# 备忘面板会话总结设计

本文记录「在备忘面板总结官方已归档会话，并把结果写入当前周」这一批改动的设计决策。目的：让用户在一周结束时，不必重读每个会话，就能从周视图的卡片里看到本周实际完成的工作；每条总结都带来源会话 ID，可回溯。

## 目标

1. 只对**官方归档**的会话做总结，不复用备忘自己的按季度归档。
2. 由用户手动触发、手动勾选，绝不在归档时自动消耗模型调用。
3. 总结结果写入**当前查看周期对应的周**（与输入框添加卡片的落点一致），并以纯文本条目保存。
4. 条目末尾附来源会话标注，默认 `来源会话：<sessionId>`，格式可由插件 `Config` 覆盖。
5. 不新增 npm 包：能力进 `@zhangj1164/dsh-memo` 与 `@zhangj1164/dsh-client-ui-memo`，安装命令保持 `@zhangj1164/dsh-memo` 不变。

## 已确认的取舍

- **手动触发 + 当前周**：面板头部新增「总结会话」，弹窗列出归档会话，勾选后逐个总结，写入当前查看的周。用户始终知道何时、为哪些会话消耗模型调用。
- **来源标注宿主侧拼接**：模型只产出总结正文；来源标注由宿主用配置模板渲染后追加，客户端无法伪造。
- **新增 `originSessionId` 而不是复用 `source`**：`source` 的既有语义是「用户链接的外部文件路径」，复用它会让去重和未来查询把两种来源混为一谈。新字段可选，对既有存储行向后兼容。
- **可选服务读取**：`workspaceRegistry` 与 `sessionQuery` 通过 `ctx.get()` 读取，不加入 `static inject`。没有工作区/会话查询的 headless 部署仍应能正常启动备忘服务，只是在调用总结时返回明确的不可用失败码。

## 取证得到的关键事实

- 官方归档集合由 `ctx.workspaceRegistry.archivedSessionIds` 暴露；`archiveSession`/`unarchiveSession` 同属该服务。运行时 Inspect 已确认该服务在当前 Web profile 中挂载。
- 会话内容由 `ctx.sessionQuery` 读取：`readTitleSnapshots(ids)` 批量返回标题与 header，`readSurface(id)` 返回模型可见的当前 surface。两者在当前 Web profile 中均挂载。
- `SessionHeader` 含 `id`、`createdAt`、可选 `cwd`、可选 `origin: 'subagent'`；子会话不应出现在周工作摘要的选择列表里。
- `MemoEntry` 已由 zod schema 在存储边界校验；新增可选字段不会让既有行失效。
- 现有 `resolveRoute`（请求 → `Config` → `agentDefaultModel`）与 `streamLlmText` 已处理路由与失败保真，总结复用它们，不另造一套。
- 客户端已有 `targetWeekId()`：优先选当前周期内的当前周，否则选该周期最后一周，再回退到宿主最新周。复用它与输入框的落点保持一致。

## 接口

### 宿主 Remote

| 方法 | 入参 | 出参 |
|---|---|---|
| `listArchivedSessions` | `{}` | `{ sessions, maxSessions, currentWeekId }`；每个会话含 `sessionId`、`title`、`createdAt`、`cwd?`、`summarizedWeekIds`。 |
| `summarizeSession` | `{ sessionIds, weekId?, provider?, model?, force? }` | `{ weekId, outcomes }`；每个 outcome 含 `sessionId`、`title`、`entry?`、`error?`。 |

`summarizeSession` 的顶层失败只用于请求级问题（服务缺失、空选择、超过上限、周 id 非法、目标周已归档）；单个会话的读取、空内容、重复、模型失败都放进 `outcomes`，保证部分成功可用。

### 失败码

新增：`session-service-unavailable`（含 `service`）、`invalid-session-id`、`no-sessions`、`too-many-sessions`（含 `limit`）、`session-not-archived`、`session-unreadable`、`session-empty`、`already-summarized`（含 `weekId` 与 `entryId`）。模型失败继续用既有 `llm-failure`。

### Config（dsh-memo）

| 字段 | 默认 | 说明 |
|---|---|---|
| `sessionSummaryPrompt` | 内置中文工作总结提示 | 总结系统提示，部署可覆盖。 |
| `sessionSummarySourceTemplate` | `\n\n来源会话：{sessionId}` | 条目末尾的来源模板；支持 `{sessionId}`、`{sessionTitle}`。 |
| `sessionSummaryTranscriptMaxChars` | `24000` | 单次总结送入模型的对话总字符上限。 |
| `sessionSummaryMaxSessions` | `5` | 一次请求允许总结的会话数上限。 |

单条消息另有固定上限（4000 字符）作为协议常量，避免一条超长消息挤掉其余上下文。

## 对话提取规则

只保留人可见的问答：

- 跳过 `system/message`、`developer/message`、`tool/result`。
- 用户消息只保留 `source.kind === 'user'` 的，跳过工具或系统注入。
- 助手消息只取 `text` 内容块，忽略工具调用。
- 单条超限截断并加省略标记；总量超限时保留开头与结尾、省略中间，因为工作会话的目标通常在开头、结论通常在结尾。

纯函数放在 `src/session-transcript.ts`，宿主方法只负责编排。

## 写入与去重

- 目标周：请求的 `weekId`，否则宿主当前 ISO 周。
- 写入前用 `archivedWeekFailure` 检查备忘自己的已归档季度；命中则顶层返回 `quarter-archived`。
- 每个会话生成一条 `text` 条目：`总结正文 + 渲染后的来源模板`，并带 `originSessionId`。
- 目标周已有同 `originSessionId` 的条目时返回 `already-summarized`，`force: true` 才继续。客户端把这类行标为「本周已总结」并禁用勾选。

## 客户端

- 面板头部新增「总结会话」按钮，打开 `SessionSummaryDialog`。
- 弹窗加载归档会话，显示标题、创建日期、短 ID；支持全选/清空；显示目标周；目标周被备忘季度归档时禁用提交并提示先取消归档。
- 提交后逐个返回结果：成功的卡片随看板刷新出现；失败项在弹窗内列明原因，全部完成后再关闭或由用户关闭。
- 所有文案进 `locales.ts` 的 zh/en；对话框复用现有 `dsh-memo-dialog` 样式。

## 测试

- 宿主：默认/自定义标注、跳过工具消息、空会话、读失败隔离、重复拒绝与 `force`、超过上限、服务缺失、LLM 失败透传、子会话过滤。
- 客户端：controller 的新 RPC 与状态、弹窗的打开/勾选/提交/归档周禁用。
- `remote-signatures.spec.ts` 自动覆盖新方法的单 `request` 参数。
- 门禁：`pnpm run gates`；之后重建两个包并在 `http://127.0.0.1:3080` 实际验收。

## 本次不包含

- 归档时自动总结（需要额外的模型成本授权与去抖策略）。
- 跨会话合并成一条周总结（本期是一会话一条，周视图天然汇总）。
- 从会话内容生成 GitHub Issue。
- 修改官方归档 UI 或归档数据本身。
