# @zhangj1164/dsh-telemetry

English | [中文](README.zh.md)

Local-only in-process telemetry tracker for DeepSeek Harness. Records operation trails and error logs over the storage-domain KV backend with feature-code-anchored failure grouping.

## Plugin

`TelemetryService extends Service` with `static inject = ['storageDomain']`. The service opens a dedicated storage domain on `Service.init` and provides synchronous reads for log analysis.

| Config | Default | Meaning |
|---|---|---|
| `maxEventsPerQuery` | `500` | Maximum events returned by one `listEvents` call. |
| `redact` | `true` | Whether to redact sensitive text before an event is stored. |
| `redactionMarker` | `[redacted:{rule}]` | Replacement written in place of every match; `{rule}` becomes the matching rule's name. |
| `redactionRules` | the families below | The rule set: `{ name, pattern, flags? }`, applied in order. |
| `storageWriteRetries` | `4` | Extra attempts after a durable write fails with `EPERM` / `EBUSY` (the Windows rename-over-open-handle race). `0` disables retrying. |
| `storageWriteRetryDelayMs` | `50` | First backoff delay in milliseconds; each retry doubles it. Only transient failures wait. |

## Durable-write retry

`dsh-storage-json` publishes a unit by writing a temp file and renaming it over the target. On Windows that rename fails with `EPERM` while an antivirus, an indexer, or another reader holds the target open, and the JSON backend reports the error instead of retrying. Telemetry replays the identical write for `EPERM` and `EBUSY` up to `storageWriteRetries` times with exponential backoff, so a transient scan window does not silently drop an event; every other error is rethrown immediately. A write that exhausts the budget is still dropped, because `track()` is fire-and-forget — the retry narrows the failure window, it does not turn a permanent medium failure into a success.

## Write-time redaction

The fields that carry the most diagnostic value — `error.message`, `error.stack`, and free-form `metadata` — are exactly the ones that pick up absolute paths, addresses, and credentials on the way through. Those records are also what the log-analysis feature reads and pastes into a GitHub issue, so a secret captured here leaves the machine on the next report.

Redaction therefore happens **before the write**, in `src/redaction.ts`, and is irreversible. Rules are applied in order, so a more specific pattern runs ahead of a generic one and supplies the more informative marker: a token is also long and base64-shaped, and gets labelled `credential` because that rule runs first.

| Rule | Catches |
|---|---|
| `email` | `jane.doe+work@example.co.uk` |
| `jwt` | three-part `eyJ…`.`…`.`…` tokens |
| `credential` | `Bearer …` / `Basic …`, prefixed keys (`sk-`, `ghp_`, `github_pat_`, `xox…`, `AKIA…`, `AIza…`), and `api_key=` / `password:` / `secret=` assignments |
| `query-credential` | `?token=…`, `&key=…`, `?signature=…` in a URL |
| `home-path` | `/Users/…`, `/home/…`, `/root/…`, `/var/…`, `/tmp/…`, `/opt/…`, `/mnt/…`, `/etc/…`, `~/…`, and `C:\Users\…` |
| `file-url` | a `file:///…` URL |
| `absolute-path` | any other absolute path of two segments or more, `/v1/chat/completions` included |
| `unc-path` | `\\server\share\…` |
| `windows-path` | any other absolute Windows path |
| `cn-id` / `cn-mobile` | an 18-digit resident ID and a mainland mobile number |
| `ipv4` / `ipv6` | literal addresses |
| `hex` / `base64` | long blobs (32+ hex characters, 40+ base64 characters) |

One deliberate limit on how far the path rules reach. A bare path segment such as `/api` or `/v1` is **not** touched: a rule set that also chews up the channel and endpoint names it will be asked to explain is a rule set nobody can debug with. Two segments or more go, wherever they are written — inside a URL as well, where the host alone still names the service. Every path rule stops at a colon, so a stack frame's `path:line:column` keeps its position — the position is the part that makes the path worth logging. The same trade-off decides the digit rules: an eighteen-digit run is only a resident ID when the middle of it reads as a date, so an ordinary long number survives.

Only strings are rewritten. Non-string leaves keep their value and their type, so redaction removes secrets rather than reshaping the log. Values that are neither plain data nor strings are stringified rather than passed through unexamined. `metadata` absent stays absent instead of becoming `{}`, because the durable schema treats those differently.

**What is not redacted:** `pluginId`, `action`, `category`, `result`, `sessionId`, `error.code`, and `error.featureCodeRef`. These are the plugin's own grouping keys; redacting them would protect nothing the plugin did not already choose to publish while destroying the grouping that makes the log analyzable. A deployment that needs one of them covered can add a rule.

**Rules are configuration, not a constant.** The balance between "keeps secrets out" and "keeps enough to debug" is deployment-specific, and an over-broad rule loses triage information permanently — which is why the rule set is a `Config` field. `redactionRules` **replaces** the default set rather than extending it, so a deployment that finds one family noisy — the mobile-number or resident-ID rules, say — drops it by writing out the set it does want. A rule added today changes what is recorded next, and what the analysis re-reads from here on; it never rewrites the store. A rule whose pattern fails to compile is dropped rather than thrown: a typo in configuration must not stop the host recording anything at all.

## Read-time redaction

Write-time redaction is irreversible, so a record stored before a rule existed keeps verbatim whatever that rule would have removed. `analyzeForPlugin` therefore runs the same rule set again on the way out: the failure event each group carries (`latest`) has its `error.message`, `error.stack`, and `metadata` re-read through the rules before the analysis leaves the service. That is the last point before the text becomes a model prompt and a pre-filled issue, so it is where a legacy record gets stopped.

Two properties keep this cheap and safe. It touches only each group's most recent failure — one pass per failure pattern, not per stored event — and it is idempotent, because a value that already carries a `[redacted:…]` marker matches no default rule and comes back unchanged. Grouping keys stay legible on read for the same reason they stay legible on write.

`listEvents` is deliberately **not** re-read: it is the raw view of what the host stored, and it never feeds a report. `redact: false` disables both passes, because the deployment has already asked for the verbatim log.

## Service methods

| Method | Behavior |
|---|---|
| `track(input)` | Records a success event (fire-and-forget KV write). |
| `trackError(input)` | Records a failure event with `category: 'error'`, `result: 'failure'`, and the error record carrying a `featureCodeRef`. |
| `listEvents(query)` | Synchronous read of matching events, newest first by write order. Filters by `pluginId`, `category`, `result`, and timestamp range. |
| `analyzeForPlugin(pluginId)` | Groups all failure events for one plugin by `featureCodeRef`, returning total counts, the window it read, and per-group error codes. The event each group carries is re-read through the redaction rules on the way out. |

## Telemetry event model

Every event carries a `pluginId`, `action`, `category` (`user-action` / `system` / `error`), and `result` (`success` / `failure`). Error events carry a `TelemetryErrorRecord` with a `code`, `message`, and the agreed `featureCodeRef` — a stable code-section anchor (e.g. `"memo:analyze"`) that the log-analysis step correlates against the plugin's feature code.

## Event order

Every event also carries `seq`, a monotonic write sequence the service assigns when the event is recorded. It is what orders the log. `Date.now()` counts milliseconds, so an attempt recorded in the same millisecond as the failure it follows would otherwise compare as "not later", and the analysis would report `0` attempts after a failure that did happen again. The sequence continues across restarts — the service seeds it from the stored maximum when the domain opens, so a number is never handed out twice — and a record stored before the field existed reads back as `seq: 0`, which orders it by `timestamp` instead. Two such legacy records in the same millisecond cannot be ordered any better than that, and the field was added precisely so that no new record lands in that position. The analysis `window` stays a timestamp range: it answers which stretch of time was read, not which event came first.

## Analysis facts

`analyzeForPlugin` reports more than a total, because a total cannot be told apart from a current problem: the same count describes an incident from last week and one from a minute ago.

- **`window`** — the time range the analysis read, absent when the plugin has no events. Only that plugin's events bound it.
- **`attemptsAfterLastFailure`** (per group) — attempts of the group's action(s) recorded after its most recent failure. Counted by action rather than by total events: a plugin's unrelated reads would otherwise inflate the number and present an old failure as if it sat in a busy period. "After" is write order, so an attempt recorded in the same millisecond as the failure still counts.
- **`route`** (per group) — the provider and model the most recent failure ran on, when that event recorded them. Distinguishing "not recorded" from "no route" matters: failures recorded before the route metadata existed carry neither.

`route` is extracted by allowlist (`provider`, `model`, `status`) rather than by copying the event's `metadata`. Metadata is an open map a plugin fills with anything it likes, and reports built from this analysis leave the machine, so only these named keys cross the boundary.

## Requirement mapping

- **Req 7** — Built-in local-only telemetry tracking, packaged as a reusable DSH plugin. Any feature plugin can call `ctx.telemetry.track()` / `ctx.telemetry.trackError()` to record operation trails and error logs. The `featureCodeRef` on every error event is the agreed log format that the log-analysis feature (req 8) correlates against the plugin's feature code.
- **Req 12** — Encapsulated as a generic plugin: any DSH plugin can depend on `@zhangj1164/dsh-telemetry` and use `ctx.telemetry` to record events, not just the memo suite.

## Known Limitations

- **Host-side only** — the service does not extend `TypertRemoteService`; the client never calls it directly.
- **No user-facing surface of its own** — this package registers no model tool and ships no UI, so installing `dsh plugin --profile web add @zhangj1164/dsh-telemetry` on its own adds a service and nothing a user can see. It is infrastructure for other plugins to consume (`ctx.get('telemetry')`), and the visible surface arrives with the plugin that consumes it — in this repository, the memo board's log-analysis action.
- **Fire-and-forget writes** — `track()` and `trackError()` return `void`; the KV write is durable and queued, but callers must wait for the write chain to settle before a synchronous `listEvents()` reflects new events.

