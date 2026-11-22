# 文件

- [DSH 宿主服务契约：结构化读取与可选降级](dsh-host-services.md) - 各插件如何消费宿主能力而不 import 实现：llm、fs、sessionQuery、sessionProjectionCache、workspaceRegistry、sessionController、schedule、storageDomain、configForms、agentDefaultModel、connection、sidebarRight(+/Tabs)、slots、layout、locale、theme 的用法，以及「结构化声明 + ctx.get() 可选读取」如何让部分安装仍能启动。
- [GitHub REST 集成：URL 解析、端点、凭据与时序](github-rest.md) - 本文说明 `GithubIssueClient` 这一薄传输层：repository URL 解析与校验、createIssue 与 listClaimable 的端点与请求成形、面向可配置 API 源与钉死 API 版本的请求头、token 的三级解析与进程内一次性缓存，以及把 fetch 错误与 HTTP 状态收敛成稳定失败码的分类规则与测试覆盖。
