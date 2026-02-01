export type AlertCategory =
	| "bug-report"
	| "regression"
	| "security"
	| "feature-request"
	| "pain-point"
	| "praise"
	| "trend"
	| "noise";

export type Severity = "critical" | "high" | "medium" | "low";

export interface ClassificationResult {
	topicId: number;
	topicUrl: string;
	title: string;
	category: AlertCategory;
	severity: Severity;
	summary: string;
	reasoning: string;
}
