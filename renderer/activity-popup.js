// ================= DOM ELEMENTS =================
const getEl = (id) => (typeof document !== 'undefined' ? document.getElementById(id) : null);
const popupContainer = getEl('popup-container');
const arrowEl = getEl('arrow');
const closeBtn = getEl('close-btn');
const refreshBtn = getEl('refresh-btn');
const dateEl = getEl('current-date');
const loadingState = getEl('loading-state');
const errorState = getEl('error-state');
const emptyState = getEl('empty-state');
const emptyMsg = getEl('empty-msg');
const retryBtn = getEl('retry-btn');
const activityList = getEl('activity-list');
const historyList = getEl('history-list');
const totalTimeEl = getEl('total-time');
const periodTabs = typeof document !== 'undefined' ? document.querySelectorAll('.period-tab') : [];
const colHeaderName = getEl('col-header-name');
const colHeaderTime = getEl('col-header-time');
const loadingText = getEl('loading-text');
const weekendToggleContainer = getEl('weekend-toggle-container');
const weekendCheckbox = getEl('toggle-weekends');
const historyLegend = getEl('history-legend');
const viewToggleContainer = getEl('view-toggle-container');
const viewToggleAppBtn = getEl('view-toggle-app');
const viewToggleHoursBtn = getEl('view-toggle-hours');

// Header Navigation & View Panel Elements
const tabNavActiveTime = getEl('tab-nav-active-time');
const tabNavReportees = getEl('tab-nav-reportees');
const navReporteesLabel = getEl('nav-reportees-label');
const activeTimeView = getEl('active-time-view');
const reporteesView = getEl('reportees-view');

// Reportees Dashboard Elements
const reporteesDateRangeText = getEl('reportees-date-range-text');
const reporteesPeriodPill = getEl('reportees-period-pill');
const reporteesSearchInput = getEl('reportees-search-input');
const reporteesRangeSelectorBtn = getEl('reportees-range-selector-btn');
const reporteesDropdownSelectedLabel = getEl('reportees-dropdown-selected-label');
const reporteesRangeMenu = getEl('reportees-range-menu');
const summaryTotalReportees = getEl('summary-total-reportees');
const summaryTeamHours = getEl('summary-team-hours');
const summaryPeriodDays = getEl('summary-period-days');
const reporteesLoading = getEl('reportees-loading');
const reporteesError = getEl('reportees-error');
const reporteesErrorMsg = getEl('reportees-error-msg');
const reporteesRetryBtn = getEl('reportees-retry-btn');
const reporteesEmpty = getEl('reportees-empty');
const reporteesEmptyMsg = getEl('reportees-empty-msg');
const reporteesList = getEl('reportees-list');

// ================= STATE VARIABLES =================
let pollInterval = null;
let renderedRows = {}; // Holds legacy map of appName -> DOM element
let renderedHourRows = {}; // Holds map of hour -> DOM element
let expandedAppName = null; // Currently expanded application name
let expandedHours = new Set(); // Set of currently expanded hour numbers
let currentPeriod = 'today'; // 'today' | 'yesterday' | 'last7days' | 'current_month'
let currentActivityView = 'app'; // 'app' | 'hours' (defaults to App-Wise)
let showWeekends = false; // Default: false (unchecked, hides Sat & Sun in historical views)

// Reportees State
let currentDashboardView = 'active-time'; // 'active-time' | 'reportees'
let reporteesData = null;
let reporteesDays = 30;
let reporteesSearchQuery = '';
let collapsedReporteeIds = new Set();
let isReporteesLoading = false;

// Client-side view cache for instant tab switching (0ms)
let clientViewCache = {
  today: null,
  yesterday: null,
  last7days: null,
  last30days: null
};
let lastCacheTimestamp = Date.now();
const CLIENT_CACHE_TTL_MS = 60 * 1000; // 60s cache TTL

// ================= INITIALIZATION =================
if (typeof document !== 'undefined') {
document.addEventListener('DOMContentLoaded', () => {
  setupPeriodTabs();
  setupViewToggle();
  setupHeaderNav();
  setupReporteesControls();
  checkReporteesVisibility();
  updateDateDisplay();
  updateViewToggleVisibility();
  updateWeekendToggleVisibility();
  updateHistoryLegendVisibility();

  if (weekendCheckbox) {
    weekendCheckbox.checked = showWeekends;
    weekendCheckbox.addEventListener('change', (e) => {
      showWeekends = Boolean(e.target.checked);
      if (currentPeriod === 'last7days' || currentPeriod === 'last30days' || currentPeriod === 'current_month') {
        if (clientViewCache[currentPeriod]) {
          renderHistoryView(clientViewCache[currentPeriod]);
        }
      }
    });
  }

  // Register close button click
  if (closeBtn) closeBtn.addEventListener('click', initiateCloseAnimation);

  // Register refresh button click
  if (refreshBtn) refreshBtn.addEventListener('click', handleRefreshClick);

  // Register retry button click
  if (retryBtn) retryBtn.addEventListener('click', fetchAndRender);

  // Set up listeners from main process
  if (window.api) {
    if (typeof window.api.onPopupStatusChanged === 'function') {
      window.api.onPopupStatusChanged((status) => {
        if (status === 'opened') {
          // If cache expired, reset client cache so fresh background fetch occurs
          if (Date.now() - lastCacheTimestamp > CLIENT_CACHE_TTL_MS) {
            clientViewCache = { today: null, yesterday: null, last7days: null, last30days: null };
            lastCacheTimestamp = Date.now();
          }
          // Always default to today when popup is reopened
          selectPeriod('today', false);
          updateDateDisplay();
          startPolling();
          checkReporteesVisibility();
        } else if (status === 'closed') {
          stopPolling();
        }
      });
    }

    if (typeof window.api.onRequestClose === 'function') {
      window.api.onRequestClose(() => {
        initiateCloseAnimation();
      });
    }

    if (typeof window.api.onUpdateArrowPosition === 'function') {
      window.api.onUpdateArrowPosition((arrowLeft, isBelow) => {
        updateArrowPosition(arrowLeft, isBelow);
      });
    }

    if (typeof window.api.onHistoricalDataReady === 'function') {
      window.api.onHistoricalDataReady((data) => {
        // Clear cached views so fresh server data will be loaded
        clientViewCache.today = null;
        clientViewCache.yesterday = null;
        clientViewCache.last7days = null;
        clientViewCache.last30days = null;
        // Always refresh currently visible period immediately with synchronized server data
        fetchAndRender();
      });
    }

    if (typeof window.api.onAppIconsUpdated === 'function') {
      window.api.onAppIconsUpdated((iconsMap) => {
        if (!iconsMap) return;
        // Update rendered app icons in place without re-rendering entire lists
        for (const [appName, el] of Object.entries(renderedRows)) {
          if (!el) continue;
          const iconEl = el.querySelector('.app-icon');
          if (iconEl && iconsMap[appName.toLowerCase()]) {
            iconEl.src = iconsMap[appName.toLowerCase()];
          }
        }
      });
    }

    // Tell the main process that the renderer is fully loaded and ready
    window.api.sendPopupReady();
  }
});
}

// ================= PERIOD TABS CONTROLLER =================
function setupPeriodTabs() {
  periodTabs.forEach(tab => {
    tab.addEventListener('click', () => {
      const targetPeriod = tab.dataset.period;
      if (targetPeriod === currentPeriod) return;
      selectPeriod(targetPeriod, true);
    });

    tab.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        tab.click();
      }
    });
  });
}

function selectPeriod(period, triggerFetch = true) {
  const isPeriodChange = (period !== currentPeriod);

  currentPeriod = period;
  periodTabs.forEach(tab => {
    const isSelected = tab.dataset.period === period;
    tab.classList.toggle('active', isSelected);
    tab.setAttribute('aria-selected', isSelected ? 'true' : 'false');
  });

  updateDateDisplay();
  updateViewToggleVisibility();
  updateColumnHeaders();
  updateWeekendToggleVisibility();
  updateFooterLabel();

  // If already cached, switch view INSTANTLY with zero network/IPC delay
  if (clientViewCache[period]) {
    if (isPeriodChange) {
      clearRenderedActivityRows();
      if (historyList) {
        historyList.innerHTML = '';
        historyList.scrollTop = 0;
      }
    }

    if (period === 'last7days' || period === 'last30days' || period === 'current_month') {
      renderHistoryView(clientViewCache[period]);
    } else {
      renderTodayYesterdayView(clientViewCache[period]);
    }
    return;
  }

  // Not in client cache yet: clear current items to avoid stale flashing
  if (isPeriodChange) {
    clearRenderedActivityRows();
    if (historyList) {
      historyList.innerHTML = '';
      historyList.scrollTop = 0;
    }
  }

  if (triggerFetch) {
    fetchAndRender();
  }
}

// ================= VIEW TOGGLE CONTROLLER (APP WISE / HOURS WISE) =================
function setupViewToggle() {
  const appBtn = viewToggleAppBtn || getEl('view-toggle-app');
  const hoursBtn = viewToggleHoursBtn || getEl('view-toggle-hours');

  if (appBtn) {
    appBtn.addEventListener('click', () => {
      selectActivityView('app');
    });
    appBtn.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        appBtn.click();
      }
    });
  }

  if (hoursBtn) {
    hoursBtn.addEventListener('click', () => {
      selectActivityView('hours');
    });
    hoursBtn.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        hoursBtn.click();
      }
    });
  }
}

function selectActivityView(viewMode) {
  if (viewMode !== 'app' && viewMode !== 'hours') return;
  if (viewMode === currentActivityView) return;

  currentActivityView = viewMode;
  updateViewToggleButtons();
  updateColumnHeaders();

  clearRenderedActivityRows();

  if (currentPeriod === 'today' || currentPeriod === 'yesterday') {
    if (clientViewCache[currentPeriod]) {
      renderTodayYesterdayView(clientViewCache[currentPeriod]);
    } else {
      fetchAndRender();
    }
  }
}

function updateViewToggleButtons() {
  const appBtn = viewToggleAppBtn || getEl('view-toggle-app');
  const hoursBtn = viewToggleHoursBtn || getEl('view-toggle-hours');
  const isApp = (currentActivityView === 'app');
  if (appBtn) {
    appBtn.classList.toggle('active', isApp);
    appBtn.setAttribute('aria-pressed', isApp ? 'true' : 'false');
  }
  if (hoursBtn) {
    hoursBtn.classList.toggle('active', !isApp);
    hoursBtn.setAttribute('aria-pressed', !isApp ? 'true' : 'false');
  }
}

function updateViewToggleVisibility() {
  const container = viewToggleContainer || getEl('view-toggle-container');
  if (!container) return;
  const isTodayOrYesterday = (currentPeriod === 'today' || currentPeriod === 'yesterday');
  if (isTodayOrYesterday) {
    container.classList.remove('hidden');
    updateViewToggleButtons();
  } else {
    container.classList.add('hidden');
  }
}

function clearRenderedActivityRows() {
  for (const h in renderedHourRows) {
    if (renderedHourRows[h]) renderedHourRows[h].remove();
  }
  renderedHourRows = {};

  for (const name in renderedRows) {
    if (renderedRows[name]) renderedRows[name].remove();
  }
  renderedRows = {};

  expandedHours = new Set();
  expandedAppName = null;

  const targetList = activityList || getEl('activity-list');
  if (targetList) {
    targetList.innerHTML = '';
    targetList.scrollTop = 0;
  }
}

function updateColumnHeaders() {
  const targetName = colHeaderName || getEl('col-header-name');
  const targetTime = colHeaderTime || getEl('col-header-time');
  if (!targetName || !targetTime) return;
  if (currentPeriod === 'today' || currentPeriod === 'yesterday') {
    targetName.textContent = currentActivityView === 'hours' ? 'TIME SLOT' : 'APPLICATION';
    targetTime.textContent = 'ACTIVE TIME';
  } else {
    targetName.textContent = 'DATE';
    targetTime.textContent = 'ACTIVE TIME';
  }
}

function updateWeekendToggleVisibility() {
  if (!weekendToggleContainer) return;
  const isHistorical = (currentPeriod === 'last7days' || currentPeriod === 'last30days' || currentPeriod === 'current_month');
  if (isHistorical) {
    weekendToggleContainer.classList.remove('hidden');
    if (weekendCheckbox) {
      weekendCheckbox.checked = showWeekends;
    }
  } else {
    weekendToggleContainer.classList.add('hidden');
  }
  updateHistoryLegendVisibility();
}

function updateHistoryLegendVisibility() {
  if (!historyLegend) return;
  const isHistorical = (currentPeriod === 'last7days' || currentPeriod === 'last30days' || currentPeriod === 'current_month');
  if (isHistorical) {
    historyLegend.classList.remove('hidden');
  } else {
    historyLegend.classList.add('hidden');
  }
}

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function formatShortHours(hours) {
  const totalMinutes = Math.round((Number(hours) || 0) * 60);
  const h = Math.floor(totalMinutes / 60);
  const m = totalMinutes % 60;
  if (h > 0 && m > 0) return `${h}h ${m}m`;
  if (h > 0) return `${h}h`;
  return `${m}m`;
}

function parseTimestampToDate(val) {
  if (!val) return null;
  if (val instanceof Date) return isNaN(val.getTime()) ? null : val;
  const str = String(val).trim();
  // Match YYYY-MM-DDTHH:mm:ss or YYYY-MM-DD HH:mm:ss
  const ymdMatch = str.match(/^(\d{4})-(\d{2})-(\d{2})(?:[T\s](\d{2}):(\d{2}):?(\d{2})?)?/);
  if (ymdMatch) {
    const y = parseInt(ymdMatch[1], 10);
    const m = parseInt(ymdMatch[2], 10) - 1;
    const d = parseInt(ymdMatch[3], 10);
    const hh = parseInt(ymdMatch[4] || 0, 10);
    const mm = parseInt(ymdMatch[5] || 0, 10);
    const ss = parseInt(ymdMatch[6] || 0, 10);
    return new Date(y, m, d, hh, mm, ss);
  }
  // Match DD-MM-YYYYTHH:mm:ss or DD-MM-YYYY HH:mm:ss
  const dmyMatch = str.match(/^(\d{2})-(\d{2})-(\d{4})(?:[T\s](\d{2}):(\d{2}):?(\d{2})?)?/);
  if (dmyMatch) {
    const d = parseInt(dmyMatch[1], 10);
    const m = parseInt(dmyMatch[2], 10) - 1;
    const y = parseInt(dmyMatch[3], 10);
    const hh = parseInt(dmyMatch[4] || 0, 10);
    const mm = parseInt(dmyMatch[5] || 0, 10);
    const ss = parseInt(dmyMatch[6] || 0, 10);
    return new Date(y, m, d, hh, mm, ss);
  }
  const parsed = new Date(str);
  if (!isNaN(parsed.getTime())) return parsed;
  return null;
}

function formatHour12(h) {
  const normalizedHour = ((h % 24) + 24) % 24;
  const period = normalizedHour >= 12 ? 'PM' : 'AM';
  let h12 = normalizedHour % 12;
  if (h12 === 0) h12 = 12;
  const hh = String(h12).padStart(2, '0');
  return `${hh}:00 ${period}`;
}

function formatHourRange(startH) {
  const startStr = formatHour12(startH);
  const endStr = formatHour12(startH + 1);
  return `${startStr} – ${endStr}`;
}

function parse12HourTimeToHours(timeStr) {
  if (!timeStr || typeof timeStr !== 'string') return null;
  const m = timeStr.trim().match(/^(\d{1,2}):(\d{2})\s*(AM|PM)?$/i);
  if (!m) return null;
  let hh = parseInt(m[1], 10);
  const period = (m[3] || '').toUpperCase();
  if (period === 'PM' && hh < 12) hh += 12;
  if (period === 'AM' && hh === 12) hh = 0;
  return hh;
}

/**
 * Cleanly formats a window or website title.
 * For browser applications, strips trailing browser suffixes and produces clean domain / page titles.
 * For desktop applications, preserves the recorded window title.
 */
function formatWindowOrWebsiteTitle(rawTitle, appName = '') {
  if (!rawTitle || typeof rawTitle !== 'string') {
    return appName || 'Active Window';
  }

  let title = rawTitle.trim();
  const lowerApp = (appName || '').toLowerCase();
  const isBrowser = lowerApp.includes('chrome') || lowerApp.includes('edge') || lowerApp.includes('firefox') || lowerApp.includes('brave') || lowerApp.includes('opera');

  if (isBrowser) {
    // Strip trailing browser names like " - Google Chrome", " - Microsoft Edge", etc.
    title = title.replace(/\s*[-–—]\s*(Google Chrome|Microsoft Edge|Mozilla Firefox|Brave|Opera)$/i, '').trim();

    const lowerTitle = title.toLowerCase();

    // Google Docs
    if (lowerTitle.includes('docs.google.com') || lowerTitle.includes('google docs')) {
      let cleanDoc = title
        .replace(/https?:\/\//i, '')
        .replace(/docs\.google\.com\/?/i, '')
        .replace(/\s*[-–—:]*\s*google docs\s*[-–—:]*\s*/gi, '')
        .trim();
      cleanDoc = cleanDoc.replace(/^[-–—:]+\s*/, '').replace(/\s*[-–—:]+$/, '').trim();
      return cleanDoc ? `docs.google.com – ${cleanDoc}` : 'docs.google.com';
    }

    // Google Sheets
    if (lowerTitle.includes('sheets.google.com') || lowerTitle.includes('google sheets')) {
      let cleanSheet = title
        .replace(/https?:\/\//i, '')
        .replace(/sheets\.google\.com\/?/i, '')
        .replace(/\s*[-–—:]*\s*google sheets\s*[-–—:]*\s*/gi, '')
        .trim();
      cleanSheet = cleanSheet.replace(/^[-–—:]+\s*/, '').replace(/\s*[-–—:]+$/, '').trim();
      return cleanSheet ? `sheets.google.com – ${cleanSheet}` : 'sheets.google.com';
    }

    // Gmail / Google Mail
    if (lowerTitle.includes('mail.google.com') || lowerTitle.includes('gmail')) {
      return 'mail.google.com';
    }

    // YouTube
    if (lowerTitle.includes('youtube.com') || lowerTitle.includes('youtube')) {
      return 'youtube.com';
    }

    // Notion
    if (lowerTitle.includes('notion.so') || lowerTitle.includes('notion')) {
      return 'notion.so';
    }

    // Stack Overflow
    if (lowerTitle.includes('stackoverflow.com') || lowerTitle.includes('stack overflow')) {
      return 'stackoverflow.com';
    }

    // GitHub
    if (lowerTitle.includes('github.com')) {
      return 'github.com';
    }
  }

  return title;
}

/**
 * Computes application-wise activity aggregation from raw session records.
 * Groups by application name and individual activity window titles.
 * Sorts applications by total active time in descending order by default.
 * Sorts activities within each application by duration descending.
 * Calculates total active seconds without double-counting.
 */
function computeAppWiseActivity(logs) {
  const activeLogs = (logs || []).filter(e => {
    if (!e) return false;
    const status = (e.status || '').toLowerCase();
    const duration = Number(e.duration) || 0;
    return status === 'active' && duration > 0;
  });

  const totalDailySeconds = activeLogs.reduce((acc, entry) => acc + (Number(entry.duration) || 0), 0);

  if (activeLogs.length === 0) {
    return {
      sortedApps: [],
      totalDailySeconds: 0,
      hasActivity: false
    };
  }

  const grouped = {};
  activeLogs.forEach(entry => {
    const rawAppName = entry.app_name;
    const appName = (rawAppName && String(rawAppName).trim()) ? String(rawAppName).trim() : 'Unknown Application';
    const rawWindowTitle = (entry.window_title && String(entry.window_title).trim()) ? String(entry.window_title).trim() : appName;
    const duration = Number(entry.duration) || 0;

    if (!grouped[appName]) {
      grouped[appName] = {
        name: appName,
        totalDuration: 0,
        activitiesMap: {}
      };
    }
    grouped[appName].totalDuration += duration;
    grouped[appName].activitiesMap[rawWindowTitle] = (grouped[appName].activitiesMap[rawWindowTitle] || 0) + duration;
  });

  const sortedApps = Object.keys(grouped)
    .map(name => {
      const appGroup = grouped[name];
      const activities = Object.keys(appGroup.activitiesMap).map(title => ({
        title,
        appName: name,
        duration: appGroup.activitiesMap[title]
      })).sort((a, b) => b.duration - a.duration);

      return {
        name,
        duration: appGroup.totalDuration,
        activities
      };
    })
    .sort((a, b) => b.duration - a.duration);

  return {
    sortedApps,
    totalDailySeconds,
    hasActivity: sortedApps.length > 0
  };
}

/**
 * Computes hourly activity distribution from raw session records.
 * Calculates exact interval overlap within each hour without double-counting.
 * For today, caps current hour activity at the present time.
 */
function computeHourlyActivity(logs, dayDateStr, isToday, now = new Date(), startTimeStr = null, endTimeStr = null) {
  const activeLogs = (logs || []).filter(e => {
    if (!e) return false;
    const status = (e.status || '').toLowerCase();
    const duration = Number(e.duration) || 0;
    return status === 'active' && duration > 0;
  });

  const totalDailySeconds = activeLogs.reduce((acc, entry) => acc + (Number(entry.duration) || 0), 0);

  if (activeLogs.length === 0) {
    return {
      hourlySlots: [],
      totalDailySeconds: 0,
      hasActivity: false
    };
  }

  // Determine earliest and latest activity hours
  let minHour = null;
  let maxHour = null;

  activeLogs.forEach(entry => {
    const s = parseTimestampToDate(entry.start_time);
    if (s) {
      const h = s.getHours();
      if (minHour === null || h < minHour) minHour = h;
      if (maxHour === null || h > maxHour) maxHour = h;
    }
    const e = parseTimestampToDate(entry.end_time);
    if (e) {
      const h = e.getHours();
      if (maxHour === null || h > maxHour) maxHour = h;
    }
  });

  // Start hour: strictly when PC / tracking started
  let startHour = minHour !== null ? minHour : 9;
  if (startTimeStr && startTimeStr !== '--') {
    const parsedStartHour = parse12HourTimeToHours(startTimeStr);
    if (parsedStartHour !== null) {
      startHour = (minHour !== null) ? Math.min(minHour, parsedStartHour) : parsedStartHour;
    }
  }

  // End hour: up to Present (for Today) or up to when PC tracking ended (for Yesterday)
  let endHour;
  if (isToday) {
    const currentHour = now.getHours();
    endHour = Math.max(currentHour, maxHour !== null ? maxHour : currentHour);
  } else {
    if (endTimeStr && endTimeStr !== '--' && endTimeStr !== 'Present') {
      const parsedEndHour = parse12HourTimeToHours(endTimeStr);
      if (parsedEndHour !== null) {
        endHour = (maxHour !== null) ? Math.max(maxHour, parsedEndHour) : parsedEndHour;
      } else {
        endHour = (maxHour !== null) ? maxHour : startHour;
      }
    } else {
      endHour = (maxHour !== null) ? maxHour : startHour;
    }
  }

  if (endHour < startHour) {
    endHour = startHour;
  }

  // Parse target date components
  let year = now.getFullYear();
  let month = now.getMonth();
  let day = now.getDate();
  if (dayDateStr && typeof dayDateStr === 'string' && dayDateStr.includes('-')) {
    const parts = dayDateStr.split('-');
    if (parts.length === 3) {
      const y = parseInt(parts[0], 10);
      const m = parseInt(parts[1], 10) - 1;
      const d = parseInt(parts[2], 10);
      if (!isNaN(y) && !isNaN(m) && !isNaN(d)) {
        year = y;
        month = m;
        day = d;
      }
    }
  }

  const hourlySlots = [];

  for (let h = startHour; h <= endHour; h++) {
    const slotStart = new Date(year, month, day, h, 0, 0, 0);
    const slotEnd = new Date(year, month, day, h + 1, 0, 0, 0);
    const slotStartMs = slotStart.getTime();
    const slotEndMs = slotEnd.getTime();

    // For the current hour, show activity only up to the present time
    const isCurrentHour = isToday && (h === now.getHours());
    const effectiveLimitMs = isCurrentHour ? Math.min(slotEndMs, now.getTime()) : slotEndMs;

    const appsMap = {};
    const windowsMap = {};
    let slotTotalDuration = 0;

    activeLogs.forEach(entry => {
      const s = parseTimestampToDate(entry.start_time);
      if (!s) return;
      const sMs = s.getTime();
      const durationSec = Number(entry.duration) || 0;
      if (durationSec <= 0) return;

      const parsedEnd = parseTimestampToDate(entry.end_time);
      const eMs = (parsedEnd && parsedEnd.getTime() > sMs)
        ? parsedEnd.getTime()
        : (sMs + durationSec * 1000);

      // Calculate intersection [overlapStart, overlapEnd]
      const overlapStart = Math.max(sMs, slotStartMs);
      const overlapEnd = Math.min(eMs, effectiveLimitMs);

      if (overlapEnd > overlapStart) {
        const overlapMs = overlapEnd - overlapStart;
        const totalSpanMs = Math.max(1, eMs - sMs);

        let activeSecInHour = Math.round(durationSec * (overlapMs / totalSpanMs));
        if (activeSecInHour <= 0 && overlapMs > 0 && durationSec >= 1) {
          activeSecInHour = 1;
        }
        activeSecInHour = Math.min(3600, activeSecInHour);

        if (activeSecInHour > 0) {
          const appName = (entry.app_name && entry.app_name.trim()) ? entry.app_name.trim() : 'Unknown Application';
          const rawWindowTitle = (entry.window_title && entry.window_title.trim()) ? entry.window_title.trim() : appName;
          const displayTitle = formatWindowOrWebsiteTitle(rawWindowTitle, appName);

          // 1. Group by application
          if (!appsMap[appName]) {
            appsMap[appName] = {
              name: appName,
              duration: 0,
              windowTitles: {}
            };
          }
          appsMap[appName].duration += activeSecInHour;
          appsMap[appName].windowTitles[rawWindowTitle] = (appsMap[appName].windowTitles[rawWindowTitle] || 0) + activeSecInHour;

          // 2. Group by website / window title
          if (!windowsMap[displayTitle]) {
            windowsMap[displayTitle] = {
              displayTitle,
              rawTitle: rawWindowTitle,
              appName,
              duration: 0
            };
          }
          windowsMap[displayTitle].duration += activeSecInHour;

          slotTotalDuration += activeSecInHour;
        }
      }
    });

    slotTotalDuration = Math.min(3600, slotTotalDuration);

    const appList = Object.keys(appsMap).map(name => {
      const appObj = appsMap[name];
      return {
        name,
        duration: Math.min(3600, appObj.duration),
        windowTitles: appObj.windowTitles
      };
    }).sort((a, b) => b.duration - a.duration);

    const windowList = Object.values(windowsMap).map(w => ({
      displayTitle: w.displayTitle,
      rawTitle: w.rawTitle,
      appName: w.appName,
      duration: Math.min(3600, w.duration)
    })).sort((a, b) => b.duration - a.duration);

    hourlySlots.push({
      hour: h,
      timeRange: formatHourRange(h),
      totalDuration: slotTotalDuration,
      appList,
      windowList,
      isCurrentHour
    });
  }

  return {
    hourlySlots,
    totalDailySeconds,
    hasActivity: true
  };
}

function isWeekend(dateStr) {
  if (!dateStr || typeof dateStr !== 'string') return false;
  const parts = dateStr.split('-');
  if (parts.length !== 3) return false;
  const year = parseInt(parts[0], 10);
  const month = parseInt(parts[1], 10) - 1;
  const day = parseInt(parts[2], 10);
  if (isNaN(year) || isNaN(month) || isNaN(day)) return false;
  // Use local noon (12:00:00) to ensure reliable local calendar weekday without DST transition effects
  const date = new Date(year, month, day, 12, 0, 0);
  const dayOfWeek = date.getDay();
  return dayOfWeek === 0 || dayOfWeek === 6; // Sunday = 0, Saturday = 6
}

function getDailyActiveTimeColor(durationSeconds) {
  const duration = Number(durationSeconds) || 0;
  const durationMinutes = duration / 60;
  // Thresholds:
  // - RED: Less than 7 hours (< 420 minutes / < 25200 seconds)
  // - YELLOW: Greater than 7 hours but less than 7 hours 30 minutes (> 420 minutes && < 450 minutes)
  // - BLUE: Exactly 7 hours (420m / 25200s) or exactly 7 hours 30 minutes (450m / 27000s)
  // - GREEN: More than 7 hours 30 minutes (> 450 minutes / > 27000 seconds)
  if (durationMinutes < 420) {
    return 'red';
  } else if (durationMinutes > 420 && durationMinutes < 450) {
    return 'yellow';
  } else if (durationMinutes <= 450) {
    return 'blue';
  } else {
    return 'green';
  }
}

// Daily reference scale: 9 hours 30 minutes = 570 minutes = 34,200 seconds (fixed 100% target scale)
const DAILY_TARGET_MINUTES = 570;
const DAILY_TARGET_SECONDS = DAILY_TARGET_MINUTES * 60; // 34,200 seconds
const DAILY_REFERENCE_MINUTES = 570;
const DAILY_REFERENCE_SECONDS = DAILY_TARGET_SECONDS;
const STANDARD_TARGET_HOURS = 8;
const STANDARD_TARGET_MINUTES = STANDARD_TARGET_HOURS * 60; // 480 minutes
const STANDARD_TARGET_SECONDS = STANDARD_TARGET_MINUTES * 60; // 28,800 seconds

const REDMINE_CATEGORY_COLORS = {
  'Big Late': '#FF1744',
  'Early Out': '#FFD600',
  'Leave': '#8B5CF6',
  'Holiday': '#FF4081',
  'Working': '#00E676',
  'ABM Function, Activity': '#2979FF',
  'Non Productive - ABM Function, Activity': '#2979FF',
  'Non Productive - ABM Function': '#2979FF'
};

/**
 * Calculates progress percentages for daily progress bars based on the fixed 9h 30m (570 minutes) reference scale:
 * Both the green bar (actual tracked active time) and yellow bar (8-hour target / special hours)
 * share the exact same 9h 30m reference denominator (570 minutes = 34,200 seconds = 100%).
 *
 * Formula:
 * - actualPercent = (actualMinutes / 570) * 100 = (actualSeconds / 34200) * 100
 * - targetPercent = (targetMinutes / 570) * 100 = (targetSeconds / 34200) * 100
 *
 * Examples:
 * - Actual tracked: 5h 9m (309m = 18,540s) -> 54.21%
 * - Target: 8h (480m = 28,800s) -> 84.21%
 * - 9h 30m (570m = 34,200s) -> 100.00%
 * - 10h (600m = 36,000s) -> 105.26% (visually capped at 100% so it stays within the track)
 *
 * Both bars start at the same horizontal position (0%) and use the same available track width (100%).
 * Each bar is individually visually capped at 100% so neither exceeds the track.
 */
function calculateDailyProgressPercentages(regularDuration, yellowDuration = 0, unit = 'seconds') {
  const isMinutes = unit === true || unit === 'minutes' || unit === 'min' || unit === 'm' || (typeof unit === 'object' && unit && unit.unit === 'minutes');
  const denominator = isMinutes ? DAILY_REFERENCE_MINUTES : DAILY_REFERENCE_SECONDS;

  const regVal = Math.max(0, Number(regularDuration) || 0);
  const yelVal = Math.max(0, Number(yellowDuration) || 0);

  const rawRegularPercentage = (regVal / denominator) * 100;
  const rawYellowPercentage = (yelVal / denominator) * 100;
  const rawTotalPercentage = ((regVal + yelVal) / denominator) * 100;

  // Visual capping: each displayed bar must never exceed 100% of the available track width
  const regularPercentage = Math.min(100, Math.max(0, rawRegularPercentage));
  const yellowPercentage = Math.min(100, Math.max(0, rawYellowPercentage));

  return {
    rawRegularPercentage,
    rawYellowPercentage,
    rawTotalPercentage,
    regularPercentage,
    yellowPercentage,
    cappedTotalPercentage: Math.min(rawTotalPercentage, 100)
  };
}

function calculateDailyProgressPercentagesMinutes(actualMinutes, targetMinutes = 0) {
  return calculateDailyProgressPercentages(actualMinutes, targetMinutes, 'minutes');
}

function calculateProgressPercent(duration, reference = DAILY_TARGET_SECONDS) {
  const d = Math.max(0, Number(duration) || 0);
  const ref = Math.max(1, Number(reference) || DAILY_TARGET_SECONDS);
  return Math.min(100, Math.max(0, (d / ref) * 100));
}

// ================= UTILITIES & HELPERS =================
function updateFooterLabel() {
  const footerLabelEl = document.getElementById('footer-label');
  if (!footerLabelEl) return;
  if (currentPeriod === 'today') {
    footerLabelEl.textContent = 'Total Active Time (Today)';
  } else if (currentPeriod === 'yesterday') {
    footerLabelEl.textContent = 'Total Active Time (Yesterday)';
  } else if (currentPeriod === 'last7days') {
    footerLabelEl.textContent = 'Total Time (Last 7 Days)';
  } else if (currentPeriod === 'last30days' || currentPeriod === 'current_month') {
    footerLabelEl.textContent = 'Total Time (Last 30 Days)';
  } else {
    footerLabelEl.textContent = 'Total Active Time';
  }
}

function updateDateDisplay() {
  if (!dateEl) return;
  const now = new Date();
  const options = { day: '2-digit', month: 'short', year: 'numeric' };

  if (currentPeriod === 'today') {
    if (clientViewCache.today) {
      updateDateSubtitleForAppView(clientViewCache.today);
    } else {
      dateEl.innerHTML = `<span class="date-label">${now.toLocaleDateString('en-GB', options)}</span>`;
    }
  } else if (currentPeriod === 'yesterday') {
    const y = new Date();
    y.setDate(y.getDate() - 1);
    if (clientViewCache.yesterday) {
      updateDateSubtitleForAppView(clientViewCache.yesterday);
    } else {
      dateEl.innerHTML = `<span class="date-label">${y.toLocaleDateString('en-GB', options)}</span>`;
    }
  } else if (currentPeriod === 'last7days') {
    const start = new Date();
    start.setDate(now.getDate() - 6);
    dateEl.innerHTML = `<span class="date-label">${start.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' })} — ${now.toLocaleDateString('en-GB', options)}</span>`;
  } else if (currentPeriod === 'last30days' || currentPeriod === 'current_month') {
    const start = new Date();
    start.setDate(now.getDate() - 29);
    dateEl.innerHTML = `<span class="date-label">${start.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' })} — ${now.toLocaleDateString('en-GB', options)}</span>`;
  }
}

function updateDateSubtitleForAppView(data) {
  if (!dateEl) return;
  const now = new Date();
  const options = { day: '2-digit', month: 'short', year: 'numeric' };
  let dateText = '';
  if (currentPeriod === 'today') {
    dateText = now.toLocaleDateString('en-GB', options);
  } else if (currentPeriod === 'yesterday') {
    const y = new Date();
    y.setDate(y.getDate() - 1);
    dateText = y.toLocaleDateString('en-GB', options);
  } else {
    return;
  }

  const startTime = data?.startTime || '--';
  const endTime = data?.endTime || '--';
  const isPresent = Boolean(data?.isPresent);
  const hasData = Boolean(data?.hasData || (startTime !== '--' && endTime !== '--'));

  if (hasData) {
    const endHtml = isPresent ? `<span class="present-text">Present</span>` : endTime;
    dateEl.innerHTML = `<span class="date-label">${dateText}</span><span class="date-session-range"><span class="time-boundary-start">${startTime}</span><span class="time-range-arrow">&rarr;</span><span class="time-boundary-end ${isPresent ? 'is-present' : ''}">${endHtml}</span></span>`;
  } else {
    dateEl.innerHTML = `<span class="date-label">${dateText}</span><span class="date-session-range"><span class="time-boundary-start">--</span><span class="time-range-arrow">&rarr;</span><span class="time-boundary-end">--</span></span>`;
  }
}

function formatDuration(totalSeconds) {
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);

  if (hours > 0) {
    return `${hours}h ${minutes}m`;
  }
  return `${minutes}m`;
}

function formatActivityDuration(totalSeconds) {
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (hours > 0) {
    return `${hours}h ${minutes}m ${seconds}s`;
  }
  if (minutes > 0) {
    return `${minutes}m ${seconds}s`;
  }
  return `${seconds}s`;
}

function toggleAppExpansion(appName, groupEl) {
  const wrapper = groupEl.querySelector('.activities-details-wrapper');
  const row = groupEl.querySelector('.activity-row');
  const isExpanded = wrapper.classList.contains('expanded');

  // Collapse currently expanded one if it's different
  if (!isExpanded && expandedAppName && expandedAppName !== appName) {
    const prevGroup = renderedRows[expandedAppName];
    if (prevGroup) {
      const prevWrapper = prevGroup.querySelector('.activities-details-wrapper');
      const prevRow = prevGroup.querySelector('.activity-row');
      if (prevWrapper && prevWrapper.classList.contains('expanded')) {
        prevWrapper.classList.remove('expanded');
        prevRow.classList.remove('expanded');
        prevRow.setAttribute('aria-expanded', 'false');
      }
    }
  }

  // Toggle this one
  if (isExpanded) {
    wrapper.classList.remove('expanded');
    row.classList.remove('expanded');
    row.setAttribute('aria-expanded', 'false');
    expandedAppName = null;
  } else {
    wrapper.classList.add('expanded');
    row.classList.add('expanded');
    row.setAttribute('aria-expanded', 'true');
    expandedAppName = appName;
  }
}

function renderActivities(contentEl, activities) {
  contentEl.innerHTML = '';
  
  if (!activities || activities.length === 0) {
    const emptyEl = document.createElement('div');
    emptyEl.className = 'activity-detail-empty';
    emptyEl.textContent = 'No activity details available.';
    contentEl.appendChild(emptyEl);
    return;
  }

  activities.forEach(act => {
    const detailRow = document.createElement('div');
    detailRow.className = 'activity-detail-row';

    const titleEl = document.createElement('span');
    titleEl.className = 'activity-title';
    const rawTitle = act.title;
    const titleText = (typeof rawTitle === 'string' && rawTitle.trim().length > 0)
      ? rawTitle.trim()
      : (act.appName || '(Untitled Activity)');
    titleEl.textContent = titleText;
    titleEl.title = (typeof rawTitle === 'string' && rawTitle.length > 0) ? rawTitle : titleText;
    titleEl.tabIndex = 0;
    titleEl.setAttribute('role', 'text');
    titleEl.setAttribute('aria-label', titleEl.title);

    const durationEl = document.createElement('span');
    durationEl.className = 'activity-duration';
    durationEl.textContent = formatActivityDuration(act.duration);

    detailRow.appendChild(titleEl);
    detailRow.appendChild(durationEl);
    contentEl.appendChild(detailRow);
  });
}

function updateArrowPosition(arrowLeft, isBelow) {
  if (!arrowEl) return;
  
  // Center the 16px wide arrow and adjust for the body's offset (10px padding of html)
  const adjustedLeft = arrowLeft - 18;
  arrowEl.style.left = `${adjustedLeft}px`;
  
  if (isBelow) {
    arrowEl.className = 'arrow arrow-up';
    arrowEl.style.top = '12px';
  } else {
    arrowEl.className = 'arrow arrow-down';
    arrowEl.style.top = '490px'; // Exactly touches container bottom edge
  }
}

function initiateCloseAnimation() {
  if (!popupContainer) return;
  
  popupContainer.classList.add('closing');
  popupContainer.addEventListener('animationend', function handler() {
    popupContainer.classList.remove('closing');
    popupContainer.removeEventListener('animationend', handler);
    
    // Call the close handler in main process
    if (window.api && typeof window.api.closeActivityPopup === 'function') {
      window.api.closeActivityPopup();
    }
  }, { once: true });
}

// ================= POLLING CONTROLLER =================
function startPolling() {
  stopPolling();
  fetchAndRender();
  pollInterval = setInterval(() => {
    // Only automatically poll live updates when on 'today' tab
    if (currentPeriod === 'today') {
      fetchAndRender();
    }
  }, 30000);
}

function stopPolling() {
  if (pollInterval) {
    clearInterval(pollInterval);
    pollInterval = null;
  }
}

let currentFetchSeq = 0;
let inFlightFetchPromises = {};

// ================= API FETCH & DATA PROCESSING =================
async function fetchAndRender() {
  if (typeof window === 'undefined' || !window || !window.api || typeof window.api.fetchActivityLogs !== 'function') return;

  const targetPeriod = currentPeriod;
  const seq = ++currentFetchSeq;

  // Show loading state if no rows have been rendered for this view yet
  const hasRows = (targetPeriod === 'today' || targetPeriod === 'yesterday')
    ? (currentActivityView === 'hours' ? Object.keys(renderedHourRows).length > 0 : Object.keys(renderedRows).length > 0)
    : (historyList && historyList.children.length > 0);

  if (!hasRows) {
    if (loadingText) {
      loadingText.textContent = (targetPeriod === 'today' ? 'Loading activity...' : 'Loading historical data...');
    }
    showState(loadingState);
  }

  try {
    let fetchPromise = inFlightFetchPromises[targetPeriod];
    if (!fetchPromise) {
      fetchPromise = window.api.fetchActivityLogs(targetPeriod);
      inFlightFetchPromises[targetPeriod] = fetchPromise;
    }

    const rawData = await fetchPromise;
    delete inFlightFetchPromises[targetPeriod];

    // Cache the resolved data for instant subsequent tab switches
    clientViewCache[targetPeriod] = rawData;

    // Guard against race conditions if user clicked another tab while awaiting
    if (seq !== currentFetchSeq || currentPeriod !== targetPeriod) return;

    if (targetPeriod === 'last7days' || targetPeriod === 'last30days' || targetPeriod === 'current_month') {
      renderHistoryView(rawData);
      return;
    }

    renderTodayYesterdayView(rawData);

  } catch (error) {
    delete inFlightFetchPromises[targetPeriod];
    if (seq !== currentFetchSeq || currentPeriod !== targetPeriod) return;
    console.error('Failed to load activity details:', error);
    // Only show full screen error state if we have no loaded data
    const hasData = Object.keys(renderedRows).length > 0 || Object.keys(renderedHourRows).length > 0 || (historyList && historyList.children.length > 0);
    if (!hasData) {
      showState(errorState);
    }
  }
}

function renderAppWiseView(rawData) {
  // Update subtitle date and start/end time for Today / Yesterday view
  updateDateSubtitleForAppView(rawData);
  updateViewToggleVisibility();
  updateColumnHeaders();

  // Hide history list and show activity list
  if (historyList) {
    historyList.classList.add('hidden');
    historyList.innerHTML = '';
  }

  let logsData = rawData;
  let iconsMap = {};
  if (rawData && rawData.logs) {
    logsData = rawData.logs;
    iconsMap = rawData.icons || {};
  }

  const logs = Array.isArray(logsData) ? logsData : (logsData?.entries || []);
  const isToday = (currentPeriod === 'today');

  const { sortedApps, totalDailySeconds, hasActivity } = computeAppWiseActivity(logs);

  if (!hasActivity || sortedApps.length === 0) {
    if (emptyMsg) {
      emptyMsg.textContent = isToday ? 'No activity recorded today.' : 'No activity recorded yesterday.';
    }
    showState(emptyState);
    if (totalTimeEl) {
      totalTimeEl.textContent = '0m';
    }

    for (const name in renderedRows) {
      if (renderedRows[name]) renderedRows[name].remove();
    }
    renderedRows = {};
    expandedAppName = null;
    return;
  }

  // Clear hourly rows if they exist
  for (const h in renderedHourRows) {
    if (renderedHourRows[h]) renderedHourRows[h].remove();
  }
  renderedHourRows = {};
  expandedHours = new Set();

  showState(activityList);

  // Render and reconcile app-wise rows
  reconcileRows(sortedApps, totalDailySeconds, iconsMap);

  if (totalTimeEl) {
    totalTimeEl.textContent = formatDuration(totalDailySeconds);
  }
  updateFooterLabel();
}

function renderHoursWiseView(rawData) {
  // Update subtitle date and start/end time for Today / Yesterday view
  updateDateSubtitleForAppView(rawData);
  updateViewToggleVisibility();
  updateColumnHeaders();

  // Hide history list and show activity list
  if (historyList) {
    historyList.classList.add('hidden');
    historyList.innerHTML = '';
  }

  let logsData = rawData;
  let iconsMap = {};
  if (rawData && rawData.logs) {
    logsData = rawData.logs;
    iconsMap = rawData.icons || {};
  }

  const logs = Array.isArray(logsData) ? logsData : (logsData?.entries || []);
  const isToday = (currentPeriod === 'today');
  const dayDateStr = rawData?.date || '';
  const startTimeStr = rawData?.startTime || null;
  const endTimeStr = rawData?.endTime || null;

  const { hourlySlots, totalDailySeconds, hasActivity } = computeHourlyActivity(
    logs,
    dayDateStr,
    isToday,
    new Date(),
    startTimeStr,
    endTimeStr
  );

  if (!hasActivity || hourlySlots.length === 0) {
    if (emptyMsg) {
      emptyMsg.textContent = isToday ? 'No activity recorded today.' : 'No activity recorded yesterday.';
    }
    showState(emptyState);
    if (totalTimeEl) {
      totalTimeEl.textContent = '0m';
    }

    // Clear any rendered rows
    for (const h in renderedHourRows) {
      if (renderedHourRows[h]) renderedHourRows[h].remove();
    }
    renderedHourRows = {};
    expandedHours = new Set();
    return;
  }

  // Clear app rows if they exist
  for (const name in renderedRows) {
    if (renderedRows[name]) renderedRows[name].remove();
  }
  renderedRows = {};
  expandedAppName = null;

  // Hide all states and show activity list
  showState(activityList);

  // Render and reconcile hourly rows
  reconcileHourlyRows(hourlySlots, iconsMap);

  // Calculate and show total active duration from existing activity logs
  if (totalTimeEl) {
    totalTimeEl.textContent = formatDuration(totalDailySeconds);
  }
  updateFooterLabel();
}

function renderTodayYesterdayView(rawData) {
  if (currentActivityView === 'hours') {
    renderHoursWiseView(rawData);
  } else {
    renderAppWiseView(rawData);
  }
}

function renderAppView(rawData) {
  renderTodayYesterdayView(rawData);
}

function renderHistoryView(rawData) {
  // Clear any rendered app rows
  for (const name in renderedRows) {
    renderedRows[name].remove();
  }
  renderedRows = {};
  expandedAppName = null;

  const allDays = rawData?.days || [];
  const days = showWeekends ? allDays : allDays.filter(day => !isWeekend(day.dateStr));

  const targetHistoryList = historyList || getEl('history-list');
  const targetTotalTimeEl = totalTimeEl || getEl('total-time');
  const targetEmptyMsg = emptyMsg || getEl('empty-msg');
  const targetEmptyState = emptyState || getEl('empty-state');

  if (!days || days.length === 0) {
    if (targetEmptyMsg) {
      targetEmptyMsg.textContent = 'No activity recorded.';
    }
    showState(targetEmptyState);
    if (targetTotalTimeEl) {
      targetTotalTimeEl.innerHTML = `
        <div class="history-dual-totals">
          <div class="history-total-item" title="System Active Time (excluding Special Hours)">
            <span class="history-total-dot dot-system">●</span>
            <span class="history-total-label">System:</span>
            <span class="history-total-val history-total-val-system">0m</span>
          </div>
          <span class="history-total-divider">|</span>
          <div class="history-total-item" title="Redmine Total Hours">
            <span class="history-total-dot dot-redmine">●</span>
            <span class="history-total-label">Redmine:</span>
            <span class="history-total-val history-total-val-redmine">0h</span>
          </div>
        </div>
      `.trim();
    }
    updateFooterLabel();
    return;
  }

  showState(targetHistoryList);
  if (targetHistoryList) {
    targetHistoryList.innerHTML = '';
    targetHistoryList.scrollTop = 0;
  }

  days.forEach((day, index) => {
    const rowEl = document.createElement('div');
    rowEl.className = 'history-row';
    rowEl.style.animation = 'rowFadeIn 250ms ease forwards';
    rowEl.style.animationDelay = `${Math.min(index * 30, 300)}ms`;

    const totalDuration = Number(day.duration) || 0;
    const regularDuration = day.regularDuration !== undefined ? Number(day.regularDuration) : totalDuration;
    let yellowDuration = day.yellowDuration !== undefined ? Number(day.yellowDuration) : 0;
    if (yellowDuration === 0) {
      if (day.targetDuration !== undefined) {
        yellowDuration = Number(day.targetDuration) || 0;
      } else if (day.targetMinutes !== undefined) {
        yellowDuration = (Number(day.targetMinutes) || 0) * 60;
      } else if (day.targetHours !== undefined) {
        yellowDuration = (Number(day.targetHours) || 0) * 3600;
      }
    }

    // Determine actual daily Redmine logged duration
    let redmineDuration = 0;
    if (day.redmineDuration !== undefined && Number(day.redmineDuration) > 0) {
      redmineDuration = Number(day.redmineDuration);
    } else if (day.redmineTotalSeconds !== undefined && Number(day.redmineTotalSeconds) > 0) {
      redmineDuration = Number(day.redmineTotalSeconds);
    } else if (day.redmineWorkingSeconds !== undefined && Number(day.redmineWorkingSeconds) > 0) {
      redmineDuration = Number(day.redmineWorkingSeconds) + yellowDuration;
    } else if (yellowDuration > 0) {
      redmineDuration = yellowDuration;
    }

    const { regularPercentage, yellowPercentage } = calculateDailyProgressPercentages(regularDuration, redmineDuration);
    const formattedDuration = totalDuration > 0 ? formatDuration(totalDuration) : '0m';

    // Left column: Calendar icon
    const iconContainer = document.createElement('div');
    iconContainer.className = 'history-calendar-icon';
    iconContainer.innerHTML = `
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <rect x="3" y="4" width="18" height="18" rx="2" ry="2"/>
        <line x1="16" y1="2" x2="16" y2="6"/>
        <line x1="8" y1="2" x2="8" y2="6"/>
        <line x1="3" y1="10" x2="21" y2="10"/>
      </svg>
    `;

    const dateInfo = document.createElement('div');
    dateInfo.className = 'history-date-info';

    const dateHeader = document.createElement('div');
    dateHeader.className = 'history-date-header';

    const dateText = document.createElement('span');
    dateText.className = 'history-date-text' + (day.isToday ? ' is-today' : '');
    const rawDateDisplay = day.weekdayDisplay || day.displayDate || day.dateStr || 'Unknown Date';
    const dateDisplay = typeof rawDateDisplay === 'string' ? rawDateDisplay.replace(',', '') : rawDateDisplay;
    dateText.textContent = dateDisplay;
    dateText.title = dateDisplay;
    dateText.tabIndex = 0;
    dateText.setAttribute('role', 'text');
    dateText.setAttribute('aria-label', dateDisplay);

    dateHeader.appendChild(dateText);

    if (day.isToday) {
      const todayBadge = document.createElement('span');
      todayBadge.className = 'history-today-badge';
      todayBadge.textContent = 'TODAY';
      dateHeader.appendChild(todayBadge);
    }

    if (day.startTime && day.startTime !== '--' && day.endTime && day.endTime !== '--') {
      const sessionTimeEl = document.createElement('span');
      sessionTimeEl.className = 'history-session-time';
      sessionTimeEl.textContent = `${day.startTime} — ${day.endTime}`;
      dateHeader.appendChild(sessionTimeEl);
    }

    dateInfo.appendChild(dateHeader);

    // Progress bar row: stacked vertical column of tracks + right duration
    // System Activity status colors (<7h: Red, 7h01m-7h29m: Yellow, 7h00m/7h30m: Blue, >7h30m: Green)
    const color = getDailyActiveTimeColor(totalDuration);

    const barRow = document.createElement('div');
    barRow.className = 'history-bar-row';

    const trackWrapper = document.createElement('div');
    trackWrapper.className = 'history-track-wrapper';

    // Track 1: Regular progress bar (workstation active time) - strictly unmodified
    const regTrack = document.createElement('div');
    regTrack.className = 'history-progress-container history-track-regular';
    const progressBar = document.createElement('div');
    progressBar.className = `history-progress-bar history-segment-regular color-${color} progress-${color}`;
    progressBar.dataset.color = color;
    progressBar.style.width = '0%';
    progressBar.style.cursor = 'pointer';
    progressBar.title = `System Activity: ${formatShortHours(regularDuration / 3600)}`;
    regTrack.appendChild(progressBar);

    trackWrapper.appendChild(regTrack);

    // Track 2: Redmine API Working Hours (Neon Green #00E676) / Category Segments - ALWAYS visible
    const yelTrack = document.createElement('div');
    yelTrack.className = 'history-progress-container history-track-yellow history-track-redmine';
    yelTrack.style.display = 'flex';
    yelTrack.style.overflow = 'hidden';
    yelTrack.style.borderRadius = '2px';

    let yellowBar = null;
    const rawCategories = (Array.isArray(day.redmineCategories) && day.redmineCategories.length > 0)
      ? day.redmineCategories
      : null;

    // Ensure Working (regular active hours) renders FIRST, extra/special hours render at the END
    const categories = rawCategories ? [...rawCategories].sort((a, b) => {
      if (a.name === 'Working' && b.name !== 'Working') return -1;
      if (b.name === 'Working' && a.name !== 'Working') return 1;
      return 0;
    }) : null;

    if (categories && categories.length > 1) {
      categories.forEach((cat, cIdx) => {
        const seg = document.createElement('div');
        const segColor = cat.color || REDMINE_CATEGORY_COLORS[cat.name] || '#00E676';
        const isYellow = cat.name !== 'Working';
        seg.className = `history-progress-bar-yellow history-segment-working${isYellow ? ' history-segment-yellow' : ''} cat-${cIdx}`;
        seg.dataset.color = (cat.name === 'Working' ? 'working' : 'yellow');
        seg.dataset.category = cat.name;
        seg.style.backgroundColor = segColor;
        seg.style.height = '100%';
        seg.style.flexShrink = '0';
        seg.style.cursor = 'pointer';
        const catSeconds = Number(cat.seconds) || (Number(cat.hours) * 3600) || 0;
        const segPct = Math.min(100, Math.max(0, (catSeconds / DAILY_REFERENCE_SECONDS) * 100));
        seg.style.width = '0%';
        seg.title = `${cat.name}: ${formatShortHours(catSeconds / 3600)}`;
        yelTrack.appendChild(seg);
        if (!yellowBar) yellowBar = seg;
        setTimeout(() => {
          seg.style.width = `${segPct}%`;
        }, 50);
      });
    } else {
      let barColor = '#00E676'; // Neon Green default for Working
      let catName = 'Working';
      if (categories && categories.length === 1) {
        barColor = categories[0].color || REDMINE_CATEGORY_COLORS[categories[0].name] || '#00E676';
        catName = categories[0].name || 'Working';
      } else if (Array.isArray(day.yellowCategories) && day.yellowCategories.length > 0) {
        catName = day.yellowCategories[0].name || 'Working';
        barColor = REDMINE_CATEGORY_COLORS[catName] || '#00E676';
      }

      const isYellowCat = (redmineDuration > 0 || yellowDuration > 0);
      yellowBar = document.createElement('div');
      yellowBar.className = 'history-progress-bar-yellow history-segment-working' + (isYellowCat ? ' history-segment-yellow' : '') + (redmineDuration === 0 ? ' zero' : '');
      yellowBar.dataset.color = (catName === 'Working' ? 'working' : 'yellow');
      yellowBar.dataset.category = catName;
      yellowBar.style.backgroundColor = barColor;
      yellowBar.style.width = '0%';
      yellowBar.style.height = '100%';
      yellowBar.style.borderRadius = '2px';
      yellowBar.style.flexShrink = '0';
      yellowBar.style.cursor = 'pointer';
      yellowBar.title = `${catName}: ${formatShortHours(redmineDuration / 3600)}`;
      yelTrack.appendChild(yellowBar);

      if (redmineDuration > 0) {
        setTimeout(() => {
          yellowBar.style.width = `${yellowPercentage}%`;
        }, 50);
      }
    }

    trackWrapper.appendChild(yelTrack);
    barRow.appendChild(trackWrapper);

    // Right column: Separate durations for each progress bar (always 2 bars layout)
    const durationCol = document.createElement('div');
    durationCol.className = 'history-duration-col has-two-bars';

    const regDurationEl = document.createElement('div');
    regDurationEl.className = 'history-duration history-duration-regular' + (regularDuration === 0 ? ' zero' : '');
    regDurationEl.textContent = regularDuration > 0 ? formatShortHours(regularDuration / 3600) : '0m';
    durationCol.appendChild(regDurationEl);

    const redmineDurationEl = document.createElement('div');
    redmineDurationEl.className = 'history-duration history-duration-yellow history-duration-working' + (redmineDuration === 0 ? ' zero' : '');
    redmineDurationEl.textContent = redmineDuration > 0 ? formatShortHours(redmineDuration / 3600) : '0h';
    durationCol.appendChild(redmineDurationEl);

    barRow.appendChild(durationCol);

    dateInfo.appendChild(barRow);

    rowEl.appendChild(iconContainer);
    rowEl.appendChild(dateInfo);

    if (targetHistoryList) {
      targetHistoryList.appendChild(rowEl);
    }

    setTimeout(() => {
      progressBar.style.width = `${regularPercentage}%`;
    }, 50);
  });

  const targetDays = days;
  const systemTotalSeconds = targetDays.reduce((sum, d) => {
    if (d.regularDuration !== undefined) return sum + (Number(d.regularDuration) || 0);
    if (d.activeSeconds !== undefined) return sum + (Number(d.activeSeconds) || 0);
    return sum + (Number(d.duration) || 0);
  }, 0);

  const redmineTotalSeconds = targetDays.reduce((sum, d) => {
    let rSec = 0;
    if (d.redmineTotalSeconds !== undefined && Number(d.redmineTotalSeconds) > 0) {
      rSec = Number(d.redmineTotalSeconds);
    } else if (d.redmineDuration !== undefined && Number(d.redmineDuration) > 0) {
      rSec = Number(d.redmineDuration);
    } else if (d.redmineWorkingSeconds !== undefined && Number(d.redmineWorkingSeconds) > 0) {
      const yel = Number(d.yellowDuration) || 0;
      rSec = Number(d.redmineWorkingSeconds) + yel;
    } else if (d.yellowDuration !== undefined && Number(d.yellowDuration) > 0) {
      rSec = Number(d.yellowDuration);
    }
    return sum + rSec;
  }, 0);

  if (targetTotalTimeEl) {
    targetTotalTimeEl.innerHTML = `
      <div class="history-dual-totals">
        <div class="history-total-item" title="System Active Time (excluding Special Hours)">
          <span class="history-total-dot dot-system">●</span>
          <span class="history-total-label">System:</span>
          <span class="history-total-val history-total-val-system">${formatDuration(systemTotalSeconds)}</span>
        </div>
        <span class="history-total-divider">|</span>
        <div class="history-total-item" title="Redmine Total Hours">
          <span class="history-total-dot dot-redmine">●</span>
          <span class="history-total-label">Redmine:</span>
          <span class="history-total-val history-total-val-redmine">${formatDuration(redmineTotalSeconds)}</span>
        </div>
      </div>
    `.trim();
  }
  updateFooterLabel();
}

function showState(visibleElement) {
  const elements = [
    loadingState || getEl('loading-state'),
    errorState || getEl('error-state'),
    emptyState || getEl('empty-state'),
    activityList || getEl('activity-list'),
    historyList || getEl('history-list')
  ];
  elements.forEach(el => {
    if (el) el.classList.add('hidden');
  });
  if (visibleElement) {
    visibleElement.classList.remove('hidden');
  }
}

// ================= DOM RECONCILIATION =================
function reconcileHourlyRows(hourlySlots, iconsMap) {
  if (!activityList) return;

  const currentHours = new Set(hourlySlots.map(slot => String(slot.hour)));

  // 1. Remove stale rows
  for (const hStr in renderedHourRows) {
    if (!currentHours.has(hStr)) {
      if (renderedHourRows[hStr]) renderedHourRows[hStr].remove();
      delete renderedHourRows[hStr];
    }
  }

  // 2. Add or update hourly rows
  hourlySlots.forEach((slot, index) => {
    const { hour, timeRange, totalDuration, appList, windowList } = slot;
    const hStr = String(hour);
    const formattedDuration = formatDuration(totalDuration);
    const isExpanded = expandedHours.has(hour);
    const apps = Array.isArray(appList) ? appList : [];
    const windows = Array.isArray(windowList) ? windowList : [];

    let groupEl = renderedHourRows[hStr];

    if (!groupEl) {
      groupEl = document.createElement('div');
      groupEl.className = 'hourly-group';
      groupEl.dataset.hour = hStr;
      groupEl.style.animation = 'rowFadeIn 250ms ease forwards';
      groupEl.style.animationDelay = `${Math.min(index * 30, 300)}ms`;

      const rowEl = document.createElement('div');
      rowEl.className = 'hourly-row' + (isExpanded ? ' expanded' : '');
      rowEl.tabIndex = 0;
      rowEl.setAttribute('role', 'button');
      rowEl.setAttribute('aria-expanded', isExpanded ? 'true' : 'false');
      rowEl.setAttribute('aria-label', `Toggle ${timeRange} activity`);

      // Chevron
      const chevronContainer = document.createElement('div');
      chevronContainer.className = 'hourly-chevron-container';
      chevronContainer.innerHTML = `
        <svg class="hourly-chevron-icon" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
          <path d="M8.59 16.59L13.17 12 8.59 7.41 10 6l6 6-6 6-1.41-1.41z" fill="currentColor"/>
        </svg>
      `;
      rowEl.appendChild(chevronContainer);

      // Hour range
      const timeRangeEl = document.createElement('div');
      timeRangeEl.className = 'hourly-time-range';
      timeRangeEl.textContent = timeRange;
      timeRangeEl.title = timeRange;
      timeRangeEl.tabIndex = 0;
      timeRangeEl.setAttribute('role', 'text');
      timeRangeEl.setAttribute('aria-label', timeRange);
      rowEl.appendChild(timeRangeEl);

      // Center Column (Segmented Bar + App Pills Stack)
      const centerCol = document.createElement('div');
      centerCol.className = 'hourly-center-col';

      const progressContainer = document.createElement('div');
      progressContainer.className = 'hourly-progress-container';

      // Keep hidden .hourly-progress-bar for backward compatibility
      const progressBar = document.createElement('div');
      progressBar.className = 'hourly-progress-bar';
      progressBar.style.display = 'none';
      progressContainer.appendChild(progressBar);

      // Render segmented bar for applications in this hour
      apps.forEach(app => {
        const segEl = document.createElement('div');
        segEl.className = 'hourly-segment';
        segEl.style.width = '0%';
        segEl.style.backgroundColor = getAppColor(app.name);
        segEl.title = `${app.name}: ${formatDuration(app.duration)}`;
        progressContainer.appendChild(segEl);
      });
      centerCol.appendChild(progressContainer);

      // Render mini app pills directly below progress bar
      const pillsContainer = document.createElement('div');
      pillsContainer.className = 'hourly-app-pills';

      const maxPills = 3;
      const topApps = apps.slice(0, maxPills);
      const remainingApps = apps.slice(maxPills);

      topApps.forEach(app => {
        const pillItem = document.createElement('div');
        pillItem.className = 'hourly-pill-item';
        pillItem.title = `${app.name}: ${formatDuration(app.duration)}`;

        const pillIcon = document.createElement('span');
        pillIcon.className = 'hourly-pill-icon';
        const lowerName = app.name.toLowerCase();
        if (iconsMap && iconsMap[lowerName]) {
          const img = document.createElement('img');
          img.className = 'app-img-icon';
          img.src = iconsMap[lowerName];
          pillIcon.appendChild(img);
        } else {
          pillIcon.innerHTML = getWindowIconSvg(app.name, app.name);
        }
        pillItem.appendChild(pillIcon);

        const pillTime = document.createElement('span');
        pillTime.className = 'hourly-pill-time';
        pillTime.textContent = formatDuration(app.duration);
        pillItem.appendChild(pillTime);

        pillsContainer.appendChild(pillItem);
      });

      if (remainingApps.length > 0) {
        const moreCount = remainingApps.length;
        const moreDur = remainingApps.reduce((sum, a) => sum + a.duration, 0);
        const morePill = document.createElement('div');
        morePill.className = 'hourly-pill-more';
        morePill.textContent = `+${moreCount} app${moreCount > 1 ? 's' : ''} ${formatDuration(moreDur)}`;
        pillsContainer.appendChild(morePill);
      }
      centerCol.appendChild(pillsContainer);
      rowEl.appendChild(centerCol);

      // Total Duration
      const durationEl = document.createElement('div');
      durationEl.className = 'hourly-duration' + (totalDuration === 0 ? ' zero' : '');
      durationEl.textContent = formattedDuration;
      rowEl.appendChild(durationEl);

      // Details Wrapper
      const detailsWrapper = document.createElement('div');
      detailsWrapper.className = 'hourly-details-wrapper' + (isExpanded ? ' expanded' : '');

      const detailsContent = document.createElement('div');
      detailsContent.className = 'hourly-details-content';
      detailsWrapper.appendChild(detailsContent);

      groupEl.appendChild(rowEl);
      groupEl.appendChild(detailsWrapper);

      // Render the website / window table inside expanded row
      renderHourlyWindows(detailsContent, windows, totalDuration, iconsMap);

      const toggleHandler = () => {
        toggleHourExpansion(hour, groupEl);
      };

      rowEl.addEventListener('click', toggleHandler);
      rowEl.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          toggleHandler();
        }
      });

      activityList.appendChild(groupEl);
      renderedHourRows[hStr] = groupEl;

      // Animate segments
      setTimeout(() => {
        const segEls = progressContainer.querySelectorAll('.hourly-segment');
        segEls.forEach((segEl, i) => {
          if (apps[i]) {
            const segPct = Math.min(100, (apps[i].duration / 3600) * 100);
            segEl.style.width = `${segPct}%`;
          }
        });
      }, 50);

    } else {
      if (activityList.children[index] !== groupEl) {
        activityList.insertBefore(groupEl, activityList.children[index]);
      }

      const durationEl = groupEl.querySelector('.hourly-duration');
      if (durationEl) {
        durationEl.textContent = formattedDuration;
        durationEl.className = 'hourly-duration' + (totalDuration === 0 ? ' zero' : '');
      }

      // Update segmented bar
      const centerCol = groupEl.querySelector('.hourly-center-col');
      if (centerCol) {
        const progressContainer = centerCol.querySelector('.hourly-progress-container');
        if (progressContainer) {
          progressContainer.innerHTML = '';
          const progressBar = document.createElement('div');
          progressBar.className = 'hourly-progress-bar';
          progressBar.style.display = 'none';
          progressContainer.appendChild(progressBar);

          apps.forEach(app => {
            const segEl = document.createElement('div');
            segEl.className = 'hourly-segment';
            const segPct = Math.min(100, (app.duration / 3600) * 100);
            segEl.style.width = `${segPct}%`;
            segEl.style.backgroundColor = getAppColor(app.name);
            segEl.title = `${app.name}: ${formatDuration(app.duration)}`;
            progressContainer.appendChild(segEl);
          });
        }

        const pillsContainer = centerCol.querySelector('.hourly-app-pills');
        if (pillsContainer) {
          pillsContainer.innerHTML = '';
          const maxPills = 3;
          const topApps = apps.slice(0, maxPills);
          const remainingApps = apps.slice(maxPills);

          topApps.forEach(app => {
            const pillItem = document.createElement('div');
            pillItem.className = 'hourly-pill-item';
            pillItem.title = `${app.name}: ${formatDuration(app.duration)}`;

            const pillIcon = document.createElement('span');
            pillIcon.className = 'hourly-pill-icon';
            const lowerName = app.name.toLowerCase();
            if (iconsMap && iconsMap[lowerName]) {
              const img = document.createElement('img');
              img.className = 'app-img-icon';
              img.src = iconsMap[lowerName];
              pillIcon.appendChild(img);
            } else {
              pillIcon.innerHTML = getWindowIconSvg(app.name, app.name);
            }
            pillItem.appendChild(pillIcon);

            const pillTime = document.createElement('span');
            pillTime.className = 'hourly-pill-time';
            pillTime.textContent = formatDuration(app.duration);
            pillItem.appendChild(pillTime);

            pillsContainer.appendChild(pillItem);
          });

          if (remainingApps.length > 0) {
            const moreCount = remainingApps.length;
            const moreDur = remainingApps.reduce((sum, a) => sum + a.duration, 0);
            const morePill = document.createElement('div');
            morePill.className = 'hourly-pill-more';
            morePill.textContent = `+${moreCount} app${moreCount > 1 ? 's' : ''} ${formatDuration(moreDur)}`;
            pillsContainer.appendChild(morePill);
          }
        }
      }

      const detailsContent = groupEl.querySelector('.hourly-details-content');
      if (detailsContent) {
        renderHourlyWindows(detailsContent, windows, totalDuration, iconsMap);
      }
    }
  });
}

function toggleHourExpansion(hour, groupEl) {
  const wrapper = groupEl.querySelector('.hourly-details-wrapper');
  const row = groupEl.querySelector('.hourly-row');
  if (!wrapper || !row) return;
  const isExpanded = wrapper.classList.contains('expanded');

  if (isExpanded) {
    wrapper.classList.remove('expanded');
    row.classList.remove('expanded');
    row.setAttribute('aria-expanded', 'false');
    expandedHours.delete(hour);
  } else {
    wrapper.classList.add('expanded');
    row.classList.add('expanded');
    row.setAttribute('aria-expanded', 'true');
    expandedHours.add(hour);
  }
}

/**
 * Renders website / window activity table directly inside expanded hourly row.
 * Includes WINDOW / WEBSITE and ACTIVE TIME headers, favicon/icon, progress bar, and duration.
 */
function renderHourlyWindows(containerEl, windowList, hourlyTotalDuration, iconsMap) {
  containerEl.innerHTML = '';

  const tableCard = document.createElement('div');
  tableCard.className = 'hourly-table-card';

  // Table Header
  const headerEl = document.createElement('div');
  headerEl.className = 'hourly-table-header';
  headerEl.innerHTML = `
    <span class="table-col-name">WINDOW / WEBSITE</span>
    <span class="table-col-time">ACTIVE TIME</span>
  `;
  tableCard.appendChild(headerEl);

  const bodyEl = document.createElement('div');
  bodyEl.className = 'hourly-table-body';

  const windows = Array.isArray(windowList) ? windowList : [];

  if (windows.length === 0) {
    const emptyEl = document.createElement('div');
    emptyEl.className = 'hourly-empty-message';
    emptyEl.textContent = 'No activity recorded for this hour';
    bodyEl.appendChild(emptyEl);
    tableCard.appendChild(bodyEl);
    containerEl.appendChild(tableCard);
    return;
  }

  // Find max duration in this hour for relative progress scaling
  const maxWinDuration = windows[0]?.duration || 1;

  windows.forEach((win, idx) => {
    const rowEl = document.createElement('div');
    rowEl.className = 'hourly-window-row';

    // Left Column: Website / Window icon + Title
    const titleCol = document.createElement('div');
    titleCol.className = 'window-title-col';
    titleCol.title = win.rawTitle || win.displayTitle;

    const iconEl = document.createElement('span');
    iconEl.className = 'window-icon';
    iconEl.innerHTML = getWindowIconSvg(win.displayTitle, win.appName);
    titleCol.appendChild(iconEl);

    const titleTextEl = document.createElement('span');
    titleTextEl.className = 'window-title-text';
    titleTextEl.textContent = win.displayTitle;
    titleTextEl.tabIndex = 0;
    titleTextEl.setAttribute('role', 'text');
    titleTextEl.setAttribute('aria-label', win.rawTitle || win.displayTitle);
    titleCol.appendChild(titleTextEl);

    rowEl.appendChild(titleCol);

    // Center Column: Light blue progress bar
    const progressContainer = document.createElement('div');
    progressContainer.className = 'window-progress-container';

    const progressFill = document.createElement('div');
    progressFill.className = 'window-progress-fill';
    const pct = maxWinDuration > 0
      ? Math.max(3, Math.min(100, Math.round((win.duration / maxWinDuration) * 72)))
      : 0;
    progressFill.style.width = '0%';
    progressContainer.appendChild(progressFill);
    rowEl.appendChild(progressContainer);

    // Right Column: Duration
    const durationEl = document.createElement('div');
    durationEl.className = 'window-duration';
    durationEl.textContent = formatDuration(win.duration);
    rowEl.appendChild(durationEl);

    bodyEl.appendChild(rowEl);

    setTimeout(() => {
      progressFill.style.width = `${pct}%`;
    }, 40 + idx * 20);
  });

  tableCard.appendChild(bodyEl);
  containerEl.appendChild(tableCard);
}

// Preserved for backward-compatibility with tests
function renderHourlyApps(containerEl, appList, hourlyTotalDuration, iconsMap) {
  containerEl.innerHTML = '';

  if (!appList || appList.length === 0) {
    const emptyEl = document.createElement('div');
    emptyEl.className = 'hourly-empty-message';
    emptyEl.textContent = 'No activity recorded';
    containerEl.appendChild(emptyEl);
    return;
  }

  appList.forEach(app => {
    const appRow = document.createElement('div');
    appRow.className = 'hourly-app-row';

    const iconContainer = document.createElement('div');
    iconContainer.className = 'hourly-app-icon-container';
    const lowerName = app.name.toLowerCase();
    if (iconsMap && iconsMap[lowerName]) {
      const img = document.createElement('img');
      img.className = 'app-img-icon';
      img.src = iconsMap[lowerName];
      iconContainer.appendChild(img);
    } else {
      iconContainer.innerHTML = getAppIconSvg(app.name);
    }
    appRow.appendChild(iconContainer);

    const nameEl = document.createElement('div');
    nameEl.className = 'hourly-app-name';
    nameEl.textContent = app.name;
    nameEl.title = app.name;
    nameEl.tabIndex = 0;
    nameEl.setAttribute('role', 'text');
    nameEl.setAttribute('aria-label', app.name);
    appRow.appendChild(nameEl);

    const progContainer = document.createElement('div');
    progContainer.className = 'hourly-app-progress-container';
    const progBar = document.createElement('div');
    progBar.className = 'hourly-app-progress-bar';
    progBar.style.backgroundColor = getAppColor(app.name);
    const pct = hourlyTotalDuration > 0
      ? Math.min(100, Math.round((app.duration / hourlyTotalDuration) * 100))
      : 0;
    progBar.style.width = '0%';
    progContainer.appendChild(progBar);
    appRow.appendChild(progContainer);

    const durationEl = document.createElement('div');
    durationEl.className = 'hourly-app-duration';
    durationEl.textContent = formatDuration(app.duration);
    appRow.appendChild(durationEl);

    containerEl.appendChild(appRow);

    setTimeout(() => {
      progBar.style.width = `${pct}%`;
    }, 40);
  });
}

// Application-wise reconciler for App-Wise view
function reconcileRows(sortedApps, totalDailySeconds, iconsMap) {
  const currentAppNames = new Set(sortedApps.map(app => app.name));
  
  // 1. Remove stale rows
  for (const appName in renderedRows) {
    if (!currentAppNames.has(appName)) {
      renderedRows[appName].remove();
      delete renderedRows[appName];
      if (expandedAppName === appName) {
        expandedAppName = null;
      }
    }
  }

  // 2. Add or update active rows
  sortedApps.forEach((app, index) => {
    const { name, duration, activities } = app;
    // Calculate application's share of total tracked activity
    const percentage = totalDailySeconds > 0 ? (duration / totalDailySeconds) * 100 : 0;
    const formattedDuration = formatDuration(duration);
    const lowerName = name.toLowerCase();
    
    let groupEl = renderedRows[name];
    
    if (!groupEl) {
      // Create new group element
      groupEl = document.createElement('div');
      groupEl.className = 'activity-group';
      groupEl.dataset.appName = name;
      
      // Smooth fade-in staggers
      groupEl.style.animation = 'rowFadeIn 250ms ease forwards';
      groupEl.style.animationDelay = `${Math.min(index * 40, 400)}ms`;

      // Create row element (the clickable app header)
      const rowEl = document.createElement('div');
      rowEl.className = 'activity-row';
      rowEl.tabIndex = 0;
      rowEl.setAttribute('role', 'button');
      rowEl.setAttribute('aria-expanded', 'false');
      rowEl.setAttribute('aria-label', `Toggle ${name} activities`);

      // Add Chevron container and SVG
      const chevronContainer = document.createElement('div');
      chevronContainer.className = 'chevron-container';
      chevronContainer.innerHTML = `
        <svg class="chevron-icon" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
          <path d="M8.59 16.59L13.17 12 8.59 7.41 10 6l6 6-6 6-1.41-1.41z" fill="currentColor"/>
        </svg>
      `;
      rowEl.appendChild(chevronContainer);

      // Icon Column
      const iconEl = document.createElement('div');
      iconEl.className = 'app-icon-container';
      if (iconsMap && iconsMap[lowerName]) {
        const img = document.createElement('img');
        img.className = 'app-img-icon';
        img.src = iconsMap[lowerName];
        iconEl.appendChild(img);
      } else {
        iconEl.innerHTML = getAppIconSvg(name);
      }
      rowEl.appendChild(iconEl);

      // Details Column (Name & Progress Bar)
      const detailsEl = document.createElement('div');
      detailsEl.className = 'app-details';

      const nameEl = document.createElement('div');
      nameEl.className = 'app-name';
      const displayName = (name && name.trim()) ? name.trim() : 'Unknown Application';
      nameEl.textContent = displayName;
      nameEl.title = name || 'Unknown Application';
      nameEl.tabIndex = 0;
      nameEl.setAttribute('role', 'text');
      nameEl.setAttribute('aria-label', name || 'Unknown Application');

      const progressContainer = document.createElement('div');
      progressContainer.className = 'progress-container';

      const progressBar = document.createElement('div');
      progressBar.className = 'progress-bar';
      progressBar.style.backgroundColor = getAppColor(name);
      progressBar.style.width = '0%'; // Initial width for animation trigger
      
      progressContainer.appendChild(progressBar);
      detailsEl.appendChild(nameEl);
      detailsEl.appendChild(progressContainer);
      rowEl.appendChild(detailsEl);

      // Duration Column
      const durationEl = document.createElement('div');
      durationEl.className = 'app-duration';
      durationEl.textContent = formattedDuration;
      rowEl.appendChild(durationEl);

      // Activities Details Container (Wrapper and Content)
      const detailsWrapper = document.createElement('div');
      detailsWrapper.className = 'activities-details-wrapper';
      
      const detailsContent = document.createElement('div');
      detailsContent.className = 'activities-details-content';
      
      detailsWrapper.appendChild(detailsContent);
      
      groupEl.appendChild(rowEl);
      groupEl.appendChild(detailsWrapper);

      // Render the child activities list
      renderActivities(detailsContent, activities);

      // Register Click and Keyboard handlers
      const toggleHandler = () => {
        toggleAppExpansion(name, groupEl);
      };
      
      rowEl.addEventListener('click', toggleHandler);
      rowEl.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          toggleHandler();
        }
      });

      activityList.appendChild(groupEl);
      renderedRows[name] = groupEl;
      
      // Animate the progress bar width from 0% to target width
      setTimeout(() => {
        progressBar.style.width = `${percentage}%`;
      }, 50);

    } else {
      // Update existing row
      // Re-order if position changed
      if (activityList.children[index] !== groupEl) {
        activityList.insertBefore(groupEl, activityList.children[index]);
      }
      
      // Update duration text
      const durationEl = groupEl.querySelector('.app-duration');
      if (durationEl && durationEl.textContent !== formattedDuration) {
        durationEl.textContent = formattedDuration;
      }

      // Update application name and tooltip if needed
      const nameEl = groupEl.querySelector('.app-name');
      if (nameEl) {
        const displayName = (name && name.trim()) ? name.trim() : 'Unknown Application';
        if (nameEl.textContent !== displayName) {
          nameEl.textContent = displayName;
        }
        const fullTitle = name || 'Unknown Application';
        if (nameEl.title !== fullTitle) {
          nameEl.title = fullTitle;
          nameEl.setAttribute('aria-label', fullTitle);
        }
      }

      // Update progress bar width
      const progressBar = groupEl.querySelector('.progress-bar');
      if (progressBar) {
        progressBar.style.width = `${percentage}%`;
      }

      // Update icon if it wasn't rendered as an image before but now has one
      const iconEl = groupEl.querySelector('.app-icon-container');
      if (iconEl) {
        const hasImg = iconEl.querySelector('.app-img-icon');
        if (iconsMap && iconsMap[lowerName] && !hasImg) {
          iconEl.innerHTML = '';
          const img = document.createElement('img');
          img.className = 'app-img-icon';
          img.src = iconsMap[lowerName];
          iconEl.appendChild(img);
        }
      }

      // Update the child activities list dynamically
      const detailsContent = groupEl.querySelector('.activities-details-content');
      if (detailsContent) {
        renderActivities(detailsContent, activities);
      }
    }
  });
}

// ================= THEME AND VISUALS =================
function getAppColor(appName) {
  const name = (appName || '').toLowerCase();
  if (name.includes('code') || name.includes('vscode') || name.includes('antigravity')) return '#38bdf8'; // Sky Blue
  if (name.includes('chrome')) return '#fb923c'; // Warm Orange
  if (name.includes('teams')) return '#a855f7'; // Teams Purple
  if (name.includes('edge') || name.includes('msedge')) return '#34d399'; // Mint Green
  if (name.includes('word') || name.includes('winword')) return '#2563eb'; // Word Blue
  if (name.includes('excel')) return '#10b981'; // Excel Green
  if (name.includes('slack')) return '#ec4899'; // Slack Magenta
  if (name.includes('spotify')) return '#22c55e'; // Spotify Green
  if (name.includes('notepad')) return '#eab308'; // Notepad Yellow
  if (name.includes('firefox')) return '#f97316'; // Firefox Orange
  if (name.includes('terminal') || name.includes('cmd') || name.includes('powershell')) return '#10b981'; // Terminal Green
  return '#64748b'; // Fallback Slate Gray
}

function getWindowIconSvg(title = '', appName = '') {
  const t = (title || '').toLowerCase();
  const a = (appName || '').toLowerCase();

  // 1. Google Docs
  if (t.includes('docs.google.com') || t.includes('google docs')) {
    return `
      <svg class="window-svg-icon" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
        <rect x="3" y="2" width="18" height="20" rx="3" fill="#4285F4"/>
        <path d="M7 8h10M7 12h10M7 16h6" stroke="#FFFFFF" stroke-width="2" stroke-linecap="round"/>
      </svg>
    `;
  }

  // 2. YouTube
  if (t.includes('youtube.com') || t.includes('youtube')) {
    return `
      <svg class="window-svg-icon" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
        <rect x="2" y="4" width="20" height="16" rx="4" fill="#FF0000"/>
        <polygon points="10,8 16,12 10,16" fill="#FFFFFF"/>
      </svg>
    `;
  }

  // 3. Notion
  if (t.includes('notion.so') || t.includes('notion')) {
    return `
      <svg class="window-svg-icon" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
        <rect x="2" y="2" width="20" height="20" rx="4" fill="#18181B" stroke="rgba(255,255,255,0.2)"/>
        <path d="M7 6v12l4-2V6L7 6zm5 0v9l5-9v12h-3V9l-2 4.5V6h0z" fill="#FFFFFF"/>
      </svg>
    `;
  }

  // 4. Gmail
  if (t.includes('mail.google.com') || t.includes('gmail')) {
    return `
      <svg class="window-svg-icon" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path d="M4 6v12a2 2 0 0 0 2 2h2V10l4 3 4-3v10h2a2 2 0 0 0 2-2V6a2 2 0 0 0-3.2-1.6L12 9 7.2 4.4A2 2 0 0 0 4 6z" fill="#EA4335"/>
        <path d="M4 6.5l8 6 8-6V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v.5z" fill="#C5221F"/>
        <path d="M8 20h8V10l-4 3-4-3v10z" fill="#4285F4"/>
      </svg>
    `;
  }

  // 5. Stack Overflow
  if (t.includes('stackoverflow.com') || t.includes('stack overflow')) {
    return `
      <svg class="window-svg-icon" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
        <rect x="3" y="19" width="18" height="2" rx="1" fill="#F48024"/>
        <path d="M4 14.5l16 0" stroke="#F48024" stroke-width="2" stroke-linecap="round"/>
        <path d="M5.5 10l14.5 3" stroke="#F48024" stroke-width="2" stroke-linecap="round"/>
        <path d="M8 6l13 6" stroke="#F48024" stroke-width="2" stroke-linecap="round"/>
      </svg>
    `;
  }

  // 6. GitHub
  if (t.includes('github.com') || t.includes('github')) {
    return `
      <svg class="window-svg-icon" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path fill-rule="evenodd" clip-rule="evenodd" d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.53 1.032 1.53 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0112 6.844c.85.004 1.705.115 2.504.337 1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.019 10.019 0 0022 12.017C22 6.484 17.522 2 12 2z" fill="#FFFFFF"/>
      </svg>
    `;
  }

  // 7. Microsoft Teams
  if (t.includes('teams') || a.includes('teams')) {
    return `
      <svg class="window-svg-icon" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
        <rect x="3" y="3" width="18" height="18" rx="4" fill="#5059C9"/>
        <path d="M12 7v10M8 10h8" stroke="#FFFFFF" stroke-width="2.5" stroke-linecap="round"/>
      </svg>
    `;
  }

  // 8. If app has specific icon from getAppIconSvg
  if (a.includes('chrome') && !t.includes('.')) {
    return getAppIconSvg('chrome');
  }
  if (a.includes('code') || a.includes('vscode') || t.includes('.js') || t.includes('.ts') || t.includes('.json')) {
    return getAppIconSvg('code');
  }
  if (a.includes('word')) {
    return getAppIconSvg('word');
  }
  if (a.includes('excel')) {
    return getAppIconSvg('excel');
  }
  if (a.includes('slack')) {
    return getAppIconSvg('slack');
  }
  if (a.includes('edge')) {
    return getAppIconSvg('edge');
  }
  if (a.includes('terminal') || a.includes('powershell') || a.includes('cmd')) {
    return getAppIconSvg('terminal');
  }

  // Fallback web / window icon
  if (t.includes('.com') || t.includes('.org') || t.includes('.net') || t.includes('.io') || t.includes('http')) {
    return `
      <svg class="window-svg-icon" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
        <circle cx="12" cy="12" r="10" stroke="#38bdf8" stroke-width="1.8"/>
        <ellipse cx="12" cy="12" rx="4" ry="10" stroke="#38bdf8" stroke-width="1.8"/>
        <line x1="2" y1="12" x2="22" y2="12" stroke="#38bdf8" stroke-width="1.8"/>
      </svg>
    `;
  }

  return getAppIconSvg(appName || title);
}

function getAppIconSvg(appName) {
  const name = (appName || '').toLowerCase();
  
  if (name.includes('chrome')) {
    return `
      <svg class="app-svg-icon" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
        <circle cx="12" cy="12" r="10" fill="#4285F4"/>
        <path d="M12 2a10 10 0 0 1 7.54 3.42l-4.5 7.8A5 5 0 0 0 12 7h-8.2A10 10 0 0 1 12 2z" fill="#EA4335"/>
        <path d="M3.8 7h8.2a5 5 0 0 1 4.33 2.5l-4.5 7.8a5 5 0 0 1-4.33-2.5l-3.7-7.8z" fill="#FBBC05"/>
        <path d="M11.8 17.3l4.5-7.8A5 5 0 0 1 20.6 12a10 10 0 0 1-13.8 8.8l5-3.5z" fill="#34A853"/>
        <circle cx="12" cy="12" r="4" fill="#FFFFFF"/>
        <circle cx="12" cy="12" r="3.2" fill="#4285F4"/>
      </svg>
    `;
  }
  
  if (name.includes('code') || name.includes('vscode') || name.includes('antigravity')) {
    return `
      <svg class="app-svg-icon" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path d="M1.3 7.8L6.4 12 .5 16.5c-.3.2-.5-.1-.4-.4l3-9.5c0-.4.7-.6.7-.2l6.6 5.6-6.6 5.6c-.2.2-.5.1-.6-.1l-2.6-9.7c0-.2.2-.4.4-.4z" fill="#23A9F2"/>
        <path d="M18.2 2.3l-9.6 7.4 2.1 2.3 9.4-8.8c.4-.4.1-1.1-.5-1.1l-1.4.2z" fill="#007ACC"/>
        <path d="M18.2 21.7l-9.6-7.4 2.1-2.3 9.4 8.8c.4.4.1 1.1-.5 1.1l-1.4-.2z" fill="#007ACC"/>
        <path d="M17.5 2.1l5.8 4.2c.4.3.4.9 0 1.2l-5.8 4.2V2.1z" fill="#1F9CF0"/>
        <path d="M17.5 12.3l5.8 4.2c.4.3.4.9 0 1.2l-5.8 4.2v-9.6z" fill="#1F9CF0"/>
        <path d="M7.4 12l10.1 7.8V4.2L7.4 12z" fill="#0066B3"/>
      </svg>
    `;
  }

  if (name.includes('teams')) {
    return `
      <svg class="app-svg-icon" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
        <rect x="3" y="3" width="18" height="18" rx="4" fill="#5059C9"/>
        <path d="M12 7v10M8 10h8" stroke="#FFFFFF" stroke-width="2.5" stroke-linecap="round"/>
      </svg>
    `;
  }
  
  if (name.includes('word') || name.includes('winword')) {
    return `
      <svg class="app-svg-icon" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path d="M14 2H6a3 3 0 0 0-3 3v14a3 3 0 0 0 3 3h12a3 3 0 0 0 3-3V9l-7-7z" fill="#185ABD"/>
        <path d="M14 2v5a2 2 0 0 0 2 2h5L14 2z" fill="#2B88D9"/>
        <path d="M6 10l2 4 2-4h2.5L9.5 15h-3L4 10H6z" fill="#FFFFFF"/>
      </svg>
    `;
  }
  
  if (name.includes('excel')) {
    return `
      <svg class="app-svg-icon" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path d="M14 2H6a3 3 0 0 0-3 3v14a3 3 0 0 0 3 3h12a3 3 0 0 0 3-3V9l-7-7z" fill="#107C41"/>
        <path d="M14 2v5a2 2 0 0 0 2 2h5L14 2z" fill="#33C481"/>
        <path d="M8.5 9l1.8 2.5L12 9h2.3l-2.8 3.5 2.8 3.5h-2.3L10.3 13.5 8.5 16H6.2l2.8-3.5-2.8-3.5H8.5z" fill="#FFFFFF"/>
      </svg>
    `;
  }
  
  if (name.includes('slack')) {
    return `
      <svg class="app-svg-icon" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path d="M5 10.5C5 9.7 4.3 9 3.5 9S2 9.7 2 10.5v3c0 .8.7 1.5 1.5 1.5S5 14.3 5 13.5v-3z" fill="#36C5F0"/>
        <path d="M6.5 15c.8 0 1.5-.7 1.5-1.5v-3c0-.8-.7-1.5-1.5-1.5S5 9.7 5 10.5v3c0 .8.7 1.5 1.5 1.5z" fill="#36C5F0"/>
        <path d="M10.5 5C9.7 5 9 4.3 9 3.5S9.7 2 10.5 2h3c.8 0 1.5.7 1.5 1.5S14.3 5 13.5 5h-3z" fill="#2EB67D"/>
        <path d="M15 6.5c0 .8-.7 1.5-1.5 1.5h-3C9.7 8 9 7.3 9 6.5S9.7 5 10.5 5h3c.8 0 1.5.7 1.5 1.5z" fill="#2EB67D"/>
        <path d="M19 13.5c0 .8.7 1.5 1.5 1.5s1.5-.7 1.5-1.5v-3c0-.8-.7-1.5-1.5-1.5S19 9.7 19 10.5v3z" fill="#E01E5A"/>
        <path d="M17.5 9c-.8 0-1.5.7-1.5 1.5v3c0 .8.7 1.5 1.5 1.5s1.5-.7 1.5-1.5v-3c0-.8-.7-1.5-1.5-1.5z" fill="#E01E5A"/>
        <path d="M13.5 19c.8 0 1.5-.7 1.5-1.5s-.7-1.5-1.5-1.5h-3c-.8 0-1.5.7-1.5 1.5s.7 1.5 1.5 1.5h3z" fill="#ECB22E"/>
        <path d="M9 17.5c0-.8.7-1.5 1.5-1.5h3c.8 0 1.5.7 1.5 1.5s-.7 1.5-1.5 1.5h-3c-.8 0-1.5-.7-1.5-1.5z" fill="#ECB22E"/>
      </svg>
    `;
  }
  
  if (name.includes('spotify')) {
    return `
      <svg class="app-svg-icon" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
        <circle cx="12" cy="12" r="10" fill="#1DB954"/>
        <path d="M16.5 16.25c-.15 0-.3-.05-.4-.15-1.75-1.05-3.95-1.3-6.55-.7-.35.1-.7-.1-.8-.45s.1-.7.45-.8c2.85-.65 5.3-.35 7.25.85.3.2.4.55.2.85-.1.25-.25.4-.4.4z" fill="#FFFFFF"/>
        <path d="M17.75 13.5c-.2 0-.35-.05-.5-.15-2.05-1.25-5.15-1.6-7.55-.9-.4.1-.8-.1-.9-.5s.1-.8.5-.9c2.75-.85 6.2-.45 8.6 1 .35.2.45.65.25.95-.1.2-.25.3-.4.3z" fill="#FFFFFF"/>
        <path d="M18.9 10.65c-.2 0-.4-.1-.5-.25-2.35-1.4-6.3-1.55-8.6-.85-.45.15-.9-.1-.1.05-.6s.1-.9.6-1.05c2.7-.8 7.05-.65 9.75.95.4.25.55.75.3 1.15-.15.35-.35.45-.55.45z" fill="#FFFFFF"/>
      </svg>
    `;
  }
  
  if (name.includes('notepad')) {
    return `
      <svg class="app-svg-icon" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path d="M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm-1 15H6v-2h12v2zm0-4H6v-2h12v2zm0-4H6V8h12v2z" fill="#007ACC"/>
        <path d="M4 6h16v1H4zm0 11h16v1H4z" fill="#FFFFFF" opacity="0.3"/>
      </svg>
    `;
  }
  
  if (name.includes('edge') || name.includes('msedge')) {
    return `
      <svg class="app-svg-icon" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 17.93c-3.95-.49-7-3.85-7-7.93 0-.62.08-1.21.21-1.79L11.5 15v1.5c0 .83.67 1.5 1.5 1.5v1.93zm6.9-2.54c-.26-.81-1-1.39-1.9-1.39h-1v-3c0-.55-.45-1-1-1H8v-2h2c.55 0 1-.45 1-1V7h2c1.66 0 3 1.34 3 3v1h1c1.1 0 2 .9 2 2v1.76c.55.44.9 1.11.9 1.87 0 .26-.04.51-.1.76z" fill="#0078D7"/>
      </svg>
    `;
  }
  
  if (name.includes('firefox')) {
    return `
      <svg class="app-svg-icon" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
        <circle cx="12" cy="12" r="10" fill="#E66000"/>
        <path d="M12 2a10 10 0 0 0-8.8 14.8c.8-1.7 2.3-2.8 4.2-2.8 2.2 0 4 1.8 4 4v3.5A10 10 0 0 0 22 12a10 10 0 0 0-10-10z" fill="#FF9500"/>
        <circle cx="11.5" cy="11.5" r="4.5" fill="#3C78D8"/>
      </svg>
    `;
  }
  
  if (name.includes('terminal') || name.includes('cmd') || name.includes('powershell') || name.includes('bash')) {
    return `
      <svg class="app-svg-icon" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
        <rect x="2" y="3" width="20" height="18" rx="2" fill="#1E1E1E" stroke="#FFFFFF" stroke-width="1.5"/>
        <path d="M6 8l4 4-4 4" stroke="#00FF00" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" fill="none"/>
        <line x1="11" y1="16" x2="17" y2="16" stroke="#00FF00" stroke-width="2" stroke-linecap="round"/>
      </svg>
    `;
  }
  
  // Fallback icon
  return `
    <svg class="app-svg-icon" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      <rect x="3" y="3" width="8" height="8" rx="1.5" fill="#60a5fa" opacity="0.8"/>
      <rect x="13" y="3" width="8" height="8" rx="1.5" fill="#3b82f6" opacity="0.8"/>
      <rect x="3" y="13" width="8" height="8" rx="1.5" fill="#3b82f6" opacity="0.8"/>
      <rect x="13" y="13" width="8" height="8" rx="1.5" fill="#9ca3af" opacity="0.8"/>
    </svg>
  `;
}

// ================= REPORTEES DASHBOARD CONTROLLER =================
const REPORTEE_PALETTE = ['#3b82f6', '#a855f7', '#06b6d4', '#10b981', '#f59e0b', '#ec4899', '#6366f1'];

function getReporteeInitials(name) {
  if (!name || typeof name !== 'string') return '??';
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

function getReporteeColor(index, id) {
  const seed = (typeof id === 'number' && id > 0) ? id : index;
  return REPORTEE_PALETTE[seed % REPORTEE_PALETTE.length];
}

function setupHeaderNav() {
  if (tabNavActiveTime) {
    tabNavActiveTime.addEventListener('click', () => {
      switchDashboardView('active-time');
    });
  }

  if (tabNavReportees) {
    tabNavReportees.addEventListener('click', () => {
      switchDashboardView('reportees');
    });
  }
}

function switchDashboardView(view) {
  if (view === currentDashboardView) return;
  currentDashboardView = view;

  if (view === 'active-time') {
    if (tabNavActiveTime) tabNavActiveTime.classList.add('active');
    if (tabNavReportees) tabNavReportees.classList.remove('active');
    if (activeTimeView) activeTimeView.classList.remove('hidden');
    if (reporteesView) reporteesView.classList.add('hidden');
  } else if (view === 'reportees') {
    if (tabNavActiveTime) tabNavActiveTime.classList.remove('active');
    if (tabNavReportees) tabNavReportees.classList.add('active');
    if (activeTimeView) activeTimeView.classList.add('hidden');
    if (reporteesView) reporteesView.classList.remove('hidden');

    if (!reporteesData) {
      fetchAndRenderReportees();
    } else {
      renderReporteesDashboard();
    }
  }
}

async function checkReporteesVisibility() {
  if (typeof window === 'undefined' || !window || !window.api || typeof window.api.getReporteesCount !== 'function') return;
  try {
    const res = await window.api.getReporteesCount();
    if (res && typeof res.total_reportees === 'number' && res.total_reportees > 0) {
      if (tabNavReportees) {
        tabNavReportees.classList.remove('hidden');
      }
      if (navReporteesLabel) {
        navReporteesLabel.textContent = `Reportees (${res.total_reportees})`;
      }
    } else {
      if (tabNavReportees) {
        tabNavReportees.classList.add('hidden');
      }
    }
  } catch (err) {
    console.error('Failed to check reportees visibility:', err);
    if (tabNavReportees) {
      tabNavReportees.classList.add('hidden');
    }
  }
}

function setupReporteesControls() {
  if (reporteesSearchInput) {
    reporteesSearchInput.addEventListener('input', (e) => {
      reporteesSearchQuery = e.target.value;
      renderReporteesDashboard();
    });
  }

  if (reporteesRangeSelectorBtn && reporteesRangeMenu) {
    reporteesRangeSelectorBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      reporteesRangeMenu.classList.toggle('hidden');
    });

    const menuItems = reporteesRangeMenu.querySelectorAll('.range-menu-item');
    menuItems.forEach(item => {
      item.addEventListener('click', (e) => {
        e.stopPropagation();
        menuItems.forEach(i => i.classList.remove('active'));
        item.classList.add('active');
        reporteesDays = parseInt(item.dataset.days, 10) || 30;
        reporteesRangeMenu.classList.add('hidden');
        fetchAndRenderReportees(true);
      });
    });

    document.addEventListener('click', () => {
      if (reporteesRangeMenu && !reporteesRangeMenu.classList.contains('hidden')) {
        reporteesRangeMenu.classList.add('hidden');
      }
    });
  }

  if (reporteesRetryBtn) {
    reporteesRetryBtn.addEventListener('click', () => {
      fetchAndRenderReportees(true);
    });
  }
}

async function fetchAndRenderReportees(forceRefresh = false) {
  if (typeof window === 'undefined' || !window || !window.api || typeof window.api.getTeamHistory !== 'function') return;
  isReporteesLoading = true;

  if (reporteesLoading) reporteesLoading.classList.remove('hidden');
  if (reporteesError) reporteesError.classList.add('hidden');
  if (reporteesEmpty) reporteesEmpty.classList.add('hidden');
  if (reporteesList) reporteesList.innerHTML = '';

  try {
    const data = await window.api.getTeamHistory({
      days: reporteesDays,
      forceRefresh: forceRefresh
    });

    isReporteesLoading = false;
    if (reporteesLoading) reporteesLoading.classList.add('hidden');

    if (!data || typeof data !== 'object' || data.error) {
      throw new Error((data && data.error) || 'Failed to retrieve team history');
    }

    reporteesData = data;

    // Update dynamic header label count if fresh data changes it
    if (typeof data.total_reportees === 'number') {
      if (data.total_reportees > 0) {
        if (tabNavReportees) tabNavReportees.classList.remove('hidden');
        if (navReporteesLabel) navReporteesLabel.textContent = `Reportees (${data.total_reportees})`;
      } else {
        if (tabNavReportees) tabNavReportees.classList.add('hidden');
      }
    }

    renderReporteesDashboard();
  } catch (err) {
    isReporteesLoading = false;
    if (reporteesLoading) reporteesLoading.classList.add('hidden');
    if (reporteesError) {
      reporteesError.classList.remove('hidden');
      if (reporteesErrorMsg) {
        reporteesErrorMsg.textContent = `Unable to load reportees: ${err.message || 'Network error'}`;
      }
    }
  }
}

function renderReporteesDashboard() {
  if (!reporteesData) return;
  const data = reporteesData;

  // 1. Update date range header
  if (reporteesDateRangeText) {
    reporteesDateRangeText.textContent = `${data.from_formatted || data.from} — ${data.to_formatted || data.to}`;
  }
  if (reporteesPeriodPill) {
    reporteesPeriodPill.textContent = `(${data.days} days)`;
  }
  if (reporteesDropdownSelectedLabel) {
    reporteesDropdownSelectedLabel.textContent = `${data.from_formatted || data.from} - ${data.to_formatted || data.to}`;
  }

  // 2. Summary cards (reflect full team totals)
  if (summaryTotalReportees) {
    summaryTotalReportees.textContent = String(data.total_reportees || 0);
  }
  if (summaryTeamHours) {
    const hours = data.team_total_hours || 0;
    summaryTeamHours.textContent = `${hours % 1 === 0 ? hours : hours.toFixed(1)}h`;
  }
  if (summaryPeriodDays) {
    summaryPeriodDays.textContent = `${data.days} days`;
  }

  // 3. Filter reportees
  const query = reporteesSearchQuery.toLowerCase().trim();
  const rawReportees = Array.isArray(data.reportees) ? data.reportees : [];

  let filteredReportees = rawReportees;
  if (query) {
    filteredReportees = rawReportees.map(r => {
      const nameMatch = (r.name && r.name.toLowerCase().includes(query));
      const loginMatch = (r.login && r.login.toLowerCase().includes(query));

      const matchingEntries = (r.all_entries || []).filter(e => {
        return (e.project && e.project.toLowerCase().includes(query)) ||
               (e.issue_subject && e.issue_subject.toLowerCase().includes(query)) ||
               (e.activity && e.activity.toLowerCase().includes(query)) ||
               (e.comments && e.comments.toLowerCase().includes(query));
      });

      if (nameMatch || loginMatch) {
        return r;
      } else if (matchingEntries.length > 0) {
        return {
          ...r,
          all_entries: matchingEntries
        };
      }
      return null;
    }).filter(Boolean);
  }

  if (reporteesList) {
    reporteesList.innerHTML = '';
  }

  if (filteredReportees.length === 0) {
    if (reporteesEmpty) {
      reporteesEmpty.classList.remove('hidden');
      if (reporteesEmptyMsg) {
        reporteesEmptyMsg.textContent = query
          ? `No reportees or projects found matching "${escapeHtml(query)}"`
          : 'No reportee activity found for the selected period.';
      }
    }
    return;
  }

  if (reporteesEmpty) {
    reporteesEmpty.classList.add('hidden');
  }

  // 4. Render cards
  const maxTeamHours = Math.max(
    ...rawReportees.map(r => r.total_hours || 0),
    (data.days || 30) * 8 * (5 / 7),
    1
  );

  filteredReportees.forEach((r, idx) => {
    const cardEl = createReporteeCardElement(r, idx, maxTeamHours);
    if (reporteesList) {
      reporteesList.appendChild(cardEl);
    }
  });
}

function createReporteeCardElement(r, idx, maxTargetHours) {
  const card = document.createElement('div');
  const isCollapsed = collapsedReporteeIds.has(r.id);
  card.className = `reportee-card${isCollapsed ? ' collapsed' : ''}`;
  card.dataset.reporteeId = String(r.id);

  const accentColor = getReporteeColor(idx, r.id);
  const initials = getReporteeInitials(r.name);
  const totalH = r.total_hours || 0;
  const pct = Math.min(100, Math.max(4, (totalH / maxTargetHours) * 100));

  const avgH = r.avg_daily_hours % 1 === 0 ? r.avg_daily_hours : (r.avg_daily_hours || 0).toFixed(1);
  const sublabel = r.active_days > 0 ? `${r.active_days} days × ${avgH}h logged` : `0 days logged`;
  const totalHStr = `${totalH % 1 === 0 ? totalH : totalH.toFixed(1)}h`;

  // Header
  const header = document.createElement('div');
  header.className = 'reportee-header';
  header.innerHTML = `
    <div class="reportee-header-left">
      <svg class="reportee-chevron" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path d="M4 6L8 10L12 6" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" />
      </svg>
      <div class="reportee-avatar" style="background-color: ${accentColor};">${escapeHtml(initials)}</div>
      <div class="reportee-user-info">
        <div class="reportee-name">${escapeHtml(r.name)}</div>
        <div class="reportee-login">${escapeHtml(r.login)}</div>
      </div>
    </div>
    <div class="reportee-header-right">
      <div class="reportee-hours-total">${totalHStr}</div>
      <div class="reportee-progress-wrapper">
        <div class="reportee-progress-bar" style="width: ${pct}%; background-color: ${accentColor};"></div>
      </div>
      <div class="reportee-sublabel">${escapeHtml(sublabel)}</div>
    </div>
  `;

  header.addEventListener('click', () => {
    if (collapsedReporteeIds.has(r.id)) {
      collapsedReporteeIds.delete(r.id);
      card.classList.remove('collapsed');
    } else {
      collapsedReporteeIds.add(r.id);
      card.classList.add('collapsed');
    }
  });

  // Body
  const body = document.createElement('div');
  body.className = 'reportee-body';

  const table = document.createElement('table');
  table.className = 'reportee-table';

  const thead = document.createElement('thead');
  thead.innerHTML = `
    <tr>
      <th style="width: 95px;">DATE ↓</th>
      <th>PROJECT / ISSUE</th>
      <th style="width: 140px;">ACTIVITY</th>
      <th class="th-hours" style="width: 60px;">HOURS</th>
    </tr>
  `;
  table.appendChild(thead);

  const tbody = document.createElement('tbody');
  const entries = Array.isArray(r.all_entries) ? r.all_entries : [];

  if (entries.length === 0) {
    const tr = document.createElement('tr');
    tr.innerHTML = `<td colspan="4" style="text-align: center; color: #64748b; padding: 12px 0;">No timesheet entries found for this period.</td>`;
    tbody.appendChild(tr);
  } else {
    entries.forEach(entry => {
      const tr = document.createElement('tr');
      const hoursVal = typeof entry.hours === 'number' ? entry.hours : (parseFloat(entry.hours) || 0);
      const hoursStr = `${hoursVal.toFixed(1)}h`;
      const issuePart = entry.issue_subject
        ? `<span class="project-bullet">•</span><span class="issue-subject">${escapeHtml(entry.issue_subject)}</span>`
        : '';

      tr.innerHTML = `
        <td class="td-date">${escapeHtml(entry.formatted_date || entry.spent_on || '—')}</td>
        <td class="td-project"><span>${escapeHtml(entry.project || '—')}</span>${issuePart}</td>
        <td class="td-activity">${escapeHtml(entry.activity || '—')}</td>
        <td class="td-hours">${hoursStr}</td>
      `;
      tbody.appendChild(tr);
    });
  }

  table.appendChild(tbody);
  body.appendChild(table);

  card.appendChild(header);
  card.appendChild(body);
  return card;
}

async function handleRefreshClick() {
  if (refreshBtn) {
    refreshBtn.classList.add('spinning');
  }

  try {
    const hasWindowApi = typeof window !== 'undefined' && window && window.api;

    if (currentDashboardView === 'active-time') {
      // Invalidate local client view cache and reset in-flight promises
      clientViewCache = { today: null, yesterday: null, last7days: null, last30days: null };
      inFlightFetchPromises = {};
      lastCacheTimestamp = Date.now();

      // Trigger sync to flush pending sessions to server if supported
      if (hasWindowApi && typeof window.api.triggerSync === 'function') {
        try {
          await window.api.triggerSync();
        } catch (syncErr) {
          console.error('[Refresh] triggerSync failed:', syncErr);
        }
      }

      await fetchAndRender();
      await checkReporteesVisibility();
    } else if (currentDashboardView === 'reportees') {
      // Force refresh bypassing team history cache
      await fetchAndRenderReportees(true);
      await checkReporteesVisibility();
    }
  } catch (err) {
    console.error('[Refresh] Error during live data refresh:', err);
  } finally {
    setTimeout(() => {
      if (refreshBtn) {
        refreshBtn.classList.remove('spinning');
      }
    }, 600);
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    DAILY_TARGET_MINUTES,
    DAILY_TARGET_SECONDS,
    DAILY_REFERENCE_MINUTES,
    DAILY_REFERENCE_SECONDS,
    STANDARD_TARGET_MINUTES,
    STANDARD_TARGET_SECONDS,
    STANDARD_TARGET_HOURS,
    calculateDailyProgressPercentages,
    calculateDailyProgressPercentagesMinutes,
    calculateProgressPercent,
    isWeekend,
    formatDuration,
    formatShortHours,
    formatHour12,
    formatHourRange,
    parse12HourTimeToHours,
    computeAppWiseActivity,
    computeHourlyActivity,
    formatWindowOrWebsiteTitle,
    getWindowIconSvg,
    getAppColor,
    getAppIconSvg,
    reconcileRows,
    reconcileHourlyRows,
    renderHourlyApps,
    renderHourlyWindows,
    toggleHourExpansion,
    toggleAppExpansion,
    getExpandedHours: () => expandedHours,
    setExpandedHours: (set) => { expandedHours = set; },
    getExpandedAppName: () => expandedAppName,
    setExpandedAppName: (name) => { expandedAppName = name; },
    escapeHtml,
    getDailyActiveTimeColor,
    getShowWeekends: () => showWeekends,
    setShowWeekends: (val) => { showWeekends = Boolean(val); },
    updateWeekendToggleVisibility,
    updateHistoryLegendVisibility,
    updateFooterLabel,
    renderHistoryView,
    renderAppWiseView,
    renderHoursWiseView,
    renderTodayYesterdayView,
    renderAppView: renderTodayYesterdayView,
    renderHourlyView: renderHoursWiseView,
    renderActivities,
    getCurrentActivityView: () => currentActivityView,
    setCurrentActivityView: (val) => { currentActivityView = val; },
    selectActivityView,
    updateViewToggleVisibility,
    updateViewToggleButtons,
    clearRenderedActivityRows,
    REDMINE_CATEGORY_COLORS,
    // Reportees exports for testing
    getReporteeInitials,
    getReporteeColor,
    setupHeaderNav,
    switchDashboardView,
    getCurrentDashboardView: () => currentDashboardView,
    setCurrentDashboardView: (v) => { currentDashboardView = v; },
    fetchAndRenderReportees,
    renderReporteesDashboard,
    createReporteeCardElement,
    getReporteesData: () => reporteesData,
    setReporteesData: (d) => { reporteesData = d; },
    getReporteesDays: () => reporteesDays,
    setReporteesDays: (d) => { reporteesDays = d; },
    getReporteesSearchQuery: () => reporteesSearchQuery,
    setReporteesSearchQuery: (q) => { reporteesSearchQuery = q; },
    handleRefreshClick
  };
}

