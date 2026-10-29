# ui-memo 交互改造与归档功能设计

本文记录一批 ui-memo 交互改造与归档功能的设计决策，作为后续各工作项实施与验收的依据。所有关键事实均来自运行时槽位/服务取证或源码阅读，未采用推断；四条影响面最大的取舍已由用户逐项确认。

## 目标

在不引入跨插件职责迁移的前提下，把 ui-memo 的入口放回 DSH Web 左侧边栏，修正预填 issue 的超长 URL 缺陷，补齐结果卡片的折叠/关闭能力，重做四维度标签的筛选与年份切换，并新增按季度归档与 telemetry 写入脱敏两个宿主侧功能。每一项都必须是可独立审查、可独立回滚的改动。

## 决策记录

### 已确认的取舍

1. **预填 issue 超长** → URL 内截断正文并附一行说明，同时提供「复制完整正文」按钮。截断阈值与说明文案都做成 `Config` 字段，不硬编码。
2. **当前周期始终显示** → 最新一周即使没有任何备忘也出现在标签列并默认选中，否则用户无法往新周添加备忘。
3. **归档状态存独立 domain** → 新建 `memo-archive`（独立存储文件），不给 `memo` 域加表、不给 `weeks` 行加字段。理由是零迁移风险：本项目刚发生过「一条非法记录让整个插件无法启动」的事故，归档状态不应压在这个已暴露脆弱性的位置。
4. **telemetry 脱敏只在写入时生效** → 只影响新采集的记录，不批量改写历史记录（批量改写是不可逆操作，需要额外的确认机制，不在本次范围）。

### 取证得到的关键事实

- **侧边栏是一等扩展点。** 运行时槽位树中，`sidebar.panellist`（list，`replaceRisk: none`）的目录说明是「Global panel icons. Each list id addresses the matching main panel; the sidebar owns the button and resolves its label from list metadata.」，其 cell 收到 `{ size, active }` 用于渲染图标；`main`（keyed，`replaceRisk: shadows-shipped-ui`）的说明是「Central panel selected by sidebar entry id.」，目前只占用了 `conversation` 一个 key。现有 `packages/client/ui-memo/src/client/index.ts` 的模块注释声称侧边栏方案已被放弃，但那指的是早先的 DOM hack（注入侧边栏行 + 在会话列里绝对定位面板），与槽位方案不是一回事。
- **`main` 面板内的「关闭」可实现。** 客户端 `layout` 服务提供 `selectPanel(panelId: MainPanelId | null): void`，因此关闭按钮的语义是切回 `conversation` 面板。
- **`listPeriods` 的形状。** 它从当前周期开始往回逐条生成，`limit` 被夹在 `1..400`，**没有年份锚点**；每条 `MemoPeriodEntry` 已带 `current: boolean`、`weekCount: number`、`weekIds: readonly string[]`。这决定了四维度标签与年份切换可以完全在客户端实现。
- **`weekCount > 0` 不等于「有备忘」。** `getOrCreateCurrentWeek` 会为当前周建立**零条目**的周行，所以「该周期有备忘」必须用卡片判定，不能用宿主返回的 `weekCount`。
- **日志分析属于 dsh-memo。** `@Remote('analyzeLogs')` 定义在 `packages/memo/dsh-memo/src/index.ts`，它依次调用 `telemetry.analyzeForPlugin`、`githubIssue.generateReport`、`githubIssue.prefilledIssueUrl`。把该按钮移到右上角是纯 UI 布局变更。
- **预填 URL 有两处构造点。** `packages/client/ui-memo/src/client/MemoBoard.tsx` 与 `packages/github-issue/dsh-github-issue/src/index.ts` 各自把整份报告写进 query string，逻辑重复。

## 工作项

### 1 · 预填 issue URL 过长

- **范围**：`dsh-github-issue`（唯一权威构造点）、`ui-memo`（改为调用该 Remote，删除本地拼接）。
- **改动**：URL 构造收敛到 `prefilledIssueUrl`；正文超过阈值时截断并追加说明行；`Config` 增加正文长度上限与截断说明文案。
- **验收**：超长报告生成的 URL 能被 GitHub 接受并打开新建 issue 页面；面板上的「复制完整正文」按钮复制的是未截断正文。
- **风险**：GitHub 的长度限制没有稳定公开的常量，阈值只能取经验值并留出余量；把阈值做成 `Config` 就是为了部署侧可调整。

### 2 · 侧边栏入口

- **范围**：`ui-memo`（纯客户端）。
- **改动**：注册 `sidebar.panellist`（`id: 'memo'`）渲染图标；注册 `main`（key `'memo'`）渲染 `MemoBoard`；头部「关闭」改为 `ctx.layout.selectPanel('conversation')`；删除 `settings.section` 注册，保持单一入口，避免同一控制器被两处渲染。
- **验收**：左侧边栏出现 memo 图标，点击后中央面板显示看板，关闭返回会话；默认状态下看板不干扰会话面板。
- **风险**：图标需与 shell 视觉一致，实现时先用 Inspect 查是否暴露了 shell 的图标组件，查不到则用插件自带内联 SVG。

### 3 · 头部按钮与结果卡片

- **范围**：`ui-memo`（纯客户端）。
- **改动**：头部右上角三个按钮改为**图标 + 文字**，顺序为 `添加 issue`、`日志分析`、`关闭`（关闭最右）；三个结果容器（AI 分析 / 导出报告 / 日志分析）各加「折叠」与「关闭」图标按钮——折叠收起正文保留标题，关闭清空该结果。
- **验收**：三个结果容器都能独立折叠与关闭；关闭后不残留状态；按钮可被键盘聚焦且有可访问名称。
- **风险**：这三个结果是 controller 的临时状态，清空即完成，不涉及存储；注意不要与「刷新」混淆。

### 4 · 四维度标签与年份切换

- **范围**：`ui-memo`（纯客户端）。
- **改动**：把 `PERIOD_HISTORY_LIMIT` 从 24 调整为一次拉取宿主上限 400，维度切换与年份切换全部在客户端计算；新增纯函数实现标签规则；维度切换组同一行右侧增加年份选择器。
- **标签规则**：在选定年份内取该维度的所有周期，保留「有备忘」或「是当前周期」的，按时间倒序取前 10 个。当前周期永远在列。
- **年份选择器**：可选年份从拉回的周期标签推导，当前年始终在列。
- **验收**：周维度只显示最近的若干个有数据的周标签（不超过 10 个）加当前周；没有数据的历史周不出现；切换年份后标签整体换到该年；纯函数有单元测试覆盖。
- **风险**：周维度一次拉 400 条约覆盖 7.7 年历史，对个人备忘足够；要无限历史必须给 `listPeriods` 增加锚点参数，那是一个独立决定，不在本次范围。

### 5 · 按季度归档

- **范围**：`dsh-memo`（存储与 Remote）、`ui-memo`（卡片状态与操作）。
- **改动**：新建独立 domain `memo-archive`；新增 `archiveQuarter(label)`、`unarchiveQuarter(label)`、`listArchivedQuarters()`；最后这个返回每条归档季度的 `{ label, weekIds }`，由宿主解析 weekIds，客户端只建 `Set` 判断卡片是否归档，避免客户端做「周 → 季度」的跨年边界换算。
- **规则**：某季度归档后，**所有维度**下落在该季度的卡片都只读，编辑按钮位置变成「取消归档」，卡片有视觉区分（降对比度 + 「已归档」标记）。
- **验收**：归档一个季度后，四个维度下该季度的卡片都不可编辑且显示为已归档；取消归档后恢复可编辑；非归档季度的卡片行为不变。
- **风险**：若实现时确认给 `memo` 域增加表无需版本升级，可再合并回单一存储文件；独立 domain 是更安全的默认。

### 6 · telemetry 脱敏

- **范围**：`dsh-telemetry`（纯宿主）。
- **改动**：写入前对敏感字段脱敏；规则集（邮箱、家目录与绝对路径、token 与密钥形态、IP、长 hex/base64）作为 `Config` 字段可配置；配套单元测试。
- **验收**：含敏感样例的数据写入后，存储中的对应字段已被替换；规则可经配置增删；历史记录不受影响。
- **风险**：脱敏是不可逆的，规则过宽会丢失排障信息——规则集可配置正是为此，且只对新记录生效。

## 实施顺序

先做工作项 1（独立缺陷，影响面最小且有用户可见的失败），再做 2 → 3 → 4（三者都在 ui-memo 客户端且存在依赖顺序：入口先落地，头部与结果卡片次之，标签逻辑最后），然后做 5（宿主 + 客户端），最后做 6（纯宿主，与其他项无耦合）。

每个工作项都是独立的 issue、独立分支、独立 PR，并且必须通过 `pnpm run gates`（9 道门禁）后才合并。

## 本次不包含

- 给 `listPeriods` 增加年份/锚点参数（工作项 4 用客户端方案覆盖了需求，YAGNI）。
- telemetry 历史记录的批量清洗（决策 4）。
- 除季度以外的归档粒度（用户明确「先支持按季度归档」）。
- 归档状态的跨设备同步（本地存储，与现有 weeks 一致）。
