# 工程文档

给要改代码的人。先读顺序：

1. [architecture.md](architecture.md)：进程、主链路、33 路由分组、13 张表归属、改功能去哪。
2. [glossary.md](glossary.md)：产品词 ↔ 代码词 ↔ 状态 ↔ 表；先解决“说的是不是同一件事”。
3. [states.md](states.md)：节点/边/方向/副本状态机；改状态前必读。
4. [canonical-state.md](canonical-state.md)：P2 canonical 线型/状态模型、direction 单一来源与分阶段重命名。
5. [experimental.md](experimental.md)：anchorFirst/dev/ghost/WFC/hide/export 等实验/死代码/隐藏功能。
6. [testing.md](testing.md)：测试命令、覆盖范围、CI、已知缺口。
7. [implemented.md](implemented.md)：当前代码真正实现了什么（找 bug 以它和源码为准）。
8. [line-implementation-notes.md](line-implementation-notes.md)：线系统的实现细节、当前 4 种 kind、迁移选项。
9. [relation-gate-qa.md](relation-gate-qa.md)：锚点优先/关系准入验证、当前模型重跑、真实链路坑。
10. [onboarding-cognitive-load.md](onboarding-cognitive-load.md)：新人认知成本与 P0/P1/P2 简化方案。

## 维护规则

- 改代码后同步 `implemented.md`（行为）和本文架构/状态（结构）；
- 新增表/字段/状态必须在 `glossary.md` + `states.md` 登记；
- 实验代码必须进 `experimental.md`，不能悄悄出现在主链路；
- 旧设计只作为来源，当前需求在 `../product/four-line-system.md`。
