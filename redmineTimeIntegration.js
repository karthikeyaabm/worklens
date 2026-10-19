// redmineTimeIntegration.js
// Modular service for Redmine time-entry API integration and yellow category classification

const YELLOW_CATEGORIES = new Set([
  'Big Late',
  'Early Out',
  'Leave',
  'Holiday',
  'Non Productive - ABM Function, Activity'
]);

/**
 * Standard project 90 (ABM Org Team) issue IDs for yellow categories.
 * In Redmine's /time_entries.json, issue.subject is omitted and entries only have issue.id.
 * For categories like "Non Productive - ABM Function, Activity" which are tracked as issues
 * rather than activity dropdown items (e.g., activity is "Do"), mapping the issue ID ensures
 * correct classification without requiring extra slow network queries.
 */
const KNOWN_YELLOW_ISSUE_IDS = {
  236611: 'Non Productive - ABM Function, Activity',
  226878: 'Big Late',
  226879: 'Early Out',
  226884: 'Leave',
  277728: 'Holiday'
};

/**
 * Normalizes and parses spent_on date strings into YYYY-MM-DD.
 * Strictly avoids new Date() timezone / DST offset shifts.
 * Supports:
 * - YYYY-MM-DD (e.g., "2026-10-18")
 * - DD-MM-YYYY (e.g., "18-10-2026")
 */
function parseSpentOnDateStr(spentOn) {
  if (!spentOn || typeof spentOn !== 'string') return null;
  const trimmed = spentOn.trim();

  // Match YYYY-MM-DD
  const ymdMatch = trimmed.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (ymdMatch) {
    const y = ymdMatch[1];
    const m = ymdMatch[2].padStart(2, '0');
    const d = ymdMatch[3].padStart(2, '0');
    return `${y}-${m}-${d}`;
  }

  // Match DD-MM-YYYY
  const dmyMatch = trimmed.match(/^(\d{1,2})-(\d{1,2})-(\d{4})/);
  if (dmyMatch) {
    const d = dmyMatch[1].padStart(2, '0');
    const m = dmyMatch[2].padStart(2, '0');
    const y = dmyMatch[3];
    return `${y}-${m}-${d}`;
  }

  return null;
}

/**
 * Classifies a Redmine time entry.
 * Checks issue_subject, issue.subject, known issue IDs, and activity (string or object with name).
 * Uses exact matching after trimming whitespace.
 * Returns the matched yellow category name if matched, or null if regular time.
 */
function getEntryYellowCategory(entry) {
  if (!entry) return null;

  // 1. Check issue_subject field / issue.subject object / entry.subject
  const rawSubject = typeof entry.issue_subject === 'string'
    ? entry.issue_subject
    : (entry.issue && typeof entry.issue.subject === 'string' ? entry.issue.subject : (typeof entry.subject === 'string' ? entry.subject : ''));
  const issueSubject = rawSubject.trim();

  if (YELLOW_CATEGORIES.has(issueSubject)) {
    return issueSubject;
  }
  // Check if issueSubject without trailing punctuation (e.g. "Leave.") matches
  const cleanSubject = issueSubject.replace(/[\.\s]+$/, '').trim();
  if (cleanSubject && YELLOW_CATEGORIES.has(cleanSubject)) {
    return cleanSubject;
  }

  // 2. Check known issue ID (e.g. Issue 236611 = Non Productive - ABM Function, Activity)
  const issueId = entry.issue_id || (entry.issue && (entry.issue.id || entry.issue));
  const numericIssueId = Number(issueId);
  if (numericIssueId && KNOWN_YELLOW_ISSUE_IDS[numericIssueId]) {
    return KNOWN_YELLOW_ISSUE_IDS[numericIssueId];
  }

  // 3. Check activity field (supports { id, name } object or raw string)
  let rawActivity = '';
  if (entry.activity) {
    if (typeof entry.activity === 'object' && typeof entry.activity.name === 'string') {
      rawActivity = entry.activity.name;
    } else if (typeof entry.activity === 'string') {
      rawActivity = entry.activity;
    }
  }
  const activityName = rawActivity.trim();

  if (YELLOW_CATEGORIES.has(activityName)) {
    return activityName;
  }
  const cleanActivity = activityName.replace(/[\.\s]+$/, '').trim();
  if (cleanActivity && YELLOW_CATEGORIES.has(cleanActivity)) {
    return cleanActivity;
  }

  // 4. Fallback check on comments if entry was logged with exact category in notes
  if (typeof entry.comments === 'string') {
    const trimmedComment = entry.comments.trim();
    if (YELLOW_CATEGORIES.has(trimmedComment)) {
      return trimmedComment;
    }
  }

  return null;
}

/**
 * Formats decimal hours into clean compact text:
 * - 1 -> "1h"
 * - 2 -> "2h"
 * - 1.5 -> "1h 30m"
 * - 0.5 -> "30m"
 */
function formatShortHours(hours) {
  const totalMinutes = Math.round((Number(hours) || 0) * 60);
  const h = Math.floor(totalMinutes / 60);
  const m = totalMinutes % 60;
  if (h > 0 && m > 0) return `${h}h ${m}m`;
  if (h > 0) return `${h}h`;
  return `${m}m`;
}

/**
 * Aggregates a list of Redmine time entries across a target set of calendar dates.
 * Enforces stable entry ID deduplication to prevent double-counting across repeated fetches.
 * Only the approved five categories contribute additional hours:
 * 1. Big Late
 * 2. Early Out
 * 3. Leave
 * 4. Holiday
 * 5. Non Productive - ABM Function, Activity (also accepts Non Productive - ABM Function)
 * All other categories (e.g., Development, Data Analysis, Project Management) are strictly excluded
 * and contribute zero additional hours.
 */
function aggregateRedmineTimeEntries(timeEntries, validDateSet) {
  const result = {
    regularHoursByDate: {},
    yellowHoursByDate: {},
    yellowCatsByDate: {},
    excludedHoursByDate: {},
    totalYellowHours: 0,
    totalRegularHours: 0,
    totalExcludedHours: 0,
    processedCount: 0,
    dedupedCount: 0,
    excludedCount: 0
  };

  if (validDateSet) {
    validDateSet.forEach(ds => {
      result.regularHoursByDate[ds] = 0;
      result.yellowHoursByDate[ds] = 0;
      result.yellowCatsByDate[ds] = {};
      result.excludedHoursByDate[ds] = 0;
    });
  }

  if (!Array.isArray(timeEntries) || timeEntries.length === 0) {
    return result;
  }

  const seenEntryIds = new Set();

  for (let i = 0; i < timeEntries.length; i++) {
    const entry = timeEntries[i];
    if (!entry) continue;

    // Stable deduplication by entry ID
    if (entry.id !== undefined && entry.id !== null) {
      if (seenEntryIds.has(entry.id)) {
        result.dedupedCount++;
        continue;
      }
      seenEntryIds.add(entry.id);
    }

    const dStr = parseSpentOnDateStr(entry.spent_on);
    if (!dStr) continue;

    // Skip dates outside the requested window if validDateSet is provided
    if (validDateSet && !validDateSet.has(dStr)) {
      continue;
    }

    if (result.regularHoursByDate[dStr] === undefined) {
      result.regularHoursByDate[dStr] = 0;
      result.yellowHoursByDate[dStr] = 0;
      result.yellowCatsByDate[dStr] = {};
      result.excludedHoursByDate[dStr] = 0;
    }

    const hours = Number(entry.hours) || 0;
    if (hours <= 0) continue;

    result.processedCount++;
    const yellowCat = getEntryYellowCategory(entry);

    if (yellowCat) {
      result.yellowHoursByDate[dStr] += hours;
      result.yellowCatsByDate[dStr][yellowCat] = (result.yellowCatsByDate[dStr][yellowCat] || 0) + hours;
      result.totalYellowHours += hours;
    } else {
      // Unapproved Redmine entry: excluded from additional Redmine hours
      result.excludedHoursByDate[dStr] += hours;
      result.totalExcludedHours += hours;
      result.excludedCount++;
      // regularHoursByDate[dStr] remains 0.0 — unapproved entries contribute zero additional hours
    }
  }

  return result;
}

/**
 * Combines existing WorkLens Active Time with aggregated Redmine yellow time entries.
 * Strictly excludes unapproved regular Redmine categories (e.g., Development, Data Analysis, Project Management).
 *
 * For each date:
 * yellowRedmineHours = sum(hours of matching entries from the five approved categories)
 * displayTotal = originalWorkLensActiveTime + yellowRedmineHours
 * regularDuration = originalWorkLensActiveTime (in seconds)
 * yellowDuration = yellowRedmineHours (in seconds)
 *
 * Unapproved Redmine hours do not contribute to regularDuration, displayTotal, progress bar, or status colors.
 */
function buildCombinedHistoricalView({
  periodName,
  dateObjects,
  dailyDurations,
  dailyTimeRanges,
  redmineAggregation,
  todayStr,
  isCurrentlyTracking,
  formatTime12Fn
}) {
  const daysList = dateObjects.map(d => {
    const ds = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    const isToday = (ds === todayStr);

    // 1. Existing WorkLens Active Time (seconds) - authoritative tracking source, remains unchanged
    const activeSeconds = dailyDurations[ds] || 0;

    // 2. Only approved five categories contribute additional yellow hours
    const redmineYelHours = redmineAggregation ? (redmineAggregation.yellowHoursByDate[ds] || 0) : 0;
    const yellowDurationSeconds = Math.round(redmineYelHours * 3600);

    // 3. Regular Redmine hours are excluded from dashboard totals
    // regularDuration is strictly original WorkLens Active Time
    // displayTotal = originalWorkLensActiveTime + yellowRedmineHours
    const regularDurationSeconds = activeSeconds;
    const totalDisplaySeconds = regularDurationSeconds + yellowDurationSeconds;

    // Session time ranges
    const range = (dailyTimeRanges && dailyTimeRanges[ds]) || { earliestStart: null, latestEnd: null };
    const hasData = Boolean(range.earliestStart || totalDisplaySeconds > 0);
    const startTime = range.earliestStart && formatTime12Fn ? formatTime12Fn(range.earliestStart) : '--';
    let endTime = '--';
    if (isToday) {
      endTime = isCurrentlyTracking ? 'Present' : (range.latestEnd && formatTime12Fn ? formatTime12Fn(range.latestEnd) : '--');
    } else {
      endTime = range.latestEnd && formatTime12Fn ? formatTime12Fn(range.latestEnd) : '--';
    }

    // Yellow categories list for sub-row rendering
    const catMap = (redmineAggregation && redmineAggregation.yellowCatsByDate[ds]) || {};
    const yellowCategoriesList = Object.keys(catMap).map(catName => ({
      name: catName,
      hours: catMap[catName]
    }));

    const weekdayDisplay = d.toLocaleDateString('en-GB', { weekday: 'short', day: '2-digit', month: 'short' });
    const displayDate = d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
    const shortDate = d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' });

    return {
      dateStr: ds,
      displayDate: displayDate,
      weekdayDisplay: weekdayDisplay,
      shortDate: shortDate,
      isToday: isToday,
      duration: totalDisplaySeconds, // Combined daily total seconds = active + yellow
      activeSeconds: activeSeconds,
      regularDuration: regularDurationSeconds,
      yellowDuration: yellowDurationSeconds,
      redmineRegularHours: 0, // Unapproved categories contribute zero additional hours
      redmineYellowHours: redmineYelHours,
      yellowCategories: yellowCategoriesList,
      startTime: startTime,
      endTime: endTime,
      isPresent: isToday && isCurrentlyTracking,
      hasData: hasData
    };
  });

  const totalSeconds = daysList.reduce((sum, d) => sum + d.duration, 0);

  return {
    period: periodName,
    days: daysList,
    totalSeconds: totalSeconds,
    dateRange: `${daysList[daysList.length - 1].shortDate} — ${daysList[0].shortDate}`
  };
}

/**
 * Asynchronously fetches Redmine time entries via redmineClient with pagination.
 */
async function fetchRedmineTimeEntries(userId, fromDateStr, toDateStr, client) {
  if (!userId || !client) return [];
  const allEntries = [];
  let offset = 0;
  const limit = 100;
  let totalCount = 1;

  while (offset < totalCount && offset < 500) {
    try {
      const res = await client.get('/time_entries.json', {
        user_id: userId,
        from: fromDateStr,
        to: toDateStr,
        limit: limit,
        offset: offset
      }, { timeout: 25000 });

      let list = [];
      if (Array.isArray(res)) {
        list = res;
        totalCount = list.length;
      } else if (res && Array.isArray(res.time_entries)) {
        list = res.time_entries;
        totalCount = typeof res.total_count === 'number' ? res.total_count : list.length;
      } else {
        break;
      }

      if (list.length === 0) break;
      allEntries.push(...list);
      offset += list.length;
      if (list.length < limit) break;
    } catch (err) {
      console.error(`[Redmine Time Integration] Error fetching /time_entries.json offset ${offset}:`, err.message);
      break;
    }
  }

  // Enrich entries with issue_subject from KNOWN_YELLOW_ISSUE_IDS so downstream components always have it
  allEntries.forEach(entry => {
    const issueId = entry.issue_id || (entry.issue && (entry.issue.id || entry.issue));
    const numId = Number(issueId);
    if (numId && KNOWN_YELLOW_ISSUE_IDS[numId] && !entry.issue_subject) {
      entry.issue_subject = KNOWN_YELLOW_ISSUE_IDS[numId];
    }
  });

  return allEntries;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    YELLOW_CATEGORIES,
    KNOWN_YELLOW_ISSUE_IDS,
    parseSpentOnDateStr,
    getEntryYellowCategory,
    formatShortHours,
    aggregateRedmineTimeEntries,
    buildCombinedHistoricalView,
    fetchRedmineTimeEntries
  };
}
