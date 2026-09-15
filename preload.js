const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  /*fetchTimelog: async () => {
    return {
      Yesterday: "7h",
      Today: "2h"
    };
  },*/

  getUsername: async () => {
    return await ipcRenderer.invoke('get-username');
  },

  getEmployeeId: async () => {
    return await ipcRenderer.invoke('get-employee-id');
  },

  // New: open the "today's activity" detail window
  openActivityWindow: async () => {
    return await ipcRenderer.invoke('open-activity-window');
  },

  // New: fetch today's tracked app-usage + idle summary
  getActivitySummary: async () => {
    return await ipcRenderer.invoke('get-activity-summary');
  },

  // Required enhancement APIs
  getRedmineEfforts: async () => {
    return await ipcRenderer.invoke('get-redmine-efforts');
  },

  getActiveTimeToday: async () => {
    return await ipcRenderer.invoke('get-active-time-today');
  },

  getActiveTimeYesterday: async () => {
    return await ipcRenderer.invoke('get-active-time-yesterday');
  },

  getCurrentStatus: async () => {
    return await ipcRenderer.invoke('get-current-status');
  },

  getAppVersion: async () => {
    return await ipcRenderer.invoke('get-app-version');
  },

  fetchActivityLogs: async () => {
    return await ipcRenderer.invoke('fetch-activity-logs');
  },

  openDashboard: async () => {
    return await ipcRenderer.invoke('open-dashboard');
  },

  closeDashboard: async () => {
    return await ipcRenderer.invoke('close-dashboard');
  },

  showMainWindow: async () => {
    return await ipcRenderer.invoke('show-main-window');
  },

  minimizeWindow: async () => {
    return await ipcRenderer.invoke('window-minimize');
  },

  maximizeWindow: async () => {
    return await ipcRenderer.invoke('window-maximize');
  },

  isWindowMaximized: async () => {
    return await ipcRenderer.invoke('is-window-maximized');
  },

  onWindowStateChange: (callback) => {
    if (typeof callback === 'function') {
      ipcRenderer.on('window-state-changed', (_event, data) => callback(data));
    }
  },

  closeWindow: async () => {
    return await ipcRenderer.invoke('window-close');
  },

  closeInactivityPopup: async () => {
    return await ipcRenderer.invoke('close-inactivity-popup');
  },

  triggerSync: async () => {
    return await ipcRenderer.invoke('trigger-sync');
  },

  hideMainWindow: async () => {
    return await ipcRenderer.invoke('hide-main-window');
  },

  // Dynamic Dashboard Creation & API Integration
  getDashboards: async (options) => {
    return await ipcRenderer.invoke('dashboards:list', options);
  },

  getDashboard: async (id) => {
    return await ipcRenderer.invoke('dashboards:get', id);
  },

  createDashboard: async (data) => {
    return await ipcRenderer.invoke('dashboards:create', data);
  },

  updateDashboard: async (id, data) => {
    return await ipcRenderer.invoke('dashboards:update', { id, ...data });
  },

  deleteDashboard: async (id) => {
    return await ipcRenderer.invoke('dashboards:delete', id);
  },

  testDashboardApi: async (config) => {
    return await ipcRenderer.invoke('dashboards:test', config);
  },

  fetchDashboardData: async (id) => {
    return await ipcRenderer.invoke('dashboards:fetch-data', id);
  }
});