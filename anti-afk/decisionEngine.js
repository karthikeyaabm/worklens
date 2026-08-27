/**
 * anti-afk/decisionEngine.js
 *
 * Decision Engine.
 * Converts numerical confidence scores into behavioral classifications.
 */

const config = require('./config');

/**
 * Classifies confidence score into structured decision levels.
 * @param {number} score - Confidence score (0-100)
 */
function classifyScore(score) {
  for (const level of config.decisionLevels) {
    if (score >= level.min && score <= level.max) {
      return level.label;
    }
  }
  return 'Human'; // Fallback
}

/**
 * Evaluates the final classification, triggers, and returns full details.
 * @param {number} score - Confidence score (0-100)
 * @param {Array} reasons - Trigger reasons list
 * @param {Object} metrics - Extracted behavioral features
 * @param {Object} indicators - Behavior anomaly flags
 */
function processDecision(score, reasons, metrics, indicators) {
  const status = classifyScore(score);
  
  // Directly trigger suspicion if key hold exceeds threshold, vibration-like activity, or score >= threshold
  const hasLongHold = metrics.keyboard.keyHoldDuration >= config.behavior.keyHoldThresholdSeconds;
  const hasVibrationLikeActivity = indicators && indicators.vibrationLikeActivity;
  const isSuspicious = score >= config.scoreThreshold || hasLongHold || hasVibrationLikeActivity;

  return {
    status: hasLongHold ? 'Likely Automation' : status,
    confidenceScore: score,
    isSuspicious,
    reasons,
    metrics
  };
}

module.exports = { processDecision };
