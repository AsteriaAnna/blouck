import { Suspense, useMemo, useRef, useState } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
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
}: {
  position: [number, number, number];
  node: any;
  onOpen: () => void;
}) {
  const [hover, setHover] = useState(false);
  const ref = useRef<THREE.Group>(null);
  const seed = hash(node.id);
  const accent = ACCENTS[seed % ACCENTS.length];
  const tier = node.tier ?? 0;

  useFrame((_, dt) => {
    if (!ref.current) return;
    const target = hover ? 1.1 : 1;
    ref.current.scale.lerp(new THREE.Vector3(target, target, target), Math.min(1, dt * 8));
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
      </group>
      <Html center position={[0, 92, 0]} zIndexRange={[30, 0]} style={{ pointerEvents: "none" }}>
        <div className="n3d-label">
          <span className="dot" style={{ background: accent }} />
          {node.name}
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

export default function World3D() {
  const nodes = useStore((s) => s.nodes);
  const edges = useStore((s) => s.edges);
  const buildings = useStore((s) => s.buildings);
  const openNode = useStore((s) => s.openNode);
  const openBuilding = useStore((s) => s.openBuilding);
  const openEdge = useStore((s) => s.openEdge);

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
          <Island key={n.id} position={posOf(n.x, n.y)} node={n} onOpen={() => openNode(n.id)} />
        ))}
        {edges.map((e) => {
          const a = nodePos.get(e.src);
          const b = nodePos.get(e.dst);
          if (!a || !b) return null;
          const label = e.kind === "direction" ? e.question || "下一步方向" : e.label || "";
          return (
            <Edge
              key={e.id}
              a={a.clone().setY(0)}
              b={b.clone().setY(0)}
              kind={e.kind}
              label={label}
              onSign={() => openEdge(e.id)}
            />
          );
        })}
        {buildings.map((b) => {
          const anchor = nodes.find((n) => n.id === b.anchor);
          if (!anchor) return null;
          const [x, , z] = posOf(anchor.x, anchor.y);
          return (
            <Building
              key={b.id}
              position={[x + 190, 0, z + 70]}
              building={b}
              onOpen={() => openBuilding(b.id)}
            />
          );
        })}
        <OrbitControls
          enablePan
          minDistance={300}
          maxDistance={2600}
          maxPolarAngle={Math.PI / 2.15}
          target={[0, 0, 0]}
        />
      </Canvas>
      <div className="hud3d">
        <div className="badge">3D · 拖拽旋转 · 滚轮缩放 · 点岛查看</div>
      </div>
    </div>
  );
}
