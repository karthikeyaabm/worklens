const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  fetchTimelog: async () => {
    return {
      totalTime: "07h 45m"
    };
  },

  getUsername: async () => {
    return await ipcRenderer.invoke('get-username');
  }
});