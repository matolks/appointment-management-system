import { app } from "electron";
import { DatabaseSync } from "node:sqlite";
import path from "node:path";
import fs from "node:fs";

let db = null;

export function getDatabase() {
  if (db) return db;

  const dbDir = path.join(app.getPath("userData"), "data");
  fs.mkdirSync(dbDir, { recursive: true });

  const dbPath = path.join(dbDir, "appointments.sqlite");
  db = new DatabaseSync(dbPath);

  db.exec(`
    CREATE TABLE IF NOT EXISTS app_state (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    ) STRICT;
  `);

  return db;
}

export function loadAppState() {
  const database = getDatabase();

  const row = database
    .prepare("SELECT value FROM app_state WHERE key = ?")
    .get("main");

  if (!row) return null;

  return JSON.parse(row.value);
}

export function saveAppState(state) {
  const database = getDatabase();

  const save = database.prepare(`
    INSERT INTO app_state (key, value, updated_at)
    VALUES (?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(key)
    DO UPDATE SET
      value = excluded.value,
      updated_at = CURRENT_TIMESTAMP
  `);

  save.run("main", JSON.stringify(state));

  return true;
}

export function resetAppState() {
  const database = getDatabase();

  database.prepare("DELETE FROM app_state WHERE key = ?").run("main");

  database.exec("VACUUM");

  return true;
}
