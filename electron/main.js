/*
 * Copyright (c) 2026 Vince Matolka.
 * All rights reserved.
 *
 * This file is part of Appointment Manager.
 * Unauthorized copying, modification, distribution, or use is prohibited
 * without written permission from the copyright owner.
 */

import { app, BrowserWindow, ipcMain, dialog, shell } from "electron";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  loadAppState,
  saveAppState,
  resetAppState,
  closeDatabase,
  exportFullBackup,
  importFullBackup,
  restoreLatestBackup,
  getBackupDirectory,
  clearOldBackups,
  benchmarkAppStateStorage, //
  benchmarkRawCurrentRowQuery, //
  benchmarkRealChangedSaveWithBackup, //
} from "./database.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DEV_SERVER_URL =
  process.env.VITE_DEV_SERVER_URL ?? "http://localhost:5173";
const RENDERER_DIST = path.join(__dirname, "../dist");
let mainWindow = null;

function isAllowedRendererUrl(rawUrl) {
  try {
    const url = new URL(rawUrl);
    if (app.isPackaged) {
      return url.protocol === "file:";
    }
    return url.origin === new URL(DEV_SERVER_URL).origin;
  } catch {
    return false;
  }
}

function assertTrustedSender(event) {
  if (!mainWindow || event.sender !== mainWindow.webContents) {
    throw new Error("Untrusted IPC sender.");
  }
  const senderUrl = event.senderFrame?.url ?? "";
  if (!isAllowedRendererUrl(senderUrl)) {
    throw new Error("Untrusted IPC sender URL.");
  }
}

function getBackupDefaultFileName() {
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  return `appointment-manager-backup-${timestamp}.json`;
}

function shouldRunDatabaseBenchmark() {
  return !app.isPackaged && process.env.BENCHMARK_DB === "1";
}

async function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  mainWindow.once("ready-to-show", () => {
    mainWindow?.show();

    if (shouldRunDatabaseBenchmark()) {
      console.log("Running database benchmark...");
      // For testing
      setTimeout(() => {
        benchmarkAppStateStorage();
        benchmarkRawCurrentRowQuery();
        benchmarkRealChangedSaveWithBackup();
      }, 1000);
    }
  });
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  mainWindow.webContents.on("will-navigate", (event) => {
    event.preventDefault();
  });
  if (app.isPackaged) {
    await mainWindow.loadFile(path.join(RENDERER_DIST, "index.html"));
  } else {
    await mainWindow.loadURL(DEV_SERVER_URL);
  }
}

// Load current persisted application state.
ipcMain.handle("app-state:load", (event) => {
  assertTrustedSender(event);
  return loadAppState();
});
// Save current application state.
// The database layer should create an automatic backup before committing.
ipcMain.handle("app-state:save", (event, state) => {
  assertTrustedSender(event);
  return saveAppState(state);
});
// Reset all persisted application state.
ipcMain.handle("app-state:reset", (event) => {
  assertTrustedSender(event);
  return resetAppState();
});
// Export a full JSON backup selected by the user.
ipcMain.handle("app-state:export-backup", async (event) => {
  assertTrustedSender(event);
  const result = await dialog.showSaveDialog(mainWindow, {
    title: "Export Full Backup",
    defaultPath: getBackupDefaultFileName(),
    filters: [{ name: "JSON Backup", extensions: ["json"] }],
  });
  if (result.canceled || !result.filePath) {
    return { canceled: true };
  }
  await exportFullBackup(result.filePath);
  return {
    canceled: false,
    filePath: result.filePath,
  };
});

// Import a full JSON backup selected by the user.
// The database layer should validate, persist, and return the restored state.
ipcMain.handle("app-state:import-backup", async (event) => {
  assertTrustedSender(event);
  const result = await dialog.showOpenDialog(mainWindow, {
    title: "Import Full Backup",
    properties: ["openFile"],
    filters: [{ name: "JSON Backup", extensions: ["json"] }],
  });
  if (result.canceled || result.filePaths.length === 0) {
    return null;
  }
  const restoredState = await importFullBackup(result.filePaths[0]);
  return restoredState;
});
// Restore the latest automatic backup.
ipcMain.handle("app-state:restore-latest-backup", async (event) => {
  assertTrustedSender(event);
  return restoreLatestBackup();
});
// Open the automatic backup folder in Finder/File Explorer.
ipcMain.handle("app-state:open-backup-folder", async (event) => {
  assertTrustedSender(event);
  const backupDirectory = getBackupDirectory();
  const errorMessage = await shell.openPath(backupDirectory);
  return {
    opened: errorMessage === "",
    error: errorMessage || undefined,
  };
});

ipcMain.handle("app-state:clear-old-backups", async (event) => {
  assertTrustedSender(event);
  return clearOldBackups();
});

app.whenReady().then(createWindow);
app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});

app.on("before-quit", () => {
  closeDatabase();
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});
