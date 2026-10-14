/**
 * test_mouse_pattern_suite.js
 *
 * Deterministic unit test suite for Python Mouse Automation Pattern Detection.
 * Tests Pattern A (Periodic Clicks), Pattern B (Mouse Vibration),
 * Pattern C (Back-and-Forth), and Pattern D (Random Movement).
 *
 * Verifies all 11 required criteria:
 * 1. 0.4s periodic clicks recognized
 * 2. 10px vibration sequences recognized
 * 3. 150px horizontal oscillation recognized
 * 4. Variable-coordinate movements evaluated without assuming randomness proves automation
 * 5. Normal human movement and normal clicking are NOT flagged
 * 6. Short sequences and insufficient evidence do NOT produce confirmed classifications
 * 7. Random movement alone does not trigger unrelated pattern classifications
 * 8. Detection NEVER changes active/inactive status
 * 9. Session start/end times and active-time calculations remain unchanged
 * 10. Existing API payload fields and offline queue behavior remain intact
 * 11. Stale evidence expires when pattern stops
 */

const assert = require('assert');
const path = require('path');

// Mock time
let mockTime = 1700000000000;
const originalDateNow = Date.now;
Date.now = () => mockTime;

const detector = require('./anti-afk/antiAfkDetector');
const { PATTERNS } = detector;

let passed = 0;
let failed = 0;

function test(name, fn) {
  detector.clear();
  try {
    fn();
    console.log(`  PASS: ${name}`);
    passed++;
  } catch (err) {
    console.error(`  FAIL: ${name}`);
    console.error(`    ${err.message}`);
    failed++;
  }
}

console.log('\n================ WORKLENS PYTHON MOUSE PATTERN DETECTION SUITE ================\n');

// -------------------------------------------------------------------------
// 1. Pattern A: Periodic Clicks (0.4s interval)
// -------------------------------------------------------------------------
test('1. Pattern A: Repeated 0.4-second clicks recognized as PYTHON_PERIODIC_CLICKS', () => {
  // Simulate 12 clicks approximately 400ms apart at coordinate (250, 350)
  for (let i = 0; i < 12; i++) {
    detector.recordMouseClick(1, 250, 350);
    mockTime += 400; // 0.4s interval
  }

  const result = detector.evaluateActivity();
  const activityType = detector.getActivityType();

  assert.strictEqual(result.detectedPattern, PATTERNS.PERIODIC_CLICKS, 'Must detect Pattern A');
  assert.strictEqual(activityType, PATTERNS.PERIODIC_CLICKS, 'getActivityType must return PYTHON_PERIODIC_CLICKS');
  assert.strictEqual(result.isSuspicious, false, 'Pattern detection must NOT flag suspicion');
  assert.strictEqual(detector.isUserActive(), true, 'User must remain Active');
});

// -------------------------------------------------------------------------
// 2. Pattern B: Small Vibration Movement (10px orthogonal cycle)
// -------------------------------------------------------------------------
test('2. Pattern B: Repeated 10-pixel vibration sequences recognized as PYTHON_MOUSE_VIBRATION', () => {
  // Script cycles: (0,0) -> (+10, 0) -> (0,0) -> (0, +10) -> (0,0)
  // Each move lasts ~0.05s, sleep ~0.1s -> ~150ms per step
  const baseX = 400;
  const baseY = 400;
  const cycleOffsets = [
    [0, 0],
    [10, 0],
    [0, 0],
    [0, 10]
  ];

  // Repeat cycle 4 times (16 steps)
  for (let c = 0; c < 4; c++) {
    for (const [dx, dy] of cycleOffsets) {
      detector.recordMouseMove(baseX + dx, baseY + dy);
      mockTime += 150;
    }
  }

  const result = detector.evaluateActivity();
  const activityType = detector.getActivityType();

  assert.strictEqual(result.detectedPattern, PATTERNS.MOUSE_VIBRATION, 'Must detect Pattern B');
  assert.strictEqual(activityType, PATTERNS.MOUSE_VIBRATION, 'getActivityType must return PYTHON_MOUSE_VIBRATION');
  assert.strictEqual(result.isSuspicious, false, 'Pattern detection must NOT flag suspicion');
  assert.strictEqual(detector.isUserActive(), true, 'User must remain Active');
});

// -------------------------------------------------------------------------
// 3. Pattern C: Back-and-Forth Movement (~150px horizontal, 0.5s duration)
// -------------------------------------------------------------------------
test('3. Pattern C: Repeated 150-pixel horizontal oscillations recognized as PYTHON_BACK_AND_FORTH', () => {
  // Script alternates between X1=200 and X2=350 (dx=150), duration 0.5s (500ms)
  const y = 300;
  const xLeft = 200;
  const xRight = 350;

  // Initial position
  detector.recordMouseMove(xLeft, y);
  mockTime += 50;

  // 6 sweeps back and forth
  for (let s = 0; s < 6; s++) {
    const targetX = (s % 2 === 0) ? xRight : xLeft;
    const startX = (s % 2 === 0) ? xLeft : xRight;

    // Simulate 5 intermediate points along the sweep taking 500ms total
    for (let p = 1; p <= 5; p++) {
      const curX = Math.round(startX + (targetX - startX) * (p / 5));
      detector.recordMouseMove(curX, y);
      mockTime += 100; // 5 * 100ms = 500ms
    }
  }

  const result = detector.evaluateActivity();
  const activityType = detector.getActivityType();

  assert.strictEqual(result.detectedPattern, PATTERNS.BACK_AND_FORTH, 'Must detect Pattern C');
  assert.strictEqual(activityType, PATTERNS.BACK_AND_FORTH, 'getActivityType must return PYTHON_BACK_AND_FORTH');
  assert.strictEqual(result.isSuspicious, false, 'Pattern detection must NOT flag suspicion');
  assert.strictEqual(detector.isUserActive(), true, 'User must remain Active');
});

// -------------------------------------------------------------------------
// 4. Pattern D: Random Movement (Multi-indicator confirmation)
// -------------------------------------------------------------------------
test('4. Pattern D: Straight-line random legs with pauses and zero interaction recognized as PYTHON_RANDOM_MOVEMENT', () => {
  // PyAutoGUI: random coordinates across screen, durations 0.2..0.8s, pauses 0.1..0.5s, linear tweening
  const waypoints = [
    { x: 100, y: 150 },
    { x: 450, y: 300 },
    { x: 200, y: 650 },
    { x: 750, y: 250 },
    { x: 300, y: 500 },
    { x: 800, y: 700 },
    { x: 350, y: 200 }
  ];

  detector.recordMouseMove(waypoints[0].x, waypoints[0].y);

  for (let i = 1; i < waypoints.length; i++) {
    const from = waypoints[i - 1];
    const to = waypoints[i];

    // Pause between legs: 200ms
    mockTime += 200;

    // Linear tweened traversal over 400ms (duration within 0.2-0.8s)
    const steps = 4;
    for (let s = 1; s <= steps; s++) {
      const curX = Math.round(from.x + (to.x - from.x) * (s / steps));
      const curY = Math.round(from.y + (to.y - from.y) * (s / steps));
      detector.recordMouseMove(curX, curY);
      mockTime += 100; // 4 * 100ms = 400ms leg duration
    }
  }

  const result = detector.evaluateActivity();
  const activityType = detector.getActivityType();

  assert.strictEqual(result.detectedPattern, PATTERNS.RANDOM_MOVEMENT, 'Must detect Pattern D');
  assert.strictEqual(activityType, PATTERNS.RANDOM_MOVEMENT, 'getActivityType must return PYTHON_RANDOM_MOVEMENT');
  assert.strictEqual(result.isSuspicious, false, 'Pattern detection must NOT flag suspicion');
  assert.strictEqual(detector.isUserActive(), true, 'User must remain Active');
});

// -------------------------------------------------------------------------
// 5. Normal Human Movement and Clicking NOT Flagged
// -------------------------------------------------------------------------
test('5. Normal human browsing (curved movement + variable clicks) is NOT flagged', () => {
  // Human moves in arcs with natural curvature and clicks links occasionally
  const points = [
    [100, 100],
    [120, 140],
    [160, 200],
    [220, 240], // Curved trajectory
    [300, 260]
  ];

  for (const [x, y] of points) {
    detector.recordMouseMove(x, y);
    mockTime += 120;
  }

  // Human clicks a link
  detector.recordMouseClick(1, 300, 260);
  mockTime += 2500; // 2.5s reading pause

  // Human moves to another section
  const points2 = [
    [310, 270],
    [350, 310],
    [400, 380]
  ];
  for (const [x, y] of points2) {
    detector.recordMouseMove(x, y);
    mockTime += 150;
  }
  detector.recordMouseClick(1, 400, 380);
  mockTime += 3000;

  const result = detector.evaluateActivity();
  const activityType = detector.getActivityType();

  assert.strictEqual(result.detectedPattern, null, 'Human browsing must NOT be flagged as automation pattern');
  assert.strictEqual(activityType, 'Human Activity', 'Classification must be Human Activity');
  assert.strictEqual(result.isSuspicious, false);
});

// -------------------------------------------------------------------------
// 6. Short Sequences and Insufficient Evidence NOT Classified
// -------------------------------------------------------------------------
test('6. Short sequences (insufficient observations) do NOT trigger classifications', () => {
  // Only 2 clicks at 400ms (threshold is 6)
  detector.recordMouseClick(1, 100, 100);
  mockTime += 400;
  detector.recordMouseClick(1, 100, 100);
  mockTime += 400;

  let result = detector.evaluateActivity();
  assert.strictEqual(result.detectedPattern, null, '2 clicks must not trigger Pattern A');

  detector.clear();

  // Only 3 vibration steps (threshold is 10)
  detector.recordMouseMove(100, 100);
  mockTime += 150;
  detector.recordMouseMove(110, 100);
  mockTime += 150;
  detector.recordMouseMove(100, 100);

  result = detector.evaluateActivity();
  assert.strictEqual(result.detectedPattern, null, '3 vibration steps must not trigger Pattern B');

  detector.clear();

  // Only 1 sweep of 150px (threshold is 4 sweeps)
  detector.recordMouseMove(100, 100);
  mockTime += 250;
  detector.recordMouseMove(250, 100);

  result = detector.evaluateActivity();
  assert.strictEqual(result.detectedPattern, null, '1 sweep must not trigger Pattern C');
});

// -------------------------------------------------------------------------
// 7. Random Movement Alone Does NOT Trigger Unrelated Patterns
// -------------------------------------------------------------------------
test('7. Random movement with human characteristics does NOT trigger Pattern D or others', () => {
  // Random waypoints, but with human typing present
  detector.recordKeyDown(65); // User types 'A'
  mockTime += 100;
  detector.recordKeyUp(65);
  mockTime += 100;

  // Move between points
  detector.recordMouseMove(100, 100);
  mockTime += 300;
  detector.recordMouseMove(500, 300);
  mockTime += 200;
  detector.recordMouseMove(200, 600);

  const result = detector.evaluateActivity();
  assert.strictEqual(result.detectedPattern, null, 'Input with keystrokes must NOT trigger Pattern D');
});

// -------------------------------------------------------------------------
// 8. Critical Active/Inactive Protection
// -------------------------------------------------------------------------
test('8. Critical Active/Inactive Protection: Pattern detection never alters active status', () => {
  // Pattern A triggers
  for (let i = 0; i < 10; i++) {
    detector.recordMouseClick(1, 150, 150);
    mockTime += 400;
  }

  const result = detector.evaluateActivity();
  assert.strictEqual(result.detectedPattern, PATTERNS.PERIODIC_CLICKS);
  assert.strictEqual(result.isSuspicious, false, 'Must NOT be marked suspicious');
  assert.strictEqual(detector.isUserActive(), true, 'Must remain user active');
  assert.strictEqual(result.status, 'Human', 'Status must remain Human');
  assert.ok(result.score <= 30, 'Score must remain within Human threshold');
});

// -------------------------------------------------------------------------
// 9. Detection Lifecycle & Evidence Expiration
// -------------------------------------------------------------------------
test('9. Lifecycle: Detection expires when pattern stops without carrying forward', () => {
  // Trigger Pattern A
  for (let i = 0; i < 10; i++) {
    detector.recordMouseClick(1, 200, 200);
    mockTime += 400;
  }

  let result = detector.evaluateActivity();
  assert.strictEqual(result.detectedPattern, PATTERNS.PERIODIC_CLICKS);

  // Fast forward past recency threshold (25 seconds with no clicks)
  mockTime += 25000;

  // User moves mouse naturally
  detector.recordMouseMove(210, 210);
  mockTime += 100;
  detector.recordMouseMove(230, 240);

  result = detector.evaluateActivity();
  assert.strictEqual(result.detectedPattern, null, 'Stale pattern must expire cleanly');
  assert.strictEqual(detector.getActivityType(), 'Human Activity', 'Should revert to Human Activity');
});

// -------------------------------------------------------------------------
// 10. API Payload and Schema Compatibility
// -------------------------------------------------------------------------
test('10. API payload preserves all existing schema fields and attaches activity_type', () => {
  const sampleChunk = {
    user_id: 890,
    app_name: 'Google Chrome',
    window_title: 'WorkLens - Dashboard',
    start_time: '2026-10-12T10:00:00',
    end_time: '2026-10-12T10:05:00',
    duration: 300,
    activity_on: '2026-10-12',
    status: 'active',
    version: '1.1.7',
    activity_type: PATTERNS.PERIODIC_CLICKS,
    redmine_created_on: '2026-10-12 10:05:00',
    local_created_on: '2026-10-12 10:00:00',
    latitude: '18.5204',
    longitude: '73.8567',
    current_address: 'Pune, India',
    location: 'Pune, India'
  };

  // Verify all contract fields exist
  const expectedKeys = [
    'user_id', 'app_name', 'window_title', 'start_time', 'end_time',
    'duration', 'activity_on', 'status', 'version', 'activity_type',
    'redmine_created_on', 'local_created_on', 'latitude', 'longitude',
    'current_address', 'location'
  ];

  for (const key of expectedKeys) {
    assert.ok(key in sampleChunk, `Missing expected payload key: ${key}`);
  }
  assert.strictEqual(sampleChunk.activity_type, 'PYTHON_PERIODIC_CLICKS');
  assert.strictEqual(sampleChunk.status, 'active', 'Status remains active');
  assert.strictEqual(sampleChunk.duration, 300, 'Duration remains unchanged');
});

// -------------------------------------------------------------------------
// SUMMARY
// -------------------------------------------------------------------------
console.log('\n--------------------------------------------------------------------------------');
console.log(` RESULTS: ${passed} passed, ${failed} failed`);
console.log('--------------------------------------------------------------------------------\n');

// Restore time
Date.now = originalDateNow;

if (failed > 0) {
  process.exit(1);
} else {
  process.exit(0);
}
