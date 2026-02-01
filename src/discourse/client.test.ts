import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DiscourseClient, stripHtml } from "./client.js";
import type {
	DiscourseRawPost,
	DiscourseRawTopic,
	DiscourseTopicDetailResponse,
	DiscourseTopicListResponse,
} from "./types.js";

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

function makeRawPost(overrides: Partial<DiscourseRawPost> = {}): DiscourseRawPost {
	return {
		id: 100,
		post_number: 1,
		cooked: "<p>Hello world</p>",
		username: "alice",
		created_at: "2026-01-15T10:00:00.000Z",
		updated_at: "2026-01-15T10:00:00.000Z",
		like_count: 2,
		reply_count: 0,
		...overrides,
	};
}

function makeTopicDetailResponse(
	overrides: Partial<DiscourseTopicDetailResponse> = {},
): DiscourseTopicDetailResponse {
	return {
		id: 42,
		title: "Test Topic",
		slug: "test-topic",
		posts_count: 1,
		views: 100,
		like_count: 5,
		created_at: "2026-01-15T10:00:00.000Z",
		last_posted_at: "2026-01-16T12:00:00.000Z",
		category_id: 7,
		tags: ["bug"],
		post_stream: {
			posts: [makeRawPost()],
			stream: [100],
		},
		...overrides,
	};
}

function jsonResponse(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
	return new Response(JSON.stringify(body), {
		status,
		headers: { "Content-Type": "application/json", ...headers },
	});
}

describe("stripHtml", () => {
	it("removes HTML tags", () => {
		expect(stripHtml("<p>Hello <strong>world</strong></p>")).toBe("Hello world");
	});

	it("decodes common HTML entities", () => {
		expect(stripHtml("&amp; &lt; &gt; &quot; &#39; &nbsp;")).toBe("& < > \" '");
	});

	it("collapses whitespace", () => {
		expect(stripHtml("<p>line one</p>\n\n<p>line two</p>")).toBe("line one line two");
	});

	it("handles nested tags", () => {
		expect(stripHtml("<div><p><em><strong>deep</strong></em></p></div>")).toBe("deep");
	});

	it("returns empty string for empty input", () => {
		expect(stripHtml("")).toBe("");
	});
});

describe("fetchTopicDetails", () => {
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

	it("fetches topic details and returns TopicDetails with OP and replies", async () => {
		const op = makeRawPost({ id: 100, post_number: 1, cooked: "<p>OP body</p>" });
		const reply = makeRawPost({
			id: 101,
			post_number: 2,
			cooked: "<p>A reply</p>",
			username: "bob",
		});
		const detail = makeTopicDetailResponse({
			post_stream: { posts: [op, reply], stream: [100, 101] },
		});
		fetchMock.mockResolvedValueOnce(jsonResponse(detail));

		const client = new DiscourseClient("https://forum.example.com");
		const result = await client.fetchTopicDetails(42);

		expect(result).not.toBeNull();
		expect(result?.id).toBe(42);
		expect(result?.title).toBe("Test Topic");
		expect(result?.url).toBe("https://forum.example.com/t/test-topic/42");
		expect(result?.op.body).toBe("OP body");
		expect(result?.op.postNumber).toBe(1);
		expect(result?.replies).toHaveLength(1);
		expect(result?.replies[0].body).toBe("A reply");
		expect(result?.replies[0].username).toBe("bob");
	});

	it("extracts up to 5 most recent replies when topic has many posts", async () => {
		const op = makeRawPost({ id: 100, post_number: 1 });
		const posts = [op];
		const stream = [100];
		for (let i = 1; i <= 8; i++) {
			const post = makeRawPost({ id: 100 + i, post_number: 1 + i, cooked: `<p>Reply ${i}</p>` });
			posts.push(post);
			stream.push(100 + i);
		}

		const detail = makeTopicDetailResponse({
			post_stream: { posts, stream },
		});
		fetchMock.mockResolvedValueOnce(jsonResponse(detail));

		const client = new DiscourseClient("https://forum.example.com");
		const result = await client.fetchTopicDetails(42);

		expect(result?.replies).toHaveLength(5);
		// Should be the last 5 replies (posts 5-9, IDs 104-108)
		expect(result?.replies.map((r) => r.id)).toEqual([104, 105, 106, 107, 108]);
	});

	it("fetches missing recent posts via posts.json when not in initial response", async () => {
		const op = makeRawPost({ id: 100, post_number: 1 });
		// Initial response only has the OP, but stream references more posts
		const detail = makeTopicDetailResponse({
			post_stream: { posts: [op], stream: [100, 101, 102] },
		});
		fetchMock.mockResolvedValueOnce(jsonResponse(detail));

		// Second request fetches the missing posts
		const missingPosts = {
			post_stream: {
				posts: [
					makeRawPost({ id: 101, post_number: 2, cooked: "<p>Reply 1</p>" }),
					makeRawPost({ id: 102, post_number: 3, cooked: "<p>Reply 2</p>" }),
				],
			},
		};
		fetchMock.mockResolvedValueOnce(jsonResponse(missingPosts));

		const client = new DiscourseClient("https://forum.example.com");
		const result = await client.fetchTopicDetails(42);

		expect(fetchMock).toHaveBeenCalledTimes(2);
		expect(fetchMock.mock.calls[1][0]).toContain("/t/42/posts.json?");
		expect(fetchMock.mock.calls[1][0]).toContain("post_ids[]=101");
		expect(fetchMock.mock.calls[1][0]).toContain("post_ids[]=102");
		expect(result?.replies).toHaveLength(2);
		expect(result?.replies[0].body).toBe("Reply 1");
		expect(result?.replies[1].body).toBe("Reply 2");
	});

	it("strips HTML tags from post bodies", async () => {
		const op = makeRawPost({
			id: 100,
			post_number: 1,
			cooked: '<p>This is <strong>bold</strong> and <a href="http://example.com">a link</a></p>',
		});
		const detail = makeTopicDetailResponse({
			post_stream: { posts: [op], stream: [100] },
		});
		fetchMock.mockResolvedValueOnce(jsonResponse(detail));

		const client = new DiscourseClient("https://forum.example.com");
		const result = await client.fetchTopicDetails(42);

		expect(result?.op.body).toBe("This is bold and a link");
	});

	it("returns null for 404 (deleted topic)", async () => {
		fetchMock.mockResolvedValueOnce(new Response("Not Found", { status: 404 }));

		const client = new DiscourseClient("https://forum.example.com");
		const result = await client.fetchTopicDetails(999);

		expect(result).toBeNull();
	});

	it("returns null for 403 (private topic)", async () => {
		fetchMock.mockResolvedValueOnce(new Response("Forbidden", { status: 403 }));

		const client = new DiscourseClient("https://forum.example.com");
		const result = await client.fetchTopicDetails(999);

		expect(result).toBeNull();
	});

	it("handles network errors gracefully (returns null)", async () => {
		fetchMock.mockRejectedValueOnce(new Error("ECONNREFUSED"));

		const client = new DiscourseClient("https://forum.example.com");
		const result = await client.fetchTopicDetails(42);

		expect(result).toBeNull();
	});
});
