/**
 * anti-afk/config.js
 *
 * Configuration settings, scoring weights, feature thresholds,
 * and decision classifications for the WorkLens behavior analysis engine.
 */

module.exports = {
  // Global settings
  rollingWindowSeconds: 300, // Size of the rolling event buffer
  evaluationWindowSeconds: 60, // Size of the window used to evaluate behavior features
  historySize: 200,         // Maximum keyboard events in buffer
  scoreThreshold: 70,       // Suspicion score threshold to flag fake activity
  loggingEnabled: true,     // Enable structured debug logging

  // Confidence Score Weights (Phase 4)
  weights: {
    sameKeyRatio: 25,
    lowEntropy: 15,
    constantInterval: 20,
    periodicClicks: 15,
    pingPongSwitch: 15,
    noMouseMovement: 10,
    longKeyHold: 30,
    windowSwitchWithoutInteraction: 20,
    softwareWindowSwitch: 80
  },

  // Feature Extraction and Behavioral thresholds
  behavior: {
    sameKeyThreshold: 0.95,                 // Single key dominates >= 95% of keyboard input
    keyHoldThresholdSeconds: 30,            // Duration in seconds to flag a key hold
    lowEntropyThreshold: 1.0,               // Shannon entropy threshold for repeating patterns
    constantIntervalStdDevThreshold: 15,    // Key interval standard deviation (ms) below which timing is considered automated
    periodicClicksIntervalStdDevThreshold: 20, // Mouse click interval standard deviation (ms)
    pingPongCountThreshold: 3,              // Number of window focus switches required to evaluate ping-pong pattern
    pingPongRatioThreshold: 0.75,           // Ratio of A-B-A-B switching to total switches
    mouseIdleThresholdSeconds: 60           // Duration without mouse movement to flag as idle
  },

  // Decision Classification Levels (Phase 5)
  decisionLevels: [
    { min: 0, max: 30, label: 'Human' },
    { min: 31, max: 60, label: 'Watch' },
    { min: 61, max: 80, label: 'Suspicious' },
    { min: 81, max: 100, label: 'Likely Automation' }
  ]
};
