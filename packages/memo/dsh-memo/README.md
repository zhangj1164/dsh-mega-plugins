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

Every method declares exactly one parameter named `request`, even when it carries no input. The protocol binds arguments **by name** — the client sends `{ args: { request } }` — so a method declared with no parameter at all has its call rejected before the body runs. That is not a cosmetic difference: `listArchivedQuarters` once declared none, the host archived quarters successfully while the client's read of them returned nothing, and archiving looked like it did nothing at all. `tests/remote-signatures.spec.ts` now fails on any method that breaks the rule.

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
| `listPeriods(request)` | Lists the navigable periods of one dimension (week/month/quarter/year), newest first, with the week ids each contains. |
| `archiveQuarter(request)` | Archives one quarter by label. Anything that is not a `YYYY-Qn` label is rejected with `invalid-quarter-label`. |
| `unarchiveQuarter(request)` | Removes a quarter from the archive and reports whether a row was actually removed. |
| `listArchivedQuarters(request)` | Lists archived quarters, oldest first, each with the week ids the host resolved for it. |

## Quarter archive

Archiving a quarter is a durable marker, not a move: the memo weeks stay exactly where they are, and an archived quarter is one row in its own storage domain (`memo_archive`, table `quarters`) holding `{ label, archivedAt }`. Nothing is copied, so unarchiving cannot lose content and an archive can never disagree with the memo table.

`listArchivedQuarters` returns each quarter's week ids, resolved on the host through the same period calendar that decides which weeks a quarter owns. A client only has to build a `Set` from them to know which cards are read-only, which is what makes an archive hold in **all four dimensions** without the client ever mapping a week onto a quarter across a year boundary.

The week ids are deliberately **not** stored. They follow deterministically from the label, so persisting them would be persisting a derivable copy that goes wrong the day the calendar is corrected — and would silently un-archive or over-archive cards at that point.

**The request names a quarter, never a period.** "The quarter containing the period you are looking at" has no single answer: a year spans four quarters, and a week's Monday can sit in the previous quarter while the week belongs to the quarter holding its Thursday. Resolving a quarter from a period's start timestamp would therefore archive the wrong quarter for the week and year dimensions alike, so the archive action is offered where a quarter label is unambiguous and is never guessed anywhere else.

The domain is separate from `memo` rather than a second table beside `weeks`, so a problem opening the archive can never stop the memo table from opening. The name is `memo_archive`, not `memo-archive`: a storage-domain name must match `/^[a-z][a-z0-9_]*$/`.

**An archived quarter is read-only on the host.** `addEntry`, `updateEntry` and `deleteEntry` all refuse a week inside an archived quarter with the failure code `quarter-archived`, and refuse it before touching the table, so a refused call changes nothing at all. Read-only is enforced here rather than only in the browser because the same Remote methods are reachable by any client, and because an archive can land while an edit dialog is already open.

The guard asks `weekIdBelongsToPeriod(weekId, 'quarter', label)` — the same Thursday rule that resolved the quarter's week ids — so the answer cannot drift from the calendar that produced them. The cost is one pass over the archived rows, which are a handful of quarters at most, on a user-initiated write.

A consequence worth stating: archiving the **current** quarter closes today as well, since "archive this quarter" is a legitimate action on the quarter in progress. The client disables its composer in that state and points at the unarchive action, so the way out is always one click away.

## Four-dimension periods

The memo UI navigates weeks, months, quarters, and years over the same cards. `dsh-memo/period` owns that calendar math so the host and the UI cannot disagree about which card belongs where.

Period labels are pinned: `2026-W36`, `2026-09`, `2026-Q3`, `2026`.

One rule decides ownership: **a week belongs to the period containing its Thursday** — the same convention that decides which year owns the week, so `2025-12-29` is `2026-W01`. Because every week has exactly one Thursday, the week lists tile the timeline: the twelve months and the four quarters of a year each cover that year's weeks exactly once, with no gap and no overlap. `weekIdsInPeriod` is the enumeration of `weekIdBelongsToPeriod`, so a card cannot be listed under one period and highlighted under another.

Two defects lived in the previous prefix-based check and are covered by tests now:

- Quarter membership used the `YYYY-` prefix shared with month labels, so every quarter of a year matched `Q1`.
- Week labels took the calendar year of the week's Monday, so a week at a year boundary was off by one year.

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
