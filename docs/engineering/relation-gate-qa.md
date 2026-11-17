# 08 · Q&A：锚点优先/关系准入的验证与现状

> 性质：**验证记录 + 现状审计，不是需求，也不是实现基线。**
> 需求看 [four-line-system.md](../product/four-line-system.md)；当前实现看 [line-implementation-notes.md](./line-implementation-notes.md)；代码事实以 [implemented.md](./implemented.md) 和源码为准。
> 记录日期：2026-11-17。旧测试报告来自 Git 历史（`8125bfe` / `dae8b8f` / `5d379ab` 等，文件 `docs/reviews/anchor-first-prototype-2026-11-16.md`，后在文档清理中移出主目录）。

## Q1：这个 dev 效果验证过吗？

验证过，但规模很小：**5 个手写句子、候选预置**，不是产品验收，也不含真实 ASR partial。

旧报告（2026-11-16，锚点优先原型 `POST /api/dev/anchor-first`）：

| 用例 | 结果 | 耗时（慢判） |
|---|---|---|
| 雪白句（RAG/白雪公主/猎人/公主/后妈，锚点知识库） | A1 全不建；A2 只建 RAG（仅来源线），类比不进正式关系；白雪公主等全部 drop | 0.87–1.05s |
| 检索句（RAG 从知识库检索资料） | 知识库 + RAG，formal related（检索/使用） | 0.68s |
| 混合检索句 | 混合检索/BM25/向量召回/Rerank 落图；但混合检索被判 partOf RAG（应为 kindOf 检索），Rerank 方向/标签不准 | 1.87s |
| 否定句（RAG 不是微调） | 微调 role=noise 但 related=true，仍然 commit；规则冲突 | 1.14s |
| 指标句（召回率衡量召回） | formal related（衡量/度量） | 1.07s |

旧报告明确结论：**链路能跑通、雪白句达到预期；但快判/角色/谓词三层都不够稳**。

## Q2：当时的问题解决了吗？

| 问题 | 状态 | 说明 |
|---|---|---|
| 关系准入（没有关系就不建节点） | ⚠️ 原型验证可行，未进正式链路 | A1/A2 能按关系/话题决定建不建；但只在 dev 接口 |
| 比喻/例子被当知识节点 | ✅ 在雪白句上解决 | 规则 + 慢判能 drop metaphor/example |
| 类比被标成 related=true | ✅ 原型用后处理压掉 | label/evidence 含类比/比喻/举例 → related=false |
| 角色判定稳定 | ❌ 未解决 | LLM 会把 topic 判成 metaphor/noise；role=noise 仍可能 commit |
| 谓词选择正确 | ❌ 未解决 | 混合检索 partOf 而非 kindOf；Rerank 方向不清；没有谓词测试题/校验 |
| 快判真的“快” | ❌ 未解决 | 第一层只是句子规则；真正的词对判断是 LLM，约 0.9–1.4s/对 |
| 延迟可接受 | ❌ 未解决 | 慢判 0.7–1.9s/次（候选预置）；加候选抽取总延迟约 1.5–3.5s；不能塞进流式主链路 |
| provisional/修复/重连 | ❌ 未实现 | 没有 ghost 持久化、relink、tombstone；只有 drop/commit |
| 多锚点/真实 ASR/幂等/副本联动 | ❌ 未实现 | 原型只支持单锚点、文本输入，无 graphVersion/副本 |

结论：**解决了“能不能按关系准入”的可行性验证，没有解决“稳定、快、可上线”的问题。**

## Q3：现在的模型能不能通过加入这个效果变得更好？

我用当前模型（同一 dev 接口、当前 DeepSeek）在全新世界上重跑了两句：

### 3.1 雪白句（当前模型）

- 总耗时 **2575ms**：pair_fast 967ms + slow_judge 1608ms；
- 白雪公主/猎人/公主/后妈：全部 `drop_metaphor` ✅；
- 混合检索（技术概念）：被判 `role=noise`、`action=candidate`、`related=false`、label“类比（非知识关系）” → **被当成噪声/候选，不建节点**。
  - 好处：不污染图；
  - 风险：这是**假阴性**——用户提到了一个正常技术概念，却因为句子是类比结构被丢掉。A2 的“topic 先建”也救不了，因为它被判成 noise。

### 3.2 混合检索句（当前模型）

- 总耗时 **3606ms**：pair_fast 1094ms + slow_judge 2510ms；
- 4 个候选全部 `commit_relation`；
- 但谓词仍错：
  - 混合检索 → partOf RAG（应是 kindOf 检索）；
  - BM25/向量召回 → partOf 混合检索（可接受）；
  - Rerank → prerequisite（方向和标签仍不准）。

### 3.3 判断

- **作为流式主链路的同步闸门：现在不行。** 延迟 2.6–3.6s/句（还没算候选抽取），会直接拖垮边说边生成；而且有假阴性（技术概念被判 noise）。
- **作为异步的“候选过滤 + 事后修复”：有潜力。** 可以先用便宜的本地/embedding/词典做粗筛，再把 top 候选批量交给 LLM 慢判；A2 的 topic pending 可以保留误判的节点；后面再 relink/纠正。
- **它不会自动修好关系语义。** 当前模型在谓词/方向上仍然错；要提升得靠谓词测试题、证据校验、方向规则，而不是“加一个快判”。
- **当前评测也说明关系质量仍是短板**：现有 12 例评测 mapType 91.3%、predicate 87.0%、evidence 46.0%、direction 1/5（2026-11-14）；方向命中很低，快判不解决这个。

## Q4：现在的真实链路是什么样，有没有坑？

### 4.1 正式链路

```text
语音：/ws/asr → /stream/segment
  → ingestSegment: llm.extract(text)
  → 先建 provisional 节点（evidence 校验、confidence≥0.6）
  → 每个新节点写 source（parent→new）
  → relations 写 suggest（幂等）
  → /stream/commit: provisional→committed；origin=stream 且有 evidence 的 suggest→formal
  → 不生成方向/题目/副本

文字：POST /extract
  → llm.extract(text)
  → 建节点（evidence 必须在原文、confidence≥0.6）
  → relations：evidence+confidence≥0.75 → formal，否则 suggest
  → 给新节点补 source 来路
  → 对没有方向的节点生成 1 条方向（suggestDirections，含计划目标节点）
  → 前 3 个新节点异步出题
  → detectDungeons（只读 formal）
  → materializeDirectionEdges

探索：POST /explore（edgeId）
  → 读方向计划（没有则懒规划）
  → 建计划节点 + source + formal（沿 frontier 方向）
  → consume 方向
  → 新节点生成方向
  → computeFrontier + materializeDirectionEdges

手动关系：POST /worlds/:id/relations（后端有，前端入口缺）
  → 可选 LLM 补谓词/名称/MD
  → 建 formal，origin=manual
  → computeFrontier + materializeDirectionEdges
```

### 4.2 坑（按严重程度）

1. **没有关系闸门**：`/extract`、`/stream/segment` 都是先建节点再写关系；关系为空/失败时节点仍留下。默认库有 **16 个无 formal/suggest 语义边的可见节点**（排除根节点）；它们只靠 source 挂着。这是“关系优先”需求与现状最大的冲突。
2. **commit 自动升级过宽**：所有 `origin=stream` 且有 evidence 的 suggest 都会转 formal；没有二次验证，弱关系/错误关系会直接变正式知识，并进入副本检测。
3. **source/sequence 是补丁**：source 边只保证“看起来不孤立”，不代表语义关系；把它当顺序线会让用户误以为节点已被关系接入。
4. **关系语义质量不稳**：谓词/方向仍会错（当前模型重跑混合检索句仍是 partOf/kindOf 错误；方向命中 1/5）；快判不解决。
5. **流式链路没有方向/题目/副本**：commit 只做状态迁移；所以“节点完成后生成 4 条探索线”目前只存在于文字/探索链路，不在语音主链路。
6. **方向能力不完整**：每节点只生成 1 条、物化最多 2 条、只渲染 frontier、非外围不展示；没有 4 条/用完再生成/隐藏条补显示；旧方向需要懒规划。
7. **suggest 没有池/上限**：所有 open suggest 都画，没有 4 个展示位、没有新节点重算。
8. **手动关系入口缺失**：后端 API 有，前端 UI 在 MVP 重写 NodeDrawer 时删掉；且手动线可绕过证据/校验，可能污染副本。
9. **副本触发单一**：只在 `/extract` 检测；语音/手动关系变化不会触发；没有 stale/去重/上限；只读 formal。
10. **事务/幂等/并发**：无事务封装；方向落图多写；题目生成有并发竞态（并发会生成 30 题）；边幂等靠单键，source 与 formal 可同时存在同一对节点。
11. **LLM 失败/空结果**：extract 失败返回空+warning，但 `/extract` 响应不总是带 warning；前端只显示“没有新实体”，用户不知道是模型失败还是真的没有。
12. **关系方向/证据质量**：evidence 覆盖率 46%，方向命中 1/5；这是评测层面的硬伤，不是动画问题。

## Q5：建议怎么验证“加这个效果能不能变好”

不要直接上主链路。先做 A/B 离线实验：

- 语料：同一批 30–50 句（含技术概念、比喻、否定、指代、多话题）。
- A：当前 `/extract`（现状）。
- B：关系准入（A2：topic pending + relation gate）。
- C：B + 本地/embedding 快筛 + 批量慢判 + 谓词测试题。
- 指标：节点 precision/recall（误建率/漏建率）、关系 predicate/direction/evidence、假阴性、P50/P95 延迟、用户可读性。
- 通过标准：节点误建显著下降，同时技术概念漏建不超过可接受阈值；延迟不拖垮主链路；关系谓词/方向不退化。

在这个实验之前，**不建议把锚点优先接回正式链路**。

## Q6：这套“核心学习/游戏循环”偏离原设计了吗？之前没做过吗？

### 6.1 结论

**没有完全偏离：大部分内容原设计就有；我新增的主要是“核心循环”这个组织方式，以及更硬的“关系优先准入”。**

原设计（文档清理前）里已经有：

- **节点 MD 四区**：来源 / 我的理解 / 关系定位 / 继续探索（`docs/reference/product-baseline.md`）；
- **关系 MD**：谓词、方向、理由、来源证据、用户补充；正式关系不可删，建议≠正式（`docs/reference/algorithms.md`、`requirements.md`）；
- **节点准入**：必须是学习对象、可解释、有证据/来源；比喻/例子/步骤/口头语不建节点；
- **方向**：每节点 0–3 条；只有 frontier 画线；非 frontier 放节点 MD；点击消费；
- **副本游戏感**：出现≠可挑战；不在输入中打断；自然停顿出现；玩家有选择；同时出现数量受控；依据变化要 stale（`requirements.md`）；
- **关系题目/三档**：关系有判断题和展示档位（阈值未定）。

我新增/强化的、原设计没有明确写的：

- 把这些组织成一个显式的 **capture → structure → confirm → understand → practice → progress** 循环；
- 建议**先做循环、再把四类线当视图**；
- **“新节点必须有语义关系才生成”** 这个硬闸门。原设计只要求“节点是学习对象 + 有证据/来源 + 不能孤岛（要有探索来路）”，并没有要求先有关系；锚点优先是后来的 dev 方案，不是原基线。

### 6.2 为什么现在感觉“没做过”

1. **旧设计文档被清理了**：`380c69a`（docs: 清空旧文档）把 `docs/reference/product-baseline.md`、`docs/design/requirements.md`、`docs/reference/algorithms.md` 等移出主目录；当前 01/02 只是压缩摘要，03 只记实现。设计的“为什么”丢了。
2. **实现层被 MVP 砍过**：`82c38ce`（MVP 前端改动）之前，`NodeDrawer` 有题库/三档/关系定位/手动关联/继续探索/隐藏；`RelationDrawer` 有关系 MD 编辑、证据、置信度、claim_status。MVP 为了“干净”把这些隐藏/删了。现在体验受损，部分是**自己砍掉了知识/游戏层**，不是从来没设计。
3. **原设计本身也没完全落地**：节点 MD 四区、关系题、副本游戏感条件、stale/数量控制等，很多只停留在需求/算法文档，代码没有完整实现。

### 6.3 这些内容为什么重要

| 内容 | 为什么是产品核心，而不是附加功能 |
|---|---|
| 节点 MD 四区 | 节点不只是“定义”；来源/理解/关系定位/继续探索才是学习发生的地方。只有定义，地图就是目录。 |
| 关系 MD（定位/辨析/对比） | 学习的关键动作是区分两个概念；一句话关系说明不足以支撑理解。 |
| 节点准入 + 关系证据 | 决定用户是否信任这张图；关系错了，MD/副本/游戏全部失效。 |
| 方向（frontier/MD 分流） | 决定用户“下一步去哪”，也是地图不拥挤、不无限膨胀的关键。 |
| 副本出现/可挑战/选择/stale | 这是“游戏感”的来源：不是有副本就叫游戏，而是时机、选择、风险、反馈、失效。 |
| 关系题/三档 | 提供检索练习和掌握反馈；删掉后游戏层只剩探索，学习闭环断了。 |

### 6.4 二阶/三阶影响

- 如果继续把“四类线/动画/池”当主线，而不恢复原设计里的 MD/准入/副本题材：会**重复造需求**，旧文档和新文档冲突，实现越来越复杂但体验不变。
- 如果一次性恢复旧设计全部内容：复杂度/延迟会反弹，所以需要**纵向切片**，不是全量回滚。
- 如果继续让旧设计文档缺失：团队会反复“重新发现”同一结论，维护成本高，且容易把已砍掉的能力当新需求再做一遍。

### 6.5 建议

1. **恢复“设计来源”文档**：把旧 `product-baseline / requirements / algorithms` 作为「设计基线（历史但有效）」恢复/链接，而不是当实现依据；
2. 做一张 **需求 → 当前实现 → 状态（已实现/曾实现被删/未实现）** 的对照表；
3. 先选一个纵向切片恢复：节点 MD 四区 + 关系 MD + 手动关系 + 一个满足“出现/可挑战/选择/stale”的副本；四类线作为视图后置。

---

**关系**：本文件是 Q&A/验证记录；需求在 06，实现在 07，事实基线在 03。
