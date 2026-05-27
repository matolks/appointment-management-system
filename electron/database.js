/*
 * Copyright (c) 2026 Vince Matolka.
 * All rights reserved.
 *
 * This file is part of Appointment Management System.
 * Unauthorized copying, modification, distribution, or use is prohibited
 * without written permission from the copyright owner.
 */

import { app, safeStorage } from "electron";
import { DatabaseSync } from "node:sqlite";
import path from "node:path";
import fs from "node:fs";
import crypto from "node:crypto";

const APP_STATE_KEY = "main";

const CURRENT_APP_STATE_SCHEMA_VERSION = 1;
const CURRENT_BACKUP_FORMAT_VERSION = 1;
const CURRENT_DB_SCHEMA_VERSION = 1;

const MAX_AUTOMATIC_BACKUPS = 50;
const AUTOMATIC_BACKUP_RETENTION_DAYS = 365;
const AUTOMATIC_BACKUP_RETENTION_MS =
  AUTOMATIC_BACKUP_RETENTION_DAYS * 24 * 60 * 60 * 1000;

const ENCRYPTION_FORMAT = "appointment-manager-encrypted-v1";
const KEY_FILE_NAME = "appointment-manager-key.bin";

let db = null;
let cachedDataKey = null;

function getDataDirectory() {
  const dbDir = path.join(app.getPath("userData"), "data");
  fs.mkdirSync(dbDir, { recursive: true });
  lockDownDirectory(dbDir);
  return dbDir;
}

function getDbPath() {
  return path.join(getDataDirectory(), "appointments.sqlite");
}

function getKeyPath() {
  return path.join(getDataDirectory(), KEY_FILE_NAME);
}

export function getBackupDirectory() {
  const backupDir = path.join(app.getPath("userData"), "backups");
  fs.mkdirSync(backupDir, { recursive: true });
  lockDownDirectory(backupDir);

  return backupDir;
}

function lockDownDirectory(dirPath) {
  if (process.platform === "win32") return;
  try {
    fs.chmodSync(dirPath, 0o700);
  } catch {
    // Best-effort only. Some filesystems may not support chmod.
  }
}

function lockDownFile(filePath) {
  if (process.platform === "win32") return;
  try {
    fs.chmodSync(filePath, 0o600);
  } catch {
    // Best-effort only. Some filesystems may not support chmod.
  }
}

function getTimestampForFileName() {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

function getEmptyAppState() {
  return {
    schemaVersion: CURRENT_APP_STATE_SCHEMA_VERSION,
    providers: [],
    entries: [],
    openings: [],
    scheduledRecords: [],
    removedRecords: [],
  };
}

function getOrCreateDataKey() {
  if (cachedDataKey) return cachedDataKey;
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error(
      "OS encryption is not available. Cannot open encrypted database.",
    );
  }
  const keyPath = getKeyPath();
  if (fs.existsSync(keyPath)) {
    const encryptedKey = fs.readFileSync(keyPath);
    const keyHex = safeStorage.decryptString(encryptedKey);
    cachedDataKey = Buffer.from(keyHex, "hex");
    if (cachedDataKey.length !== 32) {
      throw new Error("Stored database encryption key is invalid.");
    }
    return cachedDataKey;
  }
  cachedDataKey = crypto.randomBytes(32);
  const encryptedKey = safeStorage.encryptString(cachedDataKey.toString("hex"));
  fs.writeFileSync(keyPath, encryptedKey);
  lockDownFile(keyPath);
  return cachedDataKey;
}

function encryptText(plainText) {
  const key = getOrCreateDataKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([
    cipher.update(plainText, "utf8"),
    cipher.final(),
  ]);
  const authTag = cipher.getAuthTag();
  return {
    format: ENCRYPTION_FORMAT,
    iv: iv.toString("base64"),
    authTag: authTag.toString("base64"),
    data: encrypted.toString("base64"),
  };
}

function decryptText(encryptedValue) {
  const parsed =
    typeof encryptedValue === "string"
      ? JSON.parse(encryptedValue)
      : encryptedValue;
  if (parsed?.format !== ENCRYPTION_FORMAT) {
    return null;
  }
  const key = getOrCreateDataKey();
  const iv = Buffer.from(parsed.iv, "base64");
  const authTag = Buffer.from(parsed.authTag, "base64");
  const data = Buffer.from(parsed.data, "base64");
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(authTag);
  return Buffer.concat([decipher.update(data), decipher.final()]).toString(
    "utf8",
  );
}

function isEncryptedEnvelope(value) {
  try {
    const parsed = typeof value === "string" ? JSON.parse(value) : value;
    return parsed?.format === ENCRYPTION_FORMAT;
  } catch {
    return false;
  }
}

function serializeStoredState(state) {
  return JSON.stringify(encryptText(JSON.stringify(state)));
}

function parseStoredState(value) {
  if (!value) return null;
  // Current encrypted SQLite format.
  if (isEncryptedEnvelope(value)) {
    return JSON.parse(decryptText(value));
  }
  // Backward compatibility for existing plaintext SQLite data.
  return JSON.parse(value);
}

function normalizeAppState(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const schemaVersion = Number.isInteger(value.schemaVersion)
    ? value.schemaVersion
    : Number.isInteger(value.version)
      ? value.version
      : 0;
  if (schemaVersion > CURRENT_APP_STATE_SCHEMA_VERSION) {
    throw new Error(`Unsupported app state schema version: ${schemaVersion}`);
  }

  return {
    schemaVersion: CURRENT_APP_STATE_SCHEMA_VERSION,
    providers: Array.isArray(value.providers) ? value.providers : [],
    entries: Array.isArray(value.entries) ? value.entries : [],
    openings: Array.isArray(value.openings)
      ? value.openings.map((opening) => ({
          ...opening,
          isSurgery: Boolean(opening.isSurgery),
        }))
      : [],
    scheduledRecords: Array.isArray(value.scheduledRecords)
      ? value.scheduledRecords
      : [],
    removedRecords: Array.isArray(value.removedRecords)
      ? value.removedRecords
      : [],
  };
}

function getDatabaseSchemaVersion(database) {
  const row = database.prepare("PRAGMA user_version").get();
  return row.user_version;
}

function migrateDatabaseSchema(database) {
  const version = getDatabaseSchemaVersion(database);
  if (version === 0) {
    database.exec(`PRAGMA user_version = ${CURRENT_DB_SCHEMA_VERSION};`);
    return;
  }
  if (version > CURRENT_DB_SCHEMA_VERSION) {
    throw new Error(`Unsupported database schema version: ${version}`);
  }
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
      value TEXT NOT NULL,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    ) STRICT;
  `);
  migrateDatabaseSchema(db);
  lockDownFile(getDbPath());
  return db;
}

function getCurrentAppStateRow(database) {
  return database
    .prepare("SELECT value FROM app_state WHERE key = ?")
    .get(APP_STATE_KEY);
}

function readStoredAppState(database = getDatabase()) {
  const row = getCurrentAppStateRow(database);
  if (!row?.value) return null;
  return normalizeAppState(parseStoredState(row.value));
}

function writeJsonFileAtomic(filePath, value) {
  const tempPath = `${filePath}.tmp`;
  fs.writeFileSync(tempPath, JSON.stringify(value, null, 2), "utf8");
  fs.renameSync(tempPath, filePath);
  lockDownFile(filePath);
}

function createBackupPayload(state, backupType) {
  const normalized = normalizeAppState(state);
  if (!normalized) {
    throw new Error("Cannot create backup from invalid app state.");
  }
  return {
    backupType,
    appName: "Appointment Manager",
    backupFormatVersion: CURRENT_BACKUP_FORMAT_VERSION,
    appStateSchemaVersion: CURRENT_APP_STATE_SCHEMA_VERSION,
    createdAt: new Date().toISOString(),
    encrypted: true,
    payload: encryptText(JSON.stringify(normalized)),
  };
}

function readBackupPayload(parsed) {
  // Current encrypted backup format.
  if (parsed?.encrypted === true && parsed?.payload) {
    if (
      Number.isInteger(parsed.backupFormatVersion) &&
      parsed.backupFormatVersion > CURRENT_BACKUP_FORMAT_VERSION
    ) {
      throw new Error(
        `Unsupported backup format version: ${parsed.backupFormatVersion}`,
      );
    }
    const decrypted = decryptText(parsed.payload);
    const normalized = normalizeAppState(JSON.parse(decrypted));
    if (!normalized) {
      throw new Error("Backup file contains invalid encrypted app state.");
    }
    return normalized;
  }

  // Old wrapped plaintext backup format.
  if (parsed?.state) {
    const normalized = normalizeAppState(parsed.state);
    if (!normalized) {
      throw new Error("Backup file contains invalid app state.");
    }
    return normalized;
  }

  // Old plain PersistedAppState JSON format.
  const normalized = normalizeAppState(parsed);
  if (!normalized) {
    throw new Error("Backup file contains invalid app state.");
  }
  return normalized;
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
  for (const file of backupFiles) {
    if (file.mtimeMs < cutoffTime) {
      filesToDelete.add(file.filePath);
    }
  }
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
  return readBackupPayload(parsed);
}

function writeAppStateTransaction(database, state) {
  const normalized = normalizeAppState(state);
  if (!normalized) {
    throw new TypeError("Invalid app state.");
  }
  const value = serializeStoredState(normalized);
  database.exec("BEGIN IMMEDIATE TRANSACTION;");
  try {
    database
      .prepare(
        `
        INSERT INTO app_state (key, value, updated_at)
        VALUES (?, ?, CURRENT_TIMESTAMP)
        ON CONFLICT(key) DO UPDATE SET
          value = excluded.value,
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
    const normalized = normalizeAppState(parseStoredState(row.value));
    // If old plaintext data was loaded successfully, rewrite it encrypted.
    if (!isEncryptedEnvelope(row.value) && normalized) {
      writeAppStateTransaction(database, normalized);
    }
    return normalized;
  } catch {
    const corruptKey = `${APP_STATE_KEY}.corrupt.${Date.now()}`;
    const corruptBackupPath = path.join(
      getBackupDirectory(),
      `corrupt-app-state-${getTimestampForFileName()}.txt`,
    );
    try {
      fs.writeFileSync(corruptBackupPath, row.value, "utf8");
      lockDownFile(corruptBackupPath);
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
  const currentRow = getCurrentAppStateRow(database);
  const currentState = currentRow?.value ? readStoredAppState(database) : null;
  if (
    currentState &&
    JSON.stringify(currentState) === JSON.stringify(normalized)
  ) {
    return true;
  }
  if (currentRow?.value) {
    createAutomaticBackupFromDatabase(database, "before-save");
  }
  writeAppStateTransaction(database, normalized);
  return true;
}

export function resetAppState() {
  const database = getDatabase();
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
      const raw = fs.readFileSync(backup.filePath, "utf8");
      const parsed = JSON.parse(raw);
      if (parsed?.backupType === "before-restore") {
        continue;
      }
      latestValidBackup = readBackupPayload(parsed);
      break;
    } catch {
      // Skip invalid backup files and try the next newest one.
    }
  }
  if (!latestValidBackup) {
    throw new Error("No valid backup files could be restored.");
  }
  createAutomaticBackupFromDatabase(database, "before-restore");
  const restoredState = writeAppStateTransaction(database, latestValidBackup);
  return restoredState;
}

export function closeDatabase() {
  if (!db) return;
  db.close();
  db = null;
}
