# dsh-mega-plugins

[English](README.md) | 中文

四个 DSH 插件，提供本地存储和 AI 分析的个人备忘管理功能，以 pnpm monorepo 形式开发。

## 包

- **@zhangj1164/dsh-telemetry**（`packages/telemetry/dsh-telemetry`）— 基于 storage-domain KV 后端的通用本地遥测跟踪器（需求 7）。
- **@zhangj1164/dsh-github-issue**（`packages/github-issue/dsh-github-issue`）— 使用 LLM 的 GitHub issue 生成与优化服务（需求 8、9、10、11）。
- **@zhangj1164/dsh-memo**（`packages/memo/dsh-memo`）— 按周组织的个人备忘服务，支持 AI 分析、报告导出和遥测记录（需求 1–6、8）。
- **@zhangj1164/dsh-client-ui-memo**（`packages/client/ui-memo`）— 浏览器端 UI 面板，支持备忘录入、分析、报告下载、日志分析和 Issue 编辑（需求 1–4、6、8、9、11）。

## 命令

```sh
pnpm install                          # 安装所有工作区依赖
pnpm run build                        # 构建所有包（tsdown）
pnpm run test                         # 运行所有 vitest 测试
pnpm run gates                        # 完整门禁：构建 + 测试 + 代码规范 + 文档同步
pnpm run verify-translation-pairing   # 校验双语 README 一致性（6 对）
```

## 安装到 DSH profile

`@zhangj1164/dsh-telemetry`、`@zhangj1164/dsh-github-issue` 与 `@zhangj1164/dsh-memo` 各自声明 `dsh.bundle`，且每个组合条目 id 只有一个归属 bundle。子集与整套一样可以正常组合，因此按需点名即可：

```sh
# 完整备忘套件（遥测 + issue 服务 + 备忘 + 浏览器面板）
dsh plugin --profile web add @zhangj1164/dsh-telemetry @zhangj1164/dsh-github-issue @zhangj1164/dsh-memo @zhangj1164/dsh-client-ui-memo

# 只装通用遥测服务，供其他插件消费
dsh plugin --profile web add @zhangj1164/dsh-telemetry
```

`@zhangj1164/dsh-client-ui-memo` 自己不声明 bundle：`@zhangj1164/dsh-memo` 的 patch 会插入它的 `ui-memo` 行，因此面板随 `@zhangj1164/dsh-memo` 一起激活——但包本身仍须点名，且 `dsh plugin add` 会把它报告为普通依赖而非 profile layer。对 `dsh.client` 插件而言这条提示是预期行为，不是缺陷。

凡是启动所需的行或其注入服务所属的包，都必须点名。profile 设置了 `autoInstallPeers: false`，安装只引入命令点名的包——只装 `@zhangj1164/dsh-memo` 会让 `github-issue` 与 `ui-memo` 两行无法解析，加载器随之让启动失败。

`@zhangj1164/dsh-telemetry` 与 `@zhangj1164/dsh-github-issue` 暴露的是 Cordis 服务（`ctx.telemetry`、`ctx.githubIssue`），而不是模型工具或面板。它们属于基础设施：单独装 `@zhangj1164/dsh-telemetry` 只是给消费方插件提供可调用的能力，终端用户看不到任何界面。可见界面是备忘看板。

## 工作区结构

```
packages/
  telemetry/dsh-telemetry/        # @zhangj1164/dsh-telemetry（独立 bundle：`telemetry` 行）
  github-issue/dsh-github-issue/  # @zhangj1164/dsh-github-issue（独立 bundle：`github-issue` 行）
  memo/dsh-memo/                  # @zhangj1164/dsh-memo（bundle：`memo` + `ui-memo` 行；注入上述两个服务）
  client/ui-memo/                 # @zhangj1164/dsh-client-ui-memo（dsh.client 插件，无 bundle；由 @zhangj1164/dsh-memo 插入）
```

`pnpm-workspace.yaml` 声明 `packages/*/*` — 与 DSH monorepo 的 `packages/<group>/<pkg>` 约定一致。
