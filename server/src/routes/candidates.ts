import { Router } from "express";
import {
  addEdge,
  addNode,
  computeFrontier,
  getGraph,
  getNode,
  getWorld,
} from "../db.js";
import {
  enqueueGenerationJob,
  getNodeCandidate,
  listNodeCandidates,
  setNodeCandidateStatus,
} from "../db/docs.js";
import { placeAround } from "../placement.js";
import { materializeDirectionEdges } from "../services/directions.js";

/** 候选节点：列出、确认（补一条语义关系）、忽略。 */
export const candidatesRouter = Router();

candidatesRouter.get("/api/worlds/:id/candidates", (req, res) => {
  const world = getWorld(req.params.id);
  if (!world) return res.status(404).json({ error: "world not found" });
  res.json({
    candidates: listNodeCandidates(world.id).map((c) => ({
      ...c,
      aliases: (() => {
        try {
          return JSON.parse(c.aliases || "[]");
        } catch {
          return [];
        }
      })(),
    })),
  });
});

candidatesRouter.post("/api/candidates/:id/admit", (req, res) => {
  const candidate = getNodeCandidate(req.params.id);
  if (!candidate) return res.status(404).json({ error: "candidate not found" });
  if (candidate.status !== "candidate") {
    return res.status(409).json({ error: "candidate already handled" });
  }
  const target = getNode(String(req.body?.targetNodeId ?? ""));
  if (!target || target.world_id !== candidate.world_id) {
    return res.status(400).json({ error: "targetNodeId must be in the same world" });
  }
  const graph = getGraph(candidate.world_id);
  const norm = (s: string) =>
    s
      .toLowerCase()
      .replace(/[\s\-_·、，。,.；;：:（）()【】\[\]《》"'“”]/g, "")
      .trim();
  if (graph.nodes.some((n) => norm(n.name) === norm(candidate.name))) {
    return res.status(409).json({ error: "节点已存在" });
  }
  const predicate = ["kindOf", "partOf", "prerequisite", "contrast", "alternative", "related"].includes(
    String(req.body?.predicate ?? ""),
  )
    ? String(req.body.predicate)
    : "related";
  const pos = placeAround(
    graph.nodes.map((n) => ({ id: n.id, x: n.x, y: n.y })),
    { id: target.id, x: target.x, y: target.y },
    { preferAngle: (graph.nodes.length * 1.7) % (Math.PI * 2) },
  );
  const node = addNode(candidate.world_id, candidate.name, pos.x, pos.y, "", {
    type: candidate.type,
    definition: candidate.definition,
    aliases: (() => {
      try {
        return JSON.parse(candidate.aliases || "[]") as string[];
      } catch {
        return [];
      }
    })(),
  });
  const edge = addEdge(
    candidate.world_id,
    target.id,
    node.id,
    "formal",
    String(req.body?.label ?? "用户确认候选"),
    null,
    "",
    {
      predicate,
      evidence: candidate.evidence || "用户确认候选",
      confidence: 1,
      origin: "manual",
    },
  );
  setNodeCandidateStatus(candidate.id, "admitted");
  computeFrontier(candidate.world_id);
  materializeDirectionEdges(candidate.world_id);
  enqueueGenerationJob(candidate.world_id, "node_doc", node.id);
  enqueueGenerationJob(candidate.world_id, "relation_doc", edge.id);
  res.json({ ok: true, node, edge });
});

candidatesRouter.post("/api/candidates/:id/reject", (req, res) => {
  const candidate = getNodeCandidate(req.params.id);
  if (!candidate) return res.status(404).json({ error: "candidate not found" });
  setNodeCandidateStatus(candidate.id, "rejected");
  res.json({ ok: true });
});
