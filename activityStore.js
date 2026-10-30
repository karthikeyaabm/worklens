// activityStore.js
const { app } = require('electron');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const storageHealth = require('./storageHealth');

const MAX_SESSION_DURATION = 12 * 60 * 60; // 12 hours (43,200s) max session limit

let queueFilePath = null;
let userProfileFilePath = null;

// In-memory buffer to hold unpersisted chunks during temporary disk failures / ENOSPC
const unpersistedChunks = new Map();
let storageFaultInjection = null;

function setStorageFaultInjection(err) {
  storageFaultInjection = err;
}

function getStorageFaultInjection() {
  return storageFaultInjection;
}

// Centralized tracking permission checker (enforces working hours restriction at recording boundary)
let trackingPermissionChecker = null;

function setTrackingPermissionChecker(checker) {
  trackingPermissionChecker = checker;
}

function getTrackingPermissionChecker() {
  return trackingPermissionChecker;
}

function isTrackingPermitted(date) {
  if (typeof trackingPermissionChecker === 'function') {
    try {
      return trackingPermissionChecker(date);
    } catch (e) {
      console.error('[ActivityStore] Error in trackingPermissionChecker:', e);
      return false; // Fail closed on checker error
    }
  }
  return true; // Default to true if unconfigured (preserves existing behavior/tests)
}

let cachedParsedChunks = null;
let cachedFileMtimeMs = 0;
let cachedFileSize = 0;
let cachedDateIndex = new Map();

function invalidateChunksCache() {
  cachedParsedChunks = null;
  cachedFileMtimeMs = 0;
  cachedFileSize = 0;
  cachedDateIndex = new Map();
}

function getUserDataDir() {
  if (app && typeof app.getPath === 'function') {
    try { return app.getPath('userData'); } catch (_) {}
  }
  return process.env.WORKLENS_DATA_DIR || path.join(process.cwd(), 'scratch');
}

function getQueueFilePath() {
  const currentPath = path.join(getUserDataDir(), 'activity_queue.jsonl');
  if (queueFilePath !== currentPath) {
    queueFilePath = currentPath;
    invalidateChunksCache();
  }
  return queueFilePath;
}

let cachedUserProfile = null;
let cachedUserProfileMtime = 0;
let cachedUserProfileSize = 0;

function getUserProfileFilePath() {
  const current = path.join(getUserDataDir(), 'user_profile.json');
  if (userProfileFilePath !== current) {
    userProfileFilePath = current;
    cachedUserProfile = null;
    cachedUserProfileMtime = 0;
    cachedUserProfileSize = 0;
  }
  return userProfileFilePath;
}

function getStoredUserProfile() {
  const filePath = getUserProfileFilePath();
  if (!fs.existsSync(filePath)) {
    cachedUserProfile = null;
    return null;
  }
  try {
    const stat = fs.statSync(filePath);
    if (cachedUserProfile && stat.mtimeMs === cachedUserProfileMtime && stat.size === cachedUserProfileSize) {
      return cachedUserProfile;
    }
    const raw = fs.readFileSync(filePath, 'utf8');
    if (!raw.trim()) {
      cachedUserProfile = null;
      return null;
    }
    cachedUserProfile = JSON.parse(raw);
    cachedUserProfileMtime = stat.mtimeMs;
    cachedUserProfileSize = stat.size;
    return cachedUserProfile;
  } catch (err) {
    console.error('[Storage] Failed to read user_profile.json:', err);
    return cachedUserProfile;
  }
}

function saveStoredUserProfile(username, redmineUserId, employeeName = null) {
  if (!username || !redmineUserId) return;
  const filePath = getUserProfileFilePath();
  const profile = {
    username: username,
    os_username: username,
    redmine_user_id: parseInt(redmineUserId, 10),
    employee_name: employeeName || null,
    verified_at: new Date().toISOString(),
    last_resolved_at: new Date().toISOString()
  };
  try {
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(filePath, JSON.stringify(profile, null, 2), 'utf8');
    try {
      const stat = fs.statSync(filePath);
      cachedUserProfile = profile;
      cachedUserProfileMtime = stat.mtimeMs;
      cachedUserProfileSize = stat.size;
    } catch (_) {}
    console.log(`[Storage] Saved user profile cache: ${username} -> Redmine ID ${redmineUserId}`);
  } catch (err) {
    console.error('[Storage] Failed to write user_profile.json:', err);
    storageHealth.recordStorageFailure(err);
  }
}

function clearStoredUserProfile() {
  const filePath = getUserProfileFilePath();
  cachedUserProfile = null;
  cachedUserProfileMtime = 0;
  cachedUserProfileSize = 0;
  try {
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
      console.log('[Storage] Cleared stored user profile.');
    }
  } catch (err) {
    console.error('[Storage] Failed to clear user_profile.json:', err);
  }
}

function getStoredVerifiedUser() {
  const profile = getStoredUserProfile();
  if (!profile) return null;
  const uname = profile.username || profile.os_username || null;
  const uid = profile.redmine_user_id ? parseInt(profile.redmine_user_id, 10) : null;
  if (uname && uid) {
    return {
      username: uname,
      userId: uid,
      employeeName: profile.employee_name || null,
      verifiedAt: profile.verified_at || null,
      lastResolvedAt: profile.last_resolved_at || null
    };
  }
  return null;
}

function getCachedUserIdForOsUser(currentOsUsername) {
  const profile = getStoredUserProfile();
  if (!profile) return null;
  if (!currentOsUsername) {
    return profile.redmine_user_id || null;
  }
  const uname = (profile.username || profile.os_username || '').toLowerCase();
  if (uname === currentOsUsername.toLowerCase()) {
    return profile.redmine_user_id || null;
  }
  return null;
}

let dailyStateFilePath = null;
let cachedDailyState = null;
let cachedDailyStateMtime = 0;
let cachedDailyStateSize = 0;

function getDailyStateFilePath() {
  const current = path.join(getUserDataDir(), 'daily_tracking_state.json');
  if (dailyStateFilePath !== current) {
    dailyStateFilePath = current;
    cachedDailyState = null;
    cachedDailyStateMtime = 0;
    cachedDailyStateSize = 0;
  }
  return dailyStateFilePath;
}

function getStoredDailyState() {
  const filePath = getDailyStateFilePath();
  if (!fs.existsSync(filePath)) {
    cachedDailyState = {};
    return {};
  }
  try {
    const stat = fs.statSync(filePath);
    if (cachedDailyState && stat.mtimeMs === cachedDailyStateMtime && stat.size === cachedDailyStateSize) {
      return cachedDailyState;
    }
    const raw = fs.readFileSync(filePath, 'utf8');
    if (!raw.trim()) {
      cachedDailyState = {};
      return {};
    }
    cachedDailyState = JSON.parse(raw);
    cachedDailyStateMtime = stat.mtimeMs;
    cachedDailyStateSize = stat.size;
    return cachedDailyState;
  } catch (err) {
    console.error('[Storage] Failed to read daily_tracking_state.json:', err);
    return cachedDailyState || {};
  }
}

function getPersistedDailyStartTime(dateStr, osUsername = null, userId = null) {
  if (!dateStr) return null;
  const state = getStoredDailyState();
  const dayData = state[dateStr];
  if (!dayData) return null;

  const userKey = (osUsername || (userId ? String(userId) : 'default')).toLowerCase();
  const userRecord = dayData[userKey] || dayData['default'];
  if (!userRecord || !userRecord.earliestStartTime) return null;
  return parseTimestampToDate(userRecord.earliestStartTime);
}

function recordDailyStartTime(dateStr, osUsername, userId, timestamp) {
  if (!dateStr || !timestamp) return null;
  const dateObj = (timestamp instanceof Date) ? timestamp : parseTimestampToDate(timestamp);
  if (!dateObj || isNaN(dateObj.getTime())) return null;

  const filePath = getDailyStateFilePath();
  const state = getStoredDailyState();
  if (!state[dateStr]) {
    // Automatically prune dates older than 35 days to keep file compact
    const limitDate = new Date();
    limitDate.setDate(limitDate.getDate() - 35);
    const limitStr = getLocalDateString(limitDate);
    Object.keys(state).forEach(k => {
      if (k < limitStr) delete state[k];
    });
    state[dateStr] = {};
  }

  const userKey = (osUsername || (userId ? String(userId) : 'default')).toLowerCase();
  const existing = state[dateStr][userKey];
  let earliest = dateObj;

  if (existing && existing.earliestStartTime) {
    const existingDate = parseTimestampToDate(existing.earliestStartTime);
    if (existingDate && existingDate < earliest) {
      earliest = existingDate;
    }
  }

  const formatted = ensureFormattedDateTime(earliest);
  state[dateStr][userKey] = {
    earliestStartTime: formatted,
    os_username: osUsername || null,
    user_id: userId ? parseInt(userId, 10) : null,
    updated_at: new Date().toISOString()
  };

  try {
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(filePath, JSON.stringify(state, null, 2), 'utf8');
    try {
      const stat = fs.statSync(filePath);
      cachedDailyState = state;
      cachedDailyStateMtime = stat.mtimeMs;
      cachedDailyStateSize = stat.size;
    } catch (_) {}
  } catch (err) {
    console.error('[Storage] Failed to write daily_tracking_state.json:', err);
    storageHealth.recordStorageFailure(err);
  }

  return earliest;
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

function getLocalDateString(date = new Date()) {
  const yyyy = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${yyyy}-${month}-${day}`;
}

function ensureFormattedDateTime(val) {
  if (val instanceof Date) return formatDateTime(val);
  if (typeof val === 'string') {
    if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/.test(val)) return val;
    const parsed = new Date(val);
    if (!isNaN(parsed.getTime())) return formatDateTime(parsed);
    return val;
  }
  return formatDateTime(new Date());
}

function normalizeToLocalDateStr(val) {
  if (!val) return null;
  if (val instanceof Date) {
    return getLocalDateString(val);
  }
  if (typeof val === 'string') {
    const trimmed = val.trim();
    // Fast path: YYYY-MM-DD
    if (trimmed.length >= 10 && trimmed.charCodeAt(4) === 45 && trimmed.charCodeAt(7) === 45) {
      return trimmed.slice(0, 10);
    }
    const ymdMatch = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (ymdMatch) {
      return `${ymdMatch[1]}-${ymdMatch[2]}-${ymdMatch[3]}`;
    }
    const dmyMatch = trimmed.match(/^(\d{2})-(\d{2})-(\d{4})/);
    if (dmyMatch) {
      return `${dmyMatch[3]}-${dmyMatch[2]}-${dmyMatch[1]}`;
    }
    const parsed = new Date(trimmed);
    if (!isNaN(parsed.getTime())) {
      return getLocalDateString(parsed);
    }
  }
  return null;
}

function rebuildDateIndex(chunks) {
  const index = new Map();
  for (let i = 0; i < chunks.length; i++) {
    const c = chunks[i];
    const dStr = normalizeToLocalDateStr(c.start_time || c.activity_on);
    if (dStr) {
      let list = index.get(dStr);
      if (!list) {
        list = [];
        index.set(dStr, list);
      }
      list.push(c);
    }
  }
  cachedDateIndex = index;
}

function readChunks() {
  const filePath = getQueueFilePath();
  let baseChunks = null;

  if (fs.existsSync(filePath)) {
    try {
      const stat = fs.statSync(filePath);
      if (cachedParsedChunks && stat.mtimeMs === cachedFileMtimeMs && stat.size === cachedFileSize) {
        baseChunks = cachedParsedChunks;
      } else {
        const content = fs.readFileSync(filePath, 'utf8');
        const lines = content.split('\n');
        const parsed = [];
        for (let i = 0; i < lines.length; i++) {
          const trimmed = lines[i].trim();
          if (trimmed) {
            try {
              parsed.push(JSON.parse(trimmed));
            } catch (err) {
              console.error('[Storage] Failed to parse JSONL line:', err);
            }
          }
        }
        cachedParsedChunks = parsed;
        cachedFileMtimeMs = stat.mtimeMs;
        cachedFileSize = stat.size;
        rebuildDateIndex(parsed);
        baseChunks = parsed;
      }
    } catch (err) {
      console.error('[Storage] Failed to read chunks file:', err);
      storageHealth.recordStorageFailure(err);
      baseChunks = cachedParsedChunks || [];
    }
  } else {
    cachedParsedChunks = [];
    cachedFileMtimeMs = 0;
    cachedFileSize = 0;
    rebuildDateIndex([]);
    baseChunks = [];
  }

  // Merge any unpersisted in-memory chunks (buffered during ENOSPC / disk-full events)
  if (unpersistedChunks.size > 0) {
    const merged = baseChunks.slice();
    for (const [localId, unpersisted] of unpersistedChunks) {
      const existingIdx = merged.findIndex(c => c.local_id === localId);
      if (existingIdx >= 0) {
        merged[existingIdx] = unpersisted;
      } else {
        merged.push(unpersisted);
      }
    }
    return merged;
  }

  return baseChunks;
}

function getChunksForDate(dateStr) {
  readChunks();
  const list = cachedDateIndex.get(dateStr) || [];
  if (unpersistedChunks.size > 0) {
    const merged = list.slice();
    for (const [localId, unpersisted] of unpersistedChunks) {
      const d = normalizeToLocalDateStr(unpersisted.start_time || unpersisted.activity_on);
      if (d === dateStr) {
        const idx = merged.findIndex(c => c.local_id === localId);
        if (idx >= 0) {
          merged[idx] = unpersisted;
        } else {
          merged.push(unpersisted);
        }
      }
    }
    return merged;
  }
  return list;
}

function writeChunks(chunks) {
  // Fault injection hook for automated testing and simulation of ENOSPC / disk full
  if (storageFaultInjection) {
    for (const c of chunks) {
      if (c && c.local_id) {
        unpersistedChunks.set(c.local_id, c);
      }
    }
    storageHealth.recordStorageFailure(storageFaultInjection);
    return false;
  }

  const filePath = getQueueFilePath();
  const tempPath = `${filePath}.tmp`;

  try {
    // Automatically prune synced chunks older than 35 days to support Last 7 Days & Current Month historical summaries while keeping file size bounded
    const limitDate = new Date();
    limitDate.setDate(limitDate.getDate() - 35);

    const filtered = chunks.filter(c => {
      if (!c.synced) return true;
      const createdAt = new Date(c.created_at || c.start_time);
      return createdAt >= limitDate;
    });

    const content = filtered.map(c => JSON.stringify(c)).join('\n') + (filtered.length ? '\n' : '');
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    // Atomic write pattern: Write to .tmp first to protect existing activity records from ENOSPC truncation
    fs.writeFileSync(tempPath, content, 'utf8');
    fs.renameSync(tempPath, filePath);

    // Update in-memory cache directly with filtered chunks & file stats
    try {
      const stat = fs.statSync(filePath);
      cachedParsedChunks = filtered;
      cachedFileMtimeMs = stat.mtimeMs;
      cachedFileSize = stat.size;
      rebuildDateIndex(filtered);
    } catch (_) {
      invalidateChunksCache();
    }

    // Persistence succeeded: clear in-memory unpersisted buffer and record storage success
    unpersistedChunks.clear();
    storageHealth.recordStorageSuccess();
    return true;
  } catch (err) {
    try {
      if (fs.existsSync(tempPath)) {
        fs.unlinkSync(tempPath);
      }
    } catch (_) {}

    // Invalidate cached parsed chunks since write failed
    invalidateChunksCache();

    // Buffer unwritten chunks in-memory so tracking data is never lost during temporary disk full
    for (const c of chunks) {
      if (c && c.local_id) {
        unpersistedChunks.set(c.local_id, c);
      }
    }

    console.error('[Storage] Failed to write chunks file:', err);
    storageHealth.recordStorageFailure(err);
    return false;
  }
}

function splitSessionAtMidnightBoundaries(session) {
  if (!session) return [];
  const start = session.startTime || session.start_time;
  const end = session.endTime || session.end_time;
  if (!start || !end) return [session];

  const startDate = (start instanceof Date) ? start : parseTimestampToDate(start);
  const endDate = (end instanceof Date) ? end : parseTimestampToDate(end);
  if (!startDate || !endDate || isNaN(startDate.getTime()) || isNaN(endDate.getTime())) {
    return [session];
  }

  // If start is after end, clamp end to start
  if (endDate < startDate) {
    return [{
      ...session,
      startTime: formatDateTime(startDate),
      endTime: formatDateTime(startDate),
      start_time: formatDateTime(startDate),
      end_time: formatDateTime(startDate),
      duration: 0
    }];
  }

  const startDateStr = getLocalDateString(startDate);
  const endDateStr = getLocalDateString(endDate);

  if (startDateStr === endDateStr) {
    return [session];
  }

  const segments = [];
  let curStart = new Date(startDate.getTime());
  let isFirst = true;

  while (getLocalDateString(curStart) !== endDateStr && curStart < endDate) {
    // End of this calendar day: 23:59:59
    const dayEnd = new Date(curStart.getFullYear(), curStart.getMonth(), curStart.getDate(), 23, 59, 59, 0);
    const segEnd = (dayEnd > endDate) ? endDate : dayEnd;
    let segDuration = Math.floor((segEnd - curStart) / 1000);
    if (segDuration < 0) segDuration = 0;
    if (segDuration > MAX_SESSION_DURATION) segDuration = MAX_SESSION_DURATION;

    const segLocalId = isFirst ? (session.local_id || crypto.randomUUID()) : crypto.randomUUID();
    isFirst = false;

    const startFormatted = formatDateTime(curStart);
    const endFormatted = formatDateTime(segEnd);

    segments.push({
      ...session,
      local_id: segLocalId,
      startTime: startFormatted,
      endTime: endFormatted,
      start_time: startFormatted,
      end_time: endFormatted,
      activityOn: startFormatted,
      activity_on: startFormatted,
      duration: segDuration,
      closed: true, // Past calendar day segment must always be closed
      synced: session.synced !== undefined ? session.synced : false,
      updated_at: new Date().toISOString()
    });

    // Move to start of next calendar day: 00:00:00
    curStart = new Date(curStart.getFullYear(), curStart.getMonth(), curStart.getDate() + 1, 0, 0, 0, 0);
  }

  // Final day segment (from curStart to endDate)
  if (curStart <= endDate) {
    let finalDuration = Math.floor((endDate - curStart) / 1000);
    if (finalDuration < 0) finalDuration = 0;
    if (finalDuration > MAX_SESSION_DURATION) finalDuration = MAX_SESSION_DURATION;

    const finalStartFormatted = formatDateTime(curStart);
    const finalEndFormatted = formatDateTime(endDate);
    const finalLocalId = isFirst ? (session.local_id || crypto.randomUUID()) : crypto.randomUUID();

    segments.push({
      ...session,
      local_id: finalLocalId,
      startTime: finalStartFormatted,
      endTime: finalEndFormatted,
      start_time: finalStartFormatted,
      end_time: finalEndFormatted,
      activityOn: finalStartFormatted,
      activity_on: finalStartFormatted,
      duration: finalDuration,
      closed: session.closed !== undefined ? session.closed : false,
      synced: session.synced !== undefined ? session.synced : false,
      updated_at: new Date().toISOString()
    });
  }

  return segments;
}

function reconcileMidnightBoundaries() {
  const chunks = readChunks();
  let modified = false;
  const newChunksList = [];
  const todayStr = getLocalDateString(new Date());

  for (let i = 0; i < chunks.length; i++) {
    const c = chunks[i];
    const sDate = parseTimestampToDate(c.start_time || c.startTime);
    const eDate = parseTimestampToDate(c.end_time || c.endTime);

    if (!sDate) {
      newChunksList.push(c);
      continue;
    }

    const sDay = normalizeToLocalDateStr(c.start_time || c.startTime);
    const eDay = eDate ? normalizeToLocalDateStr(c.end_time || c.endTime) : sDay;

    // Check 1: Does this chunk cross a midnight boundary?
    if (sDay && eDay && sDay !== eDay) {
      modified = true;
      const splitSegments = splitSessionAtMidnightBoundaries(c);
      for (let j = 0; j < splitSegments.length; j++) {
        newChunksList.push(splitSegments[j]);
      }
      continue;
    }

    // Check 2: Was this chunk left unclosed from a previous calendar day?
    if (!c.closed && sDay && sDay < todayStr) {
      modified = true;
      let finalEnd = eDate;
      if (!finalEnd || normalizeToLocalDateStr(finalEnd) !== sDay) {
        finalEnd = new Date(sDate.getFullYear(), sDate.getMonth(), sDate.getDate(), 23, 59, 59, 0);
      }
      let duration = Math.floor((finalEnd - sDate) / 1000);
      if (duration < 0) duration = 0;
      if (duration > MAX_SESSION_DURATION) duration = MAX_SESSION_DURATION;

      newChunksList.push({
        ...c,
        end_time: formatDateTime(finalEnd),
        endTime: formatDateTime(finalEnd),
        duration: duration,
        closed: true,
        updated_at: new Date().toISOString()
      });
      continue;
    }

    newChunksList.push(c);
  }

  if (modified) {
    writeChunks(newChunksList);
    console.log('[Storage] Reconciled and split cross-day sessions in local queue.');
  }

  return modified;
}

function saveOrUpdateSingleSessionLocal(session, userId, currentOsUser = null) {
  const chunks = readChunks();
  const index = chunks.findIndex(c => c.local_id === session.local_id);

  const start = session.startTime || session.start_time;
  const end = session.endTime || session.end_time;
  const actOn = session.activityOn || session.activity_on;

  const startFormatted = ensureFormattedDateTime(start);
  const endFormatted = ensureFormattedDateTime(end);
  const actOnFormatted = ensureFormattedDateTime(actOn);

  const startDateObj = (start instanceof Date) ? start : parseTimestampToDate(start);
  const endDateObj = (end instanceof Date) ? end : parseTimestampToDate(end);
  let duration = session.duration !== undefined ? session.duration : (startDateObj && endDateObj ? Math.floor((endDateObj - startDateObj) / 1000) : 0);
  if (duration < 0) duration = 0;
  if (duration > MAX_SESSION_DURATION) {
    duration = MAX_SESSION_DURATION;
  }

  const isPermitted = isTrackingPermitted(startDateObj || new Date());
  if (!isPermitted) {
    if (index >= 0 && session.closed) {
      // Allow closing an existing session when tracking transitions to restricted
    } else {
      console.warn('[ActivityStore] Recording rejected: activity is outside permitted working hours schedule.');
      return null;
    }
  }

  // Persist earliest start time for this local calendar day
  const chunkDate = normalizeToLocalDateStr(startFormatted || actOnFormatted);
  if (chunkDate && start) {
    recordDailyStartTime(chunkDate, currentOsUser, userId, start);
  }

  if (index >= 0) {
    // Update existing session
    chunks[index] = {
      ...chunks[index],
      user_id: chunks[index].user_id || userId || null,
      os_username: chunks[index].os_username || currentOsUser,
      end_time: endFormatted,
      duration: duration,
      closed: session.closed !== undefined ? session.closed : chunks[index].closed,
      reason: session.reason !== undefined ? session.reason : chunks[index].reason,
      latitude: session.latitude !== undefined ? session.latitude : (chunks[index].latitude || null),
      longitude: session.longitude !== undefined ? session.longitude : (chunks[index].longitude || null),
      current_address: session.current_address !== undefined ? session.current_address : (chunks[index].current_address || null),
      updated_at: new Date().toISOString()
    };
    writeChunks(chunks);
    return chunks[index];
  } else {
    // Insert new active session - allowed even if userId is unresolved during offline mode
    const newSession = {
      local_id: session.local_id || crypto.randomUUID(),
      user_id: userId || null,
      os_username: currentOsUser,
      app_name: session.appName || session.app_name || 'Unknown',
      window_title: session.windowTitle || session.window_title || 'Untitled',
      start_time: startFormatted,
      end_time: endFormatted,
      duration: duration,
      activity_on: actOnFormatted,
      status: (session.status || 'Active').toLowerCase(),
      activity_type: session.activityType || 'Unknown',
      reason: session.reason || null,
      latitude: session.latitude !== undefined ? session.latitude : null,
      longitude: session.longitude !== undefined ? session.longitude : null,
      current_address: session.current_address !== undefined ? session.current_address : null,
      closed: session.closed !== undefined ? session.closed : false,
      synced: false,
      retry_count: 0,
      last_error: null,
      local_created_on: formatDateTime(new Date()),
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    };
    chunks.push(newSession);
    writeChunks(chunks);
    return newSession;
  }
}

function saveOrUpdateActiveSessionLocal(session, userId, osUsername = null) {
  const start = session.startTime || session.start_time;
  const end = session.endTime || session.end_time;
  const currentOsUser = session.os_username || session.osUsername || osUsername || null;

  const startDateObj = (start instanceof Date) ? start : parseTimestampToDate(start);
  const endDateObj = (end instanceof Date) ? end : parseTimestampToDate(end);

  if (startDateObj && endDateObj) {
    const startDay = getLocalDateString(startDateObj);
    const endDay = getLocalDateString(endDateObj);

    if (startDay !== endDay) {
      // Midnight boundary crossing detected! Split into discrete calendar day entries
      const segments = splitSessionAtMidnightBoundaries(session);
      let lastSaved = null;
      for (let i = 0; i < segments.length; i++) {
        lastSaved = saveOrUpdateSingleSessionLocal(segments[i], userId, currentOsUser);
      }
      return lastSaved;
    }
  }

  return saveOrUpdateSingleSessionLocal(session, userId, currentOsUser);
}

function closeOrphanedSessions() {
  reconcileMidnightBoundaries();
  const chunks = readChunks();
  let modified = false;
  const updated = chunks.map(c => {
    if (!c.closed) {
      modified = true;
      let duration = c.duration || 0;
      if (duration > MAX_SESSION_DURATION) {
        duration = MAX_SESSION_DURATION;
      }
      return {
        ...c,
        duration: duration,
        closed: true,
        updated_at: new Date().toISOString()
      };
    }
    return c;
  });
  if (modified) {
    writeChunks(updated);
    console.log('[Storage] Closed orphaned active sessions on startup.');
  }
}

function quarantineSession(localId, reason) {
  const chunks = readChunks();
  let found = false;
  const updated = chunks.map(c => {
    if (c.local_id === localId) {
      found = true;
      return {
        ...c,
        quarantined: true,
        quarantine_reason: reason || 'Anomalous session quarantined',
        updated_at: new Date().toISOString()
      };
    }
    return c;
  });
  if (found) {
    writeChunks(updated);
    console.warn(`[Storage] Quarantined session local_id=${localId}: ${reason}`);
  }
}

function getEligibleClosedSessions() {
  const chunks = readChunks();
  const now = Date.now();
  const currentYear = new Date().getFullYear();
  return chunks.filter(c => {
    if (!c.closed) return false;
    if (c.synced) return false;
    if (c.quarantined) return false;

    // Sanity Guard: Filter out corrupt/future year dates or excessive durations
    if (c.duration && c.duration > MAX_SESSION_DURATION) return false;

    const sDate = c.start_time ? parseTimestampToDate(c.start_time) : null;
    const eDate = c.end_time ? parseTimestampToDate(c.end_time) : null;

    if (!sDate || isNaN(sDate.getTime())) return false;
    if (!eDate || isNaN(eDate.getTime())) return false;

    // Reject future-dated sessions relative to current local time (+60s tolerance for clock jitter)
    if (sDate.getTime() > now + 60000) return false;
    if (eDate.getTime() < sDate.getTime()) return false;

    const startYear = sDate.getFullYear();
    const endYear = eDate.getFullYear();
    if (startYear > currentYear + 1 || startYear < 2024 ||
        endYear > currentYear + 1 || endYear < 2024) {
      return false;
    }

    if (c.retry_count === 0) return true;

    // Exponential backoff logic: 2^(retry_count - 1) minutes, max 60 minutes
    const backoffMin = Math.min(Math.pow(2, c.retry_count - 1), 60);
    const backoffMs = backoffMin * 60 * 1000;
    const lastAttempt = new Date(c.updated_at).getTime();
    return (now - lastAttempt) >= backoffMs;
  });
}

function getPendingClosedSessions(limit) {
  const chunks = readChunks().filter(c => c.closed && !c.synced);
  if (limit) {
    return chunks.slice(0, limit);
  }
  return chunks;
}

function markSessionSynced(localId) {
  const chunks = readChunks();
  let found = false;
  const updated = chunks.map(c => {
    if (c.local_id === localId) {
      found = true;
      return {
        ...c,
        synced: true,
        updated_at: new Date().toISOString()
      };
    }
    return c;
  });
  if (found) {
    writeChunks(updated);
    console.log(`[Storage] Marked session synced: local_id=${localId}`);
  }
}

function markSessionFailed(localId, errorMessage) {
  const chunks = readChunks();
  let found = false;
  const updated = chunks.map(c => {
    if (c.local_id === localId) {
      found = true;
      const count = c.retry_count + 1;
      return {
        ...c,
        retry_count: count,
        last_error: errorMessage || 'Unknown sync error',
        updated_at: new Date().toISOString()
      };
    }
    return c;
  });
  if (found) {
    writeChunks(updated);
    console.warn(`[Storage] Marked session failed: local_id=${localId}, error="${errorMessage}"`);
  }
}

function getUnsyncedTodayDuration(userId, osUsername = null) {
  const todayStr = getLocalDateString();
  const chunks = getChunksForDate(todayStr);
  const userIdInt = userId ? parseInt(userId, 10) : null;

  return chunks
    .filter(c => {
      if (c.quarantined) return false;
      if ((c.duration || 0) > MAX_SESSION_DURATION) return false;
      if (c.synced) return false;
      if (userIdInt && c.user_id && parseInt(c.user_id, 10) !== userIdInt) return false;
      if (osUsername && c.os_username && c.os_username.toLowerCase() !== osUsername.toLowerCase()) return false;
      if (c.status && c.status.toLowerCase() !== 'active') return false;
      return true;
    })
    .reduce((sum, c) => sum + (c.duration || 0), 0);
}

// Map back for compatibility in testing or simple usage if needed
function saveChunkLocal(chunk, userId, osUsername = null) {
  return saveOrUpdateActiveSessionLocal({ ...chunk, closed: true }, userId, osUsername);
}

function getUnsyncedTodayLogs(userId, osUsername = null) {
  const todayStr = getLocalDateString();
  const chunks = getChunksForDate(todayStr);
  const userIdInt = userId ? parseInt(userId, 10) : null;

  return chunks.filter(c => {
    if (c.synced) return false;
    if (userIdInt && c.user_id && parseInt(c.user_id, 10) !== userIdInt) return false;
    if (osUsername && c.os_username && c.os_username.toLowerCase() !== osUsername.toLowerCase()) return false;
    return true;
  });
}

function getUserIdFromLocalQueue(currentOsUsername = null) {
  try {
    const chunks = readChunks();
    // Scan backward to find the most recent non-null user_id matching current OS user (if provided)
    for (let i = chunks.length - 1; i >= 0; i--) {
      if (chunks[i].user_id) {
        if (!currentOsUsername || !chunks[i].os_username || chunks[i].os_username.toLowerCase() === currentOsUsername.toLowerCase()) {
          return chunks[i].user_id;
        }
      }
    }
  } catch (err) {
    console.error('[Storage] Error reading user_id from local queue:', err);
  }
  return null;
}

function backfillUserIdForOsUsername(osUsername, userId) {
  if (!osUsername || !userId) return 0;
  const chunks = readChunks();
  let updatedCount = 0;
  const updated = chunks.map(c => {
    if (!c.synced && (!c.user_id || c.user_id === null) && (!c.os_username || c.os_username.toLowerCase() === osUsername.toLowerCase())) {
      updatedCount++;
      return {
        ...c,
        user_id: parseInt(userId, 10),
        os_username: osUsername,
        updated_at: new Date().toISOString()
      };
    }
    return c;
  });
  if (updatedCount > 0) {
    writeChunks(updated);
    console.log(`[Storage] Backfilled user_id=${userId} for ${updatedCount} pending session(s) of OS user "${osUsername}".`);
  }
  return updatedCount;
}

function getActivityLogsForDate(dateStr, userId = null, osUsername = null) {
  const chunks = getChunksForDate(dateStr);
  const userIdInt = userId ? parseInt(userId, 10) : null;

  return chunks.filter(c => {
    if (c.quarantined) return false;
    if ((c.duration || 0) > MAX_SESSION_DURATION) return false;
    if (userIdInt && c.user_id && parseInt(c.user_id, 10) !== userIdInt) return false;
    if (osUsername && c.os_username && c.os_username.toLowerCase() !== osUsername.toLowerCase()) return false;
    return true;
  }).map(c => ({
    id: c.local_id,
    local_id: c.local_id,
    user_id: c.user_id,
    app_name: c.app_name,
    window_title: c.window_title,
    start_time: c.start_time,
    end_time: c.end_time,
    duration: c.duration,
    activity_on: c.activity_on,
    status: c.status,
    synced: !!c.synced,
    is_synced: !!c.synced,
    activity_type: c.activity_type || 'Unknown',
    latitude: c.latitude || null,
    longitude: c.longitude || null,
    current_address: c.current_address || null
  }));
}

function getAllTodayLogs(userId = null, osUsername = null) {
  const todayStr = getLocalDateString();
  return getActivityLogsForDate(todayStr, userId, osUsername);
}

function getDateWiseActiveDurations(dateStrings, userId = null, osUsername = null) {
  readChunks();
  const userIdInt = userId ? parseInt(userId, 10) : null;
  const result = {};

  dateStrings.forEach(ds => {
    result[ds] = 0;
    const dayChunks = getChunksForDate(ds);
    for (let i = 0; i < dayChunks.length; i++) {
      const c = dayChunks[i];
      if (c.quarantined) continue;
      if ((c.duration || 0) > MAX_SESSION_DURATION) continue;
      if (c.status && c.status.toLowerCase() !== 'active') continue;
      if (userIdInt && c.user_id && parseInt(c.user_id, 10) !== userIdInt) continue;
      if (osUsername && c.os_username && c.os_username.toLowerCase() !== osUsername.toLowerCase()) continue;
      result[ds] += (c.duration || 0);
    }
  });

  return result;
}

function parseTimestampToDate(val) {
  if (!val) return null;
  if (val instanceof Date) return isNaN(val.getTime()) ? null : val;
  const str = String(val).trim();
  // Match YYYY-MM-DDTHH:mm:ss or YYYY-MM-DD HH:mm:ss
  const ymdMatch = str.match(/^(\d{4})-(\d{2})-(\d{2})(?:[T\s](\d{2}):(\d{2}):?(\d{2})?)?/);
  if (ymdMatch) {
    const y = parseInt(ymdMatch[1], 10);
    const m = parseInt(ymdMatch[2], 10) - 1;
    const d = parseInt(ymdMatch[3], 10);
    const hh = parseInt(ymdMatch[4] || 0, 10);
    const mm = parseInt(ymdMatch[5] || 0, 10);
    const ss = parseInt(ymdMatch[6] || 0, 10);
    return new Date(y, m, d, hh, mm, ss);
  }
  // Match DD-MM-YYYY HH:mm:ss or DD-MM-YYYYTHH:mm:ss
  const dmyMatch = str.match(/^(\d{2})-(\d{2})-(\d{4})(?:[T\s](\d{2}):(\d{2}):?(\d{2})?)?/);
  if (dmyMatch) {
    const d = parseInt(dmyMatch[1], 10);
    const m = parseInt(dmyMatch[2], 10) - 1;
    const y = parseInt(dmyMatch[3], 10);
    const hh = parseInt(dmyMatch[4] || 0, 10);
    const mm = parseInt(dmyMatch[5] || 0, 10);
    const ss = parseInt(dmyMatch[6] || 0, 10);
    return new Date(y, m, d, hh, mm, ss);
  }
  const parsed = new Date(str);
  return isNaN(parsed.getTime()) ? null : parsed;
}

function formatTime12(date) {
  if (!date) return '--';
  const d = (date instanceof Date) ? date : parseTimestampToDate(date);
  if (!d || isNaN(d.getTime())) return '--';
  return d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true });
}

function getDateWiseTimeRanges(dateStrings, userId = null, osUsername = null) {
  readChunks();
  const userIdInt = userId ? parseInt(userId, 10) : null;
  const result = {};
  const state = getStoredDailyState(); // read ONCE, cached in-memory

  dateStrings.forEach(ds => {
    result[ds] = {
      earliestStart: null,
      latestEnd: null
    };

    // Include persisted earliest start time for this employee and date if available
    const dayData = state[ds];
    if (dayData) {
      const userKey = (osUsername || (userId ? String(userId) : 'default')).toLowerCase();
      const userRecord = dayData[userKey] || dayData['default'];
      if (userRecord && userRecord.earliestStartTime) {
        result[ds].earliestStart = parseTimestampToDate(userRecord.earliestStartTime);
      }
    }

    const dayChunks = getChunksForDate(ds);
    for (let i = 0; i < dayChunks.length; i++) {
      const c = dayChunks[i];
      if (userIdInt && c.user_id && parseInt(c.user_id, 10) !== userIdInt) continue;
      if (osUsername && c.os_username && c.os_username.toLowerCase() !== osUsername.toLowerCase()) continue;

      const s = parseTimestampToDate(c.start_time);
      const e = parseTimestampToDate(c.end_time);
      if (s) {
        if (!result[ds].earliestStart || s < result[ds].earliestStart) {
          result[ds].earliestStart = s;
        }
      }
      if (e) {
        if (!result[ds].latestEnd || e > result[ds].latestEnd) {
          result[ds].latestEnd = e;
        }
      }
    }
  });

  return result;
}

module.exports = {
  saveOrUpdateActiveSessionLocal,
  setTrackingPermissionChecker,
  getTrackingPermissionChecker,
  closeOrphanedSessions,
  getEligibleClosedSessions,
  getPendingClosedSessions,
  markSessionSynced,
  markSessionFailed,
  quarantineSession,
  getUnsyncedTodayDuration,
  getUnsyncedTodayLogs,
  getQueueFilePath,
  getUserIdFromLocalQueue,
  // Persistent user profile cache helpers
  getUserProfileFilePath,
  getStoredUserProfile,
  saveStoredUserProfile,
  getCachedUserIdForOsUser,
  clearStoredUserProfile,
  getStoredVerifiedUser,
  backfillUserIdForOsUsername,
  // Persistent daily tracking state
  getDailyStateFilePath,
  getStoredDailyState,
  getPersistedDailyStartTime,
  recordDailyStartTime,
  // History & Date-wise queries
  getLocalDateString,
  normalizeToLocalDateStr,
  getActivityLogsForDate,
  getAllTodayLogs,
  getChunksForDate,
  getDateWiseActiveDurations,
  getDateWiseTimeRanges,
  parseTimestampToDate,
  formatTime12,
  invalidateChunksCache,
  // Storage Health & Fault Injection
  storageHealth,
  getStorageHealth: storageHealth.getStorageHealth,
  configureStorageHealth: storageHealth.configureStorageHealth,
  resetStorageHealth: storageHealth.resetStorageHealth,
  setStorageFaultInjection,
  getStorageFaultInjection,
  // Midnight Session Split & Calendar Boundary Helpers
  splitSessionAtMidnightBoundaries,
  reconcileMidnightBoundaries,
  // Keep back compat mapping
  saveChunkLocal,
  markChunkSynced: markSessionSynced,
  markChunkFailed: markSessionFailed
};
