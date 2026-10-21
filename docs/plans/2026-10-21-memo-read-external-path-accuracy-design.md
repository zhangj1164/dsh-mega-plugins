# 备忘 `readExternalPath` 的文档与失败码对齐设计

本文记录 #93 的处理：让文档回到方法真实行为，并让读取失败按原因分派。它**取消**了一条文档里写着的提权边界（Req 5 的「客户端调用前必须弹同意对话框」），因此需要单独留档：这不是漏做，而是确认该边界在代码里从未存在、且当前没有任何调用方可以在其之上实现。

## 目标

1. README（中英）不再声称 `readExternalPath` 会把文件作为条目加入某周——它只返回文本。
2. Req 5 改写成实际状态：没有同意对话框；边界是 `fs` 服务自身的策略加上宿主的 Remote 面。
3. 读取失败按原因给出可区分的码，而不是统一 `approval-denied`。
4. 用测试钉住两半契约：成功读取不改动任何一周；每个失败原因映射到自己的码。

## 取证得到的关键事实

- **方法只读**：`src/index.ts` 的 `readExternalPath` 是 `resolve` → `readText` → `return { ok: true, value: text }`，全仓库没有对它的一次调用，也没有一条测试；请求只有 `path`，结果只有 `string`，两侧都没有能承载「条目」的字段。
- **README 自相矛盾**：方法表写「读取本地文件路径并将其作为条目添加」，而同一份 README 的 Req 5 只要求「读路径 + 客户端调用前弹同意对话框」——Req 5 从未要求入条目。
- **客户端没有调用点**：`packages/client/ui-memo/src` 零引用 `readExternalPath`，控制器只会发 `addEntry { type: 'text' }`。没有调用方，就没有地方能弹出对话框。
- **宿主没有确认点**：`ctx.fs` 的沙箱只约束**写**；`dsh-fs-observation-policy` 明写「Direct `ctx.fs` reads emit no `fs/observed`」，所以这次读取在本进程内没有任何人工确认环节。能否从本机之外到达取决于宿主 Remote 通道的绑定与鉴权，本次未验。
- **DSH 的失败码是可分派的**：`FsErrorCode` 为 `FS_NOT_FOUND` / `FS_NOT_TEXT` / `FS_NOT_REGULAR_FILE` / `FS_TOO_LARGE` / `FS_PERMISSION_DENIED` / `FS_SANDBOX_DENIED` / `FS_IO_ERROR` 等；原实现把全部异常折成 `approval-denied`，同时 `trackError` 记的是 `FS_ERROR`，于是「不存在的文件」与「被拒绝」不解析消息就分不开，遥测与返回值也对不上。

## 决策记录

### Q1 = 文档对齐现状（A），不删方法、不在 UI 接线

方法保留，README 改为描述真实行为。否掉了另外两条：B「删掉方法与表行」（零消费者，但要动公开 Remote 表与发布物，且没有回应「读文件」这个真实需求）；C「读后入条目 + 客户端确认」（Req 5 从未要求入条目；浏览器客户端给不出宿主绝对路径）。若日后要做按 `kind/feature` 另开。

### Q2 = 把「无确认」写成事实，令牌另开 #95

一次性确认令牌本身是合理设计，但当前没有调用方，做出来无法验收，因此停在 #95 的 `needs-triage`，并在本 issue 里把「现在没有确认」当作已知边界写清楚。这比继续在文档里承诺一个不存在的对话框更诚实。

### 失败码用业务名，不用 DSH 的 `FS_*`

返回给调用方与遥测用的是同一套业务码（`path-not-found` 等），DSH 的 `FS_*` 只作为输入在内部映射一次。理由：`FS_*` 是后端实现细节，换后端就变；调用方需要的是「文件不存在」而不是「fs 后端说了 FS_NOT_FOUND」。两者同名会让调用方把内部常量当稳定契约。

## 设计

`readExternalPath` 的 catch 分支取异常上的 `code`，映射为业务码后同时用于 `trackError` 与返回的 `failure`，并附上本次尝试的 `path`（成功事件原本就记 `metadata.path`，失败事件此前没有）。

| DSH 码（或 errno） | 业务码 | 含义 |
|---|---|---|
| `FS_NOT_FOUND`、`ENOENT` | `path-not-found` | 路径不存在 |
| `FS_NOT_TEXT`、`FS_NOT_REGULAR_FILE` | `path-not-text` | 存在但不是可读的普通文本文件 |
| `FS_TOO_LARGE` | `path-too-large` | 被后端的大小上限拒绝 |
| `FS_PERMISSION_DENIED`、`FS_SANDBOX_DENIED`、`EACCES`、`EPERM` | `approval-denied` | 真正的权限或沙箱拒绝 |
| 其它（含无 `code` 的异常） | `fs-error` | 说不清原因，不猜 |
| 部署未挂 `fs` 服务 | `fs-unavailable` | 能力缺失，与方法无关 |

`ENOENT` / `EACCES` / `EPERM` 也一并映射，因为部署可以把一个薄 `node:fs` 封装当成 `fs` 服务挂上，那时异常带的是 errno 而不是 `FS_*`；不映射就会退化成 `fs-error`。

`ctx.get('fs')` 从 `any` 收成一个结构化的 `FsTextSource`（`resolve` / `readText`），目标值保持 `unknown`：本服务从不解释它，只原样交回给产出它的服务。

## 不做的事

- 不删 `readExternalPath`，不改它的返回类型，不加条目写入。
- 不给面板加导入入口——那属于 B/C 两条被否掉的方向。
- 不引入一次性确认令牌（#95）。
- 无存储 schema 变化，不涉及旧数据迁移。

## 验证

- `packages/memo/dsh-memo/tests/external-path.spec.ts`：13 条。成功读取后整份 `listWeeks` 结果与读取前完全一致（不止当前周）；未挂 `fs` → `fs-unavailable`；7 组 DSH 码 + 2 组 errno 各自映射；无 `code` 的异常 → `fs-error`；遥测记录的码与返回给调用方的码一致。
- `pnpm run gates`：11 passed, 0 failed（Node v24.19.0）。
- 修复前的读数（HEAD `76ef8c9`）：`readExternalPath` 返回 `{"ok":true,"value":"OUTSIDE-SECRET-CONTENT"}`，同周条目数前后都是 0。
