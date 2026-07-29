/**
 * antiAfkDetector.js
 * 
 * Modular Anti-AFK / Anti-Fake Activity Detection system for Electron.
 * It monitors keyboard and mouse activity using a rolling event history
 * and evaluates suspicious patterns such as key weights, held keys,
 * and high-frequency automated repetitions.
 */

const log = require('./logger');

// Configuration matching requirements
const CONFIG = {
  sameKeyWindow: 60,       // Time window in seconds to analyze
  sameKeyThreshold: 0.95,  // Ratio threshold for a single key dominating input
  keyHoldSeconds: 30,      // Max duration in seconds a key can be held down
  historySize: 200,        // Maximum number of rolling key events to keep
  scoreThreshold: 70       // Suspicion score threshold to flag fake activity
};

// State variables
let keyHistory = [];       // Rolling array of { keycode, timestamp }
let heldKeys = new Map();  // Map of keycode -> downTimestamp
let lastMouseMoveTime = Date.now();
let lastMouseClickTime = Date.now();
let isFakeActivityDetected = false;
let fakeActivityReason = '';

// Track the window title/app that was active during the last check
let lastWindowKey = '';

/**
 * Record a key down event.
 * @param {number} keycode 
 */
function recordKeyDown(keycode) {
  const now = Date.now();

  // 1. Maintain held keys state.
  // Windows key repeat fires multiple keydown events for a single physical hold.
  // We only record the initial timestamp and ignore subsequent repeated keydowns for held keys.
  if (!heldKeys.has(keycode)) {
    heldKeys.set(keycode, now);
  }

  // 2. Add to rolling history
  keyHistory.push({ keycode, timestamp: now });
  if (keyHistory.length > CONFIG.historySize) {
    keyHistory.shift();
  }

  // 3. Natural interaction detection:
  // If we currently have a flagged fake activity, pressing a DIFFERENT key should resume activity.
  if (isFakeActivityDetected) {
    // Find the repeating key that triggered the block.
    // If the new key is different, we consider it a natural interaction and clear the block.
    const mostFrequentKey = getMostFrequentKey(keyHistory);
    if (mostFrequentKey !== null && keycode !== mostFrequentKey) {
      resumeActivity('Different key pressed');
    }
  }
}

/**
 * Record a key up event.
 * @param {number} keycode 
 */
function recordKeyUp(keycode) {
  // Remove from held keys
  heldKeys.delete(keycode);
}

/**
 * Record a mouse movement.
 * @param {number} x 
 * @param {number} y 
 */
function recordMouseMove(x, y) {
  lastMouseMoveTime = Date.now();
  if (isFakeActivityDetected) {
    resumeActivity('Mouse movement detected');
  }
}

/**
 * Record a mouse click.
 * @param {number} button 
 * @param {number} x 
 * @param {number} y 
 */
function recordMouseClick(button, x, y) {
  lastMouseClickTime = Date.now();
  if (isFakeActivityDetected) {
    resumeActivity('Mouse click detected');
  }
}

/**
 * Record a window change.
 * This is called from the main process when the active application or window title changes.
 * @param {string} appName 
 * @param {string} windowTitle 
 */
function recordWindowChange(appName, windowTitle) {
  const windowKey = `${appName}::${windowTitle}`;
  if (lastWindowKey && lastWindowKey !== windowKey) {
    if (isFakeActivityDetected) {
      resumeActivity('Window focus changed');
    }
  }
  lastWindowKey = windowKey;
}

/**
 * Resumes user activity, resetting the fake activity flag and clearing history
 * to avoid immediate re-triggering.
 * @param {string} context 
 */
function resumeActivity(context) {
  if (isFakeActivityDetected) {
    log.info(`[AntiAFK] Activity resumed. Trigger: ${context}.`);
    isFakeActivityDetected = false;
    fakeActivityReason = '';
  }
  // Clear history so old patterns do not bleed into the new session
  keyHistory = [];
  heldKeys.clear();
}

/**
 * Evaluates the rolling history and updates the user's active/inactive status.
 * Uses a multi-factor scoring system to prevent false positives while capturing physical cheating.
 * 
 * Scores:
 * - Same-key ratio >= threshold: +40
 * - Very low entropy (< 1.0): +25
 * - Key held > 30s: +20 (and forces fake activity flag directly)
 * - No mouse movement in last 60s: +15
 * 
 * If score >= 70, sets isFakeActivityDetected = true
 */
function evaluateActivity() {
  const now = Date.now();
  const cutoff = now - (CONFIG.sameKeyWindow * 1000);

  // Filter history to keep only events in the last 60s window
  const activeHistory = keyHistory.filter(event => event.timestamp >= cutoff);

  let score = 0;
  const metrics = {
    sameKeyRatio: 0,
    entropy: 99,
    typingDiversity: 1.0,
    averageInterval: 0,
    intervalStdDev: 0,
    maxKeyHoldDuration: 0
  };

  // 1. Evaluate key hold duration
  let hasLongHold = false;
  for (const [keycode, pressTime] of heldKeys.entries()) {
    const holdTime = (now - pressTime) / 1000;
    if (holdTime > metrics.maxKeyHoldDuration) {
      metrics.maxKeyHoldDuration = holdTime;
    }
    if (holdTime > CONFIG.keyHoldSeconds) {
      hasLongHold = true;
    }
  }

  if (hasLongHold) {
    score += 20;
  }

  // 2. Evaluate keyboard pattern metrics if we have sufficient events
  if (activeHistory.length >= 10) {
    const totalKeys = activeHistory.length;
    const keyCounts = new Map();
    let maxCount = 0;
    let mostFrequentKeyCode = null;

    activeHistory.forEach(event => {
      const count = (keyCounts.get(event.keycode) || 0) + 1;
      keyCounts.set(event.keycode, count);
      if (count > maxCount) {
        maxCount = count;
        mostFrequentKeyCode = event.keycode;
      }
    });

    // Same-key ratio
    metrics.sameKeyRatio = maxCount / totalKeys;
    if (metrics.sameKeyRatio >= CONFIG.sameKeyThreshold) {
      score += 40;
    }

    // Shannon Entropy
    let entropy = 0;
    for (const count of keyCounts.values()) {
      const p = count / totalKeys;
      entropy -= p * Math.log2(p);
    }
    metrics.entropy = entropy;
    if (entropy < 1.0) {
      score += 25;
    }

    // Typing Diversity (unique keys / total keys)
    metrics.typingDiversity = keyCounts.size / totalKeys;

    // Time Intervals (Average & StdDev)
    let totalInterval = 0;
    const intervals = [];
    for (let i = 1; i < activeHistory.length; i++) {
      const diff = activeHistory[i].timestamp - activeHistory[i - 1].timestamp;
      intervals.push(diff);
      totalInterval += diff;
    }
    metrics.averageInterval = totalInterval / (totalKeys - 1);

    let varianceSum = 0;
    intervals.forEach(interval => {
      varianceSum += Math.pow(interval - metrics.averageInterval, 2);
    });
    metrics.intervalStdDev = Math.sqrt(varianceSum / intervals.length);
  }

  // 3. Evaluate mouse movement
  const timeSinceLastMouseMove = now - lastMouseMoveTime;
  const timeSinceLastMouseClick = now - lastMouseClickTime;
  const noMouseMovement = timeSinceLastMouseMove > (CONFIG.sameKeyWindow * 1000) &&
                          timeSinceLastMouseClick > (CONFIG.sameKeyWindow * 1000);

  if (noMouseMovement) {
    score += 15;
  }

  // Determine final status
  // Direct rules check: If a key is held down for more than 30 seconds or score is >= 70
  if (hasLongHold || score >= CONFIG.scoreThreshold) {
    if (!isFakeActivityDetected) {
      // Determine key name for user-friendly logging if possible
      let keyDisplay = 'a key';
      if (activeHistory.length > 0) {
        const mostFreq = getMostFrequentKey(activeHistory);
        keyDisplay = mostFreq !== null ? `Key [${mostFreq}]` : 'a key';
      } else if (heldKeys.size > 0) {
        const firstHeld = heldKeys.keys().next().value;
        keyDisplay = `Key [${firstHeld}]`;
      }

      const durationSecs = Math.round((now - (activeHistory[0]?.timestamp || now)) / 1000);
      let reason = '';
      if (hasLongHold) {
        reason = `Key held down continuously for ${Math.round(metrics.maxKeyHoldDuration)} seconds.`;
      } else {
        reason = `Repeated "${keyDisplay}" detected for ${durationSecs} seconds (Score: ${score}).`;
      }

      fakeActivityReason = 'Continuous repetitive keyboard input detected.';
      isFakeActivityDetected = true;

      log.warn(`[AntiAFK]\nReason:\n${reason}\nActivity paused.`);
    }
  }

  return {
    score,
    isSuspicious: isFakeActivityDetected,
    metrics
  };
}

/**
 * Returns whether the user is currently considered active (not flagged for cheating).
 * @returns {boolean}
 */
function isUserActive() {
  return !isFakeActivityDetected;
}

/**
 * Helper to get the most frequent keycode in history
 * @param {Array} history 
 */
function getMostFrequentKey(history) {
  if (history.length === 0) return null;
  const counts = {};
  let maxCount = 0;
  let mostFreq = null;
  history.forEach(ev => {
    counts[ev.keycode] = (counts[ev.keycode] || 0) + 1;
    if (counts[ev.keycode] > maxCount) {
      maxCount = counts[ev.keycode];
      mostFreq = ev.keycode;
    }
  });
  return mostFreq;
}

module.exports = {
  recordKeyDown,
  recordKeyUp,
  recordMouseMove,
  recordMouseClick,
  recordWindowChange,
  evaluateActivity,
  isUserActive,
  CONFIG
};
