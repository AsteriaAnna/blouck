# 生成算法评测（eval）

日期：2026-11-14
脚本：`server/eval/run.ts`（抽取/关系）、`server/eval/dungeons.ts`（副本校验）
用例：`server/eval/cases.json`（12 个中文 AI 产品学习材料，人工标注）、`server/eval/dungeons.ts` 内置 15 个副本正负例

## 用法

```bash
cd server
pnpm eval                 # 直连 provider（默认 deepseek）
pnpm eval -- --provider=mock
pnpm eval -- --api        # 走真实 API（含副本检测），需服务已启动
pnpm eval:dungeons        # 副本发现/校验正负例（无需服务）
```

输出：

- `server/eval/report-<provider>.md` / `.json`
- `server/eval/report-<provider>-api.md` / `.json`

## 评测指标

| 指标 | 含义 |
| --- | --- |
| 实体 Precision / Recall / F1 | 抽取的概念 vs 人工标注概念（支持别名归一） |
| 关系对 Precision / Recall | 抽取的连接对 vs 标注关系对（无向匹配） |
| 线型一致率 | 关系的地图类型（formal/source/suggest/direction）是否与标注一致 |
| 证据覆盖率 | 关系是否带来源证据（当前恒 0，因为模型没有 evidence 字段） |
| 方向问题命中 | 该出现方向的用例是否正确产出 question |
| 流程/领域副本命中 | 仅 `--api` 模式，检查副本是否被检测出来 |

## 基线结果（2026-11-14）

| 指标 | 旧版 mock | 旧版 deepseek | **关系 v2 deepseek** |
| --- | --- | --- | --- |
| 实体 P | 100.0% | 100.0% | 100.0% |
| 实体 R | 17.1% | 60.0% | **70.0%** |
| 关系 P | 0.0% | 4.3% | **32.4%** |
| 关系 R | 0.0% | 6.0% | **46.0%** |
| 线型一致率 | 0.0% | 0.0% | **91.3%** |
| 证据覆盖率 | 0.0% | 0.0% | **46.0%** |
| 方向问题命中 | 0/5 | 5/5 | 1/5（方向改为独立表，评测只统计关系输出） |

**结论**：关系 v2 把关系 Recall 从 6% 提到 46%、Precision 从 4.3% 提到 32.4%；谓词准确率 87.0%、线型一致率 91.3%、证据覆盖率 46.0%。方向改为独立表后，评测脚本只统计关系输出，需单独评方向质量。

## 根因（脚本里已标注）

1. **结构限制**：抽取 schema 的 relations 只有 `target`，没有 `source`，所有边只能是「焦点 → 目标」；非焦点的实体对（A 前置 B、A 组成 B）无法表达。这是关系 Recall 上不去的首要原因。
2. **无知识关系类型**：只返回 source/formal/suggest/direction 四类地图线，没有前置/组成/对比/替代等教学语义；线型一致率因此为 0。
3. **无证据字段**：抽取结果没有 evidence span，无法校验、无法展示来源。
4. **无别名/去重策略**：只按名称精确匹配。
5. **mock 只是关键词表**：Recall 17%，关系随机，不能作为离线质量基线。

## 下一步（按优先级）

1. 改抽取 schema：`relations: [{source, target, type(知识关系), mapType, label, evidence, confidence}]`；
2. 补证据：每条关系必须返回原文证据句（用于校验与展示）；
3. 教学关系词表：前置/组成/对比/替代/相关 + 与四类地图线的映射规则；
4. 多轮 gleaning 提升 Recall；
5. 别名/去重（精确 + 向量 + LLM 裁决）；
6. 副本检测单独评测（流程唯一拓扑、领域簇）；
7. 每次算法改动后重跑 `pnpm eval`，报告进 `docs/reviews/`。

## 副本评测（2026-11-14）

`pnpm eval:dungeons` 跑 15 个用例（流程 8、领域 7），覆盖：

- 流程正例：3–6 步 + 过程词 + 唯一顺序；
- 流程负例：2 步、7 步、多解、环、无过程词、低置信度、引用不存在节点；
- 领域正例：4 成员 + 共同上位；
- 领域负例：3 成员、无共同依据、泛化名、与成员同名、重叠过高、低置信度。

结果：`TP=2 FP=0 FN=0 TN=13`，Precision=1.00、Recall=1.00（小样本，需扩样）；报告写入 `server/eval/report-dungeons.md`。

副本位置实测（`POST /api/dev/dungeon-fixture`）：

- 流程副本在链上方、与最近节点留白 100；
- 领域副本在领域簇下方、与最近成员留白 116；
- 两副本互不粘连。

截图见 `docs/screenshots/12-dungeon.png`。

---

*评测集与脚本已入库，作为算法 v2 的验收基线。*
