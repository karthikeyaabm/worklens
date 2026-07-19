// ================= DOM ELEMENTS =================
const popupContainer = document.getElementById('popup-container');
const arrowEl = document.getElementById('arrow');
const closeBtn = document.getElementById('close-btn');
const dateEl = document.getElementById('current-date');
const loadingState = document.getElementById('loading-state');
const errorState = document.getElementById('error-state');
const emptyState = document.getElementById('empty-state');
const retryBtn = document.getElementById('retry-btn');
const activityList = document.getElementById('activity-list');
const totalTimeEl = document.getElementById('total-time');

// ================= STATE VARIABLES =================
let pollInterval = null;
let renderedRows = {}; // Holds map of appName -> DOM element

// ================= INITIALIZATION =================
document.addEventListener('DOMContentLoaded', () => {
  updateDateDisplay();
  
  // Register close button click
  closeBtn.addEventListener('click', initiateCloseAnimation);
  
  // Register retry button click
  retryBtn.addEventListener('click', fetchAndRender);

  // Set up listeners from main process
  if (window.api) {
    if (typeof window.api.onPopupStatusChanged === 'function') {
      window.api.onPopupStatusChanged((status) => {
        if (status === 'opened') {
          updateDateDisplay();
          startPolling();
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

    // Tell the main process that the renderer is fully loaded and ready
    window.api.sendPopupReady();
  }
});

// ================= UTILITIES & HELPERS =================
function updateDateDisplay() {
  if (!dateEl) return;
  const now = new Date();
  const options = { day: 'numeric', month: 'short', year: 'numeric' };
  // Outputs "18 Jul 2026"
  dateEl.textContent = now.toLocaleDateString('en-GB', options);
}

function formatDuration(totalSeconds) {
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);

  if (hours > 0) {
    return `${hours}h ${minutes}m`;
  }
  return `${minutes}m`;
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
  pollInterval = setInterval(fetchAndRender, 30000);
}

function stopPolling() {
  if (pollInterval) {
    clearInterval(pollInterval);
    pollInterval = null;
  }
}

// ================= API FETCH & DATA PROCESSING =================
async function fetchAndRender() {
  if (!window.api || typeof window.api.fetchActivityLogs !== 'function') return;

  // Show loading state if no rows have been rendered yet
  const hasRows = Object.keys(renderedRows).length > 0;
  if (!hasRows) {
    showState(loadingState);
  }

  try {
    const rawData = await window.api.fetchActivityLogs();
    
    // Support either { logs, icons } or raw data direct
    let logsData = rawData;
    let iconsMap = {};
    if (rawData && rawData.logs) {
      logsData = rawData.logs;
      iconsMap = rawData.icons || {};
    }
    
    // Format is { user_id, date, entries, ... } or raw array
    const logs = Array.isArray(logsData) ? logsData : (logsData?.entries || []);
    
    // Group logs by application name
    const grouped = {};
    logs.forEach(entry => {
      // API response status field matches "active"
      if (entry.status === 'active' && entry.duration > 0) {
        const appName = entry.app_name || 'Unknown';
        grouped[appName] = (grouped[appName] || 0) + entry.duration;
      }
    });

    const sortedApps = Object.keys(grouped)
      .map(name => ({ name, duration: grouped[name] }))
      .sort((a, b) => b.duration - a.duration);

    if (sortedApps.length === 0) {
      showState(emptyState);
      totalTimeEl.textContent = '0m';
      
      // Clear any rendered rows
      for (const name in renderedRows) {
        renderedRows[name].remove();
      }
      renderedRows = {};
      return;
    }

    // Hide all states and show activity list
    showState(activityList);
    
    const maxDuration = sortedApps[0].duration;
    
    // Render and reconcile rows
    reconcileRows(sortedApps, maxDuration, iconsMap);

    // Calculate and show total active duration
    const totalSeconds = sortedApps.reduce((acc, app) => acc + app.duration, 0);
    totalTimeEl.textContent = formatDuration(totalSeconds);

  } catch (error) {
    console.error('Failed to load activity details:', error);
    // Only show full screen error state if we have no loaded data
    if (Object.keys(renderedRows).length === 0) {
      showState(errorState);
    }
  }
}

function showState(visibleElement) {
  [loadingState, errorState, emptyState, activityList].forEach(el => {
    if (el) el.classList.add('hidden');
  });
  if (visibleElement) {
    visibleElement.classList.remove('hidden');
  }
}

// ================= DOM RECONCILIATION =================
function reconcileRows(sortedApps, maxDuration, iconsMap) {
  const currentAppNames = new Set(sortedApps.map(app => app.name));
  
  // 1. Remove stale rows
  for (const appName in renderedRows) {
    if (!currentAppNames.has(appName)) {
      renderedRows[appName].remove();
      delete renderedRows[appName];
    }
  }

  // 2. Add or update active rows
  sortedApps.forEach((app, index) => {
    const { name, duration } = app;
    const percentage = maxDuration > 0 ? (duration / maxDuration) * 100 : 0;
    const formattedDuration = formatDuration(duration);
    const lowerName = name.toLowerCase();
    
    let rowEl = renderedRows[name];
    
    if (!rowEl) {
      // Create new row elements
      rowEl = document.createElement('div');
      rowEl.className = 'activity-row';
      rowEl.dataset.appName = name;
      
      // Smooth fade-in staggers
      rowEl.style.animation = 'rowFadeIn 250ms ease forwards';
      rowEl.style.animationDelay = `${Math.min(index * 40, 400)}ms`;

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

      // Details Column (Name & Progress Bar)
      const detailsEl = document.createElement('div');
      detailsEl.className = 'app-details';

      const nameEl = document.createElement('div');
      nameEl.className = 'app-name';
      nameEl.textContent = name;
      nameEl.title = name;

      const progressContainer = document.createElement('div');
      progressContainer.className = 'progress-container';

      const progressBar = document.createElement('div');
      progressBar.className = 'progress-bar';
      progressBar.style.backgroundColor = getAppColor(name);
      progressBar.style.width = '0%'; // Initial width for animation trigger
      
      progressContainer.appendChild(progressBar);
      detailsEl.appendChild(nameEl);
      detailsEl.appendChild(progressContainer);

      // Duration Column
      const durationEl = document.createElement('div');
      durationEl.className = 'app-duration';
      durationEl.textContent = formattedDuration;

      rowEl.appendChild(iconEl);
      rowEl.appendChild(detailsEl);
      rowEl.appendChild(durationEl);

      activityList.appendChild(rowEl);
      renderedRows[name] = rowEl;
      
      // Animate the progress bar width from 0% to target width
      setTimeout(() => {
        progressBar.style.width = `${percentage}%`;
      }, 50);

    } else {
      // Update existing row
      // Re-order if position changed
      if (activityList.children[index] !== rowEl) {
        activityList.insertBefore(rowEl, activityList.children[index]);
      }
      
      // Update duration text
      const durationEl = rowEl.querySelector('.app-duration');
      if (durationEl && durationEl.textContent !== formattedDuration) {
        durationEl.textContent = formattedDuration;
      }

      // Update progress bar width
      const progressBar = rowEl.querySelector('.progress-bar');
      if (progressBar) {
        progressBar.style.width = `${percentage}%`;
      }

      // Update icon if it wasn't rendered as an image before but now has one
      const iconEl = rowEl.querySelector('.app-icon-container');
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
    }
  });
}

// ================= THEME AND VISUALS =================
function getAppColor(appName) {
  const name = appName.toLowerCase();
  if (name.includes('chrome')) return '#2dd4bf'; // Teal
  if (name.includes('code') || name.includes('vscode')) return '#3b82f6'; // Blue
  if (name.includes('word') || name.includes('winword')) return '#1d4ed8'; // Microsoft Word Blue
  if (name.includes('excel')) return '#10b981'; // Excel Green
  if (name.includes('slack')) return '#a855f7'; // Slack Purple
  if (name.includes('spotify')) return '#22c55e'; // Spotify Green
  if (name.includes('notepad')) return '#eab308'; // Notepad Yellow
  if (name.includes('edge') || name.includes('msedge')) return '#06b6d4'; // Edge Cyan
  if (name.includes('firefox')) return '#f97316'; // Firefox Orange
  if (name.includes('terminal') || name.includes('cmd') || name.includes('powershell')) return '#10b981'; // Terminal Green
  return '#9ca3af'; // Fallback Gray
}

function getAppIconSvg(appName) {
  const name = appName.toLowerCase();
  
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
  
  if (name.includes('code') || name.includes('vscode')) {
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
