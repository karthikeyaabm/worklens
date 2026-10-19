// scratch/test_live_redmine_verification.js
// Live end-to-end runtime verification of Redmine Time Integration and Yellow Progress Bar segments

const dotenv = require('dotenv');
dotenv.config();

const redmineClient = require('../redmineClient');
const redmineTimeIntegration = require('../redmineTimeIntegration');

async function verifyLive() {
  console.log('================================================================================');
  console.log('    RUNTIME VERIFICATION: LIVE REDMINE API DATA & HISTORICAL COMBINED VIEW     ');
  console.log('================================================================================\n');

  const userId = 890;
  const dFrom = new Date();
  dFrom.setDate(dFrom.getDate() - 35);
  const fromStr = dFrom.toISOString().slice(0, 10);
  const toStr = new Date().toISOString().slice(0, 10);

  console.log(`[1] Querying live /time_entries.json for User ID ${userId} from ${fromStr} to ${toStr}...`);
  const entries = await redmineTimeIntegration.fetchRedmineTimeEntries(userId, fromStr, toStr, redmineClient);
  console.log(`    Successfully fetched ${entries.length} time entries from Redmine.\n`);

  console.log('[2] Aggregating entries and classifying categories...');
  const agg = redmineTimeIntegration.aggregateRedmineTimeEntries(entries);
  console.log(`    Total Yellow Hours:   ${agg.totalYellowHours}h`);
  console.log(`    Total Regular Hours:  ${agg.totalRegularHours}h (additional Redmine hours)`);
  console.log(`    Total Excluded Hours: ${agg.totalExcludedHours}h (unapproved Redmine categories)`);
  console.log(`    Total Processed:      ${agg.processedCount}`);
  console.log(`    Deduplicated Count:   ${agg.dedupedCount}\n`);

  console.log('[3] Inspecting Key Production Dates:');
  // Check Oct 18, 2026 (Has Early Out: 2h)
  console.log('  Date 2026-10-18:');
  console.log(`    Yellow Categories: ${JSON.stringify(agg.yellowCatsByDate['2026-10-18'] || {})}`);
  console.log(`    Yellow Hours:      ${agg.yellowHoursByDate['2026-10-18'] || 0}h`);
  console.log(`    Regular Hours:     ${agg.regularHoursByDate['2026-10-18'] || 0}h`);
  console.log(`    Excluded Hours:    ${agg.excludedHoursByDate['2026-10-18'] || 0}h`);

  // Check Oct 16, 2026 (Data Analysis / Project Management: 1h regular)
  console.log('  Date 2026-10-16:');
  console.log(`    Yellow Categories: ${JSON.stringify(agg.yellowCatsByDate['2026-10-16'] || {})}`);
  console.log(`    Yellow Hours:      ${agg.yellowHoursByDate['2026-10-16'] || 0}h`);
  console.log(`    Regular Hours:     ${agg.regularHoursByDate['2026-10-16'] || 0}h`);
  console.log(`    Excluded Hours:    ${agg.excludedHoursByDate['2026-10-16'] || 0}h\n`);

  console.log('[4] Building Last 7 Days Combined View:');
  const today = new Date();
  const last7DateObjects = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(today);
    d.setDate(today.getDate() - i);
    last7DateObjects.push(d);
  }

  // Simulate active tracking durations for demonstration (e.g. 5.5h on Oct 16)
  const simulatedActiveDurations = {
    '2026-10-16': 5.5 * 3600 // 5h 30m active tracking
  };

  const last7View = redmineTimeIntegration.buildCombinedHistoricalView({
    periodName: 'last7days',
    dateObjects: last7DateObjects,
    dailyDurations: simulatedActiveDurations,
    dailyTimeRanges: {},
    redmineAggregation: agg,
    todayStr: toStr,
    isCurrentlyTracking: false,
    formatTime12Fn: null
  });

  last7View.days.forEach(d => {
    const totalH = (d.duration / 3600).toFixed(1);
    const regH = (d.regularDuration / 3600).toFixed(1);
    const yelH = (d.yellowDuration / 3600).toFixed(1);
    const catStr = d.yellowCategories.length > 0
      ? d.yellowCategories.map(c => `${c.hours}h ${c.name}`).join(', ')
      : 'None';
    console.log(`    ${d.dateStr} (${d.weekdayDisplay.padEnd(11)}) | Total: ${totalH}h | Regular: ${regH}h | Yellow: ${yelH}h | Yellow Cats: ${catStr}`);
  });

  console.log('\n[5] Building Last 30 Days Combined View:');
  const last30DateObjects = [];
  for (let i = 0; i < 30; i++) {
    const d = new Date(today);
    d.setDate(today.getDate() - i);
    last30DateObjects.push(d);
  }

  const last30View = redmineTimeIntegration.buildCombinedHistoricalView({
    periodName: 'last30days',
    dateObjects: last30DateObjects,
    dailyDurations: {},
    dailyTimeRanges: {},
    redmineAggregation: agg,
    todayStr: toStr,
    isCurrentlyTracking: false,
    formatTime12Fn: null
  });

  console.log(`    Last 30 Days total combined time: ${(last30View.totalSeconds / 3600).toFixed(1)} hours across 30 days.`);
  const daysWithYellow = last30View.days.filter(d => d.yellowDuration > 0);
  console.log(`    Dates with yellow category entries in last 30 days: ${daysWithYellow.length} days.`);
  daysWithYellow.forEach(d => {
    console.log(`      ${d.dateStr} (${d.weekdayDisplay}): ${d.yellowCategories.map(c => `${c.hours}h ${c.name}`).join(', ')}`);
  });

  console.log('\n================================================================================');
  console.log('              LIVE RUNTIME VERIFICATION SUCCESSFULLY COMPLETED [OK]             ');
  console.log('================================================================================');
}

verifyLive().catch(err => {
  console.error('Runtime verification failed:', err);
  process.exit(1);
});
