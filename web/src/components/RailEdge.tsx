import { EdgeLabelRenderer, type EdgeProps } from "@xyflow/react";

const COLORS: Record<string, string> = {
  formal: "#2a2620",
  source: "#4f7a9a",
  suggest: "#8a8278",
  direction: "#a79e90",
};

/** 折线铁路：从节点底部尖端出发，落地、横向、再抬起到目标底部尖端 */
function railPoints(sx: number, sy: number, tx: number, ty: number, bend: number) {
  const drop = 34 + Math.abs(bend) * 18;
  const mid = sx + (tx - sx) / 2 + bend * 44;
  return [
    { x: sx, y: sy },
    { x: sx, y: sy + drop },
    { x: mid, y: sy + drop },
    { x: mid, y: ty + drop },
    { x: tx, y: ty + drop },
    { x: tx, y: ty },
  ];
}

function toPath(points: { x: number; y: number }[], r = 10) {
  // 圆角折线
  let d = `M ${points[0].x} ${points[0].y}`;
  for (let i = 1; i < points.length - 1; i++) {
    const p = points[i];
    const prev = points[i - 1];
    const next = points[i + 1];
    const v1 = { x: p.x - prev.x, y: p.y - prev.y };
    const v2 = { x: next.x - p.x, y: next.y - p.y };
    const l1 = Math.hypot(v1.x, v1.y) || 1;
    const l2 = Math.hypot(v2.x, v2.y) || 1;
    const rr = Math.min(r, l1 / 2, l2 / 2);
    const a = { x: p.x - (v1.x / l1) * rr, y: p.y - (v1.y / l1) * rr };
    const b = { x: p.x + (v2.x / l2) * rr, y: p.y + (v2.y / l2) * rr };
    d += ` L ${a.x} ${a.y} Q ${p.x} ${p.y} ${b.x} ${b.y}`;
  }
  const last = points[points.length - 1];
  d += ` L ${last.x} ${last.y}`;
  return d;
}

function offsetLine(points: { x: number; y: number }[], off: number) {
  return points.map((p, i) => {
    const prev = points[Math.max(0, i - 1)];
    const next = points[Math.min(points.length - 1, i + 1)];
    const dx = next.x - prev.x;
    const dy = next.y - prev.y;
    const l = Math.hypot(dx, dy) || 1;
    return { x: p.x + (-dy / l) * off, y: p.y + (dx / l) * off };
  });
}

function sampleAlong(points: { x: number; y: number }[], step: number) {
  const out: { x: number; y: number; nx: number; ny: number }[] = [];
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i];
    const b = points[i + 1];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len = Math.hypot(dx, dy);
    if (!len) continue;
    const ux = dx / len;
    const uy = dy / len;
    for (let t = step / 2; t < len; t += step) {
      out.push({ x: a.x + ux * t, y: a.y + uy * t, nx: -uy, ny: ux });
    }
  }
  return out;
}

export default function RailEdge(props: EdgeProps) {
  const { id, sourceX, sourceY, targetX, targetY, data } = props;
  const d = (data ?? {}) as any;
  const kind: string = d.kind ?? "formal";
  const color = COLORS[kind] ?? COLORS.formal;
  const bend: number = d.bend ?? 0;

  const pts = railPoints(sourceX, sourceY, targetX, targetY, bend);
  const path = toPath(pts);
  const left = toPath(offsetLine(pts, 2.6));
  const right = toPath(offsetLine(pts, -2.6));
  const sleepers = sampleAlong(pts, 13);

  const signX = (sourceX + targetX) / 2 + bend * 20;
  const signY = (sourceY + targetY) / 2 + 20;

  const isDirection = kind === "direction";
  const label = isDirection ? d.question || "下一步方向" : d.label || "关系";

  return (
    <>
      {/* 道砟 + 枕木 + 双轨 */}
      <path d={path} fill="none" stroke="#e2d1b4" strokeWidth={15} strokeLinecap="round" strokeLinejoin="round" />
      {sleepers.map((s, i) => (
        <line
          key={i}
          x1={s.x + s.nx * 5.5}
          y1={s.y + s.ny * 5.5}
          x2={s.x - s.nx * 5.5}
          y2={s.y - s.ny * 5.5}
          stroke="#b9a98a"
          strokeWidth={1.4}
        />
      ))}
      <path d={left} fill="none" stroke={color} strokeWidth={1.9} />
      <path d={right} fill="none" stroke={color} strokeWidth={1.9} />
      {kind === "suggest" && (
        <path d={path} fill="none" stroke="#fffdf7" strokeWidth={1} strokeDasharray="4 6" opacity={0.8} />
      )}

      <EdgeLabelRenderer>
        <button
          className={"rail-sign" + (isDirection ? " dir" : "") + (kind === "suggest" ? " suggest" : "")}
          style={{
            position: "absolute",
            transform: `translate(-50%,-50%) translate(${signX}px,${signY}px)`,
            pointerEvents: "all",
          }}
          title={isDirection ? "方向提示：点击查看问题" : label}
          onClick={(e) => {
            e.stopPropagation();
            d.onSign?.(id);
          }}
        >
          <span className="rail-sign-icon">{isDirection ? "?" : kind === "suggest" ? "◌" : "▸"}</span>
          <span className="rail-sign-text">{label}</span>
        </button>
      </EdgeLabelRenderer>
    </>
  );
}
