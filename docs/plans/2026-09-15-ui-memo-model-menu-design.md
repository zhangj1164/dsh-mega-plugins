# 备忘面板模型菜单设计

本文记录「把模型选择器并入 AI 分析按钮，并覆盖全部已注册 provider」这一功能的设计。它**推翻**了上一份设计（`2026-09-15-ui-memo-model-switcher-design.md`）中的两条取舍：不再限制在单一 provider 内，选择器也不再是工具栏里的独立下拉。关键事实来自源码阅读与对 DSH 服务类型的核对（`dsh-llm/lib/types/index.d.ts`、`types.d.ts`），未采用推断。

## 目标

让用户在备忘面板内切换到**任意已注册 provider** 下的任意模型（当前部署为 `ark`、`deepseek-cu`、官方 `DeepSeek`），并把控件放在它真正作用的地方——AI 分析按钮右侧，而不是工具栏里一个需要自行对应的独立下拉。

## 决策记录

### 与上一份设计的差异

1. **跨 provider 切换（原为「不做 provider 切换」）** → 请求现在会同时携带 `provider` 与 `model`。这是有意的反转，理由见下。
2. **控件从独立下拉改为分析按钮上的分割按钮** → 由用户提出：左半仍是分析动作，右半角标点开菜单。工具栏那一行因此少一个控件。
3. **导出报告仍与 AI 分析共用这个选择** → 两者走同一套 LLM 路由，同屏出现两个不同的生效模型只会让人困惑。若将来需要拆开，控制器已按「单次覆盖」设计，扩展点就在 `modelOverride()`。

### 为什么这次可以发送 provider

上一份设计的红线是「浏览器不得自行决定模型路由」，它要防的是本仓库记录在案的那个缺陷：浏览器硬编码 provider `custom`，于是每个 AI 调用都以 `NO_ADAPTER` 失败，还被上报成「模型没有产出」。跨 provider 切换并不重犯这个缺陷，因为 provider id 不是猜测，而是**宿主自己注册表里的原文**：`llm.listProviders()` 由宿主代理返回，菜单只列其中的项，客户端也只允许发送出现在该列表里的 provider。因此不变式从「不发送 provider」收紧为「只发送宿主上报过的 provider，且只发送该 provider 上报过的模型」。

### 取证得到的关键事实

- **`llm.listProviders(): LlmProviderInfo[]` 是同步方法，且只列已注册（活着、可用）的 provider 路由**，`LlmProviderInfo` 为 `{ id, name }`，其中 `name` 是「供选择器与诊断使用的人类可读名」。所以 `cu` 在界面上显示为 `ark`。
- **`llm.listConfigurableProviders()` 会包含 dormant 项**（声明了但未配置）。这类 provider 不能真正承载调用，列出来只会让人选到必然失败的目标，因此菜单只列 `listProviders()` 的结果。
- **`llm.listModels(provider)` 只对已注册 provider 有效**，返回 `LlmModelInfo[]`（`{ provider, id, name, ... }`），并且 DSH 明确写着目录成员资格是 advisory、从不参与路由或请求校验。因此「不在目录里」不是拒绝的理由。
- **本部署的注册表**：`~/.dsh/settings.yaml` 的 `llm-pi-ai.providers` 声明了 `cu`（`displayName: ark`，模型 `glm-5-2-260617`）与 `deepseek-cu`（`deepseek-flash`、`deepseek-pro`）；此外官方自带 `DeepSeek`。当前默认路由为 `agent-default-model: { provider: deepseek-cu, model: deepseek-flash }`。
- **客户端可用的弹出层令牌**：主题 Inspect 给出的公开令牌里，`--dsw-alias-bg-overlay` 的用途正是「Overlay and popover background」，适合菜单浮层；`--dsw-alias-brand-primary`、`--dsw-alias-border-l1/l2`、`--dsw-alias-label-primary/secondary` 与状态色构成其余可用面。
- **路由优先级无需改动。** `resolveRoute(request)` 已按「请求里的 provider/model → 插件 `Config` → `agentDefaultModel`」解析，`analyze` 与 `exportReport` 都把请求原样交给它。
- **点击外部关闭需要监听器。** 看板根节点没有 `overflow: hidden`，但面板本身可能滚动；菜单做成锚定在按钮下方的绝对定位浮层，自身限高并滚动，同时用 `useEffect` 上的 `pointerdown` 监听实现点击外部关闭，而不是铺一层遮罩。

## 设计

### 宿主：`listModels` 聚合所有已注册 provider

返回 `{ ok: true, value: { provider, model, providers, catalogError? } }`：

- `provider`/`model` 仍是 `resolveRoute({})` 的结果，含义是「不覆盖时分析会用哪个」，用于「跟随默认」这一项。
- `providers` 为 `llm.listProviders()` 的顺序，每项 `{ id, name, models, error? }`，`models` 来自逐个 `llm.listModels(id)`。
- **每个 provider 独立容错**：某个 provider 的目录查询抛错只把 `error` 记在它自己身上，其余 provider 与整个结果照常。整表为空（未挂 llm、无注册 provider）时返回 `catalogError`，结果仍是 `ok`——能力缺失要可见，但不能让看板不可用。
- 遥测记录 provider 数与模型条数。

### 客户端：状态与传参

- 状态里 `models` 换成 `providers: readonly MemoCatalogProvider[]`（含每项的 `models`/`error`），另保留解析出的默认 `routeProvider`/`routeModel`。
- `selectModel(provider, model)` 记录 `{ provider, model }`；不带参数调用则清除，回到「跟随默认」。
- `analyze`/`exportReport` 在存在覆盖值时同时带上 `provider` 与 `model`。
- **持久化仍在浏览器本地**：载入时若覆盖值的 provider 已不在 `providers` 中即丢弃（provider 被移除或改名后，旧值已无法工作）。模型是否仍在目录中只作建议，不参与丢弃判定。

### 客户端：分割按钮与菜单

- `[ AI 分析 |▾ ]`：左半沿用现有 `analyze` 点击行为（使用当前选中的类型），右半是 `aria-haspopup="menu"` 的角标按钮；按钮旁用小字显示当前生效模型，使不开菜单也能看出用的是哪个。
- 菜单为 `role="menu"`，首项「跟随默认（`<provider> · <model>`）」，其后按 provider 分组：组标题用 `name`，组内每项为一个模型的 `role="menuitemradio"`，当前生效项 `aria-checked`。模型标签取 `name`，回退到 `id`。
- 键盘与关闭：Esc 关闭并把焦点还给角标；↑/↓/Home/End 在项之间移动；点击外部关闭；打开时把焦点移到当前项。`busy` 时按钮与角标都禁用。
- 某个 provider 读不出目录时，该分组显示一条禁用说明，而不是静默隐藏——否则用户会以为 provider 消失了。
- 结果卡片继续标注实际作答的模型（宿主早已返回 `modelProvider`/`modelName`）。

### 错误处理

- 注册表整体读不出：角标禁用并说明原因，看板照常可用。
- 单个 provider 目录读不出：只影响该分组的可选项与说明。
- 调用失败：既有 `llm-failure` 已带 provider 与 model，界面照旧展示，无需新分支。

### 测试

- 宿主：多 provider 聚合与顺序；单个 provider 抛错时其余不受影响；未挂 `llm`、无注册 provider 时返回空表 + `catalogError` 且仍为 `ok`；目录成员资格不参与校验。
- 控制器：跨 provider 选择后请求同时带 `provider` 与 `model`；清除后两者都不带；provider 消失即丢弃并清除持久化；无 provider 时拒绝记录选择。
- Board：分割按钮渲染与 `aria-expanded`；菜单按 provider 分组、勾选当前项；选择后生效并显示在按钮旁；Esc 与点击外部关闭；目录不可读时禁用与说明。
- 保留 `expectNoModelRouteInRequests`：未做任何选择时，任何请求都不得携带 `provider` 或 `model`。

## 实施顺序

1. 设计文档提交。
2. 宿主聚合 + 类型 + 遥测 + 宿主测试。
3. 客户端状态、持久化、传参与控制器测试。
4. 分割按钮、菜单、文案与样式 + Board 测试。
5. 双语 README 与 `README.i18n.yaml` 重录，跑门禁，PR。

## 本次不包含

- dormant（声明但未配置）provider 的呈现。
- reasoning effort/思考档位选择。
- 写 `agentDefaultModel`，即不改变整仓默认模型。
- 选择的服务端持久化（跨浏览器共享仍需另加宿主存储，界面结构不必再变）。
- 把目录当作请求白名单。
