import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { env } from "../env.js";

mkdirSync(dirname(env.dbPath), { recursive: true });
export const db = new DatabaseSync(env.dbPath);
db.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;");
