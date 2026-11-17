import { db } from "../db.js";
import type { EdgeRow } from "../db/edges.js";
import {
  createUnderstandingTask,
  getUnderstandingTask,
  getUnderstandingTaskByEdge,
  getUnderstandingTaskByEdgeKind,
  getUnderstandingTaskByNode,
  recordUnderstandingAttempt,
  type UnderstandingTaskRow,
} from "../db/understanding.js";
import type { LLMProvider } from "../providers/types.js";

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
  const task = createUnderstandingTask({
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
    source_span_id: span.id,
    follow_up: draft.follow_up,
  });
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
  const task = createUnderstandingTask({
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
  return { status: "ready" as const, task: publicTask(task) };
}

export async function answerUnderstandingTask(  taskId: string,
  choice: string,
  explanation: string,
  llm: LLMProvider,
) {
  const task = getUnderstandingTask(taskId);
  if (!task) return null;
  const choiceCorrect = choice === task.correct_choice;
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
      reference: JSON.parse(task.rubric_json || "[]").join("；"),
    });
    explanationCorrect = judged.correct;
    explanationFeedback = judged.feedback;
  }
  const correct = choiceCorrect && explanationCorrect;
  const feedback = !choiceCorrect
    ? `类型判断不对。${task.misconception ? `这道题针对的误解：${task.misconception}` : ""}`
    : explanationFeedback || "类型正确；补一句原文依据会更稳。";
  recordUnderstandingAttempt({ taskId, choice, explanation, correct, feedback });
  return {
    correct,
    choice_correct: choiceCorrect,
    explanation_correct: explanationCorrect,
    feedback,
    correct_choice: task.correct_choice,
    rubric: JSON.parse(task.rubric_json || "[]"),
    follow_up: task.follow_up,
  };
}
