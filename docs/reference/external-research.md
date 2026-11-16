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


---

## 6. 流式/对话图构建参考（2026-11-16 补充）

针对"多焦点、多跳、边说边生成"查过一轮，结论是：**有相邻研究，但没有现成可复用的完整系统。**

| 资料 | 能说明什么 | 不能解决什么 |
| --- | --- | --- |
| [A Speech-to-Knowledge-Graph Construction System（IJCAI 2020）](https://ijcai.org/Proceedings/2020/777) | 已经有人做"实时语音 → 知识图谱"演示：把关键短语作为节点/边，边听边画 | 节点是关键词级，没有教学语义、多焦点父链、证据/修订 |
| [LiveGraph: A Compound AI System for Evolving Knowledge Graph Construction from Streaming Data（2025）](https://dl.acm.org/doi/10.1145/3786335.3813169) | 流式数据持续建/演化 KG 的系统架构 | 面向流式数据，不是对话焦点/教学图；无公开可复用代码 |
| [Towards automatic knowledge graph construction from dialogue（RPI 项目）](https://tw.rpi.edu/project/towards-automatic-knowledge-graph-construction-dialogue) | 系统梳理对话建 KG 的难点：代词/回指、话题切换、跨轮上下文；并指出没有现成综述 | 是综述/方向，不是实现 |
| Centering Theory / attentional state（Grosz & Sidner 1986；Grosz, Joshi & Weinstein 1995） | "局部焦点 + 焦点栈 + 回退"是经典话语模型，正好对应多焦点 | 理论模型，不提供工程流水线 |
| Dialogue State Tracking（DST）综述 | 对话状态需要显式跟踪，不能只靠最后一次输入 | 传统 DST 是 slot-value，不是开放知识图 |

### 6.1 这些参考共同说明

1. **实时语音 → 图** 本身可行（IJCAI 2020 已演示），但现有演示停留在关键词图；
2. **对话建图** 的核心难点是回指、话题切换、跨轮上下文（RPI 综述）；
3. **多焦点** 需要话语焦点栈/注意力状态（Centering Theory），不是单一 focus；
4. **流式演化** 需要独立的状态/修订机制（LiveGraph 方向）；
5. 没有找到"教学语义 + 多焦点父链 + provisional + 证据"的现成系统。

### 6.2 对我们意味着什么

- 不能直接抄某个开源项目；
- 但可以确定方向：**对话状态模型（焦点栈）+ 增量图状态 + 关系验证**，而不是"一句话一次抽取"；
- 实时语音→图的研究支持"边听边画"，但不支持"自动挂对父节点/教学关系"；
- 这属于产品层自研，不是模型能力问题。

### 6.3 结论

用户要的"多焦点、多跳、随时切回"不是玄学，而是**话语图构建**问题；现有研究给出了组件（焦点栈、DST、流式建图），但没有给出完整教学图系统。我们需要自己设计状态模型，不能靠 prompt 或 Ghost 补。


---

## 7. 参考方式反思：焦点移动该查什么

### 7.1 我之前的搜索角度偏了

我之前主要用**系统/产品关键词**：

- streaming knowledge graph
- real-time knowledge graph
- speech-to-knowledge-graph

找到的是"实时语音→图"的系统演示（IJCAI 2020、LiveGraph），但这类工作关注**怎么流式建图**，不关注**一句话内部/多句话之间焦点怎么移动、父节点怎么选**。

所以不是"完全没有参考"，而是**搜索角度偏系统层，漏了话语/对话层**。

### 7.2 正确的关键词/角度

焦点移动属于：

- **Centering Theory / attentional state**：局部焦点、焦点栈、回退；
- **Discourse structure（SDRT / QUD）**：话题如何推进、何时回退；
- **Coreference / anaphora resolution**：代词、指代决定"接谁"；
- **Conversational entity linking**：多轮里实体身份如何保持；
- **Dialogue State Tracking**：对话状态需要显式跟踪；
- **Incremental KG construction**：图状态如何增量更新。

### 7.3 现在能找到的相关资料

| 资料 | 用途 |
| --- | --- |
| [A Preliminary Model of Centering in Dialog（ACL 1998）](https://aclanthology.org/P98-2241/) | 对话中的 Centering：局部焦点、回退；直接对应"多焦点" |
| Centering Theory（Grosz, Joshi & Weinstein 1995） | 焦点栈/显著性的理论基础 |
| SDRT / QUD（Asher & Lascarides 等） | 话题推进/回退、话语关系；决定"现在在讲哪个分支" |
| [Entity Linking with Wikidata: A Systematic Literature Review（ACM CSUR）](https://dl.acm.org/doi/10.1145/3795134) | 实体链接/消歧的工程方法；多轮实体身份 |
| [Alexa Prize: Discourse Driven Coreference Resolution](https://nlp.ucsc.edu/files/2022/03/Amazon-Alexa-Prize-Discourse-Model-Coreference-Resolution.pdf) | 对话中指代/回指如何驱动实体解析 |
| [RPI dialogue KG survey project](https://tw.rpi.edu/project/towards-automatic-knowledge-graph-construction-dialogue) | 对话建图难点：回指、话题切换、跨轮上下文 |
| [IJCAI 2020 Speech-to-KG](https://ijcai.org/Proceedings/2020/777) | 实时语音→图可行，但只到关键词图 |
| [LiveGraph 2025](https://dl.acm.org/doi/10.1145/3786335.3813169) | 流式图演化架构 |

### 7.4 结论

- **焦点移动不是一个算法，而是一组机制**：焦点栈 + 显著性 + 显式线索 + 指代解析 + 实体链接 + 关系验证；
- 有充分的理论/组件参考，但**没有端到端教学图系统**；
- 可以自研，但必须把它当"对话状态模型"来做，不是 prompt 工程；
- 我之前没找到，是因为关键词偏系统层，不是因为它不存在。

### 7.5 可做性判断

- 焦点栈 + 父节点选择：可做；
- 多轮实体身份/指代：可做，但需要实体链接/别名/回指处理；
- 真实"随机跳转 + 回退"：可做，但需要明确的焦点规则和评测集；
- 端到端实时：可做，但首次反应必须走本地快路径，不能等 LLM。


---

## 8. 这些资料分别解决"问题 6"的哪个环节

问题 6 = 言出法随 + 多焦点/父链。资料不是笼统参考，按环节对应如下：

| 问题 6 的环节 | 资料 | 具体解决什么 |
| --- | --- | --- |
| 6.1 实时反应/延迟 | [IJCAI 2020 Speech-to-KG](https://ijcai.org/Proceedings/2020/777) | 证明"边听边画"可行；只能做到关键词节点，不能作为完整方案 |
| 6.1 流式图演化 | [LiveGraph 2025](https://dl.acm.org/doi/10.1145/3786335.3813169) | 流式数据持续建/演化图的状态架构；不是对话焦点 |
| 6.2 多焦点/回退 | [Centering in Dialog（ACL 1998）](https://aclanthology.org/P98-2241/) + Centering Theory | 局部焦点、焦点栈、回退；解决"现在在讲哪个分支" |
| 6.2 话题推进/回退 | SDRT / QUD | 话语关系与话题结构；解决"什么时候回到旧分支" |
| 6.2 指代/回指 | [Alexa discourse coreference](https://nlp.ucsc.edu/files/2022/03/Amazon-Alexa-Prize-Discourse-Model-Coreference-Resolution.pdf) | 代词/回指决定新 mention 接谁；解决父节点解析 |
| 6.2 实体身份 | [Entity Linking survey（ACM CSUR）](https://dl.acm.org/doi/10.1145/3795134) | 同一实体跨轮/跨别名保持同一 ID；解决 ghost→节点身份 |
| 6.2 对话状态 | Dialogue State Tracking 综述 | 对话状态要显式跟踪，不能只看最后一句；解决多轮上下文 |
| 6.2 对话建图难点 | [RPI dialogue KG project](https://tw.rpi.edu/project/towards-automatic-knowledge-graph-construction-dialogue) | 系统列出回指、话题切换、跨轮上下文难点；证明这是公认问题 |
| 6.3 增量更新 | LiveGraph + Graphiti | 增量写入/provenance；解决"边生成边修订"的存储层 |
| 6.5 provisional/演出法 | optimistic UI / progressive disclosure（工程模式，非论文） | 先显示 provisional，后确认；解决"3 秒延迟如何不空等" |

**结论：**

- 这些资料覆盖了问题 6 的**组件**：焦点栈、指代、实体链接、DST、流式图、provisional UI；
- 没有任何一份资料给出"教学图 + 多焦点 + 父子链 + provisional"的端到端实现；
- 所以能做，但必须组合，不是找一个库接上。


---

## 9. 工程侧参考（只用于持久化/多端阶段，不是 MVP 必需）

这些不是 KG 论文，而是工程模式；现在不需要全上。

| 问题 | 参考 | 用在哪 | 现在需要吗 |
| --- | --- | --- | --- |
| 先显示、后确认 | [React useOptimistic](https://react.dev/reference/react/useOptimistic) | provisional/ghost 的 UI 状态 | ✅ 概念可用 |
| 感知延迟 | Perceived performance / skeleton screen 模式 | 占位、渐进呈现 | ✅ 概念可用 |
| 并发写冲突 | [Optimistic concurrency control（Kung & Robinson, 1981）](https://dl.acm.org/doi/abs/10.1145/319566.319567) | 多端/多请求同时改图 | ❌ 延后 |
| 失败补偿 | [Sagas（Garcia-Molina & Salem, 1987）](https://dl.acm.org/doi/abs/10.1145/38714.38742) | 长事务式的 provisional→commit 失败回滚 | ❌ 延后 |
| 实体消解 | [Entity Resolution survey（VLDB 2012）](https://dl.acm.org/doi/abs/10.14778/2367502.2367564) | 同一实体多名称/多轮合并 | ⚠️ 先只用别名/模糊；完整方案延后 |
| 多端最终一致 | CRDT / event sourcing / CQRS | 多标签页、离线、重放 | ❌ 延后 |
| 幂等 | API idempotency key 工程模式 | 重复提交/重试 | ❌ 延后 |

### 9.1 结论

- **MVP 不需要三层一致性、并发控制、Saga、CRDT、完整实体消解**；
- 这些是"有持久化、多端、失败补偿"之后的问题；
- 现在只需要：本地匹配 + provisional + 简单父链 + 单端内存状态；
- 过早引入会把 MVP 拖死。

### 9.2 边界

- 参考只说明"方向存在"，不代表"现在必须做"；
- 不要把生产期方案写进 MVP 验收；
- 如果后续要做持久化/多端，再逐项引入。
