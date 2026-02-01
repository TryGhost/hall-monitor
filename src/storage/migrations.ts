import type Database from "better-sqlite3";

export interface Migration {
	version: number;
	name: string;
	up: (db: Database.Database) => void;
}

export const migrations: Migration[] = [
	{
		version: 1,
		name: "initial-schema",
		up: (db) => {
			db.exec(`
				CREATE TABLE schema_version (
					version INTEGER NOT NULL
				);
				INSERT INTO schema_version (version) VALUES (1);

				CREATE TABLE seen_topics (
					topic_id INTEGER PRIMARY KEY,
					last_post_number INTEGER NOT NULL,
					last_checked_at TEXT NOT NULL
				);

				CREATE TABLE seen_posts (
					post_id INTEGER PRIMARY KEY,
					topic_id INTEGER NOT NULL,
					seen_at TEXT NOT NULL
				);

				CREATE TABLE analysis_results (
					id INTEGER PRIMARY KEY AUTOINCREMENT,
					topic_id INTEGER NOT NULL,
					category TEXT NOT NULL,
					severity TEXT NOT NULL,
					summary TEXT NOT NULL,
					reasoning TEXT NOT NULL,
					analyzed_at TEXT NOT NULL
				);

				CREATE TABLE run_log (
					id INTEGER PRIMARY KEY AUTOINCREMENT,
					started_at TEXT NOT NULL,
					completed_at TEXT,
					topics_checked INTEGER DEFAULT 0,
					findings_count INTEGER DEFAULT 0
				);
			`);
		},
	},
];

export function runMigrations(db: Database.Database): void {
	const hasSchemaTable = db
		.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='schema_version'")
		.get();

	let currentVersion = 0;
	if (hasSchemaTable) {
		const row = db.prepare("SELECT version FROM schema_version").get() as
			| { version: number }
			| undefined;
		currentVersion = row?.version ?? 0;
	}

	const pending = migrations.filter((m) => m.version > currentVersion);
	if (pending.length === 0) return;

	for (const migration of pending) {
		db.transaction(() => {
			migration.up(db);
			if (migration.version > 1) {
				db.prepare("UPDATE schema_version SET version = ?").run(migration.version);
			}
		})();
	}
}
