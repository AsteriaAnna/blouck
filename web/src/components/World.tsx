import { useCallback, useEffect, useState } from "react";
import { useStore } from "../store";
import World3D from "./World3D";
import InputBar from "./InputBar";
import NodeDrawer from "./NodeDrawer";
import BuildingDrawer from "./BuildingDrawer";
import RelationDrawer from "./RelationDrawer";

/**
 * 世界页：只保留 3D 视图（2026-11-14 起 2D React Flow 视图已移除）。
 * 3D 负责渲染；抽屉、输入台、副本/关系编辑仍由 DOM 层负责。
 */
export default function World() {
  const world = useStore((s) => s.world);
  const nodes = useStore((s) => s.nodes);
  const edges = useStore((s) => s.edges);
  const buildings = useStore((s) => s.buildings);
  const drawer = useStore((s) => s.drawer);
  const backHome = useStore((s) => s.backHome);
  const [provider, setProvider] = useState("mock");

  useEffect(() => {
    fetch("/api/health")
      .then((r) => r.json())
      .then((h) => setProvider(`${h.providers.llmActive}/${h.providers.asrActive}`))
      .catch(() => setProvider("offline"));
  }, []);

  const undoHide = useCallback(async () => {
    if (!world) return;
    const r = await fetch(`/api/worlds/${world.id}/hide/undo`, { method: "POST" });
    const data = await r.json();
    if (!r.ok) {
      useStore.getState().showToast(data.error ?? "没有可撤回的隐藏");
      return;
    }
    await useStore.getState().openWorld(world.id);
    useStore.getState().showToast(`已撤回 ${data.count} 个节点的隐藏`);
  }, [world]);

  const exportWorld = useCallback(async () => {
    if (!world) return;
    const r = await fetch(`/api/worlds/${world.id}/export`);
    const data = await r.json();
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `knowledge-world-${world.name}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }, [world]);

  const relayout = useCallback(async () => {
    if (!world) return;
    await fetch(`/api/worlds/${world.id}/layout`, { method: "POST" });
    await useStore.getState().openWorld(world.id);
    useStore.getState().showToast("已用 WFC 重排布局");
  }, [world]);

  if (!world) return null;

  return (
    <>
      <div className="world">
        <div className="topbar">
          <button className="ghost-btn" onClick={backHome}>
            ← 世界列表
          </button>
          <div className="title">{world.name}</div>
          {world.is_demo ? <span className="badge">示例数据</span> : null}
          <span className="badge">{nodes.length} 节点</span>
          <span className="badge">{edges.length} 关系</span>
          <span className="badge">{buildings.length} 副本</span>
          <span className="badge">LLM/ASR: {provider}</span>
          <span className="badge">3D 视图</span>
          <button className="ghost-btn" onClick={relayout}>
            重排
          </button>
          <button className="ghost-btn" onClick={undoHide}>
            撤回隐藏
          </button>
          <button className="ghost-btn" onClick={exportWorld}>
            导出
          </button>
          <div className="spacer" />
          <span className="badge">拖拽旋转 · 滚轮缩放 · 点岛查看</span>
        </div>

        <div className="flow-wrap">
          <World3D />
          <div className="legend">
            <div><b>3D 视图</b></div>
            <div className="li">浮岛 = 知识节点；地标 = 节点类型</div>
            <div className="li">贴地曲线 = 关系；立体路牌 = 方向/建议</div>
            <div className="li">塔 = 领域副本；门 = 流程副本</div>
            <div style={{ marginTop: 6 }}><b>节点三档</b>：核心 → Ⅰ 环 → Ⅱ → Ⅲ 塔</div>
          </div>
          <InputBar />
        </div>

        {drawer?.kind === "node" && <NodeDrawer />}
        {drawer?.kind === "building" && <BuildingDrawer />}
        {drawer?.kind === "edge" && <RelationDrawer />}
      </div>
    </>
  );
}
