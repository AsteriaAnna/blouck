# 外部参考

最后更新：2026-11-16

这份文档只保留"结论和可借用点"，不记录搜索过程。

---

## 1. 结论

没有一套现成开源项目能完整覆盖我们的场景：

- 抽取、实体消歧、图存储有成熟组件；
- **节点准入（什么值得成为学习节点）没有现成实现**；
- 关系谓词/方向有通用标准，但没有 RAG/IR 教学领域关系体系；
- 流式 provisional + 修复没有现成开源实现。

所以我们采用"组件借用 + 产品层自研"。

---

## 2. 按层看

### 2.1 抽取 / 消歧 / 图

| 项目/论文 | 可借用 | 不解决 |
| --- | --- | --- |
| GraphRAG | 分块抽取、实体/关系类型、图社区 | 学习节点准入、角色 |
| Graphiti | 增量 episode、实体消歧、时间有效性 | 教学语义、provable 修复 |
| REBEL | seq2seq 三元组抽取，200+ 关系 | 教学关系/方向 |
| DeepKE | 中文实体/关系抽取 | 节点是否值得建 |
| GLiNER / UniversalNER | 零样本实体候选 | 关系、角色 |
| GLiREL | 零样本关系分类 | 中文/方向/许可证（CC BY-NC-SA） |

### 2.2 关系判断

| 资料 | 结论 |
| --- | --- |
| [LLM with Relation Classifier for DocRE](https://arxiv.org/abs/2408.13889) | 先剪枝实体对，再让 LLM 判关系；无关对会分散注意力 |
| [Unexpected Phenomenon（ACL 2024）](https://aclanthology.org/2024.findings-acl.545/) | LLM 会把无关实体硬套关系；必须允许"无关"、做标签验证 |
| [SKOS](https://www.w3.org/TR/skos-reference/) | `broader/narrower/related`；层级与 related 不相交 |
| ISO 1087 | generic / partitive / associative 三类概念关系 |
| [ConceptNet](https://github.com/commonsense/conceptnet5/wiki/Relations) | 34 种关系，含 IsA/PartOf/HasPrerequisite/Antonym/RelatedTo；方向与我们要相反的要归一 |
| [OBO RO](https://obofoundry.org/ontology/ro.html) | `part_of`/`has_part`/`precedes` 等，带形式化公理 |
| WordNet | hypernym/meronym/antonym；meronym 方向与 ConceptNet PartOf 相反 |

### 2.3 教学/先修

| 资料 | 可借用 |
| --- | --- |
| [Knowledge Spaces](https://github.com/vanderbilt-data-science/knowledge-spaces) | KST：knowledge items、先修准序、knowledge state、outer fringe |
| Novak 概念图 | 概念 + 带连接词的命题；层级、cross-link、例子 |
| [ACL 2025 Concept Map Extraction](https://aclanthology.org/2025.ldk-1.10/) | 概念图抽取本身很难（F1 25–28），需要人工兜底 |

### 2.4 流式

| 资料 | 结论 |
| --- | --- |
| LiveGraph（论文） | 流式图更新，但无公开代码；不能直接复用 |
| optimistic UI / speculative execution | 前端可以先显示 provisional，再确认；不是 KG 现成方案 |
| ASR streaming | 豆包 Seed ASR Streaming 2.0 可用，partial 不稳定，必须做稳定片段/修订 |

---

## 3. 我们借了什么

- 抽取层：LLM/REBEL/DeepKE 的"实体 + 关系 + 证据"结构；
- 关系层：SKOS/ISO/ConceptNet/OBO RO 的谓词/方向/传递/逆关系规则；
- 先修层：KST 的 frontier/可挑战思路；
- 图增量：Graphiti 的 episode/provenance 思路；
- 关系验证：DocRE 的"先剪枝再判" + ACL 2024 的"允许无关/标签验证"。

## 4. 我们自研什么

- 学习节点准入（角色/断言/证据，而非任意识别）；
- RAG/IR 领域谓词（`related(衡量/使用/组合)` 等自由标签，暂不做 15 谓词本体）；
- 流式 ghost → provisional → commit → 修复；
- 教学语义下的方向/frontier/副本规则。

## 5. 关键缺口

1. 没有开源"学习节点准入"；
2. 没有现成 RAG/IR 关系本体；
3. 没有开源 streaming provisional + reconciliation；
4. LLM 关系判断的虚假关联需要自建证据/标签校验。

这些缺口对应 [problems-and-approaches.md](../design/problems-and-approaches.md) 里的待解问题。
