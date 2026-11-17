# 架构图（进程、主链路、路由、表归属）

> 目的：新人 30 分钟内知道“请求从哪来、数据写哪、改功能去哪个文件”。
> 这是**当前实现**，不是目标架构；P1 正在拆 `index.ts`/`db.ts`，拆完后更新本文。

## 1. 进程与仓库

```text
pnpm monorepo
├─ packages/shared/  前后端共享 DTO/enum/API 契约（@blouck/shared）
├─ server/  Node 24 + Express + ws + node:sqlite(WAL) + tsx
│    default port 8787
│    data/mvp.db（SQLite，WAL）
│    providers: DeepSeek / 豆包 ASR / mock
└─ web/     React 18 + TS + Vite + three.js + @react-three/fiber + zustand
     dev port 5173，vite 代理 /api、/ws → 8787
```

- 开发：`pnpm dev` 同时起 server + web；
- 测试：`pnpm test`（单测 + mock 集成）；CI：`.github/workflows/ci.yml`；
- 生产：当前**没有**静态托管/统一域名；前端 build 后需要单独托管，API 另起；
- 没有鉴权；API key 只在 server `.env`。

## 2. 主链路

### 2.1 语音输入（唯一流式主链路）

```text
浏览器麦克风
→ AudioWorklet 原生采样率 + 16k 重采样
→ /ws/asr（豆包 ASR partial/segment/final；mock 可替代）
→ POST /api/worlds/:id/stream/segment
   → stream/ingestSegment()
      → llm.extract(text)
      → 先建 provisional nodes（evidence 校验、confidence≥0.6）
      → 每个新节点写 source 边（parent→new）
      → relations 写 suggest（幂等）
      → 更新 focus_stack
→ POST /api/worlds/:id/stream/commit
   → nodes provisional→committed
   → commitStreamEdges：origin=stream 且有 evidence 的 suggest→formal
   → computeFrontier
```

**不生成**：方向、题目、副本。语音链路只做“抽取 + 节点/关系 + commit”。

### 2.2 文字输入（重流程）

```text
POST /api/worlds/:id/extract
→ llm.extract(text)
→ 建节点（evidence 必须在原文、confidence≥0.6）
→ 关系：
   evidence 且 confidence≥0.75 → formal
   否则 → suggest
→ 给新节点补 source 来路
→ 对没有方向的节点 suggestDirections（1 条/节点，含计划目标节点）
→ 前 3 个新节点异步 generateQuiz
→ detectDungeons（只读 formal）
→ materializeDirectionEdges
```

### 2.3 探索方向落图

```text
POST /api/worlds/:id/explore { edgeId | directionId }
→ 读方向计划（没有则懒规划）
→ 在 frontier 点沿 source→frontier 方向 placeAround
→ 建计划节点 + source + formal
→ consume 方向（edges.consumed=1；directions.status=consumed）
→ 给新节点生成方向
→ computeFrontier + materializeDirectionEdges
```

### 2.4 手动关系

```text
POST /api/worlds/:id/relations
→ 校验两个节点
→ 缺 predicate/label 时 llm.suggestRelation
→ 建 formal，origin=manual
→ computeFrontier + materializeDirectionEdges
```

### 2.5 副本

```text
/extract → detectDungeons → createBuilding（detected/…）
GET /api/buildings/:id → DungeonDrawer（文件已按产品名重命名；API/表仍 building）
POST /api/buildings/:id/challenge → 出题/连线
POST /api/buildings/:id/submit → 判题/通关/cleared
refreshBuildingStatus / refreshStaleBuildings 由世界读取/隐藏/答题触发
```

## 3. 路由分组（32 个注册）

| 组 | 方法/路径 | 数量 | 主用途 |
|---|---|---|---|
| health | GET `/api/health` | 1 | 健康检查/当前 provider |
| worlds | GET/POST `/api/worlds`；GET/DELETE `/api/worlds/:id` | 4 | 世界列表/创建/读取/删除 |
| graph | POST `/api/worlds/:id/extract`；POST `/api/worlds/:id/explore` | 2 | 文字抽取、方向落图 |
| nodes | PATCH `/api/nodes/:id` | 1 | 节点编辑（定义/自由区等） |
| docs | GET/POST `.../doc`、`.../doc/regenerate`、PATCH `.../doc/notes`（node/edge） | 6 | V3 节点卡/关系卡懒生成、备注、重生成 |
| candidates | GET `/api/worlds/:id/candidates`；POST `/api/candidates/:id/admit`、`/reject` | 3 | 软准入候选列表/确认（建节点+formal 关系）/忽略 |
| practice | GET `/api/edges/:id/practice`；POST `/api/practice/:id/answer` | 2 | 旧关系短练习；UI 已由辨析任务替代 |
| understanding | GET `/api/nodes/:id/understanding`、`/api/edges/:id/understanding`；POST `/api/understanding/:id/answer` | 3 | 节点/关系辨析任务（类型/边界+理由+原文） |
| dungeon-seq | GET `/api/buildings/:id/sequence`；POST `/api/buildings/:id/sequence/complete` | 2 | 边界→反例→迁移误解纠正序列 |
| events | POST `/api/events`；GET `/api/worlds/:id/events/summary` | 2 | 本地指标上报/汇总 |
| quizzes | GET `/api/nodes/:id/quiz`；POST `/api/nodes/:id/quiz/generate`；POST `/api/quiz/:id/answer` | 3 | 节点题/生成/判题 |
| edges | POST `/api/edges/:id/accept`；PATCH `/api/edges/:id`；POST `/api/edges/:id/consume` | 3 | 接受建议/编辑 MD/消费方向 |
| relations | POST `/api/worlds/:id/relations` | 1 | 手动关系 |
| layout | POST `/api/worlds/:id/layout` | 1 | WFC/ELK 布局；UI 当前无入口 |
| hide/export | POST `/api/worlds/:id/hide/preview`、`/hide`、`/hide/undo`；GET `/api/worlds/:id/export` | 4 | 隐藏/撤回/导出；UI 当前无入口 |
| stream | POST `/api/worlds/:id/stream/segment`、`/commit`、`/detect`、`/preview` | 4 | segment/commit 主链路；detect/preview 当前前端未用 |
| buildings | GET `/api/buildings/:id`；POST `/challenge`、`/submit`；PATCH `/api/buildings/:id` | 4 | 副本读取/挑战/提交/编辑 MD |
| dev | POST `/api/dev/world`、`/api/dev/explore`、`/api/dev/anchor-first`、`/api/dev/dungeon-fixture` | 4 | 开发/实验；不是产品链路 |

**注意**：`/api/dev/explore` 的重复注册已在 P1 删除，dev 路由已隔离到 `routes/dev.ts`。

## 4. 数据表归属（13 张核心 + 9 张 V3 卡片/练习/指标）

| 表 | 归属 | 关键字段 | 谁写 | 谁读 |
|---|---|---|---|---|
| `worlds` | 世界 | name/root_node_id/is_demo | 创建/删除世界 | 列表/世界页 |
| `nodes` | 节点 | name/type/definition/aliases/source_span_id/status/frontier/hidden/tier/x/y/free_md | extract/segment/explore/hide/quiz | 世界读取/渲染/副本 |
| `edges` | 线 | kind/label/question/predicate/evidence/confidence/origin/consumed/claim_status/revision/md/frontier_x/y/target_*/hint_score/hint_display | extract/segment/explore/manual/accept/materialize/hints | 渲染/副本/导出 |
| `directions` | 方向计划 | node_id/question/reason/status/target_*/consumed_span_id | suggestDirections/extract/explore | 节点 MD/方向物化 |
| `buildings` | 副本 | kind/anchor/title/sub/md/steps/status/version/basis | detectDungeons/manual patch/refresh | 地图/副本抽屉/挑战 |
| `quizzes` | 节点题 | node_id/kind/prompt/answer/aliases | generateQuiz | 节点题/判题/三档 |
| `attempts` | 答题记录 | quiz_id/correct/created_at | answerQuiz | tier/统计 |
| `source_spans` | 原文片段 | text/revision | extract/segment/explore | 节点来源 quote |
| `focus_stack` | 语音焦点 | world_id/node_ids(JSON) | segment | segment/前端 focus |
| `domain_questions` | 领域日题 | building_id/kind/prompt/answer/day | 领域挑战 | 领域挑战 |
| `daily_domain` | 领域日计数 | world/building/date/count | 领域挑战 | 每日上限 |
| `hide_batches` | 隐藏批次 | node_ids/undone | hide/undo | 撤回/恢复 |
| `meta` | 杂项 | k/v | 迁移/内部 | 迁移/内部 |
| `node_docs` | 节点理解卡 | doc_json/notes_md/version/generated_at | `services/contentDocs.ts` | 节点卡 |
| `relation_docs` | 关系对照卡 | doc_json/notes_md/version/generated_at | `services/contentDocs.ts` | 关系卡 |
| `node_candidates` | 未准入节点 | name/evidence/confidence/status | 准入（下一阶段） | 候选确认 |
| `generation_jobs` | 异步生成任务 | type/target_id/status | 生成（下一阶段） | worker/观测 |
| `edge_practice` | 关系短练习 | edge_id/kind/prompt/answer | `services/practice.ts` | 关系卡 |
| `edge_attempts` | 关系练习记录 | practice_id/correct | `services/practice.ts` | 关系卡进度 |
| `understanding_tasks` | 节点/关系辨析任务 | task_kind/target_type/node_id/edge_id/stem/choices/correct/rubric/evidence | `services/understanding.ts` | 节点卡/关系卡 |
| `understanding_attempts` | 辨析作答记录 | task_id/choice/explanation/correct | `services/understanding.ts` | 关系卡 |
| `events` | 本地指标 | world_id/type/target_id/payload | `web/src/telemetry.ts` → `/api/events` | events summary |

**表关系**：
- `worlds 1—N nodes/edges/buildings/directions/source_spans/focus_stack/hide_batches`；
- `nodes 1—N quizzes/attempts`；`buildings 1—N domain_questions/daily_domain`；
- `directions.node_id → nodes.id`；方向边 `edges.src/dst → nodes.id`（自环）；
- 没有外键约束（SQLite schema 未建 FK），删除世界靠手工清理。

## 5. 改功能去哪（新人最常问）

| 想改 | 先看 | 注意 |
|---|---|---|
| 语音抽取/节点生成 | `server/src/stream/session.ts`、`providers/deepseek.ts` | provisional、parent 启发、suggest/source 双写 |
| 文字抽取/关系分类 | `server/src/routes/graph.ts` `/extract` | 节点先建、关系后判；formal 阈值 0.75 |
| 方向生成/物化 | `providers/deepseek.ts suggestDirections`、`services/directions.ts materializeDirectionEdges`、`assetops.ts ensureDirectionFrontiers` | directions 表 + 自环边双写 |
| frontier | `server/src/db.ts computeFrontier` | 只看 formal 出边 |
| 副本检测/刷新 | `server/src/services/buildings.ts`、`server/src/routes/buildings.ts` | 只读 formal；语音不触发 |
| 3D 渲染/线/路牌 | `web/src/components/World3D.tsx`、`World3DScene.tsx`、`World3DEdges.tsx` | 三文件分工，不再混在一起 |
| 抽屉/理解卡 | `NodeDrawer.tsx`、`RelationDrawer.tsx`、`DungeonDrawer.tsx` | 节点卡/关系卡/副本；Dungeon 是产品名，API/DB 仍 building |
| 流式状态/UI | `store/worldSlice.ts`、`store/streamSlice.ts`、`InputBar.tsx`、`hooks/useVoiceInput.ts` | 已按职责拆开 |
| 布局 | `layout.ts`、`wfc.ts` | `/layout` UI 无入口 |

## 6. 已知架构问题

1. `index.ts` 已降到约 78 行：只剩 express/server/ws 装配 + health；业务路由已拆到 `routes/*`。
2. `db.ts` 约 235 行：已拆出 `db/connection`/`schema`/`sources`/`domain`/`directions`/`buildings`/`nodes`/`edges`/`quizzes`；剩余 worlds/getGraph/recordAttempt/refreshBuildingStatus/seed，作为 barrel + 图读取。
3. `stream/session.ts` 混合 LLM/父子启发/DB 写/focus；无事务。
4. `assetops.ts` 混合建筑位置、方向 frontier、隐藏、导出；名字无意义。
5. 前端已拆：`World3D` 185（组装）+ `World3DScene` 271（岛/建筑/相机）+ `World3DEdges` 278（线/路牌）；`InputBar` 104（UI）+ `hooks/useVoiceInput` 489（音频/WS）；`store.ts` 14（组合）+ `store/worldSlice` 198 + `store/streamSlice` 170 + `store/streamText` 60。
6. web/server DTO 已抽到 `packages/shared`；canonical `line_type/line_state` 已由 getGraph 派生；仍有少量 `send<any>`/组件内类型。
7. 已有 CI；仍无鉴权/静态托管；验收脚本在仓库外。
8. 方向/来源/suggest 的“源数据 vs 地图投影”没有单一来源；P2 canonical 方案见 `canonical-state.md`。

## 7. P1 拆分目标（供实现参考）

```text
server/src/
  routes/         stream/nodes/edges/worlds/dev/buildings/worldAdmin/graph（已拆）
  services/       directions/buildings（已拆）；extract/stream/explore/relations/quiz 待拆
  db/             connection/schema/sources/domain/directions/buildings/nodes/edges/quizzes（已拆）；worlds/graph/seed 留 db.ts
  providers/      deepseek, doubao, mock, types, active
  domain/         placement, frontier, dungeon-validation
  experiments/    anchorFirst, exploreSim（已隔离）；dev fixtures 已拆到 routes/dev
```

拆完后本文和 `glossary.md`/`states.md` 必须同步更新。
