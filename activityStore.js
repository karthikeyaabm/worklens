// activityStore.js
const { app } = require('electron');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

let queueFilePath = null;

function getQueueFilePath() {
  if (!queueFilePath) {
    queueFilePath = path.join(app.getPath('userData'), 'activity_queue.jsonl');
  }
  return queueFilePath;
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

function saveOrUpdateActiveSessionLocal(session, userId) {
  const chunks = readChunks();
  const index = chunks.findIndex(c => c.local_id === session.local_id);

  const start = session.startTime || session.start_time;
  const end = session.endTime || session.end_time;
  const actOn = session.activityOn || session.activity_on;

  const startFormatted = ensureFormattedDateTime(start);
  const endFormatted = ensureFormattedDateTime(end);
  const actOnFormatted = ensureFormattedDateTime(actOn);

  const startDateObj = new Date(start);
  const endDateObj = new Date(end);
  const duration = session.duration !== undefined ? session.duration : Math.floor((endDateObj - startDateObj) / 1000);

  if (index >= 0) {
    // Update existing session
    chunks[index] = {
      ...chunks[index],
      end_time: endFormatted,
      duration: duration,
      closed: session.closed !== undefined ? session.closed : chunks[index].closed,
      updated_at: new Date().toISOString()
    };
    writeChunks(chunks);
    return chunks[index];
  } else {
    // Insert new active session
    const newSession = {
      local_id: session.local_id || crypto.randomUUID(),
      user_id: userId || null,
      app_name: session.appName || session.app_name || 'Unknown',
      window_title: session.windowTitle || session.window_title || 'Untitled',
      start_time: startFormatted,
      end_time: endFormatted,
      duration: duration,
      activity_on: actOnFormatted,
      status: (session.status || 'Active').toLowerCase(),
      closed: session.closed !== undefined ? session.closed : false,
      synced: false,
      retry_count: 0,
      last_error: null,
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
      return {
        ...c,
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
  return chunks.filter(c => {
    if (!c.closed) return false;
    if (c.synced) return false;
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

function getUnsyncedTodayDuration(userId) {
  const chunks = readChunks();
  const todayStr = getLocalDateString();
  const userIdInt = userId ? parseInt(userId, 10) : null;

  return chunks
    .filter(c => {
      if (c.synced) return false;
      if (userIdInt && c.user_id && parseInt(c.user_id, 10) !== userIdInt) return false;
      return c.start_time && c.start_time.startsWith(todayStr);
    })
    .reduce((sum, c) => sum + (c.duration || 0), 0);
}

// Map back for compatibility in testing or simple usage if needed
function saveChunkLocal(chunk, userId) {
  return saveOrUpdateActiveSessionLocal({ ...chunk, closed: true }, userId);
}

function getUnsyncedTodayLogs(userId) {
  const chunks = readChunks();
  const todayStr = getLocalDateString();
  const userIdInt = userId ? parseInt(userId, 10) : null;

  return chunks.filter(c => {
    if (c.synced) return false;
    if (userIdInt && c.user_id && parseInt(c.user_id, 10) !== userIdInt) return false;
    return c.start_time && c.start_time.startsWith(todayStr);
  });
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
  // Keep back compat mapping
  saveChunkLocal,
  markChunkSynced: markSessionSynced,
  markChunkFailed: markSessionFailed
};
