# dsh-telemetry

[English](README.md) | 中文

DSH 本地进程内遥测跟踪器。基于 storage-domain KV 后端记录操作轨迹和错误日志，按特性代码锚点分组失败事件。

## 插件

`TelemetryService extends Service`，`static inject = ['storageDomain']`。服务在 `Service.init` 时打开专用存储域，并提供同步读取以供日志分析。

| 配置 | 默认值 | 含义 |
|---|---|---|
| `maxEventsPerQuery` | `500` | 一次 `listEvents` 调用返回的最大事件数。 |
| `redact` | `true` | 是否在写入事件前对敏感文本脱敏。 |
| `redactionMarker` | `[redacted:{rule}]` | 每处命中替换成的文本；`{rule}` 会替换为命中的规则名。 |
| `redactionRules` | 下列五类规则 | 规则集：`{ name, pattern, flags? }`，按顺序应用。 |

## 写入时脱敏

最有排障价值的字段——`error.message`、`error.stack`，以及调用方自由填写的 `metadata`——恰恰是最容易在流转中带上绝对路径、地址与凭据的那几个。而这些记录也正是「日志分析」功能读取、并粘贴进 GitHub issue 的内容，因此这里捕获到的密钥会随下一次报告离开本机。

所以脱敏发生在**写入之前**，实现在 `src/redaction.ts`，且不可逆。规则按顺序应用，因此更具体的模式排在通用模式之前，并由它给出更有信息量的标记：token 同时也是「长且形似 base64」的串，因为 token 规则先跑，所以它被标为 `credential`。

| 规则 | 命中内容 |
|---|---|
| `email` | `jane.doe+work@example.co.uk` |
| `credential` | `Bearer …` / `Basic …`、带前缀的密钥（`sk-`、`ghp_`、`github_pat_`、`xox…`），以及 `api_key=` / `password:` / `secret=` 这类赋值 |
| `home-path` | `/Users/…`、`/home/…`、`/root/…`、`/var/…`、`/tmp/…`、`/opt/…`、`/mnt/…`、`/etc/…`，以及 `C:\Users\…` |
| `windows-path` | 其他任意 Windows 绝对路径 |
| `ipv4` / `ipv6` | 字面地址 |
| `hex` / `base64` | 长串（32 个以上十六进制字符、40 个以上 base64 字符） |

默认规则的触达范围有两处刻意收敛。像 `/api` 这样的裸路径片段**不**会被处理：一个连自己将来要解释的 channel 与 endpoint 名都一并打码的规则集，是没人能用来排障的规则集。家目录路径在冒号处停止，因此栈帧里的 `path:line:column` 会保留位置信息——正是位置让这条路径值得记录。

只有字符串会被改写。非字符串叶子保持原值与类型，因此脱敏是「移除密钥」而不是「重塑日志」。既不是普通数据也不是字符串的值会被字符串化，而不是原样放过。`metadata` 缺失时仍然缺失，不会变成 `{}`——持久化 schema 对二者是区别对待的。

**不脱敏的字段**：`pluginId`、`action`、`category`、`result`、`sessionId`、`error.code`、`error.featureCodeRef`。这些是插件自己的分组键；对它们脱敏既保护不了插件本就未选择公开的任何东西，又会摧毁让日志可分析的分组能力。确需覆盖其中某项的部署可以自行加一条规则。

**规则是配置，不是常量。** 「挡住密钥」与「留够排障信息」之间的平衡因部署而异，而过宽的规则会永久损失排查线索——这正是规则集是 `Config` 字段、且只影响新记录的原因。模式编译失败的规则会被丢弃而不是抛出：配置里的一个笔误不该让宿主记录不了任何东西。

## 服务方法

| 方法 | 行为 |
|---|---|
| `track(input)` | 记录一个成功事件（异步 KV 写入，立即返回）。 |
| `trackError(input)` | 记录一个失败事件，`category` 为 `'error'`，`result` 为 `'failure'`，错误记录携带 `featureCodeRef`。 |
| `listEvents(query)` | 同步读取匹配的事件，按时间倒序。支持按 `pluginId`、`category`、`result` 和时间戳范围过滤。 |
| `analyzeForPlugin(pluginId)` | 按 `featureCodeRef` 分组一个插件的所有失败事件，返回总数、本次读取的时间窗，以及每组的错误代码。 |

## 遥测事件模型

每个事件携带 `pluginId`、`action`、`category`（`user-action` / `system` / `error`）和 `result`（`success` / `failure`）。错误事件携带 `TelemetryErrorRecord`，包含 `code`、`message` 和约定的 `featureCodeRef` — 一个稳定的代码段锚点（如 `"memo:analyze"`），日志分析步骤据此与插件特性代码关联。

## 分析事实

`analyzeForPlugin` 报告的不只是一个总数，因为总数无法与「当前仍在发生的问题」区分开：同一个计数既能描述上周的事故，也能描述一分钟前的事故。

- **`window`** — 本次分析读取的时间范围；该插件没有任何事件时缺省。只有该插件自己的事件参与界定它。
- **`attemptsAfterLastFailure`**（每组）— 该组最近一次失败之后，其动作的尝试次数。按动作而非全部事件计数：否则插件无关的读取会把数字抬高，让一次旧失败看起来落在一个繁忙时段里。
- **`route`**（每组）— 最近一次失败所用的 provider 与 model，前提是该事件记录过它们。区分「未记录」与「没有路由」是有意义的：在路由 metadata 出现之前记录的失败两者都没有。

`route` 按白名单（`provider`、`model`、`status`）提取，而不是整体复制事件的 `metadata`。metadata 是插件可任意填充的开放映射，而由本分析生成的报告会离开本机，因此只有这几个具名键跨越边界。

## 需求映射

- **需求 7** — 内置的仅本地遥测跟踪，封装为可复用的 DSH 插件。任何功能插件都可以调用 `ctx.telemetry.track()` / `ctx.telemetry.trackError()` 记录操作轨迹和错误日志。每个错误事件上的 `featureCodeRef` 是约定的日志格式，供日志分析功能（需求 8）与插件功能代码进行关联。
- **需求 12** — 封装为通用插件：任何 DSH 插件都可以依赖 `dsh-telemetry` 并使用 `ctx.telemetry` 记录事件，不仅限于备忘套件。

## 已知限制

- **仅宿主侧** — 服务不继承 `TypertRemoteService`；客户端不直接调用它。
- **异步写入** — `track()` 和 `trackError()` 返回 `void`；KV 写入是持久且排队的，但调用者必须等待写入链完成后，同步 `listEvents()` 才能反映新事件。
