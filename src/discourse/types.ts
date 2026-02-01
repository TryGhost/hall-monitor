/** Clean internal representation of a Discourse topic. */
export interface Topic {
	id: number;
	title: string;
	slug: string;
	postsCount: number;
	views: number;
	likeCount: number;
	createdAt: string;
	lastPostedAt: string;
	categoryId: number;
	tags: string[];
	excerpt: string | null;
}

/** Raw topic shape from the Discourse API (snake_case). */
export interface DiscourseRawTopic {
	id: number;
	title: string;
	slug: string;
	posts_count: number;
	views: number;
	like_count: number;
	created_at: string;
	last_posted_at: string;
	category_id: number;
	tags: string[];
	excerpt: string | null;
}

/** Raw response shape from /latest.json. */
export interface DiscourseTopicListResponse {
	topic_list: {
		topics: DiscourseRawTopic[];
		more_topics_url?: string;
	};
}
