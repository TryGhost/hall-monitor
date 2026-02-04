import { Command } from "commander";
import { resolveConfig } from "./config.js";
import { runMonitor } from "./monitor.js";

const program = new Command();

program
	.name("hall-monitor")
	.description("Monitor Discourse forums for actionable insights")
	.version("0.1.0")
	.option("--url <url>", "Discourse forum URL")
	.option("--api-key <key>", "Discourse API key")
	.option("--api-username <username>", "Discourse API username")
	.option("--config <path>", "Path to config file")
	.option("--json", "Output as JSON")
	.option("--severity <level>", "Minimum severity threshold (critical, high, medium, low)")
	.option("--db <path>", "Path to SQLite state database")
	.option("--categories <slugs>", "Comma-separated category slugs or IDs to monitor")
	.option("--tags <tags>", "Comma-separated tag names to monitor")
	.option("--skip-log", "Skip saving run log and dashboard generation")
	.action(async (opts) => {
		try {
			const config = resolveConfig({
				url: opts.url,
				apiKey: opts.apiKey,
				apiUsername: opts.apiUsername,
				config: opts.config,
				json: opts.json,
				severity: opts.severity,
				db: opts.db,
				categories: opts.categories,
				tags: opts.tags,
				skipLog: opts.skipLog,
			});

			await runMonitor(config);
		} catch (err) {
			console.error(`Error: ${(err as Error).message}`);
			process.exit(1);
		}
	});

program.parse();
