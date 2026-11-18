# 设计—实现偏差审计（2026-11-18）

> 对应设计：[world-design.md](../product/world-design.md)
> 只记录“设计应该是什么 / 代码实际是什么 / 证据 / 修复优先级”。

## 0. 结论

当前不是“空壳”，但存在**四处结构性偏差**：

1. **关系门失效**：建议关系可以无证据升级为正式关系，并把模型的推理说明写进 `evidence`。
2. **Demo 数据不是设计数据**：早期演示/实验数据混入同一个 demo 世界，关系无 predicate、无证据，甚至出现“证据未显示…故定位为相关”的伪证据。
3. **MD 是自由生成文本，不是受约束的理解卡**：没有来源时仍可生成“解释”，导致空心内容。
4. **副本触发过早**：第一次 extract 就可能检出副本，未等待节点积累、方向出现、证据关系足够。

## 0.1 本轮修复状态（2026-11-18）

- ✅ 证据门：无 evidence 的 suggest 不能 accept；手动无证据关系落为虚线假设；不再把 LLM 的 `suggestion.md` 写入 evidence。
- ✅ demo 重建：12 节点/10 条 canonical 关系，全部节点挂 source_span；删除“向量数据库↔上下文窗口”等伪关系；关系卡立即显示原文依据。
- ✅ 副本门槛：可见节点≥8、有证据 formal 边≥4、frontier≥1 才检测；demo fixture 显式 `force`。
- ✅ 卡片状态：关系卡无依据显示“假设/缺少依据”；节点无 source 显示“草稿，不能生成事实题”。
- 🟡 旧库其他世界仍有历史空证据边，需要单独清理脚本；本轮只重建 demo。
- 🟡 节点 MD 仍可能由 LLM 生成草稿（已加“缺来源”标记），还不是完全由证据结构化。

## 1. 用户指出的具体案例

`向量数据库 ↔ 上下文窗口`：

- 当前 DB 边：`kind=formal`, `predicate=related`, `label=技术关联`
- `evidence`：`向量数据库与上下文窗口均为大模型应用中的技术概念，但证据未显示上下位、部分或前置关系，故定位为相关。`
- 关系卡 `one_line`：`向量数据库与上下文窗口之间关系未在给定证据中说明`
- 来源：seed 里先建了无证据 `suggest` 边；之后 `POST /api/edges/:id/accept` 调用 `llm.suggestRelation`，把返回的 `md` 写进 `evidence`。

**根因不是模型乱说，是代码允许“无证据接受建议”，并把解释当证据。**

代码位置：

- `server/src/db.ts` seed：`E(vectordb, ctx, "suggest", "可能相关？")`，无 evidence。
- `server/src/routes/edges.ts` accept：`edge.evidence || suggestion.md`，空证据时用模型说明补位。
- `server/src/providers/deepseek.ts` suggestRelation：没有证据时仍返回 `related` 和解释性 md。

## 2. 关系类型与方向

设计要求：6 类固定 predicate + 固定方向。

实际情况：

- 大量 demo/seed 边 `predicate=NULL`，只有自由 label（依赖/组合/使用/受限于/验证/控制/调用）。
- 前端 `RelationDrawer` 对 `predicate` 为空默认 `related`，显示“相关关系”，用户看不到真实类型。
- 方向也按 label 推测，未遵循 kindOf/partOf/prerequisite 的方向约定。
- 关系中存在自环（`上下文窗口→上下文窗口`、`召回率→召回率`）与重复边。

## 3. MD 空心

- `ensureNodeDoc` 没有 `source_span` 时会用定义/邻居生成 fallback，仍可能输出“体系位置/边界”，但没有证据标注。
- `ensureRelationDoc` 只做“证据是否为空/引用是否存在”的弱校验；无来源时仍生成对照卡。
- 卡片里没有统一的“来源缺失/假设”状态，用户无法区分“知识”与“模型解释”。

## 4. 题目的来源

- 关系题：从关系证据原文生成；无来源转 `source_required`（这一条已实现）。
- 节点题：从节点来源生成；无来源转 `source_required`（已实现）。
- 旧节点定义题：从 definition/free_md 生成，仍在“复习模式”里；主路径已改为辨析。
- 但 demo 旧数据没有来源，却已经存在题库/文档；**旧文档没有按新规则重算**。

## 5. 副本时机

设计要求：节点积累 + 方向出现 + 证据关系足够后，才“发现”副本。

实际：

- `detectBuildingsLLM` 只检查“是否已有 flow/domain”，没有节点/证据/方向阈值。
- `/extract` 末尾直接调用 `detectBuildingsLLM` 与 `detectBuildingsV2`。
- seed demo 直接创建两个副本。
- 结果：用户输入第一段就可能看到塔/门，且副本成员关系没有证据。

## 6. 其他空心点

| 点 | 现状 | 影响 |
|---|---|---|
| 关系接受 | 无证据也能接受 | 伪关系进正式图 |
| 手动关系 | 无证据也能建 formal | 同上 |
| 方向线 | 旧数据有方向无目标/无问题 | 点击探索可能只建关系 |
| 提示线 | seed 用“可能相关？”占位 | 用户看到无意义提示 |
| 节点卡 | 邻居多、无 canonical 类型/证据 | “很多关系没必要/描述不清” |
| 副本 MD | 生成文本，未绑定证据 | 看起来像内容，实际不可核验 |
| 地图 | 旧数据自环/重复边 | 视觉噪音 |

## 7. 修复顺序（按用户价值）

1. **证据门**：无证据不能升级正式关系；解释不入 evidence。
2. **Demo 重建**：干净的原文 + canonical predicate + evidence；删除伪关系/自环/重复。
3. **MD 状态**：无来源的卡显示“假设/待补来源”，不生成事实题。
4. **副本阈值**：节点≥8、证据关系≥4、frontier≥1 才检测；演示世界不参与该阈值。
5. **旧数据清理**：删除无证据 formal、自环、重复边；重算 doc/task。
6. **UI 明示**：关系卡上显示“证据缺失/假设”；提示线明确不是知识。

> 本轮先做 1–4 的可验收部分；5–6 需要单独迁移脚本/验收。
