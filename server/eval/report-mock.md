# 生成算法评测报告

- 时间：2026-11-14T09:15:57.102Z
- 模式：provider 直连
- provider：mock
- 用例数：12
- 焦点：RAG

## 汇总

| 指标 | 数值 |
| --- | --- |
| 实体 Precision | 100.0% |
| 实体 Recall | 17.1% |
| 实体 F1 | 29.3% |
| 关系对 Precision | 0.0% |
| 关系对 Recall | 0.0% |
| 线型（mapType）一致率 | — |
| 证据覆盖率 | 0.0%（当前抽取没有 evidence 字段） |
| 方向问题命中 | 0/5 |

## 逐条结果

| case | 实体 TP/FP/FN | 关系 TP/FP/FN | 线型 | 方向 | 缺失实体 | 缺失关系 |
| --- | --- | --- | --- | --- | --- | --- |
| rag-basic | 1/0/5 | 0/1/4 | 0/0 | ✗ | RAG、文档分块、向量数据库、检索、大模型 | RAG --partOf--> 文档分块；文档分块 --related--> 向量数据库；检索 --related--> 召回；文档分块 --prerequisite--> 召回 |
| hybrid-retrieval | 4/0/3 | 0/1/6 | 0/0 | ✗ | 关键词召回、向量数据库、语义召回 | 混合检索 --partOf--> BM25；混合检索 --partOf--> 向量数据库；BM25 --related--> 关键词召回；向量数据库 --related--> 语义召回；BM25 --contrast--> 向量数据库；混合检索 --related--> Rerank |
| rerank | 2/0/4 | 0/1/4 | 0/0 | — | 粗排、候选集、交叉编码器、向量相似度 | Rerank --related--> 精排；Rerank --prerequisite--> 粗排；Rerank --partOf--> 交叉编码器；Rerank --contrast--> 向量相似度 |
| evaluation | 1/0/5 | 0/1/3 | 0/0 | ✗ | 召回率、准确率、延迟、离线评测、线上 A/B | 评测集 --related--> 召回率；评测集 --related--> 准确率；离线评测 --prerequisite--> 线上 A/B |
| chunking | 0/0/5 | 0/1/4 | 0/0 | — | 分块、语义边界、重叠窗口、embedding、上下文 | 分块 --related--> 语义边界；分块 --related--> 重叠窗口；分块 --prerequisite--> embedding；分块 --contrast--> 上下文 |
| hallucination | 0/0/6 | 0/1/4 | 0/0 | ✗ | 幻觉、RAG、检索证据、召回错误、事实一致性、评测 | RAG --related--> 幻觉；RAG --partOf--> 检索证据；召回错误 --related--> 幻觉；事实一致性 --contrast--> 幻觉 |
| agent-tools | 1/0/4 | 0/1/4 | 0/0 | — | 任务规划、工具调用、工具、规划能力 | Agent --partOf--> 任务规划；Agent --partOf--> 工具调用；规划能力 --prerequisite--> 工具调用；工具调用 --related--> 工具 |
| workflow | 1/0/4 | 0/1/4 | 0/0 | — | 输入解析、资料检索、草稿生成、审核发布 | 工作流 --partOf--> 输入解析；输入解析 --prerequisite--> 资料检索；资料检索 --prerequisite--> 草稿生成；草稿生成 --prerequisite--> 审核发布 |
| embedding | 0/0/6 | 0/1/4 | 0/0 | — | Embedding、向量、向量空间、向量数据库、近似最近邻、召回率 | Embedding --related--> 向量；Embedding --related--> 向量空间；向量数据库 --partOf--> 近似最近邻；近似最近邻 --related--> 召回率 |
| memory | 1/0/4 | 0/1/4 | 0/0 | — | 短期记忆、长期记忆、上下文、外部存储 | 短期记忆 --partOf--> 上下文；长期记忆 --partOf--> 外部存储；短期记忆 --contrast--> 长期记忆；Agent --related--> 短期记忆 |
| multimodal | 1/0/6 | 0/1/5 | 0/0 | — | 文本、图片、语音、表示空间、融合、跨模态检索 | 多模态 --partOf--> 文本；多模态 --partOf--> 图片；多模态 --partOf--> 语音；表示空间 --prerequisite--> 融合；表示空间 --prerequisite--> 跨模态检索 |
| finetune-vs-rag | 0/0/6 | 0/1/4 | 0/0 | ✗ | 微调、RAG、模型参数、知识更新、风格、格式 | 微调 --related--> 模型参数；微调 --contrast--> RAG；RAG --related--> 知识更新；微调 --related--> 风格 |

## 解读

1. **结构限制**：当前抽取 schema 的 relations 只有 `target`，没有 `source`，所以所有边都只能是「焦点 → 目标」，非焦点的实体对（如 A 前置 B）无法表达——这是关系 Recall 上不去的结构性原因。
2. **无证据字段**：抽取结果没有 evidence span，因此证据覆盖率恒为 0；这部分要等数据模型补 TranscriptSpan/relation.source。
3. **无线型判定**：provider 只返回 source/formal/suggest/direction，没有知识语义类型（前置/组成/对比），线型一致率只能检验"四类地图线"映射，检验不了教学关系。
4. **副本检测**：只有 --api 模式能评，而且依赖抽取后的图结构；规则检测的命中率应结合实例人工复核。
