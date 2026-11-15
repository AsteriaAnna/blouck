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

## 0.1 原始定义（所有检测规则的上位依据）

先回到最初设计里每个对象的定义，后面的准入/检测都围绕它们：

| 对象 | 原始定义 | 推论（检测时不能违背） |
| --- | --- | --- |
| **节点** | 基线：一个实体名词；后来明确为**名词性概念**，点开的 MD 记录由它延伸出的学习、了解、思考 | 不是"句子里的名词"；比喻/例子/步骤/口头语不是节点；节点必须可解释、可出题 |
| **节点 MD** | 自由区：用户围绕该概念的学习记录（来源、理解、疑问、类比、资料、关系定位、继续探索） | 比喻（如"RAG 像灰姑娘"）属于 MD 里的"类比"内容，不是图对象 |
| **关系** | 基线：节点之间的关系、联系；后来明确为**归类与定位**，不是随便一条线 | 关系要有谓词、方向、理由、证据；"包含"必须落到 `partOf`（部分→整体）或 `kindOf`（具体→上位） |
| **方向** | 每个节点理论上都有下一步方向；方向线只提示方向，没有 MD | 方向不是关系；只有边缘（frontier）节点把方向画成线；方向问题必须具体到本节点 |
| **副本** | AI 根据已有知识和节点分析生成，用户不能新建；区分"出现条件"与"可挑战条件" | 出现 ≠ 可挑战；流程要有唯一顺序，领域要是同一上位；不能把"组成部分"当"领域" |
| **输入** | 流式语音 + 文字；稳定片段后才落图，临时文字只更新 UI | 检测必须从"稳定 episode"开始，不能对 partial 建节点 |

**用户的三个痛点分别属于哪条定义被违背：**

| 现象 | 被违背的定义 | 对应检测点 |
| --- | --- | --- |
| "RAG 像灰姑娘"生成了灰姑娘节点、RAG→灰姑娘关系 | 节点=名词概念/学习对象；比喻属于 MD | 节点准入检测（角色判定） |
| 节点关系混乱、"包含"理不清 | 关系=归类与定位，有谓词与方向 | 关系谓词/方向检测 |
| 副本出现时机不对、自由度低 | 副本=出现条件与可挑战分离、按玩家状态出现 | 副本触发/节奏检测 |

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

## 2.0 全流程检测点（在哪里识别问题）

整条链路是**逐级依赖**的：上游一个检测没通过，下游的"正确"都不可信。每个阶段先定义"要检测什么"，再谈优化。

| # | 阶段 | 检测问题 | 通过标准 | 不通过怎么办 | 依赖 |
| --- | --- | --- | --- | --- | --- |
| D0 | 输入/分段 | 这是稳定 episode 吗？是学习内容还是玩笑/口头语？ | final + 静音/标点；不是纯寒暄 | 暂存/丢弃，不触发抽取 | — |
| D1 | 节点候选 | 候选是名词概念吗？ | 通过名词性校验 | 进笔记/丢弃 | D0 |
| D2 | **节点准入（角色）** | 它是 topic/subconcept/process，还是 example/metaphor/step/noise？ | 只有 topic/subconcept/process 建节点；其余进 MD/副本 | example/metaphor 写进 MD；step 进流程副本 | D1 |
| D3 | 节点价值 | 有定义、能出题、以后会再学吗？ | 至少一项成立 + 有关于它的断言 | 进"候选层"或笔记 | D2 |
| D4 | 节点归并 | 已有同义/父子概念吗？ | same→合并；parent_child→kindOf；different→新建 | 合并保留 revision | D3 |
| D5 | 关系候选 | 这两个概念有明确语义联系吗？ | 证据句同时涉及两端 | 不建关系 | D2/D4 |
| D6 | **关系谓词** | 是归类/组成/前置/对比/替代/相关，还是类比/举例？ | 谓词在白名单；证据能推出该谓词 | 降级 suggest 或拒绝 | D5 |
| D7 | **关系方向** | 方向符合谓词约定吗？ | kindOf 具体→上位；partOf 部分→整体；prerequisite 前置→后续 | 按证据/定义归一；无法判断→suggest | D6 |
| D8 | 关系线型 | 证据够不够正式？ | confidence≥0.75 且有证据→formal；0.5–0.75→suggest | 无证据不建 | D7 |
| D9 | 图一致性 | 有孤儿/自环/重复/方向反了吗？ | 孤儿 0、非方向自环 0、重复 0 | 回滚该 episode 或修正 | D2–D8 |
| D10 | 方向生成 | 每个节点有方向吗？问题具体吗？ | frontier 节点≥1 条；问题提到本节点 | 模板兜底/重新生成 | D9 |
| D11 | **副本触发** | 现在该出现副本吗？玩家准备好了吗？ | 知识就绪 + 玩家就绪 + 节奏分数≥阈值 | 不出现/延后 | D9/D10 |
| D12 | 副本校验 | 流程唯一序？领域共同上位？ | 3–6 步唯一序；≥4 成员 kindOf；证据齐 | 不生成/标记候选 | D11 |
| D13 | 副本内容 | 题目有依据吗？答案可判吗？ | 每题引用成员+证据；填空/判断本地判 | 剔除无依据题 | D12 |
| D14 | 评测/观测 | 指标是否退化？ | P/R、方向合法率、重复率、延迟达标 | 回滚/调参 | 全链路 |

### 2.0.1 检测信号（每阶段看什么数）

| 检测点 | 关键信号（先看这些） |
| --- | --- |
| D0 分段 | 每次抽取对应的 final 数、episode 时长、切换世界时是否有迟到结果 |
| D2 节点角色 | metaphor/example 被建成节点的数量（灰姑娘类）；每 100 字新增节点数 |
| D3 节点价值 | 无定义/无证据节点比例；只出现一次就建节点的比例 |
| D4 归并 | 同义概念重复率（向量召回/语义召回）；合并次数与回滚数 |
| D6 谓词 | 谓词准确率；`related` 占比是否过高（说明没分类） |
| D7 方向 | 前置反方向数（Rerank→混合检索）；partOf 整体→部分数 |
| D8 线型 | 正式关系缺证据数；suggest 被误升级数 |
| D9 图一致性 | 孤儿、自环、重复边、frontier 与方向线不一致数 |
| D11 触发 | 副本出现时用户是否在输入中；出现后 10 分钟内被忽略/关闭率 |
| D12 校验 | 流程多解被生成数；领域"组成部分"被当领域数 |
| D13 内容 | 题目无依据数；答案判错率 |

### 任务 A：流式输入与 episode 缓冲

> 检测点：D0（稳定 episode、revision、切世界隔离）

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

> 检测点：D1/D2/D3（名词性、角色、价值）；灰姑娘问题在这里解决

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

> 检测点：D6/D7/D8（谓词、方向、线型）；"包含"问题在这里解决

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

> 检测点：D4（same/parent_child/different）

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

> 检测点：D9/D10（孤儿/自环/方向线/frontier）

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

> 检测点：D11（知识/玩家/节奏分数）；副本时机问题在这里解决

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

> 检测点：D12/D13（唯一序/kindOf/题目依据）

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

> 检测点：D14（指标、回放、延迟/成本）

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

## 2.9 依赖依次排查顺序（出问题先查哪里）

按依赖从上游到下游排查，**不要先调副本或界面**——上游错会让下游全部失真。

1. **D0 分段/稳定性**
   - 现象：一句一抽、重复节点多、切世界串数据。
   - 先确认：一次抽取对应几个 final？episode 是否合并？revision 是否丢弃旧结果？

2. **D2 节点角色（灰姑娘问题）**
   - 现象：比喻/例子/步骤被建成节点。
   - 先确认：候选有没有角色？example/metaphor/step 是否被拒绝？
   - 这一步不过，后面的关系一定是"乱七八糟"的，因为对象本身错了。

3. **D3/D4 节点价值与归并**
   - 现象：同一概念多个节点、无定义节点。
   - 先确认：是否有定义/证据/复用？同义是否合并？

4. **D6/D7 关系谓词与方向（包含问题）**
   - 现象："包含"说不清、Rerank→混合检索反向。
   - 先确认：谓词是哪一类？方向是否符合约定？证据能否推出？
   - 这一步依赖 D2：如果灰姑娘被当节点，关系再准也没意义。

5. **D8/D9 线型与图一致性**
   - 现象：虚线/实线混乱、孤儿、自环。
   - 先确认：正式关系是否有证据？有没有重复/方向反？

6. **D10 方向**
   - 现象：方向问题泛泛而谈。
   - 先确认：问题是否提到本节点？是否只给 frontier 画线？

7. **D11/D12 副本触发与校验**
   - 现象：副本出现太早/太晚、把组件当领域、多解流程。
   - 先确认：知识条件、玩家条件、节奏分数是否都满足？流程唯一序/领域 kindOf 是否通过？
   - 这一步依赖 D9：图里方向都乱了，副本成员自然不可信。

8. **D13/D14 内容与评测**
   - 现象：题目无依据、指标漂移。
   - 先确认：每题是否引用成员+证据？离线指标是否退化？

### 2.9.1 一句话排查口诀

```text
先看分段对不对（D0）
→ 再看对象该不该是节点（D2/D3）
→ 再看关系是哪一类、方向对不对（D6/D7）
→ 再看图干净不干净（D9）
→ 再看方向具体不具体（D10）
→ 最后才看副本该不该出现（D11/D12）
```

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
