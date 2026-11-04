# 文件

- [分析与导出：一次备忘分析的端到端路径](analyze-and-export.md) - 从看板点一次「分析」到账本落一条记忆的完整请求序列：类型选择留在浏览器、条目由宿主重读、路由三级解析、模型调用失败如何折成业务结果、成功时遥测与账本两条副作用，以及兄弟端点 exportReport 为何只返回 Markdown 而不写账本。
- [Issue 接单与 Session 派发循环](issue-intake-autopilot.md) - 从带接单标签的 open issue 到一个已排入提示词的 DSH 会话的完整流程，包括每日首启检查的两个拒绝点、派发历史去重、先内存后磁盘的提交顺序，以及为什么经 Session 控制器而不是 Agent 注册表派发。
- [从遥测日志分析到 GitHub Issue 报告](log-analysis-to-issue.md) - 追溯 memo.analyzeLogs 逐插件读取遥测、合并失败组、交给 github-issue 生成报告与预填 URL 的完整链路，并说明报告只允许主张哪些事实、脱敏白名单的边界，以及「无数据 / 模型调用失败 / URL 构建失败」三个失败面各自的业务码。
- [季度归档与只读：按标签归档、宿主派生周 id 与写守卫](quarter-archive-and-read-only.md) - 一次季度归档的完整路径：写入前拒绝非 `YYYY-Qn` 标签、在独立域 `memo_archive` 只存 `{ label, archivedAt }`、由宿主用星期四规则派生该季度的周 id 交给客户端、`quarter-archived` 守卫在 `addEntry`/`updateEntry`/`deleteEntry`/`summarizeSession` 四处的落点与「归档压过 force」的优先级，以及取消归档的幂等返回形状。
- [已归档会话 → 备忘周条目：资格、转写预算、每会话一次模型调用与来源标注](session-summary-to-week.md) - 「总结会话」这条路线怎么走：官方归档集合决定资格、header/标题只做表现层补全、子会话在宿主侧被过滤、对话按「只留人可见文本」提取并压进字符预算（保留首尾）、每个会话各一次模型调用、来源标注在宿主侧渲染、`originSessionId` 只能由这条路径写入，以及顶层闸门与七种单会话失败码如何让部分成功可用。
