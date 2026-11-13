import { Handle, Position } from "@xyflow/react";

const INK = "#2a2620";
const SIDE = "#e2d8c6";
const TOP = "#fffdf7";

/** 2.5D 等距浮岛：三档形态（核心 / 带环 / 双环+塔） */
export default function IslandNode({ data }: any) {
  const tier: number = data.tier ?? 0;
  const name: string = data.name ?? "";
  const hidden: boolean = !!data.hidden;
  const unknown: boolean = !!data.unknown;
  const passed = data.passed ?? { short: 0, judge: 0 };

  return (
    <div className={"island" + (hidden || unknown ? " hidden-node" : "")}>
      <Handle type="target" position={Position.Top} style={{ opacity: 0 }} />
      <svg width={140} height={110} viewBox="0 0 140 110">
        <ellipse cx="70" cy="92" rx="42" ry="9" fill="rgba(0,0,0,.10)" />
        {/* 侧面 */}
        <path d="M24 56 L70 79 L70 89 L24 66 Z" fill={SIDE} stroke={INK} strokeWidth="1.2" />
        <path d="M116 56 L70 79 L70 89 L116 66 Z" fill="#d6cbb8" stroke={INK} strokeWidth="1.2" />
        {/* 顶面 */}
        <path d="M70 33 L116 56 L70 79 L24 56 Z" fill={TOP} stroke={INK} strokeWidth="1.4" />
        {/* 地标：按档位 */}
        {tier >= 3 ? (
          <>
            <rect x="63" y="34" width="14" height="22" fill="#fff" stroke={INK} strokeWidth="1.2" />
            <path d="M60 34 L70 24 L80 34 Z" fill="#fff" stroke={INK} strokeWidth="1.2" />
            <line x1="70" y1="24" x2="70" y2="18" stroke={INK} strokeWidth="1.2" />
            <circle cx="70" cy="16" r="2.4" fill={INK} />
            <ellipse cx="70" cy="62" rx="34" ry="11" fill="none" stroke={INK} strokeWidth="0.8" opacity=".6" />
            <ellipse cx="70" cy="62" rx="42" ry="14" fill="none" stroke={INK} strokeWidth="0.6" opacity=".35" />
          </>
        ) : tier >= 2 ? (
          <>
            <path d="M58 48 L70 42 L82 48 L70 54 Z" fill="#fff" stroke={INK} strokeWidth="1.2" />
            <rect x="62" y="51" width="16" height="10" fill="#fff" stroke={INK} strokeWidth="1.2" />
            <ellipse cx="70" cy="63" rx="34" ry="11" fill="none" stroke={INK} strokeWidth="0.8" opacity=".6" />
          </>
        ) : tier >= 1 ? (
          <>
            <path d="M58 50 L70 44 L82 50 L70 56 Z" fill="#fff" stroke={INK} strokeWidth="1.2" />
            <rect x="62" y="53" width="16" height="8" fill="#fff" stroke={INK} strokeWidth="1.2" />
          </>
        ) : (
          <ellipse cx="70" cy="56" rx="9" ry="4" fill="#fff" stroke={INK} strokeWidth="1.2" />
        )}
        <text className="name" x="70" y="103">
          {unknown ? "???" : name}
        </text>
      </svg>
      {tier > 0 && (
        <div className="badge-tier" style={{ left: 70, top: 12 }}>
          {"ⅠⅡⅢ"[tier - 1] ?? tier}
        </div>
      )}
      {passed.short + passed.judge > 0 && (
        <div style={{ position: "absolute", left: 114, top: 96, fontSize: 9, color: "#8a8278" }}>
          {passed.short}/5 · {passed.judge}/10
        </div>
      )}
      <Handle type="source" position={Position.Bottom} style={{ opacity: 0 }} />
    </div>
  );
}
