# 文件

- [测试策略与测试接缝](testing-strategy.md) - 本仓库如何测试：根 vitest 的两条发现规则与源码别名、React/jsdom 钉版与装饰器降级，宿主 harness（真实存储域 + mock llm + 注入式 flaky JSON 后端）、浏览器半边的 fake RPC 与 FakeForm 替身、可视化插件的子进程与文件系统接缝，以及钉契约的测试、门禁 spec 与 node --test 策略套件的分工。
