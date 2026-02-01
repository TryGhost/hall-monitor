import type {
	DiscoursePostsResponse,
	DiscourseRawPost,
	DiscourseRawTopic,
	DiscourseTopicDetailResponse,
	DiscourseTopicListResponse,
	Post,
	Topic,
	TopicDetails,
} from "./types.js";

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
	 * Fetch full topic details including the OP and up to 5 most recent replies.
	 * Returns null for deleted, private, or inaccessible topics.
	 */
	async fetchTopicDetails(topicId: number): Promise<TopicDetails | null> {
		const response = await this.request(`/t/${topicId}.json`);
		if (!response) return null;

		let body: DiscourseTopicDetailResponse;
		try {
			body = (await response.json()) as DiscourseTopicDetailResponse;
		} catch {
			console.error(`Failed to parse topic detail response for topic ${topicId}`);
			return null;
		}

		const initialPosts = body.post_stream?.posts ?? [];
		const stream = body.post_stream?.stream ?? [];

		// Find OP from the initial posts
		const rawOp = initialPosts.find((p) => p.post_number === 1);
		if (!rawOp) {
			console.error(`No OP found for topic ${topicId}`);
			return null;
		}

		// Determine the 5 most recent reply IDs (exclude the OP's post ID)
		const replyIds = stream.filter((id) => id !== rawOp.id);
		const recentReplyIds = replyIds.slice(-5);

		// Check which are already in the initial response
		const loadedIds = new Set(initialPosts.map((p) => p.id));
		const missingIds = recentReplyIds.filter((id) => !loadedIds.has(id));

		let allPosts = initialPosts;

		// Fetch missing posts if needed
		if (missingIds.length > 0) {
			const params = missingIds.map((id) => `post_ids[]=${id}`).join("&");
			const postsResponse = await this.request(`/t/${topicId}/posts.json?${params}`);
			if (postsResponse) {
				try {
					const postsBody = (await postsResponse.json()) as DiscoursePostsResponse;
					const fetchedPosts = postsBody.post_stream?.posts ?? [];
					allPosts = [...initialPosts, ...fetchedPosts];
				} catch {
					// Fall through with initial posts only
				}
			}
		}

		// Build a lookup of all available posts by ID
		const postsById = new Map<number, DiscourseRawPost>();
		for (const p of allPosts) {
			postsById.set(p.id, p);
		}

		// Collect replies in post_number order
		const replies: Post[] = [];
		for (const id of recentReplyIds) {
			const raw = postsById.get(id);
			if (raw) {
				replies.push(mapPost(raw));
			}
		}
		replies.sort((a, b) => a.postNumber - b.postNumber);

		return {
			id: body.id,
			title: body.title,
			slug: body.slug,
			url: `${this.baseUrl}/t/${body.slug}/${body.id}`,
			op: mapPost(rawOp),
			replies,
		};
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

export function stripHtml(html: string): string {
	return html
		.replace(/<[^>]*>/g, "")
		.replace(/&amp;/g, "&")
		.replace(/&lt;/g, "<")
		.replace(/&gt;/g, ">")
		.replace(/&quot;/g, '"')
		.replace(/&#39;/g, "'")
		.replace(/&nbsp;/g, " ")
		.replace(/\s+/g, " ")
		.trim();
}

function mapPost(raw: DiscourseRawPost): Post {
	return {
		id: raw.id,
		postNumber: raw.post_number,
		body: stripHtml(raw.cooked),
		username: raw.username,
		createdAt: raw.created_at,
		likeCount: raw.like_count,
		replyCount: raw.reply_count,
	};
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
