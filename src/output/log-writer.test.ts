import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { JsonFinding } from "./json.js";
import { type RunLog, getReportsDir, loadRecentRuns, saveRunLog } from "./log-writer.js";

function makeFinding(overrides: Partial<JsonFinding> = {}): JsonFinding {
	return {
		topicId: 1,
		topicUrl: "https://forum.example.com/t/test/1",
		title: "Test Topic",
		category: "bug-report",
		severity: "high",
		summary: "A bug was found",
		reasoning: "User reports broken behavior",
		detectedAt: "2026-01-15T10:00:00.000Z",
		...overrides,
	};
}

describe("log-writer", () => {
	let tempDir: string;

	beforeEach(() => {
		tempDir = mkdtempSync(join(tmpdir(), "hall-monitor-log-test-"));
	});

	afterEach(() => {
		rmSync(tempDir, { recursive: true });
	});

	describe("getReportsDir", () => {
		it("returns custom path when provided", () => {
			expect(getReportsDir("/custom/path")).toBe("/custom/path");
		});

		it("returns default path when null", () => {
			const dir = getReportsDir(null);
			expect(dir).toContain(".hall-monitor");
			expect(dir).toContain("reports");
		});
	});

	describe("saveRunLog", () => {
		it("creates a JSON file with run data", () => {
			const findings = [makeFinding()];
			const stats = { topicsChecked: 10, findingsCount: 1 };

			const filePath = saveRunLog(tempDir, findings, stats);

			expect(existsSync(filePath)).toBe(true);
			const content = JSON.parse(readFileSync(filePath, "utf-8")) as RunLog;
			expect(content.stats).toEqual(stats);
			expect(content.findings).toHaveLength(1);
			expect(content.timestamp).toBeTruthy();
		});

		it("creates filesystem-safe filenames without colons", () => {
			const filePath = saveRunLog(tempDir, [], { topicsChecked: 0, findingsCount: 0 });
			expect(filePath).not.toContain(":");
			expect(filePath).toMatch(/run-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}Z\.json$/);
		});

		it("creates the directory if it does not exist", () => {
			const nested = join(tempDir, "nested", "reports");
			saveRunLog(nested, [], { topicsChecked: 0, findingsCount: 0 });
			expect(existsSync(nested)).toBe(true);
		});
	});

	describe("loadRecentRuns", () => {
		it("returns empty array when directory does not exist", () => {
			const runs = loadRecentRuns(join(tempDir, "nonexistent"));
			expect(runs).toEqual([]);
		});

		it("loads run files in reverse chronological order", () => {
			const run1: RunLog = {
				timestamp: "2026-01-01T10:00:00.000Z",
				filename: "run-2026-01-01T10-00-00Z.json",
				stats: { topicsChecked: 5, findingsCount: 1 },
				findings: [makeFinding()],
			};
			const run2: RunLog = {
				timestamp: "2026-01-02T10:00:00.000Z",
				filename: "run-2026-01-02T10-00-00Z.json",
				stats: { topicsChecked: 8, findingsCount: 2 },
				findings: [makeFinding(), makeFinding({ topicId: 2 })],
			};

			writeFileSync(join(tempDir, run1.filename), JSON.stringify(run1));
			writeFileSync(join(tempDir, run2.filename), JSON.stringify(run2));

			const runs = loadRecentRuns(tempDir);
			expect(runs).toHaveLength(2);
			expect(runs[0].timestamp).toBe("2026-01-02T10:00:00.000Z");
			expect(runs[1].timestamp).toBe("2026-01-01T10:00:00.000Z");
		});

		it("limits results to maxRuns", () => {
			for (let i = 0; i < 5; i++) {
				const run: RunLog = {
					timestamp: `2026-01-0${i + 1}T10:00:00.000Z`,
					filename: `run-2026-01-0${i + 1}T10-00-00Z.json`,
					stats: { topicsChecked: 1, findingsCount: 0 },
					findings: [],
				};
				writeFileSync(join(tempDir, run.filename), JSON.stringify(run));
			}

			const runs = loadRecentRuns(tempDir, 3);
			expect(runs).toHaveLength(3);
		});

		it("silently skips corrupted files", () => {
			writeFileSync(join(tempDir, "run-2026-01-01T10-00-00Z.json"), "not json{{{");
			const validRun: RunLog = {
				timestamp: "2026-01-02T10:00:00.000Z",
				filename: "run-2026-01-02T10-00-00Z.json",
				stats: { topicsChecked: 1, findingsCount: 0 },
				findings: [],
			};
			writeFileSync(join(tempDir, validRun.filename), JSON.stringify(validRun));

			const runs = loadRecentRuns(tempDir);
			expect(runs).toHaveLength(1);
			expect(runs[0].timestamp).toBe("2026-01-02T10:00:00.000Z");
		});

		it("ignores non-run files", () => {
			writeFileSync(join(tempDir, "index.html"), "<html></html>");
			writeFileSync(join(tempDir, "notes.json"), "{}");
			const run: RunLog = {
				timestamp: "2026-01-01T10:00:00.000Z",
				filename: "run-2026-01-01T10-00-00Z.json",
				stats: { topicsChecked: 1, findingsCount: 0 },
				findings: [],
			};
			writeFileSync(join(tempDir, run.filename), JSON.stringify(run));

			const runs = loadRecentRuns(tempDir);
			expect(runs).toHaveLength(1);
		});
	});
});
