import { db, getGraph, getNode, getWorld, listBuildings, getBuilding, type BuildingRow, type EdgeRow, type NodeRow } from "./db.js";

const DOMAIN_DAILY_LIMIT = 10;

export function todayShanghai(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai" }).format(new Date());
}

type Pt = { x: number; y: number };

function dist(a: Pt, b: Pt) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/** 在锚点周围找一个不压节点/建筑的空位（用于副本、方向标记） */
export function findFreeSpot(
  anchor: Pt,
  occupied: Pt[],
  radii = [240, 330, 430, 550, 690],
  preferRight = true,
): Pt {
  const angles: number[] = [];
  const start = preferRight ? 0 : -Math.PI;
  for (let k = 0; k < 16; k++) angles.push(start + k * (Math.PI / 8));
  let best: Pt = { x: anchor.x + 260, y: anchor.y };
  let bestClearance = -Infinity;
  for (const r of radii) {
    for (const a of angles) {
      const p = { x: anchor.x + Math.cos(a) * r, y: anchor.y + Math.sin(a) * r };
      let clearance = Infinity;
      for (const o of occupied) clearance = Math.min(clearance, dist(p, o) - 210);
      if (clearance >= 0) return p;
      if (clearance > bestClearance) {
        bestClearance = clearance;
        best = p;
      }
    }
  }
  return best;
}

function nodePoints(worldId: string, exclude?: string, extra: Pt[] = []): Pt[] {
  const { nodes } = getGraph(worldId);
  return [
    ...nodes.filter((n) => n.id !== exclude && !n.hidden).map((n) => ({ x: n.x, y: n.y })),
    ...extra,
  ];
}

/** 副本位置：锚点附近找空位，写回 DB；已存在但不合适的会重新放置 */
export function ensureBuildingPositions(worldId: string) {
  const nodes = getGraph(worldId).nodes;
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const buildings = listBuildings(worldId);
  const placed: Pt[] = [];
  for (const b of buildings) {
    const anchor = byId.get(b.anchor);
    if (!anchor) continue;
    const occupied = [
      ...nodes.map((n) => ({ x: n.x, y: n.y })),
      ...placed,
    ];
    let pos: Pt = { x: b.x, y: b.y };
    const overlaps = (p: Pt) =>
      occupied.some((o) => Math.abs(o.x - p.x) < 200 && Math.abs(o.y - p.y) < 180);
    if (!b.x && !b.y) {
      pos = findFreeSpot(anchor, occupied);
    } else if (overlaps(pos)) {
      pos = findFreeSpot(anchor, occupied, [260, 360, 470, 600]);
    }
    placed.push(pos);
    if (pos.x !== b.x || pos.y !== b.y) {
      db.prepare("UPDATE buildings SET x=?, y=? WHERE id=?").run(pos.x, pos.y, b.id);
    }
  }
}

/** 方向线：给未消费的方向边生成 frontier 坐标（围绕源节点，避开节点/建筑） */
export function ensureDirectionFrontiers(worldId: string) {
  const { nodes, edges } = getGraph(worldId);
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const buildings = listBuildings(worldId);
  for (const e of edges) {
    if (e.kind !== "direction" || e.consumed) continue;
    if (e.frontier_x != null && e.frontier_y != null) continue;
    const src = byId.get(e.src);
    if (!src) continue;
    let h = 0;
    for (let i = 0; i < e.id.length; i++) h = (h * 31 + e.id.charCodeAt(i)) | 0;
    const angle = ((Math.abs(h) % 360) * Math.PI) / 180;
    const occupied = [
      ...nodes.map((n) => ({ x: n.x, y: n.y })),
      ...buildings.map((b) => ({ x: b.x, y: b.y })),
    ];
    let spot: Pt | null = null;
    for (const r of [260, 340, 440, 560]) {
      const p = { x: src.x + Math.cos(angle) * r, y: src.y + Math.sin(angle) * r };
      const clear = occupied.every((o) => dist(p, o) > 180);
      if (clear) {
        spot = p;
        break;
      }
    }
    if (!spot) {
      spot = findFreeSpot({ x: src.x, y: src.y }, occupied, [260, 360, 470, 600], false);
    }
    db.prepare("UPDATE edges SET frontier_x=?, frontier_y=? WHERE id=?").run(spot.x, spot.y, e.id);
  }
}

export function setBuildingPosition(id: string, x: number, y: number) {
  db.prepare("UPDATE buildings SET x=?, y=? WHERE id=?").run(x, y, id);
}

export function consumeDirection(edgeId: string) {
  const row = db.prepare("SELECT * FROM edges WHERE id=?").get(edgeId) as EdgeRow | undefined;
  if (!row || row.kind !== "direction") return false;
  db.prepare("UPDATE edges SET consumed=1 WHERE id=?").run(edgeId);
  return true;
}

/** 隐藏预览：移除目标后，从根节点做无向 BFS，不可达的可见节点整片隐藏 */
export function hidePreview(worldId: string, nodeId: string) {
  const world = getWorld(worldId);
  if (!world) return { error: "world not found" as const };
  if (nodeId === world.root_node_id) return { error: "初始节点不能隐藏" as const };
  const node = getNode(nodeId);
  if (!node) return { error: "node not found" as const };
  const { nodes, edges } = getGraph(worldId);
  const visible = nodes.filter((n) => !n.hidden && n.id !== nodeId);
  const adj = new Map<string, string[]>();
  for (const n of visible) adj.set(n.id, []);
  for (const e of edges) {
    if (e.src === nodeId || e.dst === nodeId) continue;
    adj.get(e.src)?.push(e.dst);
    adj.get(e.dst)?.push(e.src);
  }
  const seen = new Set<string>();
  const queue = [world.root_node_id];
  while (queue.length) {
    const id = queue.shift()!;
    if (seen.has(id) || !adj.has(id)) continue;
    seen.add(id);
    for (const nb of adj.get(id) ?? []) if (!seen.has(nb)) queue.push(nb);
  }
  const toHide = visible.filter((n) => !seen.has(n.id));
  return {
    node: { id: node.id, name: node.name },
    nodes: toHide.map((n) => ({ id: n.id, name: n.name })),
  };
}

export function applyHide(worldId: string, nodeId: string) {
  const preview = hidePreview(worldId, nodeId);
  if ("error" in preview) return preview;
  const ids = [...preview.nodes.map((n) => n.id), nodeId];
  for (const id of ids) {
    db.prepare("UPDATE nodes SET hidden=1 WHERE id=?").run(id);
  }
  const batchId = crypto.randomUUID();
  db.prepare("INSERT INTO hide_batches(id,world_id,node_ids,created_at,undone) VALUES(?,?,?,?,0)").run(
    batchId,
    worldId,
    JSON.stringify(ids),
    Date.now(),
  );
  return { batchId, ids, count: ids.length };
}

export function undoLastHide(worldId: string) {
  const row = db
    .prepare("SELECT * FROM hide_batches WHERE world_id=? AND undone=0 ORDER BY created_at DESC LIMIT 1")
    .get(worldId) as { id: string; node_ids: string } | undefined;
  if (!row) return { error: "没有可撤回的隐藏" as const };
  const ids = JSON.parse(row.node_ids) as string[];
  for (const id of ids) db.prepare("UPDATE nodes SET hidden=0 WHERE id=?").run(id);
  db.prepare("UPDATE hide_batches SET undone=1 WHERE id=?").run(row.id);
  return { ids, count: ids.length };
}

/** 领域副本按 Asia/Shanghai 自然日限 10 道新题 */
export function bumpDomainDaily(
  worldId: string,
  buildingId: string,
  limit = DOMAIN_DAILY_LIMIT,
  increment = 1,
) {
  const date = todayShanghai();
  const row = db
    .prepare("SELECT used FROM daily_domain WHERE world_id=? AND building_id=? AND date=?")
    .get(worldId, buildingId, date) as { used: number } | undefined;
  const used = row?.used ?? 0;
  if (increment <= 0) return { allowed: true, used, limit };
  if (used >= limit) return { allowed: false, used, limit };
  if (row) {
    db.prepare("UPDATE daily_domain SET used=used+? WHERE world_id=? AND building_id=? AND date=?").run(
      increment,
      worldId,
      buildingId,
      date,
    );
  } else {
    db.prepare("INSERT INTO daily_domain(world_id,building_id,date,used) VALUES(?,?,?,?)").run(
      worldId,
      buildingId,
      date,
      increment,
    );
  }
  return { allowed: true, used: used + increment, limit };
}

export function exportWorld(worldId: string) {
  const world = getWorld(worldId);
  if (!world) return null;
  const { nodes, edges } = getGraph(worldId);
  const buildings = listBuildings(worldId);
  const quizzes = db
    .prepare(
      "SELECT q.* FROM quizzes q JOIN nodes n ON n.id=q.node_id WHERE n.world_id=?",
    )
    .all(worldId);
  const attempts = db
    .prepare(
      "SELECT a.* FROM attempts a JOIN quizzes q ON q.id=a.quiz_id JOIN nodes n ON n.id=q.node_id WHERE n.world_id=?",
    )
    .all(worldId);
  return { world, nodes, edges, buildings, quizzes, attempts, exportedAt: new Date().toISOString() };
}
