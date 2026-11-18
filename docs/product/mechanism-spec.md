# 机制规格：老师先走一步

> 目的：把“AI 应该先判断、再展示”落成可实现的机制，而不是让用户在点击后才看到生成结果。
> 适用：关系线、节点卡、题目、领域/流程副本。
> 标记：✅ 已实现；🟡 部分实现；⬜ 设计目标，未实现。

## 1. 关系线：先生成“答案”，再决定要不要画

### 1.1 旧流程为什么错

旧流程：

```text
LLM 抽实体/关系
→ 关系标记成 suggest
→ 直接画虚线
→ 用户点击
→ 才生成关系文档/问“是什么关系”
```

这就是“先画线、后找理由”。用户看到的是猜测，且点击后才补解释；如果没证据，就只能显示“未在给定证据中说明”。

### 1.2 目标流程

```text
1. 原文入库（source_span）
2. 生成候选概念对（co-occurrence / 明确关系句 / 同一段）
3. 证据检查：同一 source_span 中必须同时出现两端，或不歧义指代
4. 关系判定（LLM + 程序校验）：
   {
     verdict: "hold" | "uncertain" | "reject",
     predicate: kindOf|partOf|prerequisite|contrast|alternative|related,
     direction: "src->dst" | "dst->src" | "none",
     reason: "为什么成立/为什么不确定（必须引用原文）",
     evidence_quote: "原文子串",
     boundary: "什么情况下不成立",
     confusable_with: ["最容易混的类型/概念"],
     confidence
   }
5. 门：
   - reject：不建线
   - uncertain：只能建“假设线”，必须带具体 reason + evidence；不能出事实题
   - hold：建正式关系线；必须有 evidence + canonical predicate
6. 预生成卡片（异步可以，但必须在展示前完成或显示“生成中”，不能点击后才开始思考）
7. 地图只展示“已经判定”的线
```

**核心原则**：线是“判定结果”的视图，不是“判定的入口”。

### 1.3 触发条件（什么时候才允许 suggest）

候选对进入判定前必须满足：

- 同一 `source_span` 中出现两端名字（或明确指代链）；
- 至少一句包含两端，或一个明确关系句；
- 两端不是同一节点、不是已存在同 predicate 关系；
- 每节点候选数受限（例如最多 6 个候选，地图只展示 2 个）。

结果：

- 没有关系证据 → **不画线**，最多进后台候选池；
- 有关系但不确定 → `suggest`，必须带 reason（如“原文只说二者并列，没有上下位证据”），不能是“可能相关”；
- 有明确证据 + predicate → `formal`；
- 不允许“置信度足够就把 suggest 自动升级 formal”；必须经过判定结论。

### 1.4 当前实现

- ✅ 手动/建议接受现在要求 evidence，无证据 400。
- ✅ demo 重建，所有 formal 都有 predicate/evidence。
- ✅ 抽取阶段：语义关系必须 evidence 同时包含两端，否则不建线。
- 🟡 尚未新增独立 `relation_verifier` 流程；当前仍依赖抽取 LLM 的 `type/predicate`，`suggest` 的理由主要来自 `label/evidence`，不是结构化判定结果。
- 🟡 `suggest` 仍与“方向问题”共享部分字段，未完全拆成独立 hypothesis 状态。

## 2. 线内到底显示什么

### 2.1 关系线

必须显示：

```text
一句话：A 是 B 的什么（必须出现 A、B、predicate 语义）
类型/方向：kindOf 具体→上位；partOf 部分→整体；prerequisite 前置→后续；...
依据：原文引用（不是模型解释）
边界：什么情况下不成立
易混：最容易混的另一种类型/概念
反例：一个具体反例
我的笔记
```

禁止：

- “A 与 B 相关”作为唯一内容；
- “证据未显示…故定位为相关”这种模型推理说明；
- 点击后才生成“一句话”。

### 2.2 节点卡

定义模板（必须至少满足 2 条，最好 3 条）：

```text
X 是【上位类别】，它的区别特征是【关键特征】，用于【用途/边界】；
它容易和【近邻】混，区别是【边界】。
```

反例：

- ❌ “RAG 是一种检索增强生成技术。”（同义反复）
- ❌ “向量数据库与上下文窗口都是技术概念。”（不是定义）
- ✅ “向量数据库：按向量相似度存储和检索 embedding 的数据库，区别于关键词检索；检索之前需要先建立向量索引。”

节点位置不能只列“相关”；每条必须带 predicate + direction + evidence。没有证据的邻居不展示为关系，最多显示“候选/待确认”。

### 2.3 方向线/提示线/序列线

- 方向线：问题 + 目标节点预览 + 为什么值得探索；不显示关系断言。
- 提示线：候选关系 + 具体理由 + 证据；没有理由的不出现。
- 序列线：从哪次输入/哪句/第几步生成；不承担知识解释。

## 3. 题从哪里来

题不是“从节点文档生成”，而是从**判定阶段发现的误解/边界**来。

### 3.1 关系题

输入：

```text
A、B 的定义
predicate + direction
evidence_quote
boundary
confusable_with（错误类型/近邻）
```

输出：

```text
learning_goal: discriminate | explain | apply | transfer
misconception: 一个具体误解（来自 confusable_with/boundary）
stem: 比较/边界/反例/迁移题，必须提到 A、B
choices: 至少两个，含错误干扰项
correct: 一个
rubric: 覆盖“类型、方向、证据、边界”
evidence_quote
follow_up
```

硬规则：

- 无 evidence → 不出事实题；
- 无法指出一个具体误解 → 不出题；
- 题干不能是“X 是什么”；
- 答案不能只靠抄定义；
- 低分题（可抄定义/无干扰项/无比较）重写或降级。

### 3.2 节点题

输入：节点定义、source_quote、最近邻/易混节点、boundary。
输出：体系位置/边界/对比/迁移题，必须带原文依据；不能是定义默写。

### 3.3 副本题

副本不重新“随便出题”，而是从已判定的关系题中选：

- 选 1–2 条最有辨析价值的关系（类型权重/证据/易混度）；
- 每条关系选 2–3 个任务（边界/反例/迁移）；
- 全部带 evidence；
- 低质量题不得进入副本。

## 4. 备用：旧定义题

- 旧 short/judge 只作为“复习模式”；
- 不再从 definition 直接生成主路径题；
- 节点升档可由辨析答对触发（✅ 已实现 at least tier 1），旧题仅用于继续升档。

## 5. 副本/领域：字段、遍历与校验

### 5.1 领域副本（domain）

**字段**：

```text
edges.kind = formal
edges.predicate ∈ {kindOf, partOf}
edges.evidence 非空
nodes.hidden = 0
nodes.source_span_id 非空（成员应有来源）
```

**遍历**：

1. 取所有 formal `kindOf/partOf` 边；
2. 按“上位/整体”节点分组（kindOf dst；partOf dst）；
3. 每组取成员 4–8 个，排除已属于其他领域超过 50% 的成员；
4. 候选必须有一个共同上位/整体；没有则拒绝；
5. 计算证据覆盖率：成员至少有 1 条带 evidence 关系；否则拒绝；
6. 领域名 = 上位/整体名（2–12 字）。

**校验**（`validateDomainCandidate`）：

- 成员数 4–8；
- 成员不隐藏；
- 共同上位存在；
- 重叠 ≤50%；
- confidence ≥0.7。

### 5.2 流程副本（flow）

**字段**：

```text
edges.kind = formal
edges.predicate = prerequisite（首选）或 label 含过程词（兜底）
edges.evidence 非空
步骤节点 3–6 个
```

**遍历**：

1. 取 formal prerequisite/过程词边；
2. 弱连通分量；
3. 每个分量作为候选步骤集；
4. 用 evidence 建立先后约束；
5. 计算线性扩展数：必须恰好 1 种顺序；
6. 每一步至少一条 evidence；没有则拒绝。

**校验**（`validateFlowCandidate`）：

- 步骤数 3–6；
- 先后约束 ≥步骤数−1；
- 无环；
- 线性扩展唯一；
- 证据含过程词/先后关系；
- confidence ≥0.75。

### 5.3 副本出现时机

```text
ready = 可见节点 ≥8
      && 有证据 formal 边 ≥4
      && frontier 节点 ≥1
```

满足后才运行 detect；副本状态：

```text
detected（发现/未解锁）
→ 相关成员 tier≥1
→ playable
→ 全部关卡答对
→ cleared
```

**不允许**在第一次输入、节点很少、没有方向时出现副本。

**当前实现**：

- ✅ `dungeonReadiness` 门槛已接入 `detectBuildingsLLM/V2`；
- ✅ domain 现在按 kindOf/partOf 分组；
- ✅ flow 现在优先 prerequisite，并带 evidence；
- 🟡 `detectBuildingsLLM` 仍可能用 LLM 候选；需要后续把候选也接到关系判定结果；
- 🟡 demo seed 直接建副本（演示数据例外）。

## 6. 当前差距清单

| 机制 | 目标 | 当前 | 状态 |
|---|---|---|---|
| 关系判定 | 先 verify 再画线 | 抽取 LLM 一步给 type；手动接受有证据门 | 🟡 |
| suggest 理由 | 结构化 reason/evidence | 有 evidence 才能建；无独立 reason 字段 | 🟡 |
| 线内容 | 判定后预生成 | 关系卡可异步生成；证据已前置 | 🟡 |
| 节点定义 | 模板/质量闸 | 抽取定义；无定义质量校验 | ⬜ |
| 关系题 | 从误解/边界生成 | 从关系证据+neighbors 生成；有质量审计 | 🟡 |
| 节点题 | 从边界/近邻生成 | 已接来源/边界，但仍通用 prompt | 🟡 |
| 领域 | kindOf/partOf + 证据 | 已按字段分组；证据覆盖率未硬校验 | 🟡 |
| 流程 | prerequisite + 唯一顺序 | 已按 predicate/evidence；校验已有 | ✅/🟡 |
| 副本时机 | 积累+方向+证据 | 门槛已实现 | ✅ |
| 假设状态 | 独立 hypothesis | 用 suggest/虚线/文案表达 | ⬜ |

## 7. 需要产品确认的三件事

1. 无证据的候选关系：允许作为“假设线”显示，还是只进后台候选池？
2. 关系判定是否允许一次 LLM call 处理一批候选（成本）？还是每条关系单独 verify？
3. 领域/流程的发现条件是否就按 §5.3 的三项阈值？
