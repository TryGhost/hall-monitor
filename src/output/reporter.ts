import type { ClassificationResult, Severity } from "../analysis/types.js";

export interface RunStats {
	topicsChecked: number;
	findingsCount: number;
	newSinceLastRun: number;
}

const SEVERITY_ORDER: Severity[] = ["critical", "high", "medium", "low"];

const SEVERITY_COLORS: Record<Severity, string> = {
	critical: "\x1b[1;31m",
	high: "\x1b[1;33m",
	medium: "\x1b[36m",
	low: "\x1b[2m",
};

const BOLD = "\x1b[1m";
const DIM = "\x1b[2m";
const RESET = "\x1b[0m";

function useColor(): boolean {
	return !process.env.NO_COLOR;
}

function colorize(text: string, code: string): string {
	if (!useColor()) return text;
	return `${code}${text}${RESET}`;
}

export function printTerminalReport(results: ClassificationResult[], stats: RunStats): void {
	const findings = results.filter((r) => r.category !== "noise");

	if (findings.length === 0) {
		console.log("\nNo findings to report.");
		printSummary(stats);
		return;
	}

	console.log("");
	console.log(colorize("Hall Monitor Report", BOLD));
	console.log("");

	for (const severity of SEVERITY_ORDER) {
		const group = findings.filter((r) => r.severity === severity);
		if (group.length === 0) continue;

		const label = severity.toUpperCase();
		console.log(colorize(label, SEVERITY_COLORS[severity]));

		for (const finding of group) {
			const cat = `[${finding.category.toUpperCase()}]`;
			const line = `  ${cat} ${finding.title} — ${finding.summary}`;

			if (severity === "critical" || severity === "high") {
				console.log(colorize(line, SEVERITY_COLORS[severity]));
			} else {
				console.log(line);
			}
			console.log(`    ${finding.topicUrl}`);
		}
		console.log("");
	}

	printSummary(stats);
}

function printSummary(stats: RunStats): void {
	console.log(colorize("---", DIM));
	console.log(
		`${stats.topicsChecked} topics checked | ${stats.findingsCount} findings | ${stats.newSinceLastRun} new since last run`,
	);
}
