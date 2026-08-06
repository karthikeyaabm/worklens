/**
 * scratch/verify_anti_afk.js
 *
 * Automated verification test suite for the modular Anti-AFK Behavior Analysis Engine.
 * It mocks Date.now to fast-forward time and test all features, scores, overrides, and classifications.
 */

const assert = require('assert');
const path = require('path');

// 1. Setup global time mocking
let fakeTime = 1700000000000; // Arbitrary starting timestamp
const originalDateNow = Date.now;
Date.now = () => fakeTime;

const detector = require('../anti-afk/antiAfkDetector');

function resetState() {
  detector.clear();
}

function runTest(name, fn) {
  resetState();
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

// ==========================================
// TEST CASES
// ==========================================

runTest('Normal Human Typing and Interaction', () => {
  // Simulate natural keypresses with different keycodes and variable intervals
  const keys = [30, 48, 46, 32, 18, 33, 34]; // Different keys
  for (let i = 0; i < keys.length; i++) {
    detector.recordKeyDown(keys[i]);
    fakeTime += 80 + Math.random() * 120; // 80-200ms holds
    detector.recordKeyUp(keys[i]);
    fakeTime += 100 + Math.random() * 300; // 100-400ms typing intervals
  }

  // Simulate mouse moves with curvature
  detector.recordMouseMove(100, 100);
  fakeTime += 50;
  detector.recordMouseMove(105, 103);
  fakeTime += 50;
  detector.recordMouseMove(115, 110); // Angle shifts (natural curvature)
  fakeTime += 50;
  detector.recordMouseClick(1, 115, 110);

  const result = detector.evaluateActivity();
  console.log('Result Score:', result.score, 'Status:', result.status, 'Suspicious:', result.isSuspicious);
  
  assert.ok(result.score <= 30, `Human score should be low, got ${result.score}`);
  assert.strictEqual(result.status, 'Human');
  assert.strictEqual(result.isSuspicious, false);
});

runTest('Automation: Repeated Same Key at Regular Intervals', () => {
  // Simulate an auto-clicker typing the same key (keycode 65) at exactly 500ms intervals
  for (let i = 0; i < 15; i++) {
    detector.recordKeyDown(65);
    fakeTime += 50;
    detector.recordKeyUp(65);
    fakeTime += 450; // Total 500ms cycle
  }

  const result = detector.evaluateActivity();
  console.log('Result Score:', result.score, 'Status:', result.status, 'Reasons:', result.reasons);

  // Should flag sameKeyRatio, lowEntropy, and constantInterval (25 + 15 + 20 = 60 weight)
  // Let's verify indicators are flagged
  assert.ok(result.score >= 60, `Score should reflect weights, got ${result.score}`);
  assert.ok(result.reasons.some(r => r.includes('same key')), 'Should report same key reason');
  assert.ok(result.reasons.some(r => r.includes('entropy')), 'Should report low entropy reason');
  assert.ok(result.reasons.some(r => r.includes('typing interval')), 'Should report constant interval reason');
});

runTest('Automation: Long Key Hold Duration', () => {
  // Press key 65
  detector.recordKeyDown(65);
  // Fast forward 35 seconds
  fakeTime += 35 * 1000;

  const result = detector.evaluateActivity();
  console.log('Result Score:', result.score, 'Status:', result.status, 'Reasons:', result.reasons);

  // Key hold of 30+ seconds should flag longKeyHold (+30) and directly trigger suspicious/automation
  assert.ok(result.score >= 30, `Score should be at least modifier weight, got ${result.score}`);
  assert.strictEqual(result.isSuspicious, true, 'Long key hold must trigger suspicion');
  assert.ok(result.reasons.some(r => r.includes('held down continuously')), 'Should report held key reason');
});

runTest('Automation: Low Frequency Typing Detection', () => {
  // Simulate typing the same key once every 15 seconds. (In 60 seconds, that's 4 keys)
  // This verifies we don't require 10 keystrokes to evaluate repetition
  for (let i = 0; i < 4; i++) {
    detector.recordKeyDown(70);
    fakeTime += 100;
    detector.recordKeyUp(70);
    fakeTime += 14900; // 15 second cycles
  }

  const result = detector.evaluateActivity();
  console.log('Result Score:', result.score, 'Status:', result.status, 'Reasons:', result.reasons);

  // Low frequency with identical intervals and keys should trigger sameKeyRatio and constantInterval
  assert.ok(result.score >= 45, `Low frequency score should flag key anomalies, got ${result.score}`);
});

runTest('Automation: Ping Pong Window Switching Without Interaction', () => {
  // Focus switches A -> B -> A -> B -> A -> B
  const apps = ['chrome.exe', 'vscode.exe', 'chrome.exe', 'vscode.exe', 'chrome.exe', 'vscode.exe'];
  for (let i = 0; i < apps.length; i++) {
    detector.recordWindowChange(apps[i], 'Window Title');
    fakeTime += 5000; // Switch every 5 seconds
  }

  const result = detector.evaluateActivity();
  console.log('Result Score:', result.score, 'Status:', result.status, 'Reasons:', result.reasons);

  // Ping pong switches without keys or clicks should flag pingPongSwitch (+15) and windowSwitchWithoutInteraction (+20) = 35 score
  assert.ok(result.score >= 35, `Should flag switches without interaction, got ${result.score}`);
  assert.ok(result.reasons.some(r => r.includes('Ping-pong')), 'Should report ping pong switching');
  assert.ok(result.reasons.some(r => r.includes('without any corresponding user interaction')), 'Should report switch without interaction');
});

runTest('Developer Natural Switching (Ping Pong Override)', () => {
  // Focus switches A -> B -> A -> B -> A -> B but with natural typing inside them
  const apps = ['chrome.exe', 'vscode.exe', 'chrome.exe', 'vscode.exe', 'chrome.exe', 'vscode.exe'];
  for (let i = 0; i < apps.length; i++) {
    detector.recordWindowChange(apps[i], 'Window Title');
    const holdTime = 50 + Math.floor(Math.random() * 50);
    fakeTime += holdTime;
    
    // Simulate user typing a key
    detector.recordKeyDown(40 + i);
    fakeTime += 100;
    detector.recordKeyUp(40 + i);
    
    const intervalTime = 4000 + Math.floor(Math.random() * 1000);
    fakeTime += intervalTime;
  }

  const result = detector.evaluateActivity();
  console.log('Result Score:', result.score, 'Status:', result.status, 'Reasons:', result.reasons);

  // Developer switches between windows and works. Score should remain below threshold (and ping pong weight bypassed).
  assert.ok(result.score <= 30, `Developer switches should bypass ping pong weights, got score ${result.score}`);
  assert.strictEqual(result.status, 'Human');
});

runTest('Automation: Software-initiated Window Focus Switches', () => {
  // Focus switches but zero hardware keyboard/mouse activity is recorded
  detector.recordWindowChange('chrome.exe', 'Outlook');
  fakeTime += 1000;
  detector.recordWindowChange('vscode.exe', 'WorkLens');
  fakeTime += 1000;

  const result = detector.evaluateActivity();
  console.log('Result Score:', result.score, 'Status:', result.status, 'Reasons:', result.reasons);

  // Focus switches without clicks or keystrokes should trigger softwareWindowSwitch (+80) -> suspicious/Likely Automation
  assert.ok(result.score >= 80, `Should trigger softwareWindowSwitch weight, got score ${result.score}`);
  assert.strictEqual(result.isSuspicious, true);
  assert.ok(result.reasons.some(r => r.includes('Software-initiated window focus switch')), 'Should report software window switch reason');
});

runTest('Automation: AHK Alt+Tab and 1-pixel Mouse Jiggler', () => {
  // Simulate the KeepAwake function: Alt+Tab and 2 1-pixel mouse moves
  detector.recordWindowChange('firefox.exe', 'OrangeScape');
  fakeTime += 100;
  
  // 1-pixel wiggle right and left
  detector.recordMouseMove(100, 100);
  fakeTime += 50;
  detector.recordMouseMove(101, 100); // 1 pixel distance
  fakeTime += 100;
  detector.recordMouseMove(100, 100); // 1 pixel distance
  fakeTime += 50;
  
  // Alt+Tab key events
  detector.recordKeyDown(56); // Alt
  fakeTime += 50;
  detector.recordKeyDown(15); // Tab
  fakeTime += 50;
  detector.recordKeyUp(15);
  fakeTime += 50;
  detector.recordKeyUp(56);
  fakeTime += 58000; // Almost 60s total

  const result = detector.evaluateActivity();
  console.log('Result Score:', result.score, 'Status:', result.status, 'Reasons:', result.reasons);

  // Should trigger:
  // - noMouseMovement (+10) since distance is 2 (< 15)
  // - windowSwitchWithoutInteraction (+20) since contentKeys is 0, click/scroll is 0, distance is 2 (< 15)
  // - softwareWindowSwitch (+80) since focus switch happened with no genuine interaction
  // Total score = 100 (Likely Automation)
  assert.ok(result.score >= 80, `AHK bypass should be caught, got score ${result.score}`);
  assert.strictEqual(result.isSuspicious, true);
  assert.ok(result.reasons.some(r => r.includes('Software-initiated window focus switch')), 'Should flag software focus switch');
});

runTest('Recovery Logic: Natural mouse click / different key', () => {
  // Trigger long hold block
  detector.recordKeyDown(65);
  fakeTime += 35 * 1000;
  let result = detector.evaluateActivity();
  assert.strictEqual(result.isSuspicious, true);

  // Release and type a DIFFERENT key naturally
  detector.recordKeyUp(65);
  fakeTime += 100;
  detector.recordKeyDown(66); // Different key!
  fakeTime += 100;
  detector.recordKeyUp(66);

  result = detector.evaluateActivity();
  console.log('Result Score after different key:', result.score, 'Suspicious:', result.isSuspicious);

  // suspicion should be cleared instantly upon different keypress
  assert.strictEqual(result.isSuspicious, false, 'Pressing a different key should recover');
});

console.log('\n==========================================');
console.log('All tests completed successfully!');
console.log('==========================================');

// Restore original Date.now
Date.now = originalDateNow;
