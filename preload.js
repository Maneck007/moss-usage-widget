'use strict';
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('moss', {
  onUsage: (cb) => ipcRenderer.on('usage', (_e, s) => cb(s)),
  onSetView: (cb) => ipcRenderer.on('set-view', (_e, v) => cb(v)),
  onDebugTab: (cb) => ipcRenderer.on('debug-tab', (_e, t) => cb(t)),
  onSystemAccent: (cb) => ipcRenderer.on('system-accent', (_e, c) => cb(c)),
  onPetScale: (cb) => ipcRenderer.on('pet-scale', (_e, s) => cb(s)),
  onClaudeStatus: (cb) => ipcRenderer.on('claude-status', (_e, m) => cb(m)),
  onCfg: (cb) => ipcRenderer.on('cfg', (_e, c) => cb(c)),
  fitHeight: (delta) => ipcRenderer.send('fit-height', delta),
  passthrough: (flag) => ipcRenderer.send('passthrough', flag),
  dragBy: (dx, dy) => ipcRenderer.send('drag-by', dx, dy),
  setView: (v, tab) => ipcRenderer.send('set-view', { v, tab }),
  setTab: (tab) => ipcRenderer.send('tab-changed', tab),
  reportCardHeight: (tab, h) => ipcRenderer.send('report-card-height', tab, h),
  resetPos: () => ipcRenderer.send('reset-pos'),
  syncHint: () => ipcRenderer.send('claude-sync-hint'),
  contextMenu: () => ipcRenderer.send('context-menu'),
});
