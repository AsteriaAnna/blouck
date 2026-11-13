import { useCallback, useEffect, useMemo, useState } from "react";
import { Background, Controls, ReactFlow, type Edge, type Node } from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { useStore } from "../store";
import IslandNode from "./IslandNode";
import BuildingNode from "./BuildingNode";
import DirectionNode from "./DirectionNode";
import RailEdge from "./RailEdge";
import RelationDrawer from "./RelationDrawer";
import World3D from "./World3D";
import InputBar from "./InputBar";
import NodeDrawer from "./NodeDrawer";
import BuildingDrawer from "./BuildingDrawer";
import { routeWithLibavoid } from "../routing";

const SPREAD = 1.28;
const NODE_W = 190;
const NODE_H = 170;
const nodeTypes = { island: IslandNode, building: BuildingNode, direction: DirectionNode };
const edgeTypes = { rail: RailEdge };

export default function World() {
  const world = useStore((s) => s.world);
  const nodes = useStore((s) => s.nodes);
  const edges = useStore((s) => s.edges);
  const buildings = useStore((s) => s.buildings);
  const drawer = useStore((s) => s.drawer);
  const openNode = useStore((s) => s.openNode);
  const openBuilding = useStore((s) => s.openBuilding);
  const backHome = useStore((s) => s.backHome);
  const [provider, setProvider] = useState("mock");
  const [zoom, setZoom] = useState(1);
  const [mode, setMode] = useState<"curve" | "straight" | "rail">("curve");
  const [view3d, setView3d] = useState(true);
  const [routes, setRoutes] = useState<Record<string, { x: number; y: number }[]>>({});

  // 缩放分级：0 简略 / 1 中等 / 2 完整
  const lod = zoom < 0.55 ? 0 : zoom < 1.0 ? 1 : 2;

  useEffect(() => {
    fetch("/api/health")
      .then((r) => r.json())
      .then((h) => setProvider(`${h.providers.llmActive}/${h.providers.asrActive}`))
      .catch(() => setProvider("offline"));
  }, []);

  const rfNodes = useMemo<Node[]>(() => {
    const base: Node[] = nodes.map((n) => ({
      id: n.id,
      type: "island",
      position: { x: n.x * SPREAD, y: n.y * SPREAD },
      data: { ...n, unknown: false, lod },
      draggable: false,
      selectable: true,
    }));

    // 副本：服务端已算好坐标并写入 DB，前端直接使用
    const bs: Node[] = buildings.map((b) => ({
      id: "b:" + b.id,
      type: "building",
      position: { x: b.x * SPREAD - NODE_W / 2, y: b.y * SPREAD - NODE_H / 2 },
      data: { ...b, lod },
      draggable: false,
      selectable: false,
    }));

    // 方向线：悬空"?"标记，位置来自服务端的 frontier 坐标
    const dirs: Node[] = edges
      .filter((e) => e.kind === "direction" && !e.consumed)
      .map((e) => {
        const src = nodes.find((n) => n.id === e.src);
        let seed = 0;
        for (let i = 0; i < e.id.length; i++) seed = (seed * 31 + e.id.charCodeAt(i)) | 0;
        const ang = ((Math.abs(seed) % 360) * Math.PI) / 180;
        return {
          id: "d:" + e.id,
          type: "direction",
          position: {
            x:
              e.frontier_x != null
                ? e.frontier_x * SPREAD
                : (src?.x ?? 0) * SPREAD + Math.cos(ang) * 190,
            y:
              e.frontier_y != null
                ? e.frontier_y * SPREAD
                : (src?.y ?? 0) * SPREAD + Math.sin(ang) * 150,
          },
          data: { question: e.question, edgeId: e.id },
          draggable: false,
          selectable: false,
        };
      });

    // 视觉去重叠（只影响渲染坐标，不写回数据库）
    const solid = [...base, ...bs];
    for (let iter = 0; iter < 8; iter++) {
      for (let i = 0; i < solid.length; i++) {
        for (let j = i + 1; j < solid.length; j++) {
          const a = solid[i] as any;
          const b = solid[j] as any;
          const ddx = b.position.x - a.position.x;
          const ddy = b.position.y - a.position.y;
          const minX = 230;
          const minY = 200;
          if (Math.abs(ddx) >= minX || Math.abs(ddy) >= minY) continue;
          const pushX = (minX - Math.abs(ddx)) * (ddx >= 0 ? 1 : -1) * 0.5;
          const pushY = (minY - Math.abs(ddy)) * (ddy >= 0 ? 1 : -1) * 0.5;
          if (Math.abs(ddx) / minX > Math.abs(ddy) / minY) {
            a.position.x -= pushX;
            b.position.x += pushX;
          } else {
            a.position.y -= pushY;
            b.position.y += pushY;
          }
        }
      }
    }
    return [...base, ...bs, ...dirs];
  }, [nodes, buildings, edges, lod]);

  // libavoid 正交避障：用渲染后的节点坐标当障碍，保证线端贴岛
  useEffect(() => {
    let alive = true;
    const boxes = rfNodes
      .filter((n) => n.type !== "direction")
      .map((n) => ({ id: n.id, x: n.position.x, y: n.position.y, w: NODE_W, h: NODE_H }));
    const links = edges
      .filter((e) => e.kind !== "direction")
      .map((e) => ({ id: e.id, src: e.src, dst: e.dst }));
    routeWithLibavoid(boxes, links).then((r) => {
      if (alive && r) setRoutes(r);
    });
    return () => {
      alive = false;
    };
  }, [rfNodes, edges]);

  // 路牌全局排布：沿路径错位 + 互相避让
  const signPos = useMemo<Record<string, { x: number; y: number }>>(() => {
    const items: { id: string; x: number; y: number; w: number; h: number }[] = [];
    for (const e of edges) {
      if (e.kind === "direction" && e.consumed) continue;
      const route = routes[e.id];
      if (!route || route.length < 2) continue;
      const label = e.kind === "direction" ? e.question || "下一步方向" : e.label || "";
      if (!label) continue;
      let seed = 0;
      for (let i = 0; i < e.id.length; i++) seed = (seed * 31 + e.id.charCodeAt(i)) | 0;
      const frac = 0.3 + ((Math.abs(seed) % 34) / 100);
      const total = route.reduce(
        (acc, p, i) => (i === 0 ? 0 : acc + Math.hypot(p.x - route[i - 1].x, p.y - route[i - 1].y)),
        0,
      );
      let walked = 0;
      let px = route[0].x;
      let py = route[0].y;
      for (let i = 1; i < route.length; i++) {
        const a = route[i - 1];
        const b = route[i];
        const len = Math.hypot(b.x - a.x, b.y - a.y);
        if (walked + len >= total * frac) {
          const t = len ? (total * frac - walked) / len : 0;
          px = a.x + (b.x - a.x) * t;
          py = a.y + (b.y - a.y) * t;
          break;
        }
        walked += len;
      }
      items.push({ id: e.id, x: px, y: py - 18, w: Math.min(240, label.length * 7 + 44), h: 26 });
    }
    for (const it of items) {
      for (const n of nodes) {
        const bx = n.x * SPREAD;
        const by = n.y * SPREAD;
        if (
          it.x + it.w / 2 > bx &&
          it.x - it.w / 2 < bx + NODE_W &&
          it.y + it.h / 2 > by &&
          it.y - it.h / 2 < by + NODE_H
        ) {
          it.y = by - it.h / 2 - 12;
        }
      }
    }
    for (let iter = 0; iter < 10; iter++) {
      for (let i = 0; i < items.length; i++) {
        for (let j = i + 1; j < items.length; j++) {
          const a = items[i];
          const b = items[j];
          const dx = b.x - a.x;
          const dy = b.y - a.y;
          const minX = (a.w + b.w) / 2 + 8;
          const minY = (a.h + b.h) / 2 + 6;
          if (Math.abs(dx) >= minX || Math.abs(dy) >= minY) continue;
          const pushY = (minY - Math.abs(dy)) * (dy >= 0 ? 1 : -1) * 0.55;
          a.y -= pushY;
          b.y += pushY;
        }
      }
    }
    const out: Record<string, { x: number; y: number }> = {};
    for (const it of items) out[it.id] = { x: it.x, y: it.y };
    return out;
  }, [edges, routes, nodes]);

  const rfEdges = useMemo<Edge[]>(() => {
    const center = (id: string) => {
      const n = nodes.find((x) => x.id === id);
      return n ? { x: n.x * SPREAD + 95, y: n.y * SPREAD + 75 } : null;
    };
    const dirPos = (e: any) => {
      const src = nodes.find((n) => n.id === e.src);
      if (e.frontier_x != null && e.frontier_y != null) {
        return { x: e.frontier_x * SPREAD, y: e.frontier_y * SPREAD };
      }
      let seed = 0;
      for (let i = 0; i < e.id.length; i++) seed = (seed * 31 + e.id.charCodeAt(i)) | 0;
      const ang = ((Math.abs(seed) % 360) * Math.PI) / 180;
      return {
        x: (src?.x ?? 0) * SPREAD + Math.cos(ang) * 190,
        y: (src?.y ?? 0) * SPREAD + Math.sin(ang) * 150,
      };
    };
    const counts: Record<string, number> = {};
    const bends = [0, 1, -1, 2, -2];
    const mapped = edges
      .filter((e) => !(e.kind === "direction" && e.consumed))
      .map((e) => {
        const isDir = e.kind === "direction";
        const a = center(e.src);
        const b = isDir ? dirPos(e) : center(e.dst);
        if (!a || !b) return null;
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const horiz = Math.abs(dx) >= Math.abs(dy);
        const sourceHandle = horiz ? (dx >= 0 ? "r" : "l") : (dy >= 0 ? "b" : "t");
        const targetHandle = isDir
          ? undefined
          : horiz
            ? (dx >= 0 ? "l" : "r")
            : (dy >= 0 ? "t" : "b");
        const key = isDir ? "d:" + e.id : [e.src, e.dst].sort().join("|");
        const idx = counts[key] ?? 0;
        counts[key] = idx + 1;
        const depth =
          Math.max(0, Math.min(1, (a.y + b.y) / 2 / Math.max(1, Math.max(...nodes.map((n) => n.y * SPREAD)))));
        return {
          id: e.id,
          source: e.src,
          target: isDir ? "d:" + e.id : e.dst,
          sourceHandle,
          targetHandle,
          type: "rail",
          data: {
            kind: e.kind,
            label: e.label,
            question: e.question,
            bend: bends[idx % bends.length],
            lod,
            mode,
            depth,
            route: routes[e.id],
            signPos: signPos[e.id],
            onSign: (id: string) => useStore.getState().openEdge(id),
          },
        } as Edge;
      })
      .filter(Boolean) as Edge[];

    // 副本挂靠线：节点 → 副本（不显示路牌）
    const linkEdges: Edge[] = buildings.map((b) => ({
      id: "bl:" + b.id,
      source: b.anchor,
      sourceHandle: "r",
      target: "b:" + b.id,
      targetHandle: "l",
      type: "rail",
      data: { kind: "source", label: "", lod, bend: 0, noSign: true },
    }));
    return [...mapped, ...linkEdges];
  }, [nodes, edges, routes, lod, buildings, signPos, mode]);

  const onNodeClick = useCallback(
    (_evt: any, node: Node) => {
      if (node.id.startsWith("d:")) return;
      if (node.id.startsWith("b:")) openBuilding(node.id.slice(2));
      else openNode(node.id);
    },
    [openNode, openBuilding],
  );

  const onEdgeClick = useCallback((_evt: any, edge: Edge) => {
    useStore.getState().openEdge(edge.id);
  }, []);

  async function undoHide() {
    if (!world) return;
    const r = await fetch(`/api/worlds/${world.id}/hide/undo`, { method: "POST" });
    const data = await r.json();
    if (!r.ok) {
      useStore.getState().showToast(data.error ?? "没有可撤回的隐藏");
      return;
    }
    await useStore.getState().openWorld(world.id);
    useStore.getState().showToast(`已撤回 ${data.count} 个节点的隐藏`);
  }

  async function exportWorld() {
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
  }

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
          <button className="ghost-btn" onClick={() => setView3d((v) => !v)}>
            {view3d ? "2D 视图" : "3D 视图"}
          </button>
          <button
            className="ghost-btn"
            onClick={() =>
              setMode((m) => (m === "curve" ? "straight" : m === "straight" ? "rail" : "curve"))
            }
          >
            连线：{mode === "curve" ? "曲线" : mode === "straight" ? "直线" : "轨道"}
          </button>
          <button
            className="ghost-btn"
            onClick={async () => {
              if (!world) return;
              await fetch(`/api/worlds/${world.id}/layout`, { method: "POST" });
              await useStore.getState().openWorld(world.id);
              useStore.getState().showToast("已用 WFC 重排布局");
            }}
          >
            重排
          </button>
          <button className="ghost-btn" onClick={undoHide}>
            撤回隐藏
          </button>
          <button className="ghost-btn" onClick={exportWorld}>
            导出
          </button>
          <div className="spacer" />
          <span className="badge">拖拽平移 · 滚轮缩放 · 点线看关系</span>
        </div>

        <div className="flow-wrap">
          {view3d ? (
            <World3D />
          ) : (
            <ReactFlow
              nodes={rfNodes}
              edges={rfEdges}
              nodeTypes={nodeTypes}
              edgeTypes={edgeTypes}
              onNodeClick={onNodeClick}
              onEdgeClick={onEdgeClick}
              onMove={(_e, vp) => setZoom(vp.zoom)}
              fitView
              fitViewOptions={{ padding: 0.35 }}
              minZoom={0.3}
              maxZoom={1.8}
              proOptions={{ hideAttribution: true }}
            >
              <Background color="#ded3c0" gap={26} size={1} />
              <Controls showInteractive={false} />
            </ReactFlow>
          )}
          <div className="legend">
            <div><b>线型</b></div>
            <div className="li"><i className="sw" />正式关系（实线，不可删除）</div>
            <div className="li"><i className="sw src" />探索来源（正式关系的一种）</div>
            <div className="li"><i className="sw dash" />AI 建议（虚线，可接受）</div>
            <div className="li"><i className="sw dot" />方向（点线 + ?，无 MD）</div>
            <div style={{ marginTop: 6 }}><b>节点三档</b>：核心 → Ⅰ 环 → Ⅱ → Ⅲ 塔</div>
            <div><b>建筑</b>：领域副本 / 流程副本</div>
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
