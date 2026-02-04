import type { ClassificationResult } from "../analysis/types.js";

export interface JsonFinding {
	topicId: number;
	topicUrl: string;
	title: string;
	category: string;
	severity: string;
	summary: string;
	reasoning: string;
	detectedAt: string;
}

export function buildJsonFindings(results: ClassificationResult[]): JsonFinding[] {
	return results
		.filter((r) => r.category !== "noise")
		.map((r) => ({
			topicId: r.topicId,
			topicUrl: r.topicUrl,
			title: r.title,
			category: r.category,
			severity: r.severity,
			summary: r.summary,
			reasoning: r.reasoning,
			detectedAt: new Date().toISOString(),
		}));
}

export function printJsonReport(results: ClassificationResult[]): void {
	const findings = buildJsonFindings(results);
	console.log(JSON.stringify(findings, null, 2));
}
