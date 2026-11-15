# 需求对照开源技术：能否直接找到解决方案

> **修正说明（2026-11-15 晚）：本文结论"没有参考"过于绝对。**
> 按第一性原理补充检索后，端到端仍无成品，但分层已有可参考/可复用的开源项目
> （Knowledge Spaces、Concept Map Extraction、Reor、QuestFusion 等）。
> 以补充报告为准：[open-source-solutions-addendum-2026-11-15.md](open-source-solutions-addendum-2026-11-15.md)。

日期：2026-11-15
需求依据：`docs/design/required-implementation.md`（需求基线，只写行为与验收）
目的：按需求环节对照开源项目，判断"能否直接用、只能借架构、还是必须自研"。
范围：不写实现方案，只做选型判断与证据。

---

## 0. 结论先行

**没有单一开源项目能覆盖我们的完整需求。** 能直接复用的主要是"组件级"能力（ASR、抽取模型、评测框架、可视化）；核心的**节点准入、关系方向、副本时机与自由度**没有现成产品可抄。

| 需求环节 | 能否直接解决 | 结论 |
| --- | --- | --- |
| 流式语音输入 | ✅ 部分 | FunASR 可做离线/自托管替代；豆包已满足在线 |
| 稳定片段/episode | ⚠️ 只能借架构 | 无现成"学习语义分段"；Pathway 可做流式管线但重 |
| 节点准入（什么算节点） | ❌ 不能 | 所有开源只做 NER/实体抽取，不做"比喻/例子/步骤/学习对象"判断 |
| 关系语义与方向 | ⚠️ 部分 | DeepKE/GLiREL 可抽关系，但不保证谓词方向；GLiREL 许可证不适合商用 |
| 增量落图/去重/来源 | ⚠️ 只能借架构 | Graphiti/Mem0/Cognee/LightRAG 有增量与去重思路，均为 Python + 图库，不能直接嵌入 Node/SQLite |
| 方向问题 | ❌ 不能 | 无现成"学习下一步方向"产品 |
| 副本触发/时机/自由度 | ❌ 不能 | 无现成"知识副本"系统；QuestFusion 只是研究原型 |
| 副本内容（流程/领域题） | ❌ 不能 | 需自研规则 + LLM 出题 |
| 评测 | ⚠️ 部分 | RAGAS 评 RAG 答案，不评图语义；需自建指标 |
| 3D/图渲染 | ✅ 可选 | 3d-force-graph 等可替代/参考，但非需求核心 |

---

## 1. 流式语音 / 输入

### 候选：FunASR

- 仓库：https://github.com/modelscope/FunASR
- PyPI：https://pypi.org/project/funasr/
- 能力（README/PyPI 原文）：工业级语音识别工具包，支持**离线、流式、边缘部署**；包含 ASR、VAD、标点、说话人、情感/音频事件；提供 **WebSocket 流式服务**、OpenAI 兼容接口；中文模型 Paraformer-zh / Paraformer-zh-streaming / SenseVoice；MIT 工具包许可（模型权重单独许可）。
- 适配度：
  - 可以直接替换/备份我们现在的豆包流式 ASR（尤其离线、自托管、成本敏感场景）；
  - 仍需自己做"稳定片段/episode"的产品判定；FunASR 只给流式文本/VAD 边界。
- 结论：**组件可用**，但不是"输入→节点"的完整方案。

### 候选：Pathway（流式管线）

- 仓库：https://github.com/pathwaycom/pathway
- 能力：Python 流式 ETL，Rust 引擎，增量计算，处理迟到/乱序数据，持久化，LLM/RAG 工具；适合"实时数据管线"。
- 许可：**BSL 1.1**（非商业免费，商业使用有限制；4 年后转 Apache 2.0）。
- 适配度：可以做 episode 队列/增量计算的基础设施，但引入 Python 服务 + 重运行时，对当前单机 Node 架构过重。
- 结论：**可参考架构，不建议 MVP 引入**。

### 候选：LiveGraph

- 论文：https://dl.acm.org/doi/10.1145/3786335.3813169
- 定位：**流式数据持续演化知识图谱**的复合 AI 系统。
- 检索结果只找到论文，**未找到公开可用的开源代码**。
- 结论：**只能借鉴架构**（episode/增量更新/演化），不能直接集成。

---

## 2. 节点抽取 / "什么算节点"

### 候选：DeepKE

- 仓库：https://github.com/zjunlp/DeepKE
- 能力：中文知识图谱抽取框架，NER/关系抽取/属性抽取/事件抽取；支持 cnSchema、低资源、长篇章、多模态；提供 DeepKE-LLM / OneKE 大模型抽取；MIT 许可。
- 适配度：可以抽"实体/关系候选"，但**不做节点准入**（不判断比喻/例子/步骤/学习价值）；需要训练/部署 PyTorch 模型，和 Node 栈分离。
- 结论：**候选生成可参考/可做离线对比，不解决需求核心**。

### 候选：GLiNER

- 仓库：https://github.com/urchade/GLiNER
- 能力：零样本 NER，可指定任意实体类型；Apache-2.0。
- 适配度：可作为"名词候选"轻量模型；但中文效果/模型覆盖需实测，仍不判断"是否值得建节点"。
- 结论：**候选生成组件**。

### 候选：GLiREL

- 仓库：https://github.com/jackboyla/glirel
- 能力：零样本关系抽取（给定实体与关系标签）。
- 许可：**CC BY-NC-SA 4.0（非商业、相同方式共享）**，不适合直接用于商业产品。
- 结论：**不建议商用集成**；关系方向/谓词规则仍需自研。

---

## 3. 关系语义与方向

- DeepKE 的关系抽取是"给定 schema 抽关系"，**不保证方向、不区分比喻/举例、不做方向归一**；
- GLiREL 同样是分类式关系抽取，且许可不适合商用；
- ConceptNet（https://conceptnet.io/）可提供关系词表（IsA/PartOf/RelatedTo 等，CC BY-SA 4.0，注意 share-alike），但不是抽取器，也不含"前置/对比/替代"的完整教学语义；
- 结论：**没有开源项目直接满足"谓词 + 方向 + 证据 + 非知识关系拦截"**，必须自研规则 + LLM。

---

## 4. 增量落图 / 去重 / 来源

### Graphiti（Zep）

- 仓库：https://github.com/getzep/graphiti
- 能力：面向 AI Agent 的**实时时间知识图谱**；episode 增量入图、provenance、实体去重、自定义本体、时间有效性；支持 Neo4j/FalkorDB 等图数据库。
- 许可：Apache-2.0（LICENSE 已核对）。
- 适配度：**最接近我们的"增量 + 来源 + 去重"需求**；但：
  - Python + 图数据库，与当前 Node + SQLite 不同栈；
  - 面向"事实/记忆"，不处理节点的"学习对象/比喻/步骤"语义；
  - 引入需 sidecar + 图库，MVP 过重。
- 结论：**借架构（episode/实体归并/provenance），不直接嵌入**。

### Mem0

- 仓库：https://github.com/mem0ai/mem0
- 能力：AI 记忆层，抽取/存储/检索记忆；README 明确当前算法为 **单次 ADD-only**（不做 UPDATE/DELETE），实体链接 + 多信号检索；Apache-2.0。
- 适配度：适合"用户偏好记忆"，**不适合知识图谱去重/合并**（新版不再做更新/删除）；旧版曾有 ADD/UPDATE/DELETE 但以当前版本为准。
- 结论：**不解决我们的归并需求**；可参考其"抽取后决策"的产品思路。

### Cognee

- 仓库：https://github.com/topoteretes/cognee
- 能力：文档/代码/对话 → 知识图谱 + 向量；`remember/recall/improve/forget`，本地 GLiNER 抽取，支持自定义本体；Apache-2.0。
- 适配度：更像"文档/Agent 记忆管线"，不是实时语音/教学节点；可参考本体与管线设计，不适合直接接入当前实时链路。
- 结论：**架构参考**。

### LightRAG

- 仓库：https://github.com/HKUDS/LightRAG
- 能力：增量图构建 + 双层检索；MIT。
- 适配度：面向文档 RAG，不是对话/实时；可参考增量插入策略。
- 结论：**参考**。

### Microsoft GraphRAG

- 仓库：https://github.com/microsoft/graphrag
- 能力：批量文档 → 实体/关系/社区摘要；MIT。
- 适配度：批量、重、非实时；schema 与证据思路可参考。
- 结论：**不适合实时链路**。

---

## 5. 方向 / 学习下一步

- 没有找到开源项目提供"每个概念自动生成下一步学习方向、只在前沿节点展示、探索后消费"的完整实现；
- 相关研究：Learning to Ask（https://zenodo.org/records/20114629/files/paper.pdf）、Counterfactual Question Generation（https://ojs.aaai.org/index.php/AAAI/article/view/39023）、Adaptive KG learning path（https://link.springer.com/article/10.1007/s44163-026-01379-w），但都是方法/论文，不是可嵌入产品。
- 结论：**必须自研**（LLM 生成 + 规则校验），没有现成组件。

---

## 6. 副本（出现时机 / 内容 / 自由度）

### QuestFusion（KG + LLM 生成游戏任务）

- 仓库：https://github.com/snehilaryan32/rpg-with-knowledge-graphs
- 定位：用知识图谱 + LLM 生成 RPG 自定义任务（QuestFusion）。
- 适配度：**概念上最接近"由知识图谱生成副本"**；但为研究/演示项目，README 未能成功获取，成熟度、许可、可维护性均需进一步核实；且是游戏任务，不是"学习副本出现时机/可挑战/题库"。
- 结论：**只能作为设计参考**。

### pyBKT（掌握度建模）

- 仓库：https://github.com/CAHLR/pyBKT
- 能力：Bayesian Knowledge Tracing，估计学生对技能的掌握概率，支持多技能/多学生/资源；适合做"玩家是否准备好挑战"的模型。
- 适配度：我们当前 tier 规则很简单；pyBKT 可做后续个性化，但不是副本生成/时机系统，且 Python 栈。
- 结论：**可选参考**，MVP 不需要。

### Knowledge Space Theory / ALEKS

- ALEKS：https://www.aleks.com/（商业产品，非开源）
- KST 是理论模型，不是现成开源引擎；可用于定义"知识状态/前置闭包"，但需自研。
- 结论：**理论参考**。

### 结论

副本的"出现条件 + 玩家状态 + 时机 + 自由度 + 内容正确性"没有开源直接方案，**必须自研**。

---

## 7. 评测

### RAGAS

- 仓库：https://github.com/vibrantlabsai/ragas
- 能力：LLM 应用/RAG 评测指标、测试数据生成；Apache-2.0。
- 适配度：评"答案是否基于检索上下文"，**不评节点/关系的语义正确性、方向、副本规则**；可以作为评测框架参考，但核心指标需自建。
- 结论：**部分参考**。

---

## 8. 3D / 图渲染（非需求核心）

### 3d-force-graph

- 仓库：https://github.com/vasturiano/3d-force-graph
- 能力：Three.js/WebGL 的 3D 力导向图，支持增量更新、方向箭头、曲线、点击聚焦、fit-to-canvas；与我们的 three.js 栈接近。
- 适配度：可替代/参考当前自定义 3D 渲染中的"相机自适应、箭头、聚焦"等；但我们的需求主要是知识语义，不是渲染。
- 许可：以仓库 LICENSE 为准（未核对）。
- 结论：**可选视觉组件**。

---

## 9. 许可证与栈风险汇总

| 项目 | 许可证 | 与当前栈 | 风险 |
| --- | --- | --- | --- |
| FunASR | MIT（工具包；模型单独许可） | Python | 需自托管/模型许可核实 |
| DeepKE | MIT | Python/PyTorch | 训练/部署成本，非实时 |
| GLiNER | Apache-2.0 | Python | 中文效果需实测 |
| **GLiREL** | **CC BY-NC-SA 4.0** | Python | **非商业限制，不建议商用** |
| Graphiti | Apache-2.0 | Python + 图数据库 | 引入 sidecar/图库，重 |
| Mem0 | Apache-2.0 | Python | 当前算法 ADD-only，不解决归并 |
| Cognee | Apache-2.0 | Python + 图/向量 | 文档/记忆管线，非实时教学 |
| LightRAG | MIT | Python | 文档向，非实时 |
| Pathway | **BSL 1.1** | Python/Rust | 商业限制，重 |
| RAGAS | Apache-2.0 | Python | 不评图语义 |
| pyBKT | 以仓库为准 | Python | 非副本系统 |
| 3d-force-graph | 以仓库为准 | JS/Three | 仅渲染 |
| LiveGraph | 论文，无公开代码 | — | 不可直接用 |
| QuestFusion | 待核实 | — | 研究原型 |

---

## 10. 建议：哪些直接采用、哪些借架构、哪些自研

### 可直接采用（组件级）

1. **FunASR**：作为离线/自托管 ASR 备选（当前豆包在线可用，先不替换）；
2. **GLiNER**：如果要做轻量候选抽取，可做实验对比（需验证中文）；
3. **RAGAS**：借评测框架的组织方式，不直接用其指标评图；
4. **3d-force-graph**：如果需要替换 3D 渲染/相机聚焦，可参考。

### 借架构 / 规则，不整体引入

1. **Graphiti**：episode、provenance、实体归并、时间有效性 → 用 SQLite 自实现；
2. **Mem0/Cognee**：抽取后合并决策、记忆生命周期 → 只借规则；
3. **LiveGraph**：流式演化架构 → 论文参考；
4. **GraphRAG**：schema/证据/多轮补抽 → prompt 参考。

### 必须自研

1. **节点准入**（topic/subconcept/process vs metaphor/example/step/noise）；
2. **关系语义与方向**（谓词、方向归一、非知识关系拦截、关系卡）；
3. **副本触发/时机/自由度**（知识条件 + 玩家条件 + 节奏 + 选择）；
4. **副本内容**（流程唯一序、领域每日题、题目依据）；
5. **评测指标**（节点/关系/副本专项，不是 RAG 答案评测）；
6. **学习资产模型**（节点 MD、方向、纠错、隐藏、stale）。

---

## 11. 如果要做一个 spike（建议）

| 目标 | 做法 | 验收 |
| --- | --- | --- |
| 验证 FunASR 能否替代/备份豆包 | 本地流式跑 10 段真实语音 | 中文术语准确率、延迟、资源占用 |
| 验证 Graphiti 的归并规则是否值得抄 | 用同一段对话喂 Graphiti 与我们的图 | 重复实体率、关系方向、可解释性 |
| 验证 GLiNER/DeepKE 是否能补候选 | 对我们 20 段评测集跑 NER | 实体召回、中文术语、是否引入步骤/比喻噪声 |
| 验证 QuestFusion 设计 | 读代码/跑 demo | 副本结构、规则、许可 |
| 验证 RAGAS 是否可复用评测框架 | 跑我们的评测集 | 指标是否可映射到图语义 |

---

*本报告只做需求对照与选型判断；结论是"组件可用、核心自研"，没有推荐直接替换现有系统。*
