const { app } = require('electron');
const path = require('path');
const os = require('os');
const fs = require('fs');

const realUserData = path.join(process.env.APPDATA, 'WorkLens');
app.setPath('userData', realUserData);

async function runApiBenchmark() {
  console.log('\n================ BACKEND API / IPC BENCHMARK ================');
  // Require main or simulate handleFetchActivity from main
  // Let's inspect timing of the IPC handlers
  const store = require('../activityStore');
  const user = os.userInfo().username;
  const userId = 890;

  // Measure handleFetchActivity for 'today'
  console.log('Testing handleFetchActivity logic...');

  // 1. Measure Today
  const tToday0 = performance.now();
  const todayLogs = store.getAllTodayLogs(userId, user);
  const persistedStart = store.getPersistedDailyStartTime(store.getLocalDateString(), user, userId);
  let todayStart = persistedStart;
  let todayEnd = null;
  todayLogs.forEach(e => {
    const s = store.parseTimestampToDate(e.start_time);
    const end = store.parseTimestampToDate(e.end_time);
    if (s && (!todayStart || s < todayStart)) todayStart = s;
    if (end && (!todayEnd || end > todayEnd)) todayEnd = end;
  });
  const tToday = performance.now() - tToday0;
  console.log(`Today resolution: ${tToday.toFixed(2)} ms (logs: ${todayLogs.length})`);

  // 2. Measure Yesterday
  const tYest0 = performance.now();
  const yest = new Date();
  yest.setDate(yest.getDate() - 1);
  const yestStr = store.getLocalDateString(yest);
  const yestLogs = store.getActivityLogsForDate(yestStr, userId, user);
  let yMin = null, yMax = null;
  yestLogs.forEach(c => {
    const s = store.parseTimestampToDate(c.start_time);
    const e = store.parseTimestampToDate(c.end_time);
    if (s && (!yMin || s < yMin)) yMin = s;
    if (e && (!yMax || e > yMax)) yMax = e;
  });
  const tYest = performance.now() - tYest0;
  console.log(`Yesterday resolution: ${tYest.toFixed(2)} ms (logs: ${yestLogs.length})`);

  // 3. Measure Last 7 Days offline resolution
  const tL70 = performance.now();
  const l7Dates = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    l7Dates.push(store.getLocalDateString(d));
  }
  const l7Dur = store.getDateWiseActiveDurations(l7Dates, userId, user);
  const l7Ranges = store.getDateWiseTimeRanges(l7Dates, userId, user);
  const redmineTime = require('../redmineTimeIntegration');
  const l7View = redmineTime.buildCombinedHistoricalView({
    periodName: 'last7days',
    dateObjects: l7Dates.map(ds => new Date(ds)),
    dailyDurations: l7Dur,
    dailyTimeRanges: l7Ranges,
    redmineAggregation: null,
    todayStr: store.getLocalDateString(),
    isCurrentlyTracking: true,
    formatTime12Fn: store.formatTime12
  });
  const tL7 = performance.now() - tL70;
  console.log(`Last 7 Days resolution: ${tL7.toFixed(2)} ms`);

  // 4. Measure Last 30 Days offline resolution
  const tL300 = performance.now();
  const l30Dates = [];
  for (let i = 0; i < 30; i++) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    l30Dates.push(store.getLocalDateString(d));
  }
  const l30Dur = store.getDateWiseActiveDurations(l30Dates, userId, user);
  const l30Ranges = store.getDateWiseTimeRanges(l30Dates, userId, user);
  const l30View = redmineTime.buildCombinedHistoricalView({
    periodName: 'last30days',
    dateObjects: l30Dates.map(ds => new Date(ds)),
    dailyDurations: l30Dur,
    dailyTimeRanges: l30Ranges,
    redmineAggregation: null,
    todayStr: store.getLocalDateString(),
    isCurrentlyTracking: true,
    formatTime12Fn: store.formatTime12
  });
  const tL30 = performance.now() - tL300;
  console.log(`Last 30 Days resolution: ${tL30.toFixed(2)} ms`);
  console.log('===============================================================\n');

  if (app) app.quit();
  process.exit(0);
}

runApiBenchmark().catch(err => {
  console.error('Benchmark failed:', err);
  if (app) app.quit();
  process.exit(1);
});
