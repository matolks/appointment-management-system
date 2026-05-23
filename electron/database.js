import { app } from "electron";
import { DatabaseSync } from "node:sqlite";
import path from "node:path";
import fs from "node:fs";

const APP_STATE_KEY = "main";
const CURRENT_VERSION = 1;

let db = null;

function getDbPath() {
  const dbDir = path.join(app.getPath("userData"), "data");
  fs.mkdirSync(dbDir, { recursive: true });
  return path.join(dbDir, "appointments.sqlite");
}

export function getDatabase() {
  if (db) return db;

  db = new DatabaseSync(getDbPath());

  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA synchronous = NORMAL;
    PRAGMA busy_timeout = 5000;

    CREATE TABLE IF NOT EXISTS app_state (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL CHECK (json_valid(value)),
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    ) STRICT;
  `);

  return db;
}

function normalizeAppState(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;

  return {
    version: CURRENT_VERSION,
    providers: Array.isArray(value.providers) ? value.providers : [],
    entries: Array.isArray(value.entries) ? value.entries : [],
    openings: Array.isArray(value.openings) ? value.openings : [],
    scheduledRecords: Array.isArray(value.scheduledRecords)
      ? value.scheduledRecords
      : [],
    removedRecords: Array.isArray(value.removedRecords)
      ? value.removedRecords
      : [],
  };
}

export function loadAppState() {
  const database = getDatabase();

  const row = database
    .prepare("SELECT value FROM app_state WHERE key = ?")
    .get(APP_STATE_KEY);

  if (!row?.value) return null;

  try {
    return normalizeAppState(JSON.parse(row.value));
  } catch {
    database
      .prepare(
        "UPDATE app_state SET key = ?, updated_at = CURRENT_TIMESTAMP WHERE key = ?",
      )
      .run(`${APP_STATE_KEY}.corrupt.${Date.now()}`, APP_STATE_KEY);

    return null;
  }
}

export function saveAppState(state) {
  const database = getDatabase();
  const normalized = normalizeAppState(state);

  if (!normalized) {
    throw new TypeError("Invalid app state.");
  }

  const value = JSON.stringify(normalized);

  database
    .prepare(
      `
      INSERT INTO app_state (key, value, updated_at)
      VALUES (?, json(?), CURRENT_TIMESTAMP)
      ON CONFLICT(key) DO UPDATE SET
        value = json(excluded.value),
        updated_at = CURRENT_TIMESTAMP
    `,
    )
    .run(APP_STATE_KEY, value);

  return true;
}

export function resetAppState() {
  const database = getDatabase();

  database.prepare("DELETE FROM app_state WHERE key = ?").run(APP_STATE_KEY);

  database.exec(`
    PRAGMA wal_checkpoint(TRUNCATE);
    VACUUM;
  `);

  return true;
}

export function closeDatabase() {
  if (!db) return;
  db.close();
  db = null;
}
