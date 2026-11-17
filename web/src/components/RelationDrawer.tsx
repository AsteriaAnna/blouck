import { useEffect, useState } from "react";
import ReactMarkdown from "react-markdown";
import { LINE_TYPE_LABEL, deriveLineFields, type LineType } from "@blouck/shared";
import { get, send, type RelationDocPayload } from "../api";
import { useStore } from "../store";

const PRED_LABEL: Record<string, string> = {
  kindOf: "归类",
  partOf: "组成",
  prerequisite: "前置",
  contrast: "对比",
  alternative: "替代",
  related: "相关",
};

function relationSentence(lineType: LineType, predicate: string | null, from: string, to: string) {
  if (lineType === "sequence") return `顺序线：「${to}」是从「${from}」生成的来路。`;
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

/** 点击线：展示关系理解卡；建议线提供“接受”，方向线提供“探索”。 */
export default function RelationDrawer() {
  const drawer = useStore((s) => s.drawer);
  const edges = useStore((s) => s.edges);
  const nodes = useStore((s) => s.nodes);
  const acceptEdge = useStore((s) => s.acceptEdge);
  const exploreDirection = useStore((s) => s.exploreDirection);
  const closeDrawer = useStore((s) => s.closeDrawer);

  const edge = edges.find((e) => e.id === (drawer?.kind === "edge" ? drawer.id : ""));
  const [payload, setPayload] = useState<RelationDocPayload | null>(null);
  const [loading, setLoading] = useState(false);
  const [notes, setNotes] = useState("");
  const [saved, setSaved] = useState("");

  useEffect(() => {
    if (!edge || (edge.kind !== "formal" && edge.kind !== "suggest")) {
      setPayload(null);
      setNotes("");
      return;
    }
    let cancelled = false;
    setLoading(true);
    get<RelationDocPayload>(`/api/edges/${edge.id}/doc`)
      .then((p) => {
        if (cancelled) return;
        setPayload(p);
        setNotes(p.notes_md ?? "");
      })
      .catch(() => {
        if (!cancelled) setPayload(null);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [edge?.id]);

  if (!edge) return null;
  const from = nodes.find((n) => n.id === edge.src)?.name ?? "?";
  const to = nodes.find((n) => n.id === edge.dst)?.name ?? "?";
  const line = { line_type: edge.line_type, line_state: edge.line_state, ...deriveLineFields(edge) };
  const lineType = line.line_type;
  const isDirection = lineType === "exploration";
  const isHint = lineType === "hint";
  const plannedName = edge.target_name?.trim() || "";
  const plannedDef = edge.target_definition?.trim() || "";
  const sentence = isDirection
    ? `探索方向：「${from}」的下一个问题：${edge.question || edge.label || "还可以往哪里深入？"}` +
      (plannedName
        ? `\n\n点「去探索」会直接生成预先规划好的节点：**${plannedName}**${plannedDef ? `——${plannedDef}` : ""}`
        : `\n\n这条方向是旧数据，点「去探索」时会先规划延伸节点，再落图。`)
    : relationSentence(lineType, edge.predicate ?? null, from, to);
  const doc = payload?.doc;

  async function saveNotes() {
    if (!edge) return;
    await send(`/api/edges/${edge.id}/doc/notes`, "PATCH", { notes });
    setSaved("已保存 " + new Date().toLocaleTimeString());
  }

  async function regenerate() {
    if (!edge) return;
    setLoading(true);
    try {
      const p = await send<RelationDocPayload>(`/api/edges/${edge.id}/doc/regenerate`, "POST");
      setPayload(p);
      setSaved("已重新生成");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="drawer">
      <header>
        <div className="k">{LINE_TYPE_LABEL[lineType]}</div>
        <h2>{isDirection ? from : `${from} → ${to}`}</h2>
        <button className="close" onClick={closeDrawer}>
          ×
        </button>
      </header>
      <div className="body">
        <div className="md-preview">
          <ReactMarkdown>{doc?.one_line || sentence}</ReactMarkdown>
        </div>

        {loading && <div className="hintline">正在整理关系卡…</div>}

        {doc && (
          <>
            {doc.evidence_quote && (
              <div className="section">
                <h4>依据</h4>
                <blockquote>{doc.evidence_quote}</blockquote>
              </div>
            )}
            {(doc.compare.same.length > 0 ||
              doc.compare.different.length > 0 ||
              doc.compare.boundary.length > 0) && (
              <div className="section">
                <h4>辨析</h4>
                {doc.compare.same.length > 0 && (
                  <div className="hintline">相同：{doc.compare.same.join("；")}</div>
                )}
                {doc.compare.different.length > 0 && (
                  <div className="hintline">不同：{doc.compare.different.join("；")}</div>
                )}
                {doc.compare.boundary.length > 0 && (
                  <div className="hintline">边界：{doc.compare.boundary.join("；")}</div>
                )}
              </div>
            )}
            {doc.counterexample && (
              <div className="section">
                <h4>反例 / 易混</h4>
                <div className="hintline">{doc.counterexample}</div>
              </div>
            )}
          </>
        )}

        {(edge.kind === "formal" || edge.kind === "suggest") && (
          <div className="section">
            <h4>我的备注</h4>
            <textarea
              className="md-edit"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="这条关系对你意味着什么…"
            />
            <div className="row" style={{ marginTop: 8 }}>
              <button className="primary" onClick={saveNotes}>
                保存
              </button>
              <button className="secondary" onClick={regenerate} disabled={loading}>
                重新生成关系卡
              </button>
              <span className="hintline">{saved}</span>
            </div>
          </div>
        )}

        {isHint ? (
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
                closeDrawer();
                await exploreDirection(edge.id);
              }}
            >
              {plannedName ? `生成「${plannedName}」` : "去探索"}
            </button>
          </div>
        ) : null}
      </div>
    </div>
  );
}
