// Preload script for context isolation
// Exposes a minimal API to the renderer process if needed

const { contextBridge } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  platform: process.platform,
  isElectron: true
});
