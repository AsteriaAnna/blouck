import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { Html, Line, OrbitControls, useGLTF } from "@react-three/drei";
import * as THREE from "three";
import { useStore } from "../store";
import { buildingModelUrl, islandModelUrl } from "../models3d";

const ACCENTS = ["#c97b6b", "#7e8fa8", "#a76b6b", "#6e8c83", "#b0805a", "#8a7080"];

function hash(s: string) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

const EDGE_COLORS: Record<string, string> = {
  formal: "#6f6252",
  source: "#7d9994",
  suggest: "#b08a5f", // 待确认的线统一颜色（虚线）
  direction: "#9a8f7a",
};

/** 加载 GLB 并归一化：底部落在 y=0，尺寸缩放到 target */
function Model({ url, target, tint }: { url: string; target: number; tint?: string }) {
  const { scene } = useGLTF(url);
  const object = useMemo(() => {
    const src = scene.clone(true);
    src.traverse((o: any) => {
      if (o.isMesh) {
        o.castShadow = true;
        o.receiveShadow = true;
        if (o.material) o.material.side = THREE.FrontSide;
      }
    });
    const box = new THREE.Box3().setFromObject(src);
    const size = box.getSize(new THREE.Vector3());
    const center = box.getCenter(new THREE.Vector3());
    const k = target / Math.max(size.x, size.z, 0.001);
    src.scale.setScalar(k);
    src.position.set(-center.x * k, -box.min.y * k, -center.z * k);
    const group = new THREE.Group();
    group.add(src);
    return group;
  }, [scene, target]);
  return <primitive object={object} />;
}

function Island({
  position,
  node,
  onOpen,
  appearing,
  mentioned,
  spawnFrom,
}: {
  position: [number, number, number];
  node: any;
  onOpen: () => void;
  appearing?: boolean;
  mentioned?: boolean;
  spawnFrom?: [number, number, number];
}) {
  const [hover, setHover] = useState(false);
  const ref = useRef<THREE.Group>(null);
  const motionRef = useRef<THREE.Group>(null);
  const ringRef = useRef<THREE.Mesh>(null);
  const born = useRef<number | null>(null);
  const seed = hash(node.id);
  const accent = ACCENTS[seed % ACCENTS.length];
  const tier = node.tier ?? 0;
  // provisional 与 committed 是同一套地图坐标，只在标签/脉冲上弱化区分（commit 后 status 变 committed 即恢复）
  const provisional = node.status === "provisional";
  const pulse = Boolean(appearing || mentioned || provisional);
  const deltaX = spawnFrom ? spawnFrom[0] - position[0] : 0;
  const deltaZ = spawnFrom ? spawnFrom[2] - position[2] : 0;

  useFrame((state, dt) => {
    if (!ref.current) return;
    if (appearing) {
      if (born.current === null) born.current = state.clock.elapsedTime;
      const age = state.clock.elapsedTime - born.current;
      const t = Math.min(1, age / 1.2);
      const ease = 1 - Math.pow(1 - t, 3);
      const s = 0.02 + ease * 1.0;
      ref.current.scale.setScalar(s * (hover ? 1.08 : 1));
      ref.current.position.y = -90 * (1 - ease);
      if (motionRef.current) {
        motionRef.current.position.x = deltaX * (1 - ease);
        motionRef.current.position.z = deltaZ * (1 - ease);
      }
    } else {
      ref.current.position.y = THREE.MathUtils.lerp(ref.current.position.y, 0, Math.min(1, dt * 6));
      if (motionRef.current) {
        motionRef.current.position.x = THREE.MathUtils.lerp(motionRef.current.position.x, 0, Math.min(1, dt * 5));
        motionRef.current.position.z = THREE.MathUtils.lerp(motionRef.current.position.z, 0, Math.min(1, dt * 5));
      }
      const target = hover ? 1.1 : 1;
      ref.current.scale.lerp(new THREE.Vector3(target, target, target), Math.min(1, dt * 8));
    }
    if (ringRef.current && pulse) {
      const k = 1 + Math.sin(state.clock.elapsedTime * 3.2) * 0.05;
      ringRef.current.scale.setScalar(k);
      const mat = ringRef.current.material as THREE.MeshBasicMaterial;
      // 纯候选（未在入场动画中）的脉冲环更弱
      const strength = provisional && !appearing ? 0.55 : 1;
      mat.opacity = (0.35 + 0.25 * (0.5 + 0.5 * Math.sin(state.clock.elapsedTime * 3.2))) * strength;
    }
  });

  return (
    <group
      position={position}
      onPointerOver={(e) => {
        e.stopPropagation();
        setHover(true);
        document.body.style.cursor = "pointer";
      }}
      onPointerOut={() => {
        setHover(false);
        document.body.style.cursor = "auto";
      }}
      onPointerDown={(e) => {
        e.stopPropagation();
        onOpen();
      }}
    >
      <group ref={motionRef}>
        <group ref={ref}>
          <Suspense fallback={null}>
            <Model url={islandModelUrl(node.name ?? "", node.id)} target={120} tint={accent} />
          </Suspense>
          {tier >= 1 && (
            <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 3, 0]}>
              <torusGeometry args={[tier >= 3 ? 70 : 60, 1.3, 8, 48]} />
              <meshStandardMaterial color={accent} transparent opacity={0.85} />
            </mesh>
          )}
          {pulse && (
            <mesh ref={ringRef} rotation={[-Math.PI / 2, 0, 0]} position={[0, 4, 0]}>
              <torusGeometry args={[68, 2.4, 8, 48]} />
              <meshBasicMaterial
                color={appearing ? "#e0a458" : provisional ? "#c2ac8d" : "#d8b46a"}
                transparent
                opacity={0.55}
                depthWrite={false}
              />
            </mesh>
          )}
        </group>
        <Html center position={[0, 92, 0]} zIndexRange={[30, 0]} style={{ pointerEvents: "none" }}>
          <div
            className={
              "n3d-label" +
              (provisional ? " provisional" : "") +
              (appearing ? " new" : "") +
              (mentioned ? " mentioned" : "")
            }
          >
            <span className="dot" style={{ background: accent }} />
            {provisional ? <span className="tag">候选 ·</span> : null}
            {node.name}
            {appearing ? <span className="spark">＋</span> : null}
          </div>
        </Html>
      </group>
    </group>
  );
}

function GhostIsland({
  position,
  name,
  role,
}: {
  position: [number, number, number];
  name: string;
  role?: string;
}) {
  const ref = useRef<THREE.Group>(null);
  useFrame((state) => {
    if (!ref.current) return;
    ref.current.position.y = 6 + Math.sin(state.clock.elapsedTime * 2.2 + name.length) * 5;
    const k = 1 + Math.sin(state.clock.elapsedTime * 2.6) * 0.04;
    ref.current.scale.setScalar(k);
  });
  return (
    <group ref={ref} position={position}>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 2, 0]}>
        <circleGeometry args={[42, 32]} />
        <meshBasicMaterial color="#a3937c" transparent opacity={0.16} depthWrite={false} />
      </mesh>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 3, 0]}>
        <torusGeometry args={[44, 1.1, 8, 40]} />
        <meshBasicMaterial color="#b49f82" transparent opacity={0.55} depthWrite={false} />
      </mesh>
      <Html center position={[0, 58, 0]} zIndexRange={[25, 0]} style={{ pointerEvents: "none" }}>
        <div className={"n3d-label ghost"}>
          <span className="dot" />
          候选 · {name}
          {role ? <em>{role}</em> : null}
        </div>
      </Html>
    </group>
  );
}

function Building({
  position,
  building,
  onOpen,
}: {
  position: [number, number, number];
  building: any;
  onOpen: () => void;
}) {
  return (
    <group
      position={position}
      onPointerDown={(e) => {
        e.stopPropagation();
        onOpen();
      }}
    >
      <Suspense fallback={null}>
        <Model url={buildingModelUrl(building.kind)} target={150} />
      </Suspense>
      <Html center position={[0, 118, 0]} style={{ pointerEvents: "none" }}>
        <div className="b3d-label">{building.kind === "flow" ? "流程副本" : "领域副本"}</div>
      </Html>
    </group>
  );
}

/** 贴地弧线：所有点 y=0，只在 XZ 平面里弯（与岛屿的平面高度一致） */
function edgeCurve(a: THREE.Vector3, b: THREE.Vector3) {
  const s = a.clone().setY(0);
  const t = b.clone().setY(0);
  const mid = s.clone().add(t).multiplyScalar(0.5);
  const dx = t.x - s.x;
  const dz = t.z - s.z;
  const len = Math.hypot(dx, dz) || 1;
  const bow = Math.min(60, len * 0.12);
  mid.x += (-dz / len) * bow;
  mid.z += (dx / len) * bow;
  return new THREE.QuadraticBezierCurve3(s, mid, t);
}

/** 沿线的透明命中体：线太细，用一根不可见管子接点击 */
function HitTube({
  curve,
  onOpen,
  radius = 14,
}: {
  curve: THREE.Curve<THREE.Vector3>;
  onOpen: () => void;
  radius?: number;
}) {
  const geo = useMemo(() => new THREE.TubeGeometry(curve, 24, radius, 4, false), [curve, radius]);
  return (
    <mesh
      geometry={geo}
      onPointerDown={(e) => {
        e.stopPropagation();
        onOpen();
      }}
      onPointerOver={() => (document.body.style.cursor = "pointer")}
      onPointerOut={() => (document.body.style.cursor = "auto")}
    >
      <meshBasicMaterial transparent opacity={0} depthWrite={false} />
    </mesh>
  );
}

/** 探索点：雾里发光的“？”信标（对应方向线末端） */
function makeQuestionTexture() {
  const canvas = document.createElement("canvas");
  canvas.width = 128;
  canvas.height = 128;
  const ctx = canvas.getContext("2d")!;
  const cx = 64;
  const cy = 64;
  const grad = ctx.createRadialGradient(cx, cy, 8, cx, cy, 62);
  grad.addColorStop(0, "rgba(255,252,240,0.98)");
  grad.addColorStop(0.55, "rgba(255,246,222,0.72)");
  grad.addColorStop(1, "rgba(255,240,200,0)");
  ctx.fillStyle = grad;
  ctx.beginPath();
  ctx.arc(cx, cy, 62, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#fffdf7";
  ctx.strokeStyle = "#8a7a63";
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.arc(cx, cy, 30, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = "#6f6252";
  ctx.font = "bold 42px 'Microsoft YaHei','Segoe UI',sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText("?", cx, cy + 2);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function QuestionBeacon({
  position,
  onOpen,
}: {
  position: [number, number, number];
  onOpen: () => void;
}) {
  const ref = useRef<THREE.Group>(null);
  const tex = useMemo(makeQuestionTexture, []);
  useFrame(({ clock }) => {
    if (!ref.current) return;
    const t = clock.elapsedTime;
    ref.current.position.y = 14 + Math.sin(t * 1.8 + position[0] * 0.01) * 5;
    const k = 1.04 + Math.sin(t * 2.2) * 0.08;
    ref.current.scale.setScalar(k);
    const glow = ref.current.children[1] as THREE.Mesh | undefined;
    if (glow) {
      const mat = glow.material as THREE.MeshBasicMaterial;
      mat.opacity = 0.3 + 0.16 * (0.5 + 0.5 * Math.sin(t * 2.2));
    }
  });
  return (
    <group
      ref={ref}
      position={position}
      onPointerDown={(e) => {
        e.stopPropagation();
        onOpen();
      }}
      onPointerOver={() => (document.body.style.cursor = "pointer")}
      onPointerOut={() => (document.body.style.cursor = "auto")}
    >
      <sprite scale={[38, 38, 1]}>
        <spriteMaterial map={tex} transparent depthWrite={false} />
      </sprite>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -10, 0]}>
        <ringGeometry args={[17, 22, 28]} />
        <meshBasicMaterial color="#c2ac8d" transparent opacity={0.32} depthWrite={false} side={THREE.DoubleSide} />
      </mesh>
    </group>
  );
}

function Edge({
  a,
  b,
  kind,
  onOpen,
}: {
  a: THREE.Vector3;
  b: THREE.Vector3;
  kind: string;
  onOpen: () => void;
}) {
  const curve = useMemo(() => edgeCurve(a, b), [a, b]);
  const pts = useMemo(
    () => curve.getPoints(28).map((p) => [p.x, p.y, p.z] as [number, number, number]),
    [curve],
  );
  const start = useMemo(() => curve.getPoint(0), [curve]);
  const mid = useMemo(() => curve.getPoint(0.5), [curve]);
  const color = EDGE_COLORS[kind] ?? EDGE_COLORS.formal;
  const solid = kind === "formal" || kind === "source";
  const tubeGeo = useMemo(
    () =>
      solid
        ? new THREE.TubeGeometry(curve, 28, kind === "source" ? 2.0 : 2.8, 6, false)
        : null,
    [curve, kind, solid],
  );
  if (solid) {
    return (
      <group>
        <mesh geometry={tubeGeo!} castShadow receiveShadow>
          <meshStandardMaterial color={color} roughness={0.86} metalness={0} flatShading />
        </mesh>
        {kind === "source" ? (
          <mesh position={[start.x, 4, start.z]} castShadow>
            <sphereGeometry args={[6, 14, 12]} />
            <meshStandardMaterial color={color} roughness={0.8} flatShading />
          </mesh>
        ) : null}
        <HitTube curve={curve} onOpen={onOpen} radius={14} />
      </group>
    );
  }
  const dotted = kind === "direction";
  return (
    <group>
      <Line
        points={pts}
        color={color}
        lineWidth={1.7}
        transparent
        opacity={dotted ? 0.55 : 0.85}
        dashed
        dashSize={dotted ? 2 : 9}
        gapSize={dotted ? 10 : 7}
      />
      {kind === "suggest" ? (
        <mesh position={[mid.x, 4, mid.z]} castShadow>
          <sphereGeometry args={[4, 12, 10]} />
          <meshStandardMaterial color={color} emissive={color} emissiveIntensity={0.35} roughness={0.7} flatShading />
        </mesh>
      ) : null}
      <HitTube curve={curve} onOpen={onOpen} radius={12} />
    </group>
  );
}

/** 方向线：点线 + 末端发光的“？”探索点 */
function DirectionEdge({
  a,
  b,
  onOpen,
}: {
  a: THREE.Vector3;
  b: THREE.Vector3;
  onOpen: () => void;
}) {
  const curve = useMemo(() => edgeCurve(a, b), [a, b]);
  const pts = useMemo(
    () => curve.getPoints(28).map((p) => [p.x, p.y, p.z] as [number, number, number]),
    [curve],
  );
  return (
    <group>
      <Line
        points={pts}
        color={EDGE_COLORS.direction}
        lineWidth={1.5}
        transparent
        opacity={0.55}
        dashed
        dashSize={2}
        gapSize={10}
      />
      <HitTube curve={curve} onOpen={onOpen} radius={12} />
      <QuestionBeacon position={[b.x, 0, b.z]} onOpen={onOpen} />
    </group>
  );
}

/** 进入世界时自动把全部节点 + 副本框进视野；只在世界切换（worldId 变化）时 fit 一次，之后新增节点不改相机 */
function CameraFit({
  worldId,
  points,
}: {
  worldId: string | null;
  points: [number, number, number][];
}) {
  const camera = useThree((s) => s.camera);
  const controls = useThree((s) => s.controls) as any;
  // 始终读到最新节点坐标，但 effect 不因 points 变化重跑（否则每新增一个节点 1s 后相机就被重置）
  const pointsRef = useRef(points);
  pointsRef.current = points;
  useEffect(() => {
    if (!worldId) return;
    let cancelled = false;
    let tries = 0;
    let timer = 0;
    const fit = () => {
      if (cancelled) return;
      const pts = pointsRef.current;
      if (!pts.length) {
        // openWorld 里 world 与 nodes 同一次 set 写入；万一节点还没就位，短暂重试，绝不用空数据改相机
        if (tries++ < 10) timer = window.setTimeout(fit, 200);
        return;
      }
      let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
      for (const [x, , z] of pts) {
        minX = Math.min(minX, x);
        maxX = Math.max(maxX, x);
        minZ = Math.min(minZ, z);
        maxZ = Math.max(maxZ, z);
      }
      const cx = (minX + maxX) / 2;
      const cz = (minZ + maxZ) / 2;
      const size = Math.max(maxX - minX, maxZ - minZ, 600);
      const dist = Math.max(1250, size * 1.55);
      camera.position.set(cx, dist * 0.95, cz + dist * 0.95);
      camera.lookAt(cx, 0, cz);
      camera.updateProjectionMatrix();
      if (controls?.target) {
        controls.target.set(cx, 0, cz);
        controls.update?.();
      }
    };
    timer = window.setTimeout(fit, 1000);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [worldId, camera, controls]);
  return null;
}

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
        {edges.map((e) => {
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
