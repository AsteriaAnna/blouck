# DB 重命名/迁移 Runbook（分阶段、可回滚）

> 现状：**不改旧表/旧值**，只加只读兼容视图。真正的 DB 值迁移尚未执行。
> 目标：`formal→relation`、`source→sequence`、`suggest→hint`、`direction→exploration`、`building→dungeon`。
> 原则：每一步可部署、可回滚；先读兼容，再写切换，最后删旧。

## 0. 当前已有兼容层

启动时由 `server/src/db/schema.ts` 自动执行（幂等）：

1. `edges` 加 `kind_v2` / `consumed_v2` 两列；
2. 回填旧 kind/consumed；
3. 建 `AFTER INSERT` / `AFTER UPDATE OF kind, consumed` trigger，旧代码只写 kind 时新列自动同步；
4. 重建只读视图：

```sql
CREATE VIEW edges_canonical AS
SELECT *,
  COALESCE(kind_v2, CASE kind ... END) AS line_type,
  CASE COALESCE(kind_v2, kind) ... END AS line_state
FROM edges;

CREATE VIEW dungeons AS SELECT * FROM buildings;
```

- 旧查询/旧数据完全不变；
- 新代码/报表可直接 `SELECT ... FROM edges_canonical`；
- `dungeons` 是 `buildings` 的只读 alias；
- 测试：`db.test.ts` 断言 view 映射、双写 trigger；`directions.test.ts` 断言 consume 后 `line_state=consumed`；`legacy-boot.test.ts` 用旧 edges schema 起真实 server 验证自动迁移/回填/API。

## 1. 迁移前检查（每次必做）

```bash
# 备份（先停写；SQLite WAL 也要拷）
cp server/data/blouck.db server/data/blouck.db.bak-$(date +%Y%m%d%H%M)
# 或 sqlite3 server/data/blouck.db ".backup '...bak'"
```

- 记录行数：worlds/nodes/edges/directions/buildings。
- 记录 kind 分布：

```sql
SELECT kind, COUNT(*) FROM edges GROUP BY kind;
SELECT status, COUNT(*) FROM directions GROUP BY status;
```

- 确认没有未完成写入（停 server 或只读窗口）。

## 2. Stage A：加新列（不删旧列）

**主路径**：schema 启动时已自动完成 Stage A（加列、回填、trigger）。CLI 仍是可选的独立工具/核对手段：

已实现脚本（默认 dry-run，`--apply` 前自动备份）：

```bash
# 先 dry-run 看行数/缺失列/kind 分布
pnpm --filter @blouck/server migrate:canonical -- --db server/data/blouck.db
# 确认后执行，自动生成 <db>.bak-<timestamp>
pnpm --filter @blouck/server migrate:canonical -- --db server/data/blouck.db --apply
```

脚本只做：

```sql
ALTER TABLE edges ADD COLUMN kind_v2 TEXT;
ALTER TABLE edges ADD COLUMN consumed_v2 INTEGER;
UPDATE edges SET kind_v2 = CASE kind ... END;
UPDATE edges SET consumed_v2 = consumed;
```

- 幂等；重复 --apply 不会重复加列/不会改已正确值；
- 不改旧 `kind`、不删列；
- 测试：`server/src/db/canonical-migrate.test.ts` 用旧 schema 临时库验证映射/幂等。

## 3. Stage B：读切新列

- ✅ `getGraph` 已改为 `SELECT * FROM edges_canonical`：API 的 `line_type/line_state` 直接来自 `kind_v2/consumed_v2`；旧算法仍读 `kind`。
- 其余旧 SQL 仍读 `kind`（兼容窗口），逐步改为 `COALESCE(kind_v2, kind)` 或视图。
- 回滚：代码回滚；DB 新列保留即可，旧数据未改。

## 4. Stage C：写切新列

- 所有 `addEdge/updateEdgeKind` 写 `kind_v2`（并双写 `kind`）。
- 观察一个发布周期：一致性查询必须 0 差异：

```sql
SELECT COUNT(*) FROM edges WHERE kind_v2 IS NOT kind;
```

- 回滚：改回双写/旧写；数据未丢。

## 5. Stage D：删旧列、改视图

```sql
-- 最终代码不再引用 kind 后
ALTER TABLE edges DROP COLUMN kind;
DROP VIEW edges_canonical; -- 或改成直接 SELECT
```

- 必须在新代码稳定、备份保留、回滚窗口结束后。
- `building→dungeon` 同法：`CREATE TABLE dungeons_new` → 双写 → 回填 → 切读 → 切写 → `DROP TABLE buildings`。
- **不要**在同一次发布同时改 edge kind 和 building 表名。

## 6. 自动化测试要求

每个 stage 至少补：

1. 全新 DB schema 能启动；
2. 旧 DB 副本（含 4 种 kind）迁移后行数/计数不变；
3. 迁移可重复执行（幂等）；
4. 双写一致性查询为 0；
5. canonical view 与 `kind_v2` 映射一致；
6. 回滚脚本在副本上能跑通。

`test` 使用临时 DB（见 `db.test.ts` / `integration.test.ts`），不要用开发库。

## 7. 当前状态与下一步

- ✅ 只读兼容视图已上线（本轮）。
- ✅ canonical API 字段、前端 canonical 判断、direction 单源。
- ⬜ Stage A–D 未执行；需要单独排期与停写窗口。
- ⬜ 没有迁移脚本/旧库 fixture；下一轮应先补“旧库副本”测试，再写 Stage A 脚本。

## 8. 禁止事项

- 不在没有备份/回滚脚本时直接 `UPDATE edges SET kind=...`。
- 不同时改 DB 值 + API 路径 + 表名。
- 不用开发库验证迁移；必须临时 DB/副本。
- 不让旧代码在新库上运行（缺列会报错）。
