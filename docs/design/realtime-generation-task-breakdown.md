# 实时生成流程与任务拆分（含参考项目）

日期：2026-11-15
状态：工作文档（记录流程、拆分任务、对应参考材料）
目标：流式语音 + 文字输入 → 实时生成有意义的节点/关系 → 积累到条件后自动生成副本

---

## 0. 一句话流程

```text
流式语音 / 文字
  → 稳定片段（episode）
  → 概念/过程候选
  → 语义校验（名词性、证据、方向）
  → 增量合并（别名/去重/版本）
  → 实时落图（节点 + 关系 + 方向）
  → 达到条件后触发副本候选
  → 副本硬校验（流程唯一序 / 领域共同上位）
  → 生成可挑战副本（流程排序 / 领域每日 10 题）
```

核心不是"抽到词就建点"，而是四件事同时成立：

1. **实时**：流式输入不断进来，节点/关系要增量出现，不重算全图；
2. **节点/关系语义正确**：名词概念、谓词方向、证据可追溯；
3. **关系识别符合规则**：什么时候建正式关系、什么时候虚线/方向，不能模型说了算；
4. **副本符合规则**：流程有唯一顺序，领域有共同上位，出现与可挑战分离。

---

## 1. 端到端流程（现状 vs 目标）

| 阶段 | 现状 | 目标 |
| --- | --- | --- |
| 输入 | 豆包 ASR partial/final + 文字提交；每个 final 立刻抽取 | final 先缓冲成 10–20 秒 / 2–4 句 episode，再抽取 |
| 分段 | 一句一次 | 句末 + 静音 + 主题分段（相似度骤降处切） |
| 候选 | LLM 直接出 entities/relations/processes | 先候选（名词/过程），再判"值不值得建节点" |
| 校验 | 证据子串、类型白名单、confidence | 增加名词性、谓词方向、跨句指代、矛盾检测 |
| 合并 | 同名/别名精确匹配 | embedding 相似 + LLM 裁决 same/parent_child/different |
| 落图 | 事务性弱、单条写入 | 单 episode 事务 + graphVersion + 幂等 |
| 方向 | frontier 节点生成 | 每个节点有方向，只有 frontier 画线，消费后更新 |
| 副本触发 | 抽取后邻域检测 + LLM 候选 | 规则化阈值（数量/结构/覆盖度）+ 冷却/去重 |
| 副本校验 | 流程唯一序、领域 kindOf | 增加引用完整性、版本/失效、题目依据 |

---

## 2. 任务拆分（按依赖顺序）

### 任务 A：流式输入与 episode 缓冲

**输入**：ASR partial / final、文字提交
**输出**：稳定 episode（文本 + spanId + 起止时间 + revision + graphVersion）

要做的事：

1. endpointing：final + 静音 ≥700ms + 句末标点；
2. 连续 final 合并成 episode（10–20 秒 / 2–4 句），停顿/切世界时 flush；
3. partial 只更新 UI，不触发抽取；
4. revision：同一段被 ASR 修正时，用新 revision 替换旧结果，旧抽取结果丢弃；
5. 每个世界单队列，去抖 800ms，避免并发写图。

参考：

- **LiveGraph: A Compound AI System for Evolving Knowledge Graph Construction from Streaming Data**（[ACM](https://dl.acm.org/doi/10.1145/3786335.3813169)）：流式数据持续演化图谱的整体架构；
- **Graphiti / Zep**（[GitHub](https://github.com/getzep/graphiti)、[PyPI](https://pypi.org/project/graphiti-core/)）：episode 作为增量单元、provenance、实体去重、时间有效性；
- 流式 ASR endpointing / VAD：豆包/Whisper 文档里的 final + 静音判据；
- 主题分段：TextTiling / GraphSeg 思路（相邻句 embedding 相似度骤降处切）。

验收：一句话输入不再单独触发抽取；一个 episode 只调用一次模型；切世界不会把旧结果写进新世界。

---

### 任务 B：节点候选与"值不值得建"

**输入**：episode 文本 + 当前 focus + 已有概念
**输出**：概念候选（name/type/definition/evidence/confidence）与过程候选（name/steps/evidence）

要做的事：

1. 轻量候选：名词短语/NER/术语（GLiNER、KeyBERT、TextRank 或小模型）；
2. LLM 判定：这个词是否有定义、可出题、会被继续学习；
3. **过程句**：只把过程本身当节点，步骤进 `processes.steps`，不建步骤节点（已实现）；
4. 名词性校验：疑问句/动词短语/代词/泛化词拒绝；
5. 候选层：拿不准的进"待确认"，不直接上地图。

参考：

- **GraphRAG**（[GitHub](https://github.com/microsoft/graphrag)）的实体类型白名单 + 描述 + 多轮 gleaning；
- **LlamaIndex Property Graph**（[介绍](https://www.llamaindex.ai/blog/introducing-the-property-graph-index-a-powerful-new-way-to-build-knowledge-graphs-with-llms)）的 schema 约束与校验；
- **ConceptNet**（[conceptnet.io](https://conceptnet.io/)）的关系词表（IsA/PartOf/RelatedTo）；
- **分类体系构建**（[Sage](https://journals.sagepub.com/doi/10.1177/22104968251404186)、[CEUR](https://ceur-ws.org/Vol-2211/paper-10.pdf)）：`kindOf/partOf` 的抽取与合并；
- 概念图生成：RAG-LLM Ensemble 概念图、KnowledgeMaps AI（层级概念图）。

验收：过程句只产生 1 个过程节点 + N 步流程副本（已验证）；普通句的节点有类型/定义/证据；步骤不再被建成"XX环节"节点。

---

### 任务 C：关系识别与语义校验

**输入**：节点候选 + episode 文本 + focus
**输出**：带谓词/方向/证据/置信度的关系

要做的事：

1. 谓词白名单：kindOf / partOf / prerequisite / contrast / alternative / related；
2. **方向归一**：
   - kindOf 具体 → 上位；
   - partOf 部分 → 整体；
   - prerequisite 前置 → 后续（按证据中实体出现顺序校验）；
   - contrast/related 无方向；
   - alternative 旧 → 新；
3. 关系类型到地图线型：
   - 证据充分 + confidence≥0.75 → formal；
   - 0.5–0.75 → suggest；
   - 无证据 → 不建或降级；
4. 虚线接受后由 LLM 生成关系名/说明/MD；
5. 用户手动连线：AI 给谓词/名称/理由。

参考：

- **Graphiti**：事实/关系 + 时间有效性 + 去重；
- **GraphRAG**：关系强度、描述、证据；
- **Neo4j LLM Graph Builder**（[文档](https://neo4j.com/developer/genai-ecosystem/llm-graph-builder/)）：schema 配置 + 来源 Chunk；
- **ConceptNet**：谓词/方向词表；
- 先修关系推断：**Inferring Prerequisite Knowledge Concepts in Educational Knowledge Graphs**（[arXiv:2509.05393](https://arxiv.org/abs/2509.05393)）——多准则投票推断前置关系，可用于校验 prerequisite 方向。

验收：同一对概念的边方向合法率 100%；正式关系证据覆盖率提升；接受建议后有可读关系名。

当前评测：谓词准确率 87.0%、线型一致率 91.3%、证据覆盖率 46.0%（关系 P/R 32.4%/46.0%）。

---

### 任务 D：增量实体归并（最缺）

**输入**：新候选 + 已有节点
**输出**：复用/合并/父子/新建 的决策

要做的事：

1. 精确名 / 别名匹配；
2. embedding 相似度 ≥0.9 → LLM 裁决 `same / parent_child / different`；
3. `same`：合并别名、证据、定义（保留更长），不新建；
4. `parent_child`：建 kindOf，不合并；
5. 合并保留 revision，可回溯；
6. 避免同一概念被不同说法拆成多个节点。

参考：

- **Mem0**（[How Mem0 works](https://docs.mem0.ai/core-concepts/how-it-works)）：抽取后的 ADD / UPDATE / DELETE 合并决策；
- **Graphiti**：实体去重 + LLM 裁决 + 时间失效；
- **LightRAG**（[GitHub](https://github.com/HKUDS/LightRAG)）：增量插入；
- 增量实体解析（incremental entity resolution）研究。

验收：同义概念（向量召回/语义召回）合并率提升；重复节点率下降；合并可回滚。

---

### 任务 E：实时落图、方向与 frontier

**输入**：校验后的节点/关系
**输出**：增量图（节点 + 关系 + 方向 + frontier）

要做的事：

1. 单 episode 事务写入，带 spanId/graphVersion；
2. 新节点必须有 source 来路（孤岛禁令）；
3. 每个节点生成 0–3 条方向（LLM，失败用模板）；
4. 只有 frontier（无向外正式关系）节点在地图上画方向，最多 2 条；
5. 方向被探索后消费，重新计算 frontier；
6. 隐藏/争议变化 → 副本 stale。

参考：

- **Graphiti/Zep**：episode + 实体/边 + provenance；
- **LiveGraph**：流式更新；
- 本仓库现有实现：`directions` 表、`frontier` 计算、方向线物化。

验收：0 孤儿、0 非 frontier 方向线、方向消费后消失。

---

### 任务 F：副本触发（什么时候该出现）

**输入**：当前图（节点/关系/证据）
**输出**：流程/领域副本候选

要做的事：

1. 触发条件（建议规则化）：
   - 流程：存在 3–6 步、有过程证据、唯一顺序的过程；
   - 领域：≥4 个概念有共同上位（kindOf）；
   - 新节点邻域发生变化时触发，不扫全图；
2. 去重：按成员/步骤指纹；
3. 冷却：同邻域 10 分钟内不重复；
4. 上限：每世界每类最多 3 个；
5. LLM 提候选 + 程序硬校验，规则候选兜底。

参考：

- **LiveGraph**：增量触发；
- **MeetGraph**（[PyPI](https://pypi.org/project/meetgraph/)）、**cocoindex meeting-notes-knowledge-graph**（[GitHub](https://github.com/cocoindex-io/meeting-notes-knowledge-graph)）：会议/笔记 → 图并持续更新；
- **Audio GraphRAG**（[lablab](https://lablab.ai/ai-hackathons/amd-developer-hackathon-act-ii/xvision/audio-graphrag)）：音频到图的端到端流程；
- 本仓库：`detectBuildingsLLM` + `detectBuildingsV2`。

验收：流程/领域误报率低；同候选不重复生成；一个世界可以有多个不同副本。

---

### 任务 G：副本规则与挑战

**输入**：副本候选
**输出**：detected → playable → cleared；流程排序 / 领域每日题

要做的事：

1. 流程校验：3–6 步、过程证据、唯一顺序、无环、每步来源、粒度一致；
2. 领域校验：4–8 成员、共同 kindOf 上位或共同来源（不能只是共同邻居）；
3. 出现 vs 可挑战分离：
   - 流程：过程节点 tier≥1；
   - 领域：≥2 个成员 tier≥1；
4. 领域每日 10 题（填空/判断/解答），本地判填空/判断，LLM 判解答；
5. 依据变化 → stale，暂停出题，保留历史；
6. 副本位置：相关节点质心附近，留白不粘连。

参考：

- **Knowledge Space Theory / ALEKS**（[ALEKS](https://www.aleks.com/)）：知识状态/前置闭包 → 决定解锁；
- **Adaptive KG and learning path generation**（[Springer](https://link.springer.com/article/10.1007/s44163-026-01379-w)）：前置关系与学习路径；
- **Question Generation**（[Learning to Ask](https://zenodo.org/records/20114629/files/paper.pdf)、[Counterfactual QG](https://ojs.aaai.org/index.php/AAAI/article/view/39023)）：方向/领域题；
- 本仓库：`dungeons.ts` + 挑战/提交接口。

验收：流程唯一序；领域题每题有依据；状态机不跳过 detected。

---

### 任务 H：评测与可观测

**输入**：真实/模拟语料
**输出**：指标报告（节点/关系/副本/延迟/成本）

要做的事：

1. 离线集：20–30 段中文材料，人工标注实体/关系/谓词/证据；
2. 实时回放：模拟 ASR final 流，测 episode 触发、延迟、重复率；
3. 指标：
   - 节点 P/R、重复节点率、步骤误建率；
   - 关系 P/R、谓词准确率、方向合法率、证据覆盖率；
   - 流程/领域检测 P/R、唯一序正确率；
   - 每 episode token/延迟 p50/p95；
4. 每次算法改动重跑 `pnpm eval`。

参考：

- 本仓库 `server/eval`（已有 12 用例 + 15 副本用例）；
- GraphRAG/Graphiti 的评测思路（实体/边 precision/recall）。

---

## 3. 关键难点与优先级

| 优先级 | 难点 | 为什么难 | 建议先做 |
| --- | --- | --- | --- |
| P0 | 实时触发粒度 | 一句一抽会碎、模型调用多 | episode 缓冲 + 静音/标点 |
| P0 | 节点/步骤区分 | 字符串猜词性会错（已踩坑） | 过程 schema + 名词性校验 |
| P0 | 关系方向 | 模型经常反着给 | 谓词方向表 + 证据顺序校验 |
| P0 | 增量去重 | 同义词会拆成多点 | embedding + LLM 裁决 |
| P1 | 副本触发质量 | 规则 vs 召回矛盾 | 精度优先 + 指纹/冷却 |
| P1 | 方向问题质量 | 模板化、泛泛而问 | LLM + 校验（提到本节点） |
| P2 | 成本/延迟 | 每 episode 多次调用 | 小模型候选 + 主模型校验 |

---

## 4. 参考项目总表（按任务）

| 任务 | 参考 | 借什么 |
| --- | --- | --- |
| A 流式 | LiveGraph、Graphiti/Zep | episode、增量更新、provenance |
| A 分段 | ASR endpointing、TextTiling/GraphSeg | final+静音、主题切分 |
| B 候选 | GraphRAG、LlamaIndex、GLiNER/KeyBERT | schema、类型白名单、候选抽取 |
| C 关系 | GraphRAG、Neo4j Builder、ConceptNet、arXiv:2509.05393 | 谓词、强度、证据、方向校验 |
| D 归并 | Mem0、Graphiti、LightRAG | ADD/UPDATE/DELETE、实体去重 |
| E 落图 | Graphiti、LiveGraph | 事务、版本、frontier |
| F 触发 | LiveGraph、MeetGraph、cocoindex、Audio GraphRAG | 持续摄取、增量触发 |
| G 副本 | KST/ALEKS、学习路径、QG 论文 | 解锁条件、题目生成 |
| H 评测 | 本仓库 eval、GraphRAG 评测 | 指标与回放 |

---

## 5. 需要拍板的参数

1. episode 长度：10–20 秒 / 2–4 句？
2. 结束判据：静音 700ms + 句末标点？
3. 每 episode 最多新节点 3–5 个？
4. 节点候选是否需要"待确认"层（不直接上地图）？
5. 关系正式阈值 0.75、虚线 0.5–0.75？
6. 流程/领域每世界上限 3 个、冷却 10 分钟？
7. 领域每日题按"用户 + 世界 + 领域"计 10 题？

---

## 6. 当前实现对照（2026-11-15）

已实现：

- 流式 ASR（豆包真实 partial/final）+ 文字输入；
- 节点/关系 v2（type/definition/aliases/evidence/predicate/confidence）；
- 过程节点 + 步骤流程副本（不再建"环节"节点）；
- 方向独立表 + frontier 渲染；
- 副本规则校验 + detected/playable/cleared/stale；
- 领域每日 10 题混合题型；
- 节点题库自动生成；
- 手动连线 / 接受建议命名；
- 离线评测（关系 P/R 32.4%/46.0%，谓词 87.0%）。

待补（对应任务）：

- A：episode 缓冲 / 主题分段 / 队列；
- B：候选层 + 名词性程序校验；
- C：方向归一从启发式升级为模型输出+校验；
- D：embedding + LLM 增量归并；
- F：副本触发规则化阈值/冷却完善；
- H：实时回放评测与延迟/成本指标。

---

*本文是流程与任务拆分的记录，不改变已实现代码；后续按任务 A→H 推进。*
