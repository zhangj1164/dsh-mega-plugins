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

`listModels` 把第 2、3 层解析结果作为*当前*路由上报，随后给出**每一个已注册** provider 及其公布的模型，使调用方既能显示「本次会用哪个模型」，也能切到部署真实拥有的其他路由。插件仅声明、尚未激活的 dormant 路由不会出现：它们承载不了调用，列出来等于提供一个必然失败的选择。所有异常都在**成功**结果里上报：某个 provider 自己的目录抛错时只带它自己的 `error`，其余照常可用；只有整个注册表都读不出来时才设 `catalogError`——选择器失效不等于看板失效。注册表与目录都来自 `llm` 服务，因为 DSH 只把 `listProviders` 与 `listModels` 暴露给宿主；浏览器两者都无法枚举，也绝不能被塞一份硬编码清单。两者在 DSH 里都是建议性的：成员资格从不参与请求校验，所以未列出的模型 id 不等于被拒绝。

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

每个方法都声明且只声明一个名为 `request` 的形参，即使它本身不携带任何输入。协议按**名字**绑定参数——客户端发送 `{ args: { request } }`——因此一个完全不声明形参的方法，其调用会在进入方法体之前就被拒绝。这不是外观差异：`listArchivedQuarters` 曾经不声明形参，宿主成功归档了季度，而客户端读回的结果始终为空，于是归档看起来什么也没做。现在 `tests/remote-signatures.spec.ts` 会让任何违反该规则的方法失败。

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
| `analyzeLogs(request)` | 读取本插件的遥测失败记录，通过 github-issue 服务生成 GitHub issue 报告。会一并传递分析时间窗，以及每组的路由、最近一次失败时间和之后的尝试次数，使报告能说明失败是否仍在发生。 |
| `listPeriods(request)` | 列出某一维度（周/月/季/年）可导航的周期，最新的在前，并给出每个周期包含的周 id。 |
| `archiveQuarter(request)` | 按标签归档一个季度。任何不符合 `YYYY-Qn` 的标签都会以 `invalid-quarter-label` 被拒绝。 |
| `unarchiveQuarter(request)` | 将某季度移出归档，并报告是否确实删除了记录。 |
| `listArchivedQuarters(request)` | 列出已归档的季度，最早的在前，每条附带宿主解析出的周 id。 |
| `listModels(request)` | 上报 AI 调用将使用的路由，随后给出每个已注册 provider 及其公布的模型。不会失败：某个 provider 读不出来时只带它自己的 `error`，整个注册表读不出来时返回空列表并附 `catalogError`。 |

## 季度归档

归档一个季度是打一个持久标记，而不是搬移：备忘所在的周原地不动，一个已归档季度就是在它自己的存储 domain（`memo_archive`，表 `quarters`）里的一行 `{ label, archivedAt }`。没有任何内容被复制，因此取消归档不会丢内容，归档状态也不可能与备忘表不一致。

`listArchivedQuarters` 返回每个季度的周 id，由宿主用「决定一个季度拥有哪些周」的那同一套周期日历解析。客户端只需据此建一个 `Set` 就能知道哪些卡片只读——这正是归档能在**四个维度**同时生效、而客户端又永远不需要跨年把周映射到季度的原因。

这些周 id **刻意不落存储**。它们由标签确定性地推导而来，存下来就等于存一份可推导的副本：一旦日历规则被修正，这份副本就会出错，并在此刻静默地把卡片错误地解除归档或过度归档。

**请求只命名季度，绝不命名周期。** 「你正在看的周期所属的季度」没有唯一答案：一年包含四个季度；而某一周的周一可能落在上一个季度，这一周本身却属于包含其周四的那个季度。因此按周期的起始时间戳反推季度，会在周维度与年维度上都归档到错误的季度——所以归档动作只在季度标签无歧义处提供，其他任何地方都不做猜测。

该 domain 与 `memo` 分离，而不是在 `weeks` 旁加一张表，这样归档打不开也绝不会导致备忘表打不开。名字是 `memo_archive` 而非 `memo-archive`：存储 domain 名必须匹配 `/^[a-z][a-z0-9_]*$/`。

**已归档季度在宿主侧就是只读的。** `addEntry`、`updateEntry`、`deleteEntry` 对落在已归档季度内的周一律以失败码 `quarter-archived` 拒绝，且在任何表操作之前就拒绝，因此被拒的调用什么都不改变。只读之所以落实在这里而不只是浏览器里，是因为同一套 Remote 方法从任何客户端都可达，也因为归档可能在编辑弹窗已经打开之后才落地。

守卫询问的是 `weekIdBelongsToPeriod(weekId, 'quarter', label)`——也就是当初解析该季度周 id 时用的同一条周四规则，因此它的判断不可能与产出这些周 id 的日历发生漂移。代价是在一次用户发起的写入上遍历一遍归档行，而归档行至多只有几个季度。

一个值得说明的后果：归档**当前**季度会连今天一起关掉，因为「归档本季度」对进行中的季度是一个正当操作。客户端在该状态下禁用输入区并指出取消归档动作，因此出路始终一次点击可达。

## 四维度周期

备忘 UI 在同一批卡片上按周、月、季、年导航。这套日历计算由 `dsh-memo/period` 统一持有，宿主与 UI 因此不可能对"哪张卡片属于哪里"产生分歧。

周期标签是固定的：`2026-W36`、`2026-09`、`2026-Q3`、`2026`。

归属只有一条规则：**一周属于包含其周四的那个周期**——这同时也是"哪一年拥有这一周"的既定约定，所以 `2025-12-29` 是 `2026-W01`。由于每周恰有一个周四，各周期的周列表恰好平铺整条时间线：一年的十二个月与四个季度各自不重不漏地覆盖该年的所有周。`weekIdsInPeriod` 就是 `weekIdBelongsToPeriod` 的枚举，因此一张卡片不可能"在一个周期里被列出、在另一个周期里被高亮"。

旧的前缀判定里藏着两个缺陷，现已由测试覆盖：

- 季度归属沿用了与月份标签共享的 `YYYY-` 前缀，导致一年中每个季度都匹配到 `Q1`。
- 周标签取的是该周周一的日历年，导致跨年那一周整体错一年。

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
