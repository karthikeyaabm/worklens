/**
 * anti-afk/scoreEngine.js
 *
 * Confidence Score Engine.
 * Evaluates active behavioral indicators and computes a weighted confidence score.
 * Implements developer false-positive override logic for window switching.
 */

const config = require('./config');

/**
 * Calculates a weighted confidence score based on active indicators.
 * @param {Object} indicators - Active behavior anomaly flags
 * @returns {Object} { score, activeWeights }
 */
function calculateConfidenceScore(indicators) {
  let score = 0;
  const activeWeights = {};

  for (const [key, val] of Object.entries(indicators)) {
    if (val && config.weights[key]) {
      let weight = config.weights[key];

      // Developer False Positive Override for Ping Pong switching
      if (key === 'pingPongSwitch') {
        // If a developer switches back and forth between IDE and browser (ping-pong),
        // we check if they are interacting (i.e. windowSwitchWithoutInteraction is false)
        // and if there are no other active anomalies (such as key repeating, low entropy, holds, etc.).
        // If they are behaving naturally, we override the weight of pingPongSwitch to 0.
        const otherSuspicious =
          indicators.sameKeyRatio ||
          indicators.lowEntropy ||
          indicators.constantInterval ||
          indicators.periodicClicks ||
          indicators.repeatedMouseMovement ||
          indicators.longKeyHold ||
          indicators.windowSwitchWithoutInteraction ||
          indicators.artificialIdleRecovery;

        if (!otherSuspicious) {
          weight = 0; // Bypass weight for natural switching behavior
        }
      }

      score += weight;
      if (weight > 0) {
        activeWeights[key] = weight;
      }
    }
  }

  // Cap score at 100
  score = Math.min(100, score);

  return {
    score,
    activeWeights
  };
}

module.exports = { calculateConfidenceScore };
