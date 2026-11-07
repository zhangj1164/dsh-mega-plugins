# 接单派发登记为自动化任务：设计

- 关联 issue：[#165](https://github.com/zhangj1164/dsh-mega-plugins/issues/165)
- 日期：2026-11-07
- 状态：进行中

## 问题

接单成功后只在会话列表里多一个会话；Web 侧栏的「自动化任务」面板（`@deepseek-ai/dsh-client-ui-schedule`）里看不到任何接单记录，用户无法在面板中追踪"今天接了哪些单"。

DSH 的自动化任务属于会话级记录：`ctx.schedule.create(sessionId, request)` 的第一个参数是**必须已存在的会话**；到点由 `sessionController.resolveAgent(task.sessionId)` 把提示词排进那个会话（必要时恢复它），消息来源是 `schedule`。宿主不会因为一条任务去新开会话。

## 决定

1. **派发 = 建会话 + 登记一次性自动化任务。** `dispatch()` 建出会话后，若部署挂载了 Schedule 服务，就调用 `schedule.create(sessionId, { title: "Issue #N: <标题>", prompt: 渲染后的接单提示词, after_seconds: dispatchTaskDelaySeconds })`，不再直接 `prompt`。任务到点由 Schedule 服务送达，会话开始干活；面板里能看到这条任务，送达后一次性任务转为 `inactive`。
2. **没有 Schedule 服务就回退。** 非 Web 组合（TUI / headless）不挂载 `schedule`，此时沿用 `sessionController.prompt` 直接派发，行为与本设计之前一致，只是面板里没有任务。
3. **登记失败等于派发失败。** 任务登记抛错时返回 `dispatch-failed`、不提交日期键、写 telemetry 错误——与"提示词被拒"共用同一条护栏；不会出现"会话建了、任务没登记、当天却算完成"。
4. **送达失败不会静默丢失。** 任务登记成功即持久化；Schedule 服务在送达失败时保留 `active` 并在下一轮 drive 重试，所以"会话已建、提示词未送达"最终仍会送达。
5. **新增部署级配置 `dispatchTaskDelaySeconds`**（默认 1 秒，1–3600）。它不进 Settings 页：易变字段仍是原来八个，避免把部署级时序搬进浏览器界面。

## 不做的

- 不改 DSH 的 Schedule 服务：任务仍绑定一个会话，接单依旧自己建会话。想让"任务自己新开会话"需要改上游，不在本仓库范围。
- 不把 `permission` 预设写进插件的 `cordis.patch.yml`：`danger-full-access` 是部署的安全取舍，由部署方在 profile 层决定（见「部署建议」）。

## 部署建议

接单派生的会话要自己跑 `git fetch` 等联网命令，`workspace-write` 沙箱会拦网络管道并弹审批。在 profile 的 `cordis.patch.yml` 把 `permission` 行的 `defaultPreset` 设为 `danger-full-access`，新会话（含派生的）即免审批：

```yaml
- id: permission
  config:
    presets:
      read-only: { sandbox: read-only, approval: ask }
      workspace-write: { sandbox: workspace-write, approval: ask }
      danger-full-access: { sandbox: danger-full-access, approval: never }
    defaultPreset: danger-full-access
```

## 验证

- 单测：任务参数（sessionId / title / prompt / after_seconds）、无 Schedule 服务的回退路径、任务登记失败不提交日期键。
- 端到端：真实宿主启动检查派发，状态文件与 telemetry 记录 `taskId`，面板出现任务，约 1 秒后提示词进入会话并跑完一个 turn。
- 本地 `pnpm run gates` 全绿。
