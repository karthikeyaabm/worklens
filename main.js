require('dotenv').config(); // Load environment variables from .env
const { app, BrowserWindow, screen, ipcMain, powerMonitor, Menu, Tray, nativeImage, dialog } = require('electron');
const path = require('path');
const os = require('os');
const redmineClient = require('./redmineClient');
const { autoUpdater } = require('electron-updater');
const log = require('electron-log');

log.transports.file.level = 'info';
autoUpdater.logger = log;

let mainWindow = null;
let dashboardWindow = null;
let tray = null;
let isQuitting = false;
let finalSyncDone = false;

// Request single instance lock
const gotTheLock = app.requestSingleInstanceLock();

function showAndFocusWindow() {
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    if (!mainWindow.isVisible()) mainWindow.show();
    mainWindow.focus();
    mainWindow.setAlwaysOnTop(true, 'screen-saver');
  }
}

let cachedUserId = null;
let currentRecord = null; // { appName, windowTitle, startTime, status } -- no `id`, no PUT flow (POST-only API)
let currentStatus = 'Active'; // 'Active' or 'Inactive'
let trackingInterval = null;
let lastDbSyncTime = Date.now();
let activeWin = null;

// Graceful degradation caches
let cachedRedmineEfforts = { yesterday: 0, today: 0 };
let cachedActiveTimeToday = 0;
let cachedActiveTimeYesterday = 0;

// Short-lived cache + in-flight dedup so get-active-time-today/yesterday don't
// fire two parallel identical requests to the summary endpoint (this caused a 500 earlier).
let activitySummaryCache = { data: null, fetchedAt: 0 };
let activitySummaryInFlight = null;

// Initialize active-win dynamic import
async function loadActiveWin() {
  if (!activeWin) {
    const mod = await import('active-win');
    activeWin = mod.default;
  }
  return activeWin;
}

function formatDateTime(date) {
  const yyyy = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const hour = String(date.getHours()).padStart(2, '0');
  const minute = String(date.getMinutes()).padStart(2, '0');
  const second = String(date.getSeconds()).padStart(2, '0');

  return `${yyyy}-${month}-${day}T${hour}:${minute}:${second}`;
}

function calculateDuration(startTime, endTime) {
  return Math.floor((endTime - startTime) / 1000);
}

// Get or Cache Redmine User ID using OS username via REST API
// Still needed for the numeric user_id in the activity-log POST body.
async function getUserId() {
  if (cachedUserId !== null) return cachedUserId;
  try {
    const username = os.userInfo().username;
    console.log(`[UserId Resolution] Resolving Redmine user_id for OS username: ${username}`);

    const response = await redmineClient.get('/users.json', { name: username, limit: 100 });
    if (response && Array.isArray(response.users)) {
      const matchedUser = response.users.find(u => u.login === username);
      if (matchedUser) {
        cachedUserId = matchedUser.id;
        console.log(`[UserId Resolution] Resolved OS username "${username}" to Redmine user_id: ${cachedUserId}`);
      } else {
        console.warn(`[UserId Resolution] No user with login "${username}" found in Redmine response.`);
      }
    }
  } catch (error) {
    console.error('Error resolving user ID via Redmine API:', error);
  }
  return cachedUserId;
}

// Single POST-only "chunk" sync — the API has no update/PUT endpoint, so every
// chunk is a complete, already-closed start->end record.
async function syncChunkToApi(appName, windowTitle, status, startTime, endTime) {
  const userId = await getUserId();
  if (!userId) return false;

  const body = {
    user_id: userId,
    app_name: appName,
    window_title: windowTitle,
    start_time: formatDateTime(startTime),
    end_time: formatDateTime(endTime),
    duration: calculateDuration(startTime, endTime),
    status: status.toLowerCase()
  };

  try {
    console.log(`[Sync] POST chunk user=${userId} app="${appName}" ${body.start_time} -> ${body.end_time} (${body.status})`);
    await redmineClient.post('/user_system_activity_logs.json', body);

    if (dashboardWindow && !dashboardWindow.isDestroyed()) {
      dashboardWindow.webContents.send('activity-synced', {
        lastSyncTime: Date.now()
      });
    }

    return true;
  } catch (error) {
    console.error('[Sync] Failed to sync activity chunk:', error.message || error);
    return false;
  }
}

// Main tracking tick
async function trackTick() {
  try {
    const userId = await getUserId();
    if (!userId) return;

    const idleTime = powerMonitor.getSystemIdleTime();
    const newStatus = idleTime >= 300 ? 'Inactive' : 'Active';
    currentStatus = newStatus;

    let currentApp = 'System';
    let currentTitle = 'Idle';

    if (newStatus === 'Active') {
      try {
        const getWin = await loadActiveWin();
        const winInfo = await getWin();
        if (winInfo) {
          currentApp = winInfo.owner?.name || 'Unknown';
          currentTitle = winInfo.title || 'Untitled';
        } else {
          currentApp = 'Unknown';
          currentTitle = 'No Active Window';
        }
      } catch (winError) {
        console.error('Error getting active window:', winError);
        currentApp = 'Unknown';
        currentTitle = 'Error';
      }
    }

    const now = new Date();
    const statusChanged = !currentRecord || currentRecord.status !== newStatus;
    const appChanged = currentRecord && currentRecord.status === 'Active' &&
      (currentRecord.appName !== currentApp || currentRecord.windowTitle !== currentTitle);

    if (statusChanged || appChanged) {
      // Close out the previous chunk fully (real start -> now)
      if (currentRecord) {
        await syncChunkToApi(currentRecord.appName, currentRecord.windowTitle, currentRecord.status, currentRecord.startTime, now);
      }

      // Start a fresh chunk from now
      currentRecord = {
        appName: currentApp,
        windowTitle: currentTitle,
        startTime: now,
        status: newStatus
      };
      lastDbSyncTime = Date.now();
    } else {
      // Periodic durability sync — no PUT available, so we close the current
      // chunk (start -> now) and immediately re-open a new chunk from `now`
      // with the same appName/windowTitle/status, so nothing is lost beyond ~15s.
      const elapsed = Date.now() - lastDbSyncTime;
      if (elapsed >= 15000 && currentRecord) {
        const synced = await syncChunkToApi(currentRecord.appName, currentRecord.windowTitle, currentRecord.status, currentRecord.startTime, now);
        if (synced) {
          currentRecord = {
            appName: currentRecord.appName,
            windowTitle: currentRecord.windowTitle,
            startTime: now,
            status: currentRecord.status
          };
        }
        lastDbSyncTime = Date.now();
      }
    }
  } catch (err) {
    console.error('Error in activity tracking tick:', err);
  }
}

function createWindow() {
  const primaryDisplay = screen.getPrimaryDisplay();
  const { width: workWidth, height: workHeight, x: workX, y: workY } = primaryDisplay.workArea;

  const widgetWidth = 185;
  const widgetHeight = 60;

  const x = workX + workWidth - widgetWidth - 20;
  const y = workY + workHeight - widgetHeight - 20;

  const loginSettings = app.getLoginItemSettings();
  const startHidden = loginSettings.wasOpenedAsHidden || process.argv.includes('--hidden') || process.argv.includes('--open-as-hidden');

  mainWindow = new BrowserWindow({
    width: widgetWidth,
    height: widgetHeight,
    x,
    y,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: false,
    movable: true,
    minimizable: true,
    maximizable: true,
    //closable: false,
    fullscreenable: false,
    hasShadow: false,
    show: !startHidden,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));

  //mainWindow.webContents.openDevTools();

  mainWindow.setAlwaysOnTop(true, 'screen-saver');

  mainWindow.on('close', (event) => {
    if (!isQuitting) {
      event.preventDefault();
      mainWindow.hide();
    }
  });
}

// IPC Handlers
ipcMain.handle('get-username', () => {
  return os.userInfo().username;
});

ipcMain.handle('get-app-version', () => {
  return app.getVersion();
});

// Response shape confirmed from logs:
// { user: {id, name}, yesterday: {date, hours}, today: {date, hours} }
ipcMain.handle('get-redmine-efforts', async () => {
  try {
    const username = os.userInfo().username;
    const response = await redmineClient.get('/today_timesheet.json', { user_id: username });

    console.log('\n========== TODAY TIMESHEET RESPONSE ==========');
    console.log(JSON.stringify(response, null, 2));

    const todayHours = parseFloat(response?.today?.hours ?? 0) || 0;
    const yesterdayHours = parseFloat(response?.yesterday?.hours ?? 0) || 0;

    cachedRedmineEfforts = { yesterday: yesterdayHours, today: todayHours };
  } catch (error) {
    console.error('get-redmine-efforts error:', error);
  }
  return cachedRedmineEfforts;
});

// Response shape confirmed from logs:
// { user_id, yesterday: {date, duration_hours}, today: {date, duration_hours} }
// Note: values are HOURS, not seconds — converted below since the renderer's
// formatSeconds() expects seconds.
async function fetchActivitySummary() {
  const now = Date.now();

  // Serve from cache if fresh (5s window)
  if (activitySummaryCache.data && (now - activitySummaryCache.fetchedAt) < 5000) {
    return activitySummaryCache.data;
  }

  // If a request is already in-flight, piggyback on it instead of firing a
  // second parallel identical request (this was causing the intermittent 500).
  if (activitySummaryInFlight) {
    return activitySummaryInFlight;
  }

  const username = os.userInfo().username;

  activitySummaryInFlight = (async () => {
    try {
      const response = await redmineClient.get('/user_system_activity_logs/summary.json', { user_id: username });

      console.log('\n========== ACTIVITY SUMMARY RESPONSE ==========');
      console.log(JSON.stringify(response, null, 2));

      const todayHours = parseFloat(response?.today?.duration_hours ?? 0) || 0;
      const yesterdayHours = parseFloat(response?.yesterday?.duration_hours ?? 0) || 0;

      const result = {
        today: Math.round(todayHours * 3600),
        yesterday: Math.round(yesterdayHours * 3600)
      };

      activitySummaryCache = { data: result, fetchedAt: Date.now() };
      return result;
    } finally {
      activitySummaryInFlight = null; // release the lock whether success or failure
    }
  })();

  return activitySummaryInFlight;
}

ipcMain.handle('get-active-time-today', async () => {
  try {
    const summary = await fetchActivitySummary();
    cachedActiveTimeToday = summary.today;
  } catch (error) {
    console.error('get-active-time-today error:', error);
    // Graceful degradation: fall through using cachedActiveTimeToday from last success
  }

  let totalSeconds = cachedActiveTimeToday;
  if (currentRecord && currentRecord.status === 'Active') {
    const now = new Date();
    if (now.toDateString() === currentRecord.startTime.toDateString()) {
      totalSeconds += Math.round((now - currentRecord.startTime) / 1000);
    }
  }
  return totalSeconds;
});

ipcMain.handle('get-active-time-yesterday', async () => {
  try {
    const summary = await fetchActivitySummary();
    cachedActiveTimeYesterday = summary.yesterday;
  } catch (error) {
    console.error('get-active-time-yesterday error:', error);
  }
  return cachedActiveTimeYesterday;
});

ipcMain.handle('get-current-status', () => {
  return currentStatus;
});

ipcMain.handle('open-activity-window', () => {
  if (dashboardWindow && !dashboardWindow.isDestroyed()) {
    if (dashboardWindow.isMinimized()) dashboardWindow.restore();
    if (!dashboardWindow.isVisible()) dashboardWindow.show();
    dashboardWindow.focus();
    return;
  }

  dashboardWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    title: 'WorkLens | Activity Log Dashboard',
    icon: path.join(__dirname, 'assets', 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'dashboardPreload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  dashboardWindow.setMenu(null);
  dashboardWindow.loadFile(path.join(__dirname, 'renderer', 'dashboard.html'));

  dashboardWindow.on('closed', () => {
    dashboardWindow = null;
  });
});

ipcMain.handle('get-dashboard-data', async () => {
  try {
    const username = os.userInfo().username;
    const userId = await getUserId();
    if (!userId) {
      throw new Error('User ID not resolved');
    }

    // Fetch today's logs
    const todayLogs = await redmineClient.get('/user_system_activity_logs/today.json', { user_id: userId });
    
    // Fetch summary logs
    const summary = await fetchActivitySummary();

    // Get user full name (optional, but premium if we cache it)
    let fullName = username;
    try {
      const usersResponse = await redmineClient.get('/users.json', { name: username, limit: 100 });
      if (usersResponse && Array.isArray(usersResponse.users)) {
        const matchedUser = usersResponse.users.find(u => u.login === username);
        if (matchedUser) {
          fullName = `${matchedUser.firstname} ${matchedUser.lastname}`;
        }
      }
    } catch (err) {
      console.error('Error fetching full name:', err);
    }

    // Format currentRecord to match API format
    let activeRecord = null;
    if (currentRecord) {
      const now = new Date();
      const duration = Math.floor((now - currentRecord.startTime) / 1000);
      
      // Format dates as DD-MM-YYYY HH:mm:ss
      const formatApiDate = (d) => {
        const day = String(d.getDate()).padStart(2, '0');
        const month = String(d.getMonth() + 1).padStart(2, '0');
        const year = d.getFullYear();
        const hr = String(d.getHours()).padStart(2, '0');
        const min = String(d.getMinutes()).padStart(2, '0');
        const sec = String(d.getSeconds()).padStart(2, '0');
        return `${day}-${month}-${year} ${hr}:${min}:${sec}`;
      };

      activeRecord = {
        id: 'current-virtual-record',
        user_id: userId,
        app_name: currentRecord.appName,
        window_title: currentRecord.windowTitle,
        start_time: formatApiDate(currentRecord.startTime),
        end_time: formatApiDate(now),
        duration: duration,
        status: currentRecord.status.toLowerCase()
      };
    }

    return {
      username: username,
      fullName: fullName,
      entries: todayLogs.entries || [],
      summary: summary,
      currentRecord: activeRecord
    };
  } catch (error) {
    console.error('get-dashboard-data error:', error);
    throw error;
  }
});

function createTray() {
  const iconPath = path.join(__dirname, 'assets', 'icon.png');
  let trayIcon = nativeImage.createFromPath(iconPath);
  trayIcon = trayIcon.resize({ width: 16, height: 16 });

  tray = new Tray(trayIcon);
  const contextMenu = Menu.buildFromTemplate([
    {
      label: 'Open WorkLens',
      click: () => {
        showAndFocusWindow();
      }
    },
    { type: 'separator' },
    {
      label: 'Exit',
      click: () => {
        isQuitting = true;
        app.quit();
      }
    }
  ]);

  tray.setToolTip('WorkLens');
  tray.setContextMenu(contextMenu);

  tray.on('double-click', () => {
    showAndFocusWindow();
  });
}

if (gotTheLock) {
  // App Lifecycle
  app.whenReady().then(async () => {
    try {
      app.setLoginItemSettings({
        openAtLogin: true,
        openAsHidden: true,
        path: process.execPath
      });
    } catch (error) {
      console.error(error);
    }

    const userId = await getUserId();
    if (userId) {
      console.log(`[Startup] App started. Resolved user ID: ${userId}. Tracking active sessions.`);
    }

    // Start tracking interval every 2 seconds
    trackingInterval = setInterval(trackTick, 2000);
    trackTick();

    createWindow();
    createTray();

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        createWindow();
      }
    });
    log.info(`Installed version: ${app.getVersion()}`);

    autoUpdater.on("checking-for-update", () => {
      log.info(`Checking for update. Current version: ${app.getVersion()}`);
    });
    // ---- Auto-update setup ----

    autoUpdater.on("update-available", (info) => {
      log.info(`[AutoUpdate] Update available: ${info.version}`);
      log.info(`Installed: ${app.getVersion()}`);
      log.info(`GitHub: ${info.version}`);
    });

    autoUpdater.on('update-not-available', () => {
      log.info('[AutoUpdate] No update available.');
    });

    autoUpdater.on('error', (err) => {
      log.error('[AutoUpdate] Error:', err);
    });

    autoUpdater.on('download-progress', (progress) => {
      log.info(`[AutoUpdate] Download progress: ${Math.round(progress.percent)}%`);
    });

    autoUpdater.on('update-downloaded', (info) => {
      log.info(`[AutoUpdate] Update downloaded: v${info.version}. Installing now...`);
      // Closes the app and installs the new version immediately.
      // currentRecord is already being flushed by the existing 'before-quit' handler.
      autoUpdater.quitAndInstall();
    });

    try {
      await autoUpdater.checkForUpdatesAndNotify();
    } catch (err) {
      log.error("[AutoUpdate] Initial check failed:", err);
    }

    // Re-check every 4 hours in the background
    setInterval(() => {
      autoUpdater.checkForUpdatesAndNotify();
    }, 4 * 60 * 60 * 1000);

    // Handle system suspend/resume
    powerMonitor.on('suspend', async () => {
      console.log('System suspending, saving current activity...');
      if (currentRecord) {
        await syncChunkToApi(currentRecord.appName, currentRecord.windowTitle, currentRecord.status, currentRecord.startTime, new Date());
        currentRecord = null;
      }
    });

    powerMonitor.on('resume', async () => {
      console.log('System resumed, restarting tracking...');
      trackTick();
    });
  });

  // Graceful exit
  app.on('before-quit', async (event) => {
    isQuitting = true;

    if (currentRecord && !finalSyncDone) {
      event.preventDefault();
      finalSyncDone = true;
      clearInterval(trackingInterval);
      console.log('App quitting, closing final activity record...');
      try {
        await syncChunkToApi(currentRecord.appName, currentRecord.windowTitle, currentRecord.status, currentRecord.startTime, new Date());
      } catch (e) {
        console.error(e);
      } finally {
        app.quit();
      }
    }
  });

  app.on('window-all-closed', (event) => {
    if (process.platform !== 'darwin') {
      if (isQuitting) {
        app.quit();
      } else {
        event.preventDefault();
      }
    }
  });
}