/**
 * WorkLens Desktop Dashboard - Controller
 * Coordinates navigation, live telemetry, Redmine metrics, task interactions, and window controls.
 */

// ================= STATE =================
const appState = {
  currentUser: 'Karthikeya',
  currentRole: 'Employee',
  activeView: 'home',
  dashboardsState: {
    dashboards: [],
    loading: false,
    error: null,
    selectedDashboardId: null,
    selectedDashboardData: null,
    dataLoading: false,
    dataError: null,
    editingDashboardId: null
  },
  tasks: [
    {
      id: 'TASK-1024',
      title: 'Update server configuration',
      type: 'IT Help Desk',
      status: 'In Progress',
      priority: 'High',
      dueDate: '08 Sep 2026',
      urgent: false
    },
    {
      id: 'TASK-1025',
      title: 'Employee Onboarding',
      type: 'Admin Help Desk',
      status: 'Pending',
      priority: 'Medium',
      dueDate: '10 Sep 2026',
      urgent: false
    },
    {
      id: 'TASK-1026',
      title: 'Sales Dashboard Bug Fix',
      type: 'Project',
      status: 'In Progress',
      priority: 'High',
      dueDate: '09 Sep 2026',
      urgent: true
    },
    {
      id: 'TASK-1027',
      title: 'Laptop Request',
      type: 'IT Help Desk',
      status: 'Completed',
      priority: 'Low',
      dueDate: '05 Sep 2026',
      urgent: false
    },
    {
      id: 'TASK-1028',
      title: 'Access Card Request',
      type: 'Admin Help Desk',
      status: 'Pending',
      priority: 'Medium',
      dueDate: '11 Sep 2026',
      urgent: false
    }
  ]
};

// ================= INITIALIZATION =================
document.addEventListener('DOMContentLoaded', () => {
  setupWindowControls();
  setupNavigation();
  setupDropdowns();
  setupSearch();
  setupQuickActions();
  setupDashboardManagement();
  loadDashboards();
  setupHashRouting();
  updateLiveDateAndGreeting();
  loadUserInfo();
  loadTelemetryMetrics();

  // Polling for live telemetry and clock updates
  setInterval(updateLiveDateAndGreeting, 60000);
  setInterval(loadLiveStatusAndActiveTime, 3000);
  setInterval(loadTelemetryMetrics, 30000);

  // Network online sync trigger
  window.addEventListener('online', () => {
    if (window.api && typeof window.api.triggerSync === 'function') {
      window.api.triggerSync().catch(err => console.error('Sync error:', err));
    }
  });
});

// ================= WINDOW CONTROLS =================
function setupWindowControls() {
  const minBtn = document.getElementById('win-min-btn');
  const maxBtn = document.getElementById('win-max-btn');
  const closeBtn = document.getElementById('win-close-btn');

  if (minBtn) {
    minBtn.addEventListener('click', () => {
      if (window.api && typeof window.api.minimizeWindow === 'function') {
        window.api.minimizeWindow();
      }
    });
  }

  const updateMaximizeBtn = (isMaximized) => {
    if (!maxBtn) return;
    if (isMaximized) {
      maxBtn.title = 'Restore';
      maxBtn.innerHTML = '<svg viewBox="0 0 12 12"><path d="M4 4V2.5h5.5v5.5H8" stroke="currentColor" stroke-width="1.2" fill="none"/><rect x="2" y="4" width="6" height="6" stroke="currentColor" stroke-width="1.2" fill="none"/></svg>';
    } else {
      maxBtn.title = 'Maximize';
      maxBtn.innerHTML = '<svg viewBox="0 0 12 12"><rect x="2" y="2" width="8" height="8" stroke="currentColor" stroke-width="1.2" fill="none"/></svg>';
    }
  };

  if (window.api && typeof window.api.isWindowMaximized === 'function') {
    window.api.isWindowMaximized().then(isMax => updateMaximizeBtn(isMax)).catch(() => {});
  }

  if (window.api && typeof window.api.onWindowStateChange === 'function') {
    window.api.onWindowStateChange((state) => {
      updateMaximizeBtn(state && state.isMaximized);
    });
  }

  if (maxBtn) {
    maxBtn.addEventListener('click', () => {
      if (window.api && typeof window.api.maximizeWindow === 'function') {
        window.api.maximizeWindow();
      }
    });
  }

  if (closeBtn) {
    closeBtn.addEventListener('click', () => {
      if (window.api && typeof window.api.closeDashboard === 'function') {
        window.api.closeDashboard();
      } else if (window.api && typeof window.api.closeWindow === 'function') {
        window.api.closeWindow();
      }
    });
  }
}

// ================= NAVIGATION =================
function setupNavigation() {
  const navButtons = document.querySelectorAll('.nav-item');

  navButtons.forEach(btn => {
    btn.addEventListener('click', () => {
      const targetView = btn.getAttribute('data-view');
      navigateToView(targetView);
    });
  });

  // Category Stat Cards Clicks
  const cardProject = document.getElementById('card-project-tasks');
  const cardIt = document.getElementById('card-it-desk');
  const cardAdmin = document.getElementById('card-admin-desk');
  const viewAllBtn = document.getElementById('view-all-tasks-btn');

  if (cardProject) {
    cardProject.style.cursor = 'pointer';
    cardProject.addEventListener('click', () => {
      navigateToView('project-tasks');
    });
  }

  if (cardIt) {
    cardIt.style.cursor = 'pointer';
    cardIt.addEventListener('click', () => {
      navigateToView('it-helpdesk');
    });
  }

  if (cardAdmin) {
    cardAdmin.style.cursor = 'pointer';
    cardAdmin.addEventListener('click', () => {
      navigateToView('admin-helpdesk');
    });
  }

  if (viewAllBtn) {
    viewAllBtn.addEventListener('click', () => {
      navigateToView('home');
    });
  }
}

function navigateToView(targetView, meta = {}) {
  appState.activeView = targetView;
  const views = {
    'home': document.getElementById('view-home'),
    'active-time': document.getElementById('view-active-time'),
    'settings': document.getElementById('view-settings'),
    'dynamic-dashboard': document.getElementById('view-dynamic-dashboard')
  };

  // Hide all primary views
  Object.values(views).forEach(v => {
    if (v) v.classList.add('hidden');
  });

  // Clear active states on all nav buttons
  document.querySelectorAll('.nav-item, .nav-item-dynamic').forEach(b => b.classList.remove('active'));

  if (targetView === 'home') {
    if (views.home) views.home.classList.remove('hidden');
    setActiveNav('home');
    filterTasksByType(null);
    updateUrlHash('#/home');
  } else if (targetView === 'active-time') {
    if (views['active-time']) views['active-time'].classList.remove('hidden');
    setActiveNav('active-time');
    loadActivityLogsList();
    updateUrlHash('#/active-time');
  } else if (targetView === 'project-tasks') {
    if (views.home) views.home.classList.remove('hidden');
    setActiveNav('project-tasks');
    filterTasksByType('Project');
    updateUrlHash('#/project-tasks');
  } else if (targetView === 'it-helpdesk') {
    if (views.home) views.home.classList.remove('hidden');
    setActiveNav('it-helpdesk');
    filterTasksByType('IT Help Desk');
    updateUrlHash('#/it-helpdesk');
  } else if (targetView === 'admin-helpdesk') {
    if (views.home) views.home.classList.remove('hidden');
    setActiveNav('admin-helpdesk');
    filterTasksByType('Admin Help Desk');
    updateUrlHash('#/admin-helpdesk');
  } else if (targetView === 'settings') {
    if (views.settings) views.settings.classList.remove('hidden');
    setActiveNav('settings');
    renderDashboardsTable();
    updateUrlHash('#/settings');
  } else if (targetView === 'dynamic-dashboard') {
    if (views['dynamic-dashboard']) views['dynamic-dashboard'].classList.remove('hidden');
    const dashId = meta.dashboardId;
    if (dashId) {
      setActiveDynamicNav(dashId);
      updateUrlHash(`#/dashboard/${dashId}`);
      fetchAndRenderDynamicDashboard(dashId);
    }
  }
}

function updateUrlHash(newHash) {
  if (window.location.hash !== newHash) {
    window.location.hash = newHash;
  }
}

function setActiveNav(dataView) {
  const navButtons = document.querySelectorAll('.nav-item');
  navButtons.forEach(btn => {
    if (btn.getAttribute('data-view') === dataView) {
      btn.classList.add('active');
    } else {
      btn.classList.remove('active');
    }
  });
}

function setActiveDynamicNav(dashboardId) {
  document.querySelectorAll('.nav-item').forEach(b => b.classList.remove('active'));
  document.querySelectorAll('.nav-item-dynamic').forEach(btn => {
    if (btn.getAttribute('data-id') === dashboardId) {
      btn.classList.add('active');
    } else {
      btn.classList.remove('active');
    }
  });
}

function setupHashRouting() {
  const handleHash = () => {
    const hash = window.location.hash || '#/home';
    if (hash.startsWith('#/dashboard/')) {
      const dashId = hash.replace('#/dashboard/', '').trim();
      if (dashId) {
        navigateToView('dynamic-dashboard', { dashboardId: dashId });
      }
    } else if (hash === '#/settings') {
      navigateToView('settings');
    } else if (hash === '#/active-time') {
      navigateToView('active-time');
    } else if (hash === '#/project-tasks') {
      navigateToView('project-tasks');
    } else if (hash === '#/it-helpdesk') {
      navigateToView('it-helpdesk');
    } else if (hash === '#/admin-helpdesk') {
      navigateToView('admin-helpdesk');
    } else {
      navigateToView('home');
    }
  };

  window.addEventListener('hashchange', handleHash);
  if (window.location.hash && window.location.hash !== '#/home') {
    handleHash();
  }
}

// ================= DROPDOWNS =================
function setupDropdowns() {
  const notifBtn = document.getElementById('notification-btn');
  const notifDropdown = document.getElementById('notifications-dropdown');
  const userBtn = document.getElementById('user-pill-btn');
  const userDropdown = document.getElementById('user-dropdown');
  const syncBtn = document.getElementById('menu-refresh-btn');
  const widgetBtn = document.getElementById('menu-widget-btn');
  const exitBtn = document.getElementById('menu-quit-btn');
  const activeRefreshBtn = document.getElementById('active-refresh-btn');

  if (notifBtn && notifDropdown) {
    notifBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      notifDropdown.classList.toggle('hidden');
      if (userDropdown) userDropdown.classList.add('hidden');
    });
  }

  if (userBtn && userDropdown) {
    userBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      userDropdown.classList.toggle('hidden');
      if (notifDropdown) notifDropdown.classList.add('hidden');
    });
  }

  document.addEventListener('click', () => {
    if (notifDropdown) notifDropdown.classList.add('hidden');
    if (userDropdown) userDropdown.classList.add('hidden');
  });

  if (widgetBtn) {
    widgetBtn.addEventListener('click', () => {
      if (window.api && typeof window.api.showMainWindow === 'function') {
        window.api.showMainWindow();
      }
    });
  }

  if (syncBtn) {
    syncBtn.addEventListener('click', async () => {
      if (window.api && typeof window.api.triggerSync === 'function') {
        await window.api.triggerSync();
        loadTelemetryMetrics();
        loadActivityLogsList();
      }
    });
  }

  if (activeRefreshBtn) {
    activeRefreshBtn.addEventListener('click', async () => {
      if (window.api && typeof window.api.triggerSync === 'function') {
        await window.api.triggerSync();
        loadTelemetryMetrics();
        loadActivityLogsList();
      }
    });
  }

  if (exitBtn) {
    exitBtn.addEventListener('click', () => {
      if (window.api && typeof window.api.closeWindow === 'function') {
        window.api.closeWindow();
      }
    });
  }
}

// ================= SEARCH =================
function setupSearch() {
  const searchInput = document.getElementById('search-input');
  if (!searchInput) return;

  searchInput.addEventListener('input', (e) => {
    const query = e.target.value.toLowerCase().trim();
    const rows = document.querySelectorAll('#tasks-tbody tr');

    rows.forEach(row => {
      const text = row.textContent.toLowerCase();
      if (!query || text.includes(query)) {
        row.style.display = '';
      } else {
        row.style.display = 'none';
      }
    });
  });
}

function filterTasksByType(type) {
  const rows = document.querySelectorAll('#tasks-tbody tr');
  rows.forEach(row => {
    const rowType = row.getAttribute('data-type');
    if (!type || rowType === type) {
      row.style.display = '';
    } else {
      row.style.display = 'none';
    }
  });
}

// ================= QUICK ACTIONS & MODAL =================
function setupQuickActions() {
  const modal = document.getElementById('task-modal');
  const closeBtn = document.getElementById('modal-close-btn');
  const cancelBtn = document.getElementById('modal-cancel-btn');
  const submitBtn = document.getElementById('modal-submit-btn');

  const btnProject = document.getElementById('btn-create-project-task');
  const btnIt = document.getElementById('btn-create-it-ticket');
  const btnAdmin = document.getElementById('btn-create-admin-ticket');

  const typeSelect = document.getElementById('task-input-type');
  const titleInput = document.getElementById('task-input-title');
  const prioritySelect = document.getElementById('task-input-priority');
  const dueInput = document.getElementById('task-input-due');

  function openModal(defaultType) {
    if (typeSelect) typeSelect.value = defaultType || 'Project';
    if (titleInput) titleInput.value = '';
    if (dueInput) {
      const d = new Date();
      d.setDate(d.getDate() + 3);
      dueInput.value = d.toISOString().split('T')[0];
    }
    if (modal) modal.classList.remove('hidden');
    if (titleInput) titleInput.focus();
  }

  function closeModal() {
    if (modal) modal.classList.add('hidden');
  }

  if (btnProject) btnProject.addEventListener('click', () => openModal('Project'));
  if (btnIt) btnIt.addEventListener('click', () => openModal('IT Help Desk'));
  if (btnAdmin) btnAdmin.addEventListener('click', () => openModal('Admin Help Desk'));

  if (closeBtn) closeBtn.addEventListener('click', closeModal);
  if (cancelBtn) cancelBtn.addEventListener('click', closeModal);

  if (submitBtn) {
    submitBtn.addEventListener('click', () => {
      const title = titleInput.value.trim();
      if (!title) {
        titleInput.focus();
        return;
      }

      const type = typeSelect.value;
      const priority = prioritySelect.value;
      const dueRaw = dueInput.value;
      const dueDate = dueRaw ? formatDateForTable(dueRaw) : '15 Sep 2026';
      const newId = `TASK-${1029 + appState.tasks.length - 5}`;

      const newTask = {
        id: newId,
        title,
        type,
        status: 'Pending',
        priority,
        dueDate,
        urgent: priority === 'High'
      };

      appState.tasks.unshift(newTask);
      renderTasksTable();
      updateStatCounters();
      closeModal();
    });
  }
}

function formatDateForTable(isoDate) {
  const d = new Date(isoDate);
  const day = String(d.getDate()).padStart(2, '0');
  const month = d.toLocaleString('en-US', { month: 'short' });
  const year = d.getFullYear();
  return `${day} ${month} ${year}`;
}

function renderTasksTable() {
  const tbody = document.getElementById('tasks-tbody');
  if (!tbody) return;

  tbody.innerHTML = appState.tasks.map(task => {
    let typeClass = 'badge-type-project';
    if (task.type === 'IT Help Desk') typeClass = 'badge-type-it';
    if (task.type === 'Admin Help Desk') typeClass = 'badge-type-admin';

    let statusClass = 'badge-status-pending';
    if (task.status === 'In Progress') statusClass = 'badge-status-inprogress';
    if (task.status === 'Completed') statusClass = 'badge-status-completed';

    let dotClass = 'dot-medium';
    if (task.priority === 'High') dotClass = 'dot-high';
    if (task.priority === 'Low') dotClass = 'dot-low';

    return `
      <tr data-type="${task.type}" data-status="${task.status}">
        <td class="task-id">${task.id}</td>
        <td class="task-title">${escapeHtml(task.title)}</td>
        <td><span class="badge ${typeClass}">${escapeHtml(task.type)}</span></td>
        <td><span class="badge ${statusClass}">${escapeHtml(task.status)}</span></td>
        <td><span class="priority-cell"><span class="dot ${dotClass}"></span>${task.priority}</span></td>
        <td class="task-date ${task.urgent ? 'text-urgent' : ''}">${task.dueDate}</td>
        <td><button class="action-btn" title="Options">···</button></td>
      </tr>
    `;
  }).join('');
}

function updateStatCounters() {
  const projectCount = appState.tasks.filter(t => t.type === 'Project').length + 11; // base seed count
  const itCount = appState.tasks.filter(t => t.type === 'IT Help Desk').length + 3;
  const adminCount = appState.tasks.filter(t => t.type === 'Admin Help Desk').length + 6;

  const projectEl = document.getElementById('stat-project-count');
  const itEl = document.getElementById('stat-it-count');
  const adminEl = document.getElementById('stat-admin-count');

  if (projectEl) projectEl.textContent = projectCount;
  if (itEl) itEl.textContent = itCount;
  if (adminEl) adminEl.textContent = adminCount;
}

// ================= USER & GREETING =================
async function loadUserInfo() {
  try {
    if (!window.api || typeof window.api.getUsername !== 'function') return;

    const result = await window.api.getUsername();
    let name = 'Karthikeya';

    if (result && result.username && !result.error) {
      name = result.username;
    }

    appState.currentUser = name;
    const initials = extractInitials(name);

    // Update avatar elements
    const sideAvatar = document.getElementById('sidebar-user-avatar');
    const topAvatar = document.getElementById('topbar-user-avatar');
    if (sideAvatar) sideAvatar.textContent = initials;
    if (topAvatar) topAvatar.textContent = initials;

    // Update name labels
    const sideName = document.getElementById('sidebar-user-name');
    const topName = document.getElementById('topbar-user-name');
    const welcomeName = document.getElementById('welcome-name');
    const menuUserName = document.getElementById('menu-user-name');

    if (sideName) sideName.textContent = name;
    if (topName) topName.textContent = name;
    if (welcomeName) welcomeName.textContent = name;
    if (menuUserName) menuUserName.textContent = name;
  } catch (err) {
    console.error('Failed to load user info:', err);
  }
}

function extractInitials(name) {
  if (!name) return 'KK';
  const parts = name.trim().split(/[\s._-]+/);
  if (parts.length >= 2) {
    return (parts[0][0] + parts[1][0]).toUpperCase();
  }
  return name.slice(0, 2).toUpperCase();
}

function updateLiveDateAndGreeting() {
  const dateEl = document.getElementById('current-date-badge');
  const welcomeTitle = document.querySelector('.welcome-title');
  const now = new Date();

  // Format: "Mon, 8 Sep 2026"
  const weekday = now.toLocaleDateString('en-US', { weekday: 'short' });
  const day = now.getDate();
  const month = now.toLocaleDateString('en-US', { month: 'short' });
  const year = now.getFullYear();

  if (dateEl) {
    dateEl.textContent = `${weekday}, ${day} ${month} ${year}`;
  }

  // Greeting based on time of day
  const hour = now.getHours();
  let greeting = 'Good Morning';
  if (hour >= 12 && hour < 17) {
    greeting = 'Good Afternoon';
  } else if (hour >= 17) {
    greeting = 'Good Evening';
  }

  if (welcomeTitle) {
    welcomeTitle.innerHTML = `${greeting}, <span id="welcome-name">${escapeHtml(appState.currentUser)}</span>! 👋`;
  }
}

// ================= TELEMETRY METRICS =================
async function loadTelemetryMetrics() {
  try {
    if (!window.api) return;

    // 1. Redmine efforts
    if (typeof window.api.getRedmineEfforts === 'function') {
      const redmineData = await window.api.getRedmineEfforts();
      const rTodayEl = document.getElementById('redmine-effort-today-val');
      const rYesterdayEl = document.getElementById('redmine-effort-yesterday-val');

      if (rTodayEl) rTodayEl.textContent = formatHours(redmineData.today);
      if (rYesterdayEl) rYesterdayEl.textContent = formatHours(redmineData.yesterday);
    }

    // 2. Active time yesterday
    if (typeof window.api.getActiveTimeYesterday === 'function') {
      const secYesterday = await window.api.getActiveTimeYesterday();
      const aYesterdayEl = document.getElementById('active-time-yesterday-val');
      if (aYesterdayEl) aYesterdayEl.textContent = formatSecondsToHours(secYesterday);
    }

    // 3. Status & Active time today
    await loadLiveStatusAndActiveTime();
  } catch (err) {
    console.error('Failed to load telemetry metrics:', err);
  }
}

async function loadLiveStatusAndActiveTime() {
  try {
    if (!window.api) return;

    // Active time today
    if (typeof window.api.getActiveTimeToday === 'function') {
      const secToday = await window.api.getActiveTimeToday();
      const aTodayEl = document.getElementById('active-time-today-val');
      if (aTodayEl) aTodayEl.textContent = formatSecondsToHours(secToday);
    }

    // Status dot
    if (typeof window.api.getCurrentStatus === 'function') {
      const status = await window.api.getCurrentStatus();
      const dot = document.getElementById('live-status-dot');
      const text = document.getElementById('live-status-text');

      if (dot && text) {
        if (status === 'Active') {
          dot.className = 'status-pulse-dot active';
          text.textContent = 'Active (Online)';
        } else if (status === 'Offline') {
          dot.className = 'status-pulse-dot offline';
          text.textContent = 'Active (Offline)';
        } else {
          dot.className = 'status-pulse-dot inactive';
          text.textContent = 'Inactive';
        }
      }
    }
  } catch (err) {
    console.error('Error polling live status:', err);
  }
}

// ================= ACTIVITY LOGS LIST (TAB 2) =================
async function loadActivityLogsList() {
  const tbody = document.getElementById('activity-log-tbody');
  const countBadge = document.getElementById('log-count-badge');
  if (!tbody) return;

  try {
    if (!window.api || typeof window.api.fetchActivityLogs !== 'function') {
      tbody.innerHTML = `<tr><td colspan="5" class="empty-cell">Telemetry API unavailable</td></tr>`;
      return;
    }

    const res = await window.api.fetchActivityLogs();
    const logs = Array.isArray(res) ? res : (res && res.logs ? (Array.isArray(res.logs) ? res.logs : res.logs.entries || []) : []);
    const icons = (res && res.icons) || {};

    if (!logs || logs.length === 0) {
      tbody.innerHTML = `<tr><td colspan="5" class="empty-cell">No application activity recorded yet today. Active tracking is running.</td></tr>`;
      if (countBadge) countBadge.textContent = '0 applications recorded';
      return;
    }

    // Aggregate by application name
    const appMap = {};
    let totalSec = 0;

    logs.forEach(item => {
      const name = item.app_name || 'System / Desktop';
      const dur = Number(item.duration) || 0;
      totalSec += dur;

      if (!appMap[name]) {
        appMap[name] = {
          name,
          duration: 0,
          lastTitle: item.window_title || name,
          status: item.status || 'Active'
        };
      }
      appMap[name].duration += dur;
      if (item.window_title) {
        appMap[name].lastTitle = item.window_title;
      }
    });

    const appList = Object.values(appMap).sort((a, b) => b.duration - a.duration);
    if (countBadge) countBadge.textContent = `${appList.length} applications tracked`;

    tbody.innerHTML = appList.map(app => {
      const sharePct = totalSec > 0 ? Math.round((app.duration / totalSec) * 100) : 0;
      const iconSrc = icons[app.name.toLowerCase()];
      const iconHtml = iconSrc ? `<img src="${iconSrc}" class="app-icon-img" alt="" />` : '';

      return `
        <tr>
          <td class="task-title">${iconHtml}<strong>${escapeHtml(app.name)}</strong></td>
          <td class="task-date">${escapeHtml(app.lastTitle || '-')}</td>
          <td><span class="badge ${app.status === 'Active' ? 'badge-status-completed' : 'badge-status-pending'}">${app.status}</span></td>
          <td><strong>${formatDurationExact(app.duration)}</strong></td>
          <td>
            <div class="progress-bar-container">
              <div class="progress-bar-fill" style="width: ${sharePct}%"></div>
            </div>
            <span>${sharePct}%</span>
          </td>
        </tr>
      `;
    }).join('');
  } catch (err) {
    console.error('Error fetching activity logs for dashboard:', err);
    tbody.innerHTML = `<tr><td colspan="5" class="empty-cell">Failed to load activity logs: ${escapeHtml(err.message || 'Error')}</td></tr>`;
  }
}

// ================= FORMATTERS =================
function formatSecondsToHours(seconds) {
  if (!seconds || seconds <= 0) return '0h';
  const hours = seconds / 3600;
  if (Number.isInteger(hours)) return `${hours}h`;
  return `${parseFloat(hours.toFixed(1))}h`;
}

function formatHours(val) {
  const num = parseFloat(val);
  if (isNaN(num) || num <= 0) return '0h';
  if (Number.isInteger(num)) return `${num}h`;
  return `${num.toFixed(1)}h`;
}

function formatDurationExact(seconds) {
  if (!seconds || seconds <= 0) return '0m';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

// ================= DYNAMIC DASHBOARD MANAGEMENT =================

function setupDashboardManagement() {
  const btnOpenCreate = document.getElementById('btn-open-create-dashboard');
  const btnEmptyCreate = document.getElementById('btn-empty-create-dashboard');
  const modalCloseBtn = document.getElementById('dash-modal-close-btn');
  const modalCancelBtn = document.getElementById('dash-modal-cancel-btn');
  const modalSubmitBtn = document.getElementById('dash-modal-submit-btn');
  const modalTestBtn = document.getElementById('dash-modal-test-btn');
  const btnToggleMask = document.getElementById('dash-btn-toggle-mask');
  const authTypeSelect = document.getElementById('dash-input-auth-type');

  // Delete modal buttons
  const deleteCloseBtn = document.getElementById('dash-delete-close-btn');
  const deleteCancelBtn = document.getElementById('dash-delete-cancel-btn');
  const deleteConfirmBtn = document.getElementById('dash-delete-confirm-btn');

  // Dynamic Dashboard View Actions
  const dynRefreshBtn = document.getElementById('dyn-dash-refresh-btn');
  const dynEditBtn = document.getElementById('dyn-dash-edit-btn');
  const dynDeleteBtn = document.getElementById('dyn-dash-delete-btn');
  const dynRetryBtn = document.getElementById('dyn-dash-error-retry-btn');
  const dynErrorEditBtn = document.getElementById('dyn-dash-error-edit-btn');
  const dynRawToggleBtn = document.getElementById('dyn-raw-toggle-btn');
  const dynTableSearch = document.getElementById('dyn-table-search');

  if (btnOpenCreate) btnOpenCreate.addEventListener('click', () => openCreateDashboardModal());
  if (btnEmptyCreate) btnEmptyCreate.addEventListener('click', () => openCreateDashboardModal());

  if (modalCloseBtn) modalCloseBtn.addEventListener('click', closeDashboardModal);
  if (modalCancelBtn) modalCancelBtn.addEventListener('click', closeDashboardModal);

  if (btnToggleMask) {
    btnToggleMask.addEventListener('click', () => {
      const tokenInput = document.getElementById('dash-input-token');
      if (!tokenInput) return;
      tokenInput.type = tokenInput.type === 'password' ? 'text' : 'password';
    });
  }

  if (authTypeSelect) {
    authTypeSelect.addEventListener('change', (e) => {
      handleAuthTypeChange(e.target.value);
    });
  }

  if (modalTestBtn) {
    modalTestBtn.addEventListener('click', async () => {
      await testDashboardApiInModal();
    });
  }

  if (modalSubmitBtn) {
    modalSubmitBtn.addEventListener('click', async () => {
      await handleSaveDashboard();
    });
  }

  if (deleteCloseBtn) deleteCloseBtn.addEventListener('click', closeDeleteModal);
  if (deleteCancelBtn) deleteCancelBtn.addEventListener('click', closeDeleteModal);

  if (deleteConfirmBtn) {
    deleteConfirmBtn.addEventListener('click', async () => {
      await executeDeleteDashboard();
    });
  }

  // Dynamic Dashboard View Controls
  if (dynRefreshBtn) {
    dynRefreshBtn.addEventListener('click', async () => {
      const id = appState.dashboardsState.selectedDashboardId;
      if (id) {
        dynRefreshBtn.classList.add('rotating');
        await fetchAndRenderDynamicDashboard(id);
        setTimeout(() => dynRefreshBtn.classList.remove('rotating'), 600);
      }
    });
  }

  if (dynEditBtn) {
    dynEditBtn.addEventListener('click', () => {
      const id = appState.dashboardsState.selectedDashboardId;
      if (id) openEditDashboardModal(id);
    });
  }

  if (dynDeleteBtn) {
    dynDeleteBtn.addEventListener('click', () => {
      const id = appState.dashboardsState.selectedDashboardId;
      if (id) openDeleteDashboardModal(id);
    });
  }

  if (dynRetryBtn) {
    dynRetryBtn.addEventListener('click', () => {
      const id = appState.dashboardsState.selectedDashboardId;
      if (id) fetchAndRenderDynamicDashboard(id);
    });
  }

  if (dynErrorEditBtn) {
    dynErrorEditBtn.addEventListener('click', () => {
      const id = appState.dashboardsState.selectedDashboardId;
      if (id) openEditDashboardModal(id);
    });
  }

  if (dynRawToggleBtn) {
    dynRawToggleBtn.addEventListener('click', () => {
      const rawContent = document.getElementById('dyn-raw-content');
      const toggleLabel = document.getElementById('dyn-raw-toggle-label');
      if (rawContent) {
        const isHidden = rawContent.classList.toggle('hidden');
        if (toggleLabel) toggleLabel.textContent = isHidden ? 'Expand ▼' : 'Collapse ▲';
      }
    });
  }

  if (dynTableSearch) {
    dynTableSearch.addEventListener('input', (e) => {
      filterDynamicTableRows(e.target.value);
    });
  }
}

function handleAuthTypeChange(authType) {
  const tokenGroup = document.getElementById('dash-group-token');
  const basicGroup = document.getElementById('dash-group-basic');
  const requiredStar = document.getElementById('dash-token-required-star');
  const tokenHint = document.getElementById('dash-token-hint');

  if (authType === 'none') {
    if (tokenGroup) tokenGroup.classList.add('hidden');
    if (basicGroup) basicGroup.classList.add('hidden');
  } else if (authType === 'basic') {
    if (tokenGroup) tokenGroup.classList.add('hidden');
    if (basicGroup) basicGroup.classList.remove('hidden');
  } else {
    // bearer or apikey
    if (tokenGroup) tokenGroup.classList.remove('hidden');
    if (basicGroup) basicGroup.classList.add('hidden');
    if (requiredStar) requiredStar.classList.remove('hidden');
    if (tokenHint) {
      tokenHint.textContent = authType === 'bearer'
        ? 'Bearer token will be sent in Authorization: Bearer <token> header.'
        : 'API Key will be sent in X-API-Key and Authorization headers.';
    }
  }
}

/**
 * Fetch all configured dashboards from main process.
 */
async function loadDashboards() {
  appState.dashboardsState.loading = true;
  try {
    if (window.api && typeof window.api.getDashboards === 'function') {
      const dashboards = await window.api.getDashboards();
      appState.dashboardsState.dashboards = Array.isArray(dashboards) ? dashboards : [];
    } else {
      appState.dashboardsState.dashboards = [];
    }
  } catch (err) {
    console.error('[Dashboard] Error loading dashboards list:', err);
    appState.dashboardsState.dashboards = [];
  } finally {
    appState.dashboardsState.loading = false;
    renderDynamicNavItems();
    renderDashboardsTable();
  }
}

/**
 * Render dynamic custom dashboards in the sidebar navigation without reloading the page.
 */
function renderDynamicNavItems() {
  const container = document.getElementById('dynamic-dashboards-container');
  const divider = document.getElementById('dynamic-dashboards-divider');
  const header = document.getElementById('dynamic-dashboards-header');

  if (!container) return;

  const dashboards = appState.dashboardsState.dashboards;

  if (!dashboards || dashboards.length === 0) {
    container.innerHTML = '';
    if (divider) divider.style.display = 'none';
    if (header) header.style.display = 'none';
    return;
  }

  if (divider) divider.style.display = 'block';
  if (header) header.style.display = 'block';

  container.innerHTML = dashboards.map(d => {
    const isError = d.status === 'error';
    return `
      <button class="nav-item-dynamic ${isError ? 'status-error' : ''}" data-id="${d.id}" id="dyn-nav-${d.id}" title="${escapeHtml(d.name)}">
        <div class="nav-item-left">
          <span class="dynamic-dash-dot"></span>
          <span class="nav-label">${escapeHtml(d.name)}</span>
        </div>
        <span class="nav-badge-pill">${escapeHtml(d.method || 'GET')}</span>
      </button>
    `;
  }).join('');

  // Bind click handlers to dynamic navigation items
  container.querySelectorAll('.nav-item-dynamic').forEach(btn => {
    btn.addEventListener('click', () => {
      const id = btn.getAttribute('data-id');
      navigateToView('dynamic-dashboard', { dashboardId: id });
    });
  });
}

/**
 * Render dashboards table in the Settings view.
 */
function renderDashboardsTable() {
  const tbody = document.getElementById('dashboards-tbody');
  const tableContainer = document.getElementById('dashboards-table-container');
  const emptyState = document.getElementById('dashboards-empty-state');

  if (!tbody) return;

  const dashboards = appState.dashboardsState.dashboards;

  if (!dashboards || dashboards.length === 0) {
    if (tableContainer) tableContainer.classList.add('hidden');
    if (emptyState) emptyState.classList.remove('hidden');
    return;
  }

  if (tableContainer) tableContainer.classList.remove('hidden');
  if (emptyState) emptyState.classList.add('hidden');

  tbody.innerHTML = dashboards.map(d => {
    const isConnected = d.status === 'connected';
    const statusBadgeClass = isConnected ? 'badge-status-completed' : 'badge-type-admin';
    const statusText = isConnected ? 'Connected' : (d.status === 'error' ? 'Connection Failed' : 'Pending');

    let authLabel = 'None';
    if (d.auth_type === 'bearer') authLabel = 'Bearer Token';
    else if (d.auth_type === 'apikey') authLabel = 'API Key';
    else if (d.auth_type === 'basic') authLabel = 'Basic Auth';

    return `
      <tr data-dashboard-id="${d.id}">
        <td class="task-title">
          <strong>${escapeHtml(d.name)}</strong>
        </td>
        <td class="task-date font-mono" title="${escapeHtml(d.endpoint)}">
          ${escapeHtml(truncateEndpoint(d.endpoint, 42))}
        </td>
        <td>
          <span class="badge badge-type-it">${escapeHtml(d.method || 'GET')}</span>
        </td>
        <td>
          <span class="badge ${d.auth_type !== 'none' ? 'badge-type-project' : 'badge-status-pending'}">${authLabel}</span>
        </td>
        <td>
          <span class="badge ${statusBadgeClass}">${statusText}</span>
        </td>
        <td>
          <div class="action-btn-group">
            <button class="action-btn-sm" data-action="test" data-id="${d.id}" title="Test API Connection">Test</button>
            <button class="action-btn-sm" data-action="view" data-id="${d.id}" title="Open Dashboard">View</button>
            <button class="action-btn-sm" data-action="edit" data-id="${d.id}" title="Edit Dashboard">Edit</button>
            <button class="action-btn-sm text-danger" data-action="delete" data-id="${d.id}" title="Delete Dashboard">Delete</button>
          </div>
        </td>
      </tr>
    `;
  }).join('');

  // Bind row action buttons
  tbody.querySelectorAll('button[data-action]').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const action = btn.getAttribute('data-action');
      const id = btn.getAttribute('data-id');

      if (action === 'test') {
        await handleTestExistingDashboard(id, btn);
      } else if (action === 'view') {
        navigateToView('dynamic-dashboard', { dashboardId: id });
      } else if (action === 'edit') {
        openEditDashboardModal(id);
      } else if (action === 'delete') {
        openDeleteDashboardModal(id);
      }
    });
  });
}

function truncateEndpoint(url, maxLen = 40) {
  if (!url) return '';
  if (url.length <= maxLen) return url;
  return url.slice(0, maxLen) + '...';
}

/**
 * Open Create Dashboard Modal
 */
function openCreateDashboardModal() {
  appState.dashboardsState.editingDashboardId = null;

  const modal = document.getElementById('dashboard-modal');
  const title = document.getElementById('dash-modal-title');
  const submitBtn = document.getElementById('dash-modal-submit-btn');

  const nameInput = document.getElementById('dash-input-name');
  const endpointInput = document.getElementById('dash-input-endpoint');
  const methodSelect = document.getElementById('dash-input-method');
  const authSelect = document.getElementById('dash-input-auth-type');
  const tokenInput = document.getElementById('dash-input-token');
  const usernameInput = document.getElementById('dash-input-username');
  const passwordInput = document.getElementById('dash-input-password');

  if (title) title.textContent = 'Create Dashboard';
  if (submitBtn) submitBtn.textContent = 'Create Dashboard';

  if (nameInput) nameInput.value = '';
  if (endpointInput) endpointInput.value = '';
  if (methodSelect) methodSelect.value = 'GET';
  if (authSelect) authSelect.value = 'apikey';
  if (tokenInput) {
    tokenInput.value = '';
    tokenInput.type = 'password';
  }
  if (usernameInput) usernameInput.value = '';
  if (passwordInput) passwordInput.value = '';

  handleAuthTypeChange('apikey');
  clearModalAlerts();

  if (modal) modal.classList.remove('hidden');
  if (nameInput) nameInput.focus();
}

/**
 * Open Edit Dashboard Modal
 */
function openEditDashboardModal(id) {
  const d = appState.dashboardsState.dashboards.find(item => item.id === id);
  if (!d) return;

  appState.dashboardsState.editingDashboardId = id;

  const modal = document.getElementById('dashboard-modal');
  const title = document.getElementById('dash-modal-title');
  const submitBtn = document.getElementById('dash-modal-submit-btn');

  const nameInput = document.getElementById('dash-input-name');
  const endpointInput = document.getElementById('dash-input-endpoint');
  const methodSelect = document.getElementById('dash-input-method');
  const authSelect = document.getElementById('dash-input-auth-type');
  const tokenInput = document.getElementById('dash-input-token');
  const usernameInput = document.getElementById('dash-input-username');
  const passwordInput = document.getElementById('dash-input-password');

  if (title) title.textContent = `Edit Dashboard: ${d.name}`;
  if (submitBtn) submitBtn.textContent = 'Save Changes';

  if (nameInput) nameInput.value = d.name || '';
  if (endpointInput) endpointInput.value = d.endpoint || '';
  if (methodSelect) methodSelect.value = d.method || 'GET';
  if (authSelect) authSelect.value = d.auth_type || 'none';
  if (tokenInput) {
    // If credentials already exist, leave blank with placeholder so user can keep existing or enter new
    tokenInput.value = '';
    tokenInput.placeholder = (d.credentials && d.credentials.hasToken)
      ? '•••••••• (Leave blank to keep existing key)'
      : 'Enter API key or Bearer token';
    tokenInput.type = 'password';
  }
  if (usernameInput) usernameInput.value = (d.credentials && d.credentials.username) || '';
  if (passwordInput) passwordInput.value = '';

  handleAuthTypeChange(d.auth_type || 'none');
  clearModalAlerts();

  if (modal) modal.classList.remove('hidden');
  if (nameInput) nameInput.focus();
}

function closeDashboardModal() {
  const modal = document.getElementById('dashboard-modal');
  if (modal) modal.classList.add('hidden');
  appState.dashboardsState.editingDashboardId = null;
  clearModalAlerts();
}

function clearModalAlerts() {
  const alertBox = document.getElementById('dash-form-alert');
  const testBanner = document.getElementById('dash-test-banner');
  const spinner = document.getElementById('dash-test-spinner');
  const successIcon = document.getElementById('dash-test-success-icon');
  const failIcon = document.getElementById('dash-test-fail-icon');

  if (alertBox) {
    alertBox.classList.add('hidden');
    alertBox.style.display = 'none';
  }
  if (testBanner) {
    testBanner.classList.add('hidden');
    testBanner.style.display = 'none';
  }
  if (spinner) {
    spinner.classList.add('hidden');
    spinner.style.display = 'none';
  }
  if (successIcon) {
    successIcon.classList.add('hidden');
    successIcon.style.display = 'none';
  }
  if (failIcon) {
    failIcon.classList.add('hidden');
    failIcon.style.display = 'none';
  }
}

function showFormError(message) {
  const alertBox = document.getElementById('dash-form-alert');
  const alertMsg = document.getElementById('dash-form-alert-msg');
  const testBanner = document.getElementById('dash-test-banner');

  if (testBanner) {
    testBanner.classList.add('hidden');
    testBanner.style.display = 'none';
  }
  if (alertBox && alertMsg) {
    alertMsg.textContent = message;
    alertBox.classList.remove('hidden');
    alertBox.style.display = 'flex';
  }
}

/**
 * Validate Dashboard Form Inputs
 */
function validateDashboardForm() {
  clearModalAlerts();

  const nameInput = document.getElementById('dash-input-name');
  const endpointInput = document.getElementById('dash-input-endpoint');
  const methodSelect = document.getElementById('dash-input-method');
  const authSelect = document.getElementById('dash-input-auth-type');
  const tokenInput = document.getElementById('dash-input-token');
  const usernameInput = document.getElementById('dash-input-username');
  const passwordInput = document.getElementById('dash-input-password');

  const name = nameInput ? nameInput.value.trim() : '';
  const endpoint = endpointInput ? endpointInput.value.trim() : '';
  const method = methodSelect ? methodSelect.value : 'GET';
  const authType = authSelect ? authSelect.value : 'none';
  const token = tokenInput ? tokenInput.value.trim() : '';
  const username = usernameInput ? usernameInput.value.trim() : '';
  const password = passwordInput ? passwordInput.value.trim() : '';

  // 1. Dashboard Name validation
  if (!name) {
    showFormError('Dashboard name is required.');
    if (nameInput) nameInput.focus();
    return null;
  }

  if (name.length < 2 || name.length > 50) {
    showFormError('Dashboard name must be between 2 and 50 characters.');
    if (nameInput) nameInput.focus();
    return null;
  }

  const isEditing = Boolean(appState.dashboardsState.editingDashboardId);
  const existingWithSameName = appState.dashboardsState.dashboards.find(
    d => d.name.toLowerCase() === name.toLowerCase() &&
         (!isEditing || d.id !== appState.dashboardsState.editingDashboardId)
  );

  if (existingWithSameName) {
    showFormError('A dashboard with this name already exists.');
    if (nameInput) nameInput.focus();
    return null;
  }

  // 2. API Endpoint validation
  if (!endpoint) {
    showFormError('API endpoint is required.');
    if (endpointInput) endpointInput.focus();
    return null;
  }

  try {
    const urlObj = new URL(endpoint);
    if (urlObj.protocol !== 'http:' && urlObj.protocol !== 'https:') {
      showFormError('Please enter a valid HTTP or HTTPS API endpoint.');
      if (endpointInput) endpointInput.focus();
      return null;
    }
  } catch {
    showFormError('Please enter a valid API endpoint.');
    if (endpointInput) endpointInput.focus();
    return null;
  }

  // 3. API Key / Token validation
  if ((authType === 'apikey' || authType === 'bearer') && !token) {
    // If editing and already has token, token is optional
    if (isEditing) {
      const existing = appState.dashboardsState.dashboards.find(d => d.id === appState.dashboardsState.editingDashboardId);
      if (!existing || !existing.credentials || !existing.credentials.hasToken) {
        showFormError('API key is required.');
        if (tokenInput) tokenInput.focus();
        return null;
      }
    } else {
      showFormError('API key is required.');
      if (tokenInput) tokenInput.focus();
      return null;
    }
  }

  return {
    name,
    endpoint,
    method,
    authType,
    token,
    username,
    password
  };
}

/**
 * Standalone Test Button inside the Create/Edit Modal
 */
async function testDashboardApiInModal() {
  const formData = validateDashboardForm();
  if (!formData) return;

  const testBanner = document.getElementById('dash-test-banner');
  const spinner = document.getElementById('dash-test-spinner');
  const successIcon = document.getElementById('dash-test-success-icon');
  const failIcon = document.getElementById('dash-test-fail-icon');
  const bannerMsg = document.getElementById('dash-test-banner-msg');

  if (testBanner && bannerMsg) {
    testBanner.className = 'modal-alert-box alert-info';
    testBanner.classList.remove('hidden');
    testBanner.style.display = 'flex';
    if (spinner) {
      spinner.classList.remove('hidden');
      spinner.style.display = 'inline-block';
    }
    if (successIcon) {
      successIcon.classList.add('hidden');
      successIcon.style.display = 'none';
    }
    if (failIcon) {
      failIcon.classList.add('hidden');
      failIcon.style.display = 'none';
    }
    bannerMsg.textContent = 'Testing API...';
  }

  try {
    let result = { success: false };
    if (window.api && typeof window.api.testDashboardApi === 'function') {
      result = await window.api.testDashboardApi(formData);
    }

    if (spinner) {
      spinner.classList.add('hidden');
      spinner.style.display = 'none';
    }

    if (result.success) {
      testBanner.className = 'modal-alert-box alert-success';
      testBanner.classList.remove('hidden');
      testBanner.style.display = 'flex';
      if (successIcon) {
        successIcon.classList.remove('hidden');
        successIcon.style.display = 'inline-block';
      }
      if (failIcon) {
        failIcon.classList.add('hidden');
        failIcon.style.display = 'none';
      }
      bannerMsg.textContent = 'API connection successful';
    } else {
      testBanner.className = 'modal-alert-box alert-error';
      testBanner.classList.remove('hidden');
      testBanner.style.display = 'flex';
      if (failIcon) {
        failIcon.classList.remove('hidden');
        failIcon.style.display = 'inline-block';
      }
      if (successIcon) {
        successIcon.classList.add('hidden');
        successIcon.style.display = 'none';
      }
      bannerMsg.textContent = result.message || 'Unable to connect to API. Please check the endpoint and authentication details.';
    }
  } catch (err) {
    if (spinner) {
      spinner.classList.add('hidden');
      spinner.style.display = 'none';
    }
    testBanner.className = 'modal-alert-box alert-error';
    testBanner.classList.remove('hidden');
    testBanner.style.display = 'flex';
    if (failIcon) {
      failIcon.classList.remove('hidden');
      failIcon.style.display = 'inline-block';
    }
    if (successIcon) {
      successIcon.classList.add('hidden');
      successIcon.style.display = 'none';
    }
    bannerMsg.textContent = 'Unable to connect to API. Please check the endpoint and authentication details.';
  }
}

/**
 * Handle form submission: validates form, tests API connection, and saves dashboard.
 */
async function handleSaveDashboard() {
  const formData = validateDashboardForm();
  if (!formData) return;

  const submitBtn = document.getElementById('dash-modal-submit-btn');
  const testBanner = document.getElementById('dash-test-banner');
  const spinner = document.getElementById('dash-test-spinner');
  const successIcon = document.getElementById('dash-test-success-icon');
  const failIcon = document.getElementById('dash-test-fail-icon');
  const bannerMsg = document.getElementById('dash-test-banner-msg');

  // Show "Testing API..." state
  if (submitBtn) submitBtn.disabled = true;
  if (testBanner && bannerMsg) {
    testBanner.className = 'modal-alert-box alert-info';
    testBanner.classList.remove('hidden');
    testBanner.style.display = 'flex';
    if (spinner) {
      spinner.classList.remove('hidden');
      spinner.style.display = 'inline-block';
    }
    if (successIcon) {
      successIcon.classList.add('hidden');
      successIcon.style.display = 'none';
    }
    if (failIcon) {
      failIcon.classList.add('hidden');
      failIcon.style.display = 'none';
    }
    bannerMsg.textContent = 'Testing API...';
  }

  let testResult = { success: false };
  try {
    if (window.api && typeof window.api.testDashboardApi === 'function') {
      testResult = await window.api.testDashboardApi(formData);
    }
  } catch (err) {
    testResult = { success: false, message: err.message };
  }

  if (!testResult.success) {
    if (submitBtn) submitBtn.disabled = false;
    if (spinner) {
      spinner.classList.add('hidden');
      spinner.style.display = 'none';
    }
    if (testBanner) {
      testBanner.className = 'modal-alert-box alert-error';
      testBanner.classList.remove('hidden');
      testBanner.style.display = 'flex';
    }
    if (failIcon) {
      failIcon.classList.remove('hidden');
      failIcon.style.display = 'inline-block';
    }
    if (successIcon) {
      successIcon.classList.add('hidden');
      successIcon.style.display = 'none';
    }
    if (bannerMsg) bannerMsg.textContent = testResult.message || 'Unable to connect to API. Please check the endpoint and authentication details.';
    return; // Do NOT save invalid dashboard
  }

  // API is successful!
  if (spinner) {
    spinner.classList.add('hidden');
    spinner.style.display = 'none';
  }
  if (testBanner) {
    testBanner.className = 'modal-alert-box alert-success';
    testBanner.classList.remove('hidden');
    testBanner.style.display = 'flex';
  }
  if (successIcon) {
    successIcon.classList.remove('hidden');
    successIcon.style.display = 'inline-block';
  }
  if (failIcon) {
    failIcon.classList.add('hidden');
    failIcon.style.display = 'none';
  }
  if (bannerMsg) bannerMsg.textContent = 'API connection successful';

  const isEditing = Boolean(appState.dashboardsState.editingDashboardId);
  try {
    let savedDashboard = null;
    if (isEditing) {
      const id = appState.dashboardsState.editingDashboardId;
      savedDashboard = await window.api.updateDashboard(id, formData);
      showToast(`Dashboard "${formData.name}" updated successfully!`, 'success');
    } else {
      savedDashboard = await window.api.createDashboard(formData);
      showToast(`Dashboard "${formData.name}" created successfully!`, 'success');
    }

    // Refresh dashboards state
    await loadDashboards();

    closeDashboardModal();

    // Auto-navigate to the newly created / updated dashboard
    if (savedDashboard && savedDashboard.id) {
      navigateToView('dynamic-dashboard', { dashboardId: savedDashboard.id });
    }
  } catch (saveErr) {
    console.error('[Dashboard] Error saving configuration:', saveErr);
    showFormError(saveErr.message || 'Failed to save dashboard configuration.');
  } finally {
    if (submitBtn) submitBtn.disabled = false;
  }
}

/**
 * Handle testing an existing dashboard from the Settings table.
 */
async function handleTestExistingDashboard(id, buttonEl) {
  const d = appState.dashboardsState.dashboards.find(item => item.id === id);
  if (!d) return;

  const originalText = buttonEl.textContent;
  buttonEl.textContent = 'Testing...';
  buttonEl.disabled = true;

  try {
    const res = await window.api.fetchDashboardData(id);
    if (res.success) {
      showToast(`Connection to "${d.name}" succeeded!`, 'success');
      await loadDashboards();
    } else {
      showToast(`Connection failed: ${res.error || 'Network error'}`, 'error');
      await loadDashboards();
    }
  } catch (err) {
    showToast(`Connection error: ${err.message || 'Could not reach server'}`, 'error');
  } finally {
    buttonEl.textContent = originalText;
    buttonEl.disabled = false;
  }
}

/**
 * Delete Confirmation Modal
 */
let pendingDeleteDashboardId = null;

function openDeleteDashboardModal(id) {
  const d = appState.dashboardsState.dashboards.find(item => item.id === id);
  if (!d) return;

  pendingDeleteDashboardId = id;
  const modal = document.getElementById('dashboard-delete-modal');
  const targetLabel = document.getElementById('delete-dash-name-target');

  if (targetLabel) targetLabel.textContent = `"${d.name}"`;
  if (modal) modal.classList.remove('hidden');
}

function closeDeleteModal() {
  const modal = document.getElementById('dashboard-delete-modal');
  if (modal) modal.classList.add('hidden');
  pendingDeleteDashboardId = null;
}

async function executeDeleteDashboard() {
  const id = pendingDeleteDashboardId;
  if (!id) return;

  const confirmBtn = document.getElementById('dash-delete-confirm-btn');
  if (confirmBtn) confirmBtn.disabled = true;

  try {
    await window.api.deleteDashboard(id);
    closeDeleteModal();
    showToast('Dashboard deleted successfully.', 'info');

    // Reload dashboards list
    await loadDashboards();

    // If currently viewing the deleted dashboard, redirect to Settings
    if (appState.activeView === 'dynamic-dashboard' && appState.dashboardsState.selectedDashboardId === id) {
      navigateToView('settings');
    }
  } catch (err) {
    console.error('[Dashboard] Error deleting dashboard:', err);
    showToast(`Failed to delete dashboard: ${err.message || 'Error'}`, 'error');
  } finally {
    if (confirmBtn) confirmBtn.disabled = false;
  }
}

// ================= DYNAMIC DASHBOARD DATA FETCHING & RENDERING =================

/**
 * Load dashboard configuration and fetch API data for dynamic dashboard view.
 */
async function fetchAndRenderDynamicDashboard(dashboardId) {
  appState.dashboardsState.selectedDashboardId = dashboardId;

  const titleEl = document.getElementById('dyn-dash-title');
  const endpointEl = document.getElementById('dyn-dash-endpoint');
  const statusPill = document.getElementById('dyn-dash-status-pill');
  const statusDot = document.getElementById('dyn-dash-status-dot');
  const statusText = document.getElementById('dyn-dash-status-text');

  const loadingEl = document.getElementById('dyn-dash-loading');
  const errorCard = document.getElementById('dyn-dash-error');
  const contentBody = document.getElementById('dyn-dash-content');

  // Reset UI states
  if (loadingEl) loadingEl.classList.remove('hidden');
  if (errorCard) errorCard.classList.add('hidden');
  if (contentBody) contentBody.classList.add('hidden');

  const d = appState.dashboardsState.dashboards.find(item => item.id === dashboardId);
  if (d) {
    if (titleEl) titleEl.textContent = d.name;
    if (endpointEl) endpointEl.textContent = `${d.method || 'GET'} ${d.endpoint}`;
  }

  try {
    if (!window.api || typeof window.api.fetchDashboardData !== 'function') {
      throw new Error('Dashboard Data API is unavailable in this environment.');
    }

    const response = await window.api.fetchDashboardData(dashboardId);

    if (loadingEl) loadingEl.classList.add('hidden');

    if (!response.success) {
      if (statusDot) statusDot.className = 'status-pulse-dot offline';
      if (statusText) statusText.textContent = 'Error';
      if (errorCard) {
        errorCard.classList.remove('hidden');
        const errTitle = document.getElementById('dyn-dash-error-title');
        const errDesc = document.getElementById('dyn-dash-error-desc');
        if (errTitle) errTitle.textContent = `Unable to connect to ${d ? d.name : 'API'}`;
        if (errDesc) errDesc.textContent = response.error || 'Please verify the endpoint and credentials.';
      }
      return;
    }

    // Success state
    if (statusDot) statusDot.className = 'status-pulse-dot active';
    if (statusText) statusText.textContent = 'Connected';

    if (contentBody) contentBody.classList.remove('hidden');

    renderGenericApiData(response.data);
  } catch (err) {
    console.error('[Dashboard] Error fetching dynamic dashboard data:', err);
    if (loadingEl) loadingEl.classList.add('hidden');
    if (errorCard) {
      errorCard.classList.remove('hidden');
      const errTitle = document.getElementById('dyn-dash-error-title');
      const errDesc = document.getElementById('dyn-dash-error-desc');
      if (errTitle) errTitle.textContent = 'Connection Error';
      if (errDesc) errDesc.textContent = err.message || 'Network request failed.';
    }
    if (statusDot) statusDot.className = 'status-pulse-dot offline';
    if (statusText) statusText.textContent = 'Error';
  }
}

/**
 * Generic API Data Renderer:
 * Parses variable JSON structures into:
 * 1. Numeric KPI cards
 * 2. Data Table (with search and auto columns)
 * 3. Key/Value Property Grid
 * 4. Raw JSON Inspector
 */
function renderGenericApiData(data) {
  if (data === undefined || data === null) {
    data = {};
  }

  // 1. Raw JSON Inspector
  const rawBlock = document.getElementById('dyn-raw-json');
  if (rawBlock) {
    rawBlock.textContent = typeof data === 'object' ? JSON.stringify(data, null, 2) : String(data);
  }

  // 2. Numeric KPI Extraction
  renderKpiCards(data);

  // 3. Array Data Table Extraction
  renderDynamicTable(data);

  // 4. Object Key-Value Attributes Grid
  renderKeyValues(data);
}

/**
 * Extract numeric counters for top KPI cards.
 */
function renderKpiCards(data) {
  const kpiGrid = document.getElementById('dyn-dash-kpi-grid');
  if (!kpiGrid) return;

  const kpis = [];

  // Check top-level numeric properties or summary objects
  function extractNumbers(obj, prefix = '') {
    if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return;
    Object.keys(obj).forEach(key => {
      const val = obj[key];
      if (typeof val === 'number') {
        kpis.push({
          label: formatKeyToTitle(prefix ? `${prefix} ${key}` : key),
          value: val
        });
      } else if (val && typeof val === 'object' && !Array.isArray(val) && ['summary', 'stats', 'totals', 'counts', 'metrics'].includes(key.toLowerCase())) {
        extractNumbers(val, key);
      }
    });
  }

  if (typeof data === 'object' && !Array.isArray(data)) {
    extractNumbers(data);
  } else if (Array.isArray(data)) {
    kpis.push({ label: 'Total Records', value: data.length });
  }

  if (kpis.length === 0) {
    kpiGrid.classList.add('hidden');
    kpiGrid.innerHTML = '';
    return;
  }

  kpiGrid.classList.remove('hidden');

  // Limit to top 6 KPIs
  const visibleKpis = kpis.slice(0, 6);
  const colors = ['blue', 'purple', 'green', 'amber', 'cyan'];

  kpiGrid.innerHTML = visibleKpis.map((kpi, idx) => {
    const color = colors[idx % colors.length];
    return `
      <div class="stat-card">
        <div class="stat-icon-box ${color}">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <polyline points="22 12 18 12 15 21 9 3 6 12 2 12"></polyline>
          </svg>
        </div>
        <div class="stat-info">
          <span class="stat-number">${kpi.value.toLocaleString()}</span>
          <span class="stat-label">${escapeHtml(kpi.label)}</span>
        </div>
      </div>
    `;
  }).join('');
}

/**
 * Extract tabular records from array payloads.
 */
let cachedDynamicRows = [];

function renderDynamicTable(data) {
  const tableCard = document.getElementById('dyn-dash-table-card');
  const thead = document.getElementById('dyn-table-thead');
  const tbody = document.getElementById('dyn-table-tbody');
  const countBadge = document.getElementById('dyn-table-count');
  const titleEl = document.getElementById('dyn-table-title');

  if (!tableCard || !thead || !tbody) return;

  let records = null;
  let title = 'Data Records';

  if (Array.isArray(data)) {
    records = data;
  } else if (data && typeof data === 'object') {
    // Look for common array properties
    const candidateKeys = ['tickets', 'items', 'data', 'records', 'issues', 'tasks', 'users', 'entries', 'rows', 'list', 'events'];
    for (const key of candidateKeys) {
      if (Array.isArray(data[key])) {
        records = data[key];
        title = formatKeyToTitle(key);
        break;
      }
    }
    // Fallback: check any array property
    if (!records) {
      for (const [k, v] of Object.entries(data)) {
        if (Array.isArray(v) && v.length > 0 && typeof v[0] === 'object') {
          records = v;
          title = formatKeyToTitle(k);
          break;
        }
      }
    }
  }

  if (!records || records.length === 0 || typeof records[0] !== 'object' || records[0] === null) {
    tableCard.classList.add('hidden');
    cachedDynamicRows = [];
    return;
  }

  tableCard.classList.remove('hidden');
  if (titleEl) titleEl.textContent = title;
  if (countBadge) countBadge.textContent = `${records.length} items`;

  cachedDynamicRows = records;

  // Extract up to 7 sensible columns from first object
  const sample = records[0];
  const allKeys = Object.keys(sample).filter(k => typeof sample[k] !== 'object' || sample[k] === null);
  const selectedColumns = allKeys.slice(0, 7);

  // Render headers
  thead.innerHTML = `
    <tr>
      ${selectedColumns.map(col => `<th>${escapeHtml(formatKeyToTitle(col))}</th>`).join('')}
    </tr>
  `;

  // Render body rows
  renderDynamicTableRows(records, selectedColumns);
}

function renderDynamicTableRows(records, columns) {
  const tbody = document.getElementById('dyn-table-tbody');
  if (!tbody) return;

  if (records.length === 0) {
    tbody.innerHTML = `<tr><td colspan="${columns.length}" class="empty-cell">No matching records found.</td></tr>`;
    return;
  }

  // Limit display to 100 items for smooth scrolling
  const displayRecords = records.slice(0, 100);

  tbody.innerHTML = displayRecords.map(item => {
    return `
      <tr>
        ${columns.map(col => {
          const val = item[col];
          return `<td>${formatCellValue(col, val)}</td>`;
        }).join('')}
      </tr>
    `;
  }).join('');
}

function filterDynamicTableRows(query) {
  const q = String(query || '').toLowerCase().trim();
  const thead = document.getElementById('dyn-table-thead');
  const countBadge = document.getElementById('dyn-table-count');

  if (!thead || cachedDynamicRows.length === 0) return;

  const ths = thead.querySelectorAll('th');
  const columns = Array.from(ths).map(th => th.textContent.toLowerCase().replace(/\s+/g, '_'));

  // Get original keys from sample
  const sample = cachedDynamicRows[0];
  const keys = Object.keys(sample).filter(k => typeof sample[k] !== 'object' || sample[k] === null).slice(0, 7);

  const filtered = !q ? cachedDynamicRows : cachedDynamicRows.filter(row => {
    return Object.values(row).some(v => String(v).toLowerCase().includes(q));
  });

  if (countBadge) countBadge.textContent = `${filtered.length} of ${cachedDynamicRows.length}`;
  renderDynamicTableRows(filtered, keys);
}

function formatCellValue(key, val) {
  if (val === null || val === undefined) return '<span class="text-dim">-</span>';
  if (typeof val === 'boolean') {
    return val ? '<span class="badge badge-status-completed">True</span>' : '<span class="badge badge-status-pending">False</span>';
  }

  const strVal = String(val);

  // Status-like strings
  const lowerKey = key.toLowerCase();
  const lowerVal = strVal.toLowerCase();

  if (lowerKey.includes('status') || ['open', 'closed', 'resolved', 'active', 'pending', 'in progress', 'completed'].includes(lowerVal)) {
    if (lowerVal === 'closed' || lowerVal === 'completed' || lowerVal === 'resolved' || lowerVal === 'active') {
      return `<span class="badge badge-status-completed">${escapeHtml(strVal)}</span>`;
    }
    if (lowerVal === 'in progress') {
      return `<span class="badge badge-status-inprogress">${escapeHtml(strVal)}</span>`;
    }
    return `<span class="badge badge-status-pending">${escapeHtml(strVal)}</span>`;
  }

  // Priority-like strings
  if (lowerKey.includes('priority')) {
    let dotClass = 'dot-medium';
    if (lowerVal === 'high' || lowerVal === 'urgent' || lowerVal === 'critical') dotClass = 'dot-high';
    if (lowerVal === 'low') dotClass = 'dot-low';
    return `<span class="priority-cell"><span class="dot ${dotClass}"></span>${escapeHtml(strVal)}</span>`;
  }

  // ID-like strings
  if (lowerKey === 'id' || lowerKey.endsWith('_id')) {
    return `<strong class="task-id">${escapeHtml(strVal)}</strong>`;
  }

  return escapeHtml(strVal);
}

/**
 * Render scalar key/value properties in neat grid.
 */
function renderKeyValues(data) {
  const kvCard = document.getElementById('dyn-dash-kv-card');
  const kvGrid = document.getElementById('dyn-kv-grid');

  if (!kvCard || !kvGrid) return;

  if (typeof data !== 'object' || Array.isArray(data) || data === null) {
    kvCard.classList.add('hidden');
    return;
  }

  // Find non-object, non-array scalar properties (or short strings)
  const scalarEntries = Object.entries(data).filter(([k, v]) => {
    return typeof v !== 'object' && typeof v !== 'number';
  });

  if (scalarEntries.length === 0) {
    kvCard.classList.add('hidden');
    return;
  }

  kvCard.classList.remove('hidden');

  kvGrid.innerHTML = scalarEntries.slice(0, 8).map(([k, v]) => {
    return `
      <div class="kv-item">
        <span class="kv-key">${escapeHtml(formatKeyToTitle(k))}</span>
        <span class="kv-value">${escapeHtml(String(v))}</span>
      </div>
    `;
  }).join('');
}

function formatKeyToTitle(str) {
  if (!str) return '';
  return str
    .replace(/([A-Z])/g, ' $1')
    .replace(/[_-]+/g, ' ')
    .replace(/\b\w/g, char => char.toUpperCase())
    .trim();
}

/**
 * Toast Notification Utility
 */
function showToast(message, type = 'info') {
  const container = document.getElementById('toast-container');
  if (!container) return;

  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;

  let iconSvg = `
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width: 18px; height: 18px; color: #60a5fa; flex-shrink: 0;">
      <circle cx="12" cy="12" r="10"></circle>
      <line x1="12" y1="16" x2="12" y2="12"></line>
      <line x1="12" y1="8" x2="12.01" y2="8"></line>
    </svg>
  `;

  if (type === 'success') {
    iconSvg = `
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width: 18px; height: 18px; color: #34d399; flex-shrink: 0;">
        <polyline points="20 6 9 17 4 12"></polyline>
      </svg>
    `;
  } else if (type === 'error') {
    iconSvg = `
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width: 18px; height: 18px; color: #f87171; flex-shrink: 0;">
        <circle cx="12" cy="12" r="10"></circle>
        <line x1="15" y1="9" x2="9" y2="15"></line>
        <line x1="9" y1="9" x2="15" y2="15"></line>
      </svg>
    `;
  }

  toast.innerHTML = `
    ${iconSvg}
    <span>${escapeHtml(message)}</span>
  `;

  container.appendChild(toast);

  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateY(10px)';
    toast.style.transition = 'all 0.3s ease';
    setTimeout(() => toast.remove(), 300);
  }, 3500);
}

