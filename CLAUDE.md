# Hall Monitor

## Vision

Hall Monitor is a CLI tool that monitors Discourse forums for open-source projects. It surfaces serious bugs, interesting ideas, trends in user needs, and other actionable insights for project maintainers — without requiring them to read every forum post.

You point it at a Discourse instance, run it periodically (cron, CI, or manually), and it tells you what matters.

## Tech Stack

- **Language**: TypeScript (strict mode)
- **Runtime**: Node.js >= 20 (uses native fetch)
- **Database**: SQLite via better-sqlite3 — local state tracking (seen topics, prior analyses)
- **LLM**: Claude API via @anthropic-ai/sdk — classifies and summarizes forum content
- **CLI**: commander — argument parsing
- **Build**: tsup — fast bundling
- **Test**: vitest
- **Lint/Format**: Biome

## Architecture

```
src/
  cli.ts            — entry point, argument parsing
  config.ts         — configuration loading/validation
  discourse/
    client.ts       — Discourse API client (REST + .json convention)
    types.ts        — Discourse API response types
  analysis/
    classifier.ts   — LLM-powered topic classification
    summarizer.ts   — condensed summaries of relevant threads
    types.ts        — analysis result types
  storage/
    db.ts           — SQLite schema and queries
    migrations.ts   — schema migrations
  output/
    reporter.ts     — terminal output formatting
    json.ts         — structured JSON output
  monitor.ts        — orchestrator: fetch → filter → analyze → report
```

## Key Design Principles

- **Works unauthenticated by default.** Public Discourse APIs don't require auth. API key is optional for deeper access.
- **Idempotent runs.** Each invocation picks up where the last left off. SQLite tracks what's been seen.
- **LLM as filter, not firehose.** Raw topics get a fast pre-filter (keyword/heuristic), then the LLM classifies the survivors. This keeps API costs low.
- **Minimal dependencies.** Prefer built-in Node APIs. No ORMs, no heavy frameworks.
- **Structured output.** Human-readable by default, `--json` for CI/automation.

## Discourse API Usage

The Discourse API is accessed by appending `.json` to standard URL paths:
- `/latest.json` — latest topics
- `/c/{slug}/{id}.json` — topics in a category
- `/search.json?q=...` — search with filters (date, status, tags, etc.)
- `/t/{id}.json` — single topic with posts
- `/posts.json` — latest posts globally

Rate limits: 200 req/min (unauthenticated), 60 req/min (API key). Plan polling accordingly.

## Alert Categories

The LLM classifies forum content into these categories:
- **bug-report** — users reporting broken behavior
- **regression** — something that used to work but doesn't
- **security** — potential security issues
- **feature-request** — ideas for new functionality
- **pain-point** — recurring frustrations or UX issues
- **praise** — positive feedback worth noting
- **trend** — emerging pattern across multiple posts
- **noise** — not actionable (filtered out)

Severity levels: critical, high, medium, low.

## Configuration

Config lives in `.hall-monitor.json` (or via CLI flags):
```json
{
  "url": "https://forum.example.com",
  "apiKey": null,
  "apiUsername": null,
  "categories": [],
  "tags": [],
  "checkIntervalTopics": 100,
  "anthropicApiKey": "sk-ant-...",
  "severityThreshold": "medium",
  "outputFormat": "terminal"
}
```

## Development

```bash
npm install
npm run build
npm test
npm run lint
```

## Project Tracking

- Requirements are captured in `requirements.json`
- Use structured requirement IDs: `{category}-{number}` (e.g., `INGEST-001`)
- Status values: `proposed`, `accepted`, `in-progress`, `done`, `deferred`
