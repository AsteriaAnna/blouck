import {
  BaseEdge,
  EdgeLabelRenderer,
  getBezierPath,
  type EdgeProps,
} from "@xyflow/react";

/**
 * 四种线型（对应 MVP 文档）：
 * formal 正式关系 / source 探索来源 / suggest 虚线建议 / direction 方向线（无 MD）
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
  const kind = (data as any)?.kind ?? "formal";
  const label = (data as any)?.label ?? "";
  const question = (data as any)?.question ?? "";

  const [path, labelX, labelY] = getBezierPath({
    sourceX,
    sourceY,
    targetX,
    targetY,
    sourcePosition,
    targetPosition,
    curvature: 0.25,
  });

  const style: React.CSSProperties =
    kind === "formal"
      ? { stroke: "#2a2620", strokeWidth: 1.7 }
      : kind === "source"
        ? { stroke: "#6e8fa8", strokeWidth: 1.5 }
        : kind === "suggest"
          ? { stroke: "#8a8278", strokeWidth: 1.2, strokeDasharray: "6 5" }
          : { stroke: "#a79e90", strokeWidth: 1.1, strokeDasharray: "1 5" };

  return (
    <>
      <BaseEdge path={path} style={style} markerEnd={undefined} />
      {kind !== "formal" && (label || question || kind === "direction") && (
        <EdgeLabelRenderer>
          <div
            style={{
              position: "absolute",
              transform: `translate(-50%,-50%) translate(${labelX}px,${labelY}px)`,
              pointerEvents: "none",
              fontSize: 10,
              color: "#6e6558",
              background: "rgba(255,253,247,.92)",
              border: "1px solid rgba(60,50,40,.14)",
              borderRadius: 999,
              padding: "1px 7px",
              whiteSpace: "nowrap",
              maxWidth: 180,
              overflow: "hidden",
              textOverflow: "ellipsis",
            }}
          >
            {kind === "direction" ? "? " + (question || "下一步方向") : label}
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  );
}
