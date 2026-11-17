# 测试与 CI

## 命令

```bash
pnpm typecheck   # shared + server + web
pnpm test        # server 单测 + mock 集成
pnpm build       # web build（shared/server 只 typecheck）
```

CI：`.github/workflows/ci.yml`，push main / PR 跑 install → typecheck → test → build。

## 当前覆盖（P1 起步，当前 42 个测试）

| 测试 | 文件 | 覆盖 |
|---|---|---|
| 放置算法 | `server/src/placement.test.ts` | 空图起点、minGap、relax 局部松弛 |
| 副本校验 | `server/src/dungeons.test.ts` | 线性扩展计数、流程校验、领域共同上位 |
| DB 基础 | `server/src/db.test.ts` | frontier 只看 formal、commitStreamEdges 只提升 stream suggest、directions 状态、canonical line 映射、双写 trigger/view |
| 方向物化/消费 | `server/src/directions.test.ts` | 每节点最多 2 条、重复执行幂等、非 frontier 删除、consume 以 directions 为源 |
| 方向计划 4 条 | `server/src/integration.test.ts` | 新节点 `directions` 至少 4 条 open；地图仍只 materialize 1–2；directionId 可直接探索，探索生成的新节点也有 4 条 |
| DB 迁移 Stage A | `server/src/db/canonical-migrate.test.ts` | 旧 schema 临时库：kind→line_type 回填、consumed 回填、重复执行幂等 |
| 旧库启动迁移 | `server/src/legacy-boot.test.ts` | 旧 edges schema 起真实 server：自动加列/trigger、旧行回填、canonical API 正常 |
| V3 理解卡 | `server/src/contentDocs.test.ts` | 节点卡位置/来源、关系卡证据、备注不覆盖、方向/来源不生成 MD |
| V3 生成 worker | `server/src/generationWorker.test.ts` | 幂等入队、node_doc/relation_doc 串行执行、空队列返回 |
| V3 软准入 | `server/src/integration.test.ts` | 无语义关系实体只进 `createdCandidates`，不新建可见节点；候选列表/确认后建节点+formal 边 |
| 副本解锁 | `server/src/buildings.test.ts` | tier>=1 后 domain/flow 从 detected → playable；short+judge 正确 → tier=1 → playable |
| V3 提示池 | `server/src/hints.test.ts` | 置信度/新近/热度排序、top-k display、旧边回退 |
| V3 关系练习 | `server/src/practice.test.ts` | 3 题生成/答案隐藏/缓存/判题记录；无源不生成事实题（旧接口） |
| V3 辨析任务 | `server/src/understanding.test.ts` | 无源不出题；选择+解释；答案不暴露；节点边界任务；反例/纠错/迁移变体独立缓存 |
| V3 辨析副本 | `server/src/dungeonSequence.test.ts` | 单关系 3 关；两条关系多误解点 4 关；按类型/证据优先选关系；全过 → cleared |
| V3 题目质量 | `server/src/understandingQuality.test.ts` | 证据/误解/干扰项/比较/非定义题；好题高分、定义题低分 |
| V3 质量重写 | `server/src/understandingRepair.test.ts` | 关系/节点低分题重写一次；保留高分版本、删低分 |
| V3 学习指标 | `server/src/learningStats.test.ts` | 任务/作答/卡片/方向/副本汇总；平均解释分；近 7 日趋势；CSV 行数/表头 |
| V3 解释质量 | `server/src/explanationQuality.test.ts` | 空解释 0；完整解释高分；rubric 覆盖降分 |
| V3 全链路 | `server/src/v3Loop.test.ts` | 源→关系→辨析→三关副本→cleared→指标 |
| V3 浏览器 E2E | `scripts/e2e-v3.mjs` | 节点辨析→三关→指标面板；需 dev server + Chrome，非 CI |
| V3 指标事件 | `server/src/events.test.ts` | 写入、world 过滤、type 汇总 |
| mock 集成 | `server/src/integration.test.ts` | 起临时 server + 临时 DB：世界创建、extract、stream segment/commit、重复抽取不重复建边、方向物化只给 frontier/≤2、seed demo 方向投影 |

## 已知缺口

- 没有前端组件/E2E 测试；现有 `_verify` 脚本在仓库外（CDP/浏览器），未纳入 CI。
- 没有 LLM 真实调用的稳定评测；`server/eval` 是离线评测，不阻断 CI。
- 没有 DB 迁移回归测试；schema 迁移目前靠启动时执行。
- 没有并发/事务测试（题目并发、方向落图多写）。

## 写测试的约定

- 纯函数优先放 `src/*.test.ts`；
- 需要 DB 的测试用 `process.env.DB_PATH` 指向临时文件，并在 import `db.ts` **之前**设置；
- 集成测试用临时端口/DB，必须清理进程和文件；
- 不依赖真实 DeepSeek/豆包；mock provider 默认可跑；
- 修 bug 先加失败测试，再修。

## 下一步（P1 收尾）

1. 拆出 `materializeDirectionEdges` 到 `services/directions.ts`，补单测（非 frontier 删除、每节点 ≤2、幂等）。
2. 把 `_verify` 的 CDP 脚本移入 `tests/e2e`（Playwright/自建 CDP），至少覆盖：打开地图、点节点文档、点方向生成。
3. 加 DB 迁移测试：空库启动、旧库补列、重复启动幂等。
4. 加前端 store/组件 smoke 测试（可选）。
