# dsh-mega-plugins

[English](README.md) | 中文

六个 DSH 插件，以 pnpm monorepo 形式开发：本地存储、带 AI 分析的个人备忘套件及其设置页，以及面向 Web 右侧边栏的 OpenWiki 预览。

## 包

- **@zhangj1164/dsh-telemetry**（`packages/telemetry/dsh-telemetry`）— 基于 storage-domain KV 后端的通用本地遥测跟踪器（需求 7）。
- **@zhangj1164/dsh-github-issue**（`packages/github-issue/dsh-github-issue`）— 使用 LLM 的 GitHub issue 生成与优化服务（需求 8、9、10、11）。
- **@zhangj1164/dsh-memo**（`packages/memo/dsh-memo`）— 按周组织的个人备忘服务，支持 AI 分析、报告导出和遥测记录（需求 1–6、8）。
- **@zhangj1164/dsh-client-ui-memo**（`packages/client/ui-memo`）— 浏览器端 UI 面板，支持备忘录入、分析、报告下载、日志分析和 Issue 编辑（需求 1–4、6、8、9、11）。
- **@zhangj1164/dsh-client-ui-memo-settings**（`packages/client/ui-memo-settings`）— 备忘套件的设置页：在 DSH Web 里编辑备忘宿主的 AI 路由、归档会话总结文案和 GitHub 仓库，每次保存都无需重启即可生效。
- **@zhangj1164/dsh-openwiki-visualize**（`packages/openwiki/dsh-openwiki-visualize`）— 检测当前工作区的 OpenWiki，用 `openwiki visualize` 在回环地址提供服务，并将官方阅读器嵌入自有右侧边栏标签页，同时提供 openwiki/DSH 环境检查与插件自更新。

## 命令

```sh
pnpm install                          # 安装所有工作区依赖
pnpm run build                        # 构建所有包（tsdown）
pnpm run test                         # 运行所有 vitest 测试
pnpm run gates                        # 完整门禁：构建 + 测试 + 代码规范 + 文档同步
pnpm run verify-translation-pairing   # 校验双语 README 一致性（7 对）
```

## 安装到 DSH profile

`@zhangj1164/dsh-telemetry`、`@zhangj1164/dsh-github-issue`、`@zhangj1164/dsh-memo` 与 `@zhangj1164/dsh-client-ui-memo-settings` 各自声明 `dsh.bundle`，且每个组合条目 id 只有一个归属 bundle。子集与整套一样可以正常组合，因此按需点名即可：

```sh
# 完整备忘套件（遥测 + issue 服务 + 备忘 + 浏览器面板 + 设置页）
dsh plugin --profile web add @zhangj1164/dsh-telemetry @zhangj1164/dsh-github-issue @zhangj1164/dsh-memo @zhangj1164/dsh-client-ui-memo-settings

# 只装通用遥测服务，供其他插件消费
dsh plugin --profile web add @zhangj1164/dsh-telemetry
```

启动所需的每个 bundle 都要点名。profile 设置了 `autoInstallPeers: false`，因此安装只引入命令点名的包及其依赖，永远不会带入 peer 依赖。备忘面板就是其中一个依赖：`@zhangj1164/dsh-client-ui-memo` 随 `@zhangj1164/dsh-memo` 一起装上，不需要点名。只装 `@zhangj1164/dsh-memo` 仍会让 `github-issue` 行无法解析——`memo (@zhangj1164/dsh-memo): pending (waiting for service: githubIssue)`——因为该服务属于它自己的 bundle。

`@zhangj1164/dsh-client-ui-memo` 自己不声明 bundle。`@zhangj1164/dsh-memo` 的 patch 会插入它的 `ui-memo` 行，并且本包依赖它，因此安装备忘服务就装上面板并激活它；`dsh plugin add` 会把没有 `dsh.bundle` 的包报告为普通依赖而非 profile layer，对 `dsh.client` 插件而言这条提示是预期行为，不是缺陷。这里刻意声明为普通依赖而不是 peer：profile 从不安装 peer，把它声明为 peer 的那个版本正是让该行未激活、侧边栏没有「备忘」的原因（[#194](https://github.com/zhangj1164/dsh-mega-plugins/issues/194)）。面板自己保留着对备忘宿主的 peer，因此 pnpm 会在安装时报告循环 workspace 依赖；没有任何构建或启动依赖该顺序。`@zhangj1164/dsh-client-ui-memo-settings` 则刻意不同：它自带 bundle patch，插入 `ui-memo-settings` 行，因此作为 profile layer 安装，可以独立增删而不必改备忘 bundle。它的页面只在已部署的备忘宿主提供 `memo` 设置命名空间时注册，所以没装备忘套件时装上它不会留下任何可见痕迹。

`@zhangj1164/dsh-telemetry` 与 `@zhangj1164/dsh-github-issue` 暴露的是 Cordis 服务（`ctx.telemetry`、`ctx.githubIssue`），而不是模型工具或面板。它们属于基础设施：单独装 `@zhangj1164/dsh-telemetry` 只是给消费方插件提供可调用的能力，终端用户看不到任何界面。可见界面是备忘看板。

### 从 GitHub 安装（不经过注册表）

这些包可以不经任何注册表发布，直接从本仓库安装。pnpm 用 **committish** 里的 `path:` 参数选中仓库内的某个包，也就是写在 `#` 之后——pnpm 把它当作 ref 的一部分，因此把 `&path:` 写在仓库 URL 上会被默默当成仓库名的一部分，拉取随之失败：

```sh
dsh plugin --profile web add \
  "github:zhangj1164/dsh-mega-plugins#path:packages/telemetry/dsh-telemetry" \
  "github:zhangj1164/dsh-mega-plugins#path:packages/github-issue/dsh-github-issue" \
  "github:zhangj1164/dsh-mega-plugins#path:packages/memo/dsh-memo" \
  "github:zhangj1164/dsh-mega-plugins#path:packages/client/ui-memo-settings"
```

当被测改动属于浏览器侧时，再加一条 `"github:zhangj1164/dsh-mega-plugins#path:packages/client/ui-memo"`。不加也能装成功：从 git 读到的 manifest 保留普通范围，备忘 bundle 会从注册表取面板作为其依赖。点名该路径则把面板钉到同一个检出，面板改动需要这一点。

git 安装取的是源码而不是构建产物，因此每个包的 `prepare` 脚本会在安装过程中构建出 `lib/`。pnpm ≥10 在 profile 授权之前不会执行该脚本：首次 `add` 会以 `ERR_PNPM_GIT_DEP_PREPARE_NOT_ALLOWED` 失败，并打印出确切的 `allowBuilds` 键。该键带有解析到的 commit，下一次推送之后就不再匹配。请改用仓库级形式（对任意 commit 都生效），写入 `${DSH_HOME}/profiles/web/pnpm-workspace.yaml`：

```yaml
allowBuilds:
  '@zhangj1164/dsh-telemetry@git+https://github.com/zhangj1164/dsh-mega-plugins.git': true
  '@zhangj1164/dsh-github-issue@git+https://github.com/zhangj1164/dsh-mega-plugins.git': true
  '@zhangj1164/dsh-memo@git+https://github.com/zhangj1164/dsh-mega-plugins.git': true
  '@zhangj1164/dsh-client-ui-memo@git+https://github.com/zhangj1164/dsh-mega-plugins.git': true
  '@zhangj1164/dsh-client-ui-memo-settings@git+https://github.com/zhangj1164/dsh-mega-plugins.git': true
```

这项授权意味着允许该包的代码在安装时于你的机器上执行，且不在任何 agent 沙箱之内。只对可信来源授权；当已安装内容必须停止漂移时请锁定 commit——`github:zhangj1164/dsh-mega-plugins#<sha>&path:packages/memo/dsh-memo`，ref 与 `path:` 之间用 `&` 连接。

注册表仍是更好的默认选择：已发布的包直接提供构建好的 `lib/`，完全不需要构建授权。git 安装还会在兄弟 `peerDependencies` 中保留 `workspace:^`，因为 pnpm 直接读取 checkout 里的 manifest，没有任何环节会改写它；pnpm 会为此打印一条 peer 警告，而启动不受影响：profile 已经点名启动所需的每个包，并设置了 `autoInstallPeers: false`，这些范围没有需要解析的对象。出于同一原因，唯一必须随包安装的依赖——备忘 bundle 的面板——使用普通范围，把它写成 `workspace:` 会让这类安装以 `ERR_PNPM_WORKSPACE_PKG_NOT_FOUND` 失败。

## 工作区结构

```
packages/
  telemetry/dsh-telemetry/        # @zhangj1164/dsh-telemetry（独立 bundle：`telemetry` 行）
  github-issue/dsh-github-issue/  # @zhangj1164/dsh-github-issue（独立 bundle：`github-issue` 行）
  memo/dsh-memo/                  # @zhangj1164/dsh-memo（bundle：`memo` + `ui-memo` 行；注入上述两个服务）
  client/ui-memo/                 # @zhangj1164/dsh-client-ui-memo（dsh.client 插件，无 bundle；由 @zhangj1164/dsh-memo 插入）
  client/ui-memo-settings/        # @zhangj1164/dsh-client-ui-memo-settings（dsh.client 插件 + 自有 bundle：`ui-memo-settings` 行）
  openwiki/dsh-openwiki-visualize/ # @zhangj1164/dsh-openwiki-visualize（自有 bundle：`openwiki-visualize` 行；同时包含主机服务与其 dsh.client 浏览器端）
```

`pnpm-workspace.yaml` 声明 `packages/*/*` — 与 DSH monorepo 的 `packages/<group>/<pkg>` 约定一致。
