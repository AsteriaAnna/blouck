# 3D 资产与原型

这些资产已经**纳入仓库管理**，不再依赖本地 `旅途/_assets` 目录或每次重新生成 Blender 脚本。

## 目录

```
web/public/assets3d/          运行时加载的 GLB（Vite 直接 /assets3d/... 访问）
  island_*.glb                21 个浮岛（平台 + 地标）
  gate_domain.glb             领域副本入口
  gate_flow.glb               流程副本入口
  manifest.json               资产清单（id / tier / landmark / palette / file）

prototype/
  knowledge-world-visual-v3.3-glb.html   正式开发前的 3D 原型（参考用，含内嵌模型）
  tools/                                 生成资产的 Blender 脚本
```

## 节点 → 模型

`web/src/models3d.ts`：

- 先按节点名关键词匹配（向量数据库→vectordb、Embedding→embedding、幻觉→hallucination…）；
- 匹配不到时，用节点 id 哈希从 21 个岛里稳定取一个；
- 副本：领域 → `gate_domain.glb`，流程 → `gate_flow.glb`。

## 加载与归一化

`web/src/components/World3D.tsx` 的 `Model`：

1. `useGLTF` 加载（drei 内部有缓存，同一模型只下载一次）；
2. 克隆场景，计算包围盒；
3. 按 `min(120 / 最大占地, 135 / 高度)` 缩放，避免高塔型岛体过大；
4. 底部对齐 `y=0`、水平居中；
5. 按节点调色板把材质色向暖色 lerp 0.42，区分不同节点。

## 重新生成资产

`prototype/tools/build_assets.py` 需要本机 Blender 4.2：

```bash
blender -b -P prototype/tools/build_assets.py -- <输出目录>
```

生成后把 GLB 与 manifest 覆盖到 `web/public/assets3d/`，提交即可。
