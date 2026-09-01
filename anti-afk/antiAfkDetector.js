/**
 * anti-afk/antiAfkDetector.js
 *
 * Primary Orchestrator for the modular Anti-AFK behavior analysis engine.
 * Coordinates events, features, behaviors, scoring, and decisions,
 * while maintaining the exact public API for backward compatibility.
 */

const eventCollector = require('./eventCollector');
const { extractFeatures } = require('./featureExtractor');
const { analyzeBehavior } = require('./behaviorAnalyzer');
const { calculateConfidenceScore } = require('./scoreEngine');
const { processDecision } = require('./decisionEngine');
const config = require('./config');
const log = require('../logger');

// State variables
let isFakeActivityDetected = false;
let fakeActivityReason = '';

// system control and navigation key scan codes in uIOhook
const CONTROL_KEYS = new Set([
  1,     // Escape
  15,    // Tab
  29,    // Left Ctrl
  42,    // Left Shift
  54,    // Right Shift
  56,    // Left Alt
  58,    // Caps Lock
  3613,  // Right Ctrl
  3640,  // Right Alt
  3675,  // Left Win / Cmd
  3676,  // Right Win / Cmd
  57416, // Up Arrow
  57419, // Left Arrow
  57421, // Right Arrow
  57424  // Down Arrow
]);

/**
 * Helper to check if a debug log should be output.
 */
function logDebug(tag, message, details = '') {
  if (config.loggingEnabled) {
    const detailStr = typeof details === 'object' ? JSON.stringify(details) : details;
    console.log(`[Anti-AFK-Engine] ${tag} ${message} ${detailStr}`);
  }
}

/**
 * Record a key down event.
 */
function recordKeyDown(keycode) {
  // Graceful recovery: press of a DIFFERENT content key clears fake activity flag.
  // This prevents control/modifier keys (like Alt, Tab) from clearing suspicion.
  if (isFakeActivityDetected && !CONTROL_KEYS.has(keycode)) {
    const events = eventCollector.getEvents();
    const keydowns = events.keyboard.filter(e => e.type === 'keydown');
    if (keydowns.length > 0) {
      const mostFrequentKey = getMostFrequentKey(keydowns);
      if (mostFrequentKey !== null && keycode !== mostFrequentKey) {
        resumeActivity('Different key pressed');
      }
    }
  }

  eventCollector.recordKeyDown(keycode);
  logDebug('[Collector]', `Key down recorded: Keycode ${keycode}`);
}

/**
 * Record a key up event.
 */
function recordKeyUp(keycode) {
  eventCollector.recordKeyUp(keycode);
  logDebug('[Collector]', `Key up recorded: Keycode ${keycode}`);
}

/**
 * Record a mouse movement.
 */
function recordMouseMove(x, y) {
  eventCollector.recordMouseMove(x, y);

  // Graceful recovery: Mouse movement with natural curvature clears the flag.
  // This prevents simple mouse Jigglers (which move in straight lines or simple loops) from recovering.
  if (isFakeActivityDetected) {
    const events = eventCollector.getEvents();
    const moves = events.mouse.filter(e => e.type === 'mousemove');
    if (moves.length >= 3) {
      const p1 = moves[moves.length - 3];
      const p2 = moves[moves.length - 2];
      const p3 = moves[moves.length - 1];

      const dx1 = p2.x - p1.x;
      const dy1 = p2.y - p1.y;
      const dx2 = p3.x - p2.x;
      const dy2 = p3.y - p2.y;

      const len1 = Math.sqrt(dx1 * dx1 + dy1 * dy1);
      const len2 = Math.sqrt(dx2 * dx2 + dy2 * dy2);

      if (len1 > 3.0 && len2 > 3.0) {
        const dot = dx1 * dx2 + dy1 * dy2;
        const cosTheta = Math.max(-1, Math.min(1, dot / (len1 * len2)));
        const theta = Math.acos(cosTheta);
        // If angle change exceeds 0.05 radians (approx 3 degrees) and is not a sharp reversal (e.g. < 3.0 rad)
        if (theta > 0.05 && theta < 3.0) {
          resumeActivity('Natural mouse movement detected');
        }
      }
    }
  }
}

/**
 * Record a mouse click.
 */
function recordMouseClick(button, x, y) {
  if (isFakeActivityDetected) {
    resumeActivity('Mouse click detected');
  }
  eventCollector.recordMouseClick(button, x, y);
  logDebug('[Collector]', `Mouse click recorded: Button ${button} at (${x}, ${y})`);
}

/**
 * Record a mouse wheel scroll.
 */
function recordMouseWheel(horizontal, rotation) {
  if (isFakeActivityDetected) {
    resumeActivity('Mouse scroll detected');
  }
  eventCollector.recordMouseWheel(horizontal, rotation);
  logDebug('[Collector]', `Mouse scroll recorded: rotation ${rotation}`);
}

/**
 * Record active window change.
 * Notice: Changing windows must NEVER immediately clear suspicious activity.
 */
function recordWindowChange(appName, windowTitle) {
  eventCollector.recordWindowChange(appName, windowTitle);
  logDebug('[Collector]', `Window focus changed to app [${appName}] title [${windowTitle}]`);
}

/**
 * Resumes activity, clearing the fake activity flag and resetting queue state.
 */
function resumeActivity(context) {
  if (isFakeActivityDetected) {
    log.info(`[AntiAFK] Activity resumed. Trigger: ${context}.`);
    isFakeActivityDetected = false;
    fakeActivityReason = '';
  }
  eventCollector.clear();
}

/**
 * Resets all internal state and clears queues (primarily for testing).
 */
function clear() {
  isFakeActivityDetected = false;
  fakeActivityReason = '';
  eventCollector.clear();
}

/**
 * Evaluates the rolling history and updates the user's active/inactive status.
 * Executes feature extraction, behavior indicators, score engine, and decision classification.
 */
function evaluateActivity() {
  const now = Date.now();
  const events = eventCollector.getEvents();
  const heldKeys = eventCollector.heldKeys;
  const lastWindowFocus = eventCollector.lastWindowFocus;

  // Find latest recorded idle time
  const idleTimeEvent = events.system.filter(e => e.type === 'idleTime').pop();
  const currentIdleTime = idleTimeEvent ? idleTimeEvent.idleTime : 0;

  // Stage 2: Feature Extraction
  const metrics = extractFeatures(events, heldKeys, lastWindowFocus, currentIdleTime, now);
  logDebug('[Features]', 'Extracted behavioral metrics:', metrics);

  // Stage 3: Behavior Analysis
  const analysis = analyzeBehavior(metrics, events);
  logDebug('[Behavior]', 'Analyzed behavioral indicators:', analysis.indicators);

  // Stage 4: Confidence Score Calculation
  const scoreResult = calculateConfidenceScore(analysis.indicators);
  logDebug('[Score]', `Calculated confidence score: ${scoreResult.score}`, scoreResult.activeWeights);

  // Stage 5: Decision classification
  const decision = processDecision(scoreResult.score, analysis.reasons, metrics);
  logDebug('[Decision]', `Status classified as [${decision.status}] with score ${decision.confidenceScore}%`);

  // Handle suspicious status flag transitions
  if (decision.isSuspicious) {
    if (!isFakeActivityDetected) {
      isFakeActivityDetected = true;
      fakeActivityReason = decision.reasons.join(' | ');
      log.warn(`[AntiAFK] Suspicious fake activity flagged (Score: ${decision.confidenceScore}%). Reasons:\n- ${decision.reasons.join('\n- ')}`);
    }
  } else {
    // If score dropped, recover state
    if (isFakeActivityDetected) {
      resumeActivity('Confidence score dropped below threshold');
    }
  }

  // Return structure compatible with original evaluateActivity
  return {
    score: decision.confidenceScore,
    isSuspicious: isFakeActivityDetected,
    metrics: {
      sameKeyRatio: metrics.keyboard.sameKeyRatio,
      entropy: metrics.keyboard.typingEntropy,
      typingDiversity: metrics.keyboard.typingDiversity,
      averageInterval: metrics.keyboard.averageInterval,
      intervalStdDev: metrics.keyboard.intervalStdDeviation,
      maxKeyHoldDuration: metrics.keyboard.keyHoldDuration,
      // Additional metrics exposed
      mouseDistance: metrics.mouse.movementDistance,
      mouseSpeed: metrics.mouse.averageSpeed,
      clickCount: metrics.mouse.clickCount,
      scrollCount: metrics.mouse.scrollCount,
      mouseCurvature: metrics.mouse.movementCurvature,
      windowSwitchCount: metrics.window.windowSwitchCount,
      pingPongRatio: metrics.window.pingPongRatio,
      idleTime: metrics.idle.idleTime
    },
    status: decision.status,
    reasons: decision.reasons
  };
}

/**
 * Returns whether user activity is active (not currently flagged for automation cheating).
 */
function isUserActive() {
  return !isFakeActivityDetected;
}

/**
 * Helper to find the most frequent keycode in keydown arrays.
 */
function getMostFrequentKey(keydownEvents) {
  if (keydownEvents.length === 0) return null;
  const counts = {};
  let maxCount = 0;
  let mostFreq = null;
  keydownEvents.forEach(ev => {
    counts[ev.keyCode] = (counts[ev.keyCode] || 0) + 1;
    if (counts[ev.keyCode] > maxCount) {
      maxCount = counts[ev.keyCode];
      mostFreq = ev.keyCode;
    }
  });
  return mostFreq;
}

module.exports = {
  clear,
  recordKeyDown,
  recordKeyUp,
  recordMouseMove,
  recordMouseClick,
  recordMouseWheel,
  recordWindowChange,
  evaluateActivity,
  isUserActive,
  CONFIG: {
    sameKeyWindow: config.evaluationWindowSeconds || config.rollingWindowSeconds,
    sameKeyThreshold: config.behavior.sameKeyThreshold,
    keyHoldSeconds: config.behavior.keyHoldThresholdSeconds,
    historySize: config.historySize,
    scoreThreshold: config.scoreThreshold
  }
};
