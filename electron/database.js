/*
 * Copyright (c) 2026 Vince Matolka.
 * All rights reserved.
 *
 * This file is part of Appointment Manager.
 * Unauthorized copying, modification, distribution, or use is prohibited
 * without written permission from the copyright owner.
 */

import { app } from "electron";
import { DatabaseSync } from "node:sqlite";
import path from "node:path";
import fs from "node:fs";
import { performance } from "node:perf_hooks";

const APP_STATE_KEY = "main";
const BENCHMARK_STATE_KEY = "__benchmark__";
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
// -------------------------------------------------------------

function percentile(values, p) {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.floor((p / 100) * (sorted.length - 1));
  return sorted[index];
}

function summarize(label, values) {
  return {
    label,
    count: values.length,
    minMs: Math.min(...values).toFixed(3),
    p50Ms: percentile(values, 50).toFixed(3),
    p95Ms: percentile(values, 95).toFixed(3),
    maxMs: Math.max(...values).toFixed(3),
  };
}

function makeFakeState(entryCount) {
  const entries = Array.from({ length: entryCount }, (_, i) => ({
    id: i + 1,
    dateAdded: "2026-05-25",
    firstName: `First${i}`,
    lastName: `Last${i}`,
    provider: `Provider ${i % 10}`,
    tier: (i % 3) + 1,
    reason: "Testing query/storage speed with a realistic reason field.",
    availableDays: ["M", "W", "F"],
    availableTimes: ["8:00 AM-10:00 AM", "1:00 PM-3:00 PM"],
    status: "WAITLISTED",
  }));

  const openings = Array.from(
    { length: Math.floor(entryCount / 2) },
    (_, i) => ({
      id: i + 1,
      provider: `Provider ${i % 10}`,
      date: "2026-05-25",
      startTime: "09:00",
      endTime: "10:00",
    }),
  );

  return {
    version: CURRENT_VERSION,
    providers: Array.from({ length: 10 }, (_, i) => ({
      name: `Provider ${i}`,
      color: "#999999",
    })),
    entries,
    openings,
    scheduledRecords: [],
    removedRecords: [],
  };
}

function timeOperation(fn) {
  const start = performance.now();
  fn();
  return performance.now() - start;
}

function getAppStateRowByKey(database, key) {
  return database.prepare("SELECT value FROM app_state WHERE key = ?").get(key);
}

function writeBenchmarkStateTransaction(database, state) {
  const normalized = normalizeAppState(state);

  if (!normalized) {
    throw new TypeError("Invalid benchmark app state.");
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
      .run(BENCHMARK_STATE_KEY, value);

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

function readBenchmarkState(database) {
  const row = getAppStateRowByKey(database, BENCHMARK_STATE_KEY);

  if (!row?.value) return null;

  return normalizeAppState(JSON.parse(row.value));
}

function restoreBenchmarkRow(database, previousBenchmarkRow) {
  database.exec("BEGIN IMMEDIATE TRANSACTION;");

  try {
    if (previousBenchmarkRow?.value) {
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
        .run(BENCHMARK_STATE_KEY, previousBenchmarkRow.value);
    } else {
      database
        .prepare("DELETE FROM app_state WHERE key = ?")
        .run(BENCHMARK_STATE_KEY);
    }

    database.exec("COMMIT;");
  } catch (error) {
    try {
      database.exec("ROLLBACK;");
    } catch {
      // Ignore rollback failure and throw the original error.
    }

    throw error;
  }
}

export function benchmarkAppStateStorage() {
  const database = getDatabase();
  const previousBenchmarkRow = getAppStateRowByKey(
    database,
    BENCHMARK_STATE_KEY,
  );

  const sizes = [100, 500, 1000, 2500, 5000, 10000];
  const results = [];

  try {
    for (const size of sizes) {
      const state = makeFakeState(size);
      const jsonSizeKb =
        Buffer.byteLength(JSON.stringify(state), "utf8") / 1024;

      const writeTimes = [];
      const readTimes = [];

      // Warm up prepared statements, JSON parser, and SQLite page cache.
      writeBenchmarkStateTransaction(database, state);
      readBenchmarkState(database);

      for (let i = 0; i < 20; i++) {
        const nextState = {
          ...state,
          entries: state.entries.map((entry, index) =>
            index === 0 ? { ...entry, reason: `Changed ${i}` } : entry,
          ),
        };

        writeTimes.push(
          timeOperation(() =>
            writeBenchmarkStateTransaction(database, nextState),
          ),
        );
      }

      for (let i = 0; i < 100; i++) {
        readTimes.push(timeOperation(() => readBenchmarkState(database)));
      }

      results.push({
        entryCount: size,
        jsonSizeKb: jsonSizeKb.toFixed(1),
        write: summarize("benchmark write", writeTimes),
        read: summarize("benchmark read", readTimes),
      });
    }
  } finally {
    restoreBenchmarkRow(database, previousBenchmarkRow);
  }

  console.table(
    results.flatMap((row) => [
      {
        entries: row.entryCount,
        jsonKb: row.jsonSizeKb,
        op: "read benchmark row",
        p50Ms: row.read.p50Ms,
        p95Ms: row.read.p95Ms,
        maxMs: row.read.maxMs,
      },
      {
        entries: row.entryCount,
        jsonKb: row.jsonSizeKb,
        op: "write benchmark row",
        p50Ms: row.write.p50Ms,
        p95Ms: row.write.p95Ms,
        maxMs: row.write.maxMs,
      },
    ]),
  );

  return results;
}

export function benchmarkRawCurrentRowQuery() {
  const database = getDatabase();
  const query = database.prepare("SELECT value FROM app_state WHERE key = ?");
  const times = [];

  for (let i = 0; i < 1000; i++) {
    times.push(
      timeOperation(() => {
        query.get(APP_STATE_KEY);
      }),
    );
  }

  const summary = summarize("raw SELECT app_state", times);

  console.table([summary]);

  return summary;
}

export function benchmarkRealChangedSaveWithBackup() {
  const currentState = readStoredAppState();

  if (!currentState) {
    console.log("No real app state found to benchmark.");
    return null;
  }

  const originalState = currentState;
  const jsonSizeKb =
    Buffer.byteLength(JSON.stringify(originalState), "utf8") / 1024;

  const times = [];

  try {
    for (let i = 0; i < 20; i++) {
      const testState = {
        ...originalState,
        removedRecords: [
          ...originalState.removedRecords,
          {
            id: -1000000 - i,
            dateRemoved: new Date().toISOString(),
            firstName: "Benchmark",
            lastName: "Record",
            provider: "Benchmark",
            tier: 1,
            reason: `Temporary benchmark save ${i}`,
            availableDays: [],
            availableTimes: [],
            status: "REMOVED",
          },
        ],
      };

      times.push(
        timeOperation(() => {
          saveAppState(testState);
        }),
      );
    }
  } finally {
    saveAppState(originalState);
  }

  const summary = {
    jsonSizeKb: jsonSizeKb.toFixed(1),
    ...summarize("real changed saveAppState with backup", times),
  };

  console.table([summary]);

  return summary;
}
