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

export type World = {
  id: string;
  name: string;
  root_node_id: string;
  is_demo: number;
  created_at: number;
};

export type Passed = { short: number; judge: number };

export type NodeRow = {
  id: string;
  world_id: string;
  name: string;
  x: number;
  y: number;
  free_md: string;
  hidden: number;
  tier: number;
  type: string;
  definition: string;
  aliases: string;
  source_span_id: string | null;
  frontier: number;
  passed?: Passed;
};

export type EdgeKind = "formal" | "source" | "suggest" | "direction";

export type EdgeRow = {
  id: string;
  world_id: string;
  src: string;
  dst: string;
  kind: EdgeKind;
  label: string;
  md: string;
  question: string | null;
  frontier_x?: number | null;
  frontier_y?: number | null;
  consumed?: number;
  predicate?: string | null;
  evidence?: string;
  confidence?: number;
  origin?: string;
  claim_status?: string;
  revision?: number;
};

export type BuildingRow = {
  id: string;
  world_id: string;
  kind: "domain" | "flow";
  anchor: string;
  title: string;
  sub: string;
  md: string;
  steps: string;
  status: "detected" | "locked" | "playable" | "cleared" | "stale";
  version?: number;
  basis?: string;
  fingerprint?: string;
  x: number;
  y: number;
};

export type DirectionRow = {
  id: string;
  world_id: string;
  node_id: string;
  question: string;
  reason: string;
  target_hint: string | null;
  status: "open" | "consumed" | "archived";
  created_at: number;
};

export type Quiz = {
  id: string;
  node_id: string;
  kind: "short" | "judge";
  prompt: string;
  answer: string;
};

export type WorldPayload = {
  world: World;
  nodes: NodeRow[];
  edges: EdgeRow[];
  buildings: BuildingRow[];
  directions?: DirectionRow[];
};
