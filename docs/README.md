# 知识世界 · 文档索引

最后整理：2026-11-16

---

## 0. 先看什么

如果只想快速理解项目，按这个顺序：

1. [产品新基线](reference/knowledge-world-new-baseline-2026-11-13.md)
2. [桌面 MVP 提案](reference/knowledge-world-desktop-mvp-v1.0.md)
3. [语义模型决策](design/semantic-model-decision-2026-11-14.md)
4. [生成算法 v2](design/generation-algorithm-v2.md)
5. [需求基线](design/required-implementation.md)
6. [三个硬问题的解决方案](design/three-hard-problems-solutions.md)
7. [讨论结论与待决项](design/discussion-conclusions-2026-11-16.md)

---

## 1. 核心参考（a）

### 1.1 产品基线

| 文档 | 作用 | 状态 |
| --- | --- | --- |
| [knowledge-world-new-baseline-2026-11-13.md](reference/knowledge-world-new-baseline-2026-11-13.md) | 用户提出的新产品基线 | 基线 |
| [knowledge-world-desktop-mvp-v1.0.md](reference/knowledge-world-desktop-mvp-v1.0.md) | 桌面 MVP 产品与开发方案 | 参考 |

### 1.2 核心算法 / 语义 / 副本

| 文档 | 作用 | 状态 |
| --- | --- | --- |
| [semantic-model-decision-2026-11-14.md](design/semantic-model-decision-2026-11-14.md) | 节点/关系/探索方向的语义分工 | 已确认决策 |
| [generation-algorithm-v2.md](design/generation-algorithm-v2.md) | 概念节点、归类定位、边缘方向 | 设计稿 |
| [dungeon-generation-rules.md](design/dungeon-generation-rules.md) | 流程/领域副本的识别、出现、挑战 | 设计稿 |
| [entity-relation-rules-reference.md](reviews/entity-relation-rules-reference.md) | 实体/关系生成规则的开源参考 | 外部参考 |

### 1.3 外部算法与开源参考

| 文档 | 作用 |
| --- | --- |
| [open-source-solutions-2026-11-15.md](reviews/open-source-solutions-2026-11-15.md) | 需求对照开源技术：分层结论与自研需求 |
| [open-source-solutions-addendum-2026-11-15.md](reviews/open-source-solutions-addendum-2026-11-15.md) | 第一性原理补充检索与纠偏 |
| [relation-extraction-papers.md](reviews/relation-extraction-papers.md) | 实体关系判断论文清单 |
| [relation-taxonomy-systems.md](reviews/relation-taxonomy-systems.md) | 关系体系标准/词表/规则 |
| [relation-system-rag-domain.md](reviews/relation-system-rag-domain.md) | RAG/IR 领域关系体系，最后收敛为 MD-first |

---

## 2. 追问与解决方案（b）

| 文档 | 作用 | 状态 |
| --- | --- | --- |
| [required-implementation.md](design/required-implementation.md) | 只写"必须实现什么"的需求基线 | 需求基线 |
| [three-hard-problems-solutions.md](design/three-hard-problems-solutions.md) | 节点准入 / 关系方向 / 谓词校验的方案思考、延迟实测、ghost 分析 | 方案思考 |
| [discussion-conclusions-2026-11-16.md](design/discussion-conclusions-2026-11-16.md) | 讨论结论、两种候选方法、证据审计、待决策清单 | 讨论记录 |
| [anchor-first-pipeline.md](design/anchor-first-pipeline.md) | 锚点优先链路的处理方式、状态、证据与遗漏 | dev 方案 |
| [streaming-voice-generation.md](design/streaming-voice-generation.md) | 流式语音交互、ghost、动效、多步检测 | 已实现（dev） |
| [pain-points-node-relation-dungeon.md](design/pain-points-node-relation-dungeon.md) | 最早的节点/关系/副本痛点梳理 | 历史问题 |
| [realtime-generation-task-breakdown.md](design/realtime-generation-task-breakdown.md) | 实时生成流程与任务拆解（非需求） | 历史讨论 |

---

## 3. 证据与验收

| 文档/资源 | 作用 |
| --- | --- |
| [anchor-first-prototype-2026-11-16.md](reviews/anchor-first-prototype-2026-11-16.md) | 锚点优先垂直切片测试报告 |
| [stream-ghost-ok.png](screenshots/stream-ghost-ok.png) | 候选 ghost |
| [stream-spawn.png](screenshots/stream-spawn.png) | 候选位置起飞 |
| [stream-land.png](screenshots/stream-land.png) | 落位 |
| [stream-generated-ok.png](screenshots/stream-generated-ok.png) | 生成后 |
| [stream-multi-spawn.png](screenshots/stream-multi-spawn.png) | 多步检测 spawn 证据 |
| [12-dungeon.png](screenshots/12-dungeon.png) | 副本布局 |

---

## 4. 运维/实现说明

| 文档 | 作用 |
| --- | --- |
| [ASR.md](ASR.md) | 豆包 Seed ASR Streaming 2.0 实测与接法 |
| [ASSETS.md](ASSETS.md) | 3D 资产与原型 |
| [EVAL.md](EVAL.md) | 生成算法评测脚本与基线 |

---

## 5. 已删除

按"删除旧记录/红队批判"的要求，已删除（可从此前 git 历史找回）：

- `docs/reviews/mvp-red-team-2026-11-14.md`
- `docs/reviews/requirements-red-team-2026-11-15.md`
- `docs/reviews/rag-walkthrough-2026-11-14.md`
- 旧截图 `01-home.png` 到 `11-voice.png`、`13-walkthrough.png`（保留 `12-dungeon.png`）

---

## 6. 待你决定

| 文档 | 内容 | 我的建议 |
| --- | --- | --- |
| `design/pain-points-node-relation-dungeon.md` | 最早的痛点梳理 | **合并进 discussion-conclusions 后删除**；内容已被覆盖，但保留了原始问题表述 |
| `design/realtime-generation-task-breakdown.md` | 实时生成任务拆解，自己标注"非需求基线" | **删除**；当前由 anchor-first-pipeline + streaming-voice-generation 取代 |
| `reviews/scope-decision-3d-2026-11-14.md` | 3D 纳入 MVP 的历史决策 | **保留**；PRD 仍引用它，属于有效决策记录 |
| `reviews/anchor-first-prototype-2026-11-16.md` | 原型测试报告 | **保留**；是当前实现的证据 |
| `ASR.md` / `ASSETS.md` / `EVAL.md` | 语音、资产、评测 | **保留**；属于运维/实现说明，不是旧讨论 |
| `reference/knowledge-world-desktop-mvp-v1.0.md` | 早期 PRD（含历史修订） | **保留**；产品基线的一部分 |

---

## 7. 推荐目录结构（后续可选）

当前没有强行移动文件，避免破坏已有引用。建议后续按这个结构归档：

```text
docs/
  README.md
  reference/        # 产品基线、核心算法参考
  design/           # 追问、方案、当前设计
  reviews/          # 外部研究、开源参考、测试报告
  screenshots/      # 证据截图
  ops/              # ASR / ASSETS / EVAL（可从根目录移入）
```

如果确认，我可以再按这个结构做一次物理迁移并统一更新链接。
