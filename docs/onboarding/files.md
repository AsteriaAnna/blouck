# 文件说明

按“当前是否参与运行”分组。未列出的生成物（`node_modules/`、`data/*.db`）不进仓库。

## 根目录

| 文件 | 作用 |
| --- | --- |
| `README.md` | 项目入口，链接本目录 |
| `package.json` | pnpm 根脚本：dev/build/typecheck |
| `pnpm-workspace.yaml` | workspace：server、web |
| `pnpm-lock.yaml` | 依赖锁 |
| `.gitignore` | 忽略 data、node_modules 等 |

## docs/

| 文件 | 内容 |
| --- | --- |
| `docs/README.md` | 文档总索引 |
| `docs/onboarding/*` | **本说明，给无上下文 AI 的入口** |
| `docs/reference/product-baseline.md` | 产品/对象定义 |
| `docs/reference/algorithms.md` | 算法规则、节点/关系/方向/副本 |
| `docs/reference/external-research.md` | 外部参考，非实现承诺 |
| `docs/design/requirements.md` | 需求基线 |
| `docs/design/current-state.md` | 当前实现与对标审计 |
| `docs/design/problems-and-approaches.md` | 问题与方案索引（第 7 节起已拆到 streaming/） |
| `docs/design/streaming/README.md` | 流式链路小文档索引 |
| `docs/design/streaming/asr.md` | ASR、hotwords、音频采集结论 |
| `docs/design/streaming/provisional.md` | provisional 状态/ID/坐标/commit |
| `docs/design/streaming/focus.md` | focus 栈、parent、指代 |
| `docs/design/streaming/relation-binding.md` | 关系绑定设计（9.3 是未确认草案，不是已实现） |
| `docs/design/streaming/issues.md` | 真实语音问题记录 |
| `docs/ops/runtime.md` | 运行/ASR/资源/评测说明 |
| `docs/screenshots/*.png` | 历史界面截图 |

## server/src/

| 文件 | 内容 |
| --- | --- |
| `env.ts` | 环境变量、provider 选择 |
| `db.ts` | schema、迁移、节点/关系/建筑/题目/方向/focus_stack 查询 |
| `index.ts` | Express REST + `/ws/asr`；文字 `/extract` 与语音 `/stream/*` |
| `stream/session.ts` | **语音建图核心**：provisional、focus、parent、关系、commit |
| `providers/types.ts` | LLM/ASR 接口、ASREvents/ASROptions |
| `providers/deepseek.ts` | DeepSeek Chat Completions 实现 |
| `providers/doubao.ts` | 豆包 ASR 二进制 WebSocket 实现 |
| `providers/mock.ts` | mock LLM/ASR，无 key 时使用 |
| `anchorFirst.ts` | 早期 anchor-first 实验代码，不是当前语音主链路 |
| `dungeons.ts` | 流程/领域副本检测与校验 |
| `placement.ts` | `placeAround` 节点放置 |
| `layout.ts` | elk 全局布局 |
| `wfc.ts` | WFC 岛屿布局 |
| `assetops.ts` | 建筑坐标、方向 frontier、隐藏/撤回、导出 |
| `explore.ts` | 探索模拟 |

## server/eval/

| 文件 | 内容 |
| --- | --- |
| `run.ts` | 抽取评测入口（mock/API） |
| `cases.json` | 评测输入 |
| `dungeons.ts` | 副本检测评测 |
| `minimal-stream.ts` | 内存最小流式建图测试 |
| `minimal-stream-report.txt` | 该测试报告 |
| `stream-voice-binding.ts` | 真实 `/ws/asr` + WAV 的语音关系绑定脚本 |
| `stream-voice-binding-report.txt` | 最近输出 |
| `stream-voice-binding-summary.md` | 语音测试总结 |
| `voice-test.wav` | 16k 测试音频 |
| `report-*.json/md` | 历史评测报告 |

## web/src/

| 文件 | 内容 |
| --- | --- |
| `main.tsx` | React 入口 |
| `App.tsx` | 路由/页面壳 |
| `api.ts` | REST 类型与 fetch 封装；NodeRow 含 status |
| `store.ts` | Zustand：世界、节点、边、focus、stream、`ingestSegment`/`commitStream` |
| `models3d.ts` | 3D 模型/资源映射 |
| `styles.css` | 通用样式 |
| `styles3d.css` | 3D 标签/地图样式，含 provisional 虚线 |
| `components/Home.tsx` | 世界列表/新建 |
| `components/World.tsx` | 世界主页面 |
| `components/World3D.tsx` | 3D 地图、节点/关系/建筑渲染、provisional 标签 |
| `components/InputBar.tsx` | 麦克风、Worklet、ASR WS、segment/commit、keepalive/重连 |
| `components/NodeDrawer.tsx` | 节点 MD/题库/进度 |
| `components/RelationDrawer.tsx` | 关系详情/接受建议 |
| `components/BuildingDrawer.tsx` | 副本挑战 |

## web 其他

| 文件 | 内容 |
| --- | --- |
| `index.html` | Vite HTML 壳 |
| `vite.config.ts` | 5173 端口、`/api` `/ws` 代理 |
| `package.json` / `tsconfig.json` | 前端依赖与 TS 配置 |
| `public/mic-test.html` | **独立麦克风/ASR 自检页**，不走图谱/LLM |
| `public/assets3d/manifest.json` | GLB 岛屿 ID/层级/文件映射 |
| `public/assets3d/*.glb` | 21 个岛屿 + 2 个副本门模型，按 manifest 使用 |

## prototype/

早期 3D HTML 原型和资产生成脚本，**不参与当前运行**：

- `knowledge-world-visual-v3.3-glb.html`：原型页面；
- `tools/*`：Three.js/GLTFLoader、Blender/HTML 构建、补丁、测试脚本；
- 不要把这些脚本当成服务端/前端运行时逻辑。

## 不纳入

- `node_modules/`；
- `server/data/*.db`（本地 SQLite）；
- 生成缓存、临时 WAV、截图之外的构建产物。


## 附录：3D 资产逐文件

`web/public/assets3d/`：

```text
manifest.json
gate_domain.glb
gate_flow.glb
island_agent.glb
island_bm25.glb
island_chunking.glb
island_clean.glb
island_ctx.glb
island_docparse.glb
island_embedding.glb
island_eval.glb
island_finetune.glb
island_generation.glb
island_hallucination.glb
island_kg.glb
island_longctx.glb
island_multimodal.glb
island_prompt.glb
island_qa.glb
island_rag.glb
island_recall.glb
island_retrieval.glb
island_vectordb.glb
island_workflow.glb
```

每个 GLB 是一个节点/副本门的 3D 模型；`manifest.json` 决定 id、tier、landmark、palette 和文件映射。

## 附录：prototype/tools 逐文件

这些是早期原型脚本，**不参与运行**：

```text
BufferGeometryUtils.js
BufferGeometryUtils147.js
GLTFLoader.js
GLTFLoader147.js
three.module.js
three147.min.js
build_assets.py
build_html.py
make_test.py
patch_blender.py
patch_builder.py
patch_builder2.py
patch_buildings.py
patch_edges.py
patch_names.py
patch_visuals.py
test_export.py
```

`prototype/knowledge-world-visual-v3.3-glb.html` 是原型页面。

## 附录：eval 报告文件

```text
report-deepseek.json
report-deepseek.md
report-dungeons.md
report-mock.json
report-mock.md
```

这些是历史评测输出，不代表当前代码的实时结果；需要重跑才能作为验收依据。
