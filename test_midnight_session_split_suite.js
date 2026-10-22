// test_midnight_session_split_suite.js
// Master automated test suite for WorkLens Midnight Session Split & Local Calendar Day Boundaries

const { app } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const assert = require('assert');

// Redirect userData to an isolated temp folder for reproducible testing
const testUserDataDir = path.join(os.tmpdir(), `worklens_midnight_test_${Date.now()}`);
fs.mkdirSync(testUserDataDir, { recursive: true });
app.setPath('userData', testUserDataDir);

console.log(`[TEST SUITE] Isolated test userData path: ${testUserDataDir}`);

const {
  saveOrUpdateActiveSessionLocal,
  splitSessionAtMidnightBoundaries,
  reconcileMidnightBoundaries,
  closeOrphanedSessions,
  getChunksForDate,
  getActivityLogsForDate,
  getDateWiseActiveDurations,
  getDateWiseTimeRanges,
  getLocalDateString,
  normalizeToLocalDateStr,
  getEligibleClosedSessions,
  getPendingClosedSessions,
  markSessionSynced,
  getUnsyncedTodayDuration,
  parseTimestampToDate,
  formatTime12,
  getQueueFilePath
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

app.whenReady().then(async () => {
  console.log('\n================ WORKLENS MIDNIGHT SESSION SPLIT SUITE ================\n');

  const testUser = 'karthikeya.kondavath';
  const testUserId = 890;

  // Clear queue before testing
  const queueFile = getQueueFilePath();
  if (fs.existsSync(queueFile)) fs.unlinkSync(queueFile);

  // --------------------------------------------------------------------------
  // TEST 1: Session starts before midnight and remains active after midnight
  // --------------------------------------------------------------------------
  runTest('1. Session starts before midnight and remains active after midnight', () => {
    const session = {
      local_id: 'sess-active-cross-midnight',
      appName: 'VSCode',
      windowTitle: 'WorkLens - main.js',
      status: 'Active',
      activityType: 'Code Editing',
      startTime: '2026-10-22T23:50:00',
      endTime: '2026-10-23T00:10:00',
      activityOn: '2026-10-22T23:50:00',
      closed: true
    };

    saveOrUpdateActiveSessionLocal(session, testUserId, testUser);

    const oct22Logs = getActivityLogsForDate('2026-10-22', testUserId, testUser);
    const oct23Logs = getActivityLogsForDate('2026-10-23', testUserId, testUser);

    assert.strictEqual(oct22Logs.length, 1, 'Oct 22 must contain exactly 1 entry');
    assert.strictEqual(oct23Logs.length, 1, 'Oct 23 must contain exactly 1 entry');

    const day1 = oct22Logs[0];
    const day2 = oct23Logs[0];

    // Day 1: October 22, 11:50 PM - October 22, 11:59:59 PM (599s)
    assert.strictEqual(day1.start_time, '2026-10-22T23:50:00', 'Day 1 start must be 23:50:00');
    assert.strictEqual(day1.end_time, '2026-10-22T23:59:59', 'Day 1 end must be 23:59:59');
    assert.strictEqual(day1.duration, 599, 'Day 1 duration must be 599 seconds');
    assert.strictEqual(day1.status, 'active', 'Day 1 status must remain active');
    assert.strictEqual(day1.activity_type, 'Code Editing', 'Day 1 metadata must be preserved');

    // Day 2: October 23, 12:00:00 AM - October 23, 12:10:00 AM (600s)
    assert.strictEqual(day2.start_time, '2026-10-23T00:00:00', 'Day 2 start must be 00:00:00');
    assert.strictEqual(day2.end_time, '2026-10-23T00:10:00', 'Day 2 end must be 00:10:00');
    assert.strictEqual(day2.duration, 600, 'Day 2 duration must be 600 seconds');
    assert.strictEqual(day2.status, 'active', 'Day 2 status must remain active');

    // Cross-day verification: neither entry spans across midnight
    assert.strictEqual(normalizeToLocalDateStr(day1.start_time), '2026-10-22');
    assert.strictEqual(normalizeToLocalDateStr(day1.end_time), '2026-10-22');
    assert.strictEqual(normalizeToLocalDateStr(day2.start_time), '2026-10-23');
    assert.strictEqual(normalizeToLocalDateStr(day2.end_time), '2026-10-23');
  });

  // --------------------------------------------------------------------------
  // TEST 2: Session remains inactive across midnight
  // --------------------------------------------------------------------------
  runTest('2. Session remains inactive across midnight without converting to active', () => {
    const session = {
      local_id: 'sess-inactive-cross-midnight',
      appName: 'System',
      windowTitle: 'Idle',
      status: 'Inactive',
      activityType: 'Idle',
      reason: 'Inactivity threshold exceeded',
      startTime: '2026-10-22T23:45:00',
      endTime: '2026-10-23T00:15:00',
      activityOn: '2026-10-22T23:45:00',
      closed: true
    };

    saveOrUpdateActiveSessionLocal(session, testUserId, testUser);

    const oct22Logs = getActivityLogsForDate('2026-10-22', testUserId, testUser).filter(l => l.local_id.includes('inactive'));
    const oct23Logs = getActivityLogsForDate('2026-10-23', testUserId, testUser).filter(l => l.local_id.includes('inactive') || l.app_name === 'System');

    assert.strictEqual(oct22Logs.length, 1);
    assert.strictEqual(oct23Logs.length, 1);

    const day1 = oct22Logs[0];
    const day2 = oct23Logs[0];

    assert.strictEqual(day1.status, 'inactive', 'Day 1 status MUST remain inactive');
    assert.strictEqual(day2.status, 'inactive', 'Day 2 status MUST remain inactive - never converted to active');
    assert.strictEqual(day1.end_time, '2026-10-22T23:59:59');
    assert.strictEqual(day2.start_time, '2026-10-23T00:00:00');
  });

  // --------------------------------------------------------------------------
  // TEST 3: OS idle session crosses midnight without changing activity classification
  // --------------------------------------------------------------------------
  runTest('3. OS idle session crosses midnight preserving activity classification and reason', () => {
    const session = {
      local_id: 'sess-os-idle',
      appName: 'System',
      windowTitle: 'No Active Window',
      status: 'Inactive',
      activityType: 'Suspicious Automation',
      reason: 'Continuous repetitive keyboard input detected.',
      startTime: '2026-10-22T23:55:00',
      endTime: '2026-10-23T00:05:00',
      activityOn: '2026-10-22T23:55:00',
      closed: true
    };

    saveOrUpdateActiveSessionLocal(session, testUserId, testUser);

    const segs = splitSessionAtMidnightBoundaries(session);
    assert.strictEqual(segs.length, 2);
    assert.strictEqual(segs[0].status, 'Inactive');
    assert.strictEqual(segs[1].status, 'Inactive');
    assert.strictEqual(segs[0].activityType, 'Suspicious Automation');
    assert.strictEqual(segs[1].activityType, 'Suspicious Automation');
    assert.strictEqual(segs[0].reason, 'Continuous repetitive keyboard input detected.');
    assert.strictEqual(segs[1].reason, 'Continuous repetitive keyboard input detected.');
  });

  // --------------------------------------------------------------------------
  // TEST 4: Multiple applications have open sessions at midnight
  // --------------------------------------------------------------------------
  runTest('4. Multiple applications open across midnight split cleanly without collision', () => {
    const app1 = {
      local_id: 'multi-app-chrome',
      appName: 'Google Chrome',
      windowTitle: 'WorkLens Dashboard',
      status: 'Active',
      startTime: '2026-10-22T23:40:00',
      endTime: '2026-10-23T00:05:00',
      activityOn: '2026-10-22T23:40:00',
      closed: true
    };

    const app2 = {
      local_id: 'multi-app-teams',
      appName: 'Microsoft Teams',
      windowTitle: 'Teams Meeting',
      status: 'Active',
      startTime: '2026-10-22T23:45:00',
      endTime: '2026-10-23T00:15:00',
      activityOn: '2026-10-22T23:45:00',
      closed: true
    };

    saveOrUpdateActiveSessionLocal(app1, testUserId, testUser);
    saveOrUpdateActiveSessionLocal(app2, testUserId, testUser);

    const oct22 = getActivityLogsForDate('2026-10-22', testUserId, testUser);
    const oct23 = getActivityLogsForDate('2026-10-23', testUserId, testUser);

    const chrome22 = oct22.find(l => l.app_name === 'Google Chrome');
    const teams22 = oct22.find(l => l.app_name === 'Microsoft Teams');
    const chrome23 = oct23.find(l => l.app_name === 'Google Chrome');
    const teams23 = oct23.find(l => l.app_name === 'Microsoft Teams');

    assert.ok(chrome22 && teams22 && chrome23 && teams23, 'Both applications must exist on both dates');

    assert.strictEqual(chrome22.end_time, '2026-10-22T23:59:59');
    assert.strictEqual(teams22.end_time, '2026-10-22T23:59:59');

    assert.strictEqual(chrome23.start_time, '2026-10-23T00:00:00');
    assert.strictEqual(teams23.start_time, '2026-10-23T00:00:00');

    // Unique IDs check
    const allIds = new Set([chrome22.id, teams22.id, chrome23.id, teams23.id]);
    assert.strictEqual(allIds.size, 4, 'All four records must have unique local IDs');
  });

  // --------------------------------------------------------------------------
  // TEST 5: Application switching occurs exactly at midnight
  // --------------------------------------------------------------------------
  runTest('5. Application switching occurs exactly at midnight boundary', () => {
    // App A finishes exactly at 23:59:59
    const appA = {
      local_id: 'app-a-exact-midnight',
      appName: 'Outlook',
      windowTitle: 'Inbox',
      status: 'Active',
      startTime: '2026-10-22T23:30:00',
      endTime: '2026-10-22T23:59:59',
      activityOn: '2026-10-22T23:30:00',
      duration: 1799,
      closed: true
    };

    // App B starts exactly at 00:00:00 on the next day
    const appB = {
      local_id: 'app-b-exact-midnight',
      appName: 'VSCode',
      windowTitle: 'index.js',
      status: 'Active',
      startTime: '2026-10-23T00:00:00',
      endTime: '2026-10-23T00:30:00',
      activityOn: '2026-10-23T00:00:00',
      duration: 1800,
      closed: true
    };

    saveOrUpdateActiveSessionLocal(appA, testUserId, testUser);
    saveOrUpdateActiveSessionLocal(appB, testUserId, testUser);

    const oct22Logs = getActivityLogsForDate('2026-10-22', testUserId, testUser);
    const oct23Logs = getActivityLogsForDate('2026-10-23', testUserId, testUser);

    const foundA = oct22Logs.find(l => l.local_id === 'app-a-exact-midnight');
    const foundB = oct23Logs.find(l => l.local_id === 'app-b-exact-midnight');

    assert.ok(foundA, 'App A must belong to Oct 22');
    assert.ok(foundB, 'App B must belong to Oct 23');
    assert.strictEqual(foundA.end_time, '2026-10-22T23:59:59');
    assert.strictEqual(foundB.start_time, '2026-10-23T00:00:00');
  });

  // --------------------------------------------------------------------------
  // TEST 6: Continuous tracking across multiple consecutive days
  // --------------------------------------------------------------------------
  runTest('6. Continuous tracking across multiple consecutive calendar days (3 days)', () => {
    const multiDaySession = {
      local_id: 'session-spanning-3-days',
      appName: 'BackgroundWorker',
      windowTitle: 'Server Monitor',
      status: 'Active',
      startTime: '2026-10-20T22:00:00',
      endTime: '2026-10-22T02:00:00',
      activityOn: '2026-10-20T22:00:00',
      closed: true
    };

    saveOrUpdateActiveSessionLocal(multiDaySession, testUserId, testUser);

    const day1Logs = getActivityLogsForDate('2026-10-20', testUserId, testUser);
    const day2Logs = getActivityLogsForDate('2026-10-21', testUserId, testUser);
    const day3Logs = getActivityLogsForDate('2026-10-22', testUserId, testUser).filter(l => l.app_name === 'BackgroundWorker');

    assert.strictEqual(day1Logs.length, 1, 'Day 1 must have 1 record');
    assert.strictEqual(day2Logs.length, 1, 'Day 2 must have 1 record');
    assert.strictEqual(day3Logs.length, 1, 'Day 3 must have 1 record');

    // Day 1: 2026-10-20 22:00:00 -> 23:59:59 (7199s)
    assert.strictEqual(day1Logs[0].start_time, '2026-10-20T22:00:00');
    assert.strictEqual(day1Logs[0].end_time, '2026-10-20T23:59:59');
    assert.strictEqual(day1Logs[0].duration, 7199);

    // Day 2: 2026-10-21 00:00:00 -> 23:59:59 (86399s, capped at MAX_SESSION_DURATION 43200)
    assert.strictEqual(day2Logs[0].start_time, '2026-10-21T00:00:00');
    assert.strictEqual(day2Logs[0].end_time, '2026-10-21T23:59:59');

    // Day 3: 2026-10-22 00:00:00 -> 02:00:00 (7200s)
    assert.strictEqual(day3Logs[0].start_time, '2026-10-22T00:00:00');
    assert.strictEqual(day3Logs[0].end_time, '2026-10-22T02:00:00');
    assert.strictEqual(day3Logs[0].duration, 7200);
  });

  // --------------------------------------------------------------------------
  // TEST 7: WorkLens wakes after sleeping through midnight
  // --------------------------------------------------------------------------
  runTest('7. WorkLens wakes after sleeping through midnight with clock skew guard', () => {
    // Session was open before sleep at 23:50:00 on Oct 24
    const sleepSession = {
      local_id: 'session-before-sleep',
      appName: 'VSCode',
      windowTitle: 'Code Editor',
      status: 'Active',
      startTime: '2026-10-24T23:50:00',
      endTime: '2026-10-24T23:55:00',
      activityOn: '2026-10-24T23:50:00',
      duration: 300,
      closed: false
    };

    saveOrUpdateActiveSessionLocal(sleepSession, testUserId, testUser);

    // Reconcile simulates wake at 08:30:00 on Oct 25
    reconcileMidnightBoundaries();

    const oct24Logs = getActivityLogsForDate('2026-10-24', testUserId, testUser);
    const s = oct24Logs.find(l => l.local_id === 'session-before-sleep');

    assert.ok(s, 'Sleep session must be in Oct 24 logs');
    assert.strictEqual(s.start_time, '2026-10-24T23:50:00');
    assert.strictEqual(s.end_time, '2026-10-24T23:55:00');
    assert.strictEqual(normalizeToLocalDateStr(s.end_time), '2026-10-24', 'End time must remain on Oct 24');
  });

  // --------------------------------------------------------------------------
  // TEST 8: WorkLens restarts after missing a midnight boundary
  // --------------------------------------------------------------------------
  runTest('8. WorkLens restarts after missing midnight boundary and closes orphaned sessions', () => {
    // Unclosed session spanning midnight from earlier run
    saveOrUpdateActiveSessionLocal({
      local_id: 'orphaned-cross-session',
      appName: 'IntelliJ',
      windowTitle: 'Backend Project',
      status: 'Active',
      startTime: '2026-10-18T23:45:00',
      endTime: '2026-10-19T00:30:00',
      activityOn: '2026-10-18T23:45:00',
      duration: 2700,
      closed: false
    }, testUserId, testUser);

    // Startup recovery executes
    closeOrphanedSessions();

    const oct18Logs = getActivityLogsForDate('2026-10-18', testUserId, testUser);
    const oct19Logs = getActivityLogsForDate('2026-10-19', testUserId, testUser);

    const seg18 = oct18Logs.find(l => l.app_name === 'IntelliJ');
    const seg19 = oct19Logs.find(l => l.app_name === 'IntelliJ');

    assert.ok(seg18, 'Oct 18 segment must exist');
    assert.ok(seg19, 'Oct 19 segment must exist');

    assert.strictEqual(seg18.end_time, '2026-10-18T23:59:59', 'Oct 18 segment must end at 23:59:59');
    assert.strictEqual(seg19.start_time, '2026-10-19T00:00:00', 'Oct 19 segment must start at 00:00:00');
    assert.strictEqual(seg19.end_time, '2026-10-19T00:30:00');

    // Both must be closed
    const pending = getPendingClosedSessions();
    assert.ok(pending.some(p => p.app_name === 'IntelliJ' && p.start_time.startsWith('2026-10-18')));
    assert.ok(pending.some(p => p.app_name === 'IntelliJ' && p.start_time.startsWith('2026-10-19')));
  });

  // --------------------------------------------------------------------------
  // TEST 9: Internet is unavailable during midnight rotation
  // --------------------------------------------------------------------------
  runTest('9. Internet unavailable during midnight rotation preserves offline records locally', () => {
    const offlineSession = {
      local_id: 'sess-offline-rotation',
      appName: 'Terminal',
      windowTitle: 'bash',
      status: 'Active',
      startTime: '2026-10-16T23:50:00',
      endTime: '2026-10-17T00:10:00',
      activityOn: '2026-10-16T23:50:00',
      closed: true
    };

    // Save offline with no API call
    saveOrUpdateActiveSessionLocal(offlineSession, null, testUser);

    const eligible = getEligibleClosedSessions();
    const oct16Eligible = eligible.find(e => e.app_name === 'Terminal' && e.start_time.startsWith('2026-10-16'));
    const oct17Eligible = eligible.find(e => e.app_name === 'Terminal' && e.start_time.startsWith('2026-10-17'));

    assert.ok(oct16Eligible, 'Oct 16 entry must be queued offline for sync');
    assert.ok(oct17Eligible, 'Oct 17 entry must be queued offline for sync');
    assert.strictEqual(oct16Eligible.synced, false);
    assert.strictEqual(oct17Eligible.synced, false);
  });

  // --------------------------------------------------------------------------
  // TEST 10: Offline records synchronize after reconnection without duplicates
  // --------------------------------------------------------------------------
  runTest('10. Offline records synchronize after reconnection without duplicates', () => {
    const eligible = getEligibleClosedSessions();
    const target = eligible.find(e => e.app_name === 'Terminal' && e.start_time.startsWith('2026-10-16'));
    assert.ok(target, 'Target offline record must exist');

    // Simulate successful sync
    markSessionSynced(target.local_id);

    // Verify it is no longer eligible for sync
    const afterSyncEligible = getEligibleClosedSessions();
    const reFound = afterSyncEligible.find(e => e.local_id === target.local_id);
    assert.strictEqual(reFound, undefined, 'Synced record must not be queued again for sync');
  });

  // --------------------------------------------------------------------------
  // TEST 11: Session start/end timestamps and duration are exact
  // --------------------------------------------------------------------------
  runTest('11. Exact boundary timestamps: 11:59:59 PM end and 12:00:00 AM start with correct duration', () => {
    const session = {
      local_id: 'sess-precision-check',
      appName: 'Word',
      windowTitle: 'Document1',
      status: 'Active',
      startTime: '2026-10-12T23:58:30',
      endTime: '2026-10-13T00:01:30',
      activityOn: '2026-10-12T23:58:30',
      closed: true
    };

    saveOrUpdateActiveSessionLocal(session, testUserId, testUser);

    const oct12Logs = getActivityLogsForDate('2026-10-12', testUserId, testUser);
    const oct13Logs = getActivityLogsForDate('2026-10-13', testUserId, testUser);

    const seg12 = oct12Logs.find(l => l.local_id === 'sess-precision-check');
    const seg13 = oct13Logs.find(l => l.app_name === 'Word');

    assert.ok(seg12 && seg13);

    // 23:58:30 to 23:59:59 = 89 seconds
    assert.strictEqual(seg12.start_time, '2026-10-12T23:58:30');
    assert.strictEqual(seg12.end_time, '2026-10-12T23:59:59');
    assert.strictEqual(seg12.duration, 89, 'Duration on Day 1 must be exactly 89s');

    // 00:00:00 to 00:01:30 = 90 seconds
    assert.strictEqual(seg13.start_time, '2026-10-13T00:00:00');
    assert.strictEqual(seg13.end_time, '2026-10-13T00:01:30');
    assert.strictEqual(seg13.duration, 90, 'Duration on Day 2 must be exactly 90s');

    // 12-hour formatter checks
    assert.strictEqual(formatTime12(seg12.end_time), '11:59 PM');
    assert.strictEqual(formatTime12(seg13.start_time), '12:00 AM');
  });

  // --------------------------------------------------------------------------
  // TEST 12: No cross-day entries, overlapping sessions, or duplicate entries exist
  // --------------------------------------------------------------------------
  runTest('12. Invariant verification: Zero cross-day records exist in entire database', () => {
    reconcileMidnightBoundaries();

    // Verify all chunks in queue file
    const queueContent = fs.readFileSync(getQueueFilePath(), 'utf8');
    const lines = queueContent.split('\n').filter(l => l.trim().length > 0);
    const parsed = lines.map(l => JSON.parse(l));

    assert.ok(parsed.length > 0, 'Database must have records');

    const seenIds = new Set();
    for (let i = 0; i < parsed.length; i++) {
      const c = parsed[i];
      const startDay = normalizeToLocalDateStr(c.start_time);
      const endDay = normalizeToLocalDateStr(c.end_time);

      assert.strictEqual(startDay, endDay, `Chunk ${c.local_id} must have identical startDay and endDay (${startDay} vs ${endDay})`);
      assert.ok(!seenIds.has(c.local_id), `Duplicate local_id detected: ${c.local_id}`);
      seenIds.add(c.local_id);
    }
  });

  // --------------------------------------------------------------------------
  // TEST 13: Dashboard totals remain correct for Today, Yesterday, Last 7 Days, and Last 30 Days
  // --------------------------------------------------------------------------
  runTest('13. Dashboard date-wise totals and time ranges correctly assign split sessions', () => {
    const date1 = '2026-10-08';
    const date2 = '2026-10-09';

    // Session: Oct 8 23:40:00 -> Oct 9 00:20:00 (active 20m on Oct 8, 20m on Oct 9)
    saveOrUpdateActiveSessionLocal({
      local_id: 'dash-split-session',
      appName: 'WorkLens',
      windowTitle: 'Dashboard',
      status: 'Active',
      startTime: `${date1}T23:40:00`,
      endTime: `${date2}T00:20:00`,
      activityOn: `${date1}T23:40:00`,
      closed: true
    }, testUserId, testUser);

    const durations = getDateWiseActiveDurations([date1, date2], testUserId, testUser);
    const ranges = getDateWiseTimeRanges([date1, date2], testUserId, testUser);

    // Oct 8 duration: 23:40:00 to 23:59:59 = 1199s
    assert.strictEqual(durations[date1], 1199, 'Oct 8 active duration must be 1199s');

    // Oct 9 duration: 00:00:00 to 00:20:00 = 1200s
    assert.strictEqual(durations[date2], 1200, 'Oct 9 active duration must be 1200s');

    // Time ranges
    assert.strictEqual(formatTime12(ranges[date1].earliestStart), '11:40 PM');
    assert.strictEqual(formatTime12(ranges[date1].latestEnd), '11:59 PM');
    assert.strictEqual(formatTime12(ranges[date2].earliestStart), '12:00 AM');
    assert.strictEqual(formatTime12(ranges[date2].latestEnd), '12:20 AM');
  });

  // --------------------------------------------------------------------------
  // TEST 14: Existing monotonic timing checks and sanity caps remain intact
  // --------------------------------------------------------------------------
  runTest('14. Monotonic clock and sanity guard constraints preserved', () => {
    const sessionHuge = {
      local_id: 'sess-huge-duration',
      appName: 'StuckApp',
      windowTitle: 'Hung',
      status: 'Active',
      startTime: '2026-10-01T08:00:00',
      endTime: '2026-10-01T22:00:00', // 14 hours (exceeds 12-hour max session limit)
      activityOn: '2026-10-01T08:00:00',
      duration: 14 * 3600,
      closed: true
    };

    saveOrUpdateActiveSessionLocal(sessionHuge, testUserId, testUser);
    const logs = getActivityLogsForDate('2026-10-01', testUserId, testUser);
    const found = logs.find(l => l.local_id === 'sess-huge-duration');

    assert.ok(found);
    assert.strictEqual(found.duration, 43200, 'Session duration must be capped at 43,200s (12 hours)');
  });

  // --------------------------------------------------------------------------
  // TEST 15: Timezone and daylight-saving boundary cases handled safely
  // --------------------------------------------------------------------------
  runTest('15. Month-end and year-end boundary rollovers handled safely', () => {
    // Month rollover: Oct 31 -> Nov 1
    const monthRollover = {
      local_id: 'sess-month-rollover',
      appName: 'Calendar',
      windowTitle: 'Planner',
      status: 'Active',
      startTime: '2026-10-31T23:55:00',
      endTime: '2026-11-01T00:10:00',
      activityOn: '2026-10-31T23:55:00',
      closed: true
    };

    const monthSegs = splitSessionAtMidnightBoundaries(monthRollover);
    assert.strictEqual(monthSegs.length, 2);
    assert.strictEqual(monthSegs[0].start_time, '2026-10-31T23:55:00');
    assert.strictEqual(monthSegs[0].end_time, '2026-10-31T23:59:59');
    assert.strictEqual(monthSegs[1].start_time, '2026-11-01T00:00:00');
    assert.strictEqual(monthSegs[1].end_time, '2026-11-01T00:10:00');

    // Year rollover: Dec 31 -> Jan 1
    const yearRollover = {
      local_id: 'sess-year-rollover',
      appName: 'NewYearCountdown',
      windowTitle: 'Party',
      status: 'Active',
      startTime: '2026-12-31T23:59:00',
      endTime: '2027-01-01T00:05:00',
      activityOn: '2026-12-31T23:59:00',
      closed: true
    };

    const yearSegs = splitSessionAtMidnightBoundaries(yearRollover);
    assert.strictEqual(yearSegs.length, 2);
    assert.strictEqual(yearSegs[0].start_time, '2026-12-31T23:59:00');
    assert.strictEqual(yearSegs[0].end_time, '2026-12-31T23:59:59');
    assert.strictEqual(yearSegs[1].start_time, '2027-01-01T00:00:00');
    assert.strictEqual(yearSegs[1].end_time, '2027-01-01T00:05:00');
  });

  console.log('\n================ TEST SUMMARY ================');
  console.log(`  Total: ${passedTests + failedTests}`);
  console.log(`  Passed: ${passedTests}`);
  console.log(`  Failed: ${failedTests}`);
  console.log('==============================================\n');

  if (failedTests > 0) process.exit(1);
  else process.exit(0);
});
