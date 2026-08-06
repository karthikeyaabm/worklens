/**
 * anti-afk/windowFeatures.js
 *
 * Feature extractor for window focus events.
 * Analyzes active application focus transitions and detects patterns such as ping-pong loops.
 */

const config = require('./config');

/**
 * Extracts window features from events in the current rolling window.
 * @param {Array} windowEvents
 * @param {number} cutoff - Timestamp cutoff (ms)
 * @param {number} now - Current timestamp (ms)
 * @param {Object} lastWindowFocus - Current active window tracking state
 */
function extractWindowFeatures(windowEvents, cutoff, now, lastWindowFocus) {
  const events = windowEvents.filter(e => e.timestamp >= cutoff);
  const allEvents = [...events];

  // If there is an active window focused, synthesize a focus event for the remaining duration
  if (lastWindowFocus) {
    const duration = now - lastWindowFocus.timestamp;
    allEvents.push({
      type: 'windowFocusChanged',
      applicationName: lastWindowFocus.appName,
      windowTitle: lastWindowFocus.windowTitle,
      timestamp: lastWindowFocus.timestamp,
      focusedDuration: duration
    });
  }

  const windowSwitchCount = allEvents.length;
  const uniqueWindows = new Set(allEvents.map(e => `${e.applicationName}::${e.windowTitle}`));
  const uniqueWindowCount = uniqueWindows.size;

  let averageWindowStay = 0;
  let longestWindowStay = 0;
  let shortestWindowStay = Infinity;
  let totalStay = 0;

  allEvents.forEach(e => {
    const staySec = e.focusedDuration / 1000;
    totalStay += staySec;
    if (staySec > longestWindowStay) {
      longestWindowStay = staySec;
    }
    if (staySec < shortestWindowStay) {
      shortestWindowStay = staySec;
    }
  });

  if (windowSwitchCount > 0) {
    averageWindowStay = totalStay / windowSwitchCount;
  }
  if (shortestWindowStay === Infinity) {
    shortestWindowStay = 0;
  }

  // Transition frequency (switches/minute)
  const windowSeconds = config.rollingWindowSeconds;
  const transitionFrequency = windowSwitchCount / (windowSeconds / 60);

  // Ping-pong ratio detection (A -> B -> A -> B app focus switches)
  let pingPongRatio = 0;
  if (allEvents.length >= 3) {
    let pingPongSwitches = 0;
    for (let i = 2; i < allEvents.length; i++) {
      const currentApp = allEvents[i].applicationName;
      const oneBackApp = allEvents[i - 1].applicationName;
      const twoBackApp = allEvents[i - 2].applicationName;

      // Check for A-B-A pattern where A != B
      if (currentApp === twoBackApp && currentApp !== oneBackApp) {
        pingPongSwitches++;
      }
    }
    pingPongRatio = pingPongSwitches / (allEvents.length - 2);
  }

  const windowSequencePattern = allEvents.map(e => e.applicationName);

  return {
    windowSwitchCount,
    uniqueWindowCount,
    averageWindowStay,
    longestWindowStay,
    shortestWindowStay,
    pingPongRatio,
    transitionFrequency,
    windowSequencePattern
  };
}

module.exports = { extractWindowFeatures };
