import { useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { Line } from "@react-three/drei";
import * as THREE from "three";

const EDGE_COLORS: Record<string, string> = {
  formal: "#6f6252",
  source: "#5f8f86",
  suggest: "#b8823f", // 待确认的线统一颜色（虚线）
  direction: "#8f8574",
};

function edgeCurve(a: THREE.Vector3, b: THREE.Vector3) {
  const s = a.clone().setY(0);
  const t = b.clone().setY(0);
  const dx = t.x - s.x;
  const dz = t.z - s.z;
  const len = Math.hypot(dx, dz) || 1;
  const bow = Math.min(110, Math.max(18, len * 0.16));
  const perp = new THREE.Vector3(-dz / len, 0, dx / len);
  const p1 = s.clone().add(t.clone().sub(s).multiplyScalar(1 / 3)).add(perp.clone().multiplyScalar(bow));
  const p2 = s.clone().add(t.clone().sub(s).multiplyScalar(2 / 3)).add(perp.clone().multiplyScalar(bow));
  return new THREE.CubicBezierCurve3(s, p1, p2, t);
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

/** 立体路牌：木柱 + 牌面（Canvas 文字），始终转向相机，可点击（建议线用） */
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
  const { tex, width, height } = useMemo(() => makeBoardTexture(label || "关系"), [label]);
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

/** 童话指路牌：旧版木柱路牌 + 地面方向箭头（箭头指向探索方向） */
function DirectionSign({
  position,
  angle,
  label,
  onOpen,
}: {
  position: [number, number, number];
  angle: number;
  label: string;
  onOpen: () => void;
}) {
  const arrow = useMemo(() => {
    const shape = new THREE.Shape();
    shape.moveTo(0, -5);
    shape.lineTo(20, 0);
    shape.lineTo(0, 5);
    shape.closePath();
    return shape;
  }, []);
  const groupRef = useRef<THREE.Group>(null);
  useFrame(({ clock }) => {
    if (groupRef.current) groupRef.current.position.y = Math.sin(clock.elapsedTime * 1.4) * 1.2;
  });
  return (
    <group ref={groupRef} position={position}>
      <SignPost position={[0, 0, 0]} label={label || "下一步方向"} onOpen={onOpen} />
      <group rotation={[0, -angle, 0]}>
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[8, 1.5, 0]}>
          <shapeGeometry args={[arrow]} />
          <meshStandardMaterial color="#a9814f" roughness={0.8} flatShading side={THREE.DoubleSide} />
        </mesh>
      </group>
      <mesh position={[0, 45, 0]}>
        <sphereGeometry args={[3, 10, 10]} />
        <meshStandardMaterial color="#f3d7a2" emissive="#e0a95e" emissiveIntensity={0.55} />
      </mesh>
    </group>
  );
}

function Edge({
  a,
  b,
  kind,
  label,
  onOpen,
}: {
  a: THREE.Vector3;
  b: THREE.Vector3;
  kind: string;
  label: string;
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
  const sourceArrow = useMemo(() => {
    if (kind !== "source") return null;
    const p = curve.getPoint(0.68);
    const tangent = curve.getTangent(0.68).normalize();
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), tangent);
    return { p, q };
  }, [curve, kind]);
  const tubeGeo = useMemo(
    () =>
      solid
        ? new THREE.TubeGeometry(curve, 28, kind === "source" ? 2.2 : 2.8, 6, false)
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
        {sourceArrow ? (
          <mesh
            position={[sourceArrow.p.x, 5, sourceArrow.p.z]}
            quaternion={[sourceArrow.q.x, sourceArrow.q.y, sourceArrow.q.z, sourceArrow.q.w]}
            castShadow
          >
            <coneGeometry args={[7, 18, 8]} />
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
        lineWidth={kind === "suggest" ? 2.0 : 1.5}
        transparent
        opacity={dotted ? 0.55 : 0.9}
        dashed
        dashSize={dotted ? 2 : 9}
        gapSize={dotted ? 10 : 7}
      />
      {kind === "suggest" && label ? (
        <SignPost position={[mid.x, 0, mid.z]} label={label} onOpen={onOpen} />
      ) : null}
      <HitTube curve={curve} onOpen={onOpen} radius={12} />
    </group>
  );
}

/** 方向线上的流动光点：让“可探索”可感知，而不是只看颜色。 */
function TravelingSpark({ curve, color }: { curve: THREE.Curve<THREE.Vector3>; color: string }) {
  const ref = useRef<THREE.Mesh>(null);
  useFrame(({ clock }) => {
    if (!ref.current) return;
    const t = (clock.elapsedTime * 0.16) % 1;
    const p = curve.getPointAt(t);
    ref.current.position.set(p.x, p.y + 7 + Math.sin(clock.elapsedTime * 3) * 2, p.z);
    const s = 1 + Math.sin(clock.elapsedTime * 4) * 0.18;
    ref.current.scale.setScalar(s);
    if ((import.meta as any).env?.DEV) {
      (window as any).__spark = { t, x: p.x, y: p.y, z: p.z, s, at: performance.now() };
    }
  });
  return (
    <mesh ref={ref}>
      <sphereGeometry args={[4.5, 12, 12]} />
      <meshStandardMaterial color={color} emissive={color} emissiveIntensity={0.9} />
    </mesh>
  );
}

/** 方向线：点线 + 流动光点 + 末端童话指路牌（木柱 + 箭头牌 + 可读文字牌） */
function DirectionEdge({
  a,
  b,
  label,
  onOpen,
}: {
  a: THREE.Vector3;
  b: THREE.Vector3;
  label: string;
  onOpen: () => void;
}) {
  const curve = useMemo(() => edgeCurve(a, b), [a, b]);
  const pts = useMemo(
    () => curve.getPoints(28).map((p) => [p.x, p.y, p.z] as [number, number, number]),
    [curve],
  );
  const angle = Math.atan2(b.z - a.z, b.x - a.x);
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
      <TravelingSpark curve={curve} color={EDGE_COLORS.direction} />
      <DirectionSign position={[b.x, 0, b.z]} angle={angle} label={label} onOpen={onOpen} />
    </group>
  );
}

/** 进入世界时自动把全部节点 + 副本框进视野；只在世界切换（worldId 变化）时 fit 一次，之后新增节点不改相机 */

export { Edge, DirectionEdge };
