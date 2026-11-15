# 开源方案检索补充：第一性原理复盘与新增参考

日期：2026-11-15
性质：对 `open-source-solutions-2026-11-15.md` 的补充与纠偏
结论先行：**上一份报告"没有参考"的说法过于绝对。端到端没有成品，但按能力拆分后，每一层都有可参考/可复用的开源项目。**

---

## 1. 我上一轮是怎么搜的（问题在哪）

| 做法 | 问题 |
| --- | --- |
| 用"knowledge graph construction / real-time KG / open source"搜成品 | 搜到的是"整体系统"，不是"能力组件" |
| 只从"项目名/产品名"出发 | 漏掉学术领域（概念图、知识空间、学习科学、PCG、对话系统） |
| 英文、GitHub 为主 | 漏掉中文生态（Gitee、中文论文、中文产品）和商业产品参考 |
| 把候选当"整体能否替换我们" | 没有按"输入/分段/节点/关系/归并/方向/副本/评测"逐层找 |
| 用"没有端到端产品"推出"没有参考" | 逻辑跳跃：**组件有参考 ≠ 整体可替换** |

正确的做法：**需求 → 第一性原理能力 → 对应学科/项目类型 → 候选**。

---

## 2. 第一性原理拆解

```text
语音/文字
  → 稳定文本（ASR + VAD + endpointing）
  → 片段/对话单元（对话分段、主题分段）
  → 概念/知识项（概念图提取、知识图谱本体、教学设计）
  → 关系/命题（语义关系、本体、概念图连接词）
  → 增量身份与来源（流式实体解析、增量图谱、provenance）
  → 方向/下一步（问题生成、学习路径、KST 外边缘）
  → 副本/挑战（游戏化、任务生成、PCG、掌握度）
  → 评测（学习分析、图质量、RAG/LLM 评测）
```

每一层对应的搜索领域：

| 能力 | 应该搜的领域/关键词 |
| --- | --- |
| 稳定文本 | streaming ASR、VAD、endpointing、punctuation |
| 片段 | dialogue segmentation、topic segmentation、conversation analysis |
| 概念/知识项 | concept map extraction、knowledge item extraction、ontology learning、instructional design、Bloom/DOK |
| 关系/命题 | semantic relation extraction、concept map propositions、SKOS、ConceptNet、schema.org |
| 增量/身份 | streaming entity resolution、incremental KG、provenance、belief revision |
| 方向 | question generation、learning path、knowledge space theory、outer fringe |
| 副本 | quest generation、procedural content generation、game-based learning、mastery-based progression |
| 评测 | learning analytics、KG evaluation、RAG evaluation |

---

## 3. 新找到的、真正相关的参考

### 3.1 Knowledge Spaces（KST 开源实现）

- 仓库：https://github.com/vanderbilt-data-science/knowledge-spaces
- 许可：MIT
- 能力（README）：
  - 从课程材料抽取 **knowledge items**；
  - 构建 **概念图 + competences**；
  - 用 **QUERY 算法**建立先修关系（surmise relations）；
  - 枚举 **knowledge states / learning paths / Hasse 图**；
  - 用 **BLIM/PoLIM** 做自适应评估；
  - 计算 **inner/outer fringe**（学生下一步能学什么）；
  - 生成个性化材料、教学计划；
  - 提供 JSON schema + Python 标准库工具。
- 为什么重要：
  - 它解决的正是我们"节点之间先修关系、三档/可挑战、下一步方向"的理论与数据结构；
  - `outer fringe` 可以直接对应"边缘节点/下一步方向"；
  - 副本的"可挑战条件"可以用 knowledge state 定义，而不是拍脑袋数 tier。
- 局限：
  - 面向课程材料/文档，不是实时语音；
  - 需要先有知识项与先修关系，不解决"什么算节点"；
  - 不是游戏/副本系统。
- 结论：**可直接参考其 schema、QUERY、fringe、评估模型；不能直接替代实时生成链路。**

### 3.2 Automated Concept Map Extraction from Text（ACL 2025）

- 论文：https://aclanthology.org/2025.ldk-1.10/
- 能力（摘要）：概念图 = 文本中概念关系的语义图摘要；提出神经符号管线 + GPT-3.5 方法；模块化开源架构；在 WIKI 数据集上 SOTA（F1 25.7/28.5，METEOR/ROUGE-2），代码开放。
- 为什么重要：
  - 直接对应"从一段文本抽概念 + 关系 + 概念图"，和我们的节点/关系生成最接近；
  - 可作为节点/关系抽取的对照基线。
- 局限：
  - 面向文档/阅读理解，不是实时语音/教学游戏；
  - F1 仍不高，说明"概念图自动抽取"本身是难题；
  - 不处理比喻/例子/步骤的角色。
- 结论：**值得读代码/跑基线，尤其用于"关系抽取质量"对照；不能直接产品化。**

### 3.3 Reor（本地 AI 笔记 + 自动关联）

- 仓库：https://github.com/reorproject/reor
- 许可：AGPL-3.0
- 能力：本地 AI 笔记应用；笔记自动分块/嵌入，**自动连接相关笔记**（向量相似），支持 RAG 问答、语义搜索、Obsidian 风格编辑器。
- 为什么重要：
  - 产品级参考"笔记 → 相关笔记图"的交互；
  - 说明"自动连线"可以只靠向量相似，但这也正是问题：相似 ≠ 有语义关系（我们的关系必须分类/定向）。
- 局限：AGPL（商用需注意）；不是实时语音；关系只是相似连接，不是谓词/方向。
- 结论：**UX/产品参考，不是语义参考。**

### 3.4 QuestFusion（KG + LLM 生成游戏任务）

- 仓库：https://github.com/snehilaryan32/rpg-with-knowledge-graphs
- 定位：用知识图谱 + LLM 生成 RPG 自定义任务（QuestFusion）。
- 为什么重要：**目前最接近"由知识图谱生成副本/任务"的开源尝试**。
- 局限：研究/演示项目；README 未成功抓取，成熟度/许可/可维护性待核实；游戏任务 ≠ 学习副本（没有三档、可挑战、依据）。
- 结论：**设计参考，不能直接用于产品。**

### 3.5 Interactive Fiction Worlds / PCG

- 论文：https://ojs.aaai.org/index.php/AIIDE/article/download/7400/7309
- 能力：生成可交互的虚构世界/任务结构（AIIDE）。
- 为什么重要：副本的"世界/任务/关卡"生成可借鉴 PCG（程序化内容生成）思路，而不是把副本当题库。
- 局限：不是知识教学，不保证知识正确性。

### 3.6 BRING（LLM 角色扮演 + 图记忆）

- 仓库：https://github.com/Eva-E1/BRING
- 能力：LLM 角色扮演，带 AI 世界、智能 NPC、多实体图记忆。
- 为什么重要：如果副本要做成"世界/角色/任务"，它的图记忆与实体管理可参考。
- 局限：角色扮演，不是学习知识图谱；许可/成熟度待核实。

### 3.7 增量对话/实体解析

- **Incremental Learning for Knowledge-Grounded Dialogue Systems in Industrial Scenarios**（SIGDIAL 2024）：https://aclanthology.org/2024.sigdial-1.8/
- **Entity Resolution for Streaming Data with Embeddings**（HAL）：https://hal.science/hal-05245956v1/preview/Entity%20Resolution%20for%20Streaming%20Data%20with%20Embeddings_AAM.pdf
- 为什么重要：我们"实时增量 + 去重/归并"的学术对应；可借鉴流式实体解析的判定策略。

### 3.8 旧报告里仍成立的候选

- **FunASR**（MIT）：流式中文 ASR，可做离线/自托管备选。
- **Graphiti**（Apache-2.0）：增量 episode、实体归并、provenance。
- **DeepKE**（MIT）：中文 NER/RE/属性抽取。
- **GLiNER**（Apache-2.0）：零样本实体候选。
- **GLiREL**（CC BY-NC-SA）：**非商业，不建议商用**。
- **Mem0/Cognee/LightRAG**：记忆/增量图谱架构参考。
- **RAGAS**（Apache-2.0）：评测框架参考。
- **pyBKT**：掌握度建模参考。

---

## 4. 修正后的结论

### 端到端

**仍然没有**一个开源项目能直接实现"流式语音 → 学习节点/关系 → 方向 → 副本出现/挑战"的完整产品。

### 分层

| 层 | 有参考吗 | 最强候选 | 能否直接用 |
| --- | --- | --- | --- |
| 流式 ASR | ✅ | FunASR | 可替换/备份 |
| 概念图/关系抽取 | ✅ | ACL 2025 concept map pipeline、DeepKE | 可对照/可借管线 |
| 先修/知识空间/可挑战 | ✅ | **Knowledge Spaces（MIT）** | schema/QUERY/fringe 可借 |
| 增量图/归并/来源 | ✅ | Graphiti | 架构可借，不能直嵌 |
| 方向/下一步 | ✅ 理论 | KST outer fringe + QG 论文 | 规则可借，需自研 |
| 副本/任务生成 | ✅ 概念 | QuestFusion、PCG/Interactive Fiction | 设计参考 |
| 评测 | ✅ 部分 | RAGAS + KST validation | 框架可借，指标自建 |

### 我们真正独有的部分

1. **节点准入**（topic/subconcept/process vs metaphor/example/step/noise）；
2. **关系方向与谓词校验**（不是相似连接）；
3. **实时语音 → 学习语义**的端到端；
4. **副本出现时机/自由度/学习意义**；
5. **学习资产模型**（MD、方向、纠错、隐藏、stale）。

---

## 5. 下一步应该怎么搜/怎么做

### 搜索方法修正

- 按能力层搜，不按"知识图谱项目"搜；
- 同时搜：开源仓库、论文（ACL/EMNLP/AIED/EDM/LAK/CHI/AIIDE）、商业产品（Heptabase/RemNote/Tana/Mem）、标准（SKOS/schema.org/xAPI/QTI）、数据集（ConceptNet/MOOCCube/WikiHow）；
- 中文生态单独搜：Gitee、机器之心、知乎、掘金；关键词用"概念图/知识空间/先修关系/自适应学习/学习路径"。

### 建议的三个 spike

1. **Knowledge Spaces**：把它的 JSON schema + QUERY + fringe 映射到我们的节点/三档/副本可挑战，验证能否替代"拍脑袋阈值"；
2. **ACL 2025 concept map pipeline**：在同一批中文材料上跑，和我们的节点/关系做 P/R 对照；
3. **Graphiti**：同一段对话喂进去，比较实体重复率与关系方向，验证归并规则。

---

*本文修正上一份报告"没有参考"的绝对结论：端到端没有，分层有参考；核心语义与副本时机仍需自研。*
