# dsh-memo

[English](README.md) | 中文

DSH 本地按周组织的个人备忘服务，支持 AI 分析、报告导出、遥测记录和 GitHub issue 生成。

## 插件

`MemoService extends TypertRemoteService`，`static inject = ['storageDomain', 'telemetry', 'githubIssue']`。服务将条目存储在以 ISO-8601 周标识（`YYYY-Www`，周一起）为键的 KV 表中，使用 LLM 进行分析和报告导出。

| 配置 | 默认值 | 含义 |
|---|---|---|
| `repoUrl` | `https://github.com/zhangj1164/dsh-mega-plugins` | 传递给 github-issue 服务用于报告生成的 GitHub 仓库 URL。 |
| `provider` | 未设置 | AI 调用使用的已注册 DSH provider 路由。未设置时跟随本部署的 `agentDefaultModel` 选择。 |
| `model` | 未设置 | AI 调用的模型 id。未设置时跟随本部署的 `agentDefaultModel` 选择。 |

## 模型路由解析

AI 调用按以下顺序解析路由，没有任何硬编码：

1. 请求上显式的 `provider`/`model`（供测试和需要临时改路的调用方使用）。
2. 本服务的 `Config.provider` / `Config.model`。
3. 本部署 `agentDefaultModel` 服务的当前选择——"这个部署用哪个模型"已有的唯一事实来源。

解析不出路由时，调用以 `llm-failure` 且 `failureCode: 'NO_MODEL_ROUTE'` 失败，而不是静默地什么都不产出。

## 失败上报

`analyze`、`exportReport` 以及其它基于模型的方法会保留 DSH 的失败事实，而不是把它们统统折叠成一条消息。失败时的 `llm-failure` 携带：

| 字段 | 含义 |
|---|---|
| `failureCode` | DSH 的 provider 中立机器路由码：`NO_ADAPTER`、`MISSING_CREDENTIAL`、`AUTH`、`RATE_LIMIT`、`EMPTY_RESPONSE` 等。 |
| `message` | DSH 原始消息，前缀本次尝试的 provider 与 model。 |
| `provider` / `model` | 失败调用实际发往的路由。 |
| `status` | provider 返回的 HTTP 状态码（DSH 提供时）。 |

`EMPTY_RESPONSE` 表示模型确实没有产出文本；`NO_ADAPTER` 表示配置的 provider 在本部署中未注册。这两者以前无法区分。

## Remote 方法

| 方法 | 行为 |
|---|---|
| `getOrCreateCurrentWeek(request)` | 创建或返回当前周。`provider`/`model` 为可选覆盖项。 |
| `getWeek(request)` | 按 id 返回一个周，不存在时返回 `null`。 |
| `listWeeks(request)` | 按范围列出周，最新的在前。 |
| `addEntry(request)` | 向一周添加条目。若该周不存在则创建。 |
| `updateEntry(request)` | 更新条目内容。编辑过去的周需要 `force: true`。 |
| `deleteEntry(request)` | 从一周删除条目。过去的周需要 `force: true`。 |
| `analyze(request)` | 对一段时间的条目运行 AI 分析（梳理/总结/分析）。该时段无条目时返回 `no-entries`，模型调用失败时返回 `llm-failure`。 |
| `exportReport(request)` | 使用模型导出一段时间的 Markdown 工作报告。 |
| `readExternalPath(request)` | 读取本地文件路径并将其作为条目添加。 |
| `analyzeLogs(request)` | 读取本插件的遥测失败记录，通过 github-issue 服务生成 GitHub issue 报告。 |

## 共享 LLM 文本助手

`dsh-memo/llm-text` 导出 `streamLlmText(llm, route, system, userText)`，这是把 DSH 流转换为"收集到的文本"或"保留的失败事实"的唯一位置。其它向模型索取单块文本的宿主插件应当使用它，而不是各自重写流循环：手写的副本正是丢掉 `chunk.reason.failure`、把所有失败报成一模一样的原因。

## 历史周强制门控

当前周始终可编辑。在过去的周中编辑或删除条目需要 `force: true`，以确认 AI 分析结果可能发生变化。这防止了在未经明确同意的情况下意外修改历史记录。

## Bundle 层

此包声明 `dsh: { bundle: { patch: "./cordis.patch.yml" } }`。补丁将 `github-issue` 和 `memo` 行插入宿主组合。`telemetry` 行由 `dsh-telemetry` bundle 拥有，以避免重复的加载器条目 id。

## 需求映射

- **需求 1** — `addEntry` 支持 `text`、`image` 和 `file` 条目类型；UI 面板记录文本条目。
- **需求 2** — `getOrCreateCurrentWeek` 自动创建或加载当前 ISO 周（周一开始，周日结束）作为存储点。
- **需求 3** — `updateEntry` 和 `deleteEntry` 强制 `past-week-requires-force`：编辑非本周的备忘需要 `force: true`，以确认 AI 分析结果可能变化。
- **需求 4** — `analyze` 和 `exportReport` 接受周期参数（`week` / `month` / `quarter` / `year`），并收集匹配周中的条目。
- **需求 5** — `readExternalPath` 通过 `fs` 服务读取本地文件路径；客户端 UI 必须在调用前显示同意对话框（提权边界）。
- **需求 6** — `exportReport` 生成标准工作报告（Markdown），可直接审查并导出为 `.md`。
- **需求 7** — 每个关键操作都调用 `ctx.telemetry.track()` / `ctx.telemetry.trackError()`，携带 `featureCodeRef` 锚点。
- **需求 8** — `analyzeLogs` 通过 `telemetry` 服务读取遥测失败记录，通过 `githubIssue` 生成 GitHub issue 报告，并返回报告 + 预填 URL。
- **需求 12** — 依赖 `dsh-telemetry` 和 `dsh-github-issue` 作为独立的通用插件。

## 已知限制

- **仅按周组织** — 条目按 ISO 周组织；没有自由格式的日期或标签系统。
- **模型路由属于部署配置** — 解析不出路由、或配置的路由未注册时，`analyze` 和 `exportReport` 以 `llm-failure` 加 `failureCode` 失败。请在此处设置 `provider`/`model`，或依赖 `agentDefaultModel`。
- **遥测和 github-issue 为注入服务** — memo 服务通过 `inject` 依赖它们的可用性。
