# 04 · 使用问题与探索记录

> **定位**：这是“过程文档”，记录在某一版基线之上提出的使用问题、思考路径、备选方案与采纳/实施情况；**它不是实现依据**。实现事实仍以 [03-implemented.md](03-implemented.md) 和源码为准。
> 方案一旦落地：更新本文对应条目的「4. 采纳与实施情况」，并把稳定的行为结论回写 `03`。

- 记录格式（每条问题都按四段写）：
  1. **发现的体验问题以及和需求的冲突**；
  2. **思考过程以及提出的最终问题可能是什么**；
  3. **解决方案可能可以参考的资料以及备选解决方案**；
  4. **解决方案的采纳和实施情况**。
- 状态图例：`待决策` / `已采纳-未实施` / `实施中` / `已实施` / `已放弃` / `已回滚`。
- 基线标注：条目会写明“基于哪版基线、什么证据”。

## 条目索引

| # | 主题 | 提出日期 | 基线 | 状态 | 证据 |
|---|---|---|---|---|---|
| 001 | 关系的实施方式 | 2026-11-16 | `d768326`（+ 同轮只读审计） | 待决策 | `_audit/relation.md`、`_audit/REPORT.md` §2 |

---

## 001 · 关系的实施方式

- 提出：2026-11-16
- 基线：语音/焦点/相机修复提交 `d768326` 之后的工作区（该轮只读审计，未改代码）
- 证据：`_audit/relation.md`（173 行详报）、`_audit/REPORT.md` §2；本文代码引用都指向该基线。

### 0. 先确认“现在到底是什么样”（避免把设想当事实）

- **数据层可用**：真实 `/extract` 一次产生 13 节点 / 23 边；四类 `kind`（formal / source / suggest / direction）全部真实出现；`predicate` 六值（kindOf/partOf/prerequisite/contrast/alternative/related）齐全；多轮 extract/segment/commit/手动连线之后 `(src,dst,kind,predicate)` 重复组 = 0；suggest→formal 有 stream commit 与 accept 两条路径；direction 的 consume 后 DB 与 UI 一致。
- **入口层不完整**：3D 里只有 `direction` 与 `suggest`（且 label 非空）会画可点的“路牌”（`World3D.tsx:383-385`、`:600`），`formal`/`source` 只有线和箭头、**没有点击入口**（`Edge` 组件 `World3D.tsx:329-371` 的 Line/cone 无 onPointerDown）；`NodeDrawer` 的“关系定位”是纯文本列表且过滤掉 `source`（`NodeDrawer.tsx:131-157`，过滤在 `:135-136`、`:144-145`）。
- **可编辑性**：`PATCH /api/edges/:id`（`index.ts:970-979`）与 `RelationDrawer` 的 MD 编辑器（`RelationDrawer.tsx:47-58`、`:136-165`）都存在，但抽屉只能通过“点路牌 → `openEdge`”（`store.ts:204`）打开，因此**只在 suggest/direction 阶段可达**。
- **生命周期**：suggest→formal 迁移由 `POST /api/edges/:id/accept` 完成（`index.ts:901-927`）；`direction` 由 `POST /api/edges/:id/consume` 消费（`index.ts:1306+`）；**没有删除关系的路由/UI**；accept 之后没有重算 frontier/方向线。
- **字段现状**：`claim_status` 只被读取一次（`index.ts:762` 的 disputed→stale 分支），全仓库没有写入点，实际恒为 `normal`；`revision` 只在 `edges` 表/`EdgeRow` 里定义（`db.ts:51-52/107/166-167`），没有任何读写；`confidence/evidence/frontier_x/frontier_y` 有真实行为。

### 1. 发现的体验问题以及和需求的冲突

- **1.1【P1】正式关系“看得见、点不开、改不了”**：用户在地图上看到一条实线（formal），但点线/箭头没有反应；唯一的编辑入口（RelationDrawer 的“关系 MD（可编辑）”）只对虚线建议开放。结果是**知识最终形态（正式关系）无法补依据、改名字、改谓词**。
- **1.2【P1】accept 会覆盖用户刚写的内容**：用户在 suggest 阶段先保存 label/md，再点“接受为正式关系”时，后端无条件用 LLM 结果 UPDATE（`index.ts:916-922`），用户内容被静默替换；而 UI 把“保存”和“接受”并排（`RelationDrawer.tsx:145-158`），很容易踩。
- **1.3【P1/P2】没有删除关系的能力**：误连、过时、错方向的关系只能永久留在地图上；没有 DELETE 路由、没有 UI，也没有“归档/否定”语义。
- **1.4【P2】accept 后地图不同步**：accept 只改边的 kind/字段，没有调用 `computeFrontier`/`materializeDirectionEdges`；实测节点 frontier 仍为 1、方向线仍渲染，直到下一次 extract 才恢复。
- **1.5【P2】手动连线缺方向归一与证据**：`POST /api/worlds/:id/relations`（`index.ts:930-967`）不校验方向，也不自动补 evidence；实测可以造出 `partOf` 方向相反的关系（“反向传播 --partOf--> 模型压缩”），与关系方向约定冲突。
- **1.6【P2/P3】`source` 边（探索来源）在 UI 完全不可见**：实测约占边的 40%，NodeDrawer 过滤、3D 不画路牌，用户不知道某个节点“从哪句话来”。
- **1.7【P2/P3】字段承诺大于实现**：`claim_status`/`revision` 在 `03` 里被列为 edges 关键字段，但实际无行为；`disputed→stale` 分支永远不可达，容易被误以为“关系争议/版本”已支持。
- **1.8【P3】方向探索上下文可能错**：`RelationDrawer` 的“按这个方向探索”走 `extract(text)`，用的是 `store.focusId` 而不是 `edge.src` 作为起点（`RelationDrawer.tsx:60-74`，`store.ts:234-243`），可能把新知识挂到当前焦点而不是这条方向线的起点。
- **1.9【P3】保存反馈不实**：`RelationDrawer.save()` 不检查 `res.ok` 却始终 toast「已保存」（`RelationDrawer.tsx:47-58`）；`store.acceptEdge` 失败也没有 toast/回滚。

**与需求的冲突（需求来源：`03` 的已实现声明 + `01` 的产品方向 + 现有 UI 自身给出的承诺）：**

- `03 §7` 声明四类关系与 suggest→formal 均“已实现”，UI 也确实提供了“关系 MD（可编辑）”按钮；但正式关系实际不可达 → **文档/UI 承诺与实现冲突**。
- `01` 的产品方向是“知识可编辑、关系要能连到已有节点并可修正”；但语音链路 `/stream/commit` 会把**全部** stream suggest 升级为 formal（`db.ts` `commitStreamEdges`），等于语音产出的关系天然全部落在“不可编辑态” → **语音链路与关系编辑体验的结构性断点**。
- `02 §6` 曾设想完整关系生命周期（candidate/suggest/formal、冲突 disputed/revised、同一对节点最多 2 谓词），但明确标注“没有进当前实现”；当前 UI 文案「正式关系不可删除」沿用了“关系=不可变”的早期假设，与“知识可编辑”的需求冲突。
- 关系方向明明有约定（kindOf 具体→上位、partOf 部分→整体、prerequisite 前置→后续……，见 `03 §7`），但手动连线不遵守、UI 也不提示 → **约定只对 LLM 生效，对用户操作不生效**。

### 2. 思考过程以及提出的最终问题可能是什么

- **2.1 先追问“为什么 formal 点不开”**：不是产品决定隐藏，而是早期“虚线=待确认 / 实线=已确认、不用再管”的交互假设留下的实现：只有“待确认”的关系需要路牌，实线只负责表达连接。代码证据：`SignPost` 只在 `direction|suggest` 时渲染；`Edge` 的线/箭头没有点击处理；抽屉只能由路牌触发。
- **2.2 找出这个假设在什么场景下崩塌**：① 语音链路 commit 后所有关系都变 formal（用户说完就失去编辑入口）；② 用户想给关系补依据/改谓词（“它其实不是 partOf 而是 kindOf”）；③ 误连/过时关系；④ 同一对节点关系多，想比较/整理；⑤ 想追溯“这条关系是从哪句话来的”（source 边不可见）。
- **2.3 顺藤摸到的次生问题**：编辑入口缺失 → 用户会先“保存草稿”再接受 → 撞上 accept 覆盖；没有删除 → 错误关系永久污染地图；accept 不重算 → 地图表现滞后；手动连线不走同一套方向/证据规则 → 关系质量分裂。
- **2.4 提炼出的“最终问题”**（需要产品/需求侧拍板的 5 个问题；先答前两个，因为决定数据模型）：
  - **Q1（一等公民）**：正式关系（formal/source）是否和节点一样是一等可编辑对象？还是“AI 生成后不可改、只能新建议覆盖”？
  - **Q2（删除语义）**：删除关系是物理删除、软删除/归档（需要新字段），还是只允许删除“用户手动关系”、AI 关系只允许“否定/降级”（配合 `claim_status`）？
  - **Q3（入口位置）**：点开关系的入口放哪——3D 线/箭头热区、线中点的小标签、NodeDrawer 的“关系定位”每行、还是世界级“关系中心”列表？
  - **Q4（accept 冲突仲裁）**：accept 与用户编辑冲突时，用户优先（只补空字段）、覆盖前 diff 确认、还是合并策略？
  - **Q5（字段去留）**：`claim_status`/`revision` 是实现“争议/修订”生命周期（`02 §6` 草案），还是从 `03` 的“关键字段”里删掉、降级为未用列？
- **2.5 先把“问题”和“方案”分开**：本节只确认问题与需要拍板的点；具体候选方案见第 3 节，不把方案当需求。

### 3. 解决方案可能可以参考的资料以及备选解决方案

#### 3.1 仓库内资料（权威优先级最高）

- `03-implemented.md` §7（关系当前范围）、§9（文字链路的方向归一规则：`index.ts:324` prerequisite 按证据先后交换、`:328` partOf 按“组成/包含/由”翻向）——手动连线可以复用同一套规则。
- `02-reasoning.md §6`（关系生命周期草案：稳定关系 ID、candidate/suggest/formal、disputed/revised、同对最多 2 谓词）——**历史记录，只能当设计输入，不能当需求**。
- `_audit/relation.md`（本轮实测：哪些能用、哪些不可达、字段真实使用、复现命令）。
- 代码：`World3D.tsx`（Edge/SignPost 渲染）、`RelationDrawer.tsx`、`NodeDrawer.tsx`（手动关联 + 关系定位）、`index.ts:901-979/1306+`（accept/PATCH/consume/relations）、`db.ts` edges schema、`store.ts`（openEdge/acceptEdge/extract）。

#### 3.2 仓库外可参考的同类交互（只作启发，不是本仓库事实）

- 图/知识图谱浏览器（如 Neo4j Browser / Bloom 的“点边 → 属性面板编辑”）——借“边即对象、点开是属性面板”的交互；
- 双向链接笔记（Obsidian / Logseq / Roam）——借“链接可编辑、可重命名、可断开、可看到反向引用”的习惯；
- 属性图/边属性模型——借“关系可以有类型/证据/置信度/状态”的数据建模，但**不要**因此引入图数据库，本项目仍是 SQLite 行 + JSON 字段；
- 常见“软删除/归档 + 撤销”模式——借删除语义（`archived` 标记、可恢复），但要注意本项目当前 edges 表没有该列，加列属于契约变更，需单独评审。

#### 3.3 备选方案（供决策，不是已采纳）

| 方案 | 做法 | 改动面 | 优点 | 缺点/风险 |
|---|---|---|---|---|
| **A. 最小入口补齐** | 给 formal/source 一条可点路径：线中点加可点小标签/圆点，或给箭头/线加 pointer 事件，点开现有 RelationDrawer；抽屉标题区分 kind | `World3D.tsx` + 可能 `styles3d.css`；不改 API/DB | 改动最小；复用现有抽屉；立刻让 PATCH/accept 产出的 md 有地方看 | 3D 线很细，命中率与遮挡要调；关系多时视觉变密 |
| **B. 关系行可点（NodeDrawer）** | 在节点抽屉“关系定位”每行加“查看/编辑/删除”入口，点击打开边抽屉（不依赖 3D 命中） | `NodeDrawer.tsx`、`store.ts`、`RelationDrawer.tsx` | 命中稳定、移动/小屏友好；顺势补 source 边展示 | 需要进抽屉两级；3D 仍是“不可点” |
| **C. 世界级关系中心** | 顶部加“关系”入口：列表/过滤（kind/predicate/confidence）/批量整理/删除，3D 只负责定位 | 新组件 + store + 可能新 API | 关系多时可管理、可审计 | 成本最高；MVP 可能不需要 |
| **D. 完整关系生命周期** | 实现 `02 §6` 草案：candidate/suggest/formal/archived + disputed/revision + 同对谓词约束 + 冲突 UI | DB 迁移 + API + 多处 UI + 验收 | 语义最完整，支持争议/修订 | 超出当前 MVP；改动大、风险高，建议后置 |

- **accept 冲突的子方案**：
  - A1 用户优先：accept 只补空字段（label/md 为空才用 LLM）；
  - A2 覆盖前确认：先展示 diff，让用户选“保留我的/用 AI 的”；
  - A3 合并：保留用户 label/md，LLM 只补 predicate/evidence（默认推荐 A1，成本最低）。
- **删除的子方案**：物理删除（最简单，但不可恢复）；软删除/归档（需给 edges 加 `archived` 或复用 `claim_status='archived'`，注意契约）；**仅允许删除 manual 关系**（`origin='manual'`），AI 关系只允许“否定/降级”（与 Q5 绑定）。
- **方向归一子方案**：把 `extract` 已有的 prerequisite/partOf 归一逻辑抽成函数，在 `/relations` 与 accept 路径复用；UI 在手动连线时把方向约定直接写在选项文案里（已有雏形）。
- **入口实现细节备选**：线中点小标签（可读性好）/ 箭头可点（面积小）/ 线整体加粗命中（性能与视觉权衡）/ 仅 NodeDrawer 行（B）。

#### 3.4 给决策的初步倾向（Lead 建议，未采纳）

1. 先做 **A + B 的组合**：NodeDrawer 关系行先可点（稳、覆盖 source），3D 同时补最小入口（线中点标签）；不改 API/DB，风险最低。
2. accept 冲突取 **A1（用户优先，只补空）**；同时 accept 后补 `computeFrontier + materializeDirectionEdges`。
3. 删除先做 **“仅 manual 关系物理/软删”** 的小口子，AI 关系的“否定/降级”留到 Q5 决策后再定。
4. 方向归一直接复用 `extract` 的归一函数；证据可空但 UI 提示“缺证据”。
5. C（关系中心）与 D（生命周期）建议等关系规模/争议需求上来后再评估，不放进本轮。

### 4. 解决方案的采纳和实施情况

- **当前状态：`待决策`（未采纳、未实施）。** 本轮是只读审计：仓库 HEAD = `d768326`，`git status` 干净；本文只写入 `docs/04-problems.md`（+ 文档索引），没有改关系相关代码。
- **已确认的硬约束（无论选哪个方案都要守）**：
  1. 不破坏语音链路 `suggest→formal` 语义与幂等（`commitStreamEdges` 的条件：`origin='stream' AND kind='suggest' AND evidence<>''`）；
  2. 不随意改 DB 字段：若做软删/归档需要新列（或新状态值），必须先单独评审并回写 `03`；
  3. 3D 入口改动不得影响节点点击、相机 fit、性能；
  4. 任何改动都要过 `pnpm typecheck` + `pnpm build` + 浏览器验收（点开 formal 边 → 改 md → 刷新仍可见；accept 不丢用户内容；删除/归档后地图与抽屉一致）。
- **待用户决策的问题**：见 §2.4 的 Q1-Q5（优先 Q1/Q2）。
- **采纳记录（留空，决策后填）**：

  | 日期 | 决策 | 决策人 | 理由 | 关联 commit / 验收证据 |
  |---|---|---|---|---|
  | — | 待定 | — | — | — |

- **后续更新规则**：方案实施后，把本条目状态改为 `已采纳-未实施 / 实施中 / 已实施`，补上 commit 与验收证据；稳定行为（入口位置、删除语义、accept 策略、字段去留）回写 `03-implemented.md`，并把本条目「4」改为“实施结果 + 遗留”。
