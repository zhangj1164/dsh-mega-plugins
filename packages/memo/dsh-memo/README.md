# dsh-memo

English | [中文](README.zh.md)

Local-only week-keyed personal memo service for DeepSeek Harness with AI analysis, report export, telemetry logging, and GitHub issue generation.

## Plugin

`MemoService extends TypertRemoteService` with `static inject = ['storageDomain', 'telemetry', 'githubIssue']`. The service stores entries in a KV table keyed by ISO-8601 week id (`YYYY-Www`, Monday start) and uses the LLM for analysis and report export.

| Config | Default | Meaning |
|---|---|---|
| `repoUrl` | — | GitHub repository URL passed to the github-issue service for report generation. |

## Remote methods

| Method | Behavior |
|---|---|
| `getOrCreateCurrentWeek(request)` | Creates or returns the current week. Stores the provider/model route for later AI calls. |
| `getWeek(request)` | Returns one week by id, or `null` when it does not exist. |
| `listWeeks(request)` | Lists weeks in a range, newest first. |
| `addEntry(request)` | Adds an entry to a week. Creates the week if it does not exist. |
| `updateEntry(request)` | Updates an entry's content. Editing a past week requires `force: true`. |
| `deleteEntry(request)` | Deletes an entry from a week. Past weeks require `force: true`. |
| `analyze(request)` | Runs AI analysis (organize / summarize / analyze) over a period's entries. Returns `no-entries` when the period is empty. |
| `exportReport(request)` | Exports a Markdown work report for a period using the model. |
| `readExternalPath(request)` | Reads a local file path and adds it as an entry. |
| `analyzeLogs(request)` | Reads telemetry failures for this plugin and generates a GitHub issue report via the github-issue service. |

## Past-week force gate

The current week is always editable. Editing or deleting entries in a past week requires `force: true` to acknowledge that AI analysis results may change. This prevents accidental mutation of historical records without explicit consent.

## Bundle layer

This package declares `dsh: { bundle: { patch: "./cordis.patch.yml" } }`. The patch inserts `github-issue` and `memo` rows into the host composition. The `telemetry` row is owned by the `dsh-telemetry` bundle to avoid duplicate loader entry ids.

## Requirement mapping

- **Req 1** — `addEntry` supports `text`, `image`, and `file` entry types; the UI panel records text entries.
- **Req 2** — `getOrCreateCurrentWeek` auto-creates or loads the current ISO week (Monday start, Sunday end) as the storage point.
- **Req 3** — `updateEntry` and `deleteEntry` enforce `past-week-requires-force`: editing a non-current week requires `force: true` to acknowledge that AI analysis results may change.
- **Req 4** — `analyze` and `exportReport` accept a period (`week` / `month` / `quarter` / `year`) and collect entries across matching weeks.
- **Req 5** — `readExternalPath` reads a local file path through the `fs` service; the client UI must show a consent dialog before calling it (privilege escalation boundary).
- **Req 6** — `exportReport` generates a standard work report in Markdown, ready for review and export as `.md`.
- **Req 7** — Every key action calls `ctx.telemetry.track()` / `ctx.telemetry.trackError()` with a `featureCodeRef` anchor.
- **Req 8** — `analyzeLogs` reads telemetry failures via the `telemetry` service, generates a GitHub issue report via `githubIssue`, and returns the report + prefill URL.
- **Req 12** — Depends on `dsh-telemetry` and `dsh-github-issue` as separate generic plugins.

## Known Limitations

- **Week-keyed only** — entries are organized by ISO week; there is no free-form date or tag system.
- **Analysis depends on LLM** — `analyze` and `exportReport` fail with `llm-failure` when the model produces no output.
- **Telemetry and github-issue are injected services** — the memo service depends on their availability through `inject`.
