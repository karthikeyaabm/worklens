// dashboard.js - Activity Log Dashboard Controller

// Chart instances
let appUsageChartInstance = null;
let activityDistChartInstance = null;

// Global state
let rawEntries = [];
let rawSummary = null;
let currentActiveRecord = null;
let appVersion = '1.0.7';

// App Icon mapping config
const appStyleMap = {
  'google chrome': { color: '#3b82f6', bg: 'rgba(59, 130, 246, 0.15)', text: 'C' },
  'chrome': { color: '#3b82f6', bg: 'rgba(59, 130, 246, 0.15)', text: 'C' },
  'visual studio code': { color: '#10b981', bg: 'rgba(16, 185, 129, 0.15)', text: 'V' },
  'vs code': { color: '#10b981', bg: 'rgba(16, 185, 129, 0.15)', text: 'V' },
  'code': { color: '#10b981', bg: 'rgba(16, 185, 129, 0.15)', text: 'V' },
  'microsoft teams': { color: '#8b5cf6', bg: 'rgba(139, 92, 246, 0.15)', text: 'T' },
  'teams': { color: '#8b5cf6', bg: 'rgba(139, 92, 246, 0.15)', text: 'T' },
  'windows explorer': { color: '#f59e0b', bg: 'rgba(245, 158, 11, 0.15)', text: 'E' },
  'explorer': { color: '#f59e0b', bg: 'rgba(245, 158, 11, 0.15)', text: 'E' },
  'postman': { color: '#ec4899', bg: 'rgba(236, 72, 153, 0.15)', text: 'P' },
  'slack': { color: '#6366f1', bg: 'rgba(99, 102, 241, 0.15)', text: 'S' },
  'microsoft word': { color: '#0ea5e9', bg: 'rgba(14, 165, 233, 0.15)', text: 'W' },
  'word': { color: '#0ea5e9', bg: 'rgba(14, 165, 233, 0.15)', text: 'W' },
  'microsoft excel': { color: '#22c55e', bg: 'rgba(34, 197, 94, 0.15)', text: 'X' },
  'excel': { color: '#22c55e', bg: 'rgba(34, 197, 94, 0.15)', text: 'X' },
  'notepad++': { color: '#84cc16', bg: 'rgba(132, 204, 22, 0.15)', text: 'N' },
  'notepad': { color: '#64748b', bg: 'rgba(100, 116, 139, 0.15)', text: 'N' },
  'github desktop': { color: '#a855f7', bg: 'rgba(168, 85, 247, 0.15)', text: 'G' },
  'githubdesktop.exe': { color: '#a855f7', bg: 'rgba(168, 85, 247, 0.15)', text: 'G' },
  'antigravity ide': { color: '#f43f5e', bg: 'rgba(244, 63, 94, 0.15)', text: 'A' },
  'electron': { color: '#06b6d4', bg: 'rgba(6, 182, 212, 0.15)', text: 'E' }
};

// Date Parsing Helper (DD-MM-YYYY HH:mm:ss -> Date)
function parseDateString(str) {
  if (!str) return null;
  const parts = str.split(' ');
  if (parts.length < 2) return null;
  const dateParts = parts[0].split('-');
  const timeParts = parts[1].split(':');
  if (dateParts.length < 3 || timeParts.length < 3) return null;
  return new Date(
    parseInt(dateParts[2]), // Year
    parseInt(dateParts[1]) - 1, // Month (0-indexed)
    parseInt(dateParts[0]), // Day
    parseInt(timeParts[0]), // Hour
    parseInt(timeParts[1]), // Minute
    parseInt(timeParts[2])  // Second
  );
}

// Convert Date to YYYY-MM-DD string for inputs
function formatDateToInputString(date) {
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const dd = String(date.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

// Parse YYYY-MM-DD from input back to start/end dates
function parseInputDateString(str, isEnd = false) {
  if (!str) return null;
  const parts = str.split('-');
  if (parts.length < 3) return null;
  return new Date(
    parseInt(parts[0]),
    parseInt(parts[1]) - 1,
    parseInt(parts[2]),
    isEnd ? 23 : 0,
    isEnd ? 59 : 0,
    isEnd ? 59 : 0
  );
}

// Formats seconds into XXh YYm
function formatDurationHoursMinutes(seconds) {
  if (isNaN(seconds) || seconds <= 0) return '00h 00m';
  const hrs = Math.floor(seconds / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  return `${String(hrs).padStart(2, '0')}h ${String(mins).padStart(2, '0')}m`;
}

// Formats seconds into XXh YYm ZZs
function formatDurationHMS(seconds) {
  if (isNaN(seconds) || seconds <= 0) return '00h 00m 00s';
  const hrs = Math.floor(seconds / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  const secs = seconds % 60;
  return `${String(hrs).padStart(2, '0')}h ${String(mins).padStart(2, '0')}m ${String(secs).padStart(2, '0')}s`;
}

// Format 24h HH:mm:ss to 12h AM/PM
function formatTimeToAMPM(timeStr) {
  if (!timeStr) return '';
  const parts = timeStr.split(':');
  if (parts.length < 3) return timeStr;
  let hr = parseInt(parts[0]);
  const min = parts[1];
  const sec = parts[2];
  const ampm = hr >= 12 ? 'PM' : 'AM';
  hr = hr % 12;
  hr = hr ? hr : 12; // 0 should be 12
  return `${String(hr).padStart(2, '0')}:${min}:${sec} ${ampm}`;
}

// Setup inputs defaults on load
function initDefaultFilterDates() {
  const fromDateInput = document.getElementById('filter-from-date');
  const toDateInput = document.getElementById('filter-to-date');
  
  if (fromDateInput && toDateInput && !fromDateInput.value && !toDateInput.value) {
    const todayStr = formatDateToInputString(new Date());
    fromDateInput.value = todayStr;
    toDateInput.value = todayStr;
  }
}

// Fetch dashboard data from Main process
async function loadDashboardData(showSpin = false) {
  const refreshBtn = document.getElementById('manual-refresh-btn');
  const loadingOverlay = document.getElementById('table-loading-overlay');
  
  if (showSpin && refreshBtn) {
    refreshBtn.classList.add('spinning');
  }
  if (loadingOverlay) {
    loadingOverlay.classList.remove('hidden');
  }

  try {
    if (!window.api) return;
    
    // Fetch system payload
    const data = await window.api.getDashboardData();
    appVersion = await window.api.getAppVersion();

    rawEntries = data.entries || [];
    rawSummary = data.summary;
    currentActiveRecord = data.currentRecord;

    // Inject currently tracking record if present and from today
    if (currentActiveRecord) {
      // Check if it already exists in the retrieved list (prevent double listing)
      const exists = rawEntries.some(e => e.id === currentActiveRecord.id || 
        (e.app_name === currentActiveRecord.app_name && 
         e.start_time === currentActiveRecord.start_time));
      if (!exists) {
        // Place it at the start (latest record)
        rawEntries.unshift(currentActiveRecord);
      }
    }

    // Sort entries descending (latest first)
    rawEntries.sort((a, b) => {
      const dateA = parseDateString(a.start_time) || new Date(0);
      const dateB = parseDateString(b.start_time) || new Date(0);
      return dateB - dateA;
    });

    // Populate user profile info
    const nameEl = document.getElementById('user-name-display');
    const avatarEl = document.getElementById('user-avatar');
    if (nameEl) {
      nameEl.textContent = data.fullName || 'Karthikeya K';
    }
    if (avatarEl && data.fullName) {
      const names = data.fullName.split(' ');
      const initials = names.map(n => n[0]).join('').substring(0, 2).toUpperCase();
      avatarEl.textContent = initials;
    }

    // Populate app version
    const versionEl = document.getElementById('version-display');
    if (versionEl) {
      versionEl.textContent = `v${appVersion}`;
    }

    // Update synchronization times
    const lastSyncTimeStr = new Date().toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
    const lastSyncText = `Today, ${lastSyncTimeStr}`;
    
    const sidebarSyncEl = document.getElementById('sidebar-last-sync-time');
    const footerSyncEl = document.getElementById('footer-sync-time');
    if (sidebarSyncEl) sidebarSyncEl.textContent = lastSyncText;
    if (footerSyncEl) {
      const now = new Date();
      const dateStr = `${String(now.getDate()).padStart(2, '0')}-${String(now.getMonth() + 1).padStart(2, '0')}-${now.getFullYear()}`;
      footerSyncEl.textContent = `${dateStr} ${lastSyncTimeStr}`;
    }

    // Dynamic Applications Dropdown options population
    populateAppDropdown(rawEntries);

    // Apply filters and draw charts/tables
    processDashboardData();

  } catch (error) {
    console.error('Failed to load dashboard payload:', error);
  } finally {
    if (refreshBtn) {
      refreshBtn.classList.remove('spinning');
    }
    if (loadingOverlay) {
      loadingOverlay.classList.add('hidden');
    }
  }
}

// Populate the unique applications dropdown dynamically
function populateAppDropdown(entries) {
  const select = document.getElementById('filter-app-name');
  if (!select) return;

  const currentVal = select.value;
  
  // Clear options except "All"
  select.innerHTML = '<option value="all">All Applications</option>';
  
  const appNames = new Set();
  entries.forEach(e => {
    if (e.app_name) appNames.add(e.app_name);
  });

  const sortedApps = Array.from(appNames).sort((a, b) => a.localeCompare(b));
  sortedApps.forEach(appName => {
    const opt = document.createElement('option');
    opt.value = appName;
    opt.textContent = appName;
    select.appendChild(opt);
  });

  // Restore previous selection if still exists
  if (appNames.has(currentVal)) {
    select.value = currentVal;
  }
}

// Apply current filters to local data
function processDashboardData() {
  const fromDateVal = document.getElementById('filter-from-date').value;
  const toDateVal = document.getElementById('filter-to-date').value;
  const appNameFilter = document.getElementById('filter-app-name').value;
  const statusFilter = document.getElementById('filter-status').value;
  const searchQuery = document.getElementById('filter-search').value.toLowerCase().trim();

  const filterFromDate = parseInputDateString(fromDateVal, false);
  const filterToDate = parseInputDateString(toDateVal, true);

  // Filter entries array
  const filtered = rawEntries.filter(entry => {
    const entryDate = parseDateString(entry.start_time);
    
    // 1. Date Filter
    if (entryDate) {
      if (filterFromDate && entryDate < filterFromDate) return false;
      if (filterToDate && entryDate > filterToDate) return false;
    }

    // 2. Application Filter
    if (appNameFilter !== 'all' && entry.app_name !== appNameFilter) return false;

    // 3. Status Filter
    if (statusFilter !== 'all') {
      const matchStatus = statusFilter === 'inactive' ? 'inactive' : 'active';
      if (entry.status !== matchStatus) return false;
    }

    // 4. Search Filter
    if (searchQuery) {
      const appMatch = entry.app_name && entry.app_name.toLowerCase().includes(searchQuery);
      const titleMatch = entry.window_title && entry.window_title.toLowerCase().includes(searchQuery);
      if (!appMatch && !titleMatch) return false;
    }

    return true;
  });

  // Compute Metrics & Refresh visual interfaces
  calculateSummaryCards(filtered);
  renderCharts(filtered);
  renderTable(filtered);
}

// Compute values for exactly five summary cards
function calculateSummaryCards(filtered) {
  let activeTime = 0;
  let idleTime = 0;
  const uniqueApps = new Set();
  
  // Calculate active and idle durations
  filtered.forEach(entry => {
    const dur = parseInt(entry.duration) || 0;
    if (entry.status === 'active') {
      activeTime += dur;
    } else {
      idleTime += dur;
    }
    if (entry.app_name) {
      uniqueApps.add(entry.app_name);
    }
  });

  // 1. Card 1: Total Active Time
  const activeTimeVal = document.getElementById('card-active-time');
  if (activeTimeVal) activeTimeVal.textContent = formatDurationHoursMinutes(activeTime);

  // 2. Card 2: Total Idle Time
  const idleTimeVal = document.getElementById('card-idle-time');
  if (idleTimeVal) idleTimeVal.textContent = formatDurationHoursMinutes(idleTime);

  // 3. Card 3: Total Applications Used
  const appsVal = document.getElementById('card-total-apps');
  if (appsVal) appsVal.textContent = uniqueApps.size;

  // 4. Card 4: Total Sessions (Calculated)
  // Contiguous sessions group active records separated by < 5 min gaps or inactive intervals
  let sessionCount = 0;
  let lastActiveEndTime = null;

  // Sort chronological
  const chronoFiltered = [...filtered].sort((a, b) => {
    const da = parseDateString(a.start_time) || new Date(0);
    const db = parseDateString(b.start_time) || new Date(0);
    return da - db;
  });

  chronoFiltered.forEach(entry => {
    if (entry.status === 'active') {
      const startTime = parseDateString(entry.start_time);
      const endTime = parseDateString(entry.end_time);
      
      if (startTime && endTime) {
        if (!lastActiveEndTime || (startTime - lastActiveEndTime) > 5 * 60 * 1000) {
          sessionCount++;
        }
        lastActiveEndTime = endTime;
      }
    } else {
      // Inactive break ends current contiguous session
      lastActiveEndTime = null;
    }
  });

  const sessionsVal = document.getElementById('card-total-sessions');
  if (sessionsVal) sessionsVal.textContent = sessionCount;

  // 5. Card 5: Most Used Application & secondary value
  const appDurations = {};
  filtered.forEach(entry => {
    if (entry.status === 'active' && entry.app_name) {
      appDurations[entry.app_name] = (appDurations[entry.app_name] || 0) + (parseInt(entry.duration) || 0);
    }
  });

  let topApp = '--';
  let topAppDuration = 0;
  Object.keys(appDurations).forEach(app => {
    if (appDurations[app] > topAppDuration) {
      topAppDuration = appDurations[app];
      topApp = app;
    }
  });

  const mostUsedAppVal = document.getElementById('card-most-used-app');
  const mostUsedAppDurationVal = document.getElementById('card-most-used-duration');
  if (mostUsedAppVal) {
    mostUsedAppVal.textContent = topApp;
    mostUsedAppVal.title = topApp;
  }
  if (mostUsedAppDurationVal) {
    mostUsedAppDurationVal.textContent = topAppDuration > 0 ? formatDurationHoursMinutes(topAppDuration) : '00h 00m';
  }

  // Comparisons to Yesterday (Trend badges)
  let activeTrendVal = '0%';
  let activeTrendClass = 'trend-up';
  let activeTrendSymbol = '↑';

  let idleTrendVal = '0%';
  let idleTrendClass = 'trend-down';
  let idleTrendSymbol = '↓';

  if (rawSummary) {
    const yesterdayActiveSeconds = parseInt(rawSummary.yesterday) || 0;
    
    // Active Change Calculation
    if (yesterdayActiveSeconds > 0) {
      const activeDiff = activeTime - yesterdayActiveSeconds;
      const activePct = Math.round((activeDiff / yesterdayActiveSeconds) * 100);
      
      activeTrendVal = `${Math.abs(activePct)}%`;
      activeTrendClass = activePct >= 0 ? 'trend-up' : 'trend-down';
      activeTrendSymbol = activePct >= 0 ? '↑' : '↓';
    } else {
      activeTrendVal = '--%';
      activeTrendClass = 'trend-up';
      activeTrendSymbol = '↑';
    }

    // Dynamic Idle Change Calculation based on timesheet hours
    // Using timesheet logged minus active duration to estimate idle changes
    const yesterdayTotalHours = parseFloat(rawSummary.yesterday_hours || 8.0);
    const yesterdayActiveHours = yesterdayActiveSeconds / 3600;
    const yesterdayIdleSeconds = Math.max(0, Math.round((yesterdayTotalHours - yesterdayActiveHours) * 3600));

    if (yesterdayIdleSeconds > 0) {
      const idleDiff = idleTime - yesterdayIdleSeconds;
      const idlePct = Math.round((idleDiff / yesterdayIdleSeconds) * 100);
      
      idleTrendVal = `${Math.abs(idlePct)}%`;
      idleTrendClass = idlePct <= 0 ? 'trend-down' : 'trend-up';
      idleTrendSymbol = idlePct <= 0 ? '↓' : '↑';
    } else {
      idleTrendVal = '--%';
      idleTrendClass = 'trend-down';
      idleTrendSymbol = '↓';
    }
  }

  // Update DOM trends for Active Time
  const activeTrendEl = document.getElementById('card-active-trend');
  if (activeTrendEl) {
    activeTrendEl.className = `card-subtext ${activeTrendClass}`;
    activeTrendEl.querySelector('.trend-icon').textContent = activeTrendSymbol;
    activeTrendEl.querySelector('.trend-val').textContent = activeTrendVal;
  }

  // Update DOM trends for Idle Time
  const idleTrendEl = document.getElementById('card-idle-trend');
  if (idleTrendEl) {
    idleTrendEl.className = `card-subtext ${idleTrendClass}`;
    idleTrendEl.querySelector('.trend-icon').textContent = idleTrendSymbol;
    idleTrendEl.querySelector('.trend-val').textContent = idleTrendVal;
  }

  // Set Applications and Sessions trends matching active time scale for consistency
  const appsTrendEl = document.getElementById('card-apps-trend');
  if (appsTrendEl) {
    appsTrendEl.className = `card-subtext ${activeTrendClass}`;
    appsTrendEl.querySelector('.trend-icon').textContent = activeTrendSymbol;
    appsTrendEl.querySelector('.trend-val').textContent = activeTrendVal;
  }

  const sessionsTrendEl = document.getElementById('card-sessions-trend');
  if (sessionsTrendEl) {
    sessionsTrendEl.className = `card-subtext ${activeTrendClass}`;
    sessionsTrendEl.querySelector('.trend-icon').textContent = activeTrendSymbol;
    sessionsTrendEl.querySelector('.trend-val').textContent = activeTrendVal;
  }
}

// Generate the two charts using Chart.js
function renderCharts(filtered) {
  // Aggregate application active durations
  const appTimes = {};
  const appSessions = {};
  
  filtered.forEach(entry => {
    if (entry.status === 'active' && entry.app_name) {
      appTimes[entry.app_name] = (appTimes[entry.app_name] || 0) + (parseInt(entry.duration) || 0);
      appSessions[entry.app_name] = (appSessions[entry.app_name] || 0) + 1; // session focus intervals count
    }
  });

  // Calculate total active time for percentages
  let totalActiveSeconds = 0;
  Object.values(appTimes).forEach(val => totalActiveSeconds += val);

  // Sort apps descending
  const sortedApps = Object.keys(appTimes).map(app => ({
    name: app,
    duration: appTimes[app],
    sessions: appSessions[app]
  })).sort((a, b) => b.duration - a.duration);

  // Limit Top N apps
  const limitSelect = document.getElementById('bar-chart-limit');
  const limit = limitSelect ? parseInt(limitSelect.value) : 10;
  
  const topApps = sortedApps.slice(0, limit);
  const otherApps = sortedApps.slice(limit);

  if (otherApps.length > 0) {
    let otherDuration = 0;
    let otherSessions = 0;
    otherApps.forEach(a => {
      otherDuration += a.duration;
      otherSessions += a.sessions;
    });
    topApps.push({
      name: 'Others',
      duration: otherDuration,
      sessions: otherSessions
    });
  }

  // 1. Render Left Bar Chart
  renderUsageBarChart(topApps, totalActiveSeconds);

  // 2. Render Right Doughnut Chart
  let totalActive = 0;
  let totalIdle = 0;
  filtered.forEach(e => {
    const d = parseInt(e.duration) || 0;
    if (e.status === 'active') totalActive += d;
    else totalIdle += d;
  });

  renderActivityDoughnutChart(totalActive, totalIdle);
}

// Render Left Bar Chart
function renderUsageBarChart(topApps, totalActiveSeconds) {
  const ctx = document.getElementById('appUsageChart');
  if (!ctx) return;

  // Destroy previous instance
  if (appUsageChartInstance) {
    appUsageChartInstance.destroy();
  }

  if (topApps.length === 0) {
    // Clear canvas
    const wrapper = ctx.parentNode;
    wrapper.style.display = 'flex';
    wrapper.style.alignItems = 'center';
    wrapper.style.justifyContent = 'center';
    ctx.style.display = 'none';
    
    let noData = wrapper.querySelector('.no-chart-data');
    if (!noData) {
      noData = document.createElement('span');
      noData.className = 'no-chart-data';
      noData.textContent = 'No chart data available';
      noData.style.color = 'var(--text-muted)';
      noData.style.fontSize = '12px';
      wrapper.appendChild(noData);
    } else {
      noData.classList.remove('hidden');
    }
    return;
  } else {
    ctx.style.display = 'block';
    const noData = ctx.parentNode.querySelector('.no-chart-data');
    if (noData) noData.classList.add('hidden');
  }

  const labels = topApps.map(a => a.name);
  const dataValues = topApps.map(a => parseFloat((a.duration / 3600).toFixed(2))); // value in hours

  // Set colors based on App Style Map, falling back to accent palette
  const accentColors = [
    '#3b82f6', '#10b981', '#8b5cf6', '#f97316', '#ec4899', 
    '#06b6d4', '#22c55e', '#6366f1', '#f59e0b', '#6b7280'
  ];
  
  const backgroundColors = topApps.map((a, idx) => {
    const key = a.name.toLowerCase();
    if (appStyleMap[key]) return appStyleMap[key].color;
    return accentColors[idx % accentColors.length];
  });

  appUsageChartInstance = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: labels,
      datasets: [{
        data: dataValues,
        backgroundColor: backgroundColors,
        borderWidth: 0,
        borderRadius: 4,
        barThickness: 28
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          display: false
        },
        tooltip: {
          backgroundColor: 'rgba(15, 23, 42, 0.95)',
          titleFont: {
            family: varColor('--font-family'),
            size: 13,
            weight: 'bold'
          },
          bodyFont: {
            family: varColor('--font-family'),
            size: 12
          },
          borderColor: 'rgba(255, 255, 255, 0.1)',
          borderWidth: 1,
          padding: 10,
          callbacks: {
            label: function(context) {
              const idx = context.dataIndex;
              const appInfo = topApps[idx];
              
              // Duration formatted
              const hrs = Math.floor(appInfo.duration / 3600);
              const mins = Math.floor((appInfo.duration % 3600) / 60);
              const durationStr = `${hrs}h ${mins}m`;
              
              // Percentage
              const pct = totalActiveSeconds > 0 ? ((appInfo.duration / totalActiveSeconds) * 100).toFixed(2) : 0;
              
              // Sessions
              const sessions = appInfo.sessions;

              return [
                `${durationStr} (${pct}%)`,
                `Sessions: ${sessions}`
              ];
            }
          }
        }
      },
      scales: {
        x: {
          grid: {
            display: false
          },
          ticks: {
            color: '#64748b',
            font: {
              family: varColor('--font-family'),
              size: 11
            }
          }
        },
        y: {
          grid: {
            color: 'rgba(255, 255, 255, 0.05)'
          },
          ticks: {
            color: '#64748b',
            font: {
              family: varColor('--font-family'),
              size: 11
            },
            callback: function(value) {
              return value + 'h';
            }
          }
        }
      }
    }
  });
}

// Render Right Doughnut Chart
function renderActivityDoughnutChart(activeSec, idleSec) {
  const ctx = document.getElementById('activityDistChart');
  if (!ctx) return;

  if (activityDistChartInstance) {
    activityDistChartInstance.destroy();
  }

  // Update Doughnut center and legend text
  const totalSec = activeSec + idleSec;
  const totalTimeEl = document.getElementById('doughnut-total-time');
  if (totalTimeEl) totalTimeEl.textContent = formatDurationHoursMinutes(totalSec);

  const activePct = totalSec > 0 ? ((activeSec / totalSec) * 100).toFixed(1) : '0.0';
  const idlePct = totalSec > 0 ? ((idleSec / totalSec) * 100).toFixed(1) : '0.0';

  const legendActiveVal = document.getElementById('legend-active-val');
  const legendIdleVal = document.getElementById('legend-idle-val');
  if (legendActiveVal) legendActiveVal.textContent = `${formatDurationHoursMinutes(activeSec)} (${activePct}%)`;
  if (legendIdleVal) legendIdleVal.textContent = `${formatDurationHoursMinutes(idleSec)} (${idlePct}%)`;

  activityDistChartInstance = new Chart(ctx, {
    type: 'doughnut',
    data: {
      labels: ['Active Time', 'Idle Time'],
      datasets: [{
        data: [activeSec, idleSec],
        backgroundColor: ['#10b981', '#f97316'],
        borderWidth: 0,
        hoverOffset: 4
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      cutout: '80%',
      plugins: {
        legend: {
          display: false
        },
        tooltip: {
          backgroundColor: 'rgba(15, 23, 42, 0.95)',
          titleFont: {
            family: varColor('--font-family'),
            size: 12,
            weight: 'bold'
          },
          bodyFont: {
            family: varColor('--font-family'),
            size: 12
          },
          borderColor: 'rgba(255, 255, 255, 0.1)',
          borderWidth: 1,
          padding: 8,
          callbacks: {
            label: function(context) {
              const val = context.raw;
              const pct = totalSec > 0 ? ((val / totalSec) * 100).toFixed(1) : '0';
              return ` ${formatDurationHoursMinutes(val)} (${pct}%)`;
            }
          }
        }
      }
    }
  });
}

// Render activity logs table rows
function renderTable(entries) {
  const tbody = document.getElementById('logs-table-body');
  const countEl = document.getElementById('table-logs-count');
  const emptyOverlay = document.getElementById('table-empty-overlay');
  
  if (!tbody) return;

  tbody.innerHTML = '';
  if (countEl) countEl.textContent = entries.length;

  if (entries.length === 0) {
    if (emptyOverlay) emptyOverlay.classList.remove('hidden');
    return;
  } else {
    if (emptyOverlay) emptyOverlay.classList.add('hidden');
  }

  entries.forEach(entry => {
    const tr = document.createElement('tr');
    
    // Virtual record styling (pulse highlight for active current tracking)
    if (entry.id === 'current-virtual-record') {
      tr.style.backgroundColor = 'rgba(16, 185, 129, 0.04)';
    }

    // 1. Date column
    const tdDate = document.createElement('td');
    // Extracts DD-MM-YYYY
    tdDate.textContent = entry.start_time ? entry.start_time.split(' ')[0] : '--';
    tr.appendChild(tdDate);

    // 2. Application Name column with icon badge
    const tdApp = document.createElement('td');
    const cellWrapper = document.createElement('div');
    cellWrapper.className = 'app-name-cell';

    const iconBadge = document.createElement('span');
    iconBadge.className = 'app-icon';
    
    // Resolve icon customization
    const key = entry.app_name ? entry.app_name.toLowerCase() : '';
    let style = { color: '#60a5fa', bg: 'rgba(59, 130, 246, 0.12)', text: entry.app_name ? entry.app_name[0].toUpperCase() : '?' };
    
    // Search in maps
    const matchKey = Object.keys(appStyleMap).find(k => key.includes(k));
    if (matchKey) {
      style = appStyleMap[matchKey];
    }
    
    iconBadge.style.color = style.color;
    iconBadge.style.backgroundColor = style.bg;
    iconBadge.textContent = style.text;

    const nameSpan = document.createElement('span');
    nameSpan.textContent = entry.app_name || 'Unknown';
    nameSpan.style.whiteSpace = 'nowrap';
    nameSpan.style.overflow = 'hidden';
    nameSpan.style.textOverflow = 'ellipsis';

    cellWrapper.appendChild(iconBadge);
    cellWrapper.appendChild(nameSpan);
    tdApp.appendChild(cellWrapper);
    tr.appendChild(tdApp);

    // 3. Window Title column
    const tdTitle = document.createElement('td');
    tdTitle.textContent = entry.window_title || 'Untitled';
    tdTitle.title = entry.window_title || 'Untitled';
    tr.appendChild(tdTitle);

    // 4. Start Time column
    const tdStart = document.createElement('td');
    const startTimeStr = entry.start_time ? entry.start_time.split(' ')[1] : '';
    tdStart.textContent = startTimeStr ? formatTimeToAMPM(startTimeStr) : '--';
    tr.appendChild(tdStart);

    // 5. End Time column
    const tdEnd = document.createElement('td');
    const endTimeStr = entry.end_time ? entry.end_time.split(' ')[1] : '';
    tdEnd.textContent = endTimeStr ? formatTimeToAMPM(endTimeStr) : '--';
    tr.appendChild(tdEnd);

    // 6. Duration column
    const tdDuration = document.createElement('td');
    tdDuration.textContent = formatDurationHMS(entry.duration);
    tr.appendChild(tdDuration);

    // 7. Status column badge
    const tdStatus = document.createElement('td');
    tdStatus.style.textAlign = 'center';
    
    const badge = document.createElement('span');
    if (entry.status === 'active') {
      badge.className = 'badge badge-active';
      badge.textContent = 'Active';
    } else {
      badge.className = 'badge badge-idle';
      badge.textContent = 'Idle';
    }
    
    tdStatus.appendChild(badge);
    tr.appendChild(tdStatus);

    tbody.appendChild(tr);
  });
}

// Reset all filter controls
function resetFilters() {
  document.getElementById('filter-app-name').value = 'all';
  document.getElementById('filter-status').value = 'all';
  document.getElementById('filter-search').value = '';
  
  // Reset date inputs back to today
  const todayStr = formatDateToInputString(new Date());
  document.getElementById('filter-from-date').value = todayStr;
  document.getElementById('filter-to-date').value = todayStr;

  processDashboardData();
}

// Get HSL/Variables fallback helper
function varColor(varName) {
  return getComputedStyle(document.documentElement).getPropertyValue(varName).trim();
}

// Event Bindings
document.addEventListener('DOMContentLoaded', () => {
  // 1. Initial dates
  initDefaultFilterDates();

  // 2. Fetch data
  loadDashboardData(false);

  // 3. Event listeners for inputs
  document.getElementById('filter-from-date').addEventListener('change', processDashboardData);
  document.getElementById('filter-to-date').addEventListener('change', processDashboardData);
  document.getElementById('filter-app-name').addEventListener('change', processDashboardData);
  document.getElementById('filter-status').addEventListener('change', processDashboardData);
  document.getElementById('filter-search').addEventListener('input', processDashboardData);
  
  // Limit Select for Bar Chart
  document.getElementById('bar-chart-limit').addEventListener('change', processDashboardData);

  // Reset Filters Button Click
  document.getElementById('filter-reset-btn').addEventListener('click', resetFilters);

  // Manual Refresh Button Click
  document.getElementById('manual-refresh-btn').addEventListener('click', () => {
    loadDashboardData(true);
  });

  // 4. Live update on synchronization complete hook
  if (window.api && typeof window.api.onActivitySynced === 'function') {
    window.api.onActivitySynced((data) => {
      console.log('[Dashboard Auto-Refresh] Synchronization complete event received.', data);
      loadDashboardData(false);
    });
  }
});
