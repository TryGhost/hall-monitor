import type { DiscourseRawTopic, DiscourseTopicListResponse, Topic } from "./types.js";

const MAX_RETRY_WAIT_MS = 60_000;
const DEFAULT_LIMIT = 100;

export class DiscourseClient {
	private baseUrl: string;
	private apiKey?: string;
	private apiUsername?: string;

	constructor(baseUrl: string, options?: { apiKey?: string; apiUsername?: string }) {
		// Strip trailing slash for consistent URL joining
		this.baseUrl = baseUrl.replace(/\/+$/, "");
		this.apiKey = options?.apiKey;
		this.apiUsername = options?.apiUsername;
	}

	/**
	 * Fetch latest topics from the Discourse instance.
	 * Paginates until `limit` topics are collected or no more pages exist.
	 */
	async fetchLatestTopics(limit: number = DEFAULT_LIMIT): Promise<Topic[]> {
		const topics: Topic[] = [];
		let page = 0;

		while (topics.length < limit) {
			const response = await this.request(`/latest.json?page=${page}`);
			if (!response) break;

			let body: DiscourseTopicListResponse;
			try {
				body = (await response.json()) as DiscourseTopicListResponse;
			} catch {
				console.error("Failed to parse Discourse API response as JSON");
				break;
			}

			const rawTopics = body.topic_list?.topics;
			if (!rawTopics || rawTopics.length === 0) break;

			for (const raw of rawTopics) {
				if (topics.length >= limit) break;
				topics.push(mapTopic(raw));
			}

			if (!body.topic_list.more_topics_url) break;
			page++;
		}

		return topics;
	}

	private async request(path: string): Promise<Response | null> {
		const url = `${this.baseUrl}${path}`;
		const headers: Record<string, string> = {};

		if (this.apiKey) {
			headers["Api-Key"] = this.apiKey;
		}
		if (this.apiUsername) {
			headers["Api-Username"] = this.apiUsername;
		}

		let response: Response;
		try {
			response = await fetch(url, { headers });
		} catch (err) {
			console.error(`Network error fetching ${url}: ${(err as Error).message}`);
			return null;
		}

		if (response.status === 429) {
			const retryAfter = response.headers.get("Retry-After");
			const waitMs = Math.min(
				retryAfter ? Number.parseInt(retryAfter, 10) * 1000 : 5000,
				MAX_RETRY_WAIT_MS,
			);
			await sleep(waitMs);

			try {
				response = await fetch(url, { headers });
			} catch (err) {
				console.error(`Network error on retry for ${url}: ${(err as Error).message}`);
				return null;
			}

			if (!response.ok) {
				console.error(`HTTP ${response.status} on retry for ${url}`);
				return null;
			}
		} else if (!response.ok) {
			console.error(`HTTP ${response.status} fetching ${url}`);
			return null;
		}

		return response;
	}
}

function mapTopic(raw: DiscourseRawTopic): Topic {
	return {
		id: raw.id,
		title: raw.title,
		slug: raw.slug,
		postsCount: raw.posts_count,
		views: raw.views,
		likeCount: raw.like_count,
		createdAt: raw.created_at,
		lastPostedAt: raw.last_posted_at,
		categoryId: raw.category_id,
		tags: raw.tags ?? [],
		excerpt: raw.excerpt ?? null,
	};
}

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}
