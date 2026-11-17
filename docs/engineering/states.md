# 状态机（节点 / 边 / 方向 / 副本 / 题目）

> 目的：新人改状态相关代码前，先看这张表，避免把“阶段”当“类型”、把“投影”当“源数据”。
> 关键原则：**源数据是一个状态，地图/边是投影；不要把投影状态当成另一个源。**

## 1. 节点 `nodes`

```text
(语音 segment) → provisional
                    │ commitStream
                    ▼
                 committed
```

| 字段 | 取值 | 谁写 | 说明 |
|---|---|---|---|
| `status` | `provisional` / `committed` | `ingestSegment` 建 provisional；`commitStream` 改 committed | 语音链路独有；文字 `/extract` 直接 committed |
| `hidden` | 0 / 1 | hide 接口/撤回 | 隐藏不是删除 |
| `tier` | 0–3 | 答题后 `recordAttempt` 重算 | 由通过题数推导；UI 当前隐藏 |
| `frontier` | 0 / 1 | `computeFrontier` | **只看 formal 出边**；没有 formal 出边 = 1 |
| `type` | 概念/方法/组件/指标/工具 | 抽取/手动 | 字符串白名单 |
| `source_span_id` | 原文片段 id | 建节点时 | 节点“来源” |
| `status` 与 `hidden`/`tier`/`frontier` | 互相独立 | — | 不要用一个字段表达多个状态 |

**注意**：
- `frontier` 是派生字段，不是用户设置的；
- 方向只给 `frontier=1` 的节点渲染地图线，但所有节点都可以有方向数据；
- 节点没有“删除”状态，只有隐藏。

## 2. 边 `edges`

### 2.1 类型（`kind`）

| kind | 产品名 | 创建 | 终止/转换 |
|---|---|---|---|
| `formal` | 关系线 | 抽取达到 formal 阈值；手动关系；接受建议；探索落图；commit 提升 | 稳定；不可删除（设计） |
| `source` | 顺序线/来源线 | 新节点生成时写 parent→new；探索/抽取补来路 | 不转 formal（当前实现） |
| `suggest` | 关联提示线 | 抽取证据不足；语音 stream 先写 suggest | 接受→formal；commit 时 `origin=stream` 且有 evidence 的 suggest→formal |
| `direction` | 探索线 | `materializeDirectionEdges` 从 `directions` 表投影 | 落图后 `consumed=1`；来源不再 frontier 时被删除 |

### 2.2 生命周期

```text
suggest ──accept / commitStream(origin=stream & evidence)──▶ formal
   │
   └─（忽略：当前没有 archived 状态，边仍在，只是可能不再展示）

direction(open) ──探索──▶ consumed=1 ──▶ 若来源非 frontier，materialize 删除
```

| 字段 | 取值 | 说明 |
|---|---|---|
| `origin` | `auto/manual/stream/direction` | 建立方式；用户手动= `manual` |
| `consumed` | 0 / 1 | 方向线专用；不是所有边 |
| `claim_status` | 预留 | 目前几乎没有业务行为 |
| `revision` | 预留 | 目前几乎没有业务行为 |
| `target_*` | 方向计划 | `target_name/type/definition/aliases/predicate/label`；`target_hint` 是旧字段 |
| `label` | 关系名/方向目标名/牌子文字 | 语义被重载，见术语表 |
| `md` | 关系 MD | 只有关系线会读；节点 MD 在 `nodes.free_md` |

**注意**：`suggest` 与 `formal` 是同一关系的两个阶段，不是两种知识；`source` 与 `formal` 可以是同一对节点的两条边（当前实现的重叠问题）。

## 3. 方向 `directions` + 方向边

### 3.1 两套记录

```text
directions 表（源数据/计划）:
  open ──探索成功──▶ consumed
  open ──归档/旧逻辑──▶ archived（当前很少用）

edges(kind='direction')（地图投影）:
  存在 → consumed=1 → 可能被 materialize 删除（来源非 frontier）
```

| 位置 | 字段 | 用途 |
|---|---|---|
| `directions` | `node_id/question/reason/status/target_*/consumed_span_id` | 方向计划；节点 MD/探索入口读这里 |
| `edges` | `src=dst=node/question/frontier_x/y/consumed/target_*` | 地图渲染；只给 frontier、每节点最多 2 条 |

### 3.2 物化规则（`materializeDirectionEdges`）

1. 删除所有 `src` 为非 frontier 的方向边；
2. 遍历 `directions.status='open'`、节点 frontier、未隐藏；
3. 每个节点最多 2 条；
4. 已存在的 `src|question` 不重复建；
5. 从 `directions` 复制 `target_*` 到边。

**陷阱**：方向边的 `src=dst` 是自环；落点在 `frontier_x/y`，不是 `dst`。`ensureDirectionFrontiers` 负责给没有落点的方向算坐标。

## 4. 副本 `buildings`

```text
detected ──满足解锁条件──▶ playable ──挑战成功──▶ cleared
   │                           ▲
   └── locked（当前代码基本不再设置）┘
   
detected/playable/... ──依据隐藏或争议──▶ stale
stale ──依据恢复──▶ refreshBuildingStatus → detected/playable
```

| 状态 | 含义 | 进入条件 |
|---|---|---|
| `detected` | 已出现、未满足挑战条件 | 创建/刷新时未达标 |
| `locked` | 计划中的锁 | 当前代码有 guard，但主流程很少设置；视为 legacy |
| `playable` | 可挑战 | 流程：步骤节点 tier≥1（或锚点）；领域：≥2 个成员 tier≥1 |
| `cleared` | 已通关 | 挑战成功 |
| `stale` | 依据失效 | 依据节点隐藏或关系 disputed |

**注意**：副本由系统生成，用户不能新建；`detected` 直接挑战应返回 409；`cleared` 不再回到 detected。

## 5. 题目 / 档位

- `quizzes`：节点题（short/judge），有 `answer`；通过后 `attempts` 记录，`nodes.tier` 由 `countPassed` 推导（1/1、3/5、5/10）。
- `domain_questions`：领域副本每日题，按 `building_id + day` 生成/读取；`daily_domain` 记录当天数量。
- `quizzes` 和 `domain_questions` 是两套题，不要混用。
- 当前节点题/档位 UI 隐藏，但后端仍在；做 UI 前先确认是否恢复。

## 6. 焦点栈 `focus_stack`

- 每个世界一份节点 id 数组（语音链路用）；
- `ingestSegment` 每句更新：本句主题/兄弟/当前/activeStack；
- 不是图结构，不要拿它推导关系。

## 7. 隐藏 `hide_batches`

```text
hide → nodes.hidden=1，写 hide_batches(ids, undone=0)
undo → hide_batches.undone=1，nodes.hidden=0
```

隐藏会影响副本 `stale`，不是纯 UI 操作。

## 8. 改状态前必须确认

1. 这个状态是**源数据**还是**地图投影**？
2. 它会不会影响 `computeFrontier`、`materializeDirectionEdges`、副本检测？
3. 转状态时是改字段、删边、还是新建边？有没有历史/幂等要求？
4. 有没有前端/API/导出依赖这个状态？
5. 有没有测试覆盖？没有就先补测试（P1）。

## 9. 已知状态问题（待 P2）

- `kind` 同时承担类型和阶段（suggest/formal）；
- `directions` 表与方向边双写，谁是 source of truth 未文档化；
- `source` 与 `sequence` 命名不一致；
- `claim_status/revision/target_hint` 预留但无行为；
- `locked` 状态有 guard 但主流程很少设置；
- 节点题/档位 UI 隐藏但后端仍活跃。
