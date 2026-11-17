import { randomUUID } from "node:crypto";
import { db } from "./connection.js";

const now = () => Date.now();
const uid = () => randomUUID();

export type UnderstandingTaskRow = {
  id: string;
  world_id: string;
  edge_id: string;
  target_type: "edge" | "node" | string;
  node_id: string | null;
  learning_goal: string;
  misconception: string;
  stem: string;
  answer_type: string;
  choices_json: string;
  correct_choice: string;
  rubric_json: string;
  evidence_quote: string;
  source_span_id: string | null;
  follow_up: string;
  created_at: number;
};

export function getUnderstandingTaskByEdge(edgeId: string): UnderstandingTaskRow | undefined {
  return db
    .prepare("SELECT * FROM understanding_tasks WHERE edge_id=? ORDER BY created_at DESC LIMIT 1")
    .get(edgeId) as UnderstandingTaskRow | undefined;
}

export function getUnderstandingTaskByNode(nodeId: string): UnderstandingTaskRow | undefined {
  return db
    .prepare("SELECT * FROM understanding_tasks WHERE node_id=? ORDER BY created_at DESC LIMIT 1")
    .get(nodeId) as UnderstandingTaskRow | undefined;
}

export function getUnderstandingTask(id: string): UnderstandingTaskRow | undefined {
  return db.prepare("SELECT * FROM understanding_tasks WHERE id=?").get(id) as
    | UnderstandingTaskRow
    | undefined;
}

export function createUnderstandingTask(
  input: Omit<UnderstandingTaskRow, "id" | "created_at">,
): UnderstandingTaskRow {
  const id = uid();
  db.prepare(
    `INSERT INTO understanding_tasks(id,world_id,edge_id,target_type,node_id,learning_goal,misconception,stem,answer_type,choices_json,correct_choice,rubric_json,evidence_quote,source_span_id,follow_up,created_at)
     VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
  ).run(
    id,
    input.world_id,
    input.edge_id,
    input.target_type,
    input.node_id,
    input.learning_goal,
    input.misconception,
    input.stem,
    input.answer_type,
    input.choices_json,
    input.correct_choice,
    input.rubric_json,
    input.evidence_quote,
    input.source_span_id,
    input.follow_up,
    now(),
  );
  return getUnderstandingTask(id)!;
}

export function recordUnderstandingAttempt(input: {
  taskId: string;
  choice: string;
  explanation: string;
  correct: boolean;
  feedback: string;
}) {
  db.prepare(
    "INSERT INTO understanding_attempts(id,task_id,choice,explanation,correct,feedback,at) VALUES(?,?,?,?,?,?,?)",
  ).run(
    uid(),
    input.taskId,
    input.choice,
    input.explanation,
    input.correct ? 1 : 0,
    input.feedback,
    now(),
  );
}
