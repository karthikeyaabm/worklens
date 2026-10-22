// test_redmine_working_hours_dashboard_suite.js
// Verification suite for WorkLens Dashboard: Redmine API Working Hours (Neon Green #00E676)
// and Category Preservation across Last 7 Days and Last 30 Days views.

const assert = require('assert');
const redmineTimeIntegration = require('./redmineTimeIntegration.js');
const popupModule = require('./renderer/activity-popup.js');

const {
  REDMINE_CATEGORY_COLORS,
  getEntryCategory,
  aggregateRedmineTimeEntries,
  buildCombinedHistoricalView,
  formatShortHours
} = redmineTimeIntegration;

const {
  DAILY_REFERENCE_SECONDS,
  calculateDailyProgressPercentages,
  getDailyActiveTimeColor,
  renderHistoryView
} = popupModule;

console.log('================================================================================');
console.log(' WORKLENS: REDMINE WORKING HOURS & CATEGORY PRESERVATION VERIFICATION SUITE    ');
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
// 1. Category Colors Specification
// ---------------------------------------------------------------------------------
console.log('--- 1. Category Colors Specification ---');

runTest('All official category colors must match specification exactly', () => {
  assert.strictEqual(REDMINE_CATEGORY_COLORS['Big Late'], '#FF1744', 'Big Late must be #FF1744');
  assert.strictEqual(REDMINE_CATEGORY_COLORS['Early Out'], '#FFD600', 'Early Out must be #FFD600');
  assert.strictEqual(REDMINE_CATEGORY_COLORS['Leave'], '#8B5CF6', 'Leave must be #8B5CF6');
  assert.strictEqual(REDMINE_CATEGORY_COLORS['Holiday'], '#FF4081', 'Holiday must be #FF4081');
  assert.strictEqual(REDMINE_CATEGORY_COLORS['Working'], '#00E676', 'Working must be Neon Green #00E676');
  assert.strictEqual(REDMINE_CATEGORY_COLORS['ABM Function, Activity'], '#2979FF', 'ABM Function, Activity must be Blue #2979FF');
});

// ---------------------------------------------------------------------------------
// 2. Redmine Entry Category Classification
// ---------------------------------------------------------------------------------
console.log('\n--- 2. Redmine Entry Category Classification ---');

runTest('Special categories are classified correctly', () => {
  assert.strictEqual(getEntryCategory({ activity: 'Leave' }), 'Leave');
  assert.strictEqual(getEntryCategory({ activity: 'Big Late' }), 'Big Late');
  assert.strictEqual(getEntryCategory({ activity: 'Early Out' }), 'Early Out');
  assert.strictEqual(getEntryCategory({ activity: 'Holiday' }), 'Holiday');
});

runTest('General work entries classify as Working, Non-Productive classifies as its own category', () => {
  assert.strictEqual(getEntryCategory({ activity: 'Development' }), 'Working');
  assert.strictEqual(getEntryCategory({ activity: 'Project Management' }), 'Working');
  assert.strictEqual(getEntryCategory({ activity: 'Data Analysis' }), 'Working');
  assert.strictEqual(getEntryCategory({ activity: 'Bugfix' }), 'Working');
  assert.strictEqual(getEntryCategory({ activity: 'Testing' }), 'Working');
  assert.strictEqual(getEntryCategory({ activity: 'ABM Function, Activity' }), 'ABM Function, Activity');
  assert.strictEqual(getEntryCategory({ activity: 'Non Productive - ABM Function, Activity' }), 'ABM Function, Activity');
  assert.strictEqual(getEntryCategory({ activity: 'Non Productive - ABM Function' }), 'ABM Function, Activity');
});

// ---------------------------------------------------------------------------------
// 3. Aggregation of Real Redmine Time Entries
// ---------------------------------------------------------------------------------
console.log('\n--- 3. Aggregation of Real Redmine Time Entries ---');

runTest('aggregateRedmineTimeEntries populates workingHoursByDate and categoriesByDate', () => {
  const dateStr = '2026-10-15';
  const entries = [
    { id: 101, spent_on: dateStr, hours: 4.5, activity: 'Development' },
    { id: 102, spent_on: dateStr, hours: 1.0, activity: 'Project Management' },
    { id: 103, spent_on: dateStr, hours: 1.5, activity: 'Leave' }
  ];

  const agg = aggregateRedmineTimeEntries(entries, new Set([dateStr]));
  assert.strictEqual(agg.workingHoursByDate[dateStr], 5.5, 'Working hours must be 5.5h (4.5 + 1.0)');
  assert.strictEqual(agg.yellowHoursByDate[dateStr], 1.5, 'Yellow hours must be 1.5h (Leave)');
  assert.strictEqual(agg.allRedmineHoursByDate[dateStr], 7.0, 'All Redmine hours must be 7.0h (5.5 + 1.5)');
  assert.strictEqual(agg.categoriesByDate[dateStr]['Working'], 5.5);
  assert.strictEqual(agg.categoriesByDate[dateStr]['Leave'], 1.5);
});

// ---------------------------------------------------------------------------------
// 4. Combined Historical View for Last 7 Days & Last 30 Days
// ---------------------------------------------------------------------------------
console.log('\n--- 4. Combined Historical View for Last 7 Days & Last 30 Days ---');

runTest('buildCombinedHistoricalView preserves WorkLens active tracking and computes Redmine Working hours', () => {
  const dateStr = '2026-10-15';
  const activeSec = 5 * 3600; // 5 hours workstation active tracking
  const entries = [
    { id: 201, spent_on: dateStr, hours: 5.5, activity: 'Development' } // 5h 30m Working
  ];
  const agg = aggregateRedmineTimeEntries(entries, new Set([dateStr]));

  const view7 = buildCombinedHistoricalView({
    periodName: 'last7days',
    dateObjects: [new Date(2026, 9, 15)],
    dailyDurations: { [dateStr]: activeSec },
    dailyTimeRanges: {},
    redmineAggregation: agg,
    todayStr: '2026-10-21',
    isCurrentlyTracking: false,
    formatTime12Fn: null
  });

  const day = view7.days[0];
  assert.strictEqual(day.regularDuration, 18000, 'System Activity regular duration must remain strictly 5h active time');
  assert.strictEqual(day.redmineWorkingHours, 5.5, 'Redmine Working hours must be 5.5h');
  assert.strictEqual(day.redmineWorkingSeconds, 19800, 'Redmine Working seconds must be 19800s (5h 30m)');
  assert.strictEqual(day.redmineDuration, 19800, 'Redmine total duration must be 19800s');
  assert.strictEqual(day.redmineCategories.length, 1);
  assert.strictEqual(day.redmineCategories[0].name, 'Working');
  assert.strictEqual(day.redmineCategories[0].color, '#00E676');
});

runTest('Multi-category days place Working hours FIRST and extra hours (Holiday, Non-Productive) at the END', () => {
  const dateStr = '2026-10-16';
  const entries = [
    { id: 301, spent_on: dateStr, hours: 2.0, activity: 'Holiday' },
    { id: 302, spent_on: dateStr, hours: 4.0, activity: 'Development' }, // Working
    { id: 303, spent_on: dateStr, hours: 2.0, activity: 'Non Productive - ABM Function, Activity' } // Separate category
  ];
  const agg = aggregateRedmineTimeEntries(entries, new Set([dateStr]));
  const view = buildCombinedHistoricalView({
    periodName: 'last7days',
    dateObjects: [new Date(2026, 9, 16)],
    dailyDurations: { [dateStr]: 4 * 3600 },
    dailyTimeRanges: {},
    redmineAggregation: agg,
    todayStr: '2026-10-21',
    isCurrentlyTracking: false,
    formatTime12Fn: null
  });

  const day = view.days[0];
  // 4h Development (Working), 2h Non Productive (#FFEA00), 2h Holiday (#FF4081)
  assert.strictEqual(day.redmineCategories.length, 3);
  // Working MUST be the very first category
  assert.strictEqual(day.redmineCategories[0].name, 'Working', 'Working must be the first category');
  assert.strictEqual(day.redmineCategories[0].hours, 4.0, 'Working hours must be 4h Development');
  assert.strictEqual(day.redmineCategories[0].color, '#00E676');

  // Find ABM Function, Activity category
  const abmCat = day.redmineCategories.find(c => c.name === 'ABM Function, Activity');
  assert.ok(abmCat, 'ABM Function, Activity category must exist in redmineCategories');
  assert.strictEqual(abmCat.hours, 2.0, 'ABM Function, Activity hours must be 2.0');
  assert.strictEqual(abmCat.color, '#2979FF', 'ABM Function, Activity color must be #2979FF (Blue)');

  // Extra hours must be after Working
  const holidayCat = day.redmineCategories.find(c => c.name === 'Holiday');
  assert.ok(holidayCat, 'Holiday category must exist');
  assert.strictEqual(holidayCat.hours, 2.0);
  assert.strictEqual(holidayCat.color, '#FF4081');
});

// ---------------------------------------------------------------------------------
// 5. DOM Rendering: System Activity Untouched, Working Bar in Neon Green #00E676
// ---------------------------------------------------------------------------------
console.log('\n--- 5. DOM Rendering: System Activity Untouched, Working Bar in Neon Green #00E676 ---');

function setupMockDom() {
  const elements = {};

  function createMockElement(tag) {
    const el = {
      tagName: tag.toUpperCase(),
      _className: '',
      _textContent: '',
      _innerHTML: '',
      style: {},
      dataset: {},
      children: [],
      classList: {
        add: (...cls) => {
          const current = (el._className || '').split(' ').filter(Boolean);
          cls.forEach(c => { if (!current.includes(c)) current.push(c); });
          el._className = current.join(' ');
        },
        remove: (...cls) => {
          const current = (el._className || '').split(' ').filter(Boolean);
          el._className = current.filter(c => !cls.includes(c)).join(' ');
        },
        contains: (cls) => (el._className || '').split(' ').includes(cls),
        toggle: (cls, force) => {
          const has = (el._className || '').split(' ').includes(cls);
          if (force === true || (force === undefined && !has)) {
            el.classList.add(cls);
          } else {
            el.classList.remove(cls);
          }
        }
      },
      get className() {
        return this._className;
      },
      set className(val) {
        this._className = String(val);
      },
      get textContent() {
        if (this._textContent) return this._textContent;
        return this.children.map(c => c.textContent || '').join(' ');
      },
      set textContent(val) {
        this._textContent = String(val);
      },
      get innerHTML() {
        return this._innerHTML;
      },
      set innerHTML(val) {
        this._innerHTML = String(val);
      },
      setAttribute: (k, v) => { el[k] = v; },
      getAttribute: (k) => el[k] || null,
      appendChild: (child) => {
        el.children.push(child);
        child.parentNode = el;
        return child;
      },
      remove: () => {},
      querySelector: (selector) => {
        const cls = selector.replace('.', '');
        function find(node) {
          if (node.className && node.className.includes(cls)) return node;
          for (const ch of node.children) {
            const found = find(ch);
            if (found) return found;
          }
          return null;
        }
        return find(el);
      },
      querySelectorAll: (selector) => {
        const cls = selector.replace('.', '');
        const results = [];
        function find(node) {
          if (node.className && node.className.includes(cls)) results.push(node);
          for (const ch of node.children) {
            find(ch);
          }
        }
        find(el);
        return results;
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
  if (domState && domState.origDocument) {
    global.document = domState.origDocument;
  } else {
    delete global.document;
  }
}

runTest('DOM Rendering: Renders untouched System Activity (Track 1) and Neon Green Working Bar (Track 2)', () => {
  const dom = setupMockDom();
  try {
    const rawData = {
      days: [
        {
          dateStr: '2026-10-15',
          weekdayDisplay: 'Thu, 15 Oct',
          duration: 18000, // 5h active time
          regularDuration: 18000,
          redmineDuration: 19800, // 5h 30m Redmine Working time
          redmineWorkingSeconds: 19800,
          redmineCategories: [
            { name: 'Working', hours: 5.5, seconds: 19800, color: '#00E676' }
          ],
          startTime: '09:00 AM',
          endTime: '02:00 PM',
          hasData: true
        }
      ],
      totalSeconds: 18000
    };

    renderHistoryView(rawData);

    const historyList = dom.elements['history-list'];
    assert.strictEqual(historyList.children.length, 1, 'One date row must be rendered');
    const row = historyList.children[0];

    // Track 1: System Activity bar
    const regBar = row.querySelector('.history-segment-regular');
    assert.ok(regBar, 'System Activity segment must exist');
    assert.ok(regBar.classList.contains('color-red'), '5h active time (<7h) must have color-red status');

    // Track 2: Working bar
    const workingBar = row.querySelector('.history-segment-working');
    assert.ok(workingBar, 'Working segment must exist');
    assert.strictEqual(workingBar.style.backgroundColor, '#00E676', 'Working bar must use Neon Green #00E676');

    // Track wrapper layout
    const trackWrapper = row.querySelector('.history-track-wrapper');
    assert.ok(trackWrapper, 'Track wrapper must exist');
    assert.strictEqual(trackWrapper.children.length, 2, 'Two tracks must be stacked vertically');
    assert.ok(trackWrapper.children[0].classList.contains('history-track-regular'), 'Top track must be System Activity');
    assert.ok(trackWrapper.children[1].classList.contains('history-track-redmine'), 'Bottom track must be Redmine Working');

    // Duration Column
    const durationCol = row.querySelector('.history-duration-col');
    assert.ok(durationCol, 'Duration column must exist');
    const regDur = durationCol.querySelector('.history-duration-regular');
    const workDur = durationCol.querySelector('.history-duration-working');
    assert.ok(regDur, 'Regular duration must exist');
    assert.strictEqual(regDur.textContent, '5h', 'System Activity duration must display 5h');
    assert.ok(workDur, 'Working duration must exist');
    assert.strictEqual(workDur.textContent, '5h 30m', 'Working duration must display actual logged 5h 30m beside Working bar');
  } finally {
    teardownMockDom(dom);
  }
});

runTest('DOM Rendering: Day with NO Redmine entries always displays Redmine Track 2 with 0% width and 0h label', () => {
  const dom = setupMockDom();
  try {
    const rawData = {
      days: [
        {
          dateStr: '2026-10-14',
          weekdayDisplay: 'Wed, 14 Oct',
          duration: 25200, // 7h
          regularDuration: 25200,
          redmineDuration: 0,
          yellowDuration: 0,
          startTime: '09:00 AM',
          endTime: '04:00 PM',
          hasData: true
        }
      ],
      totalSeconds: 25200
    };

    renderHistoryView(rawData);

    const historyList = dom.elements['history-list'];
    const row = historyList.children[0];

    const regBar = row.querySelector('.history-segment-regular');
    const workingBar = row.querySelector('.history-segment-working');
    const trackWrapper = row.querySelector('.history-track-wrapper');
    const durationCol = row.querySelector('.history-duration-col');

    assert.ok(regBar, 'Regular bar must exist');
    assert.ok(workingBar, 'Working bar container must be created even when Redmine duration is 0');
    assert.strictEqual(workingBar.style.width, '0%', 'Working bar for 0h must have 0% width');
    assert.strictEqual(trackWrapper.children.length, 2, 'Both tracks must always be present to preserve layout');
    assert.ok(trackWrapper.children[0].classList.contains('history-track-regular'), 'Top track is regular');
    assert.ok(trackWrapper.children[1].classList.contains('history-track-redmine'), 'Bottom track is Redmine track');

    const regDur = durationCol.querySelector('.history-duration-regular');
    const workDur = durationCol.querySelector('.history-duration-working');
    assert.strictEqual(regDur.textContent, '7h', 'Regular duration displays 7h');
    assert.strictEqual(workDur.textContent, '0h', 'Redmine duration displays 0h for days with no logged hours');
  } finally {
    teardownMockDom(dom);
  }
});

runTest('DOM Rendering: Proportional scaling against 9h 30m reference scale', () => {
  // 5h 30m = 330m = 19,800s. 19,800 / 34,200 = 57.89%
  const res = calculateDailyProgressPercentages(0, 19800);
  assert.strictEqual(Number(res.yellowPercentage.toFixed(2)), 57.89, '5h 30m Redmine hours must scale to 57.89%');

  // 9h 30m = 34,200s -> 100%
  const resFull = calculateDailyProgressPercentages(0, 34200);
  assert.strictEqual(resFull.yellowPercentage, 100, '9h 30m Redmine hours must reach 100%');

  // 10h = 36,000s -> capped at 100%
  const resOver = calculateDailyProgressPercentages(0, 36000);
  assert.strictEqual(resOver.yellowPercentage, 100, '10h Redmine hours must visually cap at 100%');
});

// ---------------------------------------------------------------------------------
// 5. Dashboard History Legend Threshold Labels & Preservation
// ---------------------------------------------------------------------------------
runTest('History Legend: Contains Early Out: 6hr and Half Day: 4hr threshold labels', () => {
  const fs = require('fs');
  const path = require('path');
  const html = fs.readFileSync(path.join(__dirname, 'renderer', 'activity-popup.html'), 'utf8');

  // Verify Thresholds section and labels
  assert.ok(!html.includes('Thresholds:'), 'Legend should not include "Thresholds:" header');
  assert.ok(html.includes('Early Out: 6hr'), 'Legend must include Early Out: 6hr threshold label');
  assert.ok(html.includes('Half Day: 4hr'), 'Legend must include Half Day: 4hr threshold label');
  assert.ok(html.includes('dot-early-out'), 'Early Out label must use dot-early-out');
  assert.ok(html.includes('dot-half-day'), 'Half Day label must use dot-half-day');

  // Verify preservation of existing legend items
  assert.ok(html.includes('System Activity:'), 'System Activity header must be preserved');
  assert.ok(html.includes('&lt;7h'), '<7h label must be preserved');
  assert.ok(html.includes('7h–7h 30m'), '7h–7h 30m label must be preserved');
  assert.ok(html.includes('&gt;7h 30m'), '>7h 30m label must be preserved');

  assert.ok(html.includes('Redmine Hours:'), 'Redmine Hours header must be preserved');
  assert.ok(html.includes('Working (Redmine Logged Hours)'), 'Working label must be preserved');
  assert.ok(html.includes('Big Late'), 'Big Late label must be preserved');
  assert.ok(html.includes('Leave'), 'Leave label must be preserved');
  assert.ok(html.includes('Holiday'), 'Holiday label must be preserved');
  assert.ok(html.includes('ABM Function, Activity'), 'ABM Function, Activity label must be present in legend');
  assert.ok(html.includes('dot-non-productive') || html.includes('dot-abm-function'), 'ABM Function dot class must be present');
});

runTest('History Legend CSS: .dot-half-day, .dot-abm-function and .legend-divider styles defined', () => {
  const fs = require('fs');
  const path = require('path');
  const css = fs.readFileSync(path.join(__dirname, 'renderer', 'activity-popup.css'), 'utf8');

  assert.ok(css.includes('.dot-half-day'), '.dot-half-day class must be defined in CSS');
  assert.ok(css.includes('#FF9100'), '.dot-half-day color must be #FF9100');
  assert.ok(css.includes('.dot-non-productive') || css.includes('.dot-abm-function'), '.dot-abm-function class must be defined in CSS');
  assert.ok(css.includes('#2979FF'), '.dot-abm-function color must be #2979FF (Blue)');
  assert.ok(css.includes('.legend-divider'), '.legend-divider class must be defined in CSS');
  assert.ok(css.includes('.dot-early-out'), '.dot-early-out class must be present');
});

runTest('DOM Rendering: ABM Function, Activity separate segment in progressive bar with #2979FF and tooltip', () => {
  const dom = setupMockDom();
  try {
    const rawData = {
      days: [
        {
          dateStr: '2026-10-16',
          weekdayDisplay: 'Fri, 16 Oct',
          duration: 21600,
          regularDuration: 14400, // 4h active
          redmineDuration: 21600, // 6h total Redmine
          redmineCategories: [
            { name: 'Working', hours: 4.0, seconds: 14400, color: '#00E676' },
            { name: 'ABM Function, Activity', hours: 2.0, seconds: 7200, color: '#2979FF' }
          ],
          hasData: true
        }
      ],
      totalSeconds: 21600
    };

    renderHistoryView(rawData);

    const historyList = dom.elements['history-list'];
    const row = historyList.children[0];
    const workingSeg = row.querySelector('.cat-0');
    const abmSeg = row.querySelector('.cat-1');

    assert.ok(workingSeg, 'Working segment must exist');
    assert.strictEqual(workingSeg.style.backgroundColor, '#00E676', 'Working segment color is Neon Green');

    assert.ok(abmSeg, 'ABM Function, Activity segment must exist');
    assert.strictEqual(abmSeg.style.backgroundColor, '#2979FF', 'ABM Function, Activity segment color is Blue #2979FF');
    assert.ok(abmSeg.title.includes('ABM Function, Activity: 2h'), 'ABM Function, Activity segment must have duration tooltip');
  } finally {
    teardownMockDom(dom);
  }
});

console.log('\n================================================================================');
console.log(` ALL ${total} REDMINE WORKING HOURS TESTS PASSED (${passed}/${total})`);
console.log('================================================================================\n');
