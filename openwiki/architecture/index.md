# 文件

- [宿主 ⇄ 浏览器 Remote 契约](host-client-remote-contract.md)
- [系统总览：六个插件与宿主/浏览器两侧](overview.md) - 仓库全局地图：六个包各属宿主还是浏览器半边、暴露哪个 Cordis 服务、占用哪个组合入口 id、状态落到哪个持久域叶子，以及四类新增改动（宿主能力 / 浏览器面 / 持久状态 / Remote 方法）分别落在哪里。
- [插件组合与 bundle 层](plugin-composition-and-bundles.md) - 以「每个组合入口 id 恰好一个归属 bundle」为主线，说明 DSH 部署如何按 dsh.profile.bundles 逐层应用各包的 cordis.patch.yml、安装为什么必须点名启动所需的每个包、registry 与 git 与 link 三种取得方式的差别，以及 verify-bundle-entries 门禁与 not both 出口的判据和局限。
- [存储与持久化：域、schema 与写重试](storage-and-persistence.md) - 本套件四个 storage-domain 域（memo.weeks、memo_archive.quarters、memo_telemetry.events、github_issue_intake.state）与 $DSH_HOME/memo/ledger.json 的键形状、zod 行 schema、打开失败语义、EPERM/EBUSY 写重试与降级策略，以及"坏行会拦住启动""新增字段必须可选"两条事故结论。
