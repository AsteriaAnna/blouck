# 文档索引

本仓库文档分三类：**当前事实**、**需求/设计**、**历史设计基线**。

## 当前文档

1. [01-ideas.md](01-ideas.md)：之前讨论过的产品/架构设想（压缩摘要）。**历史记录，不是实现依据。**
2. [02-reasoning.md](02-reasoning.md)：之前尝试过的思考方式、推断过但未采纳的措施。**历史记录，不是实现依据。**
3. [03-implemented.md](03-implemented.md)：**当前代码真正实现、正在使用的措施。找 bug 以这份和代码为准。**
4. [04-problems.md](04-problems.md)：使用问题、思考过程、备选方案与采纳/实施情况。**过程记录，不是实现依据。**
5. [05-line-system-draft.md](05-line-system-draft.md)：线系统的早期设计草稿（v0，研究与算法约束记录）。**不是当前需求口径。**
6. [06-four-line-system.md](06-four-line-system.md)：**四类线的体验与设计口径（v2.0）**；用户感受/视觉/交互/设计思路，含关系 MD、节点 MD、副本体验；待确认问题 Q1–Q7。
7. [07-line-implementation-notes.md](07-line-implementation-notes.md)：**四类线的当前实现与实现笔记（不是需求）**；四种 kind、节点生成真实路径、需求映射、迁移选项。
8. [08-relation-gate-qa.md](08-relation-gate-qa.md)：**锚点优先/关系准入的验证 Q&A 与现状审计**；dev 原型验证、当前模型重跑、真实链路与坑、是否偏离原设计。
9. [09-web-bp-brief.md](09-web-bp-brief.md)：Web BP（官网/宣传页）设计 Brief，交付网页设计师；不是产品功能文档。
10. [10-onboarding-cognitive-load.md](10-onboarding-cognitive-load.md)：**新工程师认知成本评估与简化方案**；命名/职责/状态/文档问题、认知成本估算、P0/P1/P2 简化路径。

## 历史设计基线（清理前，只读）

`380c69a` 曾把旧设计文档移出主目录；下面是从 Git 历史提交 `191853e`（清理前）恢复的链接，**它们是“原设计来源”，不是当前实现依据**：

- [产品基线 product-baseline.md](https://github.com/AsteriaAnna/blouck/blob/191853e/docs/reference/product-baseline.md)：节点/线/建筑、节点 MD 四区、硬规则。
- [需求 requirements.md](https://github.com/AsteriaAnna/blouck/blob/191853e/docs/design/requirements.md)：节点/关系/方向/副本的必须行为、游戏感、验收场景。
- [算法 algorithms.md](https://github.com/AsteriaAnna/blouck/blob/191853e/docs/reference/algorithms.md)：节点准入、关系 MD、方向、副本算法与已知缺口。
- [问题与方案 problems-and-approaches.md](https://github.com/AsteriaAnna/blouck/blob/191853e/docs/design/problems-and-approaches.md)：当时每个硬问题的尝试与未决点。
- [当前状态 current-state.md](https://github.com/AsteriaAnna/blouck/blob/191853e/docs/design/current-state.md)：清理前代码做到哪、卡在哪。
- [流式关系绑定 relation-binding.md](https://github.com/AsteriaAnna/blouck/blob/191853e/docs/design/streaming/relation-binding.md)：语音流关系绑定的设计。
- [锚点优先原型测试报告](https://github.com/AsteriaAnna/blouck/blob/8125bfe/docs/reviews/anchor-first-prototype-2026-11-16.md)：dev 快判/慢判原型的结果与问题（08 引用了它）。

历史目录总入口：https://github.com/AsteriaAnna/blouck/tree/191853e/docs

## 阅读路径

- 想先看“现在到底怎么了”：[08](08-relation-gate-qa.md) → [03](03-implemented.md)；
- 想看“产品本来要什么”：先看历史 [产品基线](https://github.com/AsteriaAnna/blouck/blob/191853e/docs/reference/product-baseline.md) 和 [需求](https://github.com/AsteriaAnna/blouck/blob/191853e/docs/design/requirements.md)，再看 [06](06-four-line-system.md)；
- 想改代码：只看 [03](03-implemented.md) + 源码；
- 想讨论线/关系/副本实现：[07](07-line-implementation-notes.md) + [08](08-relation-gate-qa.md)。

阅读规则：

- 要改代码、找 bug：只看 `03-implemented.md` 和源码；
- 线系统“想要什么”：看 `06`；“现在代码是什么、怎么实现”：看 `07`；“锚点优先/关系准入验证过什么、有没有坑”：看 `08`；`05` 只用于理解早期研究与算法约束；
- `01/02` 只用于理解“为什么不是另一种做法”，**不要据此新增功能**；
- `04` 只用于理解“问题从哪来、方案考虑过什么”，**不要据此假设功能已存在**；
- 文中没有写“已实现”的，就不要假设它在代码里。
