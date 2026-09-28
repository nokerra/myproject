const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  getClients: () => ipcRenderer.invoke('db:getClients'),
  getClient: (id) => ipcRenderer.invoke('db:getClient', id),
  addClient: (c) => ipcRenderer.invoke('db:addClient', c),
  updateClient: (c) => ipcRenderer.invoke('db:updateClient', c),
  deleteClient: (id) => ipcRenderer.invoke('db:deleteClient', id),

  getRecords: (clientId) => ipcRenderer.invoke('db:getRecords', clientId),
  addRecord: (r) => ipcRenderer.invoke('db:addRecord', r),
  updateRecord: (r) => ipcRenderer.invoke('db:updateRecord', r),
  deleteRecord: (id) => ipcRenderer.invoke('db:deleteRecord', id),
  getRecentVisits: (limit) => ipcRenderer.invoke('db:getRecentVisits', limit),

  backupDb: () => ipcRenderer.invoke('db:backup'),
  restoreDb: () => ipcRenderer.invoke('db:restore'),
  exportExcel: () => ipcRenderer.invoke('db:exportExcel'),

  onUpdateAvailable: (cb) => ipcRenderer.on('update-available', (_e, info) => cb(info)),
  onUpdateProgress: (cb) => ipcRenderer.on('update-progress', (_e, p) => cb(p)),
  onUpdateDownloaded: (cb) => ipcRenderer.on('update-downloaded', () => cb()),
  onUpdateError: (cb) => ipcRenderer.on('update-error', (_e, msg) => cb(msg)),
  downloadUpdate: () => ipcRenderer.invoke('update:download'),
  installUpdate: () => ipcRenderer.invoke('update:install'),
  checkUpdate: () => ipcRenderer.invoke('update:check'),
  openDownloadUrl: (url) => ipcRenderer.invoke('update:openDownloadUrl', url),
});