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
  suggest: "#a2947f",
  direction: "#b0a390",
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
}: {
  position: [number, number, number];
  node: any;
  onOpen: () => void;
  appearing?: boolean;
  mentioned?: boolean;
}) {
  const [hover, setHover] = useState(false);
  const ref = useRef<THREE.Group>(null);
  const ringRef = useRef<THREE.Mesh>(null);
  const born = useRef<number | null>(null);
  const seed = hash(node.id);
  const accent = ACCENTS[seed % ACCENTS.length];
  const tier = node.tier ?? 0;
  const pulse = Boolean(appearing || mentioned);

  useFrame((state, dt) => {
    if (!ref.current) return;
    if (appearing) {
      if (born.current === null) born.current = state.clock.elapsedTime;
      const age = state.clock.elapsedTime - born.current;
      const t = Math.min(1, age / 0.9);
      const ease = 1 - Math.pow(1 - t, 3);
      const s = 0.02 + ease * 1.0;
      ref.current.scale.setScalar(s * (hover ? 1.08 : 1));
      ref.current.position.y = -90 * (1 - ease);
    } else {
      ref.current.position.y = THREE.MathUtils.lerp(ref.current.position.y, 0, Math.min(1, dt * 6));
      const target = hover ? 1.1 : 1;
      ref.current.scale.lerp(new THREE.Vector3(target, target, target), Math.min(1, dt * 8));
    }
    if (ringRef.current && pulse) {
      const k = 1 + Math.sin(state.clock.elapsedTime * 3.2) * 0.05;
      ringRef.current.scale.setScalar(k);
      const mat = ringRef.current.material as THREE.MeshBasicMaterial;
      mat.opacity = 0.35 + 0.25 * (0.5 + 0.5 * Math.sin(state.clock.elapsedTime * 3.2));
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
            <meshBasicMaterial color={appearing ? "#e0a458" : "#d8b46a"} transparent opacity={0.55} depthWrite={false} />
          </mesh>
        )}
      </group>
      <Html center position={[0, 92, 0]} zIndexRange={[30, 0]} style={{ pointerEvents: "none" }}>
        <div className={"n3d-label" + (appearing ? " new" : "") + (mentioned ? " mentioned" : "")}>
          <span className="dot" style={{ background: accent }} />
          {node.name}
          {appearing ? <span className="spark">＋</span> : null}
        </div>
      </Html>
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

function makeBoardTexture(text: string) {
  const font = "500 30px 'Microsoft YaHei','Segoe UI',system-ui,sans-serif";
  const pad = 22;
  const probe = document.createElement("canvas").getContext("2d")!;
  probe.font = font;
  const rawW = Math.ceil(probe.measureText(text).width);
  const W = Math.min(520, Math.max(150, rawW + pad * 2));
  const H = 64;
  const canvas = document.createElement("canvas");
  canvas.width = W * 2;
  canvas.height = H * 2;
  const ctx = canvas.getContext("2d")!;
  ctx.scale(2, 2);
  ctx.font = font;
  ctx.fillStyle = "#fffdf7";
  ctx.strokeStyle = "#8a7a63";
  ctx.lineWidth = 2;
  const r = 8;
  ctx.beginPath();
  ctx.moveTo(r, 1);
  ctx.lineTo(W - r, 1);
  ctx.quadraticCurveTo(W - 1, 1, W - 1, r);
  ctx.lineTo(W - 1, H - r);
  ctx.quadraticCurveTo(W - 1, H - 1, W - r, H - 1);
  ctx.lineTo(r, H - 1);
  ctx.quadraticCurveTo(1, H - 1, 1, H - r);
  ctx.lineTo(1, r);
  ctx.quadraticCurveTo(1, 1, r, 1);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = "#4a4034";
  ctx.textBaseline = "middle";
  let shown = text;
  while (probe.measureText(shown).width > W - pad * 2 && shown.length > 2) {
    shown = shown.slice(0, -1);
  }
  if (shown !== text) shown = shown.slice(0, -1) + "…";
  ctx.fillText(shown, pad, H / 2 + 1);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return { tex, width: W * 0.32, height: H * 0.32 };
}

/** 立体路牌：木柱 + 牌面（Canvas 文字），始终转向相机，可点击 */
function SignPost({
  position,
  label,
  onOpen,
}: {
  position: [number, number, number];
  label: string;
  onOpen: () => void;
}) {
  const ref = useRef<THREE.Group>(null);
  const { tex, width, height } = useMemo(() => makeBoardTexture(label || "方向"), [label]);
  useFrame(({ camera }) => {
    if (!ref.current) return;
    ref.current.rotation.y = Math.atan2(
      camera.position.x - position[0],
      camera.position.z - position[2],
    );
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
      <mesh position={[0, 11, 0]} castShadow>
        <cylinderGeometry args={[1.6, 2.0, 22, 8]} />
        <meshStandardMaterial color="#a08a6a" flatShading />
      </mesh>
      <mesh position={[0, 26, 0]} castShadow>
        <boxGeometry args={[width, height, 1.6]} />
        <meshStandardMaterial color="#fffdf7" />
      </mesh>
      <mesh position={[0, 26, 0.95]}>
        <planeGeometry args={[width - 1.4, height - 1.4]} />
        <meshBasicMaterial map={tex} transparent />
      </mesh>
      <mesh position={[0, 26, -0.95]} rotation={[0, Math.PI, 0]}>
        <planeGeometry args={[width - 1.4, height - 1.4]} />
        <meshBasicMaterial map={tex} transparent />
      </mesh>
    </group>
  );
}

function Edge({
  a,
  b,
  kind,
  label,
  onSign,
}: {
  a: THREE.Vector3;
  b: THREE.Vector3;
  kind: string;
  label: string;
  onSign: () => void;
}) {
  const curve = useMemo(() => {
    // 完全贴地：所有点高度 y=0，只在 XZ 平面里弯
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
  }, [a, b]);
  const pts = useMemo(
    () => curve.getPoints(26).map((p) => [p.x, p.y, p.z] as [number, number, number]),
    [curve],
  );
  const end = pts[pts.length - 1];
  const prev = pts[pts.length - 2];
  const q = useMemo(() => {
    const dir = new THREE.Vector3(end[0] - prev[0], end[1] - prev[1], end[2] - prev[2]).normalize();
    return new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
  }, [end, prev]);
  const mid = curve.getPoint(0.5);
  const color = EDGE_COLORS[kind] ?? EDGE_COLORS.formal;
  return (
    <group>
      <Line
        points={pts}
        color={color}
        lineWidth={1.4}
        transparent
        opacity={kind === "direction" ? 0.35 : 0.55}
        dashed={kind === "suggest"}
        dashSize={6}
        gapSize={6}
      />
      <mesh position={end} quaternion={q}>
        <coneGeometry args={[3.2, 9, 6]} />
        <meshBasicMaterial color={color} transparent opacity={0.65} />
      </mesh>
      {(kind === "direction" || kind === "suggest") && label ? (
        <SignPost position={[mid.x, 0, mid.z]} label={label} onOpen={onSign} />
      ) : null}
    </group>
  );
}

/** 进入世界时自动把全部节点 + 副本框进视野 */
function CameraFit({ points }: { points: [number, number, number][] }) {
  const camera = useThree((s) => s.camera);
  const controls = useThree((s) => s.controls) as any;
  const signature = points.length;
  useEffect(() => {
    if (!points.length) return;
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (const [x, , z] of points) {
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
  }, [signature, camera, controls]);
  return null;
}

export default function World3D() {
  const nodes = useStore((s) => s.nodes);
  const edges = useStore((s) => s.edges);
  const buildings = useStore((s) => s.buildings);
  const openNode = useStore((s) => s.openNode);
  const openBuilding = useStore((s) => s.openBuilding);
  const openEdge = useStore((s) => s.openEdge);
  const newNodeIds = useStore((s) => s.newNodeIds);
  const mentions = useStore((s) => s.mentions);
  const ghosts = useStore((s) => s.ghosts);
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
        {nodes.map((n) => (
          <Island
            key={n.id}
            position={posOf(n.x, n.y)}
            node={n}
            onOpen={() => openNode(n.id)}
            appearing={newNodeIds.includes(n.id)}
            mentioned={mentions.includes(n.id)}
          />
        ))}
        {ghosts.map((g, i) => {
          const anchor = nodes.find((n) => n.id === focusId) ?? nodes[0];
          if (!anchor) return null;
          const x = anchor.x + 190 + (i % 3) * 120;
          const y = anchor.y + (i % 2 === 0 ? -110 : 120) + Math.floor(i / 3) * 130;
          return <GhostIsland key={`${g.name}-${i}`} position={posOf(x, y)} name={g.name} role={g.role} />;
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
              <group key={e.id}>
                <Line
                  points={[
                    [a.x, 2, a.z],
                    [f.x, 2, f.z],
                  ]}
                  color="#b9ab97"
                  lineWidth={1.4}
                  dashed
                  dashSize={6}
                  gapSize={6}
                  transparent
                  opacity={0.5}
                />
                <SignPost
                  position={[f.x, 0, f.z]}
                  label={e.question || "下一步方向"}
                  onOpen={() => openEdge(e.id)}
                />
              </group>
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
              onSign={() => openEdge(e.id)}
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
        <OrbitControls
          makeDefault
          enablePan
          minDistance={300}
          maxDistance={2600}
          maxPolarAngle={Math.PI / 2.15}
          target={[0, 0, 0]}
        />
        <CameraFit points={worldPoints} />
      </Canvas>
      <div className="hud3d">
        <div className="badge">3D · 拖拽旋转 · 滚轮缩放 · 点岛查看</div>
      </div>
    </div>
  );
}
