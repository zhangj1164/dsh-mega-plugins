# GitHub issue 接单闭环与每日首启自动派发

日期：2026-11-02
状态：已实现（Issue #146）
关联包：`@zhangj1164/dsh-github-issue`、`@zhangj1164/dsh-client-ui-memo`

## 背景

备忘面板的 issue 编辑器已经能把自然语言整理成固定模板（`optimizeIssue`），但闭环停在最后一步：`prefilledIssueUrl` 只是生成一个预填链接，用户必须自己打开 GitHub 表单并提交。之后也没有任何环节去读取 GitHub 上「可接单」的 issue，更没有把 issue 变成 DSH 会话的路径。于是「描述问题 → 整理 → 建单 → 接单 → 新会话处理」中的后半段全部靠人。

目标是让插件自己完成建单与接单，并复用现有的宿主能力，不修改 DSH 内核。

## 决策

### 为什么不用 Automation tasks（schedule）

现有 Automation tasks 由 `@deepseek-ai/dsh-schedule` 支撑。它的正式文档明确写了两条限制：

1. 提醒只会投递给**创建它的那个 Session**，官方不支持「每次运行新建一个 Session」；
2. 触发源只有日历时间与 cron，没有「宿主启动」这个事件。

而需求是「每天第一次启动 dsh web 时检查」。把每日 cron 硬套上去，既无法表达「首次启动」，又会被绑定会话的规则卡住。因此采用**宿主启动钩子 + 持久化本地日期**：`Service.init` 时读一次状态，只有本地日期变化才真正执行；同一天内重启直接跳过。Automation tasks 页面继续作为会话自身创建的提醒的管理入口，两者不冲突。

### 三层职责

1. **GitHub 通道**（`src/github.ts`）：只做两件事——建单与列出带接单标签的 open issue。所有 HTTP 失败归类为稳定失败码，上层不解释原始 `fetch` 错误。
2. **接单与会话**（`src/index.ts` 的 `dispatchIssue` / `runIntake`）：`runIntake` 去重后调用 `dispatchIssue`；派发经 `ctx.get('sessionController').create()` 新建会话，再经 `ctx.get('agents').get(id).agent.followup()` 排入提示词。
3. **每日首启检查**（`Service.init` + storage-domain）：本地日期与已派发 issue 持久化在 `github_issue_intake` 域里。

### 为什么走 Session 控制器而不是直接建 Agent

直接 `ctx.agents.create()` 也能跑，但会绕开 Session 控制器负责的 preset 解析、工作区归属与发布流程。经控制器创建的会话与用户在 Web 里点「新建会话」得到的会话一致，才能在侧边栏里被看见、被继续、被归档。

### 凭据

不把 token 写进代码，也不假定部署一定有环境变量。解析顺序是 `token` → `tokenEnv` → `tokenCommand`。默认命令 `gh auth token` 直接复用 `gh` CLI 已登录的凭据，因此本机（已登录 GitHub）开箱可用；其他部署可以设置 `token` 并把命令设为空字符串。token 不写日志。

## 数据与状态

`github_issue_intake` 域只有一行：

```ts
{ lastCheckedDay: '2026-11-02', dispatched: [{ number: 146, day: '2026-11-02', sessionId: '...' }] }
```

- `lastCheckedDay` 只在**列取成功之后**提交。连不上 GitHub 时保持旧值，下次启动重试；不会把失败记成「今天已检查」。
- `dispatched` 是去重依据：同一个 issue 永不派发第二次，即使它仍然是 open 状态、即使换了一天。
- 记录上限 500 条，只防止单个 JSON 文档无限增长。

没有 storage-domain 时首启检查**拒绝运行**并记录警告，而不是退化成「每进程一次」——后者会在重启后为同一个 issue 再开一个会话。

## 失败处理

| 情形 | 行为 |
|---|---|
| 没有 token | `auth-missing`，不发起请求 |
| 401 / 非限流的 403 | `auth-failure` |
| 403 且 `x-ratelimit-remaining: 0` | `rate-limited` |
| 422 | `invalid-request` |
| 网络异常 / 超时 | `network-failure` |
| 仓库 URL 不合法 | `invalid-repo` |
| 没有 sessionController / agents | `session-unavailable` |
| 建会话或排队失败 | `dispatch-failed`，不伪造成功 |

单个 issue 派发失败只记入 `failures`，不阻断同批其他 issue；列取本身失败则不提交日期。

## 测试

- `tests/github.spec.ts`：请求构造、认证头、PR 过滤、标签大小写、五种失败分类、缺失凭据不发请求。
- `tests/intake.spec.ts`：去掉重复标题、占位符替换、本地日期随时区变化。
- `tests/intake-service.spec.ts`：建单正文归一化、一次派发后再次运行跳过、日期与派发记录持久化、派发失败保留、首启按本地日期去重、无存储时不运行。
- UI：`ui-memo` 的 issue 编辑器新增「直接提交到 GitHub」按钮，调用 `createIssue` 后打开新 issue。

## 未做与后续

- 没有把「派发」做成 Automation tasks 里的一条任务：schedule 的会话绑定语义与「每次新建会话」冲突，见上。
- 没有自动把 issue 标记为「处理中」或评论认领：这需要仓库侧额外标签或 bot 身份，属于下一阶段。
- 没有自动合并 PR；会话完成后仍由人审。
- 首次启动检查是启动钩子：宿主跨午夜持续运行时，检查发生在下一次启动而不是午夜。
