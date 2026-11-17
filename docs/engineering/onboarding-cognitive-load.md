# 10 · 新工程师认知成本评估与简化方案

> 2026-11-17 P2 进度：canonical `line_type/line_state` 已派生到 API；`RelationDrawer` 改用 canonical；extract/seed 方向写入收敛到 `addDirection` + materialize；`World3D` 721→185 行（scene 271/edges 278）；`InputBar` 581→104 行，音频/WS 状态机拆到 `useVoiceInput` 489 行。P1 的 shared/routes/db repo/tests/CI 已完成，见 architecture。

> 评估对象：一个能力很强、但**完全不了解本项目**的工程师，假设明天接手。
> 目的：不是吐槽，而是给出“从入职到能安全改核心链路”的成本、风险点和最短简化路径。
> 代码/文档现状基于 2026-11-17 的 main。

## 0. 结论

- **项目不算大，但上下文密度很高**：约 7.2k 行代码（server 4.8k + web 2.4k）、32 个后端路由、13 张表、10 份主文档（约 140KB）；真正的难点不是 LOC，而是**术语、状态、职责和历史设计分散**。
- **“能跑起来”很快，“能安全改核心链路”很慢**：
  - 本地跑起来：**0.5–1 天**；
  - 看懂主链路并做第一个小改动：**2–4 天**；
  - 独立改节点/关系/方向/副本这类核心逻辑：**2–4 周**；
  - 能独立设计新功能并判断产品影响：**4–6 周**。
- **最大的认知成本来源**（按影响排序）：
  1. 产品术语与代码 `kind` 不是一一对应（关系/探索/提示/顺序 vs formal/suggest/direction/source）；
  2. `kind` 同时承担“类型 + 生命周期阶段”，方向又有“表 + 自环边”两套状态；
  3. `index.ts` 和 `db.ts` 职责过重，业务规则散在路由、持久层、stream、assetops；
  4. 文档有 10 份、多个版本口径、历史设计只存在 Git 里；
  5. 没有仓库内测试/CI，验收脚本在工作区外；
  6. 死代码/实验代码（anchorFirst、dev 路由、ghost、布局引擎、hide/export）没有明确边界；
  7. 前后端类型手工复制，`any` 多，契约靠记忆。

## 1. 量化现状

| 指标 | 数值 | 说明 |
|---|---|---|
| 代码量 | ~7,196 行 | server 4,816 + web 2,380 |
| 后端路由 | 32 | 其中 `/api/dev/*` 5 个、实验/无 UI 的若干 |
| 数据表 | 13 | worlds/nodes/edges/buildings/directions/quizzes/attempts/source_spans/focus_stack/domain_questions/hide_batches/daily_domain/meta |
| 最大文件 | index.ts 1,626 / db.ts 787 / World3D.tsx 721 / InputBar.tsx 581 / store.ts 412 | 都超过“一屏能读完”的范围 |
| 文档 | 10 份，约 140KB | 03/04/05/06/07/08/09 口径不同；09 是营销 Brief |
| 测试 | 仓库内无单测；`server/eval` 有评测脚本；`_verify` 在工作区外 | 没有 CI；typecheck/build 是唯一自动门 |
| 类型共享 | 无 shared package | web `api.ts` 与 server `db.ts` 手工重复 DTO |

## 2. 命名混乱（最影响理解速度）

| 代码/文档现在的名字 | 实际含义 | 问题 | 建议 |
|---|---|---|---|
| `formal` | 关系线（已确认语义关系） | 名字是“正式”，不是产品术语 | 对外/内部统一叫 `relation`；先加映射，后改代码 |
| `source` | 顺序线/来源线（节点生成来路） | 和 `source_span`（原文来源）撞名；产品现在叫顺序线 | 代码改 `sequence` 或 `provenance`；`source_span` 保留 |
| `suggest` | 关联提示线（候选关系） | “建议”是动作，不是线型 | 改 `hint` 或 `candidate_relation` |
| `direction` | 探索线（下一步方向） | 与“方向/边方向”混淆；实现是自环边 | 改 `exploration`；说明它是 UI 方向，不是关系方向 |
| `building` / `dungeons.ts` / `副本` | 同一个东西三种叫法 | 表叫 buildings，文件叫 dungeons，文档叫副本 | 统一 `dungeon`（DB 迁移可后做） |
| `edge` / `line` / `relation` | 图边/线/关系混用 | 读代码时分不清是数据还是视觉 | 数据层叫 `edge`，视觉层叫 `line`，语义层叫 `relation` |
| `frontier` | “没有 formal 出边的节点” | 产品叫外围节点；不是地图边缘 | 文档写清“frontier = 无 formal 出边”；变量可改 `is_frontier` |
| `commit` / `accept` / `consume` | 三种状态动词 | 分别发生在线、建议、方向，容易混 | 画状态机；动词和对象绑定 |
| `target_hint` / `target_name/type/...` | 方向预计划节点 | 旧字段和新字段并存 | 删旧字段或明确 legacy |
| `claim_status` / `revision` | 争议/版本 | 有字段但几乎没有真实行为 | 标记“未实现/预留”，或删除 |
| `ghost` / `spawnGhosts` | 流式候选 UI | 现在前端只有清空调用，渲染还在 | 标实验/删除，避免误以为主链路 |
| `anchorFirst` / `pairFastLLM` / `slowJudge` | 锚点优先实验 | 名字像核心链路，实际只有 dev 路由 | 移到 `experiments/` 或删除 |

**最小动作**：先加 `docs/engineering/glossary.md`，把“产品词 ↔ 代码词 ↔ 状态”固定下来；不要一上来全库改名。

## 3. 抽象过度 / 状态模型不清

1. **`kind` 同时是“类型”和“阶段”**
   - `suggest` 是关系的一个候选阶段，`formal` 是同一关系的确认阶段；
   - 方向是自环边 + `directions` 表 + `consumed` 三套状态；
   - 新需求又要引入“四类线”，但四类线是**用户看到的视觉类型**，不是四个数据库 kind。
   - 新工程师会问：一条线从建议变正式，是改 kind 还是新建边？历史怎么留？副本读哪条？
   - 建议：明确一层 canonical model：`edge/type/state/origin`，UI 线型从状态派生；在迁移前先写状态表。

2. **方向有两套存储**
   - `directions(node_id, question, status, target_*)` 和 `edges(kind='direction', src=dst, question, consumed)`；
   - `materializeDirectionEdges` 会在 frontier 变化时删/建边；
   - 读代码时必须同时理解两张表谁是 source of truth。
   - 建议：明确“directions 是计划，edge 是地图投影”，或直接只留一套；文档画数据流。

3. **`addEdge` 是万能函数**
   - 参数：src/dst/kind/label/question/md/meta(predicate/evidence/confidence/origin/target_*)，调用方决定语义；
   - 关系、来源、方向、建议都走它，容易传错参（历史上有把 predicate 传成 question 的 bug）。
   - 建议：拆 `addRelation`、`addProvenance`、`addExploration`，或用 discriminated union options。

4. **方向自环边**
   - `src=dst` 只是一种存法，但会让“边”遍历、frontier、副本逻辑都要特判。
   - 建议：文档明确“direction 不参与 relation 算法”，代码层尽量隔离。

## 4. 职责不清晰（新工程师最容易被大文件吞掉）

| 文件 | 现在承担 | 问题 | 拆分建议 |
|---|---|---|---|
| `server/src/index.ts` (1,626) | 32 路由 + 节点/关系创建 + 方向生成/物化 + 副本检测 + 出题 + 布局 + dev 路由 | 路由和领域逻辑混在一起；改一个功能要读整个文件 | `routes/*` + `services/*`（extract/explore/directions/dungeons/relations） |
| `server/src/db.ts` (787) | schema + 迁移 + CRUD + 业务规则（commitStreamEdges/computeFrontier）+ demo seed | 持久层混业务；新人无法判断“改 SQL 还是改规则” | `db/schema.ts`、`db/repo/*`、`services/*`；迁移独立 |
| `server/src/assetops.ts` (301) | 建筑位置 + 方向 frontier + 隐藏 + 导出 | 名字无意义，职责四合一 | `buildings/placement`、`directions/frontier`、`hide`、`export` |
| `server/src/stream/session.ts` (268) | LLM 抽取 + parent 启发 + 写节点/边 + focus 栈 | 领域规则、LLM、DB 写混合；没有事务 | `stream/ingest` + `graph/writer`；事务封装 |
| `web/src/components/World3D.tsx` (721) | 场景、节点、边、路牌、建筑、相机、点击、动画 | UI/3D/数据/交互全在一个组件 | `scene/`（islands/edges/signs/buildings/camera） |
| `web/src/components/InputBar.tsx` (581) | AudioWorklet、WS、ASR 状态机、UI、重连 | 音频与 UI 混在一起 | `audio/` hook + `InputBar` UI |
| `web/src/store.ts` (412) | API 调用 + UI 状态 + toast + stream 状态 | 一个 store 承担所有；类型 `any` | API client + slices（world/graph/stream/drawer） |

**判断标准**：新人能否在 5 分钟内回答“这个功能应该改哪个文件？”现在多数不能。

## 5. 需要大量上下文的点

1. **隐藏副作用**：
   - `commitStream` 会把所有 `origin=stream` 且有 evidence 的 suggest 自动转 formal；
   - `materializeDirectionEdges` 会删非 frontier 的方向边；
   - `explore` 会消费方向并给新节点生成方向；
   - 这些在路由里不是一眼可见。
2. **历史设计只存在 Git**：
   - `380c69a` 清理了 product-baseline/requirements/algorithms；当前 01/02 是摘要；
   - 读代码时看不到“为什么有四种线/为什么节点准入这么设计”。
3. **文档多版本**：
   - 03 实现、04 过程、05 早期草稿、06 需求、07 实现笔记、08 验证、09 营销；
   - 新人很容易把 04/05 当当前口径。
4. **没有 API/状态图**：
   - 32 个路由只在 index.ts 里；13 张表只在 db.ts 里；没有 route/table/state 一张图。
5. **测试不可复现**：
   - 仓库内无单测/集成测试；验收脚本在 `_verify`（工作区外）；`server/eval` 不是 CI。
   - 新人改核心逻辑后没有安全网，只能手点。
6. **中文术语/注释**：
   - 如果新人不熟中文，术语理解成本更高；至少要有英文 glossary 和英文架构摘要。

## 6. 明天入职，第一周会卡在哪

| 时间 | 预期卡点 |
|---|---|
| 第 1 天 | 能 install/dev/打开示例世界；但不知道 32 个路由哪些是主链路、哪些是 dev/死代码 |
| 第 2 天 | 能改 UI 文案；但改“一条线”会卡在 kind/状态/表/渲染四层 |
| 第 3 天 | 能看懂 `/extract` 一半；会被 direction 自环、frontier、materialize、quiz/dungeon 副作用打断 |
| 第 1 周 | 能提交外围 PR；不敢改 commit/关系/方向核心逻辑；无法独立验证 |

## 7. 简化方案（按 ROI 排序）

### P0：1–2 天，不改行为，只降认知成本

1. **加 `docs/engineering/glossary.md`**：产品词 ↔ 代码词 ↔ 状态 ↔ 数据表；四类线、边 kind、building/dungeon、source/sequence、suggest/hint、direction/exploration。
2. **加 `docs/engineering/architecture.md`**：一张主链路图（语音/文字/探索/副本）、32 路由分组、13 张表归属、谁写谁读。
3. **加 `docs/engineering/states.md`**：节点 provisional/committed；边 suggest/formal/consumed；方向 open/consumed；副本 detected/locked/playable/cleared/stale；明确迁移规则。
4. **文档分区**：`docs/product/`（06、旧 baseline）、`docs/engineering/`（03、07、10）、`docs/history/`（04、05）、`docs/marketing/`（09）、`docs/baseline/`（旧设计原文）。00-index 只做入口。
5. **标实验/死代码**：`docs/engineering/experimental.md` 列 anchorFirst、dev 路由、stream/preview、ghost、WFC/ELK、hide/export 的现状；不删先标。

### P1：1–2 周，结构简化（可并行）

1. **shared types**：新建 `packages/shared`，放 Node/Edge/Direction/Building/World DTO、enum、API 请求/响应；server/web 共用；删 `web/src/api.ts` 里重复定义，减少 `any`。
2. **拆 index.ts**：`routes/` 按域拆；`services/` 放 extract/explore/directions/dungeons/relations；路由只做参数校验和调用。
3. **拆 db.ts**：schema/migrations/repo 分离；`commitStreamEdges`、`computeFrontier`、`seedDemo` 移到 services；事务封装。
4. **清理死代码/实验**：`anchorFirst.ts`、`explore.ts`（dev）、`stream/preview`、`ghost`、`dev` 路由移到 `experiments/` 或删除；`layout`/`hide`/`export` 如果 UI 不用，标注为 internal。
5. **仓库内测试**：placement/frontier/materialize/dedupe/dungeon validation 单测；extract/commit/explore 的 mock 集成测试；把 `_verify` 的关键脚本移进 `tests/e2e`；CI 跑 typecheck/test/build。
6. **统一 API 错误/警告**：extract/stream 的 warning、toast、空结果语义统一；避免“没有新实体”掩盖模型失败。

### P2：2–4 周，命名/状态重构（需迁移与测试）

1. **canonical 状态模型**：确定 `edge.type`（relation/provenance/exploration/hint）与 `edge.state`（proposed/confirmed/consumed）是否分离；决定 direction 表/自环边单一来源；写迁移方案。
2. **代码重命名**（分阶段）：`formal→relation`、`suggest→hint`、`direction→exploration`、`source→sequence/provenance`、`building→dungeon`；先加别名/DTO 层，最后再动 DB。
3. **前端拆分**：World3D scene 组件化；InputBar audio hook；store slices。
4. **恢复设计基线**：把旧 product-baseline/requirements/algorithms 放入 `docs/baseline/`，与 06 建立“原设计 → 当前口径”的对照。

## 8. 简化后的目标（验收）

新工程师入职后应该能：

- **1 小时内**：clone、install、dev、打开示例世界；
- **半天内**：说出主链路（语音/文字/探索/副本）和 13 张表的用途；
- **1 天内**：定位“改一个关系/方向/副本”应该改哪些文件；
- **2–3 天内**：完成一个带测试的小 PR；
- **1 周内**：独立改一个非核心功能；
- **2–4 周**：安全改核心节点/关系/方向/副本逻辑。

## 9. 不建议做什么

- 不要一上来全库改名/改 DB kind：会制造迁移和回归风险；
- 不要先做四类线/动画/池：只会增加状态和组件复杂度；
- 不要在没有仓库内测试前动 commit/frontier/materialize/explore；
- 不要把历史文档全删：至少保留 `docs/baseline/` 作为“原设计为什么”；
- 不要用“再写一份新设计”替代整理旧设计：先做对照，再决定改。

---

**关联**：[00-index.md](../00-index.md)、[implemented.md](./implemented.md)、[four-line-system.md](../product/four-line-system.md)、[line-implementation-notes.md](./line-implementation-notes.md)、[relation-gate-qa.md](./relation-gate-qa.md)。
