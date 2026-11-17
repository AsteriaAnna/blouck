# 术语表（产品词 ↔ 代码词 ↔ 状态 ↔ 表）

> 目的：新人看到代码里的 `formal/source/suggest/direction` 时，能立刻知道它对应产品里的哪类线、处于什么状态、存在哪张表。
> 原则：**产品文档用左列，代码可以用右列；不要把代码 kind 当成产品类型去设计。**
> 现状不是最终命名；P2 才做重命名，P0 先保证大家说同一种话。

## 1. 四类线

| 产品词（用户看到） | 代码 token | 存储 | 当前含义 | 状态/备注 |
|---|---|---|---|---|
| **关系线** | `formal` | `edges.kind='formal'` | 已确认的语义关系，带 `predicate/label/evidence` | 稳定态；副本唯一输入；不可删除（设计） |
| **顺序线 / 来源线** | `source` | `edges.kind='source'` | 节点从哪个节点/哪次生成而来；生成顺序 | 不是语义关系；目前不转 formal |
| **关联提示线** | `suggest` | `edges.kind='suggest'` | 候选关系，等待确认 | 接受/commit 后变 formal；虚线 |
| **探索线** | `direction` | `edges.kind='direction'`（自环） + `directions` 表 | 指向尚未生成的新节点 | 地图只给 frontier 显示；消费后 `consumed=1` |

> 重要：`source` 同时被用作“来源线”和“来源片段”的前缀；`source_span` 指原文片段（`source_spans` 表），不是线。文档里说“来源”时必须区分「来源线」和「原文来源」。

## 2. 节点/边/方向/副本

| 产品词 | 代码 | 表 | 说明 |
|---|---|---|---|
| 节点 / 概念 | `node` | `nodes` | 名词性学习对象；有 type/definition/aliases/MD |
| 线 / 关系 | `edge` / `relation` | `edges` | 数据层叫 edge；语义层叫 relation；视觉层叫 line |
| 关系 MD | `edges.md` | `edges` | 关系线的完整 MD 内容 |
| 节点 MD | `nodes.free_md` | `nodes` | 节点“我的理解/笔记”区 |
| 原文来源 | `source_span` | `source_spans` | 产生节点的原文片段；节点 `source_span_id` 指向它 |
| 探索方向（计划） | `direction` | `directions` | 方向问题、理由、计划目标节点、状态 |
| 方向边（地图投影） | `edges.kind='direction'` | `edges` | `src=dst` 自环，`frontier_x/y` 是落点，`consumed` 是消费标记 |
| 副本 | `building` | `buildings` | 产品叫副本；代码/API 叫 building，检测文件叫 `dungeons.ts` |
| 流程副本 | `building.kind='flow'` | `buildings` | 按顺序连接步骤 |
| 领域副本 | `building.kind='domain'` | `buildings` | 每日 10 题 |
| 外围节点 | `frontier=1` | `nodes.frontier` | **无 formal 出边**的节点；不是地图边缘 |
| 三档 | `tier` | `nodes.tier` | 0–3，由题目通过数推导；当前 UI 隐藏 |
| 题目 | `quiz` / `domain_question` | `quizzes` / `domain_questions` | 节点题和副本日题是两套表 |
| 隐藏 | `hidden` / `hide_batches` | `nodes` / `hide_batches` | 隐藏节点与撤回批次 |
| 布局 | `layout` / `wfc` / `elk` | `nodes.x/y` | `/layout` 端点；UI 当前无入口 |
| 锚点优先实验 | `anchorFirst` | 无 | `/api/dev/anchor-first`；不是主链路 |

| 产品词 | 代码 token/派生字段 | 说明 |
|---|---|---|
| 关系线/顺序线/提示线/探索线 | `line_type`（canonical 派生） | canonical 产品线型，见 canonical-state.md |
| 已确认/待确认/来路/计划/已消费 | `line_state`（canonical 派生） | `getGraph` 附加；DB 仍存 kind |
| 关系线 | `formal` | 存储 kind；映射 relation |
| 顺序线 / 来源线 | `source` | 存储 kind；映射 sequence |
| 关联提示线 | `suggest` | 存储 kind；映射 hint |
| 探索线 | `direction` | 存储 kind；映射 exploration |

## 3. 状态词

| 状态 | 字段 | 取值 | 谁改 |
|---|---|---|---|
| 节点生命周期 | `nodes.status` | `provisional` / `committed` | 语音 segment 建 provisional；commit 改 committed |
| 节点可见性 | `nodes.hidden` | 0 / 1 | hide 接口 |
| 节点档位 | `nodes.tier` | 0–3 | 答题后计算 |
| 节点外围 | `nodes.frontier` | 0 / 1 | `computeFrontier`（只看 formal 出边） |
| 边类型 | `edges.kind` | `formal/source/suggest/direction` | 创建时决定；suggest 可转 formal |
| 边来源 | `edges.origin` | `auto/manual/stream/direction` | 创建时写入 |
| 边消费 | `edges.consumed` | 0 / 1 | 方向探索后 |
| 边争议/版本 | `claim_status` / `revision` | 预留 | 目前几乎没有业务行为 |
| 方向状态 | `directions.status` | `open/consumed/archived` | 生成 open；探索后 consumed |
| 副本状态 | `buildings.status` | `detected/locked/playable/cleared/stale` | 检测/解锁/挑战/依据变化 |
| 焦点栈 | `focus_stack` | 节点 id 数组 | 语音链路每句更新 |

## 4. 容易混淆的命名

| 看到 | 不要理解成 | 正确理解 |
|---|---|---|
| `source` 边 | 原文来源 | 顺序线/生成来路 |
| `source_span` | 来源线 | 原文片段表 |
| `direction.src/dst` | 普通边的两端 | 自环 `src=dst=node`；落点在 `frontier_x/y` |
| `frontier` | 地图边缘 | 无 formal 出边 |
| `building` | 建筑资产 | 副本入口（flow/domain） |
| `formal` | “正式”阶段 | 关系线（已确认关系） |
| `suggest` | 建议动作 | 关联提示线（候选关系） |
| `label` | 关系名 | 也可存方向计划目标名；方向/建议牌子的文字 |
| `md` | 节点 MD | `edges.md` 是关系 MD；节点正文是 `nodes.free_md` |
| `commit` | 提交代码 | 语音链路把 provisional 节点转 committed，并提升 stream suggest |
| `accept` | 接受建议 | 把 suggest 边转 formal |
| `consume` | 消费方向 | 把 direction 边/方向标记为已探索 |

## 5. 命名规则（P2 前）

- 产品/需求/体验文档：用「关系线 / 顺序线 / 关联提示线 / 探索线 / 副本」；
- 代码注释：首次出现写「产品词（`code`）」；
- 新代码不要新增 `lineType`/`kind` 去表达产品类型；先复用现有 `kind` 并写状态转换；
- 不要新增第五个 kind；如果必须区分状态，用状态字段，不要用新 kind；
- 任何新表/新字段必须在 `docs/engineering/states.md` 和本表登记。

## 6. 待清理（P2）

- `target_hint`（旧）与 `target_name/type/definition/aliases/predicate/label`（新）并存；
- `claim_status`、`revision` 没有真实业务行为；
- `source` 与 `sequence` 的命名；
- `building` 与 `dungeon` 的命名；
- `edge.md` 与 `node.free_md` 的编辑器/版本策略。
