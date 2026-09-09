# dsh-telemetry

English | [中文](README.zh.md)

Local-only in-process telemetry tracker for DeepSeek Harness. Records operation trails and error logs over the storage-domain KV backend with feature-code-anchored failure grouping.

## Plugin

`TelemetryService extends Service` with `static inject = ['storageDomain']`. The service opens a dedicated storage domain on `Service.init` and provides synchronous reads for log analysis.

| Config | Default | Meaning |
|---|---|---|
| `maxEventsPerQuery` | `500` | Maximum events returned by one `listEvents` call. |

## Service methods

| Method | Behavior |
|---|---|
| `track(input)` | Records a success event (fire-and-forget KV write). |
| `trackError(input)` | Records a failure event with `category: 'error'`, `result: 'failure'`, and the error record carrying a `featureCodeRef`. |
| `listEvents(query)` | Synchronous read of matching events, newest first. Filters by `pluginId`, `category`, `result`, and timestamp range. |
| `analyzeForPlugin(pluginId)` | Groups all failure events for one plugin by `featureCodeRef`, returning total counts and per-group error codes. |

## Telemetry event model

Every event carries a `pluginId`, `action`, `category` (`user-action` / `system` / `error`), and `result` (`success` / `failure`). Error events carry a `TelemetryErrorRecord` with a `code`, `message`, and the agreed `featureCodeRef` — a stable code-section anchor (e.g. `"memo:analyze"`) that the log-analysis step correlates against the plugin's feature code.

## Requirement mapping

- **Req 7** — Built-in local-only telemetry tracking, packaged as a reusable DSH plugin. Any feature plugin can call `ctx.telemetry.track()` / `ctx.telemetry.trackError()` to record operation trails and error logs. The `featureCodeRef` on every error event is the agreed log format that the log-analysis feature (req 8) correlates against the plugin's feature code.
- **Req 12** — Encapsulated as a generic plugin: any DSH plugin can depend on `dsh-telemetry` and use `ctx.telemetry` to record events, not just the memo suite.

## Known Limitations

- **Host-side only** — the service does not extend `TypertRemoteService`; the client never calls it directly.
- **Fire-and-forget writes** — `track()` and `trackError()` return `void`; the KV write is durable and queued, but callers must wait for the write chain to settle before a synchronous `listEvents()` reflects new events.

