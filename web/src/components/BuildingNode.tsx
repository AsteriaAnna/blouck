import { Handle, Position } from "@xyflow/react";

const INK = "#2a2620";
const TOP = "#fffdf7";
const SIDE = "#e2d8c6";

/** 副本建筑：领域副本 = 塔 + 环；流程副本 = 门 + 阶 */
export default function BuildingNode({ data }: any) {
  const flow = data.kind === "flow";
  const locked = data.status === "locked";
  const cleared = data.status === "cleared";
  const accent = flow ? "#6fa8b8" : "#c9a05b";

  const cx = 95;
  const baseY = 110;

  return (
    <div className={"building-wrap" + (locked ? " locked" : "")}>
      <Handle type="target" position={Position.Top} style={{ opacity: 0 }} />
      <svg width={190} height={140} viewBox="0 0 190 140">
        <ellipse cx={cx} cy={124} rx={54} ry={7} fill="rgba(0,0,0,.10)" />
        {/* 底座 */}
        <path d={`M${cx} 84 L${cx + 50} ${baseY} L${cx} ${baseY + 18} L${cx - 50} ${baseY} Z`} fill={TOP} stroke={INK} strokeWidth="1.3" />
        <path d={`M${cx - 50} ${baseY} L${cx} ${baseY + 18} L${cx} ${baseY + 26} L${cx - 50} ${baseY + 8} Z`} fill={SIDE} stroke={INK} strokeWidth="1.1" />
        <path d={`M${cx + 50} ${baseY} L${cx} ${baseY + 18} L${cx} ${baseY + 26} L${cx + 50} ${baseY + 8} Z`} fill="#d6cbb8" stroke={INK} strokeWidth="1.1" />

        {/* 光环 */}
        <ellipse cx={cx} cy={baseY - 2} rx={flow ? 42 : 36} ry={flow ? 14 : 12} fill="none" stroke={accent} strokeWidth="1.4" opacity=".8" />
        <ellipse cx={cx} cy={baseY - 2} rx={flow ? 52 : 46} ry={flow ? 18 : 16} fill="none" stroke={accent} strokeWidth=".8" opacity=".4" strokeDasharray="3 5" />

        {flow ? (
          <g>
            {/* 流程门 */}
            <rect x={cx - 26} y={42} width="10" height="40" fill={TOP} stroke={INK} strokeWidth="1.2" />
            <rect x={cx + 16} y={42} width="10" height="40" fill={TOP} stroke={INK} strokeWidth="1.2" />
            <path d={`M${cx - 32} 42 L${cx} 28 L${cx + 32} 42 L${cx + 32} 50 L${cx} 36 L${cx - 32} 50 Z`} fill={accent} stroke={INK} strokeWidth="1.2" />
            <line x1={cx} y1={28} x2={cx} y2={18} stroke={INK} strokeWidth="1.2" />
            <circle cx={cx} cy={16} r="3" fill={accent} stroke={INK} strokeWidth=".8" />
            {/* 台阶 */}
            <line x1={cx - 16} y1={baseY + 4} x2={cx + 16} y2={baseY + 4} stroke={INK} strokeWidth="1" opacity=".6" />
            <line x1={cx - 22} y1={baseY + 10} x2={cx + 22} y2={baseY + 10} stroke={INK} strokeWidth="1" opacity=".45" />
          </g>
        ) : (
          <g>
            {/* 领域塔 */}
            <rect x={cx - 13} y={44} width="26" height="34" fill={TOP} stroke={INK} strokeWidth="1.2" />
            <ellipse cx={cx} cy={44} rx="13" ry="4.5" fill={TOP} stroke={INK} strokeWidth="1.1" />
            <path d={`M${cx - 17} 44 L${cx} 26 L${cx + 17} 44 Z`} fill={accent} stroke={INK} strokeWidth="1.2" />
            <line x1={cx} y1={26} x2={cx} y2={16} stroke={INK} strokeWidth="1.2" />
            <circle cx={cx} cy={14} r="3" fill={accent} stroke={INK} strokeWidth=".8" />
            {/* 小窗 */}
            <rect x={cx - 3} y={52} width="6" height="8" fill="#2a2620" opacity=".8" />
            {/* 树 */}
            <line x1={cx + 36} y1={baseY} x2={cx + 36} y2={baseY - 10} stroke={INK} strokeWidth="1.1" />
            <circle cx={cx + 36} cy={baseY - 15} r="7" fill="#7e9a76" stroke={INK} strokeWidth="1" />
          </g>
        )}
      </svg>
      <div className="building-label">
        <span className="kind">{flow ? "流程副本" : "领域副本"}</span>
        <span className="name">{data.title}</span>
        <span className={"status" + (cleared ? " ok" : locked ? " lock" : "")}>
          {cleared ? "已通关" : locked ? "未解锁" : "可挑战"}
        </span>
      </div>
      <Handle type="source" position={Position.Bottom} style={{ opacity: 0 }} />
    </div>
  );
}
