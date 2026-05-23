import { app, BrowserWindow, ipcMain } from "electron";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  loadAppState,
  saveAppState,
  resetAppState,
  closeDatabase,
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

ipcMain.handle("app-state:load", (event) => {
  assertTrustedSender(event);
  return loadAppState();
});

ipcMain.handle("app-state:save", (event, state) => {
  assertTrustedSender(event);
  return saveAppState(state);
});

ipcMain.handle("app-state:reset", (event) => {
  assertTrustedSender(event);
  return resetAppState();
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
