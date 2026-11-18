# 空壳/先画后判机制审计（2026-11-18）

> 审计对象：所有会“生成内容给用户看”的机制，不只关系线。
> 判定问题：是否**先有可靠输入/判定，再展示**；是否有证据；是否把回退文本当事实；是否点击后才生成答案。
> 状态：✅ 已修；🟡 部分/有门但仍不足；⬜ 未修/仍是空壳。

## 0. 总原则

用户看到的内容必须满足：

```text
有输入（原文/已验证关系）
→ 有判定（类型/方向/结论）
→ 有证据（可回指原文）
→ 再展示
```

禁止：

```text
先展示占位/预测
→ 用户点击
→ 才生成答案
→ 回退成“相关/未说明/示例”
```

## 1. 知识抽取与候选

| 机制 | 应该怎样 | 现在实际 | 问题 | 状态 |
|---|---|---|---|---|
| 实体抽取 | 实体必须有 evidence；无证据不建节点 | `graph.ts` 检查 evidence；无 semantic relation 进候选 | 与关系脱节：节点可因 semanticNames 被建，但对应关系可能因证据不足被丢弃，留下孤立节点 | 🟡 |
| 关系抽取 | 先验证再建线 | 抽取 LLM 一次给 `type/predicate`；新增“evidence 必须同时包含两端”；不再自动 suggest→formal | **没有独立 verify 步骤**；predicate 仍是抽取阶段猜测；suggest 理由未结构化 | 🟡 |
| 无证据建议 | 不建线/只后台候选 | `accept` 无 evidence 400；手动无证据为 suggest | 抽取阶段仍可能建“有 evidence 但语义不足”的 suggest | 🟡 |
| 候选确认 | 确认前验证关系与来源 | 现在要求 candidate.evidence 非空，否则 400；节点尝试挂回 source_span | 已去掉 `"用户确认候选"` 假证据；若证据找不到对应 source_span，节点仍只能草稿 | ✅/🟡 |
| 方向 | 先规划目标再展示 | `directionPlans` 生成 4 条；地图显示 2 条 | 方向本身是问题，允许没有关系；但目标预览/why 不是所有旧数据都有 | 🟡 |
| 提示线 | 必须先有关系判定和理由 | 抽取建议 + hint score；接受有门 | 仍可能只有“可能相关”的 label/evidence，没有具体 reason | 🟡 |

## 2. 卡片/MD

| 机制 | 应该怎样 | 现在实际 | 问题 | 状态 |
|---|---|---|---|---|
| 节点卡 | 打开前已生成或显示“生成中”；无来源草稿标记 | `/api/nodes/:id/doc` GET 时 `ensureNodeDoc` 同步生成；无来源 fallback 定义/邻居 | 点击触发思考；无来源仍生成体系位置/边界（已加“草稿”提示） | 🟡 |
| 关系卡 | 判定时生成一句话/依据/边界/反例；点击只读 | `/api/edges/:id/doc` GET 时生成；失败 fallback `edge.label/related` | 关系卡仍可能由“label+neighbors”生成；无来源仅提示，不阻止 | 🟡 |
| 关系卡依据 | 必须先显示 evidence | 已加 `edge.evidence` 前置显示 | 旧数据 evidence 可能是模型说明（历史污染） | 🟡 |
| 节点定义 | 模板化、可检验 | 抽取定义原样使用；无定义质量闸 | “X 是一种 X”/同义反复仍可能进卡 | ⬜ |
| 副本 MD | 绑定成员/证据/关卡 | seed/LLM 写自由文本；无字段校验 | 副本 MD 是说明文，不是可靠内容 | 🟡 |

## 3. 题目

| 机制 | 应该怎样 | 现在实际 | 问题 | 状态 |
|---|---|---|---|---|
| 节点旧定义题 | 只作为复习；打开不生成 | `/api/nodes/:id/quiz` GET 原来会自动生成（已改为只读） | 以前打开节点就偷偷生成 15 道定义题；现在显式按钮才生成 | ✅/🟡 |
| 节点辨析 | 从来源+边界+近邻生成 | `ensureNodeUnderstandingTask` 需要 source_span；4 题型 | 生成时仍用通用 prompt；定义质量/误解来源未强制 | 🟡 |
| 关系辨析 | 从证据+误解/边界生成 | `ensureRelationUnderstandingTask` 需要 source；4 题型 | 关系判定本身不足；题目从关系文档而非 verifier 结论 | 🟡 |
| 题目生成时机 | 展示前预生成 | `GET /understanding` 在第一次点击时生成并缓存 | 点击才生成；不是老师先准备好 | ⬜ |
| 质量门 | 低分重写/降级 | 7 项审计 + <阈值重写 + 好差反馈 | 启发式；没有“可抄定义”的语义判定 | 🟡 |
| 领域每日题 | 从证据关系生成 | 仍用 definition 生成 10 题；但 submit 已改为 practice-only，不再 cleared | 题目仍是空壳；只保留“复习”语义，不能通关/升档 | 🟡 P1 |
| 领域判分 | 语义判分 | 60% 字符重合即可；`answer` 类型用 judge | 乱答可能通过；与理解无关 | ⬜ P0 |
| 流程题 | 顺序题 | challenge 打乱 steps；submit 完全匹配 | 只是排序小游戏；没有“为什么这个顺序”的题 | 🟡 |
| 副本辨析序列 | 预生成、按误解序列 | `GET /buildings/:id/sequence` 第一次点击生成各 variant | 点击才生成；题库/质量门可用，但不是预生成 | 🟡 |
| 旧 practice API | 不应保留生成路径 | `/api/edges/:id/practice` 仍会用通用 generateQuiz 生成 3 题 | 旧接口/旧 UI 已不用，但 API 仍是空壳入口 | ⬜ |

## 4. 副本/领域

| 机制 | 应该怎样 | 现在实际 | 问题 | 状态 |
|---|---|---|---|---|
| 领域发现 | kindOf/partOf + 共同上位 + 4–8 成员 + 证据覆盖 | 规则按 kindOf/partOf 分组；LLM 候选 + validate | 证据覆盖率未硬校验；LLM 候选仍可绕过关系判定 | 🟡 |
| 流程发现 | prerequisite/过程词 + 3–6 步 + 证据 + 唯一序 | 已优先 prerequisite + evidence；线性扩展唯一 | 规则候选用 label 兜底；LLM 候选仍可能弱 | 🟡 |
| 副本出现时机 | 节点/证据/frontier 门槛 | `dungeonReadiness` 已接 detect；demo fixture force | 生产 extract 已受门槛；demo seed 例外 | ✅/🟡 |
| 副本通关 | 全部辨析关卡答对 | 新序列如此；旧 domain/flow submit 已改为 practice-only，不再 cleared | 已消除“定义题/字符匹配通关”双路径 | ✅ |
| 副本 MD | 成员/顺序/证据 | 生成文本；成员/步骤在 steps 字段 | MD 不等于可核验依据 | 🟡 |
| 副本状态 | detected→playable→cleared | 依赖节点 tier；旧题可升 tier | 旧题与辨析双轨 | 🟡 |

## 5. 导航/地图

| 机制 | 应该怎样 | 现在实际 | 问题 | 状态 |
|---|---|---|---|---|
| 方向线 | 先规划目标再画 | 4 计划，地图 2；目标预览 | 旧方向可能只有问题没有目标 | 🟡 |
| 提示线 | 先判定理由再画 | hint_display 后端排序 | 旧提示可能无 reason/证据 | 🟡 |
| 线型 | canonical predicate/方向 | demo 已修；其他世界 predicate 为空/自由 label | 旧世界仍会默认 related | 🟡 |
| 四类线 | 点击结果可预期 | 已区分视觉/计数/披露 | 方向/提示旧数据仍可能空 | 🟡 |
| 指标 | 解释“学习发生了什么” | 当前/趋势/CSV/总览 | 指标不能区分“看地图”与“理解”；无质量/延迟保持 | 🟡 |

## 6. 数据/兼容/演示

| 机制 | 问题 | 状态 |
|---|---|---|
| demo 数据 | 已重建 12 节点/10 条证据关系；旧伪关系删除 | ✅ |
| 其他世界 | 仍有 401 条空证据 formal 边（历史实验） | ⬜ |
| 旧 quiz/tier | 旧定义题仍能升 tier；已不能通关 | 🟡 |
| `suggest` 状态 | 不是独立 hypothesis，只靠虚线/文案 | ⬜ |
| canonical 迁移 | formal/building 物理重命名未执行 | ⬜（已文档化） |
| 测试 fixture | dev fixture 直接建副本（force），不代表产品链路 | ✅ 已注明 |

## 7. 优先级（按“用户看到错误内容”的风险）

**P0（会让用户学到假东西）**

1. 领域每日题仍用 definition 生成、无证据；已停止用它通关，但内容仍是空壳 → 后续改由已验证关系题生成或下线。
2. ~~旧 `submit` 通关路径~~ ✅ 已改为 practice-only，仅辨析序列 cleared。
3. ~~候选确认假证据~~ ✅ 已要求 evidence + source_span。
4. 关系判定缺失：先 verify 再建线；至少不要抽取后直接 formal。
5. 节点/关系文档点击时生成 → 预生成或显示“生成中”，无来源只草稿。

**P1（内容空泛/重复）**

6. 节点定义模板/质量闸。
7. 题目从 verifier 的 misconception/confusable 派生。
8. 关系卡/节点卡无来源 fallback 清理。
9. 旧世界空证据边清理。
10. `suggest` 独立 hypothesis 状态。

**P2（体验/性能）**

11. 方向/提示旧数据预览。
12. 指标质量/延迟保持。
13. 旧 practice API 下线。

## 8. 代码定位

- `server/src/routes/graph.ts`：实体/关系/方向抽取；新增双端证据门。
- `server/src/routes/edges.ts`：accept/manual 关系；证据门。
- `server/src/routes/candidates.ts`：候选确认；已要求 evidence + 尝试 source_span。
- `server/src/routes/buildings.ts`：domain 每日题仍用 definition 生成；旧 submit 已 practice-only。
- `server/src/routes/nodes.ts`：旧题 GET 已改只读；显式生成仍 definition。
- `server/src/routes/buildings.ts`：domain 每日题生成/判分；旧 submit 通关。
- `server/src/services/contentDocs.ts`：节点/关系卡点击时生成 + fallback。
- `server/src/services/understanding.ts`：辨析题点击时生成；节点答对升 tier。
- `server/src/services/dungeonSequence.ts`：序列点击时生成。
- `server/src/dungeons.ts`：domain/flow 规则遍历。
- `server/src/services/buildings.ts`：readiness、detect。
- `web/src/components/RelationDrawer.tsx`：依据前置；无依据提示。
- `web/src/components/NodeDrawer.tsx`：无来源草稿提示；旧题复习模式。

## 9. 本轮只修了哪些

- ✅ 关系证据门、无证据 accept 400、手动关系假设化。
- ✅ demo 重建/伪关系清理。
- ✅ 副本 readiness 门槛。
- ✅ 关系卡依据前置、节点无来源提示、旧题 GET 不自动生成。
- ✅ 候选确认要求 evidence + 尝试 source_span；不再写“用户确认候选”假证据。
- ✅ 旧 domain/flow submit 改为 practice-only，只有辨析序列能 cleared。
- ⬜ 上表其余 P0/P1 未修；不能声称“全部完成”。
