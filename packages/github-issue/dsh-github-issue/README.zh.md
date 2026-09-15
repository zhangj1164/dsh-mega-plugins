# dsh-github-issue

[English](README.md) | 中文

DSH 的 GitHub issue 生成与优化服务。从遥测分析构建结构化 issue 报告、生成预填 issue 创建 URL，并使用配置的模型优化自然语言 issue 描述。

## 插件

`GithubIssueService extends TypertRemoteService`，`static inject = ['llm']`。服务通过 `ctx.get('llm')` 调用模型，暴露三个可由客户端 UI 直接调用的 Remote 方法。

| 配置 | 默认值 | 含义 |
|---|---|---|
| `repoUrl` | `https://github.com/zhangj1164/dsh-mega-plugins` | 请求未提供 `repoUrl` 时使用的默认仓库 URL。 |
| `maxPrefillUrlLength` | `7000` | 生成的预填 issue URL 长度上限（字符）。GitHub 对过长的请求 URL 不打开新建 issue 表单而是返回错误页，且未公开稳定的边界常量，因此该值留有余量并可由部署方调整。`0` 表示不截断。 |
| `prefillTruncationNote` | 一段中文说明 | URL 需要缩短时追加到 issue 正文末尾，让读者知道正文是部分内容。 |
| `provider` | 未设置 | 模型调用的 provider 路由。未设置时跟随部署的 `agentDefaultModel` 选择，因此部署方仅通过 `cordis.yml` 就能把 issue 生成固定到某条路由。 |
| `model` | 未设置 | 模型调用的 model id。未设置时与 `provider` 采用同一回退。 |

## Remote 方法

| 方法 | 行为 |
|---|---|
| `generateReport(request)` | 使用内置结构化提示词调用模型，从遥测失败分析生成统一的 GitHub issue 报告。返回包含标题、正文和标签的 `GithubIssueReport`。请求携带分析时间窗，以及每组的路由、最近一次失败时间和之后的尝试次数；这些字段都可选，缺省时会以 `not recorded` 传给模型，而不是省略。 |
| `prefilledIssueUrl(request)` | 从报告构建预填 GitHub issue 创建 URL。校验仓库 URL；失败时返回 `invalid-url`。当拼装出的 URL 超过 `maxPrefillUrlLength` 时缩短正文——标题与标签占用同一份额度，百分号编码还会放大它，因此判定基于 URL 而不是仅基于正文长度。 |
| `optimizeIssue(request)` | 将自然语言描述重写为按固定 Markdown 模板组织的 issue。空描述返回 `empty-input`，无路由可解析时返回 `route-missing`，模型调用失败返回 `llm-failure`。 |

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
| 无法解析路由的调用 | 码 `NO_MODEL_ROUTE`——与 `dsh-memo` 对同一情形使用的码一致，因此一份报告可以把两个包归到一起 |

`generateReport` 还会记录它拿到的分析属于哪个插件。只记录成功的调用能回答「这些调用走的哪条路由」，却回答不了「那条路由在其出错之后是否已经变了」，所以两半都要记。

## Issue 报告模板

`generateReport` 和 `optimizeIssue` 均使用内置系统提示词，固定统一的 Markdown 结构。首行始终是 `## ` 标题，用作 issue 标题。模板包含插件、操作、预期/实际行为、路由与时间，以及复现步骤等部分。

`generateReport` 会收到分析时间窗，以及每组的失败路由、最近一次失败时间和之后的同动作尝试次数。它的系统提示词要求陈述这些事实，禁止提出分析未提供证据的机制——采样参数、token 预算、超时、分块与响应解析被点名为反例——并要求分析未携带的事实写作 `not recorded`。它也明确禁止写「需要补充采集」：缺失的事实既可能是旧事件，也可能是采集缺口，报告无从区分。

## 需求映射

- **需求 8** — `generateReport` 将遥测失败分析转化为统一的 GitHub issue 报告，将每个失败组与插件功能代码关联。
- **需求 9** — `prefilledIssueUrl` 构建预填的 GitHub issue 创建 URL，用户可直接跳转到项目的新建 issue 页面，报告已预填。
- **需求 10** — 封装为独立的 DSH 插件：此包自带 `dsh.bundle` 与 `cordis.patch.yml`，部署方可以单独安装，任何 UI 插件都能接入。见下文「接入本插件」。
- **需求 11** — `optimizeIssue` 使用配置的模型和内置的结构化提示词，将自然语言描述重写为结构化 issue。`ui-memo` 包直接调用此方法实现"添加 Issue"编辑器。
- **需求 12** — 可复用：issue 报告模板、预填 URL 构建器和优化提示词都是通用的，不特定于备忘功能。

## 接入本插件

安装该包，并把它加进你的部署组合：

```sh
pnpm add dsh-github-issue
```

```yaml
# 你的 cordis.yml，或你自己 bundle 的 patch
- insert:
    - id: github-issue
      name: dsh-github-issue
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

该服务不依赖 `dsh-memo`；备忘只是可能的消费者之一。

不要同时启用 `dsh-github-issue` bundle 与 `dsh-memo` bundle：两者都会插入 id 为 `github-issue` 的条目，而加载器会拒绝重复的条目 id。memo bundle 本身已经会插入该服务，因此备忘部署无需额外操作。两个 patch 文件都在该 id 上带有 `not both` 标记，仓库的 `verify-bundle-entries` 门禁要求这一点：只要某个条目 id 被一个以上的 workspace bundle 插入，除非每个相关 patch 都记录了这条互斥，否则门禁失败。

## 导出

每个子路径都指向 tsdown 产出的扁平 `lib/*.js` 布局。

| 子路径 | 内容 |
|---|---|
| `dsh-github-issue` | `GithubIssueService` 插件及其 Config。 |
| `dsh-github-issue/types` | 线上类型：`GithubIssueReport`、请求与结果结构。 |
| `dsh-github-issue/client` | 面向浏览器端的类型面。 |
| `dsh-github-issue/invariant` | 不变量定义。 |

## 已知限制

- **模型依赖** — `inject: ['llm']` 意味着服务在没有 LLM 提供方时不会激活。
