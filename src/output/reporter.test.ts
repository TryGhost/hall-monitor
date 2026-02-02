import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ClassificationResult } from "../analysis/types.js";
import { type RunStats, printTerminalReport } from "./reporter.js";

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

function makeStats(overrides: Partial<RunStats> = {}): RunStats {
	return {
		topicsChecked: 50,
		findingsCount: 3,
		newSinceLastRun: 3,
		...overrides,
	};
}

describe("printTerminalReport", () => {
	let logSpy: ReturnType<typeof vi.spyOn>;
	const originalNoColor = process.env.NO_COLOR;

	beforeEach(() => {
		logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
		// biome-ignore lint/performance/noDelete: delete is the correct way to unset env vars
		delete process.env.NO_COLOR;
	});

	afterEach(() => {
		vi.restoreAllMocks();
		if (originalNoColor !== undefined) {
			process.env.NO_COLOR = originalNoColor;
		} else {
			// biome-ignore lint/performance/noDelete: delete is the correct way to unset env vars
			delete process.env.NO_COLOR;
		}
	});

	it("prints 'no findings' message when results are empty", () => {
		printTerminalReport([], makeStats({ findingsCount: 0, newSinceLastRun: 0 }));

		const output = logSpy.mock.calls.map((c) => c[0] as string).join("\n");
		expect(output).toContain("No findings to report.");
		expect(output).toContain("50 topics checked");
	});

	it("filters out noise results", () => {
		const results = [
			makeFinding({ topicId: 1, category: "noise", severity: "low" }),
			makeFinding({ topicId: 2, category: "noise", severity: "low" }),
		];

		printTerminalReport(results, makeStats({ findingsCount: 0 }));

		const output = logSpy.mock.calls.map((c) => c[0] as string).join("\n");
		expect(output).toContain("No findings to report.");
	});

	it("groups findings by severity in correct order", () => {
		const results = [
			makeFinding({ topicId: 1, severity: "low", title: "Low item" }),
			makeFinding({ topicId: 2, severity: "critical", title: "Critical item" }),
			makeFinding({ topicId: 3, severity: "medium", title: "Medium item" }),
			makeFinding({ topicId: 4, severity: "high", title: "High item" }),
		];

		printTerminalReport(results, makeStats({ findingsCount: 4 }));

		const lines = logSpy.mock.calls.map((c) => c[0] as string);
		const criticalIdx = lines.findIndex((l) => l.includes("Critical item"));
		const highIdx = lines.findIndex((l) => l.includes("High item"));
		const mediumIdx = lines.findIndex((l) => l.includes("Medium item"));
		const lowIdx = lines.findIndex((l) => l.includes("Low item"));

		expect(criticalIdx).toBeLessThan(highIdx);
		expect(highIdx).toBeLessThan(mediumIdx);
		expect(mediumIdx).toBeLessThan(lowIdx);
	});

	it("shows category label and summary for each finding", () => {
		const results = [
			makeFinding({
				category: "security",
				title: "XSS in comments",
				summary: "Possible cross-site scripting",
				topicUrl: "https://forum.example.com/t/xss/42",
			}),
		];

		printTerminalReport(results, makeStats({ findingsCount: 1 }));

		const output = logSpy.mock.calls.map((c) => c[0] as string).join("\n");
		expect(output).toContain("[SECURITY]");
		expect(output).toContain("XSS in comments");
		expect(output).toContain("Possible cross-site scripting");
		expect(output).toContain("https://forum.example.com/t/xss/42");
	});

	it("highlights critical and high severity items with ANSI colors", () => {
		const results = [
			makeFinding({ severity: "critical", title: "Critical bug" }),
			makeFinding({ topicId: 2, severity: "high", title: "High bug" }),
			makeFinding({ topicId: 3, severity: "medium", title: "Medium bug" }),
		];

		printTerminalReport(results, makeStats({ findingsCount: 3 }));

		const lines = logSpy.mock.calls.map((c) => c[0] as string);
		const criticalLine = lines.find((l) => l.includes("Critical bug"));
		const highLine = lines.find((l) => l.includes("High bug"));
		const mediumLine = lines.find((l) => l.includes("Medium bug"));

		// Critical and high lines should have ANSI escape codes
		expect(criticalLine).toContain("\x1b[");
		expect(highLine).toContain("\x1b[");
		// Medium finding text should not be colored (only the header is)
		expect(mediumLine).not.toContain("\x1b[");
	});

	it("shows run summary with correct stats", () => {
		printTerminalReport(
			[makeFinding()],
			makeStats({ topicsChecked: 100, findingsCount: 5, newSinceLastRun: 3 }),
		);

		const output = logSpy.mock.calls.map((c) => c[0] as string).join("\n");
		expect(output).toContain("100 topics checked");
		expect(output).toContain("5 findings");
		expect(output).toContain("3 new since last run");
	});

	it("respects NO_COLOR environment variable", () => {
		process.env.NO_COLOR = "1";

		const results = [makeFinding({ severity: "critical", title: "Critical bug" })];
		printTerminalReport(results, makeStats({ findingsCount: 1 }));

		const lines = logSpy.mock.calls.map((c) => c[0] as string);
		for (const line of lines) {
			expect(line).not.toContain("\x1b[");
		}
	});

	it("skips severity groups with no findings", () => {
		const results = [makeFinding({ severity: "medium", title: "Only medium" })];

		printTerminalReport(results, makeStats({ findingsCount: 1 }));

		const output = logSpy.mock.calls.map((c) => c[0] as string).join("\n");
		expect(output).not.toContain("CRITICAL");
		expect(output).not.toContain("HIGH");
		expect(output).not.toContain("LOW");
		expect(output).toContain("MEDIUM");
	});
});
