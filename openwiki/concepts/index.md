# 文件

- [敏感能力与审批边界](capability-and-approval-boundaries.md) - 本仓库关于危险宿主能力的规则：审批只存在于 open turn 内，面板发起的 Remote 调用落在 turn 之间，因此敏感能力只有「留在宿主内、不注册 @Remote」与「把工作交给某个 turn」两种合规形态；并区分审批、宿主可判定的策略守卫与 UI 意图确认三件不同的事，附当前可达副作用清单（建单、预览启停、自更新）。
- [配置与热生效（volatile settings）](configuration-and-live-settings.md) - 本仓库的配置契约：部署可变的值是带默认值的 schemastery `Config` 字段，只有 `.volatile()` 字段会投影成设置表单，且服务必须在调用点读 ref 才真正热生效；页面写入逐字段带 revision 栅栏、留空即 unset，而混入非易变字段的改动、代码与组合变更仍需重新挂载或重启宿主，`autopilotEnabled` 则是值即时存储、行为从下一次宿主启动生效。
- [模型路由与失败事实保全](llm-route-and-failure-facts.md) - 解释一次模型调用如何按「请求 → 服务 Config → agentDefaultModel」逐半解析路由（以及这一级在两个宿主包里何时生效）、为什么路由解析失败与模型调用失败必须是两个不同的失败事实、streamLlmText 如何区分终块失败与真正的空响应并把 DSH 的 code/message/status 一路保留，以及 provider/model/status 元数据如何经遥测白名单进入 issue 报告。
- [四维周期日历（period calendar）](period-calendar.md) - 宿主与浏览器共用的唯一日历契约：四维固定标签、周一起始的 ISO-8601 周、由星期四决定年份与周期归属，以及宿主对外暴露的枚举/成员判定一对接口，使 UI 永不自行重算日历。
