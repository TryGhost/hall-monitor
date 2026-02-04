import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { JsonFinding } from "./json.js";

export interface RunLog {
	timestamp: string;
	filename: string;
	stats: {
		topicsChecked: number;
		findingsCount: number;
	};
	findings: JsonFinding[];
}

const DEFAULT_REPORTS_DIR = join(homedir(), ".hall-monitor", "reports");

export function getReportsDir(reportsPath: string | null): string {
	return reportsPath ?? DEFAULT_REPORTS_DIR;
}

export function saveRunLog(
	reportsPath: string | null,
	findings: JsonFinding[],
	stats: { topicsChecked: number; findingsCount: number },
): string {
	const dir = getReportsDir(reportsPath);
	mkdirSync(dir, { recursive: true });

	const now = new Date();
	const timestamp = now.toISOString();
	// Filesystem-safe: replace colons with hyphens
	const safeName = `run-${timestamp.replace(/:/g, "-").replace(/\.\d+Z$/, "Z")}.json`;

	const log: RunLog = { timestamp, filename: safeName, stats, findings };
	const filePath = join(dir, safeName);
	writeFileSync(filePath, JSON.stringify(log, null, 2));
	return filePath;
}

export function loadRecentRuns(reportsPath: string | null, maxRuns = 50): RunLog[] {
	const dir = getReportsDir(reportsPath);
	if (!existsSync(dir)) {
		return [];
	}

	const files = readdirSync(dir)
		.filter((f) => f.startsWith("run-") && f.endsWith(".json"))
		.sort()
		.reverse()
		.slice(0, maxRuns);

	const runs: RunLog[] = [];
	for (const file of files) {
		try {
			const raw = readFileSync(join(dir, file), "utf-8");
			const parsed = JSON.parse(raw) as RunLog;
			runs.push(parsed);
		} catch {
			// Silently skip corrupted files
		}
	}
	return runs;
}
