export async function get<T>(url: string): Promise<T> {
  const r = await fetch(url);
  if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error ?? r.statusText);
  return r.json();
}

export async function send<T>(
  url: string,
  method: "POST" | "PATCH" | "DELETE",
  body?: unknown,
): Promise<T> {
  const r = await fetch(url, {
    method,
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error ?? r.statusText);
  return r.json();
}

/**
 * API DTO 来自 @blouck/shared，避免前后端各写一份。
 * 这里保留旧名称（NodeRow/EdgeRow/...）作为别名，减少调用点改动。
 */
export type {
  WorldDTO as World,
  PassedDTO as Passed,
  NodeDTO as NodeRow,
  EdgeDTO as EdgeRow,
  BuildingDTO as BuildingRow,
  DirectionDTO as DirectionRow,
  QuizDTO as Quiz,
  NodeDoc,
  NodeDocPayload,
  RelationDoc,
  RelationDocPayload,
  NodeCandidateDTO,
  WorldPayloadDTO as WorldPayload,
  EdgeKind,
  NodeType,
  RelationPredicate,
} from "@blouck/shared";
