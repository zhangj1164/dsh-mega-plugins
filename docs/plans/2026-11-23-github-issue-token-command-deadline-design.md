# GitHub 凭据命令的迟到时限与失败缓存设计

本文记录 #181 的处理。该 issue 是一份遥测诊断：窗口内 14 次失败分 6 组，其中只有 `github-issue:listClaimableIssues` 与 `github-issue:startupIntake` 两组 `auth-missing`（共 7 次）仍在近期发生，其余 4 组（`memo:analyze`、`memo:exportReport`、`memo:checkUpdate`、`github-issue:runIntake` 的一次派发失败）都是 13–70 天前的旧记录，之后有成功重跑，不在本次范围。诊断的误导点在于：真实原因是宿主机启动时事件循环卡顿，让一条**已经成功**的 `gh auth token` 被记成「没有配置 token」，并且这个结论被缓存到进程结束。

## 目标

1. 迟到的 token 命令时限不得丢弃已经跑完的命令输出。
2. 一次解析失败不得让整个进程此后都报 `auth-missing`；并发调用不得把「还没解析完」读成「没有凭据」。
3. 失败要让诊断读得懂：消息带上命令的实际问题，并用独立失败码把「命令失败」与「没有凭据」分组分开。
4. 用测试钉住三件事：卡顿后仍拿到 token；失败后下一次调用能恢复；并发只跑一次命令、成功结果被复用。

## 取证得到的关键事实

- **失败与启动卡顿逐次重合**。`C:\Users\zjlzld\.dsh\dsh-console.log` 显示 2026-11-18 启动在 `01:16:03.587Z` 载入插件后静默到 `01:16:13.893Z`（约 10.3 s），首个 github-issue 失败在 `01:16:13.978Z`；2026-11-23 启动在 `01:21:51.889Z` 载入后静默到 `01:22:07.134Z`（约 15 s），首个失败在 `01:22:07.201Z`。两处静默期结束时都有 `push: token 上报云端失败：云端超时` 与 `读会话失败：The operation was aborted due to timeout`。第三次（2026-11-13）早于该日志首行，无法对照。
- **`exec` 的 `timeout` 由事件循环计时器执行**。宿主卡住超过 `tokenCommandTimeoutMs`（默认 10000）时，计时器在卡顿结束后才触发，而命令早已结束。实测（Node v24.19.0，Windows）：先阻塞 1600 ms 再让内置时限 1000 ms 的 `exec` 结算——`echo tok` 与 `gh auth token` 得到 `error === null, stdout === ''`（不是 `killed`）；`node -e "process.stdout.write('tok')"` 得到 `killed: true, stdout: ''`。两种形态都让旧的 `resolveToken` 拿不到输出并返回 `undefined`。
- **失败被缓存**。旧实现先置 `tokenResolved = true` 再 `await`，失败后 `resolvedToken` 保持 `undefined`，此后每次调用都直接返回「没有凭据」；`catch` 里只 `warn` 一行，该日志不进遥测，所以诊断只看到 `auth-missing`，与 issue 里「失败后尝试次数为 0」的记录一致。
- **命令本身没坏**。交互环境下 `gh auth token` 返回 40 字符 token，`gh` 在用户与机器 PATH 中，`%APPDATA%\GitHub CLI\hosts.yml` 已登录 `zhangj1164`，`GITHUB_TOKEN` 未设置——环境配置不是原因。
- **一个已完成的命令在迟到时限下应当被采纳**：自管时限的原型（`setTimeout` 到点后 `setImmediate` 检查 `exitCode`/`signalCode`）在 300 ms 时限 + 1.5 s 卡顿下约 1616 ms 才触发，此时子进程 `exitCode === 0`，输出被正常解析；真正失败的 `exit 1` 则照原样抛出。

## 决策记录

### Q1 = 自管时限，不用 `exec` 的 `timeout`

`exec` 的时限只能「到点杀进程」，无法区分「命令还在跑」与「计时器迟到」，而后者正是本 bug。新实现 `src/token-command.ts` 的 `runTokenCommand` 不传 `timeout`，用 `setTimeout` + `setImmediate` 在到自己时限时先看子进程真实状态：已退出就放行，仍在跑才 `kill()` 并抛 `TokenCommandTimeoutError`。代价是「迟到时限」比「精确时限」多一点延迟，换来不再丢已完成命令。

### Q2 = 只缓存成功；并发共享一次解析

成功结果缓存到进程结束，避免每个请求都走一次钥匙串；失败不缓存，下一次调用重试。并发调用共享 `tokenResolution` 这个进行中的 promise，第二个调用者不会看到「尚未解析」而误报缺失。命令退出 0 但没有输出时返回「printed no output」，同样不缓存，因此永久无凭据的部署会在每次 GitHub 调用时重跑命令——本包内 `listClaimableIssues` 只被自身的 `runIntake` 调用（每天首次启动一次或用户手动触发），这个成本可以接受。

### Q3 = 新增 `credential-unresolved` 失败码

只把原因写进 `auth-missing` 的消息还不够：诊断按**错误码**分组，消息会被归并，于是「命令暂时失败」仍与「部署没有配置凭据」同组。`GithubIssueClient` 在拿到 `tokenProblem` 时返回新码 `credential-unresolved`，消息里带上经过清洗的原因（超时毫秒数、退出码、`ENOENT` 等）；没有 `tokenProblem` 时仍是 `auth-missing`。这样下一次遥测诊断会把两类分开，也能看出失败是否可重试。

### Q4 = 把子进程生命周期移到 `src/token-command.ts`

`index.ts` 已有 1400 余行，承担模型调用、接单、派发与遥测；把 `runTokenCommand`、`TokenCommandTimeoutError`、`tokenCommandProblem` 单独成文件，既缩小 `index.ts`，也让帮助函数可以脱离 harness 直接单测（`tests/token-command.spec.ts`）。

### Q5 = 只终止 shell，不承诺终止进程树

Windows 上 `child.kill()` 终止的是 `exec` 起的 `cmd.exe`，`gh.exe` 孙进程可能继续存活。跨平台终止进程树需要平台分支（Windows 的 `taskkill /T`），代价大于收益；因此 JSDoc 明确写「时限约束本服务的等待，而不是保证进程树消失」，避免把边界说大。

## 不做的事

- 不改任何 `Config` 字段、默认值或 `cordis.yml` 约定；需要的就是既有 `tokenCommand` 与 `tokenCommandTimeoutMs`。
- 不引入新依赖；只用 `node:child_process`。
- 不终止进程树（见 Q5）。
- 不把 `TokenResolution` 改成判别联合：它只有一个生产者 `resolveTokenOnce`，而该函数从不产出「既有 token 又有 problem」的状态；改类型只增加改动面，不改变任何可达行为。
- 不重排宿主启动时序：启动卡顿来自宿主自身（云端 token 上报、读会话超时），不在本包范围内；本修复只让凭据解析在其下不再被误伤。

## 验证

- `packages/github-issue/dsh-github-issue/tests/token-command.spec.ts`（9 条）：迟到时限采纳已完成命令（`node -e` 输出 `tok`，1000 ms 时限 + 2500 ms 卡顿）；仍在运行的命令被终止并报 `did not finish within 1000ms`；`exit 1` 透传退出码；`exit 0` 空输出返回空串；`tokenCommandProblem` 区分超时、数字退出码、`ERR_CHILD_PROCESS_STDIO_MAXBUFFER`、`ENOENT`、无 code。
- `tests/intake-service.spec.ts` `token resolution`（5 条）：服务层卡顿复现（修复前必失败）；真超时返回 `credential-unresolved` 且不发请求；消息带命令原因；失败后下一次调用恢复；带副作用的计数命令证明并发只跑一次、成功结果被复用。
- `tests/github.spec.ts`：带 `tokenProblem` 时返回 `credential-unresolved`，消息同时含通用说明与具体原因，且不发请求。
- `pnpm run gates`：11 passed, 0 failed（含 build、全量测试、双语配对、导出门面 JSDoc、Markdown 链接与换行、issue 策略等）。PR #188 上 CI 同套检查通过。

## 待确认

- 95%：修复已在单元/集成测试与 CI 中验证，但**真实宿主启动路径**下的效果未观测。确认方式：合并发版并重启宿主后，观察至少一次启动的遥测不再出现 `auth-missing` / `credential-unresolved` 配对，且 `startupIntake` 记录 `success`；确认前不 close #181。
- 本次只修 6 组中的两组 `auth-missing`（7 次失败）；其余 4 组按 issue 自身的新鲜度判断不构成当前缺陷，未改动。
- 若宿主卡顿时长真的超过时限、且命令仍未跑完，该次启动的 `startupIntake` 仍会失败；失败不再被缓存，后续调用会恢复，因此该次启动的遥测记录保留为真实超时。
- 永久无凭据的部署会在每次 GitHub 调用时重试命令（见 Q2 的成本说明）。
