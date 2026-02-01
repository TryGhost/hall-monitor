import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TopicDetails } from "../discourse/types.js";
import { classifyTopic, formatTopicMessage, parseClassification } from "./classifier.js";

vi.mock("@anthropic-ai/sdk", () => {
	const createMock = vi.fn();
	class MockAnthropic {
		messages = { create: createMock };
	}
	class APIError extends Error {
		status: number;
		constructor(status: number, message: string) {
			super(message);
			this.status = status;
		}
	}
	(MockAnthropic as unknown as Record<string, unknown>).APIError = APIError;
	return { default: MockAnthropic, __createMock: createMock, __APIError: APIError };
});

async function getCreateMock() {
	const mod = await import("@anthropic-ai/sdk");
	return (mod as unknown as { __createMock: ReturnType<typeof vi.fn> }).__createMock;
}

async function getAPIError() {
	const mod = await import("@anthropic-ai/sdk");
	return (
		mod as unknown as {
			__APIError: new (status: number, message: string) => Error & { status: number };
		}
	).__APIError;
}

function makeTopic(overrides: Partial<TopicDetails> = {}): TopicDetails {
	return {
		id: 42,
		title: "App crashes on startup",
		slug: "app-crashes-on-startup",
		url: "https://forum.example.com/t/app-crashes-on-startup/42",
		op: {
			id: 100,
			postNumber: 1,
			body: "When I launch the app it crashes immediately with a segfault.",
			username: "alice",
			createdAt: "2026-01-15T10:00:00.000Z",
			likeCount: 5,
			replyCount: 2,
		},
		replies: [
			{
				id: 101,
				postNumber: 2,
				body: "I can reproduce this on macOS 15.",
				username: "bob",
				createdAt: "2026-01-15T12:00:00.000Z",
				likeCount: 1,
				replyCount: 0,
			},
			{
				id: 102,
				postNumber: 3,
				body: "Same here, started after the 2.0 update.",
				username: "carol",
				createdAt: "2026-01-15T14:00:00.000Z",
				likeCount: 3,
				replyCount: 0,
			},
		],
		...overrides,
	};
}

function makeSuccessResponse(json: Record<string, string>) {
	return {
		content: [{ type: "text" as const, text: JSON.stringify(json) }],
	};
}

describe("classifier", () => {
	let stderrSpy: ReturnType<typeof vi.spyOn>;

	beforeEach(() => {
		stderrSpy = vi.spyOn(console, "error").mockImplementation(() => {});
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	it("classifies a topic successfully", async () => {
		const createMock = await getCreateMock();
		createMock.mockResolvedValueOnce(
			makeSuccessResponse({
				category: "bug-report",
				severity: "high",
				summary: "App crashes on startup after 2.0 update",
				reasoning: "Multiple users report segfault on launch, likely a regression",
			}),
		);

		const result = await classifyTopic(makeTopic(), "sk-test-key");

		expect(result).toEqual({
			topicId: 42,
			topicUrl: "https://forum.example.com/t/app-crashes-on-startup/42",
			title: "App crashes on startup",
			category: "bug-report",
			severity: "high",
			summary: "App crashes on startup after 2.0 update",
			reasoning: "Multiple users report segfault on launch, likely a regression",
		});
	});

	it("retries once on 5xx then succeeds", async () => {
		const createMock = await getCreateMock();
		const APIError = await getAPIError();

		createMock.mockRejectedValueOnce(new APIError(500, "Internal Server Error"));
		createMock.mockResolvedValueOnce(
			makeSuccessResponse({
				category: "feature-request",
				severity: "medium",
				summary: "Request for dark mode",
				reasoning: "User is asking for a new feature",
			}),
		);

		const result = await classifyTopic(makeTopic(), "sk-test-key");

		expect(createMock).toHaveBeenCalledTimes(2);
		expect(result?.category).toBe("feature-request");
	});

	it("returns null on persistent 5xx failure", async () => {
		const createMock = await getCreateMock();
		const APIError = await getAPIError();

		createMock.mockRejectedValueOnce(new APIError(500, "Internal Server Error"));
		createMock.mockRejectedValueOnce(new APIError(503, "Service Unavailable"));

		const result = await classifyTopic(makeTopic(), "sk-test-key");

		expect(result).toBeNull();
		expect(createMock).toHaveBeenCalledTimes(2);
		expect(stderrSpy).toHaveBeenCalledWith(
			expect.stringContaining("Classification failed for topic 42"),
		);
	});

	it("returns null immediately on 4xx error (no retry)", async () => {
		const createMock = await getCreateMock();
		const APIError = await getAPIError();

		createMock.mockRejectedValueOnce(new APIError(401, "Unauthorized"));

		const result = await classifyTopic(makeTopic(), "sk-test-key");

		expect(result).toBeNull();
		expect(createMock).toHaveBeenCalledTimes(1);
	});

	it("handles malformed LLM response gracefully", async () => {
		const createMock = await getCreateMock();
		createMock.mockResolvedValueOnce({
			content: [{ type: "text", text: "Sorry, I can't classify this." }],
		});

		const result = await classifyTopic(makeTopic(), "sk-test-key");

		expect(result).toBeNull();
		expect(stderrSpy).toHaveBeenCalledWith(
			expect.stringContaining("Malformed LLM response for topic 42"),
		);
	});

	it("handles response with invalid category", async () => {
		const createMock = await getCreateMock();
		createMock.mockResolvedValueOnce(
			makeSuccessResponse({
				category: "unknown-type",
				severity: "high",
				summary: "Something",
				reasoning: "Reason",
			}),
		);

		const result = await classifyTopic(makeTopic(), "sk-test-key");
		expect(result).toBeNull();
	});
});

describe("formatTopicMessage", () => {
	it("formats topic with OP and replies", () => {
		const topic = makeTopic();
		const message = formatTopicMessage(topic);

		expect(message).toContain("Title: App crashes on startup");
		expect(message).toContain("Original Post:");
		expect(message).toContain("segfault");
		expect(message).toContain("Recent Replies:");
		expect(message).toContain("[bob]:");
		expect(message).toContain("[carol]:");
	});

	it("formats topic with no replies", () => {
		const topic = makeTopic({ replies: [] });
		const message = formatTopicMessage(topic);

		expect(message).toContain("Title: App crashes on startup");
		expect(message).toContain("Original Post:");
		expect(message).not.toContain("Recent Replies:");
	});

	it("limits to 5 reply excerpts", () => {
		const replies = Array.from({ length: 8 }, (_, i) => ({
			id: 101 + i,
			postNumber: 2 + i,
			body: `Reply ${i + 1}`,
			username: `user${i}`,
			createdAt: "2026-01-15T12:00:00.000Z",
			likeCount: 0,
			replyCount: 0,
		}));
		const topic = makeTopic({ replies });
		const message = formatTopicMessage(topic);

		expect(message).toContain("[user0]:");
		expect(message).toContain("[user4]:");
		expect(message).not.toContain("[user5]:");
	});
});

describe("parseClassification", () => {
	it("parses valid JSON", () => {
		const result = parseClassification(
			JSON.stringify({
				category: "bug-report",
				severity: "high",
				summary: "A bug",
				reasoning: "Because",
			}),
		);
		expect(result).toEqual({
			category: "bug-report",
			severity: "high",
			summary: "A bug",
			reasoning: "Because",
		});
	});

	it("returns null for invalid JSON", () => {
		expect(parseClassification("not json")).toBeNull();
	});

	it("returns null for missing fields", () => {
		expect(parseClassification(JSON.stringify({ category: "bug-report" }))).toBeNull();
	});

	it("returns null for invalid category", () => {
		expect(
			parseClassification(
				JSON.stringify({
					category: "invalid",
					severity: "high",
					summary: "s",
					reasoning: "r",
				}),
			),
		).toBeNull();
	});

	it("returns null for invalid severity", () => {
		expect(
			parseClassification(
				JSON.stringify({
					category: "bug-report",
					severity: "extreme",
					summary: "s",
					reasoning: "r",
				}),
			),
		).toBeNull();
	});
});
