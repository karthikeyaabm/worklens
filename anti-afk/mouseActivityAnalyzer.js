/**
 * anti-afk/mouseActivityAnalyzer.js
 *
 * Second-level mouse activity analysis layer.
 * Evaluates extracted mouse features to identify potentially artificial
 * or highly repetitive mouse activity patterns.
 *
 * This module does NOT detect specific tools. It only reports behavioral
 * suspicion scores and pattern classifications.
 */

const config = require('./config');

const MICRO_MOVEMENT_FREQUENCY_THRESHOLD = config.behavior.microMovementFrequencyThreshold;
const LOW_SPEED_THRESHOLD = config.behavior.lowSpeedThreshold;
const MIN_INTERACTION_COUNT = config.behavior.minInteractionCount;
const LONG_ACTIVITY_DURATION_MS = config.behavior.longActivityDurationMs;

const SCORE_HIGH_MICRO_MOVEMENT = 25;
const SCORE_VERY_LOW_SPEED = 20;
const SCORE_NO_CLICKS = 15;
const SCORE_NO_SCROLLS = 15;
const SCORE_LONG_DURATION = 20;

const LEVEL_NORMAL = 'normal';
const LEVEL_LOW_INTERACTION = 'low_interaction';
const LEVEL_SUSPICIOUS = 'suspicious';

const LEVEL_THRESHOLD_LOW = 31;
const LEVEL_THRESHOLD_SUSPICIOUS = 61;

function safeNumber(value, fallback) {
  if (typeof value !== 'number' || Number.isNaN(value)) {
    return fallback;
  }
  return value;
}

function analyzeMouseActivity(features) {
  if (!features || typeof features !== 'object') {
    return {
      score: 0,
      level: LEVEL_NORMAL,
      reasons: []
    };
  }

  const vibrationFrequency = safeNumber(features.vibrationFrequency, 0);
  const averageSpeed = safeNumber(features.averageSpeed, 0);
  const clickCount = safeNumber(features.clickCount, 0);
  const scrollCount = safeNumber(features.scrollCount, 0);
  const durationMs = safeNumber(features.durationMs, 0);

  let score = 0;
  const reasons = [];

  if (vibrationFrequency >= MICRO_MOVEMENT_FREQUENCY_THRESHOLD) {
    score += SCORE_HIGH_MICRO_MOVEMENT;
    reasons.push('High micro-movement frequency');
  }

  if (averageSpeed < LOW_SPEED_THRESHOLD) {
    score += SCORE_VERY_LOW_SPEED;
    reasons.push('Very low average speed');
  }

  if (clickCount < MIN_INTERACTION_COUNT) {
    score += SCORE_NO_CLICKS;
    reasons.push('No clicks detected');
  }

  if (scrollCount < MIN_INTERACTION_COUNT) {
    score += SCORE_NO_SCROLLS;
    reasons.push('No scroll activity');
  }

  if (durationMs > LONG_ACTIVITY_DURATION_MS) {
    score += SCORE_LONG_DURATION;
    reasons.push('Long repetitive low-interaction activity');
  }

  score = Math.min(100, score);

  let level;
  if (score >= LEVEL_THRESHOLD_SUSPICIOUS) {
    level = LEVEL_SUSPICIOUS;
  } else if (score >= LEVEL_THRESHOLD_LOW) {
    level = LEVEL_LOW_INTERACTION;
  } else {
    level = LEVEL_NORMAL;
  }

  return {
    score,
    level,
    reasons
  };
}

module.exports = { analyzeMouseActivity };
