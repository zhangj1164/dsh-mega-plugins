# 文件

- [构建、测试与门禁套件](build-test-and-gates.md) - 本仓库如何构建并证明自己：每包一份 tsdown 构建与共享 client preset、root vitest 配置（源码别名、装饰器降级、jsdom/React 钉版），以及 scripts/run-gates.ts 的聚合门禁图——test、build、产物门禁、hygiene、doc-sync 与 issue-policy 的依赖顺序、并发上限与本地优先规则。
- [CI、issue 策略与仓库自动化](ci-and-issue-policy.md) - GitHub 侧自动化的全景：ci.yml 如何把 gates 搬进 CI、issue-policy 与 issue-lifecycle 两个 workflow 如何以 policy.mjs 的 pr/issue/lifecycle 三个子命令强制 issue 与 PR 规则、Project Status 为什么只在仓库变量加 classic PAT 时生效、翻译配对 workflow 与定时提交 PR 的 OpenWiki 更新。
- [发布与打包](release-and-publishing.md) - 本仓库的发布契约：唯一合法的打包器是 `pnpm publish`（npm 会原样写入 `workspace:` 范围），`prepublishOnly` 上的 fail-closed 互锁与保证它不被漏接的门禁，每个 manifest 究竟发布什么，发布后如何核对 registry 副本，以及预览插件按 registry 自更新如何成为这些版本的第一个下游消费者。
