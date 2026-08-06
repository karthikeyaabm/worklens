/**
 * anti-afk/behaviorAnalyzer.js
 *
 * Behavior analysis engine.
 * Evaluates extracted metrics against behavioral thresholds to trigger anomaly indicators.
 */

const config = require('./config');

/**
 * Evaluates features and flags suspicious behavior indicators.
 * @param {Object} metrics - Computed behavioral features
 * @param {Object} rawEvents - Raw events from queue
 */
function analyzeBehavior(metrics, rawEvents) {
  const indicators = {};
  const reasons = [];

  const kb = metrics.keyboard;
  const ms = metrics.mouse;
  const win = metrics.window;
  const idl = metrics.idle;

  // Compute click interval variance
  let clickIntervalStdDev = Infinity;
  const clickEvents = rawEvents ? rawEvents.mouse.filter(e => e.type === 'click') : [];
  if (clickEvents.length >= 3) {
    const intervals = [];
    let sum = 0;
    for (let i = 1; i < clickEvents.length; i++) {
      const diff = clickEvents[i].timestamp - clickEvents[i - 1].timestamp;
      intervals.push(diff);
      sum += diff;
    }
    const avg = sum / intervals.length;
    let varSum = 0;
    intervals.forEach(val => {
      varSum += Math.pow(val - avg, 2);
    });
    clickIntervalStdDev = Math.sqrt(varSum / intervals.length);
  }

  // 1. Repeated Same Key (same key ratio exceeds threshold)
  // Evaluated if there are at least 2 keyboard keypress events (low-frequency support)
  indicators.sameKeyRatio = kb.totalKeys >= 2 && kb.sameKeyRatio >= config.behavior.sameKeyThreshold;
  if (indicators.sameKeyRatio) {
    reasons.push(`Repeated same key: ${Math.round(kb.sameKeyRatio * 100)}% of keystrokes were the same key.`);
  }

  // 2. Low Typing Entropy ( Shannon entropy < threshold )
  indicators.lowEntropy = kb.totalKeys >= 2 && kb.typingEntropy < config.behavior.lowEntropyThreshold;
  if (indicators.lowEntropy) {
    reasons.push(`Low typing entropy (${kb.typingEntropy.toFixed(2)}): input shows highly predictable repeating key patterns.`);
  }

  // 3. Constant Typing Interval (standard deviation of intervals below threshold)
  indicators.constantInterval = kb.totalKeys >= 3 && kb.intervalStdDeviation < config.behavior.constantIntervalStdDevThreshold;
  if (indicators.constantInterval) {
    reasons.push(`Constant typing interval (std dev ${Math.round(kb.intervalStdDeviation)}ms): keystroke timing is too regular.`);
  }

  // 4. Periodic Mouse Clicks (very low interval standard deviation between clicks)
  indicators.periodicClicks = clickEvents.length >= 3 && clickIntervalStdDev < config.behavior.periodicClicksIntervalStdDevThreshold;
  if (indicators.periodicClicks) {
    reasons.push(`Periodic mouse clicks (std dev ${Math.round(clickIntervalStdDev)}ms): click triggers are highly periodic.`);
  }

  // 5. Repeated Mouse Movement (straight paths without natural human curvature)
  const mouseMoves = rawEvents ? rawEvents.mouse.filter(e => e.type === 'mousemove') : [];
  indicators.noMouseMovement = ms.clickCount === 0 && ms.scrollCount === 0 && ms.movementDistance < 15;

  // A movement is marked as straight line if there are multiple mousemoves and curvature (average angle change) is extremely low
  const isStraightLineMove = mouseMoves.length >= 5 && ms.movementDistance > 20 && ms.movementCurvature < 0.02;
  indicators.repeatedMouseMovement = isStraightLineMove;
  if (indicators.repeatedMouseMovement) {
    reasons.push('Artificial mouse movement: straight-line paths detected without natural human curvature.');
  }

  // 6. Window Switch Without Interaction
  // Window focus switches occur, but keyboard or mouse inputs are absent
  const hasWindowSwitches = win.windowSwitchCount >= 1;
  const hasNoInteraction = kb.contentKeys === 0 && ms.clickCount === 0 && ms.scrollCount === 0 && ms.movementDistance < 15;
  indicators.windowSwitchWithoutInteraction = hasWindowSwitches && hasNoInteraction;
  if (indicators.windowSwitchWithoutInteraction) {
    reasons.push('Window focus switches occurred without any corresponding user interaction inside windows.');
  }

  // 7. Ping Pong Window Pattern (switching back and forth between A <-> B apps)
  indicators.pingPongSwitch = win.windowSwitchCount >= config.behavior.pingPongCountThreshold &&
                              win.pingPongRatio >= config.behavior.pingPongRatioThreshold;
  if (indicators.pingPongSwitch) {
    reasons.push(`Ping-pong window switching: switching back and forth between windows (${Math.round(win.pingPongRatio * 100)}% ratio).`);
  }

  // 8. Very Regular Timing (general timing predictability)
  indicators.veryRegularTiming = indicators.constantInterval || indicators.periodicClicks;

  // 9. Long Modifier Key Hold (Shift, Ctrl, Alt, Win held continuously)
  indicators.longKeyHold = kb.keyHoldDuration >= config.behavior.keyHoldThresholdSeconds;
  if (indicators.longKeyHold) {
    reasons.push(`Modifier key held down continuously for ${Math.round(kb.keyHoldDuration)} seconds.`);
  }

  // 10. Artificial Idle Recovery (waking from sleep/lock and immediately doing automated-like window focus switches)
  const systemEvents = rawEvents ? rawEvents.system.filter(e => e.timestamp >= (Date.now() - 10000)) : [];
  const hasRecentWake = systemEvents.some(e => e.type === 'unlock' || e.type === 'resume');
  indicators.artificialIdleRecovery = hasRecentWake && hasNoInteraction && win.windowSwitchCount >= 1;
  if (indicators.artificialIdleRecovery) {
    reasons.push('Workstation recovered from idle state but immediately showed window switching without interaction.');
  }

  // 11. Software-initiated Window Switch (focus switch without physical keyboard/mouse input)
  indicators.softwareWindowSwitch = win.windowSwitchCount >= 1 && hasNoInteraction;
  if (indicators.softwareWindowSwitch) {
    reasons.push('Software-initiated window focus switch: window focus changed without any physical keyboard or mouse input.');
  }

  return {
    indicators,
    reasons
  };
}

module.exports = { analyzeBehavior };
