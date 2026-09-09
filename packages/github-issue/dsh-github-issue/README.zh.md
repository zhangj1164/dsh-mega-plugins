# dsh-github-issue

[English](README.md) | 中文

DSH 的 GitHub issue 生成与优化服务。从遥测分析构建结构化 issue 报告、生成预填 issue 创建 URL，并使用配置的模型优化自然语言 issue 描述。

## 插件

`GithubIssueService extends TypertRemoteService`，`static inject = ['llm']`。服务通过 `ctx.get('llm')` 调用模型，暴露三个可由客户端 UI 直接调用的 Remote 方法。

| 配置 | 默认值 | 含义 |
|---|---|---|
| `repoUrl` | `https://github.com/zhangj1164/dsh-mega-plugins` | 请求未提供 `repoUrl` 时使用的默认仓库 URL。 |

## Remote 方法

| 方法 | 行为 |
|---|---|
| `generateReport(request)` | 使用内置结构化提示词调用模型，从遥测失败分析生成统一的 GitHub issue 报告。返回包含标题、正文和标签的 `GithubIssueReport`。 |
| `prefilledIssueUrl(request)` | 从报告构建预填 GitHub issue 创建 URL。校验仓库 URL；失败时返回 `invalid-url`。 |
| `optimizeIssue(request)` | 将自然语言描述重写为按固定 Markdown 模板组织的 issue。空描述返回 `empty-input`，模型无输出返回 `llm-failure`。 |

## Issue 报告模板

`generateReport` 和 `optimizeIssue` 均使用内置系统提示词，固定统一的 Markdown 结构。首行始终是 `## ` 标题，用作 issue 标题。模板包含插件、操作、预期/实际行为和复现步骤等部分。

## 需求映射

- **需求 8** — `generateReport` 将遥测失败分析转化为统一的 GitHub issue 报告，将每个失败组与插件功能代码关联。
- **需求 9** — `prefilledIssueUrl` 构建预填的 GitHub issue 创建 URL，用户可直接跳转到项目的新建 issue 页面，报告已预填。
- **需求 10** — 封装为独立的 DSH 插件：任何开发者都可以安装 `dsh-github-issue` profile 并接入自己的 UI 插件。memo bundle 的 `cordis.patch.yml` 将其作为普通依赖插入。
- **需求 11** — `optimizeIssue` 使用配置的模型和内置的结构化提示词，将自然语言描述重写为结构化 issue。`ui-memo` 包直接调用此方法实现"添加 Issue"编辑器。
- **需求 12** — 可复用：issue 报告模板、预填 URL 构建器和优化提示词都是通用的，不特定于备忘功能。

## 已知限制

- **无 bundle 层** — 此包不声明 `dsh.bundle`；作为普通依赖安装，由 memo bundle 的 `cordis.patch.yml` 激活。
- **模型依赖** — `inject: ['llm']` 意味着服务在没有 LLM 提供方时不会激活。
