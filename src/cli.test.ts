import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const CLI_PATH = join(import.meta.dirname, "..", "dist", "cli.js");

function run(args: string[], options?: { cwd?: string }): { stdout: string; exitCode: number } {
	try {
		const stdout = execFileSync("node", [CLI_PATH, ...args], {
			encoding: "utf-8",
			cwd: options?.cwd,
			env: { ...process.env, NO_COLOR: "1" },
		});
		return { stdout, exitCode: 0 };
	} catch (err: unknown) {
		const execErr = err as { stdout: string; stderr: string; status: number };
		return { stdout: execErr.stderr || execErr.stdout, exitCode: execErr.status };
	}
}

describe("CLI", () => {
	let tempDir: string;

	beforeEach(() => {
		tempDir = mkdtempSync(join(tmpdir(), "hall-monitor-cli-"));
	});

	afterEach(() => {
		rmSync(tempDir, { recursive: true });
	});

	it("prints help with --help", () => {
		const result = run(["--help"]);
		expect(result.stdout).toContain("Monitor Discourse forums");
		expect(result.stdout).toContain("--url");
		expect(result.stdout).toContain("--json");
		expect(result.stdout).toContain("--severity");
	});

	it("prints version with --version", () => {
		const result = run(["--version"]);
		expect(result.stdout.trim()).toBe("0.1.0");
	});

	it("succeeds with --url", () => {
		const result = run(["--url", "https://forum.example.com"], { cwd: tempDir });
		expect(result.exitCode).toBe(0);
		expect(result.stdout).toContain("Monitoring: https://forum.example.com");
	});

	it("exits 1 with no args and no config file", () => {
		const result = run([], { cwd: tempDir });
		expect(result.exitCode).toBe(1);
		expect(result.stdout).toContain("No Discourse URL provided");
	});

	it("outputs JSON with --json flag", () => {
		const result = run(["--json", "--url", "https://forum.example.com"], { cwd: tempDir });
		expect(result.exitCode).toBe(0);
		const parsed = JSON.parse(result.stdout);
		expect(parsed.status).toBe("ok");
		expect(parsed.config.url).toBe("https://forum.example.com");
	});

	it("picks up url from config file", () => {
		writeFileSync(
			join(tempDir, ".hall-monitor.json"),
			JSON.stringify({ url: "https://from-config.com" }),
		);
		const result = run([], { cwd: tempDir });
		expect(result.exitCode).toBe(0);
		expect(result.stdout).toContain("Monitoring: https://from-config.com");
	});

	it("CLI flags override config file", () => {
		writeFileSync(
			join(tempDir, ".hall-monitor.json"),
			JSON.stringify({ url: "https://from-config.com" }),
		);
		const result = run(["--url", "https://from-flag.com"], { cwd: tempDir });
		expect(result.exitCode).toBe(0);
		expect(result.stdout).toContain("Monitoring: https://from-flag.com");
	});

	it("exits 1 with invalid severity", () => {
		const result = run(["--url", "https://forum.example.com", "--severity", "extreme"], {
			cwd: tempDir,
		});
		expect(result.exitCode).toBe(1);
		expect(result.stdout).toContain("Invalid severity level");
	});
});
