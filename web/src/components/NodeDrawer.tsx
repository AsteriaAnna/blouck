import { useEffect, useState } from "react";
import ReactMarkdown from "react-markdown";
import { get, send, type NodeDocPayload } from "../api";
import { useStore } from "../store";
import { track } from "../telemetry";

/** 点击节点的理解卡：定义 + 体系位置 + 边界 + 来源 + 下一步 + 笔记。 */
export default function NodeDrawer() {
  const drawer = useStore((s) => s.drawer);
  const nodes = useStore((s) => s.nodes);
  const world = useStore((s) => s.world);
  const openNode = useStore((s) => s.openNode);
  const closeDrawer = useStore((s) => s.closeDrawer);
  const quizzes = useStore((s) => s.quizzes);
  const passed = useStore((s) => s.passed);
  const tier = useStore((s) => s.tier);
  const generateQuiz = useStore((s) => s.generateQuiz);
  const answerQuiz = useStore((s) => s.answerQuiz);
  const directions = useStore((s) => s.directions);
  const explorePlanDirection = useStore((s) => s.explorePlanDirection);

  const node = nodes.find((n) => n.id === (drawer?.kind === "node" ? drawer.id : ""));
  const [payload, setPayload] = useState<NodeDocPayload | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [notes, setNotes] = useState("");
  const [saved, setSaved] = useState("");
  const [targetId, setTargetId] = useState("");
  const [predicate, setPredicate] = useState("related");
  const [evidence, setEvidence] = useState("");
  const [relMsg, setRelMsg] = useState("");
  const [answers, setAnswers] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!node) return;
    let cancelled = false;
    setLoading(true);
    setError("");
    setSaved("");
    get<NodeDocPayload>(`/api/nodes/${node.id}/doc`)
      .then((p) => {
        if (cancelled) return;
        setPayload(p);
        setNotes(p.notes_md || node.free_md || "");
        track("node_card_open", { worldId: world?.id, targetId: node.id, payload: { status: p.status } });
      })
      .catch((e) => {
        if (!cancelled) setError(e.message ?? "卡片加载失败");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [node?.id]);

  if (!node) return null;

  const doc = payload?.doc;
  const aliases = (() => {
    try {
      const list = JSON.parse(node.aliases || "[]") as string[];
      return Array.isArray(list) ? list.filter(Boolean) : [];
    } catch {
      return [];
    }
  })();
  const legacyBody = [node.definition, node.free_md].filter((x) => x && x.trim()).join("\n\n");
  const source = node.source_at
    ? `来源：${new Date(node.source_at).toLocaleString("zh-CN", {
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
      })}${node.source_text ? ` · ${node.source_text.slice(0, 120)}` : ""}`
    : node.source_text
      ? `来源：${node.source_text.slice(0, 120)}`
      : "";

  async function saveNotes() {
    if (!node) return;
    await send(`/api/nodes/${node.id}/doc/notes`, "PATCH", { notes });
    setSaved("已保存 " + new Date().toLocaleTimeString());
  }

  async function regenerate() {
    if (!node) return;
    setLoading(true);
    setError("");
    try {
      const p = await send<NodeDocPayload>(`/api/nodes/${node.id}/doc/regenerate`, "POST");
      setPayload(p);
      setSaved("已重新生成");
    } catch (e: any) {
      setError(e.message ?? "重新生成失败");
    } finally {
      setLoading(false);
    }
  }

  async function createRelation() {
    if (!node || !world || !targetId) return;
    setRelMsg("");
    try {
      await send(`/api/worlds/${world.id}/relations`, "POST", {
        fromNodeId: node.id,
        toNodeId: targetId,
        predicate,
        evidence,
      });
      setRelMsg("已建立关系线");
      track("manual_relation_create", { worldId: world.id, targetId: node.id, payload: { predicate } });
      await useStore.getState().openWorld(world.id);
    } catch (e: any) {
      setRelMsg(e.message ?? "建立关系失败");
    }
  }

  return (
    <div className="drawer">
      <header>
        <div className="k">
          {node.type || "概念"}
          {aliases.length ? ` · 别名：${aliases.join("、")}` : ""}
        </div>
        <h2>{node.name}</h2>
        <button className="close" onClick={closeDrawer}>
          ×
        </button>
      </header>
      <div className="body">
        {loading && <div className="hintline">正在整理理解卡…</div>}
        {error && (
          <div className="hintline">
            {error}
            <button className="secondary" style={{ marginLeft: 8 }} onClick={regenerate}>
              重试
            </button>
          </div>
        )}

        <div className="md-preview node-doc">
          <h3>{node.name}</h3>
          {doc?.definition ? (
            <ReactMarkdown>{doc.definition}</ReactMarkdown>
          ) : legacyBody ? (
            <ReactMarkdown>{legacyBody}</ReactMarkdown>
          ) : null}
          {source || doc?.source_quote ? (
            <blockquote>{doc?.source_quote || source}</blockquote>
          ) : null}
        </div>

        {doc && doc.position.length > 0 && (
          <div className="section">
            <h4>体系位置</h4>
            {doc.position.map((p) => {
              const target = nodes.find((n) => n.id === p.node_id);
              return (
                <button
                  key={`${p.node_id}-${p.predicate}`}
                  className="step-btn"
                  style={{ display: "block", width: "100%", textAlign: "left", marginBottom: 4 }}
                  onClick={() => openNode(p.node_id)}
                >
                  {target?.name ?? p.node_id} · {p.predicate ?? "相关"}
                  {p.why ? <span className="hintline"> — {p.why}</span> : null}
                </button>
              );
            })}
          </div>
        )}

        {doc?.boundary && (
          <div className="section">
            <h4>边界 / 易混</h4>
            <div className="hintline">{doc.boundary}</div>
          </div>
        )}

        {doc?.next_hint && (
          <div className="section">
            <h4>下一步</h4>
            <div className="hintline">{doc.next_hint}</div>
          </div>
        )}

        {directions.filter((d) => d.node_id === node.id && d.status === "open").length > 0 && (
          <div className="section">
            <h4>全部探索方向</h4>
            <div className="hintline">地图只显示 1–2 条，全部方向在这里。</div>
            {directions
              .filter((d) => d.node_id === node.id && d.status === "open")
              .map((d) => (
                <div key={d.id} className="hintline" style={{ marginBottom: 6 }}>
                  <div>
                    · {d.question}
                    {d.target_name ? ` → ${d.target_name}` : ""}
                  </div>
                  <button
                    className="secondary"
                    style={{ marginTop: 2 }}
                    onClick={async () => {
                      closeDrawer();
                      await explorePlanDirection(d.id);
                    }}
                  >
                    去探索
                  </button>
                </div>
              ))}
          </div>
        )}

        <div className="section">
          <h4>理解检查</h4>
          <div className="hintline">
            当前档位：{tier} · 简答 {passed.short} / 判断 {passed.judge}
          </div>
          {quizzes.length === 0 ? (
            <button className="secondary" onClick={() => generateQuiz(node.id)}>
              生成检查题
            </button>
          ) : (
            quizzes.slice(0, 3).map((q) => (
              <div key={q.id} className="quiz">
                <div className="q">{q.prompt}</div>
                <input
                  className="md-edit"
                  style={{ minHeight: 36 }}
                  value={answers[q.id] ?? ""}
                  onChange={(e) => setAnswers((a) => ({ ...a, [q.id]: e.target.value }))}
                  placeholder="写下你的答案"
                />
                <button
                  className="secondary"
                  style={{ marginTop: 4 }}
                  onClick={() => answerQuiz(q.id, answers[q.id] ?? "")}
                  disabled={!answers[q.id]?.trim()}
                >
                  提交
                </button>
              </div>
            ))
          )}
        </div>

        <div className="section">
          <h4>我的笔记</h4>
          <textarea
            className="md-edit"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="写下你的理解…"
          />
          <div className="row" style={{ marginTop: 8 }}>
            <button className="primary" onClick={saveNotes}>
              保存
            </button>
            <button className="secondary" onClick={regenerate} disabled={loading}>
              重新生成理解卡
            </button>
            <span className="hintline">{saved}</span>
          </div>
        </div>

        <div className="section">
          <h4>关联到已有节点</h4>
          <select value={targetId} onChange={(e) => setTargetId(e.target.value)}>
            <option value="">选择目标节点…</option>
            {nodes
              .filter((n) => n.id !== node.id)
              .map((n) => (
                <option key={n.id} value={n.id}>
                  {n.name}
                </option>
              ))}
          </select>
          <select value={predicate} onChange={(e) => setPredicate(e.target.value)}>
            <option value="related">相关</option>
            <option value="kindOf">归类</option>
            <option value="partOf">组成</option>
            <option value="prerequisite">前置</option>
            <option value="contrast">对比</option>
            <option value="alternative">替代</option>
          </select>
          <input
            className="md-edit"
            style={{ minHeight: 36, marginTop: 6 }}
            value={evidence}
            onChange={(e) => setEvidence(e.target.value)}
            placeholder="依据（可选）"
          />
          <div className="row" style={{ marginTop: 8 }}>
            <button className="primary" onClick={createRelation} disabled={!targetId}>
              建立关系线
            </button>
            <span className="hintline">{relMsg}</span>
          </div>
        </div>
      </div>
    </div>
  );
}
