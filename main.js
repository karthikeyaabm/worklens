require('dotenv').config(); // Load environment variables from .env
const { app, BrowserWindow, screen, ipcMain, powerMonitor, Menu, Tray, nativeImage, dialog, Notification } = require('electron');

// Disable autoplay policy to allow inactivity popup beep sound without user gesture
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');

const path = require('path');
const os = require('os');
const fs = require('fs');
const { exec } = require('child_process');

// Watchdog State and Lifecycle Helpers
const appDataDir = process.env.APPDATA || (process.platform === 'win32'
  ? path.join(os.homedir(), 'AppData', 'Roaming')
  : path.join(os.homedir(), '.config'));
const watchdogStatePath = path.join(appDataDir, 'WorkLens', 'watchdog-state.json');

function updateWatchdogState(patch = {}) {
  try {
    const dir = path.dirname(watchdogStatePath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    let current = {};
    if (fs.existsSync(watchdogStatePath)) {
      try {
        current = JSON.parse(fs.readFileSync(watchdogStatePath, 'utf8'));
      } catch (_) {}
    }
    const updated = {
      ...current,
      execPath: process.execPath,
      appPath: app.getAppPath ? app.getAppPath() : __dirname,
      isPackaged: app.isPackaged,
      pid: process.pid,
      timestamp: Date.now(),
      ...patch
    };
    fs.writeFileSync(watchdogStatePath, JSON.stringify(updated, null, 2), 'utf8');
  } catch (err) {
    console.error('[WatchdogState] Error writing watchdog state:', err);
  }
}

function ensureWatchdogRunning() {
  if (process.platform !== 'win32') return;

  const watchdogLockPath = path.join(appDataDir, 'WorkLens', 'watchdog.lock');
  if (fs.existsSync(watchdogLockPath)) {
    try {
      const lockPid = parseInt(fs.readFileSync(watchdogLockPath, 'utf8').trim(), 10);
      if (lockPid) {
        exec(`powershell -NoProfile -Command "Get-Process -Id ${lockPid} -ErrorAction SilentlyContinue"`, (err, stdout) => {
          if (err || !stdout || !stdout.trim()) {
            launchWatchdog();
          } else {
            console.log(`[Watchdog] Watchdog is already running (PID: ${lockPid}).`);
          }
        });
        return;
      }
    } catch (_) {}
  }
  launchWatchdog();
}

function launchWatchdog() {
  const vbsPath = path.join(__dirname, 'watchdog', 'worklens-watchdog.vbs');
  if (fs.existsSync(vbsPath)) {
    console.log('[Watchdog] Launching watchdog via silent VBS launcher...');
    exec(`wscript.exe "${vbsPath}"`, { windowsHide: true });
  } else {
    const psScriptPath = path.join(__dirname, 'watchdog', 'worklens-watchdog.ps1');
    if (fs.existsSync(psScriptPath)) {
      console.log('[Watchdog] Launching watchdog via PowerShell...');
      exec(`powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "${psScriptPath}"`, { windowsHide: true });
    }
  }
}

function configureWatchdogStartup() {
  if (process.platform !== 'win32') return;
  try {
    const vbsPath = path.join(__dirname, 'watchdog', 'worklens-watchdog.vbs');
    if (fs.existsSync(vbsPath)) {
      const regCommand = `reg add "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run" /v "WorkLensWatchdog" /t REG_SZ /d "wscript.exe \\"${vbsPath}\\"" /f`;
      exec(regCommand, (err) => {
        if (err) {
          console.error('[Watchdog] Failed to register startup registry:', err);
        } else {
          console.log('[Watchdog] Registered WorkLensWatchdog in Windows Startup registry.');
        }
      });
    }
  } catch (err) {
    console.error('[Watchdog] configureWatchdogStartup error:', err);
  }
}

const quotes = require('./quotes');
const {
  saveOrUpdateActiveSessionLocal,
  closeOrphanedSessions,
  getEligibleClosedSessions,
  getPendingClosedSessions,
  markSessionSynced,
  markSessionFailed,
  getUnsyncedTodayDuration,
  getUnsyncedTodayLogs,
  getUserIdFromLocalQueue,
  saveStoredUserProfile,
  getCachedUserIdForOsUser,
  backfillUserIdForOsUsername,
  getLocalDateString,
  normalizeToLocalDateStr,
  getActivityLogsForDate,
  getAllTodayLogs,
  getDateWiseActiveDurations,
  getDateWiseTimeRanges,
  parseTimestampToDate,
  formatTime12
} = require('./activityStore');
const storageHealth = require('./storageHealth');

// Connect storage health supervisor to native Windows notifications
storageHealth.setNotificationHandler((alert) => {
  try {
    if (Notification && Notification.isSupported && Notification.isSupported()) {
      const notif = new Notification({
        title: alert.title,
        body: alert.message,
        icon: path.join(__dirname, 'assets', 'icon.png')
      });
      notif.show();
      console.log(`[StorageHealth] Windows notification displayed: [${alert.title}] ${alert.message}`);
    } else {
      console.warn(`[StorageHealth] Native notifications not supported in environment: [${alert.title}] ${alert.message}`);
    }
  } catch (notifErr) {
    console.error('[StorageHealth] Notification display error:', notifErr);
  }
});

const antiAfkDetector = require('./anti-afk/antiAfkDetector');
const { getActivityType, mapDecisionToActivityType } = antiAfkDetector;
const { uIOhook } = require('uiohook-napi');

// Inactivity Nudge Configuration
const INACTIVITY_THRESHOLD_SECONDS = 300; // 5 minutes inactivity trigger threshold
const IDLE_CHECK_INTERVAL_MS = 1000; // 1 second interval to close quickly on user activity
const POPUP_AUTO_CLOSE_MS = 15000; // 15 seconds auto-close if no user action

// Sanity Guard Configuration
const MAX_SESSION_DURATION = 12 * 60 * 60; // 12 hours (43,200 seconds) max session limit
const CLOCK_SKEW_THRESHOLD_MS = 15 * 1000; // 15 seconds max tick gap (sleep / clock jump)
let lastTickTimestamp = Date.now();

let inactivityPopup = null;
let inactivityPopupShown = false;
let isSystemLocked = false;
let inactivityInterval = null;
let inactivityCheckRunning = false;
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
let usernameError = null;
let currentRecord = null; // { appName, windowTitle, startTime, activityOn, status } -- no `id`, no PUT flow (POST-only API)
let currentStatus = 'Active'; // 'Active' or 'Inactive'
let trackingInterval = null;
let lastDbSyncTime = Date.now();
let activeWin = null;

let isUserResolved = false;
let syncInterval = null;
let isUiohookRunning = false;
let isBackendReachable = true;

function startUiohook() {
  if (isUiohookRunning) return;
  try {
    uIOhook.start();
    isUiohookRunning = true;
    console.log('[AntiAFK] Global input hook started.');
  } catch (err) {
    console.error('[AntiAFK] Failed to start global input hook:', err);
  }
}

function stopUiohook() {
  if (!isUiohookRunning) return;
  try {
    uIOhook.stop();
    isUiohookRunning = false;
    console.log('[AntiAFK] Global input hook stopped.');
  } catch (err) {
    console.error('[AntiAFK] Failed to stop global input hook:', err);
  }
}

function startTrackingServices() {
  console.log('[Services] Starting all tracking services...');
  
  // 1. Keyboard/mouse tracking
  startUiohook();

  // 2. Active window monitoring (trackTick every 2 seconds)
  if (!trackingInterval) {
    trackingInterval = setInterval(trackTick, 2000);
  }
  trackTick();

  // 3. Inactivity check loop
  startInactivityCheck();

  // 4. Sync interval
  if (!syncInterval) {
    syncInterval = setInterval(flushPendingClosedSessions, 2 * 60 * 1000);
  }
  flushPendingClosedSessions();
}

function stopTrackingServices() {
  console.log('[Services] Stopping all tracking services...');

  // 1. Keyboard/mouse tracking
  stopUiohook();

  // 2. Active window monitoring
  if (trackingInterval) {
    clearInterval(trackingInterval);
    trackingInterval = null;
  }

  // 3. Inactivity check loop
  stopInactivityCheck();

  // 4. Close any open inactivity nudge window
  if (inactivityPopup && !inactivityPopup.isDestroyed()) {
    try {
      inactivityPopup.close();
    } catch (e) {
      console.error('[Inactivity Nudge] Error closing inactivity popup:', e);
    }
  }
  inactivityPopupShown = false;

  // 5. Sync interval
  if (syncInterval) {
    clearInterval(syncInterval);
    syncInterval = null;
  }

  // 6. Close and save the current active session
  if (currentRecord) {
    closeCurrentSession(new Date());
  }
}

const TEAMS_MEETING_TITLE_PATTERNS = [
  /\bmeeting\b/i,
  /\bcall\b/i,
  /\bconference\b/i,
  /\bpresenting\b/i,
  /\bscreen sharing\b/i,
  /\bteams meeting\b/i
];

const TRANSFER_PROGRESS_TITLE_PATTERN = /\b\d{1,3}%\s+(downloading|uploading|transferring)\b/i;

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

async function getActiveWindowInfo() {
  const getWin = await loadActiveWin();
  return await getWin();
}

function isLockScreenWindow(winInfo) {
  if (!winInfo) return false;
  const appName = (winInfo.owner?.name || '').toLowerCase();
  const appPath = (winInfo.owner?.path || '').toLowerCase();
  return appName.includes('lockapp') || appPath.includes('lockapp.exe');
}

function isTeamsWindow(winInfo) {
  if (!winInfo) return false;
  const appName = (winInfo.owner?.name || '').toLowerCase();
  const appPath = (winInfo.owner?.path || '').toLowerCase();
  return appName.includes('teams') || appPath.includes('teams.exe') || appPath.includes('ms-teams.exe');
}

function isTeamsMeetingWindow(winInfo) {
  if (!isTeamsWindow(winInfo)) return false;
  if (isTeamsChatWindow(winInfo)) return false;

  const title = (winInfo.title || '').trim();
  if (!title) return true;

  return TEAMS_MEETING_TITLE_PATTERNS.some(pattern => pattern.test(title));
}

function isTeamsChatWindow(winInfo) {
  if (!isTeamsWindow(winInfo)) return false;
  const title = (winInfo.title || '').trim();
  if (!title) return false;
  return /\bchat\b/i.test(title) || /\bconversation\b/i.test(title) || title.toLowerCase().startsWith('chat');
}

function isWinScpApp(appName = '', appPath = '') {
  const name = appName.toLowerCase();
  const pathName = appPath.toLowerCase();
  return name.includes('winscp') || pathName.includes('winscp.exe');
}

function isPassiveTransferWindow(winInfo) {
  if (!winInfo) return false;

  const title = winInfo.title || '';

  return TRANSFER_PROGRESS_TITLE_PATTERN.test(title);
}

function normalizeVolatileWindowTitle(appName, appPath, windowTitle) {
  if (!windowTitle || (!isWinScpApp(appName, appPath) && !TRANSFER_PROGRESS_TITLE_PATTERN.test(windowTitle))) {
    return windowTitle;
  }

  return windowTitle.replace(TRANSFER_PROGRESS_TITLE_PATTERN, (_, action) => {
    const normalizedAction = action.charAt(0).toUpperCase() + action.slice(1).toLowerCase();
    return `${normalizedAction} in progress`;
  });
}

function applyActiveWindowInfo(winInfo, fallbackApp = 'Unknown', fallbackTitle = 'No Active Window') {
  if (!winInfo) {
    return { appName: fallbackApp, windowTitle: fallbackTitle };
  }

  const appName = winInfo.owner?.name || 'Unknown';
  const appPath = winInfo.owner?.path || '';
  const rawWindowTitle = winInfo.title || 'Untitled';
  const windowTitle = normalizeVolatileWindowTitle(appName, appPath, rawWindowTitle);

  if (winInfo.owner?.path) {
    cacheAppIcon(appName, winInfo.owner.path);
  }

  return { appName, windowTitle };
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
// Get or Cache Redmine User ID using OS username via REST API
// Still needed for the numeric user_id in the activity-log POST body.
async function getUserId() {
  if (cachedUserId !== null) return cachedUserId;

  const currentOsUser = os.userInfo().username;

  // 1. Try dedicated persistent user profile cache
  const persistentUserId = getCachedUserIdForOsUser(currentOsUser);
  if (persistentUserId) {
    cachedUserId = persistentUserId;
    isUserResolved = true;
    return cachedUserId;
  }

  // 2. Try local queue recovery if not yet stored in profile cache
  const localUserId = getUserIdFromLocalQueue(currentOsUser);
  if (localUserId) {
    cachedUserId = localUserId;
    isUserResolved = true;
    saveStoredUserProfile(currentOsUser, localUserId);
  }
  return cachedUserId;
}

async function checkUserResolution() {
  const username = os.userInfo().username;
  console.log(`[User Resolution] Retrying user resolution for OS username: "${username}"`);
  
  try {
    const response = await redmineClient.get('/today_timesheet.json', {
      user_id: username
    });

    if (response && response.user) {
      const newUserId = response.user.id;
      usernameError = null;
      isBackendReachable = true;
      
      const wasResolved = isUserResolved;
      isUserResolved = true;
      cachedUserId = newUserId;

      // Save to dedicated persistent user profile cache
      saveStoredUserProfile(username, newUserId);

      // Backfill any pending offline records belonging to the current OS username
      backfillUserIdForOsUsername(username, newUserId);
      
      if (!wasResolved) {
        console.log('[User Resolution] SUCCESS: User became valid. Ensuring tracking services.');
      } else {
        console.log('[User Resolution] SUCCESS: User verified successfully. Triggering automatic sync.');
      }
      startTrackingServices();
      flushPendingClosedSessions();
    } else {
      console.warn(`[User Resolution] FAILURE: User "${username}" explicitly not found in Redmine database.`);
      usernameError = `User "${username}" not found in Redmine database`;
      isBackendReachable = true;
      
      if (isUserResolved || cachedUserId !== null) {
        console.error('[User Resolution] Active user explicitly became invalid. Stopping tracking services.');
        stopTrackingServices();
        isUserResolved = false;
        cachedUserId = null;
      }
    }
  } catch (error) {
    console.error('[User Resolution] reachability check failed:', error.message || error);
    
    isBackendReachable = false;
    
    // Check if we can recover cached user ID for this OS user
    if (!cachedUserId) {
      const localUserId = getCachedUserIdForOsUser(username) || getUserIdFromLocalQueue(username);
      if (localUserId) {
        console.log(`[User Resolution] Offline startup: recovered cached user ID ${localUserId} for "${username}".`);
        cachedUserId = localUserId;
        isUserResolved = true;
        saveStoredUserProfile(username, localUserId);
      }
    }

    // Do NOT stop tracking services on network error! Local tracking remains active.
    console.log('[User Resolution] Offline mode active. Local tracking services continue running.');
  }
}

async function syncChunkToApi(chunk) {
  const redmineCreatedOn = formatDateTime(new Date());
  const localCreatedOn = chunk.local_created_on || formatDateTime(new Date(chunk.created_at));
  const activityType = chunk.activity_type || 'Unknown';

  const body = {
    user_id: chunk.user_id,
    app_name: chunk.app_name,
    window_title: chunk.window_title,
    start_time: chunk.start_time,
    end_time: chunk.end_time,
    duration: chunk.duration,
    activity_on: chunk.activity_on,
    status: chunk.status.toLowerCase(),
    version: app.getVersion(),
    activity_type: activityType,
    redmine_created_on: redmineCreatedOn,
    local_created_on: localCreatedOn
  };

  console.log(`[Sync] POST chunk user=${body.user_id} app="${body.app_name}" duration=${body.duration}s activity_type=${body.activity_type}`);
  console.log('[Sync] Full POST payload:', JSON.stringify(body, null, 2));

  await redmineClient.post('/user_system_activity_logs.json', body);
  return true;
}

let isSyncing = false;

async function flushPendingClosedSessions() {
  if (!isUserResolved || !isBackendReachable) {
    console.log('[Sync] Skipping sync flush: User is unresolved or backend is unreachable.');
    return;
  }
  if (isSyncing) return;
  isSyncing = true;
  console.log('[Sync] Starting flush of pending closed sessions...');

  try {
    const eligible = getEligibleClosedSessions();
    if (eligible.length === 0) {
      console.log('[Sync] No pending closed sessions eligible for sync.');
      isSyncing = false;
      return;
    }

    console.log(`[Sync] Found ${eligible.length} pending closed sessions to sync.`);
    let successCount = 0;
    let failureCount = 0;

    for (const session of eligible) {
      if (session.duration <= 0) {
        markSessionSynced(session.local_id);
        continue;
      }

      // Sanity Guard: Invalidate sessions exceeding 12h or corrupt/future dates
      if (session.duration > MAX_SESSION_DURATION) {
        console.warn(`[Sanity Guard] Dropping session ${session.local_id}: duration ${session.duration}s exceeds 12h limit.`);
        markSessionSynced(session.local_id);
        continue;
      }

      const sessionDate = new Date(session.end_time || session.start_time);
      const currentYear = new Date().getFullYear();
      if (isNaN(sessionDate.getTime()) || sessionDate.getFullYear() > currentYear + 1 || sessionDate.getFullYear() < 2024) {
        console.warn(`[Sanity Guard] Dropping session ${session.local_id}: year ${sessionDate.getFullYear()} is invalid.`);
        markSessionSynced(session.local_id);
        continue;
      }

      if (!session.user_id) {
        const uId = await getUserId();
        if (uId) {
          session.user_id = uId;
        } else {
          console.warn(`[Sync] Skipping session ${session.local_id} because User ID is still unresolved.`);
          continue;
        }
      }

      try {
        const success = await syncChunkToApi(session);
        if (success) {
          markSessionSynced(session.local_id);
          successCount++;
          invalidateActivity30DaysCache();
          await new Promise(resolve => setTimeout(resolve, 200));
        }
      } catch (error) {
        failureCount++;
        const errMsg = error.message || String(error);
        markSessionFailed(session.local_id, errMsg);
      }
    }

    console.log(`[Sync] Flush completed. Successes: ${successCount}, Failures: ${failureCount}`);
  } catch (err) {
    console.error('[Sync] Error during flush:', err);
  } finally {
    isSyncing = false;
  }
}

function startOrContinueCurrentSession(appName, windowTitle, status, now = new Date(), reason = null, activityType = 'Unknown') {
  const cleanStatus = status.toLowerCase();
  const currentOsUser = os.userInfo().username;

  if (currentRecord) {
    const isSameApp = currentRecord.appName === appName;
    const isSameTitle = currentRecord.windowTitle === windowTitle;
    const isSameStatus = currentRecord.status.toLowerCase() === cleanStatus;
    const isSameDay = new Date(currentRecord.startTime).toDateString() === now.toDateString();
    const isSameReason = currentRecord.reason === reason;
    const sessionDuration = Math.floor((now - currentRecord.startTime) / 1000);
    const isDurationExceeded = sessionDuration >= MAX_SESSION_DURATION;

    if (isSameApp && isSameTitle && isSameStatus && isSameDay && isSameReason && !isDurationExceeded) {
      // Continue existing session - update activity_type from latest evaluation
      currentRecord.endTime = now;
      currentRecord.duration = Math.floor((now - currentRecord.startTime) / 1000);
      currentRecord.activityType = activityType;
      saveOrUpdateActiveSessionLocal(currentRecord, cachedUserId, currentOsUser);
      return;
    } else {
      closeCurrentSession(now);
    }
  }

  currentRecord = {
    local_id: crypto.randomUUID(),
    appName: appName,
    windowTitle: windowTitle,
    status: cleanStatus,
    startTime: now,
    endTime: now,
    activityOn: now,
    duration: 0,
    reason: reason,
    activityType: activityType,
    os_username: currentOsUser,
    closed: false
  };
  const saved = saveOrUpdateActiveSessionLocal(currentRecord, cachedUserId, currentOsUser);
  if (saved && saved.local_id) {
    currentRecord.local_id = saved.local_id;
  }
}

function closeCurrentSession(endTime = new Date()) {
  if (!currentRecord) return;
  // Sanity Guard: Ensure valid end time and cap duration at 12 hours max
  if (endTime < currentRecord.startTime) {
    endTime = new Date(currentRecord.startTime);
  }
  let duration = Math.floor((endTime - currentRecord.startTime) / 1000);
  if (duration > MAX_SESSION_DURATION) {
    console.warn(`[Sanity Guard] Capping session duration from ${duration}s to ${MAX_SESSION_DURATION}s.`);
    duration = MAX_SESSION_DURATION;
    endTime = new Date(currentRecord.startTime.getTime() + MAX_SESSION_DURATION * 1000);
  }
  currentRecord.endTime = endTime;
  currentRecord.duration = duration;
  currentRecord.closed = true;

  saveOrUpdateActiveSessionLocal(currentRecord, cachedUserId, os.userInfo().username);
  console.log(`[Session] Closed session locally: local_id=${currentRecord.local_id} app="${currentRecord.appName}" duration=${currentRecord.duration}s`);
  currentRecord = null;
}

// Main tracking tick
async function trackTick() {
  try {
    storageHealth.recordActivityCollection(true);
    const now = new Date();
    const nowMs = now.getTime();
    const elapsedSinceLastTick = nowMs - lastTickTimestamp;

    // Guard 1: Time-Jump / Clock Skew Guard (Sleep / Wakeup / Lid Close / Clock Jumps)
    // Normal interval is 2000ms. If elapsed > 15000ms or clock jumped backward (< -5000ms)
    if (lastTickTimestamp && (elapsedSinceLastTick > CLOCK_SKEW_THRESHOLD_MS || elapsedSinceLastTick < -5000)) {
      console.warn(`[Sanity Guard] System time jump/sleep detected! Elapsed: ${Math.round(elapsedSinceLastTick / 1000)}s.`);
      if (currentRecord) {
        // Safely close the previous session at the last known valid tick time
        const safeCloseTime = new Date(Math.min(lastTickTimestamp + 2000, nowMs));
        closeCurrentSession(safeCloseTime);
      }
    }
    lastTickTimestamp = nowMs;

    // Resolve user ID if possible, but continue local tracking even if null
    const userId = await getUserId();

    const idleTime = powerMonitor.getSystemIdleTime();
    let newStatus = idleTime >= INACTIVITY_THRESHOLD_SECONDS ? 'Inactive' : 'Active';

    let currentApp = 'System';
    let currentTitle = 'Idle';
    let winInfo = null;

    try {
      winInfo = await getActiveWindowInfo();

      if (isLockScreenWindow(winInfo)) {
        newStatus = 'Inactive';
      } else if (newStatus === 'Active' || isTeamsMeetingWindow(winInfo)) {
        if (newStatus === 'Inactive') {
          console.log('[Teams Activity] System is idle, but an active Teams meeting/call window was detected. Counting as Active.');
        }
        newStatus = 'Active';
        const activeWindow = applyActiveWindowInfo(winInfo);
        currentApp = activeWindow.appName;
        currentTitle = activeWindow.windowTitle;

        // Report active window to anti-AFK detector to detect focus switches as natural interaction
        antiAfkDetector.recordWindowChange(currentApp, currentTitle);

        if (isPassiveTransferWindow(winInfo)) {
          newStatus = 'Inactive';
          console.log('[Passive Transfer] Transfer progress detected. Counting as Inactive.');
        }
      } else if (isTeamsChatWindow(winInfo) && idleTime >= INACTIVITY_THRESHOLD_SECONDS) {
        newStatus = 'Inactive';
        console.log('[Teams Chat] User is idle for 5+ minutes in Teams chat. Setting status to Inactive.');
        const activeWindow = applyActiveWindowInfo(winInfo);
        currentApp = activeWindow.appName;
        currentTitle = activeWindow.windowTitle;
      } else if (isTeamsWindow(winInfo) && !isTeamsMeetingWindow(winInfo)) {
        newStatus = idleTime >= INACTIVITY_THRESHOLD_SECONDS ? 'Inactive' : 'Active';
        const activeWindow = applyActiveWindowInfo(winInfo);
        currentApp = activeWindow.appName;
        currentTitle = activeWindow.windowTitle;
      } else if (!winInfo) {
        currentApp = 'Unknown';
        currentTitle = 'No Active Window';
      }
    } catch (winError) {
      console.error('Error getting active window:', winError);
      if (newStatus === 'Active') {
        currentApp = 'Unknown';
        currentTitle = 'Error';
      }
    }

    if (newStatus === 'Active' && currentApp === 'System') {
      try {
        if (winInfo) {
          const activeWindow = applyActiveWindowInfo(winInfo);
          currentApp = activeWindow.appName;
          currentTitle = activeWindow.windowTitle;
          antiAfkDetector.recordWindowChange(currentApp, currentTitle);
        } else {
          currentApp = 'Unknown';
          currentTitle = 'No Active Window';
        }
      } catch (winError) {
        console.error('Error applying active window info:', winError);
      }
    }

    if (newStatus === 'Active' && currentApp === 'Unknown') {
      newStatus = 'Inactive';
      console.log('[Activity Tracking] Unknown active app detected. Counting as Inactive.');
    }

    // Evaluate anti-AFK detection
    const afkEval = antiAfkDetector.evaluateActivity();
    let antiAfkReason = null;
    if (newStatus === 'Active' && afkEval.isSuspicious) {
      newStatus = 'Inactive';
      antiAfkReason = 'Continuous repetitive keyboard input detected.';
    }

    // Derive activity_type from Anti-AFK classification
    const activityType = mapDecisionToActivityType(afkEval);
    console.log(`[AntiAFK] Activity type classification: ${activityType} (score=${afkEval.score}, status=${afkEval.status})`);

    if (newStatus === 'Active') {
      currentStatus = isBackendReachable ? 'Active' : 'Offline';
    } else {
      currentStatus = 'Inactive';
    }

    // Reuse now from tick start
    startOrContinueCurrentSession(currentApp, currentTitle, newStatus, now, antiAfkReason, activityType);
  } catch (err) {
    storageHealth.recordActivityCollection(false);
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
      if (activityWindow && activityWindow.isVisible()) {
        activityWindow.hide();
        activityWindow.webContents.send('popup-status-changed', 'closed');
      }
    }
  });
}

// Inactivity Nudge Helpers
function startInactivityCheck() {
  if (inactivityInterval) return;
  inactivityInterval = setInterval(async () => {
    if (inactivityCheckRunning) return;
    if (isQuitting || isSystemLocked) return;

    inactivityCheckRunning = true;
    try {
      const idleTime = powerMonitor.getSystemIdleTime();
      console.log(`[Inactivity Nudge] Idle check: current idle time = ${idleTime}s, threshold = ${INACTIVITY_THRESHOLD_SECONDS}s, popupShown = ${inactivityPopupShown}`);
      if (idleTime >= INACTIVITY_THRESHOLD_SECONDS) {
        try {
          const winInfo = await getActiveWindowInfo();
          if (isTeamsMeetingWindow(winInfo)) {
            inactivityPopupShown = false;
            if (inactivityPopup) {
              console.log('[Inactivity Nudge] Active Teams meeting/call detected. Closing inactivity popup.');
              inactivityPopup.close();
            }
            return;
          }
        } catch (winError) {
          console.error('[Inactivity Nudge] Error checking active window for Teams meeting:', winError);
        }

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
    } finally {
      inactivityCheckRunning = false;
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
ipcMain.handle('hide-main-window', () => {
  if (mainWindow) {
    mainWindow.close();
  }
});

ipcMain.handle('get-username', () => {
  const isUserExplicitlyInvalid = usernameError && (
    usernameError.toLowerCase().includes('not found') ||
    usernameError.toLowerCase().includes('database') ||
    usernameError.toLowerCase().includes('waiting for account update')
  );

  return {
    username: os.userInfo().username,
    isOffline: !isBackendReachable,
    isTrackingActive: trackingInterval !== null,
    error: isUserExplicitlyInvalid ? usernameError : null
  };
});

ipcMain.handle('get-app-version', () => {
  return app.getVersion();
});

// Response shape confirmed from logs:
// { user: {id, name}, yesterday: {date, hours}, today: {date, hours} }
ipcMain.handle('get-redmine-efforts', async () => {
  if (!isUserResolved || !isBackendReachable) {
    return cachedRedmineEfforts;
  }
  try {
    const username = os.userInfo().username;
    const response = await redmineClient.get('/today_timesheet.json', { user_id: username });

    console.log('\n========== TODAY TIMESHEET RESPONSE ==========');
    console.log(JSON.stringify(response, null, 2));

    if (response && response.user) {
      const todayHours = parseFloat(response?.today?.hours ?? 0) || 0;
      const yesterdayHours = parseFloat(response?.yesterday?.hours ?? 0) || 0;

      cachedRedmineEfforts = { yesterday: yesterdayHours, today: todayHours };
      usernameError = null;
      if (response.user.id) {
        cachedUserId = response.user.id;
        saveStoredUserProfile(username, response.user.id);
      }
    } else {
      cachedUserId = null;
      usernameError = `User "${username}" not found in Redmine database`;
    }
  } catch (error) {
    console.error('get-redmine-efforts error:', error);
    // Temporary network failure must NOT clear cachedUserId!
    isBackendReachable = false;
  }
  return cachedRedmineEfforts;
});

// Response shape confirmed from logs:
// { user_id, yesterday: {date, duration_hours}, today: {date, duration_hours} }
// Note: values are HOURS, not seconds — converted below since the renderer's
// formatSeconds() expects seconds.
async function fetchActivitySummary() {
  if (!isUserResolved || !isBackendReachable) {
    return activitySummaryCache.data || { today: 0, yesterday: 0 };
  }
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
      usernameError = null;
      return result;
    } catch (error) {
      console.error('[Sync] fetchActivitySummary error:', error);
      // Temporary network failure must NOT clear cachedUserId!
      isBackendReachable = false;
      throw error;
    } finally {
      activitySummaryInFlight = null; // release the lock whether success or failure
    }
  })();

  return activitySummaryInFlight;
}

ipcMain.handle('get-active-time-today', async () => {
  if (isUserResolved && isBackendReachable) {
    try {
      const summary = await fetchActivitySummary();
      cachedActiveTimeToday = summary.today;
    } catch (error) {
      console.error('get-active-time-today error:', error);
      // Graceful degradation: fall through using cachedActiveTimeToday from last success
    }
  }

  let totalSeconds = cachedActiveTimeToday;

  try {
    const currentOsUser = os.userInfo().username;
    const userId = await getUserId();
    const unsyncedDuration = getUnsyncedTodayDuration(userId, currentOsUser);
    totalSeconds += unsyncedDuration;
  } catch (err) {
    console.error('[Sync] Error getting unsynced duration for active-time-today:', err);
  }

  if (currentRecord && currentRecord.status === 'Active') {
    const now = new Date();
    if (now.toDateString() === currentRecord.startTime.toDateString()) {
      totalSeconds += Math.round((now - currentRecord.startTime) / 1000);
    }
  }
  return totalSeconds;
});

ipcMain.handle('get-active-time-yesterday', async () => {
  if (isUserResolved && isBackendReachable) {
    try {
      const summary = await fetchActivitySummary();
      cachedActiveTimeYesterday = summary.yesterday;
    } catch (error) {
      console.error('get-active-time-yesterday error:', error);
    }
  }
  return cachedActiveTimeYesterday;
});

ipcMain.handle('get-current-status', () => {
  return currentStatus;
});

ipcMain.handle('get-storage-health', () => {
  return storageHealth.getStorageHealth();
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

// Precomputed Historical Views Cache
let precomputedHistoricalCache = {
  isReady: false,
  isLoading: false,
  timestamp: 0,
  yesterday: null,
  last7days: null,
  last30days: null,
  serverTodayLogs: []
};
let historicalFetchPromise = null;
const HISTORICAL_CACHE_TTL_MS = 60 * 1000; // 60s cache TTL

function invalidateActivity30DaysCache() {
  precomputedHistoricalCache.isReady = false;
  precomputedHistoricalCache.timestamp = 0;
  precomputedHistoricalCache.yesterday = null;
  precomputedHistoricalCache.last7days = null;
  precomputedHistoricalCache.last30days = null;
  precomputedHistoricalCache.serverTodayLogs = [];
}

// Single-pass processor for the 30-day API entries (executes in ~25-30ms for 14.5k records)
function processHistorical30DaysData(apiEntries, userId, currentOsUser) {
  const today = new Date();
  const todayStr = getLocalDateString(today);
  const yesterday = new Date();
  yesterday.setDate(today.getDate() - 1);
  const yesterdayStr = getLocalDateString(yesterday);
  const isCurrentlyTracking = (trackingInterval !== null);

  // Pre-generate Last 7 Days date objects
  const last7DateObjects = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date();
    d.setDate(today.getDate() - i);
    last7DateObjects.push(d);
  }

  // Pre-generate Last 30 Days date objects
  const last30DateObjects = [];
  for (let i = 0; i < 30; i++) {
    const d = new Date();
    d.setDate(today.getDate() - i);
    last30DateObjects.push(d);
  }

  // Daily active durations & session time ranges map for the last 30 calendar days
  const dailyDurations = {};
  const dailyTimeRanges = {};
  last30DateObjects.forEach(d => {
    const ds = getLocalDateString(d);
    dailyDurations[ds] = 0;
    dailyTimeRanges[ds] = { earliestStart: null, latestEnd: null };
  });

  const serverYesterdayLogs = [];
  const serverTodayLogs = [];

  // SINGLE PASS through the 30-day entries
  for (let i = 0; i < apiEntries.length; i++) {
    const entry = apiEntries[i];
    const dStr = normalizeToLocalDateStr(entry.activity_on || entry.start_time);
    if (!dStr) continue;

    if (dStr === todayStr) {
      serverTodayLogs.push(entry);
    } else if (dStr === yesterdayStr) {
      serverYesterdayLogs.push(entry);
    }

    if (entry.status && entry.status.toLowerCase() === 'active' && entry.duration > 0) {
      if (dailyDurations[dStr] !== undefined) {
        dailyDurations[dStr] += entry.duration;
      }
    }

    // Capture valid session start and end timestamps per date
    if (dailyTimeRanges[dStr] !== undefined) {
      const s = parseTimestampToDate(entry.start_time);
      const e = parseTimestampToDate(entry.end_time);
      if (s) {
        if (!dailyTimeRanges[dStr].earliestStart || s < dailyTimeRanges[dStr].earliestStart) {
          dailyTimeRanges[dStr].earliestStart = s;
        }
      }
      if (e) {
        if (!dailyTimeRanges[dStr].latestEnd || e > dailyTimeRanges[dStr].latestEnd) {
          dailyTimeRanges[dStr].latestEnd = e;
        }
      }
    }
  }

  // Add local unsynced active duration & merge local queue time ranges
  try {
    const unsyncedTodaySec = getUnsyncedTodayDuration(userId, currentOsUser);
    dailyDurations[todayStr] = (dailyDurations[todayStr] || 0) + (unsyncedTodaySec || 0);

    const localRanges = getDateWiseTimeRanges(last30DateObjects.map(d => getLocalDateString(d)), userId, currentOsUser);
    Object.keys(localRanges).forEach(ds => {
      const lr = localRanges[ds];
      if (lr && dailyTimeRanges[ds]) {
        if (lr.earliestStart && (!dailyTimeRanges[ds].earliestStart || lr.earliestStart < dailyTimeRanges[ds].earliestStart)) {
          dailyTimeRanges[ds].earliestStart = lr.earliestStart;
        }
        if (lr.latestEnd && (!dailyTimeRanges[ds].latestEnd || lr.latestEnd > dailyTimeRanges[ds].latestEnd)) {
          dailyTimeRanges[ds].latestEnd = lr.latestEnd;
        }
      }
    });
  } catch (err) {
    console.error('[Historical Processor] Error adding local queue data:', err);
  }

  // Precompute Yesterday
  const yesterdayAppNames = [...new Set(serverYesterdayLogs.map(e => e.app_name).filter(Boolean))];
  const yesterdayRange = dailyTimeRanges[yesterdayStr] || { earliestStart: null, latestEnd: null };
  const yesterdayStartTime = yesterdayRange.earliestStart ? formatTime12(yesterdayRange.earliestStart) : '--';
  const yesterdayEndTime = yesterdayRange.latestEnd ? formatTime12(yesterdayRange.latestEnd) : '--';

  // Precompute Last 7 Days
  const last7DaysList = last7DateObjects.map(d => {
    const ds = getLocalDateString(d);
    const isToday = (ds === todayStr);
    const duration = dailyDurations[ds] || 0;
    const range = dailyTimeRanges[ds] || { earliestStart: null, latestEnd: null };
    const hasData = Boolean(range.earliestStart || duration > 0);
    const startTime = range.earliestStart ? formatTime12(range.earliestStart) : '--';
    let endTime = '--';
    if (isToday) {
      endTime = isCurrentlyTracking ? 'Present' : (range.latestEnd ? formatTime12(range.latestEnd) : '--');
    } else {
      endTime = range.latestEnd ? formatTime12(range.latestEnd) : '--';
    }

    return {
      dateStr: ds,
      displayDate: d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }),
      shortDate: d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' }),
      isToday: isToday,
      duration: duration,
      startTime: startTime,
      endTime: endTime,
      isPresent: isToday && isCurrentlyTracking,
      hasData: hasData
    };
  });
  const last7TotalSeconds = last7DaysList.reduce((sum, d) => sum + d.duration, 0);
  const last7View = {
    period: 'last7days',
    days: last7DaysList,
    totalSeconds: last7TotalSeconds,
    dateRange: `${last7DaysList[last7DaysList.length - 1].shortDate} — ${last7DaysList[0].shortDate}`
  };

  // Precompute Last 30 Days
  const last30DaysList = last30DateObjects.map(d => {
    const ds = getLocalDateString(d);
    const isToday = (ds === todayStr);
    const duration = dailyDurations[ds] || 0;
    const range = dailyTimeRanges[ds] || { earliestStart: null, latestEnd: null };
    const hasData = Boolean(range.earliestStart || duration > 0);
    const startTime = range.earliestStart ? formatTime12(range.earliestStart) : '--';
    let endTime = '--';
    if (isToday) {
      endTime = isCurrentlyTracking ? 'Present' : (range.latestEnd ? formatTime12(range.latestEnd) : '--');
    } else {
      endTime = range.latestEnd ? formatTime12(range.latestEnd) : '--';
    }

    return {
      dateStr: ds,
      displayDate: d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }),
      shortDate: d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' }),
      isToday: isToday,
      duration: duration,
      startTime: startTime,
      endTime: endTime,
      isPresent: isToday && isCurrentlyTracking,
      hasData: hasData
    };
  });
  const last30TotalSeconds = last30DaysList.reduce((sum, d) => sum + d.duration, 0);
  const last30View = {
    period: 'last30days',
    days: last30DaysList,
    totalSeconds: last30TotalSeconds,
    dateRange: `${last30DaysList[last30DaysList.length - 1].shortDate} — ${last30DaysList[0].shortDate}`
  };

  return {
    yesterdayStr,
    serverTodayLogs,
    yesterdayLogs: serverYesterdayLogs,
    yesterdayAppNames,
    yesterdayStartTime,
    yesterdayEndTime,
    last7View,
    last30View
  };
}

// Offline fallback precomputation using local queue
function processHistoricalOfflineData(userId, currentOsUser) {
  const today = new Date();
  const todayStr = getLocalDateString(today);
  const yesterday = new Date();
  yesterday.setDate(today.getDate() - 1);
  const yesterdayStr = getLocalDateString(yesterday);
  const isCurrentlyTracking = (trackingInterval !== null);

  const yesterdayLogs = getActivityLogsForDate(yesterdayStr, userId, currentOsUser);

  let yesterdayStartTime = '--';
  let yesterdayEndTime = '--';
  if (yesterdayLogs.length > 0) {
    let yMin = null;
    let yMax = null;
    yesterdayLogs.forEach(c => {
      const s = parseTimestampToDate(c.start_time);
      const e = parseTimestampToDate(c.end_time);
      if (s && (!yMin || s < yMin)) yMin = s;
      if (e && (!yMax || e > yMax)) yMax = e;
    });
    yesterdayStartTime = formatTime12(yMin);
    yesterdayEndTime = formatTime12(yMax);
  }

  const last7DateObjects = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date();
    d.setDate(today.getDate() - i);
    last7DateObjects.push(d);
  }
  const last7DateStrings = last7DateObjects.map(d => getLocalDateString(d));
  const last7Durations = getDateWiseActiveDurations(last7DateStrings, userId, currentOsUser);
  const last7TimeRanges = getDateWiseTimeRanges(last7DateStrings, userId, currentOsUser);

  const last7DaysList = last7DateObjects.map(d => {
    const ds = getLocalDateString(d);
    const isToday = (ds === todayStr);
    const duration = last7Durations[ds] || 0;
    const range = last7TimeRanges[ds] || { earliestStart: null, latestEnd: null };
    const hasData = Boolean(range.earliestStart || duration > 0);
    const startTime = range.earliestStart ? formatTime12(range.earliestStart) : '--';
    let endTime = '--';
    if (isToday) {
      endTime = isCurrentlyTracking ? 'Present' : (range.latestEnd ? formatTime12(range.latestEnd) : '--');
    } else {
      endTime = range.latestEnd ? formatTime12(range.latestEnd) : '--';
    }

    return {
      dateStr: ds,
      displayDate: d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }),
      shortDate: d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' }),
      isToday: isToday,
      duration: duration,
      startTime: startTime,
      endTime: endTime,
      isPresent: isToday && isCurrentlyTracking,
      hasData: hasData
    };
  });
  const last7TotalSeconds = last7DaysList.reduce((sum, d) => sum + d.duration, 0);

  const last30DateObjects = [];
  for (let i = 0; i < 30; i++) {
    const d = new Date();
    d.setDate(today.getDate() - i);
    last30DateObjects.push(d);
  }
  const last30DateStrings = last30DateObjects.map(d => getLocalDateString(d));
  const last30Durations = getDateWiseActiveDurations(last30DateStrings, userId, currentOsUser);
  const last30TimeRanges = getDateWiseTimeRanges(last30DateStrings, userId, currentOsUser);

  const last30DaysList = last30DateObjects.map(d => {
    const ds = getLocalDateString(d);
    const isToday = (ds === todayStr);
    const duration = last30Durations[ds] || 0;
    const range = last30TimeRanges[ds] || { earliestStart: null, latestEnd: null };
    const hasData = Boolean(range.earliestStart || duration > 0);
    const startTime = range.earliestStart ? formatTime12(range.earliestStart) : '--';
    let endTime = '--';
    if (isToday) {
      endTime = isCurrentlyTracking ? 'Present' : (range.latestEnd ? formatTime12(range.latestEnd) : '--');
    } else {
      endTime = range.latestEnd ? formatTime12(range.latestEnd) : '--';
    }

    return {
      dateStr: ds,
      displayDate: d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }),
      shortDate: d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' }),
      isToday: isToday,
      duration: duration,
      startTime: startTime,
      endTime: endTime,
      isPresent: isToday && isCurrentlyTracking,
      hasData: hasData
    };
  });
  const last30TotalSeconds = last30DaysList.reduce((sum, d) => sum + d.duration, 0);

  return {
    yesterday: {
      period: 'yesterday',
      date: yesterdayStr,
      logs: yesterdayLogs,
      icons: appIconCache,
      startTime: yesterdayStartTime,
      endTime: yesterdayEndTime,
      hasData: yesterdayLogs.length > 0
    },
    last7days: {
      period: 'last7days',
      days: last7DaysList,
      totalSeconds: last7TotalSeconds,
      dateRange: `${last7DaysList[last7DaysList.length - 1].shortDate} — ${last7DaysList[0].shortDate}`
    },
    last30days: {
      period: 'last30days',
      days: last30DaysList,
      totalSeconds: last30TotalSeconds,
      dateRange: `${last30DaysList[last30DaysList.length - 1].shortDate} — ${last30DaysList[0].shortDate}`
    }
  };
}

// Background asynchronous historical loader - does NOT block Today rendering
function loadHistoricalDataInBackground(userId, currentOsUser, force = false) {
  const now = Date.now();
  if (!force && precomputedHistoricalCache.isReady && (now - precomputedHistoricalCache.timestamp < HISTORICAL_CACHE_TTL_MS)) {
    return Promise.resolve(precomputedHistoricalCache);
  }

  if (historicalFetchPromise) {
    return historicalFetchPromise;
  }

  precomputedHistoricalCache.isLoading = true;

  historicalFetchPromise = (async () => {
    try {
      console.log(`[Historical Loader] Starting background 30-day API fetch for user ${userId}...`);
      let apiData = null;
      if (userId) {
        apiData = await redmineClient.get('/user_system_activity_logs/today.json', { user_id: userId }, { timeout: 90000 });
        isBackendReachable = true;
      }

      let apiEntries = [];
      if (Array.isArray(apiData)) {
        apiEntries = apiData;
      } else if (apiData && Array.isArray(apiData.entries)) {
        apiEntries = apiData.entries;
      }

      const processed = processHistorical30DaysData(apiEntries, userId, currentOsUser);

      // Pre-cache icons for yesterday's apps
      if (processed.yesterdayAppNames && processed.yesterdayAppNames.length > 0) {
        try {
          await scanAndCacheIcons(processed.yesterdayAppNames);
        } catch (scanErr) {
          console.error('[Historical Loader] Error scanning yesterday icons:', scanErr);
        }
      }

      precomputedHistoricalCache = {
        isReady: true,
        isLoading: false,
        timestamp: Date.now(),
        yesterday: {
          period: 'yesterday',
          date: processed.yesterdayStr,
          logs: processed.yesterdayLogs,
          icons: appIconCache,
          startTime: processed.yesterdayStartTime,
          endTime: processed.yesterdayEndTime,
          hasData: processed.yesterdayLogs.length > 0
        },
        last7days: processed.last7View,
        last30days: processed.last30View,
        serverTodayLogs: processed.serverTodayLogs
      };

      console.log(`[Historical Loader] Background historical data ready (${apiEntries.length} entries processed).`);

      if (activityWindow && !activityWindow.isDestroyed()) {
        activityWindow.webContents.send('historical-data-ready', { isReady: true });
      }

      return precomputedHistoricalCache;
    } catch (err) {
      console.error('[Historical Loader] Error during background fetch, using local queue fallback:', err);
      const offline = processHistoricalOfflineData(userId, currentOsUser);
      precomputedHistoricalCache = {
        isReady: false,
        isLoading: false,
        timestamp: Date.now(),
        yesterday: offline.yesterday,
        last7days: offline.last7days,
        last30days: offline.last30days,
        serverTodayLogs: []
      };

      if (activityWindow && !activityWindow.isDestroyed()) {
        activityWindow.webContents.send('historical-data-ready', { isReady: false });
      }

      return precomputedHistoricalCache;
    } finally {
      historicalFetchPromise = null;
    }
  })();

  return historicalFetchPromise;
}

async function getResolvedTodayLogs(userId, currentOsUser) {
  let logs = [];
  if (precomputedHistoricalCache.isReady && precomputedHistoricalCache.serverTodayLogs.length > 0) {
    const unsyncedToday = getUnsyncedTodayLogs(userId, currentOsUser);
    const unsyncedMapped = unsyncedToday.map(c => ({
      id: c.local_id,
      user_id: c.user_id,
      app_name: c.app_name,
      window_title: c.window_title,
      start_time: c.start_time,
      end_time: c.end_time,
      duration: c.duration,
      activity_on: c.activity_on,
      status: c.status,
      activity_type: c.activity_type || 'Unknown'
    }));
    logs = [...unsyncedMapped, ...precomputedHistoricalCache.serverTodayLogs];
  } else {
    logs = getAllTodayLogs(userId, currentOsUser);
  }
  return logs;
}

async function handleFetchActivity(period = 'today') {
  const currentOsUser = os.userInfo().username;
  const userId = await getUserId();
  const normalizedPeriod = (period || 'today').toLowerCase().replace('-', '_');
  const today = new Date();
  const todayStr = getLocalDateString(today);

  // 1. TODAY: ALWAYS IMMEDIATE (Zero network blocking!)
  if (normalizedPeriod === 'today') {
    let logs = [];
    if (precomputedHistoricalCache.isReady && precomputedHistoricalCache.serverTodayLogs.length > 0) {
      const unsyncedToday = getUnsyncedTodayLogs(userId, currentOsUser);
      const unsyncedMapped = unsyncedToday.map(c => ({
        id: c.local_id,
        user_id: c.user_id,
        app_name: c.app_name,
        window_title: c.window_title,
        start_time: c.start_time,
        end_time: c.end_time,
        duration: c.duration,
        activity_on: c.activity_on,
        status: c.status,
        activity_type: c.activity_type || 'Unknown'
      }));
      logs = [...unsyncedMapped, ...precomputedHistoricalCache.serverTodayLogs];
    } else {
      logs = getAllTodayLogs(userId, currentOsUser);
    }

    // Trigger background loading of historical data asynchronously without awaiting
    loadHistoricalDataInBackground(userId, currentOsUser);

    try {
      const appNames = [...new Set(logs.map(e => e.app_name).filter(Boolean))];
      await scanAndCacheIcons(appNames);
    } catch (scanError) {
      console.error('[ActivityPopup API] Error scanning icons for today:', scanError);
    }

    const isCurrentlyTracking = (trackingInterval !== null);
    let todayStart = null;
    let todayEnd = null;

    if (logs && logs.length > 0) {
      logs.forEach(e => {
        const s = parseTimestampToDate(e.start_time);
        const end = parseTimestampToDate(e.end_time);
        if (s && (!todayStart || s < todayStart)) todayStart = s;
        if (end && (!todayEnd || end > todayEnd)) todayEnd = end;
      });
    }

    const todayStartTime = todayStart ? formatTime12(todayStart) : '--';
    const todayEndTime = isCurrentlyTracking ? 'Present' : (todayEnd ? formatTime12(todayEnd) : '--');

    return {
      period: 'today',
      date: todayStr,
      logs: logs,
      icons: appIconCache,
      startTime: todayStartTime,
      endTime: todayEndTime,
      isPresent: isCurrentlyTracking,
      isTrackingActive: isCurrentlyTracking,
      hasData: logs.length > 0
    };
  }

  // 2. YESTERDAY
  if (normalizedPeriod === 'yesterday') {
    if (precomputedHistoricalCache.isReady && precomputedHistoricalCache.yesterday) {
      return precomputedHistoricalCache.yesterday;
    }
    await loadHistoricalDataInBackground(userId, currentOsUser);
    if (precomputedHistoricalCache.isReady && precomputedHistoricalCache.yesterday) {
      return precomputedHistoricalCache.yesterday;
    }
    const offline = processHistoricalOfflineData(userId, currentOsUser);
    return offline.yesterday;
  }

  // 3. LAST 7 DAYS
  if (normalizedPeriod === 'last7days' || normalizedPeriod === 'last_7_days') {
    if (precomputedHistoricalCache.isReady && precomputedHistoricalCache.last7days) {
      return precomputedHistoricalCache.last7days;
    }
    await loadHistoricalDataInBackground(userId, currentOsUser);
    if (precomputedHistoricalCache.isReady && precomputedHistoricalCache.last7days) {
      return precomputedHistoricalCache.last7days;
    }
    const offline = processHistoricalOfflineData(userId, currentOsUser);
    return offline.last7days;
  }

  // 4. LAST 30 DAYS
  if (normalizedPeriod === 'last30days' || normalizedPeriod === 'last_30_days' || normalizedPeriod === 'current_month' || normalizedPeriod === 'month') {
    if (precomputedHistoricalCache.isReady && precomputedHistoricalCache.last30days) {
      return precomputedHistoricalCache.last30days;
    }
    await loadHistoricalDataInBackground(userId, currentOsUser);
    if (precomputedHistoricalCache.isReady && precomputedHistoricalCache.last30days) {
      return precomputedHistoricalCache.last30days;
    }
    const offline = processHistoricalOfflineData(userId, currentOsUser);
    return offline.last30days;
  }

  return await handleFetchActivity('today');
}

ipcMain.handle('fetch-activity-logs', async (event, period = 'today') => {
  return await handleFetchActivity(period);
});

ipcMain.handle('fetch-activity-history', async (event, period) => {
  return await handleFetchActivity(period);
});

ipcMain.handle('trigger-sync', async () => {
  console.log('[IPC] trigger-sync called. Resolving user and flushing pending closed sessions...');
  await checkUserResolution();
  flushPendingClosedSessions();
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
    // Close any orphaned sessions from previous runs
    try {
      closeOrphanedSessions();
    } catch (err) {
      console.error('[Startup] Failed to close orphaned sessions:', err);
    }

    // Register global keyboard and mouse hooks callbacks (starts stopped, controlled via service manager)
    try {
      uIOhook.on('keydown', (e) => {
        if (isUiohookRunning) antiAfkDetector.recordKeyDown(e.keycode);
      });
      uIOhook.on('keyup', (e) => {
        if (isUiohookRunning) antiAfkDetector.recordKeyUp(e.keycode);
      });
      uIOhook.on('mousemove', (e) => {
        if (isUiohookRunning) antiAfkDetector.recordMouseMove(e.x, e.y);
      });
      uIOhook.on('mousedown', (e) => {
        if (isUiohookRunning) antiAfkDetector.recordMouseClick(e.button, e.x, e.y);
      });
      uIOhook.on('wheel', (e) => {
        try {
          if (isUiohookRunning) antiAfkDetector.recordMouseWheel(e.direction === 2, e.rotation);
        } catch (err) {
          console.error('[AntiAFK] Error recording wheel event:', err);
        }
      });
    } catch (err) {
      console.error('[AntiAFK] Failed to register global input hooks:', err);
    }

    // Register watchdog in Windows Startup and ensure watchdog supervisor is running
    try {
      configureWatchdogStartup();
      ensureWatchdogRunning();
    } catch (error) {
      console.error('[Watchdog] Startup setup error:', error);
    }

    // Check if WorkLens was recovered/restarted by watchdog
    if (process.argv.includes('--recovered') || process.argv.includes('--watchdog-restart')) {
      try {
        if (Notification.isSupported()) {
          const recoveryNotification = new Notification({
            title: 'WorkLens Restarted',
            body: 'WorkLens was not running and has been automatically restarted.',
            icon: path.join(__dirname, 'assets', 'icon.png')
          });
          recoveryNotification.show();
        }
      } catch (notifErr) {
        console.error('[Watchdog] Notification error:', notifErr);
      }
    }

    // Record runtime paths and clear intentional shutdown flag
    updateWatchdogState({
      intentionalShutdown: false,
      startTime: Date.now()
    });

    // 1. Recover identity from persistent user profile cache (or legacy queue fallback)
    const currentOsUser = os.userInfo().username;
    const persistentUserId = getCachedUserIdForOsUser(currentOsUser) || getUserIdFromLocalQueue(currentOsUser);
    if (persistentUserId) {
      cachedUserId = persistentUserId;
      isUserResolved = true;
      saveStoredUserProfile(currentOsUser, persistentUserId);
      console.log(`[Startup] Recovered user identity for "${currentOsUser}" from persistent cache: ID ${persistentUserId}`);
    } else {
      console.log(`[Startup] No cached Redmine user ID for "${currentOsUser}". Starting in local offline mode.`);
    }

    // 2. Start tracking services immediately and unconditionally on startup!
    startTrackingServices();

    // 3. Initiate background user resolution (does not block tracking)
    checkUserResolution();

    // 4. Start background user resolution retry loop running every 30 seconds
    setInterval(checkUserResolution, 30000);

    // Pre-cache common system icons
    preCacheCommonIcons();

    createWindow();
    createTray();

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        createWindow();
      }
    });

    app.on('second-instance', () => {
      showAndFocusWindow();
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
      // Signal watchdog this is a controlled updater restart
      updateWatchdogState({ intentionalShutdown: true, reason: 'auto-update', timestamp: Date.now() });
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
      closeCurrentSession(new Date());
      flushPendingClosedSessions();
    });

    powerMonitor.on('resume', async () => {
      console.log('System resumed, restarting tracking...');
      lastTickTimestamp = Date.now();
      trackTick();
      flushPendingClosedSessions();
    });

    powerMonitor.on('shutdown', () => {
      console.log('System shutting down, closing current activity...');
      updateWatchdogState({ intentionalShutdown: true, reason: 'shutdown', timestamp: Date.now() });
      closeCurrentSession(new Date());
      flushPendingClosedSessions();
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
  app.on('session-end', () => {
    console.log('[System] Windows session ending (logoff/shutdown), closing session...');
    updateWatchdogState({ intentionalShutdown: true, reason: 'session-end', timestamp: Date.now() });
    closeCurrentSession(new Date());
    flushPendingClosedSessions();
  });

  app.on('before-quit', async (event) => {
    isQuitting = true;
    updateWatchdogState({ intentionalShutdown: true, reason: 'before-quit', timestamp: Date.now() });
    stopInactivityCheck();
    if (inactivityPopup && !inactivityPopup.isDestroyed()) {
      inactivityPopup.destroy();
    }

    // Stop global keyboard and mouse hooks
    try {
      uIOhook.stop();
      console.log('[AntiAFK] Global input hook stopped.');
    } catch (err) {
      console.error('[AntiAFK] Failed to stop global input hook:', err);
    }

    if (!finalSyncDone) {
      event.preventDefault();
      finalSyncDone = true;
      clearInterval(trackingInterval);
      console.log('App quitting, closing final activity record and flushing queue...');

      closeCurrentSession(new Date());

      // Attempt sync with a 3-second timeout so it doesn't block quitting indefinitely
      const syncTimeout = new Promise(resolve => setTimeout(resolve, 3000));
      Promise.race([flushPendingClosedSessions(), syncTimeout]).finally(() => {
        app.quit();
      });
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
} else {
  app.quit();
}
