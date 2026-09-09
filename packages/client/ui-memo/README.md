# dsh-client-ui-memo

English | [中文](README.zh.md)

Browser-side UI plugin for the memo panel, backed by the memo Host Remote for week-keyed personal memos with AI analysis, report export, log analysis, and issue creation.

## Plugin

A pure UI surface plugin: the host `apply` is empty so the plugin appears in the host cordis.yml / Loader; the browser half ships via `exports["./client"]`, discovered through the package.json `dsh.client` declaration.

## Cross-package references (supplement 1)

This UI plugin declares **two** workspace dependencies — answering the question from supplement 1:

- **dsh-memo** (`workspace:^`) — the memo Host Remote service. The controller calls `memo/getOrCreateCurrentWeek`, `memo/addEntry`, `memo/updateEntry`, `memo/deleteEntry`, `memo/analyze`, `memo/exportReport`, and `memo/analyzeLogs` through the RPC channel.
- **dsh-github-issue** (`workspace:^`) — the GitHub-issue Host Remote service. The controller calls `githubIssue/optimizeIssue` **directly** (not through memo) for the "Add Issue" editor feature (req 11). This is the cross-package reference that supplement 1 asks about: the UI package can reference any Host Remote service, not just the one it was originally built for.

The `dsh-telemetry` service is **not** referenced directly from the UI — it is host-side only. The UI reads telemetry indirectly through `memo/analyzeLogs`, which calls `telemetry.analyzeForPlugin()` internally and returns the result to the client.

## Controller methods

| Method | Service | Behavior |
|---|---|---|
| `refresh()` | memo | Loads weeks via `listWeeks`, newest first. |
| `addEntry(content)` | memo | Calls `getOrCreateCurrentWeek` then `addEntry` with type `text`. |
| `updateEntry(weekId, entryId, content, force)` | memo | Updates an entry; `force=true` required for past weeks (req 3). |
| `deleteEntry(weekId, entryId, force)` | memo | Deletes an entry; `force=true` required for past weeks (req 3). |
| `selectWeek(index)` | — | Selects a week from the history list (req 3). |
| `analyze(type, period)` | memo | Runs AI analysis (organize/summarize/analyze) over a period (req 4). |
| `exportReport(period)` | memo | Exports a Markdown report and triggers a `.md` download (req 6). |
| `optimizeIssue(description)` | githubIssue | Optimizes a natural-language issue description into a structured report (req 11). |
| `analyzeLogs()` | memo | Reads telemetry failures and generates a GitHub issue report with prefill URL (req 8, 9). |
| `openUrl(url)` | — | Opens a URL in a new tab (req 9: pre-filled issue page). |

## UI features

- **Text entry** with add button (req 1)
- **Week history selector** with past-week badge (req 2, 3)
- **Entry edit/delete** with force-gate confirmation dialog for past weeks (req 3)
- **Period selector** (week/month/quarter/year) for analysis and export (req 4)
- **AI analysis** buttons: organize, summarize, analyze (req 4)
- **Report export** with automatic `.md` file download (req 6)
- **Log analysis** button: generates a GitHub issue report from telemetry (req 8)
- **Open pre-filled issue** button: jumps to GitHub with the report pre-filled (req 9)
- **Add Issue editor**: natural-language input + LLM optimization + GitHub open (req 11)

## Bundle layer

This package is included in the `dsh-memo` bundle's `cordis.patch.yml` as the `ui-memo` row. No separate bundle is needed.

## Known Limitations

- **Text-only entry** — the current UI supports text entries; image and file attachment types exist in the backend but are not yet wired in the UI.
- **Sidebar DOM injection** — DSH's sidebar exposes no slot for external plugins, so the sidebar entry button is injected via MutationObserver.
