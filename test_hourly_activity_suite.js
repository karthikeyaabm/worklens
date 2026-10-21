// test_hourly_activity_suite.js
// Verification suite for WorkLens Hour-Wise Activity Dashboard & Expandable Dropdowns

const assert = require('assert');
const fs = require('fs');
const path = require('path');

console.log('================================================================================');
console.log('       WORKLENS DASHBOARD - HOUR-WISE ACTIVITY & DROPDOWN TEST SUITE           ');
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
// TEST GROUP 1: CSS Stylesheet & Layout Rules
// ---------------------------------------------------------------------------------
console.log('--- Test Group 1: CSS Stylesheet, Dark Theme & Transition Verification ---');

const cssContent = fs.readFileSync(path.join(__dirname, 'renderer', 'activity-popup.css'), 'utf8');

test('1.1 Hourly row styling rules defined in activity-popup.css', () => {
  assert.ok(cssContent.includes('.hourly-group {'), 'CSS must define .hourly-group');
  assert.ok(cssContent.includes('.hourly-row {'), 'CSS must define .hourly-row');
  assert.ok(cssContent.includes('.hourly-chevron-container {'), 'CSS must define .hourly-chevron-container');
  assert.ok(cssContent.includes('.hourly-chevron-icon {'), 'CSS must define .hourly-chevron-icon');
  assert.ok(cssContent.includes('.hourly-time-range {'), 'CSS must define .hourly-time-range');
  assert.ok(cssContent.includes('.hourly-progress-container {'), 'CSS must define .hourly-progress-container');
  assert.ok(cssContent.includes('.hourly-progress-bar {'), 'CSS must define .hourly-progress-bar');
  assert.ok(cssContent.includes('.hourly-duration {'), 'CSS must define .hourly-duration');
});

test('1.2 Expandable details wrapper has GPU-accelerated grid transition', () => {
  assert.ok(cssContent.includes('.hourly-details-wrapper {'), 'CSS must define .hourly-details-wrapper');
  assert.ok(cssContent.includes('.hourly-details-wrapper.expanded {'), 'CSS must define .hourly-details-wrapper.expanded');
  assert.ok(cssContent.includes('grid-template-rows: 0fr'), 'Must use grid-template-rows: 0fr for smooth accordion collapse');
  assert.ok(cssContent.includes('grid-template-rows: 1fr'), 'Must use grid-template-rows: 1fr for expansion');
  assert.ok(cssContent.includes('transition: grid-template-rows 250ms'), 'Must have 250ms transition');
});

test('1.3 Chevron rotation animation when hourly row is expanded', () => {
  assert.ok(cssContent.includes('.hourly-row.expanded .hourly-chevron-container {'), 'Must define expanded chevron style');
  assert.ok(cssContent.includes('transform: rotate(90deg)'), 'Chevron must rotate 90deg on expansion');
});

test('1.4 Application row styles inside expanded dropdown', () => {
  assert.ok(cssContent.includes('.hourly-app-row {'), 'CSS must define .hourly-app-row');
  assert.ok(cssContent.includes('.hourly-app-icon-container {'), 'CSS must define .hourly-app-icon-container');
  assert.ok(cssContent.includes('.hourly-app-name {'), 'CSS must define .hourly-app-name');
  assert.ok(cssContent.includes('.hourly-app-progress-container {'), 'CSS must define .hourly-app-progress-container');
  assert.ok(cssContent.includes('.hourly-app-progress-bar {'), 'CSS must define .hourly-app-progress-bar');
  assert.ok(cssContent.includes('.hourly-app-duration {'), 'CSS must define .hourly-app-duration');
  assert.ok(cssContent.includes('.hourly-empty-message {'), 'CSS must define .hourly-empty-message');
});

// ---------------------------------------------------------------------------------
// TEST GROUP 2: Hour Formatting (12-Hour Slots)
// ---------------------------------------------------------------------------------
console.log('\n--- Test Group 2: Hour Formatting (12-Hour Slots) ---');

const popupModule = require('./renderer/activity-popup.js');
const {
  formatHour12,
  formatHourRange,
  computeHourlyActivity,
  formatDuration,
  toggleHourExpansion,
  getExpandedHours,
  setExpandedHours
} = popupModule;

test('2.1 formatHour12 formats hours in 12-hour clock with leading zeros', () => {
  assert.strictEqual(formatHour12(0), '12:00 AM');
  assert.strictEqual(formatHour12(8), '08:00 AM');
  assert.strictEqual(formatHour12(9), '09:00 AM');
  assert.strictEqual(formatHour12(10), '10:00 AM');
  assert.strictEqual(formatHour12(11), '11:00 AM');
  assert.strictEqual(formatHour12(12), '12:00 PM');
  assert.strictEqual(formatHour12(13), '01:00 PM');
  assert.strictEqual(formatHour12(17), '05:00 PM');
  assert.strictEqual(formatHour12(23), '11:00 PM');
});

test('2.2 formatHourRange formats continuous hourly slots', () => {
  assert.strictEqual(formatHourRange(9), '09:00 AM – 10:00 AM');
  assert.strictEqual(formatHourRange(10), '10:00 AM – 11:00 AM');
  assert.strictEqual(formatHourRange(11), '11:00 AM – 12:00 PM');
  assert.strictEqual(formatHourRange(12), '12:00 PM – 01:00 PM');
  assert.strictEqual(formatHourRange(17), '05:00 PM – 06:00 PM');
});

// ---------------------------------------------------------------------------------
// TEST GROUP 3: Exact Interval Calculations & Double-Counting Prevention
// ---------------------------------------------------------------------------------
console.log('\n--- Test Group 3: Exact Interval Calculations & Double-Counting Prevention ---');

test('3.1 Activity strictly inside an hourly interval is 100% attributed to that hour', () => {
  const logs = [
    {
      app_name: 'Antigravity IDE',
      window_title: 'main.js - WorkLens',
      start_time: '2026-10-20 09:15:00',
      end_time: '2026-10-20 09:40:00',
      duration: 1500, // 25 minutes
      status: 'active'
    }
  ];

  const now = new Date(2026, 9, 20, 18, 0, 0); // 18:00
  const result = computeHourlyActivity(logs, '2026-10-20', true, now);

  assert.ok(result.hasActivity, 'Must have activity');
  assert.strictEqual(result.totalDailySeconds, 1500, 'Total daily active time must be 1500s (25m)');

  const hour9 = result.hourlySlots.find(s => s.hour === 9);
  assert.ok(hour9, 'Hour 9 slot must exist');
  assert.strictEqual(hour9.timeRange, '09:00 AM – 10:00 AM');
  assert.strictEqual(hour9.totalDuration, 1500, 'Hour 9 total must be 1500s (25m)');
  assert.strictEqual(hour9.appList.length, 1);
  assert.strictEqual(hour9.appList[0].name, 'Antigravity IDE');
  assert.strictEqual(hour9.appList[0].duration, 1500);

  // Hour 10 must have 0 activity
  const hour10 = result.hourlySlots.find(s => s.hour === 10);
  assert.ok(hour10, 'Hour 10 slot must exist');
  assert.strictEqual(hour10.totalDuration, 0, 'Hour 10 must have 0s');
  assert.strictEqual(hour10.appList.length, 0, 'Hour 10 app list must be empty');
});

test('3.2 Activity spanning across an hour boundary is split proportionally without double counting', () => {
  // Session from 09:45:00 to 10:15:00 = 30 minutes (1800s)
  // Exactly 15 minutes (900s) in 09:00 - 10:00 and 15 minutes (900s) in 10:00 - 11:00
  const logs = [
    {
      app_name: 'Google Chrome',
      window_title: 'GitHub - Pull Requests',
      start_time: '2026-10-20 09:45:00',
      end_time: '2026-10-20 10:15:00',
      duration: 1800,
      status: 'active'
    }
  ];

  const now = new Date(2026, 9, 20, 18, 0, 0);
  const result = computeHourlyActivity(logs, '2026-10-20', true, now);

  const hour9 = result.hourlySlots.find(s => s.hour === 9);
  const hour10 = result.hourlySlots.find(s => s.hour === 10);

  assert.ok(hour9 && hour10, 'Both hour 9 and 10 must exist');
  assert.strictEqual(hour9.totalDuration, 900, 'Hour 9 must receive exactly 900s (15m)');
  assert.strictEqual(hour10.totalDuration, 900, 'Hour 10 must receive exactly 900s (15m)');

  assert.strictEqual(hour9.totalDuration + hour10.totalDuration, 1800, 'Sum across hours must equal 1800s');
  assert.strictEqual(result.totalDailySeconds, 1800, 'Daily total active seconds must equal 1800s');
});

test('3.3 Multiple applications in the same hour are aggregated and sorted descending', () => {
  const logs = [
    {
      app_name: 'Antigravity IDE',
      window_title: 'IDE Window',
      start_time: '2026-10-20 09:00:00',
      end_time: '2026-10-20 09:25:00',
      duration: 1500, // 25m
      status: 'active'
    },
    {
      app_name: 'Google Chrome',
      window_title: 'Documentation',
      start_time: '2026-10-20 09:25:00',
      end_time: '2026-10-20 09:37:00',
      duration: 720, // 12m
      status: 'active'
    },
    {
      app_name: 'Microsoft Teams',
      window_title: 'Team Chat',
      start_time: '2026-10-20 09:37:00',
      end_time: '2026-10-20 09:45:00',
      duration: 480, // 8m
      status: 'active'
    }
  ];

  const now = new Date(2026, 9, 20, 18, 0, 0);
  const result = computeHourlyActivity(logs, '2026-10-20', true, now);

  const hour9 = result.hourlySlots.find(s => s.hour === 9);
  assert.strictEqual(hour9.totalDuration, 2700, 'Total active duration for 09:00 AM – 10:00 AM must be 2700s (45m)');
  assert.strictEqual(formatDuration(hour9.totalDuration), '45m');

  assert.strictEqual(hour9.appList.length, 3);
  assert.strictEqual(hour9.appList[0].name, 'Antigravity IDE');
  assert.strictEqual(hour9.appList[0].duration, 1500);
  assert.strictEqual(hour9.appList[1].name, 'Google Chrome');
  assert.strictEqual(hour9.appList[1].duration, 720);
  assert.strictEqual(hour9.appList[2].name, 'Microsoft Teams');
  assert.strictEqual(hour9.appList[2].duration, 480);
});

// ---------------------------------------------------------------------------------
// TEST GROUP 4: Current Hour Limit & Empty Hours
// ---------------------------------------------------------------------------------
console.log('\n--- Test Group 4: Current Hour Limit & Empty Hours ---');

test('4.1 Current hour on Today caps activity up to the present time', () => {
  // It is currently 10:30 AM
  const now = new Date(2026, 9, 20, 10, 30, 0);

  const logs = [
    {
      app_name: 'VS Code',
      window_title: 'WorkLens',
      start_time: '2026-10-20 10:00:00',
      end_time: '2026-10-20 10:45:00', // Session runs past 10:30
      duration: 2700, // 45m
      status: 'active'
    }
  ];

  const result = computeHourlyActivity(logs, '2026-10-20', true, now);

  const hour10 = result.hourlySlots.find(s => s.hour === 10);
  assert.ok(hour10, 'Hour 10 slot must exist');
  assert.ok(hour10.isCurrentHour, 'Hour 10 must be flagged as current hour');

  // Should only include activity up to 10:30 AM = 30 minutes (1800s)
  assert.strictEqual(hour10.totalDuration, 1800, 'Activity must be capped at 1800s (30m) up to present time');

  // Must not generate future hours for Today
  const hour11 = result.hourlySlots.find(s => s.hour === 11);
  assert.strictEqual(hour11, undefined, 'Future hour 11 must not be generated for Today');
});

test('4.2 Empty hours within the day have 0m and empty application list', () => {
  const logs = [
    {
      app_name: 'Code',
      start_time: '2026-10-20 09:00:00',
      end_time: '2026-10-20 09:50:00',
      duration: 3000,
      status: 'active'
    },
    // Break from 10:00 AM to 11:00 AM
    {
      app_name: 'Code',
      start_time: '2026-10-20 11:00:00',
      end_time: '2026-10-20 11:45:00',
      duration: 2700,
      status: 'active'
    }
  ];

  const now = new Date(2026, 9, 20, 12, 0, 0);
  const result = computeHourlyActivity(logs, '2026-10-20', true, now);

  const hour10 = result.hourlySlots.find(s => s.hour === 10);
  assert.ok(hour10, 'Hour 10 slot must exist');
  assert.strictEqual(hour10.totalDuration, 0, 'Empty hour must have duration 0');
  assert.strictEqual(formatDuration(hour10.totalDuration), '0m', 'Duration formats as 0m');
  assert.strictEqual(hour10.appList.length, 0, 'Empty hour has no applications');
});

// ---------------------------------------------------------------------------------
// TEST GROUP 5: Independent Dropdown Toggle Behavior
// ---------------------------------------------------------------------------------
console.log('\n--- Test Group 5: Independent Dropdown Toggle Behavior ---');

test('5.1 Multiple hours expand and collapse independently', () => {
  setExpandedHours(new Set());

  // Mock DOM elements
  function createMockGroup(hour) {
    const wrapper = {
      classList: {
        contains: (cls) => wrapper._classes.has(cls),
        add: (cls) => wrapper._classes.add(cls),
        remove: (cls) => wrapper._classes.delete(cls)
      },
      _classes: new Set()
    };
    const row = {
      classList: {
        contains: (cls) => row._classes.has(cls),
        add: (cls) => row._classes.add(cls),
        remove: (cls) => row._classes.delete(cls)
      },
      setAttribute: (k, v) => { row[k] = v; },
      _classes: new Set()
    };
    return {
      hour,
      querySelector: (sel) => {
        if (sel === '.hourly-details-wrapper') return wrapper;
        if (sel === '.hourly-row') return row;
        return null;
      },
      wrapper,
      row
    };
  }

  const group9 = createMockGroup(9);
  const group10 = createMockGroup(10);

  // Expand hour 9
  toggleHourExpansion(9, group9);
  assert.ok(getExpandedHours().has(9), 'Hour 9 must be in expanded set');
  assert.ok(group9.wrapper.classList.contains('expanded'), 'Group 9 wrapper must have expanded class');

  // Expand hour 10 - hour 9 MUST STAY expanded!
  toggleHourExpansion(10, group10);
  assert.ok(getExpandedHours().has(10), 'Hour 10 must be in expanded set');
  assert.ok(getExpandedHours().has(9), 'Hour 9 must STILL be in expanded set');
  assert.ok(group9.wrapper.classList.contains('expanded'), 'Group 9 wrapper must STILL have expanded class');
  assert.ok(group10.wrapper.classList.contains('expanded'), 'Group 10 wrapper must have expanded class');

  // Collapse hour 9 - hour 10 MUST STAY expanded!
  toggleHourExpansion(9, group9);
  assert.ok(!getExpandedHours().has(9), 'Hour 9 must be removed from expanded set');
  assert.ok(getExpandedHours().has(10), 'Hour 10 must STILL be expanded');
  assert.ok(!group9.wrapper.classList.contains('expanded'), 'Group 9 wrapper collapsed');
  assert.ok(group10.wrapper.classList.contains('expanded'), 'Group 10 wrapper remains expanded');
});

// ---------------------------------------------------------------------------------
// TEST GROUP 6: Total Active Time Consistency
// ---------------------------------------------------------------------------------
console.log('\n--- Test Group 6: Total Active Time Consistency ---');

test('6.1 Daily Total Active Time equals the exact sum of all active logs without duplicate addition', () => {
  const logs = [
    { app_name: 'App A', start_time: '2026-10-20 09:10:00', end_time: '2026-10-20 09:40:00', duration: 1800, status: 'active' },
    { app_name: 'App B', start_time: '2026-10-20 10:15:00', end_time: '2026-10-20 10:45:00', duration: 1800, status: 'active' },
    { app_name: 'App C', start_time: '2026-10-20 11:00:00', end_time: '2026-10-20 11:30:00', duration: 1800, status: 'active' },
    { app_name: 'Inactive', start_time: '2026-10-20 11:30:00', end_time: '2026-10-20 12:00:00', duration: 1800, status: 'inactive' }
  ];

  const now = new Date(2026, 9, 20, 18, 0, 0);
  const result = computeHourlyActivity(logs, '2026-10-20', true, now);

  // Inactive log must be excluded
  assert.strictEqual(result.totalDailySeconds, 5400, 'Total daily seconds must be 5400s (1h 30m)');
  assert.strictEqual(formatDuration(result.totalDailySeconds), '1h 30m');

  const hourlySum = result.hourlySlots.reduce((sum, slot) => sum + slot.totalDuration, 0);
  assert.strictEqual(hourlySum, 5400, 'Sum of hourly slots must match daily total');
});

// ---------------------------------------------------------------------------------
// TEST GROUP 7: PC Start Time to Present / End Time Bounded Slots
// ---------------------------------------------------------------------------------
console.log('\n--- Test Group 7: PC Start Time to Present / End Time Bounded Slots ---');

test('7.1 Today strictly bounds hourly slots from PC start time to Present', () => {
  // PC started at 10:09 AM, current time is 14:20 (02:20 PM)
  const now = new Date(2026, 9, 20, 14, 20, 0);
  const logs = [
    { app_name: 'Chrome', start_time: '2026-10-20 10:15:00', end_time: '2026-10-20 10:45:00', duration: 1800, status: 'active' },
    { app_name: 'IDE', start_time: '2026-10-20 11:00:00', end_time: '2026-10-20 12:00:00', duration: 3600, status: 'active' },
    { app_name: 'Teams', start_time: '2026-10-20 13:00:00', end_time: '2026-10-20 14:00:00', duration: 3600, status: 'active' }
  ];

  const result = computeHourlyActivity(logs, '2026-10-20', true, now, '10:09 AM', 'Present');

  // Should start at hour 10 and end at hour 14 (Present)
  assert.strictEqual(result.hourlySlots[0].hour, 10, 'First slot must be 10:00 AM');
  assert.strictEqual(result.hourlySlots[result.hourlySlots.length - 1].hour, 14, 'Last slot must be 02:00 PM (Present)');
  assert.strictEqual(result.hourlySlots.length, 5, 'Must contain exactly 5 hourly slots (10, 11, 12, 13, 14)');

  // Ensure no pre-start hours (hour 8, 9)
  assert.strictEqual(result.hourlySlots.find(s => s.hour === 8), undefined, 'Hour 8 must not exist');
  assert.strictEqual(result.hourlySlots.find(s => s.hour === 9), undefined, 'Hour 9 must not exist');
  // Ensure no future hours (hour 15+)
  assert.strictEqual(result.hourlySlots.find(s => s.hour === 15), undefined, 'Hour 15 must not exist');
});

test('7.2 Yesterday strictly bounds hourly slots from PC start time to PC end time', () => {
  // PC started at 11:30 AM, ended at 04:15 PM
  const now = new Date(2026, 9, 21, 10, 0, 0);
  const logs = [
    { app_name: 'Chrome', start_time: '2026-10-19 11:45:00', end_time: '2026-10-19 12:30:00', duration: 2700, status: 'active' },
    { app_name: 'IDE', start_time: '2026-10-19 14:00:00', end_time: '2026-10-19 16:00:00', duration: 7200, status: 'active' }
  ];

  const result = computeHourlyActivity(logs, '2026-10-19', false, now, '11:30 AM', '04:15 PM');

  // Should start at hour 11 and end at hour 16 (4 PM)
  assert.strictEqual(result.hourlySlots[0].hour, 11, 'First slot must be 11:00 AM');
  assert.strictEqual(result.hourlySlots[result.hourlySlots.length - 1].hour, 16, 'Last slot must be 04:00 PM (end hour)');
  assert.strictEqual(result.hourlySlots.length, 6, 'Must contain exactly 6 hourly slots (11, 12, 13, 14, 15, 16)');

  // Ensure no pre-start hours (09:00, 10:00)
  assert.strictEqual(result.hourlySlots.find(s => s.hour === 9), undefined, 'Hour 9 must not exist');
  assert.strictEqual(result.hourlySlots.find(s => s.hour === 10), undefined, 'Hour 10 must not exist');
  // Ensure no post-end hours (17:00, 18:00)
  assert.strictEqual(result.hourlySlots.find(s => s.hour === 17), undefined, 'Hour 17 must not exist');
  assert.strictEqual(result.hourlySlots.find(s => s.hour === 18), undefined, 'Hour 18 must not exist');
});

// ---------------------------------------------------------------------------------
// TEST GROUP 8: Segmented Activity Bar & Application Pills
// ---------------------------------------------------------------------------------
console.log('\n--- Test Group 8: Segmented Activity Bar & Application Pills ---');

test('8.1 Segmented bar and app pills CSS rules defined in activity-popup.css', () => {
  assert.ok(cssContent.includes('.hourly-center-col {'), 'Must define .hourly-center-col');
  assert.ok(cssContent.includes('.hourly-segment {'), 'Must define .hourly-segment');
  assert.ok(cssContent.includes('.hourly-app-pills {'), 'Must define .hourly-app-pills');
  assert.ok(cssContent.includes('.hourly-pill-item {'), 'Must define .hourly-pill-item');
  assert.ok(cssContent.includes('.hourly-pill-icon {'), 'Must define .hourly-pill-icon');
  assert.ok(cssContent.includes('.hourly-pill-time {'), 'Must define .hourly-pill-time');
  assert.ok(cssContent.includes('.hourly-pill-more {'), 'Must define .hourly-pill-more');
});

test('8.2 Distinct brand accent colors defined for applications', () => {
  const { getAppColor } = popupModule;
  assert.strictEqual(getAppColor('VS Code'), '#38bdf8', 'VS Code must be Sky Blue (#38bdf8)');
  assert.strictEqual(getAppColor('Antigravity IDE'), '#38bdf8', 'IDE must be Sky Blue (#38bdf8)');
  assert.strictEqual(getAppColor('Google Chrome'), '#fb923c', 'Chrome must be Warm Orange (#fb923c)');
  assert.strictEqual(getAppColor('Microsoft Teams'), '#a855f7', 'Teams must be Purple (#a855f7)');
  assert.strictEqual(getAppColor('Microsoft Edge'), '#34d399', 'Edge must be Mint Green (#34d399)');
});

// ---------------------------------------------------------------------------------
// TEST GROUP 9: Website / Window Activity Table inside Expanded Row
// ---------------------------------------------------------------------------------
console.log('\n--- Test Group 9: Website / Window Activity Table inside Expanded Row ---');

test('9.1 formatWindowOrWebsiteTitle cleans browser suffixes and formats web services', () => {
  const { formatWindowOrWebsiteTitle } = popupModule;

  // Google Docs
  const docResult = formatWindowOrWebsiteTitle('Project Plan - Google Docs - Google Chrome', 'Google Chrome');
  assert.strictEqual(docResult, 'docs.google.com – Project Plan');

  // YouTube
  const ytResult = formatWindowOrWebsiteTitle('YouTube - Google Chrome', 'Google Chrome');
  assert.strictEqual(ytResult, 'youtube.com');

  // Notion
  const notionResult = formatWindowOrWebsiteTitle('WorkLens Architecture - Notion - Microsoft Edge', 'Microsoft Edge');
  assert.strictEqual(notionResult, 'notion.so');

  // Gmail
  const mailResult = formatWindowOrWebsiteTitle('Inbox (12) - mail.google.com - Google Chrome', 'Google Chrome');
  assert.strictEqual(mailResult, 'mail.google.com');

  // Stack Overflow
  const soResult = formatWindowOrWebsiteTitle('How to center a div - Stack Overflow - Google Chrome', 'Google Chrome');
  assert.strictEqual(soResult, 'stackoverflow.com');
});

test('9.2 formatWindowOrWebsiteTitle preserves desktop application titles without inventing URLs', () => {
  const { formatWindowOrWebsiteTitle } = popupModule;

  assert.strictEqual(
    formatWindowOrWebsiteTitle('activity-popup.js - WorkLens', 'Antigravity IDE'),
    'activity-popup.js - WorkLens',
    'Must keep code editor window title'
  );

  assert.strictEqual(
    formatWindowOrWebsiteTitle('General | Engineering - Microsoft Teams', 'Microsoft Teams'),
    'General | Engineering - Microsoft Teams',
    'Must keep Teams chat window title'
  );

  assert.strictEqual(
    formatWindowOrWebsiteTitle('Budget 2026.xlsx', 'Microsoft Excel'),
    'Budget 2026.xlsx',
    'Must keep Excel spreadsheet title'
  );
});

test('9.3 getWindowIconSvg resolves valid SVG icons for websites and applications', () => {
  const { getWindowIconSvg } = popupModule;

  const docSvg = getWindowIconSvg('docs.google.com – Project Plan', 'Google Chrome');
  assert.ok(docSvg.includes('<svg'), 'Doc icon must be an SVG');
  assert.ok(docSvg.includes('#4285F4'), 'Doc icon must use Google Docs blue');

  const ytSvg = getWindowIconSvg('youtube.com', 'Google Chrome');
  assert.ok(ytSvg.includes('<svg') && ytSvg.includes('#FF0000'), 'YouTube icon must be red SVG');

  const notionSvg = getWindowIconSvg('notion.so', 'Microsoft Edge');
  assert.ok(notionSvg.includes('<svg') && (notionSvg.includes('#18181B') || notionSvg.includes('#000000')), 'Notion icon must be dark SVG');

  const teamsSvg = getWindowIconSvg('General Chat', 'Microsoft Teams');
  assert.ok(teamsSvg.includes('<svg') && teamsSvg.includes('#5059C9'), 'Teams icon must use purple');
});

test('9.4 computeHourlyActivity correctly populates windowList sorted descending by duration', () => {
  const logs = [
    {
      app_name: 'Google Chrome',
      window_title: 'Project Plan - Google Docs - Google Chrome',
      start_time: '2026-10-20 10:00:00',
      end_time: '2026-10-20 10:10:00',
      duration: 600, // 10m
      status: 'active'
    },
    {
      app_name: 'Google Chrome',
      window_title: 'YouTube - Google Chrome',
      start_time: '2026-10-20 10:10:00',
      end_time: '2026-10-20 10:16:00',
      duration: 360, // 6m
      status: 'active'
    },
    {
      app_name: 'Microsoft Edge',
      window_title: 'notion.so - Microsoft Edge',
      start_time: '2026-10-20 10:16:00',
      end_time: '2026-10-20 10:20:00',
      duration: 240, // 4m
      status: 'active'
    }
  ];

  const now = new Date(2026, 9, 20, 18, 0, 0);
  const result = computeHourlyActivity(logs, '2026-10-20', true, now);

  const hour10 = result.hourlySlots.find(s => s.hour === 10);
  assert.ok(hour10, 'Hour 10 slot must exist');
  assert.strictEqual(hour10.totalDuration, 1200, 'Total duration must be 20m (1200s)');

  // Verify windowList
  assert.ok(Array.isArray(hour10.windowList), 'hour10 must contain windowList');
  assert.strictEqual(hour10.windowList.length, 3, 'Must have 3 distinct window entries');

  assert.strictEqual(hour10.windowList[0].displayTitle, 'docs.google.com – Project Plan');
  assert.strictEqual(hour10.windowList[0].duration, 600);
  assert.strictEqual(hour10.windowList[1].displayTitle, 'youtube.com');
  assert.strictEqual(hour10.windowList[1].duration, 360);
  assert.strictEqual(hour10.windowList[2].displayTitle, 'notion.so');
  assert.strictEqual(hour10.windowList[2].duration, 240);
});

test('9.5 renderHourlyWindows builds table card with WINDOW / WEBSITE and ACTIVE TIME headers', () => {
  const { renderHourlyWindows } = popupModule;

  // Mock DOM
  function createMockElement(tag) {
    const el = {
      tagName: tag.toUpperCase(),
      className: '',
      innerHTML: '',
      children: [],
      style: {},
      appendChild: (child) => { el.children.push(child); return child; },
      setAttribute: (k, v) => { el[k] = v; },
      querySelector: (sel) => {
        if (sel === '.hourly-table-card') return el.children.find(c => c.className.includes('hourly-table-card'));
        return null;
      }
    };
    return el;
  }

  const globalDocument = global.document;
  global.document = {
    createElement: (tag) => createMockElement(tag)
  };

  try {
    const container = createMockElement('div');
    const windowList = [
      { displayTitle: 'docs.google.com – Project Plan', rawTitle: 'Docs', appName: 'Google Chrome', duration: 600 },
      { displayTitle: 'youtube.com', rawTitle: 'YouTube', appName: 'Google Chrome', duration: 360 }
    ];

    renderHourlyWindows(container, windowList, 960, {});

    const card = container.children[0];
    assert.ok(card, 'Card must be created');
    assert.strictEqual(card.className, 'hourly-table-card');

    const header = card.children[0];
    assert.strictEqual(header.className, 'hourly-table-header');
    assert.ok(header.innerHTML.includes('WINDOW / WEBSITE'), 'Header must contain WINDOW / WEBSITE');
    assert.ok(header.innerHTML.includes('ACTIVE TIME'), 'Header must contain ACTIVE TIME');

    const body = card.children[1];
    assert.strictEqual(body.className, 'hourly-table-body');
    assert.strictEqual(body.children.length, 2, 'Must have 2 window rows');
  } finally {
    global.document = globalDocument;
  }
});

// ---------------------------------------------------------------------------------
// TEST GROUP 10: Footer & Period Sync
// ---------------------------------------------------------------------------------
console.log('\n--- Test Group 10: Footer & Period Sync ---');

test('10.1 Footer duration styling in activity-popup.css matches bold blue 18px', () => {
  assert.ok(cssContent.includes('.footer-value {'), 'CSS must define .footer-value');
  assert.ok(cssContent.includes('color: #38bdf8'), 'Footer value must use #38bdf8 blue highlight');
  assert.ok(cssContent.includes('font-size: 18px'), 'Footer value must have font-size 18px');
  assert.ok(cssContent.includes('font-weight: 700'), 'Footer value must have font-weight 700');
});

test('10.2 HTML defines #footer-label for dynamic period labeling', () => {
  const htmlContent = fs.readFileSync(path.join(__dirname, 'renderer', 'activity-popup.html'), 'utf8');
  assert.ok(htmlContent.includes('id="footer-label"'), 'activity-popup.html must have #footer-label');
  assert.ok(htmlContent.includes('Total Active Time (Today)'), 'Default footer label must be Total Active Time (Today)');
});

console.log('\n================ TEST SUMMARY ================');
console.log(`  Total: ${passed + failed}`);
console.log(`  Passed: ${passed}`);
console.log(`  Failed: ${failed}`);
console.log('==============================================\n');

if (failed > 0) process.exit(1);

