# 日志分析报告保真设计

本文记录「让日志分析报告带上模型路由与时间窗，把可能原因从猜测改成可判读的事实」的设计。触发点是一次实测：用户拿到的报告把两周前的旧失败读成现状，并给出了一串与本插件代码无关的修复建议。关键事实来自源码阅读、对遥测原始记录的统计，以及三个包的现有接口，未采用推断。

## 问题

三处缺陷，按严重程度排列。

### 1. 报告不带时间窗，于是旧失败被读成现状

`analyzeForPlugin` 只统计累计值，`generateReport` 的 prompt 也只收到累计总数。报告因此写「失败率约 1.09%」，而读者无法知道这些失败发生在什么时候。实测数据的按日分布是：

| 日期 | 事件 | 失败 |
|---|---:|---:|
| 09-01 | 27 | 2 |
| 09-11 | 37 | 3 |
| 09-14 | 173 | 0 |
| 09-15 | 206 | 0 |

全部 5 次失败发生在 09-01 与 09-11；最后一次是 09-11 11:04，此后共 403 条事件，其中 `analyze` 12 次、`exportReport` 2 次，**零失败**。也就是说报告突出描述的失败类别已有 4 天没有复现，期间该功能被正常使用过 14 次。累计分母越大，这个比率越"好看"，而它什么也说明不了。

### 2. 「需要补充采集」这句结论指错了地方

报告在「环境」一节写：模型 / 供应商 / 版本 / 请求参数 / 超时配置「遥测未提供，需要补充采集」。这句话在两个层面上不成立。

- **遥测已经在采集。** `dsh-memo` 的 `llmFailure()` 把 `provider`、`model`、`status` 写入失败事件的 metadata（由 #47/#49 落地）。
- **但报告层会把它丢掉。** `analyzeLogs` 只透传 `featureCodeRef`/`count`/`errorCode`/`errorMessage` 四个字段，`buildReportUserPrompt` 也只接受这四个。真正的缺口是报告透传，而不是采集能力。

该报告引用的那 5 条事件确实没有 metadata，因为它们发生在 09-01 与 09-11——早于上述改动。这解释了现象的来源，但不改变结论：任何一次新的 LLM 失败都会带上路由，而报告依然不会写出它。

### 3. 「可能原因 / 建议修复」是与本插件无关的通用套话

报告建议里出现的 `max_tokens` 不足、上下文占满 token 预算、分块摘要、`reasoning_content` 兼容、`stop` 序列过早命中、JSON 解析失败降级——这些环节在本插件中都不存在：`dsh-memo` 的 `Config` 只有 `repoUrl`/`provider`/`model`，它不设采样参数、不分块、也不解析 JSON。报告还猜 `memo:exportReport` "可能依赖 `memo:analyze` 结果"，而两者各自独立发起 LLM 调用（`index.ts` 的 `llmFailure('analyze', ...)` 与 `llmFailure('exportReport', ...)`）。

只要 prompt 只给出「总数 + 错误码」，模型就只能这样猜。这不是模型能力问题，是输入问题。

## 目标

报告要能自己回答三个问题，从而让读者判断「这是待修的问题还是已修的旧账」：

1. 这次分析覆盖哪个时间窗，窗口内该功能被调用过几次？
2. 每次失败发生在哪个路由（provider / model）上？
3. 最近一次失败之后，该功能又被调用过多少次、是否再次失败？

## 非目标

- **不改 LLM 调用方式**：不加采样参数、不加重试、不加分块。这些问题在本插件里不存在，报告提及它们是缺陷而非待办。
- **不做事件保留或轮转**：遥测目前只增不减，属独立议题（见「待定」）。
- **不改 URL 截断行为**：截断与「复制完整正文」已由 #54 修正。
- **不把任意 metadata 透传给 LLM**：见下面的隐私约束。

## 设计

### 1. 遥测：暴露事实，而不是暴露任意数据

`TelemetryAnalysis` 增加窗口：

- `window: { firstEventAt: number, lastEventAt: number }`，即本次分析所读事件的时间范围（空表时为 `undefined`）。

`TelemetryFailureGroup` **已经**带有 `latest: TelemetryEvent`（含 `timestamp` 与可选 `metadata`）与 `errorCodes`，因此不需要新增原始数据，只需把事实提炼成稳定字段：

- `lastFailureAt: number`（来自 `latest.timestamp`）。
- `callsAfterLastFailure: number`，即同一 `pluginId` 下时间戳晚于 `lastFailureAt` 的事件数。它让报告能写出「此后 N 次调用无失败」。
- `route?: { provider: string, model: string, status?: number }`，**按白名单**从 `latest.metadata` 中提取。

隐私约束是这里唯一的硬设计点。`metadata` 是开放的 `Record<string, unknown>`，而报告会被粘贴进 GitHub issue、离开本机；`dsh-telemetry` 的脱敏只处理字符串，README 也明确写着遥测内容会随报告离开本机。因此**不整体透传 metadata**，只按固定白名单读取三个字段。将来若需要更多字段，应逐一加入白名单，而不是改成整体透传。

白名单字段必须能在脱敏后存活：`deepseek-cu`、`deepseek-flash`、`glm-5-2-260617` 这类值不匹配 email、凭据、路径、IP、长 hex、base64 中的任何规则。这个事实需要一条测试固定下来——否则未来某次脱敏规则收紧会静默地清空报告里的路由，而没人会注意到。

### 2. 备忘服务：透传

`analyzeLogs` 把 `window`、以及每组的 `lastFailureAt`、`callsAfterLastFailure`、`route` 一并传给 `generateReport`。`dsh-memo` 不新增判读逻辑：它只负责把遥测事实搬到报告边界。

### 3. github-issue：把事实写进 prompt，并约束判读边界

`GithubIssueGenerateReportRequest` 增加上述可选字段；`buildReportUserPrompt` 增加三类事实行：分析窗口、每组的路由、每组的「最近一次失败时间 + 之后调用数」。

模板侧同时收紧判读要求：

- 「可能原因」必须逐条引用遥测中出现过的字段；**禁止**引入未被观测到的机制（采样参数、超时、分块、解析失败等），除非遥测确实记录了对应证据。
- 缺失字段写「本次遥测未记录」，**不写**「需要补充采集」——后者是行动建议，而缺失既可能是采集缺口也可能是旧事件的正常状态，报告无从区分。
- 同一路由连续多次失败时，才允许把它们合并叙述为「同一路由上的重复失败」。

### 4. 陈旧性由数据说话

有了 `lastFailureAt` 与 `callsAfterLastFailure`，报告可以写出「最后失败 09-11 11:04；此后 14 次 LLM 调用（analyze 12、exportReport 2）零失败」。这正是当前报告给不出、也最误导读者的那句话。判读规则保持在报告中立：只陈述事实与差值，不替读者下「已修复」的结论——遥测只能说明没有再发生。

## 兼容与降级

- **旧事件无 metadata**：`route` 缺省，报告写「未记录」，其余字段照常。
- **窗口为空（无任何事件）**：沿用既有的「无失败」分支，不产生空窗口段落。
- **协议兼容**：`generateReport` 是服务方法，新增字段全部可选，既有调用方（当前只有 `analyzeLogs`）不需同步修改即可继续工作；`TelemetryAnalysis` 新增字段属于同包内的类型扩展，`dsh-telemetry` 的公开导出一并更新。
- **条数上界**：遥测表只增不减，`callsAfterLastFailure` 的计算是一次全表遍历。当前量级（数百条）无问题；若将来事件量级增长，应先把遍历限制在 `window` 内，或先做保留策略（见「待定」）。

## 测试

- **telemetry**：窗口首末时间戳；每组的最后失败时间与之后调用数；白名单只取 `provider`/`model`/`status`（metadata 里塞入其他键不得出现在 `route` 中）；`provider`/`model` 经脱敏后仍然存活；空表时 `window` 为 `undefined`。
- **memo**：`analyzeLogs` 把窗口与每组事实透传给 `generateReport`（断言请求体），且不因缺字段而失败。
- **github-issue**：prompt 含窗口、路由、最近一次失败时间与之后调用数；字段缺失时写「未记录」而非「需要补充采集」；prompt 含禁止无据归因的约束语句。

## 待定

- **是否再加可配置的时间窗过滤**（只分析最近 N 天）。它能进一步压制陈旧噪声，但需要先决定遥测的保留策略：当前事件永不清理，而一个「只分析最近 7 天」的开关会把「看不到失败」与「没有失败」混在一起。倾向先只做「报告窗口」而不做过滤。
- **`prefillTruncationNote` 的默认文案点名了「备忘面板」**，而它属于通用服务 `dsh-github-issue`。它是 `Config` 字段、可覆盖，不算硬编码违规；但通用服务的默认值点名某个消费方的 UI 仍然别扭。是否改为不指名 UI 的表述，留待单独决定。
