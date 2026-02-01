import type { HallMonitorConfig } from "./config.js";
import { DiscourseClient } from "./discourse/client.js";
import type { Topic, TopicDetails } from "./discourse/types.js";
import { preFilterTopics } from "./filter.js";
import {
	closeDatabase,
	getSeenTopic,
	logRunEnd,
	logRunStart,
	openDatabase,
	upsertSeenTopic,
} from "./storage/db.js";

function createLogger(config: HallMonitorConfig) {
	if (config.outputFormat === "json") {
		return (_message: string) => {};
	}
	return (message: string) => {
		console.error(`▸ ${message}`);
	};
}

export async function runMonitor(config: HallMonitorConfig): Promise<void> {
	const log = createLogger(config);

	// 1. Open database
	const dbPath = config.dbPath ?? undefined;
	const db = openDatabase(dbPath);
	log(`Database opened${dbPath ? `: ${dbPath}` : " (default location)"}`);

	try {
		// 2. Log run start
		const runId = logRunStart(db);
		log(`Run #${runId} started`);

		// 3. Create Discourse client
		const client = new DiscourseClient(config.url, {
			apiKey: config.apiKey ?? undefined,
			apiUsername: config.apiUsername ?? undefined,
		});
		log(`Discourse client ready: ${config.url}`);

		// 4. Fetch topics
		const topics = await client.fetchLatestTopics(config.checkIntervalTopics);
		log(`Fetched ${topics.length} topics`);

		// 5. Identify new/updated topics
		let newCount = 0;
		let updatedCount = 0;
		let unchangedCount = 0;
		const relevantTopics: Topic[] = [];

		const topicMap = new Map<number, Topic>();
		for (const topic of topics) {
			topicMap.set(topic.id, topic);
		}

		for (const topic of topics) {
			const seen = getSeenTopic(db, topic.id);
			if (!seen) {
				newCount++;
				relevantTopics.push(topic);
			} else if (topic.postsCount > seen.last_post_number) {
				updatedCount++;
				relevantTopics.push(topic);
			} else {
				unchangedCount++;
			}
		}

		log(`Topics: ${newCount} new, ${updatedCount} updated, ${unchangedCount} unchanged`);

		// 5a. Pre-filter relevant topics
		const { passed, filtered } = preFilterTopics(relevantTopics, config);
		for (const { topic, reason } of filtered) {
			log(`Filtered topic ${topic.id} ("${topic.title}"): ${reason}`);
		}
		if (relevantTopics.length > 0) {
			log(`Pre-filter: ${passed.length} passed, ${filtered.length} filtered`);
		}

		// 6. Fetch details for passed topics only
		const topicDetails: TopicDetails[] = [];
		for (const topic of passed) {
			const details = await client.fetchTopicDetails(topic.id);
			if (details) {
				topicDetails.push(details);
			} else {
				log(`Skipping topic ${topic.id} (deleted or inaccessible)`);
			}
		}
		if (passed.length > 0) {
			log(`Fetched details for ${topicDetails.length}/${passed.length} topics`);
		}

		// 7. Update seen topics (all topics, including filtered)
		for (const topic of topics) {
			upsertSeenTopic(db, topic.id, topic.postsCount);
		}
		log("Seen topics updated");

		// 9. Placeholder: analysis
		log("Skipping LLM analysis (not yet implemented)");

		// 10. Placeholder: report
		log("Skipping report (not yet implemented)");

		// 11. Log run end
		logRunEnd(db, runId, topics.length, 0);
		log(`Run #${runId} complete: ${topics.length} topics checked, 0 findings`);
	} finally {
		// 12. Close database
		closeDatabase(db);
	}
}
