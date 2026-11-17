# 设计基线（清理前原设计，历史但有效）

这里恢复的是 `380c69a` 清理文档之前的原设计文档，来源提交：

- 设计文档：`191853e`（清理前最后一版 `docs/reference` + `docs/design`）
- 锚点优先测试报告：`8125bfe`

**它们不是当前实现依据，也不是当前需求口径。** 当前：

- 实现事实：[../engineering/implemented.md](../engineering/implemented.md)
- 当前体验/设计口径：[../product/four-line-system.md](../product/four-line-system.md)
- 当前线实现笔记：[../engineering/line-implementation-notes.md](../engineering/line-implementation-notes.md)
- 验证/坑：[../engineering/relation-gate-qa.md](../engineering/relation-gate-qa.md)

## 文件

| 文件 | 原路径 | 内容 |
|---|---|---|
| [product-baseline.md](product-baseline.md) | `docs/reference/product-baseline.md` | 节点/线/建筑、节点 MD 四区、硬规则 |
| [requirements.md](requirements.md) | `docs/design/requirements.md` | 节点/关系/方向/副本的必须行为、游戏感、验收 |
| [algorithms.md](algorithms.md) | `docs/reference/algorithms.md` | 节点准入、关系 MD、方向、副本算法、已知缺口 |
| [problems-and-approaches.md](problems-and-approaches.md) | `docs/design/problems-and-approaches.md` | 当时硬问题的尝试与未决点 |
| [current-state.md](current-state.md) | `docs/design/current-state.md` | 清理前代码做到哪、卡在哪 |
| [streaming-relation-binding.md](streaming-relation-binding.md) | `docs/design/streaming/relation-binding.md` | 语音流关系绑定设计 |
| [anchor-first-prototype.md](anchor-first-prototype.md) | `docs/reviews/anchor-first-prototype-2026-11-16.md` | 锚点优先 dev 原型测试报告 |

## 使用方式

- 想知道“原来设计过什么”：查这里；
- 想知道“现在代码是什么”：查 `../engineering/implemented.md` + 源码；
- 两者冲突时：**实现事实以 `03`/源码为准，产品意图以 `../product/four-line-system.md` 为准，本文只作为原设计来源**；
- 不要直接把本文的需求当“现在已实现”；很多只停留在设计，或后来被 MVP 删减/隐藏。
