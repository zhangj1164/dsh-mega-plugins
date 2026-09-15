# dsh-telemetry

English | [中文](README.zh.md)

Local-only in-process telemetry tracker for DeepSeek Harness. Records operation trails and error logs over the storage-domain KV backend with feature-code-anchored failure grouping.

## Plugin

`TelemetryService extends Service` with `static inject = ['storageDomain']`. The service opens a dedicated storage domain on `Service.init` and provides synchronous reads for log analysis.

| Config | Default | Meaning |
|---|---|---|
| `maxEventsPerQuery` | `500` | Maximum events returned by one `listEvents` call. |
| `redact` | `true` | Whether to redact sensitive text before an event is stored. |
| `redactionMarker` | `[redacted:{rule}]` | Replacement written in place of every match; `{rule}` becomes the matching rule's name. |
| `redactionRules` | the five families below | The rule set: `{ name, pattern, flags? }`, applied in order. |

## Write-time redaction

The fields that carry the most diagnostic value — `error.message`, `error.stack`, and free-form `metadata` — are exactly the ones that pick up absolute paths, addresses, and credentials on the way through. Those records are also what the log-analysis feature reads and pastes into a GitHub issue, so a secret captured here leaves the machine on the next report.

Redaction therefore happens **before the write**, in `src/redaction.ts`, and is irreversible. Rules are applied in order, so a more specific pattern runs ahead of a generic one and supplies the more informative marker: a token is also long and base64-shaped, and gets labelled `credential` because that rule runs first.

| Rule | Catches |
|---|---|
| `email` | `jane.doe+work@example.co.uk` |
| `credential` | `Bearer …` / `Basic …`, prefixed keys (`sk-`, `ghp_`, `github_pat_`, `xox…`), and `api_key=` / `password:` / `secret=` assignments |
| `home-path` | `/Users/…`, `/home/…`, `/root/…`, `/var/…`, `/tmp/…`, `/opt/…`, `/mnt/…`, `/etc/…`, and `C:\Users\…` |
| `windows-path` | any other absolute Windows path |
| `ipv4` / `ipv6` | literal addresses |
| `hex` / `base64` | long blobs (32+ hex characters, 40+ base64 characters) |

Two deliberate limits on how far the default rules reach. A bare path segment such as `/api` is **not** touched: a rule set that also chews up the channel and endpoint names it will be asked to explain is a rule set nobody can debug with. And a home path stops at a colon, so a stack frame's `path:line:column` keeps its position — the position is the part that makes the path worth logging.

Only strings are rewritten. Non-string leaves keep their value and their type, so redaction removes secrets rather than reshaping the log. Values that are neither plain data nor strings are stringified rather than passed through unexamined. `metadata` absent stays absent instead of becoming `{}`, because the durable schema treats those differently.

**What is not redacted:** `pluginId`, `action`, `category`, `result`, `sessionId`, `error.code`, and `error.featureCodeRef`. These are the plugin's own grouping keys; redacting them would protect nothing the plugin did not already choose to publish while destroying the grouping that makes the log analyzable. A deployment that needs one of them covered can add a rule.

**Rules are configuration, not a constant.** The balance between "keeps secrets out" and "keeps enough to debug" is deployment-specific, and an over-broad rule loses triage information permanently — which is why the rule set is a `Config` field and why only new records are affected. A rule whose pattern fails to compile is dropped rather than thrown: a typo in configuration must not stop the host recording anything at all.

## Service methods

| Method | Behavior |
|---|---|
| `track(input)` | Records a success event (fire-and-forget KV write). |
| `trackError(input)` | Records a failure event with `category: 'error'`, `result: 'failure'`, and the error record carrying a `featureCodeRef`. |
| `listEvents(query)` | Synchronous read of matching events, newest first. Filters by `pluginId`, `category`, `result`, and timestamp range. |
| `analyzeForPlugin(pluginId)` | Groups all failure events for one plugin by `featureCodeRef`, returning total counts, the window it read, and per-group error codes. |

## Telemetry event model

Every event carries a `pluginId`, `action`, `category` (`user-action` / `system` / `error`), and `result` (`success` / `failure`). Error events carry a `TelemetryErrorRecord` with a `code`, `message`, and the agreed `featureCodeRef` — a stable code-section anchor (e.g. `"memo:analyze"`) that the log-analysis step correlates against the plugin's feature code.

## Analysis facts

`analyzeForPlugin` reports more than a total, because a total cannot be told apart from a current problem: the same count describes an incident from last week and one from a minute ago.

- **`window`** — the time range the analysis read, absent when the plugin has no events. Only that plugin's events bound it.
- **`attemptsAfterLastFailure`** (per group) — attempts of the group's action(s) recorded after its most recent failure. Counted by action rather than by total events: a plugin's unrelated reads would otherwise inflate the number and present an old failure as if it sat in a busy period.
- **`route`** (per group) — the provider and model the most recent failure ran on, when that event recorded them. Distinguishing "not recorded" from "no route" matters: failures recorded before the route metadata existed carry neither.

`route` is extracted by allowlist (`provider`, `model`, `status`) rather than by copying the event's `metadata`. Metadata is an open map a plugin fills with anything it likes, and reports built from this analysis leave the machine, so only these named keys cross the boundary.

## Requirement mapping

- **Req 7** — Built-in local-only telemetry tracking, packaged as a reusable DSH plugin. Any feature plugin can call `ctx.telemetry.track()` / `ctx.telemetry.trackError()` to record operation trails and error logs. The `featureCodeRef` on every error event is the agreed log format that the log-analysis feature (req 8) correlates against the plugin's feature code.
- **Req 12** — Encapsulated as a generic plugin: any DSH plugin can depend on `dsh-telemetry` and use `ctx.telemetry` to record events, not just the memo suite.

## Known Limitations

- **Host-side only** — the service does not extend `TypertRemoteService`; the client never calls it directly.
- **Fire-and-forget writes** — `track()` and `trackError()` return `void`; the KV write is durable and queued, but callers must wait for the write chain to settle before a synchronous `listEvents()` reflects new events.

