const { contextBridge } = require('electron');

contextBridge.exposeInMainWorld('graveyardShiftDesktop', {
  platform: process.platform,
});
