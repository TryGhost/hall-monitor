# Hall Monitor

A CLI tool that monitors Discourse forums for open-source project maintainers. It surfaces serious bugs, interesting ideas, trends in user needs, and other actionable insights — without requiring you to read every forum post.

Point it at a Discourse instance, run it periodically (cron, CI, or manually), and it tells you what matters.

## How It Works

Hall Monitor connects to a Discourse forum's public API, fetches recent topics, and uses Claude (via the Anthropic API) to classify and summarize what it finds. A local SQLite database tracks what's already been seen, so each run picks up where the last one left off.

To keep LLM costs low, raw topics pass through a keyword/heuristic pre-filter before anything hits the API. Only the survivors get classified.

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

## Installation

```bash
git clone https://github.com/your-org/hall-monitor.git
cd hall-monitor
npm install
npm run build
```

After building, you can run it directly:

```bash
node dist/cli.js --url https://forum.example.com
```

Or link it globally:

```bash
npm link
hall-monitor --url https://forum.example.com
```

## Usage

```
hall-monitor [options]
```

### Options

| Flag | Description |
|---|---|
| `--url <url>` | Discourse forum URL (required unless set in config) |
| `--api-key <key>` | Discourse API key (optional; for private forums or higher rate limits) |
| `--api-username <username>` | Discourse API username (used with `--api-key`) |
| `--config <path>` | Path to a config file (defaults to `.hall-monitor.json` in the current directory) |
| `--json` | Output results as JSON instead of human-readable text |
| `--severity <level>` | Minimum severity threshold: `critical`, `high`, `medium`, or `low` |
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

Use a config file:

```bash
hall-monitor --config ./my-config.json
```

## Configuration

Hall Monitor can be configured via CLI flags, a JSON config file, or both. CLI flags take priority over the config file.

By default, the tool looks for `.hall-monitor.json` in the current directory. You can point to a different file with `--config <path>`.

### Config File Reference

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

| Field | Type | Default | Description |
|---|---|---|---|
| `url` | `string` | *(required)* | Base URL of the Discourse forum |
| `apiKey` | `string \| null` | `null` | Discourse API key for authenticated access |
| `apiUsername` | `string \| null` | `null` | Username associated with the API key |
| `categories` | `string[]` | `[]` | Limit monitoring to specific category slugs |
| `tags` | `string[]` | `[]` | Limit monitoring to topics with specific tags |
| `checkIntervalTopics` | `number` | `100` | Number of recent topics to check per run |
| `anthropicApiKey` | `string \| null` | `null` | Anthropic API key for Claude-powered analysis |
| `severityThreshold` | `string` | `"medium"` | Minimum severity to report (`critical`, `high`, `medium`, `low`) |
| `outputFormat` | `string` | `"terminal"` | Output format: `terminal` for human-readable, `json` for structured |

### Configuration Precedence

Settings are resolved in this order (highest priority first):

1. CLI flags
2. Config file (`.hall-monitor.json` or path given via `--config`)
3. Built-in defaults

### Discourse API Notes

Hall Monitor uses the Discourse API by appending `.json` to standard URL paths (e.g., `/latest.json`, `/t/{id}.json`). Public Discourse forums don't require authentication. An API key is optional but provides access to private content:

- **Unauthenticated**: 200 requests/minute
- **Authenticated**: 60 requests/minute (lower, but with access to private content)

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
  discourse/
    client.ts         Discourse API client
    types.ts          Discourse API response types
  analysis/
    classifier.ts     LLM-powered topic classification
    summarizer.ts     Condensed summaries of relevant threads
    types.ts          Analysis result types
  storage/
    db.ts             SQLite schema and queries
    migrations.ts     Schema migrations
  output/
    reporter.ts       Terminal output formatting
    json.ts           Structured JSON output
  monitor.ts          Orchestrator: fetch -> filter -> analyze -> report
```

## Status

Hall Monitor is in early development (v0.1.0). The CLI scaffolding and configuration system are complete. Forum ingestion, LLM analysis, state tracking, and reporting are not yet implemented. See `requirements.json` for the full feature roadmap.
