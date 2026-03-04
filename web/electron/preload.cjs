const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('ide', {
  openProjectDirectory: () => ipcRenderer.invoke('project:open'),
  setPanelVisibility: (panelId, visible) => ipcRenderer.invoke('view:set-panel-visibility', panelId, visible),
  readDirectory: (directoryPath) => ipcRenderer.invoke('fs:readdir', directoryPath),
  readFile: (filePath) => ipcRenderer.invoke('fs:readFile', filePath),
  writeFile: (filePath, content) => ipcRenderer.invoke('fs:writeFile', filePath, content),
  createTerminal: (cwd) => ipcRenderer.invoke('terminal:create', cwd),
  sendTerminalInput: (terminalId, input) => ipcRenderer.send('terminal:input', terminalId, input),
  resizeTerminal: (terminalId, cols, rows) => ipcRenderer.send('terminal:resize', terminalId, cols, rows),
  closeTerminal: (terminalId) => ipcRenderer.send('terminal:close', terminalId),
  onPanelVisibilityChange: (callback) => {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on('view:panel-visibility', listener);
    return () => ipcRenderer.removeListener('view:panel-visibility', listener);
  },
  onTerminalData: (terminalId, callback) => {
    const channel = `terminal:data:${terminalId}`;
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on(channel, listener);
    return () => ipcRenderer.removeListener(channel, listener);
  },
  onAnyTerminalData: (callback) => {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on('terminal:data:any', listener);
    return () => ipcRenderer.removeListener('terminal:data:any', listener);
  },
  onTerminalExit: (terminalId, callback) => {
    const channel = `terminal:exit:${terminalId}`;
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on(channel, listener);
    return () => ipcRenderer.removeListener(channel, listener);
  },
  onAnyTerminalExit: (callback) => {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on('terminal:exit:any', listener);
    return () => ipcRenderer.removeListener('terminal:exit:any', listener);
  },
});
