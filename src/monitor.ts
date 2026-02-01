import type { HallMonitorConfig } from "./config.js";
import { DiscourseClient } from "./discourse/client.js";
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

		for (const topic of topics) {
			const seen = getSeenTopic(db, topic.id);
			if (!seen) {
				newCount++;
			} else if (topic.postsCount > seen.last_post_number) {
				updatedCount++;
			} else {
				unchangedCount++;
			}
		}

		log(`Topics: ${newCount} new, ${updatedCount} updated, ${unchangedCount} unchanged`);

		// 6. Update seen topics
		for (const topic of topics) {
			upsertSeenTopic(db, topic.id, topic.postsCount);
		}
		log("Seen topics updated");

		// 7. Placeholder: filter
		log("Skipping pre-filter (not yet implemented)");

		// 8. Placeholder: analysis
		log("Skipping LLM analysis (not yet implemented)");

		// 9. Placeholder: report
		log("Skipping report (not yet implemented)");

		// 10. Log run end
		logRunEnd(db, runId, topics.length, 0);
		log(`Run #${runId} complete: ${topics.length} topics checked, 0 findings`);
	} finally {
		// 11. Close database
		closeDatabase(db);
	}
}
