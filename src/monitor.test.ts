import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { HallMonitorConfig } from "./config.js";
import type {
	DiscourseRawPost,
	DiscourseRawTopic,
	DiscourseTopicDetailResponse,
	DiscourseTopicListResponse,
} from "./discourse/types.js";
import { runMonitor } from "./monitor.js";
import { closeDatabase, getSeenTopic, openDatabase, upsertSeenTopic } from "./storage/db.js";

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
		severityThreshold: "medium",
		outputFormat: "terminal",
		dbPath: null,
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
		// Pre-seed a seen topic with 3 posts
		const dbPath = join(tempDir, "test.db");
		const db = openDatabase(dbPath);
		upsertSeenTopic(db, 10, 3);
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
		expect(logs.some((l) => l.includes("0 new, 0 updated, 0 unchanged"))).toBe(true);
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
});
