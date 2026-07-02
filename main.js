const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');

let mainWindow = null;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1100,
    height: 800,
    minWidth: 800,
    minHeight: 640,
    backgroundColor: '#302e2b',
    title: 'Chess',
    frame: false,            // borderless — we draw our own titlebar
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: path.join(__dirname, 'preload.js'),
    },
  });

  mainWindow.setMenuBarVisibility(false);
  mainWindow.loadFile('index.html');

  // Tell the renderer when the maximize state changes so it can swap the
  // maximize/restore icon.
  const sendMaxState = () => {
    if (!mainWindow) return;
    mainWindow.webContents.send('window:maximized-changed', mainWindow.isMaximized());
  };
  mainWindow.on('maximize', sendMaxState);
  mainWindow.on('unmaximize', sendMaxState);

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

// ---- Window control IPC (from the custom titlebar in the renderer) ----
ipcMain.on('window:minimize', () => {
  BrowserWindow.getFocusedWindow()?.minimize();
});

ipcMain.on('window:toggle-maximize', () => {
  const win = BrowserWindow.getFocusedWindow();
  if (!win) return;
  if (win.isMaximized()) win.unmaximize();
  else win.maximize();
});

ipcMain.on('window:close', () => {
  BrowserWindow.getFocusedWindow()?.close();
});

// Let the renderer query the current maximize state on load.
ipcMain.handle('window:is-maximized', () => {
  return BrowserWindow.getFocusedWindow()?.isMaximized() ?? false;
});

app.whenReady().then(() => {
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
