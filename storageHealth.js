// storageHealth.js
// WorkLens Storage Health & Local Persistence Supervisor
const path = require('path');

const config = {
  failureThreshold: 3,                   // 3 consecutive persistence failures required
  notWorkingAfterMs: 0,                  // Minimum continuous failure duration (0 = immediate upon failureThreshold)
  notificationCooldownMs: 30 * 60 * 1000 // 30 minutes cooldown between failure notifications
};

const state = {
  activityCollectionWorking: true,
  localStorageWorking: true,
  offlineQueueWorking: true,
  lastSuccessfulLocalWrite: null,
  lastStorageError: null,
  storageFailure: false,
  consecutiveFailures: 0,
  firstFailureTime: null,
  isUnhealthy: false,
  lastNotificationTime: null,
  lastRecoveryNotificationTime: null
};

let notificationHandler = (alert) => {
  try {
    const { Notification } = require('electron');
    if (Notification && Notification.isSupported && Notification.isSupported()) {
      const notif = new Notification({
        title: alert.title,
        body: alert.message,
        icon: path.join(__dirname, 'assets', 'icon.png')
      });
      notif.show();
      console.log(`[StorageHealth] Windows notification displayed: [${alert.title}] ${alert.message}`);
      return true;
    }
  } catch (err) {
    console.error('[StorageHealth] Failed to show native notification:', err);
  }
  return false;
};

/**
 * Classifies filesystem and database errors into employee-friendly notifications.
 * Eliminates technical jargon like ENOSPC, EACCES, syscalls, or stack traces.
 */
function classifyStorageError(error) {
  const code = (error && error.code) ? String(error.code).toUpperCase() : '';
  const msg = (error && error.message) ? String(error.message).toLowerCase() : String(error || '').toLowerCase();

  const isDiskFull = code === 'ENOSPC' ||
    msg.includes('no space left on device') ||
    msg.includes('disk full') ||
    msg.includes('database full') ||
    msg.includes('database or disk is full') ||
    msg.includes('not enough space') ||
    msg.includes('out of disk space');

  if (isDiskFull) {
    return {
      type: 'DISK_FULL',
      title: 'WorkLens Alert',
      message: 'WorkLens is not working properly because your system storage may be full. Please free up disk space.'
    };
  }

  const isPermissionOrLocked = code === 'EACCES' ||
    code === 'EPERM' ||
    code === 'EBUSY' ||
    code === 'EROFS' ||
    msg.includes('permission denied') ||
    msg.includes('access denied') ||
    msg.includes('resource busy') ||
    msg.includes('database locked') ||
    msg.includes('file locked') ||
    msg.includes('locked') ||
    msg.includes('read-only');

  if (isPermissionOrLocked) {
    return {
      type: 'PERMISSION_OR_LOCK',
      title: 'WorkLens Alert',
      message: 'WorkLens is not working properly due to a local storage or file permission issue. Please check folder permissions or restart the app.'
    };
  }

  return {
    type: 'STORAGE_FAILURE',
    title: 'WorkLens Alert',
    message: 'WorkLens is not working properly because local activity data cannot be saved. Please check system storage.'
  };
}

/**
 * Configure health thresholds and cooldowns
 */
function configureStorageHealth(options = {}) {
  if (typeof options.failureThreshold === 'number') {
    config.failureThreshold = Math.max(1, options.failureThreshold);
  }
  if (typeof options.notWorkingAfterMs === 'number') {
    config.notWorkingAfterMs = Math.max(0, options.notWorkingAfterMs);
  }
  if (typeof options.notificationCooldownMs === 'number') {
    config.notificationCooldownMs = Math.max(0, options.notificationCooldownMs);
  }
  return { ...config };
}

/**
 * Sets custom notification handler for testing or UI delegation
 */
function setNotificationHandler(fn) {
  if (typeof fn === 'function') {
    notificationHandler = fn;
  }
}

/**
 * Records a successful local persistence write.
 * Handles recovery transition and triggers recovery notification if previously unhealthy.
 */
function recordStorageSuccess() {
  const now = Date.now();
  const wasUnhealthy = state.isUnhealthy;

  state.localStorageWorking = true;
  state.offlineQueueWorking = true;
  state.storageFailure = false;
  state.lastSuccessfulLocalWrite = new Date(now).toISOString();
  state.lastStorageError = null;
  state.consecutiveFailures = 0;
  state.firstFailureTime = null;

  if (wasUnhealthy) {
    state.isUnhealthy = false;
    state.lastRecoveryNotificationTime = now;
    console.log('[StorageHealth] WORKLENS_RECOVERED: Local storage writes succeeding again.');

    const recoveryAlert = {
      type: 'RECOVERED',
      title: 'WorkLens Alert',
      message: 'WorkLens is working normally again.'
    };

    try {
      notificationHandler(recoveryAlert);
    } catch (err) {
      console.error('[StorageHealth] Recovery notification handler error:', err);
    }
  }
}

/**
 * Records a local storage persistence failure.
 * Increments consecutive failure counter, evaluates health thresholds,
 * and triggers alert with cooldown protection.
 */
function recordStorageFailure(error) {
  const now = Date.now();
  state.localStorageWorking = false;
  state.offlineQueueWorking = false;
  state.storageFailure = true;
  state.lastStorageError = error ? (error.message || String(error)) : 'Unknown storage error';
  state.consecutiveFailures++;

  if (!state.firstFailureTime) {
    state.firstFailureTime = now;
  }

  const elapsedSinceFirstFailure = now - state.firstFailureTime;
  const isThresholdReached = state.consecutiveFailures >= config.failureThreshold &&
    elapsedSinceFirstFailure >= config.notWorkingAfterMs;

  console.warn(`[StorageHealth] Local storage failure (attempt ${state.consecutiveFailures}/${config.failureThreshold}): ${state.lastStorageError}`);

  if (isThresholdReached) {
    state.isUnhealthy = true;
    console.error(`[StorageHealth] WORKLENS_NOT_WORKING: Local activity persistence has failed ${state.consecutiveFailures} times consecutively.`);

    const isCooldownActive = state.lastNotificationTime &&
      (now - state.lastNotificationTime) < config.notificationCooldownMs;

    if (!isCooldownActive) {
      state.lastNotificationTime = now;
      const alert = classifyStorageError(error);
      try {
        notificationHandler(alert);
      } catch (err) {
        console.error('[StorageHealth] Storage failure notification handler error:', err);
      }
    } else {
      const remainingCooldownMin = Math.ceil((config.notificationCooldownMs - (now - state.lastNotificationTime)) / 60000);
      console.log(`[StorageHealth] Notification suppressed by cooldown (${remainingCooldownMin}m remaining).`);
    }
  }
}

/**
 * Records activity collection status from tracking tick
 */
function recordActivityCollection(isWorking = true) {
  state.activityCollectionWorking = !!isWorking;
}

/**
 * Returns a snapshot of the current storage health
 */
function getStorageHealth() {
  return {
    activityCollectionWorking: state.activityCollectionWorking,
    localStorageWorking: state.localStorageWorking,
    offlineQueueWorking: state.offlineQueueWorking,
    lastSuccessfulLocalWrite: state.lastSuccessfulLocalWrite,
    lastStorageError: state.lastStorageError,
    storageFailure: state.storageFailure,
    consecutiveFailures: state.consecutiveFailures,
    isUnhealthy: state.isUnhealthy,
    status: state.isUnhealthy ? 'WORKLENS_NOT_WORKING' : 'HEALTHY'
  };
}

/**
 * Returns boolean whether local storage is healthy
 */
function isStorageHealthy() {
  return !state.isUnhealthy && state.localStorageWorking;
}

/**
 * Resets state to clean initial defaults (primarily for test isolation)
 */
function resetStorageHealth() {
  state.activityCollectionWorking = true;
  state.localStorageWorking = true;
  state.offlineQueueWorking = true;
  state.lastSuccessfulLocalWrite = null;
  state.lastStorageError = null;
  state.storageFailure = false;
  state.consecutiveFailures = 0;
  state.firstFailureTime = null;
  state.isUnhealthy = false;
  state.lastNotificationTime = null;
  state.lastRecoveryNotificationTime = null;
}

module.exports = {
  recordStorageSuccess,
  recordStorageFailure,
  recordActivityCollection,
  getStorageHealth,
  isStorageHealthy,
  classifyStorageError,
  configureStorageHealth,
  setNotificationHandler,
  resetStorageHealth,
  WORKLENS_NOT_WORKING: 'WORKLENS_NOT_WORKING',
  WORKLENS_RECOVERED: 'WORKLENS_RECOVERED'
};
