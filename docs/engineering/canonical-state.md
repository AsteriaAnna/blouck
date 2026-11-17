# Canonical 状态模型（P2，分阶段迁移）

> 目的：解决“`kind` 同时承担类型/阶段、direction 双存储、命名与产品不一致”的问题。
> 原则：**先加派生字段和映射，再改调用点，最后才迁移 DB 值**；每一步可回滚、有测试。

## 1. 为什么需要 canonical

现状（DB）只有 4 个 `edges.kind`：

```text
formal | source | suggest | direction
```

但产品语义是：

| 产品类型 | 产品阶段 |
|---|---|
| 关系线 | 已确认 |
| 顺序线（来源） | 来路/生成顺序 |
| 关联提示线 | 待确认 |
| 探索线 | 已计划/已消费 |

`kind` 把“类型 + 阶段”揉在一起；`direction` 又有 `directions` 表 + 自环边两套记录。新人无法回答：
“改一条线的阶段，是改 kind、删边，还是改状态？”

## 2. Canonical 模型（代码/API 层）

```ts
type LineType = "relation" | "sequence" | "hint" | "exploration";
type LineState = "confirmed" | "proposed" | "provenance" | "planned" | "consumed";
type EdgeOrigin = "auto" | "manual" | "stream" | "direction";
```

### 2.1 映射（迁移期）

| DB `kind` | `line_type` | 默认 `line_state` | 说明 |
|---|---|---|---|
| `formal` | `relation` | `confirmed` | 已确认知识 |
| `source` | `sequence` | `provenance` | 来路/顺序 |
| `suggest` | `hint` | `proposed` | 待确认候选 |
| `direction` | `exploration` | `planned`；`consumed=1` → `consumed` | 地图投影；计划在 directions 表 |

共享包提供：

- `deriveLineFields({kind, consumed})`：唯一映射入口；
- `EDGE_KIND_TO_LINE_TYPE`、`LINE_TYPE_LABEL`；
- `EdgeDTO.line_type/line_state`：可选派生字段。

### 2.2 当前落地阶段

- ✅ Phase 1：shared 增加 canonical 类型/映射；`getGraph` 给每条 edge 附加 `line_type/line_state`；`RelationDrawer` 已改用 canonical 判断（不再直接 switch `edge.kind`）。
- ✅ 测试：`db.test` 断言 formal→relation/confirmed、source→sequence/provenance；integration 断言 seed demo 方向线 `line_type=exploration`。
- ✅ Phase 2（大部分）：extract 不再直接 `addEdge(kind='direction')`；seed demo 改用 `addDirection`；GET world 会 `materializeDirectionEdges`。**方向边现在只由 materialize 投影生成**（dev 模拟除外）。
- ⬜ Phase 2 剩余：`consumeDirection` 只改 directions.status；读取逻辑逐步只读 directions。
- ⬜ Phase 3：DB 值迁移/重命名（见 §4）。
- ⬜ Phase 4：前端组件全面使用 canonical，后端内部逐步改名。

## 3. direction 的单一来源（待做）

现状：

```text
directions 表：question/reason/status/target_*   ← 计划
edges(kind=direction)：自环 + frontier_x/y + consumed  ← 地图投影
```

目标：**directions 表是唯一源数据；edges 的 direction 只是投影/视图。**

执行顺序（建议）：

1. ✅ extract 不再直接写方向边；seed 改用 `addDirection`；GET world 负责 materialize。方向边只由 `materializeDirectionEdges` 投影生成（dev `exploreSim` 除外）。
2. `materializeDirectionEdges` 只负责读 directions → 生成/更新投影，禁止反向写计划。
3. `consumeDirection` 只改 `directions.status='consumed'`；投影的 `consumed` 由派生字段生成，不再作为独立源。
4. 读取逻辑（节点 MD/探索入口/API）只读 directions；渲染读投影。
5. 稳定后再考虑删除 `edges.consumed` 或改为纯派生。

风险：当前 `explore` 用 edgeId 找方向和 status；改造时要保持 API 兼容（edgeId 仍可用）。

## 4. DB / 命名迁移（分阶段，暂不做）

建议步骤，每步单独 PR + 测试：

1. **代码别名层**（现在）：新代码只用 `line_type/line_state`；旧 `kind` 只在 DB/repo 层出现。
2. **API 双写**：响应同时给 `kind` 和 `line_type`；前端先迁 canonical。
3. **DB 值迁移**：`formal→relation`、`source→sequence`、`suggest→hint`、`direction→exploration`；`building→dungeon` 单独迁移（表名/字段/API 一起）。
4. **删除旧字段**：`target_hint`、`claim_status/revision`（若仍无行为）清理。
5. **rename 文件/服务**：`assetops`、`dungeons`、`directions` 命名统一。

禁止：在没有迁移测试/回滚方案时直接改 DB 值；一次同时改 kind + 表名 + API。

## 5. 验收

- 新人只看 `glossary.md` + 本文件，能说出“四类线、阶段、origin、direction 源 vs 投影”。
- 前端不再直接依赖 `edge.kind` 做产品判断。
- 方向写入只有一个入口；方向消费只有一个状态源。
- 重命名分阶段、每步测试通过。

## 6. 关联

[glossary.md](glossary.md)、[states.md](states.md)、[architecture.md](architecture.md)、[07-line-implementation-notes.md](line-implementation-notes.md)。
