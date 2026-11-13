import { useMemo, useRef, useState } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import { Html, Line, OrbitControls } from "@react-three/drei";
import * as THREE from "three";
import { useStore } from "../store";

const PALETTES = [
  { roof: "#c97b6b", accent: "#6fa8b8" },
  { roof: "#7e8fa8", accent: "#c98a5e" },
  { roof: "#a76b6b", accent: "#8e7bb0" },
  { roof: "#6e8c83", accent: "#c9a05b" },
  { roof: "#b0805a", accent: "#6b8fa8" },
  { roof: "#8a7080", accent: "#a88a5e" },
];

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

function Island({
  position,
  node,
  pal,
  onOpen,
}: {
  position: [number, number, number];
  node: any;
  pal: { roof: string; accent: string };
  onOpen: () => void;
}) {
  const [hover, setHover] = useState(false);
  const ref = useRef<THREE.Group>(null);
  useFrame((_, dt) => {
    if (!ref.current) return;
    const target = hover ? 1.12 : 1;
    ref.current.scale.lerp(new THREE.Vector3(target, target, target), Math.min(1, dt * 8));
    ref.current.position.y += Math.sin(performance.now() / 1400 + position[0]) * 0.02;
  });
  const tier = node.tier ?? 0;
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
        {/* 岛体 */}
        <mesh castShadow receiveShadow position={[0, -8, 0]}>
          <cylinderGeometry args={[52, 40, 16, 7]} />
          <meshStandardMaterial color="#e4d8c2" flatShading />
        </mesh>
        <mesh castShadow receiveShadow position={[0, 2, 0]}>
          <cylinderGeometry args={[50, 50, 6, 7]} />
          <meshStandardMaterial color="#fffdf7" flatShading />
        </mesh>
        {/* 地标 */}
        {tier >= 3 ? (
          <group>
            <mesh position={[0, 28, 0]} castShadow>
              <boxGeometry args={[22, 40, 22]} />
              <meshStandardMaterial color="#fffdf7" />
            </mesh>
            <mesh position={[0, 52, 0]} castShadow>
              <coneGeometry args={[18, 18, 4]} />
              <meshStandardMaterial color={pal.roof} />
            </mesh>
          </group>
        ) : (
          <group>
            <mesh position={[0, 20, 0]} castShadow>
              <boxGeometry args={[26, 24, 26]} />
              <meshStandardMaterial color="#fffdf7" />
            </mesh>
            <mesh position={[0, 36, 0]} castShadow>
              <coneGeometry args={[20, 14, 4]} />
              <meshStandardMaterial color={pal.roof} />
            </mesh>
          </group>
        )}
        {/* 树 */}
        <group position={[30, 4, -16]}>
          <mesh position={[0, 10, 0]}>
            <cylinderGeometry args={[2.4, 2.4, 16, 6]} />
            <meshStandardMaterial color="#8a7a63" />
          </mesh>
          <mesh position={[0, 22, 0]} castShadow>
            <sphereGeometry args={[9, 10, 8]} />
            <meshStandardMaterial color="#7f9a74" flatShading />
          </mesh>
        </group>
        {/* 等级环 */}
        {tier >= 1 && (
          <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 4, 0]}>
            <torusGeometry args={[tier >= 3 ? 64 : 56, 1.4, 8, 48]} />
            <meshStandardMaterial color={pal.accent} transparent opacity={0.8} />
          </mesh>
        )}
      </group>
      <Html center position={[0, 72, 0]} zIndexRange={[20, 0]} style={{ pointerEvents: "none" }}>
        <div className="n3d-label">
          <span className="dot" style={{ background: pal.roof }} />
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
  const isFlow = building.kind === "flow";
  return (
    <group
      position={position}
      onPointerDown={(e) => {
        e.stopPropagation();
        onOpen();
      }}
    >
      <mesh castShadow receiveShadow position={[0, -4, 0]}>
        <cylinderGeometry args={[44, 36, 12, 7]} />
        <meshStandardMaterial color="#e4d8c2" flatShading />
      </mesh>
      {isFlow ? (
        <group>
          <mesh position={[-18, 26, 0]} castShadow>
            <boxGeometry args={[8, 52, 8]} />
            <meshStandardMaterial color="#cfc4ae" />
          </mesh>
          <mesh position={[18, 26, 0]} castShadow>
            <boxGeometry args={[8, 52, 8]} />
            <meshStandardMaterial color="#cfc4ae" />
          </mesh>
          <mesh position={[0, 56, 0]} castShadow>
            <boxGeometry args={[52, 8, 10]} />
            <meshStandardMaterial color="#8e7bb0" />
          </mesh>
        </group>
      ) : (
        <group>
          <mesh position={[0, 30, 0]} castShadow>
            <cylinderGeometry args={[16, 20, 48, 8]} />
            <meshStandardMaterial color="#fffdf7" />
          </mesh>
          <mesh position={[0, 62, 0]} castShadow>
            <coneGeometry args={[22, 22, 6]} />
            <meshStandardMaterial color="#6fa8b8" />
          </mesh>
        </group>
      )}
      <Html center position={[0, 92, 0]} style={{ pointerEvents: "none" }}>
        <div className="b3d-label">{building.kind === "flow" ? "流程副本" : "领域副本"}</div>
      </Html>
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
    const mid = a.clone().add(b).multiplyScalar(0.5);
    mid.y += Math.min(140, a.distanceTo(b) * 0.18);
    return new THREE.QuadraticBezierCurve3(a, mid, b);
  }, [a, b]);
  const pts = useMemo(() => curve.getPoints(26).map((p) => [p.x, p.y, p.z] as [number, number, number]), [curve]);
  const end = pts[pts.length - 1];
  const prev = pts[pts.length - 2];
  const q = useMemo(() => {
    const dir = new THREE.Vector3(end[0] - prev[0], end[1] - prev[1], end[2] - prev[2]).normalize();
    return new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
  }, [end, prev]);
  const mid = curve.getPoint(0.5);
  const dashed = kind === "suggest";
  const color = EDGE_COLORS[kind] ?? EDGE_COLORS.formal;
  return (
    <group>
      <Line
        points={pts}
        color={color}
        lineWidth={1.4}
        transparent
        opacity={kind === "direction" ? 0.35 : 0.55}
        dashed={dashed}
        dashSize={6}
        gapSize={6}
      />
      <mesh position={end} quaternion={q}>
        <coneGeometry args={[3.2, 9, 6]} />
        <meshBasicMaterial color={color} transparent opacity={0.65} />
      </mesh>
      {(kind === "direction" || kind === "suggest") && label ? (
        <Html center position={[mid.x, mid.y + 18, mid.z]}>
          <button className="rail-board sign3d" onClick={onSign}>
            {label}
          </button>
        </Html>
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
    if (!nodes.length) return { cx: 0, cy: 0, scale: 0.8 };
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
        <ambientLight intensity={0.85} />
        <hemisphereLight args={["#fffdf7", "#d8cbb5", 0.5]} />
        <directionalLight
          position={[700, 1200, 500]}
          intensity={1.15}
          castShadow
          shadow-mapSize-width={2048}
          shadow-mapSize-height={2048}
        />
        {nodes.map((n) => {
          const seed = hash(n.id);
          return (
            <Island
              key={n.id}
              position={posOf(n.x, n.y)}
              node={n}
              pal={PALETTES[seed % PALETTES.length]}
              onOpen={() => openNode(n.id)}
            />
          );
        })}
        {edges.map((e) => {
          const a = nodePos.get(e.src);
          const b = nodePos.get(e.dst);
          if (!a || !b) return null;
          const label = e.kind === "direction" ? e.question || "下一步方向" : e.label || "";
          return (
            <Edge
              key={e.id}
              a={a.clone().setY(26)}
              b={b.clone().setY(26)}
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
              position={[x + 170, 0, z + 60]}
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
