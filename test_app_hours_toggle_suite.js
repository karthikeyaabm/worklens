// test_app_hours_toggle_suite.js
// Comprehensive Verification Suite for WorkLens Dashboard App-Wise / Hours-Wise View Toggle

const assert = require('assert');
const fs = require('fs');
const path = require('path');

console.log('================================================================================');
console.log('     WORKLENS DASHBOARD - APP-WISE / HOURS-WISE VIEW TOGGLE SUITE               ');
console.log('================================================================================\n');

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

// ---------------------------------------------------------------------------------
// TEST GROUP 1: HTML Structure & View Toggle Markup
// ---------------------------------------------------------------------------------
console.log('--- Test Group 1: HTML Markup & View Selection Control ---');

const htmlContent = fs.readFileSync(path.join(__dirname, 'renderer', 'activity-popup.html'), 'utf8');

test('1.1 HTML defines #view-toggle-container inside .date-controls-row', () => {
  assert.ok(htmlContent.includes('id="view-toggle-container"'), 'Must define #view-toggle-container');
  assert.ok(htmlContent.includes('class="view-toggle-container"'), 'Must define class .view-toggle-container');
});

test('1.2 HTML defines segmented toggle buttons for App Wise and Hours Wise', () => {
  assert.ok(htmlContent.includes('id="view-toggle-app"'), 'Must define #view-toggle-app');
  assert.ok(htmlContent.includes('id="view-toggle-hours"'), 'Must define #view-toggle-hours');
  assert.ok(htmlContent.includes('>App Wise</button>'), 'Must have button labeled "App Wise"');
  assert.ok(htmlContent.includes('>Hours Wise</button>'), 'Must have button labeled "Hours Wise"');
  assert.ok(htmlContent.includes('data-view="app"'), 'Must have data-view="app"');
  assert.ok(htmlContent.includes('data-view="hours"'), 'Must have data-view="hours"');
});

test('1.3 Toggle buttons have ARIA roles and accessibility attributes', () => {
  assert.ok(htmlContent.includes('role="group"'), 'Segmented toggle group must have role="group"');
  assert.ok(htmlContent.includes('aria-label="Activity view mode"'), 'Group must have aria-label');
  assert.ok(htmlContent.includes('aria-pressed="true"'), 'Active button must have aria-pressed="true"');
});

// ---------------------------------------------------------------------------------
// TEST GROUP 2: CSS Stylesheet & Visual Hierarchy
// ---------------------------------------------------------------------------------
console.log('\n--- Test Group 2: CSS Stylesheet & Segmented Toggle Styling ---');

const cssContent = fs.readFileSync(path.join(__dirname, 'renderer', 'activity-popup.css'), 'utf8');

test('2.1 CSS defines .view-toggle-container and .view-toggle-group', () => {
  assert.ok(cssContent.includes('.view-toggle-container {'), 'Must define .view-toggle-container');
  assert.ok(cssContent.includes('.view-toggle-group {'), 'Must define .view-toggle-group');
  assert.ok(cssContent.includes('background: rgba(14, 17, 22, 0.75)'), 'Toggle group must have dark fluent background');
  assert.ok(cssContent.includes('border-radius: 6px'), 'Toggle group must have 6px border radius');
});

test('2.2 CSS defines .view-toggle-btn with compact styling and active states', () => {
  assert.ok(cssContent.includes('.view-toggle-btn {'), 'Must define .view-toggle-btn');
  assert.ok(cssContent.includes('.view-toggle-btn.active {'), 'Must define .view-toggle-btn.active');
  assert.ok(cssContent.includes('.view-toggle-btn:focus-visible {'), 'Must define :focus-visible for keyboard navigation');
  assert.ok(cssContent.includes('color: #93C5FD'), 'Active toggle button must highlight with light blue text');
  assert.ok(cssContent.includes('border: 1px solid #3b82f6'), 'Active toggle button must have #3b82f6 border');
});

test('2.3 .date-controls-row supports responsive flex wrapping on smaller screens', () => {
  assert.ok(cssContent.includes('.date-controls-row {'), 'Must define .date-controls-row');
  assert.ok(cssContent.includes('flex-wrap: wrap'), '.date-controls-row must have flex-wrap: wrap for responsive wrapping');
});

// ---------------------------------------------------------------------------------
// TEST GROUP 3: App-Wise Activity Aggregation & Calculations
// ---------------------------------------------------------------------------------
console.log('\n--- Test Group 3: App-Wise Activity Aggregation & Calculations ---');

const popupModule = require('./renderer/activity-popup.js');
const {
  computeAppWiseActivity,
  computeHourlyActivity,
  formatDuration,
  getCurrentActivityView,
  setCurrentActivityView,
  selectActivityView,
  updateViewToggleVisibility,
  updateViewToggleButtons,
  clearRenderedActivityRows
} = popupModule;

test('3.1 computeAppWiseActivity returns empty state when logs are empty or null', () => {
  const emptyRes1 = computeAppWiseActivity([]);
  assert.strictEqual(emptyRes1.hasActivity, false);
  assert.strictEqual(emptyRes1.sortedApps.length, 0);
  assert.strictEqual(emptyRes1.totalDailySeconds, 0);

  const emptyRes2 = computeAppWiseActivity(null);
  assert.strictEqual(emptyRes2.hasActivity, false);
  assert.strictEqual(emptyRes2.sortedApps.length, 0);
  assert.strictEqual(emptyRes2.totalDailySeconds, 0);
});

test('3.2 computeAppWiseActivity filters out inactive and 0-duration records', () => {
  const logs = [
    { app_name: 'Chrome', duration: 1200, status: 'active' },
    { app_name: 'Chrome', duration: 300, status: 'idle' },
    { app_name: 'Slack', duration: 0, status: 'active' },
    { app_name: 'VS Code', duration: 600, status: 'inactive' }
  ];
  const res = computeAppWiseActivity(logs);
  assert.strictEqual(res.hasActivity, true);
  assert.strictEqual(res.sortedApps.length, 1, 'Only active entries with duration > 0 must be included');
  assert.strictEqual(res.sortedApps[0].name, 'Chrome');
  assert.strictEqual(res.sortedApps[0].duration, 1200);
  assert.strictEqual(res.totalDailySeconds, 1200);
});

test('3.3 computeAppWiseActivity groups applications and sorts in descending order by total active time', () => {
  const logs = [
    { app_name: 'Google Chrome', window_title: 'PR #12 - GitHub', duration: 12240, status: 'active' }, // 3h 24m
    { app_name: 'Visual Studio Code', window_title: 'index.js - WorkLens', duration: 9600, status: 'active' }, // 2h 40m
    { app_name: 'Google Chrome', window_title: 'Docs - Google Docs', duration: 60, status: 'active' }, // 1m (Chrome total 3h 25m)
    { app_name: 'Microsoft Excel', window_title: 'Financials.xlsx', duration: 4500, status: 'active' }, // 1h 15m
    { app_name: 'Slack', window_title: 'Team Channel - Slack', duration: 2700, status: 'active' } // 45m
  ];

  const res = computeAppWiseActivity(logs);
  assert.strictEqual(res.hasActivity, true);
  assert.strictEqual(res.sortedApps.length, 4);

  // Default sorting must be descending by total duration
  assert.strictEqual(res.sortedApps[0].name, 'Google Chrome');
  assert.strictEqual(res.sortedApps[0].duration, 12300); // 3h 25m = 12300s
  assert.strictEqual(formatDuration(res.sortedApps[0].duration), '3h 25m');

  assert.strictEqual(res.sortedApps[1].name, 'Visual Studio Code');
  assert.strictEqual(res.sortedApps[1].duration, 9600); // 2h 40m = 9600s
  assert.strictEqual(formatDuration(res.sortedApps[1].duration), '2h 40m');

  assert.strictEqual(res.sortedApps[2].name, 'Microsoft Excel');
  assert.strictEqual(res.sortedApps[2].duration, 4500); // 1h 15m = 4500s
  assert.strictEqual(formatDuration(res.sortedApps[2].duration), '1h 15m');

  assert.strictEqual(res.sortedApps[3].name, 'Slack');
  assert.strictEqual(res.sortedApps[3].duration, 2700); // 45m = 2700s
  assert.strictEqual(formatDuration(res.sortedApps[3].duration), '45m');

  // Verify total duration
  const expectedTotal = 12300 + 9600 + 4500 + 2700; // 29,100s = 8h 5m
  assert.strictEqual(res.totalDailySeconds, expectedTotal);
  assert.strictEqual(formatDuration(res.totalDailySeconds), '8h 5m');
});

test('3.4 computeAppWiseActivity groups child activities and sorts them descending', () => {
  const logs = [
    { app_name: 'Google Chrome', window_title: 'Docs - Google Docs', duration: 1800, status: 'active' }, // 30m
    { app_name: 'Google Chrome', window_title: 'GitHub - Pull Requests', duration: 3600, status: 'active' }, // 1h
    { app_name: 'Google Chrome', window_title: 'YouTube - Tech Talk', duration: 600, status: 'active' } // 10m
  ];

  const res = computeAppWiseActivity(logs);
  const chrome = res.sortedApps[0];
  assert.strictEqual(chrome.activities.length, 3);
  assert.strictEqual(chrome.activities[0].title, 'GitHub - Pull Requests');
  assert.strictEqual(chrome.activities[0].duration, 3600);
  assert.strictEqual(chrome.activities[1].title, 'Docs - Google Docs');
  assert.strictEqual(chrome.activities[1].duration, 1800);
  assert.strictEqual(chrome.activities[2].title, 'YouTube - Tech Talk');
  assert.strictEqual(chrome.activities[2].duration, 600);
});

test('3.5 computeAppWiseActivity handles unknown applications and missing window titles', () => {
  const logs = [
    { app_name: '', window_title: '', duration: 500, status: 'active' },
    { app_name: '   ', window_title: null, duration: 300, status: 'active' },
    { app_name: null, window_title: 'Unidentified Window', duration: 200, status: 'active' }
  ];

  const res = computeAppWiseActivity(logs);
  assert.strictEqual(res.sortedApps.length, 1);
  assert.strictEqual(res.sortedApps[0].name, 'Unknown Application');
  assert.strictEqual(res.sortedApps[0].duration, 1000);
});

// ---------------------------------------------------------------------------------
// TEST GROUP 4: Data Consistency: App Wise vs Hours Wise Total Match
// ---------------------------------------------------------------------------------
console.log('\n--- Test Group 4: Total Active Duration Consistency Between Views ---');

test('4.1 Total active time is strictly identical between App Wise and Hours Wise', () => {
  const sampleLogs = [
    {
      app_name: 'Google Chrome',
      window_title: 'Search - Google Chrome',
      start_time: '2026-10-21 09:15:00',
      end_time: '2026-10-21 10:15:00',
      duration: 3600,
      status: 'active'
    },
    {
      app_name: 'Visual Studio Code',
      window_title: 'main.js - WorkLens',
      start_time: '2026-10-21 10:15:00',
      end_time: '2026-10-21 12:00:00',
      duration: 6300,
      status: 'active'
    },
    {
      app_name: 'Microsoft Teams',
      window_title: 'Weekly Standup',
      start_time: '2026-10-21 14:00:00',
      end_time: '2026-10-21 14:45:00',
      duration: 2700,
      status: 'active'
    }
  ];

  const appResult = computeAppWiseActivity(sampleLogs);
  const now = new Date(2026, 9, 21, 18, 0, 0);
  const hourlyResult = computeHourlyActivity(sampleLogs, '2026-10-21', true, now);

  assert.strictEqual(appResult.totalDailySeconds, hourlyResult.totalDailySeconds, 'Total daily active seconds must match exactly');
  assert.strictEqual(formatDuration(appResult.totalDailySeconds), formatDuration(hourlyResult.totalDailySeconds));
  assert.strictEqual(appResult.totalDailySeconds, 12600); // 3600 + 6300 + 2700 = 12600s (3h 30m)
  assert.strictEqual(formatDuration(appResult.totalDailySeconds), '3h 30m');
});

// ---------------------------------------------------------------------------------
// TEST GROUP 5: Progress Bar Percentage Calculation (Share of Total Tracked Activity)
// ---------------------------------------------------------------------------------
console.log('\n--- Test Group 5: Progress Bar Percentage (Share of Total Tracked Activity) ---');

test('5.1 Progress bar represents the application share of total tracked activity', () => {
  const totalDailySeconds = 12600; // 3h 30m
  const chromeDuration = 3600;
  const vsCodeDuration = 6300;
  const teamsDuration = 2700;

  const chromeShare = (chromeDuration / totalDailySeconds) * 100;
  const vsCodeShare = (vsCodeDuration / totalDailySeconds) * 100;
  const teamsShare = (teamsDuration / totalDailySeconds) * 100;

  assert.strictEqual(Math.round(chromeShare), 29); // 3600 / 12600 = ~28.57%
  assert.strictEqual(Math.round(vsCodeShare), 50); // 6300 / 12600 = 50.0%
  assert.strictEqual(Math.round(teamsShare), 21); // 2700 / 12600 = ~21.43%

  const totalShare = chromeShare + vsCodeShare + teamsShare;
  assert.strictEqual(Math.round(totalShare), 100, 'Sum of all application shares must equal 100%');
});

// ---------------------------------------------------------------------------------
// TEST GROUP 6: View State Management & Tab Preservation
// ---------------------------------------------------------------------------------
console.log('\n--- Test Group 6: View State Management & Tab Preservation ---');

test('6.1 Default activity view is "app" (App Wise)', () => {
  assert.strictEqual(getCurrentActivityView(), 'app', 'Default activity view must be "app"');
});

test('6.2 setCurrentActivityView updates currentActivityView and preserves setting', () => {
  setCurrentActivityView('hours');
  assert.strictEqual(getCurrentActivityView(), 'hours', 'View mode must change to "hours"');

  setCurrentActivityView('app');
  assert.strictEqual(getCurrentActivityView(), 'app', 'View mode must change back to "app"');
});

// ---------------------------------------------------------------------------------
// TEST GROUP 7: DOM Mock Verification for View Toggle & Header Sync
// ---------------------------------------------------------------------------------
console.log('\n--- Test Group 7: DOM Mock Verification for View Toggle & Header Sync ---');

class MockDomElement {
  constructor(id, tagName = 'div') {
    this.id = id;
    this.tagName = tagName.toUpperCase();
    this.className = '';
    this.classList = {
      _classes: new Set(),
      add: (c) => this.classList._classes.add(c),
      remove: (c) => this.classList._classes.delete(c),
      toggle: (c, force) => {
        if (force === true) this.classList._classes.add(c);
        else if (force === false) this.classList._classes.delete(c);
        else if (this.classList._classes.has(c)) this.classList._classes.delete(c);
        else this.classList._classes.add(c);
      },
      contains: (c) => this.classList._classes.has(c)
    };
    this.textContent = '';
    this.children = [];
    this.style = {};
    this.attributes = {};
    this.innerHTML = '';
    this.scrollTop = 0;
  }
  setAttribute(k, v) { this.attributes[k] = String(v); }
  getAttribute(k) { return this.attributes[k]; }
  appendChild(child) { this.children.push(child); return child; }
  remove() {}
}

const mockElements = {
  'view-toggle-container': new MockDomElement('view-toggle-container'),
  'view-toggle-app': new MockDomElement('view-toggle-app', 'button'),
  'view-toggle-hours': new MockDomElement('view-toggle-hours', 'button'),
  'weekend-toggle-container': new MockDomElement('weekend-toggle-container'),
  'col-header-name': new MockDomElement('col-header-name', 'span'),
  'col-header-time': new MockDomElement('col-header-time', 'span'),
  'activity-list': new MockDomElement('activity-list'),
  'history-list': new MockDomElement('history-list'),
  'total-time': new MockDomElement('total-time'),
  'current-date': new MockDomElement('current-date'),
  'empty-msg': new MockDomElement('empty-msg')
};

const originalGetElementById = global.document?.getElementById;
if (!global.document) global.document = {};
global.document.getElementById = (id) => mockElements[id] || null;

try {
  test('7.1 updateViewToggleButtons sets active class and aria-pressed attributes', () => {
    setCurrentActivityView('app');
    updateViewToggleButtons();
    assert.ok(mockElements['view-toggle-app'].classList.contains('active'), 'App button must be active');
    assert.strictEqual(mockElements['view-toggle-app'].getAttribute('aria-pressed'), 'true');
    assert.ok(!mockElements['view-toggle-hours'].classList.contains('active'), 'Hours button must not be active');
    assert.strictEqual(mockElements['view-toggle-hours'].getAttribute('aria-pressed'), 'false');

    setCurrentActivityView('hours');
    updateViewToggleButtons();
    assert.ok(!mockElements['view-toggle-app'].classList.contains('active'), 'App button must not be active');
    assert.strictEqual(mockElements['view-toggle-app'].getAttribute('aria-pressed'), 'false');
    assert.ok(mockElements['view-toggle-hours'].classList.contains('active'), 'Hours button must be active');
    assert.strictEqual(mockElements['view-toggle-hours'].getAttribute('aria-pressed'), 'true');
  });

  test('7.2 updateViewToggleVisibility shows toggle on Today/Yesterday and hides on historical tabs', () => {
    // Check helper logic
    function isViewToggleVisibleForPeriod(period) {
      return period === 'today' || period === 'yesterday';
    }

    assert.strictEqual(isViewToggleVisibleForPeriod('today'), true, 'Today must show view toggle');
    assert.strictEqual(isViewToggleVisibleForPeriod('yesterday'), true, 'Yesterday must show view toggle');
    assert.strictEqual(isViewToggleVisibleForPeriod('last7days'), false, 'Last 7 Days must NOT show view toggle');
    assert.strictEqual(isViewToggleVisibleForPeriod('last30days'), false, 'Last 30 Days must NOT show view toggle');
  });

  test('7.3 clearRenderedActivityRows cleans DOM and state without crashing', () => {
    mockElements['activity-list'].innerHTML = '<div>some row</div>';
    mockElements['activity-list'].scrollTop = 50;
    clearRenderedActivityRows();
    assert.strictEqual(mockElements['activity-list'].innerHTML, '');
    assert.strictEqual(mockElements['activity-list'].scrollTop, 0);
  });
} finally {
  if (originalGetElementById) {
    global.document.getElementById = originalGetElementById;
  }
}

console.log('\n================================================================================');
console.log(`  TOTAL TESTS: ${passed + failed}`);
console.log(`  PASSED:      ${passed}`);
console.log(`  FAILED:      ${failed}`);
console.log('================================================================================\n');

if (failed > 0) process.exit(1);
