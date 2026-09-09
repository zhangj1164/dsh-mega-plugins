# dsh-mega-plugins

[English](README.md) | 中文

四个 DSH 插件，提供本地存储和 AI 分析的个人备忘管理功能，以 pnpm monorepo 形式开发。

## 包

- **dsh-telemetry**（`packages/telemetry/dsh-telemetry`）— 基于 storage-domain KV 后端的通用本地遥测跟踪器（需求 7）。
- **dsh-github-issue**（`packages/github-issue/dsh-github-issue`）— 使用 LLM 的 GitHub issue 生成与优化服务（需求 8、9、10、11）。
- **dsh-memo**（`packages/memo/dsh-memo`）— 按周组织的个人备忘服务，支持 AI 分析、报告导出和遥测记录（需求 1–6、8）。
- **dsh-client-ui-memo**（`packages/client/ui-memo`）— 浏览器端 UI 面板，支持备忘录入、分析、报告下载、日志分析和 Issue 编辑（需求 1–4、6、8、9、11）。

## 命令

```sh
pnpm install                          # 安装所有工作区依赖
pnpm run build                        # 构建所有包（tsdown）
pnpm run test                         # 运行所有 vitest 测试
pnpm run gates                        # 完整门禁：构建 + 测试 + 代码规范 + 文档同步
pnpm run verify-translation-pairing   # 校验双语 README 一致性（6 对）
```

## 工作区结构

```
packages/
  telemetry/dsh-telemetry/        # dsh-telemetry（独立 bundle）
  github-issue/dsh-github-issue/  # dsh-github-issue（普通依赖，无 bundle）
  memo/dsh-memo/                  # dsh-memo（bundle；依赖上面两个包）
  client/ui-memo/                 # dsh-client-ui-memo（UI 面板；依赖 dsh-memo + dsh-github-issue）
```

`pnpm-workspace.yaml` 声明 `packages/*/*` — 与 DSH monorepo 的 `packages/<group>/<pkg>` 约定一致。
