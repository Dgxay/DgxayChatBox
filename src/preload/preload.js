'use strict';

const { contextBridge, ipcRenderer } = require('electron');

function subscribe(channel, callback) {
  const handler = (_event, payload) => callback(payload);
  ipcRenderer.on(channel, handler);
  return () => ipcRenderer.removeListener(channel, handler);
}

contextBridge.exposeInMainWorld('dcb', {
  init: () => ipcRenderer.invoke('app:init'),
  getConfig: () => ipcRenderer.invoke('config:get'),
  saveConfig: (patch) => ipcRenderer.invoke('config:save', patch),
  resetConfig: () => ipcRenderer.invoke('config:reset'),
  openConfigFolder: () => ipcRenderer.invoke('config:openFolder'),

  loadChats: () => ipcRenderer.invoke('chats:load'),
  saveChats: (chats) => ipcRenderer.invoke('chats:save', chats),

  pickFolder: (defaultPath) => ipcRenderer.invoke('dialog:pickFolder', defaultPath),
  openPath: (target) => ipcRenderer.invoke('shell:openPath', target),
  showItem: (target) => ipcRenderer.invoke('shell:showItem', target),
  fetchModels: (payload) => ipcRenderer.invoke('models:fetch', payload),
  shortcutStatus: () => ipcRenderer.invoke('shortcut:status'),

  chatSend: (payload) => ipcRenderer.invoke('chat:send', payload),
  chatAbort: (requestId) => ipcRenderer.invoke('chat:abort', requestId),
  onChatEvent: (cb) => subscribe('chat:event', cb),
  onPermissionRequest: (cb) => subscribe('permission:request', cb),
  respondPermission: (payload) => ipcRenderer.invoke('permission:respond', payload),

  window: {
    minimize: () => ipcRenderer.send('window:minimize'),
    toggleMaximize: () => ipcRenderer.send('window:toggle-maximize'),
    close: () => ipcRenderer.send('window:close'),
    onState: (cb) => subscribe('window:state', cb)
  }
});
