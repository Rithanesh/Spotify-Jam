const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  platform: process.platform,
  apiBaseUrl: 'http://127.0.0.1:9000', // renderer always talks loopback; LAN clients hit the same backend directly
  openExternal: (url) => ipcRenderer.invoke('open-external', url),
});
