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
  }
});