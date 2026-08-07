// Get Windows Logged-in Username or show connection error
async function loadUsername() {
  try {
    if (!window.api || typeof window.api.getUsername !== 'function') return;

    const result = await window.api.getUsername();
    const titleElement = document.getElementById('header-title');

    if (titleElement) {
      if (result && result.error) {
        if (result.error.toLowerCase().includes('not found') || result.error.toLowerCase().includes('database')) {
          titleElement.textContent = 'User not found';
        } else if (result.error.toLowerCase().includes('waiting for account update') || result.error.toLowerCase().includes('unresolved')) {
          titleElement.textContent = 'Waiting for account update';
        } else {
          titleElement.textContent = 'Not Connected';
        }
        titleElement.style.color = '#ef4444'; // Red color to indicate connection/validation error
        titleElement.style.fontWeight = 'bold';
        titleElement.title = `${result.error}`; // Tooltip containing the full error details
      } else {
        const displayName = result && result.username ? result.username : 'Unknown User';
        titleElement.textContent = displayName;
        titleElement.style.color = '#ffffff'; // White color for successful connection
        titleElement.style.fontWeight = '500';
        titleElement.title = `Logged in as ${displayName}`;
      }
    }
  } catch (error) {
    console.error('Failed to load username:', error);
  }
}

// Function to update the date and day displays dynamically
function updateDateDisplay() {
  const dateElement = document.getElementById('date-display');
  //const dayElement = document.getElementById('day-display');

  if (!dateElement) return;

  const now = new Date();

  const dateOptions = {
    month: 'short',
    day: 'numeric',
    //year: 'numeric'
  };
  const dateString = now.toLocaleDateString('en-US', dateOptions);

  /*const dayOptions = {
    weekday: 'long'
  };*/
  //const dayString = now.toLocaleDateString('en-US', dayOptions);

  dateElement.textContent = dateString;
  //dayElement.textContent = dayString;
}

function formatSeconds(seconds) {
  if (seconds <= 0) return '0h';

  const decimalHours = seconds / 3600;

  // If exact integer (e.g. 10.0) show "10h"
  if (Number.isInteger(decimalHours)) {
    return `${decimalHours}h`;
  }

  // If decimal (e.g. 6.5) show "6.5h"
  return `${parseFloat(decimalHours.toFixed(1))}h`;
}

// Helper to format Redmine hours into clean strings
function formatRedmineHours(hours) {
  const val = parseFloat(hours);
  if (isNaN(val) || val <= 0) return '0h';
  if (Number.isInteger(val)) {
    return `${val}h`;
  }
  return `${val.toFixed(1)}h`;
}

// Get App Version
async function loadVersion() {
  try {
    if (!window.api || typeof window.api.getAppVersion !== 'function') return;

    const version = await window.api.getAppVersion();
    const versionElement = document.getElementById('version-display');

    if (versionElement) {
      versionElement.textContent = `v${version}`;
    }
  } catch (error) {
    console.error('Failed to load version:', error);
  }
}

// Load both Redmine efforts and Active tracking metrics
async function loadWidgetData() {
  try {
    if (!window.api) return;

    // Load connection status/username periodically
    await loadUsername();

    // 1. Redmine Efforts
    if (typeof window.api.getRedmineEfforts === 'function') {
      const data = await window.api.getRedmineEfforts();
      const yesterdayEl = document.getElementById('redmine-yesterday');
      const todayEl = document.getElementById('redmine-today');

      if (yesterdayEl) yesterdayEl.textContent = formatRedmineHours(data.yesterday);
      if (todayEl) todayEl.textContent = formatRedmineHours(data.today);
    }

    // 2. Active Time Yesterday
    if (typeof window.api.getActiveTimeYesterday === 'function') {
      const activeYesterday = await window.api.getActiveTimeYesterday();
      const activeYesterdayEl = document.getElementById('active-yesterday');
      if (activeYesterdayEl) activeYesterdayEl.textContent = formatSeconds(activeYesterday);
    }

    // 3. Active Time Today
    await updateActiveTimeToday();

    // 4. Current Status (pulsing dot)
    await updateStatusDot();
  } catch (error) {
    console.error('Failed to load widget data:', error);
  }
}

async function updateStatusDot() {
  try {
    if (window.api && typeof window.api.getCurrentStatus === 'function') {
      const status = await window.api.getCurrentStatus();
      const dotEl = document.getElementById('status-dot');
      if (dotEl) {
        if (status === 'Active') {
          dotEl.className = 'status-dot active';
          dotEl.title = 'Active (Online)';
        } else if (status === 'Offline') {
          dotEl.className = 'status-dot offline';
          dotEl.title = 'Active (Offline)';
        } else {
          dotEl.className = 'status-dot inactive';
          dotEl.title = 'Inactive';
        }
      }
    }
  } catch (error) {
    console.error('Failed to update status dot:', error);
  }
}

async function updateActiveTimeToday() {
  try {
    if (window.api && typeof window.api.getActiveTimeToday === 'function') {
      const activeToday = await window.api.getActiveTimeToday();
      const activeTodayEl = document.getElementById('active-today');
      if (activeTodayEl) activeTodayEl.textContent = formatSeconds(activeToday);
    }
  } catch (error) {
    console.error('Failed to update active time today:', error);
  }
}

// Initialization on DOM load
document.addEventListener('DOMContentLoaded', () => {
  loadUsername();
  loadVersion();
  updateDateDisplay();
  loadWidgetData();

  // Set pointer cursor and add click listener for Active Time card to open details popup
  const activeTimeCard = document.querySelector('.active-time-card');
  if (activeTimeCard) {
    activeTimeCard.style.cursor = 'pointer';
    activeTimeCard.addEventListener('click', () => {
      if (window.api && typeof window.api.toggleActivityPopup === 'function') {
        window.api.toggleActivityPopup();
      }
    });
  }

  // Set pointer cursor and add click listener for Timelog card to open dashboard popup
  const timelogCard = document.querySelector('.time-logs-card');
  if (timelogCard) {
    timelogCard.style.cursor = 'pointer';
    timelogCard.addEventListener('click', () => {
      if (window.api && typeof window.api.toggleDashboardPopup === 'function') {
        window.api.toggleDashboardPopup();
      }
    });
  }

  // Add click listener for widget close button to hide to system tray
  const closeBtn = document.getElementById('widget-close-btn');
  if (closeBtn) {
    closeBtn.addEventListener('click', (e) => {
      e.stopPropagation(); // Prevent triggering other click event handlers
      if (window.api && typeof window.api.hideMainWindow === 'function') {
        window.api.hideMainWindow().catch(err => console.error('Failed to hide window:', err));
      }
    });
  }

  // Refresh clock every minute
  setInterval(updateDateDisplay, 60000);

  // Refresh cheap local stats, status dot, and username status every 2 seconds
  setInterval(async () => {
    await loadUsername();
    await updateStatusDot();
    await updateActiveTimeToday();
  }, 2000);

  // Refresh server-side stats every 30 seconds
  setInterval(loadWidgetData, 30000);

  // Trigger immediate sync on network recovery
  window.addEventListener('online', () => {
    if (window.api && typeof window.api.triggerSync === 'function') {
      console.log('[Network] Browser online event detected, triggering activity sync...');
      window.api.triggerSync().catch(err => console.error('Failed to trigger sync:', err));
    }
  });
});