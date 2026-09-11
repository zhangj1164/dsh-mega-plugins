# dsh-memo

English | [中文](README.zh.md)

Local-only week-keyed personal memo service for DeepSeek Harness with AI analysis, report export, telemetry logging, and GitHub issue generation.

## Plugin

`MemoService extends TypertRemoteService` with `static inject = ['storageDomain', 'telemetry', 'githubIssue']`. The service stores entries in a KV table keyed by ISO-8601 week id (`YYYY-Www`, Monday start) and uses the LLM for analysis and report export.

| Config | Default | Meaning |
|---|---|---|
| `repoUrl` | `https://github.com/zhangj1164/dsh-mega-plugins` | GitHub repository URL passed to the github-issue service for report generation. |
| `provider` | unset | Registered DSH provider route for AI calls. Unset follows this deployment's `agentDefaultModel` selection. |
| `model` | unset | Model id for AI calls. Unset follows this deployment's `agentDefaultModel` selection. |

## Model route resolution

AI calls resolve their route in one order, and nothing is hardcoded:

1. An explicit `provider`/`model` on the request (used by tests and by callers that need to retarget one call).
2. This service's `Config.provider` / `Config.model`.
3. The deployment's `agentDefaultModel` service selection — the existing single source of truth for "which model does this deployment use".

When no route resolves, the call fails with `llm-failure` and `failureCode: 'NO_MODEL_ROUTE'` instead of silently producing nothing.

## Failure reporting

`analyze`, `exportReport`, and any other model-backed method preserve the DSH failure facts instead of collapsing them into one message. A failed `llm-failure` carries:

| Field | Meaning |
|---|---|
| `failureCode` | DSH provider-neutral machine-routing code: `NO_ADAPTER`, `MISSING_CREDENTIAL`, `AUTH`, `RATE_LIMIT`, `EMPTY_RESPONSE`, … |
| `message` | The DSH message prefixed with the attempted provider and model. |
| `provider` / `model` | The route the failed call was sent to. |
| `status` | HTTP status from the provider, when DSH supplied one. |

`EMPTY_RESPONSE` means the model genuinely returned no text; `NO_ADAPTER` means the configured provider is not registered in this deployment. Those two used to be indistinguishable.

## Remote methods

| Method | Behavior |
|---|---|
| `getOrCreateCurrentWeek(request)` | Creates or returns the current week. `provider`/`model` are optional overrides. |
| `getWeek(request)` | Returns one week by id, or `null` when it does not exist. |
| `listWeeks(request)` | Lists weeks in a range, newest first. |
| `addEntry(request)` | Adds an entry to a week. Creates the week if it does not exist. |
| `updateEntry(request)` | Updates an entry's content. Editing a past week requires `force: true`. |
| `deleteEntry(request)` | Deletes an entry from a week. Past weeks require `force: true`. |
| `analyze(request)` | Runs AI analysis (organize / summarize / analyze) over a period's entries. Returns `no-entries` when the period is empty, `llm-failure` when the model call fails. |
| `exportReport(request)` | Exports a Markdown work report for a period using the model. |
| `readExternalPath(request)` | Reads a local file path and adds it as an entry. |
| `analyzeLogs(request)` | Reads telemetry failures for this plugin and generates a GitHub issue report via the github-issue service. |

## Shared LLM text helper

`dsh-memo/llm-text` exports `streamLlmText(llm, route, system, userText)`, the one place that turns a DSH stream into either collected text or preserved failure facts. Other host plugins that ask a model for a single block of text should use it instead of re-implementing the stream loop: the hand-rolled copies are what dropped `chunk.reason.failure` and reported every failure identically.

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
- **Model route is deployment configuration** — `analyze` and `exportReport` fail with `llm-failure` and a `failureCode` when no route resolves or the configured route is not registered. Set `provider`/`model` here or rely on `agentDefaultModel`.
- **Telemetry and github-issue are injected services** — the memo service depends on their availability through `inject`.
