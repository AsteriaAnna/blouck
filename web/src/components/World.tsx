import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Background,
  Controls,
  ReactFlow,
  type Edge,
  type Node,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { useStore } from "../store";
import IslandNode from "./IslandNode";
import BuildingNode from "./BuildingNode";
import KwEdge from "./KwEdge";
import InputBar from "./InputBar";
import NodeDrawer from "./NodeDrawer";
import BuildingDrawer from "./BuildingDrawer";

const nodeTypes = { island: IslandNode, building: BuildingNode };
const edgeTypes = { kw: KwEdge };

export default function World() {
  const world = useStore((s) => s.world);
  const nodes = useStore((s) => s.nodes);
  const edges = useStore((s) => s.edges);
  const buildings = useStore((s) => s.buildings);
  const drawer = useStore((s) => s.drawer);
  const openNode = useStore((s) => s.openNode);
  const openBuilding = useStore((s) => s.openBuilding);
  const acceptEdge = useStore((s) => s.acceptEdge);
  const backHome = useStore((s) => s.backHome);
  const [provider, setProvider] = useState("mock");

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
      position: { x: n.x, y: n.y },
      data: { ...n, unknown: false },
      draggable: false,
      selectable: true,
    }));
    const bs: Node[] = buildings.map((b, i) => {
      const anchor = nodes.find((n) => n.id === b.anchor);
      return {
        id: "b:" + b.id,
        type: "building",
        position: {
          x: (anchor?.x ?? 120) + 300,
          y: (anchor?.y ?? 0) - 90 + i * 110,
        },
        data: { ...b },
        draggable: false,
        selectable: false,
      };
    });
    return [...base, ...bs];
  }, [nodes, buildings]);

  const rfEdges = useMemo<Edge[]>(
    () =>
      edges.map((e) => ({
        id: e.id,
        source: e.src,
        target: e.dst,
        type: "kw",
        data: { kind: e.kind, label: e.label, question: e.question },
      })),
    [edges],
  );

  const onNodeClick = useCallback(
    (evt: any, node: Node) => {
      if (node.id.startsWith("b:")) {
        openBuilding(node.id.slice(2));
      } else {
        openNode(node.id);
      }
    },
    [openNode, openBuilding],
  );

  const onEdgeClick = useCallback(
    (evt: any, edge: Edge) => {
      const kind = (edge.data as any)?.kind;
      if (kind === "suggest") {
        if (window.confirm("接受这条虚线建议，建立正式关系？")) acceptEdge(edge.id);
      }
    },
    [acceptEdge],
  );

  if (!world) return null;

  return (
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
        <div className="spacer" />
        <span className="badge">拖拽平移 · 滚轮缩放 · 点虚线可接受</span>
      </div>

      <div className="flow-wrap">
        <ReactFlow
          nodes={rfNodes}
          edges={rfEdges}
          nodeTypes={nodeTypes}
          edgeTypes={edgeTypes}
          onNodeClick={onNodeClick}
          onEdgeClick={onEdgeClick}
          fitView
          fitViewOptions={{ padding: 0.35 }}
          minZoom={0.3}
          maxZoom={1.8}
          proOptions={{ hideAttribution: true }}
        >
          <Background color="#ded3c0" gap={26} size={1} />
          <Controls showInteractive={false} />
        </ReactFlow>
        <InputBar />
      </div>

      {drawer?.kind === "node" && <NodeDrawer />}
      {drawer?.kind === "building" && <BuildingDrawer />}
    </div>
  );
}
