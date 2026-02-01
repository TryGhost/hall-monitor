import { Command } from "commander";
import { resolveConfig } from "./config.js";

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
	.action((opts) => {
		try {
			const config = resolveConfig({
				url: opts.url,
				apiKey: opts.apiKey,
				apiUsername: opts.apiUsername,
				config: opts.config,
				json: opts.json,
				severity: opts.severity,
				db: opts.db,
			});

			if (config.outputFormat === "json") {
				console.log(JSON.stringify({ status: "ok", config: { url: config.url } }));
			} else {
				console.log("Hall Monitor v0.1.0");
				console.log(`Monitoring: ${config.url}`);
			}
		} catch (err) {
			console.error(`Error: ${(err as Error).message}`);
			process.exit(1);
		}
	});

program.parse();
