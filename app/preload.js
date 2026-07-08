// Bridges the sandboxed renderer to main over a tiny, explicit API.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('godmode', {
  // Browser controls
  nav: (url) => ipcRenderer.invoke('nav', url),
  back: () => ipcRenderer.invoke('back'),
  forward: () => ipcRenderer.invoke('forward'),
  reload: () => ipcRenderer.invoke('reload'),
  onViewState: (cb) => ipcRenderer.on('view:state', (_e, s) => cb(s)),

  // AI agent
  ask: (message) => ipcRenderer.invoke('agent:ask', message),
  onAgentEvent: (cb) => ipcRenderer.on('agent:event', (_e, evt) => cb(evt)),

  // Voice (LiveKit)
  voiceConfig: () => ipcRenderer.invoke('voice:config'),
});
