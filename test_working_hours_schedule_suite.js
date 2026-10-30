// test_working_hours_schedule_suite.js
// Production-Level Verification Suite for Dynamic Day-Based and Time-Based Tracking Control

const assert = require('assert');
const path = require('path');
const fs = require('fs');

const { WorkingHoursController } = require('./workingHoursController');
const activityStore = require('./activityStore');

let totalTests = 0;
let passedTests = 0;
let failedTests = 0;

function runTest(name, fn) {
  totalTests++;
  try {
    fn();
    passedTests++;
    console.log(`  PASS: ${name}`);
  } catch (err) {
    failedTests++;
    console.error(`  FAIL: ${name}`);
    console.error(`    ${err.message}`);
  }
}

// Helper to create a specific Date with local year, month, day, hours, minutes, seconds
// Note: 2026-10-26 was a Monday
// Mon: 2026-10-26
// Tue: 2026-10-27
// Wed: 2026-10-28
// Thu: 2026-10-29
// Fri: 2026-10-30
// Sat: 2026-10-31
// Sun: 2026-11-01
const DATES = {
  monday: (h, m, s = 0) => new Date(2026, 9, 26, h, m, s, 0),
  tuesday: (h, m, s = 0) => new Date(2026, 9, 27, h, m, s, 0),
  wednesday: (h, m, s = 0) => new Date(2026, 9, 28, h, m, s, 0),
  thursday: (h, m, s = 0) => new Date(2026, 9, 29, h, m, s, 0),
  friday: (h, m, s = 0) => new Date(2026, 9, 30, h, m, s, 0),
  saturday: (h, m, s = 0) => new Date(2026, 9, 31, h, m, s, 0),
  sunday: (h, m, s = 0) => new Date(2026, 10, 1, h, m, s, 0)
};

function runSuite() {
  console.log('================================================================================');
  console.log('   WORKLENS WORKING HOURS & SCHEDULE RESTRICTION TEST SUITE                     ');
  console.log('================================================================================');

  const testDir = path.join(__dirname, 'scratch', 'test_sched_tmp');
  if (!fs.existsSync(testDir)) fs.mkdirSync(testDir, { recursive: true });
  const testConfigPath = path.join(testDir, 'working_hours_config.json');

  const controller = new WorkingHoursController({ storagePath: testConfigPath });

  // -----------------------------------------------------------------------------
  // 1. FULL-TIME TRACKING TESTS (Mode A)
  // -----------------------------------------------------------------------------
  console.log('\n[1] Mode A: Full-Time Tracking Tests (24/7):');

  runTest('1.1 work_lens_full_time = "1" permits Monday 02:00 AM', () => {
    controller.resetForTesting();
    controller.updateConfiguration({
      work_lens_full_time: '1',
      work_lens_day: 'Tuesday', // Should be ignored
      work_lens_time: '10:00, 18:00' // Should be ignored
    });
    assert.strictEqual(controller.canTrackNow(DATES.monday(2, 0)), true);
  });

  runTest('1.2 work_lens_full_time = "1" permits Saturday 11:00 PM', () => {
    assert.strictEqual(controller.canTrackNow(DATES.saturday(23, 0)), true);
  });

  runTest('1.3 work_lens_full_time = "1" permits Sunday 12:00 PM', () => {
    assert.strictEqual(controller.canTrackNow(DATES.sunday(12, 0)), true);
  });

  runTest('1.4 work_lens_full_time = "1" ignores missing day and time fields', () => {
    controller.resetForTesting();
    const res = controller.updateConfiguration({ work_lens_full_time: '1' });
    assert.strictEqual(res.success, true);
    assert.strictEqual(controller.canTrackNow(DATES.sunday(3, 30)), true);
  });

  // -----------------------------------------------------------------------------
  // 2. DYNAMIC WEEKDAY TESTS (Mode B)
  // -----------------------------------------------------------------------------
  console.log('\n[2] Dynamic Weekday Tests:');

  runTest('2.1 Monday, Wednesday: Monday inside hours is ON, Tuesday is OFF, Wednesday is ON', () => {
    controller.resetForTesting();
    controller.updateConfiguration({
      work_lens_full_time: '0',
      work_lens_day: 'Monday, Wednesday',
      work_lens_time: '09:00, 21:00'
    });

    assert.strictEqual(controller.canTrackNow(DATES.monday(12, 0)), true);
    assert.strictEqual(controller.canTrackNow(DATES.tuesday(12, 0)), false);
    assert.strictEqual(controller.canTrackNow(DATES.wednesday(12, 0)), true);
  });

  runTest('2.2 Saturday, Sunday: Saturday is ON, Sunday is ON, Monday is OFF', () => {
    controller.resetForTesting();
    controller.updateConfiguration({
      work_lens_full_time: '0',
      work_lens_day: 'Saturday, Sunday',
      work_lens_time: '09:00, 21:00'
    });

    assert.strictEqual(controller.canTrackNow(DATES.saturday(14, 0)), true);
    assert.strictEqual(controller.canTrackNow(DATES.sunday(14, 0)), true);
    assert.strictEqual(controller.canTrackNow(DATES.monday(14, 0)), false);
  });

  runTest('2.3 Wednesday only: Wednesday is ON, Thursday is OFF', () => {
    controller.resetForTesting();
    controller.updateConfiguration({
      work_lens_full_time: '0',
      work_lens_day: 'Wednesday',
      work_lens_time: '09:00, 21:00'
    });

    assert.strictEqual(controller.canTrackNow(DATES.wednesday(11, 0)), true);
    assert.strictEqual(controller.canTrackNow(DATES.thursday(11, 0)), false);
  });

  runTest('2.4 Tuesday, Thursday, Sunday: Sunday is ON, Friday is OFF', () => {
    controller.resetForTesting();
    controller.updateConfiguration({
      work_lens_full_time: '0',
      work_lens_day: 'Tuesday, Thursday, Sunday',
      work_lens_time: '09:00, 21:00'
    });

    assert.strictEqual(controller.canTrackNow(DATES.sunday(10, 0)), true);
    assert.strictEqual(controller.canTrackNow(DATES.friday(10, 0)), false);
  });

  // -----------------------------------------------------------------------------
  // 3. TIME BOUNDARY TESTS (09:00 - 21:00)
  // -----------------------------------------------------------------------------
  console.log('\n[3] Time Boundary Tests (09:00 - 21:00):');

  runTest('3.1 08:59:59 is OFF (before start time)', () => {
    controller.resetForTesting();
    controller.updateConfiguration({
      work_lens_full_time: '0',
      work_lens_day: 'Monday',
      work_lens_time: '09:00, 21:00'
    });
    assert.strictEqual(controller.canTrackNow(DATES.monday(8, 59, 59)), false);
  });

  runTest('3.2 09:00:00 is ON (inclusive start boundary)', () => {
    assert.strictEqual(controller.canTrackNow(DATES.monday(9, 0, 0)), true);
  });

  runTest('3.3 12:00:00 is ON (mid-day)', () => {
    assert.strictEqual(controller.canTrackNow(DATES.monday(12, 0, 0)), true);
  });

  runTest('3.4 20:59:59 is ON (last second before end boundary)', () => {
    assert.strictEqual(controller.canTrackNow(DATES.monday(20, 59, 59)), true);
  });

  runTest('3.5 21:00:00 is OFF (exclusive end boundary)', () => {
    assert.strictEqual(controller.canTrackNow(DATES.monday(21, 0, 0)), false);
  });

  runTest('3.6 22:00:00 is OFF (after end boundary)', () => {
    assert.strictEqual(controller.canTrackNow(DATES.monday(22, 0, 0)), false);
  });

  // -----------------------------------------------------------------------------
  // 4. COMBINED DAY AND TIME TESTS
  // -----------------------------------------------------------------------------
  console.log('\n[4] Combined Day and Time Tests:');

  runTest('4.1 Monday 10:00 AM -> ON', () => {
    controller.resetForTesting();
    controller.updateConfiguration({
      work_lens_full_time: '0',
      work_lens_day: 'Monday, Wednesday',
      work_lens_time: '9:00, 21:00'
    });
    assert.strictEqual(controller.canTrackNow(DATES.monday(10, 0)), true);
  });

  runTest('4.2 Tuesday 10:00 AM -> OFF (non-working day)', () => {
    assert.strictEqual(controller.canTrackNow(DATES.tuesday(10, 0)), false);
    const evalRes = controller.evaluateSchedule(DATES.tuesday(10, 0));
    assert.strictEqual(evalRes.reason, 'NON_WORKING_DAY');
  });

  runTest('4.3 Wednesday 08:00 AM -> OFF (outside working hours)', () => {
    assert.strictEqual(controller.canTrackNow(DATES.wednesday(8, 0)), false);
    const evalRes = controller.evaluateSchedule(DATES.wednesday(8, 0));
    assert.strictEqual(evalRes.reason, 'OUTSIDE_HOURS');
  });

  runTest('4.4 Wednesday 10:00 AM -> ON', () => {
    assert.strictEqual(controller.canTrackNow(DATES.wednesday(10, 0)), true);
  });

  runTest('4.5 Wednesday 10:00 PM -> OFF (outside working hours)', () => {
    assert.strictEqual(controller.canTrackNow(DATES.wednesday(22, 0)), false);
  });

  runTest('4.6 Thursday 02:00 PM -> OFF (non-working day)', () => {
    assert.strictEqual(controller.canTrackNow(DATES.thursday(14, 0)), false);
  });

  // -----------------------------------------------------------------------------
  // 5. MIDNIGHT-CROSSING SCHEDULE TESTS (21:00 - 06:00)
  // -----------------------------------------------------------------------------
  console.log('\n[5] Midnight-Crossing Schedule Tests (21:00 - 06:00):');

  runTest('5.1 Overnight schedule on Monday, Wednesday, Saturday', () => {
    controller.resetForTesting();
    controller.updateConfiguration({
      work_lens_full_time: '0',
      work_lens_day: 'Monday, Wednesday, Saturday',
      work_lens_time: '21:00, 06:00'
    });

    // Monday before shift
    assert.strictEqual(controller.canTrackNow(DATES.monday(20, 0)), false, 'Monday 20:00 OFF');
    // Monday shift begins
    assert.strictEqual(controller.canTrackNow(DATES.monday(21, 0)), true, 'Monday 21:00 ON');
    assert.strictEqual(controller.canTrackNow(DATES.monday(23, 59)), true, 'Monday 23:59 ON');
    // Tuesday morning continuation of Monday shift
    assert.strictEqual(controller.canTrackNow(DATES.tuesday(0, 0)), true, 'Tuesday 00:00 ON (from Monday)');
    assert.strictEqual(controller.canTrackNow(DATES.tuesday(5, 59, 59)), true, 'Tuesday 05:59:59 ON');
    // Tuesday 06:00 shift ends
    assert.strictEqual(controller.canTrackNow(DATES.tuesday(6, 0, 0)), false, 'Tuesday 06:00 OFF');
    // Tuesday evening: Tuesday is NOT in allowed days
    assert.strictEqual(controller.canTrackNow(DATES.tuesday(21, 0)), false, 'Tuesday 21:00 OFF');
    // Wednesday morning: continuation of Tuesday (which was NOT allowed)
    assert.strictEqual(controller.canTrackNow(DATES.wednesday(2, 0)), false, 'Wednesday 02:00 OFF (Tuesday not allowed)');
    assert.strictEqual(controller.canTrackNow(DATES.wednesday(5, 59)), false, 'Wednesday 05:59 OFF');
    // Wednesday evening: Wednesday shift begins
    assert.strictEqual(controller.canTrackNow(DATES.wednesday(21, 0)), true, 'Wednesday 21:00 ON');
    // Thursday morning continuation of Wednesday shift
    assert.strictEqual(controller.canTrackNow(DATES.thursday(5, 59)), true, 'Thursday 05:59 ON');
    assert.strictEqual(controller.canTrackNow(DATES.thursday(6, 0)), false, 'Thursday 06:00 OFF');
    // Friday evening: Friday is NOT in allowed days
    assert.strictEqual(controller.canTrackNow(DATES.friday(21, 0)), false, 'Friday 21:00 OFF');
    // Saturday evening: Saturday shift begins
    assert.strictEqual(controller.canTrackNow(DATES.saturday(21, 0)), true, 'Saturday 21:00 ON');
    // Sunday morning continuation of Saturday shift
    assert.strictEqual(controller.canTrackNow(DATES.sunday(5, 59)), true, 'Sunday 05:59 ON');
    assert.strictEqual(controller.canTrackNow(DATES.sunday(6, 0)), false, 'Sunday 06:00 OFF');
  });

  // -----------------------------------------------------------------------------
  // 6. DYNAMIC CONFIGURATION UPDATE TESTS (Without Application Restart)
  // -----------------------------------------------------------------------------
  console.log('\n[6] Dynamic Configuration Update Tests:');

  runTest('6.1 Switch full-time from 1 to 0 immediately restricts tracking', () => {
    controller.resetForTesting();
    controller.updateConfiguration({ work_lens_full_time: '1' });
    assert.strictEqual(controller.canTrackNow(DATES.tuesday(10, 0)), true);

    // Dynamic update arrives
    controller.updateConfiguration({
      work_lens_full_time: '0',
      work_lens_day: 'Monday, Wednesday',
      work_lens_time: '09:00, 21:00'
    });
    // Immediately restricted on Tuesday without restart!
    assert.strictEqual(controller.canTrackNow(DATES.tuesday(10, 0)), false);
  });

  runTest('6.2 Switch full-time from 0 to 1 immediately restores 24/7 tracking', () => {
    controller.updateConfiguration({ work_lens_full_time: '1' });
    assert.strictEqual(controller.canTrackNow(DATES.tuesday(10, 0)), true);
  });

  runTest('6.3 Dynamic change of allowed days applies immediately', () => {
    controller.updateConfiguration({
      work_lens_full_time: '0',
      work_lens_day: 'Monday, Tuesday',
      work_lens_time: '09:00, 21:00'
    });
    assert.strictEqual(controller.canTrackNow(DATES.tuesday(10, 0)), true);
    assert.strictEqual(controller.canTrackNow(DATES.wednesday(10, 0)), false);

    // Server updates days to Wednesday, Thursday
    controller.updateConfiguration({
      work_lens_full_time: '0',
      work_lens_day: 'Wednesday, Thursday',
      work_lens_time: '09:00, 21:00'
    });
    assert.strictEqual(controller.canTrackNow(DATES.tuesday(10, 0)), false);
    assert.strictEqual(controller.canTrackNow(DATES.wednesday(10, 0)), true);
  });

  runTest('6.4 Dynamic change of working hours applies immediately', () => {
    // Current window 10:00 to 18:00
    controller.updateConfiguration({
      work_lens_full_time: '0',
      work_lens_day: 'Wednesday',
      work_lens_time: '10:00, 18:00'
    });
    assert.strictEqual(controller.canTrackNow(DATES.wednesday(9, 30)), false);
    assert.strictEqual(controller.canTrackNow(DATES.wednesday(18, 30)), false);

    // Server extends hours to 09:00 to 20:00
    controller.updateConfiguration({
      work_lens_full_time: '0',
      work_lens_day: 'Wednesday',
      work_lens_time: '09:00, 20:00'
    });
    assert.strictEqual(controller.canTrackNow(DATES.wednesday(9, 30)), true);
    assert.strictEqual(controller.canTrackNow(DATES.wednesday(18, 30)), true);
  });

  runTest('6.5 Invalid/incomplete API responses are rejected and retain last-known-good', () => {
    const previousConfig = controller.getActiveConfiguration();

    // Missing days
    const res1 = controller.updateConfiguration({
      work_lens_full_time: '0',
      work_lens_day: '',
      work_lens_time: '09:00, 18:00'
    });
    assert.strictEqual(res1.success, false);

    // Invalid time
    const res2 = controller.updateConfiguration({
      work_lens_full_time: '0',
      work_lens_day: 'Monday',
      work_lens_time: '25:00, 99:00'
    });
    assert.strictEqual(res2.success, false);

    // Configuration was safely retained!
    const active = controller.getActiveConfiguration();
    assert.deepStrictEqual(active.allowedDays, previousConfig.allowedDays);
  });

  // -----------------------------------------------------------------------------
  // 7. NEXT ALLOWED START & END CALCULATIONS
  // -----------------------------------------------------------------------------
  console.log('\n[7] Next Allowed Start & End Boundary Calculations:');

  runTest('7.1 getNextAllowedEnd calculates exact end time during daytime shift', () => {
    controller.resetForTesting();
    controller.updateConfiguration({
      work_lens_full_time: '0',
      work_lens_day: 'Monday, Wednesday',
      work_lens_time: '09:00, 21:00'
    });

    const now = DATES.monday(14, 30);
    const end = controller.getNextAllowedEnd(now);
    assert.ok(end instanceof Date);
    assert.strictEqual(end.getFullYear(), 2026);
    assert.strictEqual(end.getMonth(), 9);
    assert.strictEqual(end.getDate(), 26);
    assert.strictEqual(end.getHours(), 21);
    assert.strictEqual(end.getMinutes(), 0);
  });

  runTest('7.2 getNextAllowedStart finds next shift on future allowed day', () => {
    const tuesday = DATES.tuesday(10, 0); // Tuesday is not allowed
    const nextStart = controller.getNextAllowedStart(tuesday);
    assert.ok(nextStart instanceof Date);
    assert.strictEqual(nextStart.getDate(), 28); // Wednesday
    assert.strictEqual(nextStart.getHours(), 9);
    assert.strictEqual(nextStart.getMinutes(), 0);
  });

  runTest('7.3 Overnight getNextAllowedEnd spans into next calendar day', () => {
    controller.updateConfiguration({
      work_lens_full_time: '0',
      work_lens_day: 'Monday',
      work_lens_time: '21:00, 06:00'
    });

    const mondayNight = DATES.monday(22, 0);
    const end = controller.getNextAllowedEnd(mondayNight);
    assert.ok(end instanceof Date);
    assert.strictEqual(end.getDate(), 27); // Tuesday
    assert.strictEqual(end.getHours(), 6);
    assert.strictEqual(end.getMinutes(), 0);
  });

  // -----------------------------------------------------------------------------
  // 8. RECORDING BOUNDARY & ACTIVITY STORE INTEGRITY TESTS
  // -----------------------------------------------------------------------------
  console.log('\n[8] Activity Recording Boundary Safety Tests:');

  runTest('8.1 ActivityStore rejects new session creation when tracking is restricted', () => {
    controller.resetForTesting();
    controller.updateConfiguration({
      work_lens_full_time: '0',
      work_lens_day: 'Monday',
      work_lens_time: '09:00, 21:00'
    });

    // Wire up activityStore permission checker
    activityStore.setTrackingPermissionChecker(d => controller.canTrackNow(d));

    const restrictedDate = DATES.tuesday(12, 0); // Tuesday is not allowed
    const fakeSession = {
      local_id: 'test-restricted-session-1',
      appName: 'VSCode',
      windowTitle: 'test.js',
      startTime: restrictedDate,
      endTime: restrictedDate,
      status: 'Active',
      closed: false
    };

    const saved = activityStore.saveOrUpdateActiveSessionLocal(fakeSession, 123, 'testuser');
    assert.strictEqual(saved, null, 'Expected session to be blocked and return null');
  });

  runTest('8.2 ActivityStore allows closing an already-open session when boundary hits', () => {
    controller.resetForTesting();
    controller.updateConfiguration({
      work_lens_full_time: '0',
      work_lens_day: 'Monday',
      work_lens_time: '09:00, 21:00'
    });

    // 1. Session created at 20:58 (permitted)
    const validStart = DATES.monday(20, 58);
    const openSession = {
      local_id: 'test-close-session-boundary',
      appName: 'VSCode',
      windowTitle: 'code.js',
      startTime: validStart,
      endTime: validStart,
      status: 'Active',
      closed: false
    };

    activityStore.setTrackingPermissionChecker(d => controller.canTrackNow(d));
    const saved = activityStore.saveOrUpdateActiveSessionLocal(openSession, 123, 'testuser');
    assert.ok(saved, 'Permitted session should save');

    // 2. Boundary hits at 21:00 -> restricted!
    // Closing the session should be permitted so duration is properly finalized
    const closeTime = DATES.monday(21, 0);
    const closingSession = {
      ...saved,
      endTime: closeTime,
      duration: Math.floor((closeTime - validStart) / 1000),
      closed: true
    };

    const closedResult = activityStore.saveOrUpdateActiveSessionLocal(closingSession, 123, 'testuser');
    assert.ok(closedResult, 'Closing existing session must succeed');
    assert.strictEqual(closedResult.closed, true);
    assert.strictEqual(closedResult.duration, 120);

    // Clean up permission checker for subsequent test suites
    activityStore.setTrackingPermissionChecker(null);
  });

  // -----------------------------------------------------------------------------
  // 9. PERSISTENCE & STARTUP RECOVERY TESTS
  // -----------------------------------------------------------------------------
  console.log('\n[9] Persistence & Startup Recovery Tests:');

  runTest('9.1 Configuration persists to disk and reloads on startup', () => {
    controller.resetForTesting();
    controller.updateConfiguration({
      work_lens_full_time: '0',
      work_lens_day: 'Thursday, Friday',
      work_lens_time: '08:30, 17:30'
    });

    // Create a new controller simulating application restart
    const restartedController = new WorkingHoursController({ storagePath: testConfigPath });
    const loaded = restartedController.loadConfiguration();

    assert.ok(loaded);
    assert.strictEqual(loaded.isFullTime, false);
    assert.ok(loaded.allowedDays.has('thursday'));
    assert.ok(loaded.allowedDays.has('friday'));
    assert.strictEqual(loaded.workingHours.start.hours, 8);
    assert.strictEqual(loaded.workingHours.start.minutes, 30);
    assert.strictEqual(loaded.workingHours.end.hours, 17);
    assert.strictEqual(loaded.workingHours.end.minutes, 30);
  });


  // -----------------------------------------------------------------------------
  // 10. SLEEP, RESUME & CLOCK SHIFT LIFECYCLE TESTS
  // -----------------------------------------------------------------------------
  console.log('\n[10] Sleep, Resume & Clock Shift Lifecycle Tests:');

  runTest('10.1 Windows sleeps before configured end time and resumes after it', () => {
    controller.resetForTesting();
    let startedCount = 0;
    let stoppedCount = 0;
    controller.init({
      onStartTracking: () => { startedCount++; },
      onStopTracking: () => { stoppedCount++; }
    });

    controller.updateConfiguration({
      work_lens_full_time: '0',
      work_lens_day: 'Monday',
      work_lens_time: '09:00, 21:00'
    });

    // 1. Before sleep at 20:50 (inside window)
    controller.evaluateAndApply(DATES.monday(20, 50));
    assert.strictEqual(controller.isTracking, true);

    // 2. Machine sleeps, clock advances to 21:10 (after window), powerMonitor resume fires
    controller.evaluateAndApply(DATES.monday(21, 10));
    assert.strictEqual(controller.isTracking, false);
    assert.strictEqual(controller.canTrackNow(DATES.monday(21, 10)), false);
  });

  runTest('10.2 Application starts on a restricted weekday: tracking remains stopped', () => {
    controller.resetForTesting();
    controller.updateConfiguration({
      work_lens_full_time: '0',
      work_lens_day: 'Monday, Wednesday',
      work_lens_time: '09:00, 21:00'
    });

    // App launches on Tuesday
    const evalRes = controller.evaluateSchedule(DATES.tuesday(11, 0));
    assert.strictEqual(evalRes.permitted, false);
    assert.strictEqual(evalRes.reason, 'NON_WORKING_DAY');
    assert.strictEqual(controller.canTrackNow(DATES.tuesday(11, 0)), false);
  });

  runTest('10.3 Application starts outside working hours: tracking remains stopped', () => {
    // App launches Monday 07:30 AM
    const evalRes = controller.evaluateSchedule(DATES.monday(7, 30));
    assert.strictEqual(evalRes.permitted, false);
    assert.strictEqual(evalRes.reason, 'OUTSIDE_HOURS');
    assert.strictEqual(controller.canTrackNow(DATES.monday(7, 30)), false);
  });

  runTest('10.4 Application starts inside working hours: tracking becomes permitted', () => {
    // App launches Monday 10:30 AM
    const evalRes = controller.evaluateSchedule(DATES.monday(10, 30));
    assert.strictEqual(evalRes.permitted, true);
    assert.strictEqual(evalRes.reason, 'WITHIN_HOURS');
    assert.strictEqual(controller.canTrackNow(DATES.monday(10, 30)), true);
  });

  runTest('10.5 System clock moves forward across an end boundary', () => {
    controller.evaluateAndApply(DATES.monday(20, 59));
    assert.strictEqual(controller.isTracking, true);

    // Clock leaps forward past 21:00 boundary
    controller.evaluateAndApply(DATES.monday(21, 2));
    assert.strictEqual(controller.isTracking, false);
  });

  runTest('10.6 System clock moves backward across an allowed boundary', () => {
    controller.evaluateAndApply(DATES.monday(21, 5));
    assert.strictEqual(controller.isTracking, false);

    // Clock corrected backward into working hours
    controller.evaluateAndApply(DATES.monday(20, 55));
    assert.strictEqual(controller.isTracking, true);
  });

  runTest('10.7 Friday allowed schedule ends and Saturday is restricted', () => {
    controller.updateConfiguration({
      work_lens_full_time: '0',
      work_lens_day: 'Friday',
      work_lens_time: '09:00, 21:00'
    });

    assert.strictEqual(controller.canTrackNow(DATES.friday(20, 59)), true, 'Fri 20:59 ON');
    assert.strictEqual(controller.canTrackNow(DATES.friday(21, 0)), false, 'Fri 21:00 OFF');
    assert.strictEqual(controller.canTrackNow(DATES.saturday(10, 0)), false, 'Sat 10:00 OFF');
  });

  runTest('10.8 Sunday is restricted and Monday allowed schedule begins', () => {
    controller.updateConfiguration({
      work_lens_full_time: '0',
      work_lens_day: 'Monday',
      work_lens_time: '09:00, 21:00'
    });

    assert.strictEqual(controller.canTrackNow(DATES.sunday(23, 59)), false, 'Sun 23:59 OFF');
    assert.strictEqual(controller.canTrackNow(DATES.monday(8, 59)), false, 'Mon 08:59 OFF');
    assert.strictEqual(controller.canTrackNow(DATES.monday(9, 0)), true, 'Mon 09:00 ON');
  });

  // Clean up test file
  try {
    if (fs.existsSync(testConfigPath)) fs.unlinkSync(testConfigPath);
  } catch (_) {}

  console.log('\n================================================================================');
  console.log(` RESULTS: ${passedTests} passed, ${failedTests} failed out of ${totalTests} tests`);
  console.log('================================================================================');

  if (failedTests > 0) {
    process.exit(1);
  }
}

if (require.main === module) {
  runSuite();
}

module.exports = { runSuite };
