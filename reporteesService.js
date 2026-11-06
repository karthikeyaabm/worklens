// reporteesService.js
const redmineClient = require('./redmineClient');
const XLSX = require('xlsx');

// In-memory cache for reportees time slot data and reportee counts
const reporteesTimeSlotCache = new Map();
const CACHE_TTL_MS = 60 * 1000; // 60 seconds TTL

/**
 * Formats a JavaScript Date object into "DD-MM-YYYY" string.
 * @param {Date} dateObj
 * @returns {string}
 */
function formatDateDDMMYYYY(dateObj) {
  if (!(dateObj instanceof Date) || isNaN(dateObj.getTime())) return '';
  const day = String(dateObj.getDate()).padStart(2, '0');
  const month = String(dateObj.getMonth() + 1).padStart(2, '0');
  const year = dateObj.getFullYear();
  return `${day}-${month}-${year}`;
}

/**
 * Parses date string in DD-MM-YYYY format to a JavaScript Date object (UTC midnight).
 * @param {string} dateStr - e.g. "28-10-2026"
 * @returns {Date|null}
 */
function parseDateDDMMYYYY(dateStr) {
  if (!dateStr || typeof dateStr !== 'string') return null;
  const parts = dateStr.trim().split('-');
  if (parts.length !== 3) return null;
  const day = parseInt(parts[0], 10);
  const month = parseInt(parts[1], 10) - 1;
  const year = parseInt(parts[2], 10);
  if (isNaN(day) || isNaN(month) || isNaN(year)) return null;
  return new Date(year, month, day);
}

/**
 * Formats a DD-MM-YYYY date into readable "DD MMM YYYY", e.g. "28 Oct 2026".
 * @param {string} dateStr
 * @returns {string}
 */
function formatDisplayDate(dateStr) {
  const d = parseDateDDMMYYYY(dateStr);
  if (!d) return dateStr || '—';
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const day = String(d.getDate()).padStart(2, '0');
  const monthName = months[d.getMonth()];
  const year = d.getFullYear();
  return `${day} ${monthName} ${year}`;
}

/**
 * Computes default start date string DD-MM-YYYY from days back.
 * @param {number} days
 * @param {Date} [baseDate]
 * @returns {{ from: string, to: string }}
 */
function computeDateRange(days = 7, baseDate = new Date()) {
  const toDate = new Date(baseDate);
  const fromDate = new Date(baseDate);
  fromDate.setDate(toDate.getDate() - (Math.max(1, days) - 1));
  return {
    from: formatDateDDMMYYYY(fromDate),
    to: formatDateDDMMYYYY(toDate)
  };
}

/**
 * Formats decimal hours preserving API numbers and decimal precision.
 * @param {*} val
 * @returns {string}
 */
function formatDecimalHours(val) {
  if (val === null || val === undefined || val === '') return '';
  const num = typeof val === 'number' ? val : parseFloat(val);
  if (isNaN(num)) return String(val);
  return num.toString();
}

/**
 * Sanitizes and normalizes raw API response from /user_system_activity_logs/reportees_time_slot.json.
 * @param {Object} rawData
 * @returns {Object}
 */
function sanitizeReporteesTimeSlotData(rawData) {
  if (!rawData || typeof rawData !== 'object') {
    throw new Error('Invalid API response: payload is not an object');
  }

  const manager = rawData.manager && typeof rawData.manager === 'object'
    ? {
        id: rawData.manager.id || null,
        name: rawData.manager.name ? String(rawData.manager.name).trim() : ''
      }
    : null;

  const fromDateStr = rawData.from ? String(rawData.from).trim() : '';
  const toDateStr = rawData.to ? String(rawData.to).trim() : '';
  const days = parseInt(rawData.days, 10) || 7;

  const rawReporteesCount = parseInt(rawData.total_reportees, 10);
  const rawRecords = Array.isArray(rawData.records) ? rawData.records : [];

  // Track distinct reportees from records
  const distinctReportees = new Set();

  const sanitizedRecords = rawRecords.map((r, idx) => {
    if (!r || typeof r !== 'object') return null;

    const user = r.user ? String(r.user).trim() : 'Unknown';
    if (user) distinctReportees.add(user);

    const parseNum = (v) => {
      if (v === null || v === undefined || v === '') return 0;
      const parsed = parseFloat(v);
      return isNaN(parsed) ? 0 : parsed;
    };

    // Strict boolean checking for is_shortage
    let isShortage = null;
    if (typeof r.is_shortage === 'boolean') {
      isShortage = r.is_shortage;
    } else if (r.is_shortage === 'true') {
      isShortage = true;
    } else if (r.is_shortage === 'false') {
      isShortage = false;
    }

    return {
      id: r.id || `${r.date || ''}_${r.user_id || idx}`,
      date: r.date ? String(r.date).trim() : '',
      date_formatted: formatDisplayDate(r.date),
      user_id: r.user_id || null,
      user: user,
      reporting_manager: r.reporting_manager ? String(r.reporting_manager).trim() : '',
      early_morning: parseNum(r.early_morning),
      office_time: parseNum(r.office_time),
      after_office_time: parseNum(r.after_office_time),
      total: (() => {
        const em = parseNum(r.early_morning);
        const ot = parseNum(r.office_time);
        const aot = parseNum(r.after_office_time);
        const slotSum = Math.round((em + ot + aot) * 100) / 100;
        const rawT = parseNum(r.total);
        return (slotSum > 0 || rawT === 0) ? slotSum : rawT;
      })(),
      leave: parseNum(r.leave),
      holiday: r.holiday !== null && r.holiday !== undefined ? r.holiday : '',
      early_out: parseNum(r.early_out),
      work_time: parseNum(r.work_time),
      is_shortage: isShortage
    };
  }).filter(Boolean);

  // Calculate totals from sanitized records
  const calculatedTotals = {
    early_morning: 0,
    office_time: 0,
    after_office_time: 0,
    total: 0,
    leave: 0,
    holiday: 0,
    early_out: 0,
    work_time: 0
  };

  sanitizedRecords.forEach(rec => {
    calculatedTotals.early_morning += rec.early_morning;
    calculatedTotals.office_time += rec.office_time;
    calculatedTotals.after_office_time += rec.after_office_time;
    calculatedTotals.total += rec.total;
    calculatedTotals.leave += rec.leave;
    const holidayNum = parseFloat(rec.holiday);
    if (!isNaN(holidayNum)) calculatedTotals.holiday += holidayNum;
    calculatedTotals.early_out += rec.early_out;
    calculatedTotals.work_time += rec.work_time;
  });

  // Round individual time slot column totals to 2 decimal places
  calculatedTotals.early_morning = Math.round(calculatedTotals.early_morning * 100) / 100;
  calculatedTotals.office_time = Math.round(calculatedTotals.office_time * 100) / 100;
  calculatedTotals.after_office_time = Math.round(calculatedTotals.after_office_time * 100) / 100;
  
  // Consistent methodology: total is strictly verified against the three time-slot totals (EM + OT + AOT)
  calculatedTotals.total = Math.round((calculatedTotals.early_morning + calculatedTotals.office_time + calculatedTotals.after_office_time) * 100) / 100;

  calculatedTotals.leave = Math.round(calculatedTotals.leave * 100) / 100;
  calculatedTotals.holiday = Math.round(calculatedTotals.holiday * 100) / 100;
  calculatedTotals.early_out = Math.round(calculatedTotals.early_out * 100) / 100;
  calculatedTotals.work_time = Math.round(calculatedTotals.work_time * 100) / 100;

  // Use calculatedTotals to ensure complete mathematical consistency across rows, columns, and footer
  const finalTotals = { ...calculatedTotals };

  // Determine total reportees: use API value if specified, else count distinct reportees found
  const totalReportees = !isNaN(rawReporteesCount)
    ? rawReporteesCount
    : distinctReportees.size;

  const totalRecords = !isNaN(parseInt(rawData.total_records, 10))
    ? parseInt(rawData.total_records, 10)
    : sanitizedRecords.length;

  // Extract distinct reportees array with details (name, id, reporting_manager)
  const reporteesMap = new Map();
  if (Array.isArray(rawData.reportees)) {
    rawData.reportees.forEach(r => {
      if (r && (r.id || r.user_id)) {
        const uid = Number(r.id || r.user_id);
        reporteesMap.set(uid, {
          id: uid,
          user_id: uid,
          name: r.name ? String(r.name).trim() : (r.user ? String(r.user).trim() : `Employee ${uid}`),
          reporting_manager: r.reporting_manager ? String(r.reporting_manager).trim() : (manager ? manager.name : '')
        });
      }
    });
  }

  sanitizedRecords.forEach(rec => {
    if (rec.user_id) {
      const uid = Number(rec.user_id);
      if (!reporteesMap.has(uid)) {
        reporteesMap.set(uid, {
          id: uid,
          user_id: uid,
          name: rec.user || `Employee ${uid}`,
          reporting_manager: rec.reporting_manager || (manager ? manager.name : '')
        });
      }
    }
  });

  const reporteesList = Array.from(reporteesMap.values());
  const finalTotalReportees = !isNaN(rawReporteesCount)
    ? rawReporteesCount
    : (reporteesList.length || distinctReportees.size);

  return {
    manager,
    from: fromDateStr,
    to: toDateStr,
    from_formatted: formatDisplayDate(fromDateStr),
    to_formatted: formatDisplayDate(toDateStr),
    days,
    total_reportees: finalTotalReportees,
    total_records: totalRecords,
    reportees: reporteesList,
    records: sanitizedRecords,
    totals: finalTotals
  };
}

/**
 * Fetches reportees time slot data from Redmine/WorkLens API.
 * GET /user_system_activity_logs/reportees_time_slot.json
 * @param {string|number} userId - Manager's User ID or username
 * @param {Object} options - { from, to, days, forceRefresh }
 * @returns {Promise<Object>}
 */
async function fetchReporteesTimeSlot(userId, options = {}) {
  if (!userId) {
    throw new Error('User identifier is required to fetch reportees time slot data');
  }

  // Determine date range: use explicit from/to or compute from days (default 7 days)
  let fromDate = options.from;
  let toDate = options.to;

  if (!fromDate || !toDate) {
    const range = computeDateRange(options.days || 7);
    fromDate = fromDate || range.from;
    toDate = toDate || range.to;
  }

  const cacheKey = `${userId}_${fromDate}_${toDate}`;
  const now = Date.now();

  if (!options.forceRefresh && reporteesTimeSlotCache.has(cacheKey)) {
    const cached = reporteesTimeSlotCache.get(cacheKey);
    if (now - cached.timestamp < CACHE_TTL_MS) {
      return cached.data;
    }
  }

  const params = {
    user_id: userId,
    from: fromDate,
    to: toDate
  };

  const response = await redmineClient.get('/user_system_activity_logs/reportees_time_slot.json', params, {
    timeout: 90000
  });

  const sanitized = sanitizeReporteesTimeSlotData(response);

  reporteesTimeSlotCache.set(cacheKey, {
    data: sanitized,
    timestamp: now
  });

  return sanitized;
}

/**
 * Gets reportee count for dynamic header visibility.
 * Returns null if API error or missing, so UI can safely hide the label.
 * @param {string|number} userId
 * @returns {Promise<{total_reportees: number|null, has_reportees: boolean, error?: string}>}
 */
async function getReporteesCount(userId) {
  if (!userId) {
    return { total_reportees: null, has_reportees: false };
  }

  try {
    const data = await fetchReporteesTimeSlot(userId);
    const count = typeof data.total_reportees === 'number' ? data.total_reportees : null;
    return {
      total_reportees: count,
      has_reportees: typeof count === 'number' && count > 0
    };
  } catch (err) {
    console.error('[ReporteesService] Failed to get reportees count:', err.message);
    return {
      total_reportees: null,
      has_reportees: false,
      error: err.message
    };
  }
}

/**
 * Builds an Excel Workbook buffer from reportee time slot records and totals.
 * Columns: DATE, USER, EARLY MORNING, OFFICE TIME, AFTER OFFICE TIME, TOTAL, LEAVE, HOLIDAY, EARLY OUT, WORK TIME.
 * @param {Object} data - { records: Array, totals: Object, from: string, to: string }
 * @returns {Buffer}
 */
function buildExcelWorkbook(data = {}) {
  const records = Array.isArray(data.records) ? data.records : [];
  const totals = data.totals || {};

  const headers = [
    'DATE',
    'USER',
    'EARLY MORNING',
    'OFFICE TIME',
    'AFTER OFFICE TIME',
    'TOTAL',
    'LEAVE',
    'HOLIDAY',
    'EARLY OUT',
    'WORK TIME'
  ];

  const rows = [headers];

  records.forEach(r => {
    rows.push([
      r.date || '',
      r.user || '',
      typeof r.early_morning === 'number' ? r.early_morning : (r.early_morning || ''),
      typeof r.office_time === 'number' ? r.office_time : (r.office_time || ''),
      typeof r.after_office_time === 'number' ? r.after_office_time : (r.after_office_time || ''),
      typeof r.total === 'number' ? r.total : (r.total || ''),
      typeof r.leave === 'number' ? r.leave : (r.leave || ''),
      r.holiday !== null && r.holiday !== undefined ? r.holiday : '',
      typeof r.early_out === 'number' ? r.early_out : (r.early_out || ''),
      typeof r.work_time === 'number' ? r.work_time : (r.work_time || '')
    ]);
  });

  // Append Total row
  rows.push([
    'TOTAL',
    '',
    typeof totals.early_morning === 'number' ? totals.early_morning : '',
    typeof totals.office_time === 'number' ? totals.office_time : '',
    typeof totals.after_office_time === 'number' ? totals.after_office_time : '',
    typeof totals.total === 'number' ? totals.total : '',
    typeof totals.leave === 'number' ? totals.leave : '',
    typeof totals.holiday === 'number' ? totals.holiday : '',
    typeof totals.early_out === 'number' ? totals.early_out : '',
    typeof totals.work_time === 'number' ? totals.work_time : ''
  ]);

  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet(rows);

  // Set column widths for readability
  ws['!cols'] = [
    { wch: 14 }, // DATE
    { wch: 28 }, // USER
    { wch: 16 }, // EARLY MORNING
    { wch: 16 }, // OFFICE TIME
    { wch: 20 }, // AFTER OFFICE TIME
    { wch: 12 }, // TOTAL
    { wch: 10 }, // LEAVE
    { wch: 12 }, // HOLIDAY
    { wch: 12 }, // EARLY OUT
    { wch: 14 }  // WORK TIME
  ];

  XLSX.utils.book_append_sheet(wb, ws, 'Reportees Time Slot');
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
}

/**
 * Backward compatibility alias for fetchTeamHistory.
 * Maps to fetchReporteesTimeSlot.
 */
async function fetchTeamHistory(userId, options = {}) {
  return await fetchReporteesTimeSlot(userId, options);
}

/**
 * Backward compatibility alias for sanitizeTeamHistoryData.
 */
function sanitizeTeamHistoryData(rawData) {
  if (rawData && Array.isArray(rawData.records)) {
    return sanitizeReporteesTimeSlotData(rawData);
  }
  // If legacy structure with .reportees
  return sanitizeReporteesTimeSlotData({
    manager: rawData ? rawData.manager : null,
    from: rawData ? rawData.from : '',
    to: rawData ? rawData.to : '',
    days: rawData ? rawData.days : 7,
    total_reportees: rawData ? rawData.total_reportees : 0,
    records: []
  });
}

/**
 * Clears the memory cache.
 */
function clearCache() {
  reporteesTimeSlotCache.clear();
}


/**
 * Calculates column totals for a filtered set of employee records.
 * @param {Array<Object>} records
 * @returns {Object}
 */
function calculateEmployeeTotals(records) {
  const totals = {
    early_morning: 0,
    office_time: 0,
    after_office_time: 0,
    total: 0,
    work_time: 0,
    leave: 0,
    holiday: 0,
    early_out: 0
  };

  if (!Array.isArray(records)) return totals;

  records.forEach(rec => {
    totals.early_morning += (parseFloat(rec.early_morning) || 0);
    totals.office_time += (parseFloat(rec.office_time) || 0);
    totals.after_office_time += (parseFloat(rec.after_office_time) || 0);
    totals.work_time += (parseFloat(rec.work_time) || 0);
    totals.leave += (parseFloat(rec.leave) || 0);
    const h = parseFloat(rec.holiday);
    if (!isNaN(h)) totals.holiday += h;
    totals.early_out += (parseFloat(rec.early_out) || 0);
  });

  totals.early_morning = Math.round(totals.early_morning * 100) / 100;
  totals.office_time = Math.round(totals.office_time * 100) / 100;
  totals.after_office_time = Math.round(totals.after_office_time * 100) / 100;
  totals.total = Math.round((totals.early_morning + totals.office_time + totals.after_office_time) * 100) / 100;
  totals.work_time = Math.round(totals.work_time * 100) / 100;
  totals.leave = Math.round(totals.leave * 100) / 100;
  totals.holiday = Math.round(totals.holiday * 100) / 100;
  totals.early_out = Math.round(totals.early_out * 100) / 100;

  return totals;
}

module.exports = {
  calculateEmployeeTotals,
  fetchReporteesTimeSlot,
  getReporteesCount,
  sanitizeReporteesTimeSlotData,
  buildExcelWorkbook,
  formatDisplayDate,
  formatDateDDMMYYYY,
  parseDateDDMMYYYY,
  computeDateRange,
  formatDecimalHours,
  clearCache,
  // Backward compatibility
  fetchTeamHistory,
  sanitizeTeamHistoryData
};
