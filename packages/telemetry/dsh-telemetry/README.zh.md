# @zhangj1164/dsh-telemetry

[English](README.md) | 中文

DSH 本地进程内遥测跟踪器。基于 storage-domain KV 后端记录操作轨迹和错误日志，按特性代码锚点分组失败事件。

## 插件

`TelemetryService extends Service`，`static inject = ['storageDomain']`。服务在 `Service.init` 时打开专用存储域，并提供同步读取以供日志分析。

| 配置 | 默认值 | 含义 |
|---|---|---|
| `maxEventsPerQuery` | `500` | 一次 `listEvents` 调用返回的最大事件数。 |
| `redact` | `true` | 是否在写入事件前对敏感文本脱敏。 |
| `redactionMarker` | `[redacted:{rule}]` | 每处命中替换成的文本；`{rule}` 会替换为命中的规则名。 |
| `redactionRules` | 下列规则 | 规则集：`{ name, pattern, flags? }`，按顺序应用。 |
| `storageWriteRetries` | `4` | 持久写入因 `EPERM` / `EBUSY`（Windows 上 rename 覆盖被占用文件的竞态）失败后的额外尝试次数。`0` 表示关闭重试。 |
| `storageWriteRetryDelayMs` | `50` | 首次退避的毫秒数，每次重试翻倍，上限 5000 毫秒。只有瞬态失败才会等待。 |

## 持久写入重试

`dsh-storage-json` 以「写临时文件 → rename 覆盖目标」发布单元。Windows 上，只要杀软、索引器或另一个读句柄仍持有目标文件，这次 rename 就会以 `EPERM` 失败，而 JSON 后端会直接报错、不重试。telemetry 对 `EPERM` / `EBUSY` 按指数退避重放同一次写入，最多重试 `storageWriteRetries` 次，因此一次短暂的扫描窗口不会静默丢掉事件；其他错误立即抛出。预算耗尽后写入仍会被丢弃，因为 `track()` 是 fire-and-forget——重试只是收窄失败窗口，不会把永久性的介质故障变成成功。

## 写入时脱敏

最有排障价值的字段——`error.message`、`error.stack`，以及调用方自由填写的 `metadata`——恰恰是最容易在流转中带上绝对路径、地址与凭据的那几个。而这些记录也正是「日志分析」功能读取、并粘贴进 GitHub issue 的内容，因此这里捕获到的密钥会随下一次报告离开本机。

所以脱敏发生在**写入之前**，实现在 `src/redaction.ts`，且不可逆。规则按顺序应用，因此更具体的模式排在通用模式之前，并由它给出更有信息量的标记：token 同时也是「长且形似 base64」的串，因为 token 规则先跑，所以它被标为 `credential`。

| 规则 | 命中内容 |
|---|---|
| `email` | `jane.doe+work@example.co.uk` |
| `jwt` | `eyJ…`.`…`.`…` 这样的三段式令牌 |
| `credential` | `Bearer …` / `Basic …`、带前缀的密钥（`sk-`、`ghp_`、`github_pat_`、`xox…`、`AKIA…`、`AIza…`），以及 `api_key=` / `password:` / `secret=` 这类赋值 |
| `query-credential` | URL 里的 `?token=…`、`&key=…`、`?signature=…` |
| `home-path` | `/Users/…`、`/home/…`、`/root/…`、`/var/…`、`/tmp/…`、`/opt/…`、`/mnt/…`、`/etc/…`、`~/…`，以及 `C:\Users\…` |
| `file-url` | `file:///…` 这样的 URL |
| `absolute-path` | 其余两段及以上的绝对路径，包括 `/v1/chat/completions` |
| `unc-path` | `\\server\share\…` |
| `windows-path` | 其他任意 Windows 绝对路径 |
| `cn-id` / `cn-mobile` | 18 位身份证号与内地手机号 |
| `ipv4` / `ipv6` | 字面地址 |
| `hex` / `base64` | 长串（32 个以上十六进制字符、40 个以上 base64 字符） |

路径规则只有一处刻意收敛。像 `/api`、`/v1` 这样的裸路径片段**不**会被处理：一个连自己将来要解释的 channel 与 endpoint 名都一并打码的规则集，是没人能用来排障的规则集。两段及以上就脱敏，无论写在哪里——写进 URL 里也一样，此时主机名仍能指明服务。所有路径规则都在冒号处停止，因此栈帧里的 `path:line:column` 会保留位置信息——正是位置让这条路径值得记录。数字规则遵循同一取舍：18 位长串只有中间能读成日期时才算身份证号，普通的超长数字会原样留下。

只有字符串会被改写。非字符串叶子保持原值与类型，因此脱敏是「移除密钥」而不是「重塑日志」。既不是普通数据也不是字符串的值会被字符串化，而不是原样放过。`metadata` 缺失时仍然缺失，不会变成 `{}`——持久化 schema 对二者是区别对待的。

**不脱敏的字段**：`pluginId`、`action`、`category`、`result`、`sessionId`、`error.code`、`error.featureCodeRef`。这些是插件自己的分组键；对它们脱敏既保护不了插件本就未选择公开的任何东西，又会摧毁让日志可分析的分组能力。确需覆盖其中某项的部署可以自行加一条规则。

**规则是配置，不是常量。** 「挡住密钥」与「留够排障信息」之间的平衡因部署而异，而过宽的规则会永久损失排查线索——这正是规则集是 `Config` 字段的原因。`redactionRules` 是**整体替换**默认规则集而不是追加：某个部署若觉得某一类规则太吵——比如手机号或身份证号——只要写出它真正想要的那套规则集，就等于去掉了它。今天加的规则会改变接下来记录的内容，也会改变分析从这里起的二次读取；但它从不改写库里已有的记录。模式编译失败的规则会被丢弃而不是抛出：配置里的一个笔误不该让宿主记录不了任何东西。

## 读取时脱敏

写入时脱敏不可逆，因此某条规则出现之前就已入库的记录，会一直原样带着那条规则本该移除的内容。`analyzeForPlugin` 于是在出口处把同一套规则再跑一遍：每组失败事件携带的 `latest`，其 `error.message`、`error.stack`、`metadata` 会在分析结果离开服务之前重新过一遍规则。这正是文本变成模型提示与预填 issue 之前的最后一站，旧记录在这里被拦下。

两条性质让它既便宜又安全：只处理每组的最近一次失败——每个失败模式一次，而不是每条已存事件一次；并且幂等，因为已经带 `[redacted:…]` 标记的值不命中任何默认规则，原样返回。分组键在读取时同样保持可读，理由与写入时一致。

`listEvents` 刻意**不**做二次读取：它是宿主实际存了什么的原始视图，也从不进入报告。`redact: false` 会同时关掉两遍处理，因为部署已经明确表示要保留原样日志。

## 服务方法

| 方法 | 行为 |
|---|---|
| `track(input)` | 记录一个成功事件（异步 KV 写入，立即返回）。 |
| `trackError(input)` | 记录一个失败事件，`category` 为 `'error'`，`result` 为 `'failure'`，错误记录携带 `featureCodeRef`。 |
| `listEvents(query)` | 同步读取匹配的事件，按写入顺序倒序。支持按 `pluginId`、`category`、`result` 和时间戳范围过滤。 |
| `analyzeForPlugin(pluginId)` | 按 `featureCodeRef` 分组一个插件的所有失败事件，返回总数、本次读取的时间窗，以及每组的错误代码。每组携带的事件在出口处会重新过一遍脱敏规则。 |

## 遥测事件模型

每个事件携带 `pluginId`、`action`、`category`（`user-action` / `system` / `error`）和 `result`（`success` / `failure`）。错误事件携带 `TelemetryErrorRecord`，包含 `code`、`message` 和约定的 `featureCodeRef` — 一个稳定的代码段锚点（如 `"memo:analyze"`），日志分析步骤据此与插件特性代码关联。

## 事件顺序

每个事件还携带 `seq`，即服务在记录它时分配的单调写入序号。它才是给日志排序的东西。`Date.now()` 只数到毫秒，与被它跟随的失败落在同一毫秒的尝试，否则会被判成「不晚于」，分析就会把一次确实又跑过的失败报成「之后 0 次尝试」。序号跨重启延续——服务在打开域时从已存的最大值播种，所以同一个号不会发两次；而在该字段出现之前入库的记录读回时是 `seq: 0`，只能改由 `timestamp` 定序。两条这样的旧记录若在同一毫秒，就无法排得更准；新增这个字段的目的正是让任何新记录都不再落到那个位置。分析的 `window` 仍是一个时间戳区间：它回答的是读了哪一段，而不是哪个事件先发生。

## 分析事实

`analyzeForPlugin` 报告的不只是一个总数，因为总数无法与「当前仍在发生的问题」区分开：同一个计数既能描述上周的事故，也能描述一分钟前的事故。

- **`window`** — 本次分析读取的时间范围；该插件没有任何事件时缺省。只有该插件自己的事件参与界定它。
- **`attemptsAfterLastFailure`**（每组）— 该组最近一次失败之后，其动作的尝试次数。按动作而非全部事件计数：否则插件无关的读取会把数字抬高，让一次旧失败看起来落在一个繁忙时段里。这里的「之后」取写入顺序，因此与被计失败同一毫秒内记录的尝试仍然算数。
- **`route`**（每组）— 最近一次失败所用的 provider 与 model，前提是该事件记录过它们。区分「未记录」与「没有路由」是有意义的：在路由 metadata 出现之前记录的失败两者都没有。

`route` 按白名单（`provider`、`model`、`status`）提取，而不是整体复制事件的 `metadata`。metadata 是插件可任意填充的开放映射，而由本分析生成的报告会离开本机，因此只有这几个具名键跨越边界。

## 需求映射

- **需求 7** — 内置的仅本地遥测跟踪，封装为可复用的 DSH 插件。任何功能插件都可以调用 `ctx.telemetry.track()` / `ctx.telemetry.trackError()` 记录操作轨迹和错误日志。每个错误事件上的 `featureCodeRef` 是约定的日志格式，供日志分析功能（需求 8）与插件功能代码进行关联。
- **需求 12** — 封装为通用插件：任何 DSH 插件都可以依赖 `@zhangj1164/dsh-telemetry` 并使用 `ctx.telemetry` 记录事件，不仅限于备忘套件。

## 已知限制

- **仅宿主侧** — 服务不继承 `TypertRemoteService`；客户端不直接调用它。
- **自身没有面向用户的界面** — 本包不注册模型工具，也不附带 UI，因此单独执行 `dsh plugin --profile web add @zhangj1164/dsh-telemetry` 只增加一个服务，用户看不到任何东西。它是供其他插件消费的基础设施（`ctx.get('telemetry')`），可见界面随消费方插件一起到来——在本仓库中就是备忘看板的日志分析动作。
- **异步写入** — `track()` 和 `trackError()` 返回 `void`；KV 写入是持久且排队的，但调用者必须等待写入链完成后，同步 `listEvents()` 才能反映新事件。
