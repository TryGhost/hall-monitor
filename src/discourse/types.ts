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

/** Raw post shape from the Discourse API (snake_case). */
export interface DiscourseRawPost {
	id: number;
	post_number: number;
	cooked: string;
	username: string;
	created_at: string;
	updated_at: string;
	like_count: number;
	reply_count: number;
}

/** Raw response shape from /t/{id}.json. */
export interface DiscourseTopicDetailResponse {
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
	post_stream: {
		posts: DiscourseRawPost[];
		stream: number[];
	};
}

/** Raw response shape from /t/{id}/posts.json. */
export interface DiscoursePostsResponse {
	post_stream: {
		posts: DiscourseRawPost[];
	};
}

/** Clean internal representation of a Discourse post. */
export interface Post {
	id: number;
	postNumber: number;
	body: string;
	username: string;
	createdAt: string;
	likeCount: number;
	replyCount: number;
}

/** Clean internal representation of a topic with its posts. */
export interface TopicDetails {
	id: number;
	title: string;
	slug: string;
	url: string;
	op: Post;
	replies: Post[];
}
