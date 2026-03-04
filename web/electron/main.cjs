const { app, BrowserWindow, Menu, dialog, ipcMain } = require('electron');
const path = require('node:path');
const fs = require('node:fs/promises');
const fsSync = require('node:fs');
const { spawn } = require('node:child_process');
const pty = require('@homebridge/node-pty-prebuilt-multiarch');

const terminals = new Map();
let terminalCounter = 0;
const viewVisibility = {
  explorer: true,
  editor: true,
  bottom: true,
};

function getShellConfig() {
  if (process.platform === 'win32') {
    return { command: 'powershell.exe', args: ['-NoLogo'] };
  }

  const shellCandidates = [process.env.SHELL, '/bin/zsh', '/bin/bash', '/bin/sh'].filter(Boolean);
  const command =
    shellCandidates.find((candidate) => {
      try {
        fsSync.accessSync(candidate, fsSync.constants.X_OK);
        return true;
      } catch {
        return false;
      }
    }) || '/bin/sh';

  // Force interactive login shells so prompts initialize consistently.
  const args = command === '/bin/sh' ? ['-i'] : ['-il'];
  return { command, args };
}

function getPipeShellArgs(command) {
  // Non-PTY fallback must avoid interactive flags that require a TTY.
  if (command === 'powershell.exe') {
    return ['-NoLogo'];
  }

  return [];
}

async function sanitizeDirectory(cwd) {
  const fallback = app.getPath('home');
  if (!cwd) {
    return fallback;
  }

  try {
    const stat = await fs.stat(cwd);
    if (stat.isDirectory()) {
      return cwd;
    }
  } catch {
    return fallback;
  }

  return fallback;
}

async function safeReadDirectory(directoryPath) {
  const entries = await fs.readdir(directoryPath, { withFileTypes: true });

  return entries
    .map((entry) => ({
      name: entry.name,
      path: path.join(directoryPath, entry.name),
      type: entry.isDirectory() ? 'directory' : 'file',
    }))
    .sort((a, b) => {
      if (a.type !== b.type) {
        return a.type === 'directory' ? -1 : 1;
      }
      return a.name.localeCompare(b.name);
    });
}

function isSafePathInput(value) {
  return typeof value === 'string' && value.length > 0 && path.isAbsolute(value);
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1540,
    height: 960,
    minWidth: 1080,
    minHeight: 680,
    fullscreenable: true,
    backgroundColor: '#0f1114',
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    webPreferences: {
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.cjs'),
      sandbox: true,
    },
  });

  if (app.isPackaged) {
    win.loadFile(path.join(__dirname, '../dist/index.html'));
  } else {
    win.loadURL('http://localhost:5173');
  }
}

function sendPanelVisibility(panelId, visible) {
  const window = BrowserWindow.getFocusedWindow() || BrowserWindow.getAllWindows()[0];
  if (!window) {
    return;
  }

  window.webContents.send('view:panel-visibility', {
    panelId,
    visible,
  });
}

function updatePanelMenuCheckmark(panelId, visible) {
  const menu = Menu.getApplicationMenu();
  if (!menu) {
    return;
  }

  const key = `view-panel-${panelId}`;
  const menuItem = menu.getMenuItemById(key);
  if (menuItem) {
    menuItem.checked = visible;
  }
}

function setPanelVisibility(panelId, visible) {
  viewVisibility[panelId] = visible;
  updatePanelMenuCheckmark(panelId, visible);
  sendPanelVisibility(panelId, visible);
}

function createApplicationMenu() {
  const template = [
    ...(process.platform === 'darwin'
      ? [
          {
            label: app.name,
            submenu: [{ role: 'about' }, { type: 'separator' }, { role: 'quit' }],
          },
        ]
      : []),
    {
      label: 'File',
      submenu: [{ role: 'close' }],
    },
    {
      label: 'View',
      submenu: [
        {
          id: 'view-panel-explorer',
          label: 'Explorer',
          type: 'checkbox',
          checked: viewVisibility.explorer,
          click: (menuItem) => {
            setPanelVisibility('explorer', menuItem.checked);
          },
        },
        {
          id: 'view-panel-editor',
          label: 'Editor',
          type: 'checkbox',
          checked: viewVisibility.editor,
          click: (menuItem) => {
            setPanelVisibility('editor', menuItem.checked);
          },
        },
        {
          id: 'view-panel-bottom',
          label: 'Terminal / Problems',
          type: 'checkbox',
          checked: viewVisibility.bottom,
          click: (menuItem) => {
            setPanelVisibility('bottom', menuItem.checked);
          },
        },
        { type: 'separator' },
        { role: 'toggleDevTools' },
      ],
    },
    {
      label: 'Window',
      submenu: [{ role: 'minimize' }, { role: 'zoom' }],
    },
  ];

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

app.whenReady().then(() => {
  createApplicationMenu();
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  for (const [, session] of terminals) {
    session.proc.kill();
  }
  terminals.clear();

  if (process.platform !== 'darwin') {
    app.quit();
  }
});

ipcMain.handle('project:open', async () => {
  const window = BrowserWindow.getFocusedWindow();
  const result = await dialog.showOpenDialog(window ?? undefined, {
    properties: ['openDirectory'],
  });

  if (result.canceled || result.filePaths.length === 0) {
    return null;
  }

  return result.filePaths[0];
});

ipcMain.handle('fs:readdir', async (_event, directoryPath) => {
  if (!isSafePathInput(directoryPath)) {
    throw new Error('Invalid directory path');
  }
  return safeReadDirectory(directoryPath);
});

ipcMain.handle('fs:readFile', async (_event, filePath) => {
  if (!isSafePathInput(filePath)) {
    throw new Error('Invalid file path');
  }
  return fs.readFile(filePath, 'utf8');
});

ipcMain.handle('fs:writeFile', async (_event, filePath, content) => {
  if (!isSafePathInput(filePath) || typeof content !== 'string') {
    throw new Error('Invalid file write payload');
  }
  await fs.writeFile(filePath, content, 'utf8');
  return true;
});

ipcMain.handle('terminal:create', async (event, cwd) => {
  if (cwd !== undefined && cwd !== null && !isSafePathInput(cwd)) {
    throw new Error('Invalid terminal cwd');
  }

  const terminalId = `term-${++terminalCounter}`;
  const shell = getShellConfig();
  const terminalCwd = await sanitizeDirectory(cwd);
  let session = null;

  const ptyCandidates = [
    { command: shell.command, args: shell.args },
    ...(shell.command === '/bin/sh' ? [] : [{ command: '/bin/sh', args: ['-i'] }]),
  ];

  for (const candidate of ptyCandidates) {
    try {
      const proc = pty.spawn(candidate.command, candidate.args, {
        name: 'xterm-color',
        cwd: terminalCwd,
        env: {
          ...process.env,
          TERM: process.env.TERM || 'xterm-256color',
        },
        cols: 100,
        rows: 30,
      });

      session = {
        kind: 'pty',
        proc,
      };
      break;
    } catch (error) {
      // Try next fallback candidate.
    }
  }

  if (!session) {
    const pipeCandidate = ptyCandidates[0] ?? { command: '/bin/sh', args: ['-i'] };
    const proc = spawn(pipeCandidate.command, getPipeShellArgs(pipeCandidate.command), {
      cwd: terminalCwd,
      env: {
        ...process.env,
        TERM: process.env.TERM || 'xterm-256color',
      },
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    session = {
      kind: 'pipe',
      proc,
    };
  }

  terminals.set(terminalId, session);

  if (session.kind === 'pty') {
    session.proc.onData((data) => {
      event.sender.send(`terminal:data:${terminalId}`, { data });
      event.sender.send('terminal:data:any', { terminalId, data });
    });

    session.proc.onExit(({ exitCode }) => {
      terminals.delete(terminalId);
      event.sender.send(`terminal:exit:${terminalId}`, { exitCode });
      event.sender.send('terminal:exit:any', { terminalId, exitCode });
    });
  } else {
    event.sender.send(`terminal:data:${terminalId}`, {
      data: '[BORE] PTY unavailable. Running fallback shell mode.\r\n',
    });

    session.proc.on('error', () => {
      terminals.delete(terminalId);
      event.sender.send(`terminal:exit:${terminalId}`, { exitCode: 1 });
      event.sender.send('terminal:exit:any', { terminalId, exitCode: 1 });
    });

    session.proc.stdout.on('data', (chunk) => {
      const data = chunk.toString();
      event.sender.send(`terminal:data:${terminalId}`, { data });
      event.sender.send('terminal:data:any', { terminalId, data });
    });

    session.proc.stderr.on('data', (chunk) => {
      const data = chunk.toString();
      event.sender.send(`terminal:data:${terminalId}`, { data });
      event.sender.send('terminal:data:any', { terminalId, data });
    });

    session.proc.on('close', (exitCode) => {
      terminals.delete(terminalId);
      event.sender.send(`terminal:exit:${terminalId}`, { exitCode });
      event.sender.send('terminal:exit:any', { terminalId, exitCode });
    });
  }

  return {
    terminalId,
    mode: session.kind,
  };
});

ipcMain.on('terminal:input', (_event, terminalId, input) => {
  if (typeof terminalId !== 'string') {
    return;
  }

  const session = terminals.get(terminalId);
  if (!session || typeof input !== 'string') {
    return;
  }

  if (session.kind === 'pty') {
    session.proc.write(input);
  } else if (session.proc.stdin.writable) {
    session.proc.stdin.write(input);
  }
});

ipcMain.on('terminal:resize', (_event, terminalId, cols, rows) => {
  if (typeof terminalId !== 'string') {
    return;
  }

  const session = terminals.get(terminalId);
  if (!session || session.kind !== 'pty') {
    return;
  }

  if (Number.isInteger(cols) && Number.isInteger(rows) && cols > 0 && rows > 0) {
    session.proc.resize(cols, rows);
  }
});

ipcMain.on('terminal:close', (_event, terminalId) => {
  if (typeof terminalId !== 'string') {
    return;
  }

  const session = terminals.get(terminalId);
  if (!session) {
    return;
  }

  session.proc.kill();
  terminals.delete(terminalId);
});

ipcMain.handle('view:set-panel-visibility', (_event, panelId, visible) => {
  if (!Object.hasOwn(viewVisibility, panelId) || typeof visible !== 'boolean') {
    return false;
  }

  setPanelVisibility(panelId, visible);
  return true;
});
