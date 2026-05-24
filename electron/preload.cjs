const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("appStorage", {
  load: () => ipcRenderer.invoke("app-state:load"),
  save: (state) => ipcRenderer.invoke("app-state:save", state),
  reset: () => ipcRenderer.invoke("app-state:reset"),

  exportBackup: () => ipcRenderer.invoke("app-state:export-backup"),
  importBackup: () => ipcRenderer.invoke("app-state:import-backup"),
  restoreLatestBackup: () =>
    ipcRenderer.invoke("app-state:restore-latest-backup"),
  openBackupFolder: () => ipcRenderer.invoke("app-state:open-backup-folder"),
  clearOldBackups: () => ipcRenderer.invoke("app-state:clear-old-backups"),
});
