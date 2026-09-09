# dsh-client-ui-memo

[English](README.md) | 中文

备忘面板的浏览器端 UI 插件，由 memo Host Remote 提供按周组织的个人备忘服务，支持 AI 分析、报告导出、日志分析和 Issue 创建。

## 插件

纯 UI 界面插件：主机端 `apply` 为空，仅使插件出现在主机 cordis.yml / Loader 中；浏览器端通过 `exports["./client"]` 交付，由 package.json 的 `dsh.client` 声明发现。

## 跨包引用（补充 1）

该 UI 插件声明了**两个**工作区依赖——回答补充 1 的问题：

- **dsh-memo**（`workspace:^`）— memo Host Remote 服务。控制器通过 RPC 通道调用 `memo/getOrCreateCurrentWeek`、`memo/addEntry`、`memo/updateEntry`、`memo/deleteEntry`、`memo/analyze`、`memo/exportReport` 和 `memo/analyzeLogs`。
- **dsh-github-issue**（`workspace:^`）— GitHub-issue Host Remote 服务。控制器**直接**调用 `githubIssue/optimizeIssue`（不经过 memo）来实现"添加 Issue"编辑器功能（需求 11）。这就是补充 1 所问的跨包引用：UI 包可以引用任何 Host Remote 服务，而不仅限于最初构建时关联的服务。

`dsh-telemetry` 服务**不**从 UI 直接引用——它仅为主机端服务。UI 通过 `memo/analyzeLogs` 间接读取遥测数据，该方法内部调用 `telemetry.analyzeForPlugin()` 并将结果返回给客户端。

## 控制器方法

| 方法 | 服务 | 行为 |
|---|---|---|
| `refresh()` | memo | 通过 `listWeeks` 加载周列表，最新优先。 |
| `addEntry(content)` | memo | 调用 `getOrCreateCurrentWeek` 然后 `addEntry`，类型为 `text`。 |
| `updateEntry(weekId, entryId, content, force)` | memo | 更新条目；历史周需要 `force=true`（需求 3）。 |
| `deleteEntry(weekId, entryId, force)` | memo | 删除条目；历史周需要 `force=true`（需求 3）。 |
| `selectWeek(index)` | — | 从历史列表中选择一周（需求 3）。 |
| `analyze(type, period)` | memo | 对一个周期内的条目运行 AI 分析（梳理/总结/分析）（需求 4）。 |
| `exportReport(period)` | memo | 导出 Markdown 报告并触发 `.md` 下载（需求 6）。 |
| `optimizeIssue(description)` | githubIssue | 将自然语言问题描述优化为结构化报告（需求 11）。 |
| `analyzeLogs()` | memo | 读取遥测失败记录并生成带预填 URL 的 GitHub issue 报告（需求 8、9）。 |
| `openUrl(url)` | — | 在新标签页中打开 URL（需求 9：预填 issue 页）。 |

## UI 功能

- **文本录入**，带添加按钮（需求 1）
- **历史周选择器**，带历史周标记（需求 2、3）
- **条目编辑/删除**，历史周需通过提权确认对话框（需求 3）
- **周期选择器**（周/月/季度/年），用于分析和导出（需求 4）
- **AI 分析**按钮：梳理、总结、分析（需求 4）
- **报告导出**，自动下载 `.md` 文件（需求 6）
- **日志分析**按钮：从遥测数据生成 GitHub issue 报告（需求 8）
- **打开预填 Issue** 按钮：跳转到 GitHub 并预填报告（需求 9）
- **添加 Issue 编辑器**：自然语言输入 + LLM 优化 + GitHub 打开（需求 11）

## Bundle 层

该包包含在 `dsh-memo` bundle 的 `cordis.patch.yml` 中，作为 `ui-memo` 行。无需单独 bundle。

## 已知限制

- **仅文本录入** — 当前 UI 支持文本条目；图片和文件附件类型在后端已有定义，但尚未接入 UI。
- **侧边栏 DOM 注入** — DSH 侧边栏未为外部插件提供插槽，因此侧边栏入口按钮通过 MutationObserver 注入。
