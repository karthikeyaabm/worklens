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

  // Activity Popup APIs
  toggleActivityPopup: async () => {
    return await ipcRenderer.invoke('toggle-activity-popup');
  },

  openActivityPopup: async () => {
    return await ipcRenderer.invoke('open-activity-popup');
  },

  closeActivityPopup: async () => {
    return await ipcRenderer.invoke('close-activity-popup');
  },

  fetchActivityLogs: async () => {
    return await ipcRenderer.invoke('fetch-activity-logs');
  },

  // Activity Popup Listeners/Signals
  onPopupStatusChanged: (callback) => {
    const listener = (event, status) => callback(status);
    ipcRenderer.on('popup-status-changed', listener);
    return () => ipcRenderer.removeListener('popup-status-changed', listener);
  },

  onUpdateArrowPosition: (callback) => {
    const listener = (event, arrowLeft, isBelow) => callback(arrowLeft, isBelow);
    ipcRenderer.on('update-arrow-position', listener);
    return () => ipcRenderer.removeListener('update-arrow-position', listener);
  },

  onRequestClose: (callback) => {
    const listener = () => callback();
    ipcRenderer.on('request-close', listener);
    return () => ipcRenderer.removeListener('request-close', listener);
  },

  sendPopupReady: () => {
    ipcRenderer.invoke('popup-ready');
  },

  closeInactivityPopup: async () => {
    return await ipcRenderer.invoke('close-inactivity-popup');
  },

  triggerSync: async () => {
    return await ipcRenderer.invoke('trigger-sync');
  }
});