import { describe, expect, it } from "vitest";
import type { HallMonitorConfig } from "./config.js";
import type { Topic } from "./discourse/types.js";
import { preFilterTopics } from "./filter.js";

const NOW = new Date("2026-02-01T00:00:00.000Z");

function makeTopic(overrides: Partial<Topic> = {}): Topic {
	return {
		id: 1,
		title: "Test Topic",
		slug: "test-topic",
		postsCount: 3,
		views: 100,
		likeCount: 5,
		createdAt: "2026-01-15T10:00:00.000Z",
		lastPostedAt: "2026-01-16T12:00:00.000Z",
		categoryId: 7,
		tags: ["bug"],
		excerpt: "This is a test topic excerpt",
		...overrides,
	};
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
		filterMinReplies: 1,
		filterMinViews: 5,
		filterMaxAgeDays: 30,
		filterExcludeCategories: [],
		...overrides,
	};
}

describe("preFilterTopics", () => {
	it("passes topics that meet all criteria", () => {
		const topic = makeTopic({ postsCount: 3, views: 100 });
		const result = preFilterTopics([topic], makeConfig(), NOW);

		expect(result.passed).toHaveLength(1);
		expect(result.filtered).toHaveLength(0);
	});

	it("filters topics in excluded categories", () => {
		const topic = makeTopic({ categoryId: 5 });
		const config = makeConfig({ filterExcludeCategories: [5, 10] });
		const result = preFilterTopics([topic], config, NOW);

		expect(result.passed).toHaveLength(0);
		expect(result.filtered).toHaveLength(1);
		expect(result.filtered[0].reason).toBe("excluded category");
	});

	it("passes topics not in excluded categories", () => {
		const topic = makeTopic({ categoryId: 7 });
		const config = makeConfig({ filterExcludeCategories: [5, 10] });
		const result = preFilterTopics([topic], config, NOW);

		expect(result.passed).toHaveLength(1);
	});

	it("filters topics older than filterMaxAgeDays", () => {
		const topic = makeTopic({ createdAt: "2025-12-01T00:00:00.000Z" });
		const config = makeConfig({ filterMaxAgeDays: 30 });
		const result = preFilterTopics([topic], config, NOW);

		expect(result.passed).toHaveLength(0);
		expect(result.filtered).toHaveLength(1);
		expect(result.filtered[0].reason).toBe("too old");
	});

	it("passes topics within age limit", () => {
		const topic = makeTopic({ createdAt: "2026-01-20T00:00:00.000Z" });
		const config = makeConfig({ filterMaxAgeDays: 30 });
		const result = preFilterTopics([topic], config, NOW);

		expect(result.passed).toHaveLength(1);
	});

	it("filters topics with low replies AND low views", () => {
		// postsCount 1 means 0 replies, views below threshold
		const topic = makeTopic({ postsCount: 1, views: 3 });
		const config = makeConfig({ filterMinReplies: 1, filterMinViews: 5 });
		const result = preFilterTopics([topic], config, NOW);

		expect(result.passed).toHaveLength(0);
		expect(result.filtered).toHaveLength(1);
		expect(result.filtered[0].reason).toBe("low engagement");
	});

	it("passes topics with low replies but high views", () => {
		const topic = makeTopic({ postsCount: 1, views: 500 });
		const config = makeConfig({ filterMinReplies: 1, filterMinViews: 5 });
		const result = preFilterTopics([topic], config, NOW);

		expect(result.passed).toHaveLength(1);
	});

	it("passes topics with many replies but low views", () => {
		const topic = makeTopic({ postsCount: 10, views: 2 });
		const config = makeConfig({ filterMinReplies: 1, filterMinViews: 5 });
		const result = preFilterTopics([topic], config, NOW);

		expect(result.passed).toHaveLength(1);
	});

	it("applies category exclusion before age check", () => {
		// Topic is both in excluded category AND too old
		const topic = makeTopic({
			categoryId: 5,
			createdAt: "2025-01-01T00:00:00.000Z",
		});
		const config = makeConfig({ filterExcludeCategories: [5], filterMaxAgeDays: 30 });
		const result = preFilterTopics([topic], config, NOW);

		expect(result.filtered[0].reason).toBe("excluded category");
	});

	it("applies age check before engagement check", () => {
		// Topic is both too old AND low engagement
		const topic = makeTopic({
			createdAt: "2025-01-01T00:00:00.000Z",
			postsCount: 1,
			views: 1,
		});
		const config = makeConfig({ filterMaxAgeDays: 30 });
		const result = preFilterTopics([topic], config, NOW);

		expect(result.filtered[0].reason).toBe("too old");
	});

	it("handles multiple topics with mixed results", () => {
		const topics = [
			makeTopic({ id: 1, postsCount: 5, views: 200 }),
			makeTopic({ id: 2, categoryId: 99 }),
			makeTopic({ id: 3, postsCount: 1, views: 1 }),
			makeTopic({ id: 4, createdAt: "2025-01-01T00:00:00.000Z" }),
		];
		const config = makeConfig({ filterExcludeCategories: [99] });
		const result = preFilterTopics(topics, config, NOW);

		expect(result.passed).toHaveLength(1);
		expect(result.passed[0].id).toBe(1);
		expect(result.filtered).toHaveLength(3);
	});

	it("handles empty topic list", () => {
		const result = preFilterTopics([], makeConfig(), NOW);

		expect(result.passed).toHaveLength(0);
		expect(result.filtered).toHaveLength(0);
	});

	it("allows filterMinReplies of 0 (any topic with views passes)", () => {
		const topic = makeTopic({ postsCount: 1, views: 10 });
		const config = makeConfig({ filterMinReplies: 0, filterMinViews: 5 });
		const result = preFilterTopics([topic], config, NOW);

		expect(result.passed).toHaveLength(1);
	});

	it("uses current time when now is not provided", () => {
		// A recent topic should pass without explicit now
		const topic = makeTopic({
			createdAt: new Date().toISOString(),
			postsCount: 3,
			views: 100,
		});
		const result = preFilterTopics([topic], makeConfig());

		expect(result.passed).toHaveLength(1);
	});
});
