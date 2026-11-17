# 测试与 CI

## 命令

```bash
pnpm typecheck   # shared + server + web
pnpm test        # server 单测 + mock 集成
pnpm build       # web build（shared/server 只 typecheck）
```

CI：`.github/workflows/ci.yml`，push main / PR 跑 install → typecheck → test → build。

## 当前覆盖（P1 起步）

| 测试 | 文件 | 覆盖 |
|---|---|---|
| 放置算法 | `server/src/placement.test.ts` | 空图起点、minGap、relax 局部松弛 |
| 副本校验 | `server/src/dungeons.test.ts` | 线性扩展计数、流程校验、领域共同上位 |
| DB 基础 | `server/src/db.test.ts` | frontier 只看 formal、commitStreamEdges 只提升 stream suggest、directions 状态 |
| mock 集成 | `server/src/integration.test.ts` | 起临时 server + 临时 DB：世界创建、extract、stream segment/commit、重复抽取不重复建边、方向物化只给 frontier/≤2 |

## 已知缺口

- 没有 `materializeDirectionEdges` 的独立单测（当前靠集成测试间接覆盖）；P1 拆 `index.ts` 后补。
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
