import { useMemo } from "react";
import { Canvas } from "@react-three/fiber";
import { OrbitControls } from "@react-three/drei";
import * as THREE from "three";
import { useStore } from "../store";
import { Edge, DirectionEdge } from "./World3DEdges";
import { Building, CameraFit, GhostIsland, Island } from "./World3DScene";

export default function World3D() {
  const worldId = useStore((s) => s.world?.id ?? null);
  const nodes = useStore((s) => s.nodes);
  const edges = useStore((s) => s.edges);
  const buildings = useStore((s) => s.buildings);
  const openNode = useStore((s) => s.openNode);
  const openBuilding = useStore((s) => s.openBuilding);
  const openEdge = useStore((s) => s.openEdge);
  const newNodeIds = useStore((s) => s.newNodeIds);
  const mentions = useStore((s) => s.mentions);
  const ghosts = useStore((s) => s.ghosts);
  const spawnGhosts = useStore((s) => s.spawnGhosts);
  const focusId = useStore((s) => s.focusId);

  const { cx, cy, scale } = useMemo(() => {
    if (!nodes.length) return { cx: 0, cy: 0, scale: 0.85 };
    const xs = nodes.map((n) => n.x);
    const ys = nodes.map((n) => n.y);
    return {
      cx: (Math.min(...xs) + Math.max(...xs)) / 2,
      cy: (Math.min(...ys) + Math.max(...ys)) / 2,
      scale: 0.85,
    };
  }, [nodes]);

  const posOf = (x: number, y: number): [number, number, number] => [
    (x - cx) * scale,
    0,
    (y - cy) * scale,
  ];

  const anchorNode = nodes.find((n) => n.id === focusId) ?? nodes[0];
  const ghostPos = (i: number): [number, number, number] | undefined => {
    if (!anchorNode) return undefined;
    const x = anchorNode.x + 190 + (i % 3) * 120;
    const y = anchorNode.y + (i % 2 === 0 ? -110 : 120) + Math.floor(i / 3) * 130;
    return posOf(x, y);
  };
  const normName = (s: string) => s.toLowerCase().replace(/[\s\-_·、，。,.；;：:（）()【】\[\]《》"'“”]/g, "");
  const aliasesOf = (n: any) => {
    const out = [String(n.name ?? "")];
    try {
      const a = JSON.parse(n.aliases || "[]");
      if (Array.isArray(a)) out.push(...a.map(String));
    } catch {}
    return out.filter(Boolean);
  };
  const spawnIndexFor = (n: any) => {
    const names = aliasesOf(n).map(normName);
    return spawnGhosts.findIndex((g) => {
      const gn = normName(g.name);
      return names.some((x) => x === gn || x.includes(gn) || gn.includes(x));
    });
  };

  const nodePos = useMemo(() => {
    const m = new Map<string, THREE.Vector3>();
    for (const n of nodes) m.set(n.id, new THREE.Vector3(...posOf(n.x, n.y)));
    return m;
  }, [nodes, cx, cy]);

  const worldPoints = useMemo(() => {
    const pts: [number, number, number][] = nodes.map((n) => posOf(n.x, n.y));
    for (const b of buildings) {
      if (b.x || b.y) pts.push(posOf(b.x, b.y));
      else {
        const a = nodes.find((n) => n.id === b.anchor);
        if (a) pts.push(posOf(a.x, a.y));
      }
    }
    return pts;
  }, [nodes, buildings, cx, cy]);

  // 地图克制：提示线最多 2 条（按置信度/新近），其余留在关系池
  const displayEdges = useMemo(() => {
    const hints = edges
      .filter((e) => e.kind === "suggest")
      .slice()
      .sort((a, b) => (b.confidence ?? 0) - (a.confidence ?? 0))
      .slice(0, 2);
    const allowed = new Set(hints.map((e) => e.id));
    return edges.filter((e) => e.kind !== "suggest" || allowed.has(e.id));
  }, [edges]);

  return (
    <div className="world3d">
      <Canvas
        shadows
        dpr={[1, 1.8]}
        camera={{ position: [0, 820, 1000], fov: 38, near: 10, far: 8000 }}
      >
        <color attach="background" args={["#f7f2e8"]} />
        <fog attach="fog" args={["#f7f2e8", 1400, 4200]} />
        <ambientLight intensity={0.9} />
        <hemisphereLight args={["#fffdf7", "#d8cbb5", 0.55]} />
        <directionalLight
          position={[700, 1200, 500]}
          intensity={1.2}
          castShadow
          shadow-mapSize-width={2048}
          shadow-mapSize-height={2048}
        />
        {nodes.map((n) => {
          const appearing = newNodeIds.includes(n.id);
          const spawnIdx = appearing ? spawnIndexFor(n) : -1;
          const fallback = appearing && spawnGhosts.length > 0 ? ghostPos(0) : undefined;
          return (
            <Island
              key={n.id}
              position={posOf(n.x, n.y)}
              node={n}
              onOpen={() => openNode(n.id)}
              appearing={appearing}
              mentioned={mentions.includes(n.id)}
              spawnFrom={spawnIdx >= 0 ? ghostPos(spawnIdx) : fallback}
            />
          );
        })}
        {ghosts.map((g, i) => {
          const p = ghostPos(i);
          if (!p) return null;
          return <GhostIsland key={`${g.name}-${i}`} position={p} name={g.name} role={g.role} />;
        })}
        {displayEdges.map((e) => {
          if (e.kind === "direction") {
            if (e.consumed) return null;
            const srcNode = nodes.find((n) => n.id === e.src);
            if (!srcNode?.frontier) return null; // 只有边缘节点在地图上画方向
            const a = nodePos.get(e.src);
            const f =
              e.frontier_x != null && e.frontier_y != null
                ? new THREE.Vector3((e.frontier_x - cx) * scale, 0, (e.frontier_y - cy) * scale)
                : null;
            if (!a || !f) return null;
            return (
              <DirectionEdge
                key={e.id}
                a={a.clone().setY(0)}
                b={f.clone().setY(0)}
                label={e.question || "下一步方向"}
                onOpen={() => openEdge(e.id)}
              />
            );
          }
          const a = nodePos.get(e.src);
          const b = nodePos.get(e.dst);
          if (!a || !b) return null;
          return (
            <Edge
              key={e.id}
              a={a.clone().setY(0)}
              b={b.clone().setY(0)}
              kind={e.kind}
              label={e.label || ""}
              onOpen={() => openEdge(e.id)}
            />
          );
        })}
        {buildings.map((b) => {
          const anchor = nodes.find((n) => n.id === b.anchor);
          let pos: [number, number, number] | null = null;
          if (b.x || b.y) {
            const [x, , z] = posOf(b.x, b.y);
            pos = [x, 0, z];
          } else if (anchor) {
            const [x, , z] = posOf(anchor.x, anchor.y);
            pos = [x + 190, 0, z + 70];
          }
          if (!pos) return null;
          return (
            <Building
              key={b.id}
              position={pos}
              building={b}
              onOpen={() => openBuilding(b.id)}
            />
          );
        })}
        {/* 不要给 OrbitControls 传 target：[0,0,0]：R3F 每次重渲染都会把 props apply 一遍，
            target 数组会重新 .set 回原点，等于在新增节点时把相机拽回原点（相机只在 CameraFit 里定一次）。 */}
        <OrbitControls
          makeDefault
          enablePan
          minDistance={300}
          maxDistance={2600}
          maxPolarAngle={Math.PI / 2.15}
        />
        <CameraFit worldId={worldId} points={worldPoints} />
      </Canvas>
      <div className="hud3d">
        <div className="badge">3D · 拖拽旋转 · 滚轮缩放 · 点岛查看</div>
      </div>
    </div>
  );
}
