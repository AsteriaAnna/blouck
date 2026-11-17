# 07 · 四类线：当前实现与实现笔记（2026-11-17）

> **这是实现文档，不是需求文档。** 需求口径看 [06-four-line-system.md](06-four-line-system.md)。
> 当前真正在跑的代码事实以 [03-implemented.md](03-implemented.md) 和源码为准；本文件记录“代码现在是什么、和需求怎么对应、实现前必须定的技术选择”。

## 1. 当前代码里的四种 `kind`

| 当前 kind | 实际角色 | 谁生成 | 关键字段 | 地图渲染 | 点击行为 | 状态转换 |
|---|---|---|---|---|---|---|
| `formal` | 正式语义关系 | `/extract` 抽取；手动关系 API；`suggest` 接受；语音 commit 提升；探索落图 | `label/predicate/evidence/confidence/origin/md` | 深色 3D 管状实线（r≈2.8），始终显示 | 一句话关系文档（按 predicate） | 稳定；被 `computeFrontier`/副本检测读取 |
| `source` | 顺序线（来源线）的实现基础 | 语音 `ingestSegment`（parent→new，origin=stream）；`/extract` 给新节点补来路；探索落图 | `label`（多为“本轮探索来源”）、`evidence`、`origin` | 蓝灰 3D 管状实线（r≈2.0）+ 起点圆点，始终显示 | 一句话“探索来源”文档 | **不转 formal**；不影响 frontier；不参与副本 |
| `suggest` | 关联提示线的实现基础 | 语音 `ingestSegment`（origin=stream）；`/extract` 中证据不足/置信度低的关系 | `label/predicate/evidence/confidence/origin` | 统一色虚线（#b08a5f）+ 中点路牌；**所有 open 建议都显示，无 4 条上限** | 一句话建议文档 +「接受为正式关系」 | 接受→`formal`（LLM 补谓词/名称/MD）；语音 commit 时 `origin=stream` 且有 evidence 的 suggest 自动→formal |
| `direction` | 探索线的实现基础 | `/extract` 里的 direction 关系；`suggestDirections`（当前每节点 1 条）；`materializeDirectionEdges` | 自环边（`src=dst`）+ `question`、`frontier_x/y`、`consumed`、`target_name/type/definition/aliases/predicate/label`；`directions` 表存计划 | 只在 **frontier** 节点上显示；点线 + 木柱路牌 + 地面箭头；**每节点最多 2 条**（`materializeDirectionEdges` 的 `used>=2`） | 文档显示问题 + 预先计划的目标节点；「生成「X」」调用 `/api/worlds/:id/explore` 直接落计划节点 | 落图后 `consumed=1`；来源节点变成非 frontier 后，其方向边会被 materialize 删除 |

**没有 `sequence` kind。**

## 2. 语音流实际产生的线

- `ingestSegment` 为每个新 provisional 节点写一条 **`source`**（parent→new，`origin=stream`）；
- LLM 抽出的关系写成 **`suggest`**（`origin=stream`）；
- `commitStream` 把 provisional 节点改 committed，并把 `origin=stream` 且有 evidence 的 **`suggest` 全量转 `formal`**；
- `source` 保持 source，**不会转 formal**；所以“顺序线→关系线”目前没有实现。

## 3. 手动联系关系线（入口现状）

- **后端已有**：`POST /api/worlds/:id/relations`
  - body：`{ fromNodeId, toNodeId, predicate?, label?, evidence?, md? }`
  - 若没给合法 `predicate/label`，会调用 `llm.suggestRelation` 让模型补谓词/名称/说明；
  - 校验：两个节点都存在、属于当前世界、不能自连；同 `src+dst+predicate` 的 formal 已存在则 409；
  - 创建：`kind=formal`、`origin=manual`、`confidence=0.9`；
  - 之后 `computeFrontier` + `materializeDirectionEdges`。
- **前端入口目前没有**：MVP 重写 `NodeDrawer` 时把“手动关联/关系列表”删了，所以当前 UI 无法手动连线；只有 API 可用。

## 4. 需求 ↔ 当前实现映射

| 需求类型 | 当前实现基础 | 主要缺口 |
|---|---|---|
| 关系线 | `formal` | 只有一句话文档，没有完整关系 MD；手动入口 UI 缺失 |
| 探索线 | `direction` | 已有“生成时计划目标节点 + 点击直接落图”；缺 4 条/节点、4 条用完再生成、非外围 MD 列表、外围随机 1–2 条及隐藏条补显示、漩涡/线延伸动画 |
| 关联提示线 | `suggest` | 缺后台池、地图 ≤4、新节点重算；当前所有 open suggest 都画 |
| 顺序线 | `source` | 有来路视觉与写入；没有“转关系线”逻辑，也没有 4 条/节点的顺序/来源状态 |

## 5. 实现前必须定的技术选择

### 5.1 顺序线的数据模型

- 选项 A：继续用 `source` kind，增加 `status/role` 字段（sequence → relation），转关系线时改 kind 并补齐 `predicate/label/evidence`；
- 选项 B：新增 `sequence` kind，关系线仍是 `formal`；转关系就是删除/归档 sequence 边、创建 formal 边；
- 选项 C：一条边 + `type/status` 分离（`type` 是用户看到的四类，`status` 是 proposed/confirmed/consumed），避免 kind 同时承担类型和阶段。

**风险**：当前 `suggest`/`formal` 已经用“同一条关系两个阶段”实现（幂等键把 suggest 与 formal 视为同一关系）；顺序线如果也改 kind，要注意同一对节点出现 source + formal 两条边时的去重与副本输入。

### 5.2 “顺序线→关系线”的判定（基于既有关系语义）

当前已有的关系语义与判定条件（代码事实）：

- 谓词：`kindOf/partOf/prerequisite/contrast/alternative/related`；
- 方向约定：具体→上位、部分→整体、前置→后续、对比/相关无方向、替代旧→新；
- `/extract`：有 evidence 且 confidence ≥ 0.75 → `formal`，否则 `suggest`；
- 语音 `ingestSegment`：关系先写 `suggest` + evidence；`commitStream` 时 `origin=stream` 且有 evidence 的 suggest → `formal`；
- 接受建议：`/api/edges/:id/accept` 会调 `suggestRelation` 补谓词/名称/MD，再转 formal；
- 手动关系：直接 formal，`origin=manual`。

因此“顺序线转关系线”不建议用计时器/轮数，而应由**同一对节点的语义关系是否达到 formal 条件**触发：

- 语音提交：已有 `commitStream` 自动转 formal 的路径；
- 抽取：`/extract` 中 relation 达到 evidence + confidence 阈值；
- 接受建议：用户确认；
- 手动：用户主动建立。

如果没有达到 formal 条件，顺序线保留为来路（或按需求文档 Q5 决定是否在地图隐藏）。

### 5.3 探索线的数量/显示

- `materializeDirectionEdges` 当前每节点最多 2 条 direction 边（`used>=2` 跳过），且只在 `frontier=1` 时创建/渲染；
- `suggestDirections` 当前每节点生成 1 条，explore 落图后只补 1 条；
- 需求是每节点 4 条、4 条用完重新生成、外围显示 1–2 条、隐藏条补显示；
- 需要决定：direction 数据存 4 条但只物化 1–2 条展示（推荐），还是只存展示的 1–2 条、隐藏的只存 directions 表；这会决定 API 里节点 MD 如何拿探索列表。

### 5.4 关联提示池

- 现状：`suggest` 没有“池”概念，所有 open suggest 直接画；没有 4 条上限。
- 需求：后台候选池 + 地图 4 个展示位 + 确认一条补一条 + 新节点重算。
- 需要决定：池是数据库候选表还是按当前图实时计算？确认/忽略的状态如何存？地图展示的 4 条是全局还是按节点分摊？

### 5.5 关系 MD

- 现状：`edges.md` 字段存在，但 `RelationDrawer` 只渲染一句话，不读写 `md`；`PATCH /api/edges/:id` 已存在可更新 md/label。
- 需求：只有关系线有完整 MD；需要补前端 MD 展示/编辑，并确定字段（类型/说明/依据/来源）。
- 注意：`/extract`/accept/manual 已经会写 `md`（LLM 生成的关系说明），可直接作为初始 MD 正文。

### 5.6 副本

- 现状：`detectDungeons` 只在 `/extract` 触发；输入是 nodes + formal edges；LLM 提议 + `validateFlowCandidate`/`validateDomainCandidate` 校验；已有 buildings 表与 flow/domain 玩法。
- 需求：关系线变化后异步检测、去重、上限、stale；输入只读关系线。
- 需要决定：触发点（extract / commit / 手动关系 / 定时/idle）、候选节流、每轮上限、重算策略、解锁规则是否沿用当前实现。

## 6. 从需求到实现的建议顺序

1. **关系线**：补完整 MD + 恢复手动入口（API 已有，UI 缺）。
2. **顺序线**：定数据模型（5.1），接既有 formal 判定（5.2）；先不动副本。
3. **探索线**：4 条数据 + 4 条用完再生成 + 外围/非外围显示规则；动画最后做。
4. **关联提示线**：池 + 地图 4 位 + 重算；确认转关系线。
5. **副本**：在关系线稳定后再接异步检测/去重/上限。

> 具体实现方式待讨论；本文件只列选项与风险，不代表已选型。
