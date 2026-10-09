// run_all_tests.js
// Master test runner for WorkLens Desktop App
// Executes all verification test suites covering changes from this week.

const { spawnSync } = require('child_process');
const path = require('path');
const electronPath = require('electron');

const TEST_SUITES = [
  {
    name: '1. Microsoft Teams Call/Meeting Tracking Suite',
    file: 'test_teams_tracking_suite.js',
    runner: 'node',
    description: 'Hardware sensors, window titles, meeting grace periods, idle timer suppression'
  },
  {
    name: '2. Local Storage Health & ENOSPC Resilience Suite',
    file: 'test_storage_health_suite.js',
    runner: 'electron',
    description: 'Disk full handling, consecutive failure threshold, cooldown, memory buffering'
  },
  {
    name: '3. PC Location Data Integration Suite',
    file: 'test_location_suite.js',
    runner: 'electron',
    description: 'Windows native geolocation, reverse geocoding, 20m cache, offline preservation'
  },
  {
    name: '4. Offline Startup & Identity Reconciliation Suite',
    file: 'test_offline_suite.js',
    runner: 'electron',
    description: 'Decoupled tracking, user profile cache, backfilling user_id, 35-day retention'
  },
  {
    name: '5. Session Start/End Time & Boundary Suite',
    file: 'test_session_times_suite.js',
    runner: 'electron',
    description: 'Earliest start, latest end, timestamp parsing ISO / DD-MM-YYYY, Present state'
  },
  {
    name: '6. Active Time Single-Source 30-Day API Suite',
    file: 'test_activity_periods_suite.js',
    runner: 'node',
    description: '30-day API structures, today/yesterday/last7/last30 periods, response cache'
  },
  {
    name: '7. Progressive Loading & Latency Benchmark Suite',
    file: 'test_progressive_loading.js',
    runner: 'electron',
    description: 'Instant local today load <100ms, single-pass processing <100ms, instant tab swap'
  },
  {
    name: '8. WorkLens Watchdog & Auto-Recovery Suite',
    file: path.join('scratch', 'test_watchdog_suite.js'),
    runner: 'node',
    description: 'Watchdog state coordination, intentional shutdown detection, registry auto-start'
  }
];

async function runAll() {
  console.log('================================================================================');
  console.log('             WORKLENS DESKTOP APP - COMPREHENSIVE TEST RUNNER                   ');
  console.log('================================================================================\n');

  const results = [];
  const overallStart = Date.now();

  for (let i = 0; i < TEST_SUITES.length; i++) {
    const suite = TEST_SUITES[i];
    console.log(`[SUITE ${i + 1}/${TEST_SUITES.length}] ${suite.name}`);
    console.log(`  File:        ${suite.file}`);
    console.log(`  Runner:      ${suite.runner}`);
    console.log(`  Description: ${suite.description}`);
    console.log('  ------------------------------------------------------------------------------');

    const cmd = suite.runner === 'electron' ? electronPath : process.execPath;
    const suiteFilePath = path.resolve(__dirname, suite.file);
    const start = Date.now();

    const proc = spawnSync(cmd, [suiteFilePath], {
      cwd: __dirname,
      encoding: 'utf8',
      env: { ...process.env, NODE_ENV: 'test' }
    });

    const duration = ((Date.now() - start) / 1000).toFixed(2);
    const passed = proc.status === 0;

    // Extract summary lines if present
    const lines = (proc.stdout || '').split('\n').map(l => l.trim()).filter(Boolean);
    const passCount = lines.filter(l => l.startsWith('PASS:')).length;
    const failCount = lines.filter(l => l.startsWith('FAIL:')).length;

    if (passed) {
      console.log(`  STATUS: PASS (${duration}s) | Passes detected: ${passCount}`);
    } else {
      console.error(`  STATUS: FAIL (${duration}s) (Exit Code: ${proc.status})`);
      if (proc.stderr) {
        console.error('  STDERR:');
        console.error(proc.stderr.slice(0, 500));
      }
      if (proc.stdout) {
        const failLines = lines.filter(l => l.includes('FAIL') || l.includes('Error'));
        if (failLines.length > 0) {
          console.error('  FAILURE DETAILS:');
          failLines.forEach(fl => console.error(`    ${fl}`));
        }
      }
    }
    console.log('');

    results.push({
      ...suite,
      passed,
      duration,
      passCount,
      failCount,
      exitCode: proc.status
    });
  }

  const overallDuration = ((Date.now() - overallStart) / 1000).toFixed(2);

  console.log('================================================================================');
  console.log('                             TEST EXECUTION SUMMARY                             ');
  console.log('================================================================================');
  console.log(
    ' Suite                                      | Runner   | Time    | Passes | Status'
  );
  console.log(
    '--------------------------------------------+----------+---------+--------+---------'
  );

  let allPassed = true;
  for (const r of results) {
    const namePadded = r.name.slice(0, 42).padEnd(42, ' ');
    const runnerPadded = r.runner.padEnd(8, ' ');
    const timePadded = `${r.duration}s`.padEnd(7, ' ');
    const passPadded = String(r.passCount).padEnd(6, ' ');
    const statusStr = r.passed ? 'PASS [OK]' : 'FAIL [X]';
    if (!r.passed) allPassed = false;
    console.log(` ${namePadded} | ${runnerPadded} | ${timePadded} | ${passPadded} | ${statusStr}`);
  }

  console.log('--------------------------------------------+----------+---------+--------+---------');
  console.log(` Total Time: ${overallDuration}s`);
  console.log(` Final Outcome: ${allPassed ? 'ALL TEST SUITES PASSED - READY FOR PRODUCTION DEPLOYMENT' : 'TEST FAILURES DETECTED'}`);
  console.log('================================================================================\n');

  if (!allPassed) {
    process.exit(1);
  } else {
    process.exit(0);
  }
}

runAll().catch(err => {
  console.error('Fatal test runner error:', err);
  process.exit(1);
});
