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

function getQueueFilePath() {
  if (!queueFilePath) {
    queueFilePath = path.join(app.getPath('userData'), 'activity_queue.jsonl');
  }
  return queueFilePath;
}

function getUserProfileFilePath() {
  if (!userProfileFilePath) {
    userProfileFilePath = path.join(app.getPath('userData'), 'user_profile.json');
  }
  return userProfileFilePath;
}

function getStoredUserProfile() {
  const filePath = getUserProfileFilePath();
  if (!fs.existsSync(filePath)) {
    return null;
  }
  try {
    const raw = fs.readFileSync(filePath, 'utf8');
    if (!raw.trim()) return null;
    return JSON.parse(raw);
  } catch (err) {
    console.error('[Storage] Failed to read user_profile.json:', err);
    return null;
  }
}

function saveStoredUserProfile(osUsername, redmineUserId) {
  if (!osUsername || !redmineUserId) return;
  const filePath = getUserProfileFilePath();
  const profile = {
    os_username: osUsername,
    redmine_user_id: parseInt(redmineUserId, 10),
    last_resolved_at: new Date().toISOString()
  };
  try {
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(filePath, JSON.stringify(profile, null, 2), 'utf8');
    console.log(`[Storage] Saved user profile cache: ${osUsername} -> Redmine ID ${redmineUserId}`);
  } catch (err) {
    console.error('[Storage] Failed to write user_profile.json:', err);
    storageHealth.recordStorageFailure(err);
  }
}

function getCachedUserIdForOsUser(currentOsUsername) {
  if (!currentOsUsername) return null;
  const profile = getStoredUserProfile();
  if (profile && profile.os_username && profile.os_username.toLowerCase() === currentOsUsername.toLowerCase()) {
    return profile.redmine_user_id || null;
  }
  return null;
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

function readChunks() {
  const filePath = getQueueFilePath();
  const chunks = [];

  if (fs.existsSync(filePath)) {
    try {
      const content = fs.readFileSync(filePath, 'utf8');
      const lines = content.split('\n');
      for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed) {
          try {
            chunks.push(JSON.parse(trimmed));
          } catch (err) {
            console.error('[Storage] Failed to parse JSONL line:', err);
          }
        }
      }
    } catch (err) {
      console.error('[Storage] Failed to read chunks file:', err);
      storageHealth.recordStorageFailure(err);
    }
  }

  // Merge any unpersisted in-memory chunks (buffered during ENOSPC / disk-full events)
  if (unpersistedChunks.size > 0) {
    for (const [localId, unpersisted] of unpersistedChunks) {
      const existingIdx = chunks.findIndex(c => c.local_id === localId);
      if (existingIdx >= 0) {
        chunks[existingIdx] = unpersisted;
      } else {
        chunks.push(unpersisted);
      }
    }
  }

  return chunks;
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

function saveOrUpdateActiveSessionLocal(session, userId, osUsername = null) {
  const chunks = readChunks();
  const index = chunks.findIndex(c => c.local_id === session.local_id);

  const start = session.startTime || session.start_time;
  const end = session.endTime || session.end_time;
  const actOn = session.activityOn || session.activity_on;
  const currentOsUser = session.os_username || session.osUsername || osUsername || null;

  const startFormatted = ensureFormattedDateTime(start);
  const endFormatted = ensureFormattedDateTime(end);
  const actOnFormatted = ensureFormattedDateTime(actOn);

  const startDateObj = new Date(start);
  const endDateObj = new Date(end);
  let duration = session.duration !== undefined ? session.duration : Math.floor((endDateObj - startDateObj) / 1000);
  if (duration < 0) duration = 0;
  if (duration > MAX_SESSION_DURATION) {
    duration = MAX_SESSION_DURATION;
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

function closeOrphanedSessions() {
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

function getEligibleClosedSessions() {
  const chunks = readChunks();
  const now = Date.now();
  const currentYear = new Date().getFullYear();
  return chunks.filter(c => {
    if (!c.closed) return false;
    if (c.synced) return false;

    // Sanity Guard: Filter out corrupt/future year dates or excessive durations
    if (c.duration && c.duration > MAX_SESSION_DURATION) return false;
    const startYear = c.start_time ? new Date(c.start_time).getFullYear() : null;
    const endYear = c.end_time ? new Date(c.end_time).getFullYear() : null;
    if ((startYear && (startYear > currentYear + 1 || startYear < 2024)) ||
        (endYear && (endYear > currentYear + 1 || endYear < 2024))) {
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
  const chunks = readChunks();
  const todayStr = getLocalDateString();
  const userIdInt = userId ? parseInt(userId, 10) : null;

  return chunks
    .filter(c => {
      if (c.synced) return false;
      if (userIdInt && c.user_id && parseInt(c.user_id, 10) !== userIdInt) return false;
      if (osUsername && c.os_username && c.os_username.toLowerCase() !== osUsername.toLowerCase()) return false;
      if (c.status && c.status.toLowerCase() !== 'active') return false;
      return c.start_time && c.start_time.startsWith(todayStr);
    })
    .reduce((sum, c) => sum + (c.duration || 0), 0);
}

// Map back for compatibility in testing or simple usage if needed
function saveChunkLocal(chunk, userId, osUsername = null) {
  return saveOrUpdateActiveSessionLocal({ ...chunk, closed: true }, userId, osUsername);
}

function getUnsyncedTodayLogs(userId, osUsername = null) {
  const chunks = readChunks();
  const todayStr = getLocalDateString();
  const userIdInt = userId ? parseInt(userId, 10) : null;

  return chunks.filter(c => {
    if (c.synced) return false;
    if (userIdInt && c.user_id && parseInt(c.user_id, 10) !== userIdInt) return false;
    if (osUsername && c.os_username && c.os_username.toLowerCase() !== osUsername.toLowerCase()) return false;
    return c.start_time && c.start_time.startsWith(todayStr);
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

function normalizeToLocalDateStr(val) {
  if (!val) return null;
  if (val instanceof Date) {
    return getLocalDateString(val);
  }
  if (typeof val === 'string') {
    const trimmed = val.trim();
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

function getActivityLogsForDate(dateStr, userId = null, osUsername = null) {
  const chunks = readChunks();
  const userIdInt = userId ? parseInt(userId, 10) : null;

  return chunks.filter(c => {
    if (userIdInt && c.user_id && parseInt(c.user_id, 10) !== userIdInt) return false;
    if (osUsername && c.os_username && c.os_username.toLowerCase() !== osUsername.toLowerCase()) return false;
    const chunkDate = normalizeToLocalDateStr(c.start_time || c.activity_on);
    return chunkDate === dateStr;
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
  const chunks = readChunks();
  const userIdInt = userId ? parseInt(userId, 10) : null;
  const result = {};

  dateStrings.forEach(ds => {
    result[ds] = 0;
  });

  chunks.forEach(c => {
    if (c.status && c.status.toLowerCase() !== 'active') return;
    if (userIdInt && c.user_id && parseInt(c.user_id, 10) !== userIdInt) return;
    if (osUsername && c.os_username && c.os_username.toLowerCase() !== osUsername.toLowerCase()) return;

    const chunkDate = normalizeToLocalDateStr(c.start_time || c.activity_on);
    if (chunkDate && result[chunkDate] !== undefined) {
      result[chunkDate] += (c.duration || 0);
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
  const chunks = readChunks();
  const userIdInt = userId ? parseInt(userId, 10) : null;
  const result = {};

  dateStrings.forEach(ds => {
    result[ds] = {
      earliestStart: null,
      latestEnd: null
    };
  });

  chunks.forEach(c => {
    if (userIdInt && c.user_id && parseInt(c.user_id, 10) !== userIdInt) return;
    if (osUsername && c.os_username && c.os_username.toLowerCase() !== osUsername.toLowerCase()) return;

    const chunkDate = normalizeToLocalDateStr(c.start_time || c.activity_on);
    if (chunkDate && result[chunkDate] !== undefined) {
      const s = parseTimestampToDate(c.start_time);
      const e = parseTimestampToDate(c.end_time);
      if (s) {
        if (!result[chunkDate].earliestStart || s < result[chunkDate].earliestStart) {
          result[chunkDate].earliestStart = s;
        }
      }
      if (e) {
        if (!result[chunkDate].latestEnd || e > result[chunkDate].latestEnd) {
          result[chunkDate].latestEnd = e;
        }
      }
    }
  });

  return result;
}

module.exports = {
  saveOrUpdateActiveSessionLocal,
  closeOrphanedSessions,
  getEligibleClosedSessions,
  getPendingClosedSessions,
  markSessionSynced,
  markSessionFailed,
  getUnsyncedTodayDuration,
  getUnsyncedTodayLogs,
  getQueueFilePath,
  getUserIdFromLocalQueue,
  // Persistent user profile cache helpers
  getUserProfileFilePath,
  getStoredUserProfile,
  saveStoredUserProfile,
  getCachedUserIdForOsUser,
  backfillUserIdForOsUsername,
  // History & Date-wise queries
  getLocalDateString,
  normalizeToLocalDateStr,
  getActivityLogsForDate,
  getAllTodayLogs,
  getDateWiseActiveDurations,
  getDateWiseTimeRanges,
  parseTimestampToDate,
  formatTime12,
  // Storage Health & Fault Injection
  storageHealth,
  getStorageHealth: storageHealth.getStorageHealth,
  configureStorageHealth: storageHealth.configureStorageHealth,
  resetStorageHealth: storageHealth.resetStorageHealth,
  setStorageFaultInjection,
  getStorageFaultInjection,
  // Keep back compat mapping
  saveChunkLocal,
  markChunkSynced: markSessionSynced,
  markChunkFailed: markSessionFailed
};
