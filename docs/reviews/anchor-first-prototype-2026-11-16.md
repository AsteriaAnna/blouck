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
