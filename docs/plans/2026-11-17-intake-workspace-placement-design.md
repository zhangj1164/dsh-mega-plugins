# 接单派发的会话归入项目工作区：设计

- 关联 issue：[#172](https://github.com/zhangj1164/dsh-mega-plugins/issues/172)
- 日期：2026-11-17
- 状态：进行中

## 问题

派发生成的会话出现在侧边栏「未分组」里，而不是 `autopilotCwd` 指向的项目工作区分组；「自动化任务」面板里对应任务也挂在一个不属于任何工作区的会话上。

原因在 DSH 的创建契约：`sessionController.create()` 只有在请求携带 `workspaceId` 时才调用 `workspace.attachSession(sessionId)`，而本插件的 `dispatch()` 只传 `cwd`。只给目录会按目录建出会话，但不会写进任何工作区的 `sessionIds`，侧边栏的 `owningGroupKey()` 因此找不到归属，落到「未分组」。另外 `cwd` 与 `workspaceId` 在同一个请求里互斥，两者同时传会被 `gateway/bad-request` 拒绝。

## 决定

1. **按配置目录匹配工作区，命中就传 `workspaceId`。** `dispatch()` 用 `firstNonBlank(request.cwd, autopilotCwd)` 得到目录，读到可选的 `workspaceRegistry` 服务后用 `normalizeWorkspacePath()` 逐个比较注册表里的 `workspace.path`：分隔符统一为 `/`、折叠重复与结尾分隔符、只在 win32/darwin 上折叠大小写。命中即创建请求只带 `{ workspaceId, agentPreset }`——控制器会从工作区自己的 `path` 推出目录并 attach，正是侧边栏分组依赖的那一步。
2. **匹配不到就退回按目录创建。** 未注册的目录、部署没有工作区层（`ctx.get("workspaceRegistry")` 为空）、注册表读取抛错，三种情况都退回现状的 `{ cwd }`，派发照常成功，只是会话留在未分组；后两种各记一条警告，方便部署方发现目录写错了。
3. **不新增 `Config` 字段。** 用户已有 `autopilotCwd`（以及 `dispatchIssue` 的单次 `cwd` 覆盖），工作区归属就是它的派生行为；再加一个「工作区 id」字段等于要求部署方手抄注册表内部 id，既易过期又和目录重复。
4. **目录归一化只做比较，不改传给控制器的值。** 命中的分支传 `workspaceId`，由工作区自己的 path 决定真实目录；归一化后的字符串从不当作路径使用。
5. **测试显式挂载工作区注册表。** 测试 harness 增加 `MockWorkspaceRegistry`，只有用例传 `workspaces` 或 `workspaceListFails` 时才挂载；默认不挂载的用例继续断言 `{ cwd }`，因此原有行为有覆盖，新行为也有独立用例。

## 不做的

- **不自动创建工作区。** 目录不在注册表里就新建一个，会改动用户侧边栏的持久状态；派发是后台行为，不该顺手改用户的组织方式。
- **不做 attach 失败重试。** 会话已经创建成功，重试只会多出第二个会话；attach 失败按 DSH 的 `session/workspace-attach-failed` 走 `dispatch-failed`，与建会话失败同一条护栏。
- **不做父目录/符号链接的模糊匹配。** 子目录算不算同一项目是部署语义，插件无法判断；`realpath` 会引入 IO 与网络盘延迟，也会让「配置值 → 会话位置」变得不可预测。
- **不改 DSH 的创建契约。** 「只给 cwd 也应该自动归组」需要上游按目录反查工作区，不在本仓库范围。

## 验证

- 单测：命中工作区时创建请求为 `{ workspaceId, agentPreset }`；分隔符与结尾分隔符差异仍命中；大小写按平台折叠；无匹配目录、注册表读取失败时退回 `{ cwd }`；`dispatchIssue` 的 `cwd` 覆盖同样参与匹配。
- 端到端：真实宿主启动检查派发后，`workspace.json` 里 `dsh-mega-plugins` 工作区的 `sessionIds` 含有新会话，侧边栏该工作区分组下出现会话，任务面板里对应任务随之可见。
- 本地 `pnpm run gates` 全绿。
