import {
  BaseEdge,
  EdgeLabelRenderer,
  getSmoothStepPath,
  type EdgeProps,
} from "@xyflow/react";

const COLORS: Record<string, string> = {
  formal: "#2a2620",
  source: "#6e8fa8",
  suggest: "#8a8278",
  direction: "#a79e90",
};

/**
 * 四种线型 + 明确方向：
 * formal/source 实线带箭头；suggest 虚线带箭头；direction 点线指到悬空 ?。
 * 同一条边的 bend 偏移由 World 计算，避免两条边叠在一起。
 */
export default function KwEdge(props: EdgeProps) {
  const {
    sourceX,
    sourceY,
    targetX,
    targetY,
    sourcePosition,
    targetPosition,
    data,
  } = props;
  const d = (data ?? {}) as any;
  const kind = d.kind ?? "formal";
  const color = COLORS[kind] ?? COLORS.formal;
  const bend: number = d.bend ?? 0;

  // 中点垂直偏移，避免同一对节点的多条线重叠
  const mx = (sourceX + targetX) / 2;
  const my = (sourceY + targetY) / 2;
  const dx = targetX - sourceX;
  const dy = targetY - sourceY;
  const len = Math.hypot(dx, dy) || 1;
  const ox = (-dy / len) * bend * 26;
  const oy = (dx / len) * bend * 26;

  const [path, labelX, labelY] = getSmoothStepPath({
    sourceX,
    sourceY,
    targetX,
    targetY,
    sourcePosition,
    targetPosition,
    borderRadius: 18,
    offset: 26,
    centerX: mx + ox,
    centerY: my + oy,
  });

  const dashed = kind === "suggest";
  const dotted = kind === "direction";
  const width = kind === "formal" ? 1.8 : kind === "source" ? 1.6 : 1.2;

  const style: React.CSSProperties = {
    stroke: color,
    strokeWidth: width,
    strokeDasharray: dashed ? "6 5" : dotted ? "1 6" : undefined,
    strokeLinecap: "round",
  };

  const arrowId =
    kind === "source"
      ? "kw-arrow-source"
      : kind === "suggest"
        ? "kw-arrow-suggest"
        : kind === "direction"
          ? "kw-arrow-direction"
          : "kw-arrow-formal";

  return (
    <>
      <BaseEdge path={path} style={style} markerEnd={`url(#${arrowId})`} />
      {/* 起点圆点：一眼看出 A → B */}
      {kind !== "direction" && (
        <circle cx={sourceX} cy={sourceY} r={2.6} fill={color} stroke="#fffdf7" strokeWidth={1} />
      )}
      {(kind === "suggest" || kind === "source") && d.label && (
        <EdgeLabelRenderer>
          <div
            style={{
              position: "absolute",
              transform: `translate(-50%,-50%) translate(${labelX}px,${labelY}px)`,
              pointerEvents: "none",
              fontSize: 10,
              color: "#6e6558",
              background: "rgba(255,253,247,.94)",
              border: "1px solid rgba(60,50,40,.14)",
              borderRadius: 999,
              padding: "1px 7px",
              whiteSpace: "nowrap",
              maxWidth: 170,
              overflow: "hidden",
              textOverflow: "ellipsis",
            }}
          >
            {d.label}
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  );
}
