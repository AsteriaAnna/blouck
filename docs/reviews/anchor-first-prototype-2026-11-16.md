# 锚点优先垂直切片 · 测试报告

日期：2026-11-16
性质：dev 原型测试（不是产品验收、不是生产链路）
代码：`server/src/anchorFirst.ts` + `POST /api/dev/anchor-first`
方案：用户提出的 A 方案（锚点 → 候选 → 快判 → provisional → 慢判 → commit/修复 → 方向/推荐）

---

## 1. 这次做了什么

新增 dev 接口：

```text
POST /api/dev/anchor-first
{
  worldId, anchorId?, text,
  candidates: [{name}],
  variant: "A1" | "A2",
  apply: boolean
}
```

链路：

```text
加载锚点/已有节点
  → 快判（确定性规则：像/一样之后=喻体；像之前=话题候选；附近线索=possible；否则 defer）
  → 慢判（一次 DeepSeek 批量：role + related + predicate + direction + evidence + recommendations）
  → 决策（existing / drop_metaphor / drop_unrelated / commit_relation / commit_topic_pending / candidate）
  → apply：建节点/来源线/正式或建议关系/方向
  → 返回 timeline、fast、decisions、nodes、edges、totalMs
```

两个变体：

- **A1 严格**：没有知识关系就不建节点；
- **A2 话题优先**：topic 节点可以"关系待确认"先建，只保留来源线，不建正式知识边。

---

## 2. 测试结果

### 2.1 雪白句

输入：

> 我感觉 RAG 和知识库的关系就像白雪公主里那个派猎人去追杀公主的后妈一样。

候选：RAG、白雪公主、猎人、公主、后妈；锚点：知识库。

| 变体 | 快判 | 慢判 | 结果 |
| --- | --- | --- | --- |
| A1 | RAG=possible；其余=metaphor | RAG role=topic，related=false，label=类比（非知识关系） | **只留知识库**；不建 RAG、不建白雪公主等；无正式关系 |
| A2 | 同上 | 同上 | **知识库 + RAG**；RAG 只有来源线；**没有类比正式关系**；白雪公主等不建 |

耗时：A1 1053ms，A2 868ms（只有一次慢判，候选预置，不含候选抽取）。

**这是预期结果**：白雪公主/猎人/公主/后妈全部被排除；类比只作为标签，不进正式图。

### 2.2 检索句

> RAG 从知识库检索资料，然后再生成回答。

候选：RAG；锚点：知识库。

结果：

- 节点：知识库 / RAG
- 关系：`formal / related / 检索/使用`
- 耗时：684ms

符合预期：RAG 是话题，和知识库有"使用/检索"关系，formal。

### 2.3 包含/混合检索句

> 混合检索把 BM25 的关键词召回和向量召回合并，然后用 Rerank 精排。

候选：混合检索、BM25、向量召回、Rerank；锚点：RAG。

结果：

- 节点：RAG / 混合检索 / BM25 / 向量召回 / Rerank
- 关系：
  - 混合检索 —suggest partOf— RAG（label 检索方式/组成）
  - BM25 —formal partOf— 混合检索（关键词召回组件）
  - 向量召回 —formal partOf— 混合检索（向量召回组件）
  - Rerank —suggest prerequisite—（合并后精排）
- 耗时：1866ms

**问题：**

1. "混合检索"应该是 `kindOf` 检索（是一种检索方式），不是 `partOf` RAG；
2. `Rerank` 的前置方向/标签不够准；
3. 慢判输出仍是"模型自由选谓词"，没有按关系测试题校验。

### 2.4 否定句

> RAG 不是微调，RAG 不改模型参数。

候选：微调；锚点：RAG。

结果：

- 节点：RAG / 微调
- 关系：`formal / contrast / 对比/区别`
- 耗时：1138ms

**问题：**

- 模型把"微调"role 判成 `noise`，但 `related=true`，当前决策逻辑仍然 commit 了节点；
- 说明**角色与关系的优先级没有定**：role=noise 时，关系为真是否还能建节点？
- 这个用例本身结果可接受（微调确实是概念），但暴露了 action 规则不严谨。

### 2.5 指标句

> 召回率衡量召回效果，召回率越高说明召回越全。

候选：召回率；锚点：召回。

结果：

- 节点：召回 / 召回率
- 关系：`formal / related / 衡量/度量`
- 耗时：1070ms

符合"MD-first + 自由标签"：没有新增 `measures` 谓词，用 `related(衡量)` 表达。

---

## 3. 延迟

| 场景 | 耗时（候选预置） |
| --- | --- |
| 雪白 A1 | 1053ms |
| 雪白 A2 | 868ms |
| 检索 | 684ms |
| 包含 | 1866ms |
| 否定 | 1138ms |
| 指标 | 1070ms |

- 快判：<1ms（确定性规则）；
- 慢判：0.7–1.9s（一次 DeepSeek 调用）；
- **不含候选抽取**：真实链路还要加候选抽取（0.5–2s），总延迟约 1.5–3.5s。

---

## 4. 测试发现（重要）

### 4.1 快判规则太脆弱

- 目前只识别"像/一样/如同/似的"作喻体；
- "RAG 像灰姑娘"有效，但换一种比喻（"RAG 让我想到灰姑娘"）就失效；
- 快判没有角色/指代/否定能力，只能做极粗筛。

### 4.2 LLM 会把话题判成隐喻/噪声

- 第一次测试：雪白句里 RAG 被判成 `metaphor`/`noise`；
- 加 prompt 规则（"像之前的候选是话题"）后才变成 topic；
- 说明**角色判定不能只靠 LLM 自由发挥**，需要快判/规则/显式角色问题。

### 4.3 "类比"会被标成 related=true

- 模型输出 label "类比关联"，related=true；
- 必须后处理：label/evidence 含"类比/比喻/举例/就像/一样" → related=false；
- 这验证了"related 布尔值不可信，必须看证据/标签"。

### 4.4 角色与关系的优先级未定

- 微调 role=noise 但 related=true → 当前仍 commit；
- 需要明确：role=noise/step 是否允许 commit？关系为真能否覆盖角色？
- 这是产品规则，不是模型问题。

### 4.5 谓词仍由模型自由选择

- 混合检索被判 partOf，而不是 kindOf；
- Rerank 前置方向/标签不准；
- 说明"自由标签 + 核心谓词"需要一套**谓词测试题/校验**，不能只靠一次 prompt。

### 4.6 变体 A1/A2 体验差异明显

- A1：雪白句什么都不建，用户可能觉得"我提到了 RAG 怎么没有"；
- A2：RAG 留下，关系待确认，但多一个弱节点；
- 这是产品取舍，需要真实用户测试。

---

## 5. 结论

- **链路可以串联，端到端能跑**：锚点→候选→快判→慢判→commit/修复→方向，一次慢判 0.7–1.9s；
- **雪白句达到预期**：A1 不建、A2 只建 RAG、白雪公主等不进图、类比不进正式关系；
- **但快判/角色/谓词三层都不够稳**：
  1. 快判只覆盖"像/一样"；
  2. LLM 角色判定不可靠；
  3. 类比会 related=true；
  4. role=noise 仍可 commit；
  5. 谓词选择没有校验。
- 这些正是下一步要补的规则/实验，不是"链路不通"。

---

## 6. 下一步建议

1. **快判扩充**：比喻/举例/否定/指代的规则集，而不是只有"像"；
2. **角色判定单独评测**：30 句标注，测 role 准确率；
3. **action 优先级定稿**：existing > metaphor/example > relation? > role noise? > topic pending；
4. **谓词测试题**：对每对候选问"部分/种类/前置/对比/无关"，替代一次自由 prompt；
5. **加候选抽取延迟**：真实链路测总 P95；
6. **UI ghost/时间线**：把 decisions/timeline 显示出来，才能看"闪不闪"。

---

*本报告只记录 dev 原型测试，不改变主链路与需求基线。*


---

## 7. 快判复盘：我做的不是"只给两个词"，而是句子模式

### 7.1 我实际怎么做的

- 输入：整句 + 锚点名 + 候选名；
- 找"像/好像/如同/似的/一样"的位置；
- "像"之后的候选 → `metaphor`；
- "像"之前的候选 → `possible`；
- 附近有线索词 → `possible`，否则 `defer`。

所以它判断的是**句子里的位置/比喻结构**，不是"知识库 ↔ RAG 这两个词之间有没有关系"。

### 7.2 这个效果对吗？

- 对"雪白句"这个特定输入，结果是对的：白雪公主等被排除；
- 但机制不对：换一种比喻（"RAG 让我想到灰姑娘"）就失效；
- 它也无法回答"只给知识库和 RAG，有没有关系"；
- 所以不能把这次结果当作"pair-only 快判有效"的证据。

### 7.3 只给两个词的对照测试

用 DeepSeek，仅输入 A/B 名称（无句子），要求输出 `possible/unrelated/defer`：

| 词对 | 判定 | 耗时 |
| --- | --- | --- |
| 知识库 ↔ RAG | **possible**（RAG 常以知识库为数据源） | 1372ms |
| 知识库 ↔ 白雪公主 | **unrelated**（不同知识域） | 856ms |
| 知识库 ↔ 猎人 | **unrelated** | 1204ms |
| 知识库 ↔ 公主 | **unrelated** | 1114ms |
| 知识库 ↔ 后妈 | **unrelated** | 1035ms |
| 知识库 ↔ 向量数据库 | possible | 1159ms |
| 召回 ↔ 召回率 | possible | 1174ms |
| 语义检索 ↔ 混合检索 | possible | 1062ms |
| RAG ↔ 微调 | possible | 1105ms |

**结论：**

1. 只给两个词，LLM **能**做出合理的 relatedness 判断：RAG 保留，白雪公主等排除；
2. 但每个 pair **0.9–1.4s**，如果 5 个候选就是 5–7s，不算"快判"；
3. 它只能给 `possible/unrelated`，**不能给谓词/方向/证据**，慢判仍需要；
4. 它无法识别"这是比喻/类比"——pair-only 会把 RAG↔灰姑娘判成 unrelated（这对排除是对的，但不会留下"类比"笔记）。

### 7.4 正确的快判应该是什么

**快判 = pair-level 相关度过滤，不是句子角色判定。**

```text
快判（pair-only）：
  输入：锚点(名称/定义/MD) + 候选(名称/定义)
  输出：possible / unrelated / defer
  手段：embedding/小模型/批量 LLM
  目标：筛掉明显不同域的候选，不追求谓词/方向

句子级角色判定（另一层）：
  输入：整句 + 候选
  输出：topic / example / metaphor / step / noise
  目的：处理"像/比如/工作流步骤"这类语境角色
```

两层不能混：

- pair-only 判"知识库 vs 白雪公主"→ unrelated（域不同）；
- 句子级判"白雪公主在这句里是喻体"→ metaphor（语境）；
- 两者都成立，但原因不同。

### 7.5 对原型的修正建议

1. 把当前"像/一样"句子规则从"快判"里拆出去，作为**角色判定**；
2. 快判改为 pair-only：先用 embedding/小模型算相关度，必要时批量 LLM；
3. 快判只输出 possible/unrelated/defer，不输出 metaphor；
4. 慢判再给谓词/方向/证据；
5. 批量：一次给多个候选，不要每个 pair 一次 LLM；
6. 如果坚持"快"，必须用本地 embedding/小模型；LLM pair judge 是 1s 级，不是毫秒级。

### 7.6 一句话

**我之前的快判是"句子模式"，不是你要的"词对判断"；词对判断本身可行且结果合理，但 LLM 版本不够快，需要 embedding/小模型 + 批量。**


### 7.7 重复测试：LLM + 只给两个词（3 轮）

说明：这不是原型里的快判（原型快判仍是确定性句子规则），而是单独验证"pair-only LLM 判断"。

| 词对 | 3 轮 verdict | 稳定性 | 平均耗时 | 置信度 |
| --- | --- | --- | --- | --- |
| 知识库 ↔ RAG | possible / possible / possible | ✅ | 1004ms | 0.95 |
| 知识库 ↔ 白雪公主 | unrelated / unrelated / unrelated | ✅ | 965ms | 0.85 |
| 知识库 ↔ 猎人 | unrelated / unrelated / unrelated | ✅ | 834ms | 0.85 |
| 知识库 ↔ 公主 | unrelated / unrelated / unrelated | ✅ | 953ms | 0.85–0.90 |
| 知识库 ↔ 后妈 | unrelated / unrelated / unrelated | ✅ | 1032ms | 0.90 |
| RAG ↔ 灰姑娘 | unrelated / unrelated / unrelated | ✅ | 955ms | 0.90 |
| 召回 ↔ 召回率 | possible / possible / possible | ✅ | 892ms | 0.95 |
| 语义检索 ↔ 混合检索 | possible / possible / possible | ✅ | 929ms | 0.95 |

总计：24 次调用，**avg 946ms、p50 968ms、p95 1148ms**。

结论：

1. **pair-only LLM 判断很稳定**：8/8 对 3 轮一致；
2. **语义判断符合直觉**：知识库↔RAG possible；童话角色 unrelated；召回↔召回率 possible；语义检索↔混合检索 possible；
3. **RAG↔灰姑娘被判 unrelated**：pair-only 会直接排除它——这对"不建节点"是对的，但**无法留下"类比"笔记**；比喻/类比必须靠句子级角色判定；
4. **仍然不快**：每个 pair 约 1s；如果 5 个候选逐个调用就是 5–6s；必须批量（一次多对）或用 embedding/小模型，才能叫"快判"；
5. 置信度不能替代证据：possible 只说明"可能相关"，谓词/方向/证据仍要慢判。

**因此：pair-only LLM 可以作为"慢速的粗筛"或"批量候选判断"，但不能当毫秒级快判；真正的快判需要本地小模型/embedding，或一次批量 LLM。**


---

## 8. 三层串联后的完整测试（2026-11-16）

链路：

```text
句子角色预筛 → 批量 LLM 词对快筛 → 慢判（谓词/方向/证据/无关）
→ decisions（existing/drop_metaphor/drop_unrelated/commit_relation/commit_topic_pending/candidate）
→ apply（节点 + 来源线 + 关系 + 方向）
```

### 8.1 结果

| 场景 | total | 快筛 | 慢判 | 结果 |
| --- | ---: | ---: | ---: | --- |
| 雪白 A1 | 2410ms | 1030ms | 1378ms | 知识库；RAG 不建；白雪公主等全排除 |
| 雪白 A2 | 2142ms | 1173ms | 946ms | 知识库 + RAG（仅来源线）；无类比正式关系 |
| 检索 | 1534ms → 修后 1469ms | 661ms | 860ms | RAG + `formal related 使用/检索` |
| 包含 | 3149ms → 修后 2737ms | 1278ms | 1820ms | RAG/混合检索/BM25/向量召回/Rerank；**混合检索仍 partOf RAG** |
| 否定 | 2443ms | 1165ms | 1265ms | RAG + 微调 + `formal contrast 对比/区别` |
| 指标 | 1965ms | 1030ms | 922ms | 召回 + 召回率 + `formal related 衡量` |

### 8.2 已修对的部分

1. **雪白句**：A1 不建 RAG、A2 只建 RAG；白雪公主/猎人/公主/后妈全部排除；类比只作为标签，不建正式关系；
2. **检索句**：加谓词消歧后从错误的 `prerequisite` 修正为 `related 使用/检索`；
3. **否定句**：`contrast` 方向/线型正确；
4. **指标句**：`related 衡量`，没有硬造 `measures` 谓词；
5. **延迟**：整条链路 1.5–3.1s（不含候选抽取），其中快筛 0.7–1.3s、慢判 0.9–1.8s。

### 8.3 仍不对的部分

1. **包含句谓词仍错**：
   - 混合检索、BM25、向量召回、Rerank 全被判 `partOf`；
   - "混合检索"是 RAG 使用的方法，不是 RAG 的一部分；应该是 `related(使用/组合)` 或 `kindOf`；
   - 说明 prompt 消歧仍不够，模型仍倾向"partOf 万能化"。
2. **快筛/慢判两次 LLM 调用**：快筛没有真正"快"，只是批量化；如果要毫秒级，需要本地 embedding/小模型。
3. **句子预筛只覆盖"像/一样"**：其他比喻/举例（"让我想到""好比"）会漏。
4. **候选抽取未计入延迟**：真实链路还要加抽取（0.5–2s），总延迟可能 2–5s。
5. **没有 UI ghost/时间线**：目前只有接口返回，看不到"闪不闪"。
6. **修复/重连未真正实现**：当前只有 drop/commit，没有"发现更合适的已有节点后重连"。

### 8.4 结论

- **整条链路可以跑通**：雪白句、检索、否定、指标基本正确；
- **A1/A2 差异可见**；
- **仍有一个明确的语义错误（包含句 partOf）**，以及"快筛不真快、候选抽取未计入、无 UI"三个工程缺口；
- 下一步优先级：
  1. 谓词消歧/测试题（partOf vs kindOf vs related）；
  2. 候选抽取纳入链路并测 P95；
  3. UI ghost/时间线；
  4. 修复/重连逻辑；
  5. 快筛换本地 embedding/小模型。
