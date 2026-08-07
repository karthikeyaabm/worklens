/**
 * modules/dashboard/dashboard.js
 * 
 * Core Orchestrator for the Employee Productivity Dashboard.
 * Dynamically binds and lifecycle-manages pluggable widgets based on a modular registry.
 */

// Import Services
import { ActivityService } from './services/activityService.js';
import { TaskService } from './services/taskService.js';
import { ProjectService } from './services/projectService.js';
import { DocumentService } from './services/documentService.js';
import { NotificationService } from './services/notificationService.js';
import { ReportService } from './services/reportService.js';

// Import UI Components
import { DashboardHeader } from './components/DashboardHeader.js';
import { SummaryCards } from './components/SummaryCards.js';
import { TaskList } from './components/TaskList.js';
import { ProjectWidget } from './components/ProjectWidget.js';
import { NotificationPanel } from './components/NotificationPanel.js';
import { DocumentWidget } from './components/DocumentWidget.js';
import { QuickActions } from './components/QuickActions.js';
import { ActivityWidget } from './components/ActivityWidget.js';
import { ReportsWidget } from './components/ReportsWidget.js';

// Instantiate Services (Single Source of Truth)
const services = {
  activityService: new ActivityService(),
  taskService: new TaskService(),
  projectService: new ProjectService(),
  documentService: new DocumentService(),
  notificationService: new NotificationService(),
  reportService: new ReportService()
};

// PLUGGABLE WIDGET REGISTRY
// To add/remove/reorder widgets, modify this array without touching code below.
const widgetRegistry = [
  { selector: '#header-container', componentClass: DashboardHeader },
  { selector: '#top-cards-container', componentClass: SummaryCards },
  { selector: '#tasks-container', componentClass: TaskList },
  { selector: '#projects-container', componentClass: ProjectWidget },
  { selector: '#reports-container', componentClass: ReportsWidget },
  { selector: '#actions-container', componentClass: QuickActions },
  { selector: '#activity-container', componentClass: ActivityWidget },
  { selector: '#documents-container', componentClass: DocumentWidget },
  { selector: '#notifications-container', componentClass: NotificationPanel }
];

// Active widget instances tracking
let activeWidgets = [];
let pollInterval = null;

// ================= INITIALIZATION & LIFECYCLE =================

document.addEventListener('DOMContentLoaded', () => {
  setupIpcListeners();
  setupGlobalEventListeners();
  
  if (window.api && typeof window.api.sendDashboardReady === 'function') {
    window.api.sendDashboardReady();
  } else {
    // Development fallback if opened directly in browser
    console.log('[Dev] Running in browser preview mode.');
    initializeAndRenderDashboard();
    startPolling();
  }
});

/**
 * Instantiates and renders all registered widgets.
 */
async function initializeAndRenderDashboard() {
  // Clear any existing instances
  activeWidgets.forEach(w => w.destroy());
  activeWidgets = [];

  for (const registryEntry of widgetRegistry) {
    const container = document.querySelector(registryEntry.selector);
    if (container) {
      try {
        const WidgetClass = registryEntry.componentClass;
        const instance = new WidgetClass(container, services);
        await instance.init();
        instance.render();
        activeWidgets.push(instance);
      } catch (err) {
        console.error(`Failed to load widget for ${registryEntry.selector}:`, err);
      }
    }
  }
}

/**
 * Periodically updates widgets that require live telemetry updates (e.g. activity counts).
 */
async function refreshTelemetryWidgets() {
  for (const widget of activeWidgets) {
    // Only re-init/render if the widget supports dynamic telemetry updates
    const isTelemetryDependent = 
      widget instanceof SummaryCards || 
      widget instanceof ActivityWidget || 
      widget instanceof ReportsWidget;

    if (isTelemetryDependent) {
      try {
        await widget.init();
        widget.render();
      } catch (err) {
        console.error('Error refreshing telemetry widget:', err);
      }
    }
  }
}

// ================= POLLING CONTROLLER =================

function startPolling() {
  stopPolling();
  // Poll every 3 seconds for live hardware metric updates and active time
  pollInterval = setInterval(refreshTelemetryWidgets, 3000);
}

function stopPolling() {
  if (pollInterval) {
    clearInterval(pollInterval);
    pollInterval = null;
  }
}

// ================= INTERPROCESS COMMUNICATION (IPC) =================

function setupIpcListeners() {
  if (!window.api) return;

  if (typeof window.api.onPopupStatusChanged === 'function') {
    window.api.onPopupStatusChanged(async (status) => {
      if (status === 'opened') {
        await initializeAndRenderDashboard();
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
}

function updateArrowPosition(arrowLeft, isBelow) {
  const arrowEl = document.getElementById('arrow');
  if (!arrowEl) return;

  // Center the 16px wide arrow and offset for window borders
  const adjustedLeft = arrowLeft - 18;
  arrowEl.style.left = `${adjustedLeft}px`;

  if (isBelow) {
    arrowEl.className = 'arrow arrow-up';
    arrowEl.style.top = '12px';
  } else {
    arrowEl.className = 'arrow arrow-down';
    arrowEl.style.top = '490px'; // Anchored exactly to container bottom (520px height - 30px offset = 490px)
  }
}

function initiateCloseAnimation() {
  const container = document.getElementById('popup-container');
  if (!container) return;

  container.classList.add('closing');
  container.addEventListener('animationend', function handler() {
    container.classList.remove('closing');
    container.removeEventListener('animationend', handler);

    if (window.api && typeof window.api.closeDashboardPopup === 'function') {
      window.api.closeDashboardPopup();
    }
  }, { once: true });
}

// ================= EVENTS DISPATCH HANDLING =================

function setupGlobalEventListeners() {
  // Listen for custom widgets request close event
  document.addEventListener('request-close-animation', () => {
    initiateCloseAnimation();
  });

  // Listen for custom state change broadcasts (e.g. task added)
  document.addEventListener('dashboard-data-changed', async () => {
    console.log('[Dashboard] Data change event received. Re-rendering affected widgets...');
    // Fully re-render summary cards and task grid lists
    for (const widget of activeWidgets) {
      if (widget instanceof SummaryCards || widget instanceof TaskList || widget instanceof ActivityWidget) {
        await widget.init();
        widget.render();
      }
    }
  });
}
