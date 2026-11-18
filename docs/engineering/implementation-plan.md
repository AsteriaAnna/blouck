# 落地实施方案（唯一需要看的执行文档）

> 目标：把“老师先判定、再展示”落到每个环节。
> 读法：只看本文；其余设计/审计文档是附录。
> 标注：✅ 已完成；🟡 已有基础；⬜ 待实现。
>
> 核心约束：
> 1. **没有判定结果，不建线、不出卡、不出题。**
> 2. **点击只读，不在点击时让模型开始思考。**
> 3. **所有事实内容必须能回指 source_span。**
> 4. 每个阶段可独立合并、独立验收，不一次性大改。

## 0. 总览：按依赖顺序

| 阶段 | 内容 | 依赖 | 规模 | 完成定义 |
|---|---|---|---|---|
| P1 | 证据句关系抽取 + 规则/归一化判定 | 无 | 2–3 天 | formal 必须能回指关系句；没有句子就不建线 |
| P2 | 卡片/题目预生成 | P1 | 2 天 | 点击只读；未生成显示“准备中” |
| P3 | 节点定义质量闸 | P1 | 1–2 天 | 空泛定义进草稿，不出事实题 |
| P4 | 题目从误解/边界派生 | P1/P3 | 2–3 天 | 题带 `derived_from`，不是通用 quiz |
| P5 | 旧题/旧练习/旧通关下线 | P2/P4 | 1 天 | 旧定义题不能通关/升主档；旧 practice 410 |
| P6 | 副本检测与序列预生成 | P1/P4 | 2 天 | 只用已验证关系；序列不点击生成 |
| P7 | 历史数据清理 + hypothesis 状态 | P1/P5 | 1–2 天 | 无证据 formal 降级/删除，报告可查 |
| P8 | 验收与指标 | 全部 | 1 天 | 下列命令全绿 + 指标基线 |

不要并行做 P4 和 P6：题目派生规则会直接改变副本关卡。

---

## P1. 关系判定：证据句优先，不做独立大模型验证

### 先修正问题定义

关系线不是“两个节点之间有没有关系”的二分类，而是：

> **原文里有没有一个句子，明确断言了 A 与 B 的某种关系？**

有句子 → 从句子抽 predicate/direction/evidence；
没有句子 → 不画关系线，最多留后台候选；
句子含糊 → 只做一次轻量归一化，不引入 770M 本地模型。

这也修正了 MiniCheck 方向：它体积/部署不适合手机，而且参考实现大多不是“先抽一对节点，再用 fact-check 模型判关系”，而是**把关系绑定到源文本单元，再做合并/去重/摘要**。

### 参考实现是怎么做的

| 项目 | 关系判定方式 | 对我们的启示 |
|---|---|---|
| [GraphRAG](https://microsoft.github.io/graphrag/index/default_dataflow/) | 按 TextUnit 抽 entities/relationships（source/target/description），相同 source/target 的关系按 description 数组合并、再 LLM 摘要；可选 claim extraction 带 status/time；所有知识项可回指 TextUnit | 关系由**原文单元**背书，不是独立 fact-check；合并/摘要比“二次判真”更重要 |
| [GraphRAG FastGraphRAG](https://microsoft.github.io/graphrag/index/default_dataflow/) | 用 NLP 做 entity/relationship extraction，省 LLM；claim extraction 跳过 | 常见关系可以先规则/NLP，LLM 只处理复杂句 |
| [LightRAG](https://github.com/HKUDS/LightRAG) | 按 chunk 抽 entity/relation，relation 保留 source_id；去重/合并；增量更新 | 关系必须带 source_id；去重和增量是核心，不是再训一个验证器 |
| [Graphiti](https://github.com/getzep/graphiti) | LLM 抽事实，再对已有边做 dedupe/resolution；事实有 validity window，矛盾时旧事实失效 | 关系是“事实生命周期”，不是布尔判定；矛盾要保留历史 |
| [KGGen](https://github.com/stair-lab/kg-gen) | 抽 entity/relation 后做 entity/edge clustering | 同义 predicate/重复边靠聚类解决，不靠逐条判真 |
| [DocRED / Re-DocRED](https://aclanthology.org/2025.emnlp-main.783/) | 关系抽取与 evidence sentence 联合标注/预测 | 证据句是关系抽取的一等输出，不是事后补的 |
| [DOCoR](https://dl.acm.org/doi/pdf/10.1145/3539597.3573038) | 文档级 OpenIE + 指代消解 | 同一句/同一指代链内的关系才可靠；跨段共现不够 |

共同点：

1. **关系从文本单元来，不从“节点对”来。**
2. **先抽关系陈述，再做合并/去重/摘要。**
3. **没有证据句的关系不是知识。**
4. **矛盾靠事实生命周期/图约束处理，不靠再跑一个大模型判真。**

### 目标流程

```text
原文
→ 句子切分（中文标点/分句）
→ 句子内识别实体对（只配对同句出现的节点）
→ 关系线索检测（规则/词表）
   - kindOf: 是/属于/一种/分为
   - partOf: 包含/组成/由…构成/一部分
   - prerequisite: 先/再/然后/之前/之后/依赖
   - contrast: 相比/不同于/区别
   - alternative: 替代/改为/不再使用
   - related: 与…相关/影响/关联
→ 无关系线索：不建关系线（最多后台候选/提示）
→ 线索明确：规则直接定 predicate；LLM 不参与
→ 线索含糊：一次 normalizeRelation（LLM，批量）定 predicate/direction
→ 图约束校验：自环、重复、kindOf/partOf/prerequisite 环、方向冲突
→ 写入 relation_claim（带 evidence_sentence/source_span_id/cue/verifier）
→ 只有 confirmed 才建 formal 线；uncertain 只能 hypothesis 虚线
```

### 数据

把原来的 `relation_verifications` 改为更准确的 `relation_claims`：

```sql
CREATE TABLE IF NOT EXISTS relation_claims(
  id TEXT PRIMARY KEY,
  world_id TEXT NOT NULL,
  src TEXT NOT NULL,
  dst TEXT NOT NULL,
  predicate TEXT NOT NULL,
  direction TEXT NOT NULL DEFAULT 'src_to_dst',
  evidence_sentence TEXT NOT NULL,
  source_span_id TEXT,
  cue TEXT NOT NULL DEFAULT '',
  verifier TEXT NOT NULL DEFAULT 'rule', -- rule | llm | human
  confidence REAL NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'confirmed', -- confirmed | hypothesis | rejected
  reason TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL
);
```

`edges` 增加：

```sql
ALTER TABLE edges ADD COLUMN claim_id TEXT;
ALTER TABLE edges ADD COLUMN evidence_sentence TEXT NOT NULL DEFAULT '';
ALTER TABLE edges ADD COLUMN verifier TEXT NOT NULL DEFAULT 'rule';
```

### Provider 契约

不要再叫 verify：它是**归一化器**，只在规则判不了时调用。

```ts
type RelationNormalizeInput = {
  sentence: string;
  a: { name: string; definition?: string };
  b: { name: string; definition?: string };
  cueCandidates: string[]; // 规则命中的候选 predicate
};

type RelationNormalizeOutput = {
  predicate: "kindOf" | "partOf" | "prerequisite" | "contrast" | "alternative" | "related";
  direction: "src_to_dst" | "dst_to_src" | "none";
  reason: string;       // 为什么是这种关系，引用句子片段
  confidence: number;
};
```

规则能判的常见句式**不调 LLM**。只有：

- 一句多义（“依赖”既可能 prerequisite 也可能 related）；
- 中文长句/多重从句；
- 新 predicate 需要人确认；

才调用，且一批句子一次调用。

### 图约束（第二层验证，零模型成本）

写入前检查：

1. `src !== dst`；
2. 同 `(src,dst,predicate)` 已有 formal → 合并 description/evidence，不重复建；
3. `kindOf/partOf/prerequisite` 不允许成环；
4. 方向必须符合 predicate 约定；
5. 已有相反方向 `prerequisite` → 不建，标 contradiction；
6. `related` 只能由明确关系句产生，不能默认填充；
7. 同一对节点已有 `kindOf`，再出现 `partOf` 要人工/LLM 归一，不并存。

违反 3/5 的：不建 formal，写 `status='hypothesis'` + reason，UI 显示“存在冲突”。

### 接入位置

1. `server/src/routes/graph.ts` 关系循环：
   - 不再遍历 `result.relations` 直接建边；
   - 改为 `extractRelationClaims(text, entities)`；
   - 规则优先，ambiguous 批量 normalize；
   - 图约束后写 `relation_claims` + edges。
2. `server/src/routes/edges.ts` accept：
   - 没有 evidence_sentence → 400；
   - 规则/normalize 后写 claim；不再调用“判真”模型。
3. `server/src/routes/candidates.ts` admit：
   - 必须能从候选 evidence 找到同句两端；否则只能建 draft 节点，不建 formal 边。

### suggest 的重新定义

`suggest` 不是“我猜这两个有关”，而是：

> 原文有一句**弱断言/hedge**（“可能相关/会影响/取决于”），但不足以定强 predicate。

所以：

- 必须有 `evidence_sentence`；
- 必须有 `cue`（可能是“可能/相关/影响”）；
- reason 直接引用句子，不允许“可能相关？”；
- 没有句子的节点对**不产生 suggest**，不进地图。

### 测试

- 同句出现两端 + 明确“是…一种” → kindOf；
- 同句出现两端但无关系线索 → 不建线；
- 跨句/跨段共现 → 不建线；
- “可能影响” → suggest + evidence，不 formal；
- 相反 prerequisite → hypothesis/矛盾，不建正式；
- kindOf 环 → 拒绝；
- 规则路径不调用 LLM（mock 计数）；
- 含糊句批量 normalize 一次调用；
- accept 无 evidence → 400。

### 验收

```sql
-- 所有 formal 必须有 evidence_sentence 且非空
SELECT COUNT(*) FROM edges WHERE kind='formal' AND (evidence='' OR evidence_sentence='');
-- 所有 formal 必须有 claim_id
SELECT COUNT(*) FROM edges WHERE kind='formal' AND claim_id IS NULL;
```

目标都是 0（新数据）。

### 成本

- 规则覆盖大部分中文明确关系句：0 次 LLM；
- 只有多义/长句归一化：批量 1 次；
- 不引入 770M 本地模型，不增加手机端体积；
- 关系线在抽取阶段就完成判定，不等到点击。

---

## P2. 卡片/题目预生成（点击只读）

### 目标

用户点开时只读缓存；没有缓存显示“老师正在准备”，不触发模型。

### 任务类型

复用 `generation_jobs`，增加 type：

```text
relation_verify
relation_doc
relation_task
node_doc
node_task
```

### 触发

- 关系 verify 完成 → 入队 `relation_doc` + `relation_task`（至少 boundary）。
- 节点创建且有 `source_span_id` → 入队 `node_doc` + `node_task`。
- 没有 source → 不创建 doc/task job，只标记 `definition_status='draft'`。

### Worker

`generationWorker.runOneGenerationJob` 增加：

- `relation_task`：调用理解任务生成（P4 的派生器），缓存到 `understanding_tasks`；
- `node_task`：同上；
- 失败重试有限次，失败后状态 `failed`，不无限生成。

### API 行为

`GET /api/nodes/:id/doc`、`GET /api/edges/:id/doc`：

- 有缓存 → 返回；
- 无缓存 → `{status:"preparing", doc:null}`（HTTP 200）；
- 不再 `ensure*` 同步生成（保留 regenerate 手动入口）。

`GET /api/nodes/:id/understanding`、`GET /api/edges/:id/understanding`：

- 有任务 → 返回；
- 无任务且没有 job → `preparing`；
- 不再 `ensure*` 生成（`POST regenerate` 可显式触发）。

### 前端

- `NodeDrawer`/`RelationDrawer`：`preparing` 显示“老师准备中”；轮询 1.5s，最多 10s；不展示“生成辨析任务”按钮作为主路径。
- `UnderstandingTaskPanel`：去掉“生成一个辨析任务”主入口；保留“换一题”为显式重新生成（可选）。

### 测试

- 打开 doc/task 的 GET 不增加 job 数量；
- worker 完成后 GET 返回 ready；
- 无 source 的节点 GET 返回 draft/preparing，不生成事实题。

---

## P3. 节点定义质量闸

### 目标

定义不是“与邻居相关的一句话”，而是可独立理解的名片。

### 规则

`server/src/services/definitionQuality.ts`：

```ts
type DefinitionReport = {
  ok: boolean;
  flags: string[]; // no_category | no_differentia | generic_related | too_short | too_long | no_source
  score: number;
};
```

检查：

1. 8–80 字；
2. 有上位类别（“是一种/属于/是……的一种”等）；
3. 有区别特征（“区别/不是/用于/负责/特点是”等）；
4. 不是纯“与 X 相关/有关”；
5. 有 source_span 或 definition 来源。

### 数据

`nodes` 增加：

```sql
ALTER TABLE nodes ADD COLUMN definition_status TEXT NOT NULL DEFAULT 'draft'; -- draft|verified
```

生成/确认后写 `verified`；失败写 `draft`。

### UI

节点卡顶部：

```text
定义（草稿/已验证）
```

草稿不进入事实题；只显示“请补充来源/定义”。

### 测试

- 同义反复“X 是一种 X” → draft；
- “与 Y 相关” → draft；
- 有类别+区别+来源 → verified；
- draft 节点不出事实题。

---

## P4. 题目从误解/边界派生

### 目标

题不是 `generateQuiz`，而是从 P1 的 `relation_claim` 字段生成。

### 数据

`understanding_tasks` 增加：

```sql
ALTER TABLE understanding_tasks ADD COLUMN derived_from_json TEXT NOT NULL DEFAULT '{}';
ALTER TABLE understanding_tasks ADD COLUMN claim_id TEXT;
```

`derived_from_json` 至少含：

```json
{
  "predicate": "prerequisite",
  "direction": "src_to_dst",
  "misconception": "把前置关系当成同类",
  "boundary": "...",
  "confusable_with": ["kindOf", "partOf"]
}
```

### 派生器

新增 `server/src/services/taskDerivation.ts`：

```ts
deriveRelationTasks(claim, sourceText): TaskDraft[]
deriveNodeTasks(node, neighbors, sourceText): TaskDraft[]
```

题型映射：

| variant | 输入 | 题干必须 |
|---|---|---|
| boundary | predicate + boundary + confusable | 问“为什么不是 confusable / 边界在哪” |
| counterexample | predicate + boundary | 给一个反例场景，问是否成立 |
| error_correction | predicate + direction | 给错误表述，问错在哪/怎么改 |
| transfer | neighbor | 换一个近邻/场景，问关系是否仍成立 |

硬规则：

- `misconception` 必须来自 `confusable_with` 或 `boundary`；
- `evidence_quote` 必须来自 source；
- 选择项 ≥2，含错误干扰项；
- 不能生成“X 是什么”。

### 质量门

沿用 `understandingQuality` + 重写；新增 `derived_from_json` 检查：

- 缺 misconception/boundary → 不生成；
- 缺 evidence → 不生成。

### 测试

- claim=rejected/hypothesis 不出事实题；
- boundary 题必须提到 confusable；
- 题干不得是定义题；
- 低质量重写逻辑仍生效。

---

## P5. 旧题/旧练习/旧通关下线

### 下线清单

| 入口 | 处理 |
|---|---|
| `GET /api/nodes/:id/quiz` | 只读；不再自动生成（✅ 已做） |
| `POST /api/nodes/:id/quiz/generate` | 保留但标记 legacy，不再驱动主档位 |
| `POST /api/quiz/:id/answer` | 只更新复习进度；不再改变主 tier（或仅 tier 不计入新解锁） |
| `POST /api/edges/:id/practice` | 410 Gone；前端已不用 |
| `POST /api/buildings/:id/challenge` domain | 410 或 `legacy_review`；不再生成 10 道定义题 |
| `POST /api/buildings/:id/submit` domain/flow | 已 practice-only；保留复习反馈 |
| `computeTier` 旧题路径 | 只用于历史数据展示；新解锁只看辨析/理解 |

### UI

- 删除“复习模式”里的旧题入口，或明确“只复习、不计入通关/解锁”；
- 移除 `startChallenge` 调用；
- 删除旧 practice UI（已无）。

### 测试

- 旧 quiz 答对不再改变主 tier（或只改复习分）；
- 旧 challenge 410/不 cleared；
- 新序列 cleared。

---

## P6. 副本检测与序列预生成

### 领域检测

字段：

```text
edges.kind = formal
edges.predicate ∈ {kindOf, partOf}
edge.claim.status = confirmed
edge.evidence 非空
nodes.hidden = 0
nodes.definition_status = verified（或至少 source 存在）
```

遍历：

1. 取 hold 的 kindOf/partOf；
2. 按上位/整体分组；
3. 成员 4–8；
4. 共同上位存在；
5. 每个成员至少一条带 evidence 关系；
6. 重叠 ≤50%；
7. 生成 domain 候选。

### 流程检测

字段：

```text
edges.kind=formal
edges.predicate=prerequisite（首选）
edge.claim.status=confirmed
edge.evidence 非空
步骤 3–6
```

遍历：

1. 弱连通分量；
2. 用 evidence 建先后约束；
3. `countLinearExtensions == 1`；
4. 每步 evidence 非空；
5. 生成 flow 候选。

### 出现时机

```text
visible nodes >= 8
AND verified formal edges >= 4
AND frontier >= 1
AND open directions >= 1
```

满足才 `detectBuildings`；状态：

```text
detected → playable（相关成员 tier>=1）→ cleared（全部辨析关卡正确）
```

### 序列预生成

- 副本 `detected` 时入队 `relation_task` × 3/4；
- `GET /sequence` 只读；
- 没有任务显示“准备中”；
- 通关只认 `dungeon_stages` 全对。

### 测试

- 不满足门槛不检测；
- 无 confirmed claim 的关系不能进副本；
- 序列 GET 不新增任务；
- 全关过 cleared；旧 submit 不 cleared。

---

## P7. 历史数据清理 + hypothesis 状态

### 清理脚本

新增 `server/scripts/repair-relations.ts`（`pnpm --filter server tsx scripts/repair-relations.ts --dry-run`）：

对每个世界：

1. formal 边：
   - evidence 为空 → 降级 `suggest` 或删除；写报告；
   - evidence 不是任何 source_span 子串 → 降级；
   - `src===dst` → 删除；
   - 同 `(src,dst,predicate)` 重复 → 保留最新，删旧；
2. 无 source_span 的节点 → `definition_status='draft'`；
3. 清空/重算 relation_docs、understanding_tasks 中依赖伪关系的记录；
4. 输出 JSON/CSV 报告：世界、边、原因。

### hypothesis 状态

`edges.claim_status` 使用：

```text
normal      = 已验证正式关系
hypothesis  = 假设（无证据/uncertain）
rejected    = 已拒绝（可保留审计）
```

UI：

- 实线 normal；
- 虚线 hypothesis；
- 不显示 rejected。

### 验收

- 清理前/后计数；
- demo 不能出现空证据 formal；
- 旧数据可追溯。

---

## P8. 验收命令与指标

```bash
pnpm typecheck
pnpm test
pnpm build
pnpm e2e:v3
pnpm voice:check
pnpm quality:sample
```

新增验收断言：

- `SELECT COUNT(*) FROM edges WHERE kind='formal' AND claim_id IS NULL` = 0（新世界）
- `GET /api/relations/:id` 返回 `claim`（关系句、predicate、status）
- 无 source 节点不出事实题
- 旧 quiz 不改变主 tier
- 副本 GET 不新增 job
- 旧 submit 不 cleared
- 清理脚本 dry-run 报告

指标：

```text
关系判定通过率
无证据线数量（目标 0）
卡片预生成命中率
题目 derivation 覆盖率
副本 detected/playable/cleared
旧路径调用次数（目标 0）
```

---

## 外部方案对照：只借机制，不引入本地大模型

> 结论：参考实现里没有“先抽一对节点，再用 770M fact-check 模型判关系”这种标准做法。它们主要做三件事：
> **把关系绑定到源文本单元 → 合并/去重/摘要 → 用事实生命周期或图约束处理矛盾。**
> 这正好支持 P1 的“证据句优先”，也避免手机端模型体积问题。

| 来源 | 具体机制 | 接到哪一步 | 是否采用 | 说明 |
|---|---|---|---|---|
| [GraphRAG 默认数据流](https://microsoft.github.io/graphrag/index/default_dataflow/) | 每个 TextUnit 抽 entity/relationship（source/target/description）；相同 source/target 合并 description，再 LLM 摘要；所有知识项可回指 TextUnit；claim extraction 可选 | P1/P2：关系绑定 TextUnit，合并/摘要 | **借机制** | 关系由原文单元背书，不靠独立判真模型 |
| [GraphRAG FastGraphRAG](https://microsoft.github.io/graphrag/index/default_dataflow/) | 用 NLP 做 entity/relationship extraction，省 LLM；claim extraction 跳过 | P1：规则/NLP 先覆盖常见句式 | **借机制** | 常见关系不需要 LLM；复杂句才归一化 |
| [LightRAG](https://github.com/HKUDS/LightRAG) | 按 chunk 抽 entity/relation，relation 保留 source_id；去重/合并；增量更新；角色分离 + 缓存 | P2/P6：source_id 贯穿、任务缓存、增量 | **借机制** | 不引入图数据库，借字段和缓存策略 |
| [Graphiti](https://github.com/getzep/graphiti) | 事实带 validity window；矛盾时旧事实失效而非删除；所有事实回溯 episode；边 dedupe/resolution | P1/P7：claim status + 失效历史 + 冲突处理 | **借机制** | 关系是事实生命周期，不是布尔真假 |
| [KGGen](https://github.com/stair-lab/kg-gen) | 抽 entity/relation 后做 entity/edge clustering、aggregate | P1/P7：predicate 归一、重复边合并 | **借机制** | 同义关系靠聚类，不靠逐条判真 |
| [DocRED / Re-DocRED](https://aclanthology.org/2025.emnlp-main.783/) | 关系抽取与 evidence sentence 联合标注/预测 | P1：evidence sentence 是输出字段 | **借机制** | 证据句不是事后补的 |
| [MiniCheck](https://github.com/liyan06/minicheck)（EMNLP 2024） | 句子级 fact-check，770M Flan-T5 本地跑 | 不作默认方案 | **不采用** | 体积/部署不适合手机；且 P1 用“证据句存在”已经能挡掉大部分假关系 |
| [Microsoft GraphRAG 社区摘要](https://github.com/microsoft/graphrag) | 社区检测 + 社区报告 | 不作为主链路 | **不采用整套** | 成本高，和“知识地图 + 辨析”目标不一致 |
| [Concept Map MCQ](https://arxiv.org/abs/2505.02850) / [KG-guided distractors](https://github.com/ryyrn/Knowledge_Graph_Guided_Distractor_Generation) | 概念图距离/邻居关系生成干扰项 | P4：干扰项来自易混邻居 | **建议试验** | 和 boundary/confusable 同构 |
| [RAGAS](https://github.com/explodinggradients/ragas) | faithfulness / context precision / answer relevance | P8：关系卡/解释评测 | **借指标** | 不进入运行时 |
| [Self-RAG](https://arxiv.org/abs/2310.11511) / [Chain-of-Verification](https://arxiv.org/abs/2309.11495) | 先引用→再结论→再反例 | P1：normalize prompt 结构 | **借结构** | 不增加逐条多轮调用 |

### 真正要抄的 4 个机制

1. **Source-unit provenance**：每条关系必须能回指一个 TextUnit/句子；没有句子就没有关系。
   - GraphRAG 的 TextUnit、LightRAG 的 source_id、Graphiti 的 episode 都是同一件事。
2. **合并/去重/聚类**：相同 `(src,dst,predicate)` 合并 description；同义 predicate 聚类。
   - 这比“再判一次真假”更能减少噪音。
3. **事实生命周期**：confirmed / hypothesis / invalidated；矛盾时失效旧关系，保留历史。
4. **NLP/规则优先**：常见中文关系句式用规则，LLM 只处理多义/长句；不引入本地大模型。

### 3 个低成本实验

**实验 A：规则句式覆盖率**

- 从现有世界抽 100 个包含两个节点名的句子；
- 人工标 predicate（或无关系）；
- 对比规则命中率/准确率。
- 通过标准：明确句式准确率 ≥90%，覆盖 ≥60% 关系句。

**实验 B：批量 normalize**

- 一次 prompt 归一化 10–20 个含糊句，对比逐条调用；
- 指标：predicate 一致性、JSON 合法率、token 成本。
- 通过标准：一致性 ≥90%，成本下降 ≥50%。

**实验 C：图约束反例**

- 构造自环、kindOf 环、相反 prerequisite、重复边；
- 验证全部被拒绝/标 hypothesis。
- 通过标准：0 条污染 formal。

### 不要做的事

- 不要本地部署 MiniCheck/770M 模型，尤其不要放进手机端；服务端规则 + 一次归一化足够。
- 不要为每条关系调用多次 LLM。
- 不要把 GraphRAG 社区摘要整套搬进来。
- 不要引入 Neo4j/图数据库；当前 SQLite 规模足够。
- 不要先做知识追踪/FSRS；题目质量稳定前没意义。

---

## 附：文件改动清单

| 文件 | 改动 |
|---|---|
| `server/src/db/schema.ts` | relation_claims、edges/nodes/understanding_tasks 新列 |
| `server/src/db/edges.ts` | claim 字段读写、hypothesis 状态 |
| `server/src/db/nodes.ts` | definition_status |
| `server/src/db/relationClaims.ts`（新） | claim CRUD / 图约束 |
| `server/src/providers/types.ts` | normalizeRelation 契约 |
| `server/src/providers/deepseek.ts` | 批量 normalize prompt |
| `server/src/providers/mock.ts` | 确定性 normalize（测试） |
| `server/src/services/relationClaims.ts`（新） | 句子切分、线索检测、归一化、图约束、落库 |
| `server/src/services/taskDerivation.ts`（新） | 从 claim 派生题 |
| `server/src/services/definitionQuality.ts`（新） | 定义质量闸 |
| `server/src/services/contentDocs.ts` | 去掉同步生成，改读缓存/准备中 |
| `server/src/services/understanding.ts` | 去掉 sync ensure，改读缓存 |
| `server/src/services/generationWorker.ts` | 新 job 类型 |
| `server/src/routes/graph.ts` | 关系候选 → verify → 建线 |
| `server/src/routes/edges.ts` | accept/manual verify |
| `server/src/routes/candidates.ts` | admit verify |
| `server/src/routes/nodes.ts` | 旧题只读/legacy |
| `server/src/routes/buildings.ts` | 旧 challenge 下线 |
| `server/src/services/buildings.ts` | readiness + verified detection |
| `server/src/dungeons.ts` | verified 字段遍历 |
| `web/src/components/RelationDrawer.tsx` | 显示 claim（关系句/类型/边界）；preparing 状态 |
| `web/src/components/NodeDrawer.tsx` | 定义状态；preparing |
| `web/src/components/UnderstandingTaskPanel.tsx` | 去掉生成按钮/轮询 |
| `web/src/components/DungeonDrawer.tsx` | 旧 challenge 入口移除 |

## 附：不要做什么

- 不要再加“生成题/生成关系”的按钮来掩盖未预生成；
- 不要用 `label` 或模型说明补 `evidence`；
- 不要用 `related` 作为默认 predicate；
- 不要让旧定义题成为通关/升档主路径；
- 不要在第一次输入就创建副本。

---

**建议执行顺序：P1 → P2 → P3 → P4 → P5 → P6 → P7 → P8。**  
P1 完成前，不要再改关系卡/题目 UI；否则只是换一种方式展示猜测。
