import { Handle, Position } from "@xyflow/react";

const INK = "#2a2620";
const TOP = "#fffdf7";
const SIDE = "#e2d8c6";

const PALETTES = [
  { roof: "#c97b6b", accent: "#6fa8b8", tree: "#7e9a76" },
  { roof: "#7e8fa8", accent: "#c98a5e", tree: "#6e8c6a" },
  { roof: "#a76b6b", accent: "#8e7bb0", tree: "#8a9c6e" },
  { roof: "#6e8c83", accent: "#c9a05b", tree: "#7c9468" },
  { roof: "#b0805a", accent: "#6b8fa8", tree: "#7a936b" },
  { roof: "#8a7080", accent: "#a88a5e", tree: "#82966e" },
];
const GRAY = { roof: "#b6b0a6", accent: "#c2bcb2", tree: "#afa89e" };

function hash(s: string) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

type Pal = { roof: string; accent: string; tree: string };

function Tree({ x, y, s, pal }: { x: number; y: number; s: number; pal: Pal }) {
  return (
    <g>
      <line x1={x} y1={y} x2={x} y2={y - 12 * s} stroke={INK} strokeWidth="1.2" />
      <circle cx={x} cy={y - 18 * s} r={8 * s} fill={pal.tree} stroke={INK} strokeWidth="1" />
    </g>
  );
}

/** 每个节点都有自己的地标：房 / 塔 / 穹顶；档位只加环与体量 */
function Landmark({ cx, top, pal, variant, tier }: { cx: number; top: number; pal: Pal; variant: number; tier: number }) {
  const big = tier >= 2 ? 1.25 : 1;
  if (tier >= 3) {
    return (
      <g>
        <rect x={cx - 11} y={top + 6} width="22" height="34" fill={TOP} stroke={INK} strokeWidth="1.3" />
        <path d={`M${cx - 15} ${top + 6} L${cx} ${top - 10} L${cx + 15} ${top + 6} Z`} fill={pal.roof} stroke={INK} strokeWidth="1.2" />
        <line x1={cx} y1={top - 10} x2={cx} y2={top - 19} stroke={INK} strokeWidth="1.2" />
        <circle cx={cx} cy={top - 21} r="3" fill={pal.accent} stroke={INK} strokeWidth=".8" />
        <circle cx={cx + 46} cy={top - 24} r="3.4" fill={pal.accent} stroke={INK} strokeWidth=".8" />
        <line x1={cx + 22} y1={top - 18} x2={cx + 43} y2={top - 23} stroke={INK} strokeWidth=".7" strokeDasharray="2 3" opacity=".6" />
        <Tree x={cx - 44} y={top + 38} s={0.9} pal={pal} />
        <rect x={cx - 3} y={top + 22} width="6" height="8" fill={INK} opacity=".75" />
      </g>
    );
  }
  if (variant === 0) {
    return (
      <g>
        <rect x={cx - 13 * big} y={top + 16 * big} width={26 * big} height={22 * big} fill={TOP} stroke={INK} strokeWidth="1.3" />
        <path
          d={`M${cx - 18 * big} ${top + 16 * big} L${cx} ${top + 2 * big} L${cx + 18 * big} ${top + 16 * big} Z`}
          fill={pal.roof}
          stroke={INK}
          strokeWidth="1.2"
        />
        <line x1={cx + 36} y1={top + 38} x2={cx + 36} y2={top + 28} stroke={INK} strokeWidth="1.1" />
        <circle cx={cx + 36} cy={top + 22} r="7" fill={pal.tree} stroke={INK} strokeWidth="1" />
      </g>
    );
  }
  if (variant === 1) {
    return (
      <g>
        <rect x={cx - 10 * big} y={top + 10 * big} width={20 * big} height={28 * big} fill={TOP} stroke={INK} strokeWidth="1.3" />
        <ellipse cx={cx} cy={top + 10 * big} rx={10 * big} ry={3.4 * big} fill={TOP} stroke={INK} strokeWidth="1" />
        <path d={`M${cx - 14 * big} ${top + 10 * big} L${cx} ${top - 4 * big} L${cx + 14 * big} ${top + 10 * big} Z`} fill={pal.roof} stroke={INK} strokeWidth="1.2" />
        <line x1={cx} y1={top - 4 * big} x2={cx} y2={top - 14} stroke={INK} strokeWidth="1.1" />
        <circle cx={cx} cy={top - 16} r="2.6" fill={pal.accent} stroke={INK} strokeWidth=".7" />
        <Tree x={cx - 40} y={top + 38} s={0.8} pal={pal} />
      </g>
    );
  }
  return (
    <g>
      <path d={`M${cx - 16 * big} ${top + 36} Q${cx} ${top - 2} ${cx + 16 * big} ${top + 36} Z`} fill={TOP} stroke={INK} strokeWidth="1.3" />
      <line x1={cx} y1={top + 18} x2={cx} y2={top + 2} stroke={INK} strokeWidth="1.1" />
      <circle cx={cx} cy={top - 1} r="3" fill={pal.accent} stroke={INK} strokeWidth=".8" />
      <Tree x={cx + 34} y={top + 38} s={0.8} pal={pal} />
    </g>
  );
}

/** 等距浮岛节点（三档：核心 → Ⅰ环 → Ⅱ环+更大 → Ⅲ塔+双环+卫星） */
export default function IslandNode({ data }: any) {
  const tier: number = data.tier ?? 0;
  const name: string = data.name ?? "";
  const hidden: boolean = !!data.hidden;
  const unknown: boolean = !!data.unknown;
  const passed = data.passed ?? { short: 0, judge: 0 };
  const seed = hash((data.id ?? name) + "");
  const pal = unknown || hidden ? GRAY : PALETTES[seed % PALETTES.length];
  const variant = seed % 3;
  const cx = 95;
  const top = 66;
  const bottom = 128;
  const half = 68;

  return (
    <div className={"island-wrap" + (hidden || unknown ? " dim" : "")}>
      '<Handle id="t" type="target" position={Position.Top} style={{ opacity: 0 }} />
      <Handle id="r" type="target" position={Position.Right} style={{ opacity: 0 }} />
      <Handle id="b" type="target" position={Position.Bottom} style={{ opacity: 0 }} />
      <Handle id="l" type="target" position={Position.Left} style={{ opacity: 0 }} />'
      <svg width={190} height={150} viewBox="0 0 190 150">
        <ellipse cx={cx} cy={138} rx={60} ry={8} fill="rgba(0,0,0,.10)" />
        <path d="M56 118 L70 112 L78 122 L64 130 Z" fill={SIDE} stroke={INK} strokeWidth="1" opacity=".8" />
        <path d="M118 120 L130 116 L136 126 L122 131 Z" fill={SIDE} stroke={INK} strokeWidth="1" opacity=".7" />
        <path d={`M${cx - half} ${top + 2} L${cx} ${bottom} L${cx} ${bottom + 16} L${cx - half} ${top + 18} Z`} fill={SIDE} stroke={INK} strokeWidth="1.2" />
        <path d={`M${cx + half} ${top + 2} L${cx} ${bottom} L${cx} ${bottom + 16} L${cx + half} ${top + 18} Z`} fill="#d6cbb8" stroke={INK} strokeWidth="1.2" />
        <path d={`M${cx} ${top} L${cx + half} ${top + 33} L${cx} ${bottom} L${cx - half} ${top + 33} Z`} fill={TOP} stroke={INK} strokeWidth="1.4" />
        {tier >= 1 && (
          <ellipse cx={cx} cy={top + 38} rx={tier >= 3 ? 62 : 50} ry={tier >= 3 ? 19 : 14} fill="none" stroke={pal.accent} strokeWidth={tier >= 3 ? 1.6 : 1.2} opacity=".85" />
        )}
        {tier >= 3 && (
          <ellipse cx={cx} cy={top + 38} rx={72} ry={22} fill="none" stroke={pal.roof} strokeWidth=".9" opacity=".45" strokeDasharray="3 5" />
        )}
        <g transform={`translate(${cx} ${bottom}) scale(1.3) translate(${-cx} ${-bottom})`}>
          <Landmark cx={cx} top={top} pal={pal} variant={variant} tier={tier} />
        </g>
      </svg>
      <div className="island-label">
        <span className="dot" style={{ background: pal.roof }} />
        {unknown ? "???" : name}
        {tier > 0 && <span className="lv">{"ⅠⅡⅢ"[tier - 1]}</span>}
      </div>
      {passed.short + passed.judge > 0 && (
        <div className="island-sub">
          {passed.short}/5 · {passed.judge}/10
        </div>
      )}
      '<Handle id="t" type="source" position={Position.Top} style={{ opacity: 0 }} />
      <Handle id="r" type="source" position={Position.Right} style={{ opacity: 0 }} />
      <Handle id="b" type="source" position={Position.Bottom} style={{ opacity: 0 }} />
      <Handle id="l" type="source" position={Position.Left} style={{ opacity: 0 }} />'
    </div>
  );
}
