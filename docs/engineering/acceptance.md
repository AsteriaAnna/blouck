# 验收记录（本次）

> 目的：证明“新人能跑通 + 能改”不是口头结论。记录本次实际执行的命令、耗时和结果。
> 环境：Windows，仓库 `blouck`，main 分支；时间 2026-11-17。

## 1. 环境

```text
node v24.15.0
pnpm 10.33.2
```

- `pnpm install --frozen-lockfile`：lockfile up to date，0.5s
- 不配置 key：mock 可跑；本次运行环境配置了 key，health 显示 deepseek/doubao

## 2. 启动与 health

```bash
pnpm dev
curl http://localhost:8787/api/health
```

结果：

```json
{"ok":true,"providers":{"llm":"deepseek","asr":"doubao","llmActive":"deepseek","asrActive":"doubao"}}
```

> 注意：本次验收发现 8787 上曾有一个 `tsx src/index.ts`（非 watch）的旧进程，导致 API 还是旧代码。重启为 `pnpm --filter @blouck/server dev`（tsx watch）后恢复正常。新人按 README 用 `pnpm dev` 即可。

## 3. 质量门禁

| 命令 | 耗时 | 结果 |
|---|---|---|
| `pnpm typecheck` | 3.6s | shared/server/web 全通过 |
| `pnpm test` | 3.0s | **20 pass / 0 fail** |
| `pnpm build` | 5.6s | web build 成功 |

测试覆盖见 [testing.md](testing.md)。

## 4. demo 世界 API 验收

```text
worlds: 110
demo nodes: 24
demo edges: 45
direction edges: 9
edges with canonical line_type: 45 / 45
line_type values: relation, sequence, hint, exploration
```

说明：

- canonical 派生字段已对所有边生效；
- direction 投影边存在（9 条）；
- 四类线在 demo 数据里都能出现。

## 5. 浏览器 smoke

用 CDP 脚本打开 demo 世界、点节点/建筑抽屉：

```text
errors: []
building drawer z-index=100
hit node label=概念
```

- 3D 场景/线/抽屉渲染无 console error；
- 抽屉层级正确（不被 3D HTML 标签穿透）。

## 6. 验收目标对照

| 目标 | 状态 | 证据 |
|---|---|---|
| 1 小时跑通 | ✅ 当前机器约 12 秒跑完 install 后门禁；文档路径 [onboarding.md](onboarding.md) | §1–§3 |
| 半天说出主链路/表用途 | ✅ 文档：onboarding §2/§3 + [architecture.md](architecture.md) + [glossary.md](glossary.md) | 13 表、双链路、direction 源/投影 |
| 1 天定位关系/方向/副本改动 | ✅ onboarding §4 改动定位表 | `routes/graph.ts`、`services/directions.ts`、`services/buildings.ts` |
| 2–3 天完成带测试小 PR | ✅ 有测试/CI/小 PR 先例 | 20 tests + CI workflow |
| 1 周独立改非核心功能 | 🟡 结构已支持，但无真人计时样本 | 前端已拆 hooks/slices/scene；后端 routes/services/db |
| 2–4 周安全改核心逻辑 | 🟡 canonical/单源已就绪，DB 重命名未执行 | 见 [canonical-state.md](canonical-state.md) Phase 3 |

## 7. 未完成/风险

- P2 的 DB 值迁移（formal→relation 等、building→dungeon）**未执行**；目前是 API 派生 + 兼容视图 + 前端/文件 alias 的分阶段状态，迁移方案见 [migrations.md](migrations.md)。
- 没有前端自动化 E2E；本次是 CDP smoke，未纳入 CI。
- 无鉴权/静态托管；验收不覆盖部署。
- 真实 LLM 输出质量不在本次验收范围（mock 集成只保证链路）。

## 8. 结论

- “跑通 + 主链路/表 + 改动定位”的工程结构已具备可验证证据。
- 结构性目标（P0/P1/P2 前端与 canonical）完成；P2 的 DB 重命名仍是下一阶段。
