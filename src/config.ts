import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

export interface HallMonitorConfig {
	url: string;
	apiKey: string | null;
	apiUsername: string | null;
	categories: string[];
	tags: string[];
	checkIntervalTopics: number;
	anthropicApiKey: string | null;
	severityThreshold: "critical" | "high" | "medium" | "low";
	outputFormat: "terminal" | "json";
	dbPath: string | null;
}

const SEVERITY_LEVELS = ["critical", "high", "medium", "low"] as const;
const OUTPUT_FORMATS = ["terminal", "json"] as const;

const DEFAULT_CONFIG: Omit<HallMonitorConfig, "url"> = {
	apiKey: null,
	apiUsername: null,
	categories: [],
	tags: [],
	checkIntervalTopics: 100,
	anthropicApiKey: null,
	severityThreshold: "medium",
	outputFormat: "terminal",
	dbPath: null,
};

const DEFAULT_CONFIG_FILENAME = ".hall-monitor.json";

export function loadConfigFile(configPath?: string): Partial<HallMonitorConfig> {
	const filePath = configPath ?? resolve(process.cwd(), DEFAULT_CONFIG_FILENAME);

	if (!existsSync(filePath)) {
		if (configPath) {
			throw new Error(`Config file not found: ${configPath}`);
		}
		return {};
	}

	let raw: string;
	try {
		raw = readFileSync(filePath, "utf-8");
	} catch (err) {
		throw new Error(`Failed to read config file: ${(err as Error).message}`);
	}

	let parsed: unknown;
	try {
		parsed = JSON.parse(raw);
	} catch {
		throw new Error(`Invalid JSON in config file: ${filePath}`);
	}

	if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
		throw new Error(`Config file must contain a JSON object: ${filePath}`);
	}

	return validatePartialConfig(parsed as Record<string, unknown>);
}

function validatePartialConfig(raw: Record<string, unknown>): Partial<HallMonitorConfig> {
	const config: Partial<HallMonitorConfig> = {};

	if (raw.url !== undefined) {
		if (typeof raw.url !== "string" || raw.url.trim() === "") {
			throw new Error("Config: 'url' must be a non-empty string");
		}
		config.url = raw.url.trim();
	}

	if (raw.apiKey !== undefined) {
		if (raw.apiKey !== null && typeof raw.apiKey !== "string") {
			throw new Error("Config: 'apiKey' must be a string or null");
		}
		config.apiKey = raw.apiKey as string | null;
	}

	if (raw.apiUsername !== undefined) {
		if (raw.apiUsername !== null && typeof raw.apiUsername !== "string") {
			throw new Error("Config: 'apiUsername' must be a string or null");
		}
		config.apiUsername = raw.apiUsername as string | null;
	}

	if (raw.categories !== undefined) {
		if (!Array.isArray(raw.categories) || !raw.categories.every((c) => typeof c === "string")) {
			throw new Error("Config: 'categories' must be an array of strings");
		}
		config.categories = raw.categories;
	}

	if (raw.tags !== undefined) {
		if (!Array.isArray(raw.tags) || !raw.tags.every((t) => typeof t === "string")) {
			throw new Error("Config: 'tags' must be an array of strings");
		}
		config.tags = raw.tags;
	}

	if (raw.checkIntervalTopics !== undefined) {
		if (typeof raw.checkIntervalTopics !== "number" || raw.checkIntervalTopics < 1) {
			throw new Error("Config: 'checkIntervalTopics' must be a positive number");
		}
		config.checkIntervalTopics = raw.checkIntervalTopics;
	}

	if (raw.anthropicApiKey !== undefined) {
		if (raw.anthropicApiKey !== null && typeof raw.anthropicApiKey !== "string") {
			throw new Error("Config: 'anthropicApiKey' must be a string or null");
		}
		config.anthropicApiKey = raw.anthropicApiKey as string | null;
	}

	if (raw.severityThreshold !== undefined) {
		if (!SEVERITY_LEVELS.includes(raw.severityThreshold as (typeof SEVERITY_LEVELS)[number])) {
			throw new Error(`Config: 'severityThreshold' must be one of: ${SEVERITY_LEVELS.join(", ")}`);
		}
		config.severityThreshold = raw.severityThreshold as HallMonitorConfig["severityThreshold"];
	}

	if (raw.outputFormat !== undefined) {
		if (!OUTPUT_FORMATS.includes(raw.outputFormat as (typeof OUTPUT_FORMATS)[number])) {
			throw new Error(`Config: 'outputFormat' must be one of: ${OUTPUT_FORMATS.join(", ")}`);
		}
		config.outputFormat = raw.outputFormat as HallMonitorConfig["outputFormat"];
	}

	if (raw.dbPath !== undefined) {
		if (raw.dbPath !== null && typeof raw.dbPath !== "string") {
			throw new Error("Config: 'dbPath' must be a string or null");
		}
		config.dbPath = raw.dbPath as string | null;
	}

	return config;
}

export interface CliFlags {
	url?: string;
	apiKey?: string;
	apiUsername?: string;
	config?: string;
	json?: boolean;
	severity?: string;
	db?: string;
}

export function resolveConfig(flags: CliFlags): HallMonitorConfig {
	const fileConfig = loadConfigFile(flags.config);

	const merged = {
		...DEFAULT_CONFIG,
		...fileConfig,
	};

	if (flags.url) {
		merged.url = flags.url;
	}
	if (flags.apiKey) {
		merged.apiKey = flags.apiKey;
	}
	if (flags.apiUsername) {
		merged.apiUsername = flags.apiUsername;
	}
	if (flags.json) {
		merged.outputFormat = "json" as const;
	}
	if (flags.severity) {
		if (!SEVERITY_LEVELS.includes(flags.severity as (typeof SEVERITY_LEVELS)[number])) {
			throw new Error(
				`Invalid severity level: '${flags.severity}'. Must be one of: ${SEVERITY_LEVELS.join(", ")}`,
			);
		}
		merged.severityThreshold = flags.severity as HallMonitorConfig["severityThreshold"];
	}
	if (flags.db) {
		merged.dbPath = flags.db;
	}

	if (!merged.url) {
		throw new Error(
			"No Discourse URL provided. Use --url <url> or set 'url' in .hall-monitor.json",
		);
	}

	return merged as HallMonitorConfig;
}
