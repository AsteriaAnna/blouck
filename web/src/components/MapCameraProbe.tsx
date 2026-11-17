import { useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { useStore } from "../store";

/** 镜头高度跨过阈值时切换披露层级；只在切换时写 store，避免每帧重渲染。 */
export default function MapCameraProbe() {
  const camera = useThree((s) => s.camera);
  const controls = useThree((s) => s.controls) as any;
  const base = useStore((s) => s.mapBaseDistance);
  const setMapZoom = useStore((s) => s.setMapZoom);
  const current = useRef<"far" | "near">("far");

  useFrame(() => {
    const target = controls?.target;
    const distance = target ? camera.position.distanceTo(target) : camera.position.length();
    if ((import.meta as any).env?.DEV) {
      (window as any).__mapCamera = {
        x: Math.round(camera.position.x),
        y: Math.round(camera.position.y),
        z: Math.round(camera.position.z),
        distance: Math.round(distance),
        base: Math.round(base),
        at: performance.now(),
      };
    }
    // 用“距离 / fit 基线”判断缩放；旋转不改变距离，不会误触发“拉近”。
    const next = base > 0 ? (distance < base * 0.8 ? "near" : "far") : camera.position.y < 720 ? "near" : "far";
    if (next !== current.current) {
      current.current = next;
      setMapZoom(next);
    }
  });
  return null;
}
