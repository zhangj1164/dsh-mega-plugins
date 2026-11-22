# 文件

- [GitHub issue 服务：报告、预填 URL、建单、派发与 intake](github-issue-service.md) - dsh-github-issue 的 GithubIssueService 契约：generateReport / prefilledIssueUrl / optimizeIssue / createIssue / listClaimableIssues / dispatchIssue / runIntake 的请求形状与失败码，dispatch 的「建 Session + 登记一次性任务（无 Schedule 时回退 prompt）」两步、workspace 归一化放置与未分组回落、intake 只在有派发成功时提交本地日、以及遥测与配置分界。
- [备忘看板 UI（浏览器）](memo-board-ui.md) - 备忘套件的浏览器半边：侧栏 panellist 与键控 main 面板的注册分工、MemoController 的不可变视图状态与 args.request 线上形状、logic.ts 的四维时间线与卡片模型、localStorage 选中项与模型选择，以及分析、导出、会话总结、归档与 issue 编辑器分别调用的宿主方法。
- [备忘服务：按周存储、归档、会话、AI、日志与自更新](memo-service.md) - 宿主 MemoService 的完整方法面：19 个带 @Remote 的方法（周与时间线、归档、会话总结、模型与 AI 分析、报告导出、日志分析、自更新与版本信息、memory list）加一个刻意不注册的 readExternalPath，按能力分组给出请求/结果形状、写守卫、三条失败通道、inject 与可选服务降级、遥测锚点与账本副作用。
- [备忘设置页 UI（浏览器）](memo-settings-ui.md) - 备忘套件的 Settings 页包：两个由 `configForms.whileServed` 门控的 `settings.section` 注册（`memo` 与 `github-issue`）、共享的暂存草稿状态机、字段与分组声明表及复述的边界，以及一次保存如何成为带 revision 栅栏的热配置写入而不是重启。
- [OpenWiki 预览（宿主服务 + 浏览器半边）](openwiki-visualize.md)
- [遥测服务（宿主）](telemetry-service.md) - 说明 telemetry 这个 Cordis 宿主服务：写路径如何分配序列号并把脱敏后的事件排进存储域写链、读路径为何是同步全表扫描、listEvents 与 analyzeForPlugin 的排序与分组契约、写时与读时两遍脱敏的边界，以及它为什么不是 Remote 服务。
