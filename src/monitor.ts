import type { HallMonitorConfig } from "./config.js";
import { DiscourseClient } from "./discourse/client.js";
import type { TopicDetails } from "./discourse/types.js";
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
		const relevantTopicIds: number[] = [];

		for (const topic of topics) {
			const seen = getSeenTopic(db, topic.id);
			if (!seen) {
				newCount++;
				relevantTopicIds.push(topic.id);
			} else if (topic.postsCount > seen.last_post_number) {
				updatedCount++;
				relevantTopicIds.push(topic.id);
			} else {
				unchangedCount++;
			}
		}

		log(`Topics: ${newCount} new, ${updatedCount} updated, ${unchangedCount} unchanged`);

		// 6. Fetch details for new/updated topics
		const topicDetails: TopicDetails[] = [];
		for (const topicId of relevantTopicIds) {
			const details = await client.fetchTopicDetails(topicId);
			if (details) {
				topicDetails.push(details);
			} else {
				log(`Skipping topic ${topicId} (deleted or inaccessible)`);
			}
		}
		if (relevantTopicIds.length > 0) {
			log(`Fetched details for ${topicDetails.length}/${relevantTopicIds.length} topics`);
		}

		// 7. Update seen topics
		for (const topic of topics) {
			upsertSeenTopic(db, topic.id, topic.postsCount);
		}
		log("Seen topics updated");

		// 8. Placeholder: filter
		log("Skipping pre-filter (not yet implemented)");

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
