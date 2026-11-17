import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { Html, useGLTF } from "@react-three/drei";
import * as THREE from "three";
import { useStore } from "../store";
import { buildingModelUrl, islandModelUrl } from "../models3d";

const ACCENTS = ["#c97b6b", "#7e8fa8", "#a76b6b", "#6e8c83", "#b0805a", "#8a7080"];

function hash(s: string) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

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
      <Html center position={[0, 118, 0]} zIndexRange={[20, 0]} style={{ pointerEvents: "none" }}>
        <div className="b3d-label">{building.kind === "flow" ? "流程副本" : "领域副本"}</div>
      </Html>
    </group>
  );
}

/** 贴地弧线：两端切线更顺的缓弧，避免长线看起来像硬折 */
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

export { Building, CameraFit, GhostIsland, Island };
