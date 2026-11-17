# 文档索引

> 先看这一页，再按“当前事实 / 产品设计 / 工程 / 历史 / 原设计基线”选。  
> 文件已分区；旧的 `01-…md`、`03-…md` 等路径已迁移到子目录。

## 一句话导航

- **现在代码到底怎样** → [engineering/implemented.md](engineering/implemented.md)
- **产品想要什么、体验如何** → [product/four-line-system.md](product/four-line-system.md)
- **新人为什么看不懂、怎么简化** → [engineering/onboarding-cognitive-load.md](engineering/onboarding-cognitive-load.md)
- **锚点优先/关系准入验证过什么、有哪些坑** → [engineering/relation-gate-qa.md](engineering/relation-gate-qa.md)
- **原来设计过什么** → [baseline/README.md](baseline/README.md)

## 工程（改代码先看）

| 文档 | 用途 |
|---|---|
| [engineering/README.md](engineering/README.md) | 工程文档入口/阅读顺序 |
| [engineering/architecture.md](engineering/architecture.md) | 进程、主链路、33 路由分组、13 张表归属、改功能去哪 |
| [engineering/glossary.md](engineering/glossary.md) | 产品词 ↔ 代码词 ↔ 状态 ↔ 表 |
| [engineering/states.md](engineering/states.md) | 节点/边/方向/副本状态机 |
| [engineering/experimental.md](engineering/experimental.md) | anchorFirst/dev/ghost/WFC/hide/export 等实验/死代码/隐藏功能 |
| [engineering/implemented.md](engineering/implemented.md) | **当前代码真正实现了什么；找 bug 以它和源码为准** |
| [engineering/line-implementation-notes.md](engineering/line-implementation-notes.md) | 四类线的当前实现与迁移选项 |
| [engineering/relation-gate-qa.md](engineering/relation-gate-qa.md) | 关系准入 dev 验证、当前模型重跑、真实链路坑、是否偏离原设计 |
| [engineering/onboarding-cognitive-load.md](engineering/onboarding-cognitive-load.md) | 新工程师认知成本评估与 P0/P1/P2 简化方案 |

## 产品与设计

| 文档 | 用途 |
|---|---|
| [product/README.md](product/README.md) | 产品文档入口 |
| [product/four-line-system.md](product/four-line-system.md) | 四类线体验与设计口径 v2.0（关系线/探索线/关联提示线/顺序线；关系 MD、节点 MD、副本体验；Q1–Q7） |

## 历史（理解“为什么不是另一种做法”）

| 文档 | 用途 |
|---|---|
| [history/README.md](history/README.md) | 历史文档入口 |
| [history/ideas.md](history/ideas.md) | 之前的产品/架构设想（压缩摘要） |
| [history/reasoning.md](history/reasoning.md) | 之前尝试/推断过但未采纳的措施 |
| [history/problems.md](history/problems.md) | 使用问题、探索过程、备选方案 |
| [history/line-system-draft.md](history/line-system-draft.md) | 线系统早期设计草稿 v0 |

## 原设计基线（清理前，历史但有效）

`380c69a` 清理文档前的原文，已恢复到 [baseline/README.md](baseline/README.md)。它们是“原设计来源”，**不是当前实现依据**：

- [baseline/product-baseline.md](baseline/product-baseline.md)：节点/线/建筑、节点 MD 四区、硬规则
- [baseline/requirements.md](baseline/requirements.md)：节点/关系/方向/副本需求、游戏感、验收
- [baseline/algorithms.md](baseline/algorithms.md)：节点准入、关系 MD、方向、副本算法
- [baseline/problems-and-approaches.md](baseline/problems-and-approaches.md)：当时硬问题的尝试与未决点
- [baseline/current-state.md](baseline/current-state.md)：清理前代码状态
- [baseline/streaming-relation-binding.md](baseline/streaming-relation-binding.md)：语音流关系绑定
- [baseline/anchor-first-prototype.md](baseline/anchor-first-prototype.md)：锚点优先 dev 原型报告

历史 Git 目录：https://github.com/AsteriaAnna/blouck/tree/191853e/docs

## 市场/官网

- [marketing/web-bp-brief.md](marketing/web-bp-brief.md)：Web BP（官网/宣传页）设计 Brief，不是产品功能文档。

## 阅读路径

- **新工程师第一周**：`engineering/README.md` → `architecture.md` → `glossary.md` → `states.md` → `implemented.md`；
- **想先看“现在到底怎么了”**：`engineering/relation-gate-qa.md` → `engineering/implemented.md`；
- **想看“产品本来要什么”**：`product/four-line-system.md` → `baseline/product-baseline.md` + `baseline/requirements.md`；
- **想改代码/修 bug**：`engineering/implemented.md` + 源码 → `states.md`/`glossary.md`；
- **想讨论线/关系/副本实现**：`engineering/line-implementation-notes.md` + `engineering/relation-gate-qa.md`。

## 维护规则

- 改代码：同步 `engineering/implemented.md`；改结构/状态：同步 `architecture.md`/`states.md`/`glossary.md`；
- 新实验代码必须登记 `engineering/experimental.md`，不能悄悄进主链路；
- 旧设计只作为来源；当前产品口径以 `product/four-line-system.md` 为准；
- 文档移动后必须更新索引和交叉链接。
