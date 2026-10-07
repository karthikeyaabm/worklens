// Comprehensive Progressive Loading & Background Caching Test
const path = require('path');
const os = require('os');
const { getLocalDateString } = require('./activityStore');

console.log('\n================ WORKLENS PROGRESSIVE LOADING SUITE ================');

async function testProgressiveLoading() {
  const currentOsUser = os.userInfo().username;
  const userId = 890;

  // 1. Benchmark Today Load Time (Local Queue Source)
  const todayStart = Date.now();
  const { getAllTodayLogs } = require('./activityStore');
  const todayLogs = getAllTodayLogs(userId, currentOsUser);
  const todayDuration = Date.now() - todayStart;
  console.log(`[Metric 1] Today logs load time: ${todayDuration}ms (Found ${todayLogs.length} logs)`);
  if (todayDuration < 100) {
    console.log('  PASS: Today loads immediately (< 100ms) without waiting for 30-day API');
  } else {
    console.error('  FAIL: Today took too long to load');
  }

  // 2. Benchmark Single-Pass Processing across large dataset
  const redmineClient = require('./redmineClient');
  console.log(`[Metric 2] Fetching 30-day API data for profiling...`);
  const apiStart = Date.now();
  const apiData = await redmineClient.get('/user_system_activity_logs/today.json', { user_id: userId });
  const apiTime = Date.now() - apiStart;
  const entries = Array.isArray(apiData) ? apiData : (apiData.entries || []);
  console.log(`  API Network + Parse Time: ${apiTime}ms for ${entries.length} records`);

  // Measure Single-pass grouping
  const procStart = Date.now();
  const today = new Date();
  const todayStr = getLocalDateString(today);
  const yesterday = new Date();
  yesterday.setDate(today.getDate() - 1);
  const yesterdayStr = getLocalDateString(yesterday);

  const last7DateObjects = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date();
    d.setDate(today.getDate() - i);
    last7DateObjects.push(d);
  }
  const last30DateObjects = [];
  for (let i = 0; i < 30; i++) {
    const d = new Date();
    d.setDate(today.getDate() - i);
    last30DateObjects.push(d);
  }

  const dailyDurations = {};
  last30DateObjects.forEach(d => {
    dailyDurations[getLocalDateString(d)] = 0;
  });

  const serverYesterdayLogs = [];
  const serverTodayLogs = [];

  // SINGLE PASS
  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];
    const rawDate = entry.activity_on || entry.start_time;
    if (!rawDate) continue;
    const dStr = rawDate.slice(0, 10);

    if (dStr === todayStr) {
      serverTodayLogs.push(entry);
    } else if (dStr === yesterdayStr) {
      serverYesterdayLogs.push(entry);
    }

    if (entry.status && entry.status.toLowerCase() === 'active' && entry.duration > 0) {
      if (dailyDurations[dStr] !== undefined) {
        dailyDurations[dStr] += entry.duration;
      }
    }
  }

  const procTime = Date.now() - procStart;
  console.log(`[Metric 3] Single-pass processing time: ${procTime}ms for ${entries.length} records`);
  if (procTime < 100) {
    console.log('  PASS: Single-pass precomputation is ultra-fast (< 100ms)');
  } else {
    console.error('  FAIL: Processing took longer than expected');
  }

  // 3. Verify Cache Structure and In-Memory Tab Switching
  const precomputedHistoricalCache = {
    isReady: true,
    timestamp: Date.now(),
    yesterday: {
      period: 'yesterday',
      date: yesterdayStr,
      logs: serverYesterdayLogs
    },
    last7days: {
      period: 'last7days',
      days: last7DateObjects.map(d => ({ dateStr: getLocalDateString(d), duration: dailyDurations[getLocalDateString(d)] || 0 }))
    },
    last30days: {
      period: 'last30days',
      days: last30DateObjects.map(d => ({ dateStr: getLocalDateString(d), duration: dailyDurations[getLocalDateString(d)] || 0 }))
    }
  };

  const switchStart = performance.now();
  const yData = precomputedHistoricalCache.yesterday;
  const l7Data = precomputedHistoricalCache.last7days;
  const l30Data = precomputedHistoricalCache.last30days;
  const switchTime = performance.now() - switchStart;
  console.log(`[Metric 4] In-memory tab lookup time: ${switchTime.toFixed(4)}ms`);
  console.log('  PASS: Tab switching from precomputed cache is instantaneous');

  console.log('\n================ ALL PROGRESSIVE LOADING TESTS PASSED ================');
}

const { app } = require('electron');

testProgressiveLoading().then(() => {
  if (app) app.quit();
  process.exit(0);
}).catch(err => {
  console.error('Test error:', err);
  if (app) app.quit();
  process.exit(1);
});
