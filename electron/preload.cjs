const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("appStorage", {
  load: () => ipcRenderer.invoke("app-state:load"),
  save: (state) => ipcRenderer.invoke("app-state:save", state),
  reset: () => ipcRenderer.invoke("app-state:reset"),
});
