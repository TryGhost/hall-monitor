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

export function printJsonReport(results: ClassificationResult[]): void {
	const findings: JsonFinding[] = results
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

	console.log(JSON.stringify(findings, null, 2));
}
