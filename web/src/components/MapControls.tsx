import { useStore } from "../store";

const LABEL: Record<string, string> = {
  relation: "关系",
  sequence: "序列",
  hint: "提示",
  exploration: "方向",
};

/** 地图四类线计数 + 渐进披露开关。默认克制，用户可展开。 */
export default function MapControls() {
  const edges = useStore((s) => s.edges);
  const mapExpand = useStore((s) => s.mapExpand);
  const toggleMapExpand = useStore((s) => s.toggleMapExpand);
  const counts: Record<string, number> = { relation: 0, sequence: 0, hint: 0, exploration: 0 };
  for (const e of edges) {
    const t =
      e.line_type ??
      (e.kind === "formal" ? "relation" : e.kind === "source" ? "sequence" : e.kind === "suggest" ? "hint" : "exploration");
    counts[t] = (counts[t] ?? 0) + 1;
  }
  return (
    <div
      className="map-controls"
      style={{
        position: "absolute",
        right: 16,
        bottom: 96,
        background: "rgba(255,253,247,.92)",
        border: "1px solid #e2d8c6",
        borderRadius: 10,
        padding: "8px 10px",
        fontSize: 12,
        color: "#5c5142",
        zIndex: 5,
      }}
    >
      <div style={{ marginBottom: 4 }}>
        {(["relation", "sequence", "hint", "exploration"] as const).map((k) => (
          <span key={k} style={{ marginRight: 8 }}>
            {LABEL[k]} {counts[k]}
          </span>
        ))}
      </div>
      <button className="secondary" onClick={toggleMapExpand}>
        {mapExpand ? "收起：只看重点" : "展开：显示全部关系"}
      </button>
      <div className="hintline" style={{ marginTop: 4 }}>
        {mapExpand ? "当前显示全部线索" : "默认提示 top2 / 方向 2"}
      </div>
    </div>
  );
}
