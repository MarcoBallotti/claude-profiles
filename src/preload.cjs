const { contextBridge, ipcRenderer } = require('electron');
const actions = new Set(['state', 'saveProfile', 'removeProfile', 'restoreProfile', 'saveSettings',
  'launchDesktop', 'launchCode', 'copyCommand', 'copyPreferences', 'discover', 'importProfile', 'choosePath', 'reveal', 'openDocs']);
contextBridge.exposeInMainWorld('profiles', Object.freeze({
  invoke: (action, payload = {}) => {
    if (!actions.has(action)) return Promise.reject(new Error('Unknown action.'));
    return ipcRenderer.invoke('profiles:action', action, payload);
  },
  onChange: callback => {
    const listener = () => callback();
    ipcRenderer.on('profiles:changed', listener);
    return () => ipcRenderer.removeListener('profiles:changed', listener);
  },
  onNavigate: callback => {
    const listener = (_event, target) => callback(target);
    ipcRenderer.on('profiles:navigate', listener);
    return () => ipcRenderer.removeListener('profiles:navigate', listener);
  },
}));
