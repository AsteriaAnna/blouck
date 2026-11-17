import { randomUUID } from "node:crypto";
import { db } from "./connection.js";

const now = () => Date.now();
const uid = () => randomUUID();

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
  version: number;
  basis: string;
  fingerprint: string;
  x: number;
  y: number;
  created_at: number;
};

export function createBuilding(
  worldId: string,
  kind: "domain" | "flow",
  anchor: string,
  title: string,
  sub: string,
  md: string,
  steps: string[],
): BuildingRow {
  const id = uid();
  const fingerprint = [...steps].sort().join("|") || `${kind}:${anchor}`;
  db.prepare(
    "INSERT INTO buildings(id,world_id,kind,anchor,title,sub,md,steps,status,version,basis,fingerprint,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)",
  ).run(
    id,
    worldId,
    kind,
    anchor,
    title,
    sub,
    md,
    JSON.stringify(steps),
    "detected",
    1,
    JSON.stringify({ kind, anchor }),
    fingerprint,
    now(),
  );
  return db.prepare("SELECT * FROM buildings WHERE id=?").get(id) as BuildingRow;
}

export function setBuildingStatus(id: string, status: BuildingRow["status"]) {
  db.prepare("UPDATE buildings SET status=? WHERE id=?").run(status, id);
}

export function updateBuildingMd(id: string, md: string, steps?: string[]) {
  if (steps) {
    db.prepare("UPDATE buildings SET md=?, steps=? WHERE id=?").run(
      md,
      JSON.stringify(steps),
      id,
    );
  } else {
    db.prepare("UPDATE buildings SET md=? WHERE id=?").run(md, id);
  }
}

/** 节点达到可挑战条件后刷新建筑状态（MVP 简化：相关节点至少 2 个首档） */
