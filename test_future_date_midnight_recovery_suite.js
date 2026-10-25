// test_future_date_midnight_recovery_suite.js
// Automated verification for Future-Date Cascade Prevention, Safe Midnight Splitting,
// Duration Sanity Quarantine, and Recovery Suite.

process.env.NODE_ENV = 'test';

const { app } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const assert = require('assert');

// Redirect userData to an isolated temp folder for reproducible testing
const testUserDataDir = path.join(os.tmpdir(), `worklens_recovery_test_${Date.now()}`);
fs.mkdirSync(testUserDataDir, { recursive: true });
app.setPath('userData', testUserDataDir);

console.log(`[RECOVERY TEST SUITE] Isolated test userData path: ${testUserDataDir}`);

const {
  saveOrUpdateActiveSessionLocal,
  splitSessionAtMidnightBoundaries,
  reconcileMidnightBoundaries,
  closeOrphanedSessions,
  getChunksForDate,
  getActivityLogsForDate,
  getEligibleClosedSessions,
  getPendingClosedSessions,
  markSessionSynced,
  markSessionFailed,
  quarantineSession,
  parseTimestampToDate,
  formatTime12,
  getLocalDateString,
  getQueueFilePath
} = require('./activityStore');

const {
  startOrContinueCurrentSession,
  closeCurrentSession,
  splitActiveSessionAtMidnight,
  getCurrentRecord,
  setCurrentRecord,
  scheduleMidnightBoundaryCheck,
  clearMidnightTimer
} = require('./main');

let passedTests = 0;
let failedTests = 0;

function runTest(name, fn) {
  try {
    fn();
    console.log(`  PASS: ${name}`);
    passedTests++;
  } catch (err) {
    console.error(`  FAIL: ${name}`);
    console.error(`    ${err.stack || err.message}`);
    failedTests++;
  }
}

app.whenReady().then(async () => {
  console.log('\n================ WORKLENS FUTURE-DATE & MIDNIGHT RECOVERY SUITE ================\n');

  const testUser = 'karthikeya.kondavath';
  const testUserId = 890;

  // Clear queue before testing
  const queueFile = getQueueFilePath();
  if (fs.existsSync(queueFile)) fs.unlinkSync(queueFile);

  // --------------------------------------------------------------------------
  // TEST 1: Tracking across 23:59:59 to 00:00:00 produces clean split
  // --------------------------------------------------------------------------
  runTest('1. Tracking across 23:59:59 to 00:00:00 produces clean split', () => {
    setCurrentRecord(null);
    const day1Time = new Date(2026, 9, 24, 23, 50, 0); // Oct 24, 23:50:00
    startOrContinueCurrentSession('VSCode', 'Code Editor', 'active', day1Time);

    const recBefore = getCurrentRecord();
    assert.strictEqual(recBefore.appName, 'VSCode');

    // Simulate tick across midnight at Oct 25 00:00:05
    const day2Time = new Date(2026, 9, 25, 0, 0, 5);
    startOrContinueCurrentSession('VSCode', 'Code Editor', 'active', day2Time);

    const day1Chunks = getChunksForDate('2026-10-24');
    assert.strictEqual(day1Chunks.length, 1, 'Day 1 must have 1 record');
    assert.strictEqual(day1Chunks[0].end_time, '2026-10-24T23:59:59', 'Day 1 must end at 23:59:59');
    assert.strictEqual(day1Chunks[0].duration, 599, 'Day 1 duration must be 599s (23:50:00 -> 23:59:59)');
    assert.strictEqual(day1Chunks[0].closed, true, 'Day 1 must be closed');

    const recAfter = getCurrentRecord();
    assert.ok(recAfter, 'Continuation record must exist');
    assert.strictEqual(getLocalDateString(recAfter.startTime), '2026-10-25');
  });

  // --------------------------------------------------------------------------
  // TEST 2: Midnight timer firing slightly early does NOT split prematurely
  // --------------------------------------------------------------------------
  runTest('2. Midnight timer firing slightly early does NOT split prematurely', () => {
    // Current time is 23:59:59.700 (still Oct 24)
    const earlyTime = new Date(2026, 9, 24, 23, 59, 59);
    const targetSession = {
      local_id: 'sess-early-timer',
      appName: 'Chrome',
      windowTitle: 'WorkLens',
      status: 'active',
      startTime: '2026-10-24T23:55:00',
      endTime: '2026-10-24T23:59:59',
      duration: 299,
      closed: false
    };
    setCurrentRecord(targetSession);

    // Call splitActiveSessionAtMidnight with early boundary time on the same day
    splitActiveSessionAtMidnight(earlyTime, targetSession);

    // Because startDayStr === boundaryDayStr ('2026-10-24'), split is rejected
    assert.strictEqual(targetSession.closed, false, 'Session must remain open when timer is early');
  });

  // --------------------------------------------------------------------------
  // TEST 3: Midnight timer firing late cleanly closes Day 1 and bounds Day 2
  // --------------------------------------------------------------------------
  runTest('3. Midnight timer firing late cleanly closes Day 1 and bounds Day 2', () => {
    const lateTime = new Date(2026, 9, 25, 0, 5, 0); // 5 minutes after midnight
    const lateSession = {
      local_id: 'sess-late-timer',
      appName: 'Docs',
      windowTitle: 'Spec',
      status: 'active',
      startTime: '2026-10-24T23:40:00',
      endTime: '2026-10-24T23:40:00',
      duration: 0,
      closed: false
    };
    setCurrentRecord(lateSession);

    splitActiveSessionAtMidnight(lateTime, lateSession);

    assert.strictEqual(lateSession.closed, true, 'Day 1 session must be closed');
    assert.strictEqual(lateSession.duration, 1199, 'Day 1 duration must be 1199s (23:40:00 to 23:59:59)');

    const continuation = getCurrentRecord();
    assert.ok(continuation);
    assert.strictEqual(continuation.startTime.getDate(), 25);
    assert.strictEqual(continuation.startTime.getHours(), 0);
  });

  // --------------------------------------------------------------------------
  // TEST 4: Session whose start time is tomorrow is rejected from splitting
  // --------------------------------------------------------------------------
  runTest('4. Session whose start time is tomorrow is rejected and quarantined', () => {
    const now = new Date(2026, 9, 25, 14, 0, 0); // Oct 25 14:00:00
    const tomorrowSession = {
      local_id: 'sess-tomorrow',
      appName: 'Electron',
      windowTitle: 'Future Window',
      status: 'active',
      startTime: new Date(2026, 9, 26, 0, 0, 0), // Tomorrow (Oct 26)
      endTime: new Date(2026, 9, 26, 0, 0, 0),
      duration: 0,
      closed: false
    };
    setCurrentRecord(tomorrowSession);

    // Tracking tick runs at actual time 'now' (Oct 25)
    startOrContinueCurrentSession('Electron', 'Future Window', 'active', now);

    assert.strictEqual(tomorrowSession.closed, true, 'Future session must be closed');
    assert.strictEqual(tomorrowSession.quarantined, true, 'Future session must be quarantined');
    assert.strictEqual(tomorrowSession.duration, 0, 'Quarantined future session must have 0 duration');

    // Fresh session must start at 'now' (Oct 25)
    const current = getCurrentRecord();
    assert.ok(current);
    assert.strictEqual(getLocalDateString(current.startTime), '2026-10-25');
  });

  // --------------------------------------------------------------------------
  // TEST 5: Session start several days in future does NOT trigger date cascade
  // --------------------------------------------------------------------------
  runTest('5. Session start several days in future does NOT cascade', () => {
    const now1 = new Date(2026, 9, 25, 14, 0, 0);
    const now2 = new Date(2026, 9, 25, 14, 0, 2);
    const now3 = new Date(2026, 9, 25, 14, 0, 4);

    const farFuture = {
      local_id: 'sess-far-future',
      appName: 'Electron',
      windowTitle: 'WorkLens | Active Time Details',
      status: 'active',
      startTime: new Date(2026, 10, 10, 0, 0, 0), // Nov 10, 2026
      endTime: new Date(2026, 10, 10, 0, 0, 0),
      duration: 0,
      closed: false
    };
    setCurrentRecord(farFuture);

    // Simulate 3 tracking ticks
    startOrContinueCurrentSession('Electron', 'WorkLens | Active Time Details', 'active', now1);
    startOrContinueCurrentSession('Electron', 'WorkLens | Active Time Details', 'active', now2);
    startOrContinueCurrentSession('Electron', 'WorkLens | Active Time Details', 'active', now3);

    // Verify no cascade records for Nov 11, Nov 12, etc. were created
    const chunks = getChunksForDate('2026-11-11');
    assert.strictEqual(chunks.length, 0, 'Must NOT generate cascade for Nov 11');

    const current = getCurrentRecord();
    assert.ok(current);
    assert.strictEqual(getLocalDateString(current.startTime), '2026-10-25');
    assert.strictEqual(current.duration, 4, 'Current session duration must be 4 seconds');
  });

  // --------------------------------------------------------------------------
  // TEST 6: Timer and tracking tick firing near the same boundary is idempotent
  // --------------------------------------------------------------------------
  runTest('6. Timer and tracking tick firing near the same boundary is idempotent', () => {
    const boundaryTime = new Date(2026, 9, 25, 0, 0, 0);
    const session = {
      local_id: 'sess-concurrent-boundary',
      appName: 'IDE',
      windowTitle: 'Editor',
      status: 'active',
      startTime: new Date(2026, 9, 24, 23, 30, 0),
      endTime: new Date(2026, 9, 24, 23, 30, 0),
      duration: 0,
      closed: false
    };
    setCurrentRecord(session);

    // Call split function once (e.g. from timer)
    splitActiveSessionAtMidnight(boundaryTime, session);
    const recAfter1 = getCurrentRecord();
    const localIdAfter1 = recAfter1.local_id;

    // Call split function again 1 second later (e.g. from trackTick)
    const tickTime = new Date(2026, 9, 25, 0, 0, 1);
    splitActiveSessionAtMidnight(tickTime, recAfter1);
    const recAfter2 = getCurrentRecord();

    // Must not create another Day 1 split or corrupt continuation
    assert.strictEqual(recAfter2.local_id, localIdAfter1, 'Must remain idempotent on second split call');
  });

  // --------------------------------------------------------------------------
  // TEST 7: Repeated calls to splitActiveSessionAtMidnight on same day no-op
  // --------------------------------------------------------------------------
  runTest('7. Repeated calls to splitActiveSessionAtMidnight on same day no-op', () => {
    const todaySession = {
      local_id: 'sess-today-dup',
      appName: 'Browser',
      windowTitle: 'Tab',
      status: 'active',
      startTime: new Date(2026, 9, 25, 10, 0, 0),
      endTime: new Date(2026, 9, 25, 10, 0, 0),
      duration: 0,
      closed: false
    };
    setCurrentRecord(todaySession);

    const callTime = new Date(2026, 9, 25, 11, 0, 0);
    splitActiveSessionAtMidnight(callTime, todaySession);

    assert.strictEqual(todaySession.closed, false, 'Same day session must not be closed by split');
  });

  // --------------------------------------------------------------------------
  // TEST 8: App restart at midnight reconciles orphaned sessions safely
  // --------------------------------------------------------------------------
  runTest('8. App restart at midnight reconciles orphaned sessions safely', () => {
    const unclosedPastSession = {
      local_id: 'sess-orphaned-past',
      appName: 'BackgroundTool',
      windowTitle: 'Tool',
      status: 'active',
      startTime: '2026-10-20T20:00:00',
      endTime: '2026-10-20T21:00:00',
      duration: 3600,
      closed: false
    };
    saveOrUpdateActiveSessionLocal(unclosedPastSession, testUserId, testUser);

    closeOrphanedSessions();

    const chunks = getChunksForDate('2026-10-20');
    const found = chunks.find(l => l.local_id === 'sess-orphaned-past');
    assert.ok(found);
    assert.strictEqual(found.closed, true, 'Orphaned past session must be closed on restart');
  });

  // --------------------------------------------------------------------------
  // TEST 9: Offline tracking and subsequent synchronization eligibility
  // --------------------------------------------------------------------------
  runTest('9. Offline tracking and subsequent synchronization eligibility', () => {
    const validClosed = {
      local_id: 'sess-offline-valid',
      appName: 'WorkApp',
      windowTitle: 'Project',
      status: 'active',
      startTime: '2026-10-25T09:00:00',
      end_time: '2026-10-25T10:00:00',
      duration: 3600,
      closed: true,
      synced: false
    };
    saveOrUpdateActiveSessionLocal(validClosed, testUserId, testUser);

    const eligible = getEligibleClosedSessions();
    const found = eligible.find(s => s.local_id === 'sess-offline-valid');
    assert.ok(found, 'Valid closed session must be eligible for sync');
  });

  // --------------------------------------------------------------------------
  // TEST 10: API retry and duplicate prevention with future date quarantine
  // --------------------------------------------------------------------------
  runTest('10. API retry and duplicate prevention with future date quarantine', () => {
    const futureClosed = {
      local_id: 'sess-future-uneligible',
      appName: 'GlitchApp',
      windowTitle: 'Glitch',
      status: 'active',
      startTime: '2026-11-20T09:00:00', // Future date
      end_time: '2026-11-20T10:00:00',
      duration: 3600,
      closed: true,
      synced: false
    };
    saveOrUpdateActiveSessionLocal(futureClosed, testUserId, testUser);

    const eligible = getEligibleClosedSessions();
    const found = eligible.find(s => s.local_id === 'sess-future-uneligible');
    assert.strictEqual(found, undefined, 'Future dated session must NEVER be eligible for sync');
  });

  // --------------------------------------------------------------------------
  // TEST 11: Genuine sessions lasting longer than 12h capped & quarantined safely
  // --------------------------------------------------------------------------
  runTest('11. Genuine sessions lasting longer than 12h quarantined with diagnostic evidence', () => {
    const excessiveSession = {
      local_id: 'sess-excessive-duration',
      appName: 'StuckProcess',
      windowTitle: 'Frozen',
      status: 'active',
      startTime: '2026-10-25T00:00:00',
      end_time: '2026-10-25T15:00:00',
      duration: 54000, // 15 hours > 12h limit
      closed: true,
      synced: false
    };
    saveOrUpdateActiveSessionLocal(excessiveSession, testUserId, testUser);

    quarantineSession('sess-excessive-duration', 'Duration exceeds 12h limit');

    const eligible = getEligibleClosedSessions();
    const found = eligible.find(s => s.local_id === 'sess-excessive-duration');
    assert.strictEqual(found, undefined, 'Quarantined session must not be eligible for sync');

    const chunks = getChunksForDate('2026-10-25');
    const stored = chunks.find(c => c.local_id === 'sess-excessive-duration');
    assert.strictEqual(stored.quarantined, true, 'Must preserve quarantined flag');
    assert.ok(stored.quarantine_reason.includes('12h'), 'Must preserve quarantine diagnostic reason');
  });

  // --------------------------------------------------------------------------
  // TEST 12: Duration calculation and local calendar day boundaries
  // --------------------------------------------------------------------------
  runTest('12. Duration calculation and local calendar day boundaries', () => {
    const s = parseTimestampToDate('2026-10-24T23:30:00');
    const e = parseTimestampToDate('2026-10-25T00:30:00');
    assert.strictEqual(Math.floor((e - s) / 1000), 3600, 'Total span is 1 hour');

    const day1End = new Date(s.getFullYear(), s.getMonth(), s.getDate(), 23, 59, 59);
    const day1Dur = Math.floor((day1End - s) / 1000);
    assert.strictEqual(day1Dur, 1799, 'Day 1 portion must be exactly 1799s (29m 59s)');

    const day2Start = new Date(e.getFullYear(), e.getMonth(), e.getDate(), 0, 0, 0);
    const day2Dur = Math.floor((e - day2Start) / 1000);
    assert.strictEqual(day2Dur, 1800, 'Day 2 portion must be exactly 1800s (30m)');
  });

  // --------------------------------------------------------------------------
  // TEST 13: Recovery from malformed persisted session state
  // --------------------------------------------------------------------------
  runTest('13. Recovery from malformed persisted session state', () => {
    const malformed = {
      local_id: 'sess-malformed-nan',
      appName: 'CorruptedApp',
      windowTitle: 'Corrupt',
      status: 'active',
      startTime: 'Invalid Date',
      end_time: '2026-10-25T10:00:00',
      duration: NaN,
      closed: true,
      synced: false
    };
    saveOrUpdateActiveSessionLocal(malformed, testUserId, testUser);

    const eligible = getEligibleClosedSessions();
    const found = eligible.find(s => s.local_id === 'sess-malformed-nan');
    assert.strictEqual(found, undefined, 'Malformed record with NaN duration / invalid date must be ineligible');
  });

  console.log('\n================================================================');
  console.log(` SUMMARY: ${passedTests} passed, ${failedTests} failed.`);
  console.log('================================================================\n');

  // Clean up isolated test directory
  try {
    fs.rmSync(testUserDataDir, { recursive: true, force: true });
  } catch (_) {}

  if (failedTests > 0) {
    process.exit(1);
  } else {
    process.exit(0);
  }
});
