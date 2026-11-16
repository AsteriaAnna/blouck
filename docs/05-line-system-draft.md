# 05 · 线系统设计草稿（v0，待评审）

> **这是草稿，不是实现依据，也不是需求文档。** 它先回答“现有算法/契约对线有哪些约束、哪些方案在现实里做不了”，再把交互、后端、字段、任务与待决策点摊开。
> 关联：[04-problems.md](04-problems.md) 001（问题与探索记录）；实现事实以 [03-implemented.md](03-implemented.md) + 源码为准。
> 阅读约定：
> - 【事实】= 代码/实测可证，附文件行号或证据；
> - 【假设】= 本轮提出、**尚未经你确认**的设计候选，不能当结论；
> - 【待决策】= 需要产品/你拍板的问题；
> - 【禁止/风险】= 与现有算法/契约冲突、或会拖垮生成速度的做法。
> 用户端与后端严格分开：§3 用户端、§4 后端、§5 生成字段与题目/记录。

- 版本：v0（2026-11-16）
- 基线：`d768326` + 04 草稿；本轮未改代码
- 证据/算法检查：`server/src/stream/session.ts`、`index.ts`、`db.ts`、`dungeons.ts`、`placement.ts`、`layout.ts`、`wfc.ts`、`web/src/components/{World3D,RelationDrawer,NodeDrawer}.tsx`、`_audit/*`

---

## 0. 先澄清：哪些是事实、哪些是我的假设

### 0.1 事实（可直接约束设计）

1. 只有 **四种线 kind**：`formal | source | suggest | direction`（`03 §5`、`db.ts`），没有“探索线/推荐线”第五种。
2. **方向线是自环边**（`src=dst=node`，`question` 存问题），且：
   - 只在 **frontier 节点** 渲染（`World3D.tsx:557-586`）；
   - `materializeDirectionEdges` **每节点最多 2 条**（`index.ts:75-107`，`used >= 2` 即跳过）；
   - `computeFrontier` 只看 **formal** 边（`db.ts:401-416`），方向/来源/建议不参与 frontier；
   - 副本检测只读 **formal** 边（`dungeons.ts`），direction/source/suggest 不参与。
3. **语音链路与文字链路分工**：语音 `segment` → 1 次 LLM 抽取（20s 超时）→ 写 provisional + `suggest`/`source`；`commit` 只做 DB 状态迁移（`commitStreamEdges` 把 stream 的 suggest+evidence 自动转 formal）。**语音链路不生成方向、不出题、不触发副本检测**（`03 §9`）。
4. **文字链路 `/extract`** 是重流程：1 次 extract 抽取 + 可能 1 次 suggestDirections（只为“尚无任何方向”的节点）+ 可能 1 次 detectDungeons + 最多 3 个节点的异步出题；实测一次 extract 约 **6.1s / 7.3s**（A1 审计）。
5. **建议线的自动升级**：`commitStreamEdges`（`db.ts:359-365`）把 `origin='stream' AND kind='suggest' AND evidence<>''` 全量转 formal —— 任何“新建议类型”若复用 `kind=suggest` 且 origin=stream，都会被自动转正式。
6. **坐标是增量放置**：新节点用 `placeAround` 围绕父节点在 250–780 半径环上找点（`placement.ts:13-71`）；老节点位置不动；只有 dev 的 `simulateExplore` 末尾做局部 `relax`；`layout` 端点才会全局重排（`layout.ts`）；前端 `posOf` 用节点包围盒质心把整图重新居中（所以新增节点会让已有标签整体微移）。
7. **渲染成本**：每条方向/建议线在 3D 里是一个 `Line` + 一个 HTML `SignPost`；每节点 4 方向意味着 4 个 HTML 标签/节点（当前最多 2 且只给 frontier）。
8. **数据字段固定**：`direction` 只有 `directions(node_id, question, reason, target_hint, status)` + 自环边；`edges` 没有 angle/round/status（有 claim_status/revision 但无真实行为）；`nodes.free_md`/`edges.md` 是单 TEXT，无版本/结构。
9. **无事务封装**：`addNode/addEdge/addDirection` 是独立同步写，没有事务 helper；探索一次写多行需要自己加事务/幂等。
10. **现有评测**：`server/eval` 12 例，线型一致率 91.3%、方向命中 1/5（2026-11-14）；不覆盖 UI/交互/关系校验。

### 0.2 我上一轮越界的地方（本版撤回）

- ❌ “方向来源=语义+图结构+系统三层混合” —— 不是事实，是我的**假设**；
- ❌ “探索时先匹配已有节点、高置信优先连接，否则生成 1–3 个新节点” —— 同样是**假设**，不是现有行为（现有 `extract` 只做“同名去重”，没有“连已有”分支）；
- ❌ 把“每节点 4 个探索型节点”当既有设计 —— 工作区**没有**该原始设计，它是你本轮提出的目标（见 §0.3）；
- ❌ 把“建议卡/关系卡”的具体字段当既定 —— 属于 **待决策**。

### 0.3 你本轮提出的目标（记录为新增期望，尚非需求规格）

- 【新增期望】每个节点保证 **4 个探索型节点/方向**；
- 【新增期望】点击探索线后的流程、生成/连接规则要能匹配现有生成速度；
- 【新增期望】节点/关系生成时要有“题目/内容/记录”的明确设计，区分用户端与后端。

---

## 1. 算法与契约对“线”的约束（先看现实，再设计）

### 1.1 延迟/成本约束（“线”必须契合生成速度）

| 链路 | 现在做什么 | 实测/代码约束 | 对探索设计的含义 |
|---|---|---|---|
| 语音 segment | 每句 1 次 LLM extract（超时 20s）→ 写 provisional | 前端 segment 队列**串行**；commit 要等队列排空；句间体验要求快 | **不能**在 segment 里再加一次 LLM 校验/方向生成；关系校验与 4 方向生成必须放到 commit 后/后台/懒触发 |
| 语音 commit | 仅 DB 状态迁移（0 LLM） | 快；但自动把 stream suggest 转 formal | 探索建议若复用 suggest 会被误升级 → 必须换 origin 或独立表 |
| 文字 extract | 1 extract + 1 方向 + 可能 1 副本 + 异步出题 | 实测 ~6–7s；返回是“同步等全部 LLM” | 探索若同步做“抽取+校验+4方向”，会到 10s+；需分阶段/异步/缓存 |
| 节点出题 | 首次打开节点同步 LLM（2.5s，最长 20s） | 打开节点会卡 | 4 方向若也“打开时现算”，会叠加卡顿 → 需要缓存/预热/模板兜底 |
| 渲染 | 每线 1 Line + 1 HTML SignPost | 4 方向/节点 × N 节点 DOM 数量线性涨 | 需渲染上限/只给 frontier/远处隐藏（待决策） |

### 1.2 结构约束（不能硬改的语义）

| # | 约束 | 依据 | 不能做什么 |
|---|---|---|---|
| C1 | 四种 kind 固定 | `03 §5` | 不能新增第五种 line kind 而不改 03/迁移；探索建议必须映射到现有 kind 或用独立数据结构 |
| C2 | direction 是自环 + 只 frontier 渲染 + 每节点最多 2 条 | `World3D.tsx:557-586`、`index.ts:75-107` | 想“每节点 4 方向”必须改渲染/物化上限；不能让方向参与 frontier/副本算法 |
| C3 | commit 自动升级 stream suggest | `db.ts:359-365` | 探索产生的“建议”不能用 stream suggest 落库，否则会被自动转正式 |
| C4 | 副本检测只看 formal + kindOf/过程词 | `dungeons.ts:154-184` | 不能随意改 formal 的 label 语法/谓词语义；不能把探索线当 formal 喂给副本检测 |
| C5 | 坐标增量放置、老节点不动 | `placement.ts`、`03 §8` | 不能每新增节点全局重排；新节点多时只能局部松弛/限数量 |
| C6 | 边/MD 字段固定、无事务 | `db.ts` | 新字段（angle/round/archived/updated_at）必须迁移；探索多写必须自己事务/幂等 |
| C7 | 现有抽取是“单段文本→实体/关系” | `session.ts:122-277`、`03 §4` | 不能假设一次抽取能自动推断多跳/图结构关系；跨段推断要另做算法 |
| C8 | LLM 输出需证据子串、超时 20s | `session.ts`、`deepseek.ts` | 不能把“模型自由生成的解释”直接当证据；探索候选必须可校验 |

### 1.3 可做 / 不建议做 / 明确不能做（初步）

- **可做**：
  - 用现有 `directions` 表扩字段（angle/status/round 等），把“4 方向”落为 direction 记录；
  - 在 `/extract` 之后异步补 4 方向（批量一次 LLM），或用模板兜底保证数量；
  - 探索执行复用现有 `addNode/addEdge` + 新事务 helper；
  - 关系校验做成独立异步步骤（NLI/规则），不阻塞语音 segment。
- **不建议**：
  - 每句语音都跑关系校验/方向生成；
  - 每节点 4 方向都实时 LLM 现算（N 节点 × LLM 成本/延迟）；
  - 把探索建议复用 `kind=suggest, origin=stream`；
  - 用 `formal` 的 label 语法承载探索语义（会污染副本检测）。
- **明确不能做（与现有契约直接冲突）**：
  - 改 `direction` 参与 `computeFrontier`/副本检测而不改 03；
  - 在语音 commit 里同步做探索（会让 commit 从毫秒级变数秒）；
  - 在未迁移 DB 的前提下直接写新字段；
  - 用无证据的 LLM 文本直接建 formal 关系。

### 1.4 现有算法的“线”生成路径（事实清单）

| 路径 | 产生什么线 | 证据/落库 | 触发 |
|---|---|---|---|
| `/extract` LLM relations | formal/suggest/source/direction | `index.ts:273-341` | 文字输入 |
| `/extract` 每新节点/过程节点补 source | source | `index.ts:390-412`、`:402-412` | 文字输入 |
| `/stream/segment` | provisional + source + suggest | `session.ts:122-277` | 语音 |
| `/stream/commit` | suggest→formal；provisional→committed；不改坐标 | `db.ts:359-365`、`session.ts:280+` | 语音停止 |
| `/api/edges/:id/accept` | suggest→formal（LLM 重写 label/md/predicate） | `index.ts:901-927` | 人工接受 |
| `/api/worlds/:id/relations` | 手动 formal（LLM 补谓词/名称/md） | `index.ts:930-967` | 人工连线 |
| `materializeDirectionEdges` | direction（自环） | `index.ts:75-107` | extract 后/手动关系后/layout 后 |
| `/api/edges/:id/consume` | direction consumed | `index.ts:1306+` | 方向探索 |
| `simulateExplore` | 模拟线（dev/不可达） | `explore.ts` | `/api/dev/explore` 死路由，不是产品链路 |

---

## 2. 规则类 / 语义类 / 待决策（草稿清单）

### 2.1 规则类（R，产品/系统规则；需拍板后落为代码）

| # | 规则 | 现状 | 草稿建议（待确认） | 用户端/后端 |
|---|---|---|---|---|
| R1 | 每节点 4 方向：数量、去重、覆盖、刷新 | 现状最多 2 且只 frontier | 4 条；角度不重复；消费/新增后重算；保留历史 | 前端展示/后端生成 |
| R2 | 方向生成时机 | 只在 `/extract` 后为“无方向”节点生成 | 事件触发（extract/commit/节点打开懒加载）+ 批量 + 模板兜底 | 后端 |
| R3 | 建议→正式的确认规则 | 手动 accept；语音 commit 自动升级 | 是否允许语音自动？两种建议是否分表/origin？ | 用户端确认 + 后端 |
| R4 | 置信分档与阈值 | 无显式阈值（rel.confidence 默认 0.6/0.7；extract 里 <0.6 丢弃） | formal/suggest/reject 三档阈值；可配置 | 后端 |
| R5 | 编辑仲裁（accept 覆盖） | accept 无条件覆盖用户 label/md | 用户优先/覆盖前确认/合并（待定） | 用户端 + 后端 |
| R6 | 删除/归档/撤回 | 无删除；方向 consume | 不可删除下定义“否定/归档/存疑”；是否允许删手动线 | 用户端 + 后端 |
| R7 | 探索防重/防循环 | 无 | 记录已探索方向；A→B 后再从 B 探索回 A 的规则 | 后端 |
| R8 | 失败/重试/幂等 | extract 失败返回 warning；无重试 | 探索失败保留方向；幂等键；重试上限 | 后端 |
| R9 | MD 结构与版本 | 单 TEXT，无 updated_at | frontmatter + 小节；revision 乐观锁 | 前端编辑 + 后端 |
| R10 | 渲染上限 | 全量渲染节点/线 | 4 方向/节点 + 远处/非 frontier 降级（DOM/性能） | 前端 |
| R11 | 验收口径 | 现有 12 例 mapType 评测 | L1 生成/L2 状态/L3 交互/L4 视觉/L5 可用性 | 前后端 + 评测 |

### 2.2 语义类（S，需要我们自己设计判断规则）

| # | 工作 | 现状 | 草稿建议（待确认） |
|---|---|---|---|
| S1 | 谓词体系（kindOf/partOf/prerequisite/contrast/alternative/related） | 6 值；方向约定散落在 prompt/UI | 定义每个谓词的语义、方向、正/反例、domain/range；是否加“指标/应用/因果/时序” |
| S2 | 节点类型与 domain/range | 概念/方法/组件/指标/工具（UI/抽取） | 类型集合固定；谓词允许的端点类型矩阵 |
| S3 | 证据充分性/meaningfulness | 只查 evidence 子串包含 | G1 证据接地 / G2 蕴含 / G3 本体约束 / G4 产品确认；阈值待定 |
| S4 | 4 探索角度分类与问句模板 | 无（现 suggestDirections 自由生成） | 角度枚举：定义/上位/组成/前置/对比/替代/指标/应用/边界/反例；每角度模板 + 覆盖规则 |
| S5 | 线的名称/内容规则 | source 固定「本轮探索来源」；formal/suggest 用 LLM label；direction 用问题句 | 来源=`本轮从「A」探索到「B」`；formal=短谓词；suggest=带问号；direction=问题句 |
| S6 | 合并/别名/同名 | findNode 名称+别名精确匹配 | 同名/近义合并、别名策略、探索连已有的判定（如果决定做） |
| S7 | 线型语义边界 | 四种 kind 有定义但 UI 未完整表达 | 建议≠正式；来源是正式的一种；方向只是提示；语音自动升级是否合法（待定） |

### 2.3 待决策（D，先于开发；用户拍板前不实现）

| # | 问题 | 选项 | 影响 |
|---|---|---|---|
| D1 | 正式关系能否点开？只读 or 可编辑 | 只读说明 / 可编辑 MD / 不可点 | 交互与数据模型 |
| D2 | 探索来源线的格式与内容 | 「本轮从 A 探索到 B」/自由文本；原句/轮次/时间 | 名称规则、MD 结构 |
| D3 | 来源线与正式关系是同一还是并存 | 同一（source 只是标签）/ 两条 | 数据模型、副本检测 |
| D4 | 建议线：直接接受 or 先建议卡 | 直接 / 卡 | 用户端流程 |
| D5 | 每节点 4 方向是否硬约束；方向线点击后 | 消费消失 / 留痕 / 转来源线 | 规则、DB、渲染 |
| D6 | 语音自动 commit 算不算“用户接受建议” | 算 / 不算（保留建议/批量确认） | 现有契约要改 |
| D7 | 线宽/视觉以哪份为准 | §3.5 细线 / §8.23 粗管 / 样片数值 | 视觉验收 |
| D8 | “不可删除”下错误关系如何修正 | 否定 / 归档 / 存疑 / 允许删除 | DB 字段、UI |
| D9 | 边 MD 与节点 MD 是否同一编辑器 | 同一 / 分开 | 前端结构 |
| D10 | 测试验收口径 | L1–L5 取舍 | 评测范围 |
| D11 | 探索时“连已有 vs 生成新” | 先连已有（需匹配算法）/ 只生成新 / 用户选 | 抽取管线 |
| D12 | 探索失败/重复/循环规则 | 保留方向/提示/跳过 | 状态机 |
| D13 | 4 方向生成时机与成本 | 懒生成/批量/事件/模板兜底 | 性能/成本 |
| D14 | 关系是否也要出题 | 不给关系出题 / 出一类“关系理解题” | 题目体系、DB |

---

## 3. 用户端交互逻辑（前端）

### 3.1 地图上的线（展示规则）

| 线型 | 展示（现状） | 草稿建议（待确认） | 可点 |
|---|---|---|---|
| 正式关系 | 实线（颜色 `EDGE_COLORS.formal`），无标签、不可点 | 深色实线；hover 显示关系名；点击开关系卡 | 待 D1 |
| 探索来源 | 实线（`EDGE_COLORS.source`），无起点圆点、无标签、不可点 | 蓝灰实线 + 起点圆点；hover「本轮从 A 探索到 B」；点击开来源卡 | 待 D2/D3 |
| 建议 | 虚线 + 路牌（label） | 虚线 + 呼吸；路牌显示建议问句；点击开建议卡 | 是（现状） |
| 方向 | 虚线 + 路牌（question） | 点线 + 问号徽章；hover 加深；点击开方向卡 | 是（现状） |

### 3.2 点击后显示的字段（按线型）

| 线型 | 必显字段 | 可选/交互 | 不显示 |
|---|---|---|---|
| 正式关系卡 | 关系名、谓词、方向（A→B）、证据原句、置信度、建立方式（AI/手动）、来源轮次 | 用户备注 MD（编辑/保存）、跳转两端节点、关系状态 | 不显示答案/内部 prompt |
| 来源卡 | A→B、来源原句、触发方式（语音/文字/手动）、轮次/时间 | 跳转两端、从这条来路继续探索 | 不显示“可删除” |
| 建议卡 | 建议谓词/名称、AI 依据（证据）、置信度、建议来源 | 接受、忽略、跳转两端 | 不显示内部打分细节（可折叠） |
| 方向卡 | 问题、理由、角度（可选）、可能指向（若有） | 去探索、换个方向、忽略 | 不显示“已生成节点”（探索前没有） |
| 节点抽屉（现有） | 档位、定义、别名、关系列表、方向列表、自由区 MD、题目区、隐藏 | 手动关联、保存 MD、答题 | — |

### 3.3 探索交互流程（用户视角）

```text
地图/节点抽屉里看到方向线/方向卡
 → 点击方向线/问号点 → 方向卡（问题/理由/可能指向）
 → 点「去探索」→ loading（可取消）→ 结果面板：
      · 若产生新节点：显示新节点卡（名称/定义/证据/建议关系）→ 用户确认落图（或自动落图，待定）
      · 若命中已有节点（如果 D11 选择“连已有”）：显示“连接到已有节点 X” → 确认
      · 若无可靠结果：提示“这个方向暂时没有可靠内容”，方向保留
 → 落图后：方向线变为已消费/留痕（待 D5）；新节点出现来源线；节点抽屉出现 4 个新方向
```

### 3.4 节点连接字段（用户端需要看到的）

- 节点卡/抽屉：关系列表每行显示「线型 + 关系名 + 方向 + 证据摘要 + 来源轮次 + 操作（查看/编辑）」；
- 关系卡：两端节点名、谓词方向、证据、来源、建立方式；
- 来源卡：A→B、原句、轮次、触发方式；
- 探索结果：新节点名称/定义/证据、与当前节点的来源关系、与已有节点的建议关系；
- 方向列表：4 条（问题 + 角度 + 状态 + 探索按钮）。

---

## 4. 后端逻辑（服务端）

### 4.1 现有链路与延迟预算（事实）

| 步骤 | LLM 调用 | 实测/上限 | 备注 |
|---|---|---|---|
| 语音 segment | 1 extract | 20s 超时；前端串行 | 不能加同步 LLM |
| 语音 commit | 0 | 快 | 自动升级 suggest |
| 文字 extract | 1 extract + 0/1 方向 + 0/1 副本 + ≤3 异步出题 | ~6–7s 实测 | 已经是重流程 |
| 节点出题 | 1 generate | 2.5s（最长 20s） | 懒加载 |
| 关系 accept | 1 suggestRelation | ~1s 级 | 覆盖 label/md |
| 手动连线 | 0/1 suggestRelation | ~1s | 无方向归一/证据 |

**探索新增调用的预算（草稿建议）**：
- 一次探索：1 次抽取（生成候选节点/关系）+ 1 次校验（规则必做，NLI/LLM 二选一按成本）+ 1 次 4 方向生成（可批量/模板兜底）；
- 目标：**首屏反馈 < 1s（先返回方向卡/开始态），结果 3–8s 内异步返回**；超时可取消、失败保留方向；
- 禁止：把探索执行放进语音 segment/commit 的同步路径。

### 4.2 关系生成与校验管线（后端）

```text
输入：文本/问题 + 当前图上下文（节点、已有关系、本体/谓词表）
① 候选生成（LLM，受控 schema）：
   entities[{name,type,aliases,definition,evidence}]
   relations[{src,dst,predicate(白名单),label,evidence,confidence}]
② 证据接地：evidence 必须能在 source_span/text 中匹配（忽略标点），否则拒绝
③ 语义校验（独立于生成器）：
   - G2 蕴含：evidence ⟹ (src,predicate,dst)（NLI/事实核查小模型）
   - G3 本体：predicate 的 domain/range/方向/矛盾/基数（SHACL 思路）
   - G4 分档：score = w·[接地,蕴含,约束,模型置信] → formal/suggest/reject
④ 落库：formal（高置信）/ suggest（中置信）/ 不落图（低置信）；记录来源、轮次、置信、校验结果
⑤ 用户确认：suggest→accept（保留用户编辑）；语音自动升级是否允许（D6）
```

- 【假设 A1】上述校验器/阈值是候选，不是事实；
- 【事实】现有只做 evidence 子串包含（`session.ts`），没有 NLI/本体校验；
- 【禁止】同一个 LLM 既生成又当唯一裁判（会放大幻觉）；校验器要独立/可解释/可测试。

### 4.3 4 方向生成器（后端，草稿候选）

- 【事实】现状：`llm.suggestDirections` 只对“没有任何方向”的节点批量生成；`materializeDirectionEdges` 每节点最多 2 条、仅 frontier 渲染；`directions` 表无 angle/score 字段；
- 【假设 A2】方向来源可做三层混合：语义角度（LLM）+ 图结构缺口（规则）+ 用户/历史（MD 待探索/未消费方向）；
- 【假设 A3】每节点 4 条是硬约束，不足时用模板兜底（如“X 的前置条件是什么？”）保证数量；
- 生成时机候选（待 D13）：① 节点创建/关系变化后异步批量；② 节点打开时懒生成；③ 每日/空闲预热。**不能**在语音 segment 同步做；
- 去重：问题 embedding 相似度 + 角度分类；保留已消费历史避免重复问；
- 成本：LLM 批量（一次调用生成 N 节点各 4 条）优先；模板兜底不耗 LLM；
- 字段建议：`question/angle/reason/target_hint/status/round/created_by`（需迁移）。

### 4.4 探索执行管线（后端，草稿）

**候选 API（草案，未实现）**：

```text
POST /api/worlds/:id/explore/preview   { directionId }        → { status, question, candidates[], matchedExisting[], warnings[] }
POST /api/worlds/:id/explore/commit    { directionId, selected[] } → { nodes, edges, directions, transactionId }
```

- 执行顺序（同事务/幂等键）：
  1. 校验方向属于该世界且 open；
  2. 生成候选（LLM）→ 校验（§4.2）→ 选新节点/连已有（D11）；
  3. 写：新节点（placeAround）、来源线 A→B、正式/建议关系、方向 consumed、B 的 4 方向、A 补方向；
  4. 更新 frontier/direction 物化（注意 direction 不能被提交自动升级）；
  5. 返回结果；失败回滚事务、方向保持 open。
- 幂等：`transactionId` 或 `(directionId, commitHash)`；重复提交返回同一结果；
- 性能：LLM 在 preview 阶段做；commit 只写 DB（快）。

### 4.5 状态机（后端）

| 对象 | 状态 | 事件→状态 |
|---|---|---|
| direction | open / consumed / archived | 点击不动；去探索→consumed（或留痕，D5）；忽略→archived |
| suggest | suggest / formal / archived | accept→formal；忽略→archived（待定）；语音 commit→formal（现有，D6） |
| source | 只读 | 不参与 accept；不删除（待定） |
| formal | formal | 不可删除（设计）；修正/否定/归档待 D8 |
| 探索事务 | idle/ preview/ committing/ done/ failed | preview→commit→done；失败→failed（方向保留） |

### 4.6 数据模型变更建议（需迁移，先评审）

| 表/字段 | 现状 | 建议 | 是否必须 |
|---|---|---|---|
| directions | question/reason/target_hint/status | + angle、score、round、created_by、consumed_at | 4 方向需要 |
| edges | kind/label/md/evidence/confidence/origin/claim_status/revision | 探索建议需 `origin='explore'`（防 commit 自动升级）；可能 + round/created_by | 必须（若复用 suggest） |
| edges | 无删除/归档 | 可复用 claim_status=archived 或新字段 | D8 |
| nodes/edges md | 单 TEXT | + updated_at/revision；MD 结构约定（frontmatter） | 可后置 |
| source_spans | id/world/text/revision | 探索来源复用；轮次可用 created_at | 现有够用 |
| quizzes/attempts | 节点题 | 关系题需新表或 node_id→edge_id 扩展 | D14 |

### 4.7 性能/降级策略（草稿）

- LLM 调用：超时 20s、失败返回 warning（现有）；探索失败保留方向、可重试；
- 4 方向：优先批量一次 LLM + 模板兜底；节点多时只对 frontier/最近活跃节点预热；
- 渲染：3D 每节点 4 方向先只渲染 frontier + hover 展开（待 D10/前端性能）；HTML 标签设上限/距离裁剪；
- 缓存：方向生成结果落 DB；关系校验结果可缓存到 evidence hash；
- 成本：每个探索事务 1–3 次 LLM（抽取+方向，NLI 可选）；需要统计 token/耗时后再定预算。

---

## 5. 节点与关系生成：题目、记录内容与功能需求

### 5.1 LLM 生成 schema（后端“题目/提示词”侧）

| 生成物 | 必带字段 | 校验 | 备注 |
|---|---|---|---|
| 节点 | name/type/definition/aliases/evidence/confidence | 长度 2–20、非问句/代词、证据可匹配 | 现有 prompt 已有，需加 schema 校验 |
| 关系 | src/dst/predicate(白名单)/label/evidence/confidence/direction | evidence 可匹配、predicate 合法、方向符合定义 | 现有有 evidence/confidence；缺方向强校验 |
| 方向 | question/angle/reason/target_hint? | 问题句、8–60 字、不重复、角度覆盖 | 现有只有 question/reason；angle 需新增 |
| 探索结果 | 候选节点/关系 + 校验结果 + 来源 | 同节点/关系校验 | 新增 |

### 5.2 学习题目（用户端 quiz）与关系的关系

- 【事实】现有题目只属于**节点**：5 简答 + 10 判断（`03 §9`），存 `quizzes(node_id,...)`；答对累计 `passed/tier`（1/1、3/5、5/10）；关系**没有题目**；副本有 flow/domain 两种题（building）。
- 【事实】题目生成时机：extract 后仅前 3 个新节点异步生成；打开节点懒生成；失败降级 mock；题/答案注入 LLM prompt（答案不返回主 API，但 export 含答案）。
- 【待决策 D14】关系是否出题？候选（若做）：
  - **关系理解题**：给出 A/B，让用户选/填关系谓词；
  - **方向判断题**：给 A→B，判断方向是否正确/属于哪类；
  - **证据配对题**：给关系，选支持它的原文句。
  - 记录建议：`quizzes` 增加 `edge_id` 或新表 `relation_quizzes`；attempts 复用（按 quiz_id）；tier 仍只算节点（或新增关系 tier，待定）。
- 【功能需求】题目必须：① 有证据依据（不得编造）；② 生成幂等/可重生成（md 改了要能重出）；③ 答案不泄漏主 API；④ 判题失败可见；⑤ 与副本解锁的关系明确（目前副本题不改变节点 tier，构建状态只看节点 tier）。

### 5.3 记录的主要内容（审计与回溯）

| 记录 | 现有 | 建议补充 |
|---|---|---|
| 语音/文字来源 | `source_spans`（text/revision/created_at） | 探索来源也写 source_span；记录触发方式/轮次 |
| 线本身 | edges（kind/label/md/evidence/confidence/origin/claim_status/revision） | 写入者/轮次/校验结果/探索事务 id；状态变更日志（可选） |
| 方向 | directions（question/reason/target_hint/status/created_at） | angle/score/round/consumed_at |
| 建议接受 | 直接 UPDATE | 记录“谁接受/是否用户编辑/是否自动升级”（审计） |
| 出题/答题 | quizzes/attempts | 关系题记录；重生成记录；判题来源（LLM/mock） |
| 评测 | `server/eval` 12 例 | 线型/证据/方向/meaningfulness 的 gold+负例集 |

### 5.4 功能需求清单（FR，草稿）

- **FR-1 关系可读**：正式/来源线可见名称/证据/来源（D1）；
- **FR-2 建议确认**：建议卡→接受/忽略；接受后名称可见、用户编辑保留（D4/R5）；
- **FR-3 方向卡与探索**：方向线/问号→方向卡→探索→结果→落图/保留（D5/D11/D12）；
- **FR-4 4 方向**：每节点保证 4 条（D5/D13），刷新/去重/历史；
- **FR-5 来源追溯**：来源线可点、显示原句/轮次/触发方式（D2）；
- **FR-6 关系校验**：证据/蕴含/本体/分档（R4/S3）；
- **FR-7 线型视觉**：四类线可分辨（D7）；
- **FR-8 关系题/节点题**：题目生成/幂等/不泄漏/判题可见（D14）；
- **FR-9 状态与删除**：不可删除下的修正/归档（D8）；
- **FR-10 性能与降级**：探索异步/可取消/失败保留；4 方向不阻塞语音（§1.1）。

---

## 6. 风险与“不要做”汇总（设计评审用）

1. **同步叠加 LLM**：在语音 segment/commit 里做校验/方向/探索 → 破坏当前语音体验（必须异步/懒触发）。
2. **建议复用 suggest+origin=stream** → commit 自动转 formal，建议线失控。
3. **4 方向实时全量 LLM** → N 节点 × 调用，成本/延迟不可控；必须批量/懒/模板兜底。
4. **改 formal 的 label 语法/语义** → 副本检测（kindOf/过程词）失灵；不要把探索语义塞进 formal。
5. **把方向线接入 frontier/副本检测** → 改变现有地图/副本行为；需单独评审 03。
6. **无证据关系进入 formal** → 知识可信度崩；必须走校验与分档。
7. **新增 DB 字段不迁移** → 现有 03/导出/前端会坏；先评审迁移脚本。
8. **每新增节点全局重排** → 破坏空间记忆（`03 §8`/`placement.ts`）；只能增量放置/局部松弛。
9. **4 方向全量 HTML 标签渲染** → 性能/DOM 压力；需裁剪/只渲染 frontier/展开式。
10. **探索失败当成成功** → 必须保留方向、明确提示、可重试。

---

## 7. 分阶段落地建议（草稿，不是排期承诺）

| 阶段 | 内容 | 验证 |
|---|---|---|
| P0 规格确认 | 拍板 D1–D14；写“线的设计规格 v1”（本稿升级） | 你确认 |
| P1 后端能力 | 关系校验（证据/本体/分档）+ 4 方向生成（批量/模板）+ 探索 preview/commit API + 事务 | `server/eval` 扩集 + API 测试 |
| P2 用户端最小闭环 | 方向卡→探索→结果→落图；来源线/正式线可读；建议确认 | 浏览器 E2E（现有 `_verify` harness） |
| P3 完整交互 | 4 方向展示/刷新、四种线视觉、关系编辑/修正、MD 结构 | 截图/回归 |
| P4 题目与审计 | 关系题（若做）、记录/日志、评测扩展 | gold+负例集 |

---

## 8. 附录：证据与参考

- 受约束的代码：`server/src/stream/session.ts:122-277`、`server/src/db.ts:359-416/510+`、`server/src/index.ts:75-107/417-457/808/901-967/1306+`、`server/src/dungeons.ts:11/154-184`、`server/src/placement.ts:13-94`、`server/src/layout.ts:14-60`、`web/src/components/World3D.tsx:16/366-385/557-586`。
- 审计证据：`_audit/relation.md`、`_audit/dungeon-generation.md`、`_audit/md-and-quiz.md`、`_audit/dungeon-play.md`、`_audit/REPORT.md`。
- 设计出处：`知识世界-MVP-模型与视觉决策建议.md` §3.4/§3.5/§3.5.1/§8.23；样片 `knowledge-world-visual-v1.0.html`、`prototype/knowledge-world-visual-v3.3-glb.html`。
- 外部参考（04 §3 已列）：[GraphRAG](https://github.com/microsoft/graphrag)、[LightRAG](https://github.com/HKUDS/LightRAG)、[Graphiti](https://github.com/getzep/graphiti)、[llm-graph-builder](https://github.com/neo4j-labs/llm-graph-builder)、[DeepKE](https://aclanthology.org/2022.emnlp-demos.10/)、[REBEL](https://aclanthology.org/2021.acl-long.17/)、[GLiNER](https://github.com/urchade/GLiNER)、[MiniCheck](https://aclanthology.org/2024.emnlp-main.499.pdf)、[AlignScore](https://aclanthology.org/2023.acl-long.634.pdf)、[SHACL](https://www.w3.org/TR/shacl/)、[Look before you hop](https://ar5iv.labs.arxiv.org/html/1910.03262)。

> 本稿所有“建议/候选/假设”都待你评审；确认后我再升级为设计规格并拆实现任务。
