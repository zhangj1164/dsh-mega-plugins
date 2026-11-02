# @zhangj1164/dsh-github-issue

[English](README.md) | 中文

DSH 的 GitHub issue 生成与优化服务。从遥测分析构建结构化 issue 报告、生成预填 issue 创建 URL，并使用配置的模型优化自然语言 issue 描述；同时打通接单闭环：经 GitHub API 直接建单、拉取带接单标签的 issue，并在本地日期首次启动时把其中一个交给新会话。

## 插件

`GithubIssueService extends TypertRemoteService`，`static inject = ['llm']`。服务通过 `ctx.get('llm')` 调用模型，暴露七个可由客户端 UI 直接调用的 Remote 方法。

| 配置 | 默认值 | 含义 |
|---|---|---|
| `repoUrl` | `https://github.com/zhangj1164/dsh-mega-plugins` | 请求未提供 `repoUrl` 时使用的默认仓库 URL。 |
| `maxPrefillUrlLength` | `7000` | 生成的预填 issue URL 长度上限（字符）。GitHub 对过长的请求 URL 不打开新建 issue 表单而是返回错误页，且未公开稳定的边界常量，因此该值留有余量并可由部署方调整。`0` 表示不截断。 |
| `prefillTruncationNote` | 一段中文说明 | URL 需要缩短时追加到 issue 正文末尾，让读者知道正文是部分内容。 |
| `provider` | 未设置 | 模型调用的 provider 路由。未设置时跟随部署的 `agentDefaultModel` 选择，因此部署方仅通过 `cordis.yml` 就能把 issue 生成固定到某条路由。 |
| `model` | 未设置 | 模型调用的 model id。未设置时与 `provider` 采用同一回退。 |
| `tokenEnv` | `GITHUB_TOKEN` | `token` 未设置时读取 GitHub token 的环境变量名。空名称表示停用该查找。 |
| `token` | 未设置 | 显式 GitHub token。由部署自行管理密钥时设置；优先级高于环境变量与命令。 |
| `tokenCommand` | `gh auth token` | 标准输出即 token 的命令。仅在 `token` 与环境变量都没有提供时执行，且每个进程最多一次。默认复用 `gh` CLI 已保存的凭据，因此已登录 GitHub 的机器无需额外密钥；设为空字符串可停用该查找。 |
| `tokenCommandTimeoutMs` | `10000` | `tokenCommand` 的超时（毫秒）。 |
| `apiBaseUrl` | `https://api.github.com` | GitHub REST 源。GitHub Enterprise 部署设置自己的 `https://host/api/v3`。 |
| `requestTimeoutMs` | `15000` | 单次 GitHub REST 请求的超时（毫秒）。 |
| `claimLabel` | `ready-for-agent` | 标记「可接单」的标签。取值的归属是仓库的分诊词汇表；本字段只决定哪个标签算数。 |
| `maxIssuesPerRun` | `3` | 一次接单最多派发的 issue 数。 |
| `autopilotEnabled` | `false` | 是否在本地日期首次启动时检查可接单 issue。默认关闭：未经请求就打开会话是部署决定，而不是插件安装时替用户做的决定。 |
| `autopilotCwd` | 空 | 派发会话的工作目录。空值跟随宿主默认目录。 |
| `autopilotPreset` | 空 | 派发会话使用的 agent preset。空值跟随部署默认。 |
| `autopilotTimeZone` | 空 | 判定「今天」所用的 IANA 时区。空值跟随宿主自身时区，因此用户的本地午夜才是新一天的开始。 |
| `autopilotPrompt` | 内置模板 | 交给每个派发会话的提示词模板。占位符 `{number}`、`{title}`、`{url}`、`{body}`、`{labels}` 会被替换；未知占位符保留原样可见。 |

## Remote 方法

| 方法 | 行为 |
|---|---|
| `generateReport(request)` | 使用内置结构化提示词调用模型，从遥测失败分析生成统一的 GitHub issue 报告。返回包含标题、正文和标签的 `GithubIssueReport`。请求用 `pluginIds` 说明它覆盖哪些插件——一份报告覆盖整个套件——并携带分析时间窗，以及每组的路由、最近一次失败时间和之后的尝试次数；每组字段都可选，缺省时会以 `not recorded` 传给模型，而不是省略。 |
| `prefilledIssueUrl(request)` | 从报告构建预填 GitHub issue 创建 URL。校验仓库 URL；失败时返回 `invalid-url`。当拼装出的 URL 超过 `maxPrefillUrlLength` 时缩短正文——标题与标签占用同一份额度，百分号编码还会放大它，因此判定基于 URL 而不是仅基于正文长度。 |
| `optimizeIssue(request)` | 将自然语言描述重写为按固定 Markdown 模板组织的 issue。空描述返回 `empty-input`，无路由可解析时返回 `route-missing`，模型调用失败返回 `llm-failure`。 |
| `createIssue(request)` | 经 GitHub REST API 直接建单，返回新 issue 的 `{ number, url }`。正文写入时会去掉首行的 `## 标题`，因为 GitHub 把标题作为独立字段。 |
| `listClaimableIssues(request)` | 列出带接单标签的 open issue，并排除 PR——GitHub 的 issue 端点也会返回 PR。 |
| `dispatchIssue(request)` | 经 Session 控制器新建一个会话，把渲染后的提示词排进它的 Agent，并给会话命名；返回 `sessionId`。 |
| `runIntake(request)` | 执行一次接单：列出可接单 issue，跳过此前已派发的，派发其余，并把本地日期持久化。 |

接单方法只报一个稳定的失败码，而不是原始的 `fetch` 错误：`auth-missing`、`auth-failure`、`rate-limited`、`invalid-repo`、`invalid-request`、`http-failure`、`network-failure`、`session-unavailable`、`dispatch-failed`。`auth-missing` 与 `auth-failure` 分开，是因为「没有凭据」和「凭据被拒绝」是两种部署问题，修法不同。

## 模型路由

两个会调用模型的方法都按与 memo 服务相同的方式解析路由：请求里的 `provider`/`model`，其次本服务的 `Config`，最后部署的 `agentDefaultModel` 选择。因此请求里的这两个字段是可选的，客户端 UI 只在用户显式选择模型时才发送——浏览器无需为了调用成功而发布路由。

空字符串按「未提供」处理而不是当作取值，这样省略的字段仍能落到部署默认值，而不会以不可用的路由发往模型。当各处都解析不出路由时，调用返回 `route-missing`，并且**不会发起任何模型调用**：没有适配器的调用不可能成功，把它报成 `llm-failure` 等于用模型的名义解释路由问题。

## 失败事实

失败的调用会保留 DSH 报告的内容，而不是折叠成一条消息。`llm-failure` 的消息里带着机器路由码与路由——`model call to provider "custom" model "glm-5-2-260617" failed: NO_ADAPTER: no adapter registered for provider "custom"`——因此 `NO_ADAPTER`（本部署未注册的路由）、`AUTH`、`RATE_LIMIT` 与 `EMPTY_RESPONSE`（模型确实没有产出文本）之间仍然可区分。把它们一律报成「模型没有输出」，正是让用户在从未到达模型的请求里去找模型问题的原因。

流本身抛出传输错误而不是产出终止 `finish` 块时，报为 `LLM_STREAM_THREW`，而不是让异常逃逸出调用。

## 遥测

两个会调用模型的方法在部署装有遥测服务时都会上报，没有时行为完全相同。该服务通过 `ctx.get('telemetry')` 读取，并**刻意不**写进 `static inject`：本包可以单独作为 bundle 安装，诊断依赖绝不能成为服务拒绝激活的理由。

| 事件 | 记录内容 |
|---|---|
| 成功的调用 | 动作 `optimizeIssue` / `generateReport`，`success`，并带上服务本次调用的路由 |
| 失败的调用 | 保留的 DSH 码、消息与 HTTP 状态、路由，以及 `github-issue:<action>` 特性锚点 |
| 无法解析路由的调用 | 码 `NO_MODEL_ROUTE`——与 `@zhangj1164/dsh-memo` 对同一情形使用的码一致，因此一份报告可以把两个包归到一起 |

`generateReport` 还会记录它拿到的分析属于哪个插件。只记录成功的调用能回答「这些调用走的哪条路由」，却回答不了「那条路由在其出错之后是否已经变了」，所以两半都要记。

## Issue 报告模板

`generateReport` 和 `optimizeIssue` 均使用内置系统提示词，固定统一的 Markdown 结构。首行始终是 `## ` 标题，用作 issue 标题。模板包含插件、操作、预期/实际行为、路由与时间，以及复现步骤等部分。

`generateReport` 会收到分析时间窗，以及每组的失败路由、最近一次失败时间和之后的同动作尝试次数。它的系统提示词要求陈述这些事实，禁止提出分析未提供证据的机制——采样参数、token 预算、超时、分块与响应解析被点名为反例——并要求分析未携带的事实写作 `not recorded`。它也明确禁止写「需要补充采集」：缺失的事实既可能是旧事件，也可能是采集缺口，报告无从区分。

## Issue 接单闭环

闭环有三步，本插件负责后两步。用户用自然语言描述问题，`optimizeIssue` 把它变成固定模板的报告，`createIssue` 直接建单。这一步替换掉闭环原本停住的地方：预填 URL 仍然要用户打开表单并按下提交，任何东西都无法自动接住这个 issue。

`runIntake` 随后读取带 `claimLabel` 的 issue，并把每个交给一个新会话。派发走 Session 控制器而不是直接走 Agent 注册表，这样派发出来的会话与用户在 Web 里新建的会话拿到相同的 preset 与工作区策略；提示词经 Agent 的 `followup` 排入，它会唤醒驱动，而不需要别处已经有一个打开的 turn。命名是尽力而为：没有挂载标题服务的部署依然得到一个可用的会话。

凭据每个进程只解析一次，顺序是 `token`、`tokenEnv`、`tokenCommand`。默认命令是 `gh auth token`，因此已经登录 GitHub 的机器不需要额外密钥；自行管理密钥的部署设置 `token` 并用空字符串停用命令。token 永远不会被记录到日志。

### 每天首次启动

`autopilotEnabled` 打开后，宿主启动时每个本地日期执行一次检查。本地日期从 storage-domain 的持久状态读取，因此同一天稍后重启什么也不做，已派发的 issue 永不再次派发——它的会话已经存在，再来一个只会重复劳动。只有列取成功后才提交日期，所以连不上 GitHub 的那次会在下次启动重试，而不会被记成已完成。

检查需要持久状态，没有就拒绝运行：没有「派发过什么」的记忆，重启会为同一个 issue 打开第二个会话。它也默认关闭，因为未经请求就打开会话是部署决定，而不是插件安装时自带的行为。

```yaml
# 你的 cordis.yml，或你自己 bundle 的 patch
- insert:
    - id: github-issue
      name: @zhangj1164/dsh-github-issue
      config:
        repoUrl: https://github.com/your-org/your-repo
        autopilotEnabled: true
        autopilotCwd: /path/to/your-repo
        claimLabel: ready-for-agent
```

宿主必须在运行，检查才可能发生；没有启动的一天就没有检查。这是有意的行为——检查是启动钩子，不是调度器——Automation tasks 页面仍然是查看和管理会话自身创建的提醒的地方。

## 需求映射

- **需求 8** — `generateReport` 将遥测失败分析转化为统一的 GitHub issue 报告，将每个失败组与插件功能代码关联。
- **需求 9** — `prefilledIssueUrl` 构建预填的 GitHub issue 创建 URL，用户可直接跳转到项目的新建 issue 页面，报告已预填。
- **需求 10** — 封装为独立的 DSH 插件：此包自带 `dsh.bundle` 与 `cordis.patch.yml`，部署方可以单独安装，任何 UI 插件都能接入。见下文「接入本插件」。
- **需求 11** — `optimizeIssue` 使用配置的模型和内置的结构化提示词，将自然语言描述重写为结构化 issue。`ui-memo` 包直接调用此方法实现"添加 Issue"编辑器。
- **需求 12** — 可复用：issue 报告模板、预填 URL 构建器和优化提示词都是通用的，不特定于备忘功能。
- **需求 13** — `createIssue` 经 GitHub API 直接提交整理好的报告，于是「整理 issue」与「填写 issue」合成一步，而不是一个必须由用户提交的表单。
- **需求 14** — `runIntake` 与首次启动检查闭合了环路：可接单 issue 无需用户手动打开就变成一个会话，且已派发的 issue 不会被派发两次。

## 接入本插件

安装该包，并把它加进你的部署组合：

```sh
pnpm add @zhangj1164/dsh-github-issue
```

```yaml
# 你的 cordis.yml，或你自己 bundle 的 patch
- insert:
    - id: github-issue
      name: @zhangj1164/dsh-github-issue
      config:
        repoUrl: https://github.com/your-org/your-repo
```

任何插件都可以通过 `ctx.get('githubIssue')` 读取该服务。从消费者角度看它是可选的，因此请做存在性判断：

```ts
const issues = ctx.get('githubIssue')
if (issues !== undefined) {
  const { report } = await issues.generateReport({ analysis, repoUrl })
}
```

该服务不依赖 `@zhangj1164/dsh-memo`；备忘只是可能的消费者之一。

本 bundle 是 `github-issue` 这个条目 id 的唯一归属方。`@zhangj1164/dsh-memo` 注入该服务，但不插入这一行，因此独立 bundle 与备忘套件可以无冲突地组合，`pnpm run verify-bundle-entries` 也找不到任何重叠。备忘部署因此需要点名整套：

```sh
dsh plugin --profile web add @zhangj1164/dsh-telemetry @zhangj1164/dsh-github-issue @zhangj1164/dsh-memo @zhangj1164/dsh-client-ui-memo
```

`@zhangj1164/dsh-github-issue` 要点名安装，而不是作为 peer 被带入：profile 设置了 `autoInstallPeers: false`，安装只引入命令点名的包，只装 `@zhangj1164/dsh-memo` 会让这一行无法解析。

## 导出

每个子路径都指向 tsdown 产出的扁平 `lib/*.js` 布局。

| 子路径 | 内容 |
|---|---|
| `@zhangj1164/dsh-github-issue` | `GithubIssueService` 插件及其 Config。 |
| `@zhangj1164/dsh-github-issue/types` | 线上类型：`GithubIssueReport`、请求与结果结构。 |
| `@zhangj1164/dsh-github-issue/client` | 面向浏览器端的类型面。 |
| `@zhangj1164/dsh-github-issue/invariant` | 不变量定义。 |

## 已知限制

- **模型依赖** — `inject: ['llm']` 意味着服务在没有 LLM 提供方时不会激活。
- **自身没有浏览器界面** — 本包不注册模型工具，也不附带浏览器 UI。单独安装只会给部署带来 `ctx.get('githubIssue')`，用户看不到也点不到任何东西；可见的入口是 `@zhangj1164/dsh-client-ui-memo` 的 issue 编辑器（其「直接提交到 GitHub」按钮）与日志分析动作，它们经 Remote 调用本服务。请把它当作供 UI 插件消费的后端，而不是一个能独立使用的功能。
- **派发需要 Web 组合** — `dispatchIssue` 与 `runIntake` 读取 `ctx.get('sessionController')` 与 `ctx.get('agents')`。两者都没挂载的 headless 或纯 SDK 组合会返回 `session-unavailable`，只能建单和列取。
- **首次启动检查是启动钩子，不是调度器** — 它只在宿主启动时运行。跨过午夜仍保持运行的部署会在下一次启动时检查，而不是在午夜检查。
