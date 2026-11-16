import ReactMarkdown from "react-markdown";
import { useStore } from "../store";

const PRED_LABEL: Record<string, string> = {
  kindOf: "归类",
  partOf: "组成",
  prerequisite: "前置",
  contrast: "对比",
  alternative: "替代",
  related: "相关",
};

const KIND_LABEL: Record<string, string> = {
  formal: "正式关系",
  source: "探索来源",
  suggest: "待确认",
  direction: "探索方向",
};

/** 用一句话说明两个节点是什么关系（按设计好的关系类型） */
function relationSentence(kind: string, predicate: string | null, from: string, to: string) {
  if (kind === "source") return `探索来源：「${to}」是从「${from}」探索出来的。`;
  const type = predicate ?? "related";
  const label = PRED_LABEL[type] ?? "相关";
  switch (type) {
    case "kindOf":
      return `归类关系：「${from}」是一种「${to}」。`;
    case "partOf":
      return `组成关系：「${from}」是「${to}」的一部分。`;
    case "prerequisite":
      return `前置关系：「${from}」是「${to}」的前置。`;
    case "contrast":
      return `对比关系：「${from}」与「${to}」形成对比。`;
    case "alternative":
      return `替代关系：「${to}」可以替代「${from}」。`;
    default:
      return `${label}关系：「${from}」与「${to}」相关。`;
  }
}

/** 点击线：展示这条线的说明文档；建议线额外提供“接受”动作 */
export default function RelationDrawer() {
  const drawer = useStore((s) => s.drawer);
  const edges = useStore((s) => s.edges);
  const nodes = useStore((s) => s.nodes);
  const acceptEdge = useStore((s) => s.acceptEdge);
  const extract = useStore((s) => s.extract);
  const closeDrawer = useStore((s) => s.closeDrawer);

  const edge = edges.find((e) => e.id === (drawer?.kind === "edge" ? drawer.id : ""));
  if (!edge) return null;
  const from = nodes.find((n) => n.id === edge.src)?.name ?? "?";
  const to = nodes.find((n) => n.id === edge.dst)?.name ?? "?";
  const isDirection = edge.kind === "direction";
  const sentence = isDirection
    ? `探索方向：「${from}」的下一个问题是：${edge.question || edge.label || "还可以往哪里深入？"}`
    : relationSentence(edge.kind, edge.predicate ?? null, from, to);

  return (
    <div className="drawer">
      <header>
        <div className="k">{KIND_LABEL[edge.kind] ?? edge.kind}</div>
        <h2>{isDirection ? from : `${from} → ${to}`}</h2>
        <button className="close" onClick={closeDrawer}>
          ×
        </button>
      </header>
      <div className="body">
        <div className="md-preview">
          <ReactMarkdown>{sentence}</ReactMarkdown>
        </div>
        {edge.kind === "suggest" ? (
          <div className="row" style={{ marginTop: 10 }}>
            <button
              className="primary"
              onClick={() => {
                acceptEdge(edge.id);
                closeDrawer();
              }}
            >
              接受为正式关系
            </button>
          </div>
        ) : null}
        {isDirection ? (
          <div className="row" style={{ marginTop: 10 }}>
            <button
              className="primary"
              onClick={async () => {
                await fetch(`/api/edges/${edge.id}/consume`, { method: "POST" }).catch(() => null);
                // 从这条方向线的起点探索，而不是当前焦点
                useStore.getState().setFocus(edge.src);
                closeDrawer();
                await extract(edge.question || "继续探索这个方向", edge.id);
              }}
            >
              去探索
            </button>
          </div>
        ) : null}
      </div>
    </div>
  );
}
