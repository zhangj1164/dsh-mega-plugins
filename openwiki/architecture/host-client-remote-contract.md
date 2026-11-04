---
type: contract
title: 宿主 ⇄ 浏览器 Remote 契约
description: 把宿主 TypertRemoteService 与其浏览器半边连起来的线上与构建契约：@Remote 命名、单一 request 参数、双层信封、dsh.client 发现链与 exports['./client'] 的区别、共享 tsdown client preset，以及核查产物 bundle 的门禁。
tags: [remote, typert, client-bundle, dsh-client, tsdown, gates, envelope]
verified:
  - by: openwiki/0.7.2
    at: 2026-11-03T09:53:43.931Z
---

# 宿主 ⇄ 浏览器 Remote 契约

本仓库的每个「面板 + 服务」插件都由两个物理上分离、却必须严格对齐的产物组成：宿主侧一个 `TypertRemoteService` 子类（`MemoService`、`GithubIssueService`、`OpenWikiVisualizeService`），浏览器侧一个通过 `dsh.client` 声明被发现、经共享 preset 打包成 `lib/client.js` 的 CJS bundle。两侧没有共享的运行时对象、没有生成的 descriptor、也没有 import map——它们只共享一套**命名与包装约定**。这一页记录的就是这套约定：谁是方法名、谁是服务名、参数怎么绑、返回怎么套、bundle 怎么注册，以及哪些门禁会在契约被破坏时把构建打红。

四类失败恰好是这个契约的全部内容：Remote 方法缺少 `request` 参数、声明了两个以上参数、bundle 注册 id 与包名不一致、bundle 里出现既不是平台模块也没有被声明的 `require`。它们都不会在类型检查里报错，都只在真实宿主 + 真实浏览器里以「什么都没发生」的形式出现。

## 两侧各自的职责边界

宿主半边负责**行为**：服务继承 `TypertRemoteService`，构造时把服务名交给框架（`super(ctx, 'memo')` / `super(ctx, 'githubIssue')` / `super(ctx, SERVICE_KEY)`），方法用 `@Remote('name')` 标注成可按名寻址的端点。浏览器半边负责**视图**：`@zhangj1164/dsh-client-ui-memo` 的 node 半边是一个空的 `apply()`，只为让插件出现在宿主的 cordis 组合里；真正的面板通过 `exports["./client"]` 交付，由 package.json 的 `dsh.client` 声明发现。

`dsh.client` 有三个字段，加上「包名就是身份」这一条，共同决定启动图上的一行：

```json
"dsh": {
  "client": {
    "inject": ["@deepseek-ai/dsh-client-connection", "..."],
    "platform": "web"
  }
}
```

- `platform`：只有 `web` 会被外壳组合，其它值连门禁都直接跳过。
- `inject`：必须先于本行实例化的包行（装配顺序）；这些词同时进入可应答集合。
- `external`：额外允许从模块表应答的精确 specifier。本仓库至今没有任何包声明它——跨包引用另一个插件浏览器半边的全是类型导入。
- **包名本身是 boot graph 的行 id**，所以 `exports["./client"]` 的 `default` 目标（本仓库一律是 `lib/client.js`）必须以同名注册，否则外壳只报 `bundle <url> loaded without registering "<id>"`——一条既不指出是哪个包、也不指出怎么修的报错。

服务名同样没有共享对象作保：`'memo'` 在 `MemoService` 的 `super()` 里，`'openwikiVisualize'` 在宿主 `src/index.ts` 与浏览器 `src/client/controller.ts` 各写一份字面量。两侧对齐靠约定与测试（`controller.spec.ts` 断言了发出去的 endpoint 是 `${SERVICE_KEY}/status`），不靠 import。

一个浏览器半边也不必只对一个服务说话：备忘看板同时按名调用 `memo/*` 与 `githubIssue/optimizeIssue`、`prefilledIssueUrl`、`createIssue`，三条请求走同一个 `/api` 通道、同一个 `RpcCaller`，类型则分别来自各包 `./client` 投影。对 `github-issue` 浏览器半边的依赖因此只存在于类型层。

## 易混点：`exports['./client']` 是类型投影，`dsh.client` 才是浏览器半边

同一个导出键 `./client` 在本仓库承担两种完全不同的角色，决定权不在导出键上，而在 `dsh.client` 在不在：

| | `@zhangj1164/dsh-memo` | `@zhangj1164/dsh-client-ui-memo` |
|---|---|---|
| `exports['./client']` | `lib/client.js` + `lib/client.d.ts` | `lib/client.js` + `lib/client.d.ts` |
| `dsh.client` | **没有** | `platform: "web"` + 5 个 `inject` 行 |
| 那份 `src/client.ts` 是什么 | `export type * from './types.ts'`，纯类型投影 | 真正的面板入口，被打包成 wrap 过的 CJS |
| 在构建里的角色 | 不是 boot 行、不进模块表；preset 判其「无 client 半边」直接内联 | boot 行；`lib/client.js` 由外壳抓取并注册 |

`@zhangj1164/dsh-memo` 导出 `./client` 的唯一目的，是让浏览器代码从 `@zhangj1164/dsh-memo/client` 拿到 `MemoWeek`、`MemoEntry`、`MemoAddEntryRequest` 这类宿主类型而不复制一份。它在构建里既不是 boot 行也不进模块表：类型导入早被擦除，`dsh-client-bundle-purity` 永远看不到它。这个区别有两个直接后果：

- **测试必须绕开投影。** 根 `vitest.config.ts` 把 `@zhangj1164/dsh-memo`、`.../client`、`.../types`（以及 github-issue、telemetry 的同名面）统统 alias 到 TypeScript 源文件：运行时解析已发布的投影只会得到一个空模块，客户端测试会以一个毫不相干的错误失败。
- **`import type` 永远安全，值导入才是装配关系。** `@zhangj1164/dsh-client-ui-memo-settings` 在 `dsh.client.inject` 里声明了 `@deepseek-ai/dsh-client-ui-settings`（装配顺序），但对该包的引用是类型导入，所以产物里没有对应 `require`，也就不需要 `external` 行。

## 线上形状：按名绑定 + 单一 `request`

一次调用只有一个合法写法：

```ts
await rpc.call('/api', `${service}/${method}`, { args: { request } })
```

服务名来自 `super(ctx, 'memo')`，方法名来自 `@Remote('addEntry')`，参数**按名字**绑定——框架把 `args.request` 送到那个名叫 `request` 的参数上。于是浏览器侧只有一条规则、且必须是硬规则：**每个 Remote 方法声明且只声明一个名为 `request` 的参数**，即使它不接收任何输入。

不接收输入的方法也必须保留这个参数，`listArchivedQuarters` 与 `listModels` 都是这么写的：

```ts
@Remote('listArchivedQuarters')
listArchivedQuarters(request: MemoListArchivedQuartersRequest): MemoListArchivedQuartersResult {
  void request
  ...
}
```

这条规则的代价已经用一次真实故障付过：`listArchivedQuarters` 曾完全不带参数，调用在方法体执行之前就被拒绝，宿主那边 13 个季度归档成功、客户端读回来永远为空，「归档」看起来像没做任何事。客户端测试用 fake RPC 应答、宿主测试直接调方法，裂缝正好落在两者之间，没有任何测试发现。现在 `tests/remote-signatures.spec.ts` 从源码里抽取每个 `@Remote('...')` 与其后的签名，断言 `request` 存在、且签名里没有第二个参数（第二个参数需要一个客户端根本不会发送的线上名字），并且先断言「扫到的方法数 > 10 且包含 `listArchivedQuarters`」，避免整份用例在重构后静默变成永远通过的空壳。

**这条不变式目前的执行范围只有 `dsh-memo`。** 扫描读的是写死的 `../src/index.ts`，而同一仓库的 `@zhangj1164/dsh-openwiki-visualize` 有五个完全不带参数的 `@Remote` 方法——`environment()`、`status()`、`stop()`、`checkUpdate()`、`update()`——浏览器半边却照样按统一形状发 `{ args: { request: {} } }`。这两件事不可能同时对：要么宿主对「多出来的命名参数」是宽容的（那么 memo 那次故障的机制另有解释），要么这五个方法在线上根本到不了方法体。仓库里没有任何测试盖住这条缝（openwiki 的宿主测试直接调方法，客户端测试用 fake RPC），两边都只证明了自己那一半。要信任这条规则，得把源码扫描从「一个包的 `src/index.ts`」扩到一个可枚举的宿主半边清单。

## 双层信封：传输层与业务层各有一个 `ok`

`rpc.call` 返回的不是方法的返回值，而是**传输信封**；方法自己返回的又是**业务结果**。两层都带 `ok`，所以线上形状是 `{ ok, value: { ok, value } }`：

| 层 | 形状 | 由谁产生 | 何时失败 |
|---|---|---|---|
| 传输层 | `{ ok, value?, error? }` | Connection 的 `/api` 通道 | 端点不存在、通道断掉、框架侧拒绝（包括参数绑定失败） |
| 业务层 | `{ ok: true, value } \| { ok: false, error: { code, message } }` | `@Remote` 方法体 | 输入非法、季度已归档、服务未挂载、模型调用失败等 |

`callRemote` 只解第一层：`envelope.ok && envelope.value !== undefined` 时把内层业务结果原样返回，否则用 `envelope.error` 合成失败（缺 code 时兜底 `transport-failure`），抛异常则返回 `rpc-failure`。调用方（controller 的各个动作）再读业务层——两层都不能省：只解一层会让加载器把一个数组当成 `{ ok }` 读，而把业务失败当成传输失败会让「quarter-archived」这类可操作的原因退化成一句通道错误。

## 一次看板点击走完整条链路

```mermaid
sequenceDiagram
  participant Board as MemoBoard
  participant Ctl as MemoController
  participant Rpc as connection.rpc
  participant Host as 宿主 Remote 派发
  participant Svc as MemoService
  Board->>Ctl: addCard(draft)
  Ctl->>Rpc: call('/api', 'memo/addEntry', { args: { request } })
  Rpc->>Host: 传输请求
  Host->>Svc: addEntry(request)
  Svc->>Svc: appendEntry 写 storage-domain 表
  Svc-->>Host: 业务结果 { ok: true, value: MemoEntry }
  Host-->>Rpc: 传输信封 { ok: true, value: 业务结果 }
  Rpc-->>Ctl: 传输信封
  Ctl->>Ctl: 解外层信封，读内层 ok 与 value
  Ctl-->>Board: refresh() 后重绘
```

图里的每一步在源码里都能对上：`MemoBoard` 把草稿交给 `controller.addCard`；`addCard` 只有拿到 `targetWeek` 后才发 `callMemo(this.rpc, 'addEntry', { weekId, type: 'text', content })`；`callMemo` 只是把服务名固定成 `'memo'` 的 `callRemote`；`callRemote` 组装 `{ args: { request } }` 并解外层信封。宿主 `addEntry` 转发给私有的 `appendEntry`（`@Remote` 只在公开入口上，`originSessionId` 由 `summarizeSession` 单独设置，外部请求无法伪造来源），写库成功后返回 `{ ok: true, value: entry }`。注意这条链路里**没有** provider/model：路由由宿主按自己的 `Config` 或部署的 `agentDefaultModel` 解析，浏览器不猜。

失败时浏览器看到什么，取决于断在哪一层，而落点是同一个 `error` 字符串槽：

| 断点 | 浏览器读到的 `code` | 面板显示 |
|---|---|---|
| 季度已归档、`weekId` 非法等业务拒绝 | 宿主给的码，如 `quarter-archived`、`invalid-week-id` | 宿主写的那句话，卡片没被加上 |
| 通道断掉、端点不存在、框架拒绝参数绑定 | `envelope.error.code`，缺失时 `transport-failure` | `unknown transport error` 或通道原始信息，看起来像网络问题 |
| `rpc.call` 抛异常 | `rpc-failure` | 异常文本 |

第三行与第一行最容易被混为一谈：`addCard` 对两者做的是同一件事——`if (!result.ok) this.set({ error: result.error.message })`——所以「归档了所以不能写」和「通道坏了」在界面上只差一句文案，`code` 才是唯一可靠的区分。`listArchivedQuarters` 那次故障更隐蔽：`readArchivedQuarters` 把任何失败折叠成空集合加 `ok: false`，`refresh()` 再用一句固定警告 `the archived quarters could not be read; cards are shown as editable` 把「读不到」与「没归档」区分开——因为归档状态读不到时，卡片会被当成可编辑的。

## 浏览器产物的构建契约

`scripts/tsdown.client.ts` 的 `clientBundle(id, libEntry, options?)` 是这一半的唯一事实来源，它一次产出三份 tsdown 配置，顺序有意义：

```mermaid
flowchart TD
  A["manifest: name + dsh.client（platform 必须为 web）"] --> B["clientBundle(id, libEntry)"]
  B --> C["node 半 lib/index.js（ESM，dts，clean）"]
  B --> D["浏览器半 lib/client.js（CJS + 包装）"]
  B --> E["声明 lib/client.d.ts（emitDtsOnly）"]
  D --> F{"verify-client-bundle-id（needs build）"}
  F -->|通过| G["exports ./client 的 default 指向 lib/client.js"]
  F -->|违反| H["门禁失败：注册 id、require 应答、声明行"]
  G --> I["外壳按行 id 组合 boot graph，并从模块表应答 require"]
```

- **node 半**（`name: id`）先跑、带 `clean: true`，`deps.neverBundle` / `alwaysBundle` 两侧都显式给出（生产依赖留在磁盘上不打包，其余内联），从而不依赖 tsdown 的 `getProductionDeps` 兜底。
- **浏览器半**（`name: id/client`）以 `format: ['cjs']`、`platform: 'browser'`、`target: 'es2024'` 输出，`entryFileNames` 钉死为 `client.js`，`clean: false`（目录已被 node 半清过），开 `sourcemap`，并注入三组 `define` 把 `process.env.NODE_ENV` / `import.meta.env.MODE` 折成常量——CJS 产物装不下空的 `import.meta`。产物本身是一个闭包工厂：`banner` 写 `window.__ModuleLoader__.load({ id, factory: (require) => {`，`intro` 造出 `module` / `exports`，`footer` 收尾 `return module.exports; } });`。注册 id 就来自这里，而且是从预设参数拼进去的——不是某处手写的字面量。
- **声明半**（`name: id/client-types`）只跑 `dts: { emitDtsOnly: true }`，因为 rolldown 不会为被包装的 CJS 面产出声明 chunk，而 `exports["./client"]` 的 `types` 需要一个 `.d.ts`。

`exports["./client"]` 与 `client.js` 这个名字不是预设写进 manifest 的：manifest 是人写的，预设只保证产物叫 `lib/client.js`，门禁再从 manifest 读出目标路径去核产物。三者要一起改。

### require 必须可应答

浏览器半边的 `neverBundle` / `alwaysBundle` 由 `moduleTableWords(declaration)` 一个集合决定：平台基线 `PLATFORM_MODULES`，加上 `dsh.client.inject` 与 `dsh.client.external` 的每一行。行的两种拼写都算数——`<pkg>` 与 `<pkg>/client` 互为同义（浏览器在查表前会把 `/client` 归一化掉），所以同一个集合既能应答 `@deepseek-ai/dsh-client-ui-theme`，也能应答 `@deepseek-ai/dsh-client-ui-theme/client`。集合之外的 specifier 一律内联：模块表答不上来的 `require` 在工厂实例化那一刻就是确定的运行时抛错。

`PLATFORM_MODULES` 只有 11 个词，镜像 DSH 外壳的种子表（源码位置是 harness 的 `packages/client/web/src/platform.ts`，版本对齐这些包声明的 peer 范围 `0.2.1-rc.2`）：`react`、`react/jsx-runtime`、`react-dom`、`react-dom/client`、`@deepseek-ai/cordis`、`zod`、`@tanstack/react-virtual` 与四个 `dsh-client-*` UI/store 包。它**不等于**外壳的全部包：三个 web 半边实际 inject 的 `@deepseek-ai/dsh-client-connection`、`-locale`、`-ui-layout`、`-ui-renderer`、`-ui-theme`、`-ui-settings` 都不在基线里，必须自己写进 `inject` 才算数。外壳升级若增删一个种子词，必须同步改这里：外壳不再种的词会变成无法应答的 `require`，而外壳新增的词若漏在这里，就会被内联进每个 bundle。

### 另一个插件的浏览器半边不许被内联

`dsh-client-bundle-purity` 插件把这件事变成**构建错误**：解析 `@deepseek-ai/*` 或 `@zhangj1164/*` 的 specifier 时，如果它是本包的模块表词，外部化照旧；如果不在表里、却解析到一个**自己声明了 `dsh.client` 的包**，直接抛错并提示「声明到 `dsh.client.external`，或改走 cordis service 协作」。理由很硬：内联会把对方的 service、单例与 Remote 协议各造一份。类型导入在这里天然安全——它们被擦除，永远到不了这个 gate，这也正是本仓库目前**没有任何** `dsh.client.external` 行的原因（跨包引用另一个插件浏览器半边的都是类型）。

### 样式没有 CSS 流水线

preset 刻意丢弃了 harness 版本的 `lightningcss` 虚拟模块与 `staticLinked` 静态装配通道：本仓库每个包只发布一个浏览器半边，样式以 TypeScript 字符串常量交付。`ui-memo` 的 `styles.ts` 导出一个 `CSS_TEXT`，`apply()` 里创建一个 `<style data-dsh-plugin="memo">` 挂到 `document.head`，并由 `ctx.effect` 的 disposer 负责移除。好处是样式和 token 一起走类型检查、随包发布、不需要额外 loader；代价是主题只能靠 `--dsw-alias-*` 变量跟随，不能预处理。

## 门禁：`verify-client-bundle-id`

`pnpm run verify-client-bundle-id` 是唯一读**产物**而不是读声明的检查，因此它在 `gates:check-all` 里带 `needs: ['build']`。它扫描 `packages/*/*/package.json`，只看 `dsh.client.platform === 'web'` 的行（当前三行：两个 memo 面板与 openwiki 预览），然后从 `exports["./client"]` 解出 bundle 路径（缺失则报「run the build」），对 `lib/client.js` 的源码做四类断言：

1. **注册 id 必须等于包名。** 用正则从 `window.__ModuleLoader__.load({ id: ... })` 抽出 id；抽不到算违规（「registers no id」），抽到但与包名不同也算违规，并把两边的字符串一起写进诊断。
2. **每个字面量 `require` 必须是模块表词。** 不在平台基线、也不在 `inject`/`external` 里的 specifier 逐个报出。
3. **不允许非字面量 `require`。** 用「`require(` 出现次数 > 字面量次数」判断；动态 specifier 是模块表结构上无法应答的。
4. **声明的行必须真的可服务。** `inject`/`external` 里的每一项必须是裸包 specifier、必须解析到已安装的清单、且该包必须自己声明 `dsh.client`——否则外壳拿不出这一行。唯一豁免是平台基线词：`react` 之类写在 `inject` 里会被当作外壳已种、不再要求本包声明 `dsh.client`。

第 1 条针对的是本仓库真的发出过的缺陷：包改名后 banner 里的字面量 id 停在旧名上，浏览器只报一句「loaded without registering」，而现在 `scripts/tests/client-bundle-id.spec.ts` 把这个回归、缺 handoff、越界 `require`、声明行三类错误都钉成了用例；`scripts/tests/tsdown-client.spec.ts` 则在另一端钉住 preset 的解析规则（不存在的 id 直接抛错、`client.js` 被钉死、browser 配置 `clean: false`、平台词外部化、`/client` 双拼写、malformed 声明抛错）。

## 失败模式与拦截点

| 破坏方式 | 症状 | 被谁拦住 |
|---|---|---|
| 方法没有 `request` 参数 | 调用在方法体之前被拒，宿主改成功、客户端读到空 | `tests/remote-signatures.spec.ts`（仅 `dsh-memo`） |
| 方法声明了第二个参数 | 第二个参数永远拿不到值（客户端不发送它的线上名字） | `tests/remote-signatures.spec.ts` |
| bundle 注册 id ≠ 包名 | 浏览器拒绝注册，面板不挂载 | preset 按名定位包（不存在的 id 直接抛）+ `verify-client-bundle-id` |
| `require` 既非平台模块、也未声明 | 工厂实例化时抛错，面板白屏 | preset 的 `alwaysBundle` 内联兜底 + `verify-client-bundle-id` |
| 内联了另一个插件的浏览器半边 | 服务/单例/Remote 协议出现两份 | `dsh-client-bundle-purity` 构建期抛错 |
| 只解一层信封 | 加载器把数组或业务对象当 `{ ok }` 读 | `tests/fake-rpc.ts` 复刻 `{ ok, value: { ok, value } }` |
| 无参 `@Remote`（openwiki 那五个） | 未知：要么被框架拒绝，要么多余参数被忽略 | 目前没有任何测试 |

最后两行值得展开：`fake-rpc.ts` 显式模仿宿主返回 `{ ok: true, value: handle(endpoint, request) }`，并注释说明「直接返回业务结果会塌掉一层」。这意味着 client 侧的信封解包在测试里是被真实结构驱动的，而不是被一个恰好对齐的 stub 掩盖。而最后一行是这份契约目前唯一的已知空白：无参方法在 `dsh-memo` 里被写死为错误，在 `dsh-openwiki-visualize` 里却照常发布。

## 改动这份契约时要同步的地方

- **加一个 Remote 方法**：方法体上 `@Remote('name')`，签名只有一个 `request`（哪怕不接收输入也要留着，`void request`），返回业务结果类型；同时更新包的 README 方法表（中英 + `README.i18n.yaml`）。
- **加一个浏览器侧依赖**：先判断它是不是模块表词。平台基线内的（`react`、`zod` 等）不用声明；外壳里有 client 半边但不在基线的包（`dsh-client-connection`、`-ui-theme` 一类）写进 `dsh.client.inject`；另一个插件自己的浏览器半边要同时进 `inject`（装配顺序）与 `external`（可应答请求）；纯类型引用什么都不用做。
- **包改名**：只改 `package.json` 的 `name`，preset 调用点的 `id` 必须跟着改，否则 preset 按名找不到包而中止；改名之后跑一次门禁确认产物里的注册 id 已经跟上。
- **外壳升级**：核对 `PLATFORM_MODULES` 与 DSH 的种子表，增删词条；漏改的两侧都会静默失败（一个内联、一个无法应答）。
- **新增带 `@Remote` 的包**：它的 node 半构建需要 decorator lowering（`ts.transpileModule`），走 `clientBundle` 的包用 `options.lib.plugins` 注入（`dsh-openwiki-visualize` 就是这么做的）；根 `vitest.config.ts` 的 `standardDecorators()` 插件覆盖测试侧。

需要同意的能力不属于这份契约：面板发起的 Remote 调用发生在 turn 之间，`ctx.approval.request()` 没有 open turn 可落，所以敏感操作只能留在宿主内部（不注册 `@Remote`，`readExternalPath` 就是这一形态）或包装成 turn 内的 tool。见[能力与审批边界](../concepts/capability-and-approval-boundaries.md)。

## 相关页面

- [架构总览](overview.md)——两半产物的整体位置，以及本契约在其中的落点。
- [能力与审批边界](../concepts/capability-and-approval-boundaries.md)——为什么「UI 点击 → 宿主敏感操作」拿不到人工确认。
- [构建、测试与门禁](../operations/build-test-and-gates.md)——`gates:check-all` 的完整图与依赖关系。
- [备忘看板 UI](../systems/memo-board-ui.md)——这条契约最大的消费者。
- [OpenWiki 预览](../systems/openwiki-visualize.md)——同样走 `clientBundle` 且需要 decorator lowering 的宿主+浏览器双侧插件。
- [测试策略](../testing/testing-strategy.md)——fake RPC、产物门禁与源码扫描式用例在测试金字塔中的位置。
