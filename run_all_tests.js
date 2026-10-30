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
  },
  {
    name: '9. Python Mouse Automation Pattern Detection Suite',
    file: 'test_mouse_pattern_suite.js',
    runner: 'node',
    description: 'Periodic clicks, mouse vibration, back-and-forth, random movement annotation'
  },
  {
    name: '10. Dashboard Weekend Visibility Toggle Suite',
    file: 'test_weekend_toggle_suite.js',
    runner: 'node',
    description: 'Show Weekends checkbox, Sat & Sun filtering, zero-activity preservation, tab sync'
  },
  {
    name: '11. Dashboard Dynamic Progress Bar Color Suite',
    file: 'test_progress_bar_colors_suite.js',
    runner: 'node',
    description: 'Dynamic Active Time progress bar colors: Red (<7h), Blue (7h-7h30m), Green (>7h30m)'
  },
  {
    name: '12. Dashboard Title Truncation & Tooltip Suite',
    file: 'test_title_truncation_suite.js',
    runner: 'node',
    description: 'Compact display, ellipsis truncation, responsive layout, full title tooltip, keyboard focus'
  },
  {
    name: '13. Redmine Time Integration & Yellow Progress Bar Segments Suite',
    file: 'test_redmine_yellow_integration_suite.js',
    runner: 'node',
    description: 'Redmine time entries aggregation, 5 yellow categories classification, segmented progress bar rendering'
  },
  {
    name: '14. Dashboard 9h 30m Progress Target Suite',
    file: 'test_daily_progress_target_suite.js',
    runner: 'node',
    description: 'Fixed 9h 30m (570m) progress target, loggedActiveMinutes / 570 * 100, visual capping at 100%'
  },
  {
    name: '15. Dashboard Hour-Wise Activity & Dropdowns Suite',
    file: 'test_hourly_activity_suite.js',
    runner: 'node',
    description: 'Hourly slots, exact interval calculation, proportional multi-hour splits, independent expand/collapse'
  },
  {
    name: '16. Dashboard App-Wise / Hours-Wise View Toggle Suite',
    file: 'test_app_hours_toggle_suite.js',
    runner: 'node',
    description: 'Segmented view toggle, app-wise aggregation, share of total tracked time, in-place switching, date preservation'
  },
  {
    name: '17. Dashboard Redmine Working Hours & Category Preservation Suite',
    file: 'test_redmine_working_hours_dashboard_suite.js',
    runner: 'node',
    description: 'Redmine API Working hours Neon Green #00E676 progress bar, 6 category colors preservation, 9h 30m scaling'
  },
  {
    name: '18. Dashboard Query Performance & Four-Period Optimization Suite',
    file: 'test_dashboard_performance_suite.js',
    runner: 'electron',
    description: 'Ultra-fast Today/Yesterday/7d/30d resolution, in-memory date index, non-blocking hydration, deduplication'
  },
  {
    name: '19. Midnight Session Split & Local Day Boundary Suite',
    file: 'test_midnight_session_split_suite.js',
    runner: 'electron',
    description: 'Automatic 12:00:00 AM / 11:59:59 PM session splitting, zero cross-day records, offline preservation'
  },
  {
    name: '20. Future-Date Cascade Prevention & Midnight Recovery Suite',
    file: 'test_future_date_midnight_recovery_suite.js',
    runner: 'electron',
    description: 'Boundary safety, future-date rejection, duration sanity quarantine, idempotent split, retry integrity'
  },
  {
    name: '21. Reportees Dashboard & Team History Integration Suite',
    file: 'test_reportees_dashboard_suite.js',
    runner: 'node',
    description: 'Dynamic navigation tab, total_reportees visibility, summary metrics, individual reportee progress bars and activity tables'
  },
  {
    name: '22. Today & Historical Dashboard Total Time Alignment Suite',
    file: 'test_today_history_alignment_suite.js',
    runner: 'node',
    description: 'Single-source alignment of Today Total Time across Today tab, Last 7 Days, and Last 30 Days'
  },
  {
    name: '23. First-Launch Username Verification Suite',
    file: 'test_username_verification_suite.js',
    runner: 'electron',
    description: 'First-launch admin username prompt, backend verification source-of-truth, session recovery & revocation'
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

    const suiteEnv = { ...process.env, NODE_ENV: 'test' };
    if (suite.runner === 'electron') {
      delete suiteEnv.ELECTRON_RUN_AS_NODE;
    }

    const proc = spawnSync(cmd, [suiteFilePath], {
      cwd: __dirname,
      encoding: 'utf8',
      env: suiteEnv
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
