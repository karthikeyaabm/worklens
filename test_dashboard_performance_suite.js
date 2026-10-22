// test_dashboard_performance_suite.js
// Automated verification of Dashboard Performance Optimization for Today, Yesterday, Last 7 Days, and Last 30 Days
const { app } = require('electron');
const path = require('path');
const os = require('os');
const assert = require('assert');

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

async function runPerformanceTestSuite() {
  console.log('\n================ WORKLENS DASHBOARD PERFORMANCE & ACCURACY SUITE ================\n');

  const store = require('./activityStore');
  const redmineTime = require('./redmineTimeIntegration');
  const user = os.userInfo().username;
  const userId = 890;

  const todayStr = store.getLocalDateString();
  const yest = new Date();
  yest.setDate(yest.getDate() - 1);
  const yestStr = store.getLocalDateString(yest);

  // 1. Fast Substring Date Parsing
  runTest('1. normalizeToLocalDateStr uses ultra-fast path for ISO dates', () => {
    assert.strictEqual(store.normalizeToLocalDateStr('2026-10-22 09:30:00'), '2026-10-22');
    assert.strictEqual(store.normalizeToLocalDateStr('2026-10-22T14:15:30.000Z'), '2026-10-22');
    assert.strictEqual(store.normalizeToLocalDateStr('22-10-2026 09:30:00'), '2026-10-22');
  });

  // 2. Date Indexing & In-Memory Cache
  runTest('2. getChunksForDate retrieves only chunks matching target date', () => {
    const todayChunks = store.getChunksForDate(todayStr);
    assert.ok(Array.isArray(todayChunks), 'Must return an array');
    todayChunks.forEach(c => {
      const d = store.normalizeToLocalDateStr(c.start_time || c.activity_on);
      assert.strictEqual(d, todayStr, `All chunks must belong to today (${todayStr})`);
    });

    const yestChunks = store.getChunksForDate(yestStr);
    assert.ok(Array.isArray(yestChunks), 'Must return an array');
    yestChunks.forEach(c => {
      const d = store.normalizeToLocalDateStr(c.start_time || c.activity_on);
      assert.strictEqual(d, yestStr, `All chunks must belong to yesterday (${yestStr})`);
    });
  });

  // 3. Query Execution Speed (< 20ms on production dataset)
  runTest('3. In-memory indexed query executes under 20ms', () => {
    const t0 = performance.now();
    const logs = store.getAllTodayLogs(userId, user);
    const duration = performance.now() - t0;
    console.log(`    [Perf Info] getAllTodayLogs execution time: ${duration.toFixed(3)} ms`);
    assert.ok(duration < 20, `Today query must execute in < 20ms, took ${duration.toFixed(3)} ms`);
  });

  // 4. Yesterday Accuracy
  runTest('4. Yesterday query returns exact previous day boundaries without today overlap', () => {
    const yestLogs = store.getActivityLogsForDate(yestStr, userId, user);
    assert.ok(Array.isArray(yestLogs), 'Must be an array');
    yestLogs.forEach(c => {
      const d = store.normalizeToLocalDateStr(c.start_time || c.activity_on);
      assert.strictEqual(d, yestStr, 'Yesterday records must not contain other dates');
    });
  });

  // 5. Last 7 Days Aggregation & Range Integrity
  runTest('5. Last 7 Days produces exactly 7 calendar days with accurate durations', () => {
    const l7Dates = [];
    for (let i = 0; i < 7; i++) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      l7Dates.push(store.getLocalDateString(d));
    }
    assert.strictEqual(l7Dates.length, 7);

    const t0 = performance.now();
    const durations = store.getDateWiseActiveDurations(l7Dates, userId, user);
    const timeRanges = store.getDateWiseTimeRanges(l7Dates, userId, user);
    const durTime = performance.now() - t0;

    console.log(`    [Perf Info] Last 7 Days duration & range calculation time: ${durTime.toFixed(3)} ms`);
    assert.ok(durTime < 50, `Last 7 Days queries took ${durTime.toFixed(3)} ms`);

    assert.strictEqual(Object.keys(durations).length, 7);
    assert.strictEqual(Object.keys(timeRanges).length, 7);
    l7Dates.forEach(ds => {
      assert.ok(durations[ds] !== undefined, `Duration must exist for ${ds}`);
      assert.ok(timeRanges[ds] !== undefined, `TimeRange must exist for ${ds}`);
    });
  });

  // 6. Last 30 Days Aggregation & Performance
  runTest('6. Last 30 Days produces exactly 30 calendar days efficiently', () => {
    const l30Dates = [];
    for (let i = 0; i < 30; i++) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      l30Dates.push(store.getLocalDateString(d));
    }
    assert.strictEqual(l30Dates.length, 30);

    const t0 = performance.now();
    const durations = store.getDateWiseActiveDurations(l30Dates, userId, user);
    const timeRanges = store.getDateWiseTimeRanges(l30Dates, userId, user);
    const durTime = performance.now() - t0;

    console.log(`    [Perf Info] Last 30 Days duration & range calculation time: ${durTime.toFixed(3)} ms`);
    assert.ok(durTime < 60, `Last 30 Days queries took ${durTime.toFixed(3)} ms`);

    assert.strictEqual(Object.keys(durations).length, 30);
    assert.strictEqual(Object.keys(timeRanges).length, 30);
  });

  // 7. Combined Historical View Compatibility
  runTest('7. buildCombinedHistoricalView outputs matching structures for 7d and 30d', () => {
    const l7Dates = [];
    for (let i = 0; i < 7; i++) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      l7Dates.push(store.getLocalDateString(d));
    }
    const durations = store.getDateWiseActiveDurations(l7Dates, userId, user);
    const timeRanges = store.getDateWiseTimeRanges(l7Dates, userId, user);

    const view = redmineTime.buildCombinedHistoricalView({
      periodName: 'last7days',
      dateObjects: l7Dates.map(ds => new Date(ds)),
      dailyDurations: durations,
      dailyTimeRanges: timeRanges,
      redmineAggregation: null,
      todayStr: todayStr,
      isCurrentlyTracking: true,
      formatTime12Fn: store.formatTime12
    });

    assert.strictEqual(view.period, 'last7days');
    assert.strictEqual(view.days.length, 7);
    assert.ok(view.totalSeconds !== undefined, 'totalSeconds must exist');
    assert.ok(typeof view.dateRange === 'string', 'dateRange must be string');
  });

  // 8. Cache Invalidation upon mutation
  runTest('8. invalidateChunksCache forces fresh read and re-indexing', () => {
    store.invalidateChunksCache();
    const logs = store.getAllTodayLogs(userId, user);
    assert.ok(Array.isArray(logs), 'Must reload chunks cleanly after cache invalidation');
  });

  console.log(`\n================ PERFORMANCE SUITE RESULTS: ${passedTests} PASSED, ${failedTests} FAILED ================\n`);

  if (app) app.quit();
  process.exit(failedTests > 0 ? 1 : 0);
}

runPerformanceTestSuite().catch(err => {
  console.error('Performance test suite error:', err);
  if (app) app.quit();
  process.exit(1);
});
