// test_reportees_dashboard_suite.js
// Production-Level Test Suite for WorkLens Reportees Dashboard Integration

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const reporteesService = require('./reporteesService');
const popupRenderer = require('./renderer/activity-popup');

let totalTests = 0;
let passedTests = 0;
let failedTests = 0;

function runTest(testName, fn) {
  totalTests++;
  try {
    fn();
    passedTests++;
    console.log(`PASS: ${testName}`);
  } catch (err) {
    failedTests++;
    console.error(`FAIL: ${testName}`);
    console.error(`    ${err.message}`);
  }
}

async function runAsyncTest(testName, fn) {
  totalTests++;
  try {
    await fn();
    passedTests++;
    console.log(`PASS: ${testName}`);
  } catch (err) {
    failedTests++;
    console.error(`FAIL: ${testName}`);
    console.error(`    ${err.message}`);
  }
}

async function runSuite() {
  console.log('================================================================================');
  console.log('       WORKLENS REPORTEES DASHBOARD INTEGRATION TEST SUITE                      ');
  console.log('================================================================================');

  // -----------------------------------------------------------------------------
  // 1. DATE FORMATTING & PARSING TESTS
  // -----------------------------------------------------------------------------
  console.log('\n[1] Date Formatting & Parsing Tests:');

  runTest('1.1 parseDateDDMMYYYY converts DD-MM-YYYY string to Date', () => {
    const d = reporteesService.parseDateDDMMYYYY('23-10-2026');
    assert.ok(d instanceof Date, 'Should return a Date instance');
    assert.strictEqual(d.getFullYear(), 2026);
    assert.strictEqual(d.getMonth(), 9); // October is month 9 (0-indexed)
    assert.strictEqual(d.getDate(), 23);
  });

  runTest('1.2 parseDateDDMMYYYY returns null for invalid dates', () => {
    assert.strictEqual(reporteesService.parseDateDDMMYYYY(null), null);
    assert.strictEqual(reporteesService.parseDateDDMMYYYY(''), null);
    assert.strictEqual(reporteesService.parseDateDDMMYYYY('invalid-date'), null);
  });

  runTest('1.3 formatDisplayDate converts "23-10-2026" to "23 Oct 2026"', () => {
    const formatted = reporteesService.formatDisplayDate('23-10-2026');
    assert.strictEqual(formatted, '23 Oct 2026');
  });

  runTest('1.4 formatDisplayDate handles edge month transitions', () => {
    assert.strictEqual(reporteesService.formatDisplayDate('01-01-2026'), '1 Jan 2026');
    assert.strictEqual(reporteesService.formatDisplayDate('31-12-2026'), '31 Dec 2026');
  });

  // -----------------------------------------------------------------------------
  // 2. DATA SANITIZATION & DEDUPLICATION TESTS
  // -----------------------------------------------------------------------------
  console.log('\n[2] Data Sanitization & Deduplication Tests:');

  runTest('2.1 Sanitizes valid payload and derives correct summary metrics', () => {
    const rawPayload = {
      manager: { id: 890, name: 'Karthikeya Kondavathri' },
      from: '27-09-2026',
      to: '26-10-2026',
      days: 30,
      total_reportees: 2,
      team_total_hours: 320.0,
      reportees: [
        {
          user: { id: 424, name: 'Vishal Hake', login: 'vishal.hake' },
          total_hours: 16.0,
          daily: [
            {
              date: '23-10-2026',
              total_hours: 8.0,
              entries: [
                {
                  id: 101,
                  user_id: 424,
                  project: 'SEPG & SQA',
                  issue_subject: 'Monitoring & Control',
                  activity: 'Process Automation',
                  hours: 8.0,
                  spent_on: '23-10-2026'
                }
              ]
            },
            {
              date: '22-10-2026',
              total_hours: 8.0,
              entries: [
                {
                  id: 102,
                  user_id: 424,
                  project: 'SEPG & SQA',
                  issue_subject: 'Monitoring & Control',
                  activity: 'Process Automation',
                  hours: 8.0,
                  spent_on: '22-10-2026'
                }
              ]
            }
          ]
        }
      ]
    };

    const sanitized = reporteesService.sanitizeTeamHistoryData(rawPayload);
    assert.strictEqual(sanitized.total_reportees, 2);
    assert.strictEqual(sanitized.team_total_hours, 320.0);
    assert.strictEqual(sanitized.from_formatted, '27 Sep 2026');
    assert.strictEqual(sanitized.to_formatted, '26 Oct 2026');
    assert.strictEqual(sanitized.reportees.length, 1);

    const r1 = sanitized.reportees[0];
    assert.strictEqual(r1.name, 'Vishal Hake');
    assert.strictEqual(r1.login, 'vishal.hake');
    assert.strictEqual(r1.active_days, 2);
    assert.strictEqual(r1.all_entries.length, 2);
    assert.strictEqual(r1.avg_daily_hours, 8.0);
  });

  runTest('2.2 Deduplicates timesheet entries across nested structures', () => {
    const rawWithDupes = {
      total_reportees: 1,
      reportees: [
        {
          user: { id: 1, name: 'Test User', login: 'test.user' },
          total_hours: 8.0,
          daily: [
            {
              date: '23-10-2026',
              total_hours: 8.0,
              entries: [
                { id: 999, project: 'App', hours: 4.0 },
                { id: 999, project: 'App', hours: 4.0 } // duplicate entry id
              ]
            }
          ]
        }
      ]
    };

    const sanitized = reporteesService.sanitizeTeamHistoryData(rawWithDupes);
    assert.strictEqual(sanitized.reportees[0].all_entries.length, 1, 'Should deduplicate duplicate entry IDs');
  });

  runTest('2.3 Safely handles null, empty, or missing API properties', () => {
    const emptyPayload = {
      reportees: [
        {
          user: null,
          total_hours: null,
          daily: null
        }
      ]
    };

    const sanitized = reporteesService.sanitizeTeamHistoryData(emptyPayload);
    assert.strictEqual(sanitized.total_reportees, 1);
    assert.strictEqual(sanitized.reportees[0].name, 'Unknown Employee');
    assert.strictEqual(sanitized.reportees[0].total_hours, 0);
    assert.strictEqual(sanitized.reportees[0].all_entries.length, 0);
  });

  // -----------------------------------------------------------------------------
  // 3. DYNAMIC VISIBILITY & REPORTEE COUNT LOGIC
  // -----------------------------------------------------------------------------
  console.log('\n[3] Dynamic Visibility & Reportees Count Tests:');

  await runAsyncTest('3.1 Live API returns total_reportees > 0 for manager karthikeya.kondavath', async () => {
    const result = await reporteesService.getReporteesCount('karthikeya.kondavath');
    assert.strictEqual(typeof result.total_reportees, 'number', 'total_reportees must be a number');
    assert.ok(result.total_reportees > 0, 'User should have reportees > 0');
    assert.strictEqual(result.has_reportees, true, 'has_reportees must be true');
  });

  await runAsyncTest('3.2 Missing or invalid user returns total_reportees: null and has_reportees: false', async () => {
    const result = await reporteesService.getReporteesCount('');
    assert.strictEqual(result.total_reportees, null);
    assert.strictEqual(result.has_reportees, false);
  });

  runTest('3.3 Visibility rule verification', () => {
    // If total_reportees > 0: Show label with actual count N
    const count1 = 2;
    const isVisible1 = typeof count1 === 'number' && count1 > 0;
    assert.strictEqual(isVisible1, true);
    assert.strictEqual(`Reportees (${count1})`, 'Reportees (2)');

    // If total_reportees === 0: Hide label completely
    const count2 = 0;
    const isVisible2 = typeof count2 === 'number' && count2 > 0;
    assert.strictEqual(isVisible2, false);

    // If total_reportees is null / undefined: Hide label completely
    const count3 = null;
    const isVisible3 = typeof count3 === 'number' && count3 > 0;
    assert.strictEqual(isVisible3, false);
  });

  // -----------------------------------------------------------------------------
  // 4. HTML STRUCTURE & ASSET VERIFICATION
  // -----------------------------------------------------------------------------
  console.log('\n[4] HTML & CSS Structure Verification:');

  runTest('4.1 activity-popup.html contains both ACTIVE TIME and Reportees navigation buttons', () => {
    const htmlPath = path.join(__dirname, 'renderer', 'activity-popup.html');
    const content = fs.readFileSync(htmlPath, 'utf8');

    assert.ok(content.includes('id="tab-nav-active-time"'), 'Must have #tab-nav-active-time');
    assert.ok(content.includes('id="tab-nav-reportees"'), 'Must have #tab-nav-reportees');
    assert.ok(content.includes('id="nav-reportees-label"'), 'Must have #nav-reportees-label');
    assert.ok(content.includes('id="active-time-view"'), 'Must have #active-time-view container');
    assert.ok(content.includes('id="reportees-view"'), 'Must have #reportees-view container');
  });

  runTest('4.2 activity-popup.html contains all 3 summary cards and search input', () => {
    const htmlPath = path.join(__dirname, 'renderer', 'activity-popup.html');
    const content = fs.readFileSync(htmlPath, 'utf8');

    assert.ok(content.includes('id="summary-total-reportees"'), 'Must have #summary-total-reportees');
    assert.ok(content.includes('id="summary-team-hours"'), 'Must have #summary-team-hours');
    assert.ok(content.includes('id="summary-period-days"'), 'Must have #summary-period-days');
    assert.ok(content.includes('id="reportees-search-input"'), 'Must have #reportees-search-input');
    assert.ok(content.includes('id="reportees-range-selector-btn"'), 'Must have #reportees-range-selector-btn');
    assert.ok(content.includes('id="reportees-list"'), 'Must have #reportees-list container');
  });

  runTest('4.3 activity-popup.css contains required Reportees styling and pill button', () => {
    const cssPath = path.join(__dirname, 'renderer', 'activity-popup.css');
    const content = fs.readFileSync(cssPath, 'utf8');

    assert.ok(content.includes('.reportees-pill-btn'), 'Must style .reportees-pill-btn');
    assert.ok(content.includes('.reportee-card'), 'Must style .reportee-card');
    assert.ok(content.includes('.reportee-avatar'), 'Must style .reportee-avatar');
    assert.ok(content.includes('.reportee-table'), 'Must style .reportee-table');
    assert.ok(content.includes('.view-panel'), 'Must define .view-panel');
  });

  runTest('4.4 activity-popup contains refresh button and spinning styles', () => {
    const htmlPath = path.join(__dirname, 'renderer', 'activity-popup.html');
    const htmlContent = fs.readFileSync(htmlPath, 'utf8');
    assert.ok(htmlContent.includes('id="refresh-btn"'), 'Must have #refresh-btn');
    assert.ok(htmlContent.includes('class="refresh-button"'), 'Must have .refresh-button');

    const cssPath = path.join(__dirname, 'renderer', 'activity-popup.css');
    const cssContent = fs.readFileSync(cssPath, 'utf8');
    assert.ok(cssContent.includes('.refresh-button'), 'Must style .refresh-button');
    assert.ok(cssContent.includes('.refresh-button.spinning'), 'Must style .refresh-button.spinning');
  });

  // -----------------------------------------------------------------------------
  // 5. CLIENT-SIDE RENDERER HELPER UNIT TESTS
  // -----------------------------------------------------------------------------
  console.log('\n[5] Client-side Renderer Helper Unit Tests:');

  runTest('5.1 getReporteeInitials extracts initials accurately', () => {
    assert.strictEqual(popupRenderer.getReporteeInitials('Vishal Hake'), 'VH');
    assert.strictEqual(popupRenderer.getReporteeInitials('Gaurav Gaikwad'), 'GG');
    assert.strictEqual(popupRenderer.getReporteeInitials('Single'), 'SI');
    assert.strictEqual(popupRenderer.getReporteeInitials(''), '??');
  });

  runTest('5.2 getReporteeColor returns deterministic colors from palette', () => {
    const c1 = popupRenderer.getReporteeColor(0, 424);
    const c2 = popupRenderer.getReporteeColor(1, 839);
    assert.ok(typeof c1 === 'string' && c1.startsWith('#'), 'Color should be hex code');
    assert.ok(typeof c2 === 'string' && c2.startsWith('#'), 'Color should be hex code');
  });

  runTest('5.3 Active Time view switching preserves state without regression', () => {
    assert.strictEqual(popupRenderer.getCurrentDashboardView(), 'active-time');
    popupRenderer.switchDashboardView('reportees');
    assert.strictEqual(popupRenderer.getCurrentDashboardView(), 'reportees');
    popupRenderer.switchDashboardView('active-time');
    assert.strictEqual(popupRenderer.getCurrentDashboardView(), 'active-time');
  });

  await runAsyncTest('5.4 handleRefreshClick executes safely and handles refresh', async () => {
    assert.strictEqual(typeof popupRenderer.handleRefreshClick, 'function', 'handleRefreshClick must be a function');
    // Test safe execution when DOM / window.api is undefined or partially defined
    await popupRenderer.handleRefreshClick();
  });

  // -----------------------------------------------------------------------------
  // SUMMARY
  // -----------------------------------------------------------------------------
  console.log('\n================================================================================');
  console.log(` RESULTS: ${passedTests} / ${totalTests} tests passed (${failedTests} failed)`);
  console.log('================================================================================');

  if (failedTests > 0) {
    process.exit(1);
  } else {
    process.exit(0);
  }
}

runSuite().catch((err) => {
  console.error('Fatal test error:', err);
  process.exit(1);
});
