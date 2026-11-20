---
type: 参考
title: 本仓库消费的 DSH 宿主服务契约
description: 逐个记录各包从 DSH 宿主与浏览器外壳读取的服务键、实际用到的成员、哪些经 static inject 或 export const inject 声明为必需、哪些经 ctx.get 或 ctx.inject 可选读取，以及服务缺席时各自的降级与失败码；并说明为什么用结构类型而不是硬依赖，以及浏览器半边的模块表如何限制一个面板能直接够到哪些服务。
tags: [host-services, structural-typing, cordis-services, optional-services, client-module-table]
verified:
  - by: openwiki/0.9.0
    at: 2026-11-20T08:03:00.940Z
sources:
  - id: openwiki-source-d2082ceb4967a4fb235b4e94
    resource: repo://docs/plans/2026-09-15-ui-memo-model-switcher-design.md
  - id: openwiki-source-f8b3403cb5cc590ade7ebb1a
    resource: repo://docs/plans/2026-10-28-memo-session-summary-design.md
  - id: openwiki-source-f73ada1b954acf9b08ba25bf
    resource: repo://docs/plans/2026-11-02-github-issue-intake-autopilot-design.md
  - id: openwiki-source-fb1e84d330a7b727a6c2b3de
    resource: repo://packages/client/ui-memo-settings/src/client/draft.ts
  - id: openwiki-source-3677926fe619a6aaf798c3c2
    resource: repo://packages/client/ui-memo-settings/src/client/index.ts
  - id: openwiki-source-9adf85b324081e031e08fc7e
    resource: repo://packages/client/ui-memo-settings/tests/entry.spec.tsx
  - id: openwiki-source-0b90d56dca622d92cb59a4b0
    resource: repo://packages/client/ui-memo/src/client/index.ts
  - id: openwiki-source-d1c3b3c0ca03956475a418d2
    resource: repo://packages/client/ui-memo/tests/entry.spec.tsx
  - id: openwiki-source-1cfc01ca7c719fa80b067a8b
    resource: repo://packages/github-issue/dsh-github-issue/package.json
  - id: openwiki-source-e2b359735a8b78c5620256a1
    resource: repo://packages/github-issue/dsh-github-issue/src/index.ts
  - id: openwiki-source-1e28de25e2dd31ef73988cfe
    resource: repo://packages/github-issue/dsh-github-issue/src/invariant.ts
  - id: openwiki-source-ec2839ed53168f44b8651615
    resource: repo://packages/github-issue/dsh-github-issue/tests/intake-harness.ts
  - id: openwiki-source-acffef9d1ac2b4c5b6afb521
    resource: repo://packages/github-issue/dsh-github-issue/tests/intake-service.spec.ts
  - id: openwiki-source-c6503affb5065087aa8c04fc
    resource: repo://packages/memo/dsh-memo/package.json
  - id: openwiki-source-3a7480327133dfa38c0836e5
    resource: repo://packages/memo/dsh-memo/src/index.ts
  - id: openwiki-source-5a32207fcb88251f8f32d3c8
    resource: repo://packages/memo/dsh-memo/src/invariant.ts
  - id: openwiki-source-2fd933a4078ee59abfec2f15
    resource: repo://packages/memo/dsh-memo/src/llm-text.ts
  - id: openwiki-source-d219f324ecb87281709f240f
    resource: repo://packages/memo/dsh-memo/src/session-transcript.ts
  - id: openwiki-source-8373e522d34589c6a70fb91d
    resource: repo://packages/memo/dsh-memo/src/spec.ts
  - id: openwiki-source-90fcb4f6d0523283b8590ef6
    resource: repo://packages/memo/dsh-memo/tests/external-path.spec.ts
  - id: openwiki-source-65b7018afba5ec2f8dacc87b
    resource: repo://packages/memo/dsh-memo/tests/memo.spec.ts
  - id: openwiki-source-915d21f71d383c6cb9caef5d
    resource: repo://packages/memo/dsh-memo/tests/session-summary.spec.ts
  - id: openwiki-source-7bdef7e571c1e06b4acd10b8
    resource: repo://packages/openwiki/dsh-openwiki-visualize/package.json
  - id: openwiki-source-34ce36aa0267f32514f9fda8
    resource: repo://packages/openwiki/dsh-openwiki-visualize/src/client/index.ts
  - id: openwiki-source-98feb3974b2830432c6dc106
    resource: repo://packages/openwiki/dsh-openwiki-visualize/src/index.ts
  - id: openwiki-source-3ebcfd46000dda6a3b77ab9c
    resource: repo://packages/openwiki/dsh-openwiki-visualize/tests/entry.spec.tsx
  - id: openwiki-source-ab1b1c67ce5f3096942f7ea4
    resource: repo://packages/telemetry/dsh-telemetry/src/index.ts
  - id: openwiki-source-27d50fe5aab55f5ef2c0cafc
    resource: repo://packages/telemetry/dsh-telemetry/src/invariant.ts
  - id: openwiki-source-d96553374e6bbe1e2cc32979
    resource: repo://scripts/tsdown.client.ts
generated: { by: "openwiki/0.9.0", at: "2026-11-20T08:03:00.940Z" }
---

# 本仓库消费的 DSH 宿主服务契约

本仓库没有一个包把 DSH 当库来链接使用：它要么在 cordis 的服务键上取到运行中的能力（宿主侧），要么在浏览器外壳的服务表里取（浏览器侧）。这一页记录的就是那份消费清单——读的是哪个键、用了哪些成员、谁是必需、谁是可选的、缺席时会发生什么。

先把结论摊开，后面的章节是它的证据：

- **没有一处宿主服务是靠 `import` 服务类拿到的。** 消费方只声明它读到的成员（`interface LlmTextSource { stream(...) }` 这一类）；外壳种下的平台模块在本工作区根本没有安装，`ctx.slots` 一类的类型增补因此不存在，`FsTextSource`、`SessionArchiveSource`、`SlotsFace` 这些面才必须手写出来。包里因此没有 `@deepseek-ai/dsh-workspace`、`@deepseek-ai/dsh-fs` 这类运行时依赖，一个部署也就可以只组合这些能力的一个子集。
- **「必需」与「可选」是两种声明，不是两种语气。** `static inject` / `export const inject` 决定插件能不能激活；`ctx.get('key')`、`ctx.inject([...])` 与 `optionalService` 决定一次调用能不能干活。同一个服务可能在一个包里是前者、在另一个包里是后者（`llm`、`storageDomain` 都是），这个差别是排查「为什么插件根本没挂上」与「为什么这个按钮报错」的分界线。
- **可选读不许把「没有这个能力」伪装成「有一次空结果」。** 每个可选读取点都留下一个机器可读的原因（失败码、`catalogError`、`service` 字段或一条 `console.error`/`console.warn`）。
- **缺席要分清三种形态**：「服务根本没挂」给带原因的失败或干脆不注册；「服务在，但某个可选成员没有」给退化的可用结果；「这个功能没有持久记忆就会重复副作用」则**拒绝运行**，而不是降级成更弱的版本。

## 为什么是结构类型，而不是依赖宿主包

消费方只声明它读到的成员，理由写在每一处类型定义旁边。三条动机，各有落点：

1. **不把宿主运行时拖进包里，也不锁死宿主的实现。** `LlmTextSource` 只要一个方法：`stream(options)` 返回 `AsyncIterable<StreamChunk>`（[`llm-text.ts`](../../packages/memo/dsh-memo/src/llm-text.ts)）。具体的服务类、适配器注册表、凭据解析全都不在类型里出现，所以 DSH 内部换了实现类、这个包也不必跟着改。
2. **外壳种下的平台模块在这个工作区里并不存在，所以界面类型只能手写。** `SlotsFace` 的注释把原因写明：`@deepseek-ai/dsh-client-ui-slots` 是外壳种下的平台模块、本工作区不安装，`ctx.slots` 的类型增补因此在每个浏览器包都缺席；只写出这个页面真正调用的两个成员，比伪造整份声明更接近真实（[`ui-memo-settings/src/client/index.ts`](../../packages/client/ui-memo-settings/src/client/index.ts)）。`dsh-openwiki-visualize` 的右侧栏两个面同理，而它的清单里确实没有右侧栏包（[package.json](../../packages/openwiki/dsh-openwiki-visualize/package.json)）。
3. **结构类型让「部署只组合一部分」成为可表达的事实。** 没有硬依赖，就没有「装了备忘就必须装工作区服务」这种连带要求——缺哪个宿主服务只让对应能力不可用。设计文档把这条取舍写了下来：`workspaceRegistry` 与 `sessionQuery` 通过 `ctx.get()` 读取、不进 `static inject`，因此没有工作区/会话查询的 headless 部署仍能启动备忘服务（[会话总结设计](../../docs/plans/2026-10-28-memo-session-summary-design.md)）。备忘对**本仓库自己的** `telemetry` 与 `githubIssue` 仍然硬依赖，但那是它自身套件的成员，与宿主能力无关。

代价也要说清楚：结构类型不校验宿主那一侧，成员改名或语义变化不会在本仓库编译失败。这份契约的执行点因此全在测试上——每个结构性面都有一份手写的 mock 在测试里扮演宿主（见[测试落点](#测试落点)）。

**真的被 `import` 的宿主包是另一份清单，而且很短。** 结构类型挡掉的是「服务句柄」，不是所有类型：

- `@deepseek-ai/dsh-typert-protocol` 是值导入——`TypertRemoteService`、`Remote`、`remoteMethods`（`memo`、`github-issue`、`openwiki-visualize` 三个宿主包都用）。
- `@deepseek-ai/dsh-llm` 提供 `createUserMessage`、`EMPTY_RESPONSE_CODE` 与消息/流式块的类型（两个宿主包的值导入，并在 `peerDependencies` 里声明）。
- `@deepseek-ai/dsh-storage-domain` 提供 `defineDomain`、`domainTable` 与 `KvTable` 类型（[`memo/src/spec.ts`](../../packages/memo/dsh-memo/src/spec.ts)）。
- `@deepseek-ai/dsh-invariants` 只提供 `InvariantInstaller` 类型。
- 反过来，文件系统、工作区、会话、Schedule、插件管理器这几个宿主包在六个 `package.json` 里一个都不出现——它们正是「部署可以不装」的那一类。

### 结构面速查

| 结构类型 | 声明位置 | 消费方 | 只声明了哪些成员 |
|---|---|---|---|
| `LlmTextSource` | [`memo/src/llm-text.ts`](../../packages/memo/dsh-memo/src/llm-text.ts)、[`github-issue/src/llm-text.ts`](../../packages/github-issue/dsh-github-issue/src/llm-text.ts) | 两个宿主服务 | `stream(options)`，流式块 |
| `LlmModelCatalog` | [`memo/src/index.ts`](../../packages/memo/dsh-memo/src/index.ts) | `memo/listModels` | `listProviders()`、`listModels(provider)` |
| `FsTextSource` | 同上 | `memo/readExternalPath` | `resolve(path)`、`readText(target)`，目标值类型是 `unknown` |
| `SessionArchiveSource` / `SessionArchiveWorkspace` | 同上 | `memo` 的归档读取与工作区索引 | `archivedSessionIds`、`list?()`；工作区的 `id`/`title`/`path`/`sessionIds` |
| `SessionQuerySource` | 同上 | `memo` 的归档读取 | `listSessions()`、`readTitleSnapshots?()`、`readSurface(id)` |
| `ProjectionCacheSource` | 同上 | `memo` 的题名快路径 | `cachedSnapshot?()`、`cachedPredecessorTitle?()` |
| `SessionHeaderLike` / `SessionSurfaceLike` / `SessionTitleSnapshotLike` | 同上 | 同上 | 只取 `id`/`createdAt`/`cwd`/`origin` 与事件的 `type`/`seq`/`data` |
| `TelemetrySink` | [`github-issue/src/index.ts`](../../packages/github-issue/dsh-github-issue/src/index.ts) | `github-issue` | `track()`、`trackError()` |
| `GithubStorageDomain` / `GithubIntakeTable` | 同上 | `github-issue` 的接单状态 | `open(spec)`、`table(name)`、`close()`，表的 `get`/`put` |
| `GithubSessionController` | 同上 | `github-issue` 的派发 | `create({cwd?, workspaceId?, agentPreset?})`、`prompt(request, signal)`、`rename?()` |
| `GithubScheduleService` | 同上 | 同上 | `create(sessionId, {prompt, title, after_seconds})` |
| `GithubWorkspaceRegistry` / `GithubWorkspace` | 同上 | 派发时的会话摆放 | `list()` 里各工作区的 `id`/`path` |
| `SlotsFace` | [`ui-memo-settings/src/client/index.ts`](../../packages/client/ui-memo-settings/src/client/index.ts) | 设置页 | `inject(key, cb)`、`register(options, component)` |
| `RpcCaller` | [`ui-memo/src/client/controller.ts`](../../packages/client/ui-memo/src/client/controller.ts)、[`dsh-openwiki-visualize/src/client/controller.ts`](../../packages/openwiki/dsh-openwiki-visualize/src/client/controller.ts) | 两个面板与设置页 | `call(channel, endpoint, payload, signal?)` |
| `SidebarRightTabsFace` / `SidebarRightFace` | [`dsh-openwiki-visualize/src/client/index.ts`](../../packages/openwiki/dsh-openwiki-visualize/src/client/index.ts) | OpenWiki 预览 | `register(definition)`；`openTab(kind, options)`、`isExpanded?()`、`toggleExpanded?()` |
| `InstallOutcome` | [`ui-memo-settings/src/client/index.ts`](../../packages/client/ui-memo-settings/src/client/index.ts) | 设置页的更新卡片 | `pluginManager/installBundle` 的 `ChangeResult` 里读到的 `changed`/`application`/`version`/`error` |

两处例外值得点名，因为它们不是「结构类型」而是「照原样用」：`storageDomain` 与 `invariants`。前者在 `dsh-memo`、`dsh-telemetry` 里是 `static inject` 中的必需项，直接调 `this.ctx.storageDomain.open(...)`，域声明的 helper 与 `KvTable` 类型从 `@deepseek-ai/dsh-storage-domain` 引入；后者四个包（`dsh-telemetry`、`dsh-github-issue`、`dsh-memo`、`dsh-openwiki-visualize`）各带一个 `src/invariant.ts` 伴生插件，`export const inject = ['invariants']`，用 `ctx.invariants.register(packageName, install)` 为包名占位；`ui-memo` 的那一份在浏览器半边，`ui-memo-settings` 完全没有。

## 两条读取路径，以及怎么选

选哪条由一个问题决定：**缺了它，这个插件的核心职责还成立吗？**

```mermaid
flowchart TD
  A["这个宿主服务缺席时"] --> B{"插件的核心职责还成立吗"}
  B -- 不成立 --> C["写进 static inject 或 export const inject"]
  C --> C1["激活被拒绝：组合错误在启动时暴露，而不是在第一次点击时"]
  B -- 成立 --> D["用 ctx.get / ctx.inject / optionalService 读"]
  D --> D1["这次调用返回带码的业务失败"]
  D --> D2["或退化成空结果加一句说明"]
  D --> D3["或只记一条 warn，功能静默缺席"]
  D --> D4["或拒绝运行那个功能，而不是降级成会重复副作用的样子"]
```

图：必需与可选的判定，以及各自在缺席时的落点。最后一条是被持久性逼出来的，见下文 `storageDomain`。

两条路径在本仓库各有标准写法：

- **必需**：`MemoService` 的 `static inject = ['storageDomain', 'telemetry', 'githubIssue']`、`TelemetryService` 的 `['storageDomain']`、`GithubIssueService` 的 `['llm']`；浏览器侧是 `export const inject = [...]`——`ui-memo` 的 `['slots', 'layout', 'locale', 'theme', 'connection']`、`ui-memo-settings` 的 `['slots', 'locale', 'configForms', 'connection']`、`dsh-openwiki-visualize` 的 `['slots', 'locale', 'connection']`。
- **可选**：`this.ctx.get('workspaceRegistry')`、`this.ctx.get('agentDefaultModel')?.currentSelection()`、`ctx.get('connection')`、`ctx.inject(['sidebarRightTabs'], scoped => ...)`。`github-issue` 把「按字符串键取一个本包不依赖的服务」收成一个助手 `optionalService<T>(ctx, name)`，四个调用点分别是 `sessionController`、`schedule`、`workspaceRegistry`、`storageDomain`（[`src/index.ts`](../../packages/github-issue/dsh-github-issue/src/index.ts)）。

**声明必需不等于代码里就不再检查。** 本仓库有好几处两个都做了，读的时候不要把它当成冗余：

- `memo/analyzeLogs` 先 `this.ctx.get('telemetry')` 再判 `undefined`，而 `telemetry` 本来就在 `static inject` 里；`track`/`trackError` 也用 `this.ctx.get('telemetry')?.` 调用。这两支在实际组合里不可达，只在测试替身缺席时被走到。
- `memo` 的 `streamLlmText(this.ctx.get('llm'), ...)` 保留了 `LLM_UNAVAILABLE` 这一支，而 `github-issue` 把 `llm` 写进 `static inject` 却调同一个函数：理由是这份检查跟着**能力**走而不是跟着**这个包**走。memo 侧的 `llm` 确实可选，那一支在那边真会被走到；必需那一侧的同一支在实际运行中不可达——这正是[模型路由与失败事实保全](../concepts/llm-route-and-failure-facts.md)指出「`LLM_UNAVAILABLE` 没有直接断言」的原因。

**可选还要在清单里再声明一次。** `github-issue` 的 `peerDependenciesMeta` 把 `@deepseek-ai/dsh-storage-domain` 标成 `optional: true`（[package.json](../../packages/github-issue/dsh-github-issue/package.json)），于是「这个部署可以不装存储」这件事在安装期和运行期各有一份声明，且指的是同一件事。

## 宿主侧：服务键一览

| 服务键 | 本仓库读到什么 | 声明 | 缺席时 |
|---|---|---|---|
| `storageDomain` | `open(spec)` → `{ table(name), close() }`，表的 `get`/`put`/`entries` | `dsh-memo`、`dsh-telemetry` **必需**（`static inject`，在 `[Service.init]` 里打开域）；`dsh-github-issue` **可选**（`optionalService`） | 必需侧：`[Service.init]` 里拿不到域，服务无法初始化。可选侧：接单状态留空、`intakePersistent` 保持 false，首启检查**拒绝运行**并 `warn` |
| `llm` | `stream({provider, model, messages, system})` 的异步块流；`listProviders()`、`listModels(provider)` | `dsh-github-issue` **必需**；`dsh-memo` **可选**（`ctx.get`） | 可选侧：`streamLlmText` 返回 `LLM_UNAVAILABLE`；`listModels` 仍返回 `ok: true`，`providers` 为空并带 `catalogError` |
| `agentDefaultModel` | `currentSelection()` → `{provider, model}` | 两个包都**可选**（`ctx.get(...)?.`） | 跳过路由解析的第三级：`github-issue` 可能因此返回 `route-missing`，`memo` 把空串交给 `streamLlmText` 得到 `NO_MODEL_ROUTE` |
| `fs` | `resolve(path)` → 不透明目标；`readText(target)` | `dsh-memo` **可选** | `readExternalPath` 返回 `fs-unavailable`，并记一条失败事件，不抛 |
| `workspaceRegistry`（归档 + 工作区投影） | `archivedSessionIds: readonly string[]`；`list?()` 里各工作区的 `id`/`title`/`path`/`sessionIds` | `dsh-memo` **可选** | `session-service-unavailable`，失败体里带 `service: 'workspaceRegistry'`；`list` 缺席或抛出时归档会话只是不进工作区分组 |
| `workspaceRegistry`（摆放） | `list()` 里各工作区的 `id`/`path` | `dsh-github-issue` **可选** | 派发照常，会话按目录创建、落在侧栏未分组里，并 `warn` 一句 |
| `sessionQuery` | `listSessions(signal?)`、`readTitleSnapshots?(ids, signal?)`、`readSurface(id, signal?)` | `dsh-memo` **可选** | `session-service-unavailable` 且 `service: 'sessionQuery'`；见下节的逐层降级 |
| `sessionProjectionCache` | `cachedSnapshot?(header, keys?)`、`cachedPredecessorTitle?(header)` | `dsh-memo` **可选** | 题名一律走日志折叠（贵但正确）；缓存行读抛出也只当未命中 |
| `sessionController` | `create({cwd?, workspaceId?, agentPreset?})`、`prompt(request, signal)`、`rename?({sessionId, title})` | `dsh-github-issue` **可选** | 整体缺席或缺 `prompt` 时 `session-unavailable`：显式失败，不伪造一个会话；`rename` 缺席时派发照常成功，仅少一个标题 |
| `schedule` | `create(sessionId, {prompt, title, after_seconds})` | `dsh-github-issue` **可选** | 退回到 `sessionController.prompt` 直接投递；注册被拒则是 `dispatch-failed` |
| `invariants` | `register(packageName, install)` | 四个 `src/invariant.ts` 伴生插件都**必需** | 伴生插件不激活，包名占位与不变式检查缺席 |
| `telemetry`（本仓库自己的） | `track()`、`trackError()`、`analyzeForPlugin(id)` | `dsh-memo` **必需**；`dsh-github-issue` **可选** | 可选侧：事件被丢弃，全部功能照常——诊断依赖绝不能成为拒绝激活的理由（`TelemetrySink` 的注释即如此写明；`github-issue.spec.ts` 的 “works with no telemetry mounted at all” 钉住成功与失败两条路径） |
| `githubIssue`（本仓库自己的） | `generateReport()`、`prefilledIssueUrl()` | `dsh-memo` **必需** | `analyzeLogs` 仍保留 `github-issue-failure` 的防御分支，消息写明服务不可用 |

备忘对 `telemetry` 与 `githubIssue` 的硬依赖有一条连带后果：备忘服务不能在一个没装这两者的部署里单独挂上——这正是备忘套件的安装命令要把五个包一起点名、且 `memo` 的 patch 自己插入 `ui-memo` 行的原因（见[插件组合与 bundle](../architecture/plugin-composition-and-bundles.md)）。

**有一个包完全不在这张表里**：`@zhangj1164/dsh-openwiki-visualize` 的宿主半边没有任何 `inject`、也不读任何宿主服务，它靠 `child_process` 拉起 `openwiki visualize`、靠 `node:fs` 数页面，环境探测也只读 `process` 与依赖包的清单版本（[`src/index.ts`](../../packages/openwiki/dsh-openwiki-visualize/src/index.ts)）。所以「插件必须消费宿主服务」不是本仓库的规则，只是因为要跨插件协作或要读写宿主资源时才需要。

### `storageDomain`：必需的两个，可选的一个不许降级

三个宿主包里，`storageDomain` 的两种声明各有各的道理：

- **备忘与遥测必需。** 周行、季度归档、遥测事件都是持久事实，拿不到域就没有服务可言，所以两个包都在 `[Service.init]` 里 `await this.ctx.storageDomain.open(spec)`，并各挂一个 `ctx.effect` 清理（`memo.domainClose`、`memo.archiveDomainClose`、`telemetry.domainClose`）。备忘同时打开档案域，两个域各有一张表（`weeks` 与 `quarters`）。
- **接单状态可选，但不许降级。** `openIntakeState` 用 `optionalService` 取存储：没有域就直接返回，`intakePersistent` 保持 false；打开失败则记一条 `state-unavailable` 并 `warn`。`[Service.init]` 随后判：开了自动接单但没有持久状态时，**不运行**首启检查，只记 `state-unavailable` 并 `warn`，理由写在源码里——没有「已经派发过什么」的记忆，重启就会给同一个 issue 再开一个会话（[`src/index.ts`](../../packages/github-issue/dsh-github-issue/src/index.ts)）。这不是「退化成每进程一次」，而是「宁可不做」：`intake-service.spec.ts` 的 “stays off without durable state so it cannot dispatch twice” 用一个从不被调用的 `fetch` mock 钉住它（[`intake-service.spec.ts`](../../packages/github-issue/dsh-github-issue/tests/intake-service.spec.ts)）。

同一条原则在写入侧还有一层：`commitIntakeState` 先更新内存、再 `table.put`；durable 写失败只 `warn`，而且警告消息直接说出后果——不假装写成功。派发失败的那一轮也不会把「今天已查」写进去，同一条用例里存储行仍是旧值。

### `llm`：两个形状，一个服务

同一个服务在两处被读成两种互补的形状：

- **单块文本**（`LlmTextSource`）：给 `stream(options)`，收一串块，把它收敛成「文本」或「保留原因的失败」。这一层的全部规则——`text-delta` 累加、`finish` 的 `error`/`aborted` 优先、`EMPTY_RESPONSE` 与 `LLM_STREAM_THREW` 的分工、`status` 缺席就不写这个键——见[模型路由与失败事实保全](../concepts/llm-route-and-failure-facts.md)。
- **目录**（`LlmModelCatalog`）：只给 `memo/listModels` 用，因为 `listProviders()` 与 `listModels(provider)` 只有宿主能调，浏览器侧的 Remote 面根本没有 `listModels`。聚合规则（只列已注册 provider、单个 provider 抛错留在自己身上、三条降级写 `catalogError` 却仍返回成功）见同一页的路由目录一节。

结构上值得单独记住的一点：`llm` 在 `github-issue` 里是必需、在 `memo` 里是可选的**同一个服务**。所以「模型能力缺失时这个部署还能做什么」不是全局结论，而是逐包结论——没有 `llm` 的部署里备忘的存储、归档、检索全部可用，issue 生成则整个插件不在。`memo.spec.ts` 的 “degrades to an empty registry when no llm service is mounted” 用 `withoutLlm` 开关钉住可选侧：`listModels` 仍是 `ok: true`，只是 `providers` 为空且 `catalogError` 指名 `llm`（[`memo.spec.ts`](../../packages/memo/dsh-memo/tests/memo.spec.ts)）。

### `agentDefaultModel`：只回答第三级，两个包读法有细微差别

两边都是 `this.ctx.get('agentDefaultModel')?.currentSelection()`，只用于路由解析的最后一级：请求 → 服务 `Config` → 部署默认。两边都没有把它当成「配置的来源」去写，也没有在浏览器里缓存它——面板拿到的路由是 `memo/listModels` 报回来的那个值。

一处真实的不一致：`github-issue` 的 `resolveRoute` 用 `firstNonBlank` 把空白串当成「未提供」丢掉，因此可能整体返回 `undefined` 并给出 `route-missing`；`memo` 的 `resolveRoute` 用 `??` 串联，字面空串会被保留下来（再由 `streamLlmText` 的前置判断报 `NO_MODEL_ROUTE`）。读 `agentDefaultModel` 的代码改动时，这条差别决定了「部署把某个字段留空」会走哪条分支。

### `workspaceRegistry` 与 `sessionQuery`：把容错分成三层

这一对服务是「可选读」的最佳样本，因为同一个功能对两者做了三种不同的容错：

1. **服务整体缺席** → 整个 Remote 方法返回 `session-service-unavailable`，且 `service` 字段指名是哪一个。这是有意的：一个空的会话选择列表与「读不到会话服务」是两件事，前者会让用户以为没有归档会话。`listArchivedSessions` 与 `summarizeSession` 各做一次同样的双服务判定（[`src/index.ts`](../../packages/memo/dsh-memo/src/index.ts)），`session-summary.spec.ts` 断言的是「缺 registry 报这个码而不是空列表」。
2. **`sessionQuery` 能应答但个别调用失败** → 降级到本地容错。`listSessions()` 抛错时 `readSessionHeaders` 返回一张空 header 表而不是失败（归档集合仍然点名了会话，读不到元数据就少几个字段）；`readSurface()` 抛错时那一个会话拿到 `session-unreadable` 并落进 `outcomes`，其余会话的总结照常写入。
3. **结构上可选的方法缺席** → `readTitleSnapshots` 是可选成员，老一点的 session-query 后端没有它时，题名回退成短 id 形式（`sessionTitleOrFallback` 产出 `Session session-` 这种），会话本身不隐藏；批量读取本身抛出也只当没有标题。

`archivedSessionIds` 是「哪些会话可以总结」的唯一依据，`sessionQuery` 只负责标题、header 与内容；子会话（`origin === 'subagent'`）在宿主侧被过滤掉，因为它们是非用户的委派工作，各自总结出来只会是父会话的近似副本（`isSubagentSession`，[`session-transcript.ts`](../../packages/memo/dsh-memo/src/session-transcript.ts)）。工作区分组走 `workspaceRegistry.list()`：`session-summary.spec.ts` 断言只列出「真的持有归档会话」的工作区，没有工作区的归档会话保持未分组。

**第四个可选读取也插在这个功能里：`sessionProjectionCache`。** 折叠一个会话题名要重放整份日志，归档几十个大会话时选择器会慢到像坏了；宿主投影缓存里已经有侧栏列出过的同一份题名、零 I/O，所以先读缓存、只对缓存答不上的会话做折叠。它的两个成员都是可选的，读抛出也只算未命中；一个 `null` 题名是**真答案**（「这一行还没有题名」），会被记成空串走短 id 回退，而不是再花一次折叠去确认没有题名。`session-summary.spec.ts` 三条用例分别钉住「只折叠未缓存的」「全命中时一次折叠都不做」「缓存里的 null 行不再折叠」（[`session-summary.spec.ts`](../../packages/memo/dsh-memo/tests/session-summary.spec.ts)）。

```mermaid
sequenceDiagram
  participant Board as MemoBoard
  participant Svc as MemoService
  participant Registry as workspaceRegistry
  participant Query as sessionQuery
  participant Cache as sessionProjectionCache
  participant Default as agentDefaultModel
  participant Llm as llm
  Board->>Svc: listArchivedSessions 的 Remote 调用
  Svc->>Registry: 读 archivedSessionIds 与 list
  Registry-->>Svc: 归档会话 id 列表与工作区投影
  Svc->>Query: listSessions
  Query-->>Svc: header（抛出即空表）
  Svc->>Cache: cachedSnapshot 与 cachedPredecessorTitle
  Cache-->>Svc: 缓存题名或未命中
  Svc->>Query: readTitleSnapshots 只问未命中的
  Query-->>Svc: 题名或拒绝
  Svc-->>Board: 会话列表与三个上限值
  Board->>Svc: summarizeSession 带 sessionIds 与 weekId
  Svc->>Query: readSurface 逐个会话
  Query-->>Svc: 事件序列
  Svc->>Default: currentSelection
  Default-->>Svc: provider 与 model 或 undefined
  Svc->>Llm: stream 每个会话一次调用
  Llm-->>Svc: 文本增量与终块
  Svc-->>Board: outcomes 每个会话一条
```

图：一次「总结归档会话」触到的五个宿主服务，以及两个 Remote 方法的边界——浏览器只发请求、只读结果，不自己算可达性也不自己选路由。

### `fs`：只有两个方法，但失败原因要分得开

`resolve(path)` 拿到一个不透明目标，`readText(target)` 读出文本。之所以拆成两步而不是一个 `readText(path)`，是因为解析一步就包含了宿主对路径的策略判定（沙箱、允许清单），失败也发生在那一步。错误分派把 DSH 的 `FsErrorCode` 映射成本服务自己的码（`FS_NOT_FOUND`/`ENOENT` → `path-not-found`，`FS_NOT_TEXT`/`FS_NOT_REGULAR_FILE` → `path-not-text`，`FS_TOO_LARGE` → `path-too-large`，`FS_PERMISSION_DENIED`/`FS_SANDBOX_DENIED`/`EACCES`/`EPERM` → `approval-denied`，其余 → `fs-error`），读取本身靠 `code` 字段鸭子类型判断而不 `instanceof FsError`——`@deepseek-ai/dsh-fs` 不是本包的依赖（[`src/index.ts`](../../packages/memo/dsh-memo/src/index.ts)）。

`external-path.spec.ts` 用一个只在 `resolve`/`readText` 两步之一抛错的 `StubFs` 逐个覆盖这些输入码（含落到 `fs-error` 的 `FS_IO_ERROR`），单独断言「不带 `code` 的失败是 `fs-error` 而不是编一个原因」，并断言 `readExternalPath` 不在 `remoteMethods(memo)` 的端点表里——正反两条断言一起才成契约（[`external-path.spec.ts`](../../packages/memo/dsh-memo/tests/external-path.spec.ts)）。这条读取**没有 `@Remote` 端点**，所以浏览器根本发不出到达它的请求；这是能力边界而非审批边界，理由与替代形态见[能力与审批边界](../concepts/capability-and-approval-boundaries.md)。

### `sessionController`、`schedule` 与工作区：派发是几个可选服务拼起来的

派发一个新会话不是「调一个创建方法」那么简单，它要几个可选服务各出一段，且每一段的缺席都有确定语义：

1. **`sessionController.create({ cwd?, workspaceId?, agentPreset? })` 负责创建**，并且必须经它而不是直接建 Agent：控制器会应用部署的 preset、工作区归属与发布流程，所以这样建出来的会话与用户从 Web 点「新建会话」得到的一致，才会出现在侧栏、才能被继续与归档（[接单闭环设计](../../docs/plans/2026-11-02-github-issue-intake-autopilot-design.md)）。`workspaceId` 与 `cwd` 互斥，`workspacePlacement` 因此先查 `workspaceRegistry`：配置目录能按规范化路径匹配到一个已注册工作区就传 `workspaceId`（会话进侧栏分组），否则传 `cwd`（会话留在未分组）；registry 缺席、`list()` 抛出、没有匹配都退到 `cwd` 并 `warn`。创建本身抛错是 `dispatch-failed`。
2. **投递有两条路，优先 `schedule`**：`schedule.create(sessionId, { prompt, title, after_seconds })` 把提示词登记成一条到点投递的自动化任务，任务因此在 Web 的自动化板上可见；没有 Schedule 服务（非 Web 组合）时退回 `sessionController.prompt({ requestId, sessionId, mode: 'queue', content }, signal)`——就是 Web 提示词用的那条持久准入路径。两条路被拒都是 `dispatch-failed`，都不提交「今天已查」。
3. **`rename` 与派发任务标题是纯呈现**：`rename` 是可选成员，`void` 调用、失败只 `warn`——拿不到标题服务的部署仍得到一个可用会话。

**整体缺席是显式失败，不是伪造。** `dispatch` 第一行就是 `sessionController === undefined || typeof controller.prompt !== 'function'` → 返回 `session-unavailable`，消息写明「这个部署没挂带 prompt 准入的 Session 控制器，所以没有 issue 能被派发」，一个会话都不会被建出来；`intake-service.spec.ts` 里 `failures[0].code` 正是它、`dispatched` 为空，另有一条 “refuses when the deployment mounts no Session router” 直接断言 `dispatchIssue` 的同一个码（[`intake-service.spec.ts`](../../packages/github-issue/dsh-github-issue/tests/intake-service.spec.ts)）。

**注意这里判的是 `prompt`，不是 `agents`。** 本仓库当前版的派发路径只读 `sessionController`（创建 + 投递）与可选的 `schedule`；`agents.get(sessionId).agent.followup(...)` 这条更早的投递形态在当前 `src/index.ts` 与 `tests/intake-harness.ts` 里都已不存在——harness 的 `MockSessionController` 记录的字段就是 `creates` / `prompts` / `renames`。因此本页按当前源码把投递记为 `schedule.create` 与 `sessionController.prompt` 两路；如果宿主侧的 `agents` 契约仍被别处使用，那也是本仓库目前尚未消费的面。

## 浏览器侧：服务键一览

浏览器半边的服务全部是 cordis 服务键，与宿主侧同一套机制，只是由外壳提供。这张表有一列值得细读：`inject` 里的服务**多数没有代码真的设守卫**，靠 `inject` 本身保证——源码注释写的就是「`inject` 保证服务存在」。

| 服务键 | 本仓库读到什么 | 声明与守卫 | 缺席时 |
|---|---|---|---|
| `connection` | `rpc.call(channel, endpoint, payload, signal?)`（按 `RpcCaller` 结构面），以及 `connection/reset` 事件 | `ui-memo`、`dsh-openwiki-visualize` **必需**，且都先 `ctx.get` 再判空并**直接 return**；`ui-memo-settings` 也在 `inject` 里，但它判空后**不返回**，只把版本/更新卡片降级掉 | 两个面板 `console.error` 后返回，一个槽位都不注册：没有通道的面板没有意义；设置页照常注册两个页面，只是没有更新卡片 |
| `slots` | `inject(key, cb)`、`register(options, component)` | 三个包**必需**；只有 `ui-memo-settings` 先 `ctx.get` 判空 | 设置页 `console.error` 后返回（`entry.spec.tsx` 断言「不抛」）；另外两个包直接写 `ctx.slots`，缺失时在注册处抛错 |
| `locale` | `register(ns, {zh, en})`、`bind(ns)(key)`、`getLocale().active` | 三个包**必需**，不设守卫 | 在 `ctx.locale.register` 处抛错——`ui-memo` 还把当前语言随总结请求发出（决定输出语言） |
| `layout` | `selectPanel(id)`，配合 `MainPanelId` 类型 | `ui-memo` **必需**，不设守卫 | 看板「关闭」是一次面板导航，没有布局服务就没有这个动作 |
| `theme` | **没有任何方法调用**：只有 `type {}` 导入与样式里的 `--dsw-alias-*` 令牌 | `ui-memo` **必需**（`inject`） | 源码注释写明样式用 alias 令牌所以自动跟随主题；`inject` 表达的是样式层依赖外壳的主题装配 |
| `configForms` | `get(namespace)`、`whileServed(namespaces, cb)`；表单本身 `getSnapshot()`、`subscribe()`、`set(field, value)`、`unset(field)` | `ui-memo-settings` **必需**，不设守卫 | 在 `ctx.configForms.get(...)` 处抛错；一个没有表单服务的设置页只能是一片空白 |
| `sidebarRightTabs` | `register({ id, kind, multiple, title })` | `dsh-openwiki-visualize` **可选**，经 `ctx.inject([...])` 作用域读 | 标签页类型不注册，预览 pane 与入口按钮仍然贡献（环境报告与工作区探测照样有用） |
| `sidebarRight` | `openTab(kind, { params })`、`isExpanded?()`、`toggleExpanded?()` | `dsh-openwiki-visualize` **可选**（`ctx.get`） | 点入口按钮时 `console.warn` 并放弃打开：没有右侧栏就没有可打开的落点 |

四处细节是这张表的要害：

**`sidebarRightTabs` 用 `ctx.inject` 而不是一次 `ctx.get`。** 右侧栏插件自己的工厂可能排在预览插件之后，一次 `apply()` 时的读取会**静默地什么都不注册**。`ctx.inject(['sidebarRightTabs'], scoped => ...)` 把注册推迟到服务存在那一刻，并在 `scoped.effect` 里挂 disposer；测试专门复刻了「回调到手时服务还没到，之后才提供」这个顺序（`tests/entry.spec.tsx` 的 “registers the tab type when the registry arrives after apply”）。

**`sidebarRight` 的成员是可选的，因为它只是尽力而为。** `openTab` 一定会被调用，而「展开」只在调用方能判断时才做：`isExpanded?.() === false` 才 `toggleExpanded?.()`，无条件 toggle 会把用户本来就展开的栏收起来。两条路径各有一条用例（“reveals a collapsed column, and leaves an expanded one alone”）。

**`connection` 在两个面板与设置页上的处理不同，这条差异是有意的。** 两个面板的每一件事都经 RPC，所以缺通道时 `console.error` 后整个 `apply()` 返回；设置页除更新卡片外只依赖 `configForms` 与 `slots`，卡片拿不到通道就整块不注入 `update`（`face()` 里的 `...(update === undefined ? {} : { update })`），页面照常可用。

**设置页的 `configForms.whileServed` 是第五种缺席形态：命名空间没被服务就一个页面都不注册。** 两个页面外还包着一层「宿主是否服务这个命名空间」，所以没装 `github-issue` 的部署连 intake 页的表单都不会创建（`entry.spec.tsx` 的 “registers nothing while the namespaces are not served”）。

## 模块表：三套名字与能直接够到哪些服务

浏览器半边的产物是一个闭包工厂（`window.__ModuleLoader__.load({ id, factory })`），它的 `require` 由外壳的模块表应答。因此**一个包能直接 `require` 什么**是被结构限定的：外壳的平台种子（`PLATFORM_MODULES` 里那 11 个词）、`dsh.client.inject` 里声明的行、以及 `dsh.client.external` 里声明的精确 specifier（[`tsdown.client.ts`](../../scripts/tsdown.client.ts) 的 `moduleTableWords`）。其余 specifier 由打包器内联，而内联另一个插件的浏览器半边会被 `dsh-client-bundle-purity` 直接判成构建错误。产物层面的规则与门禁见[宿主 ⇄ 浏览器 Remote 契约](../architecture/host-client-remote-contract.md)。

这条约束推出一条对宿主服务的结论：**一个面板不能直接够到宿主的 `llm`、`fs`、`sessionQuery` 之类的服务，因为它连它们的包都 `require` 不到；它只能走 Remote。** 这不是风格问题——DSH 把 `listProviders()`、`listModels(provider)` 只暴露给宿主，浏览器侧根本没有对应方法，所以模型目录必须由 `memo/listModels` 代理回来。

同时要区分三件常被混起来的事，它们其实是三套彼此独立的名字：

- **服务键**（`ctx.get('key')`、`export const inject`）是 cordis 的运行时查找，与包名无关：`configForms` 这个键里既没有作用域也没有包名。
- **`dsh.client.inject` 的包行**管装配顺序与模块表可应答性。`slots` 服务被三个包 `inject` 使用，却没有任何包把 `@deepseek-ai/dsh-client-ui-slots` 写进 `dsh.client.inject`——它是平台种子，外壳已经种好了。`theme` 同理：`ui-memo` 只在 `peerDependencies` 与 `dsh.client.inject` 里有 `@deepseek-ai/dsh-client-ui-theme`，`theme` 这个服务键没有对应的方法调用。
- **产物里的 `require`** 是打包结果，不必与上面两者相等。

于是三种组合在仓库里都能找到实例：服务键有、包行也有（`locale` / `connection`）；服务键有、包行靠平台种子（`slots`）；服务键有、包行与 peer 都没有（`sidebarRightTabs` / `sidebarRight`）——预览包的 `dsh.client.inject` 只有 `connection`、`locale`、`ui-renderer`、`ui-theme` 四行，`peerDependencies` 里也没有右侧栏包（[package.json](../../packages/openwiki/dsh-openwiki-visualize/package.json)）。最后一种最松散，也最依赖「缺席时自己降级」，在产物里没有任何对应的 `require`，模块表完全不参与，`ctx.inject` + `ctx.get` 是它唯一的协作通道。

设置页那条 RPC 值得单独记一笔：它的更新按钮走的是 `pluginManager/installBundle`，而不是 `memo` 自己的端点，并且请求体里带 `options: { saveExact: true, registry: check.registryUrl }`——和 `dsh plugin add` 同一条路径，profile 写锁、兼容性检查与失败回滚都归平台。`InstallOutcome` 的三种 `application` 分别落成「成功」「`cancelled` → `{ ok: false }` 且无附加原因」「`failed` 或带 `error` → `{ ok: false, reason }`」，`entry.spec.tsx` 两条用例分别钉住失败原因与取消。

## 可选读的四条规则

把上面所有可选读取点放在一起，可以看出四条会被代码直接执行的规则。加一个新的可选服务读取时，这四条是要一起满足的：

1. **缺席必须留下机器可读的原因。** `session-service-unavailable` 带 `service` 字段，`catalogError` 带一句人话，`fs-unavailable` 带 `path`。只有一句 `console.warn` 就够用的地方是那种「用户本来也不会看到差异」的能力（会话标题、右侧栏展开、派发会话的工作区分组）。
2. **不许把「读不到」折叠成「空」。** 归档会话的列表为空与工作区服务缺席是两种结论，前者是数据，后者是部署问题；模型目录是唯一一处刻意把两者都塞进成功结果的地方（`ok: true` + `catalogError`），理由是备忘看板在没有模型路由的部署里也必须能打开。
3. **一个成员坏掉不许带走整批。** 单个 provider 的目录查询抛错只写进那个 provider 的 `error`；单个会话的 `readSurface` 抛错只落进那一个 `outcome`；`listSessions` 抛错退化成空 header 表；`workspaceRegistry.list()` 抛错只让会话留在未分组。
4. **可选读在浏览器侧不许抛。** 两处「缺了就没什么可做」的读取是 `console.error` 加 `return`（两个面板的 `connection`、设置页的 `slots`），而不是让 `apply()` 抛出去——一个面板的缺席不该让整行组合失败。反过来，`inject` 里的服务代码不做防御：那意味着组合本身坏了，在第一次使用时抛错比静默少注册一半槽位更容易查。设置页对 `connection` 的处理是第三种：它在 `inject` 里，所以缺席属于组合问题，但页面主体不依赖它，于是只降级卡片而不返回。

**外加一条只对「会重复副作用」的功能成立的规则：没有持久记忆就不许跑。** 首启接单检查在有 `storageDomain` 时才开始工作，这是唯一一处「可选服务缺席导致功能拒绝运行」而不是「降级」的地方。

## 测试落点

这份契约没有编译期执行点，所以每个结构性面都靠一份手写宿主替身钉住。改动时先看这些：

- **路由与目录**：`memo/tests/harness.ts` 的 `MockLlmService` 与 `MockAgentDefaultModel`，以及它暴露的 `followAgentDefault`、`withoutLlm` 与 `llm: { catalogThrows, extraProviders }` 几个开关；`memo.spec.ts` 断言「`Config` 不钉路由时跟随 `agentDefaultModel`」与「未挂 `llm` 时降级成带 `catalogError` 的空目录」。
- **归档读取**：`tests/session-summary.spec.ts` 自己定义 `MockWorkspaceRegistry`（`archivedSessionIds` 加 `list()`）、`MockSessionQuery`（三个方法，并按 `titles`/`surfaces` 回答）与 `MockProjectionCache`，断言「缺 registry 报 `session-service-unavailable` 而不是空列表」「子会话被过滤」「读不到的会话只坏自己那一条」「只列出真正持有归档会话的工作区」「缓存命中的题名不再折叠」「缓存里的 null 行照短 id 显示」。
- **`fs`**：`tests/external-path.spec.ts` 用 `StubFs` 在两个步骤上注入带 `code` 的异常，覆盖业务码背后的九个输入码，并断言 `readExternalPath` 不在 `remoteMethods(memo)` 的端点表里——正反两条断言一起才成契约。
- **`sessionController` / `schedule` / `workspaceRegistry` / `storageDomain`**：`github-issue/tests/intake-harness.ts` 的选项就是这四个服务的缺席矩阵——`withoutSessionServices`、`withoutSchedule`、`workspaceListFails` / `workspaces`、`withoutStorage` / `storageOpenFails`，加上 `promptFails`、`scheduleCreateFails`。`intake-service.spec.ts` 用它们断言 `session-unavailable`、「无持久状态时首启检查不跑、不派发」，以及工作区匹配失败时按目录创建。
- **浏览器侧**：`ui-memo/tests/entry.spec.tsx` 断言 `inject` 的精确取值、两个槽位共享同一个 panel id，以及「缺 connection 时报错而不抛」；`ui-memo-settings/tests/entry.spec.tsx` 用 `served: false` 覆盖「命名空间没被服务就一个页面都不注册」、用 `slots: false` 覆盖「缺 slots 时不抛」；`dsh-openwiki-visualize/tests/entry.spec.tsx` 覆盖「服务晚到才注册」与「完全没有 registry 时仍贡献 pane 与入口」。

## 改动这份契约时要同步的地方

- **加一个宿主服务读取**：先回答「缺了它插件还成立吗」。必需就写进 `static inject`/`inject` 并在清单里补 `peerDependencies`；可选就用 `ctx.get`（或在 `github-issue` 里用 `optionalService`）、把包标成 `peerDependenciesMeta.optional`，并想清楚缺席时返回哪个码。
- **收窄一个结构面**：把 interface 里没用到的成员删掉，比留着一个「以后可能用」的成员更接近契约的真实形状；`FsTextSource` 的目标值刻意是 `unknown`，这类「不解释宿主的值」的选择要保住。
- **换一个服务键的拼写**：`ctx.get('...')` 里的字符串、测试的 mock `super(ctx, '...')`、以及文档里的失败码 `service` 字段必须一起改；三处都不会编译失败。
- **给浏览器包加一个跨插件依赖**：先判断它是平台种子、还是要声明的行；另一个插件的浏览器半边必须同时进 `inject` 与 `external`，而纯类型引用什么都不用做。这条与[宿主 ⇄ 浏览器 Remote 契约](../architecture/host-client-remote-contract.md)的构建小节是同一件事。
- **外壳升级**：`scripts/tsdown.client.ts` 的 `PLATFORM_MODULES` 要跟着种子表增删。本仓库目前没有任何 `dsh.client.external` 行。

## 相关页面

- [宿主 ⇄ 浏览器 Remote 契约](../architecture/host-client-remote-contract.md)——两侧发布的字面量、线上形状、双层信封与产物门禁。
- [模型路由与失败事实保全](../concepts/llm-route-and-failure-facts.md)——`llm` 这一半的完整规则：三级路由、失败事实、宿主侧目录聚合。
- [能力与审批边界](../concepts/capability-and-approval-boundaries.md)——为什么 `readExternalPath` 留在宿主内、以及 turn 之间的宿主副作用清单。
- [配置与热生效](../concepts/configuration-and-live-settings.md)——`configForms` 写入的 `volatile` 语义与设置页的生效路径。
- [备忘服务](../systems/memo-service.md)——这张表里读取点最密的宿主包。
- [GitHub Issue 服务](../systems/github-issue-service.md)——`sessionController`/`schedule`/`storageDomain` 三个可选读取的实际用途。
- [Issue 接单与 Session 派发循环](../workflows/issue-intake-autopilot.md)——派发路径、去重与提交顺序的完整工作流。
- [备忘设置页](../systems/memo-settings-ui.md)——`configForms` 的唯一消费者，也是浏览器侧唯一设守卫读 `slots` 的包。
- [OpenWiki 预览](../systems/openwiki-visualize.md)——宿主半边不读宿主服务、浏览器半边读右侧栏两个服务的对照样本。
- [GitHub REST 集成](github-rest.md)——同一个包里唯一不经过宿主服务的那条外部通道。
