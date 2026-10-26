// reporteesService.js
const redmineClient = require('./redmineClient');

// In-memory cache for team history and reportee counts
const teamHistoryCache = new Map();
const CACHE_TTL_MS = 60 * 1000; // 60 seconds TTL

/**
 * Parses date string in DD-MM-YYYY format to a JavaScript Date object (UTC midnight).
 * @param {string} dateStr - e.g. "23-10-2026"
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
 * Formats a DD-MM-YYYY date into readable "DD MMM YYYY", e.g. "23 Oct 2026".
 * @param {string} dateStr
 * @returns {string}
 */
function formatDisplayDate(dateStr) {
  const d = parseDateDDMMYYYY(dateStr);
  if (!d) return dateStr || '—';
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const day = d.getDate();
  const monthName = months[d.getMonth()];
  const year = d.getFullYear();
  return `${day} ${monthName} ${year}`;
}

/**
 * Sanitizes and normalizes raw API response from /today_timesheet/team_history.json.
 * @param {Object} rawData
 * @returns {Object}
 */
function sanitizeTeamHistoryData(rawData) {
  if (!rawData || typeof rawData !== 'object') {
    throw new Error('Invalid API response: payload is not an object');
  }

  const manager = rawData.manager
    ? {
        id: rawData.manager.id || null,
        name: rawData.manager.name || ''
      }
    : null;

  const fromDateStr = rawData.from || '';
  const toDateStr = rawData.to || '';
  const days = parseInt(rawData.days, 10) || 30;

  const rawReportees = Array.isArray(rawData.reportees) ? rawData.reportees : [];
  let calculatedTeamHours = 0;

  const sanitizedReportees = rawReportees.map((r, index) => {
    const user = r.user || {};
    const userId = user.id || r.id || index + 1;
    const userName = user.name || r.name || 'Unknown Employee';
    const userLogin = user.login || r.login || '';

    // Collect daily breakdown & flatten entries
    const rawDaily = Array.isArray(r.daily) ? r.daily : [];
    let totalLoggedHours = 0;
    let activeDaysCount = 0;
    const seenEntryIds = new Set();
    const allEntries = [];

    const sanitizedDaily = rawDaily.map((d) => {
      const date = d.date || '';
      const dayHours = parseFloat(d.total_hours) || 0;
      if (dayHours > 0) activeDaysCount++;

      const rawEntries = Array.isArray(d.entries) ? d.entries : [];
      const sanitizedEntries = [];

      rawEntries.forEach((e) => {
        const entryId = e.id || `${date}_${e.project}_${e.hours}`;
        const entryHours = parseFloat(e.hours) || 0;

        const entryObj = {
          id: entryId,
          user_id: e.user_id || userId,
          project: e.project ? String(e.project).trim() : '—',
          issue_id: e.issue_id || null,
          issue_subject: e.issue_subject ? String(e.issue_subject).trim() : '',
          activity: e.activity ? String(e.activity).trim() : '—',
          hours: entryHours,
          comments: e.comments ? String(e.comments).trim() : '',
          spent_on: e.spent_on || date,
          formatted_date: formatDisplayDate(e.spent_on || date)
        };

        sanitizedEntries.push(entryObj);

        // Deduplicate in allEntries to avoid double counting
        if (!seenEntryIds.has(entryId)) {
          seenEntryIds.add(entryId);
          allEntries.push(entryObj);
        }
      });

      return {
        date,
        formatted_date: formatDisplayDate(date),
        total_hours: dayHours,
        entries: sanitizedEntries
      };
    });

    // Use reported total_hours or sum of day hours
    const reportedTotal = parseFloat(r.total_hours);
    totalLoggedHours = !isNaN(reportedTotal)
      ? reportedTotal
      : sanitizedDaily.reduce((sum, d) => sum + d.total_hours, 0);

    calculatedTeamHours += totalLoggedHours;

    // Sort entries newest first
    allEntries.sort((a, b) => {
      const da = parseDateDDMMYYYY(a.spent_on);
      const db = parseDateDDMMYYYY(b.spent_on);
      if (da && db) return db.getTime() - da.getTime();
      return 0;
    });

    const avgHoursPerDay = activeDaysCount > 0 ? totalLoggedHours / activeDaysCount : 0;

    return {
      id: userId,
      name: userName,
      login: userLogin,
      total_hours: totalLoggedHours,
      active_days: activeDaysCount,
      avg_daily_hours: avgHoursPerDay,
      daily: sanitizedDaily,
      all_entries: allEntries
    };
  });

  const apiReporteesCount = parseInt(rawData.total_reportees, 10);
  const totalReportees = !isNaN(apiReporteesCount) ? apiReporteesCount : sanitizedReportees.length;

  const reportedTeamHours = parseFloat(rawData.team_total_hours);
  const teamTotalHours = !isNaN(reportedTeamHours) ? reportedTeamHours : calculatedTeamHours;

  return {
    manager,
    from: fromDateStr,
    to: toDateStr,
    from_formatted: formatDisplayDate(fromDateStr),
    to_formatted: formatDisplayDate(toDateStr),
    days,
    total_reportees: totalReportees,
    team_total_hours: teamTotalHours,
    reportees: sanitizedReportees
  };
}

/**
 * Fetches team history from Redmine API.
 * @param {string} userId - OS username or numeric user ID
 * @param {Object} options - { days, from, to, forceRefresh }
 * @returns {Promise<Object>}
 */
async function fetchTeamHistory(userId, options = {}) {
  if (!userId) {
    throw new Error('User identifier is required to fetch team history');
  }

  const cacheKey = `${userId}_${options.days || 30}_${options.from || ''}_${options.to || ''}`;
  const now = Date.now();

  if (!options.forceRefresh && teamHistoryCache.has(cacheKey)) {
    const cached = teamHistoryCache.get(cacheKey);
    if (now - cached.timestamp < CACHE_TTL_MS) {
      return cached.data;
    }
  }

  const params = { user_id: userId };
  if (options.days) params.days = options.days;
  if (options.from) params.from = options.from;
  if (options.to) params.to = options.to;

  const response = await redmineClient.get('/today_timesheet/team_history.json', params, {
    timeout: 15000
  });

  const sanitized = sanitizeTeamHistoryData(response);

  teamHistoryCache.set(cacheKey, {
    data: sanitized,
    timestamp: now
  });

  return sanitized;
}

/**
 * Gets reportee count for dynamic header visibility.
 * Returns null if API error or missing, so the UI can safely hide the label.
 * @param {string} userId
 * @returns {Promise<{total_reportees: number|null, has_reportees: boolean}>}
 */
async function getReporteesCount(userId) {
  if (!userId) {
    return { total_reportees: null, has_reportees: false };
  }

  try {
    const data = await fetchTeamHistory(userId);
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
 * Clears the memory cache.
 */
function clearCache() {
  teamHistoryCache.clear();
}

module.exports = {
  fetchTeamHistory,
  getReporteesCount,
  sanitizeTeamHistoryData,
  formatDisplayDate,
  parseDateDDMMYYYY,
  clearCache
};
