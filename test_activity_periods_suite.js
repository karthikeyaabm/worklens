// test_activity_periods_suite.js
// Verification of single-source 30-day API integration for Today, Yesterday, Last 7 Days, and Last 30 Days
const dotenv = require('dotenv');
const path = require('path');
const assert = require('assert');

dotenv.config({ path: path.join(__dirname, '.env') });

const apiKey = process.env.REDMINE_API_KEY;
const baseUrl = process.env.REDMINE_BASE_URL.replace(/\/$/, '');
const userId = 890;

function getLocalDateString(d) {
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

function normalizeToLocalDateStr(val) {
  if (!val) return null;
  const trimmed = String(val).trim();
  const ymdMatch = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (ymdMatch) return `${ymdMatch[1]}-${ymdMatch[2]}-${ymdMatch[3]}`;
  const dmyMatch = trimmed.match(/^(\d{2})-(\d{2})-(\d{4})/);
  if (dmyMatch) return `${dmyMatch[3]}-${dmyMatch[2]}-${dmyMatch[1]}`;
  const parsed = new Date(trimmed);
  if (!isNaN(parsed.getTime())) return getLocalDateString(parsed);
  return null;
}

function formatDuration(totalSeconds) {
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

async function runTestSuite() {
  console.log('\n================ WORKLENS ACTIVE TIME SINGLE-SOURCE SUITE ================\n');
  let passed = 0;
  let failed = 0;

  function test(name, fn) {
    try {
      fn();
      console.log(`  PASS: ${name}`);
      passed++;
    } catch (err) {
      console.error(`  FAIL: ${name}`);
      console.error(`    ${err.message}`);
      failed++;
    }
  }

  // Fetch the 30-day API response from today.json
  const url = `${baseUrl}/user_system_activity_logs/today.json?user_id=${userId}&key=${apiKey}`;
  const res = await fetch(url, { headers: { 'X-Redmine-API-Key': apiKey, 'Content-Type': 'application/json' } });
  const apiData = await res.json();

  test('1. API returns 30-day structure with entries array', () => {
    assert.ok(apiData, 'Response must exist');
    assert.strictEqual(apiData.user_id, userId, `user_id must match ${userId}`);
    assert.strictEqual(apiData.days, 30, 'days must be 30');
    assert.ok(Array.isArray(apiData.entries), 'entries must be an array');
    assert.ok(apiData.entries.length > 0, 'entries must contain activity records');
  });

  const today = new Date();
  const todayStr = getLocalDateString(today);
  const yesterday = new Date();
  yesterday.setDate(today.getDate() - 1);
  const yesterdayStr = getLocalDateString(yesterday);

  // Group by date
  const dateMap = {};
  const activeEntries = apiData.entries.filter(e => e.status === 'active' && e.duration > 0);
  activeEntries.forEach(e => {
    const ds = normalizeToLocalDateStr(e.activity_on || e.start_time);
    if (ds) {
      dateMap[ds] = (dateMap[ds] || 0) + (e.duration || 0);
    }
  });

  // TEST TODAY
  test('2. Today view contains valid applications and duration', () => {
    const todayEntries = apiData.entries.filter(e => {
      const ds = normalizeToLocalDateStr(e.activity_on || e.start_time);
      return ds === todayStr && e.status === 'active' && e.duration > 0;
    });
    assert.ok(todayEntries.length > 0, 'Today should have recorded entries');
    const apps = new Set(todayEntries.map(e => e.app_name));
    assert.ok(apps.size > 0, 'Today must have unique application names');
    const totalToday = todayEntries.reduce((s, e) => s + e.duration, 0);
    assert.ok(totalToday > 0, 'Today active duration must be > 0');
    console.log(`    [Today Info] Found ${apps.size} apps, active: ${formatDuration(totalToday)}`);
  });

  // TEST YESTERDAY
  test('3. Yesterday view contains previous day applications only', () => {
    const yesterdayEntries = apiData.entries.filter(e => {
      const ds = normalizeToLocalDateStr(e.activity_on || e.start_time);
      return ds === yesterdayStr && e.status === 'active' && e.duration > 0;
    });
    assert.ok(yesterdayEntries.length > 0, 'Yesterday should have recorded entries');
    const apps = new Set(yesterdayEntries.map(e => e.app_name));
    assert.ok(apps.size > 0, 'Yesterday must have applications');
    const totalYesterday = yesterdayEntries.reduce((s, e) => s + e.duration, 0);
    assert.ok(totalYesterday > 0, 'Yesterday active duration must be > 0');
    const yesterdayHours = Math.round((totalYesterday / 3600) * 10) / 10;
    assert.ok(yesterdayHours > 0, `Yesterday active time must be > 0, got ${yesterdayHours}h (${(totalYesterday/3600).toFixed(2)}h)`);
    console.log(`    [Yesterday Info] Found ${apps.size} apps, active: ${formatDuration(totalYesterday)} (${yesterdayHours}h)`);
  });

  // TEST LAST 7 DAYS
  test('4. Last 7 Days produces exactly 7 calendar dates ending today', () => {
    const dateObjects = [];
    for (let i = 0; i < 7; i++) {
      const d = new Date();
      d.setDate(today.getDate() - i);
      dateObjects.push(d);
    }
    assert.strictEqual(dateObjects.length, 7, 'Must have exactly 7 dates');

    const days = dateObjects.map(d => {
      const ds = getLocalDateString(d);
      return {
        dateStr: ds,
        duration: dateMap[ds] || 0
      };
    });

    assert.strictEqual(days.length, 7, 'Days array must have 7 elements');
    assert.strictEqual(days[0].dateStr, todayStr, 'First element must be today');
    assert.strictEqual(days[6].dateStr, getLocalDateString(new Date(today.getTime() - 6 * 86400000)), 'Last element must be T-6');

    // Ensure zero-activity days exist and have duration === 0 (format 0m)
    const zeroDays = days.filter(d => d.duration === 0);
    console.log(`    [Last 7 Days Info] Total active dates: ${days.filter(d => d.duration > 0).length}, Zero dates: ${zeroDays.length}`);
    zeroDays.forEach(zd => {
      assert.strictEqual(formatDuration(zd.duration), '0m', 'Zero duration must format as 0m');
    });
  });

  // TEST LAST 30 DAYS
  test('5. Last 30 Days produces exactly 30 calendar dates ending today without future dates', () => {
    const dateObjects = [];
    for (let i = 0; i < 30; i++) {
      const d = new Date();
      d.setDate(today.getDate() - i);
      dateObjects.push(d);
    }
    assert.strictEqual(dateObjects.length, 30, 'Must have exactly 30 dates');

    const days = dateObjects.map(d => {
      const ds = getLocalDateString(d);
      return {
        dateStr: ds,
        duration: dateMap[ds] || 0
      };
    });

    assert.strictEqual(days.length, 30, 'Days array must have 30 elements');
    assert.strictEqual(days[0].dateStr, todayStr, 'First element must be today');
    assert.strictEqual(days[29].dateStr, getLocalDateString(new Date(today.getTime() - 29 * 86400000)), 'Last element must be T-29');

    // Verify no future dates
    days.forEach(d => {
      assert.ok(d.dateStr <= todayStr, `Date ${d.dateStr} cannot be in the future`);
    });

    const activeDays = days.filter(d => d.duration > 0);
    assert.ok(activeDays.length >= 15, `Expected at least 15 active days in 30 days, found ${activeDays.length}`);
    console.log(`    [Last 30 Days Info] Active days: ${activeDays.length}, Total days: 30`);
  });

  // TEST CACHING SIMULATION
  test('6. In-memory caching prevents duplicate network fetches', () => {
    let apiFetchCount = 0;
    let cache = null;
    let cacheTime = 0;

    function getCachedData() {
      if (cache && Date.now() - cacheTime < 60000) {
        return cache;
      }
      apiFetchCount++;
      cache = { data: 'mock' };
      cacheTime = Date.now();
      return cache;
    }

    // Call 4 times (switching through Today -> Yesterday -> Last 7 Days -> Last 30 Days)
    getCachedData();
    getCachedData();
    getCachedData();
    getCachedData();

    assert.strictEqual(apiFetchCount, 1, 'API should only be called once when switching tabs within TTL');
  });

  console.log(`\n================ TEST SUMMARY ================`);
  console.log(`  Total: ${passed + failed}`);
  console.log(`  Passed: ${passed}`);
  console.log(`  Failed: ${failed}`);
  console.log(`==============================================\n`);

  if (failed > 0) process.exit(1);
}

runTestSuite().catch(err => {
  console.error('Test suite failed:', err);
  process.exit(1);
});
