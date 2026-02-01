import type { HallMonitorConfig } from "./config.js";
import type { Topic } from "./discourse/types.js";

export interface FilteredTopic {
	topic: Topic;
	reason: string;
}

export interface PreFilterResult {
	passed: Topic[];
	filtered: FilteredTopic[];
}

export function preFilterTopics(
	topics: Topic[],
	config: HallMonitorConfig,
	now?: Date,
): PreFilterResult {
	const passed: Topic[] = [];
	const filtered: FilteredTopic[] = [];
	const currentTime = now ?? new Date();
	const maxAgeMs = config.filterMaxAgeDays * 24 * 60 * 60 * 1000;

	for (const topic of topics) {
		// 1. Category exclusion
		if (config.filterExcludeCategories.includes(topic.categoryId)) {
			filtered.push({ topic, reason: "excluded category" });
			continue;
		}

		// 2. Age check
		const topicAge = currentTime.getTime() - new Date(topic.createdAt).getTime();
		if (topicAge > maxAgeMs) {
			filtered.push({ topic, reason: "too old" });
			continue;
		}

		// 3. Low engagement (conjunction: both must be below threshold)
		const replies = topic.postsCount - 1;
		if (replies < config.filterMinReplies && topic.views < config.filterMinViews) {
			filtered.push({ topic, reason: "low engagement" });
			continue;
		}

		passed.push(topic);
	}

	return { passed, filtered };
}
