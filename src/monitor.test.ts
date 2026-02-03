import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ClassificationResult } from "./analysis/types.js";
import type { HallMonitorConfig } from "./config.js";
import type {
	DiscourseCategoriesResponse,
	DiscourseRawPost,
	DiscourseRawTopic,
	DiscourseTopicDetailResponse,
	DiscourseTopicListResponse,
} from "./discourse/types.js";
import { runMonitor } from "./monitor.js";
import {
	closeDatabase,
	getSeenTopic,
	openDatabase,
	saveAnalysisResult,
	upsertSeenTopic,
} from "./storage/db.js";

vi.mock("./analysis/classifier.js", () => ({
	classifyTopic: vi.fn(),
}));

function makeTopic(overrides: Partial<DiscourseRawTopic> = {}): DiscourseRawTopic {
	return {
		id: 1,
		title: "Test Topic",
		slug: "test-topic",
		posts_count: 3,
		views: 100,
		like_count: 5,
		created_at: "2026-01-15T10:00:00.000Z",
		last_posted_at: "2026-01-16T12:00:00.000Z",
		category_id: 7,
		tags: ["bug"],
		excerpt: "This is a test topic excerpt",
		...overrides,
	};
}

function makeResponse(topics: DiscourseRawTopic[]): DiscourseTopicListResponse {
	return { topic_list: { topics } };
}

function jsonResponse(body: unknown): Response {
	return new Response(JSON.stringify(body), {
		status: 200,
		headers: { "Content-Type": "application/json" },
	});
}

function makeConfig(overrides: Partial<HallMonitorConfig> = {}): HallMonitorConfig {
	return {
		url: "https://forum.example.com",
		apiKey: null,
		apiUsername: null,
		categories: [],
		tags: [],
		checkIntervalTopics: 100,
		anthropicApiKey: null,
		model: "haiku",
		severityThreshold: "medium",
		outputFormat: "terminal",
		dbPath: null,
		filterMinReplies: 1,
		filterMinViews: 5,
		filterMaxAgeDays: 30,
		filterExcludeCategories: [],
		...overrides,
	};
}

function makeRawPost(overrides: Partial<DiscourseRawPost> = {}): DiscourseRawPost {
	return {
		id: 100,
		post_number: 1,
		cooked: "<p>Post body</p>",
		username: "alice",
		created_at: "2026-01-15T10:00:00.000Z",
		updated_at: "2026-01-15T10:00:00.000Z",
		like_count: 2,
		reply_count: 0,
		...overrides,
	};
}

function makeTopicDetailResponse(
	topicId: number,
	overrides: Partial<DiscourseTopicDetailResponse> = {},
): DiscourseTopicDetailResponse {
	const opId = topicId * 100;
	return {
		id: topicId,
		title: `Topic ${topicId}`,
		slug: `topic-${topicId}`,
		posts_count: 1,
		views: 100,
		like_count: 5,
		created_at: "2026-01-15T10:00:00.000Z",
		last_posted_at: "2026-01-16T12:00:00.000Z",
		category_id: 7,
		tags: [],
		post_stream: {
			posts: [makeRawPost({ id: opId, post_number: 1 })],
			stream: [opId],
		},
		...overrides,
	};
}

describe("monitor", () => {
	let tempDir: string;
	let fetchMock: ReturnType<typeof vi.fn>;
	let stderrSpy: ReturnType<typeof vi.spyOn>;

	beforeEach(() => {
		tempDir = mkdtempSync(join(tmpdir(), "hall-monitor-monitor-test-"));
		fetchMock = vi.fn();
		vi.stubGlobal("fetch", fetchMock);
		stderrSpy = vi.spyOn(console, "error").mockImplementation(() => {});
	});

	afterEach(() => {
		vi.restoreAllMocks();
		vi.unstubAllGlobals();
		rmSync(tempDir, { recursive: true });
	});

	it("fetches topics and logs progress to stderr", async () => {
		const topics = [makeTopic({ id: 1 }), makeTopic({ id: 2 })];
		fetchMock.mockResolvedValueOnce(jsonResponse(makeResponse(topics)));
		fetchMock.mockResolvedValueOnce(jsonResponse(makeTopicDetailResponse(1)));
		fetchMock.mockResolvedValueOnce(jsonResponse(makeTopicDetailResponse(2)));

		const config = makeConfig({ dbPath: join(tempDir, "test.db") });
		await runMonitor(config);

		const logs = stderrSpy.mock.calls.map((c) => c[0] as string);
		expect(logs.some((l) => l.includes("Database opened"))).toBe(true);
		expect(logs.some((l) => l.includes("Run #"))).toBe(true);
		expect(logs.some((l) => l.includes("Discourse client ready"))).toBe(true);
		expect(logs.some((l) => l.includes("Fetched 2 topics"))).toBe(true);
		expect(logs.some((l) => l.includes("complete"))).toBe(true);
	});

	it("identifies new topics (not in seen_topics)", async () => {
		const topics = [makeTopic({ id: 10 }), makeTopic({ id: 20 })];
		fetchMock.mockResolvedValueOnce(jsonResponse(makeResponse(topics)));
		fetchMock.mockResolvedValueOnce(jsonResponse(makeTopicDetailResponse(10)));
		fetchMock.mockResolvedValueOnce(jsonResponse(makeTopicDetailResponse(20)));

		const config = makeConfig({ dbPath: join(tempDir, "test.db") });
		await runMonitor(config);

		const logs = stderrSpy.mock.calls.map((c) => c[0] as string);
		expect(logs.some((l) => l.includes("2 new"))).toBe(true);
	});

	it("identifies updated topics (postsCount > last_post_number)", async () => {
		// Pre-seed a seen topic with 3 posts
		const dbPath = join(tempDir, "test.db");
		const db = openDatabase(dbPath);
		upsertSeenTopic(db, 10, 3);
		closeDatabase(db);

		// Return topic 10 with 5 posts (updated) and topic 20 (new)
		const topics = [makeTopic({ id: 10, posts_count: 5 }), makeTopic({ id: 20, posts_count: 2 })];
		fetchMock.mockResolvedValueOnce(jsonResponse(makeResponse(topics)));
		fetchMock.mockResolvedValueOnce(jsonResponse(makeTopicDetailResponse(10)));
		fetchMock.mockResolvedValueOnce(jsonResponse(makeTopicDetailResponse(20)));

		const config = makeConfig({ dbPath });
		await runMonitor(config);

		const logs = stderrSpy.mock.calls.map((c) => c[0] as string);
		const topicLine = logs.find((l) => l.includes("new") && l.includes("updated"));
		expect(topicLine).toBeDefined();
		expect(topicLine).toContain("1 new");
		expect(topicLine).toContain("1 updated");
	});

	it("skips unchanged topics", async () => {
		// Pre-seed a seen topic with 3 posts and an analysis result
		const dbPath = join(tempDir, "test.db");
		const db = openDatabase(dbPath);
		upsertSeenTopic(db, 10, 3);
		saveAnalysisResult(db, {
			topicId: 10,
			category: "noise",
			severity: "low",
			summary: "Nothing here",
			reasoning: "Not actionable",
		});
		closeDatabase(db);

		// Return topic 10 with same 3 posts (unchanged)
		const topics = [makeTopic({ id: 10, posts_count: 3 })];
		fetchMock.mockResolvedValueOnce(jsonResponse(makeResponse(topics)));

		const config = makeConfig({ dbPath });
		await runMonitor(config);

		const logs = stderrSpy.mock.calls.map((c) => c[0] as string);
		const topicLine = logs.find((l) => l.includes("unchanged"));
		expect(topicLine).toBeDefined();
		expect(topicLine).toContain("1 unchanged");
		expect(topicLine).toContain("0 new");
	});

	it("retries seen topics that were never classified", async () => {
		// Pre-seed a seen topic with NO analysis result (e.g. previous run failed)
		const dbPath = join(tempDir, "test.db");
		const db = openDatabase(dbPath);
		upsertSeenTopic(db, 10, 3);
		closeDatabase(db);

		// Return topic 10 with same 3 posts — but it has no analysis result
		const topics = [makeTopic({ id: 10, posts_count: 3 })];
		fetchMock.mockResolvedValueOnce(jsonResponse(makeResponse(topics)));
		fetchMock.mockResolvedValueOnce(jsonResponse(makeTopicDetailResponse(10)));

		const config = makeConfig({ dbPath });
		await runMonitor(config);

		const logs = stderrSpy.mock.calls.map((c) => c[0] as string);
		const topicLine = logs.find((l) => l.includes("pending"));
		expect(topicLine).toBeDefined();
		expect(topicLine).toContain("1 pending");

		// Should have fetched details (1 for /latest.json + 1 for /t/10.json)
		expect(fetchMock).toHaveBeenCalledTimes(2);
		expect(fetchMock.mock.calls[1][0]).toContain("/t/10.json");
	});

	it("updates seen_topics for all fetched topics", async () => {
		const dbPath = join(tempDir, "test.db");
		const topics = [makeTopic({ id: 10, posts_count: 5 }), makeTopic({ id: 20, posts_count: 8 })];
		fetchMock.mockResolvedValueOnce(jsonResponse(makeResponse(topics)));
		fetchMock.mockResolvedValueOnce(jsonResponse(makeTopicDetailResponse(10)));
		fetchMock.mockResolvedValueOnce(jsonResponse(makeTopicDetailResponse(20)));

		const config = makeConfig({ dbPath });
		await runMonitor(config);

		// Verify the database was updated
		const db = openDatabase(dbPath);
		const seen10 = getSeenTopic(db, 10);
		const seen20 = getSeenTopic(db, 20);
		closeDatabase(db);

		expect(seen10?.last_post_number).toBe(5);
		expect(seen20?.last_post_number).toBe(8);
	});

	it("logs run start/end with correct counts", async () => {
		const dbPath = join(tempDir, "test.db");
		const topics = [makeTopic({ id: 1 }), makeTopic({ id: 2 }), makeTopic({ id: 3 })];
		fetchMock.mockResolvedValueOnce(jsonResponse(makeResponse(topics)));
		fetchMock.mockResolvedValueOnce(jsonResponse(makeTopicDetailResponse(1)));
		fetchMock.mockResolvedValueOnce(jsonResponse(makeTopicDetailResponse(2)));
		fetchMock.mockResolvedValueOnce(jsonResponse(makeTopicDetailResponse(3)));

		const config = makeConfig({ dbPath });
		await runMonitor(config);

		// Verify run_log was written
		const db = openDatabase(dbPath);
		const row = db.prepare("SELECT * FROM run_log ORDER BY id DESC LIMIT 1").get() as {
			id: number;
			started_at: string;
			completed_at: string;
			topics_checked: number;
			findings_count: number;
		};
		closeDatabase(db);

		expect(row.completed_at).toBeTruthy();
		expect(row.topics_checked).toBe(3);
		expect(row.findings_count).toBe(0);
	});

	it("suppresses progress logs in JSON output mode", async () => {
		fetchMock.mockResolvedValueOnce(jsonResponse(makeResponse([])));

		const config = makeConfig({
			dbPath: join(tempDir, "test.db"),
			outputFormat: "json",
		});
		await runMonitor(config);

		const logs = stderrSpy.mock.calls.map((c) => c[0] as string);
		const progressLogs = logs.filter((l) => l.startsWith("▸"));
		expect(progressLogs).toHaveLength(0);
	});

	it("handles zero topics gracefully", async () => {
		fetchMock.mockResolvedValueOnce(jsonResponse(makeResponse([])));

		const config = makeConfig({ dbPath: join(tempDir, "test.db") });
		await runMonitor(config);

		const logs = stderrSpy.mock.calls.map((c) => c[0] as string);
		expect(logs.some((l) => l.includes("Fetched 0 topics"))).toBe(true);
		expect(logs.some((l) => l.includes("0 new, 0 updated, 0 pending, 0 unchanged"))).toBe(true);
		expect(logs.some((l) => l.includes("0 topics checked"))).toBe(true);
	});

	it("fetches details for new topics", async () => {
		const topics = [makeTopic({ id: 10 }), makeTopic({ id: 20 })];
		fetchMock.mockResolvedValueOnce(jsonResponse(makeResponse(topics)));
		fetchMock.mockResolvedValueOnce(jsonResponse(makeTopicDetailResponse(10)));
		fetchMock.mockResolvedValueOnce(jsonResponse(makeTopicDetailResponse(20)));

		const config = makeConfig({ dbPath: join(tempDir, "test.db") });
		await runMonitor(config);

		// 1 call for /latest.json + 2 calls for /t/{id}.json
		expect(fetchMock).toHaveBeenCalledTimes(3);
		expect(fetchMock.mock.calls[1][0]).toContain("/t/10.json");
		expect(fetchMock.mock.calls[2][0]).toContain("/t/20.json");
	});

	it("fetches details for updated topics", async () => {
		const dbPath = join(tempDir, "test.db");
		const db = openDatabase(dbPath);
		upsertSeenTopic(db, 10, 3);
		closeDatabase(db);

		// Topic 10 now has 5 posts (updated)
		const topics = [makeTopic({ id: 10, posts_count: 5 })];
		fetchMock.mockResolvedValueOnce(jsonResponse(makeResponse(topics)));
		fetchMock.mockResolvedValueOnce(jsonResponse(makeTopicDetailResponse(10)));

		const config = makeConfig({ dbPath });
		await runMonitor(config);

		expect(fetchMock).toHaveBeenCalledTimes(2);
		expect(fetchMock.mock.calls[1][0]).toContain("/t/10.json");
	});

	it("skips detail fetch for unchanged topics", async () => {
		const dbPath = join(tempDir, "test.db");
		const db = openDatabase(dbPath);
		upsertSeenTopic(db, 10, 3);
		saveAnalysisResult(db, {
			topicId: 10,
			category: "noise",
			severity: "low",
			summary: "Nothing here",
			reasoning: "Not actionable",
		});
		closeDatabase(db);

		// Topic 10 still has 3 posts (unchanged)
		const topics = [makeTopic({ id: 10, posts_count: 3 })];
		fetchMock.mockResolvedValueOnce(jsonResponse(makeResponse(topics)));

		const config = makeConfig({ dbPath });
		await runMonitor(config);

		// Only 1 call for /latest.json, no detail fetches
		expect(fetchMock).toHaveBeenCalledTimes(1);
	});

	it("handles null (deleted/private) topics gracefully during detail fetch", async () => {
		const topics = [makeTopic({ id: 10 }), makeTopic({ id: 20 })];
		fetchMock.mockResolvedValueOnce(jsonResponse(makeResponse(topics)));
		// Topic 10 returns 404
		fetchMock.mockResolvedValueOnce(new Response("Not Found", { status: 404 }));
		// Topic 20 succeeds
		fetchMock.mockResolvedValueOnce(jsonResponse(makeTopicDetailResponse(20)));

		const config = makeConfig({ dbPath: join(tempDir, "test.db") });
		await runMonitor(config);

		const logs = stderrSpy.mock.calls.map((c) => c[0] as string);
		expect(logs.some((l) => l.includes("Skipping topic 10"))).toBe(true);
		expect(logs.some((l) => l.includes("Fetched details for 1/2 topics"))).toBe(true);
	});

	it("skips detail fetch for topics filtered by excluded category", async () => {
		const topics = [makeTopic({ id: 10, category_id: 7 }), makeTopic({ id: 20, category_id: 99 })];
		fetchMock.mockResolvedValueOnce(jsonResponse(makeResponse(topics)));
		// Only topic 10 should get a detail fetch
		fetchMock.mockResolvedValueOnce(jsonResponse(makeTopicDetailResponse(10)));

		const config = makeConfig({
			dbPath: join(tempDir, "test.db"),
			filterExcludeCategories: [99],
		});
		await runMonitor(config);

		// 1 call for /latest.json + 1 call for topic 10 only
		expect(fetchMock).toHaveBeenCalledTimes(2);
		expect(fetchMock.mock.calls[1][0]).toContain("/t/10.json");

		const logs = stderrSpy.mock.calls.map((c) => c[0] as string);
		expect(logs.some((l) => l.includes("Filtered topic 20"))).toBe(true);
		expect(logs.some((l) => l.includes("1 passed, 1 filtered"))).toBe(true);
	});

	it("skips detail fetch for low-engagement topics", async () => {
		const topics = [
			makeTopic({ id: 10, posts_count: 1, views: 2 }),
			makeTopic({ id: 20, posts_count: 5, views: 200 }),
		];
		fetchMock.mockResolvedValueOnce(jsonResponse(makeResponse(topics)));
		// Only topic 20 should get a detail fetch
		fetchMock.mockResolvedValueOnce(jsonResponse(makeTopicDetailResponse(20)));

		const config = makeConfig({ dbPath: join(tempDir, "test.db") });
		await runMonitor(config);

		expect(fetchMock).toHaveBeenCalledTimes(2);
		expect(fetchMock.mock.calls[1][0]).toContain("/t/20.json");
	});

	it("still tracks filtered topics in seen_topics", async () => {
		const dbPath = join(tempDir, "test.db");
		const topics = [
			makeTopic({ id: 10, posts_count: 1, views: 1 }),
			makeTopic({ id: 20, posts_count: 5, views: 200 }),
		];
		fetchMock.mockResolvedValueOnce(jsonResponse(makeResponse(topics)));
		fetchMock.mockResolvedValueOnce(jsonResponse(makeTopicDetailResponse(20)));

		const config = makeConfig({ dbPath });
		await runMonitor(config);

		// Both topics should be in seen_topics, even though topic 10 was filtered
		const db = openDatabase(dbPath);
		const seen10 = getSeenTopic(db, 10);
		const seen20 = getSeenTopic(db, 20);
		closeDatabase(db);

		expect(seen10).toBeTruthy();
		expect(seen20).toBeTruthy();
	});

	it("runs LLM analysis when anthropicApiKey is configured", async () => {
		const { classifyTopic } = await import("./analysis/classifier.js");
		const classifyMock = vi.mocked(classifyTopic);

		const mockResult: ClassificationResult = {
			topicId: 10,
			topicUrl: "https://forum.example.com/t/topic-10/10",
			title: "Topic 10",
			category: "bug-report",
			severity: "high",
			summary: "A bug was found",
			reasoning: "User reports broken behavior",
		};
		classifyMock.mockResolvedValue(mockResult);

		const topics = [makeTopic({ id: 10 })];
		fetchMock.mockResolvedValueOnce(jsonResponse(makeResponse(topics)));
		fetchMock.mockResolvedValueOnce(jsonResponse(makeTopicDetailResponse(10)));

		const dbPath = join(tempDir, "test.db");
		const config = makeConfig({ dbPath, anthropicApiKey: "sk-test" });
		await runMonitor(config);

		expect(classifyMock).toHaveBeenCalledTimes(1);
		expect(classifyMock).toHaveBeenCalledWith(
			expect.objectContaining({ id: 10 }),
			"sk-test",
			"haiku",
		);

		// Verify findings count in run_log
		const db = openDatabase(dbPath);
		const row = db.prepare("SELECT findings_count FROM run_log ORDER BY id DESC LIMIT 1").get() as {
			findings_count: number;
		};
		closeDatabase(db);
		expect(row.findings_count).toBe(1);
	});

	it("records findings_count excluding noise", async () => {
		const { classifyTopic } = await import("./analysis/classifier.js");
		const classifyMock = vi.mocked(classifyTopic);

		classifyMock.mockResolvedValueOnce({
			topicId: 10,
			topicUrl: "https://forum.example.com/t/topic-10/10",
			title: "Topic 10",
			category: "bug-report",
			severity: "high",
			summary: "Bug",
			reasoning: "Reason",
		});
		classifyMock.mockResolvedValueOnce({
			topicId: 20,
			topicUrl: "https://forum.example.com/t/topic-20/20",
			title: "Topic 20",
			category: "noise",
			severity: "low",
			summary: "Noise",
			reasoning: "Not actionable",
		});

		const topics = [makeTopic({ id: 10 }), makeTopic({ id: 20 })];
		fetchMock.mockResolvedValueOnce(jsonResponse(makeResponse(topics)));
		fetchMock.mockResolvedValueOnce(jsonResponse(makeTopicDetailResponse(10)));
		fetchMock.mockResolvedValueOnce(jsonResponse(makeTopicDetailResponse(20)));

		const dbPath = join(tempDir, "test.db");
		const config = makeConfig({ dbPath, anthropicApiKey: "sk-test" });
		await runMonitor(config);

		const db = openDatabase(dbPath);
		const row = db.prepare("SELECT findings_count FROM run_log ORDER BY id DESC LIMIT 1").get() as {
			findings_count: number;
		};
		closeDatabase(db);
		// Only the bug-report counts, noise is excluded
		expect(row.findings_count).toBe(1);
	});

	it("skips analysis when no API key is configured", async () => {
		const { classifyTopic } = await import("./analysis/classifier.js");
		const classifyMock = vi.mocked(classifyTopic);
		classifyMock.mockClear();

		const topics = [makeTopic({ id: 10 })];
		fetchMock.mockResolvedValueOnce(jsonResponse(makeResponse(topics)));
		fetchMock.mockResolvedValueOnce(jsonResponse(makeTopicDetailResponse(10)));

		const config = makeConfig({ dbPath: join(tempDir, "test.db"), anthropicApiKey: null });
		await runMonitor(config);

		expect(classifyMock).not.toHaveBeenCalled();

		const logs = stderrSpy.mock.calls.map((c) => c[0] as string);
		expect(logs.some((l) => l.includes("Skipping LLM analysis"))).toBe(true);
	});

	it("saves analysis results to the database", async () => {
		const { classifyTopic } = await import("./analysis/classifier.js");
		const classifyMock = vi.mocked(classifyTopic);

		classifyMock.mockResolvedValueOnce({
			topicId: 10,
			topicUrl: "https://forum.example.com/t/topic-10/10",
			title: "Topic 10",
			category: "security",
			severity: "critical",
			summary: "Security issue found",
			reasoning: "Potential vulnerability",
		});

		const topics = [makeTopic({ id: 10 })];
		fetchMock.mockResolvedValueOnce(jsonResponse(makeResponse(topics)));
		fetchMock.mockResolvedValueOnce(jsonResponse(makeTopicDetailResponse(10)));

		const dbPath = join(tempDir, "test.db");
		const config = makeConfig({ dbPath, anthropicApiKey: "sk-test" });
		await runMonitor(config);

		const db = openDatabase(dbPath);
		const row = db.prepare("SELECT * FROM analysis_results WHERE topic_id = 10").get() as {
			topic_id: number;
			category: string;
			severity: string;
			summary: string;
		};
		closeDatabase(db);

		expect(row.topic_id).toBe(10);
		expect(row.category).toBe("security");
		expect(row.severity).toBe("critical");
		expect(row.summary).toBe("Security issue found");
	});

	it("fetches from categories when configured", async () => {
		// First call: /categories.json
		const categoriesResp: DiscourseCategoriesResponse = {
			category_list: {
				categories: [{ id: 5, name: "Bugs", slug: "bugs" }],
			},
		};
		fetchMock.mockResolvedValueOnce(jsonResponse(categoriesResp));
		// Second call: /c/bugs/5.json?page=0
		const catTopics = [makeTopic({ id: 10 }), makeTopic({ id: 20 })];
		fetchMock.mockResolvedValueOnce(jsonResponse(makeResponse(catTopics)));
		// Detail fetches
		fetchMock.mockResolvedValueOnce(jsonResponse(makeTopicDetailResponse(10)));
		fetchMock.mockResolvedValueOnce(jsonResponse(makeTopicDetailResponse(20)));

		const config = makeConfig({
			dbPath: join(tempDir, "test.db"),
			categories: ["bugs"],
		});
		await runMonitor(config);

		// Verify /categories.json was called
		expect(fetchMock.mock.calls[0][0]).toContain("/categories.json");
		// Verify /c/bugs/5.json was called
		expect(fetchMock.mock.calls[1][0]).toContain("/c/bugs/5.json");

		const logs = stderrSpy.mock.calls.map((c) => c[0] as string);
		expect(logs.some((l) => l.includes("Fetched 2 topics"))).toBe(true);
	});

	it("fetches from tags when configured", async () => {
		// /tag/security.json?page=0
		const tagTopics = [makeTopic({ id: 30 })];
		fetchMock.mockResolvedValueOnce(jsonResponse(makeResponse(tagTopics)));
		// Detail fetch
		fetchMock.mockResolvedValueOnce(jsonResponse(makeTopicDetailResponse(30)));

		const config = makeConfig({
			dbPath: join(tempDir, "test.db"),
			tags: ["security"],
		});
		await runMonitor(config);

		expect(fetchMock.mock.calls[0][0]).toContain("/tag/security.json");

		const logs = stderrSpy.mock.calls.map((c) => c[0] as string);
		expect(logs.some((l) => l.includes("Fetched 1 topics"))).toBe(true);
	});

	it("deduplicates topics across overlapping sources", async () => {
		// /categories.json
		const categoriesResp: DiscourseCategoriesResponse = {
			category_list: {
				categories: [{ id: 5, name: "Bugs", slug: "bugs" }],
			},
		};
		fetchMock.mockResolvedValueOnce(jsonResponse(categoriesResp));
		// /c/bugs/5.json — returns topics 10, 20
		fetchMock.mockResolvedValueOnce(
			jsonResponse(makeResponse([makeTopic({ id: 10 }), makeTopic({ id: 20 })])),
		);
		// /tag/important.json — returns topics 20, 30 (20 is a duplicate)
		fetchMock.mockResolvedValueOnce(
			jsonResponse(makeResponse([makeTopic({ id: 20 }), makeTopic({ id: 30 })])),
		);
		// Detail fetches for 3 unique topics
		fetchMock.mockResolvedValueOnce(jsonResponse(makeTopicDetailResponse(10)));
		fetchMock.mockResolvedValueOnce(jsonResponse(makeTopicDetailResponse(20)));
		fetchMock.mockResolvedValueOnce(jsonResponse(makeTopicDetailResponse(30)));

		const config = makeConfig({
			dbPath: join(tempDir, "test.db"),
			categories: ["bugs"],
			tags: ["important"],
		});
		await runMonitor(config);

		const logs = stderrSpy.mock.calls.map((c) => c[0] as string);
		// Should have 3 unique topics, not 4
		expect(logs.some((l) => l.includes("Fetched 3 topics"))).toBe(true);
	});

	it("falls back to /latest.json when no categories or tags configured", async () => {
		fetchMock.mockResolvedValueOnce(jsonResponse(makeResponse([makeTopic({ id: 1 })])));
		fetchMock.mockResolvedValueOnce(jsonResponse(makeTopicDetailResponse(1)));

		const config = makeConfig({
			dbPath: join(tempDir, "test.db"),
			categories: [],
			tags: [],
		});
		await runMonitor(config);

		expect(fetchMock.mock.calls[0][0]).toContain("/latest.json");
	});

	it("handles failed category resolution gracefully", async () => {
		// /categories.json fails
		fetchMock.mockResolvedValueOnce(new Response("Server Error", { status: 500 }));

		const config = makeConfig({
			dbPath: join(tempDir, "test.db"),
			categories: ["nonexistent"],
		});
		await runMonitor(config);

		const logs = stderrSpy.mock.calls.map((c) => c[0] as string);
		expect(logs.some((l) => l.includes("Fetched 0 topics"))).toBe(true);
	});
});
