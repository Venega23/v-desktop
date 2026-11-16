const { contextBridge, ipcRenderer } = require('electron');

function subscribe(channel, callback) {
  if (typeof callback !== 'function') throw new TypeError('IPC listener must be a function');
  const listener = (_event, payload) => callback(payload);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
}

const api = Object.freeze({
  hide: () => ipcRenderer.send('overlay:hide'),
  saveAsset: (payload) => ipcRenderer.invoke('asset:save', payload),
  saveAudio: (payload) => ipcRenderer.invoke('audio:save', payload),
  readAudio: (url) => ipcRenderer.invoke('audio:read', url),
  openExternal: (url) => ipcRenderer.invoke('external:open', url),
  copyText: (text) => ipcRenderer.invoke('clipboard:write-text', text),
  syncGoogleSheets: (payload) => ipcRenderer.invoke('google-sheets:sync', payload),
  getGoogleSheetsConfig: () => ipcRenderer.invoke('google-sheets:config:get'),
  setGoogleSheetsConfig: (config) => ipcRenderer.invoke('google-sheets:config:set', config),
  getGlobalShortcut: () => ipcRenderer.invoke('shortcut:get'),
  setGlobalShortcut: (accelerator) => ipcRenderer.invoke('shortcut:set', accelerator),
  startShortcutCapture: () => ipcRenderer.invoke('shortcut:capture-start'),
  stopShortcutCapture: () => ipcRenderer.invoke('shortcut:capture-stop'),
  xaiKeyStatus: (options = {}) => ipcRenderer.invoke('xai:key:status', options),
  verifyXaiKey: (key) => ipcRenderer.invoke('xai:key:verify', key),
  setXaiKey: (key) => ipcRenderer.invoke('xai:key:set', key),
  removeXaiKey: (id) => ipcRenderer.invoke('xai:key:remove', id),
  clearXaiKey: () => ipcRenderer.invoke('xai:key:clear'),
  setAzureSpeechKey: (payload) => ipcRenderer.invoke('azure:key:set', payload),
  clearAzureSpeechKey: () => ipcRenderer.invoke('azure:key:clear'),
  xaiTranscribe: (payload) => ipcRenderer.invoke('xai:transcribe', payload),
  xaiStructure: (transcript) => ipcRenderer.invoke('xai:structure', transcript),
  xaiSuggest: (payload) => ipcRenderer.invoke('xai:suggest', payload),
  cancelXaiSuggest: (requestId) => ipcRenderer.send('xai:suggest:cancel', requestId),
  xaiBoardCheats: (payload) => ipcRenderer.invoke('xai:board-cheats', payload),
  spaceChat: (payload) => ipcRenderer.invoke('space:chat', payload),
  showAnswerPopup: (payload) => ipcRenderer.send('answer:show', payload),
  hideAnswerPopup: () => ipcRenderer.send('answer:hide'),
  setAnswerPopupRecording: (active) => ipcRenderer.send('answer:recording-state', Boolean(active)),
  toggleAnswerPause: () => ipcRenderer.send('answer:pause-toggle'),
  showMeetingWindow: (payload) => ipcRenderer.send('meeting:update', payload),
  sendMeetingWindowAction: (action, cardId) => ipcRenderer.send('meeting:action', { action, cardId }),
  dismissAnswerPopup: () => ipcRenderer.send('answer:dismiss'),
  openMainFromAnswer: () => ipcRenderer.send('answer:open-main'),
  analyzeKnowledgeImage: (payload) => ipcRenderer.invoke('knowledge:analyze-image', payload),
  consolidateKnowledge: (payload) => ipcRenderer.invoke('knowledge:consolidate', payload),
  transcribeGroqChunk: (payload) => ipcRenderer.invoke('groq:transcribe-chunk', payload),
  startXaiStream: (options) => ipcRenderer.invoke('xai:stream:start', options),
  startAzureStream: (options) => ipcRenderer.invoke('azure:stream:start', options),
  sendXaiAudio: (payload) => ipcRenderer.send('xai:stream:audio', payload),
  stopXaiStream: (sessionId) => ipcRenderer.invoke('xai:stream:stop', sessionId),
  onXaiTranscript: (callback) => subscribe('xai:stream:event', callback),
  onAiProgress: (callback) => subscribe('ai:progress', callback),
  onAnswerPopup: (callback) => subscribe('answer:update', callback),
  onAnswerPauseState: (callback) => subscribe('answer:pause-state', callback),
  onMeetingWindowUpdate: (callback) => subscribe('meeting:update', callback),
  onMeetingWindowAction: (callback) => subscribe('meeting:action', callback),
  onShown: (callback) => subscribe('overlay:shown', callback),
  onHiding: (callback) => subscribe('overlay:hiding', callback),
  isDesktop: true
});

contextBridge.exposeInMainWorld('sloy', api);
