import { useEffect, useState } from "react";
import ReactMarkdown from "react-markdown";
import { useStore } from "../store";

const KIND_LABEL: Record<string, string> = {
  formal: "正式关系",
  source: "探索来源（正式关系）",
  suggest: "AI 建议（虚线）",
  direction: "方向线（无 MD）",
};

const PRED_LABEL: Record<string, string> = {
  kindOf: "归类",
  partOf: "组成",
  prerequisite: "前置",
  contrast: "对比",
  alternative: "替代",
  related: "相关",
};

/** 点击线/路牌：关系 MD 编辑、接受建议、方向问题探索 */
export default function RelationDrawer() {
  const drawer = useStore((s) => s.drawer);
  const edges = useStore((s) => s.edges);
  const nodes = useStore((s) => s.nodes);
  const world = useStore((s) => s.world);
  const acceptEdge = useStore((s) => s.acceptEdge);
  const extract = useStore((s) => s.extract);
  const closeDrawer = useStore((s) => s.closeDrawer);
  const showToast = useStore((s) => s.showToast);

  const edge = edges.find((e) => e.id === (drawer?.kind === "edge" ? drawer.id : ""));
  const [md, setMd] = useState("");
  const [label, setLabel] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!edge) return;
    setMd(edge.md ?? "");
    setLabel(edge.label ?? "");
  }, [edge?.id, edge?.md, edge?.label]);

  if (!edge) return null;
  const from = nodes.find((n) => n.id === edge.src);
  const to = nodes.find((n) => n.id === edge.dst);

  async function save() {
    if (!edge) return;
    await fetch(`/api/edges/${edge.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ md, label }),
    });
    useStore.setState({
      edges: edges.map((e) => (e.id === edge.id ? { ...e, md, label } : e)),
    });
    showToast("关系已保存");
  }

  async function exploreDirection() {
    if (!edge || !world) return;
    setBusy(true);
    try {
      const text = edge.question || "继续探索这个方向";
      // 先把方向标记标记为已消费，再走正常抽取（新节点会落在附近）
      await fetch(`/api/edges/${edge.id}/consume`, { method: "POST" }).catch(() => null);
      closeDrawer();
      await extract(text);
      await useStore.getState().openWorld(world.id);
      showToast("已沿这个方向探索");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="drawer">
      <header>
        <div className="k">线 · {KIND_LABEL[edge.kind] ?? edge.kind}</div>
        <h2>
          {from?.name ?? "?"} → {edge.kind === "direction" ? "未知方向" : to?.name ?? "?"}
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
            <button className="primary" style={{ marginTop: 10 }} disabled={busy} onClick={exploreDirection}>
              按这个方向探索
            </button>
            <div className="hintline" style={{ marginTop: 6 }}>
              探索后这个方向标记会被消费并消失。
            </div>
          </div>
        ) : (
          <>
            <div className="section">
              <h4>语义</h4>
              <div className="row" style={{ marginBottom: 6 }}>
                <span className="chip">{PRED_LABEL[edge.predicate ?? ""] ?? edge.predicate ?? "相关"}</span>
                <span className="chip">置信度 {Math.round((edge.confidence ?? 1) * 100)}%</span>
                {edge.claim_status && edge.claim_status !== "normal" ? (
                  <span className="chip">{edge.claim_status}</span>
                ) : null}
              </div>
              {edge.evidence ? (
                <div className="hintline">依据：{edge.evidence}</div>
              ) : (
                <div className="hintline">缺少证据句；建议补来源或降级为虚线。</div>
              )}
              <div className="hintline">
                方向约定：归类（具体→上位）、组成（部分→整体）、前置（前置→后续）、对比/相关无方向、替代（旧→新）。
              </div>
            </div>
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
