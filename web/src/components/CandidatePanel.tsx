import { useEffect, useState } from "react";
import { get, send, type NodeCandidateDTO } from "../api";
import { useStore } from "../store";
import { track } from "../telemetry";

/** 未准入候选：用户确认（补语义关系）或忽略。 */
export default function CandidatePanel() {
  const world = useStore((s) => s.world);
  const nodes = useStore((s) => s.nodes);
  const refreshWorldData = useStore((s) => s.refreshWorldData);
  const [candidates, setCandidates] = useState<NodeCandidateDTO[]>([]);
  const [targetId, setTargetId] = useState("");
  const [predicate, setPredicate] = useState("related");
  const [msg, setMsg] = useState("");

  async function load() {
    if (!world) return;
    try {
      const r = await get<{ candidates: NodeCandidateDTO[] }>(
        `/api/worlds/${world.id}/candidates`,
      );
      setCandidates(r.candidates);
    } catch {
      setCandidates([]);
    }
  }

  useEffect(() => {
    setTargetId(world?.root_node_id ?? "");
    void load();
  }, [world?.id]);

  if (!world || candidates.length === 0) return null;

  async function admit(id: string) {
    try {
      await send(`/api/candidates/${id}/admit`, "POST", { targetNodeId: targetId, predicate });
      setMsg("已确认");
      track("candidate_admit", { worldId: world.id, targetId: id, payload: { predicate } });
      await refreshWorldData();
      await load();
    } catch (e: any) {
      setMsg(e.message ?? "确认失败");
    }
  }

  async function reject(id: string) {
    try {
      await send(`/api/candidates/${id}/reject`, "POST");
      setMsg("已忽略");
      track("candidate_reject", { worldId: world.id, targetId: id });
      await load();
    } catch (e: any) {
      setMsg(e.message ?? "忽略失败");
    }
  }

  return (
    <div
      style={{
        position: "fixed",
        right: 16,
        bottom: 96,
        width: 300,
        maxHeight: "52vh",
        overflow: "auto",
        background: "#fffdf7",
        border: "1px solid #d8cbb5",
        borderRadius: 10,
        padding: 10,
        zIndex: 95,
        boxShadow: "0 8px 24px rgba(0,0,0,.08)",
      }}
    >
      <div style={{ fontWeight: 600, marginBottom: 6 }}>待确认候选 · {candidates.length}</div>
      <div className="hintline" style={{ marginBottom: 6 }}>
        没有语义关系的实体不会上地图；确认时会补一条关系线。
      </div>
      <div className="row" style={{ gap: 6, marginBottom: 6 }}>
        <select value={targetId} onChange={(e) => setTargetId(e.target.value)}>
          {nodes.map((n) => (
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
      </div>
      {candidates.map((c) => (
        <div key={c.id} style={{ borderTop: "1px solid #eee4d2", padding: "6px 0" }}>
          <div>
            <b>{c.name}</b> <span className="hintline">{c.type}</span>
          </div>
          {c.evidence && <div className="hintline">{c.evidence.slice(0, 80)}</div>}
          <div className="row" style={{ gap: 6, marginTop: 4 }}>
            <button className="primary" onClick={() => admit(c.id)} disabled={!targetId}>
              确认
            </button>
            <button className="secondary" onClick={() => reject(c.id)}>
              忽略
            </button>
          </div>
        </div>
      ))}
      <div className="hintline">{msg}</div>
    </div>
  );
}
