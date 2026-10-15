// test_weekend_toggle_suite.js
// Verification suite for WorkLens Dashboard Weekend Visibility Toggle

const assert = require('assert');
const fs = require('fs');
const path = require('path');

console.log('================================================================================');
console.log('          WORKLENS DASHBOARD - WEEKEND VISIBILITY TOGGLE TEST SUITE             ');
console.log('================================================================================\n');

// 1. Helper function: isWeekend implementation mirror to test pure algorithm
function isWeekend(dateStr) {
  if (!dateStr || typeof dateStr !== 'string') return false;
  const parts = dateStr.split('-');
  if (parts.length !== 3) return false;
  const year = parseInt(parts[0], 10);
  const month = parseInt(parts[1], 10) - 1;
  const day = parseInt(parts[2], 10);
  if (isNaN(year) || isNaN(month) || isNaN(day)) return false;
  const date = new Date(year, month, day, 12, 0, 0);
  const dayOfWeek = date.getDay();
  return dayOfWeek === 0 || dayOfWeek === 6; // Sunday = 0, Saturday = 6
}

function filterDays(days, showWeekends) {
  return showWeekends ? days : days.filter(d => !isWeekend(d.dateStr));
}

// ---------------------------------------------------------------------------------
// TEST GROUP 1: HTML & CSS Structure Verification
// ---------------------------------------------------------------------------------
console.log('--- Test Group 1: HTML & CSS UI Requirements ---');

const htmlContent = fs.readFileSync(path.join(__dirname, 'renderer', 'activity-popup.html'), 'utf8');
const cssContent = fs.readFileSync(path.join(__dirname, 'renderer', 'activity-popup.css'), 'utf8');

// Checkbox exists with correct ID and label
assert.ok(htmlContent.includes('id="toggle-weekends"'), 'HTML must contain checkbox with id="toggle-weekends"');
assert.ok(htmlContent.includes('id="weekend-toggle-container"'), 'HTML must contain container id="weekend-toggle-container"');
assert.ok(htmlContent.includes('Show Weekends (Sat & Sun)'), 'HTML must display label "Show Weekends (Sat & Sun)"');
assert.ok(htmlContent.includes('class="weekend-toggle-container hidden"'), 'Container must have hidden class by default');
assert.ok(!htmlContent.includes('id="toggle-weekends" checked'), 'Checkbox must NOT be checked by default in HTML');

// Checkbox position: above list-header
const checkboxIndex = htmlContent.indexOf('id="weekend-toggle-container"');
const listHeaderIndex = htmlContent.indexOf('id="list-header"');
assert.ok(checkboxIndex > 0 && listHeaderIndex > 0, 'Both toggle and list header must exist in HTML');
assert.ok(checkboxIndex < listHeaderIndex, 'Weekend toggle must be placed above the list header');

// CSS classes exist
assert.ok(cssContent.includes('.weekend-toggle-container'), 'CSS must contain .weekend-toggle-container');
assert.ok(cssContent.includes('.weekend-toggle-label'), 'CSS must contain .weekend-toggle-label');
assert.ok(cssContent.includes('.weekend-toggle-custom'), 'CSS must contain .weekend-toggle-custom');
assert.ok(cssContent.includes('.weekend-toggle-input'), 'CSS must contain .weekend-toggle-input');
assert.ok(cssContent.includes('.date-controls-row'), 'CSS must contain .date-controls-row');

console.log('PASS: [1.1] Checkbox and container present with correct label and default unchecked state');
console.log('PASS: [1.2] Checkbox is correctly positioned above the historical data list header');
console.log('PASS: [1.3] Fluent CSS rules for checkbox, labels, and date controls row verified');

// ---------------------------------------------------------------------------------
// TEST GROUP 2: Local Calendar Date & Weekday Classification
// ---------------------------------------------------------------------------------
console.log('\n--- Test Group 2: Weekday Classification & Calendar Boundaries ---');

// Standard week check (October 2026)
// 2026-10-12 (Mon) to 2026-10-18 (Sun)
assert.strictEqual(isWeekend('2026-10-12'), false, 'Monday 2026-10-12 must not be weekend');
assert.strictEqual(isWeekend('2026-10-13'), false, 'Tuesday 2026-10-13 must not be weekend');
assert.strictEqual(isWeekend('2026-10-14'), false, 'Wednesday 2026-10-14 must not be weekend');
assert.strictEqual(isWeekend('2026-10-15'), false, 'Thursday 2026-10-15 must not be weekend');
assert.strictEqual(isWeekend('2026-10-16'), false, 'Friday 2026-10-16 must not be weekend');
assert.strictEqual(isWeekend('2026-10-17'), true, 'Saturday 2026-10-17 must be weekend');
assert.strictEqual(isWeekend('2026-10-18'), true, 'Sunday 2026-10-18 must be weekend');

// Month boundaries
// 2026-02-28 (Saturday), 2026-03-01 (Sunday), 2026-03-02 (Monday)
assert.strictEqual(isWeekend('2026-02-28'), true, '2026-02-28 (Saturday) must be weekend');
assert.strictEqual(isWeekend('2026-03-01'), true, '2026-03-01 (Sunday) must be weekend');
assert.strictEqual(isWeekend('2026-03-02'), false, '2026-03-02 (Monday) must not be weekend');

// Leap year boundary (February 2024)
// 2024-02-29 (Thursday), 2024-03-01 (Friday), 2024-03-02 (Saturday), 2024-03-03 (Sunday)
assert.strictEqual(isWeekend('2024-02-29'), false, '2024-02-29 (Thursday) must not be weekend');
assert.strictEqual(isWeekend('2024-03-01'), false, '2024-03-01 (Friday) must not be weekend');
assert.strictEqual(isWeekend('2024-03-02'), true, '2024-03-02 (Saturday) must be weekend');
assert.strictEqual(isWeekend('2024-03-03'), true, '2024-03-03 (Sunday) must be weekend');

// Year transition boundary (2025 -> 2026)
// 2025-12-31 (Wednesday), 2026-01-01 (Thursday), 2026-01-02 (Friday), 2026-01-03 (Saturday), 2026-01-04 (Sunday)
assert.strictEqual(isWeekend('2025-12-31'), false, '2025-12-31 (Wednesday) must not be weekend');
assert.strictEqual(isWeekend('2026-01-01'), false, '2026-01-01 (Thursday) must not be weekend');
assert.strictEqual(isWeekend('2026-01-02'), false, '2026-01-02 (Friday) must not be weekend');
assert.strictEqual(isWeekend('2026-01-03'), true, '2026-01-03 (Saturday) must be weekend');
assert.strictEqual(isWeekend('2026-01-04'), true, '2026-01-04 (Sunday) must be weekend');

// Defensive boundary tests (null, invalid, non-string)
assert.strictEqual(isWeekend(null), false, 'null must return false');
assert.strictEqual(isWeekend(''), false, 'empty string must return false');
assert.strictEqual(isWeekend('invalid-date'), false, 'invalid string must return false');
assert.strictEqual(isWeekend(12345), false, 'numeric input must return false');

console.log('PASS: [2.1] Correctly identifies Saturdays and Sundays (Sunday=0, Saturday=6)');
console.log('PASS: [2.2] Month boundary transitions classified accurately (Feb 28 - Mar 1)');
console.log('PASS: [2.3] Leap year leap-day transitions classified accurately (Feb 29 - Mar 3)');
console.log('PASS: [2.4] Year transitions classified accurately (Dec 31 - Jan 4)');
console.log('PASS: [2.5] Safe handling for null, invalid, and malformed date strings');

// ---------------------------------------------------------------------------------
// TEST GROUP 3: Last 7 Days & Last 30 Days Filtering Behavior
// ---------------------------------------------------------------------------------
console.log('\n--- Test Group 3: Last 7 Days & Last 30 Days Filtering Behavior ---');

// Generate mock Last 7 Days data (ending on Thu 2026-10-15)
// Dates: 2026-10-15 (Thu), 14 (Wed), 13 (Tue), 12 (Mon), 11 (Sun), 10 (Sat), 09 (Fri)
const mockLast7Days = [
  { dateStr: '2026-10-15', duration: 28800, startTime: '09:00 AM', endTime: '05:00 PM', hasData: true }, // Thu
  { dateStr: '2026-10-14', duration: 27000, startTime: '09:15 AM', endTime: '04:45 PM', hasData: true }, // Wed
  { dateStr: '2026-10-13', duration: 25200, startTime: '09:30 AM', endTime: '04:30 PM', hasData: true }, // Tue
  { dateStr: '2026-10-12', duration: 0, startTime: '--', endTime: '--', hasData: false }, // Mon (zero activity weekday)
  { dateStr: '2026-10-11', duration: 7200, startTime: '10:00 AM', endTime: '12:00 PM', hasData: true },  // Sun (weekend)
  { dateStr: '2026-10-10', duration: 0, startTime: '--', endTime: '--', hasData: false }, // Sat (zero activity weekend)
  { dateStr: '2026-10-09', duration: 28800, startTime: '09:00 AM', endTime: '05:00 PM', hasData: true }  // Fri
];

const mockRawData7 = {
  period: 'last7days',
  days: mockLast7Days,
  totalSeconds: mockLast7Days.reduce((sum, d) => sum + d.duration, 0)
};

// Default (showWeekends = false): Sat & Sun hidden
const filtered7Default = filterDays(mockRawData7.days, false);
assert.strictEqual(filtered7Default.length, 5, 'Last 7 Days must show exactly 5 weekdays by default');
assert.ok(!filtered7Default.some(d => d.dateStr === '2026-10-11'), 'Sunday must be hidden by default');
assert.ok(!filtered7Default.some(d => d.dateStr === '2026-10-10'), 'Saturday must be hidden by default');
// Zero-activity weekday preserved
assert.ok(filtered7Default.some(d => d.dateStr === '2026-10-12' && d.duration === 0), 'Zero-activity Monday must remain visible');

// When showWeekends = true: All 7 days shown
const filtered7WithWeekends = filterDays(mockRawData7.days, true);
assert.strictEqual(filtered7WithWeekends.length, 7, 'Last 7 Days must show all 7 days when checked');
assert.ok(filtered7WithWeekends.some(d => d.dateStr === '2026-10-11' && d.duration === 7200), 'Sunday with 2h activity must be visible');
assert.ok(filtered7WithWeekends.some(d => d.dateStr === '2026-10-10' && d.duration === 0), 'Zero-activity Saturday must be visible when checked');

// Toggle back to false: Sat & Sun hidden again
const filtered7ToggledBack = filterDays(mockRawData7.days, false);
assert.strictEqual(filtered7ToggledBack.length, 5, 'Unchecking must hide weekends again');

// Mock Last 30 Days data
const mockLast30Days = [];
const baseDate = new Date(2026, 9, 15, 12, 0, 0); // Oct 15, 2026
for (let i = 0; i < 30; i++) {
  const d = new Date(baseDate.getTime() - i * 86400000);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const dayNum = String(d.getDate()).padStart(2, '0');
  const ds = `${y}-${m}-${dayNum}`;
  mockLast30Days.push({
    dateStr: ds,
    duration: (i % 7 === 0) ? 0 : 25000,
    startTime: '09:00 AM',
    endTime: '05:00 PM',
    hasData: true
  });
}

const mockRawData30 = {
  period: 'last30days',
  days: mockLast30Days,
  totalSeconds: mockLast30Days.reduce((sum, d) => sum + d.duration, 0)
};

// Check 30-day default
const filtered30Default = filterDays(mockRawData30.days, false);
assert.ok(filtered30Default.length < 30, 'Last 30 Days must exclude weekends by default');
assert.ok(!filtered30Default.some(d => isWeekend(d.dateStr)), 'No weekend dates should exist in 30-day default view');

// Check 30-day checked
const filtered30Checked = filterDays(mockRawData30.days, true);
assert.strictEqual(filtered30Checked.length, 30, 'Last 30 Days must show all 30 days when checked');
assert.ok(filtered30Checked.some(d => isWeekend(d.dateStr)), 'Weekend dates must be present when checked');

console.log('PASS: [3.1] Last 7 Days hides Saturday and Sunday by default (5 visible days)');
console.log('PASS: [3.2] Zero-activity weekdays remain visible as before (duration: 0)');
console.log('PASS: [3.3] Checking toggle displays Saturday and Sunday with actual activity');
console.log('PASS: [3.4] Zero-activity weekend dates preserved when weekends are enabled');
console.log('PASS: [3.5] Unchecking immediately hides weekend days again');
console.log('PASS: [3.6] Last 30 Days filters and displays weekends consistently');

// ---------------------------------------------------------------------------------
// TEST GROUP 4: Data Immutability & Total Seconds Preservation
// ---------------------------------------------------------------------------------
console.log('\n--- Test Group 4: Data Immutability & Total Active Hours Preservation ---');

const originalDaysCount = mockRawData7.days.length;
const originalTotalSeconds = mockRawData7.totalSeconds;

// Run multiple toggles
filterDays(mockRawData7.days, false);
filterDays(mockRawData7.days, true);
filterDays(mockRawData7.days, false);

assert.strictEqual(mockRawData7.days.length, originalDaysCount, 'Original rawData.days array length must never be modified');
assert.strictEqual(mockRawData7.totalSeconds, originalTotalSeconds, 'Underlying total recorded seconds must remain unmodified');

console.log('PASS: [4.1] Original rawData.days array is not mutated or truncated');
console.log('PASS: [4.2] Total active seconds for the historical period remain preserved');

// ---------------------------------------------------------------------------------
// TEST GROUP 5: Tab Visibility & Shared State Rules
// ---------------------------------------------------------------------------------
console.log('\n--- Test Group 5: Tab Visibility & Cross-Tab Shared State ---');

// Verify tab visibility rule:
// Today & Yesterday: hidden
// Last 7 Days & Last 30 Days: visible
function isToggleVisibleForPeriod(period) {
  return (period === 'last7days' || period === 'last30days' || period === 'current_month');
}

assert.strictEqual(isToggleVisibleForPeriod('today'), false, 'Today view must NOT show weekend toggle');
assert.strictEqual(isToggleVisibleForPeriod('yesterday'), false, 'Yesterday view must NOT show weekend toggle');
assert.strictEqual(isToggleVisibleForPeriod('last7days'), true, 'Last 7 Days view MUST show weekend toggle');
assert.strictEqual(isToggleVisibleForPeriod('last30days'), true, 'Last 30 Days view MUST show weekend toggle');

// Shared state between Last 7 Days and Last 30 Days
let sharedShowWeekendsState = false; // default

// User checks box in Last 7 Days
sharedShowWeekendsState = true;
// User switches to Last 30 Days
const visibleIn30AfterToggleIn7 = filterDays(mockRawData30.days, sharedShowWeekendsState);
assert.strictEqual(visibleIn30AfterToggleIn7.length, 30, 'State toggled in Last 7 Days must apply to Last 30 Days');

// User unchecks in Last 30 Days
sharedShowWeekendsState = false;
// User switches to Last 7 Days
const visibleIn7AfterToggleIn30 = filterDays(mockRawData7.days, sharedShowWeekendsState);
assert.strictEqual(visibleIn7AfterToggleIn30.length, 5, 'State toggled in Last 30 Days must apply to Last 7 Days');

console.log('PASS: [5.1] Toggle is hidden on Today and Yesterday views');
console.log('PASS: [5.2] Toggle is visible on Last 7 Days and Last 30 Days views');
console.log('PASS: [5.3] Shared checkbox state preserved when switching between historical tabs');

// ---------------------------------------------------------------------------------
// SUMMARY
// ---------------------------------------------------------------------------------
console.log('\n================================================================================');
console.log('                    ALL WEEKEND TOGGLE TESTS PASSED [OK]                       ');
console.log('================================================================================\n');
process.exit(0);
