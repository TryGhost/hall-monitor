import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
	closeDatabase,
	getSeenTopic,
	logRunEnd,
	logRunStart,
	openDatabase,
	upsertSeenTopic,
} from "./db.js";

describe("storage/db", () => {
	let tempDir: string;
	let db: Database.Database;

	beforeEach(() => {
		tempDir = mkdtempSync(join(tmpdir(), "hall-monitor-db-test-"));
	});

	afterEach(() => {
		if (db) closeDatabase(db);
		rmSync(tempDir, { recursive: true });
	});

	it("creates database file at specified path", () => {
		const dbPath = join(tempDir, "test.db");
		db = openDatabase(dbPath);
		expect(db.open).toBe(true);
	});

	it("creates parent directory if it doesn't exist", () => {
		const dbPath = join(tempDir, "nested", "dir", "test.db");
		db = openDatabase(dbPath);
		expect(db.open).toBe(true);
	});

	it("creates all required tables", () => {
		db = openDatabase(join(tempDir, "test.db"));
		const tables = db
			.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
			.all() as { name: string }[];
		const tableNames = tables.map((t) => t.name);
		expect(tableNames).toContain("schema_version");
		expect(tableNames).toContain("seen_topics");
		expect(tableNames).toContain("seen_posts");
		expect(tableNames).toContain("analysis_results");
		expect(tableNames).toContain("run_log");
	});

	it("sets schema version to 1 after initial migration", () => {
		db = openDatabase(join(tempDir, "test.db"));
		const row = db.prepare("SELECT version FROM schema_version").get() as { version: number };
		expect(row.version).toBe(1);
	});

	it("is idempotent — opening twice does not error", () => {
		const dbPath = join(tempDir, "test.db");
		db = openDatabase(dbPath);
		closeDatabase(db);
		db = openDatabase(dbPath);
		expect(db.open).toBe(true);
	});

	it("re-opening an existing database runs no migrations", () => {
		const dbPath = join(tempDir, "test.db");
		db = openDatabase(dbPath);
		const row1 = db.prepare("SELECT version FROM schema_version").get() as { version: number };
		closeDatabase(db);

		db = openDatabase(dbPath);
		const row2 = db.prepare("SELECT version FROM schema_version").get() as { version: number };
		expect(row2.version).toBe(row1.version);
	});

	describe("upsertSeenTopic / getSeenTopic", () => {
		beforeEach(() => {
			db = openDatabase(join(tempDir, "test.db"));
		});

		it("returns undefined for unseen topic", () => {
			const result = getSeenTopic(db, 999);
			expect(result).toBeUndefined();
		});

		it("inserts a new seen topic", () => {
			upsertSeenTopic(db, 42, 5);
			const result = getSeenTopic(db, 42);
			expect(result).toEqual(
				expect.objectContaining({
					topic_id: 42,
					last_post_number: 5,
				}),
			);
			expect(result?.last_checked_at).toBeTruthy();
		});

		it("updates an existing seen topic", () => {
			upsertSeenTopic(db, 42, 5);
			const first = getSeenTopic(db, 42);
			expect(first).toBeDefined();

			upsertSeenTopic(db, 42, 10);
			const second = getSeenTopic(db, 42);

			expect(second?.last_post_number).toBe(10);
			expect(String(second?.last_checked_at) >= String(first?.last_checked_at)).toBe(true);
		});
	});

	describe("logRunStart / logRunEnd", () => {
		beforeEach(() => {
			db = openDatabase(join(tempDir, "test.db"));
		});

		it("logRunStart returns a run id", () => {
			const runId = logRunStart(db);
			expect(runId).toBeGreaterThan(0);
		});

		it("logRunEnd updates the run record", () => {
			const runId = logRunStart(db);
			logRunEnd(db, runId, 50, 3);

			const row = db.prepare("SELECT * FROM run_log WHERE id = ?").get(runId) as {
				id: number;
				started_at: string;
				completed_at: string;
				topics_checked: number;
				findings_count: number;
			};

			expect(row.completed_at).toBeTruthy();
			expect(row.topics_checked).toBe(50);
			expect(row.findings_count).toBe(3);
		});

		it("tracks multiple runs independently", () => {
			const run1 = logRunStart(db);
			const run2 = logRunStart(db);
			logRunEnd(db, run1, 10, 1);
			logRunEnd(db, run2, 20, 2);

			const row1 = db.prepare("SELECT topics_checked FROM run_log WHERE id = ?").get(run1) as {
				topics_checked: number;
			};
			const row2 = db.prepare("SELECT topics_checked FROM run_log WHERE id = ?").get(run2) as {
				topics_checked: number;
			};

			expect(row1.topics_checked).toBe(10);
			expect(row2.topics_checked).toBe(20);
		});
	});
});
