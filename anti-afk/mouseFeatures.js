/**
 * anti-afk/mouseFeatures.js
 *
 * Feature extractor for mouse events.
 * Converts raw mouse inputs (moves, clicks, scrolls) into behavioral metrics.
 */

const config = require('./config');

/**
 * Extracts mouse features from events within the current rolling window.
 * @param {Array} mouseEvents
 * @param {number} cutoff - Timestamp cutoff (ms)
 * @param {number} now - Current timestamp (ms)
 */
function extractMouseFeatures(mouseEvents, cutoff, now) {
  const events = mouseEvents.filter(e => e.timestamp >= cutoff);

  const moves = events.filter(e => e.type === 'mousemove');
  const clicks = events.filter(e => e.type === 'click');
  const scrolls = events.filter(e => e.type === 'wheel');

  let movementDistance = 0;
  moves.forEach(e => {
    movementDistance += e.distance;
  });

  const clickCount = clicks.length;
  const scrollCount = scrolls.length;

  let durationMs = 0;
  if (moves.length >= 2) {
    durationMs = moves[moves.length - 1].timestamp - moves[0].timestamp;
  }

  let averageSpeed = 0;
  if (durationMs > 0) {
    averageSpeed = movementDistance / (durationMs / 1000);
  }

  let movementCurvature = 0;
  if (moves.length >= 3) {
    let angleSum = 0;
    let angleCount = 0;

    for (let i = 2; i < moves.length; i++) {
      const p1 = moves[i - 2];
      const p2 = moves[i - 1];
      const p3 = moves[i];

      const dx1 = p2.x - p1.x;
      const dy1 = p2.y - p1.y;
      const dx2 = p3.x - p2.x;
      const dy2 = p3.y - p2.y;

      const len1 = Math.sqrt(dx1 * dx1 + dy1 * dy1);
      const len2 = Math.sqrt(dx2 * dx2 + dy2 * dy2);

      if (len1 > 0.5 && len2 > 0.5) {
        const dot = dx1 * dx2 + dy1 * dy2;
        const cosTheta = Math.max(-1, Math.min(1, dot / (len1 * len2)));
        const theta = Math.acos(cosTheta);
        angleSum += theta;
        angleCount++;
      }
    }

    if (angleCount > 0) {
      movementCurvature = angleSum / angleCount;
    }
  }

  let maxIdleGapMs = 0;
  if (events.length > 0) {
    let lastTime = cutoff;
    events.forEach(e => {
      const gap = e.timestamp - lastTime;
      if (gap > maxIdleGapMs) {
        maxIdleGapMs = gap;
      }
      lastTime = e.timestamp;
    });

    const finalGap = now - lastTime;
    if (finalGap > maxIdleGapMs) {
      maxIdleGapMs = finalGap;
    }
  } else {
    maxIdleGapMs = now - cutoff;
  }

  const idleGap = maxIdleGapMs / 1000;

  let vibrationFrequency = 0;
  if (moves.length >= 3) {
    const microMoves = moves.filter(e => e.distance < 2);
    const durationSec = durationMs / 1000;
    if (durationSec > 0) {
      vibrationFrequency = microMoves.length / durationSec;
    }
  }

  return {
    movementDistance,
    averageSpeed,
    clickCount,
    scrollCount,
    movementCurvature,
    idleGap,
    vibrationFrequency,
    durationMs
  };
}

module.exports = { extractMouseFeatures };
