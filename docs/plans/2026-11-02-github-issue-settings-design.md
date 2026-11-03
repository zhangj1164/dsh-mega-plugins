# 接单配置进 Settings：设计

- 关联 issue：[#148](https://github.com/zhangj1164/dsh-mega-plugins/issues/148)
- 日期：2026-11-02
- 状态：已实现

## 问题

`@zhangj1164/dsh-github-issue` 的接单配置此前只能改 `cordis.patch.yml` 再重启。备忘套件已经有 Settings 页，同一套 `ctx.configForms` 机制可以覆盖接单配置：值写进 profile 的用户层，运行中的服务读新值。

## 决定

1. **第二个 settings.section，而不是扩展现有页。** `ui-memo-settings` 注册两个条目：`memo`（order 20）和 `github-issue`（order 21）。每个条目只 gate 在自己的命名空间上（`whileServed` 是 `some` 语义），因此接单页不要求先装备忘，独立部署也成立。
2. **八个字段标 `.volatile()`。** `dsh-settings` 的 `describe()` 只投影易变字段；没有易变字段的 entry 不会出现在设置面板里。这八个是：`repoUrl`、`claimLabel`、`maxIssuesPerRun`、`autopilotEnabled`、`autopilotCwd`、`autopilotPreset`、`autopilotTimeZone`、`autopilotPrompt`。
3. **服务在调用时读 `this.config.*.get()`。** Loader 对「只改易变字段」的变更原地更新引用、不重新挂载插件；构造时拷贝成实例字段的写法会让热更新只改配置对象、不改变行为。`tests/config-volatile.spec.ts` 用 `updateVolatile` 复现 Loader 的提交方式，钉住这条契约。
4. **留空即 unset。** 清空字段写入的是 unset（恢复部署默认），不是空字符串，所以清空 `claimLabel` 会回到 `ready-for-agent`，而不是列出所有 open issue。页面因此不需要「必填」校验。
5. **非法时区不抛错。** `autopilotTimeZone` 可以在运行时被改成任意字符串；`intakeTimeZone()` 校验失败时告警一次并回落到宿主时区，而不是让 `localDayKey` 抛错、打断启动检查或派发。
6. **`autopilotEnabled` 的生效时机。** 值本身即时写入 profile，但启动检查在 `Service.init` 只跑一次，所以拨动开关从下一次宿主启动生效；页面文案明确写了这一点。

## 页面

三组、八个字段：接单（`repoUrl`、`claimLabel`、`maxIssuesPerRun`，1–20）、自动派发（开关、工作目录、preset、时区）、提示词模板（`autopilotPrompt`，多行，支持五个占位符）。

共享的 `SettingsDraft` 状态机承载两个命名空间：暂存、逐字段提交、覆盖徽标、恢复默认、边界提示。备忘与接单各自提供 `FieldSpec` / `GroupSpec` 与文案解析，渲染走同一个 `SettingsSection`。

## 不做的

`token`、`tokenEnv`、`tokenCommand`、`apiBaseUrl`、`requestTimeoutMs` 不进页面：凭据与部署级传输设置不该出现在浏览器界面里。

## 验证

- `tests/config-volatile.spec.ts`：八个字段恰好易变；原地提交后下一次 `runIntake` 用新值；非法时区不抛错。
- `tests/intake-form.spec.ts`：暂存不写、数字/开关类型转换、空白即 unset、越界拒绝。
- `tests/IntakeSettingsSection.spec.tsx`：渲染、开关写布尔、空白即重置。
- `tests/entry.spec.tsx`：两个页面各自注册、各自 gate、各自的注入 face。
- 本地 `pnpm run gates` 全绿。
