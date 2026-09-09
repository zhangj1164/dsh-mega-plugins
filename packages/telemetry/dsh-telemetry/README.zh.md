# dsh-telemetry

[English](README.md) | 中文

DSH 本地进程内遥测跟踪器。基于 storage-domain KV 后端记录操作轨迹和错误日志，按特性代码锚点分组失败事件。

## 插件

`TelemetryService extends Service`，`static inject = ['storageDomain']`。服务在 `Service.init` 时打开专用存储域，并提供同步读取以供日志分析。

| 配置 | 默认值 | 含义 |
|---|---|---|
| `maxEventsPerQuery` | `500` | 一次 `listEvents` 调用返回的最大事件数。 |

## 服务方法

| 方法 | 行为 |
|---|---|
| `track(input)` | 记录一个成功事件（异步 KV 写入，立即返回）。 |
| `trackError(input)` | 记录一个失败事件，`category` 为 `'error'`，`result` 为 `'failure'`，错误记录携带 `featureCodeRef`。 |
| `listEvents(query)` | 同步读取匹配的事件，按时间倒序。支持按 `pluginId`、`category`、`result` 和时间戳范围过滤。 |
| `analyzeForPlugin(pluginId)` | 按 `featureCodeRef` 分组一个插件的所有失败事件，返回总数和每组的错误代码。 |

## 遥测事件模型

每个事件携带 `pluginId`、`action`、`category`（`user-action` / `system` / `error`）和 `result`（`success` / `failure`）。错误事件携带 `TelemetryErrorRecord`，包含 `code`、`message` 和约定的 `featureCodeRef` — 一个稳定的代码段锚点（如 `"memo:analyze"`），日志分析步骤据此与插件特性代码关联。

## 需求映射

- **需求 7** — 内置的仅本地遥测跟踪，封装为可复用的 DSH 插件。任何功能插件都可以调用 `ctx.telemetry.track()` / `ctx.telemetry.trackError()` 记录操作轨迹和错误日志。每个错误事件上的 `featureCodeRef` 是约定的日志格式，供日志分析功能（需求 8）与插件功能代码进行关联。
- **需求 12** — 封装为通用插件：任何 DSH 插件都可以依赖 `dsh-telemetry` 并使用 `ctx.telemetry` 记录事件，不仅限于备忘套件。

## 已知限制

- **仅宿主侧** — 服务不继承 `TypertRemoteService`；客户端不直接调用它。
- **异步写入** — `track()` 和 `trackError()` 返回 `void`；KV 写入是持久且排队的，但调用者必须等待写入链完成后，同步 `listEvents()` 才能反映新事件。
