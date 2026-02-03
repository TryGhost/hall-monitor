import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { type CliFlags, loadConfigFile, resolveConfig } from "./config.js";

describe("loadConfigFile", () => {
	let tempDir: string;

	beforeEach(() => {
		tempDir = mkdtempSync(join(tmpdir(), "hall-monitor-test-"));
	});

	afterEach(() => {
		rmSync(tempDir, { recursive: true });
	});

	it("returns empty object when no config file exists and no path specified", () => {
		const originalCwd = process.cwd();
		process.chdir(tempDir);
		try {
			const config = loadConfigFile();
			expect(config).toEqual({});
		} finally {
			process.chdir(originalCwd);
		}
	});

	it("throws when explicit config path does not exist", () => {
		expect(() => loadConfigFile("/nonexistent/path.json")).toThrow("Config file not found");
	});

	it("loads and validates a config file", () => {
		const configPath = join(tempDir, ".hall-monitor.json");
		writeFileSync(
			configPath,
			JSON.stringify({
				url: "https://forum.example.com",
				apiKey: "test-key",
				severityThreshold: "high",
			}),
		);

		const config = loadConfigFile(configPath);
		expect(config).toEqual({
			url: "https://forum.example.com",
			apiKey: "test-key",
			severityThreshold: "high",
		});
	});

	it("throws on invalid JSON", () => {
		const configPath = join(tempDir, "bad.json");
		writeFileSync(configPath, "not json{{{");
		expect(() => loadConfigFile(configPath)).toThrow("Invalid JSON");
	});

	it("throws when config is not an object", () => {
		const configPath = join(tempDir, "array.json");
		writeFileSync(configPath, "[]");
		expect(() => loadConfigFile(configPath)).toThrow("must contain a JSON object");
	});

	it("throws on invalid url type", () => {
		const configPath = join(tempDir, "bad-url.json");
		writeFileSync(configPath, JSON.stringify({ url: 123 }));
		expect(() => loadConfigFile(configPath)).toThrow("'url' must be a non-empty string");
	});

	it("throws on invalid severityThreshold", () => {
		const configPath = join(tempDir, "bad-severity.json");
		writeFileSync(configPath, JSON.stringify({ severityThreshold: "extreme" }));
		expect(() => loadConfigFile(configPath)).toThrow("'severityThreshold' must be one of");
	});

	it("throws on invalid categories type", () => {
		const configPath = join(tempDir, "bad-cats.json");
		writeFileSync(configPath, JSON.stringify({ categories: "not-array" }));
		expect(() => loadConfigFile(configPath)).toThrow("'categories' must be an array of strings");
	});

	it("loads filter config fields", () => {
		const configPath = join(tempDir, "filter.json");
		writeFileSync(
			configPath,
			JSON.stringify({
				filterMinReplies: 2,
				filterMinViews: 10,
				filterMaxAgeDays: 14,
				filterExcludeCategories: [3, 5],
			}),
		);

		const config = loadConfigFile(configPath);
		expect(config).toEqual({
			filterMinReplies: 2,
			filterMinViews: 10,
			filterMaxAgeDays: 14,
			filterExcludeCategories: [3, 5],
		});
	});

	it("throws on negative filterMinReplies", () => {
		const configPath = join(tempDir, "bad-replies.json");
		writeFileSync(configPath, JSON.stringify({ filterMinReplies: -1 }));
		expect(() => loadConfigFile(configPath)).toThrow(
			"'filterMinReplies' must be a non-negative number",
		);
	});

	it("throws on non-number filterMinViews", () => {
		const configPath = join(tempDir, "bad-views.json");
		writeFileSync(configPath, JSON.stringify({ filterMinViews: "many" }));
		expect(() => loadConfigFile(configPath)).toThrow(
			"'filterMinViews' must be a non-negative number",
		);
	});

	it("throws on zero filterMaxAgeDays", () => {
		const configPath = join(tempDir, "bad-age.json");
		writeFileSync(configPath, JSON.stringify({ filterMaxAgeDays: 0 }));
		expect(() => loadConfigFile(configPath)).toThrow(
			"'filterMaxAgeDays' must be a positive number",
		);
	});

	it("throws on non-integer filterExcludeCategories", () => {
		const configPath = join(tempDir, "bad-exclude.json");
		writeFileSync(configPath, JSON.stringify({ filterExcludeCategories: [1, 2.5] }));
		expect(() => loadConfigFile(configPath)).toThrow(
			"'filterExcludeCategories' must be an array of integers",
		);
	});

	it("throws on non-array filterExcludeCategories", () => {
		const configPath = join(tempDir, "bad-exclude2.json");
		writeFileSync(configPath, JSON.stringify({ filterExcludeCategories: "not-array" }));
		expect(() => loadConfigFile(configPath)).toThrow(
			"'filterExcludeCategories' must be an array of integers",
		);
	});
});

describe("resolveConfig", () => {
	let tempDir: string;
	const originalEnv = process.env.ANTHROPIC_API_KEY;

	beforeEach(() => {
		tempDir = mkdtempSync(join(tmpdir(), "hall-monitor-test-"));
		process.env.ANTHROPIC_API_KEY = "sk-test-env";
	});

	afterEach(() => {
		rmSync(tempDir, { recursive: true });
		if (originalEnv !== undefined) {
			process.env.ANTHROPIC_API_KEY = originalEnv;
		} else {
			// biome-ignore lint/performance/noDelete: process.env requires delete to unset
			delete process.env.ANTHROPIC_API_KEY;
		}
	});

	it("resolves config from CLI flags only", () => {
		const originalCwd = process.cwd();
		process.chdir(tempDir);
		try {
			const config = resolveConfig({ url: "https://forum.example.com" });
			expect(config.url).toBe("https://forum.example.com");
			expect(config.severityThreshold).toBe("medium");
			expect(config.outputFormat).toBe("terminal");
			expect(config.apiKey).toBeNull();
		} finally {
			process.chdir(originalCwd);
		}
	});

	it("merges config file with CLI flags (CLI wins)", () => {
		const configPath = join(tempDir, ".hall-monitor.json");
		writeFileSync(
			configPath,
			JSON.stringify({
				url: "https://from-file.com",
				apiKey: "file-key",
				severityThreshold: "low",
			}),
		);

		const config = resolveConfig({
			config: configPath,
			url: "https://from-cli.com",
			severity: "high",
		});

		expect(config.url).toBe("https://from-cli.com");
		expect(config.apiKey).toBe("file-key");
		expect(config.severityThreshold).toBe("high");
	});

	it("uses config file url when no CLI url provided", () => {
		const configPath = join(tempDir, ".hall-monitor.json");
		writeFileSync(configPath, JSON.stringify({ url: "https://from-file.com" }));

		const config = resolveConfig({ config: configPath });
		expect(config.url).toBe("https://from-file.com");
	});

	it("throws when no url is provided anywhere", () => {
		const originalCwd = process.cwd();
		process.chdir(tempDir);
		try {
			expect(() => resolveConfig({})).toThrow("No Discourse URL provided");
		} finally {
			process.chdir(originalCwd);
		}
	});

	it("sets json output format from flag", () => {
		const originalCwd = process.cwd();
		process.chdir(tempDir);
		try {
			const config = resolveConfig({
				url: "https://forum.example.com",
				json: true,
			});
			expect(config.outputFormat).toBe("json");
		} finally {
			process.chdir(originalCwd);
		}
	});

	it("throws on invalid severity flag", () => {
		const originalCwd = process.cwd();
		process.chdir(tempDir);
		try {
			expect(() =>
				resolveConfig({ url: "https://forum.example.com", severity: "extreme" }),
			).toThrow("Invalid severity level");
		} finally {
			process.chdir(originalCwd);
		}
	});

	it("applies all defaults correctly", () => {
		const originalCwd = process.cwd();
		process.chdir(tempDir);
		try {
			const config = resolveConfig({ url: "https://forum.example.com" });
			expect(config).toEqual({
				url: "https://forum.example.com",
				apiKey: null,
				apiUsername: null,
				categories: [],
				tags: [],
				checkIntervalTopics: 100,
				anthropicApiKey: "sk-test-env",
				model: "haiku",
				severityThreshold: "medium",
				outputFormat: "terminal",
				dbPath: null,
				filterMinReplies: 1,
				filterMinViews: 5,
				filterMaxAgeDays: 30,
				filterExcludeCategories: [],
			});
		} finally {
			process.chdir(originalCwd);
		}
	});

	it("throws when no Anthropic API key is provided", () => {
		// biome-ignore lint/performance/noDelete: process.env requires delete to unset
		delete process.env.ANTHROPIC_API_KEY;
		const originalCwd = process.cwd();
		process.chdir(tempDir);
		try {
			expect(() => resolveConfig({ url: "https://forum.example.com" })).toThrow(
				"No Anthropic API key provided",
			);
		} finally {
			process.chdir(originalCwd);
		}
	});

	it("reads anthropicApiKey from ANTHROPIC_API_KEY env var", () => {
		process.env.ANTHROPIC_API_KEY = "sk-from-env";
		const originalCwd = process.cwd();
		process.chdir(tempDir);
		try {
			const config = resolveConfig({ url: "https://forum.example.com" });
			expect(config.anthropicApiKey).toBe("sk-from-env");
		} finally {
			process.chdir(originalCwd);
		}
	});

	it("prefers config file anthropicApiKey over env var", () => {
		process.env.ANTHROPIC_API_KEY = "sk-from-env";
		const configPath = join(tempDir, ".hall-monitor.json");
		writeFileSync(
			configPath,
			JSON.stringify({
				url: "https://forum.example.com",
				anthropicApiKey: "sk-from-file",
			}),
		);

		const config = resolveConfig({ config: configPath });
		expect(config.anthropicApiKey).toBe("sk-from-file");
	});

	it("parses --categories as comma-separated strings", () => {
		const originalCwd = process.cwd();
		process.chdir(tempDir);
		try {
			const config = resolveConfig({
				url: "https://forum.example.com",
				categories: "bugs, feature-requests, general",
			});
			expect(config.categories).toEqual(["bugs", "feature-requests", "general"]);
		} finally {
			process.chdir(originalCwd);
		}
	});

	it("parses --tags as comma-separated strings", () => {
		const originalCwd = process.cwd();
		process.chdir(tempDir);
		try {
			const config = resolveConfig({
				url: "https://forum.example.com",
				tags: "security, critical",
			});
			expect(config.tags).toEqual(["security", "critical"]);
		} finally {
			process.chdir(originalCwd);
		}
	});

	it("trims whitespace and filters empty strings from categories/tags", () => {
		const originalCwd = process.cwd();
		process.chdir(tempDir);
		try {
			const config = resolveConfig({
				url: "https://forum.example.com",
				categories: " bugs , , general ",
				tags: "  ,security,  ",
			});
			expect(config.categories).toEqual(["bugs", "general"]);
			expect(config.tags).toEqual(["security"]);
		} finally {
			process.chdir(originalCwd);
		}
	});

	it("CLI categories/tags override config file values", () => {
		const configPath = join(tempDir, ".hall-monitor.json");
		writeFileSync(
			configPath,
			JSON.stringify({
				url: "https://forum.example.com",
				categories: ["from-file"],
				tags: ["file-tag"],
			}),
		);

		const config = resolveConfig({
			config: configPath,
			categories: "from-cli",
			tags: "cli-tag",
		});
		expect(config.categories).toEqual(["from-cli"]);
		expect(config.tags).toEqual(["cli-tag"]);
	});
});
