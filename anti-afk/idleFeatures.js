/**
 * anti-afk/idleFeatures.js
 *
 * Feature extractor for system idle and power events.
 * Identifies wake triggers and idle duration recovery behaviors.
 */

/**
 * Extracts system idle/power metrics.
 * @param {Array} systemEvents
 * @param {number} currentIdleTime - Current polled system idle time in seconds
 * @param {number} cutoff - Timestamp cutoff (ms)
 * @param {number} now - Current timestamp (ms)
 */
function extractIdleFeatures(systemEvents, currentIdleTime, cutoff, now) {
  const events = systemEvents.filter(e => e.timestamp >= cutoff);

  // Count unlocks/resumes
  const wakeCount = events.filter(e => e.type === 'resume' || e.type === 'unlock').length;

  const idleRecoveryPattern = events.map(e => ({
    type: e.type,
    timestamp: e.timestamp
  }));

  return {
    idleTime: currentIdleTime || 0,
    wakeCount,
    idleRecoveryPattern
  };
}

module.exports = { extractIdleFeatures };
