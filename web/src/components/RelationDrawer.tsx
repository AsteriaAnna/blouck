import { useEffect, useState } from "react";
import ReactMarkdown from "react-markdown";
import { useStore } from "../store";

const KIND_LABEL: Record<string, string> = {
  formal: "正式关系",
  source: "探索来源（正式关系）",
  suggest: "AI 建议（虚线）",
  direction: "方向线（无 MD）",
};

/** 点击路牌打开：关系 MD 编辑 / 接受建议 / 方向问题 */
export default function RelationDrawer() {
  const drawer = useStore((s) => s.drawer);
  const edges = useStore((s) => s.edges);
  const nodes = useStore((s) => s.nodes);
  const acceptEdge = useStore((s) => s.acceptEdge);
  const extract = useStore((s) => s.extract);
  const closeDrawer = useStore((s) => s.closeDrawer);
  const showToast = useStore((s) => s.showToast);

  const edge = edges.find((e) => e.id === (drawer?.kind === "edge" ? drawer.id : ""));
  const [md, setMd] = useState("");
  const [label, setLabel] = useState("");

  useEffect(() => {
    if (!edge) return;
    setMd(edge.md ?? "");
    setLabel(edge.label ?? "");
  }, [edge?.id, edge?.md, edge?.label]);

  if (!edge) return null;
  const from = nodes.find((n) => n.id === edge.src);
  const to = nodes.find((n) => n.id === edge.dst);

  async function save() {
    await fetch(`/api/edges/${edge!.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ md, label }),
    });
    useStore.setState({
      edges: edges.map((e) => (e.id === edge!.id ? { ...e, md, label } : e)),
    });
    showToast("关系已保存");
  }

  return (
    <div className="drawer">
      <header>
        <div className="k">线 · {KIND_LABEL[edge.kind] ?? edge.kind}</div>
        <h2>
          {from?.name ?? "?"} → {to?.name ?? "?"}
        </h2>
        <div className="hintline">
          {edge.kind === "direction"
            ? "方向线只提示下一步，没有 MD"
            : "正式关系不可删除；虚线建议接受后转为正式关系"}
        </div>
        <button className="close" onClick={closeDrawer}>
          ×
        </button>
      </header>
      <div className="body">
        {edge.kind === "direction" ? (
          <div className="section">
            <h4>方向问题</h4>
            <div className="md-preview">
              <p>{edge.question || edge.label || "下一步可以往这里探索"}</p>
            </div>
            <button
              className="primary"
              style={{ marginTop: 10 }}
              onClick={async () => {
                closeDrawer();
                await extract(edge.question || "继续探索这个方向");
              }}
            >
              按这个方向探索
            </button>
          </div>
        ) : (
          <>
            <div className="section">
              <h4>关系名</h4>
              <input
                className="md-edit"
                style={{ minHeight: 38 }}
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                placeholder="例如：依赖 / 组合 / 验证"
              />
            </div>
            <div className="section">
              <h4>关系 MD（可编辑）</h4>
              <textarea
                className="md-edit"
                value={md}
                onChange={(e) => setMd(e.target.value)}
                placeholder="写下这条关系为什么成立、依据是什么…"
              />
              <div className="row" style={{ marginTop: 8 }}>
                <button className="primary" onClick={save}>
                  保存
                </button>
                {edge.kind === "suggest" && (
                  <button
                    className="secondary"
                    onClick={() => {
                      acceptEdge(edge.id);
                      closeDrawer();
                    }}
                  >
                    接受为正式关系
                  </button>
                )}
              </div>
              {md.trim() && (
                <div className="md-preview" style={{ marginTop: 10 }}>
                  <ReactMarkdown>{md}</ReactMarkdown>
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
