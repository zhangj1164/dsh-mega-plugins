# 文件

- [本仓库消费的 DSH 宿主服务契约](dsh-host-services.md) - 逐个记录各包从 DSH 宿主与浏览器外壳读取的服务键、实际用到的成员、哪些经 static inject 或 inject 声明为必需、哪些经 ctx.get 可选读取，以及服务缺席时各自的降级与失败码；并说明为什么用结构类型而不是硬依赖，以及浏览器半边的模块表如何限制一个面板能直接够到哪些服务。
- [GitHub REST 集成与凭据](github-rest.md) - 本文说明 `GithubIssueClient` 的契约：仓库 URL 解析、createIssue 与 listClaimable 两个操作、面向可配置 API 源与固定 API 版本的请求构造、token 的三级解析与进程内一次性缓存，以及把 fetch 错误与 HTTP 状态收敛成稳定失败码的分类规则。
