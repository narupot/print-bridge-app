const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('bridge', {
  getConfig:  () => ipcRenderer.invoke('get-config'),
  getStatus:  () => ipcRenderer.invoke('get-status'),
  openGuide:  () => ipcRenderer.invoke('open-guide'),
  saveConfig: (cfg) => ipcRenderer.invoke('save-config', cfg),
});
