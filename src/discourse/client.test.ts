import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DiscourseClient } from "./client.js";
import type { DiscourseRawTopic, DiscourseTopicListResponse } from "./types.js";

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

function makeResponse(
	topics: DiscourseRawTopic[],
	moreTopicsUrl?: string,
): DiscourseTopicListResponse {
	return {
		topic_list: {
			topics,
			...(moreTopicsUrl ? { more_topics_url: moreTopicsUrl } : {}),
		},
	};
}

function jsonResponse(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
	return new Response(JSON.stringify(body), {
		status,
		headers: { "Content-Type": "application/json", ...headers },
	});
}

describe("discourse/client", () => {
	let fetchMock: ReturnType<typeof vi.fn>;

	beforeEach(() => {
		fetchMock = vi.fn();
		vi.stubGlobal("fetch", fetchMock);
		vi.spyOn(console, "error").mockImplementation(() => {});
	});

	afterEach(() => {
		vi.restoreAllMocks();
		vi.unstubAllGlobals();
	});

	it("fetches topics from /latest.json and returns typed Topic[]", async () => {
		const raw = makeTopic({ id: 42, title: "A Real Topic" });
		fetchMock.mockResolvedValueOnce(jsonResponse(makeResponse([raw])));

		const client = new DiscourseClient("https://forum.example.com");
		const topics = await client.fetchLatestTopics();

		expect(fetchMock).toHaveBeenCalledOnce();
		expect(fetchMock.mock.calls[0][0]).toBe("https://forum.example.com/latest.json?page=0");

		expect(topics).toHaveLength(1);
		expect(topics[0]).toEqual({
			id: 42,
			title: "A Real Topic",
			slug: "test-topic",
			postsCount: 3,
			views: 100,
			likeCount: 5,
			createdAt: "2026-01-15T10:00:00.000Z",
			lastPostedAt: "2026-01-16T12:00:00.000Z",
			categoryId: 7,
			tags: ["bug"],
			excerpt: "This is a test topic excerpt",
		});
	});

	it("sends Api-Key and Api-Username headers when configured", async () => {
		fetchMock.mockResolvedValueOnce(jsonResponse(makeResponse([])));

		const client = new DiscourseClient("https://forum.example.com", {
			apiKey: "my-key",
			apiUsername: "system",
		});
		await client.fetchLatestTopics();

		const [, init] = fetchMock.mock.calls[0];
		expect(init.headers["Api-Key"]).toBe("my-key");
		expect(init.headers["Api-Username"]).toBe("system");
	});

	it("does not send auth headers when no key provided", async () => {
		fetchMock.mockResolvedValueOnce(jsonResponse(makeResponse([])));

		const client = new DiscourseClient("https://forum.example.com");
		await client.fetchLatestTopics();

		const [, init] = fetchMock.mock.calls[0];
		expect(init.headers["Api-Key"]).toBeUndefined();
		expect(init.headers["Api-Username"]).toBeUndefined();
	});

	it("handles pagination across multiple pages", async () => {
		const page0Topics = [makeTopic({ id: 1 }), makeTopic({ id: 2 })];
		const page1Topics = [makeTopic({ id: 3 })];

		fetchMock
			.mockResolvedValueOnce(jsonResponse(makeResponse(page0Topics, "/latest.json?page=1")))
			.mockResolvedValueOnce(jsonResponse(makeResponse(page1Topics)));

		const client = new DiscourseClient("https://forum.example.com");
		const topics = await client.fetchLatestTopics();

		expect(fetchMock).toHaveBeenCalledTimes(2);
		expect(fetchMock.mock.calls[1][0]).toBe("https://forum.example.com/latest.json?page=1");
		expect(topics).toHaveLength(3);
		expect(topics.map((t) => t.id)).toEqual([1, 2, 3]);
	});

	it("stops at configured limit", async () => {
		const page0Topics = [makeTopic({ id: 1 }), makeTopic({ id: 2 }), makeTopic({ id: 3 })];

		fetchMock.mockResolvedValueOnce(jsonResponse(makeResponse(page0Topics, "/latest.json?page=1")));

		const client = new DiscourseClient("https://forum.example.com");
		const topics = await client.fetchLatestTopics(2);

		// Should not fetch page 1 since limit already reached
		expect(fetchMock).toHaveBeenCalledOnce();
		expect(topics).toHaveLength(2);
		expect(topics.map((t) => t.id)).toEqual([1, 2]);
	});

	it("handles HTTP 429 with Retry-After", async () => {
		vi.useFakeTimers();

		const rateLimited = new Response("", {
			status: 429,
			headers: { "Retry-After": "2" },
		});
		const successResponse = jsonResponse(makeResponse([makeTopic({ id: 1 })]));

		fetchMock.mockResolvedValueOnce(rateLimited).mockResolvedValueOnce(successResponse);

		const client = new DiscourseClient("https://forum.example.com");
		const promise = client.fetchLatestTopics();

		// Advance past the 2-second retry wait
		await vi.advanceTimersByTimeAsync(2000);

		const topics = await promise;

		expect(fetchMock).toHaveBeenCalledTimes(2);
		expect(topics).toHaveLength(1);
		expect(topics[0].id).toBe(1);

		vi.useRealTimers();
	});

	it("returns partial results when retry after 429 also fails", async () => {
		vi.useFakeTimers();

		// Page 0 succeeds
		fetchMock.mockResolvedValueOnce(
			jsonResponse(makeResponse([makeTopic({ id: 1 })], "/latest.json?page=1")),
		);
		// Page 1 gets rate-limited twice
		const rateLimited = new Response("", {
			status: 429,
			headers: { "Retry-After": "1" },
		});
		fetchMock.mockResolvedValueOnce(rateLimited);
		fetchMock.mockResolvedValueOnce(new Response("", { status: 429 }));

		const client = new DiscourseClient("https://forum.example.com");
		const promise = client.fetchLatestTopics();

		await vi.advanceTimersByTimeAsync(1000);

		const topics = await promise;

		expect(topics).toHaveLength(1);
		expect(topics[0].id).toBe(1);

		vi.useRealTimers();
	});

	it("handles HTTP 500 errors gracefully", async () => {
		fetchMock.mockResolvedValueOnce(new Response("Internal Server Error", { status: 500 }));

		const client = new DiscourseClient("https://forum.example.com");
		const topics = await client.fetchLatestTopics();

		expect(topics).toEqual([]);
		expect(console.error).toHaveBeenCalledWith(expect.stringContaining("HTTP 500"));
	});

	it("handles network failures gracefully", async () => {
		fetchMock.mockRejectedValueOnce(new Error("ECONNREFUSED"));

		const client = new DiscourseClient("https://forum.example.com");
		const topics = await client.fetchLatestTopics();

		expect(topics).toEqual([]);
		expect(console.error).toHaveBeenCalledWith(expect.stringContaining("Network error"));
	});

	it("returns empty array when API returns no topics", async () => {
		fetchMock.mockResolvedValueOnce(jsonResponse(makeResponse([])));

		const client = new DiscourseClient("https://forum.example.com");
		const topics = await client.fetchLatestTopics();

		expect(topics).toEqual([]);
	});

	it("strips trailing slash from base URL", async () => {
		fetchMock.mockResolvedValueOnce(jsonResponse(makeResponse([])));

		const client = new DiscourseClient("https://forum.example.com/");
		await client.fetchLatestTopics();

		expect(fetchMock.mock.calls[0][0]).toBe("https://forum.example.com/latest.json?page=0");
	});

	it("defaults tags to empty array when missing from raw topic", async () => {
		const raw = makeTopic({ id: 1 });
		// Simulate Discourse returning no tags field
		const rawWithoutTags = { ...raw } as Record<string, unknown>;
		rawWithoutTags.tags = undefined;

		fetchMock.mockResolvedValueOnce(jsonResponse({ topic_list: { topics: [rawWithoutTags] } }));

		const client = new DiscourseClient("https://forum.example.com");
		const topics = await client.fetchLatestTopics();

		expect(topics[0].tags).toEqual([]);
	});
});
