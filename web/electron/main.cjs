const { app, BrowserWindow, Menu, dialog, ipcMain, nativeImage } = require('electron');
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
  scratch: false,
};
const BORE_LAYOUT_FILE = 'ide-layout.json';
const BORE_SCRATCHPADS_DIR = 'scratchpads';
const BORE_SCRATCHPAD_FILE = 'default.json';
const RECENT_PROJECTS_FILE = 'recent-projects.json';
const MAX_RECENT_PROJECTS = 5;
const SETTINGS_FILE = 'settings.json';
const MAX_COMMAND_ALIASES = 64;

function resolveAssetPath(fileName) {
  const candidates = app.isPackaged
    ? [path.join(__dirname, '..', 'dist', fileName), path.join(process.resourcesPath, fileName)]
    : [path.join(__dirname, '..', 'public', fileName)];

  return candidates.find((candidate) => fsSync.existsSync(candidate)) || null;
}

function resolveWindowIconPath() {
  if (process.platform === 'win32') {
    return resolveAssetPath('icon.ico') || resolveAssetPath('icon.png');
  }

  return resolveAssetPath('icon.png');
}

function setDockIconSafe() {
  if (process.platform !== 'darwin' || !app.dock) {
    return;
  }

  const candidates = [resolveAssetPath('icon.icns'), resolveAssetPath('icon.png')].filter(Boolean);
  for (const iconPath of candidates) {
    try {
      const image = nativeImage.createFromPath(iconPath);
      if (!image.isEmpty()) {
        app.dock.setIcon(image);
        return;
      }
    } catch {
      // Try next candidate.
    }
  }
}

function parseRepositoryName(repoUrl) {
  const trimmed = repoUrl.trim();
  if (!trimmed) {
    return null;
  }

  const withoutQuery = trimmed.split('?')[0].split('#')[0];
  const lastSegment = withoutQuery.split(/[/:]/).at(-1);
  if (!lastSegment) {
    return null;
  }

  const normalized = lastSegment.endsWith('.git')
    ? lastSegment.slice(0, -4)
    : lastSegment;

  return normalized.length > 0 ? normalized : null;
}

function runCommand(command, args, cwd) {
  return new Promise((resolve, reject) => {
    const proc = spawn(command, args, {
      cwd,
      env: process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stderr = '';

    proc.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });

    proc.on('error', (error) => {
      reject(error);
    });

    proc.on('close', (code) => {
      if (code === 0) {
        resolve();
        return;
      }

      reject(new Error(stderr.trim() || `${command} exited with code ${code}`));
    });
  });
}

function runCommandCapture(command, args, cwd) {
  return new Promise((resolve, reject) => {
    const proc = spawn(command, args, {
      cwd,
      env: process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';

    proc.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
    });

    proc.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });

    proc.on('error', (error) => {
      reject(error);
    });

    proc.on('close', (code) => {
      if (code === 0) {
        resolve(stdout);
        return;
      }

      reject(new Error(stderr.trim() || `${command} exited with code ${code}`));
    });
  });
}

function parseGitStatusSummary(rawStatus) {
  let branch = 'detached';
  let ahead = 0;
  let behind = 0;
  let dirtyCount = 0;

  for (const line of rawStatus.split('\n')) {
    if (!line) {
      continue;
    }

    if (line.startsWith('# branch.head ')) {
      const value = line.slice('# branch.head '.length).trim();
      branch = value === '(detached)' ? 'detached' : value;
      continue;
    }

    if (line.startsWith('# branch.ab ')) {
      const value = line.slice('# branch.ab '.length).trim();
      const parts = value.split(' ');
      for (const part of parts) {
        if (part.startsWith('+')) {
          ahead = Number.parseInt(part.slice(1), 10) || 0;
        }
        if (part.startsWith('-')) {
          behind = Number.parseInt(part.slice(1), 10) || 0;
        }
      }
      continue;
    }

    if (!line.startsWith('#')) {
      dirtyCount += 1;
    }
  }

  return {
    branch,
    ahead,
    behind,
    dirtyCount,
    clean: dirtyCount === 0,
  };
}

function parseGitCommits(rawLog) {
  if (!rawLog.trim()) {
    return [];
  }

  const records = rawLog
    .split('\x1e')
    .map((entry) => entry.trim())
    .filter(Boolean);

  return records.map((record) => {
    const [id = '', parentField = '', message = '', author = '', authoredAt = '', decorations = ''] = record.split('\x1f');
    const parents = parentField ? parentField.split(' ').filter(Boolean) : [];
    const refs = decorations
      .split(',')
      .map((token) => token.trim())
      .filter((token) => token && token !== 'HEAD');

    const shortId = id.slice(0, 7);

    return {
      id,
      shortId,
      message,
      author,
      authoredAt,
      parents,
      refs: refs.slice(0, 3),
      head: decorations.includes('HEAD ->'),
    };
  });
}

function parseGitCommitFiles(rawNameStatus) {
  return rawNameStatus
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [statusRaw = '', ...rest] = line.split('\t');
      const status = statusRaw.charAt(0) || 'M';
      const pathValue = rest.at(-1) || '';
      return {
        status,
        path: pathValue,
      };
    })
    .filter((entry) => entry.path.length > 0);
}

function parseBranchList(rawBranches) {
  return rawBranches
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((name) => !name.endsWith('/HEAD'))
    .sort((a, b) => a.localeCompare(b));
}

function sanitizeBranchName(value) {
  if (typeof value !== 'string') {
    return '';
  }
  return value.trim();
}

function isValidBranchName(value) {
  const name = sanitizeBranchName(value);
  if (!name) {
    return false;
  }
  if (name.startsWith('-') || name.endsWith('.') || name.endsWith('/') || name.includes('..')) {
    return false;
  }
  if (/[\s~^:?*[\]\\]/.test(name)) {
    return false;
  }
  if (name.includes('@{') || name === '@') {
    return false;
  }
  return true;
}

function parseNameStatusEntries(rawNameStatus) {
  return rawNameStatus
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [statusRaw = '', ...parts] = line.split('\t');
      const status = statusRaw.charAt(0) || 'M';
      const pathValue = parts.at(-1) || '';
      return {
        status,
        path: pathValue,
      };
    })
    .filter((entry) => entry.path.length > 0);
}

function parseNumstatByPath(rawNumstat) {
  const byPath = new Map();
  let insertions = 0;
  let deletions = 0;

  for (const line of rawNumstat.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) {
      continue;
    }
    const [addedRaw = '', deletedRaw = '', pathValue = ''] = line.split('\t');
    if (!pathValue) {
      continue;
    }

    const added = /^\d+$/.test(addedRaw) ? Number.parseInt(addedRaw, 10) : 0;
    const deleted = /^\d+$/.test(deletedRaw) ? Number.parseInt(deletedRaw, 10) : 0;
    byPath.set(pathValue, { insertions: added, deletions: deleted });
    insertions += added;
    deletions += deleted;
  }

  return {
    byPath,
    insertions,
    deletions,
  };
}

async function resolveBranchChangesBase(projectRoot, branchName) {
  try {
    const upstream = (
      await runCommandCapture(
        'git',
        ['for-each-ref', '--format=%(upstream:short)', `refs/heads/${branchName}`],
        projectRoot,
      )
    )
      .trim()
      .split('\n')
      .find(Boolean);
    if (upstream) {
      return upstream.trim();
    }
  } catch {
    // Fallback to remote head / common default branches.
  }

  const candidates = [];
  try {
    const remoteHead = (
      await runCommandCapture('git', ['symbolic-ref', '--quiet', '--short', 'refs/remotes/origin/HEAD'], projectRoot)
    ).trim();
    if (remoteHead) {
      candidates.push(remoteHead);
    }
  } catch {
    // Ignore and continue.
  }

  candidates.push('origin/main', 'origin/master', 'main', 'master');
  for (const ref of candidates) {
    try {
      await runCommandCapture('git', ['rev-parse', '--verify', '--quiet', ref], projectRoot);
      return ref;
    } catch {
      // Try next ref.
    }
  }

  return null;
}

function getBoreLayoutPath(projectRoot) {
  return path.join(projectRoot, '.bore', BORE_LAYOUT_FILE);
}

function getBoreScratchpadPath(projectRoot) {
  return path.join(projectRoot, '.bore', BORE_SCRATCHPADS_DIR, BORE_SCRATCHPAD_FILE);
}

function getRecentProjectsPath() {
  return path.join(app.getPath('userData'), RECENT_PROJECTS_FILE);
}

function getSettingsPath() {
  return path.join(app.getPath('userData'), SETTINGS_FILE);
}

function normalizeCommandLineAliases(value) {
  if (!Array.isArray(value)) {
    return [];
  }

  const cleaned = [];
  const seen = new Set();
  const validTargets = new Set(['editor', 'explorer', 'terminal']);

  for (const entry of value) {
    if (!entry || typeof entry !== 'object') {
      continue;
    }

    const keyword = typeof entry.keyword === 'string' ? entry.keyword.trim().toLowerCase() : '';
    const target = typeof entry.target === 'string' ? entry.target.trim().toLowerCase() : '';
    if (!keyword || keyword.length > 32 || !validTargets.has(target)) {
      continue;
    }

    if (seen.has(keyword)) {
      continue;
    }
    seen.add(keyword);

    cleaned.push({ keyword, target });
    if (cleaned.length >= MAX_COMMAND_ALIASES) {
      break;
    }
  }

  return cleaned;
}

function normalizeSettingsPayload(payload) {
  if (!payload || typeof payload !== 'object') {
    return { commandLineAliases: [] };
  }

  return {
    commandLineAliases: normalizeCommandLineAliases(payload.commandLineAliases),
  };
}

function normalizeScratchPadDocument(payload) {
  if (!payload || typeof payload !== 'object') {
    return {
      title: '',
      html: '',
      updatedAt: new Date(0).toISOString(),
    };
  }

  const title = typeof payload.title === 'string' ? payload.title.slice(0, 120) : '';
  const html = typeof payload.html === 'string' ? payload.html : '';
  const updatedAtRaw = typeof payload.updatedAt === 'string' ? payload.updatedAt : '';
  const updatedAt = Number.isNaN(Date.parse(updatedAtRaw))
    ? new Date(0).toISOString()
    : new Date(updatedAtRaw).toISOString();

  return { title, html, updatedAt };
}

async function readSettings() {
  try {
    const raw = await fs.readFile(getSettingsPath(), 'utf8');
    return normalizeSettingsPayload(JSON.parse(raw));
  } catch (error) {
    if (error.code === 'ENOENT') {
      return { commandLineAliases: [] };
    }
    return { commandLineAliases: [] };
  }
}

async function writeSettings(settings) {
  await fs.mkdir(app.getPath('userData'), { recursive: true });
  await fs.writeFile(getSettingsPath(), `${JSON.stringify(settings, null, 2)}\n`, 'utf8');
}

async function readRecentProjects() {
  try {
    const raw = await fs.readFile(getRecentProjectsPath(), 'utf8');
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return [];
    }

    return parsed.filter((entry) => typeof entry === 'string' && path.isAbsolute(entry));
  } catch (error) {
    if (error.code === 'ENOENT') {
      return [];
    }
    return [];
  }
}

async function writeRecentProjects(projects) {
  await fs.mkdir(app.getPath('userData'), { recursive: true });
  await fs.writeFile(getRecentProjectsPath(), `${JSON.stringify(projects, null, 2)}\n`, 'utf8');
}

async function registerRecentProject(projectPath) {
  const existing = await readRecentProjects();
  const deduped = [projectPath, ...existing.filter((entry) => entry !== projectPath)];
  await writeRecentProjects(deduped.slice(0, MAX_RECENT_PROJECTS));
}

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
  const iconPath = resolveWindowIconPath();
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
    ...(iconPath ? { icon: iconPath } : {}),
  });

  if (app.isPackaged) {
    win.loadFile(path.join(__dirname, '../dist/index.html'));
  } else {
    win.loadURL('http://localhost:5173');
  }

  win.webContents.on('context-menu', (_event, params) => {
    const contextMenu = Menu.buildFromTemplate([
      ...(params.isEditable ? [{ role: 'undo' }, { role: 'redo' }, { type: 'separator' }] : []),
      { role: 'cut', enabled: params.editFlags.canCut },
      { role: 'copy', enabled: params.editFlags.canCopy || params.selectionText.length > 0 },
      { role: 'paste', enabled: params.editFlags.canPaste },
      { role: 'selectAll' },
    ]);

    contextMenu.popup({ window: win });
  });
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
      submenu: [
        {
          label: 'Options',
          accelerator: 'CmdOrCtrl+,',
          click: () => {
            const win = BrowserWindow.getFocusedWindow() || BrowserWindow.getAllWindows()[0];
            if (!win) {
              return;
            }

            win.webContents.send('window:open-options-request');
          },
        },
        { type: 'separator' },
        {
          label: 'Close Project',
          click: () => {
            const win = BrowserWindow.getFocusedWindow() || BrowserWindow.getAllWindows()[0];
            if (!win) {
              return;
            }

            win.webContents.send('window:close-project-request');
          },
        },
        { type: 'separator' },
        { role: 'close' },
      ],
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectAll' },
      ],
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
        {
          id: 'view-panel-scratch',
          label: 'Scratch Pad',
          type: 'checkbox',
          checked: viewVisibility.scratch,
          click: (menuItem) => {
            setPanelVisibility('scratch', menuItem.checked);
          },
        },
        { type: 'separator' },
        {
          label: 'Toggle Command Line',
          accelerator: 'CmdOrCtrl+K',
          click: () => {
            const win = BrowserWindow.getFocusedWindow() || BrowserWindow.getAllWindows()[0];
            if (!win) {
              return;
            }

            win.webContents.send('window:toggle-command-line');
          },
        },
        { type: 'separator' },
        { role: 'toggleDevTools' },
      ],
    },
    {
      label: 'Window',
      submenu: [
        {
          label: 'Save Panel Layout',
          accelerator: 'CmdOrCtrl+Shift+L',
          click: () => {
            const win = BrowserWindow.getFocusedWindow() || BrowserWindow.getAllWindows()[0];
            if (!win) {
              return;
            }

            win.webContents.send('window:save-layout-request');
          },
        },
        { type: 'separator' },
        { role: 'minimize' },
        { role: 'zoom' },
      ],
    },
  ];

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

app
  .whenReady()
  .then(() => {
  setDockIconSafe();
  createApplicationMenu();
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
  })
  .catch((error) => {
    console.error('[BORE] App startup failed:', error);
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

ipcMain.handle('project:prepare-folder', async (_event, folderPath) => {
  if (!isSafePathInput(folderPath)) {
    throw new Error('Invalid project folder path');
  }

  const stat = await fs.stat(folderPath);
  if (!stat.isDirectory()) {
    throw new Error('Project path must be a directory');
  }

  await fs.mkdir(path.join(folderPath, '.bore'), { recursive: true });
  await registerRecentProject(folderPath);
  return folderPath;
});

ipcMain.handle('project:clone', async (_event, repoUrl, destinationDirectory) => {
  if (typeof repoUrl !== 'string' || repoUrl.trim().length === 0) {
    throw new Error('Repository URL is required');
  }

  if (!isSafePathInput(destinationDirectory)) {
    throw new Error('Invalid destination folder path');
  }

  const repositoryName = parseRepositoryName(repoUrl);
  if (!repositoryName) {
    throw new Error('Unable to determine repository name from URL');
  }

  await fs.mkdir(destinationDirectory, { recursive: true });

  const destinationStat = await fs.stat(destinationDirectory);
  if (!destinationStat.isDirectory()) {
    throw new Error('Destination path must be a directory');
  }

  const clonedProjectPath = path.join(destinationDirectory, repositoryName);
  try {
    await fs.access(clonedProjectPath);
    throw new Error('A folder with this repository name already exists in destination');
  } catch (error) {
    if (error.code !== 'ENOENT') {
      throw error;
    }
  }

  await runCommand('git', ['clone', repoUrl, repositoryName], destinationDirectory);
  await fs.mkdir(path.join(clonedProjectPath, '.bore'), { recursive: true });
  return clonedProjectPath;
});

ipcMain.handle('project:read-layout', async (_event, projectRoot) => {
  if (!isSafePathInput(projectRoot)) {
    throw new Error('Invalid project root path');
  }

  const layoutPath = getBoreLayoutPath(projectRoot);
  try {
    const raw = await fs.readFile(layoutPath, 'utf8');
    return JSON.parse(raw);
  } catch (error) {
    if (error.code === 'ENOENT') {
      return null;
    }
    throw error;
  }
});

ipcMain.handle('project:save-layout', async (_event, projectRoot, layoutState) => {
  if (!isSafePathInput(projectRoot)) {
    throw new Error('Invalid project root path');
  }

  if (!layoutState || typeof layoutState !== 'object') {
    throw new Error('Invalid layout payload');
  }

  const boreFolder = path.join(projectRoot, '.bore');
  await fs.mkdir(boreFolder, { recursive: true });
  const layoutPath = getBoreLayoutPath(projectRoot);
  await fs.writeFile(layoutPath, `${JSON.stringify(layoutState, null, 2)}\n`, 'utf8');
  return true;
});

ipcMain.handle('project:read-scratchpad', async (_event, projectRoot) => {
  if (!isSafePathInput(projectRoot)) {
    throw new Error('Invalid project root path');
  }

  const scratchpadPath = getBoreScratchpadPath(projectRoot);
  try {
    const raw = await fs.readFile(scratchpadPath, 'utf8');
    return normalizeScratchPadDocument(JSON.parse(raw));
  } catch (error) {
    if (error.code === 'ENOENT') {
      return normalizeScratchPadDocument(null);
    }
    throw error;
  }
});

ipcMain.handle('project:save-scratchpad', async (_event, projectRoot, document) => {
  if (!isSafePathInput(projectRoot)) {
    throw new Error('Invalid project root path');
  }

  const normalizedDocument = normalizeScratchPadDocument(document);
  const scratchpadPath = getBoreScratchpadPath(projectRoot);
  await fs.mkdir(path.dirname(scratchpadPath), { recursive: true });
  await fs.writeFile(scratchpadPath, `${JSON.stringify(normalizedDocument, null, 2)}\n`, 'utf8');
  return normalizedDocument;
});

ipcMain.handle('project:get-recent', async () => {
  return readRecentProjects();
});

ipcMain.handle('settings:get', async () => {
  return readSettings();
});

ipcMain.handle('settings:save', async (_event, payload) => {
  const normalized = normalizeSettingsPayload(payload);
  await writeSettings(normalized);
  return normalized;
});

ipcMain.handle('git:get-graph', async (_event, projectRoot, options) => {
  if (!isSafePathInput(projectRoot)) {
    throw new Error('Invalid project root path');
  }

  const rawOffset = Number.parseInt(String(options?.offset ?? 0), 10);
  const rawLimit = Number.parseInt(String(options?.limit ?? 20), 10);
  const offset = Number.isInteger(rawOffset) && rawOffset >= 0 ? rawOffset : 0;
  const limit = Number.isInteger(rawLimit) && rawLimit > 0 ? Math.min(rawLimit, 100) : 20;

  try {
    await runCommandCapture('git', ['rev-parse', '--is-inside-work-tree'], projectRoot);
  } catch {
    return {
      ok: false,
      error: 'Selected project is not a git repository.',
      summary: {
        branch: 'n/a',
        ahead: 0,
        behind: 0,
        dirtyCount: 0,
        clean: true,
        localBranches: [],
        remoteBranches: [],
      },
      commits: [],
    };
  }

  const [rawStatus, rawLog, rawLocalBranches, rawRemoteBranches] = await Promise.all([
    runCommandCapture('git', ['status', '--porcelain=2', '--branch'], projectRoot),
    runCommandCapture(
      'git',
      [
        'log',
        '--all',
        '--date-order',
        `--skip=${offset}`,
        `--max-count=${limit}`,
        '--pretty=format:%H%x1f%P%x1f%s%x1f%an%x1f%cI%x1f%D%x1e',
      ],
      projectRoot,
    ),
    runCommandCapture('git', ['for-each-ref', '--format=%(refname:short)', 'refs/heads'], projectRoot),
    runCommandCapture('git', ['for-each-ref', '--format=%(refname:short)', 'refs/remotes'], projectRoot),
  ]);

  const commits = parseGitCommits(rawLog);
  const statusSummary = parseGitStatusSummary(rawStatus);
  return {
    ok: true,
    summary: {
      ...statusSummary,
      localBranches: parseBranchList(rawLocalBranches),
      remoteBranches: parseBranchList(rawRemoteBranches),
    },
    commits,
    offset,
    limit,
    hasMore: commits.length === limit,
  };
});

ipcMain.handle('git:create-branch', async (_event, projectRoot, payload) => {
  if (!isSafePathInput(projectRoot)) {
    throw new Error('Invalid project root path');
  }

  const name = sanitizeBranchName(payload?.name);
  const from = sanitizeBranchName(payload?.from);

  if (!isValidBranchName(name)) {
    throw new Error('Invalid branch name');
  }

  const args = ['branch', name];
  if (from) {
    args.push(from);
  }
  await runCommandCapture('git', args, projectRoot);
  return {
    ok: true,
    name,
    from: from || null,
  };
});

ipcMain.handle('git:checkout-branch', async (_event, projectRoot, payload) => {
  if (!isSafePathInput(projectRoot)) {
    throw new Error('Invalid project root path');
  }

  const name = sanitizeBranchName(payload?.name);
  if (!name) {
    throw new Error('Branch name is required');
  }

  const rawLocal = await runCommandCapture(
    'git',
    ['for-each-ref', '--format=%(refname:short)', 'refs/heads'],
    projectRoot,
  );
  const localBranches = new Set(parseBranchList(rawLocal));
  if (localBranches.has(name)) {
    await runCommandCapture('git', ['switch', name], projectRoot);
    return { ok: true, checkedOut: name, created: false };
  }

  if (name.startsWith('origin/')) {
    const localName = name.slice('origin/'.length);
    if (!isValidBranchName(localName)) {
      throw new Error('Invalid tracking branch name');
    }
    if (localBranches.has(localName)) {
      await runCommandCapture('git', ['switch', localName], projectRoot);
      return { ok: true, checkedOut: localName, created: false };
    }
    await runCommandCapture('git', ['switch', '--track', '-c', localName, name], projectRoot);
    return { ok: true, checkedOut: localName, created: true };
  }

  await runCommandCapture('git', ['switch', name], projectRoot);
  return { ok: true, checkedOut: name, created: false };
});

ipcMain.handle('git:get-branch-changes', async (_event, projectRoot, branchNameRaw) => {
  if (!isSafePathInput(projectRoot)) {
    throw new Error('Invalid project root path');
  }

  const branchNameInput = sanitizeBranchName(branchNameRaw);
  let branchName = branchNameInput;

  if (!branchName) {
    branchName = (await runCommandCapture('git', ['branch', '--show-current'], projectRoot)).trim();
  }
  if (!branchName) {
    throw new Error('Unable to determine branch');
  }

  const baseRef = await resolveBranchChangesBase(projectRoot, branchName);
  if (!baseRef) {
    return {
      ok: true,
      branch: branchName,
      base: null,
      files: [],
      summary: {
        filesChanged: 0,
        insertions: 0,
        deletions: 0,
      },
    };
  }

  const mergeBase = (await runCommandCapture('git', ['merge-base', baseRef, branchName], projectRoot)).trim();
  const diffRange = `${mergeBase}...${branchName}`;

  const [rawNameStatus, rawNumstat] = await Promise.all([
    runCommandCapture('git', ['diff', '--name-status', diffRange], projectRoot),
    runCommandCapture('git', ['diff', '--numstat', diffRange], projectRoot),
  ]);

  const statusEntries = parseNameStatusEntries(rawNameStatus);
  const numstat = parseNumstatByPath(rawNumstat);
  const files = statusEntries.map((entry) => {
    const stats = numstat.byPath.get(entry.path) ?? { insertions: 0, deletions: 0 };
    return {
      status: entry.status,
      path: entry.path,
      insertions: stats.insertions,
      deletions: stats.deletions,
    };
  });

  return {
    ok: true,
    branch: branchName,
    base: baseRef,
    files,
    summary: {
      filesChanged: files.length,
      insertions: numstat.insertions,
      deletions: numstat.deletions,
    },
  };
});

ipcMain.handle('git:get-commit-stats', async (_event, projectRoot, commitId) => {
  if (!isSafePathInput(projectRoot)) {
    throw new Error('Invalid project root path');
  }

  if (typeof commitId !== 'string' || !/^[0-9a-f]{7,40}$/i.test(commitId)) {
    throw new Error('Invalid commit id');
  }

  const rawNumstat = await runCommandCapture('git', ['show', '--numstat', '--format=', commitId], projectRoot);
  let filesChanged = 0;
  let insertions = 0;
  let deletions = 0;

  for (const line of rawNumstat.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) {
      continue;
    }

    const [addedRaw = '', deletedRaw = '', pathValue = ''] = line.split('\t');
    if (!pathValue) {
      continue;
    }

    filesChanged += 1;
    if (/^\d+$/.test(addedRaw)) {
      insertions += Number.parseInt(addedRaw, 10);
    }
    if (/^\d+$/.test(deletedRaw)) {
      deletions += Number.parseInt(deletedRaw, 10);
    }
  }

  return {
    ok: true,
    commitId,
    filesChanged,
    insertions,
    deletions,
  };
});

ipcMain.handle('git:get-commit-details', async (_event, projectRoot, commitId) => {
  if (!isSafePathInput(projectRoot)) {
    throw new Error('Invalid project root path');
  }

  if (typeof commitId !== 'string' || !/^[0-9a-f]{7,40}$/i.test(commitId)) {
    throw new Error('Invalid commit id');
  }

  const [rawPatch, rawNameStatus] = await Promise.all([
    runCommandCapture('git', ['show', '--patch', '--unified=3', '--no-color', '--format=', commitId], projectRoot),
    runCommandCapture('git', ['show', '--name-status', '--format=', commitId], projectRoot),
  ]);

  return {
    ok: true,
    commitId,
    files: parseGitCommitFiles(rawNameStatus),
    patch: rawPatch,
  };
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
