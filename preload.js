const { contextBridge } = require('electron');

contextBridge.exposeInMainWorld('api', {
  fetchTimelog: async () => {
    // Return dummy data for now. Mainnet API will be integrated here later.
    return {
      totalTime: "07h 45m"
    };
  }
});
