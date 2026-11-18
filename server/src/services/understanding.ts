import { db, getNode, refreshBuildingStatus, setNodeTier } from "../db.js";
import type { EdgeRow } from "../db/edges.js";
import {
  createUnderstandingTask,
  deleteUnderstandingTask,
  getUnderstandingTask,
  getUnderstandingTaskByEdge,
  getUnderstandingTaskByEdgeKind,
  getUnderstandingTaskByNode,
  recordUnderstandingAttempt,
  type UnderstandingTaskRow,
} from "../db/understanding.js";
import type { LLMProvider } from "../providers/types.js";
import { scoreExplanation } from "./explanationQuality.js";
import { auditUnderstandingTask } from "./understandingQuality.js";
import { qualityThresholdForWorld } from "./learningStats.js";

function findSourceSpan(worldId: string, quote: string): { id: string; text: string } | undefined {
  if (!quote.trim()) return undefined;
  return db
    .prepare(
      "SELECT id, text FROM source_spans WHERE world_id=? AND instr(text, ?) > 0 ORDER BY created_at DESC LIMIT 1",
    )
    .get(worldId, quote) as { id: string; text: string } | undefined;
}

function publicTask(t: UnderstandingTaskRow) {
  return {
    id: t.id,
    learning_goal: t.learning_goal,
    misconception: t.misconception,
    stem: t.stem,
    choices: JSON.parse(t.choices_json || "[]") as { id: string; text: string }[],
    rubric: JSON.parse(t.rubric_json || "[]") as string[],
    evidence_quote: t.evidence_quote,
    follow_up: t.follow_up,
  };
}

export function getUnderstandingTaskForClient(taskId: string) {
  const t = getUnderstandingTask(taskId);
  return t ? publicTask(t) : null;
}

function createEdgeTask(
  edge: EdgeRow,
  spanId: string,
  variant: string,
  draft: {
    learning_goal: string;
    misconception: string;
    stem: string;
    choices: { id: string; text: string }[];
    correct_choice: string;
    rubric: string[];
    evidence_quote: string;
    follow_up: string;
  },
) {
  return createUnderstandingTask({
    world_id: edge.world_id,
    edge_id: edge.id,
    target_type: "edge",
    node_id: null,
    task_kind: variant,
    learning_goal: draft.learning_goal,
    misconception: draft.misconception,
    stem: draft.stem,
    answer_type: "choice_explain",
    choices_json: JSON.stringify(draft.choices),
    correct_choice: draft.correct_choice,
    rubric_json: JSON.stringify(draft.rubric),
    evidence_quote: draft.evidence_quote || edge.evidence,
    source_span_id: spanId,
    follow_up: draft.follow_up,
  });
}

function createNodeTask(
  node: { id: string; world_id: string },
  span: { id: string; text: string },
  draft: {
    learning_goal: string;
    misconception: string;
    stem: string;
    choices: { id: string; text: string }[];
    correct_choice: string;
    rubric: string[];
    evidence_quote: string;
    follow_up: string;
  },
) {
  return createUnderstandingTask({
    world_id: node.world_id,
    edge_id: "",
    target_type: "node",
    node_id: node.id,
    task_kind: "boundary",
    learning_goal: draft.learning_goal,
    misconception: draft.misconception,
    stem: draft.stem,
    answer_type: "choice_explain",
    choices_json: JSON.stringify(draft.choices),
    correct_choice: draft.correct_choice,
    rubric_json: JSON.stringify(draft.rubric),
    evidence_quote: draft.evidence_quote || span.text.slice(0, 160),
    source_span_id: span.id,
    follow_up: draft.follow_up,
  });
}

/** 事实辨析任务：必须能回到用户原文；无源不出题。 */
export async function ensureUnderstandingTask(
  edgeId: string,
  llm: LLMProvider,
  variant: "boundary" | "counterexample" | "error_correction" | "transfer" = "boundary",
) {
  const edge = db.prepare("SELECT * FROM edges WHERE id=?").get(edgeId) as EdgeRow | undefined;
  if (!edge) throw new Error("edge not found");
  const existing = getUnderstandingTaskByEdgeKind(edgeId, variant);
  if (existing) return { status: "ready" as const, task: publicTask(existing) };

  const span = findSourceSpan(edge.world_id, edge.evidence ?? "");
  if (!span) {
    return {
      status: "source_required" as const,
      task: null,
      message: "这条关系没有可回查的原文证据；辨析题需要先补充来源/原文。",
    };
  }
  const graph = db.prepare("SELECT id,name FROM nodes WHERE world_id=?").all(edge.world_id) as {
    id: string;
    name: string;
  }[];
  const a = graph.find((n) => n.id === edge.src);
  const b = graph.find((n) => n.id === edge.dst);
  if (!a || !b) return { status: "failed" as const, task: null, message: "关系端点节点缺失" };

  const neighbors = graph
    .filter((n) => n.id !== a.id && n.id !== b.id)
    .slice(0, 6)
    .map((n) => n.name);
  const draft = await llm.generateUnderstandingTask({
    sourceText: span.text,
    a,
    b,
    predicate: edge.predicate,
    label: edge.label,
    evidence: edge.evidence,
    neighbors,
    variant,
  });
  if (!draft.choices.length || !draft.correct_choice) {
    return { status: "failed" as const, task: null, message: "任务生成失败，可稍后重试" };
  }
  let task = createEdgeTask(edge, span.id, variant, draft);
  const firstAudit = auditUnderstandingTask(task.id);
  const threshold = qualityThresholdForWorld(edge.world_id);
  if (firstAudit && firstAudit.score < threshold) {
    try {
      const repaired = await llm.generateUnderstandingTask({
        sourceText: span.text,
        a,
        b,
        predicate: edge.predicate,
        label: edge.label,
        evidence: edge.evidence,
        neighbors,
        variant,
        repair: `上一次题目质检不合格（${firstAudit.flags.join("、")}）。请重写：必须引用原文、有具体误解、含错误干扰项，并且题干要求比较/边界/反例/迁移。`,
      });
      if (repaired.choices.length && repaired.correct_choice) {
        const repairedTask = createEdgeTask(edge, span.id, variant, repaired);
        const repairedAudit = auditUnderstandingTask(repairedTask.id);
        if (repairedAudit && repairedAudit.score > firstAudit.score) {
          deleteUnderstandingTask(task.id);
          task = repairedTask;
        } else {
          deleteUnderstandingTask(repairedTask.id);
        }
      }
    } catch (err) {
      console.warn("[understanding] 质量重写失败，保留原题：", err);
    }
  }
  return { status: "ready" as const, task: publicTask(task) };
}

/** 节点辨析任务：体系位置/边界；必须带节点来源原文。 */
export async function ensureNodeUnderstandingTask(nodeId: string, llm: LLMProvider) {
  const node = db.prepare("SELECT * FROM nodes WHERE id=?").get(nodeId) as
    | {
        id: string;
        world_id: string;
        name: string;
        type: string;
        definition: string;
        source_span_id: string | null;
      }
    | undefined;
  if (!node) throw new Error("node not found");
  const existing = getUnderstandingTaskByNode(nodeId);
  if (existing) return { status: "ready" as const, task: publicTask(existing) };
  const span = node.source_span_id
    ? (db.prepare("SELECT id,text FROM source_spans WHERE id=?").get(node.source_span_id) as
        | { id: string; text: string }
        | undefined)
    : undefined;
  if (!span) {
    return {
      status: "source_required" as const,
      task: null,
      message: "这个节点没有来源原文；事实辨析需要先补充来源。",
    };
  }
  const edges = db
    .prepare(
      "SELECT src,dst,predicate,evidence FROM edges WHERE world_id=? AND kind IN ('formal','suggest') AND (src=? OR dst=?)",
    )
    .all(node.world_id, node.id, node.id) as {
    src: string;
    dst: string;
    predicate: string | null;
    evidence: string;
  }[];
  const nodes = db.prepare("SELECT id,name FROM nodes WHERE world_id=?").all(node.world_id) as {
    id: string;
    name: string;
  }[];
  const neighbors = edges.slice(0, 6).map((e) => {
    const otherId = e.src === node.id ? e.dst : e.src;
    return {
      name: nodes.find((n) => n.id === otherId)?.name ?? otherId,
      predicate: e.predicate,
      evidence: e.evidence,
    };
  });
  const draft = await llm.generateNodeUnderstandingTask({
    sourceText: span.text,
    node: { name: node.name, type: node.type, definition: node.definition },
    neighbors,
  });
  if (!draft.choices.length || !draft.correct_choice) {
    return { status: "failed" as const, task: null, message: "任务生成失败，可稍后重试" };
  }
  let task = createNodeTask(node, span, draft);
  const firstAudit = auditUnderstandingTask(task.id);
  const threshold = qualityThresholdForWorld(node.world_id);
  if (firstAudit && firstAudit.score < threshold) {
    try {
      const repaired = await llm.generateNodeUnderstandingTask({
        sourceText: span.text,
        node: { name: node.name, type: node.type, definition: node.definition },
        neighbors,
        repair: `上一次题目质检不合格（${firstAudit.flags.join("、")}）。请重写：必须引用原文、有具体误解、含错误干扰项，并且题干要求比较/边界/反例/迁移。`,
      });
      if (repaired.choices.length && repaired.correct_choice) {
        const repairedTask = createNodeTask(node, span, repaired);
        const repairedAudit = auditUnderstandingTask(repairedTask.id);
        if (repairedAudit && repairedAudit.score > firstAudit.score) {
          deleteUnderstandingTask(task.id);
          task = repairedTask;
        } else {
          deleteUnderstandingTask(repairedTask.id);
        }
      }
    } catch (err) {
      console.warn("[understanding] 节点题质量重写失败，保留原题：", err);
    }
  }
  return { status: "ready" as const, task: publicTask(task) };
}

export async function answerUnderstandingTask(
  taskId: string,
  choice: string,
  explanation: string,
  llm: LLMProvider,
) {
  const task = getUnderstandingTask(taskId);
  if (!task) return null;
  const choiceCorrect = choice === task.correct_choice;
  const rubric = JSON.parse(task.rubric_json || "[]") as string[];
  const source = task.source_span_id
    ? (db.prepare("SELECT text FROM source_spans WHERE id=?").get(task.source_span_id) as
        | { text: string }
        | undefined)
    : undefined;
  let explanationCorrect = true;
  let explanationFeedback = "";
  if (explanation.trim()) {
    const judged = await llm.judge({
      prompt: `${task.stem}\n原文：${source?.text ?? ""}\n用户选择：${choice}\n解释：${explanation}`,
      answer: explanation,
      reference: rubric.join("；"),
    });
    explanationCorrect = judged.correct;
    explanationFeedback = judged.feedback;
  }
  const eq = scoreExplanation(explanation, rubric, explanationCorrect);
  const correct = choiceCorrect && explanationCorrect;
  const feedback = !choiceCorrect
    ? `类型判断不对。${task.misconception ? `这道题针对的误解：${task.misconception}` : ""}`
    : `${explanationFeedback || "类型正确。"} 解释质量 ${eq.score}/100。${eq.feedback}`;
  recordUnderstandingAttempt({
    taskId,
    choice,
    explanation,
    correct,
    feedback,
    rubricScore: eq.score,
  });
  // 节点辨析答对即至少到第一档：理解路径可直接解锁副本，不强制走旧定义题。
  if (correct && task.target_type === "node" && task.node_id) {
    const node = getNode(task.node_id);
    if (node && node.tier < 1) {
      setNodeTier(node.id, 1);
      refreshBuildingStatus(node.id);
    }
  }
  return {
    correct,
    choice_correct: choiceCorrect,
    explanation_correct: explanationCorrect,
    explanation_score: eq.score,
    explanation_feedback: eq.feedback,
    feedback,
    correct_choice: task.correct_choice,
    rubric,
    follow_up: task.follow_up,
  };
}
