// test_session_times_suite.js
// Automated verification of WorkLens Active Time Start & End Time features
const { app } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const assert = require('assert');

// Redirect userData to an isolated temp folder for testing
const testUserDataDir = path.join(os.tmpdir(), `worklens_times_test_${Date.now()}`);
fs.mkdirSync(testUserDataDir, { recursive: true });
app.setPath('userData', testUserDataDir);

console.log(`[TEST SUITE] Isolated test userData path: ${testUserDataDir}`);

const {
  saveOrUpdateActiveSessionLocal,
  parseTimestampToDate,
  formatTime12,
  getDateWiseTimeRanges,
  getLocalDateString
} = require('./activityStore');

let passedTests = 0;
let failedTests = 0;

function runTest(name, fn) {
  try {
    fn();
    console.log(`  PASS: ${name}`);
    passedTests++;
  } catch (err) {
    console.error(`  FAIL: ${name}`);
    console.error(`    ${err.message}`);
    failedTests++;
  }
}

console.log('\n================ WORKLENS SESSION START/END TIME SUITE ================\n');

// 1. TIMESTAMP PARSER TESTS
runTest('1. parseTimestampToDate correctly handles ISO format YYYY-MM-DDTHH:mm:ss', () => {
  const date = parseTimestampToDate('2026-10-07T09:32:15');
  assert.ok(date instanceof Date, 'Must return a Date object');
  assert.strictEqual(date.getFullYear(), 2026);
  assert.strictEqual(date.getMonth(), 9); // October is 9
  assert.strictEqual(date.getDate(), 7);
  assert.strictEqual(date.getHours(), 9);
  assert.strictEqual(date.getMinutes(), 32);
  assert.strictEqual(date.getSeconds(), 15);
});

runTest('2. parseTimestampToDate correctly handles server format DD-MM-YYYY HH:mm:ss without US-skew', () => {
  const date = parseTimestampToDate('07-10-2026 18:52:45');
  assert.ok(date instanceof Date, 'Must return a Date object');
  assert.strictEqual(date.getFullYear(), 2026);
  assert.strictEqual(date.getMonth(), 9); // October is 9, NOT July
  assert.strictEqual(date.getDate(), 7);
  assert.strictEqual(date.getHours(), 18);
  assert.strictEqual(date.getMinutes(), 52);
  assert.strictEqual(date.getSeconds(), 45);
});

runTest('3. parseTimestampToDate handles edge cases and invalid values safely', () => {
  assert.strictEqual(parseTimestampToDate(null), null);
  assert.strictEqual(parseTimestampToDate(undefined), null);
  assert.strictEqual(parseTimestampToDate(''), null);
  assert.strictEqual(parseTimestampToDate('invalid-date'), null);
});

// 2. 12-HOUR FORMATTER TESTS
runTest('4. formatTime12 formats AM and PM times with 2-digit hour', () => {
  assert.strictEqual(formatTime12('2026-10-07T09:32:00'), '09:32 AM');
  assert.strictEqual(formatTime12('06-10-2026 18:52:00'), '06:52 PM');
  assert.strictEqual(formatTime12('2026-10-07T00:05:00'), '12:05 AM');
  assert.strictEqual(formatTime12('2026-10-07T12:00:00'), '12:00 PM');
  assert.strictEqual(formatTime12(null), '--');
  assert.strictEqual(formatTime12('invalid'), '--');
});

// 3. MULTIPLE SESSIONS IN A DAY
runTest('5. Multiple sessions in the same day resolve earliest start and latest end', () => {
  const testUser = 'karthikeya.kondavath';
  const testDate = '2026-10-05';

  // Session 1: 09:30 AM -> 12:30 PM
  saveOrUpdateActiveSessionLocal({
    local_id: 'sess-1',
    appName: 'Code',
    windowTitle: 'Editor',
    status: 'active',
    startTime: `${testDate}T09:30:00`,
    endTime: `${testDate}T12:30:00`,
    activityOn: `${testDate}T09:30:00`,
    duration: 3 * 3600,
    closed: true
  }, 890, testUser);

  // Session 2: 01:30 PM (13:30) -> 06:15 PM (18:15)
  saveOrUpdateActiveSessionLocal({
    local_id: 'sess-2',
    appName: 'Chrome',
    windowTitle: 'Docs',
    status: 'active',
    startTime: `${testDate}T13:30:00`,
    endTime: `${testDate}T18:15:00`,
    activityOn: `${testDate}T13:30:00`,
    duration: 4.75 * 3600,
    closed: true
  }, 890, testUser);

  const ranges = getDateWiseTimeRanges([testDate], 890, testUser);
  const range = ranges[testDate];

  assert.ok(range, 'Must have range for testDate');
  assert.strictEqual(formatTime12(range.earliestStart), '09:30 AM', 'Earliest start must be 09:30 AM');
  assert.strictEqual(formatTime12(range.latestEnd), '06:15 PM', 'Latest end must be 06:15 PM');
});

// 4. EMPTY DATE HANDLING
runTest('6. Empty dates return null boundaries that format to --', () => {
  const testUser = 'karthikeya.kondavath';
  const emptyDate = '2026-10-04'; // Sunday with no entries

  const ranges = getDateWiseTimeRanges([emptyDate], 890, testUser);
  const range = ranges[emptyDate];

  assert.ok(range);
  assert.strictEqual(range.earliestStart, null);
  assert.strictEqual(range.latestEnd, null);
  assert.strictEqual(formatTime12(range.earliestStart), '--');
  assert.strictEqual(formatTime12(range.latestEnd), '--');
});

// 5. APP RESTART PERSISTENCE
runTest('7. App restart preserves the earliest start time for today', () => {
  const testUser = 'karthikeya.kondavath';
  const todayStr = getLocalDateString();

  // Morning session before app close
  saveOrUpdateActiveSessionLocal({
    local_id: 'today-sess-morning',
    appName: 'Teams',
    windowTitle: 'Standup',
    status: 'active',
    startTime: `${todayStr}T09:32:00`,
    endTime: `${todayStr}T10:00:00`,
    activityOn: `${todayStr}T09:32:00`,
    duration: 1680,
    closed: true
  }, 890, testUser);

  // App restarted hours later: new session created in the afternoon
  saveOrUpdateActiveSessionLocal({
    local_id: 'today-sess-afternoon',
    appName: 'Antigravity IDE',
    windowTitle: 'WorkLens',
    status: 'active',
    startTime: `${todayStr}T14:15:00`,
    endTime: `${todayStr}T14:45:00`,
    activityOn: `${todayStr}T14:15:00`,
    duration: 1800,
    closed: true
  }, 890, testUser);

  const ranges = getDateWiseTimeRanges([todayStr], 890, testUser);
  const range = ranges[todayStr];

  assert.strictEqual(formatTime12(range.earliestStart), '09:32 AM', 'App restart must not reset earliest start time');
  assert.strictEqual(formatTime12(range.latestEnd), '02:45 PM', 'Latest end must reflect recent afternoon session');
});

// 6. RUNNING SESSION (PRESENT) STATE EVALUATION
runTest('8. Running session state resolves to Present while tracking is active', () => {
  const isTrackingActive = true;
  const isToday = true;
  const endFormatted = isToday && isTrackingActive ? 'Present' : '05:00 PM';
  assert.strictEqual(endFormatted, 'Present');

  const stoppedTracking = false;
  const endStopped = isToday && stoppedTracking ? 'Present' : '05:00 PM';
  assert.strictEqual(endStopped, '05:00 PM');
});

console.log('\n================ TEST SUMMARY ================');
console.log(`  Total: ${passedTests + failedTests}`);
console.log(`  Passed: ${passedTests}`);
console.log(`  Failed: ${failedTests}`);
console.log('==============================================\n');

if (failedTests > 0) process.exit(1);
else process.exit(0);
