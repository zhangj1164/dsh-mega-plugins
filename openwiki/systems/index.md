# 文件

- [GitHub issue 服务（宿主）](github-issue-service.md)
- [备忘看板 UI（浏览器）](memo-board-ui.md) - 备忘套件的浏览器半边：侧栏 panellist 与键控 main 面板的注册分工、MemoController 的不可变视图状态与 args.request 线上形状、logic.ts 的四维时间线与卡片模型、localStorage 选中项与模型选择，以及分析、导出、会话总结、归档与 issue 编辑器分别调用的宿主方法。
- [备忘服务（宿主）](memo-service.md) - 宿主 MemoService 的完整方法面：18 个公开方法（17 个 @Remote 端点加宿主内部的 readExternalPath）按周与时间线、归档、会话、AI、日志、记忆分组，三条失败通道与失败码，必需与可选依赖各自的降级语义，归档只读与"非当前周"force 两道写守卫，遥测锚点，以及 analyze 的账本副作用。
- [备忘设置页 UI（浏览器）](memo-settings-ui.md) - 备忘套件的 Settings 页包：两个由 `configForms.whileServed` 门控的 `settings.section` 注册（`memo` 与 `github-issue`）、共享的暂存草稿状态机、字段与分组声明表及复述的边界，以及一次保存如何成为带 revision 栅栏的热配置写入而不是重启。
- [OpenWiki 预览（宿主服务 + 浏览器半边）](openwiki-visualize.md)
- [遥测服务（宿主）](telemetry-service.md) - 说明 telemetry 这个 Cordis 宿主服务：写路径如何分配序列号并把脱敏后的事件排进存储域写链、读路径为何是同步全表扫描、listEvents 与 analyzeForPlugin 的排序与分组契约、写时与读时两遍脱敏的边界，以及它为什么不是 Remote 服务。
