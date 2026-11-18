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
| P1 | 关系判定器 `relation_verifier` | 无 | 2–3 天 | 没有 verify 结果就不建 formal/suggest 线 |
| P2 | 卡片/题目预生成 | P1 | 2 天 | 点击只读；未生成显示“准备中” |
| P3 | 节点定义质量闸 | P1 | 1–2 天 | 空泛定义进草稿，不出事实题 |
| P4 | 题目从误解/边界派生 | P1/P3 | 2–3 天 | 题带 `derived_from`，不是通用 quiz |
| P5 | 旧题/旧练习/旧通关下线 | P2/P4 | 1 天 | 旧定义题不能通关/升主档；旧 practice 410 |
| P6 | 副本检测与序列预生成 | P1/P4 | 2 天 | 只用已验证关系；序列不点击生成 |
| P7 | 历史数据清理 + hypothesis 状态 | P1/P5 | 1–2 天 | 无证据 formal 降级/删除，报告可查 |
| P8 | 验收与指标 | 全部 | 1 天 | 下列命令全绿 + 指标基线 |

不要并行做 P4 和 P6：题目派生规则会直接改变副本关卡。

---

## P1. 关系判定器（P0，最关键）

### 目标

抽取阶段只产生**候选关系**；候选必须经过独立判定，才能变成地图上的线。

### 新增数据

新表（保留判定历史）：

```sql
CREATE TABLE IF NOT EXISTS relation_verifications(
  id TEXT PRIMARY KEY,
  world_id TEXT NOT NULL,
  src TEXT NOT NULL,
  dst TEXT NOT NULL,
  predicate TEXT,
  verdict TEXT NOT NULL,           -- hold | uncertain | reject
  direction TEXT NOT NULL DEFAULT 'src_to_dst',
  reason TEXT NOT NULL DEFAULT '',
  evidence_quote TEXT NOT NULL DEFAULT '',
  boundary TEXT NOT NULL DEFAULT '',
  confusable_json TEXT NOT NULL DEFAULT '[]',
  confidence REAL NOT NULL DEFAULT 0,
  model TEXT NOT NULL DEFAULT '',
  source_span_id TEXT,
  created_at INTEGER NOT NULL
);
```

给 `edges` 增加当前判定引用（不必存整段 JSON）：

```sql
ALTER TABLE edges ADD COLUMN verification_id TEXT;
ALTER TABLE edges ADD COLUMN verify_reason TEXT NOT NULL DEFAULT '';
ALTER TABLE edges ADD COLUMN boundary TEXT NOT NULL DEFAULT '';
ALTER TABLE edges ADD COLUMN confusable_json TEXT NOT NULL DEFAULT '[]';
```

兼容：老库用 `columnNames` 检查后 `ALTER`，见 `server/src/db/schema.ts` 现有迁移段。

### Provider 契约

`server/src/providers/types.ts`：

```ts
export type RelationVerdict = "hold" | "uncertain" | "reject";

export type RelationVerification = {
  verdict: RelationVerdict;
  predicate: "kindOf" | "partOf" | "prerequisite" | "contrast" | "alternative" | "related";
  direction: "src_to_dst" | "dst_to_src" | "none";
  reason: string;          // 必须解释为什么成立/不确定，不能是“可能相关”
  evidence_quote: string;  // 必须是 sourceText 的连续子串
  boundary: string;        // 什么情况下不成立
  confusable_with: string[]; // 最容易混的 predicate/概念
  confidence: number;
};

export type RelationVerifyInput = {
  sourceText: string;
  a: { name: string; definition?: string };
  b: { name: string; definition?: string };
  candidatePredicate?: string | null;
  candidateLabel?: string | null;
};

export type RelationVerifyOutput = RelationVerification & { ok: boolean; error?: string };
```

新增方法：

```ts
verifyRelation(input: RelationVerifyInput): Promise<RelationVerification>;
```

批量版（推荐，减少调用）：

```ts
verifyRelations(inputs: RelationVerifyInput[]): Promise<RelationVerification[]>;
```

DeepSeek prompt 要求：

```text
只输出 JSON：
{ verdict, predicate, direction, reason, evidence_quote, boundary, confusable_with, confidence }
规则：
- 先判断两概念是否有关系；没有就 verdict=reject；
- 证据必须来自 sourceText，且同时出现两端（或明确指代）；
- 不能把“可能相关”作为 reason；
- related 只能用于原文明确说有关但无法判断更强类型；
- uncertain 必须给出具体不确定点。
```

### 服务

新增 `server/src/services/relationVerifier.ts`：

```ts
export async function verifyAndRecord(input: RelationVerifyInput, llm: LLMProvider)
export function getVerificationForEdge(edgeId: string)
```

校验：

- `evidence_quote` 为空 或 不在 `sourceText` → 直接 reject；
- `verdict=reject` → 不建线；
- `verdict=uncertain` → 只能 `kind='suggest'`，写 reason；
- `verdict=hold` → `kind='formal'`；
- predicate 不在枚举 → 拒绝；
- 方向归一化（kindOf 具体→上位；partOf 部分→整体；prerequisite 前置→后续）。

### 接入位置

1. `server/src/routes/graph.ts` 关系循环（当前约 404 行）：
   - 不再直接 `addEdge`；
   - 收集候选 → `verifyRelations` → 只有 hold/uncertain 建线；
   - 写 `relation_verifications` 和 edge 字段。
2. `server/src/routes/edges.ts` `POST /api/edges/:id/accept`：
   - 对 suggest 再次 verify；
   - reject 409；uncertain 保持 suggest；hold 才 formal。
3. `server/src/routes/candidates.ts` `admit`：
   - 对 target↔candidate 做 verify；hold/suggest 才能建边。

### 前端

- 关系卡不显示“待生成”；
- 显示 `verdict/type/direction/reason/evidence/boundary`；
- `uncertain` 明确写“假设”，不用正式关系语气。

### 测试

- `relationVerifier.test.ts`：
  - 无证据 → reject；
  - 证据不含两端 → reject；
  - uncertain 只能 suggest；
  - hold 才 formal；
  - 方向归一。
- `integration.test.ts`：
  - 抽取后的所有 formal 都有 verification_id；
  - 无 evidence 不建语义线；
  - accept 无证据 400。
- `demo.test.ts`：demo formal 全部有 verification（seed 可写固定 verification 或直接按已确认处理）。

### 验收

```bash
pnpm test
# 新增断言：SELECT COUNT(*) FROM edges WHERE kind='formal' AND evidence='' = 0
# 新增断言：formal 都有 verification_id
```

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

题不是 `generateQuiz`，而是从 P1 的 `verification` 字段生成。

### 数据

`understanding_tasks` 增加：

```sql
ALTER TABLE understanding_tasks ADD COLUMN derived_from_json TEXT NOT NULL DEFAULT '{}';
ALTER TABLE understanding_tasks ADD COLUMN verification_id TEXT;
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
deriveRelationTasks(verification, sourceText): TaskDraft[]
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

- verifier reject/uncertain 不出事实题；
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
edge.verification.verdict = hold
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
edge.verification.verdict=hold
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
- 无 verification 的关系不能进副本；
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

- `SELECT COUNT(*) FROM edges WHERE kind='formal' AND verification_id IS NULL` = 0（新世界）
- `GET /api/relations/:id` 返回 verification
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

## 附：文件改动清单

| 文件 | 改动 |
|---|---|
| `server/src/db/schema.ts` | relation_verifications、edges/nodes/understanding_tasks 新列 |
| `server/src/db/edges.ts` | 增加 verification 字段读写、hypothesis 状态 |
| `server/src/db/nodes.ts` | definition_status |
| `server/src/db/relations.ts`（新） | verification CRUD |
| `server/src/providers/types.ts` | verifyRelation(s) 契约 |
| `server/src/providers/deepseek.ts` | 批量 verify prompt |
| `server/src/providers/mock.ts` | 确定性 verify（测试） |
| `server/src/services/relationVerifier.ts`（新） | 校验/落库/归一化 |
| `server/src/services/taskDerivation.ts`（新） | 从 verification 派生题 |
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
| `web/src/components/RelationDrawer.tsx` | 显示 verification；preparing 状态 |
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
