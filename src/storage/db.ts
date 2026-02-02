import { mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import Database from "better-sqlite3";
import { runMigrations } from "./migrations.js";

export interface SeenTopic {
	topic_id: number;
	last_post_number: number;
	last_checked_at: string;
}

export interface AnalysisResult {
	id: number;
	topic_id: number;
	category: string;
	severity: string;
	summary: string;
	reasoning: string;
	analyzed_at: string;
}

const DEFAULT_DB_DIR = join(homedir(), ".hall-monitor");
const DEFAULT_DB_PATH = join(DEFAULT_DB_DIR, "state.db");

export function openDatabase(dbPath?: string): Database.Database {
	const resolvedPath = dbPath ?? DEFAULT_DB_PATH;
	mkdirSync(dirname(resolvedPath), { recursive: true });
	const db = new Database(resolvedPath);
	db.pragma("journal_mode = WAL");
	runMigrations(db);
	return db;
}

export function closeDatabase(db: Database.Database): void {
	db.close();
}

export function getSeenTopic(db: Database.Database, topicId: number): SeenTopic | undefined {
	return db
		.prepare(
			"SELECT topic_id, last_post_number, last_checked_at FROM seen_topics WHERE topic_id = ?",
		)
		.get(topicId) as SeenTopic | undefined;
}

export function upsertSeenTopic(
	db: Database.Database,
	topicId: number,
	lastPostNumber: number,
): void {
	const now = new Date().toISOString();
	db.prepare(
		`INSERT INTO seen_topics (topic_id, last_post_number, last_checked_at)
		 VALUES (?, ?, ?)
		 ON CONFLICT(topic_id) DO UPDATE SET
		   last_post_number = excluded.last_post_number,
		   last_checked_at = excluded.last_checked_at`,
	).run(topicId, lastPostNumber, now);
}

export function hasAnalysisResult(db: Database.Database, topicId: number): boolean {
	const row = db.prepare("SELECT 1 FROM analysis_results WHERE topic_id = ? LIMIT 1").get(topicId);
	return row !== undefined;
}

export function saveAnalysisResult(
	db: Database.Database,
	result: {
		topicId: number;
		category: string;
		severity: string;
		summary: string;
		reasoning: string;
	},
): void {
	const now = new Date().toISOString();
	db.prepare(
		`INSERT INTO analysis_results (topic_id, category, severity, summary, reasoning, analyzed_at)
		 VALUES (?, ?, ?, ?, ?, ?)`,
	).run(result.topicId, result.category, result.severity, result.summary, result.reasoning, now);
}

export function logRunStart(db: Database.Database): number {
	const now = new Date().toISOString();
	const result = db.prepare("INSERT INTO run_log (started_at) VALUES (?)").run(now);
	return Number(result.lastInsertRowid);
}

export function logRunEnd(
	db: Database.Database,
	runId: number,
	topicsChecked: number,
	findingsCount: number,
): void {
	const now = new Date().toISOString();
	db.prepare(
		"UPDATE run_log SET completed_at = ?, topics_checked = ?, findings_count = ? WHERE id = ?",
	).run(now, topicsChecked, findingsCount, runId);
}
