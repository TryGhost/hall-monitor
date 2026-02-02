import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ClassificationResult } from "../analysis/types.js";
import type { JsonFinding } from "./json.js";
import { printJsonReport } from "./json.js";

function makeFinding(overrides: Partial<ClassificationResult> = {}): ClassificationResult {
	return {
		topicId: 1,
		topicUrl: "https://forum.example.com/t/test/1",
		title: "Test Topic",
		category: "bug-report",
		severity: "medium",
		summary: "A bug was found",
		reasoning: "User reports broken behavior",
		...overrides,
	};
}

describe("printJsonReport", () => {
	let logSpy: ReturnType<typeof vi.spyOn>;

	beforeEach(() => {
		logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	function getOutput(): JsonFinding[] {
		const raw = logSpy.mock.calls.map((c) => c[0] as string).join("");
		return JSON.parse(raw);
	}

	it("outputs valid JSON array to stdout", () => {
		printJsonReport([makeFinding()]);

		const findings = getOutput();
		expect(Array.isArray(findings)).toBe(true);
		expect(findings).toHaveLength(1);
	});

	it("outputs empty array when no results", () => {
		printJsonReport([]);

		const findings = getOutput();
		expect(findings).toEqual([]);
	});

	it("filters out noise results", () => {
		const results = [
			makeFinding({ topicId: 1, category: "bug-report" }),
			makeFinding({ topicId: 2, category: "noise" }),
		];

		printJsonReport(results);

		const findings = getOutput();
		expect(findings).toHaveLength(1);
		expect(findings[0].topicId).toBe(1);
	});

	it("includes all required fields", () => {
		printJsonReport([
			makeFinding({
				topicId: 42,
				topicUrl: "https://forum.example.com/t/test/42",
				title: "My Topic",
				category: "security",
				severity: "critical",
				summary: "Security issue",
				reasoning: "Potential vulnerability",
			}),
		]);

		const findings = getOutput();
		const finding = findings[0];

		expect(finding.topicId).toBe(42);
		expect(finding.topicUrl).toBe("https://forum.example.com/t/test/42");
		expect(finding.title).toBe("My Topic");
		expect(finding.category).toBe("security");
		expect(finding.severity).toBe("critical");
		expect(finding.summary).toBe("Security issue");
		expect(finding.reasoning).toBe("Potential vulnerability");
		expect(finding.detectedAt).toBeDefined();
	});

	it("detectedAt is a valid ISO timestamp", () => {
		printJsonReport([makeFinding()]);

		const findings = getOutput();
		const date = new Date(findings[0].detectedAt);
		expect(date.toISOString()).toBe(findings[0].detectedAt);
	});

	it("contains no ANSI escape codes", () => {
		printJsonReport([
			makeFinding({ severity: "critical" }),
			makeFinding({ topicId: 2, severity: "high" }),
		]);

		const raw = logSpy.mock.calls.map((c) => c[0] as string).join("");
		expect(raw).not.toContain("\x1b[");
	});

	it("preserves all findings in order", () => {
		const results = [
			makeFinding({ topicId: 1, category: "bug-report" }),
			makeFinding({ topicId: 2, category: "security" }),
			makeFinding({ topicId: 3, category: "feature-request" }),
		];

		printJsonReport(results);

		const findings = getOutput();
		expect(findings).toHaveLength(3);
		expect(findings[0].topicId).toBe(1);
		expect(findings[1].topicId).toBe(2);
		expect(findings[2].topicId).toBe(3);
	});
});
