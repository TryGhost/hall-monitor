# Hall Monitor

A CLI tool that monitors Discourse forums for open-source project maintainers. It surfaces serious bugs, interesting ideas, trends in user needs, and other actionable insights — without requiring you to read every forum post.

Point it at a Discourse instance, run it periodically (cron, CI, or manually), and it tells you what matters.

## How It Works

Hall Monitor connects to a Discourse forum's public API, fetches recent topics, and uses Claude (via the Anthropic API) to classify and summarize what it finds. A local SQLite database tracks what's already been seen, so each run picks up where the last one left off.

To keep LLM costs low, raw topics pass through a heuristic pre-filter before anything hits the API. Only the survivors get classified.

### Alert Categories

Each topic is classified into one of the following:

| Category | Description |
|---|---|
| **bug-report** | Users reporting broken behavior |
| **regression** | Something that used to work but doesn't |
| **security** | Potential security issues |
| **feature-request** | Ideas for new functionality |
| **pain-point** | Recurring frustrations or UX issues |
| **praise** | Positive feedback worth noting |
| **trend** | Emerging pattern across multiple posts |
| **noise** | Not actionable (filtered out) |

Each alert is assigned a severity: **critical**, **high**, **medium**, or **low**.

## Requirements

- Node.js >= 20
- An Anthropic API key (for LLM classification)

## Quick Start

```bash
git clone <repo-url>
cd hall-monitor
npm install
npm run build
```

Set your Anthropic API key:

```bash
export ANTHROPIC_API_KEY="your-key-here"
```

Run it:

```bash
node dist/cli.js --url https://meta.discourse.org
```

Or link it globally:

```bash
npm link
hall-monitor --url https://meta.discourse.org
```

## Usage

```
hall-monitor [options]
```

### Options

| Flag | Description |
|---|---|
| `--url <url>` | Discourse forum URL (required unless set in config) |
| `--api-key <key>` | Discourse API key (optional; for private forums) |
| `--api-username <username>` | Discourse API username (used with `--api-key`) |
| `--config <path>` | Path to a config file (defaults to `.hall-monitor.json` in the current directory) |
| `--json` | Output results as JSON instead of human-readable text |
| `--severity <level>` | Minimum severity threshold: `critical`, `high`, `medium`, or `low` |
| `--db <path>` | Path to SQLite state database (defaults to `~/.hall-monitor/state.db`) |
| `--categories <slugs>` | Comma-separated category slugs or IDs to monitor |
| `--tags <tags>` | Comma-separated tag names to monitor |
| `--skip-log` | Skip saving run log and dashboard generation |
| `-V, --version` | Print version number |
| `-h, --help` | Show help |

### Examples

Monitor a forum with default settings:

```bash
hall-monitor --url https://meta.discourse.org
```

Only show high-severity and above, output as JSON:

```bash
hall-monitor --url https://meta.discourse.org --severity high --json
```

Monitor specific categories:

```bash
hall-monitor --url https://meta.discourse.org --categories bug,feature
```

Use a config file:

```bash
hall-monitor --config ./my-config.json
```

## Configuration

Hall Monitor can be configured via CLI flags, a JSON config file, environment variables, or a combination. CLI flags take priority.

By default, the tool looks for `.hall-monitor.json` in the current directory. You can point to a different file with `--config <path>`.

The Anthropic API key can be set via the `ANTHROPIC_API_KEY` environment variable, in the config file, or both. The env var is used as a fallback when no key is found in the config file.

### Config File Reference

```json
{
  "url": "https://forum.example.com",
  "apiKey": null,
  "apiUsername": null,
  "categories": [],
  "tags": [],
  "checkIntervalTopics": 100,
  "anthropicApiKey": null,
  "model": "haiku",
  "severityThreshold": "medium",
  "outputFormat": "terminal",
  "dbPath": null,
  "filterMinReplies": 1,
  "filterMinViews": 5,
  "filterMaxAgeDays": 30,
  "filterExcludeCategories": [],
  "reportsPath": null,
  "noLog": false
}
```

| Field | Type | Default | Description |
|---|---|---|---|
| `url` | `string` | *(required)* | Base URL of the Discourse forum |
| `apiKey` | `string \| null` | `null` | Discourse API key for authenticated access |
| `apiUsername` | `string \| null` | `null` | Username associated with the API key |
| `categories` | `string[]` | `[]` | Limit monitoring to specific category slugs |
| `tags` | `string[]` | `[]` | Limit monitoring to topics with specific tags |
| `checkIntervalTopics` | `number` | `100` | Number of recent topics to check per run |
| `anthropicApiKey` | `string \| null` | `null` | Anthropic API key (falls back to `ANTHROPIC_API_KEY` env var) |
| `model` | `string` | `"haiku"` | Claude model to use: `haiku` (faster/cheaper) or `sonnet` (more accurate) |
| `severityThreshold` | `string` | `"medium"` | Minimum severity to report (`critical`, `high`, `medium`, `low`) |
| `outputFormat` | `string` | `"terminal"` | Output format: `terminal` for human-readable, `json` for structured |
| `dbPath` | `string \| null` | `null` | Path to SQLite state database (defaults to `~/.hall-monitor/state.db`) |
| `filterMinReplies` | `number` | `1` | Skip topics with fewer replies than this |
| `filterMinViews` | `number` | `5` | Skip topics with fewer views than this |
| `filterMaxAgeDays` | `number` | `30` | Skip topics older than this many days |
| `filterExcludeCategories` | `number[]` | `[]` | Category IDs to exclude from analysis |
| `reportsPath` | `string \| null` | `null` | Directory for run logs and dashboard (defaults to `~/.hall-monitor/reports/`) |
| `noLog` | `boolean` | `false` | Skip writing run logs and generating the dashboard |

### Configuration Precedence

Settings are resolved in this order (highest priority first):

1. CLI flags
2. Config file (`.hall-monitor.json` or path given via `--config`)
3. Environment variables (`ANTHROPIC_API_KEY`)
4. Built-in defaults

## Run History and Dashboard

Each run saves a timestamped JSON log to `~/.hall-monitor/reports/` (or the path set via `reportsPath`). After saving, Hall Monitor regenerates a self-contained HTML dashboard (`index.html`) in the same directory.

The dashboard shows findings from the most recent run, with a sidebar listing previous runs. Critical findings are highlighted with red indicators. The HTML file has no external dependencies and works when opened directly from the filesystem.

To skip logging and dashboard generation, pass `--skip-log` or set `"noLog": true` in your config.

### Discourse API Notes

Hall Monitor uses the Discourse API by appending `.json` to standard URL paths (e.g., `/latest.json`, `/t/{id}.json`). Public Discourse forums don't require authentication. An API key is optional but grants access to private content.

| Access | Rate Limit |
|---|---|
| Unauthenticated | 200 requests/minute |
| Authenticated (API key) | 60 requests/minute |

## Development

```bash
npm install          # Install dependencies
npm run build        # Build with tsup
npm run dev          # Build in watch mode
npm run typecheck    # Type-check without emitting
npm run test         # Run tests (vitest)
npm run test:watch   # Run tests in watch mode
npm run lint         # Lint with Biome
npm run lint:fix     # Lint and auto-fix
```

### Tech Stack

- **TypeScript** (strict mode) on **Node.js >= 20**
- **SQLite** via better-sqlite3 for local state
- **Claude API** via @anthropic-ai/sdk for analysis
- **commander** for CLI parsing
- **tsup** for bundling
- **vitest** for testing
- **Biome** for linting and formatting

### Project Structure

```
src/
  cli.ts              Entry point, argument parsing
  config.ts           Configuration loading and validation
  filter.ts           Pre-filter heuristics (age, engagement, categories)
  monitor.ts          Orchestrator: fetch -> filter -> analyze -> report
  discourse/
    client.ts         Discourse API client
    types.ts          Discourse API response types
  analysis/
    classifier.ts     LLM-powered topic classification
    types.ts          Analysis result types
  storage/
    db.ts             SQLite schema and queries
    migrations.ts     Schema migrations
  output/
    reporter.ts       Terminal output formatting
    json.ts           Structured JSON output
    log-writer.ts     Run log persistence (JSON files)
    dashboard.ts      Self-contained HTML dashboard generator
```

## Status

Hall Monitor is at v0.1.0. Core functionality is implemented and working: forum ingestion, incremental state tracking, heuristic pre-filtering, LLM-powered classification, terminal and JSON reporting, run logging, and an HTML dashboard. See `requirements.json` for the full feature roadmap.
