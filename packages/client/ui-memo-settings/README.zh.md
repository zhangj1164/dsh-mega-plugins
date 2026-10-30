# @zhangj1164/dsh-client-ui-memo-settings

[English](README.md) | 中文

备忘套件的设置页。它通过当前部署自己的设置面板编辑备忘宿主的配置，因此 AI 路由、归档会话总结文案和 GitHub 仓库都可以在 DSH Web 里改完即生效，不需要重启。

## 插件形态

一个纯 UI 表面插件：宿主 `apply` 为空，只为了让插件出现在宿主 `cordis.yml` / Loader 里；浏览器半边通过 `exports["./client"]` 发布，由 `package.json` 的 `dsh.client` 声明发现。

页面是一个 `settings.section` 条目：设置壳把它渲染在内容列，并用注册自身的 `id`、`order`、`label` 生成导航行。它只在宿主提供 `memo` 设置命名空间时注册（`ctx.configForms.whileServed`），因此没装备忘插件的部署看不到这个包的任何痕迹——既不会出现空页面，也不会多出一行导航。

页面不持有任何备忘的值。它在宿主表单之上暂存草稿，再通过 `ctx.configForms` 逐字段提交；每次写入都带着快照里的命名空间修订号，一次被拒绝的写入会中止整轮提交，其余草稿保持暂存。备忘宿主把每个 `Config` 字段都声明为 `.volatile()`，因此被接受的写入会原地到达运行中的服务——`cordis-plugin-loader` 刷新易变引用，而不是重新挂载插件。

## 字段

| 字段 | 控件 | 默认值 | 取值范围 |
|---|---|---|---|
| `provider` | 文本 | 跟随部署默认 | — |
| `model` | 文本 | 跟随部署默认 | — |
| `sessionSummaryLanguage` | 选择：自动 / 中文 / 英文 | `auto` | — |
| `sessionSummaryMaxSessions` | 数字 | `5` | 1–20 |
| `sessionSummaryTranscriptMaxChars` | 数字 | `24000` | 1000–200000 |
| `sessionSummaryMaxChars` | 数字 | `300` | 100–4000 |
| `sessionSummarySourceTemplate` | 多行文本 | `来源会话：{sessionId}` | — |
| `sessionSummaryPrompt` | 多行文本 | 宿主自带的提示词 | — |
| `repoUrl` | 文本 | `https://github.com/zhangj1164/dsh-mega-plugins` | — |

页面按下面的顺序分四组渲染：AI 分析（`provider`、`model`）、归档会话总结（语言、会话数上限、转录预算、总结字数）、总结文案（来源模板、提示词）、GitHub（`repoUrl`）。

**留空即取消覆盖。** 空的 `provider` 或 `model` 会被保存成一次 unset，恢复文档里的优先级：请求不带路由，由宿主解析本部署的默认模型。其他字段留空同样是恢复默认值，而不是写入空字符串。

**已覆盖与恢复默认。** 当宿主文档的用户层带有某个字段时，该字段标记为「已覆盖」；这个判断读的是快照自身的 `user` 层，而不是比较取值，只有在这种情况下该行才提供「恢复默认」，而它暂存的也是一次 unset。在点「保存」之前不会写入任何东西。

**取值范围只是便利，不是规则。** 宿主会校验每次写入并拒绝越界值；页面复述一遍 schema 里的数字，是为了在往返之前就拦住错误输入，越界时显示「超出允许范围」并禁用保存按钮。

不在本页的字段：`storageWriteRetries`、`storageWriteRetryDelayMs`、`logAnalysisPlugins` 属于部署级开关，应留在 `cordis.yml`；`sessionSummaryMaxCharsLimit` 约束的是另一个界面的长度控件，不是本页的值。

## Bundle 层

本包声明了 `dsh.bundle` 和自己的 `cordis.patch.yml`，只插入一行 `ui-memo-settings`。在没有 `@zhangj1164/dsh-memo` 的情况下装上它，模块会加载但不注册任何东西，因为 `memo` 命名空间永远不会被提供。

安装整套时要逐个点名包，因为 profile 只安装命令行上列出的包：

```sh
dsh plugin --profile web add @zhangj1164/dsh-telemetry @zhangj1164/dsh-github-issue @zhangj1164/dsh-memo @zhangj1164/dsh-client-ui-memo @zhangj1164/dsh-client-ui-memo-settings
```

## 测试

`tests/form.spec.ts` 用替身宿主表单驱动草稿模型：暂存不写入、只保存被改动的字段、留空存成 unset、被拒绝时保留草稿、只读与不可用状态、四组边界值，以及宿主认可后丢弃草稿的对账逻辑。`tests/MemoSettingsSection.spec.tsx` 在 jsdom 里用真实模型渲染页面，覆盖每个控件，包括「已覆盖」标记与恢复默认、非法数字的告警、放弃修改的路径。`tests/entry.spec.tsx` 把真实浏览器半边应用到一个替身客户端上下文上：声明的服务、唯一一次 `settings.section` 注册及其导航身份、对命名空间是否被提供的门控、字典、注入的 store 与动作，以及样式卸载。

## 本地开发与排查

本页是备忘宿主 `Config` 的投影。页面到底存不存在，由两个机制决定，而这两处在本地开发时都很容易留成旧的。

`@deepseek-ai/dsh-settings` 对每条 entry 的 schema 调 `volatileForm()`；一个没有任何 `.volatile()` 字段的 schema 会得到 `undefined`，`describe()` 随后整条跳过这个 entry。浏览器半边以「命名空间是否被提供」为门控，所以只有宿主真的在提供 `memo` 时才会注册、注入样式并渲染——宿主产物是旧的，结果是**不出现页面、也不报错**，而不是一个坏掉的页面。

两边都要构建、安装后重启：

```sh
pnpm run build    # 备忘宿主 AND 本包
dsh plugin --profile web add "link:E:/Projects/mpass/dsh-mega-plugins/packages/client/ui-memo-settings"
# 重启 DSH Web，再刷新页面
```

只构建本包不够：`pnpm --filter @zhangj1164/dsh-client-ui-memo-settings build` 刷新的是浏览器半边，而命名空间来自宿主的 `lib/`。宿主插件的代码在启动时 import，新加的 bundle 层也在启动时组装，所以重建后的 `lib/` 和新写进 `dsh.profile.bundles` 的行对运行中的进程都不可见；`patchReload: live` 只热加载配置文档，不加载模块。

重启后页面仍不出现时，按这个顺序查——第一个命中的就是原因：

1. `Select-String packages\memo\dsh-memo\lib\index.js '\.volatile\(\)'` 有匹配；从别的分支残留的产物一个都没有，entry 因此永远到不了 `describe()`。
2. `dsh --profile web --dump-config` 里有 `ui-memo-settings` 行；否则这个包根本没成为 profile 层，也就是没进 `dsh.profile.bundles`。
3. 浏览器确实取到了 `@zhangj1164/dsh-client-ui-memo-settings/client.js`；否则它不是 profile 的直接依赖，客户端扫描根本没看到它。

「页面出现」和「改动生效」是两件事：只有当宿主的字段真的带 volatile 时写入才有效，因为 loader 对「仅 volatile 变化」的配置走原地提交（对运行中的引用调 `updateVolatile`，不重新挂载），除此之外没有东西可提交。

## 已知限制

- **按设计只覆盖一部分** —— 本页只放看板用户会改的字段。上面列出的部署级开关留在 `cordis.yml`，那里改错不会波及每一个浏览器。
- **边界值重复了一份** —— 浏览器读不到 schema，只能复述备忘 schema 的范围，宿主仍是权威；schema 改动时两边都要改。
