# 备忘设置页（新设置插件）设计

本文记录「为备忘插件新增 DSH Web 设置页」这一批改动的设计依据。关键事实全部来自运行时 Service/Config/Slots 取证、`cordis-plugin-loader` 源码阅读或本仓库现有实现，未采用推断。

## 目标

新增一个独立的设置插件，把 `@zhangj1164/dsh-memo` 当前只能写在 profile `cordis.patch.yml` 里的部分配置搬到 DSH Web 的 Settings 面板中，改完即生效、可单字段恢复默认值，并且不把部署级参数（存储重试、日志分析插件列表）塞进用户界面。

## 取证得到的关键事实

1. **配置表单只投影 `volatile` 字段。** `@deepseek-ai/dsh-settings` 的 `describe()` 用 `volatileForm(schema)` 生成每个 entry 的表单；一个没有 `volatile` 字段的插件在目录里根本不会出现（`dsh-settings/lib/index.js:418`、`:505` 的「has no volatile fields」）。因此备忘侧不标 `volatile` 就不可能有设置页。
2. **`volatile` 写入是热生效，不是重启。** `cordis-plugin-loader/lib/index.js:382-384`：当唯一变化的字段是 `config` 且 `equalExceptVolatile()` 成立时，走 `_commitVolatile()` 原地更新 ref，跳过 `fiber.restart()`。schemastery 的 `Schema.resolve` 在解析时用 `createVolatile(value)` 把 `.volatile()` 字段包成 ref（`schemastery/src/index.ts:521`）。
3. **ref 的读法是 `.get()`。** `dsh-bash-local` 是官方先例：`this.config = config` 后在调用点读 `this.config.timeoutMs.get()`。这决定了备忘服务必须从「构造时拷贝成普通字段」改成「保留 config、用 getter 读 ref」，否则设置页写入的值永远到不了业务代码。
4. **表单按 entry id 寻址，备忘的 id 是 `memo`。** `settings.describe()` 用 `entry.options.id` 作为 namespace（`dsh-settings/lib/index.js:429`）；`dsh --profile web --dump-config` 中备忘行的 id 就是 `memo`（`include:memo` 只是 Config Inspect 的展示前缀）。客户端因此调用 `ctx.configForms.get('memo')`。
5. **`settings.section` 是「一页一个设置页」的座位。** 注册项携带 `id`/`order`/`label`（label 为 thunk，locale 变化时重新注册），组件只收到 `close` 与注册时 `inject` 的注入面。已发布的 order：account `-10`、general `0`、models `10`、plugins `15`，备忘页取 `20`。
6. **`configForms` 的写入语义。** `ConfigForm` 有 `getSnapshot()`/`subscribe()`/`set(field, value)`/`unset(field)`/`mutate(ops, revision)`；`snapshot.user` 里字段「存在即被覆盖」，所以「已覆盖 / 恢复默认」只能依据 `user` 的键存在性判断，不能比较值。写回落在 profile 的 `cordis.patch.yml`，该 profile 的 `patchReload` 为 `live`。
7. **备忘当前没有设置页，且是被刻意去掉的。** `packages/client/ui-memo/tests/entry.spec.tsx:126` 断言不注册 `settings.section`，理由是避免同一控制器被两处渲染。本设计不改这条断言：新页面是独立包、独立控制器，看板仍是唯一入口。

## 决策记录

### 已确认的取舍

1. **范围取「用户常用子集」，不是全部字段。** 上界 9 个字段，分 4 组：AI 路由（`provider`、`model`）、归档会话总结（`sessionSummaryLanguage`、`sessionSummaryMaxSessions`、`sessionSummaryTranscriptMaxChars`、`sessionSummaryMaxChars`）、总结文案（`sessionSummarySourceTemplate`、`sessionSummaryPrompt`）、GitHub 仓库（`repoUrl`）。`storageWriteRetries`、`storageWriteRetryDelayMs`、`logAnalysisPlugins`、`sessionSummaryMaxCharsLimit` 留在 `cordis.yml`：前三个是部署级耐久性/覆盖范围参数，最后一个是对界面长度选择器的上界约束，改动它会改变另一个界面的可选范围，不适合当普通设置项。
2. **入口注册 `settings.section`，id `memo`，order `20`。** 用户要的是「设置插件」，Settings 导航页是唯一符合这个语义的座位；`plugins.item` 属于 Plugins 页的 Official 分组，第三方插件挤进去语义不对。
3. **备忘宿主全字段标 `volatile`，但只暴露上面 9 个。** 全标是为了让读法统一成 `.get()`，避免同一份 Config 一半是 ref 一半是普通值；暴露哪些由客户端决定，和 schema 无关。
4. **新插件自带 bundle 层，不挂进 memo 的 patch。** 独立包 `@zhangj1164/dsh-client-ui-memo-settings` 插入自己的 `ui-memo-settings` 行；它不依赖备忘包（只依赖 memo entry 的 id 字符串 `memo`，与官方 `ui-settings-agent-loop` 把 namespace 拼在自己代码里同一个做法）。没有备忘时 `whileServed(['memo'])` 让页面完全不出现，安装本身无害。
5. **不引 `@deepseek-ai/dsh-client-ui-primitives`。** 它在 shell 的模块表里但不在仓库依赖里，仓库现有客户端插件（ui-memo）一律用原生元素 + `--dsw-alias-*` 令牌自绘。新页面沿用同一套做法，避免为了几个输入框引入无法本地类型检查的依赖。

### 被否掉的方案

- **另立一份设置存储（新 domain / localStorage）**：会和 memo `Config` 形成两个真值来源，且 AI 路由、总结参数是宿主行为，浏览器本地存的值到不了宿主。
- **只读展示**：`configForms` 已经给了写入路径，只读等于做了个假设置页。
- **走 `configEditor` 直接改 profile 文件**：非 `volatile` 字段写入会触发插件重启，且 `configEditor` 没有 Remote 面，浏览器够不到。

## 工作项

### 1 · 备忘宿主：Config 全字段 `volatile` 化

- **范围**：`packages/memo/dsh-memo`（`src/index.ts`、`package.json`）。
- **改动**：13 个字段加 `.volatile()`；`Config` 接口对应改为 `Volatile<T>`；服务内部由「构造时拷贝 13 个字段」改为保留 `config` 并用同名 getter 读 `.get()`，25 处调用点保持原样；`@deepseek-ai/cosmokit` 进 `dependencies`（`Volatile` 类型出现在发布的 d.ts 里）。
- **验收**：`pnpm run test` 全绿；已有 12 个测试文件不因读取方式变化而失败；设置页写入后在同一个进程内立即生效（无需重启）。

### 2 · 新包 `@zhangj1164/dsh-client-ui-memo-settings`

- **范围**：新增 `packages/client/ui-memo-settings`。
- **改动**：node 半为空 `apply`（只为占住 Loader 行）；browser 半注册 `settings.section`（`id: 'memo'`、`order: 20`、locale 化 label），并自带 `dsh.bundle` patch 插入 `ui-memo-settings` 行。
- **验收**：`pnpm run verify-client-bundle-id`、`verify-bundle-entries`、`verify-package-exports` 通过；未安装备忘时 Settings 里看不到这一页。

### 3 · 表单模型与页面

- **范围**：`packages/client/ui-memo-settings/src/client`。
- **改动**：`MemoSettingsDraft` 负责「取快照 → 暂存草稿 → 逐字段保存/恢复默认 → 失败保留草稿」；页面按 4 组渲染文本框、数字框、三选一与多行文本；数字按 schema 边界校验（`1..20`、`1000..200000`、`100..4000`）；空串表示「恢复默认」（`unset`），`provider`/`model` 留空即跟随 `agentDefaultModel`。
- **验收**：单测覆盖草稿、保存、恢复默认、非法数字、只读快照；页面对 `status !== 'ready'` 显示不可用提示。

### 4 · 文档与词条

- **范围**：新包三件套 README + `README.i18n.yaml`；memo README 的 Config 表补一句「可在 Settings → 备忘 中修改」。
- **验收**：`pnpm run verify-translation-pairing`、`verify-md-links`、`verify-md-wrap` 通过。

## 风险与已知限制

- **标题/词条是本地化字符串**：中文页面上出现的 `provider`/`model` 是协议名，不翻译；`{sessionId}`、`{sessionTitle}` 占位符在提示里原样保留，翻译后会失效。
- **并发写入**：`configForms` 的 `set` 自带 revision 栅栏；同一字段在另一个页面被改过会以 Host 拒绝 → 重新读快照展示，草稿保留。
- **volatile 化是宿主行为变更**：任何依赖「改 Config 就重启插件」的自定义部署，从此改这些字段不再重启。这正是设置页需要的语义，也是官方 `bash-local` 等插件的既有语义。

## 实施结果

- 工作项 1–4 全部落地：`packages/memo/dsh-memo` 的 13 个字段均标 `.volatile()`，服务改为保留 `config` 并同名 getter 读 `.get()`，新增 `tests/config-volatile.spec.ts`（schema 全字段断言 + `updateVolatile` 后下一次调用即走新路由）；新包 `packages/client/ui-memo-settings` 含 node 半、browser 半、自有 `cordis.patch.yml`、4 组 9 字段页面与 34 个测试；新包 README 三件套与备忘、看板、根 README 同步。
- `pnpm run gates` 11 项全绿：build、test、export-jsdoc、package-exports、client-bundle-id、bundle-entries、publish-guard、translation-pairing、md-links、md-wrap、issue policy。
- 落地时新增一处设计外的小让步：浏览器读不到 schema，数字边界（`1..20`、`1000..200000`、`100..4000`）在页面里复述了一份，只用于在往返之前拦住错误输入；宿主校验仍是唯一权威，schema 改动需两边同步。
- 已在运行中的 DSH Web（`http://127.0.0.1:3080`）里目视确认：profile `web` 用 `link:` 指向本仓库的备忘宿主与看板，切到本分支并重建宿主后，Settings 里出现「备忘」页，页面写入落到 profile 的 `cordis.patch.yml` 并在运行中的备忘服务上生效。首次验证时踩到一个坑：只重建了新包（`pnpm --filter @zhangj1164/dsh-client-ui-memo-settings build`），备忘宿主的 `lib/` 还是另一个分支留下的旧产物，`volatileForm()` 因此返回 `undefined`，`describe()` 整条跳过 `memo`，页面按门控不注册也不报错；根目录 `pnpm run build` 重建宿主并重启 DSH Web 后恢复。排查顺序（先查宿主产物里的 `.volatile()`，再查 `--dump-config` 的 `ui-memo-settings` 行，最后查浏览器是否取到 `client.js`）已写进新包 README 的「本地开发与排查」。
