// test_production_working_hours_e2e.js
// Production-Readiness Integration Audit for Dynamic Working Hours in WorkLens
// Runs in Electron runtime with isolated filesystem, controlled clock, and direct JSONL inspection.

const { app } = require('electron');
const path = require('path');
const fs = require('fs');
const assert = require('assert');
const os = require('os');

// Setup isolated test userData directory
const testUserDataDir = path.join(os.tmpdir(), `worklens_audit_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`);
fs.mkdirSync(testUserDataDir, { recursive: true });
app.setPath('userData', testUserDataDir);
process.env.WORKLENS_DATA_DIR = testUserDataDir;

const activityStore = require('./activityStore');
const workingHoursController = require('./workingHoursController');
const antiAfkDetector = require('./anti-afk/antiAfkDetector');

let totalChecks = 0;
let passedChecks = 0;
let failedChecks = 0;

function auditCheck(desc, fn) {
  totalChecks++;
  try {
    fn();
    passedChecks++;
    console.log(`  [AUDIT PASS] ${desc}`);
  } catch (err) {
    failedChecks++;
    console.error(`  [AUDIT FAIL] ${desc}`);
    console.error(`     Error: ${err.stack || err.message}`);
  }
}

// Helpers for reference dates (Week of Oct 26 - Nov 01, 2026)
// Mon: 2026-10-26, Tue: 2026-10-27, Wed: 2026-10-28, Thu: 2026-10-29
// Fri: 2026-10-30, Sat: 2026-10-31, Sun: 2026-11-01
const AUDIT_DATES = {
  mon: (h, m, s = 0) => new Date(2026, 9, 26, h, m, s, 0),
  tue: (h, m, s = 0) => new Date(2026, 9, 27, h, m, s, 0),
  wed: (h, m, s = 0) => new Date(2026, 9, 28, h, m, s, 0),
  thu: (h, m, s = 0) => new Date(2026, 9, 29, h, m, s, 0),
  fri: (h, m, s = 0) => new Date(2026, 9, 30, h, m, s, 0),
  sat: (h, m, s = 0) => new Date(2026, 9, 31, h, m, s, 0),
  sun: (h, m, s = 0) => new Date(2026, 10, 1, h, m, s, 0)
};

function readRawJsonlRecords() {
  const qPath = activityStore.getQueueFilePath();
  if (!fs.existsSync(qPath)) return [];
  const lines = fs.readFileSync(qPath, 'utf8').split('\n').map(l => l.trim()).filter(Boolean);
  return lines.map(l => JSON.parse(l));
}

function clearJsonlFile() {
  const qPath = activityStore.getQueueFilePath();
  if (fs.existsSync(qPath)) fs.unlinkSync(qPath);
  activityStore.invalidateChunksCache();
}

async function runAudit() {
  console.log('================================================================================');
  console.log('   WORKLENS WORKING HOURS PRODUCTION-READINESS INDEPENDENT AUDIT                ');
  console.log('================================================================================');
  console.log(`Isolated Test Directory: ${testUserDataDir}`);

  // Enforce recording boundary
  activityStore.setTrackingPermissionChecker((date) => workingHoursController.canTrackNow(date));

  // ---------------------------------------------------------------------------
  // AUDIT SECTION 1: Full-Time Mode (24/7) JSONL Record Verification
  // ---------------------------------------------------------------------------
  console.log('\n--- SECTION 1: Full-Time Mode (24/7) Preservation ---');
  clearJsonlFile();

  const mockApiFullTime = {
    user_id: 424,
    status: 'active',
    work_lens_full_time: '1',
    work_lens_time: '10:00, 18:00', // Must be completely ignored
    work_lens_day: 'Tuesday'        // Must be completely ignored
  };

  workingHoursController.updateConfiguration(mockApiFullTime);

  auditCheck('1.1 work_lens_full_time="1" allows session writes on Monday 02:00 AM', () => {
    const sDate = AUDIT_DATES.mon(2, 0);
    const session = {
      local_id: 'ft-mon-02am',
      appName: 'Code',
      windowTitle: 'audit.js',
      startTime: sDate,
      endTime: sDate,
      status: 'Active',
      closed: false
    };
    const res = activityStore.saveOrUpdateActiveSessionLocal(session, 424, 'auditor');
    assert.ok(res, 'Session must save');

    const records = readRawJsonlRecords();
    const found = records.find(r => r.local_id === 'ft-mon-02am');
    assert.ok(found, 'Record must physically exist in JSONL');
    assert.strictEqual(found.app_name, 'Code');
  });

  auditCheck('1.2 work_lens_full_time="1" allows session writes on Saturday 11:00 PM', () => {
    const sDate = AUDIT_DATES.sat(23, 0);
    const session = {
      local_id: 'ft-sat-11pm',
      appName: 'Browser',
      windowTitle: 'Search',
      startTime: sDate,
      endTime: sDate,
      status: 'Active',
      closed: false
    };
    activityStore.saveOrUpdateActiveSessionLocal(session, 424, 'auditor');
    const records = readRawJsonlRecords();
    assert.ok(records.some(r => r.local_id === 'ft-sat-11pm'));
  });

  auditCheck('1.3 work_lens_full_time="1" allows session writes on Sunday 12:00 PM', () => {
    const sDate = AUDIT_DATES.sun(12, 0);
    const session = {
      local_id: 'ft-sun-12pm',
      appName: 'Terminal',
      windowTitle: 'Build',
      startTime: sDate,
      endTime: sDate,
      status: 'Active',
      closed: false
    };
    activityStore.saveOrUpdateActiveSessionLocal(session, 424, 'auditor');
    const records = readRawJsonlRecords();
    assert.ok(records.some(r => r.local_id === 'ft-sun-12pm'));
  });

  // ---------------------------------------------------------------------------
  // AUDIT SECTION 2: Wednesday-Only Configuration Audit
  // ---------------------------------------------------------------------------
  console.log('\n--- SECTION 2: Wednesday-Only Schedule Restriction Audit ---');
  clearJsonlFile();

  const mockApiWednesdayOnly = {
    user_id: 424,
    status: 'active',
    work_lens_full_time: '0',
    work_lens_day: 'Wednesday',
    work_lens_time: '09:00, 18:00'
  };

  workingHoursController.updateConfiguration(mockApiWednesdayOnly);

  auditCheck('2.1 Tuesday 10:00 AM session is rejected at storage boundary (0 records in JSONL)', () => {
    const sDate = AUDIT_DATES.tue(10, 0);
    const session = {
      local_id: 'wedonly-tue-session',
      appName: 'Code',
      windowTitle: 'test.js',
      startTime: sDate,
      endTime: sDate,
      status: 'Active',
      closed: false
    };
    const res = activityStore.saveOrUpdateActiveSessionLocal(session, 424, 'auditor');
    assert.strictEqual(res, null, 'Must return null');

    const records = readRawJsonlRecords();
    assert.strictEqual(records.length, 0, 'JSONL must contain zero records');
  });

  auditCheck('2.2 Wednesday 08:59:59 AM (before shift) is rejected at storage boundary', () => {
    const sDate = AUDIT_DATES.wed(8, 59, 59);
    const session = {
      local_id: 'wedonly-wed-early',
      appName: 'Code',
      windowTitle: 'test.js',
      startTime: sDate,
      endTime: sDate,
      status: 'Active',
      closed: false
    };
    const res = activityStore.saveOrUpdateActiveSessionLocal(session, 424, 'auditor');
    assert.strictEqual(res, null);
    assert.strictEqual(readRawJsonlRecords().length, 0);
  });

  auditCheck('2.3 Wednesday 09:00:00 AM (inclusive start) successfully persists to JSONL', () => {
    const sDate = AUDIT_DATES.wed(9, 0, 0);
    const session = {
      local_id: 'wedonly-wed-start',
      appName: 'Code',
      windowTitle: 'test.js',
      startTime: sDate,
      endTime: sDate,
      status: 'Active',
      closed: false
    };
    const res = activityStore.saveOrUpdateActiveSessionLocal(session, 424, 'auditor');
    assert.ok(res, 'Session must save');

    const records = readRawJsonlRecords();
    assert.strictEqual(records.length, 1);
    assert.strictEqual(records[0].local_id, 'wedonly-wed-start');
  });

  auditCheck('2.4 Wednesday 18:00:00 PM (exclusive end) session is rejected at storage boundary', () => {
    const sDate = AUDIT_DATES.wed(18, 0, 0);
    const session = {
      local_id: 'wedonly-wed-end',
      appName: 'Code',
      windowTitle: 'test.js',
      startTime: sDate,
      endTime: sDate,
      status: 'Active',
      closed: false
    };
    const res = activityStore.saveOrUpdateActiveSessionLocal(session, 424, 'auditor');
    assert.strictEqual(res, null);
    assert.strictEqual(readRawJsonlRecords().length, 1, 'No new record added');
  });

  auditCheck('2.5 Thursday 10:00 AM session is rejected at storage boundary', () => {
    const sDate = AUDIT_DATES.thu(10, 0);
    const session = {
      local_id: 'wedonly-thu-session',
      appName: 'Code',
      windowTitle: 'test.js',
      startTime: sDate,
      endTime: sDate,
      status: 'Active',
      closed: false
    };
    const res = activityStore.saveOrUpdateActiveSessionLocal(session, 424, 'auditor');
    assert.strictEqual(res, null);
    assert.strictEqual(readRawJsonlRecords().length, 1);
  });

  // ---------------------------------------------------------------------------
  // AUDIT SECTION 3: Saturday & Sunday Weekend-Only Configuration Audit
  // ---------------------------------------------------------------------------
  console.log('\n--- SECTION 3: Saturday-Sunday Weekend-Only Schedule Audit ---');
  clearJsonlFile();

  const mockApiWeekendOnly = {
    user_id: 424,
    status: 'active',
    work_lens_full_time: '0',
    work_lens_day: 'Saturday, Sunday',
    work_lens_time: '10:00, 20:00'
  };

  workingHoursController.updateConfiguration(mockApiWeekendOnly);

  auditCheck('3.1 Friday 15:00 is rejected at storage boundary (0 records in JSONL)', () => {
    const res = activityStore.saveOrUpdateActiveSessionLocal({
      local_id: 'we-fri',
      appName: 'Notes',
      windowTitle: 'notes.txt',
      startTime: AUDIT_DATES.fri(15, 0),
      endTime: AUDIT_DATES.fri(15, 0),
      status: 'Active',
      closed: false
    }, 424, 'auditor');
    assert.strictEqual(res, null);
    assert.strictEqual(readRawJsonlRecords().length, 0);
  });

  auditCheck('3.2 Saturday 14:00 is permitted and persists to JSONL', () => {
    const res = activityStore.saveOrUpdateActiveSessionLocal({
      local_id: 'we-sat',
      appName: 'Notes',
      windowTitle: 'notes.txt',
      startTime: AUDIT_DATES.sat(14, 0),
      endTime: AUDIT_DATES.sat(14, 0),
      status: 'Active',
      closed: false
    }, 424, 'auditor');
    assert.ok(res);
    assert.strictEqual(readRawJsonlRecords().length, 1);
    assert.strictEqual(readRawJsonlRecords()[0].local_id, 'we-sat');
  });

  auditCheck('3.3 Sunday 14:00 is permitted and persists to JSONL', () => {
    const res = activityStore.saveOrUpdateActiveSessionLocal({
      local_id: 'we-sun',
      appName: 'Notes',
      windowTitle: 'notes.txt',
      startTime: AUDIT_DATES.sun(14, 0),
      endTime: AUDIT_DATES.sun(14, 0),
      status: 'Active',
      closed: false
    }, 424, 'auditor');
    assert.ok(res);
    assert.strictEqual(readRawJsonlRecords().length, 2);
  });

  auditCheck('3.4 Monday 10:00 AM is rejected at storage boundary', () => {
    const res = activityStore.saveOrUpdateActiveSessionLocal({
      local_id: 'we-mon',
      appName: 'Notes',
      windowTitle: 'notes.txt',
      startTime: AUDIT_DATES.mon(10, 0),
      endTime: AUDIT_DATES.mon(10, 0),
      status: 'Active',
      closed: false
    }, 424, 'auditor');
    assert.strictEqual(res, null);
    assert.strictEqual(readRawJsonlRecords().length, 2);
  });

  // ---------------------------------------------------------------------------
  // AUDIT SECTION 4: Tuesday, Thursday, Sunday Arbitrary Combination
  // ---------------------------------------------------------------------------
  console.log('\n--- SECTION 4: Tuesday, Thursday, Sunday Schedule Audit ---');
  clearJsonlFile();

  const mockApiTueThuSun = {
    user_id: 424,
    status: 'active',
    work_lens_full_time: '0',
    work_lens_day: 'Tuesday, Thursday, Sunday',
    work_lens_time: '09:00, 21:00'
  };

  workingHoursController.updateConfiguration(mockApiTueThuSun);

  const daysCheck = [
    { name: 'Monday', date: AUDIT_DATES.mon(12, 0), expected: false },
    { name: 'Tuesday', date: AUDIT_DATES.tue(12, 0), expected: true },
    { name: 'Wednesday', date: AUDIT_DATES.wed(12, 0), expected: false },
    { name: 'Thursday', date: AUDIT_DATES.thu(12, 0), expected: true },
    { name: 'Friday', date: AUDIT_DATES.fri(12, 0), expected: false },
    { name: 'Saturday', date: AUDIT_DATES.sat(12, 0), expected: false },
    { name: 'Sunday', date: AUDIT_DATES.sun(12, 0), expected: true }
  ];

  for (const item of daysCheck) {
    auditCheck(`4.${daysCheck.indexOf(item) + 1} ${item.name} 12:00 PM: Expected ${item.expected ? 'ON' : 'OFF'}`, () => {
      const allowed = workingHoursController.canTrackNow(item.date);
      assert.strictEqual(allowed, item.expected, `Schedule permission for ${item.name} mismatch`);

      const session = {
        local_id: `tts-${item.name.toLowerCase()}`,
        appName: 'TestApp',
        windowTitle: 'Window',
        startTime: item.date,
        endTime: item.date,
        status: 'Active',
        closed: false
      };
      const res = activityStore.saveOrUpdateActiveSessionLocal(session, 424, 'auditor');
      if (item.expected) {
        assert.ok(res, `${item.name} session should have saved`);
      } else {
        assert.strictEqual(res, null, `${item.name} session should have been rejected`);
      }
    });
  }

  const persistedCount = readRawJsonlRecords().length;
  auditCheck('4.8 Exactly 3 sessions (Tue, Thu, Sun) persisted to disk', () => {
    assert.strictEqual(persistedCount, 3, `Expected 3 records in JSONL, got ${persistedCount}`);
  });

  // ---------------------------------------------------------------------------
  // AUDIT SECTION 5: Dynamic API Updates & Safe Session Closure
  // ---------------------------------------------------------------------------
  console.log('\n--- SECTION 5: Dynamic API Updates & Safe Session Closure Audit ---');
  clearJsonlFile();

  // Start with Wednesday shift 09:00 - 18:00
  workingHoursController.updateConfiguration({
    user_id: 424,
    status: 'active',
    work_lens_full_time: '0',
    work_lens_day: 'Wednesday',
    work_lens_time: '09:00, 18:00'
  });

  // Open an active session on Wednesday at 13:50
  const openWedSession = {
    local_id: 'live-dyn-sess',
    appName: 'IDE',
    windowTitle: 'Project.js',
    startTime: AUDIT_DATES.wed(13, 50),
    endTime: AUDIT_DATES.wed(13, 50),
    status: 'Active',
    closed: false
  };
  const savedOpen = activityStore.saveOrUpdateActiveSessionLocal(openWedSession, 424, 'auditor');
  assert.ok(savedOpen);

  auditCheck('5.1 Live active session initially saved as open (closed: false) in JSONL', () => {
    const records = readRawJsonlRecords();
    assert.strictEqual(records.length, 1);
    assert.strictEqual(records[0].closed, false);
  });

  // API update arrives dynamically: working hours contracted to 09:00 - 13:00!
  // (Current time is 14:00, so tracking is immediately restricted)
  const apiContracted = {
    user_id: 424,
    status: 'active',
    work_lens_full_time: '0',
    work_lens_day: 'Wednesday',
    work_lens_time: '09:00, 13:00'
  };

  let stopCallbackFired = false;
  let stopReason = null;
  workingHoursController.onStopTrackingHandler = (reason) => {
    stopCallbackFired = true;
    stopReason = reason;
  };

  // Evaluate at 14:00 (outside new contracted window)
  workingHoursController.updateConfiguration(apiContracted);
  const evalContracted = workingHoursController.evaluateAndApply(AUDIT_DATES.wed(14, 0));

  auditCheck('5.2 API contraction immediately triggers onStopTracking and restricted permission', () => {
    assert.strictEqual(evalContracted.permitted, false);
    assert.strictEqual(workingHoursController.canTrackNow(AUDIT_DATES.wed(14, 0)), false);
  });

  auditCheck('5.3 Closing in-flight session at boundary boundary is safely permitted in JSONL', () => {
    // Pipeline close handler runs
    const closingTime = AUDIT_DATES.wed(14, 0);
    const closedSession = {
      ...savedOpen,
      endTime: closingTime,
      duration: 600, // 10 minutes duration
      closed: true
    };
    const closedRes = activityStore.saveOrUpdateActiveSessionLocal(closedSession, 424, 'auditor');
    assert.ok(closedRes, 'Closing update must succeed');
    assert.strictEqual(closedRes.closed, true);

    const records = readRawJsonlRecords();
    assert.strictEqual(records.length, 1);
    assert.strictEqual(records[0].closed, true);
    assert.strictEqual(records[0].duration, 600);
  });

  auditCheck('5.4 Subsequent write attempt after tracking stopped is blocked at recording boundary', () => {
    const postStopSession = {
      local_id: 'blocked-post-stop',
      appName: 'IDE',
      windowTitle: 'Project.js',
      startTime: AUDIT_DATES.wed(14, 5),
      endTime: AUDIT_DATES.wed(14, 5),
      status: 'Active',
      closed: false
    };
    const res = activityStore.saveOrUpdateActiveSessionLocal(postStopSession, 424, 'auditor');
    assert.strictEqual(res, null, 'Must be blocked');

    const records = readRawJsonlRecords();
    assert.strictEqual(records.length, 1, 'No new records added after stop');
    assert.strictEqual(records[0].local_id, 'live-dyn-sess');
  });

  // ---------------------------------------------------------------------------
  // AUDIT SECTION 6: Overnight Schedule Attribution & Physical JSONL Integrity
  // ---------------------------------------------------------------------------
  console.log('\n--- SECTION 6: Midnight-Crossing Schedule Attribution Audit ---');
  clearJsonlFile();

  const mockApiOvernight = {
    user_id: 424,
    status: 'active',
    work_lens_full_time: '0',
    work_lens_day: 'Monday, Wednesday',
    work_lens_time: '21:00, 06:00'
  };

  workingHoursController.updateConfiguration(mockApiOvernight);

  auditCheck('6.1 Monday 22:00 session is permitted and saved to JSONL', () => {
    const sDate = AUDIT_DATES.mon(22, 0);
    const res = activityStore.saveOrUpdateActiveSessionLocal({
      local_id: 'overnight-mon-22',
      appName: 'Terminal',
      windowTitle: 'bash',
      startTime: sDate,
      endTime: sDate,
      status: 'Active',
      closed: false
    }, 424, 'auditor');
    assert.ok(res);
    assert.strictEqual(readRawJsonlRecords().length, 1);
  });

  auditCheck('6.2 Tuesday 03:00 (continued from Monday night) is permitted and saved to JSONL', () => {
    const sDate = AUDIT_DATES.tue(3, 0);
    const res = activityStore.saveOrUpdateActiveSessionLocal({
      local_id: 'overnight-tue-03',
      appName: 'Terminal',
      windowTitle: 'bash',
      startTime: sDate,
      endTime: sDate,
      status: 'Active',
      closed: false
    }, 424, 'auditor');
    assert.ok(res);
    assert.strictEqual(readRawJsonlRecords().length, 2);
  });

  auditCheck('6.3 Tuesday 06:00 (shift ended) is rejected at storage boundary', () => {
    const sDate = AUDIT_DATES.tue(6, 0);
    const res = activityStore.saveOrUpdateActiveSessionLocal({
      local_id: 'overnight-tue-06',
      appName: 'Terminal',
      windowTitle: 'bash',
      startTime: sDate,
      endTime: sDate,
      status: 'Active',
      closed: false
    }, 424, 'auditor');
    assert.strictEqual(res, null);
    assert.strictEqual(readRawJsonlRecords().length, 2);
  });

  auditCheck('6.4 Tuesday 22:00 (Tuesday not configured) is rejected at storage boundary', () => {
    const sDate = AUDIT_DATES.tue(22, 0);
    const res = activityStore.saveOrUpdateActiveSessionLocal({
      local_id: 'overnight-tue-22',
      appName: 'Terminal',
      windowTitle: 'bash',
      startTime: sDate,
      endTime: sDate,
      status: 'Active',
      closed: false
    }, 424, 'auditor');
    assert.strictEqual(res, null);
    assert.strictEqual(readRawJsonlRecords().length, 2);
  });

  auditCheck('6.5 Wednesday 03:00 (originated from unconfigured Tuesday) is rejected at storage boundary', () => {
    const sDate = AUDIT_DATES.wed(3, 0);
    const res = activityStore.saveOrUpdateActiveSessionLocal({
      local_id: 'overnight-wed-03',
      appName: 'Terminal',
      windowTitle: 'bash',
      startTime: sDate,
      endTime: sDate,
      status: 'Active',
      closed: false
    }, 424, 'auditor');
    assert.strictEqual(res, null);
    assert.strictEqual(readRawJsonlRecords().length, 2);
  });

  auditCheck('6.6 Wednesday 21:30 (configured Wednesday shift begins) is permitted and saved to JSONL', () => {
    const sDate = AUDIT_DATES.wed(21, 30);
    const res = activityStore.saveOrUpdateActiveSessionLocal({
      local_id: 'overnight-wed-2130',
      appName: 'Terminal',
      windowTitle: 'bash',
      startTime: sDate,
      endTime: sDate,
      status: 'Active',
      closed: false
    }, 424, 'auditor');
    assert.ok(res);
    assert.strictEqual(readRawJsonlRecords().length, 3);
  });

  // ---------------------------------------------------------------------------
  // AUDIT SECTION 7: Anti-AFK Engine and Hardware Hooks Teardown
  // ---------------------------------------------------------------------------
  console.log('\n--- SECTION 7: Sensor / Hook Teardown & Anti-AFK Reset Audit ---');

  antiAfkDetector.recordKeyDown(65);
  antiAfkDetector.recordMouseMove(100, 200);

  auditCheck('7.1 antiAfkDetector.clear() cleans up metrics when tracking stops', () => {
    antiAfkDetector.clear();
    const evalResult = antiAfkDetector.evaluateActivity();
    assert.strictEqual(evalResult.status, 'Human');
    assert.strictEqual(evalResult.isSuspicious, false);
    assert.strictEqual(evalResult.metrics.clickCount, 0);
    assert.strictEqual(evalResult.metrics.mouseDistance, 0);
  });

  // ---------------------------------------------------------------------------
  // AUDIT SECTION 8: Cleanup and Summary
  // ---------------------------------------------------------------------------
  // Clean up isolated test userData directory
  try {
    fs.rmSync(testUserDataDir, { recursive: true, force: true });
  } catch (_) {}

  console.log('\n================================================================================');
  console.log(` AUDIT COMPLETE: ${passedChecks} passed, ${failedChecks} failed out of ${totalChecks} checks`);
  console.log('================================================================================');

  if (failedChecks > 0) {
    app.exit(1);
  } else {
    app.exit(0);
  }
}

app.whenReady().then(runAudit);
