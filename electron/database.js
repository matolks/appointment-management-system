import { app } from "electron";
import { DatabaseSync } from "node:sqlite";
import path from "node:path";
import fs from "node:fs";

const APP_STATE_KEY = "main";
const CURRENT_VERSION = 1;
const MAX_AUTOMATIC_BACKUPS = 50;
const AUTOMATIC_BACKUP_RETENTION_DAYS = 365;
const AUTOMATIC_BACKUP_RETENTION_MS =
  AUTOMATIC_BACKUP_RETENTION_DAYS * 24 * 60 * 60 * 1000;

let db = null;

function getDataDirectory() {
  const dbDir = path.join(app.getPath("userData"), "data");
  fs.mkdirSync(dbDir, { recursive: true });
  return dbDir;
}

function getDbPath() {
  return path.join(getDataDirectory(), "appointments.sqlite");
}

export function getBackupDirectory() {
  const backupDir = path.join(app.getPath("userData"), "backups");
  fs.mkdirSync(backupDir, { recursive: true });
  return backupDir;
}

function getTimestampForFileName() {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

function getEmptyAppState() {
  return {
    version: CURRENT_VERSION,
    providers: [],
    entries: [],
    openings: [],
    scheduledRecords: [],
    removedRecords: [],
  };
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

function getCurrentAppStateRow(database) {
  return database
    .prepare("SELECT value FROM app_state WHERE key = ?")
    .get(APP_STATE_KEY);
}

function readStoredAppState(database = getDatabase()) {
  const row = getCurrentAppStateRow(database);
  if (!row?.value) return null;
  return normalizeAppState(JSON.parse(row.value));
}

function writeJsonFileAtomic(filePath, value) {
  const tempPath = `${filePath}.tmp`;
  fs.writeFileSync(tempPath, JSON.stringify(value, null, 2), "utf8");
  fs.renameSync(tempPath, filePath);
}

function createBackupPayload(state, backupType) {
  return {
    backupType,
    appName: "Appointment Manager",
    appStateVersion: CURRENT_VERSION,
    createdAt: new Date().toISOString(),
    state,
  };
}

function createAutomaticBackupFromState(state, backupType) {
  const normalized = normalizeAppState(state);
  if (!normalized) return null;

  const backupDir = getBackupDirectory();
  const fileName = `appointment-manager-${backupType}-${getTimestampForFileName()}-${Math.random()
    .toString(16)
    .slice(2)}.json`;
  const filePath = path.join(backupDir, fileName);
  writeJsonFileAtomic(filePath, createBackupPayload(normalized, backupType));
  pruneAutomaticBackups();
  return filePath;
}

function createAutomaticBackupFromDatabase(database, backupType) {
  const currentState = readStoredAppState(database);
  if (!currentState) return null;
  return createAutomaticBackupFromState(currentState, backupType);
}

function pruneAutomaticBackups() {
  const backupDir = getBackupDirectory();
  const cutoffTime = Date.now() - AUTOMATIC_BACKUP_RETENTION_MS;
  const backupFiles = fs
    .readdirSync(backupDir)
    .filter(
      (fileName) =>
        fileName.startsWith("appointment-manager-") &&
        fileName.endsWith(".json"),
    )
    .map((fileName) => {
      const filePath = path.join(backupDir, fileName);
      const stat = fs.statSync(filePath);
      return {
        fileName,
        filePath,
        mtimeMs: stat.mtimeMs,
      };
    })
    .sort((a, b) => b.mtimeMs - a.mtimeMs);
  const filesToDelete = new Set();
  // Delete automatic backups older than one year.
  for (const file of backupFiles) {
    if (file.mtimeMs < cutoffTime) {
      filesToDelete.add(file.filePath);
    }
  }
  // Also keep the existing safety cap of 50 automatic backups.
  for (const file of backupFiles.slice(MAX_AUTOMATIC_BACKUPS)) {
    filesToDelete.add(file.filePath);
  }
  for (const filePath of filesToDelete) {
    try {
      fs.unlinkSync(filePath);
    } catch {
      // If a backup cannot be deleted, leave it alone.
    }
  }
}

export function clearOldBackups() {
  const backupDir = getBackupDirectory();
  const beforeFiles = fs
    .readdirSync(backupDir)
    .filter(
      (fileName) =>
        fileName.startsWith("appointment-manager-") &&
        fileName.endsWith(".json"),
    );
  pruneAutomaticBackups();
  const afterFiles = fs
    .readdirSync(backupDir)
    .filter(
      (fileName) =>
        fileName.startsWith("appointment-manager-") &&
        fileName.endsWith(".json"),
    );
  return {
    deletedCount: Math.max(0, beforeFiles.length - afterFiles.length),
    keptCount: afterFiles.length,
    backupDir,
  };
}

function readBackupFile(filePath) {
  const raw = fs.readFileSync(filePath, "utf8");
  const parsed = JSON.parse(raw);
  // Supports the new wrapped backup format.
  if (parsed?.state) {
    const normalized = normalizeAppState(parsed.state);
    if (!normalized) {
      throw new Error("Backup file contains invalid app state.");
    }
    return normalized;
  }

  // Supports plain PersistedAppState JSON if you ever export/import that directly.
  const normalized = normalizeAppState(parsed);
  if (!normalized) {
    throw new Error("Backup file contains invalid app state.");
  }
  return normalized;
}

function writeAppStateTransaction(database, state) {
  const normalized = normalizeAppState(state);
  if (!normalized) {
    throw new TypeError("Invalid app state.");
  }
  const value = JSON.stringify(normalized);
  database.exec("BEGIN IMMEDIATE TRANSACTION;");
  try {
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
    database.exec("COMMIT;");
  } catch (error) {
    try {
      database.exec("ROLLBACK;");
    } catch {
      // Ignore rollback failure and throw the original error.
    }
    throw error;
  }
  return normalized;
}

export function loadAppState() {
  const database = getDatabase();
  pruneAutomaticBackups();
  const row = getCurrentAppStateRow(database);
  if (!row?.value) return null;
  try {
    return normalizeAppState(JSON.parse(row.value));
  } catch {
    const corruptKey = `${APP_STATE_KEY}.corrupt.${Date.now()}`;
    const corruptBackupPath = path.join(
      getBackupDirectory(),
      `corrupt-app-state-${getTimestampForFileName()}.txt`,
    );
    try {
      fs.writeFileSync(corruptBackupPath, row.value, "utf8");
    } catch {
      // If the corrupt row cannot be written out, still quarantine it below.
    }
    database
      .prepare(
        "UPDATE app_state SET key = ?, updated_at = CURRENT_TIMESTAMP WHERE key = ?",
      )
      .run(corruptKey, APP_STATE_KEY);
    return null;
  }
}

export function saveAppState(state) {
  const database = getDatabase();
  const normalized = normalizeAppState(state);
  if (!normalized) {
    throw new TypeError("Invalid app state.");
  }
  const nextValue = JSON.stringify(normalized);
  const currentRow = getCurrentAppStateRow(database);
  // Avoid creating duplicate backups and writes when React sends the same state again.
  if (currentRow?.value === nextValue) {
    return true;
  }
  // Before replacing the current database state, preserve the previous good state.
  if (currentRow?.value) {
    createAutomaticBackupFromDatabase(database, "before-save");
  }
  writeAppStateTransaction(database, normalized);
  return true;
}

export function resetAppState() {
  const database = getDatabase();
  // Reset is destructive, so preserve the current state first.
  createAutomaticBackupFromDatabase(database, "before-reset");
  database.exec("BEGIN IMMEDIATE TRANSACTION;");
  try {
    database.prepare("DELETE FROM app_state WHERE key = ?").run(APP_STATE_KEY);
    database.exec("COMMIT;");
  } catch (error) {
    try {
      database.exec("ROLLBACK;");
    } catch {
      // Ignore rollback failure and throw the original error.
    }
    throw error;
  }
  database.exec(`
    PRAGMA wal_checkpoint(TRUNCATE);
    VACUUM;
  `);
  return true;
}

export function exportFullBackup(filePath) {
  const database = getDatabase();
  const currentState = readStoredAppState(database) ?? getEmptyAppState();
  writeJsonFileAtomic(
    filePath,
    createBackupPayload(currentState, "manual-export"),
  );
  return true;
}

export function importFullBackup(filePath) {
  const database = getDatabase();
  const importedState = readBackupFile(filePath);
  // Import replaces the database, so preserve the current state first.
  createAutomaticBackupFromDatabase(database, "before-import");
  const restoredState = writeAppStateTransaction(database, importedState);
  return restoredState;
}

export function restoreLatestBackup() {
  const database = getDatabase();
  const backupDir = getBackupDirectory();
  const backupFiles = fs
    .readdirSync(backupDir)
    .filter(
      (fileName) =>
        fileName.startsWith("appointment-manager-") &&
        fileName.endsWith(".json"),
    )
    .map((fileName) => {
      const filePath = path.join(backupDir, fileName);
      const stat = fs.statSync(filePath);
      return {
        fileName,
        filePath,
        mtimeMs: stat.mtimeMs,
      };
    })
    .sort((a, b) => b.mtimeMs - a.mtimeMs);
  if (backupFiles.length === 0) {
    return null;
  }
  let latestValidBackup = null;
  for (const backup of backupFiles) {
    try {
      latestValidBackup = readBackupFile(backup.filePath);
      break;
    } catch {
      // Skip invalid backup files and try the next newest one.
    }
  }
  if (!latestValidBackup) {
    throw new Error("No valid backup files could be restored.");
  }
  // Restore is destructive, so preserve the current state first.
  createAutomaticBackupFromDatabase(database, "before-restore");
  const restoredState = writeAppStateTransaction(database, latestValidBackup);
  return restoredState;
}

export function closeDatabase() {
  if (!db) return;
  db.close();
  db = null;
}
