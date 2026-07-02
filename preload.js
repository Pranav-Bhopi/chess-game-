const { contextBridge, ipcRenderer } = require('electron');

// Expose a minimal, explicit window-controls API to the renderer. With
// contextIsolation on, this is the only bridge between the sandboxed page and
// the main process — no direct Node/ipcRenderer access leaks through.
contextBridge.exposeInMainWorld('windowControls', {
  minimize: () => ipcRenderer.send('window:minimize'),
  toggleMaximize: () => ipcRenderer.send('window:toggle-maximize'),
  close: () => ipcRenderer.send('window:close'),
  isMaximized: () => ipcRenderer.invoke('window:is-maximized'),
  // Subscribe to maximize-state changes; returns an unsubscribe function.
  onMaximizedChanged: (callback) => {
    const listener = (_event, isMax) => callback(isMax);
    ipcRenderer.on('window:maximized-changed', listener);
    return () => ipcRenderer.removeListener('window:maximized-changed', listener);
  },
});
