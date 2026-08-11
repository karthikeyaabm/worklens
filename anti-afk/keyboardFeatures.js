/**
 * anti-afk/keyboardFeatures.js
 *
 * Feature extractor for keyboard events.
 * Converts raw keyboard inputs into statistical behavioral metrics.
 */

const config = require('./config');

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
 * Extracts keyboard features from events within the current rolling window.
 * @param {Array} keyboardEvents
 * @param {Map} heldKeys - Currently held keys
 * @param {number} cutoff - Timestamp cutoff (ms)
 * @param {number} now - Current timestamp (ms)
 */
function extractKeyboardFeatures(keyboardEvents, heldKeys, cutoff, now) {
  const events = keyboardEvents.filter(e => e.timestamp >= cutoff);
  const keydowns = events.filter(e => e.type === 'keydown');

  const totalKeys = keydowns.length;
  const uniqueKeyCodes = new Set(keydowns.map(e => e.keyCode));
  const uniqueKeys = uniqueKeyCodes.size;

  const contentKeys = keydowns.filter(e => !CONTROL_KEYS.has(e.keyCode)).length;

  const windowSeconds = config.evaluationWindowSeconds || config.rollingWindowSeconds;
  const typingSpeed = totalKeys / (windowSeconds / 60); // Keys per minute
  const typingDiversity = totalKeys > 0 ? uniqueKeys / totalKeys : 1.0;

  // Same key ratio (ratio of the most typed key to total keydowns)
  const counts = new Map();
  let maxCount = 0;
  keydowns.forEach(e => {
    const count = (counts.get(e.keyCode) || 0) + 1;
    counts.set(e.keyCode, count);
    if (count > maxCount) {
      maxCount = count;
    }
  });
  const sameKeyRatio = totalKeys > 0 ? maxCount / totalKeys : 0;

  // Typing Entropy (Shannon Entropy of key distribution)
  let typingEntropy = 0;
  if (totalKeys > 0) {
    for (const count of counts.values()) {
      const p = count / totalKeys;
      typingEntropy -= p * Math.log2(p);
    }
  } else {
    typingEntropy = 99.0; // Normal high entropy fallback for idle state
  }

  // Key interval stats (average and standard deviation of time between key presses)
  let averageInterval = 0;
  let intervalStdDeviation = 0;
  if (totalKeys >= 2) {
    const intervals = [];
    let totalInterval = 0;
    for (let i = 1; i < keydowns.length; i++) {
      const diff = keydowns[i].timestamp - keydowns[i - 1].timestamp;
      intervals.push(diff);
      totalInterval += diff;
    }
    averageInterval = totalInterval / intervals.length;

    let varianceSum = 0;
    intervals.forEach(val => {
      varianceSum += Math.pow(val - averageInterval, 2);
    });
    intervalStdDeviation = Math.sqrt(varianceSum / intervals.length);
  }

  // Key hold duration (duration a key is pressed down before release)
  let maxKeyHoldDuration = 0;
  const keyups = events.filter(e => e.type === 'keyup');
  keyups.forEach(e => {
    if (e.holdDuration > maxKeyHoldDuration) {
      maxKeyHoldDuration = e.holdDuration;
    }
  });

  // Include currently held keys which haven't triggered a keyup yet
  for (const pressTime of heldKeys.values()) {
    const holdTime = now - pressTime;
    if (holdTime > maxKeyHoldDuration) {
      maxKeyHoldDuration = holdTime;
    }
  }

  // Convert key hold duration to seconds
  const keyHoldDuration = maxKeyHoldDuration / 1000;

  return {
    totalKeys,
    uniqueKeys,
    contentKeys,
    typingSpeed,
    sameKeyRatio,
    typingEntropy,
    averageInterval,
    intervalStdDeviation,
    typingDiversity,
    keyHoldDuration
  };
}

module.exports = { extractKeyboardFeatures };
