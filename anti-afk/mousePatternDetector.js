/**
 * anti-afk/mousePatternDetector.js
 *
 * Dedicated pattern detector for specific automated mouse patterns.
 * Analyzes rolling mouse events to recognize:
 *  - Pattern A: Periodic Clicks (PYTHON_PERIODIC_CLICKS)
 *  - Pattern B: Small Vibration Movement (PYTHON_MOUSE_VIBRATION)
 *  - Pattern C: Back-and-Forth Movement (PYTHON_BACK_AND_FORTH)
 *  - Pattern D: Random Movement (PYTHON_RANDOM_MOVEMENT)
 *
 * NOTE: Operates strictly as an isolated annotation layer.
 * Does not alter active/inactive states, scores, or session times.
 */

const config = require('./config');

const PATTERNS = {
  PERIODIC_CLICKS: 'PYTHON_PERIODIC_CLICKS',
  MOUSE_VIBRATION: 'PYTHON_MOUSE_VIBRATION',
  BACK_AND_FORTH: 'PYTHON_BACK_AND_FORTH',
  RANDOM_MOVEMENT: 'PYTHON_RANDOM_MOVEMENT'
};

const defaultPatternConfig = config.mousePatterns || {
  periodicClicks: {
    minClicks: 6,
    targetIntervalMs: 400,
    intervalToleranceMs: 150,
    maxStdDevMs: 45,
    maxDistancePx: 10,
    maxRecencyMs: 15000
  },
  vibration: {
    minSteps: 10,
    maxAreaWidth: 25,
    maxAreaHeight: 25,
    nominalStepSize: 10,
    minStepSize: 6,
    maxStepSize: 16,
    minIntervalMs: 60,
    maxIntervalMs: 300,
    maxRecencyMs: 15000
  },
  backAndForth: {
    minSweeps: 4,
    targetDistancePx: 150,
    distanceTolerancePx: 35,
    maxVerticalDriftPx: 30,
    targetDurationMs: 500,
    minDurationMs: 250,
    maxDurationMs: 850,
    maxDurationStdDevMs: 120,
    maxRecencyMs: 15000
  },
  randomMovement: {
    minLegs: 5,
    minLegDistancePx: 40,
    minDurationMs: 150,
    maxDurationMs: 950,
    minPauseMs: 140,
    maxPauseMs: 650,
    maxCurvature: 0.05,
    minStraightness: 0.96,
    maxRecencyMs: 15000
  }
};

/**
 * Detect Pattern A: Periodic Clicks (~0.4s intervals at nearby coordinates)
 * @param {Object} events - Raw events container { mouse, keyboard, ... } or mouse array
 * @param {number} now - Reference timestamp
 * @param {Object} [customCfg] - Optional threshold overrides
 */
function detectPeriodicClicks(events, now = Date.now(), customCfg = {}) {
  const cfg = { ...defaultPatternConfig.periodicClicks, ...customCfg };
  const mouseEvents = Array.isArray(events) ? events : (events && events.mouse ? events.mouse : []);
  const cutoff = now - (cfg.maxRecencyMs * 2);

  const clicks = mouseEvents.filter(e => e.type === 'click' && e.timestamp >= cutoff);
  if (clicks.length < cfg.minClicks) return null;

  // Find consecutive runs of periodic clicks
  let bestRun = [];
  let currentRun = [clicks[0]];

  for (let i = 1; i < clicks.length; i++) {
    const prev = clicks[i - 1];
    const curr = clicks[i];
    const dt = curr.timestamp - prev.timestamp;
    const dist = Math.hypot(curr.x - prev.x, curr.y - prev.y);

    const isIntervalMatch = dt >= (cfg.targetIntervalMs - cfg.intervalToleranceMs) &&
                            dt <= (cfg.targetIntervalMs + cfg.intervalToleranceMs);
    const isNearby = dist <= cfg.maxDistancePx;

    if (isIntervalMatch && isNearby) {
      currentRun.push(curr);
    } else {
      if (currentRun.length > bestRun.length) {
        bestRun = currentRun;
      }
      currentRun = [curr];
    }
  }
  if (currentRun.length > bestRun.length) {
    bestRun = currentRun;
  }

  if (bestRun.length < cfg.minClicks) return null;

  // Recency check: latest click must be recent
  const latestClick = bestRun[bestRun.length - 1];
  if (now - latestClick.timestamp > cfg.maxRecencyMs) return null;

  // Compute interval standard deviation
  const intervals = [];
  for (let i = 1; i < bestRun.length; i++) {
    intervals.push(bestRun[i].timestamp - bestRun[i - 1].timestamp);
  }
  const avgInterval = intervals.reduce((a, b) => a + b, 0) / intervals.length;
  const variance = intervals.reduce((sum, val) => sum + Math.pow(val - avgInterval, 2), 0) / intervals.length;
  const stdDev = Math.sqrt(variance);

  if (stdDev <= cfg.maxStdDevMs) {
    return {
      pattern: PATTERNS.PERIODIC_CLICKS,
      details: {
        observedClicks: bestRun.length,
        avgIntervalMs: Math.round(avgInterval),
        stdDevMs: Math.round(stdDev * 10) / 10,
        anchor: { x: bestRun[0].x, y: bestRun[0].y }
      }
    };
  }

  return null;
}

/**
 * Detect Pattern B: Small Vibration Movement (4-point orthogonal 10px cycle)
 * Relative sequence: (0,0) -> (+10, 0) -> (0,0) -> (0, +10) -> (0,0)
 * @param {Object} events - Raw events container { mouse, keyboard, ... } or mouse array
 * @param {number} now - Reference timestamp
 * @param {Object} [customCfg] - Optional threshold overrides
 */
function detectMouseVibration(events, now = Date.now(), customCfg = {}) {
  const cfg = { ...defaultPatternConfig.vibration, ...customCfg };
  const mouseEvents = Array.isArray(events) ? events : (events && events.mouse ? events.mouse : []);
  const cutoff = now - (cfg.maxRecencyMs * 2);

  const moves = mouseEvents.filter(e => e.type === 'mousemove' && e.timestamp >= cutoff);
  if (moves.length < cfg.minSteps) return null;

  // Scan contiguous sub-sequences of moves
  let bestRun = [];
  let currentRun = [moves[0]];

  for (let i = 1; i < moves.length; i++) {
    const prev = moves[i - 1];
    const curr = moves[i];
    const dt = curr.timestamp - prev.timestamp;
    const dx = curr.x - prev.x;
    const dy = curr.y - prev.y;
    const stepDist = Math.hypot(dx, dy);

    // Each step must be between minStepSize and maxStepSize, with consistent interval
    const isStepSizeMatch = stepDist >= cfg.minStepSize && stepDist <= cfg.maxStepSize;
    const isIntervalMatch = dt >= cfg.minIntervalMs && dt <= cfg.maxIntervalMs;
    // Step must be primarily horizontal (|dy| <= 4) or vertical (|dx| <= 4)
    const isOrthogonal = (Math.abs(dx) >= cfg.minStepSize && Math.abs(dy) <= 4) ||
                         (Math.abs(dy) >= cfg.minStepSize && Math.abs(dx) <= 4);

    if (isStepSizeMatch && isIntervalMatch && isOrthogonal) {
      currentRun.push(curr);
    } else {
      if (currentRun.length > bestRun.length) {
        bestRun = currentRun;
      }
      currentRun = [curr];
    }
  }
  if (currentRun.length > bestRun.length) {
    bestRun = currentRun;
  }

  if (bestRun.length < cfg.minSteps) return null;

  // Check recency
  const latestMove = bestRun[bestRun.length - 1];
  if (now - latestMove.timestamp > cfg.maxRecencyMs) return null;

  // Check bounded small area
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const m of bestRun) {
    if (m.x < minX) minX = m.x;
    if (m.x > maxX) maxX = m.x;
    if (m.y < minY) minY = m.y;
    if (m.y > maxY) maxY = m.y;
  }
  const width = maxX - minX;
  const height = maxY - minY;

  if (width > cfg.maxAreaWidth || height > cfg.maxAreaHeight) return null;

  // Verify oscillation across orthogonal axes
  let horizontalSteps = 0;
  let verticalSteps = 0;
  for (let i = 1; i < bestRun.length; i++) {
    const dx = Math.abs(bestRun[i].x - bestRun[i - 1].x);
    const dy = Math.abs(bestRun[i].y - bestRun[i - 1].y);
    if (dx >= cfg.minStepSize && dy <= 4) horizontalSteps++;
    if (dy >= cfg.minStepSize && dx <= 4) verticalSteps++;
  }

  // Must have both horizontal and vertical steps over the cycles
  if (horizontalSteps >= 3 && verticalSteps >= 3) {
    return {
      pattern: PATTERNS.MOUSE_VIBRATION,
      details: {
        observedSteps: bestRun.length,
        boundingBox: { width, height },
        horizontalSteps,
        verticalSteps
      }
    };
  }

  return null;
}

/**
 * Detect Pattern C: Back-and-Forth Movement (~150px horizontal oscillation, ~0.5s duration)
 * @param {Object} events - Raw events container { mouse, keyboard, ... } or mouse array
 * @param {number} now - Reference timestamp
 * @param {Object} [customCfg] - Optional threshold overrides
 */
function detectBackAndForth(events, now = Date.now(), customCfg = {}) {
  const cfg = { ...defaultPatternConfig.backAndForth, ...customCfg };
  const mouseEvents = Array.isArray(events) ? events : (events && events.mouse ? events.mouse : []);
  const cutoff = now - (cfg.maxRecencyMs * 2);

  const moves = mouseEvents.filter(e => e.type === 'mousemove' && e.timestamp >= cutoff);
  if (moves.length < 2) return null;

  // Extract directional horizontal sweeps from mouse movement points.
  // Handles both continuous streams (many events per sweep) and sampled endpoints.
  const sweeps = [];
  let sweepStart = moves[0];
  let prevMove = moves[0];
  let currentDirection = 0; // +1 = right, -1 = left

  for (let i = 1; i < moves.length; i++) {
    const curr = moves[i];
    const dx = curr.x - prevMove.x;
    const dt = curr.timestamp - prevMove.timestamp;

    // Check direction of movement
    const dir = dx > 0 ? 1 : (dx < 0 ? -1 : currentDirection);

    // If direction reversed or large pause between points, close current sweep
    const isDirectionReversal = (currentDirection !== 0 && dir !== 0 && dir !== currentDirection);
    const isPause = dt > 350;

    if (isDirectionReversal || isPause) {
      const sweepDx = prevMove.x - sweepStart.x;
      const sweepDy = prevMove.y - sweepStart.y;
      const sweepDuration = prevMove.timestamp - sweepStart.timestamp;

      if (Math.abs(sweepDx) >= (cfg.targetDistancePx - cfg.distanceTolerancePx) &&
          Math.abs(sweepDx) <= (cfg.targetDistancePx + cfg.distanceTolerancePx) &&
          Math.abs(sweepDy) <= cfg.maxVerticalDriftPx) {
        sweeps.push({
          dx: sweepDx,
          dy: sweepDy,
          duration: sweepDuration > 0 ? sweepDuration : (prevMove.timestamp - sweepStart.timestamp),
          startTime: sweepStart.timestamp,
          endTime: prevMove.timestamp,
          startX: sweepStart.x,
          endX: prevMove.x
        });
      }

      // Next sweep starts at the turnaround peak (prevMove)
      sweepStart = prevMove;
      currentDirection = dir;
    } else {
      if (currentDirection === 0 && dx !== 0) {
        currentDirection = dir;
      }
    }
    prevMove = curr;
  }

  // Check last sweep
  if (prevMove && sweepStart && prevMove !== sweepStart) {
    const sweepDx = prevMove.x - sweepStart.x;
    const sweepDy = prevMove.y - sweepStart.y;
    const sweepDuration = prevMove.timestamp - sweepStart.timestamp;

    if (Math.abs(sweepDx) >= (cfg.targetDistancePx - cfg.distanceTolerancePx) &&
        Math.abs(sweepDx) <= (cfg.targetDistancePx + cfg.distanceTolerancePx) &&
        Math.abs(sweepDy) <= cfg.maxVerticalDriftPx) {
      sweeps.push({
        dx: sweepDx,
        dy: sweepDy,
        duration: sweepDuration,
        startTime: sweepStart.timestamp,
        endTime: prevMove.timestamp,
        startX: sweepStart.x,
        endX: prevMove.x
      });
    }
  }

  if (sweeps.length < cfg.minSweeps) return null;

  // Check for consecutive alternating sweeps
  let bestRun = [];
  let currentRun = [sweeps[0]];

  for (let i = 1; i < sweeps.length; i++) {
    const prev = sweeps[i - 1];
    const curr = sweeps[i];

    const isAlternating = (curr.dx > 0 && prev.dx < 0) || (curr.dx < 0 && prev.dx > 0);
    const isDurationMatch = curr.duration >= cfg.minDurationMs && curr.duration <= cfg.maxDurationMs;

    if (isAlternating && isDurationMatch) {
      currentRun.push(curr);
    } else {
      if (currentRun.length > bestRun.length) {
        bestRun = currentRun;
      }
      currentRun = [curr];
    }
  }
  if (currentRun.length > bestRun.length) {
    bestRun = currentRun;
  }

  if (bestRun.length < cfg.minSweeps) return null;

  // Recency check
  const latestSweep = bestRun[bestRun.length - 1];
  if (now - latestSweep.endTime > cfg.maxRecencyMs) return null;

  // Consistency checks: stdDev of durations
  const durations = bestRun.map(s => s.duration);
  const avgDuration = durations.reduce((a, b) => a + b, 0) / durations.length;
  const durationVariance = durations.reduce((sum, d) => sum + Math.pow(d - avgDuration, 2), 0) / durations.length;
  const durationStdDev = Math.sqrt(durationVariance);

  if (durationStdDev <= cfg.maxDurationStdDevMs) {
    return {
      pattern: PATTERNS.BACK_AND_FORTH,
      details: {
        observedSweeps: bestRun.length,
        avgDurationMs: Math.round(avgDuration),
        durationStdDevMs: Math.round(durationStdDev * 10) / 10,
        avgDisplacementPx: Math.round(bestRun.reduce((sum, s) => sum + Math.abs(s.dx), 0) / bestRun.length)
      }
    };
  }

  return null;
}

/**
 * Detect Pattern D: Random Movement (multi-indicator verified automated traversal)
 * PyAutoGUI executes moveTo(x, y, duration=0.2..0.8) with linear tweening followed by sleep(0.1..0.5).
 * IMPORTANT: Multiple independent indicators required:
 *   1. Straight-line legs with near-zero curvature during movement.
 *   2. Stationary pauses between legs matching 0.1s - 0.5s range.
 *   3. Zero user interaction (no clicks, scrolls, or keystrokes).
 *   4. Wide bounding box / non-trivial screen coverage.
 *   5. Sustained consecutive legs (>= 5 legs).
 * @param {Object} events - Raw events container { mouse, keyboard, system }
 * @param {number} now - Reference timestamp
 * @param {Object} [customCfg] - Optional threshold overrides
 */
function detectRandomMovement(events, now = Date.now(), customCfg = {}) {
  const cfg = { ...defaultPatternConfig.randomMovement, ...customCfg };
  const mouseEvents = Array.isArray(events) ? events : (events && events.mouse ? events.mouse : []);
  const keyboardEvents = events && events.keyboard ? events.keyboard : [];
  const cutoff = now - (cfg.maxRecencyMs * 2);

  // Indicator 1: Strict absence of human interaction (clicks, scrolls, typing)
  const clicks = mouseEvents.filter(e => e.type === 'click' && e.timestamp >= cutoff);
  const wheels = mouseEvents.filter(e => e.type === 'wheel' && e.timestamp >= cutoff);
  const keydowns = keyboardEvents.filter(e => e.type === 'keydown' && e.timestamp >= cutoff);

  if (clicks.length > 0 || wheels.length > 0 || keydowns.length > 0) {
    return null; // Human typing or clicking present -> do not flag
  }

  const moves = mouseEvents.filter(e => e.type === 'mousemove' && e.timestamp >= cutoff);
  if (moves.length < 5) return null;

  // Segment moves into legs separated by stationary pauses >= minPauseMs
  const legs = [];
  let currentLegStart = moves[0];
  let currentLegPoints = [moves[0]];

  for (let i = 1; i < moves.length; i++) {
    const prev = moves[i - 1];
    const curr = moves[i];
    const dt = curr.timestamp - prev.timestamp;

    if (dt >= cfg.minPauseMs) {
      // Pause detected: if we accumulated points, close leg at prev
      if (currentLegPoints.length > 1) {
        const legDuration = prev.timestamp - currentLegStart.timestamp;
        const legDist = Math.hypot(prev.x - currentLegStart.x, prev.y - currentLegStart.y);

        if (legDist >= cfg.minLegDistancePx &&
            legDuration >= cfg.minDurationMs &&
            legDuration <= cfg.maxDurationMs) {
          legs.push({
            start: currentLegStart,
            end: prev,
            duration: legDuration,
            distance: legDist,
            pauseAfter: dt,
            points: [...currentLegPoints]
          });
        }
      }

      currentLegStart = prev;
      currentLegPoints = [prev, curr];
    } else {
      currentLegPoints.push(curr);
    }
  }

  // Check last accumulated leg
  if (currentLegPoints.length > 1) {
    const last = currentLegPoints[currentLegPoints.length - 1];
    const legDuration = last.timestamp - currentLegStart.timestamp;
    const legDist = Math.hypot(last.x - currentLegStart.x, last.y - currentLegStart.y);

    if (legDist >= cfg.minLegDistancePx &&
        legDuration >= cfg.minDurationMs &&
        legDuration <= cfg.maxDurationMs) {
      legs.push({
        start: currentLegStart,
        end: last,
        duration: legDuration,
        distance: legDist,
        pauseAfter: 0,
        points: [...currentLegPoints]
      });
    }
  }

  if (legs.length < cfg.minLegs) return null;

  // Check recency
  const latestLeg = legs[legs.length - 1];
  if (now - latestLeg.end.timestamp > cfg.maxRecencyMs) return null;

  // Indicator 2: Path linearity / low curvature across legs
  let totalCurvatureSum = 0;
  let curvatureEvaluated = 0;

  for (const leg of legs) {
    const pts = leg.points;
    if (pts.length >= 3) {
      let angleSum = 0;
      let angleCount = 0;
      for (let j = 2; j < pts.length; j++) {
        const p1 = pts[j - 2];
        const p2 = pts[j - 1];
        const p3 = pts[j];

        const dx1 = p2.x - p1.x;
        const dy1 = p2.y - p1.y;
        const dx2 = p3.x - p2.x;
        const dy2 = p3.y - p2.y;

        const l1 = Math.hypot(dx1, dy1);
        const l2 = Math.hypot(dx2, dy2);

        if (l1 > 1.0 && l2 > 1.0) {
          const dot = dx1 * dx2 + dy1 * dy2;
          const cosTheta = Math.max(-1, Math.min(1, dot / (l1 * l2)));
          angleSum += Math.acos(cosTheta);
          angleCount++;
        }
      }
      if (angleCount > 0) {
        totalCurvatureSum += (angleSum / angleCount);
        curvatureEvaluated++;
      }
    }
  }

  // If intermediate points were evaluated, average curvature must be very low (< 0.05 rad)
  if (curvatureEvaluated > 0) {
    const avgCurvature = totalCurvatureSum / curvatureEvaluated;
    if (avgCurvature > cfg.maxCurvature) {
      return null; // Natural human curvature detected
    }
  }

  // Indicator 3: Pause timing within script range (80ms - 650ms)
  const pauses = legs.slice(0, legs.length - 1).map(l => l.pauseAfter);
  const matchingPauses = pauses.filter(p => p >= 80 && p <= cfg.maxPauseMs).length;
  if (pauses.length > 0 && (matchingPauses / pauses.length) < 0.75) {
    return null;
  }

  // Indicator 4: Non-trivial screen coverage (bounding box > 150px)
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const leg of legs) {
    for (const p of [leg.start, leg.end]) {
      if (p.x < minX) minX = p.x;
      if (p.x > maxX) maxX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.y > maxY) maxY = p.y;
    }
  }
  const spanX = maxX - minX;
  const spanY = maxY - minY;
  if (spanX < 100 && spanY < 100) {
    return null; // Clustered movements do not qualify as random screen traversal
  }

  return {
    pattern: PATTERNS.RANDOM_MOVEMENT,
    details: {
      observedLegs: legs.length,
      avgLegDistancePx: Math.round(legs.reduce((sum, l) => sum + l.distance, 0) / legs.length),
      avgLegDurationMs: Math.round(legs.reduce((sum, l) => sum + l.duration, 0) / legs.length),
      span: { spanX, spanY }
    }
  };
}

/**
 * Master dispatcher: evaluates rolling events against all 4 mouse automation patterns.
 * Priority order:
 *  1. Periodic Clicks
 *  2. Mouse Vibration
 *  3. Back-and-Forth Movement
 *  4. Random Movement
 *
 * @param {Object} events - Raw events from queue
 * @param {number} now - Target timestamp
 * @param {Object} [options] - Custom pattern overrides
 * @returns {Object|null} Result with pattern string and details, or null if no pattern detected
 */
function detectMousePatterns(events, now = Date.now(), options = {}) {
  if (!events) return null;

  // 1. Pattern A: Periodic Clicks
  const clicksResult = detectPeriodicClicks(events, now, options.periodicClicks);
  if (clicksResult) return clicksResult;

  // 2. Pattern B: Small Vibration Movement
  const vibrationResult = detectMouseVibration(events, now, options.vibration);
  if (vibrationResult) return vibrationResult;

  // 3. Pattern C: Back-and-Forth Movement
  const bnfResult = detectBackAndForth(events, now, options.backAndForth);
  if (bnfResult) return bnfResult;

  // 4. Pattern D: Random Movement (multi-indicator confirmed)
  const randomResult = detectRandomMovement(events, now, options.randomMovement);
  if (randomResult) return randomResult;

  return null;
}

module.exports = {
  PATTERNS,
  detectPeriodicClicks,
  detectMouseVibration,
  detectBackAndForth,
  detectRandomMovement,
  detectMousePatterns
};
