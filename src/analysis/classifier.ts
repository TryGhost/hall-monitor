import Anthropic from "@anthropic-ai/sdk";
import type { TopicDetails } from "../discourse/types.js";
import type { AlertCategory, ClassificationResult, Severity } from "./types.js";

export class AnthropicAuthError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "AnthropicAuthError";
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

function parseClassification(
	text: string,
): { category: AlertCategory; severity: Severity; summary: string; reasoning: string } | null {
	try {
		const parsed = JSON.parse(text);

		if (
			typeof parsed !== "object" ||
			parsed === null ||
			!VALID_CATEGORIES.includes(parsed.category) ||
			!VALID_SEVERITIES.includes(parsed.severity) ||
			typeof parsed.summary !== "string" ||
			typeof parsed.reasoning !== "string"
		) {
			return null;
		}

		return {
			category: parsed.category,
			severity: parsed.severity,
			summary: parsed.summary,
			reasoning: parsed.reasoning,
		};
	} catch {
		return null;
	}
}

export async function classifyTopic(
	topic: TopicDetails,
	apiKey: string,
	model?: string,
): Promise<ClassificationResult | null> {
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
				console.error(`[hall-monitor] No text response for topic ${topic.id}`);
				return null;
			}

			const parsed = parseClassification(textBlock.text);
			if (!parsed) {
				console.error(`[hall-monitor] Malformed LLM response for topic ${topic.id}`);
				return null;
			}

			return {
				topicId: topic.id,
				topicUrl: topic.url,
				title: topic.title,
				...parsed,
			};
		} catch (err: unknown) {
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

	console.error(
		`[hall-monitor] Classification failed for topic ${topic.id}: ${lastError instanceof Error ? lastError.message : String(lastError)}`,
	);
	return null;
}

export { formatTopicMessage, parseClassification, MODEL_MAP };
