import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { MouseEvent as ReactMouseEvent, ReactNode } from 'react'
import Editor from '@monaco-editor/react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { ChevronDown, X } from 'lucide-react'
import '@xterm/xterm/css/xterm.css'
import './App.css'

type EntryType = 'file' | 'directory'
type PanelId = 'explorer' | 'editor' | 'bottom'
type DockPosition = 'left' | 'right' | 'bottom' | 'center'
type ResizeDirection = 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw'

type FileNode = {
  name: string
  path: string
  type: EntryType
  loaded?: boolean
  children?: FileNode[]
}

type OpenTab = {
  path: string
  name: string
  content: string
  language: string
  dirty: boolean
}

type TerminalSession = {
  id: string
  title: string
  alive: boolean
  mode: 'pty' | 'pipe'
}

type PanelLayout = {
  mode: 'dock' | 'float'
  dockPosition: DockPosition
  x: number
  y: number
  width: number
  height: number
  z: number
}

type PanelVisibility = Record<PanelId, boolean>

const PANEL_TITLES: Record<PanelId, string> = {
  explorer: 'Explorer',
  editor: 'Editor',
  bottom: 'Terminal / Problems',
}

function detectLanguage(fileName: string): string {
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

function patchNode(nodes: FileNode[], targetPath: string, updater: (node: FileNode) => FileNode): FileNode[] {
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

type TerminalViewProps = {
  terminalId: string
  mode: 'pty' | 'pipe'
  initialBuffer: string
  active: boolean
  onInput: (terminalId: string, value: string) => void
  onResize: (terminalId: string, cols: number, rows: number) => void
}

function TerminalView({ terminalId, mode, initialBuffer, active, onInput, onResize }: TerminalViewProps) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const terminalRef = useRef<Terminal | null>(null)
  const fitAddonRef = useRef<FitAddon | null>(null)
  const lineBufferRef = useRef('')
  const initialBufferRef = useRef(initialBuffer)

  useEffect(() => {
    if (!containerRef.current) {
      return
    }

    const terminal = new Terminal({
      fontFamily: 'JetBrains Mono, ui-monospace, SFMono-Regular, Menlo, monospace',
      fontSize: 12,
      lineHeight: 1.45,
      cursorBlink: true,
      theme: {
        background: '#101318',
        foreground: '#e5e7eb',
      },
    })

    const fitAddon = new FitAddon()
    terminal.loadAddon(fitAddon)
    terminal.open(containerRef.current)
    fitAddon.fit()
    if (initialBufferRef.current.length > 0) {
      terminal.write(initialBufferRef.current)
    }
    onResize(terminalId, terminal.cols, terminal.rows)

    terminal.onData((value) => {
      if (mode === 'pty') {
        onInput(terminalId, value)
        return
      }

      for (const character of value) {
        if (character === '\r') {
          terminal.write('\r\n')
          onInput(terminalId, `${lineBufferRef.current}\n`)
          lineBufferRef.current = ''
          continue
        }

        if (character === '\u007f') {
          if (lineBufferRef.current.length > 0) {
            lineBufferRef.current = lineBufferRef.current.slice(0, -1)
            terminal.write('\b \b')
          }
          continue
        }

        if (character === '\u0003') {
          lineBufferRef.current = ''
          terminal.write('^C\r\n')
          onInput(terminalId, '\u0003')
          continue
        }

        lineBufferRef.current += character
        terminal.write(character)
      }
    })
    terminal.onResize((size) => onResize(terminalId, size.cols, size.rows))

    terminalRef.current = terminal
    fitAddonRef.current = fitAddon

    const unsubscribeData = window.ide.onTerminalData(terminalId, (payload) => {
      terminal.write(payload.data)
    })

    const unsubscribeExit = window.ide.onTerminalExit(terminalId, (payload) => {
      terminal.writeln(`\r\n[process exited: ${payload.exitCode ?? 'unknown'}]`)
    })

    const observer = new ResizeObserver(() => {
      fitAddon.fit()
      onResize(terminalId, terminal.cols, terminal.rows)
    })
    observer.observe(containerRef.current)

    return () => {
      observer.disconnect()
      unsubscribeData()
      unsubscribeExit()
      terminal.dispose()
    }
  }, [mode, onInput, onResize, terminalId])

  useEffect(() => {
    if (!active || !fitAddonRef.current) {
      return
    }

    const rafId = window.requestAnimationFrame(() => {
      fitAddonRef.current?.fit()
      if (terminalRef.current) {
        onResize(terminalId, terminalRef.current.cols, terminalRef.current.rows)
      }
      terminalRef.current?.focus()
    })

    return () => window.cancelAnimationFrame(rafId)
  }, [active, onResize, terminalId])

  return <div className={`terminal-view ${active ? 'active' : 'hidden'}`} ref={containerRef} />
}

type PanelChromeProps = {
  panelId: PanelId
  layout: PanelLayout
  onFloat: (panelId: PanelId) => void
  onDock: (panelId: PanelId, position: DockPosition) => void
  onDragStart: (panelId: PanelId, event: ReactMouseEvent<HTMLElement>) => void
  onResizeStart: (
    panelId: PanelId,
    direction: ResizeDirection,
    event: ReactMouseEvent<HTMLDivElement>,
  ) => void
  onHide: (panelId: PanelId) => void
  onFocus: (panelId: PanelId) => void
  children: ReactNode
}

function PanelChrome({
  panelId,
  layout,
  onFloat,
  onDock,
  onDragStart,
  onResizeStart,
  onHide,
  onFocus,
  children,
}: PanelChromeProps) {
  const [menuOpen, setMenuOpen] = useState(false)
  const actionsRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (!menuOpen) {
      return
    }

    const onPointerDown = (event: MouseEvent) => {
      const target = event.target as Node
      if (!actionsRef.current?.contains(target)) {
        setMenuOpen(false)
      }
    }

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setMenuOpen(false)
      }
    }

    window.addEventListener('mousedown', onPointerDown)
    window.addEventListener('keydown', onKeyDown)

    return () => {
      window.removeEventListener('mousedown', onPointerDown)
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [menuOpen])

  return (
    <section
      className={`panel-window ${layout.mode === 'float' ? 'floating' : 'docked'}`}
      style={
        layout.mode === 'float'
          ? {
              left: `${layout.x}px`,
              top: `${layout.y}px`,
              width: `${layout.width}px`,
              height: `${layout.height}px`,
              zIndex: layout.z,
            }
          : undefined
      }
      onMouseDown={() => onFocus(panelId)}
    >
      <header
        className={`panel-window-header ${layout.mode === 'float' ? 'drag-handle' : ''}`}
        onMouseDown={(event) => {
          if (layout.mode !== 'float') {
            return
          }

          const target = event.target as HTMLElement
          if (target.closest('.panel-window-actions')) {
            return
          }

          onDragStart(panelId, event)
        }}
      >
        <div className="panel-window-title">
          {PANEL_TITLES[panelId]}
        </div>
        <div className="panel-window-actions" ref={actionsRef}>
          <button
            className="panel-menu-trigger"
            onClick={(event) => {
              event.stopPropagation()
              setMenuOpen((value) => !value)
            }}
            aria-label="Panel actions"
          >
            <ChevronDown size={14} />
          </button>
          {menuOpen && (
            <div className="panel-menu-dropdown">
              {layout.mode === 'float' ? (
                <button
                  onClick={() => {
                    onDock(panelId, 'center')
                    setMenuOpen(false)
                  }}
                >
                  Dock
                </button>
              ) : (
                <button
                  onClick={() => {
                    onFloat(panelId)
                    setMenuOpen(false)
                  }}
                >
                  Float
                </button>
              )}
              <button
                onClick={() => {
                  onDock(panelId, 'left')
                  setMenuOpen(false)
                }}
              >
                Dock Left
              </button>
              <button
                onClick={() => {
                  onDock(panelId, 'right')
                  setMenuOpen(false)
                }}
              >
                Dock Right
              </button>
              <button
                onClick={() => {
                  onDock(panelId, 'bottom')
                  setMenuOpen(false)
                }}
              >
                Dock Bottom
              </button>
              <button
                onClick={() => {
                  onDock(panelId, 'center')
                  setMenuOpen(false)
                }}
              >
                Dock Center
              </button>
            </div>
          )}
          <button
            className="panel-close-btn"
            onClick={() => {
              setMenuOpen(false)
              onHide(panelId)
            }}
            aria-label={`Close ${PANEL_TITLES[panelId]} panel`}
          >
            <X size={14} />
          </button>
        </div>
      </header>
      <div className="panel-window-content">{children}</div>
      {layout.mode === 'float' && (
        <>
          <div
            className="resize-handle n"
            onMouseDown={(event) => onResizeStart(panelId, 'n', event)}
          />
          <div
            className="resize-handle s"
            onMouseDown={(event) => onResizeStart(panelId, 's', event)}
          />
          <div
            className="resize-handle e"
            onMouseDown={(event) => onResizeStart(panelId, 'e', event)}
          />
          <div
            className="resize-handle w"
            onMouseDown={(event) => onResizeStart(panelId, 'w', event)}
          />
          <div
            className="resize-handle ne"
            onMouseDown={(event) => onResizeStart(panelId, 'ne', event)}
          />
          <div
            className="resize-handle nw"
            onMouseDown={(event) => onResizeStart(panelId, 'nw', event)}
          />
          <div
            className="resize-handle se"
            onMouseDown={(event) => onResizeStart(panelId, 'se', event)}
          />
          <div
            className="resize-handle sw"
            onMouseDown={(event) => onResizeStart(panelId, 'sw', event)}
          />
        </>
      )}
    </section>
  )
}

function App() {
  const isMac = navigator.platform.toLowerCase().includes('mac')
  const workspaceRef = useRef<HTMLDivElement | null>(null)
  const dragStateRef = useRef<{
    panelId: PanelId
    startX: number
    startY: number
    originX: number
    originY: number
  } | null>(null)
  const resizeStateRef = useRef<{
    panelId: PanelId
    direction: ResizeDirection
    startX: number
    startY: number
    originX: number
    originY: number
    originWidth: number
    originHeight: number
  } | null>(null)

  const [projectRoot, setProjectRoot] = useState<string | null>(null)
  const [fileTree, setFileTree] = useState<FileNode[]>([])
  const [expandedPaths, setExpandedPaths] = useState<Set<string>>(new Set())
  const [openTabs, setOpenTabs] = useState<OpenTab[]>([])
  const [activeTabPath, setActiveTabPath] = useState<string | null>(null)
  const [activeBottomView, setActiveBottomView] = useState<'terminal' | 'problems'>('terminal')
  const [terminals, setTerminals] = useState<TerminalSession[]>([])
  const [terminalBuffers, setTerminalBuffers] = useState<Record<string, string>>({})
  const [activeTerminalId, setActiveTerminalId] = useState<string | null>(null)
  const [panelVisibility, setPanelVisibility] = useState<PanelVisibility>({
    explorer: true,
    editor: true,
    bottom: true,
  })
  const [panelLayouts, setPanelLayouts] = useState<Record<PanelId, PanelLayout>>({
    explorer: {
      mode: 'dock',
      dockPosition: 'left',
      x: 24,
      y: 24,
      width: 340,
      height: 520,
      z: 10,
    },
    editor: {
      mode: 'dock',
      dockPosition: 'center',
      x: 140,
      y: 78,
      width: 860,
      height: 560,
      z: 11,
    },
    bottom: {
      mode: 'dock',
      dockPosition: 'bottom',
      x: 220,
      y: 180,
      width: 820,
      height: 260,
      z: 12,
    },
  })
  const panelLayoutsRef = useRef(panelLayouts)
  const zCounterRef = useRef(30)

  const activeTab = useMemo(
    () => openTabs.find((tab) => tab.path === activeTabPath) ?? null,
    [openTabs, activeTabPath],
  )
  const sendTerminalInput = useCallback((terminalId: string, value: string) => {
    window.ide.sendTerminalInput(terminalId, value)
  }, [])
  const resizeTerminal = useCallback((terminalId: string, cols: number, rows: number) => {
    window.ide.resizeTerminal(terminalId, cols, rows)
  }, [])
  const hasDirtyTabs = openTabs.some((tab) => tab.dirty)

  useEffect(() => {
    panelLayoutsRef.current = panelLayouts
  }, [panelLayouts])

  const bringPanelToFront = useCallback((panelId: PanelId) => {
    const nextZ = ++zCounterRef.current
    setPanelLayouts((previous) => ({
      ...previous,
      [panelId]: {
        ...previous[panelId],
        z: nextZ,
      },
    }))
  }, [])

  const dockPanel = useCallback((panelId: PanelId, position: DockPosition) => {
    setPanelLayouts((previous) => {
      const next: Record<PanelId, PanelLayout> = {
        explorer: { ...previous.explorer },
        editor: { ...previous.editor },
        bottom: { ...previous.bottom },
      }

      ;(Object.keys(next) as PanelId[]).forEach((candidateId) => {
        if (candidateId !== panelId && next[candidateId].mode === 'dock' && next[candidateId].dockPosition === position) {
          next[candidateId].mode = 'float'
          next[candidateId].x = 56 + (candidateId === 'editor' ? 90 : 0)
          next[candidateId].y = 72 + (candidateId === 'bottom' ? 120 : 0)
        }
      })

      next[panelId].mode = 'dock'
      next[panelId].dockPosition = position

      return next
    })
  }, [])

  const floatPanel = useCallback((panelId: PanelId) => {
    setPanelLayouts((previous) => {
      const current = previous[panelId]
      if (current.mode === 'float') {
        return previous
      }

      const nextZ = ++zCounterRef.current
      return {
        ...previous,
        [panelId]: {
          ...current,
          mode: 'float',
          x: current.x + 26,
          y: current.y + 22,
          z: nextZ,
        },
      }
    })
  }, [])

  const handleDragStart = (panelId: PanelId, event: ReactMouseEvent<HTMLElement>) => {
    event.preventDefault()
    bringPanelToFront(panelId)

    const current = panelLayoutsRef.current[panelId]
    if (current.mode !== 'float') {
      return
    }

    dragStateRef.current = {
      panelId,
      startX: event.clientX,
      startY: event.clientY,
      originX: current.x,
      originY: current.y,
    }
  }

  const handleResizeStart = (
    panelId: PanelId,
    direction: ResizeDirection,
    event: ReactMouseEvent<HTMLDivElement>,
  ) => {
    event.preventDefault()
    event.stopPropagation()
    bringPanelToFront(panelId)

    const current = panelLayoutsRef.current[panelId]
    if (current.mode !== 'float') {
      return
    }

    resizeStateRef.current = {
      panelId,
      direction,
      startX: event.clientX,
      startY: event.clientY,
      originX: current.x,
      originY: current.y,
      originWidth: current.width,
      originHeight: current.height,
    }
  }

  useEffect(() => {
    const onMove = (event: MouseEvent) => {
      const resizeState = resizeStateRef.current
      if (resizeState && workspaceRef.current) {
        const workspaceRect = workspaceRef.current.getBoundingClientRect()
        const minimumWidth = 320
        const minimumHeight = 180
        const deltaX = event.clientX - resizeState.startX
        const deltaY = event.clientY - resizeState.startY

        let nextX = resizeState.originX
        let nextY = resizeState.originY
        let nextWidth = resizeState.originWidth
        let nextHeight = resizeState.originHeight

        if (resizeState.direction.includes('e')) {
          nextWidth = resizeState.originWidth + deltaX
        }

        if (resizeState.direction.includes('s')) {
          nextHeight = resizeState.originHeight + deltaY
        }

        if (resizeState.direction.includes('w')) {
          nextX = resizeState.originX + deltaX
          const rightEdge = resizeState.originX + resizeState.originWidth
          nextX = Math.min(Math.max(0, nextX), rightEdge - minimumWidth)
          nextWidth = rightEdge - nextX
        }

        if (resizeState.direction.includes('n')) {
          nextY = resizeState.originY + deltaY
          const bottomEdge = resizeState.originY + resizeState.originHeight
          nextY = Math.min(Math.max(0, nextY), bottomEdge - minimumHeight)
          nextHeight = bottomEdge - nextY
        }

        nextWidth = Math.max(minimumWidth, nextWidth)
        nextHeight = Math.max(minimumHeight, nextHeight)
        nextWidth = Math.min(nextWidth, workspaceRect.width - nextX)
        nextHeight = Math.min(nextHeight, workspaceRect.height - nextY)

        setPanelLayouts((previous) => ({
          ...previous,
          [resizeState.panelId]: {
            ...previous[resizeState.panelId],
            x: nextX,
            y: nextY,
            width: nextWidth,
            height: nextHeight,
          },
        }))
        return
      }

      const dragState = dragStateRef.current
      if (!dragState || !workspaceRef.current) {
        return
      }

      const panel = panelLayoutsRef.current[dragState.panelId]
      if (panel.mode !== 'float') {
        return
      }

      const workspaceRect = workspaceRef.current.getBoundingClientRect()
      const rawX = dragState.originX + (event.clientX - dragState.startX)
      const rawY = dragState.originY + (event.clientY - dragState.startY)

      const maxX = Math.max(0, workspaceRect.width - panel.width)
      const maxY = Math.max(0, workspaceRect.height - panel.height)

      const nextX = Math.min(Math.max(0, rawX), maxX)
      const nextY = Math.min(Math.max(0, rawY), maxY)

      setPanelLayouts((previous) => ({
        ...previous,
        [dragState.panelId]: {
          ...previous[dragState.panelId],
          x: nextX,
          y: nextY,
        },
      }))
    }

    const onUp = () => {
      dragStateRef.current = null
      resizeStateRef.current = null
    }

    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)

    return () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
  }, [])

  const loadDirectory = useCallback(async (directoryPath: string): Promise<FileNode[]> => {
    const entries = await window.ide.readDirectory(directoryPath)
    return entries.map((entry) => ({
      ...entry,
      loaded: entry.type === 'file',
    }))
  }, [])

  const openProject = useCallback(async () => {
    if (hasDirtyTabs) {
      const proceed = window.confirm('You have unsaved changes. Open a new folder and discard them?')
      if (!proceed) {
        return
      }
    }

    const selectedPath = await window.ide.openProjectDirectory()
    if (!selectedPath) {
      return
    }

    const rootItems = await loadDirectory(selectedPath)
    setProjectRoot(selectedPath)
    setFileTree(rootItems)
    setExpandedPaths(new Set())
    setOpenTabs([])
    setActiveTabPath(null)
  }, [hasDirtyTabs, loadDirectory])

  const toggleFolder = useCallback(
    async (node: FileNode) => {
      const nextExpanded = new Set(expandedPaths)
      const isOpen = nextExpanded.has(node.path)

      if (isOpen) {
        nextExpanded.delete(node.path)
        setExpandedPaths(nextExpanded)
        return
      }

      nextExpanded.add(node.path)
      setExpandedPaths(nextExpanded)

      if (node.loaded) {
        return
      }

      const children = await loadDirectory(node.path)
      setFileTree((prev) =>
        patchNode(prev, node.path, (target) => ({
          ...target,
          loaded: true,
          children,
        })),
      )
    },
    [expandedPaths, loadDirectory],
  )

  const openFile = useCallback(
    async (node: FileNode) => {
      if (node.type !== 'file') {
        return
      }

      const existing = openTabs.find((tab) => tab.path === node.path)
      if (existing) {
        setActiveTabPath(node.path)
        return
      }

      const content = await window.ide.readFile(node.path)
      const tab: OpenTab = {
        path: node.path,
        name: node.name,
        content,
        language: detectLanguage(node.name),
        dirty: false,
      }

      setOpenTabs((prev) => [...prev, tab])
      setActiveTabPath(node.path)
    },
    [openTabs],
  )

  const updateActiveTabContent = (nextValue: string) => {
    if (!activeTabPath) {
      return
    }

    setOpenTabs((prev) =>
      prev.map((tab) => {
        if (tab.path !== activeTabPath) {
          return tab
        }

        return {
          ...tab,
          content: nextValue,
          dirty: true,
        }
      }),
    )
  }

  const closeTab = (path: string) => {
    setOpenTabs((prev) => {
      const target = prev.find((tab) => tab.path === path)
      if (target?.dirty) {
        const proceed = window.confirm(`Discard unsaved changes in ${target.name}?`)
        if (!proceed) {
          return prev
        }
      }

      const nextTabs = prev.filter((tab) => tab.path !== path)

      if (activeTabPath === path) {
        const closedIndex = prev.findIndex((tab) => tab.path === path)
        const fallback = nextTabs[Math.max(0, closedIndex - 1)] ?? nextTabs[0] ?? null
        setActiveTabPath(fallback?.path ?? null)
      }

      return nextTabs
    })
  }

  const saveActiveTab = useCallback(async () => {
    if (!activeTab) {
      return
    }

    await window.ide.writeFile(activeTab.path, activeTab.content)
    setOpenTabs((prev) =>
      prev.map((tab) => (tab.path === activeTab.path ? { ...tab, dirty: false } : tab)),
    )
  }, [activeTab])

  const createTerminal = useCallback(async () => {
    const created = await window.ide.createTerminal(projectRoot)
    const title = `Terminal ${terminals.length + 1}`
    setTerminalBuffers((previous) => ({
      ...previous,
      [created.terminalId]: '',
    }))

    setTerminals((prev) => [...prev, { id: created.terminalId, title, alive: true, mode: created.mode }])
    setActiveTerminalId(created.terminalId)
    setActiveBottomView('terminal')
  }, [projectRoot, terminals.length])

  const closeTerminal = (terminalId: string) => {
    window.ide.closeTerminal(terminalId)
    setTerminalBuffers((previous) => {
      const next = { ...previous }
      delete next[terminalId]
      return next
    })
    setTerminals((prev) => {
      const next = prev.filter((session) => session.id !== terminalId)
      if (activeTerminalId === terminalId) {
        setActiveTerminalId(next.at(-1)?.id ?? null)
      }
      return next
    })
  }

  useEffect(() => {
    const unsubscribeExit = window.ide.onAnyTerminalExit((payload) => {
      setTerminals((prev) =>
        prev.map((session) =>
          session.id === payload.terminalId ? { ...session, alive: false } : session,
        ),
      )
    })

    return () => unsubscribeExit()
  }, [])

  useEffect(() => {
    const unsubscribeData = window.ide.onAnyTerminalData((payload) => {
      setTerminalBuffers((previous) => {
        const current = previous[payload.terminalId] ?? ''
        const next = current + payload.data
        return {
          ...previous,
          [payload.terminalId]: next.length > 120000 ? next.slice(-120000) : next,
        }
      })
    })

    return () => unsubscribeData()
  }, [])

  useEffect(() => {
    const unsubscribe = window.ide.onPanelVisibilityChange((payload) => {
      setPanelVisibility((previous) => ({
        ...previous,
        [payload.panelId]: payload.visible,
      }))
    })

    return () => unsubscribe()
  }, [])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 's') {
        event.preventDefault()
        saveActiveTab().catch(() => {})
      }
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [saveActiveTab])

  const renderTreeNode = (node: FileNode, depth = 0) => {
    const isExpanded = expandedPaths.has(node.path)

    return (
      <div key={node.path}>
        <button
          className={`tree-row ${node.type}`}
          style={{ paddingLeft: `${12 + depth * 14}px` }}
          onClick={() => {
            if (node.type === 'directory') {
              void toggleFolder(node)
            } else {
              void openFile(node)
            }
          }}
        >
          <span className="tree-icon">{node.type === 'directory' ? (isExpanded ? '▾' : '▸') : '·'}</span>
          <span>{node.name}</span>
        </button>

        {node.type === 'directory' && isExpanded && node.children && (
          <div>{node.children.map((child) => renderTreeNode(child, depth + 1))}</div>
        )}
      </div>
    )
  }

  const renderExplorer = () => (
    <div className="explorer-panel">
      <div className="panel-header">
        <span>Explorer</span>
        <button onClick={() => void openProject()}>Open Folder</button>
      </div>
      <div className="project-label">{projectRoot ?? 'No folder selected'}</div>
      <div className="tree-scroll">{fileTree.map((node) => renderTreeNode(node))}</div>
    </div>
  )

  const renderEditor = () => (
    <div className="editor-panel">
      <header className="tabs-strip">
        {openTabs.length === 0 && <div className="empty-tab">No file open</div>}
        {openTabs.map((tab) => (
          <div
            key={tab.path}
            className={`tab-item ${tab.path === activeTabPath ? 'active' : ''}`}
            onClick={() => setActiveTabPath(tab.path)}
          >
            <span>{tab.name}</span>
            {tab.dirty && <span className="dirty-dot">●</span>}
            <button
              onClick={(event) => {
                event.stopPropagation()
                closeTab(tab.path)
              }}
            >
              ×
            </button>
          </div>
        ))}
        <div className="tabs-actions">
          <button onClick={() => void saveActiveTab()} disabled={!activeTab || !activeTab.dirty}>
            Save
          </button>
        </div>
      </header>
      <section className="editor-pane">
        {activeTab ? (
          <Editor
            height="100%"
            path={activeTab.path}
            theme="vs-dark"
            language={activeTab.language}
            value={activeTab.content}
            onChange={(value) => updateActiveTabContent(value ?? '')}
            options={{
              minimap: { enabled: true },
              fontFamily: 'JetBrains Mono, ui-monospace, SFMono-Regular, Menlo, monospace',
              fontSize: 14,
              smoothScrolling: true,
              tabSize: 2,
              wordWrap: 'on',
            }}
          />
        ) : (
          <div className="empty-editor">Open a file to start editing</div>
        )}
      </section>
    </div>
  )

  const renderBottom = () => (
    <section className="bottom-panel">
      <div className="bottom-header">
        <button
          className={activeBottomView === 'terminal' ? 'active' : ''}
          onClick={() => setActiveBottomView('terminal')}
        >
          Terminal
        </button>
        <button
          className={activeBottomView === 'problems' ? 'active' : ''}
          onClick={() => setActiveBottomView('problems')}
        >
          Problems
        </button>
        {activeBottomView === 'terminal' && (
          <div className="terminal-actions">
            <button onClick={() => void createTerminal()}>+ New</button>
          </div>
        )}
      </div>

      {activeBottomView === 'terminal' ? (
        <div className="terminal-shell">
          <div className="terminal-tabs">
            {terminals.map((session) => (
              <div
                key={session.id}
                className={`terminal-tab ${session.id === activeTerminalId ? 'active' : ''}`}
                onClick={() => setActiveTerminalId(session.id)}
              >
                  <span>{session.title}</span>
                  {session.mode === 'pipe' && <span className="dead-indicator">fallback</span>}
                  {!session.alive && <span className="dead-indicator">dead</span>}
                <button
                  onClick={(event) => {
                    event.stopPropagation()
                    closeTerminal(session.id)
                  }}
                >
                  ×
                </button>
              </div>
            ))}
          </div>

          <div className="terminal-panes">
            {terminals.map((session) => (
              <TerminalView
                key={session.id}
                terminalId={session.id}
                mode={session.mode}
                initialBuffer={terminalBuffers[session.id] ?? ''}
                active={session.id === activeTerminalId}
                onInput={sendTerminalInput}
                onResize={resizeTerminal}
              />
            ))}
            {terminals.length === 0 && <div className="empty-editor">No terminal sessions</div>}
          </div>
        </div>
      ) : (
        <div className="problems-pane">No issues detected.</div>
      )}
    </section>
  )

  const panelContent: Record<PanelId, ReactNode> = {
    explorer: renderExplorer(),
    editor: renderEditor(),
    bottom: renderBottom(),
  }

  const dockedLeft = (Object.keys(panelLayouts) as PanelId[]).find(
    (panelId) =>
      panelVisibility[panelId] &&
      panelLayouts[panelId].mode === 'dock' &&
      panelLayouts[panelId].dockPosition === 'left',
  )
  const dockedRight = (Object.keys(panelLayouts) as PanelId[]).find(
    (panelId) =>
      panelVisibility[panelId] &&
      panelLayouts[panelId].mode === 'dock' &&
      panelLayouts[panelId].dockPosition === 'right',
  )
  const dockedCenter = (Object.keys(panelLayouts) as PanelId[]).find(
    (panelId) =>
      panelVisibility[panelId] &&
      panelLayouts[panelId].mode === 'dock' &&
      panelLayouts[panelId].dockPosition === 'center',
  )
  const dockedBottom = (Object.keys(panelLayouts) as PanelId[]).find(
    (panelId) =>
      panelVisibility[panelId] &&
      panelLayouts[panelId].mode === 'dock' &&
      panelLayouts[panelId].dockPosition === 'bottom',
  )

  const floatingPanels = (Object.keys(panelLayouts) as PanelId[])
    .filter((panelId) => panelVisibility[panelId] && panelLayouts[panelId].mode === 'float')
    .sort((a, b) => panelLayouts[a].z - panelLayouts[b].z)

  const hidePanel = useCallback((panelId: PanelId) => {
    setPanelVisibility((previous) => ({
      ...previous,
      [panelId]: false,
    }))
    window.ide.setPanelVisibility(panelId, false).catch(() => {})
  }, [])

  return (
    <div className="desktop-shell">
      {isMac && (
        <header className="window-titlebar">
          <div className="window-title">BORE IDE</div>
        </header>
      )}

      <div className="ide-app">
        <aside className="activity-bar">
          <button className="activity-btn active">Files</button>
          <button className="activity-btn">Git</button>
          <button className="activity-btn">AI</button>
        </aside>

        <div className="workbench" ref={workspaceRef}>
          <div className="dock-layout">
            {dockedLeft && (
              <div className="dock-left">
                <PanelChrome
                  panelId={dockedLeft}
                  layout={panelLayouts[dockedLeft]}
                  onFloat={floatPanel}
                  onDock={dockPanel}
                  onDragStart={handleDragStart}
                  onResizeStart={handleResizeStart}
                  onHide={hidePanel}
                  onFocus={bringPanelToFront}
                >
                  {panelContent[dockedLeft]}
                </PanelChrome>
              </div>
            )}

            <div className="dock-main">
              <div className="dock-center">
                {dockedCenter ? (
                  <PanelChrome
                    panelId={dockedCenter}
                    layout={panelLayouts[dockedCenter]}
                    onFloat={floatPanel}
                    onDock={dockPanel}
                    onDragStart={handleDragStart}
                    onResizeStart={handleResizeStart}
                    onHide={hidePanel}
                    onFocus={bringPanelToFront}
                  >
                    {panelContent[dockedCenter]}
                  </PanelChrome>
                ) : null}
              </div>

              {dockedBottom && (
                <div className="dock-bottom">
                  <PanelChrome
                    panelId={dockedBottom}
                    layout={panelLayouts[dockedBottom]}
                    onFloat={floatPanel}
                    onDock={dockPanel}
                    onDragStart={handleDragStart}
                    onResizeStart={handleResizeStart}
                    onHide={hidePanel}
                    onFocus={bringPanelToFront}
                  >
                    {panelContent[dockedBottom]}
                  </PanelChrome>
                </div>
              )}
            </div>

            {dockedRight && (
              <div className="dock-right">
                <PanelChrome
                  panelId={dockedRight}
                  layout={panelLayouts[dockedRight]}
                  onFloat={floatPanel}
                  onDock={dockPanel}
                  onDragStart={handleDragStart}
                  onResizeStart={handleResizeStart}
                  onHide={hidePanel}
                  onFocus={bringPanelToFront}
                >
                  {panelContent[dockedRight]}
                </PanelChrome>
              </div>
            )}
          </div>

          {floatingPanels.map((panelId) => (
            <PanelChrome
              key={panelId}
              panelId={panelId}
              layout={panelLayouts[panelId]}
              onFloat={floatPanel}
              onDock={dockPanel}
              onDragStart={handleDragStart}
              onResizeStart={handleResizeStart}
              onHide={hidePanel}
              onFocus={bringPanelToFront}
            >
              {panelContent[panelId]}
            </PanelChrome>
          ))}
        </div>
      </div>
    </div>
  )
}

export default App
