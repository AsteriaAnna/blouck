# 实验代码 / 死代码 / 隐藏功能清单

> 目的：新人不要把这些当主链路，也不要误以为“代码里有 = 产品里有”。
> 原则：**先标记，不先删除**；P1 移到 `server/src/experiments/`，P2 再决定保留/删除。
> 更新日期：2026-11-17。

## 1. 实验原型（dev only）

| 项 | 位置 | 状态 | 说明 | 建议 |
|---|---|---|---|---|
| 锚点优先链路 | `server/src/anchorFirst.ts`（318 行） | dev 原型，未进主链路 | 句子快判 + `pairFastLLM` + 慢判 + 决策；见 `docs/baseline/anchor-first-prototype.md` | P1 移到 `experiments/`；保留供关系准入实验 |
| `/api/dev/anchor-first` | `index.ts` | dev 路由 | 可 apply=false 观察决策 | P1 移到 dev router/实验开关 |
| `/api/worlds/:id/stream/preview` | `index.ts` | 未使用的 API | 用 `runAnchorFirst` 生成 ghost/决策；前端不调用 | P1 标 experimental 或删除 |
| `/api/worlds/:id/stream/detect` | `index.ts` | 未使用的 API | 只抽候选、不判关系；前端不调用 | P1 标 experimental 或删除 |
| `/api/dev/explore` | `index.ts` 注册两次 | 开发模拟；**重复路由** | 第一次 `simulateExplore`，第二次旧版占位；Express 只命中第一个，第二个不可达 | P1 删重复注册，保留一个 dev 路由 |
| `/api/dev/world` | `index.ts` | dev fixture | 构造随机世界 | P1 移到 dev router |
| `/api/dev/dungeon-fixture` | `index.ts` | dev fixture | 构造必然触发副本的世界 | P1 移到 dev router |
| `server/src/explore.ts` | 123 行 | dev 模拟 | 只被 `/api/dev/explore` 用 | P1 移到 experiments/ |

## 2. 幽灵/流式旧路径

| 项 | 位置 | 状态 | 说明 | 建议 |
|---|---|---|---|---|
| `ghosts` / `spawnGhosts` | `web/src/store.ts`、`InputBar.tsx`、`World3D.tsx` | 半死 | 渲染 `GhostIsland` 还在，但 `setGhosts` 只有清空；没有生产者 | P1 删除 ghost 渲染/状态，或接入真实预览 |
| `GhostIsland` | `World3D.tsx` | 渲染残留 | ghost 不再产生 | P1 同上 |
| `stream/detect` + `stream/preview` | server | 未使用 | 与 ghost 配套的旧预览链路 | P1 删除/隔离 |

## 3. 无 UI 的功能（后端仍在）

| 项 | API/代码 | 状态 | 说明 | 建议 |
|---|---|---|---|---|
| 重排布局 | `POST /api/worlds/:id/layout`、`layout.ts`、`wfc.ts`、`elkjs` | 后端可用，UI 无入口 | 顶栏“重排”在 MVP 清理时移除 | 决定：恢复 UI 或标 internal；不要默认用户能用 |
| 隐藏/撤回 | `/hide/preview`、`/hide`、`/hide/undo`、`hide_batches` | 后端可用，UI 无入口 | 节点抽屉的隐藏面板 MVP 删除 | 决定：恢复 UI 或标 internal |
| 导出 | `GET /api/worlds/:id/export` | 后端可用，UI 无入口 | 顶栏“导出”移除 | 决定：恢复 UI 或标 internal |
| 节点题/三档 | `/nodes/:id/quiz*`、`quizzes`、`attempts`、`tier` | 后端活跃，UI 隐藏 | MVP 隐藏题目区/档位 | 不是死代码；是产品隐藏；恢复前先确认 |
| 副本题 | `domain_questions`、`daily_domain` | 后端活跃 | 领域副本每日题；BuildingDrawer 可能仍在用 | 保留 |
| 关系题 | 无 | 未实现 | 原设计有“关系判断题/三档”，当前没有 | 需求项，不是死代码 |

## 4. 预留字段/旧字段

| 字段/表 | 状态 | 说明 | 建议 |
|---|---|---|---|
| `edges.claim_status` | 预留 | 有字段/类型，几乎没有真实业务行为；`refreshStaleBuildings` 会读 `disputed` | 要么实现争议流程，要么标记 reserved |
| `edges.revision` | 预留 | 没有真实版本/乐观锁行为 | 标记 reserved |
| `edges.target_hint` | 旧字段 | 被 `target_name/type/definition/aliases/predicate/label` 取代 | P2 迁移后删除 |
| `directions.target_hint` | 旧字段 | 同上 | P2 迁移后删除 |
| `directions.consumed_span_id` | 预留 | 记录消费来源片段；使用很少 | 保留或清理 |
| `meta.mig_direction_v2` | 迁移标记 | 一次性迁移使用 | 保留 |

## 5. 需要新人特别注意

1. **dev 路由不是产品行为**：`/api/dev/*` 可以创建随机世界、模拟探索、跑锚点实验，不要据此推断主链路。
2. **前端不可达的功能不是不存在**：hide/export/layout/quiz 的后端和 DB 仍在；改删除前要确认没有测试/导出依赖。
3. **ghost 渲染还在不等于 ghost 可用**：没有生产者，`setGhosts` 只有清空。
4. **重复路由**：`/api/dev/explore` 注册两次，第二个不可达；这是 P1 要修的代码问题。
5. **实验代码有价值**：`anchorFirst` 是关系准入的验证原型，不要直接删；先隔离，供 08 的实验计划使用。

## 6. P1 处置建议

```text
server/src/experiments/
  anchorFirst.ts
  exploreSim.ts
  devFixtures.ts
  (dev router 只在 NODE_ENV=development 注册)
```

- 主链路只保留 `routes/ + services/`；
- dev/实验路由统一加 `/api/dev/*`，并在启动日志打印“实验路由已启用”；
- 前端 ghost 状态要么接入真实预览，要么删除；
- hide/export/layout/quiz 在文档明确“internal/未恢复”，并在 UI 隐藏时不要把它们算作已实现。
