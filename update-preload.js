const { contextBridge, ipcRenderer } = require('electron');

function subscribe(callback) {
  if (typeof callback !== 'function') throw new TypeError('Updater listener must be a function');
  const listener = (_event, state) => callback(state);
  ipcRenderer.on('updater:state', listener);
  return () => ipcRenderer.removeListener('updater:state', listener);
}

contextBridge.exposeInMainWorld('vUpdater', Object.freeze({
  getState:() => ipcRenderer.invoke('updater:get-state'),
  retry:() => ipcRenderer.invoke('updater:retry'),
  install:() => ipcRenderer.invoke('updater:install'),
  openLog:() => ipcRenderer.invoke('updater:open-log'),
  close:() => ipcRenderer.send('updater:close'),
  onState:subscribe
}));
