import Anthropic from "@anthropic-ai/sdk";
import type { TopicDetails } from "../discourse/types.js";
import type { AlertCategory, ClassificationResult, Severity } from "./types.js";

export class AnthropicAuthError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "AnthropicAuthError";
	}
}

export class ClassificationError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "ClassificationError";
	}
}

const SYSTEM_PROMPT = `You are an expert open-source community analyst. Classify forum topics by their content and urgency for project maintainers.

Given a topic with its title, original post, and recent replies, classify it into one category and assign a severity.

Categories:
- bug-report: Users reporting broken behavior or errors
- regression: Something that previously worked but now doesn't
- security: Potential security vulnerabilities or concerns
- feature-request: Ideas or requests for new functionality
- pain-point: Recurring frustrations, UX issues, or workflow problems
- praise: Positive feedback or appreciation
- trend: An emerging pattern maintainers should be aware of
- noise: Not actionable (off-topic, resolved, spam)

Severity:
- critical: Immediate attention needed (data loss, security, widespread breakage)
- high: Important, affects many users or blocks common workflows
- medium: Worth tracking but not urgent
- low: Minor or informational

Respond with ONLY a JSON object:
{"category": "...", "severity": "...", "summary": "...", "reasoning": "..."}`;

const VALID_CATEGORIES: AlertCategory[] = [
	"bug-report",
	"regression",
	"security",
	"feature-request",
	"pain-point",
	"praise",
	"trend",
	"noise",
];

const VALID_SEVERITIES: Severity[] = ["critical", "high", "medium", "low"];

const MODEL_MAP: Record<string, string> = {
	haiku: "claude-haiku-4-5-20251001",
	sonnet: "claude-sonnet-4-5-20250929",
};

function formatTopicMessage(topic: TopicDetails): string {
	let message = `Title: ${topic.title}\n\nOriginal Post:\n${topic.op.body}`;

	const replyExcerpts = topic.replies.slice(0, 5);
	if (replyExcerpts.length > 0) {
		message += "\n\nRecent Replies:";
		for (const reply of replyExcerpts) {
			message += `\n\n[${reply.username}]:\n${reply.body}`;
		}
	}

	return message;
}

type ParseSuccess = {
	category: AlertCategory;
	severity: Severity;
	summary: string;
	reasoning: string;
};
type ParseFailure = { error: string };
type ParseResult = ParseSuccess | ParseFailure;

function parseClassification(text: string): ParseResult {
	let parsed: unknown;
	try {
		parsed = JSON.parse(text);
	} catch {
		return { error: "response is not valid JSON" };
	}

	if (typeof parsed !== "object" || parsed === null) {
		return { error: "response is not a JSON object" };
	}

	const obj = parsed as Record<string, unknown>;

	if (!VALID_CATEGORIES.includes(obj.category as AlertCategory)) {
		return { error: `invalid category: ${JSON.stringify(obj.category)}` };
	}
	if (!VALID_SEVERITIES.includes(obj.severity as Severity)) {
		return { error: `invalid severity: ${JSON.stringify(obj.severity)}` };
	}
	if (typeof obj.summary !== "string") {
		return { error: "missing or invalid 'summary' field" };
	}
	if (typeof obj.reasoning !== "string") {
		return { error: "missing or invalid 'reasoning' field" };
	}

	return {
		category: obj.category as AlertCategory,
		severity: obj.severity as Severity,
		summary: obj.summary,
		reasoning: obj.reasoning,
	};
}

export async function classifyTopic(
	topic: TopicDetails,
	apiKey: string,
	model?: string,
): Promise<ClassificationResult> {
	const client = new Anthropic({ apiKey });
	const modelId = MODEL_MAP[model ?? "haiku"] ?? MODEL_MAP.haiku;
	const userMessage = formatTopicMessage(topic);

	let lastError: unknown;

	for (let attempt = 0; attempt < 2; attempt++) {
		try {
			const response = await client.messages.create({
				model: modelId,
				max_tokens: 512,
				system: SYSTEM_PROMPT,
				messages: [{ role: "user", content: userMessage }],
			});

			const textBlock = response.content.find((b) => b.type === "text");
			if (!textBlock || textBlock.type !== "text") {
				throw new ClassificationError(`No text in LLM response for topic ${topic.id}`);
			}

			const parsed = parseClassification(textBlock.text);
			if ("error" in parsed) {
				const preview =
					textBlock.text.length > 200 ? `${textBlock.text.slice(0, 200)}…` : textBlock.text;
				throw new ClassificationError(
					`Malformed LLM response for topic ${topic.id}: ${parsed.error}\n  Response: ${preview}`,
				);
			}

			return {
				topicId: topic.id,
				topicUrl: topic.url,
				title: topic.title,
				...parsed,
			};
		} catch (err: unknown) {
			if (err instanceof ClassificationError) {
				throw err;
			}

			lastError = err;
			const status = err instanceof Anthropic.APIError ? err.status : undefined;

			if (status === 401 || status === 403) {
				throw new AnthropicAuthError(
					`Anthropic API authentication failed (HTTP ${status}). Check your API key.`,
				);
			}

			if (status !== undefined && status >= 500 && attempt === 0) {
				continue;
			}
			break;
		}
	}

	throw new ClassificationError(
		`Classification failed for topic ${topic.id}: ${lastError instanceof Error ? lastError.message : String(lastError)}`,
	);
}

export { formatTopicMessage, parseClassification, MODEL_MAP };
