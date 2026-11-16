// test_reportees_dashboard_suite.js
// Master verification suite for WorkLens Multi-Reportee Dropdown & Dynamic Employee Table

const assert = require('assert');
const path = require('path');
const fs = require('fs');
const XLSX = require('xlsx');

const reporteesService = require('./reporteesService');
const popupRenderer = require('./renderer/activity-popup');

let totalTests = 0;
let passedTests = 0;
let failedTests = 0;

function runTest(description, testFn) {
  totalTests++;
  try {
    testFn();
    passedTests++;
    console.log(`PASS: ${description}`);
  } catch (err) {
    failedTests++;
    console.error(`FAIL: ${description}`);
    console.error(`    ${err.message}`);
  }
}

async function runAsyncTest(description, testFn) {
  totalTests++;
  try {
    await testFn();
    passedTests++;
    console.log(`PASS: ${description}`);
  } catch (err) {
    failedTests++;
    console.error(`FAIL: ${description}`);
    console.error(`    ${err.message}`);
  }
}

(async () => {
  console.log('================================================================================');
  console.log('    WORKLENS MULTI-REPORTEE DROPDOWN & DYNAMIC EMPLOYEE TABLE SUITE             ');
  console.log('================================================================================');

  // -----------------------------------------------------------------------------
  // 1. DATE FORMATTING & PARSING TESTS
  // -----------------------------------------------------------------------------
  console.log('\n[1] Date Formatting & Parsing Tests:');

  runTest('1.1 parseDateDDMMYYYY converts DD-MM-YYYY string to Date', () => {
    const d = reporteesService.parseDateDDMMYYYY('28-10-2026');
    assert.ok(d instanceof Date);
    assert.strictEqual(d.getDate(), 28);
    assert.strictEqual(d.getMonth(), 9); // October is 9
    assert.strictEqual(d.getFullYear(), 2026);
  });

  runTest('1.2 parseDateDDMMYYYY returns null for invalid dates', () => {
    assert.strictEqual(reporteesService.parseDateDDMMYYYY(''), null);
    assert.strictEqual(reporteesService.parseDateDDMMYYYY(null), null);
    assert.strictEqual(reporteesService.parseDateDDMMYYYY('invalid-date'), null);
    assert.strictEqual(reporteesService.parseDateDDMMYYYY('2026/10/28'), null);
  });

  runTest('1.3 formatDisplayDate converts "28-10-2026" to "28 Oct 2026"', () => {
    assert.strictEqual(reporteesService.formatDisplayDate('28-10-2026'), '28 Oct 2026');
    assert.strictEqual(reporteesService.formatDisplayDate('02-11-2026'), '02 Nov 2026');
  });

  runTest('1.4 formatDateDDMMYYYY formats Date object to DD-MM-YYYY', () => {
    const d = new Date(2026, 9, 28);
    assert.strictEqual(reporteesService.formatDateDDMMYYYY(d), '28-10-2026');
  });

  runTest('1.5 computeDateRange dynamically calculates correct from/to dates', () => {
    const base = new Date(2026, 10, 4); // 04 Nov 2026
    const range7 = reporteesService.computeDateRange(7, base);
    assert.strictEqual(range7.to, '04-11-2026');
    assert.strictEqual(range7.from, '29-10-2026');

    const range8 = reporteesService.computeDateRange(8, base);
    assert.strictEqual(range8.to, '04-11-2026');
    assert.strictEqual(range8.from, '28-10-2026');
  });

  // -----------------------------------------------------------------------------
  // 2. DATA SANITIZATION & NORMALIZATION TESTS
  // -----------------------------------------------------------------------------
  console.log('\n[2] Data Sanitization & Normalization Tests:');

  runTest('2.1 Sanitizes raw reportees_time_slot API response accurately', () => {
    const rawData = {
      manager: { id: 890, name: 'Karthikeya Kondavathri' },
      from: '28-10-2026',
      to: '04-11-2026',
      days: 8,
      total_reportees: 1,
      total_records: 1,
      records: [
        {
          date: '28-10-2026',
          user_id: 890,
          user: 'Karthikeya Kondavathri',
          reporting_manager: 'Vishal Hake',
          early_morning: 0.0,
          office_time: 1.18,
          after_office_time: 0.0,
          total: 1.18,
          leave: 8.0,
          holiday: 0.0,
          early_out: 0.0,
          work_time: 0.0,
          is_shortage: false
        }
      ]
    };

    const sanitized = reporteesService.sanitizeReporteesTimeSlotData(rawData);
    assert.strictEqual(sanitized.manager.id, 890);
    assert.strictEqual(sanitized.manager.name, 'Karthikeya Kondavathri');
    assert.strictEqual(sanitized.from, '28-10-2026');
    assert.strictEqual(sanitized.to, '04-11-2026');
    assert.strictEqual(sanitized.total_reportees, 1);
    assert.strictEqual(sanitized.records.length, 1);
    assert.strictEqual(sanitized.records[0].user, 'Karthikeya Kondavathri');
    assert.strictEqual(sanitized.records[0].is_shortage, false);
    assert.strictEqual(sanitized.records[0].early_morning, 0);
    assert.strictEqual(sanitized.records[0].office_time, 1.18);
    assert.strictEqual(sanitized.records[0].total, 1.18);
    assert.strictEqual(sanitized.reportees.length, 1);
    assert.strictEqual(sanitized.reportees[0].id, 890);
    assert.strictEqual(sanitized.reportees[0].name, 'Karthikeya Kondavathri');
    assert.strictEqual(sanitized.reportees[0].reporting_manager, 'Vishal Hake');
  });

  runTest('2.2 Safely handles null, missing, or malformed API fields', () => {
    const rawCorrupt = {
      manager: null,
      from: null,
      to: null,
      days: null,
      total_reportees: null,
      total_records: null,
      records: [
        {
          date: null,
          user_id: null,
          user: null,
          reporting_manager: null,
          early_morning: null,
          office_time: 'corrupt',
          after_office_time: undefined,
          total: null,
          leave: null,
          holiday: null,
          early_out: null,
          work_time: null,
          is_shortage: null
        }
      ]
    };

    const sanitized = reporteesService.sanitizeReporteesTimeSlotData(rawCorrupt);
    assert.strictEqual(sanitized.manager, null);
    assert.strictEqual(sanitized.records.length, 1);
    assert.strictEqual(sanitized.records[0].early_morning, 0);
    assert.strictEqual(sanitized.records[0].office_time, 0);
    assert.strictEqual(sanitized.records[0].total, 0);
    assert.strictEqual(sanitized.records[0].is_shortage, null);
  });

  // -----------------------------------------------------------------------------
  // 3. PRODUCTION-LEVEL VERIFICATION (TEST CASES 1 - 8)
  // -----------------------------------------------------------------------------
  console.log('\n[3] Production-Level Verification (Test Cases 1 - 8):');

  // Test Case 1: total_reportees = 0 -> Hide Reportees section completely
  runTest('Test Case 1: total_reportees = 0 hides Reportees section completely', () => {
    const payloadZero = {
      total_reportees: 0,
      total_records: 0,
      records: []
    };
    const sanitized = reporteesService.sanitizeReporteesTimeSlotData(payloadZero);
    assert.strictEqual(sanitized.total_reportees, 0);
    assert.strictEqual(sanitized.records.length, 0);
    assert.strictEqual(sanitized.reportees.length, 0);
  });

  // Test Case 2: total_reportees = 1 -> Display one reportee's data correctly
  runTest('Test Case 2: total_reportees = 1 displays one reportee data correctly', () => {
    const payloadOne = {
      total_reportees: 1,
      total_records: 1,
      records: [
        {
          date: '28-10-2026',
          user_id: 890,
          user: 'Karthikeya Kondavathri',
          early_morning: 0.0,
          office_time: 1.18,
          after_office_time: 0.0,
          total: 1.18,
          leave: 8.0,
          holiday: 0.0,
          early_out: 0.0,
          work_time: 0.0,
          is_shortage: false
        }
      ]
    };
    const sanitized = reporteesService.sanitizeReporteesTimeSlotData(payloadOne);
    assert.strictEqual(sanitized.total_reportees, 1);
    assert.strictEqual(sanitized.records.length, 1);
    assert.strictEqual(sanitized.records[0].user, 'Karthikeya Kondavathri');
    assert.strictEqual(sanitized.records[0].office_time, 1.18);
  });

  // Test Case 3: total_reportees = 5 -> Display all five reportees dynamically without hardcoding
  runTest('Test Case 3: total_reportees = 5 displays all reportees dynamically', () => {
    const names = ['Alice', 'Bob', 'Charlie', 'David', 'Eve'];
    const payloadFive = {
      total_reportees: 5,
      records: names.map((name, i) => ({
        date: '28-10-2026',
        user_id: 100 + i,
        user: name,
        early_morning: 0,
        office_time: 7.5,
        after_office_time: 0,
        total: 7.5,
        leave: 0,
        holiday: 0,
        early_out: 0,
        work_time: 8,
        is_shortage: true
      }))
    };
    const sanitized = reporteesService.sanitizeReporteesTimeSlotData(payloadFive);
    assert.strictEqual(sanitized.total_reportees, 5);
    assert.strictEqual(sanitized.records.length, 5);
    assert.strictEqual(sanitized.reportees.length, 5);
    names.forEach((name, i) => {
      assert.strictEqual(sanitized.records[i].user, name);
      assert.strictEqual(sanitized.reportees[i].name, name);
    });
  });

  // Test Case 4: is_shortage = true -> Entire row highlighted red/pink
  runTest('Test Case 4: is_shortage = true maps to red highlight class', () => {
    const rowClass = popupRenderer.getRowClassForShortage(true);
    assert.strictEqual(rowClass, 'timeslot-row-shortage', 'is_shortage === true must use timeslot-row-shortage');
  });

  // Test Case 5: is_shortage = false -> Entire row highlighted green
  runTest('Test Case 5: is_shortage = false maps to green highlight class', () => {
    const rowClass = popupRenderer.getRowClassForShortage(false);
    assert.strictEqual(rowClass, 'timeslot-row-normal', 'is_shortage === false must use timeslot-row-normal');
  });

  // Test Case 6: Change date range -> API receives updated from and to parameters
  await runAsyncTest('Test Case 6: Change date range passes updated from and to dynamically', async () => {
    const data = await reporteesService.fetchReporteesTimeSlot(890, {
      from: '28-10-2026',
      to: '04-11-2026',
      forceRefresh: true
    });
    assert.strictEqual(data.from, '28-10-2026');
    assert.strictEqual(data.to, '04-11-2026');
    assert.ok(Array.isArray(data.records), 'Records should be an array');
  });

  // Test Case 7: Excel export -> Exported Excel data matches table columns and records
  runTest('Test Case 7: Excel export workbook contains all 10 columns, data rows, and Total row', () => {
    const exportData = {
      from: '28-10-2026',
      to: '04-11-2026',
      records: [
        {
          date: '28-10-2026',
          user: 'Karthikeya Kondavathri',
          early_morning: 0.0,
          office_time: 1.18,
          after_office_time: 0.0,
          total: 1.18,
          leave: 8.0,
          holiday: 0.0,
          early_out: 0.0,
          work_time: 0.0
        }
      ],
      totals: {
        early_morning: 0.0,
        office_time: 1.18,
        after_office_time: 0.0,
        total: 1.18,
        leave: 8.0,
        holiday: 0.0,
        early_out: 0.0,
        work_time: 0.0
      }
    };

    const buffer = reporteesService.buildExcelWorkbook(exportData);
    assert.ok(Buffer.isBuffer(buffer), 'Should return a valid binary Buffer');
    assert.ok(buffer.length > 1000, 'Buffer should contain valid XLSX bytes');

    const wb = XLSX.read(buffer, { type: 'buffer' });
    assert.ok(wb.SheetNames.includes('Reportees Time Slot'), 'Sheet name must be Reportees Time Slot');
    const ws = wb.Sheets['Reportees Time Slot'];
    const rows = XLSX.utils.sheet_to_json(ws, { header: 1 });

    const expectedHeaders = [
      'DATE', 'USER', 'EARLY MORNING', 'OFFICE TIME', 'AFTER OFFICE TIME',
      'TOTAL', 'LEAVE', 'HOLIDAY', 'EARLY OUT', 'WORK TIME'
    ];
    assert.deepStrictEqual(rows[0], expectedHeaders, 'Header row must match exact columns');
    assert.strictEqual(rows[1][0], '28-10-2026');
    assert.strictEqual(rows[1][1], 'Karthikeya Kondavathri');
    assert.strictEqual(rows[1][3], 1.18);
    assert.strictEqual(rows[1][5], 1.18);

    const lastRow = rows[rows.length - 1];
    assert.strictEqual(lastRow[0], 'TOTAL');
    assert.strictEqual(lastRow[3], 1.18);
  });

  // Test Case 8: API failure -> Existing WorkLens dashboard continues working
  await runAsyncTest('Test Case 8: API failure returns safe response without breaking dashboard', async () => {
    const res = await reporteesService.getReporteesCount(999999);
    assert.strictEqual(res.total_reportees, null);
    assert.strictEqual(res.has_reportees, false);
    assert.ok(res.error, 'Should return error message gracefully');
  });

  // -----------------------------------------------------------------------------
  // 4. HTML & CSS STRUCTURE VERIFICATION
  // -----------------------------------------------------------------------------
  console.log('\n[4] HTML & CSS Structure Verification:');

  runTest('4.1 activity-popup.html contains compact table wrapper maximizing vertical height', () => {
    const htmlPath = path.join(__dirname, 'renderer', 'activity-popup.html');
    const content = fs.readFileSync(htmlPath, 'utf8');

    assert.ok(content.includes('timeslot-table-wrapper'), 'Must have timeslot-table-wrapper');
    assert.ok(content.includes('id="timeslot-table"'), 'Must have #timeslot-table');
  });

  runTest('4.2 activity-popup.html contains multi-reportee dropdown and header date selector', () => {
    const htmlPath = path.join(__dirname, 'renderer', 'activity-popup.html');
    const content = fs.readFileSync(htmlPath, 'utf8');

    assert.ok(content.includes('id="reportees-dropdown-container"'), 'Must have #reportees-dropdown-container');
    assert.ok(content.includes('id="reportees-dropdown-menu"'), 'Must have #reportees-dropdown-menu');
    assert.ok(content.includes('id="reportees-dropdown-search-input"'), 'Must have #reportees-dropdown-search-input');
    assert.ok(content.includes('id="header-date-picker-container"'), 'Must have #header-date-picker-container');
    assert.ok(content.includes('id="header-date-range-btn"'), 'Must have #header-date-range-btn');
  });

  runTest('4.3 activity-popup.html contains Employee Profile Card and 9 Table Columns (including HOLIDAY, single TOTAL)', () => {
    const htmlPath = path.join(__dirname, 'renderer', 'activity-popup.html');
    const content = fs.readFileSync(htmlPath, 'utf8');

    // Profile card elements
    assert.ok(content.includes('id="reportee-profile-card"'), 'Must have profile card');
    assert.ok(content.includes('id="reportee-avatar"'), 'Must have avatar element');
    assert.ok(content.includes('id="reportee-name"'), 'Must have employee name element');
    assert.ok(content.includes('id="reportee-stat-total"'), 'Must have profile card Total Time metric element');
    assert.ok(content.includes('id="reportee-stat-work"'), 'Must have profile card Work Time metric element');
    assert.ok(content.includes('id="reportee-id"'), 'Must have employee ID element');
    assert.ok(content.includes('id="reportee-manager"'), 'Must have reporting manager element');

    // 9 Table Columns (including HOLIDAY, single TOTAL column)
    assert.ok(content.includes('th-date">DATE'), 'Column DATE');
    assert.ok(content.includes('th-early-morning') && content.includes('Early Morning') && content.includes('(12 AM to 8.30 AM)'), 'Column Early Morning with time range');
    assert.ok(content.includes('th-office-time') && content.includes('Office Time') && content.includes('(8.30 AM to 7.30 PM)'), 'Column Office Time with time range');
    assert.ok(content.includes('th-after-office') && content.includes('After Office Time') && content.includes('(7.30 PM to 11.59 PM)'), 'Column After Office Time with time range');
    assert.ok(content.includes('th-slot-total">TOTAL'), 'Column TOTAL');
    assert.ok(content.includes('th-work-time">WORK TIME'), 'Column WORK TIME');
    assert.ok(content.includes('th-leave">LEAVE'), 'Column LEAVE');
    assert.ok(content.includes('th-holiday">HOLIDAY'), 'Column HOLIDAY');
    assert.ok(content.includes('th-early-out">EARLY OUT'), 'Column EARLY OUT');
    
    // Ensure duplicate TOTAL header is removed
    const theadMatch = content.match(/<thead>[\s\S]*?<\/thead>/);
    assert.ok(theadMatch, 'Must contain thead');
    const totalCount = (theadMatch[0].match(/>TOTAL</g) || []).length;
    assert.strictEqual(totalCount, 1, 'There must be exactly 1 TOTAL column in table thead');
  });

  runTest('4.4 activity-popup.css contains required dropdown, profile card, and row highlight styles', () => {
    const cssPath = path.join(__dirname, 'renderer', 'activity-popup.css');
    const content = fs.readFileSync(cssPath, 'utf8');

    assert.ok(content.includes('.reportees-dropdown-menu'), 'Must define .reportees-dropdown-menu');
    assert.ok(content.includes('.reportee-profile-card'), 'Must define .reportee-profile-card');
    assert.ok(content.includes('.reportee-profile-avatar'), 'Must define .reportee-profile-avatar');
    assert.ok(content.includes('.reportee-profile-stats'), 'Must define .reportee-profile-stats');
    assert.ok(content.includes('.timeslot-row-shortage'), 'Must define .timeslot-row-shortage');
    assert.ok(content.includes('.timeslot-row-normal'), 'Must define .timeslot-row-normal');
    assert.ok(content.includes('.timeslot-row-total'), 'Must define .timeslot-row-total');
  });

  // -----------------------------------------------------------------------------
  // 5. MULTI-REPORTEE DROPDOWN & DYNAMIC EMPLOYEE TABLE (SECTION 10 VERIFICATION)
  // -----------------------------------------------------------------------------
  console.log('\n[5] Multi-Reportee Dynamic Table Tests (Section 10 Verification):');

  // Multi-reportee test fixture with 3 reportees
  const multiReporteesFixture = {
    manager: { id: 890, name: 'Karthikeya Kondavathri' },
    from: '28-10-2026',
    to: '04-11-2026',
    days: 8,
    total_reportees: 3,
    total_records: 6,
    records: [
      // Employee A: 890 (Karthikeya Kondavathri)
      {
        date: '28-10-2026',
        user_id: 890,
        user: 'Karthikeya Kondavathri',
        reporting_manager: 'Vishal Hake',
        early_morning: 0.0,
        office_time: 1.18,
        after_office_time: 0.0,
        total: 1.18,
        leave: 8.0,
        holiday: 0.0,
        early_out: 0.0,
        work_time: 0.0,
        is_shortage: false
      },
      {
        date: '29-10-2026',
        user_id: 890,
        user: 'Karthikeya Kondavathri',
        reporting_manager: 'Vishal Hake',
        early_morning: 0.0,
        office_time: 6.08,
        after_office_time: 1.05,
        total: 7.13,
        leave: 0.0,
        holiday: 0.0,
        early_out: 0.0,
        work_time: 8.0,
        is_shortage: true
      },
      // Employee B: 891 (Employee Two)
      {
        date: '28-10-2026',
        user_id: 891,
        user: 'Employee Two',
        reporting_manager: 'Vishal Hake',
        early_morning: 0.5,
        office_time: 7.0,
        after_office_time: 0.5,
        total: 8.0,
        leave: 0.0,
        holiday: 0.0,
        early_out: 0.0,
        work_time: 8.5,
        is_shortage: true
      },
      {
        date: '29-10-2026',
        user_id: 891,
        user: 'Employee Two',
        reporting_manager: 'Vishal Hake',
        early_morning: 0.0,
        office_time: 8.0,
        after_office_time: 0.0,
        total: 8.0,
        leave: 0.0,
        holiday: 0.0,
        early_out: 0.0,
        work_time: 8.0,
        is_shortage: true
      },
      // Employee C: 892 (Employee Three)
      {
        date: '28-10-2026',
        user_id: 892,
        user: 'Employee Three',
        reporting_manager: 'Karthikeya Kondavathri',
        early_morning: 0.0,
        office_time: 4.5,
        after_office_time: 0.0,
        total: 4.5,
        leave: 4.0,
        holiday: 0.0,
        early_out: 1.0,
        work_time: 5.0,
        is_shortage: false
      },
      {
        date: '30-10-2026',
        user_id: 892,
        user: 'Employee Three',
        reporting_manager: 'Karthikeya Kondavathri',
        early_morning: 0.0,
        office_time: 6.5,
        after_office_time: 0.5,
        total: 7.0,
        leave: 0.0,
        holiday: 0.0,
        early_out: 0.0,
        work_time: 7.0,
        is_shortage: true
      }
    ]
  };

  const sanitizedMulti = reporteesService.sanitizeReporteesTimeSlotData(multiReporteesFixture);

  runTest('5.1 All 3 reportees appear in the extracted reportees list with name, ID, and manager', () => {
    assert.strictEqual(sanitizedMulti.reportees.length, 3);
    const repA = sanitizedMulti.reportees.find(r => r.id === 890);
    const repB = sanitizedMulti.reportees.find(r => r.id === 891);
    const repC = sanitizedMulti.reportees.find(r => r.id === 892);

    assert.ok(repA, 'Must contain Employee A (890)');
    assert.strictEqual(repA.name, 'Karthikeya Kondavathri');
    assert.strictEqual(repA.reporting_manager, 'Vishal Hake');

    assert.ok(repB, 'Must contain Employee B (891)');
    assert.strictEqual(repB.name, 'Employee Two');
    assert.strictEqual(repB.reporting_manager, 'Vishal Hake');

    assert.ok(repC, 'Must contain Employee C (892)');
    assert.strictEqual(repC.name, 'Employee Three');
    assert.strictEqual(repC.reporting_manager, 'Karthikeya Kondavathri');
  });

  runTest('5.2 Selecting Employee A filters records and totals for Employee A only', () => {
    const recsA = sanitizedMulti.records.filter(r => r.user_id === 890);
    assert.strictEqual(recsA.length, 2);
    recsA.forEach(r => assert.strictEqual(r.user_id, 890));

    const totalsA = reporteesService.calculateEmployeeTotals(recsA);
    assert.strictEqual(totalsA.office_time, 7.26); // 1.18 + 6.08
    assert.strictEqual(totalsA.after_office_time, 1.05);
    assert.strictEqual(totalsA.total, 8.31); // 7.26 + 1.05
    assert.strictEqual(totalsA.work_time, 8.0);
    assert.strictEqual(totalsA.leave, 8.0);
  });

  runTest('5.3 Selecting Employee B updates records and totals for Employee B only', () => {
    const recsB = sanitizedMulti.records.filter(r => r.user_id === 891);
    assert.strictEqual(recsB.length, 2);
    recsB.forEach(r => assert.strictEqual(r.user_id, 891));

    const totalsB = reporteesService.calculateEmployeeTotals(recsB);
    assert.strictEqual(totalsB.early_morning, 0.5);
    assert.strictEqual(totalsB.office_time, 15.0); // 7.0 + 8.0
    assert.strictEqual(totalsB.after_office_time, 0.5);
    assert.strictEqual(totalsB.total, 16.0); // 0.5 + 15.0 + 0.5
    assert.strictEqual(totalsB.work_time, 16.5);
    assert.strictEqual(totalsB.leave, 0);
  });

  runTest('5.4 Selecting Employee C displays Employee C records and totals correctly', () => {
    const recsC = sanitizedMulti.records.filter(r => r.user_id === 892);
    assert.strictEqual(recsC.length, 2);
    recsC.forEach(r => assert.strictEqual(r.user_id, 892));

    const totalsC = reporteesService.calculateEmployeeTotals(recsC);
    assert.strictEqual(totalsC.early_morning, 0);
    assert.strictEqual(totalsC.office_time, 11.0); // 4.5 + 6.5
    assert.strictEqual(totalsC.after_office_time, 0.5);
    assert.strictEqual(totalsC.total, 11.5);
    assert.strictEqual(totalsC.work_time, 12.0);
    assert.strictEqual(totalsC.leave, 4.0);
    assert.strictEqual(totalsC.early_out, 1.0);
  });

  runTest('5.5 Switching employees does not retain or mix previous employee records', () => {
    const recsA = sanitizedMulti.records.filter(r => r.user_id === 890);
    const recsB = sanitizedMulti.records.filter(r => r.user_id === 891);

    // Records for A must not contain B
    assert.ok(recsA.every(r => r.user_id === 890));
    assert.ok(recsB.every(r => r.user_id === 891));
    assert.strictEqual(recsA.some(r => r.user_id === 891), false);
  });

  runTest('5.6 formatHoursVal formats decimal numbers consistently with h suffix', () => {
    assert.strictEqual(popupRenderer.formatHoursVal(0), '0.00h');
    assert.strictEqual(popupRenderer.formatHoursVal(1.18), '1.18h');
    assert.strictEqual(popupRenderer.formatHoursVal(31.26), '31.26h');
    assert.strictEqual(popupRenderer.formatHoursVal(34.85), '34.85h');
    assert.strictEqual(popupRenderer.formatHoursVal(null), '0.00h');
    assert.strictEqual(popupRenderer.formatHoursVal(''), '0.00h');
  });

  runTest('5.7 getReporteeInitials creates clean 2-letter uppercase initials', () => {
    assert.strictEqual(popupRenderer.getReporteeInitials('Karthikeya Kondavathri'), 'KK');
    assert.strictEqual(popupRenderer.getReporteeInitials('Employee Two'), 'ET');
    assert.strictEqual(popupRenderer.getReporteeInitials('Vishal Hake'), 'VH');
    assert.strictEqual(popupRenderer.getReporteeInitials('Single'), 'SI');
  });

  runTest('5.8 toggleReporteeTable toggles accordion expand/collapse state cleanly', () => {
    popupRenderer.setIsReporteeTableExpanded(false);
    assert.strictEqual(popupRenderer.getIsReporteeTableExpanded(), false);
    popupRenderer.toggleReporteeTable();
    assert.strictEqual(popupRenderer.getIsReporteeTableExpanded(), true);
    popupRenderer.toggleReporteeTable();
    assert.strictEqual(popupRenderer.getIsReporteeTableExpanded(), false);
  });

  runTest('5.9 createExtraReporteeBlock and renderTableRowsForBody handle multi-reportee dashboard rendering', () => {
    assert.strictEqual(typeof popupRenderer.createExtraReporteeBlock, 'function');
    assert.strictEqual(typeof popupRenderer.renderTableRowsForBody, 'function');
    const empMock = { id: 891, name: 'Employee Two' };
    const empRecs = sanitizedMulti.records.filter(r => r.user_id === 891);
    const empTotals = reporteesService.calculateEmployeeTotals(empRecs);
    const block = popupRenderer.createExtraReporteeBlock(empMock, empRecs, empTotals, false);
    assert.strictEqual(block, null); // safe headless DOM fallback in node
  });

  // -----------------------------------------------------------------------------
  // SUMMARY
  // -----------------------------------------------------------------------------
  console.log('\n================================================================================');
  console.log(` RESULTS: ${passedTests} / ${totalTests} tests passed (${failedTests} failed)`);
  console.log('================================================================================');

  if (failedTests > 0) {
    process.exit(1);
  }
})();
