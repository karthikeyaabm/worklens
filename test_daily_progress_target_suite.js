// test_daily_progress_target_suite.js
// Verification suite for WorkLens Dashboard 9h 30m (570 minutes) fixed daily progress target calculation

const assert = require('assert');
const path = require('path');
const popupModule = require('./renderer/activity-popup.js');

const {
  DAILY_TARGET_MINUTES,
  DAILY_TARGET_SECONDS,
  DAILY_REFERENCE_MINUTES,
  DAILY_REFERENCE_SECONDS,
  STANDARD_TARGET_MINUTES,
  STANDARD_TARGET_SECONDS,
  STANDARD_TARGET_HOURS,
  calculateDailyProgressPercentages,
  calculateDailyProgressPercentagesMinutes,
  calculateProgressPercent,
  getDailyActiveTimeColor,
  renderHistoryView
} = popupModule;

console.log('================================================================================');
console.log(' WORKLENS DASHBOARD: 9h 30m (570m) FIXED PROGRESS TARGET VERIFICATION SUITE   ');
console.log('================================================================================\n');

let total = 0;
let passed = 0;

function runTest(name, fn) {
  total++;
  try {
    fn();
    console.log(`  PASS: [${total}] ${name}`);
    passed++;
  } catch (err) {
    console.error(`  FAIL: [${total}] ${name}`);
    console.error(`    Error: ${err.message}`);
    throw err;
  }
}

// ---------------------------------------------------------------------------------
// 1. Target Constants
// ---------------------------------------------------------------------------------
console.log('--- 1. Target Constants ---');

runTest('Daily Target constants must be 570 minutes and 34,200 seconds', () => {
  assert.strictEqual(DAILY_TARGET_MINUTES, 570, 'Target minutes must be 570 (9h 30m)');
  assert.strictEqual(DAILY_TARGET_SECONDS, 34200, 'Target seconds must be 34200 (570 * 60)');
  assert.strictEqual(DAILY_REFERENCE_MINUTES, 570, 'Reference minutes must be 570 (9h 30m)');
  assert.strictEqual(DAILY_REFERENCE_SECONDS, 34200, 'Reference seconds must be 34200');
  assert.strictEqual(STANDARD_TARGET_HOURS, 8, 'Standard target must be 8 hours');
  assert.strictEqual(STANDARD_TARGET_MINUTES, 480, 'Standard target must be 480 minutes');
  assert.strictEqual(STANDARD_TARGET_SECONDS, 28800, 'Standard target must be 28,800 seconds');
});

// ---------------------------------------------------------------------------------
// 2. Exact Specification Benchmark Examples
// ---------------------------------------------------------------------------------
console.log('\n--- 2. Exact Specification Benchmark Examples ---');

runTest('Example 1: 4h 45m = 50%', () => {
  const sec = (4 * 60 + 45) * 60; // 285 minutes = 17100 seconds
  const res = calculateDailyProgressPercentages(sec, 0);
  assert.strictEqual(Number(res.rawTotalPercentage.toFixed(2)), 50.00, '4h 45m must be 50.00%');
  assert.strictEqual(Number(res.regularPercentage.toFixed(2)), 50.00);
});

runTest('Example 2: 7h = 73.68%', () => {
  const sec = 7 * 3600; // 420 minutes = 25200 seconds
  const res = calculateDailyProgressPercentages(sec, 0);
  assert.strictEqual(Number(res.rawTotalPercentage.toFixed(2)), 73.68, '7h must be 73.68%');
  assert.strictEqual(Number(res.regularPercentage.toFixed(2)), 73.68);
});

runTest('Example 3: 7h 30m = 78.95%', () => {
  const sec = (7 * 60 + 30) * 60; // 450 minutes = 27000 seconds
  const res = calculateDailyProgressPercentages(sec, 0);
  assert.strictEqual(Number(res.rawTotalPercentage.toFixed(2)), 78.95, '7h 30m must be 78.95%');
  assert.strictEqual(Number(res.regularPercentage.toFixed(2)), 78.95);
});

runTest('Example 4: 9h = 94.74%', () => {
  const sec = 9 * 3600; // 540 minutes = 32400 seconds
  const res = calculateDailyProgressPercentages(sec, 0);
  assert.strictEqual(Number(res.rawTotalPercentage.toFixed(2)), 94.74, '9h must be 94.74%');
  assert.strictEqual(Number(res.regularPercentage.toFixed(2)), 94.74);
});

runTest('Example 5: 9h 30m = 100%', () => {
  const sec = (9 * 60 + 30) * 60; // 570 minutes = 34200 seconds
  const res = calculateDailyProgressPercentages(sec, 0);
  assert.strictEqual(Number(res.rawTotalPercentage.toFixed(2)), 100.00, '9h 30m must reach exactly 100%');
  assert.strictEqual(res.regularPercentage, 100.00);
});

runTest('Example 6: 10h = 105.26%, visually capped at 100%', () => {
  const sec = 10 * 3600; // 600 minutes = 36000 seconds
  const res = calculateDailyProgressPercentages(sec, 0);
  assert.strictEqual(Number(res.rawTotalPercentage.toFixed(2)), 105.26, '10h raw must be 105.26%');
  assert.strictEqual(res.regularPercentage, 100.00, '10h visual progress bar must be capped at 100%');
  assert.strictEqual(res.cappedTotalPercentage, 100.00);
});

// ---------------------------------------------------------------------------------
// 3. Color Rules Preservation
// ---------------------------------------------------------------------------------
console.log('\n--- 3. Color Threshold Rules Preservation ---');

runTest('Red threshold: Under 7 hours (< 420m / < 25200s)', () => {
  assert.strictEqual(getDailyActiveTimeColor(0), 'red');
  assert.strictEqual(getDailyActiveTimeColor((4 * 60 + 45) * 60), 'red'); // 4h 45m -> Red
  assert.strictEqual(getDailyActiveTimeColor(25199), 'red'); // 6h 59m 59s -> Red
});

runTest('Blue and Yellow thresholds: 7h00m (Blue), 7h15m (Yellow), 7h30m (Blue)', () => {
  assert.strictEqual(getDailyActiveTimeColor(25200), 'blue'); // exactly 7h 00m -> Blue
  assert.strictEqual(getDailyActiveTimeColor(26100), 'yellow'); // 7h 15m -> Yellow
  assert.strictEqual(getDailyActiveTimeColor(27000), 'blue'); // exactly 7h 30m -> Blue
});

runTest('Green threshold: Over 7h 30m (> 450m / > 27000s)', () => {
  assert.strictEqual(getDailyActiveTimeColor(27001), 'green'); // 7h 30m 01s -> Green
  assert.strictEqual(getDailyActiveTimeColor(32400), 'green'); // 9h -> Green
  assert.strictEqual(getDailyActiveTimeColor(34200), 'green'); // 9h 30m -> Green
  assert.strictEqual(getDailyActiveTimeColor(36000), 'green'); // 10h -> Green
});

// ---------------------------------------------------------------------------------
// 4. Combined Regular + Yellow Scaling (Both on 9h 30m / 570m Reference Scale)
// ---------------------------------------------------------------------------------
console.log('\n--- 4. Combined Regular + Yellow Segment Progress & Capping ---');

runTest('Combined 6h Regular + 2h Yellow: both scaled independently against 9h 30m', () => {
  const regSec = 6 * 3600; // 360m -> 63.16%
  const yelSec = 2 * 3600; // 120m -> 21.05%
  const res = calculateDailyProgressPercentages(regSec, yelSec);
  assert.strictEqual(Number(res.rawTotalPercentage.toFixed(2)), 84.21);
  assert.strictEqual(Number(res.regularPercentage.toFixed(2)), 63.16);
  assert.strictEqual(Number(res.yellowPercentage.toFixed(2)), 21.05);
  assert.ok(res.regularPercentage <= 100.00);
  assert.ok(res.yellowPercentage <= 100.00);
});

runTest('Combined 8h Regular + 3h Yellow: each individually scaled & capped at 100%', () => {
  const regSec = 8 * 3600; // 480m -> 84.21%
  const yelSec = 3 * 3600; // 180m -> 31.58%
  const res = calculateDailyProgressPercentages(regSec, yelSec);
  assert.strictEqual(Number(res.rawTotalPercentage.toFixed(2)), 115.79);
  assert.strictEqual(Number(res.regularPercentage.toFixed(2)), 84.21);
  assert.strictEqual(Number(res.yellowPercentage.toFixed(2)), 31.58);
  assert.ok(res.regularPercentage <= 100.0001);
  assert.ok(res.yellowPercentage <= 100.0001);
});

runTest('10h Yellow only (no regular) = 105.26% raw, capped at 100% visual width', () => {
  const res = calculateDailyProgressPercentages(0, 10 * 3600);
  assert.strictEqual(Number(res.rawTotalPercentage.toFixed(2)), 105.26);
  assert.strictEqual(res.regularPercentage, 0);
  assert.strictEqual(res.yellowPercentage, 100.00);
});

// ---------------------------------------------------------------------------------
// 4b. Specification Target Benchmark: 5h 9m Actual vs 8h Target
// ---------------------------------------------------------------------------------
console.log('\n--- 4b. Specification Target Benchmark: 5h 9m Tracked vs 8h Target ---');

runTest('Target Benchmark: 5h 9m (54.21%) vs 8h Target (84.21%) - Yellow visibly longer than Green', () => {
  const referenceMinutes = 9 * 60 + 30; // 570 minutes
  const actualMinutes = 5 * 60 + 9; // 309 minutes
  const targetMinutes = 8 * 60; // 480 minutes

  // Verification using minutes formula
  const actualPercent = (actualMinutes / referenceMinutes) * 100;
  const targetPercent = (targetMinutes / referenceMinutes) * 100;
  assert.strictEqual(Number(actualPercent.toFixed(2)), 54.21, 'Actual 5h 9m must be approx 54.21%');
  assert.strictEqual(Number(targetPercent.toFixed(2)), 84.21, 'Target 8h must be approx 84.21%');
  assert.ok(targetPercent > actualPercent, 'Target percent (84.21%) must be greater than actual percent (54.21%)');

  // Verification using calculateDailyProgressPercentages with seconds
  const actualSec = actualMinutes * 60; // 18,540s
  const targetSec = targetMinutes * 60; // 28,800s
  const resSec = calculateDailyProgressPercentages(actualSec, targetSec);
  assert.strictEqual(Number(resSec.regularPercentage.toFixed(2)), 54.21);
  assert.strictEqual(Number(resSec.yellowPercentage.toFixed(2)), 84.21);
  assert.ok(resSec.yellowPercentage > resSec.regularPercentage, 'Yellow bar must be visibly longer than green bar');
  assert.ok(resSec.regularPercentage <= 100.00, 'Green bar must remain within track');
  assert.ok(resSec.yellowPercentage <= 100.00, 'Yellow bar must remain within track');

  // Verification using calculateDailyProgressPercentagesMinutes
  const resMin = calculateDailyProgressPercentagesMinutes(actualMinutes, targetMinutes);
  assert.strictEqual(Number(resMin.regularPercentage.toFixed(2)), 54.21);
  assert.strictEqual(Number(resMin.yellowPercentage.toFixed(2)), 84.21);
});

// ---------------------------------------------------------------------------------
// 4c. Verification Across Other Dates (< 8h, == 8h, > 8h, > 9h 30m, 0h)
// ---------------------------------------------------------------------------------
console.log('\n--- 4c. Verification Across Other Dates (< 8h, == 8h, > 8h, > 9h 30m, 0h) ---');

runTest('Day with less than 8 hours: 4h tracked (42.11%) + 8h target (84.21%) -> Yellow > Green', () => {
  const res = calculateDailyProgressPercentages(4 * 3600, 8 * 3600);
  assert.strictEqual(Number(res.regularPercentage.toFixed(2)), 42.11);
  assert.strictEqual(Number(res.yellowPercentage.toFixed(2)), 84.21);
  assert.ok(res.yellowPercentage > res.regularPercentage);
});

runTest('Day with exactly 8 hours: 8h tracked (84.21%) + 8h target (84.21%) -> Yellow == Green', () => {
  const res = calculateDailyProgressPercentages(8 * 3600, 8 * 3600);
  assert.strictEqual(Number(res.regularPercentage.toFixed(2)), 84.21);
  assert.strictEqual(Number(res.yellowPercentage.toFixed(2)), 84.21);
  assert.strictEqual(res.regularPercentage, res.yellowPercentage);
});

runTest('Day with more than 8 hours: 9h tracked (94.74%) + 8h target (84.21%) -> Green > Yellow', () => {
  const res = calculateDailyProgressPercentages(9 * 3600, 8 * 3600);
  assert.strictEqual(Number(res.regularPercentage.toFixed(2)), 94.74);
  assert.strictEqual(Number(res.yellowPercentage.toFixed(2)), 84.21);
  assert.ok(res.regularPercentage > res.yellowPercentage);
  assert.ok(res.regularPercentage <= 100.00);
  assert.ok(res.yellowPercentage <= 100.00);
});

runTest('Day with more than 9h 30m: 10h tracked (105.26% raw, capped at 100%) + 8h target (84.21%)', () => {
  const res = calculateDailyProgressPercentages(10 * 3600, 8 * 3600);
  assert.strictEqual(Number(res.rawRegularPercentage.toFixed(2)), 105.26);
  assert.strictEqual(res.regularPercentage, 100.00, 'Green bar capped at 100%');
  assert.strictEqual(Number(res.yellowPercentage.toFixed(2)), 84.21);
  assert.ok(res.regularPercentage <= 100.00);
  assert.ok(res.yellowPercentage <= 100.00);
});

runTest('Day with 0 tracked time: 0h tracked (0%) + 8h target (84.21%) -> Yellow rendered, Green 0%', () => {
  const res = calculateDailyProgressPercentages(0, 8 * 3600);
  assert.strictEqual(res.regularPercentage, 0);
  assert.strictEqual(Number(res.yellowPercentage.toFixed(2)), 84.21);
  assert.ok(res.yellowPercentage > res.regularPercentage);
});

// ---------------------------------------------------------------------------------
// 5. DOM Rendering Verification Across Dashboard Views
// ---------------------------------------------------------------------------------
console.log('\n--- 5. DOM Rendering Verification Across Views ---');

function setupMockDom() {
  const elements = {};
  function createMockElement(tag) {
    const el = {
      tagName: tag.toUpperCase(),
      className: '',
      classList: {
        add: (c) => { if (!el.className.includes(c)) el.className += ' ' + c; },
        remove: (c) => { el.className = el.className.replace(new RegExp('\\b' + c + '\\b', 'g'), '').trim(); },
        contains: (c) => el.className.includes(c)
      },
      style: {},
      dataset: {},
      children: [],
      setAttribute: () => {},
      getAttribute: () => null,
      appendChild: (child) => { el.children.push(child); return child; },
      remove: () => {},
      addEventListener: () => {},
      querySelector: (selector) => {
        function find(node) {
          if (selector.startsWith('.')) {
            const cls = selector.slice(1);
            if (node.className && node.className.includes(cls)) return node;
          }
          for (const c of (node.children || [])) {
            const res = find(c);
            if (res) return res;
          }
          return null;
        }
        return find(el);
      }
    };
    return el;
  }

  const ids = [
    'popup-container', 'arrow', 'close-btn', 'current-date', 'loading-state',
    'error-state', 'empty-state', 'empty-msg', 'retry-btn', 'activity-list',
    'history-list', 'total-time', 'col-header-name', 'col-header-time',
    'loading-text', 'weekend-toggle-container', 'toggle-weekends', 'history-legend'
  ];

  ids.forEach(id => {
    elements[id] = createMockElement('div');
    elements[id].id = id;
  });

  const origDocument = global.document;
  global.document = {
    getElementById: (id) => elements[id] || null,
    createElement: (tag) => createMockElement(tag),
    querySelectorAll: () => []
  };

  return { elements, origDocument };
}

function teardownMockDom(domState) {
  global.document = domState.origDocument;
}

runTest('DOM Rendering: Renders rows for 4h 45m, 7h, 7h 30m, 9h 30m, and 10h with correct widths and colors', (done) => {
  const domState = setupMockDom();
  try {
    const rawData = {
      days: [
        { dateStr: '2026-10-18', duration: 17100, regularDuration: 17100, yellowDuration: 0, hasData: true }, // 4h 45m (Red)
        { dateStr: '2026-10-17', duration: 25200, regularDuration: 25200, yellowDuration: 0, hasData: true }, // 7h (Blue)
        { dateStr: '2026-10-16', duration: 27000, regularDuration: 27000, yellowDuration: 0, hasData: true }, // 7h 30m (Blue)
        { dateStr: '2026-10-15', duration: 32400, regularDuration: 32400, yellowDuration: 0, hasData: true }, // 9h (Green)
        { dateStr: '2026-10-14', duration: 34200, regularDuration: 34200, yellowDuration: 0, hasData: true }, // 9h 30m (Green)
        { dateStr: '2026-10-13', duration: 36000, regularDuration: 36000, yellowDuration: 0, hasData: true }  // 10h (Green)
      ],
      totalSeconds: 171900
    };

    popupModule.setShowWeekends(true);
    renderHistoryView(rawData);

    const historyList = domState.elements['history-list'];
    assert.strictEqual(historyList.children.length, 6, 'All 6 benchmark days must be rendered');

    // Wait for the 50ms animation trigger
    setTimeout(() => {
      try {
        const rows = historyList.children;

        // 4h 45m (row 0)
        const bar0 = rows[0].querySelector('.history-segment-regular');
        assert.ok(bar0.className.includes('color-red'));
        assert.strictEqual(parseFloat(bar0.style.width).toFixed(2), '50.00');

        // 7h (row 1)
        const bar1 = rows[1].querySelector('.history-segment-regular');
        assert.ok(bar1.className.includes('color-blue'));
        assert.strictEqual(parseFloat(bar1.style.width).toFixed(2), '73.68');

        // 7h 30m (row 2)
        const bar2 = rows[2].querySelector('.history-segment-regular');
        assert.ok(bar2.className.includes('color-blue'));
        assert.strictEqual(parseFloat(bar2.style.width).toFixed(2), '78.95');

        // 9h (row 3)
        const bar3 = rows[3].querySelector('.history-segment-regular');
        assert.ok(bar3.className.includes('color-green'));
        assert.strictEqual(parseFloat(bar3.style.width).toFixed(2), '94.74');

        // 9h 30m (row 4)
        const bar4 = rows[4].querySelector('.history-segment-regular');
        assert.ok(bar4.className.includes('color-green'));
        assert.strictEqual(parseFloat(bar4.style.width).toFixed(2), '100.00');

        // 10h (row 5)
        const bar5 = rows[5].querySelector('.history-segment-regular');
        assert.ok(bar5.className.includes('color-green'));
        assert.strictEqual(parseFloat(bar5.style.width).toFixed(2), '100.00', '10h must be visually capped at 100%');

        teardownMockDom(domState);
        console.log('    All 6 DOM rows verified with animated width percentages');
      } catch (e) {
        teardownMockDom(domState);
        throw e;
      }
    }, 60);
  } catch (err) {
    teardownMockDom(domState);
    throw err;
  }
});

runTest('DOM Rendering: Two-bar row (5h 9m tracked vs 8h target) renders yellow bar longer than green bar', (done) => {
  const domState = setupMockDom();
  try {
    const rawData = {
      days: [
        {
          dateStr: '2026-10-18',
          duration: 18540, // 5h 9m
          regularDuration: 18540,
          yellowDuration: 28800, // 8h target
          hasData: true
        }
      ],
      totalSeconds: 47340
    };

    popupModule.setShowWeekends(true);
    renderHistoryView(rawData);

    const historyList = domState.elements['history-list'];
    assert.strictEqual(historyList.children.length, 1, '1 row must be rendered');

    setTimeout(() => {
      try {
        const row = historyList.children[0];
        const greenBar = row.querySelector('.history-segment-regular');
        const yellowBar = row.querySelector('.history-segment-yellow');
        const trackWrapper = row.querySelector('.history-track-wrapper');

        assert.ok(greenBar, 'Green bar must exist');
        assert.ok(yellowBar, 'Yellow bar must exist');
        assert.ok(trackWrapper, 'Track wrapper must exist');

        const greenWidth = parseFloat(greenBar.style.width);
        const yellowWidth = parseFloat(yellowBar.style.width);

        assert.strictEqual(greenWidth.toFixed(2), '54.21', 'Green bar must be 54.21%');
        assert.strictEqual(yellowWidth.toFixed(2), '84.21', 'Yellow bar must be 84.21%');
        assert.ok(yellowWidth > greenWidth, 'Yellow 8h bar must be visibly longer than green 5h 9m bar');

        teardownMockDom(domState);
        console.log('    Two-bar DOM row verified: Green 54.21% vs Yellow 84.21%');
      } catch (e) {
        teardownMockDom(domState);
        throw e;
      }
    }, 60);
  } catch (err) {
    teardownMockDom(domState);
    throw err;
  }
});

// ---------------------------------------------------------------------------------
// SUMMARY
// ---------------------------------------------------------------------------------
setTimeout(() => {
  console.log('\n================================================================================');
  console.log(` ALL ${passed}/${total} PROGRESS TARGET TESTS PASSED - TARGET VERIFIED!`);
  console.log('================================================================================\n');
  process.exit(0);
}, 120);
