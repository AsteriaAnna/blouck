# 新人 1 小时跑通 + 验收路径

> 目标：完全不了解项目的工程师，**1 小时跑通并说出主链路/表用途**；半天能定位关系/方向/副本改动点。
> 只依赖本文件 + [architecture.md](architecture.md) + [glossary.md](glossary.md) + [states.md](states.md)。

## 0. 前置

- Node.js **24**（`node --version`；项目用 `node:sqlite`，22 不够）
- pnpm **10**（`pnpm --version`）
- 端口 `8787`（server）、`5173`（web）
- 不配任何 key 时会自动用 mock，不需要 API key 也能跑通

## 1. 0–15 分钟：启动

```bash
pnpm install
# 可选：cp server/.env.example server/.env
# Windows PowerShell: Copy-Item server/.env.example server/.env
pnpm dev
```

验收：

```bash
curl http://localhost:8787/api/health
```

应返回 `ok: true` 和 `providers.llmActive`（mock 或 deepseek）。

打开 http://localhost:5173 ，应看到世界列表；点 demo 世界能看到节点/线/副本。

> 端口冲突：`pnpm dev` 起不来时先确认 8787/5173 没被占用；不要另起一个 server，Vite 代理指向 8787。

## 2. 15–30 分钟：主链路

### 文字

```text
输入框 → POST /api/worlds/:id/extract
→ 抽取节点（先建节点）→ 关系判定（formal/suggest）→ 方向（directions）
→ materializeDirectionEdges 生成方向投影边
```

### 语音

```text
麦克风 → AudioWorklet 16k PCM → /ws/asr
→ /stream/segment（provisional 节点/关系/source 边）
→ /stream/commit（provisional→committed；stream suggest→formal）
→ 语音不生成方向/题目/副本
```

### 探索方向

```text
点方向线 → POST /api/worlds/:id/explore
→ 消费 directions → 在 frontier 生成计划节点 → source+formal 边 → 新方向
```

关键约束（验收时要能说出来）：

- `frontier` 只看 **formal 出边**；`kind=direction` 自环不算。
- `directions` 表是方向源数据；`edges(kind=direction)` 只是地图投影。
- 每节点最多 2 条方向投影；非 frontier 的投影会被删除。
- 语音 segment 的 text 是**累计文本**，去重逻辑在 `web/src/store/streamText.ts`。

## 3. 30–45 分钟：13 张表

| 表 | 用途 | 关键点 |
|---|---|---|
| `worlds` | 世界 | `root_node_id`、`is_demo` |
| `nodes` | 节点 | provisional/committed、frontier、hidden、tier |
| `edges` | 线 | kind=formal/source/suggest/direction；direction 是投影 |
| `directions` | 方向计划 | 源数据；status=open/consumed；target_* 预规划 |
| `buildings` | 副本 | 代码叫 building，产品叫副本；domain/flow |
| `quizzes` | 节点题 | short/judge |
| `attempts` | 答题记录 | 决定 tier |
| `source_spans` | 来源片段 | 节点 MD 的“来源” |
| `focus_stack` | 最近焦点 | 最多 12 |
| `domain_questions` | 领域每日题 | 按 building+day |
| `hide_batches` | 隐藏/撤回 | 撤回批次 |
| `daily_domain` | 领域每日配额 | 每日 10 题 |
| `meta` | 迁移标记 | 如 `mig_direction_v2` |

## 4. 45–60 分钟：改动定位

| 想改 | 先看 |
|---|---|
| 关系判定/阈值 | `server/src/routes/graph.ts`（extract） |
| 语音 provisional/commit | `server/src/stream/session.ts` |
| 方向物化/消费 | `server/src/services/directions.ts`、`routes/edges.ts` |
| 副本检测/刷新 | `server/src/services/buildings.ts` |
| 副本挑战/提交 | `server/src/routes/buildings.ts` |
| 线渲染 | `web/src/components/World3DEdges.tsx` |
| 岛/建筑/相机 | `web/src/components/World3DScene.tsx` |
| 输入条/语音 | `web/src/components/InputBar.tsx`、`web/src/hooks/useVoiceInput.ts` |
| 前端状态 | `web/src/store/worldSlice.ts`、`store/streamSlice.ts` |
| DTO/契约 | `packages/shared/src/index.ts` |

## 5. 验收命令

```bash
pnpm typecheck
pnpm test
pnpm build
```

当前基线：47 个测试通过；mock 集成覆盖 world→extract→stream segment/commit、重复抽取去重、方向物化/消费、directionId 直接探索；旧库启动迁移/双写回填；节点/关系理解卡生成、备注、异步 worker、手动关系、软准入候选确认；提示池排序；答题→tier→副本解锁；关系/节点辨析任务（边界/反例/纠错/迁移）；辨析副本单/多误解点、选关系排序、难度自适应；题目质量审计/低分重写（关系+节点）；人工反馈/校准/阈值建议；解释 rubric 评分；学习指标汇总/趋势；长文本分块；V3 全链路；事件汇总。

新人自检问题：

1. 说出语音/文字两条主链路的入口文件和关键函数。
2. 说出 `directions` 和 `edges(kind=direction)` 谁是源、谁是投影。
3. 说出 `frontier` 只看哪种边。
4. 改“关系准入阈值”要动哪个文件、加什么测试。
5. 改“副本挑战题”要动哪个路由、哪张表。

## 6. 常见坑

- **fresh DB**：迁移顺序/建表顺序有问题会在全新 DB 暴露；已有开发库可能掩盖。测试会用临时 DB。
- **mock 与真实模型**：mock 抽取只有固定实体；验收主链路用 mock 即可。
- **语音不触发副本/方向**：这是契约，不是 bug。
- **`source` 不是 `source_spans`**：一个是边 kind，一个是表。
- **`building` = 产品“副本”**：不是 3D 建筑模型。

## 7. 关联

[architecture.md](architecture.md)、[glossary.md](glossary.md)、[states.md](states.md)、[testing.md](testing.md)、[canonical-state.md](canonical-state.md)。
