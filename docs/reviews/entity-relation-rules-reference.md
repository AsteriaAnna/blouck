# 实体 / 关系生成规则：网上参考案例

日期：2026-11-14
用途：为「知识世界」下一轮抽取规则设计提供参考，不改现有实现。

## 1. 参考实现

| 项目 | 实体规则 | 关系规则 | 可借鉴点 |
| --- | --- | --- | --- |
| Microsoft GraphRAG（[extract_graph.py](https://github.com/microsoft/graphrag/blob/main/packages/graphrag/graphrag/prompts/index/extract_graph.py)） | 先给定 `entity_types` 白名单；每个实体输出 `entity_name / entity_type / entity_description`；多轮 gleaning 补漏，直到模型输出 `<\|COMPLETE\|>` | 只抽取 "clearly related" 的实体对；每条关系输出 `source / target / relationship_description / relationship_strength(1-10)` | 类型白名单、关系强度、多轮补抽 |
| graphrag-rs（[ENTITY_EXTRACTION.md](https://github.com/automataia/graphrag-rs/blob/main/graphrag-core/ENTITY_EXTRACTION.md)） | 实体类型必填；置信度阈值 0.7；同名实体合并时保留更长描述（LightRAG 做法） | 关系去重；gleaning 默认 4 轮；JSON 多级容错解析 | 置信度阈值、别名合并策略、容错 |
| Neo4j LLM Graph Builder（[文档](https://neo4j.com/developer/genai-ecosystem/llm-graph-builder/)） | 先建 Document/Chunk 词法图，再抽实体；**配置 schema 后质量更高** | 关系挂到来源 Chunk 上；支持抽取后 cleanup | 来源溯源（provenance）、schema 配置、后处理 |
| LlamaIndex Property Graph（[介绍](https://www.llamaindex.ai/blog/introducing-the-property-graph-index-a-powerful-new-way-to-build-knowledge-graphs-with-llms)） | 指定允许的实体类型，抽取后校验 | 指定允许的关系类型，非法关系丢弃 | schema 约束 + 校验过滤 |
| LEC-KG（[论文](https://ar5iv.labs.arxiv.org/html/2602.02090)） | 分层输出（实体→类别→描述） | 关系分层输出 | 领域图谱的分层 schema |
| Wikontic（[AAAI](https://ojs.aaai.org/index.php/AAAI/article/view/42341/46302)） | 对齐 Wikidata 本体的实体类型 | 对齐本体关系 | 受控词表/本体对齐 |
| ACM 图谱 schema 设计（[论文](https://dl.acm.org/doi/pdf/10.1145/3840287)） | 先定义实体类型 | 先定义关系类型 | schema-first 建模 |

## 2. 共同规则（建议吸收）

1. **schema 先行**：实体类型、关系类型都给白名单，降低"什么都是概念"；
2. **实体三元组**：名称 + 类型 + 描述，而不是只有名称；
3. **关系四元组**：类型 + 描述 + 强度/置信度 + 证据片段；
4. **证据溯源**：每条实体/关系挂 `source_span`（转写片段/版本）；
5. **多轮 gleaning**：首轮抽取后继续补漏 1–2 轮，成本可控；
6. **去重与别名**：精确同名合并，同义实体用 alias 表；合并保留更长描述；
7. **严格校验**：JSON schema 校验、类型白名单过滤、数量校验（5 简答 + 10 判断）；
8. **不确定关系降级**：因果证据不足时用"可能关联 / 方向"，不写成正式事实；
9. **人工复核回路**：争议关系保留历史、暂停作为出题/副本依据；
10. **领域本体**：受控词表 + 类型层级，支持后续检索与出题。

## 3. 对「知识世界」的具体建议

实体类型（AI 产品学习域）：

- `概念`（RAG、Rerank、混合检索…）
- `方法`（精排、召回、分块…）
- `组件`（向量库、BM25、Embedding 模型…）
- `指标`（召回率、相关性、延迟…）
- `步骤`（流程中的一步）
- `问题`（用户提出的疑问）
- `工具`（Agent、工作流…）

关系类型（与现有四类地图线的关系）：

| 知识语义 | 地图线类型 |
| --- | --- |
| 依赖 / 组成 / 前置 / 对比 / 替代 | 正式关系 `formal`（需要证据） |
| 本轮从 A 探索到 B | 探索来源 `source` |
| 可能相关、证据不足 | AI 建议 `suggest`（虚线，人工确认后转正式） |
| 下一步可以往哪探索 | 方向 `direction`（问题，无 MD） |
| 用户手动连接 | 正式关系 `formal`（source=manual，可编辑不可删） |

字段建议（新增）：

- 实体：`aliases[]`、`source_span_id`、`confidence`；
- 关系：`confidence`、`evidence_span_id`、`claim_status(normal/disputed/revised)`、`revision`；
- 抽取任务：`task_id`、`world_id`、`session_id`、`span_id`、`graph_version`（幂等与旧结果拒绝）。

## 4. 与当前实现的差距

| 规则 | 当前实现 | 差距 |
| --- | --- | --- |
| 类型白名单 | 无，模型自由输出 | 需补 schema 与校验 |
| 实体描述 | 只有 hint；名称+可选 hint | 建议补 description/type |
| 关系强度/置信度 | 无 | 需补字段与展示 |
| 证据片段 | 无 | 需 TranscriptSpan + relation.source |
| 多轮 gleaning | 单次调用 | 可加 1–2 轮补漏 |
| 别名/去重 | 仅同名忽略大小写 | 需 alias 表与合并策略 |
| 数量校验 | 只 `slice(0,15)` | 需校验 5+10 与题型 |
| 不确定降级 | 有 suggest/direction | 已有雏形，可保留 |

---

*本文件为研究记录，不代表已实现；实现前需要产品确认。*
