// Get Windows Logged-in Username
async function loadUsername() {
  try {
    if (!window.api || typeof window.api.getUsername !== 'function') return;

    const username = await window.api.getUsername();
    const titleElement = document.getElementById('header-title');

    if (titleElement) {
      titleElement.textContent = `${username}`;
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
  if (seconds <= 0) return '0';

  const decimalHours = seconds / 3600;

  // Agar exact integer hai (10.0) to "10h" dikhao
  if (Number.isInteger(decimalHours)) {
    return `${decimalHours}`;
  }

  // Agar decimal hai (6.5) to "6.5h" dikhao
  return `${parseFloat(decimalHours.toFixed(1))}`;
}

// Helper to format Redmine hours into clean strings
function formatRedmineHours(hours) {
  const val = parseFloat(hours);
  if (isNaN(val) || val <= 0) return '0';
  if (Number.isInteger(val)) {
    return `${val}`;
  }
  return `${val.toFixed(1)}`;
}

// Load both Redmine efforts and Active tracking metrics
async function loadWidgetData() {
  try {
    if (!window.api) return;

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
    if (typeof window.api.getActiveTimeToday === 'function') {
      const activeToday = await window.api.getActiveTimeToday();
      const activeTodayEl = document.getElementById('active-today');
      if (activeTodayEl) activeTodayEl.textContent = formatSeconds(activeToday);
    }

    // 4. Current Status (pulsing dot)
    if (typeof window.api.getCurrentStatus === 'function') {
      const status = await window.api.getCurrentStatus();
      const dotEl = document.getElementById('status-dot');
      if (dotEl) {
        if (status === 'Active') {
          dotEl.className = 'status-dot active';
          dotEl.title = 'Active';
        } else {
          dotEl.className = 'status-dot inactive';
          dotEl.title = 'Inactive';
        }
      }
    }
  } catch (error) {
    console.error('Failed to load widget data:', error);
  }
}

// Initialization on DOM load
document.addEventListener('DOMContentLoaded', () => {
  loadUsername();
  updateDateDisplay();
  loadWidgetData();

  // Refresh clock every minute
  setInterval(updateDateDisplay, 60000);

  // Refresh widget stats and status every 30 seconds
  setInterval(loadWidgetData, 30000);
});