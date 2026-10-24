# 客户端 bundle 预设移植设计

本文记录「把 DSH 的 `packages/client/tsdown.client.ts` 引入本仓库」这一改动的设计。关键事实来自对 harness 检出、已安装 DSH 运行时（0.1.5-rc.1）与 `@deepseek-ai/dsh-client-modules` 源码的核对；范围与取舍已由用户确认（选项 A：仓库内落地适配版预设；精简移植；预设内校验 + 新增 CI 门禁）。

## 目标

让 ui-memo 的浏览器半边由一份**仓库内共享的构建预设**产出，而不是每个包各写一份手抄的 tsdown 配置；同时把「注册 id 必须等于 manifest 包名」这条运行时契约变成构建期与门禁期的硬约束。

## 背景与取证事实

### 为什么不能直接 import

`packages/client/tsdown.client.ts` 是 harness **仓库内部**的 workspace 预设，不是一个对外发布的包：

- 它 import 自己的同仓模块：`packages/client/modules/src/client/manifest.ts`（`optionalStringArray`）、`packages/client/web/src/platform.ts`（`PLATFORM_MODULES`）、`scripts/client-build-environment.ts`（`clientBuildEnvironmentDefines`），以及第三方 `lightningcss`。
- 它用自身文件位置推出 `REPOSITORY_ROOT = new URL('../..', import.meta.url)`，然后 `globSync('packages/*/*/package.json')` 去找**调用方自己**的 manifest，用于取 `productionExternals`（node 半边）与 `dsh.client.external`（client 半边）。
- 它假设 harness 的两阶段构建：tsc 先产出 `lib/types/**`，tsdown 再从 `lib/types/*.js` 打包，并由 `DSH_BUILD_FACE=host|client` 分两次 pass 调度。

因此直接 import 的后果是：对我们的包名 `@zhangj1164/dsh-client-ui-memo`，manifest 查找会抛 `no packages/*/*/package.json declares the name`；同时构建被绑死在 `E:\Projects\mpass\deepseek-harness` 这个同级检出上——CI、`prepare`、git 安装都不具备它。已安装的 DSH 只发 `lib/`，也没有任何已发布包对外提供这个预设。

### 顺带定位到一个真实回归

`packages/client/ui-memo` 当前产出里注册的是 `id: "dsh-client-ui-memo"`，而 DSH 0.1.5-rc.1 运行时 boot 行 id 是**manifest 包名**：

- 宿主侧 `ClientModules.flush` 用 `entry.options.name` 取登记名（本仓库 `cordis.patch.yml` 里写的是 `name: "@zhangj1164/dsh-client-ui-memo"`），并按 `resolveMeta` 得到的 `packageName` 建档：`this.table.set(packageName, { entry: graphRow(packageName, rev, meta), … })`。
- 浏览器侧 `ClientModuleSystem.arrive(row)` 在脚本执行后校验 `this.factories.has(row.id)`，不匹配即抛 `client-modules: bundle <url> loaded without registering "<id>" via __ModuleLoader__.load`。

包名收归 `@zhangj1164` scope 那次改名（`4abe80d`）改了 manifest 与 patch，漏改了 `tsdown.config.ts` 里的 banner 字面量，于是备忘面板在浏览器里根本挂不上。这类缺陷的根因是「同一个事实有两处手写来源」，预设要消除的正是这一点。

### 运行时的模块表规则

`ClientModuleSystem.makeRequire` 的回答顺序是：模块表 seed 词 → 已物化记录 → 已注册工厂的 id（`stripClientSuffix` 会把 `<pkg>/client` 归一成 `<pkg>`），其余一律抛错。宿主侧组装 boot graph 时，`inject` 边保证被注入行的工厂先到达，`external` 边携带「非注入的精确模块请求」。所以一个 bundle 里出现的每个 `require` 字面量，都必须是 seed 词、某个 `inject` 行的包名（或其 `/client` 子路径）、或自己 `dsh.client.external` 里声明过的词。

已安装 DSH 0.1.5-rc.1 的 seed 词来自 harness 的 `PLATFORM_MODULES`：`react`、`react/jsx-runtime`、`react-dom`、`react-dom/client`、`@deepseek-ai/cordis`、`@deepseek-ai/dsh-client-store`、`@deepseek-ai/dsh-client-ui-slots`、`@deepseek-ai/dsh-client-ui-primitives`、`@deepseek-ai/dsh-client-ui-dockkit`（`PRELOADED_CLIENT_EXTERNALS` 为空）。旁证：已安装的官方客户端 bundle 普遍 `require("@deepseek-ai/dsh-client-store")`。

当前 ui-memo 产物实测只 `require("react")`，其余 `@deepseek-ai/*` 与 `@zhangj1164/*` 导入都是 `import type`（会被擦除），所以这次移植不改变运行时的依赖集合。

## 决策记录

### 已确认的取舍

1. **仓库内落地适配版预设，而不是 import harness 检出** → 自包含，CI 与 git/npm 安装都能构建；代价是模块表基线成为一份需要随 DSH 升级维护的常量。
2. **精简移植** → 只保留浏览器半边真正需要的互操作契约，去掉我们用不到的分支；代价是将来若需要 CSS Modules 或静态装配通道，要再补回。
3. **预设内校验 + 新增 CI 门禁** → id 与 `require` 集合两个事实同时被构建期与门禁期约束；代价是多一道读构建产物的 gate，必须挂在 `build` 之后。

### 明确丢弃的部分

`DSH_BUILD_FACE` 的 host/client 双 pass、tsc `lib/types` 中转与 sourcemap 串接、lightningcss 的三个 CSS 虚拟模块（`.module.css` / `?inline` / 全局 CSS）、`staticLinked` 与 `clientLibrary`（静态装配通道）、`sourcemapPathTransform`（那是 harness 自己的 URL 布局）、`clientBuildEnvironmentDefines`（`DSH_CLIENT_*` 提交号/版本/标题注入）。理由：本仓库只发一个浏览器半边，样式是 TS 字符串常量，没有静态装配通道的消费者，这些能力都依赖 harness 仓库根与它自己的构建编排。

## 设计

### 保留的互操作契约

- **闭包工厂产物**：`window.__ModuleLoader__.load({ id: <包名>, factory: (require) => {` + `var module = { exports: {} }; var exports = module.exports;` 引导 + `return module.exports; } });` 收尾；`format: ['cjs']`、`platform: 'browser'`、`target: 'es2024'`、`fixedExtension: false`、`outputOptions.entryFileNames: 'client.js'`。
- **依赖规则**：模块表里的词（平台基线 ∪ `inject` 行 ∪ `dsh.client.external`）保持 external，其余全部内联。
- **纯度门**（简化版，见下）。
- **sourcemap**：`sourcemap: true` + `outputOptions.sourcemapExcludeSources: false`；DSH 会把 `.map` 一起发出去，`sourcesContent` 内嵌，DevTools 直接显示 TS 源码。
- **构建期 define**：`process.env.NODE_ENV`、`import.meta.env.MODE`、`import.meta.env`（zustand/immer 这类会读它们，CJS 产物若不替换会留下空的 `import.meta`）。
- **API 形状与 harness 一致**：`clientBundle(id, libEntry, options?)`，一次产出三个配置——node 半边（ESM、platform node、`dts: true`）、client 半边、以及只产出 `lib/client.d.ts` 的声明 pass（CJS 浏览器产物不产生声明块）。`options.lib` 按 harness 语义整体覆盖 node 半边，留作逃生口。

### 落点与 API

新文件 `scripts/tsdown.client.ts`，导出：

- `PLATFORM_MODULES`：平台基线 seed 词，注释写明来源是 DSH 0.1.5-rc.1 的 `packages/client/web/src/platform.ts`，供预设与 gate 共用同一个事实来源。
- `moduleTableWords(manifest)`：基线 ∪ `dsh.client.inject` 行（含 `/client` 形式）∪ `dsh.client.external` 词（含 `/client` 形式）。
- `clientBundle(id, libEntry, options?)`。

ui-memo 的 `tsdown.config.ts` 缩成：

```ts
import { clientBundle } from '../../../scripts/tsdown.client.ts'

export default clientBundle('@zhangj1164/dsh-client-ui-memo', ['src/index.ts', 'src/invariant.ts'])
```

manifest 定位按包名：从 `process.cwd()` 向上找到含 `pnpm-workspace.yaml` 的仓库根，再 `globSync('packages/*/*/package.json')` 找 `name === id`；**找不到、或找到的名字与传入 id 不一致，就构建失败**（让这次这类回归不可能再发生）。刻意不用 `import.meta.url` 推仓库根：tsdown 会先打包 config 再执行，那个 URL 不保证仍在原目录。

### external 判定与纯度门

client 半边 `deps.neverBundle` 取 `specifier ∈ moduleTableWords`，`alwaysBundle` 取其余；此外在 `resolveId` 上挂一个纯度门，对 `@deepseek-ai/*` 与 `@zhangj1164/*` 裸标识符：

- 命中模块表 → external（不变）。
- 能解析到 manifest、且该 manifest 声明了 `dsh.client` → **构建报错**，提示「把它声明进 `dsh.client.external`」。这条拦住的是「静默内联出第二份插件运行时」——运行时里那不是同一份实例，服务、单例与 Remote 协议都会错位。
- 其余 → 放行内联（wire/类型层、`zod`、`schemastery` 这类没有跨插件运行时身份的依赖）；解析不了的值导入交给 rolldown 直接报错。

### 防回归 gate

新 `scripts/verify-client-bundle-id.ts`：对每个 `packages/*/*` 中声明 `dsh.client.platform === 'web'` 的包，读它 `./client` 导出指向的**产物**，断言：

- 注册 id 等于 manifest `name`；
- 每个字面量 `require("…")` 都在 `moduleTableWords(manifest)` 内；
- 存在非字面量 `require(` 调用、或产物缺失，即失败（宁可响亮失败，也不要静默放过）。

同时校验 `inject` 与 `external` 里的包名：要么是基线词，要么能解析到声明了 `dsh.client` 的 manifest；否则报「不是一个模块表行」。

接入方式：`package.json` 新增 `verify-client-bundle-id` 脚本；`scripts/run-gates.ts` 的 `check-all` 中作为 `pnpmScript` 挂上 `needs: ['build']`（它读构建产物，必须等 build）；AGENTS.md 的命令清单、门禁计数与 Conventions 同步。

### 测试

放在 `scripts/tests/`（root `vitest.config.ts` 已 include 该路径，无需改配置）：

- `tsdown-client.spec.ts`：manifest 定位与 id 交叉校验（不一致即抛）、`moduleTableWords` 的合并规则。
- `client-bundle-id.spec.ts`：产物解析的正反例——注册 id 匹配/不匹配、`require` 命中/未命中模块表、非字面量 `require`、产物缺失。

## 实施顺序

1. 落地 `scripts/tsdown.client.ts` 与两个单测。
2. ui-memo 切到预设，构建并核对产物（七个文件、banner id 变为包名）。
3. 落地 gate + run-gates 接线 + AGENTS.md 同步。
4. `pnpm run gates` 全绿，然后在运行中的 DSH Web 里刷新验证备忘面板。

## 验收标准

- `pnpm --filter @zhangj1164/dsh-client-ui-memo run build` 仍产出 `lib/{index,invariant,client}.js`、对应 `.d.ts` 与 `client.js.map`，且 banner 注册 id 为 `@zhangj1164/dsh-client-ui-memo`。
- `pnpm run gates` 全绿（含新增门禁）。
- 在 3080 的 DSH Web 里 memo 面板能正常挂上，控制台不再出现 `loaded without registering`。

## 本次不包含

- 给 harness 上游提交「把仓库根与模块表参数化」的改动；本仓库只做适配版移植。
- `staticLinked` / `clientLibrary` 静态装配通道、lightningcss CSS 管线、双 pass 构建。
- 客户端的 typecheck 门禁，以及 ui-memo 里 `@deepseek-ai/dsh-client-ui-layout/client`、`@deepseek-ai/dsh-client-ui-slots/client` 两个既未声明也未安装的类型导入（声明合并实际未生效）；这两件各自单开工作项。
