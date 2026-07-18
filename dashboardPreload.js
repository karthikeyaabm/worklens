const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  getDashboardData: async () => {
    return await ipcRenderer.invoke('get-dashboard-data');
  },

  getAppVersion: async () => {
    return await ipcRenderer.invoke('get-app-version');
  },

  onActivitySynced: (callback) => {
    ipcRenderer.on('activity-synced', (event, data) => callback(data));
  }
});
