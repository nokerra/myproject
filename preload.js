const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  // Клиенты
  getClients: () => ipcRenderer.invoke('db:getClients'),
  getClient: (id) => ipcRenderer.invoke('db:getClient', id),
  addClient: (c) => ipcRenderer.invoke('db:addClient', c),
  updateClient: (c) => ipcRenderer.invoke('db:updateClient', c),
  deleteClient: (id) => ipcRenderer.invoke('db:deleteClient', id),

  // Записи
  getRecords: (clientId) => ipcRenderer.invoke('db:getRecords', clientId),
  addRecord: (r) => ipcRenderer.invoke('db:addRecord', r),
  updateRecord: (r) => ipcRenderer.invoke('db:updateRecord', r),
  deleteRecord: (id) => ipcRenderer.invoke('db:deleteRecord', id),

  // Статистика / последние обращения
  getRecentVisits: (limit) => ipcRenderer.invoke('db:getRecentVisits', limit),
  getStats: () => ipcRenderer.invoke('db:getStats'),

  // Обновления
  onUpdateAvailable: (cb) => ipcRenderer.on('update-available', (_e, info) => cb(info)),
  onUpdateDownloaded: (cb) => ipcRenderer.on('update-downloaded', () => cb()),
  downloadUpdate: () => ipcRenderer.invoke('update:download'),
  installUpdate: () => ipcRenderer.invoke('update:install'),
  checkUpdate: () => ipcRenderer.invoke('update:check'),
});