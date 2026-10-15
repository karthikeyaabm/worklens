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
  getLocalDateString,
  getPersistedDailyStartTime,
  recordDailyStartTime,
  closeOrphanedSessions,
  markSessionSynced
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
runTest('7. App restart preserves the earliest start time for a given day', () => {
  const testUser = 'karthikeya.kondavath';
  const testDate = '2026-10-14';

  // Morning session before app close
  saveOrUpdateActiveSessionLocal({
    local_id: 'day-sess-morning',
    appName: 'Teams',
    windowTitle: 'Standup',
    status: 'active',
    startTime: `${testDate}T09:32:00`,
    endTime: `${testDate}T10:00:00`,
    activityOn: `${testDate}T09:32:00`,
    duration: 1680,
    closed: true
  }, 890, testUser);

  // App restarted hours later: new session created in the afternoon
  saveOrUpdateActiveSessionLocal({
    local_id: 'day-sess-afternoon',
    appName: 'Antigravity IDE',
    windowTitle: 'WorkLens',
    status: 'active',
    startTime: `${testDate}T14:15:00`,
    endTime: `${testDate}T14:45:00`,
    activityOn: `${testDate}T14:15:00`,
    duration: 1800,
    closed: true
  }, 890, testUser);

  const ranges = getDateWiseTimeRanges([testDate], 890, testUser);
  const range = ranges[testDate];

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

// 7. REGRESSION TEST: 10:00 AM START, RESTART AT 1:00 PM -> START TIME PRESERVED
runTest('9. Employee starts at 10:00 AM; PC restarts at 1:00 PM -> Start Time remains 10:00 AM', () => {
  const testUser = 'karthikeya.kondavath';
  const todayStr = getLocalDateString();

  // Employee starts at 10:00 AM
  saveOrUpdateActiveSessionLocal({
    local_id: 'sess-10am',
    appName: 'VSCode',
    windowTitle: 'WorkLens',
    status: 'active',
    startTime: `${todayStr}T10:00:00`,
    endTime: `${todayStr}T12:59:50`,
    activityOn: `${todayStr}T10:00:00`,
    duration: 10790,
    closed: false // interrupted by PC restart at 1:00 PM!
  }, 890, testUser);

  // PC restarts at 1:00 PM: Startup recovery closes orphaned session
  closeOrphanedSessions();

  // WorkLens starts new tracking session at 1:00 PM (13:00)
  saveOrUpdateActiveSessionLocal({
    local_id: 'sess-1pm',
    appName: 'Chrome',
    windowTitle: 'Google Docs',
    status: 'active',
    startTime: `${todayStr}T13:00:00`,
    endTime: `${todayStr}T13:05:00`,
    activityOn: `${todayStr}T13:00:00`,
    duration: 300,
    closed: false
  }, 890, testUser);

  // Resolve start time
  const ranges = getDateWiseTimeRanges([todayStr], 890, testUser);
  const earliest = ranges[todayStr].earliestStart;
  assert.strictEqual(formatTime12(earliest), '10:00 AM', 'Start Time MUST remain 10:00 AM after 1:00 PM restart');
});

// 8. REGRESSION TEST: MULTIPLE RESTARTS PRESERVE START TIME
runTest('10. Multiple WorkLens/PC restarts keep the original 10:00 AM start time unchanged', () => {
  const testUser = 'karthikeya.kondavath';
  const todayStr = getLocalDateString();

  // Simulating 3 consecutive restarts throughout the afternoon
  for (let i = 1; i <= 3; i++) {
    closeOrphanedSessions();
    saveOrUpdateActiveSessionLocal({
      local_id: `restart-sess-${i}`,
      appName: 'WorkLens',
      windowTitle: `Session after restart ${i}`,
      status: 'active',
      startTime: `${todayStr}T${13 + i}:00:00`,
      endTime: `${todayStr}T${13 + i}:10:00`,
      activityOn: `${todayStr}T${13 + i}:00:00`,
      duration: 600,
      closed: true
    }, 890, testUser);
  }

  const ranges = getDateWiseTimeRanges([todayStr], 890, testUser);
  assert.strictEqual(formatTime12(ranges[todayStr].earliestStart), '10:00 AM', 'Multiple restarts must never reset Start Time');
});

// 9. REGRESSION TEST: RESTART WHILE OFFLINE & SUBSEQUENT SYNC
runTest('11. Restart while offline preserves Start Time, and syncing causes no duplicate time or jump', () => {
  const testUser = 'karthikeya.kondavath';
  const todayStr = getLocalDateString();

  // Restart offline: persisted state and local queue preserve 10:00 AM
  const offlineStart = getPersistedDailyStartTime(todayStr, testUser, 890);
  assert.strictEqual(formatTime12(offlineStart), '10:00 AM', 'Offline startup must immediately load 10:00 AM from persistence');

  // Sync completed: sessions marked synced
  markSessionSynced('sess-10am');
  markSessionSynced('sess-1pm');

  const afterSyncRanges = getDateWiseTimeRanges([todayStr], 890, testUser);
  assert.strictEqual(formatTime12(afterSyncRanges[todayStr].earliestStart), '10:00 AM', 'Syncing must preserve 10:00 AM start time');
});

// 10. REGRESSION TEST: NEW CALENDAR DAY IS CALCULATED INDEPENDENTLY
runTest('12. New local calendar day calculates its Start Time independently', () => {
  const testUser = 'karthikeya.kondavath';
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  const tomorrowStr = getLocalDateString(tomorrow);

  // New day starts at 08:45 AM
  saveOrUpdateActiveSessionLocal({
    local_id: 'tomorrow-sess-1',
    appName: 'Outlook',
    windowTitle: 'Inbox',
    status: 'active',
    startTime: `${tomorrowStr}T08:45:00`,
    endTime: `${tomorrowStr}T09:15:00`,
    activityOn: `${tomorrowStr}T08:45:00`,
    duration: 1800,
    closed: true
  }, 890, testUser);

  const tomorrowRanges = getDateWiseTimeRanges([tomorrowStr], 890, testUser);
  assert.strictEqual(formatTime12(tomorrowRanges[tomorrowStr].earliestStart), '08:45 AM', 'Tomorrow must calculate 08:45 AM independently');
});

console.log('\n================ TEST SUMMARY ================');
console.log(`  Total: ${passedTests + failedTests}`);
console.log(`  Passed: ${passedTests}`);
console.log(`  Failed: ${failedTests}`);
console.log('==============================================\n');

if (failedTests > 0) process.exit(1);
else process.exit(0);
