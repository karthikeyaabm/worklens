// test_today_history_alignment_suite.js
// Verification of single-source alignment between Today Total Time and Last 7 Days / Last 30 Days views

const assert = require('assert');
const popupRenderer = require('./renderer/activity-popup');

let passed = 0;
let failed = 0;

function runTest(name, fn) {
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

function createMockElement(tag = 'div') {
  const children = [];
  const classList = new Set();
  const attributes = {};
  const style = {};
  const dataset = {};

  return {
    tagName: tag.toUpperCase(),
    children,
    style,
    dataset,
    innerHTML: '',
    textContent: '',
    title: '',
    tabIndex: 0,
    scrollTop: 0,
    classList: {
      add: (...cls) => cls.forEach(c => classList.add(c)),
      remove: (...cls) => cls.forEach(c => classList.delete(c)),
      toggle: (c, force) => {
        if (force === undefined) {
          if (classList.has(c)) classList.delete(c);
          else classList.add(c);
        } else if (force) {
          classList.add(c);
        } else {
          classList.delete(c);
        }
      },
      contains: (c) => classList.has(c)
    },
    setAttribute: (name, val) => { attributes[name] = String(val); },
    getAttribute: (name) => attributes[name] || null,
    appendChild: (child) => { children.push(child); return child; },
    querySelector: () => null,
    querySelectorAll: () => []
  };
}

function setupMockDom() {
  const elements = {
    'history-list': createMockElement('div'),
    'total-time': createMockElement('div'),
    'empty-state': createMockElement('div'),
    'empty-msg': createMockElement('p'),
    'loading-state': createMockElement('div'),
    'error-state': createMockElement('div'),
    'activity-list': createMockElement('div')
  };

  const origDocument = global.document;
  global.document = {
    getElementById: (id) => elements[id] || null,
    createElement: (tag) => createMockElement(tag),
    querySelectorAll: () => []
  };

  return { elements, origDocument };
}

function teardownMockDom(domState) {
  if (domState && domState.origDocument) {
    global.document = domState.origDocument;
  } else {
    delete global.document;
  }
}

async function main() {
  console.log('\n================ WORKLENS TODAY & HISTORICAL ALIGNMENT SUITE ================\n');

  // Test 1: computeAppWiseActivity correctly calculates Today's Total Time
  runTest('1. computeAppWiseActivity returns exact total active duration without counting inactive logs', () => {
    const mockLogs = [
      { app_name: 'Code', duration: 3600, status: 'Active' },
      { app_name: 'Chrome', duration: 1800, status: 'Active' },
      { app_name: 'Idle Screen', duration: 900, status: 'Inactive' }
    ];
    const { totalDailySeconds, sortedApps } = popupRenderer.computeAppWiseActivity(mockLogs);
    assert.strictEqual(totalDailySeconds, 5400, 'Total daily active seconds must be 5400 (1h 30m)');
    assert.strictEqual(sortedApps.length, 2, 'Only 2 active apps should be included');
  });

  // Test 2: renderHistoryView synchronizes Today row with clientViewCache.today
  runTest('2. renderHistoryView updates Today row duration and times to match clientViewCache.today', () => {
    const dom = setupMockDom();
    try {
      // Mock clientViewCache.today
      const todayLogs = [
        { app_name: 'WorkLens', duration: 7200, status: 'Active' }, // 2h
        { app_name: 'Teams', duration: 3600, status: 'Active' }     // 1h
      ];

      // Raw historical data where Today's row had an older/stale duration (e.g. 1800s / 30m)
      const rawData = {
        period: 'last7days',
        days: [
          {
            dateStr: '2026-10-29',
            isToday: true,
            duration: 1800,
            regularDuration: 1800,
            activeSeconds: 1800,
            yellowDuration: 0,
            startTime: '09:00 AM',
            endTime: 'Present'
          },
          {
            dateStr: '2026-10-28',
            isToday: false,
            duration: 28800,
            regularDuration: 28800,
            activeSeconds: 28800,
            yellowDuration: 0,
            startTime: '09:00 AM',
            endTime: '05:00 PM'
          }
        ]
      };

      // Injected caches
      popupRenderer.setClientViewCache({
        today: {
          date: '2026-10-29',
          logs: todayLogs,
          startTime: '09:00 AM',
          endTime: 'Present',
          isPresent: true
        }
      });

      popupRenderer.renderHistoryView(rawData);

      // Verify rawData.days[0] (Today) was synchronized to 10800s (3h)
      const todayEntry = rawData.days.find(d => d.isToday);
      assert.strictEqual(todayEntry.regularDuration, 10800, 'Today regularDuration in Last 7 Days must match Today total (10800s / 3h)');
      assert.strictEqual(todayEntry.activeSeconds, 10800, 'Today activeSeconds in Last 7 Days must match Today total (10800s / 3h)');
      assert.strictEqual(todayEntry.duration, 10800, 'Today total duration in Last 7 Days must match Today total (10800s / 3h)');
    } finally {
      teardownMockDom(dom);
    }
  });

  // Test 3: Total System time in footer accurately includes synchronized Today time
  runTest('3. Dual footer System total includes synchronized Today duration', () => {
    const dom = setupMockDom();
    try {
      const rawData = {
        period: 'last7days',
        days: [
          {
            dateStr: '2026-10-29',
            isToday: true,
            duration: 0,
            regularDuration: 0,
            activeSeconds: 0,
            yellowDuration: 0
          },
          {
            dateStr: '2026-10-28',
            isToday: false,
            duration: 14400, // 4h
            regularDuration: 14400,
            activeSeconds: 14400,
            yellowDuration: 0
          }
        ]
      };

      popupRenderer.setClientViewCache({
        today: {
          date: '2026-10-29',
          logs: [
            { app_name: 'App1', duration: 10800, status: 'Active' } // 3h
          ]
        }
      });

      popupRenderer.renderHistoryView(rawData);

      const totalSystem = rawData.days.reduce((sum, d) => sum + (d.regularDuration !== undefined ? d.regularDuration : (d.activeSeconds || 0)), 0);
      assert.strictEqual(totalSystem, 25200, 'Sum of 3h today + 4h yesterday must equal 25200s (7h)');
    } finally {
      teardownMockDom(dom);
    }
  });

  console.log(`\n================ RESULTS: ${passed} PASSED, ${failed} FAILED ================\n`);
  if (failed > 0) process.exit(1);
}

main();
