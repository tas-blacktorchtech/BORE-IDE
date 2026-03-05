const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('ide', {
  openProjectDirectory: () => ipcRenderer.invoke('project:open'),
  prepareProjectFolder: (folderPath) => ipcRenderer.invoke('project:prepare-folder', folderPath),
  cloneRepository: (repoUrl, destinationDirectory) =>
    ipcRenderer.invoke('project:clone', repoUrl, destinationDirectory),
  getRecentProjects: () => ipcRenderer.invoke('project:get-recent'),
  getGitGraph: (projectRoot, options) => ipcRenderer.invoke('git:get-graph', projectRoot, options),
  getGitCommitStats: (projectRoot, commitId) =>
    ipcRenderer.invoke('git:get-commit-stats', projectRoot, commitId),
  getGitCommitDetails: (projectRoot, commitId) =>
    ipcRenderer.invoke('git:get-commit-details', projectRoot, commitId),
  createGitBranch: (projectRoot, payload) => ipcRenderer.invoke('git:create-branch', projectRoot, payload),
  checkoutGitBranch: (projectRoot, payload) => ipcRenderer.invoke('git:checkout-branch', projectRoot, payload),
  getGitBranchChanges: (projectRoot, branchName) =>
    ipcRenderer.invoke('git:get-branch-changes', projectRoot, branchName),
  getSettings: () => ipcRenderer.invoke('settings:get'),
  saveSettings: (settings) => ipcRenderer.invoke('settings:save', settings),
  readProjectLayout: (projectRoot) => ipcRenderer.invoke('project:read-layout', projectRoot),
  saveProjectLayout: (projectRoot, layoutState) =>
    ipcRenderer.invoke('project:save-layout', projectRoot, layoutState),
  readProjectScratchpad: (projectRoot) => ipcRenderer.invoke('project:read-scratchpad', projectRoot),
  saveProjectScratchpad: (projectRoot, document) =>
    ipcRenderer.invoke('project:save-scratchpad', projectRoot, document),
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
  onSaveLayoutRequest: (callback) => {
    const listener = () => callback();
    ipcRenderer.on('window:save-layout-request', listener);
    return () => ipcRenderer.removeListener('window:save-layout-request', listener);
  },
  onToggleCommandLine: (callback) => {
    const listener = () => callback();
    ipcRenderer.on('window:toggle-command-line', listener);
    return () => ipcRenderer.removeListener('window:toggle-command-line', listener);
  },
  onOpenOptionsRequest: (callback) => {
    const listener = () => callback();
    ipcRenderer.on('window:open-options-request', listener);
    return () => ipcRenderer.removeListener('window:open-options-request', listener);
  },
  onCloseProjectRequest: (callback) => {
    const listener = () => callback();
    ipcRenderer.on('window:close-project-request', listener);
    return () => ipcRenderer.removeListener('window:close-project-request', listener);
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
