export type EntryType = 'file' | 'directory'
export type PanelId = 'explorer' | 'editor' | 'bottom' | 'git' | 'help' | 'scratch'
export type DockPosition = 'left' | 'right' | 'bottom' | 'center'
export type ResizeDirection = 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw'

export type FileNode = {
  name: string
  path: string
  type: EntryType
  loaded?: boolean
  children?: FileNode[]
}

export type OpenTab = {
  path: string
  name: string
  content: string
  language: string
  dirty: boolean
}

export type TerminalSession = {
  id: string
  title: string
  alive: boolean
  mode: 'pty' | 'pipe'
}

export type PanelLayout = {
  mode: 'dock' | 'float'
  dockPosition: DockPosition
  x: number
  y: number
  width: number
  height: number
  z: number
  collapsed: boolean
}

export type PanelVisibility = Record<PanelId, boolean>

export type PersistedLayout = {
  version: 1
  panelLayouts: Record<PanelId, PanelLayout>
  panelVisibility: PanelVisibility
}

export const PANEL_TITLES: Record<PanelId, string> = {
  explorer: 'Explorer',
  editor: 'Editor',
  bottom: 'Terminal / Problems',
  git: 'Git Command Center',
  help: 'Help',
  scratch: 'Scratch Pad',
}

const DEFAULT_PANEL_LAYOUTS: Record<PanelId, PanelLayout> = {
  explorer: {
    mode: 'dock',
    dockPosition: 'left',
    x: 24,
    y: 24,
    width: 340,
    height: 520,
    z: 10,
    collapsed: false,
  },
  editor: {
    mode: 'dock',
    dockPosition: 'center',
    x: 140,
    y: 78,
    width: 860,
    height: 560,
    z: 11,
    collapsed: false,
  },
  bottom: {
    mode: 'dock',
    dockPosition: 'bottom',
    x: 220,
    y: 180,
    width: 820,
    height: 260,
    z: 12,
    collapsed: false,
  },
  git: {
    mode: 'float',
    dockPosition: 'right',
    x: 260,
    y: 96,
    width: 700,
    height: 420,
    z: 13,
    collapsed: false,
  },
  help: {
    mode: 'float',
    dockPosition: 'right',
    x: 220,
    y: 120,
    width: 520,
    height: 320,
    z: 14,
    collapsed: false,
  },
  scratch: {
    mode: 'float',
    dockPosition: 'right',
    x: 320,
    y: 140,
    width: 520,
    height: 300,
    z: 15,
    collapsed: false,
  },
}

export const DEFAULT_PANEL_VISIBILITY: PanelVisibility = {
  explorer: true,
  editor: true,
  bottom: true,
  git: false,
  help: false,
  scratch: false,
}

export function cloneDefaultPanelLayouts(): Record<PanelId, PanelLayout> {
  return {
    explorer: { ...DEFAULT_PANEL_LAYOUTS.explorer },
    editor: { ...DEFAULT_PANEL_LAYOUTS.editor },
    bottom: { ...DEFAULT_PANEL_LAYOUTS.bottom },
    git: { ...DEFAULT_PANEL_LAYOUTS.git },
    help: { ...DEFAULT_PANEL_LAYOUTS.help },
    scratch: { ...DEFAULT_PANEL_LAYOUTS.scratch },
  }
}

function isDockPosition(value: unknown): value is DockPosition {
  return value === 'left' || value === 'right' || value === 'bottom' || value === 'center'
}

export function normalizePersistedLayout(payload: unknown): PersistedLayout | null {
  if (!payload || typeof payload !== 'object') {
    return null
  }

  const candidate = payload as Partial<PersistedLayout>
  if (candidate.version !== 1 || !candidate.panelLayouts || !candidate.panelVisibility) {
    return null
  }

  const defaultLayouts = cloneDefaultPanelLayouts()
  const nextLayouts: Record<PanelId, PanelLayout> = {
    explorer: { ...defaultLayouts.explorer },
    editor: { ...defaultLayouts.editor },
    bottom: { ...defaultLayouts.bottom },
    git: { ...defaultLayouts.git },
    help: { ...defaultLayouts.help },
    scratch: { ...defaultLayouts.scratch },
  }

  for (const panelId of ['explorer', 'editor', 'bottom', 'git', 'help', 'scratch'] as PanelId[]) {
    const raw = candidate.panelLayouts[panelId]
    if (!raw || typeof raw !== 'object') {
      continue
    }

    const layout = raw as Partial<PanelLayout>
    if (
      (layout.mode === 'dock' || layout.mode === 'float') &&
      isDockPosition(layout.dockPosition) &&
      typeof layout.x === 'number' &&
      typeof layout.y === 'number' &&
      typeof layout.width === 'number' &&
      typeof layout.height === 'number' &&
      typeof layout.z === 'number'
    ) {
      nextLayouts[panelId] = {
        mode: layout.mode,
        dockPosition: layout.dockPosition,
        x: layout.x,
        y: layout.y,
        width: layout.width,
        height: layout.height,
        z: layout.z,
        collapsed: layout.collapsed === true && layout.mode === 'float',
      }
    }
  }

  const visibility: PanelVisibility = {
    explorer: candidate.panelVisibility.explorer !== false,
    editor: candidate.panelVisibility.editor !== false,
    bottom: candidate.panelVisibility.bottom !== false,
    git: candidate.panelVisibility.git === true,
    help: candidate.panelVisibility.help === true,
    scratch: candidate.panelVisibility.scratch === true,
  }

  return {
    version: 1,
    panelLayouts: nextLayouts,
    panelVisibility: visibility,
  }
}

export function detectLanguage(fileName: string): string {
  const ext = fileName.split('.').pop()?.toLowerCase()

  switch (ext) {
    case 'ts':
    case 'tsx':
      return 'typescript'
    case 'js':
    case 'jsx':
      return 'javascript'
    case 'json':
      return 'json'
    case 'py':
      return 'python'
    case 'md':
      return 'markdown'
    case 'css':
      return 'css'
    case 'html':
      return 'html'
    case 'yml':
    case 'yaml':
      return 'yaml'
    case 'sh':
      return 'shell'
    default:
      return 'plaintext'
  }
}

export function patchNode(
  nodes: FileNode[],
  targetPath: string,
  updater: (node: FileNode) => FileNode,
): FileNode[] {
  return nodes.map((node) => {
    if (node.path === targetPath) {
      return updater(node)
    }

    if (node.children) {
      return {
        ...node,
        children: patchNode(node.children, targetPath, updater),
      }
    }

    return node
  })
}
