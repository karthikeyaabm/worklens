const { app } = require('electron');
const path = require('path');
const os = require('os');
const fs = require('fs');

const realUserData = path.join(process.env.APPDATA, 'WorkLens');
app.setPath('userData', realUserData);

async function runBenchmark() {
  const store = require('../activityStore');
  const user = os.userInfo().username;
  const today = store.getLocalDateString();
  const yest = new Date();
  yest.setDate(yest.getDate() - 1);
  const yestStr = store.getLocalDateString(yest);

  const l7 = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    l7.push(store.getLocalDateString(d));
  }

  const l30 = [];
  for (let i = 0; i < 30; i++) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    l30.push(store.getLocalDateString(d));
  }

  console.log('\n================ REAL PRODUCTION DATA QUERY BENCHMARK ================');
  console.log('Queue path:', store.getQueueFilePath());

  // Test across multiple runs to get min/avg/p95
  const runs = 10;
  const times = { today: [], yest: [], l7: [], l30: [] };

  for (let r = 0; r < runs; r++) {
    const t0 = performance.now();
    const todayLogs = store.getAllTodayLogs(890, user);
    times.today.push(performance.now() - t0);

    const t1 = performance.now();
    const yestLogs = store.getActivityLogsForDate(yestStr, 890, user);
    times.yest.push(performance.now() - t1);

    const t2 = performance.now();
    const l7Dur = store.getDateWiseActiveDurations(l7, 890, user);
    const l7Ranges = store.getDateWiseTimeRanges(l7, 890, user);
    times.l7.push(performance.now() - t2);

    const t3 = performance.now();
    const l30Dur = store.getDateWiseActiveDurations(l30, 890, user);
    const l30Ranges = store.getDateWiseTimeRanges(l30, 890, user);
    times.l30.push(performance.now() - t3);
  }

  const avg = arr => (arr.reduce((a, b) => a + b, 0) / arr.length).toFixed(2);
  const max = arr => Math.max(...arr).toFixed(2);
  const min = arr => Math.min(...arr).toFixed(2);

  console.log(`Today query:        avg: ${avg(times.today)} ms (min: ${min(times.today)} ms, max: ${max(times.today)} ms)`);
  console.log(`Yesterday query:    avg: ${avg(times.yest)} ms (min: ${min(times.yest)} ms, max: ${max(times.yest)} ms)`);
  console.log(`Last 7 Days query:  avg: ${avg(times.l7)} ms (min: ${min(times.l7)} ms, max: ${max(times.l7)} ms)`);
  console.log(`Last 30 Days query: avg: ${avg(times.l30)} ms (min: ${min(times.l30)} ms, max: ${max(times.l30)} ms)`);
  console.log('======================================================================\n');

  if (app) app.quit();
  process.exit(0);
}

runBenchmark().catch(err => {
  console.error('Benchmark failed:', err);
  if (app) app.quit();
  process.exit(1);
});
