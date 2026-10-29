# @zhangj1164/dsh-openwiki-visualize

[English](README.md) | 中文

DSH Web 的 OpenWiki 预览插件：在当前工作区中定位 OpenWiki，用官方 `openwiki visualize` 阅读器在回环地址上提供服务，并将其嵌入右侧边栏，同时提供 openwiki 与 DSH 环境检查以及插件自更新。

## 功能

| 能力 | 实现方式 |
|---|---|
| 检测 OpenWiki | 读取工作区的 `openwiki/` 目录，并用阅读器自身使用的同一组标记进行判定。 |
| 提供服务 | 启动 `openwiki visualize <wiki> --port <p> --no-open`，并读取 CLI 实际绑定的端口。 |
| 嵌入预览 | 注册自己的右侧边栏标签页类型，其内容体是指向回环地址的沙箱 iframe。 |
| 检查环境 | 报告 openwiki 版本、DSH 版本，以及两者是否达到各自的配置下限。 |
| 显示版本并更新 | 展示自身版本，启动时检查一次仓库，并可按需安装最新版本。 |

## 环境要求

| 要求 | 原因 |
|---|---|
| openwiki >= 0.7.2 | 本插件嵌入的正是该阅读器的固定路由，以及它不对嵌框设限这一特性。 |
| DSH >= 0.2.1-rc.2 | 右侧边栏标签页注册表及其两阶段标签页类型契约。 |
| 工作区对应的项目已初始化 OpenWiki | 否则没有可展示的内容，请先在项目中运行 `openwiki --init`。 |
| 预览时浏览器可访问互联网 | 阅读器会从 CDN 加载 force-graph、marked、DOMPurify、Mermaid 与 Google Fonts。 |

## 安装

```sh
dsh plugin --profile web add @zhangj1164/dsh-openwiki-visualize
```

只插入一行，因为本包同时拥有两半：主机服务是插件主体，浏览器端则由同一份清单的 `dsh.client` 声明发现。

## 配置

以下每一项都是带 schema 默认值的 `Config` 字段，部署方只需在自己的 `cordis.patch.yml` 中覆盖需要改动的项。

| 字段 | 默认值 | 含义 |
|---|---|---|
| `minOpenwikiVersion` | `0.7.2` | 预览可驱动的最低 openwiki 版本。 |
| `minDshVersion` | `0.2.1-rc.2` | 本插件所面向的最低 DSH 版本。 |
| `wikiDirName` | `openwiki` | 相对于工作区的 Wiki 目录。 |
| `defaultPort` | `4321` | 首选端口；端口被占用时 CLI 会递增。 |
| `portAttempts` | `20` | 尝试的端口数量，与 CLI 自身的预算一致。 |
| `registryUrl` | `https://registry.npmjs.org` | 更新检查所查询的仓库地址。 |
| `packageName` | 本包 | 更新检查与更新操作所针对的包。 |
| `openwikiCommand` | `openwiki` | 被探测并启动的 CLI。 |
| `dshCommand` | `dsh` | 仅更新操作使用。 |
| `profileName` | `$DSH_PROFILE` 或 `web` | 更新操作所安装到的 profile。 |
| `dshVersionPackages` | `@deepseek-ai/dsh-base`、`@deepseek-ai/dsh-web-app` | 用于读取当前 DSH 版本的清单。 |
| `updateCheckOnStart` | `true` | 是否在插件启动时检查仓库。 |
| `spawnTimeoutMs` | `15000` | 单个子进程的最长运行时间。 |
| `registryTimeoutMs` | `8000` | 仓库请求的最长耗时。 |
| `defaultWorkspacePath` | 空 | 调用方未指定时使用的工作区。 |

## 预览是如何嵌入的

面板是一个直接指向 `http://127.0.0.1:<port>` 的 iframe。这不需要代理，因为 openwiki 服务端既不发送 `X-Frame-Options`，也不发送 `frame-ancestors` 指令，因此允许跨源嵌框；其剩余的 CSP 指令随后约束的是被嵌入的文档，而不是宿主页面。

### 标签页类型

右侧边栏标签页类型分两阶段注册。静态定义注册到 `ctx.sidebarRightTabs`，并以包名作为其 `id`，因为注册表要求 id 在全部注册中唯一，而且该 id 同时是内容体注册所用的键：`kind` 可以被另一个实现接管，`id` 则不会。

### 入口按钮

按钮位于 `conversation.session.header.utilities`，order 为 `-20`。`open-in-app` 在该列表中占用 `-10`，因此本条紧随其左侧渲染，与"在本地打开工作区"的控件相邻。当工作区没有 OpenWiki、或安装版本低于下限时，按钮会自行禁用并在 tooltip 中说明原因，因此它绝不会打开一个空面板。

## 主机 Remote 接口

浏览器端只能通过 `openwikiVisualize` 命名空间下的这些方法访问主机。

| 方法 | 返回 |
|---|---|
| `environment` | openwiki 与 DSH 版本，以及两者是否达到下限。 |
| `workspace` | 工作区是否有 Wiki、其路径、最强标记以及页面数量。 |
| `status` | 可视化服务是否在运行，以及运行在哪里。 |
| `start` | 启动可视化服务并返回其绑定的端口。 |
| `stop` | 回收子进程。 |
| `version` | 本插件版本及其更新状态。 |
| `checkUpdate` | 实时仓库检查。 |
| `update` | 执行 profile 安装命令，并报告是否需要重新加载。 |

## 自更新

检查与安装被有意拆成两步。检查在插件启动时运行一次，可以是自动的，但它绝不安装任何东西。安装会重写 profile 的依赖，因此只在被要求时才执行，并会报告它实际运行的命令，以便手工重复同一步骤。

## 故障排查

| 现象 | 原因与处理 |
|---|---|
| 入口按钮被禁用并提示没有 OpenWiki | 工作区对应的项目尚未初始化 Wiki。请在项目根目录运行 `openwiki --init`。 |
| 提示 openwiki 低于最低版本 | 已安装的 CLI 低于 `minOpenwikiVersion`。请升级它，或为该部署降低下限。 |
| 面板始终为空并提供"重试" | 可视化服务未能启动；失败信息会给出具体命令与超时时间。 |
| 面板能加载但样式全无 | 阅读器的 CDN 资源不可达。框架本身正常，但页面需要联网。 |
| 完全无法打开标签页 | 该 profile 未组合右侧边栏，因此没有可注册的标签页注册表。主机日志会说明这一点。 |

## 开发

```sh
pnpm run build && pnpm run test && pnpm run gates
```

纯决策逻辑——版本比较、启动横幅解析、候选端口与 Wiki 判定——位于 `src/environment.ts`，其测试无需一台恰好装了 openwiki 的机器。主机服务针对打桩的子进程与仓库进行测试，浏览器端则针对伪造的客户端上下文进行测试。

本插件所依赖的、经过验证的 openwiki 接口，以及此前的浏览器插件调研，分别记录在 [OpenWiki 可视化参考文档](../../../docs/openwiki-visualize-reference.md) 与 [浏览器插件分析报告](../../../docs/browser-plugin-analysis.md) 中。

## 许可证

MIT。
