# 备忘面板模型切换设计

本文记录「显示并切换备忘 AI 分析所用模型」这一功能的设计。关键事实来自源码阅读与对本部署运行时配置的核对，未采用推断；范围与持久化方式已由用户确认（选项 A：只影响备忘分析，选择存在浏览器本地）。

## 目标

让用户在备忘面板内看到「分析/导出实际会用哪个模型」，并在**当前 provider 内**换一个模型。整个能力必须建立在宿主返回的目录之上：浏览器不得自行决定模型路由，否则会重犯本仓库记录在案的那个缺陷。

## 决策记录

### 已确认的取舍

1. **范围只到备忘分析** → 仅 `analyze` 与 `exportReport` 两个调用受这个选择影响；不改 `agentDefaultModel`，因此对话与其他功能不受影响。
2. **选择存在浏览器本地** → 与既有的周期选择同层（浏览器存储），不新增宿主存储表。代价是换浏览器/换窗口不共享，这一点在文档里写明而不是让它成为意外。
3. **不做 provider 切换** → 用户的要求是「当前 provider 下模型」。跨 provider 只是目录返回范围的差别，将来要扩展不必改 UI 结构。
4. **目录为空不算失败** → 没挂 `llm` 服务、或 provider 为空时，面板仍要能用，下拉禁用并给出提示，而不是让整个看板报错。

### 取证得到的关键事实

- **路由优先级已存在，且调用链无需改动。** `resolveRoute(request)`（`packages/memo/dsh-memo/src/index.ts`）依次取请求里的 `provider`/`model`、插件 `Config`、`ctx.get('agentDefaultModel')?.currentSelection()`；`analyze` 与 `exportReport` 都已把各自的 `request` 原样交给它。因此客户端只需把选中的 `model` 放进请求即可生效，宿主侧的改动仅限于「提供目录」。
- **浏览器拿不到模型清单。** `dsh-llm` 的浏览器侧 Remote 面只有 `listProviders()`、`listConfigurableProviders()`、`discoverModels()`；`listModels(provider)` 是宿主侧服务方法。而 `LlmProviderInfo` 只有 `{ id, name }`，不含模型。所以目录必须由 dsh-memo 宿主代理返回。
- **本部署的实际路由。** `packages/memo/dsh-memo/cordis.patch.yml` 里 provider/model 留空（注释写明跟随 `agentDefaultModel`），`~/.dsh/settings.yaml` 为 `agent-default-model: { provider: deepseek-cu, model: deepseek-flash }`，该 provider 下还有 `deepseek-pro`。所以功能上线后默认显示的是 `deepseek-cu · deepseek-flash`。
- **模型目录是 advisory 的。** DSH 明确说明目录成员资格不参与路由校验，适配器可以接受未列出的模型 id。因此下拉是便利而非白名单，宿主不得把「不在目录里」变成请求拒绝。
- **分析结果已带模型身份。** `MemoAnalysis` 已包含 `modelProvider`/`modelName`，客户端当前丢弃了它们；展示「上次分析用的模型」不需要新增宿主字段。
- **控件位置。** 客户端只注册了 `sidebar.panellist` 与 `main` 两个槽位，没有设置分区，所以控件放在看板工具栏那一行，与「分析/导出/刷新」并列。

## 设计

### 宿主：新增一个 Remote 方法

`listModels(request)` → `{ ok: true, value: { provider, model, models } }`。

- `provider`/`model` 来自 `this.resolveRoute({})`，含义是「此刻分析会用哪个」。它让界面能回答「现在用的是什么模型」，而不是让用户去猜。
- `models` 来自 `ctx.get('llm')?.listModels(provider)`，逐条取 `{ id, name }`。目录是外部数据，必须原样透传，不做本地白名单。
- `llm` 未挂载、provider 为空、或目录查询抛错时，`models` 返回空数组且结果仍是 `ok`：目录缺失只应让下拉禁用，不应让面板不可用。
- 按现有约定记录遥测 `listModels`（含条数）。

### 客户端：状态、持久化与传参

- 新增 `route: { provider, model, models }` 状态，由 `refresh()` 在既有三次读取之后追加一次 `listModels` 读入；因此挂载、手动刷新、重连后都会自洽。
- 新增 `modelOverride`，持久化在浏览器存储的独立键；`analyze`/`exportReport` 在它非空时带上 `model: modelOverride`。
- **provider 变化时丢弃覆盖值**：模型 id 归 provider 所有，`deepseek-pro` 对 `cu` 无意义。判定用「实际 provider 与覆盖值记录时的 provider 是否一致」，不一致则忽略并清除，避免一个过期的覆盖值静默改变行为。

### 客户端：界面

- 工具栏新增一个下拉，首项固定为「跟随默认（`<provider> · <model>`）」，其余为当前 provider 下目录里的模型，标签取 `name`，回退到 `id`。
- `busy` 时禁用；目录为空时禁用并显示一行提示（复用既有的 `.dsh-memo-archiveHint` 样式族，新增一个同类提示样式）。
- 上次分析的模型显示在结果卡片上（`modelName`，必要时带 provider），使「这次是谁答的」和「下次会用谁」都可查。

### 错误处理

- `listModels` 失败（宿主未挂载等）时，客户端按空目录处理并给出提示，不阻塞看板——与归档读取的处理保持一致：能力缺失要可见，但不能让用户失去主体功能。
- 模型调用本身失败时，既有的 `llm-failure` 已经带上 provider 与 model（`llmFailure`），界面照旧展示，不需要新分支。

### 测试

- 宿主：`listModels` 返回解析后的路由；请求覆盖 > `Config` > `agentDefaultModel` 的优先级；`llm` 未挂载时目录为空但仍 `ok`；目录查询抛错时同样降级；不把目录成员资格当作校验。
- 客户端：`refresh()` 读入路由与目录；选中后 `analyze` 请求带 `model`，选「跟随默认」时不带；覆盖值持久化并可恢复；provider 变化后覆盖值被丢弃；目录为空时下拉禁用且看板仍可用。

## 实施顺序

1. 宿主方法 + 类型 + 遥测 + 宿主测试。
2. 客户端状态、持久化、`refresh` 读取与传参 + 客户端测试。
3. 界面（下拉、提示、结果卡片模型名）+ 双语文案。
4. 双语 README 与 `README.i18n.yaml` 重新录制，跑门禁。

## 本次不包含

- provider 切换（只切当前 provider 内的模型）。
- reasoning effort/思考档位选择。
- 写 `agentDefaultModel`，即不改变整仓默认模型。
- 选择的服务端持久化（将来要跨浏览器共享时，在这个 UI 之上增加宿主存储即可，不必改界面结构）。
- 把目录当作请求白名单。
