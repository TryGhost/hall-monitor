import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildDashboardHtml, generateDashboard } from "./dashboard.js";
import type { JsonFinding } from "./json.js";
import type { RunLog } from "./log-writer.js";

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

function makeRun(overrides: Partial<RunLog> = {}): RunLog {
	return {
		timestamp: "2026-01-15T10:00:00.000Z",
		filename: "run-2026-01-15T10-00-00Z.json",
		stats: { topicsChecked: 10, findingsCount: 1 },
		findings: [makeFinding()],
		...overrides,
	};
}

describe("dashboard", () => {
	let tempDir: string;

	beforeEach(() => {
		tempDir = mkdtempSync(join(tmpdir(), "hall-monitor-dashboard-test-"));
	});

	afterEach(() => {
		rmSync(tempDir, { recursive: true });
	});

	describe("generateDashboard", () => {
		it("writes index.html to the reports directory", () => {
			const runs = [makeRun()];
			const filePath = generateDashboard(tempDir, runs);

			expect(filePath).toBe(join(tempDir, "index.html"));
			expect(existsSync(filePath)).toBe(true);
		});

		it("produces valid HTML content", () => {
			const filePath = generateDashboard(tempDir, [makeRun()]);
			const content = readFileSync(filePath, "utf-8");

			expect(content).toContain("<!DOCTYPE html>");
			expect(content).toContain("Hall Monitor Dashboard");
			expect(content).toContain("</html>");
		});
	});

	describe("buildDashboardHtml", () => {
		it("returns self-contained HTML with no external dependencies", () => {
			const html = buildDashboardHtml([makeRun()]);

			expect(html).not.toContain("cdn");
			expect(html).not.toContain("fetch(");
			expect(html).toContain("<style>");
			expect(html).toContain("<script>");
		});

		it("embeds run data as inline JavaScript", () => {
			const runs = [makeRun()];
			const html = buildDashboardHtml(runs);

			expect(html).toContain("var RUNS =");
			expect(html).toContain("bug-report");
			expect(html).toContain("Test Topic");
		});

		it("escapes </script> in embedded JSON to prevent injection", () => {
			const runs = [
				makeRun({
					findings: [makeFinding({ summary: "Has </script><script>alert(1)</script> in it" })],
				}),
			];
			const html = buildDashboardHtml(runs);

			// Should not contain a literal </script> inside the data
			const scriptStart = html.indexOf("var RUNS =");
			const scriptEnd = html.indexOf("</script>", scriptStart);
			const dataSection = html.slice(scriptStart, scriptEnd);
			expect(dataSection).not.toContain("</script>");
			expect(dataSection).toContain("<\\/script>");
		});

		it("renders sidebar structure", () => {
			const html = buildDashboardHtml([makeRun()]);

			expect(html).toContain('class="sidebar"');
			expect(html).toContain("Run History");
			expect(html).toContain('id="run-list"');
		});

		it("renders main content area", () => {
			const html = buildDashboardHtml([makeRun()]);

			expect(html).toContain('class="main"');
			expect(html).toContain('id="main-content"');
		});

		it("handles empty runs array", () => {
			const html = buildDashboardHtml([]);

			expect(html).toContain("var RUNS = []");
			expect(html).toContain("<!DOCTYPE html>");
		});

		it("includes severity styling classes", () => {
			const html = buildDashboardHtml([makeRun()]);

			expect(html).toContain("h2.critical");
			expect(html).toContain("h2.high");
			expect(html).toContain("h2.medium");
			expect(html).toContain("h2.low");
		});

		it("includes critical dot indicator logic", () => {
			const html = buildDashboardHtml([
				makeRun({
					findings: [makeFinding({ severity: "critical" })],
				}),
			]);

			expect(html).toContain("hasCritical");
			expect(html).toContain(".dot.critical { background: #e74c3c; }");
		});
	});
});
