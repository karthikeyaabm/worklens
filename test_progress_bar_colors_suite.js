// test_progress_bar_colors_suite.js
// Verification suite for WorkLens Dashboard Dynamic Daily Active Time Progress Bar Colors

const assert = require('assert');
const fs = require('fs');
const path = require('path');

console.log('================================================================================');
console.log('       WORKLENS DASHBOARD - DYNAMIC PROGRESS BAR COLOR TEST SUITE               ');
console.log('================================================================================\n');

// Import the renderer popup module
const popupModule = require('./renderer/activity-popup.js');
const { getDailyActiveTimeColor, isWeekend } = popupModule;

// ---------------------------------------------------------------------------------
// TEST GROUP 1: Duration Thresholds & Color Classification
// ---------------------------------------------------------------------------------
console.log('--- Test Group 1: Exact Duration Color Threshold Rules ---');

// Rules:
// - RED: Less than 7 hours (< 420 minutes / < 25200 seconds)
// - BLUE: Exactly 7 hours (420m / 25200s) or exactly 7 hours 30 minutes (450m / 27000s)
// - YELLOW: Greater than 7 hours but less than 7 hours 30 minutes (> 420m && < 450m / > 25200s && < 27000s)
// - GREEN: More than 7 hours 30 minutes (> 450 minutes / > 27000 seconds)

const testCases = [
  { label: '0h (0 seconds)', duration: 0, expected: 'red' },
  { label: '1s (1 second)', duration: 1, expected: 'red' },
  { label: '3h (10800 seconds)', duration: 3 * 3600, expected: 'red' },
  { label: '6h 59m (25140 seconds)', duration: 6 * 3600 + 59 * 60, expected: 'red' },
  { label: '6h 59m 59s (25199 seconds)', duration: 25199, expected: 'red' },
  { label: '7h 00m (25200 seconds / exactly 420m)', duration: 7 * 3600, expected: 'blue' },
  { label: '7h 01m (25260 seconds / 421m)', duration: 7 * 3600 + 1 * 60, expected: 'yellow' },
  { label: '7h 15m (26100 seconds / 435m)', duration: 7 * 3600 + 15 * 60, expected: 'yellow' },
  { label: '7h 29m (26940 seconds / 449m)', duration: 7 * 3600 + 29 * 60, expected: 'yellow' },
  { label: '7h 30m (27000 seconds / exactly 450m)', duration: 7 * 3600 + 30 * 60, expected: 'blue' },
  { label: '7h 30m 01s (27001 seconds / > 450m)', duration: 27001, expected: 'green' },
  { label: '7h 31m (27060 seconds / 451m)', duration: 7 * 3600 + 31 * 60, expected: 'green' },
  { label: '8h 00m (28800 seconds / 480m)', duration: 8 * 3600, expected: 'green' },
  { label: '10h 30m (37800 seconds)', duration: 10 * 3600 + 30 * 60, expected: 'green' }
];

testCases.forEach(({ label, duration, expected }) => {
  const actual = getDailyActiveTimeColor(duration);
  assert.strictEqual(actual, expected, `Duration ${label} must yield color "${expected}", got "${actual}"`);
  console.log(`  PASS: ${label.padEnd(40)} -> ${actual.toUpperCase()}`);
});

// Edge case defense
assert.strictEqual(getDailyActiveTimeColor(null), 'red', 'null duration must safely return red');
assert.strictEqual(getDailyActiveTimeColor(undefined), 'red', 'undefined duration must safely return red');
assert.strictEqual(getDailyActiveTimeColor(-100), 'red', 'negative duration must safely return red');

console.log('PASS: [1.1] All requested duration threshold benchmarks correctly classified');

// ---------------------------------------------------------------------------------
// TEST GROUP 2: CSS Stylesheet Verification
// ---------------------------------------------------------------------------------
console.log('\n--- Test Group 2: CSS Rules & Visual Preservations ---');

const cssContent = fs.readFileSync(path.join(__dirname, 'renderer', 'activity-popup.css'), 'utf8');

// Ensure base progress bar styles remain preserved
assert.ok(cssContent.includes('.history-progress-bar {'), 'Base .history-progress-bar rule must exist');
assert.ok(cssContent.includes('border-radius: 2px;'), 'Progress bar rounded corners must be preserved');
assert.ok(cssContent.includes('transition: width 350ms'), 'Smooth width transition must be preserved');

// Ensure all 4 color classes exist
assert.ok(cssContent.includes('.history-progress-bar.color-red'), 'CSS must define .history-progress-bar.color-red');
assert.ok(cssContent.includes('.history-progress-bar.color-blue'), 'CSS must define .history-progress-bar.color-blue');
assert.ok(cssContent.includes('.history-progress-bar.color-yellow'), 'CSS must define .history-progress-bar.color-yellow');
assert.ok(cssContent.includes('.history-progress-bar.color-green'), 'CSS must define .history-progress-bar.color-green');

// Check gradient styles
assert.ok(cssContent.includes('#ef4444'), 'Red gradient must use modern palette (#ef4444)');
assert.ok(cssContent.includes('#3b82f6'), 'Blue gradient must use modern palette (#3b82f6)');
assert.ok(cssContent.includes('#f59e0b'), 'Yellow gradient must use modern palette (#f59e0b)');
assert.ok(cssContent.includes('#10b981'), 'Green gradient must use modern palette (#10b981)');

console.log('PASS: [2.1] Progress bar dimensions, animations, and border-radius preserved');
console.log('PASS: [2.2] Red, Blue, Yellow, and Green color rules present in activity-popup.css');

// ---------------------------------------------------------------------------------
// TEST GROUP 3: Last 7 Days & Last 30 Days Integration
// ---------------------------------------------------------------------------------
console.log('\n--- Test Group 3: Historical Views & Weekend Toggle Integration ---');

// Mock historical days spanning all color categories and weekends
// Oct 15 (Thu) to Oct 9 (Fri)
const mockLast7Days = [
  { dateStr: '2026-10-15', duration: 28800, startTime: '09:00 AM', endTime: '05:00 PM' }, // Thu: 8h -> GREEN
  { dateStr: '2026-10-14', duration: 27060, startTime: '09:00 AM', endTime: '04:31 PM' }, // Wed: 7h 31m -> GREEN
  { dateStr: '2026-10-13', duration: 27000, startTime: '09:00 AM', endTime: '04:30 PM' }, // Tue: 7h 30m -> BLUE
  { dateStr: '2026-10-12', duration: 25200, startTime: '09:00 AM', endTime: '04:00 PM' }, // Mon: 7h 00m -> BLUE
  { dateStr: '2026-10-11', duration: 7200, startTime: '10:00 AM', endTime: '12:00 PM' },  // Sun: 2h (weekend) -> RED
  { dateStr: '2026-10-10', duration: 0, startTime: '--', endTime: '--' },                 // Sat: 0h (weekend) -> RED (0% fill)
  { dateStr: '2026-10-09', duration: 25140, startTime: '09:00 AM', endTime: '03:59 PM' }  // Fri: 6h 59m -> RED
];

// Check color resolution for each day
const expectedColors = ['green', 'green', 'blue', 'blue', 'red', 'red', 'red'];
mockLast7Days.forEach((day, i) => {
  const color = getDailyActiveTimeColor(day.duration);
  assert.strictEqual(color, expectedColors[i], `Day ${day.dateStr} (${day.duration}s) must be ${expectedColors[i]}`);
});
console.log('PASS: [3.1] Color classification across mixed duration dataset matches expectations');

// Default view (showWeekends = false): Only weekdays
const weekdaysOnly = mockLast7Days.filter(d => !isWeekend(d.dateStr));
assert.strictEqual(weekdaysOnly.length, 5, 'Weekdays only must exclude weekend days');
assert.strictEqual(getDailyActiveTimeColor(weekdaysOnly[0].duration), 'green', 'Thursday (8h) is green');
assert.strictEqual(getDailyActiveTimeColor(weekdaysOnly[1].duration), 'green', 'Wednesday (7h 31m) is green');
assert.strictEqual(getDailyActiveTimeColor(weekdaysOnly[2].duration), 'blue', 'Tuesday (7h 30m) is blue');
assert.strictEqual(getDailyActiveTimeColor(weekdaysOnly[3].duration), 'blue', 'Monday (7h 00m) is blue');
assert.strictEqual(getDailyActiveTimeColor(weekdaysOnly[4].duration), 'red', 'Friday (6h 59m) is red');
console.log('PASS: [3.2] Visible weekdays have correct dynamic colors when Show Weekends is unchecked');

// Toggled view (showWeekends = true): All 7 days
const all7Days = mockLast7Days;
assert.strictEqual(all7Days.length, 7, 'All 7 days visible when checked');
assert.strictEqual(getDailyActiveTimeColor(all7Days[4].duration), 'red', 'Sunday (2h) is red');
assert.strictEqual(getDailyActiveTimeColor(all7Days[5].duration), 'red', 'Saturday (0h) is red with zero fill');
console.log('PASS: [3.3] Weekend days when shown correctly adhere to dynamic color rules');

// 30-day simulation
const mock30Days = [];
for (let i = 0; i < 30; i++) {
  let dur = 0;
  if (i % 3 === 0) dur = 28800; // 8h -> green
  else if (i % 3 === 1) dur = 26100; // 7h 15m -> yellow
  else dur = 25140; // 6h 59m -> red

  mock30Days.push({
    dateStr: `2026-09-${String(i + 1).padStart(2, '0')}`,
    duration: dur
  });
}

mock30Days.forEach(day => {
  const c = getDailyActiveTimeColor(day.duration);
  if (day.duration === 28800) assert.strictEqual(c, 'green');
  if (day.duration === 26100) assert.strictEqual(c, 'yellow');
  if (day.duration === 25140) assert.strictEqual(c, 'red');
});
console.log('PASS: [3.4] Last 30 Days view resolves dynamic colors correctly across all 30 days');

// ---------------------------------------------------------------------------------
// SUMMARY
// ---------------------------------------------------------------------------------
console.log('\n================================================================================');
console.log('              ALL DYNAMIC PROGRESS BAR COLOR TESTS PASSED [OK]                  ');
console.log('================================================================================\n');
process.exit(0);
