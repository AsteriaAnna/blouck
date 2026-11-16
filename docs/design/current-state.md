# 当前状态

最后更新：2026-11-16

这份文档回答：**代码现在做到哪、卡在哪、下一步试什么。**

---

## 1. 当前可用

### 前端

- 首页：世界列表 + 新建世界；
- 世界页：3D 地图、节点/关系/副本抽屉、底部输入台；
- 输入台：
  - 文字提交；
  - 真实麦克风（`/ws/asr`，豆包 ASR）；
  - 试听（mock ASR）；
- 流式状态：`聆听 → 检测 → 确认 → 生成`；
- partial 字幕、已有节点高亮、候选 ghost；
- 新节点从 ghost 位置起飞到最终布局；
- 节点三档、关系抽屉、副本挑战。

### 后端

- `/api/worlds/:id/extract`：现有落图链路（抽取/关系/方向/副本）；
- `/api/worlds/:id/stream/detect`：只抽候选，不落图（流式 ghost 用）；
- `/api/worlds/:id/stream/preview`：锚点优先完整决策，不落图（未接前端）；
- `/api/dev/anchor-first`：dev 原型（A 方案）；
- 评测脚本 `server/eval`。

---

## 2. 当前流式链路

```text
点麦克风/试听
  → /ws/asr partial
  → 本地 mention 匹配（已有节点高亮）
  → 每增长 6 字符：/stream/detect（候选 ghost，合并）
  → final：先全量 /stream/detect，再 /extract
  → extract 返回：新节点按名字/别名匹配 ghost
  → 从候选位置起飞，1.2s 落到最终位置
  → 相机延迟 1s fit
```

截图：[ghost](../screenshots/stream-ghost-ok.png)、[起飞](../screenshots/stream-spawn.png)、[落位](../screenshots/stream-land.png)、[生成后](../screenshots/stream-generated-ok.png)。

---

## 3. 已实现 / 部分 / 没有

| 能力 | 状态 |
| --- | --- |
| 3D 地图、节点/关系/副本抽屉 | ✅ |
| 真实语音 WS + mock 试听 | ✅ |
| partial 字幕 + 已有节点高亮 | ✅ |
| 多步实体检测 + ghost 合并 | ✅ |
| final 全量补检 | ✅ |
| ghost → 节点起飞/落位动画 | ✅ |
| 新节点确认/拒绝 | ❌ |
| provisional 实体持久化 | ❌ |
| ghost 与 final 节点 reconciliation | ❌ |
| 逐词/逐实体提交 | ❌ |
| detect 与 extract 合并成一次 | ❌ |
| 刷新后保留 ghost | ❌ |
| 多锚点 | ❌ |
| 真机 ASR 延迟评测 | ⚠️ 未系统测 |

---

## 4. 当前卡点（按重要性）

1. **双链路不一致**：detect 是预览，extract 是最终；ghost 可能多/少，名字可能对不上。
2. **延迟**：final 全量 detect（1–2s）+ extract（3–5s）串行，端到端约 6–9s。
3. **ghost 不是权威状态**：没有 provisional 表，刷新即丢，不能确认/拒绝。
4. **没有 reconciliation**：候选 A 最终并到节点 B、候选消失、候选改名，都没有处理。
5. **多 ghost 布局**：固定锚点旁网格，候选多会重叠。

---

## 5. 下一步尝试（待产品拍板）

### 路线 A：保持预览型

- 只优化 detect/extract 合并与动画；
- 成本低；
- 接受 ghost 与最终节点不一致。

### 路线 B：统一 provisional 链路（推荐如果体验优先）

- detect 生成 provisional 实体（有 ID/状态）；
- final 确认同一批 provisional；
- commit 后 provisional 变正式节点；
- 失败/无关 → tombstone；
- 需要 provisional 表、revision、幂等、前端按 ID morph。

### 路线 C：真流式提交

- 稳定短语提交 provisional，ASR 修订时 merge/rename；
- 最难，ASR 不稳时会抖。

**当前没有选路线；A 是现状，B 是下一步候选。**

---

## 6. 本轮讨论中明确不做

- 不继续扩谓词本体（5 核心 + 自由标签为准）；
- 不强制节点类型；
- 不把 MD 能表达的细节图化；
- 不把过程/红队历史写进文档。

---

## 7. 相关文档

- [问题与处理](problems-and-approaches.md)
- [算法](../reference/algorithms.md)
- [需求](requirements.md)
- [产品基线](../reference/product-baseline.md)


---

## 8. 真实代码核对（2026-11-16）

针对"多跳节点全挂到同一节点"的问题，核对了 `server/src/index.ts` 与 `server/src/providers/deepseek.ts`：

| 位置 | 实际行为 | 后果 |
| --- | --- | --- |
| `/extract` 入口 | `focus = fromNodeId ?? root` | 一次抽取只有一个全局焦点 |
| LLM prompt | 只给"当前节点 + 已有概念 + 文本" | 没有"这句话里谁接谁/父节点链"字段 |
| 关系解析 | `source = rel.source || focus` | 模型没写 source 时，所有关系默认挂当前节点 |
| 节点位置 | `placeAround(..., focus)` | 新节点全部围绕该焦点摆放 |
| 来源线 | 统一 `focus → new node`，并有孤岛禁令兜底 | 多跳节点也挂到初始节点 |
| 前端 focusId | 抽取后只更新 nodes/edges，不随新节点推进 | 连续说话时焦点仍是初始节点 |
| 流式 | detect 与 extract 两套结果，ghost 按名字匹配 | ghost 与最终节点没有同一 ID/父节点 |

**结论：当前实现不是"多跳理解失败"，而是数据模型里没有"这段话的当前父节点"这个概念，程序只能用全局 focus 兜底。** 详细分析见 [problems-and-approaches.md](problems-and-approaches.md) 第 6 节。

### 当前应优先验证的假设

1. 引入"焦点栈/父节点"后，1→2→3 是否能正确挂到 2 而不是 1；
2. 关系候选扩大到"同句新节点 + 已有节点"后，2/3 是否不再全部依赖 1；
3. provisional 实体（同一 ID）是否能同时解决 ghost 速度与衔接；
4. 本地 mention 检测 + 异步验证能否把首次可见反应压到 1s 内。


### 8.1 多焦点反例（RAG 分支）

用户给出的真实路径：

```text
RAG → 检索 → 语义检索/向量检索/混合检索
    → 回到增强生成 → 召回条数/Re-ranking/Top K → 召回率
```

当前系统无法表达，因为：

- 只有一个 `focus`；
- 没有 focus stack；
- 没有"每个新节点从上一级哪个节点延伸"的字段；
- 没有局部父链，只有全局 focus。

**这不是"焦点偶尔错"，是架构上不支持多焦点。**

### 8.2 参考结论

- 实时语音→图有演示（IJCAI 2020），但只到关键词图；
- 对话建图难点是回指/话题切换/跨轮上下文（RPI 综述）；
- 多焦点需要经典话语焦点栈/注意力状态；
- 流式演化需要独立状态与修订机制（LiveGraph 方向）；
- 没有现成"教学语义 + 多焦点 + provisional"系统。

因此这不是 prompt 或 Ghost 能修的；需要换状态模型。详见 [problems-and-approaches.md](problems-and-approaches.md) 第 6 节。
