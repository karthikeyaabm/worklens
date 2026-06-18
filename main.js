const { app, BrowserWindow, screen } = require('electron');
const path = require('path');

function createWindow() {
  const primaryDisplay = screen.getPrimaryDisplay();
  const { width: workWidth, height: workHeight, x: workX, y: workY } = primaryDisplay.workArea;

  const widgetWidth = 390;
  const widgetHeight = 150;

  // Position the window at the bottom-right corner, 20px off from right and bottom edges
  const x = workX + workWidth - widgetWidth - 20;
  const y = workY + workHeight - widgetHeight - 20;

  const mainWindow = new BrowserWindow({
    width: widgetWidth,
    height: widgetHeight,
    x: x,
    y: y,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: false,
    movable: true,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    hasShadow: false, // Custom shadow is handled in CSS for precise style match
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));

  // Keeps the window above standard windows and taskbar layers on Windows
  mainWindow.setAlwaysOnTop(true, 'screen-saver');

  // Prevent window from closing accidentally or losing focus behavior
  // Note: There is no close button in the UI, as requested.
}

app.whenReady().then(() => {
  // Configure auto start on Windows (only applicable when packaged, but safe to set)
  try {
    app.setLoginItemSettings({
      openAtLogin: true,
      path: process.execPath
    });
  } catch (error) {
    console.error('Failed to set login item settings:', error);
  }

  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
