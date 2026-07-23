require('dotenv').config(); // Load environment variables from .env
const { app, BrowserWindow, screen, ipcMain, powerMonitor, Menu, Tray, nativeImage, dialog } = require('electron');
const path = require('path');
const os = require('os');
const { exec } = require('child_process');
const quotes = require('./quotes');

// Inactivity Nudge Configuration
const INACTIVITY_THRESHOLD_SECONDS = 300; // 5 minutes inactivity trigger threshold
const IDLE_CHECK_INTERVAL_MS = 1000; // 1 second interval to close quickly on user activity
const POPUP_AUTO_CLOSE_MS = 10000; // 10 seconds auto-close if no user action

let inactivityPopup = null;
let inactivityPopupShown = false;
let isSystemLocked = false;
let inactivityInterval = null;
const util = require('util');
const execPromise = util.promisify(exec);
const redmineClient = require('./redmineClient');
const { autoUpdater } = require('electron-updater');
const log = require('./logger');
autoUpdater.logger = log;

let mainWindow = null;
let activityWindow = null;
let isPopupReady = false;
let showPopupOnReady = false;
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
let currentRecord = null; // { appName, windowTitle, startTime, activityOn, status } -- no `id`, no PUT flow (POST-only API)
let currentStatus = 'Active'; // 'Active' or 'Inactive'
let trackingInterval = null;
let lastDbSyncTime = Date.now();
let activeWin = null;

const appIconCache = {}; // maps appName.toLowerCase() -> base64 data URL

async function cacheAppIcon(appName, exePath) {
  if (!appName || !exePath) return;
  const key = appName.toLowerCase();
  if (appIconCache[key]) return;

  try {
    const icon = await app.getFileIcon(exePath, { size: 'normal' });
    if (icon) {
      appIconCache[key] = icon.toDataURL();
      console.log(`[IconCache] Cached icon for app: ${appName}`);
    }
  } catch (err) {
    console.error(`[IconCache] Failed to get icon for ${appName} at ${exePath}:`, err);
  }
}

async function preCacheCommonIcons() {
  const commonPaths = [
    { name: 'Windows Explorer', path: 'C:\\Windows\\explorer.exe' },
    { name: 'System UI', path: 'C:\\Windows\\explorer.exe' },
    { name: 'LockApp', path: 'C:\\Windows\\SystemApps\\Microsoft.LockApp_cw5n1h2txyewy\\LockApp.exe' },
    { name: 'Electron', path: process.execPath }
  ];
  for (const item of commonPaths) {
    try {
      const fs = require('fs');
      if (fs.existsSync(item.path)) {
        await cacheAppIcon(item.name, item.path);
      }
    } catch (e) {
      console.error(`[IconCache] Error pre-caching ${item.name}:`, e);
    }
  }
}

const nameOverrides = {
  'windows explorer': 'explorer',
  'microsoft teams': 'ms-teams',
  'system ui': 'explorer',
  'lockapp': 'lockapp',
  'electron': 'electron'
};

async function scanAndCacheIcons(appNames) {
  try {
    const missingNames = appNames.filter(name => !appIconCache[name.toLowerCase()]);
    if (missingNames.length === 0) return;

    const cmd = 'powershell -NoProfile -ExecutionPolicy Bypass -Command "Get-Process | Where-Object { $null -ne $_.Path } | Select-Object Name, Path -Unique | ConvertTo-Json"';
    const { stdout } = await execPromise(cmd);
    if (!stdout) return;

    let processes = [];
    try {
      processes = JSON.parse(stdout);
      if (!Array.isArray(processes)) {
        processes = [processes];
      }
    } catch (e) {
      console.error('[IconCache] Failed to parse PowerShell output:', e);
      return;
    }

    for (const appName of missingNames) {
      const cleanName = appName.toLowerCase().replace(/\.exe$/, '');
      const targetProcName = nameOverrides[cleanName] || cleanName;

      const matchedProc = processes.find(p => {
        if (!p || !p.Name) return false;
        const procName = p.Name.toLowerCase();
        return procName === targetProcName ||
          procName.includes(targetProcName) ||
          targetProcName.includes(procName);
      });

      if (matchedProc && matchedProc.Path) {
        await cacheAppIcon(appName, matchedProc.Path);
      }
    }
  } catch (error) {
    console.error('[IconCache] Error scanning running processes:', error);
  }
}

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
      const matchedUser = response.users.find(u => (u.login && u.login.toLowerCase()) === (username && username.toLowerCase()));
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
// Signature order is: startTime, endTime, activityOn — callers below now match this.
async function syncChunkToApi(appName, windowTitle, status, startTime, endTime, activityOn) {
  const userId = await getUserId();
  if (!userId) return false;

  const body = {
    user_id: userId,
    app_name: appName,
    window_title: windowTitle,
    start_time: formatDateTime(startTime),
    end_time: formatDateTime(endTime),
    duration: calculateDuration(startTime, endTime),
    activity_on: activityOn,
    status: status.toLowerCase()
  };

  try {
    console.log(`[Sync] POST chunk user=${userId} app="${appName}" ${body.start_time} -> ${body.end_time} (${body.status}) (${body.activity_on})`);
    await redmineClient.post('/user_system_activity_logs.json', body);
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
    let newStatus = idleTime >= 300 ? 'Inactive' : 'Active';

    let currentApp = 'System';
    let currentTitle = 'Idle';

    if (newStatus === 'Active') {
      try {
        const getWin = await loadActiveWin();
        const winInfo = await getWin();
        if (winInfo) {
          const appName = winInfo.owner?.name || '';
          const appPath = winInfo.owner?.path || '';
          if (appName.toLowerCase().includes('lockapp') || appPath.toLowerCase().includes('lockapp.exe')) {
            newStatus = 'Inactive';
          } else {
            currentApp = appName || 'Unknown';
            currentTitle = winInfo.title || 'Untitled';
            if (winInfo.owner?.path) {
              cacheAppIcon(currentApp, winInfo.owner.path);
            }
          }
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

    currentStatus = newStatus;

    const now = new Date();
    const statusChanged = !currentRecord || currentRecord.status !== newStatus;
    const appChanged = currentRecord && currentRecord.status === 'Active' &&
      (currentRecord.appName !== currentApp || currentRecord.windowTitle !== currentTitle);

    if (statusChanged || appChanged) {
      // Close out the previous chunk fully (real start -> now)
      // FIX #1: correct param order — endTime is `now`, activityOn is the
      // record's own activityOn marker. Previously `now` and `activityOn`
      // were swapped, which made endTime ≈ startTime and duration ≈ 0.
      if (currentRecord) {
        await syncChunkToApi(currentRecord.appName, currentRecord.windowTitle, currentRecord.status, currentRecord.startTime, now, currentRecord.activityOn);
      }

      // Start a fresh chunk from now
      currentRecord = {
        appName: currentApp,
        windowTitle: currentTitle,
        startTime: now,
        activityOn: now,
        status: newStatus
      };
      lastDbSyncTime = Date.now();
    } else {
      // Periodic durability sync — no PUT available, so we close the current
      // chunk (start -> now) and immediately re-open a new chunk from `now`
      // with the same appName/windowTitle/status, so nothing is lost beyond ~15s.
      const elapsed = Date.now() - lastDbSyncTime;
      if (elapsed >= 15000 && currentRecord) {
        const synced = await syncChunkToApi(currentRecord.appName, currentRecord.windowTitle, currentRecord.status, currentRecord.startTime, now, currentRecord.activityOn);
        if (synced) {
          // FIX #2: re-added `activityOn: now` — this was missing, so after
          // the first periodic resync currentRecord.activityOn became
          // undefined, producing NaN duration on the next close-out call.
          currentRecord = {
            appName: currentRecord.appName,
            windowTitle: currentRecord.windowTitle,
            startTime: now,
            activityOn: now,
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

function createActivityWindow() {
  if (activityWindow) return activityWindow;

  activityWindow = new BrowserWindow({
    width: 700,
    height: 520,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    show: false,
    skipTaskbar: true,
    resizable: false,
    minimizable: false,
    maximizable: false,
    movable: true,
    focusable: true,
    icon: path.join(__dirname, 'assets', 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      devTools: false
    }
  });

  activityWindow.loadFile(path.join(__dirname, 'renderer', 'activity-popup.html'));

  activityWindow.on('close', (event) => {
    if (!isQuitting) {
      event.preventDefault();
      activityWindow.hide();
      activityWindow.webContents.send('popup-status-changed', 'closed');
    }
  });

  return activityWindow;
}

function positionActivityWindow() {
  if (!mainWindow || !activityWindow) return;

  const [wx, wy] = mainWindow.getPosition();
  const primaryDisplay = screen.getDisplayNearestPoint({ x: wx, y: wy });
  const { x: workX, y: workY, width: workWidth, height: workHeight } = primaryDisplay.workArea;

  const popupWidth = 700;
  const popupHeight = 520;
  const widgetWidth = 185;
  const widgetHeight = 60;

  // The center of the ACTIVE TIME card is at wx + 140
  const activeTimeCardCenterX = wx + 140;

  // 1. Determine horizontal position (popupX)
  let popupX = wx + widgetWidth - popupWidth + 15;
  if (popupX < workX) {
    popupX = workX;
  }
  if (popupX + popupWidth > workX + workWidth) {
    popupX = workX + workWidth - popupWidth;
  }

  // 2. Determine vertical position (popupY)
  // Calculate available space above and below the widget
  const spaceAbove = wy - workY;
  const spaceBelow = (workY + workHeight) - (wy + widgetHeight);

  let popupY = 0;
  let isBelow = false;

  // Prefer opening above if we have enough space, otherwise check space below
  if (spaceAbove >= popupHeight + 8) {
    // Open above
    popupY = wy - popupHeight - 8;
    isBelow = false;
  } else if (spaceBelow >= popupHeight + 8) {
    // Open below
    popupY = wy + widgetHeight + 8;
    isBelow = true;
  } else {
    // Neither side has enough space for the full height without overflow.
    // Place it where there is more room, and clamp it to screen bounds.
    if (spaceAbove > spaceBelow) {
      // Place above and clamp
      popupY = wy - popupHeight - 8;
      if (popupY < workY) {
        popupY = workY;
      }
      isBelow = false;
    } else {
      // Place below and clamp
      popupY = wy + widgetHeight + 8;
      if (popupY + popupHeight > workY + workHeight) {
        popupY = workY + workHeight - popupHeight;
      }
      isBelow = true;
    }
  }

  // Final safety clamp to absolute screen boundaries to prevent any overflow/cut-offs
  if (popupY < workY) {
    popupY = workY;
  }
  if (popupY + popupHeight > workY + workHeight) {
    popupY = workY + workHeight - popupHeight;
  }

  activityWindow.setBounds({
    x: Math.round(popupX),
    y: Math.round(popupY),
    width: popupWidth,
    height: popupHeight
  });

  // Calculate arrow pointer's horizontal offset relative to the popup's left edge
  let arrowLeft = activeTimeCardCenterX - popupX;
  if (arrowLeft < 20) arrowLeft = 20;
  if (arrowLeft > popupWidth - 20) arrowLeft = popupWidth - 20;

  // Send styling and position variables to the popup renderer
  activityWindow.webContents.send('update-arrow-position', arrowLeft, isBelow);
}

function toggleActivityPopup() {
  if (!mainWindow) return;

  if (!activityWindow) {
    showPopupOnReady = true;
    createActivityWindow();
    return;
  }

  if (activityWindow.isVisible()) {
    activityWindow.webContents.send('request-close');
  } else {
    positionActivityWindow();
    activityWindow.show();
    activityWindow.focus();
    activityWindow.webContents.send('popup-status-changed', 'opened');
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
    icon: path.join(__dirname, 'assets', 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      devTools: false
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

// Inactivity Nudge Helpers
function startInactivityCheck() {
  if (inactivityInterval) return;
  inactivityInterval = setInterval(() => {
    if (isQuitting || isSystemLocked) return;

    const idleTime = powerMonitor.getSystemIdleTime();
    console.log(`[Inactivity Nudge] Idle check: current idle time = ${idleTime}s, threshold = ${INACTIVITY_THRESHOLD_SECONDS}s, popupShown = ${inactivityPopupShown}`);
    if (idleTime >= INACTIVITY_THRESHOLD_SECONDS) {
      if (!inactivityPopupShown && !inactivityPopup) {
        showInactivityPopup();
      }
    } else {
      inactivityPopupShown = false;
      if (inactivityPopup) {
        console.log('[Inactivity Nudge] User activity detected (idleTime < threshold). Automatically closing popup.');
        inactivityPopup.close();
      }
    }
  }, IDLE_CHECK_INTERVAL_MS);
}

function stopInactivityCheck() {
  if (inactivityInterval) {
    clearInterval(inactivityInterval);
    inactivityInterval = null;
  }
}

function showInactivityPopup() {
  if (isQuitting || isSystemLocked || inactivityPopup) return;

  console.log('[Inactivity Nudge] Showing inactivity popup window...');
  inactivityPopupShown = true;
  const randomQuote = quotes[Math.floor(Math.random() * quotes.length)];

  const primaryDisplay = screen.getPrimaryDisplay();
  const { workArea } = primaryDisplay;

  const width = 450;
  const height = 280;
  const x = workArea.x + workArea.width - width - 20;
  const y = workArea.y + workArea.height - height - 20;

  inactivityPopup = new BrowserWindow({
    width,
    height,
    x,
    y,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: false,
    focusable: false, // Do not steal focus
    show: false, // Show without activating/focusing
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      devTools: false
    }
  });

  inactivityPopup.loadFile(path.join(__dirname, 'inactivityPopup.html'), {
    query: {
      quote: randomQuote
    }
  });

  inactivityPopup.once('ready-to-show', () => {
    if (inactivityPopup) {
      inactivityPopup.showInactive();
      inactivityPopup.setAlwaysOnTop(true, 'screen-saver');
    }
  });

  const autoCloseTimer = setTimeout(() => {
    if (inactivityPopup) {
      console.log('[Inactivity Nudge] Timeout reached. Closing popup.');
      inactivityPopup.close();
    }
  }, POPUP_AUTO_CLOSE_MS);

  inactivityPopup.on('closed', () => {
    inactivityPopup = null;
    clearTimeout(autoCloseTimer);
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

// Activity Popup IPC Handlers
ipcMain.handle('toggle-activity-popup', () => {
  toggleActivityPopup();
});

ipcMain.handle('open-activity-popup', () => {
  if (!activityWindow) {
    createActivityWindow();
  }
  if (!activityWindow.isVisible()) {
    positionActivityWindow();
    activityWindow.show();
    activityWindow.focus();
    activityWindow.webContents.send('popup-status-changed', 'opened');
  }
});

ipcMain.handle('close-activity-popup', () => {
  if (activityWindow && activityWindow.isVisible()) {
    activityWindow.hide();
    activityWindow.webContents.send('popup-status-changed', 'closed');
  }
});

ipcMain.handle('close-inactivity-popup', () => {
  if (inactivityPopup) {
    inactivityPopup.close();
  }
});

ipcMain.handle('fetch-activity-logs', async () => {
  try {
    const userId = await getUserId();
    if (!userId) {
      throw new Error('User ID could not be resolved.');
    }
    const response = await redmineClient.get('/user_system_activity_logs/today.json', { user_id: userId });

    try {
      const logs = Array.isArray(response) ? response : (response?.entries || []);
      const appNames = [...new Set(logs.map(e => e.app_name).filter(Boolean))];
      await scanAndCacheIcons(appNames);
    } catch (scanError) {
      console.error('[ActivityPopup API] Error scanning icons:', scanError);
    }

    return {
      logs: response,
      icons: appIconCache
    };
  } catch (error) {
    console.error('[ActivityPopup API] Error fetching logs:', error.message || error);
    throw error;
  }
});

ipcMain.handle('get-employee-id', async () => {
  return await getUserId();
});

ipcMain.handle('popup-ready', () => {
  isPopupReady = true;
  if (showPopupOnReady) {
    showPopupOnReady = false;
    positionActivityWindow();
    activityWindow.show();
    activityWindow.focus();
    activityWindow.webContents.send('popup-status-changed', 'opened');
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

    // Start inactivity check loop
    startInactivityCheck();

    // Pre-cache common system icons
    preCacheCommonIcons();

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
        await syncChunkToApi(currentRecord.appName, currentRecord.windowTitle, currentRecord.status, currentRecord.startTime, new Date(), currentRecord.activityOn);
        currentRecord = null;
      }
    });

    powerMonitor.on('resume', async () => {
      console.log('System resumed, restarting tracking...');
      trackTick();
    });

    // Handle lock/unlock screen events for inactivity nudge
    powerMonitor.on('lock-screen', () => {
      isSystemLocked = true;
    });

    powerMonitor.on('unlock-screen', () => {
      isSystemLocked = false;
      // Reset popup trigger flag so it can trigger on the next idle session
      inactivityPopupShown = false;
    });
  });

  // Graceful exit
  app.on('before-quit', async (event) => {
    isQuitting = true;
    stopInactivityCheck();
    if (inactivityPopup && !inactivityPopup.isDestroyed()) {
      inactivityPopup.destroy();
    }

    if (currentRecord && !finalSyncDone) {
      event.preventDefault();
      finalSyncDone = true;
      clearInterval(trackingInterval);
      console.log('App quitting, closing final activity record...');
      try {
        await syncChunkToApi(currentRecord.appName, currentRecord.windowTitle, currentRecord.status, currentRecord.startTime, new Date(), currentRecord.activityOn);
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