import { useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { useStore } from "../store";

/** 镜头高度跨过阈值时切换披露层级；只在切换时写 store，避免每帧重渲染。 */
export default function MapCameraProbe() {
  const camera = useThree((s) => s.camera);
  const setMapZoom = useStore((s) => s.setMapZoom);
  const current = useRef<"far" | "near">("far");

  useFrame(() => {
    const next = camera.position.y < 720 ? "near" : "far";
    if (next !== current.current) {
      current.current = next;
      setMapZoom(next);
    }
  });
  return null;
}
