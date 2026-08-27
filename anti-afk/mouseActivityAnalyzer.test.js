/**
 * anti-afk/mouseActivityAnalyzer.test.js
 *
 * Unit tests for the mouse activity analysis layer.
 */

const assert = require('assert');
const { analyzeMouseActivity } = require('./mouseActivityAnalyzer');

const LEVEL_THRESHOLD_LOW = 31;
const LEVEL_THRESHOLD_SUSPICIOUS = 61;

function runTest(name, fn) {
  console.log(`\n--- Running Test: ${name} ---`);
  try {
    fn();
    console.log(`[PASS] ${name}`);
  } catch (err) {
    console.error(`[FAIL] ${name}`);
    console.error(err);
    process.exit(1);
  }
}

runTest('Normal human-like activity', () => {
  const features = {
    movementDistance: 500,
    averageSpeed: 200,
    clickCount: 5,
    scrollCount: 3,
    movementCurvature: 0.5,
    idleGap: 2,
    vibrationFrequency: 2,
    durationMs: 30000
  };

  const result = analyzeMouseActivity(features);

  assert.strictEqual(result.level, 'normal');
  assert.ok(result.score <= 30, `Score should be low for normal activity, got ${result.score}`);
  assert.ok(Array.isArray(result.reasons));
});

runTest('High micro-movement frequency', () => {
  const features = {
    movementDistance: 50,
    averageSpeed: 150,
    clickCount: 2,
    scrollCount: 1,
    movementCurvature: 0.1,
    idleGap: 1,
    vibrationFrequency: 20,
    durationMs: 30000
  };

  const result = analyzeMouseActivity(features);

  assert.ok(result.score >= 25, `Score should reflect high micro-movement, got ${result.score}`);
  assert.ok(result.reasons.some(r => r.includes('High micro-movement frequency')));
});

runTest('Low speed with no clicks or scrolls', () => {
  const features = {
    movementDistance: 10,
    averageSpeed: 5,
    clickCount: 0,
    scrollCount: 0,
    movementCurvature: 0.01,
    idleGap: 5,
    vibrationFrequency: 3,
    durationMs: 45000
  };

  const result = analyzeMouseActivity(features);

  assert.ok(result.score >= 45, `Score should be elevated for low-interaction low-speed activity, got ${result.score}`);
  assert.ok(result.reasons.some(r => r.includes('Very low average speed')));
  assert.ok(result.reasons.some(r => r.includes('No clicks detected')));
  assert.ok(result.reasons.some(r => r.includes('No scroll activity')));
});

runTest('Long repetitive low-interaction activity', () => {
  const features = {
    movementDistance: 30,
    averageSpeed: 10,
    clickCount: 0,
    scrollCount: 0,
    movementCurvature: 0.02,
    idleGap: 1,
    vibrationFrequency: 8,
    durationMs: 120000
  };

  const result = analyzeMouseActivity(features);

  assert.ok(result.score >= 50, `Score should be elevated for long low-interaction activity, got ${result.score}`);
  assert.ok(result.reasons.some(r => r.includes('Long repetitive low-interaction activity')));
});

runTest('Empty event data (null features)', () => {
  const result = analyzeMouseActivity(null);

  assert.strictEqual(result.score, 0);
  assert.strictEqual(result.level, 'normal');
  assert.deepStrictEqual(result.reasons, []);
});

runTest('Invalid or zero duration', () => {
  const features = {
    movementDistance: 100,
    averageSpeed: 50,
    clickCount: 2,
    scrollCount: 1,
    movementCurvature: 0.3,
    idleGap: 0.5,
    vibrationFrequency: 0,
    durationMs: 0
  };

  const result = analyzeMouseActivity(features);

  assert.strictEqual(result.level, 'normal');
  assert.ok(!result.reasons.some(r => r.includes('Long repetitive')));
});

runTest('Suspicious combination: high micro-movement, low speed, no clicks, no scrolls, long duration', () => {
  const features = {
    movementDistance: 40,
    averageSpeed: 8,
    clickCount: 0,
    scrollCount: 0,
    movementCurvature: 0.01,
    idleGap: 0.5,
    vibrationFrequency: 18,
    durationMs: 150000
  };

  const result = analyzeMouseActivity(features);

  assert.ok(result.score >= LEVEL_THRESHOLD_SUSPICIOUS, `Score should be suspicious, got ${result.score}`);
  assert.strictEqual(result.level, 'suspicious');
});

runTest('Low interaction classification', () => {
  const features = {
    movementDistance: 80,
    averageSpeed: 15,
    clickCount: 0,
    scrollCount: 0,
    movementCurvature: 0.05,
    idleGap: 3,
    vibrationFrequency: 5,
    durationMs: 40000
  };

  const result = analyzeMouseActivity(features);

  assert.ok(result.score >= LEVEL_THRESHOLD_LOW, `Score should be at least low_interaction, got ${result.score}`);
  assert.ok(result.score < LEVEL_THRESHOLD_SUSPICIOUS, `Score should be below suspicious, got ${result.score}`);
  assert.strictEqual(result.level, 'low_interaction');
});

runTest('Missing feature fields', () => {
  const features = {};

  const result = analyzeMouseActivity(features);

  assert.ok(result.score >= 0, `Score should be non-negative, got ${result.score}`);
  assert.ok(result.level === 'low_interaction' || result.level === 'normal', `Level should be normal or low_interaction, got ${result.level}`);
  assert.ok(Array.isArray(result.reasons));
});

console.log('\n==========================================');
console.log('All mouse activity analyzer tests completed!');
console.log('==========================================');
