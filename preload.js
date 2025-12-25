const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  // Window controls
  closeWindow: () => ipcRenderer.send('close-window'),
  minimizeWindow: () => ipcRenderer.send('minimize-window'),

  // Script management
  saveScripts: (scripts) => ipcRenderer.invoke('save-scripts', scripts),
  loadScripts: () => ipcRenderer.invoke('load-scripts'),

  // Voice Q&A: Speech Recognition
  qaCheckPermissions: () => ipcRenderer.invoke('qa-check-permissions'),
  qaRequestPermissions: () => ipcRenderer.invoke('qa-request-permissions'),
  qaIsLanguageAvailable: (language) => ipcRenderer.invoke('qa-is-language-available', language),
  qaGetSupportedLanguages: () => ipcRenderer.invoke('qa-get-supported-languages'),
  qaStartListening: (language) => ipcRenderer.invoke('qa-start-listening', language),
  qaStopListening: () => ipcRenderer.invoke('qa-stop-listening'),
  qaIsListening: () => ipcRenderer.invoke('qa-is-listening'),
  onTranscriptionUpdate: (callback) => {
    ipcRenderer.on('qa-transcription-update', (event, update) => callback(update));
  },
  removeTranscriptionListener: () => {
    ipcRenderer.removeAllListeners('qa-transcription-update');
  },

  // Voice Q&A: Ollama Integration
  qaCheckOllama: () => ipcRenderer.invoke('qa-check-ollama'),
  qaListModels: () => ipcRenderer.invoke('qa-list-models'),
  qaGetSuggestions: (question, context, model) => ipcRenderer.invoke('qa-get-suggestions', question, context, model),

  // Voice Q&A: Settings
  qaGetSettings: () => ipcRenderer.invoke('qa-get-settings'),
  qaSaveSettings: (settings) => ipcRenderer.invoke('qa-save-settings', settings)
});