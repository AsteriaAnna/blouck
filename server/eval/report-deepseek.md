# 生成算法评测报告

- 时间：2026-11-14T09:25:37.918Z
- 模式：provider 直连
- provider：deepseek
- 用例数：12
- 焦点：RAG

## 汇总

| 指标 | 数值 |
| --- | --- |
| 实体 Precision | 100.0% |
| 实体 Recall | 70.0% |
| 实体 F1 | 82.4% |
| 关系对 Precision | 31.5% |
| 关系对 Recall | 46.0% |
| 线型（mapType）一致率 | 91.3% |
| 证据覆盖率 | 0.0%（当前抽取没有 evidence 字段） |
| 方向问题命中 | 3/5 |

## 逐条结果

| case | 实体 TP/FP/FN | 关系 TP/FP/FN | 线型 | 方向 | 缺失实体 | 缺失关系 |
| --- | --- | --- | --- | --- | --- | --- |
| rag-basic | 6/0/0 | 1/7/3 | 0/1 | ✓ | — | 文档分块 --related--> 向量数据库；检索 --related--> 召回；文档分块 --prerequisite--> 召回 |
| hybrid-retrieval | 6/0/1 | 5/2/1 | 5/5 | ✗ | 精排 | BM25 --contrast--> 向量数据库 |
| rerank | 3/0/3 | 2/1/2 | 2/2 | — | 精排、粗排、候选集 | Rerank --related--> 精排；Rerank --prerequisite--> 粗排 |
| evaluation | 6/0/0 | 1/7/2 | 1/1 | ✓ | — | 评测集 --related--> 召回率；评测集 --related--> 准确率 |
| chunking | 3/0/2 | 2/3/2 | 2/2 | — | 语义边界、上下文 | 分块 --related--> 语义边界；分块 --contrast--> 上下文 |
| hallucination | 5/0/1 | 2/5/2 | 1/2 | ✓ | 事实一致性 | 召回错误 --related--> 幻觉；事实一致性 --contrast--> 幻觉 |
| agent-tools | 3/0/2 | 2/3/2 | 2/2 | — | 任务规划、工具 | Agent --partOf--> 任务规划；工具调用 --related--> 工具 |
| workflow | 5/0/0 | 4/6/0 | 4/4 | — | — | — |
| embedding | 3/0/3 | 0/4/4 | 0/0 | — | 向量、向量空间、近似最近邻 | Embedding --related--> 向量；Embedding --related--> 向量空间；向量数据库 --partOf--> 近似最近邻；近似最近邻 --related--> 召回率 |
| memory | 4/0/1 | 2/2/2 | 2/2 | — | 上下文 | 短期记忆 --partOf--> 上下文；Agent --related--> 短期记忆 |
| multimodal | 2/0/5 | 0/7/5 | 0/0 | — | 多模态、文本、图片、语音、融合 | 多模态 --partOf--> 文本；多模态 --partOf--> 图片；多模态 --partOf--> 语音；表示空间 --prerequisite--> 融合；表示空间 --prerequisite--> 跨模态检索 |
| finetune-vs-rag | 3/0/3 | 2/3/2 | 2/2 | ✗ | 知识更新、风格、格式 | RAG --related--> 知识更新；微调 --related--> 风格 |

## 解读

1. **结构限制**：当前抽取 schema 的 relations 只有 `target`，没有 `source`，所以所有边都只能是「焦点 → 目标」，非焦点的实体对（如 A 前置 B）无法表达——这是关系 Recall 上不去的结构性原因。
2. **无证据字段**：抽取结果没有 evidence span，因此证据覆盖率恒为 0；这部分要等数据模型补 TranscriptSpan/relation.source。
3. **无线型判定**：provider 只返回 source/formal/suggest/direction，没有知识语义类型（前置/组成/对比），线型一致率只能检验"四类地图线"映射，检验不了教学关系。
4. **副本检测**：只有 --api 模式能评，而且依赖抽取后的图结构；规则检测的命中率应结合实例人工复核。
