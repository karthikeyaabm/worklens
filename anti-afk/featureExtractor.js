/**
 * anti-afk/featureExtractor.js
 *
 * Primary feature extractor interface.
 * Aggregates hardware and system metrics into a single object for analysis.
 */

const { extractKeyboardFeatures } = require('./keyboardFeatures');
const { extractMouseFeatures } = require('./mouseFeatures');
const { extractWindowFeatures } = require('./windowFeatures');
const { extractIdleFeatures } = require('./idleFeatures');
const config = require('./config');

/**
 * Extracts all features from current queues and state.
 * @param {Object} events - Object containing arrays of events by category
 * @param {Map} heldKeys - Active key press timestamps
 * @param {Object} lastWindowFocus - Current focused window details
 * @param {number} currentIdleTime - Polled idle time in seconds
 * @param {number} now - Target timestamp in milliseconds
 */
function extractFeatures(events, heldKeys, lastWindowFocus, currentIdleTime, now = Date.now()) {
  const windowSeconds = config.evaluationWindowSeconds || config.rollingWindowSeconds;
  const cutoff = now - (windowSeconds * 1000);

  const keyboard = extractKeyboardFeatures(events.keyboard, heldKeys, cutoff, now);
  const mouse = extractMouseFeatures(events.mouse, cutoff, now);
  const window = extractWindowFeatures(events.window, cutoff, now, lastWindowFocus);
  const idle = extractIdleFeatures(events.system, currentIdleTime, cutoff, now);

  return {
    keyboard,
    mouse,
    window,
    idle,
    timestamp: now
  };
}

module.exports = { extractFeatures };
