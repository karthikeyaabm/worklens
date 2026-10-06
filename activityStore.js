// activityStore.js
const { app } = require('electron');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

const MAX_SESSION_DURATION = 12 * 60 * 60; // 12 hours (43,200s) max session limit

let queueFilePath = null;
let userProfileFilePath = null;

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
  if (!fs.existsSync(filePath)) {
    return [];
  }
  try {
    const content = fs.readFileSync(filePath, 'utf8');
    const lines = content.split('\n');
    const chunks = [];
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
    return chunks;
  } catch (err) {
    console.error('[Storage] Failed to read chunks file:', err);
    return [];
  }
}

function writeChunks(chunks) {
  const filePath = getQueueFilePath();
  try {
    // Automatically prune synced chunks older than 1 day to keep file size optimized
    const limitDate = new Date();
    limitDate.setDate(limitDate.getDate() - 1);

    const filtered = chunks.filter(c => {
      if (!c.synced) return true;
      const createdAt = new Date(c.created_at);
      return createdAt >= limitDate;
    });

    const content = filtered.map(c => JSON.stringify(c)).join('\n') + (filtered.length ? '\n' : '');
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(filePath, content, 'utf8');
  } catch (err) {
    console.error('[Storage] Failed to write chunks file:', err);
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
  // Keep back compat mapping
  saveChunkLocal,
  markChunkSynced: markSessionSynced,
  markChunkFailed: markSessionFailed
};
