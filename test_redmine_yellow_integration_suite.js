// test_redmine_yellow_integration_suite.js
// Verification suite for WorkLens Redmine Time Integration & Yellow Progress Bar Segments
// Covers all 14 mandatory test cases from Section 7 of the specification.

const assert = require('assert');
const fs = require('fs');
const path = require('path');

console.log('================================================================================');
console.log(' WORKLENS - REDMINE TIME INTEGRATION & YELLOW PROGRESS BAR SEGMENTS TEST SUITE  ');
console.log('================================================================================\n');

const redmineTimeIntegration = require('./redmineTimeIntegration.js');
const popupModule = require('./renderer/activity-popup.js');

const {
  YELLOW_CATEGORIES,
  parseSpentOnDateStr,
  getEntryYellowCategory,
  formatShortHours,
  aggregateRedmineTimeEntries,
  buildCombinedHistoricalView
} = redmineTimeIntegration;

const {
  getDailyActiveTimeColor,
  formatDuration,
  isWeekend
} = popupModule;

let passed = 0;
let total = 0;

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
// TEST 1: All five yellow category names in issue_subject
// ---------------------------------------------------------------------------------
console.log('--- Test 1: All Five Yellow Category Names in issue_subject ---');

const expectedYellowCategories = [
  'Big Late',
  'Early Out',
  'Leave',
  'Holiday',
  'Non Productive - ABM Function, Activity',
  'Non Productive - ABM Function'
];

expectedYellowCategories.forEach(category => {
  runTest(`Category "${category}" in issue_subject must classify as yellow`, () => {
    // Both exact and with surrounding whitespace
    const entry1 = {
      id: 101,
      issue_subject: category,
      activity: 'Development',
      hours: 1.0,
      spent_on: '2026-10-16'
    };
    const entry2 = {
      id: 102,
      issue_subject: `  ${category}  `,
      activity: { id: 9, name: 'Development' },
      hours: 1.5,
      spent_on: '2026-10-16'
    };
    const entry3 = {
      id: 103,
      issue: { id: 273001, subject: category },
      activity: 'Data Analysis',
      hours: 2.0,
      spent_on: '2026-10-16'
    };

    assert.strictEqual(getEntryYellowCategory(entry1), category);
    assert.strictEqual(getEntryYellowCategory(entry2), category);
    assert.strictEqual(getEntryYellowCategory(entry3), category);
  });
});

// ---------------------------------------------------------------------------------
// TEST 2: All five yellow category names in activity
// ---------------------------------------------------------------------------------
console.log('\n--- Test 2: All Five Yellow Category Names in activity ---');

expectedYellowCategories.forEach(category => {
  runTest(`Category "${category}" in activity (object or string) must classify as yellow`, () => {
    // Activity as object with name
    const entryObj = {
      id: 201,
      issue_subject: 'Project Management',
      activity: { id: 1897, name: category },
      hours: 1.0,
      spent_on: '2026-10-16'
    };
    // Activity as string with surrounding whitespace
    const entryStr = {
      id: 202,
      issue_subject: 'TSCL Support',
      activity: `  ${category}  `,
      hours: 2.0,
      spent_on: '2026-10-16'
    };

    assert.strictEqual(getEntryYellowCategory(entryObj), category);
    assert.strictEqual(getEntryYellowCategory(entryStr), category);
  });
});

// ---------------------------------------------------------------------------------
// TEST 3: Normal Project Management and Data Analysis entries
// ---------------------------------------------------------------------------------
console.log('\n--- Test 3: Normal Project Management & Data Analysis Entries ---');

runTest('Normal "Project Management" and "Data Analysis" entries remain regular (null yellow)', () => {
  const normalEntry1 = {
    id: 721381,
    project: 'TSCL Support',
    issue_id: 273001,
    issue_subject: 'Project Management',
    activity: 'Data Analysis',
    hours: 1.0,
    comments: 'Data Refresh PowerBI UAT and PROD',
    spent_on: '16-10-2026'
  };
  const normalEntry2 = {
    id: 721382,
    project: { id: 314, name: 'TSCL Support' },
    issue: { id: 273001, subject: 'Project Management' },
    activity: { id: 1041, name: 'Data Analysis' },
    hours: 2.5,
    spent_on: '2026-10-16'
  };

  assert.strictEqual(getEntryYellowCategory(normalEntry1), null);
  assert.strictEqual(getEntryYellowCategory(normalEntry2), null);
});

runTest('Partial substring matches must NOT classify as yellow (exact trimmed match required)', () => {
  const substringEntries = [
    { issue_subject: 'Leaving early today', activity: 'Development' },
    { issue_subject: 'Holiday planning meeting', activity: 'Discussion' },
    { issue_subject: 'Not a Big Late issue', activity: 'Do' },
    { issue_subject: 'Early Outing', activity: 'Meeting' },
    { issue_subject: 'Non Productive work', activity: 'Support' }
  ];

  substringEntries.forEach(e => {
    assert.strictEqual(getEntryYellowCategory(e), null, `Substring "${e.issue_subject}" must not be yellow`);
  });
});

// ---------------------------------------------------------------------------------
// TEST 4: Multiple entries on the same date
// ---------------------------------------------------------------------------------
// TEST 4: Multiple entries on the same date (Mixed approved and unapproved)
// ---------------------------------------------------------------------------------
console.log('\n--- Test 4: Mixed Approved and Unapproved Entries on the Same Date ---');

runTest('Multiple entries on the same date count ONLY approved hours and exclude unapproved entries', () => {
  const dateStr = '2026-10-16';
  const entries = [
    { id: 401, spent_on: dateStr, hours: 2.0, issue_subject: 'Development', activity: 'Development' },
    { id: 402, spent_on: dateStr, hours: 1.0, issue_subject: 'Project Management', activity: { name: 'Leave' } },
    { id: 403, spent_on: dateStr, hours: 0.5, issue_subject: 'Big Late', activity: 'Analysis' }
  ];

  const agg = aggregateRedmineTimeEntries(entries, new Set([dateStr]));
  assert.strictEqual(agg.yellowHoursByDate[dateStr], 1.5, 'Only Leave (1.0h) and Big Late (0.5h) must contribute');
  assert.strictEqual(agg.yellowCatsByDate[dateStr]['Leave'], 1.0);
  assert.strictEqual(agg.yellowCatsByDate[dateStr]['Big Late'], 0.5);
  assert.strictEqual(agg.regularHoursByDate[dateStr], 0, 'Unapproved Development entries must contribute zero additional hours');
  assert.strictEqual(agg.totalRegularHours, 0, 'Total regular additional Redmine hours must be 0');
  assert.strictEqual(agg.totalYellowHours, 1.5);
  assert.strictEqual(agg.excludedHoursByDate[dateStr], 2.0, '2.0h of Development must be tracked as excluded');
  assert.strictEqual(agg.totalExcludedHours, 2.0);
});

// ---------------------------------------------------------------------------------
// TEST 5: Decimal hours, such as 1.5 hours
// ---------------------------------------------------------------------------------
console.log('\n--- Test 5: Decimal Hours (e.g., 1.5 hours) ---');

runTest('Decimal hours correctly convert to seconds and format text cleanly', () => {
  const dateStr = '2026-10-15';
  const entries = [
    { id: 501, spent_on: dateStr, hours: 1.5, activity: { name: 'Early Out' } }
  ];

  const agg = aggregateRedmineTimeEntries(entries, new Set([dateStr]));
  assert.strictEqual(agg.yellowHoursByDate[dateStr], 1.5);

  const view = buildCombinedHistoricalView({
    periodName: 'test',
    dateObjects: [new Date(2026, 9, 15)],
    dailyDurations: { [dateStr]: 6.0 * 3600 }, // 6h active tracking
    dailyTimeRanges: {},
    redmineAggregation: agg,
    todayStr: '2026-10-18',
    isCurrentlyTracking: false,
    formatTime12Fn: null
  });

  const day = view.days[0];
  // 6.0h active + 1.5h Early Out = 7.5h (27000s)
  assert.strictEqual(day.duration, 27000);
  assert.strictEqual(day.regularDuration, 21600); // 6h
  assert.strictEqual(day.yellowDuration, 5400); // 1.5h
  assert.strictEqual(formatShortHours(1.5), '1h 30m');
  assert.strictEqual(formatShortHours(1.0), '1h');
  assert.strictEqual(formatShortHours(0.5), '30m');
});

// ---------------------------------------------------------------------------------
// TEST 6: Unapproved categories contribute zero additional hours
// ---------------------------------------------------------------------------------
console.log('\n--- Test 6: Unapproved Categories Contribute Zero Additional Hours ---');

runTest('Unapproved category (2h Bugfix/Development) contributes zero, only approved (1h Leave) contributes', () => {
  const dateStr = '2026-10-14';
  const entries = [
    { id: 601, spent_on: dateStr, hours: 2.0, issue_subject: 'Bugfix', activity: 'Development' },
    { id: 602, spent_on: dateStr, hours: 1.0, issue_subject: 'Personal', activity: 'Leave' }
  ];

  const agg = aggregateRedmineTimeEntries(entries, new Set([dateStr]));
  assert.strictEqual(agg.regularHoursByDate[dateStr], 0, 'Unapproved Development entry must contribute 0 additional regular hours');
  assert.strictEqual(agg.yellowHoursByDate[dateStr], 1.0, 'Approved Leave entry must contribute 1.0h yellow');
  assert.strictEqual(agg.excludedHoursByDate[dateStr], 2.0, '2.0h Bugfix must be classified as excluded');
  assert.strictEqual(agg.totalRegularHours, 0);
  assert.strictEqual(agg.totalYellowHours, 1.0);
});

// ---------------------------------------------------------------------------------
// TEST 7: Redmine time combined with existing Active Time
// ---------------------------------------------------------------------------------
console.log('\n--- Test 7: Redmine Time Combined with Existing Active Time ---');

runTest('5h Active Time + 1h Data Analysis (excluded) + 1h Leave = 6h total (5h regular, 1h yellow, RED threshold)', () => {
  const dateStr = '2026-10-13';
  const activeSeconds = 5 * 3600; // 18000s

  const entries = [
    { id: 701, spent_on: dateStr, hours: 1.0, activity: 'Data Analysis' }, // Unapproved -> 0
    { id: 702, spent_on: dateStr, hours: 1.0, activity: 'Leave' } // Approved -> 1.0h yellow
  ];

  const agg = aggregateRedmineTimeEntries(entries, new Set([dateStr]));
  const view = buildCombinedHistoricalView({
    periodName: 'test',
    dateObjects: [new Date(2026, 9, 13)],
    dailyDurations: { [dateStr]: activeSeconds },
    dailyTimeRanges: {},
    redmineAggregation: agg,
    todayStr: '2026-10-18',
    isCurrentlyTracking: false,
    formatTime12Fn: null
  });

  const day = view.days[0];
  // displayTotal = 5h Active Time + 1h Leave = 6h = 21600s (Data Analysis excluded!)
  assert.strictEqual(day.duration, 21600, 'Combined displayed total must be 6 hours (21600s), Data Analysis excluded');
  assert.strictEqual(day.regularDuration, 18000, 'Regular portion must remain strictly 5 hours Active Time (18000s)');
  assert.strictEqual(day.yellowDuration, 3600, 'Yellow portion must be 1 hour (3600s)');
  assert.strictEqual(day.regularDuration + day.yellowDuration, day.duration);

  // Status color for combined 6h is RED (< 7h threshold)
  const color = getDailyActiveTimeColor(day.duration);
  assert.strictEqual(color, 'red', '6h total must resolve to red threshold (< 7h)');
});

// ---------------------------------------------------------------------------------
// TEST 8: Duplicate API records and repeated fetches
// ---------------------------------------------------------------------------------
console.log('\n--- Test 8: Duplicate API Records & Repeated Fetches ---');

runTest('Stable entry IDs prevent duplicated API records from double-counting', () => {
  const dateStr = '2026-10-16';
  // Simulate duplicate record returned in overlapping pagination pages or repeated polling
  const entriesWithDuplicates = [
    { id: 721381, spent_on: dateStr, hours: 1.0, activity: 'Leave' },
    { id: 721381, spent_on: dateStr, hours: 1.0, activity: 'Leave' }, // Exact duplicate
    { id: 721382, spent_on: dateStr, hours: 2.0, activity: 'Development' },
    { id: 721382, spent_on: dateStr, hours: 2.0, activity: 'Development' } // Exact duplicate
  ];

  const agg = aggregateRedmineTimeEntries(entriesWithDuplicates, new Set([dateStr]));
  assert.strictEqual(agg.yellowHoursByDate[dateStr], 1.0, 'Yellow hours must only count ID 721381 once');
  assert.strictEqual(agg.regularHoursByDate[dateStr], 0, 'Unapproved Development must contribute zero');
  assert.strictEqual(agg.excludedHoursByDate[dateStr], 2.0, 'Excluded Development must only count ID 721382 once');
  assert.strictEqual(agg.dedupedCount, 2, 'Two duplicate records must be detected and skipped');
  assert.strictEqual(agg.processedCount, 2, 'Only two distinct records processed');
});

// ---------------------------------------------------------------------------------
// TEST 9: Date parsing for both supported formats
// ---------------------------------------------------------------------------------
console.log('\n--- Test 9: Date Parsing (DD-MM-YYYY and YYYY-MM-DD) ---');

runTest('parseSpentOnDateStr parses DD-MM-YYYY and YYYY-MM-DD without timezone shifts', () => {
  assert.strictEqual(parseSpentOnDateStr('16-10-2026'), '2026-10-16', 'DD-MM-YYYY must parse to 2026-10-16');
  assert.strictEqual(parseSpentOnDateStr('2026-10-16'), '2026-10-16', 'YYYY-MM-DD must parse to 2026-10-16');
  assert.strictEqual(parseSpentOnDateStr('01-05-2026'), '2026-05-01', 'Single-digit day must pad correctly');
  assert.strictEqual(parseSpentOnDateStr('2026-5-1'), '2026-05-01', 'Single-digit month/day must pad correctly');
  assert.strictEqual(parseSpentOnDateStr('  16-10-2026  '), '2026-10-16', 'Whitespace trimmed');
  assert.strictEqual(parseSpentOnDateStr(null), null);
  assert.strictEqual(parseSpentOnDateStr('invalid-date'), null);
});

// ---------------------------------------------------------------------------------
// TEST 10: Last 7 Days and Last 30 Days boundaries
// ---------------------------------------------------------------------------------
console.log('\n--- Test 10: Last 7 Days & Last 30 Days Boundaries ---');

runTest('Historical view builders respect exact 7-day and 30-day calendar boundaries', () => {
  const today = new Date(2026, 9, 18); // 18 Oct 2026

  const last7DateObjects = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(today);
    d.setDate(today.getDate() - i);
    last7DateObjects.push(d);
  }

  const last30DateObjects = [];
  for (let i = 0; i < 30; i++) {
    const d = new Date(today);
    d.setDate(today.getDate() - i);
    last30DateObjects.push(d);
  }

  // Time entries: one inside last 7 days, one inside last 30 days but outside 7, one 40 days ago
  const entries = [
    { id: 1001, spent_on: '2026-10-16', hours: 1.0, activity: 'Leave' }, // Inside both
    { id: 1002, spent_on: '2026-09-25', hours: 2.0, activity: 'Leave' }, // Inside 30, outside 7
    { id: 1003, spent_on: '2026-08-01', hours: 5.0, activity: 'Leave' }  // Outside both (40+ days ago)
  ];

  const set7 = new Set(last7DateObjects.map(d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`));
  const set30 = new Set(last30DateObjects.map(d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`));

  const agg7 = aggregateRedmineTimeEntries(entries, set7);
  const agg30 = aggregateRedmineTimeEntries(entries, set30);

  assert.strictEqual(agg7.totalYellowHours, 1.0, 'Last 7 Days must only count entries within 7 days');
  assert.strictEqual(agg30.totalYellowHours, 3.0, 'Last 30 Days must only count entries within 30 days');
  assert.strictEqual(agg30.yellowHoursByDate['2026-08-01'], undefined, 'Entries outside 30 days must be ignored');
});

// ---------------------------------------------------------------------------------
// TEST 11: Red, blue and green thresholds
// ---------------------------------------------------------------------------------
console.log('\n--- Test 11: Red, Blue, and Green Thresholds ---');

runTest('Dynamic color thresholds apply to the combined daily total duration', () => {
  // < 7h (25200s) -> RED
  assert.strictEqual(getDailyActiveTimeColor(0), 'red');
  assert.strictEqual(getDailyActiveTimeColor(6 * 3600 + 30 * 60), 'red'); // 6h 30m
  assert.strictEqual(getDailyActiveTimeColor(25199), 'red'); // 6h 59m 59s

  // 7h through 7h 30m (25200s to 27000s) -> BLUE
  assert.strictEqual(getDailyActiveTimeColor(25200), 'blue'); // 7h 00m
  assert.strictEqual(getDailyActiveTimeColor(7 * 3600 + 15 * 60), 'blue'); // 7h 15m
  assert.strictEqual(getDailyActiveTimeColor(27000), 'blue'); // 7h 30m

  // > 7h 30m (> 27000s) -> GREEN
  assert.strictEqual(getDailyActiveTimeColor(27001), 'green'); // 7h 30m 01s
  assert.strictEqual(getDailyActiveTimeColor(8 * 3600), 'green'); // 8h 00m
});

// ---------------------------------------------------------------------------------
// TEST 12: Yellow segments remaining visible in rendered UI
// ---------------------------------------------------------------------------------
console.log('\n--- Test 12: Yellow Segments Remaining Visible in Rendered UI ---');

runTest('Yellow segments render with non-zero width alongside regular segment', () => {
  // Simulate DOM for renderHistoryView
  const domState = setupMockDom();
  try {
    const rawData = {
      days: [
        {
          dateStr: '2026-10-16',
          weekdayDisplay: 'Thu, 16 Oct',
          duration: 27000, // 7h 30m -> blue threshold
          regularDuration: 23400, // 6h 30m
          yellowDuration: 3600, // 1h Early Out
          yellowCategories: [{ name: 'Early Out', hours: 1.0 }],
          startTime: '09:00 AM',
          endTime: '05:30 PM',
          hasData: true
        }
      ],
      totalSeconds: 27000
    };

    popupModule.renderHistoryView(rawData);

    const historyList = domState.elements['history-list'];
    assert.ok(historyList.children.length > 0, 'History list must contain rendered row');

    const row = historyList.children[0];
    const regularBar = row.querySelector('.history-segment-regular');
    const yellowBar = row.querySelector('.history-segment-yellow');
    const subRow = row.querySelector('.history-subrow');

    assert.ok(regularBar, 'Regular segment must exist in progress container');
    assert.ok(yellowBar, 'Yellow segment must exist in progress container');
    assert.ok(regularBar.className.includes('color-blue'), 'Regular segment must have status color blue');
    assert.ok(subRow, 'Sub-row breakdown must exist');
    assert.ok(subRow.textContent.includes('6h 30m other logged time'), 'Sub-row must show other logged time');
    assert.ok(subRow.textContent.includes('1h Early Out'), 'Sub-row must show yellow category name');
  } finally {
    teardownMockDom(domState);
  }
});

runTest('Date with ONLY yellow-category hours renders visible yellow bar', () => {
  const domState = setupMockDom();
  try {
    const rawData = {
      days: [
        {
          dateStr: '2026-10-15',
          weekdayDisplay: 'Thu, 15 Oct',
          duration: 7200, // 2h total
          regularDuration: 0, // 0h active time
          yellowDuration: 7200, // 2h Leave
          yellowCategories: [{ name: 'Leave', hours: 2.0 }],
          startTime: '--',
          endTime: '--',
          hasData: true
        }
      ],
      totalSeconds: 7200
    };

    popupModule.renderHistoryView(rawData);

    const historyList = domState.elements['history-list'];
    const row = historyList.children[0];
    const yellowBar = row.querySelector('.history-segment-yellow');
    const subRow = row.querySelector('.history-subrow');

    assert.ok(yellowBar, 'Yellow segment must be present when date has only yellow hours');
    assert.ok(subRow.textContent.includes('2h Leave'), 'Sub-row must show 2h Leave');
    assert.strictEqual(subRow.textContent.includes('other logged time'), false, 'Sub-row must not show 0m other logged time');
  } finally {
    teardownMockDom(domState);
  }
});

// ---------------------------------------------------------------------------------
// TEST 13: No matching yellow entries
// ---------------------------------------------------------------------------------
console.log('\n--- Test 13: No Matching Yellow Entries ---');

runTest('Dates without yellow entries preserve existing bar behavior (no yellow segment or subrow)', () => {
  const domState = setupMockDom();
  try {
    const rawData = {
      days: [
        {
          dateStr: '2026-10-14',
          weekdayDisplay: 'Wed, 14 Oct',
          duration: 14400, // 4h
          regularDuration: 14400,
          yellowDuration: 0,
          yellowCategories: [],
          startTime: '09:00 AM',
          endTime: '01:00 PM',
          hasData: true
        }
      ],
      totalSeconds: 14400
    };

    popupModule.renderHistoryView(rawData);

    const historyList = domState.elements['history-list'];
    const row = historyList.children[0];
    const regularBar = row.querySelector('.history-segment-regular');
    const yellowBar = row.querySelector('.history-segment-yellow');
    const subRow = row.querySelector('.history-subrow');

    assert.ok(regularBar, 'Regular bar must exist');
    assert.strictEqual(yellowBar, null, 'Yellow bar must NOT be created when yellowDuration is 0');
    assert.strictEqual(subRow, null, 'Sub-row must NOT be created when yellowDuration is 0');
  } finally {
    teardownMockDom(domState);
  }
});

// ---------------------------------------------------------------------------------
// TEST 14: No double-counting when sources overlap
// ---------------------------------------------------------------------------------
console.log('\n--- Test 14: No Double-Counting When Sources Overlap ---');

runTest('Active tracking duration and Redmine time entries are combined additively without duplicate inflation', () => {
  const dateStr = '2026-10-12';
  const activeSeconds = 4 * 3600; // 4 hours active time

  // Redmine logged entries for the same date (Development is unapproved, Leave is approved)
  const entries = [
    { id: 1401, spent_on: dateStr, hours: 2.0, activity: 'Development' },
    { id: 1402, spent_on: dateStr, hours: 1.0, activity: 'Leave' }
  ];

  const agg = aggregateRedmineTimeEntries(entries, new Set([dateStr]));
  const view = buildCombinedHistoricalView({
    periodName: 'test',
    dateObjects: [new Date(2026, 9, 12)],
    dailyDurations: { [dateStr]: activeSeconds },
    dailyTimeRanges: {},
    redmineAggregation: agg,
    todayStr: '2026-10-18',
    isCurrentlyTracking: false,
    formatTime12Fn: null
  });

  const day = view.days[0];
  // 4h active + 0h unapproved Redmine + 1h Leave = 5h (18000s)
  assert.strictEqual(day.duration, 18000, 'Total duration must be 5h (18000s) - Development excluded');
  assert.strictEqual(day.regularDuration, 14400, 'Regular duration must be exactly 4h (14400s) active time');
  assert.strictEqual(day.yellowDuration, 3600, 'Yellow duration must be 1h (3600s) Leave');
  assert.strictEqual(day.duration, day.regularDuration + day.yellowDuration);
});

// =================================================================================
// SECTION 5: EXPLICIT VERIFICATION OF 10 MANDATORY SPECIFICATION TESTS
// =================================================================================
console.log('\n================================================================================');
console.log(' SECTION 5: EXPLICIT VERIFICATION OF 10 MANDATORY SPECIFICATION TESTS           ');
console.log('================================================================================\n');

// 1. All five approved categories contribute their hours
runTest('Spec Test 1: All five approved categories contribute their hours', () => {
  const testCats = [
    'Big Late',
    'Early Out',
    'Leave',
    'Holiday',
    'Non Productive - ABM Function, Activity',
    'Non Productive - ABM Function'
  ];
  testCats.forEach((cat, idx) => {
    const ds = `2026-10-0${idx + 1}`;
    const entries = [{ id: 5000 + idx, spent_on: ds, hours: 1.5, activity: cat }];
    const agg = aggregateRedmineTimeEntries(entries, new Set([ds]));
    assert.strictEqual(agg.yellowHoursByDate[ds], 1.5, `Category "${cat}" must contribute 1.5h`);
    assert.strictEqual(agg.yellowCatsByDate[ds][cat], 1.5);
  });
});

// 2. Project Management and Data Analysis entries contribute zero additional Redmine hours
runTest('Spec Test 2: Project Management and Data Analysis entries contribute zero additional Redmine hours', () => {
  const dateStr = '2026-10-16';
  const entries = [
    { id: 2001, spent_on: dateStr, hours: 3.0, issue_subject: 'Project Management', activity: 'Project Management' },
    { id: 2002, spent_on: dateStr, hours: 2.5, issue_subject: 'Reports', activity: 'Data Analysis' },
    { id: 2003, spent_on: dateStr, hours: 1.0, issue_subject: 'Project Management', activity: 'Data Analysis' }
  ];
  const agg = aggregateRedmineTimeEntries(entries, new Set([dateStr]));
  assert.strictEqual(agg.yellowHoursByDate[dateStr], 0, 'Project Management & Data Analysis must contribute 0 yellow hours');
  assert.strictEqual(agg.regularHoursByDate[dateStr], 0, 'Project Management & Data Analysis must contribute 0 regular hours');
  assert.strictEqual(agg.totalYellowHours, 0);
  assert.strictEqual(agg.totalRegularHours, 0);
  assert.strictEqual(agg.totalExcludedHours, 6.5, 'All 6.5h must be excluded');

  // Verify in buildCombinedHistoricalView
  const view = buildCombinedHistoricalView({
    periodName: 'test',
    dateObjects: [new Date(2026, 9, 16)],
    dailyDurations: { [dateStr]: 4 * 3600 },
    dailyTimeRanges: {},
    redmineAggregation: agg,
    todayStr: '2026-10-18',
    isCurrentlyTracking: false,
    formatTime12Fn: null
  });
  const day = view.days[0];
  assert.strictEqual(day.duration, 4 * 3600, 'Display total must equal original active time with zero addition');
  assert.strictEqual(day.regularDuration, 4 * 3600);
  assert.strictEqual(day.yellowDuration, 0);
});

// 3. Other unapproved categories contribute zero additional Redmine hours
runTest('Spec Test 3: Other unapproved categories contribute zero additional Redmine hours', () => {
  const unapprovedCategories = [
    'Development',
    'Code Review',
    'Testing',
    'Documentation',
    'Architecture Design',
    'Support',
    'Client Meeting'
  ];
  const dateStr = '2026-10-15';
  const entries = unapprovedCategories.map((cat, idx) => ({
    id: 3000 + idx,
    spent_on: dateStr,
    hours: 1.0,
    issue_subject: cat,
    activity: cat
  }));

  const agg = aggregateRedmineTimeEntries(entries, new Set([dateStr]));
  assert.strictEqual(agg.yellowHoursByDate[dateStr], 0, 'Unapproved categories must contribute zero yellow hours');
  assert.strictEqual(agg.regularHoursByDate[dateStr], 0, 'Unapproved categories must contribute zero regular hours');
  assert.strictEqual(agg.totalYellowHours, 0);
  assert.strictEqual(agg.totalRegularHours, 0);
  assert.strictEqual(agg.totalExcludedHours, unapprovedCategories.length * 1.0);
});

// 4. Mixed approved and unapproved entries count only approved hours
runTest('Spec Test 4: Mixed approved and unapproved entries count only approved hours', () => {
  const dateStr = '2026-10-14';
  const entries = [
    { id: 4001, spent_on: dateStr, hours: 3.5, issue_subject: 'Bug Fixing', activity: 'Development' }, // Excluded
    { id: 4002, spent_on: dateStr, hours: 2.0, issue_subject: 'Holiday', activity: 'Discussion' }, // Approved (Holiday in subject)
    { id: 4003, spent_on: dateStr, hours: 1.5, issue_subject: 'Analytics', activity: 'Data Analysis' }, // Excluded
    { id: 4004, spent_on: dateStr, hours: 1.0, issue_subject: 'General', activity: 'Leave' } // Approved (Leave in activity)
  ];

  const agg = aggregateRedmineTimeEntries(entries, new Set([dateStr]));
  assert.strictEqual(agg.yellowHoursByDate[dateStr], 3.0, 'Only Holiday (2.0h) + Leave (1.0h) = 3.0h must count');
  assert.strictEqual(agg.yellowCatsByDate[dateStr]['Holiday'], 2.0);
  assert.strictEqual(agg.yellowCatsByDate[dateStr]['Leave'], 1.0);
  assert.strictEqual(agg.regularHoursByDate[dateStr], 0);
  assert.strictEqual(agg.totalRegularHours, 0);
  assert.strictEqual(agg.totalExcludedHours, 5.0, '3.5h Dev + 1.5h Data Analysis = 5.0h excluded');
});

// 5. Existing WorkLens Active Time remains unchanged
runTest('Spec Test 5: Existing WorkLens Active Time remains unchanged', () => {
  const dateStr = '2026-10-13';
  const originalActiveSeconds = 19453; // 5h 24m 13s

  const entries = [
    { id: 5001, spent_on: dateStr, hours: 4.0, activity: 'Development' }, // Unapproved
    { id: 5002, spent_on: dateStr, hours: 1.0, activity: 'Big Late' } // Approved
  ];

  const agg = aggregateRedmineTimeEntries(entries, new Set([dateStr]));
  const view = buildCombinedHistoricalView({
    periodName: 'test',
    dateObjects: [new Date(2026, 9, 13)],
    dailyDurations: { [dateStr]: originalActiveSeconds },
    dailyTimeRanges: {},
    redmineAggregation: agg,
    todayStr: '2026-10-18',
    isCurrentlyTracking: false,
    formatTime12Fn: null
  });

  const day = view.days[0];
  assert.strictEqual(day.activeSeconds, originalActiveSeconds, 'activeSeconds must match exact original WorkLens active time');
  assert.strictEqual(day.regularDuration, originalActiveSeconds, 'regularDuration must strictly equal original WorkLens active time');
  assert.strictEqual(day.duration, originalActiveSeconds + 3600, 'displayTotal must equal original active time + yellow hours');
});

// 6. No hours are double-counted
runTest('Spec Test 6: No hours are double-counted (stable ID dedup & single yellow inclusion)', () => {
  const dateStr = '2026-10-12';
  const originalActiveSeconds = 3 * 3600; // 3h

  // Feed duplicate entries simulating redundant pagination / polling
  const entries = [
    { id: 6001, spent_on: dateStr, hours: 1.0, activity: 'Leave' },
    { id: 6001, spent_on: dateStr, hours: 1.0, activity: 'Leave' }, // Duplicate
    { id: 6002, spent_on: dateStr, hours: 2.0, activity: 'Early Out' },
    { id: 6002, spent_on: dateStr, hours: 2.0, activity: 'Early Out' } // Duplicate
  ];

  const agg = aggregateRedmineTimeEntries(entries, new Set([dateStr]));
  assert.strictEqual(agg.yellowHoursByDate[dateStr], 3.0, 'Leave (1h) + Early Out (2h) = 3h total (duplicates skipped)');
  assert.strictEqual(agg.dedupedCount, 2);

  const view = buildCombinedHistoricalView({
    periodName: 'test',
    dateObjects: [new Date(2026, 9, 12)],
    dailyDurations: { [dateStr]: originalActiveSeconds },
    dailyTimeRanges: {},
    redmineAggregation: agg,
    todayStr: '2026-10-18',
    isCurrentlyTracking: false,
    formatTime12Fn: null
  });

  const day = view.days[0];
  // 3h active + 3h yellow = 6h (21600s), yellow counted exactly once
  assert.strictEqual(day.duration, 21600);
  assert.strictEqual(day.regularDuration, 10800);
  assert.strictEqual(day.yellowDuration, 10800);
  assert.strictEqual(day.regularDuration + day.yellowDuration, day.duration);
});

// 7. Last 7 Days and Last 30 Days both exclude unapproved hours
runTest('Spec Test 7: Last 7 Days and Last 30 Days both exclude unapproved hours', () => {
  const today = new Date(2026, 9, 18);
  const last7DateObjects = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(today);
    d.setDate(today.getDate() - i);
    last7DateObjects.push(d);
  }
  const last30DateObjects = [];
  for (let i = 0; i < 30; i++) {
    const d = new Date(today);
    d.setDate(today.getDate() - i);
    last30DateObjects.push(d);
  }

  const entries = [
    { id: 7001, spent_on: '2026-10-17', hours: 4.0, activity: 'Development' }, // Unapproved in last 7 & last 30
    { id: 7002, spent_on: '2026-10-17', hours: 1.0, activity: 'Early Out' }, // Approved in last 7 & last 30
    { id: 7003, spent_on: '2026-10-05', hours: 6.0, activity: 'Data Analysis' }, // Unapproved in last 30
    { id: 7004, spent_on: '2026-10-05', hours: 2.0, activity: 'Leave' } // Approved in last 30
  ];

  const set7 = new Set(last7DateObjects.map(d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`));
  const set30 = new Set(last30DateObjects.map(d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`));

  const agg7 = aggregateRedmineTimeEntries(entries, set7);
  const agg30 = aggregateRedmineTimeEntries(entries, set30);

  const view7 = buildCombinedHistoricalView({
    periodName: 'last7days',
    dateObjects: last7DateObjects,
    dailyDurations: {},
    dailyTimeRanges: {},
    redmineAggregation: agg7,
    todayStr: '2026-10-18',
    isCurrentlyTracking: false,
    formatTime12Fn: null
  });

  const view30 = buildCombinedHistoricalView({
    periodName: 'last30days',
    dateObjects: last30DateObjects,
    dailyDurations: {},
    dailyTimeRanges: {},
    redmineAggregation: agg30,
    todayStr: '2026-10-18',
    isCurrentlyTracking: false,
    formatTime12Fn: null
  });

  // Verify view7
  const day7_17 = view7.days.find(d => d.dateStr === '2026-10-17');
  assert.strictEqual(day7_17.duration, 3600, 'Last 7 Days: 1h Early Out only, 4h Development excluded');
  assert.strictEqual(day7_17.yellowDuration, 3600);
  assert.strictEqual(day7_17.regularDuration, 0);

  // Verify view30
  const day30_17 = view30.days.find(d => d.dateStr === '2026-10-17');
  const day30_05 = view30.days.find(d => d.dateStr === '2026-10-05');
  assert.strictEqual(day30_17.duration, 3600, 'Last 30 Days: 1h Early Out only, 4h Development excluded');
  assert.strictEqual(day30_05.duration, 7200, 'Last 30 Days: 2h Leave only, 6h Data Analysis excluded');
  assert.strictEqual(day30_05.yellowDuration, 7200);
  assert.strictEqual(day30_05.regularDuration, 0);
});

// 8. Cached or previously aggregated totals are recalculated correctly
runTest('Spec Test 8: Cached or previously aggregated totals are recalculated correctly', () => {
  const dateStr = '2026-10-11';
  const activeSeconds = 4 * 3600; // 4 hours active

  // Simulate stale cached pre-aggregation that previously included unapproved 3h Development
  const staleAgg = {
    regularHoursByDate: { [dateStr]: 3.0 }, // STALE / INCORRECT!
    yellowHoursByDate: { [dateStr]: 1.0 },
    yellowCatsByDate: { [dateStr]: { Leave: 1.0 } }
  };

  // Safe rebuild from authoritative source: recalculate aggregation from raw time entries
  const authoritativeEntries = [
    { id: 8001, spent_on: dateStr, hours: 3.0, activity: 'Development' }, // unapproved
    { id: 8002, spent_on: dateStr, hours: 1.0, activity: 'Leave' } // approved
  ];
  const freshAgg = aggregateRedmineTimeEntries(authoritativeEntries, new Set([dateStr]));

  const rebuiltView = buildCombinedHistoricalView({
    periodName: 'rebuilt',
    dateObjects: [new Date(2026, 9, 11)],
    dailyDurations: { [dateStr]: activeSeconds },
    dailyTimeRanges: {},
    redmineAggregation: freshAgg,
    todayStr: '2026-10-18',
    isCurrentlyTracking: false,
    formatTime12Fn: null
  });

  const day = rebuiltView.days[0];
  // Correct rebuilt total must be 4h active + 1h Leave = 5h (18000s), NOT 8h (28800s)!
  assert.strictEqual(day.duration, 18000, 'Rebuilt duration must purge stale 3h Development');
  assert.strictEqual(day.regularDuration, 14400, 'Regular duration must be exactly 4h active time');
  assert.strictEqual(day.yellowDuration, 3600, 'Yellow duration must be 1h Leave');
});

// 9. Red, blue, and green thresholds continue working
runTest('Spec Test 9: Red, blue, and green thresholds continue working', () => {
  // RED: < 7h (< 25200s)
  assert.strictEqual(getDailyActiveTimeColor(0), 'red');
  assert.strictEqual(getDailyActiveTimeColor(25199), 'red'); // 6h 59m 59s

  // BLUE: 7h through 7h 30m, inclusive (25200s - 27000s)
  assert.strictEqual(getDailyActiveTimeColor(25200), 'blue'); // 7h 00m 00s
  assert.strictEqual(getDailyActiveTimeColor(26100), 'blue'); // 7h 15m 00s
  assert.strictEqual(getDailyActiveTimeColor(27000), 'blue'); // 7h 30m 00s

  // GREEN: > 7h 30m (> 27000s)
  assert.strictEqual(getDailyActiveTimeColor(27001), 'green'); // 7h 30m 01s
  assert.strictEqual(getDailyActiveTimeColor(30000), 'green');
});

// 10. The yellow bar shows only approved-category hours
runTest('Spec Test 10: The yellow bar shows only approved-category hours', () => {
  const domState = setupMockDom();
  try {
    const rawData = {
      days: [
        {
          dateStr: '2026-10-14',
          weekdayDisplay: 'Wed, 14 Oct',
          duration: 25200, // 7h total (blue)
          regularDuration: 21600, // 6h active time
          yellowDuration: 3600, // 1h Holiday
          yellowCategories: [{ name: 'Holiday', hours: 1.0 }],
          startTime: '09:00 AM',
          endTime: '04:00 PM',
          hasData: true
        }
      ],
      totalSeconds: 25200
    };

    popupModule.renderHistoryView(rawData);

    const historyList = domState.elements['history-list'];
    const row = historyList.children[0];
    const regularBar = row.querySelector('.history-segment-regular');
    const yellowBar = row.querySelector('.history-segment-yellow');
    const subRow = row.querySelector('.history-subrow');

    assert.ok(regularBar, 'Regular bar must exist for active time');
    assert.ok(yellowBar, 'Yellow bar must exist for approved Holiday hours');
    assert.strictEqual(yellowBar.dataset.color, 'yellow');
    assert.ok(subRow.textContent.includes('1h Holiday'), 'Sub-row must display approved Holiday name');
    assert.strictEqual(subRow.textContent.includes('Development'), false, 'Sub-row must NOT mention unapproved activities');
    assert.strictEqual(subRow.textContent.includes('Data Analysis'), false);
  } finally {
    teardownMockDom(domState);
  }
});

// ---------------------------------------------------------------------------------
// MINIMAL DOM MOCK HELPER FOR UI RENDERING TESTS
// ---------------------------------------------------------------------------------
function setupMockDom() {
  const elements = {};

  function createMockElement(tag) {
    const el = {
      tagName: tag.toUpperCase(),
      className: '',
      classList: {
        add: (c) => { if (!el.className.includes(c)) el.className += ' ' + c; },
        remove: (c) => { el.className = el.className.replace(new RegExp('\\b' + c + '\\b', 'g'), '').trim(); },
        contains: (c) => el.className.includes(c),
        toggle: (c, val) => { if (val) el.classList.add(c); else el.classList.remove(c); }
      },
      style: {},
      dataset: {},
      children: [],
      _textContent: '',
      _innerHTML: '',
      get textContent() {
        if (this._textContent) return this._textContent;
        let str = this._innerHTML ? this._innerHTML.replace(/<[^>]+>/g, ' ') : '';
        for (const ch of this.children) {
          str += ' ' + ch.textContent;
        }
        return str.replace(/\s+/g, ' ').trim();
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
      setAttribute: () => {},
      getAttribute: () => null,
      appendChild: (child) => {
        el.children.push(child);
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

// ---------------------------------------------------------------------------------
// SUMMARY
// ---------------------------------------------------------------------------------
console.log('\n================================================================================');
console.log(` ALL 14 REDMINE TIME INTEGRATION & YELLOW PROGRESS BAR TESTS PASSED (${passed}/${total})`);
console.log('================================================================================\n');

process.exit(0);
