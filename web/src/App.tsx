import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { MouseEvent as ReactMouseEvent, ReactNode } from 'react'
import Editor from '@monaco-editor/react'
import { CommandLinePanel } from './components/CommandLinePanel'
import { EditorCrashBoundary } from './components/EditorCrashBoundary'
import { GitCommandCenter } from './components/GitCommandCenter'
import { OptionsModal } from './components/OptionsModal'
import type { CommandAlias, CommandAliasTarget } from './components/OptionsModal'
import { PanelChrome } from './components/PanelChrome'
import { ScratchPad } from './components/ScratchPad'
import { StartupScreen } from './components/StartupScreen'
import { TerminalView } from './components/TerminalView'
import {
  DEFAULT_PANEL_VISIBILITY,
  cloneDefaultPanelLayouts,
  detectLanguage,
  normalizePersistedLayout,
  patchNode,
} from './types/workbench'
import type {
  DockPosition,
  FileNode,
  OpenTab,
  PanelId,
  PanelLayout,
  PanelVisibility,
  PersistedLayout,
  ResizeDirection,
  TerminalSession,
} from './types/workbench'
import '@xterm/xterm/css/xterm.css'
import './App.css'

const COMMAND_LINE_WIDTH = 680
const COMMAND_LINE_HEIGHT = 64
const REFRESH_PROJECT_KEY = 'bore.refreshProjectRoot'

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
  const commandLineDragRef = useRef<{
    startX: number
    startY: number
    originX: number
    originY: number
  } | null>(null)

  const [projectRoot, setProjectRoot] = useState<string | null>(null)
  const [startupMode, setStartupMode] = useState<'home' | 'clone'>('home')
  const [cloneUrl, setCloneUrl] = useState('')
  const [cloneDestination, setCloneDestination] = useState('')
  const [startupError, setStartupError] = useState<string | null>(null)
  const [startupBusy, setStartupBusy] = useState(false)
  const [optionsOpen, setOptionsOpen] = useState(false)
  const [optionsTab, setOptionsTab] = useState<'command-line'>('command-line')
  const [optionsBusy, setOptionsBusy] = useState(false)
  const [optionsError, setOptionsError] = useState<string | null>(null)
  const [commandAliases, setCommandAliases] = useState<CommandAlias[]>([])
  const [recentProjects, setRecentProjects] = useState<string[]>([])
  const [fileTree, setFileTree] = useState<FileNode[]>([])
  const [expandedPaths, setExpandedPaths] = useState<Set<string>>(new Set())
  const [openTabs, setOpenTabs] = useState<OpenTab[]>([])
  const [activeTabPath, setActiveTabPath] = useState<string | null>(null)
  const [editorNotice, setEditorNotice] = useState<string | null>(null)
  const [editorResetVersion, setEditorResetVersion] = useState(0)
  const [activeBottomView, setActiveBottomView] = useState<'terminal' | 'problems'>('terminal')
  const [commandLineOpen, setCommandLineOpen] = useState(false)
  const [commandLineInput, setCommandLineInput] = useState('')
  const [commandLineWindow, setCommandLineWindow] = useState({
    x: 160,
    y: 72,
    z: 1400,
  })
  const [terminals, setTerminals] = useState<TerminalSession[]>([])
  const [terminalBuffers, setTerminalBuffers] = useState<Record<string, string>>({})
  const [activeTerminalId, setActiveTerminalId] = useState<string | null>(null)
  const [panelVisibility, setPanelVisibility] = useState<PanelVisibility>({ ...DEFAULT_PANEL_VISIBILITY })
  const [panelLayouts, setPanelLayouts] = useState<Record<PanelId, PanelLayout>>(cloneDefaultPanelLayouts())
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
  const openTabsRef = useRef(openTabs)
  const openingFilePathsRef = useRef<Set<string>>(new Set())

  useEffect(() => {
    panelLayoutsRef.current = panelLayouts
  }, [panelLayouts])

  useEffect(() => {
    openTabsRef.current = openTabs
  }, [openTabs])

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

  const bringCommandLineToFront = useCallback(() => {
    const nextZ = ++zCounterRef.current
    setCommandLineWindow((previous) => ({
      ...previous,
      z: nextZ,
    }))
  }, [])

  const openCommandLine = useCallback(() => {
    const nextZ = ++zCounterRef.current
    if (workspaceRef.current) {
      const bounds = workspaceRef.current.getBoundingClientRect()
      const width = COMMAND_LINE_WIDTH
      const height = COMMAND_LINE_HEIGHT
      const x = Math.max(12, Math.floor((bounds.width - width) / 2))
      const y = Math.max(12, bounds.height - height - 18)
      setCommandLineWindow((previous) => ({
        ...previous,
        x,
        y,
        z: nextZ,
      }))
    } else {
      setCommandLineWindow((previous) => ({
        ...previous,
        z: nextZ,
      }))
    }

    setCommandLineOpen(true)
  }, [])

  const dockPanel = useCallback((panelId: PanelId, position: DockPosition) => {
    setPanelLayouts((previous) => {
      const next = Object.fromEntries(
        (Object.keys(previous) as PanelId[]).map((id) => [id, { ...previous[id] }]),
      ) as Record<PanelId, PanelLayout>

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
          collapsed: false,
          x: current.x + 26,
          y: current.y + 22,
          z: nextZ,
        },
      }
    })
  }, [])

  const toggleCollapse = useCallback((panelId: PanelId) => {
    setPanelLayouts((previous) => ({
      ...previous,
      [panelId]: {
        ...previous[panelId],
        collapsed: !previous[panelId].collapsed,
      },
    }))
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

  useEffect(() => {
    const onMove = (event: MouseEvent) => {
      const dragState = commandLineDragRef.current
      if (!dragState || !workspaceRef.current) {
        return
      }

      const workspaceRect = workspaceRef.current.getBoundingClientRect()
      setCommandLineWindow((previous) => {
        const rawX = dragState.originX + (event.clientX - dragState.startX)
        const rawY = dragState.originY + (event.clientY - dragState.startY)
        const maxX = Math.max(0, workspaceRect.width - COMMAND_LINE_WIDTH)
        const maxY = Math.max(0, workspaceRect.height - COMMAND_LINE_HEIGHT)

        return {
          ...previous,
          x: Math.min(Math.max(0, rawX), maxX),
          y: Math.min(Math.max(0, rawY), maxY),
        }
      })
    }

    const onUp = () => {
      commandLineDragRef.current = null
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

  const normalizeAliasList = (aliases: CommandAlias[]): CommandAlias[] => {
    const seen = new Set<string>()
    const next: CommandAlias[] = []
    for (const alias of aliases) {
      const keyword = alias.keyword.trim().toLowerCase()
      if (!keyword || keyword.length > 32 || seen.has(keyword)) {
        continue
      }
      if (alias.target !== 'editor' && alias.target !== 'explorer' && alias.target !== 'terminal') {
        continue
      }
      seen.add(keyword)
      next.push({ keyword, target: alias.target })
    }
    return next
  }

  const loadSettings = useCallback(async () => {
    const settings = await window.ide.getSettings()
    setCommandAliases(normalizeAliasList(settings.commandLineAliases as CommandAlias[]))
  }, [])

  const saveSettings = useCallback(async () => {
    const normalized = normalizeAliasList(commandAliases)
    setOptionsBusy(true)
    setOptionsError(null)
    try {
      const saved = await window.ide.saveSettings({ commandLineAliases: normalized })
      setCommandAliases(normalizeAliasList(saved.commandLineAliases as CommandAlias[]))
      setOptionsOpen(false)
    } catch (error) {
      setOptionsError(error instanceof Error ? error.message : 'Failed to save options')
    } finally {
      setOptionsBusy(false)
    }
  }, [commandAliases])

  const refreshRecentProjects = useCallback(async () => {
    const projects = await window.ide.getRecentProjects()
    setRecentProjects(projects.slice(0, 5))
  }, [])

  const initializeProject = useCallback(
    async (folderPath: string) => {
      const preparedPath = await window.ide.prepareProjectFolder(folderPath)
      const persistedLayout = normalizePersistedLayout(await window.ide.readProjectLayout(preparedPath))
      const layouts = persistedLayout?.panelLayouts ?? cloneDefaultPanelLayouts()
      const visibility = persistedLayout?.panelVisibility ?? { ...DEFAULT_PANEL_VISIBILITY }

      const rootItems = await loadDirectory(preparedPath)
      const maxZ = Math.max(...Object.values(layouts).map((layout) => layout.z), 30)
      zCounterRef.current = maxZ
      sessionStorage.setItem(REFRESH_PROJECT_KEY, preparedPath)

      setProjectRoot(preparedPath)
      setFileTree(rootItems)
      setPanelLayouts(layouts)
      setPanelVisibility(visibility)
      setExpandedPaths(new Set())
      setOpenTabs([])
      setActiveTabPath(null)
      setStartupError(null)
      await refreshRecentProjects()
    },
    [loadDirectory, refreshRecentProjects],
  )

  const pickDirectoryForClone = async () => {
    const selectedPath = await window.ide.openProjectDirectory()
    if (!selectedPath) {
      return
    }

    setCloneDestination(selectedPath)
  }

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

    await initializeProject(selectedPath)
  }, [hasDirtyTabs, initializeProject])

  const cloneProject = async () => {
    if (!cloneUrl.trim() || !cloneDestination.trim()) {
      setStartupError('Repository URL and destination folder are required.')
      return
    }

    try {
      setStartupBusy(true)
      setStartupError(null)
      const clonedPath = await window.ide.cloneRepository(cloneUrl.trim(), cloneDestination.trim())
      await initializeProject(clonedPath)
    } catch (error) {
      setStartupError(error instanceof Error ? error.message : 'Failed to clone repository.')
    } finally {
      setStartupBusy(false)
    }
  }

  const openExistingFolderFromStartup = async () => {
    try {
      setStartupBusy(true)
      setStartupError(null)
      const selectedPath = await window.ide.openProjectDirectory()
      if (!selectedPath) {
        return
      }

      await initializeProject(selectedPath)
    } catch (error) {
      setStartupError(error instanceof Error ? error.message : 'Failed to open folder.')
    } finally {
      setStartupBusy(false)
    }
  }

  const openRecentProject = async (projectPath: string) => {
    try {
      setStartupBusy(true)
      setStartupError(null)
      await initializeProject(projectPath)
    } catch (error) {
      setStartupError(error instanceof Error ? error.message : 'Failed to open recent project.')
    } finally {
      setStartupBusy(false)
    }
  }

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

      setPanelVisibility((previous) => ({
        ...previous,
        editor: true,
      }))
      window.ide.setPanelVisibility('editor', true).catch(() => {})
      bringPanelToFront('editor')
      setEditorNotice(null)

      const existing = openTabsRef.current.find((tab) => tab.path === node.path)
      if (existing) {
        if (activeTabPath !== node.path) {
          setActiveTabPath(node.path)
        } else {
          // Recover boundary state when re-focusing an already active file.
          setEditorResetVersion((value) => value + 1)
        }
        return
      }

      if (openingFilePathsRef.current.has(node.path)) {
        return
      }
      openingFilePathsRef.current.add(node.path)

      let content = ''
      try {
        content = await window.ide.readFile(node.path)
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown read error'
        setEditorNotice(`Unable to open ${node.name}: ${message}`)
        openingFilePathsRef.current.delete(node.path)
        return
      }

      if (content.includes('\u0000')) {
        setEditorNotice(`Cannot open ${node.name}: binary files are not supported in editor yet.`)
        openingFilePathsRef.current.delete(node.path)
        return
      }

      if (content.length > 1_500_000) {
        setEditorNotice(`Cannot open ${node.name}: file is too large for this editor view.`)
        openingFilePathsRef.current.delete(node.path)
        return
      }

      const tab: OpenTab = {
        path: node.path,
        name: node.name,
        content,
        language: detectLanguage(node.name),
        dirty: false,
      }

      setOpenTabs((prev) => (prev.some((entry) => entry.path === tab.path) ? prev : [...prev, tab]))
      setActiveTabPath(node.path)
      openingFilePathsRef.current.delete(node.path)
    },
    [activeTabPath, bringPanelToFront],
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

  const saveCurrentLayout = useCallback(async () => {
    if (!projectRoot) {
      return
    }

    const payload: PersistedLayout = {
      version: 1,
      panelLayouts: panelLayoutsRef.current,
      panelVisibility,
    }

    await window.ide.saveProjectLayout(projectRoot, payload)
  }, [panelVisibility, projectRoot])

  const closeProject = useCallback(() => {
    if (!projectRoot) {
      return
    }

    if (hasDirtyTabs) {
      const proceed = window.confirm('You have unsaved changes. Close project and discard them?')
      if (!proceed) {
        return
      }
    }

    for (const session of terminals) {
      window.ide.closeTerminal(session.id)
    }
    sessionStorage.removeItem(REFRESH_PROJECT_KEY)

    setProjectRoot(null)
    setStartupMode('home')
    setStartupError(null)
    setStartupBusy(false)
    setOptionsOpen(false)
    setOptionsError(null)
    setFileTree([])
    setExpandedPaths(new Set())
    setOpenTabs([])
    setActiveTabPath(null)
    setCommandLineInput('')
    setCommandLineOpen(false)
    setPanelVisibility({ ...DEFAULT_PANEL_VISIBILITY })
    setPanelLayouts(cloneDefaultPanelLayouts())
    setTerminals([])
    setTerminalBuffers({})
    setActiveTerminalId(null)
  }, [hasDirtyTabs, projectRoot, terminals])

  useEffect(() => {
    const unsubscribe = window.ide.onSaveLayoutRequest(() => {
      void saveCurrentLayout()
    })

    return () => unsubscribe()
  }, [saveCurrentLayout])

  useEffect(() => {
    const unsubscribe = window.ide.onToggleCommandLine(() => {
      if (commandLineOpen) {
        setCommandLineOpen(false)
      } else {
        openCommandLine()
      }
    })

    return () => unsubscribe()
  }, [commandLineOpen, openCommandLine])

  useEffect(() => {
    const unsubscribe = window.ide.onOpenOptionsRequest(() => {
      setOptionsOpen(true)
      setOptionsError(null)
    })

    return () => unsubscribe()
  }, [])

  useEffect(() => {
    const unsubscribe = window.ide.onCloseProjectRequest(() => {
      closeProject()
    })

    return () => unsubscribe()
  }, [closeProject])

  useEffect(() => {
    refreshRecentProjects().catch(() => {})
  }, [refreshRecentProjects])

  useEffect(() => {
    const refreshProjectPath = sessionStorage.getItem(REFRESH_PROJECT_KEY)
    if (!refreshProjectPath) {
      return
    }

    setStartupBusy(true)
    setStartupError(null)
    initializeProject(refreshProjectPath)
      .catch(() => {
        sessionStorage.removeItem(REFRESH_PROJECT_KEY)
      })
      .finally(() => {
        setStartupBusy(false)
      })
  }, [initializeProject])

  useEffect(() => {
    loadSettings().catch(() => {})
  }, [loadSettings])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault()
        if (commandLineOpen) {
          setCommandLineOpen(false)
        } else {
          openCommandLine()
        }
        return
      }

      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 's') {
        event.preventDefault()
        saveActiveTab().catch(() => {})
      }
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [commandLineOpen, openCommandLine, saveActiveTab])

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
        {editorNotice && <div className="editor-notice">{editorNotice}</div>}
        <div className="editor-body">
          {activeTab ? (
            <EditorCrashBoundary resetKey={`${activeTab.path}:${editorResetVersion}`}>
              <Editor
                key={`${activeTab.path}:${editorResetVersion}`}
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
            </EditorCrashBoundary>
          ) : (
            <div className="empty-editor">Open a file to start editing</div>
          )}
        </div>
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
    git: <GitCommandCenter projectRoot={projectRoot ?? ''} />,
    help: <section className="help-content" />,
    scratch: <ScratchPad projectRoot={projectRoot} />,
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

  const setPanelOpenState = useCallback((panelId: PanelId, visible: boolean) => {
    setPanelVisibility((previous) => ({
      ...previous,
      [panelId]: visible,
    }))
    if (panelId === 'explorer' || panelId === 'editor' || panelId === 'bottom' || panelId === 'scratch') {
      window.ide.setPanelVisibility(panelId, visible).catch(() => {})
    }
  }, [])

  const hidePanel = useCallback((panelId: PanelId) => {
    setPanelOpenState(panelId, false)
  }, [setPanelOpenState])

  const resolvePanelFromToken = (token: string): PanelId | null => {
    if (token === 'explorer') {
      return 'explorer'
    }
    if (token === 'editor') {
      return 'editor'
    }
    if (token === 'terminal' || token === 'bottom' || token === 'problems') {
      return 'bottom'
    }
    if (token === 'git') {
      return 'git'
    }
    if (token === 'help') {
      return 'help'
    }
    if (token === 'scratch' || token === 'scratchpad') {
      return 'scratch'
    }
    return null
  }

  const resolveAliasTarget = (target: CommandAliasTarget): PanelId => {
    if (target === 'terminal') {
      return 'bottom'
    }
    return target
  }

  const runCommandLine = useCallback(() => {
    const normalized = commandLineInput.trim().toLowerCase().replace(/\s+/g, ' ')
    if (!normalized) {
      return
    }

    if (normalized === 'help') {
      setPanelOpenState('help', true)
      bringPanelToFront('help')
      setCommandLineInput('')
      return
    }

    if (normalized === 'ref') {
      if (projectRoot) {
        sessionStorage.setItem(REFRESH_PROJECT_KEY, projectRoot)
      }
      window.location.reload()
      return
    }

    if (normalized === 'close command line') {
      setCommandLineOpen(false)
      setCommandLineInput('')
      return
    }

    const alias = commandAliases.find((entry) => entry.keyword === normalized)
    if (alias) {
      setPanelOpenState(resolveAliasTarget(alias.target), true)
      setCommandLineInput('')
      return
    }

    const [action, target] = normalized.split(' ')
    const panel = resolvePanelFromToken(target ?? '')
    if (panel && (action === 'open' || action === 'close' || action === 'toggle')) {
      if (action === 'toggle') {
        setPanelOpenState(panel, !panelVisibility[panel])
      } else {
        setPanelOpenState(panel, action === 'open')
      }
    }

    setCommandLineInput('')
  }, [bringPanelToFront, commandAliases, commandLineInput, panelVisibility, projectRoot, setPanelOpenState])

  const startCommandLineDrag = useCallback(
    (event: ReactMouseEvent<HTMLElement>) => {
      bringCommandLineToFront()
      commandLineDragRef.current = {
        startX: event.clientX,
        startY: event.clientY,
        originX: commandLineWindow.x,
        originY: commandLineWindow.y,
      }
    },
    [bringCommandLineToFront, commandLineWindow.x, commandLineWindow.y],
  )

  const updateAliasKeyword = useCallback((index: number, value: string) => {
    setCommandAliases((previous) =>
      previous.map((entry, rowIndex) => (rowIndex === index ? { ...entry, keyword: value } : entry)),
    )
  }, [])

  const updateAliasTarget = useCallback((index: number, value: CommandAliasTarget) => {
    setCommandAliases((previous) =>
      previous.map((entry, rowIndex) => (rowIndex === index ? { ...entry, target: value } : entry)),
    )
  }, [])

  const removeAlias = useCallback((index: number) => {
    setCommandAliases((previous) => previous.filter((_, rowIndex) => rowIndex !== index))
  }, [])

  const addAlias = useCallback(() => {
    setCommandAliases((previous) => [...previous, { keyword: '', target: 'editor' }])
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
          <button
            className="activity-btn"
            onClick={() => {
              setPanelOpenState('git', true)
              bringPanelToFront('git')
            }}
          >
            Git
          </button>
          <button className="activity-btn">AI</button>
        </aside>

        <div className="workbench" ref={workspaceRef}>
          <CommandLinePanel
            isOpen={commandLineOpen}
            projectOpen={Boolean(projectRoot)}
            value={commandLineInput}
            windowState={commandLineWindow}
            width={COMMAND_LINE_WIDTH}
            height={COMMAND_LINE_HEIGHT}
            onValueChange={setCommandLineInput}
            onSubmit={runCommandLine}
            onClose={() => setCommandLineOpen(false)}
            onBringToFront={bringCommandLineToFront}
            onDragStart={startCommandLineDrag}
          />
          <OptionsModal
            isOpen={optionsOpen}
            optionsTab={optionsTab}
            commandAliases={commandAliases}
            optionsBusy={optionsBusy}
            optionsError={optionsError}
            onClose={() => setOptionsOpen(false)}
            onSetTab={setOptionsTab}
            onKeywordChange={updateAliasKeyword}
            onTargetChange={updateAliasTarget}
            onRemoveAlias={removeAlias}
            onAddAlias={addAlias}
            onSave={() => void saveSettings()}
          />

          {!projectRoot ? (
            <StartupScreen
              mode={startupMode}
              startupBusy={startupBusy}
              startupError={startupError}
              cloneUrl={cloneUrl}
              cloneDestination={cloneDestination}
              recentProjects={recentProjects}
              onModeChange={setStartupMode}
              onCloneUrlChange={setCloneUrl}
              onCloneDestinationChange={setCloneDestination}
              onOpenOptions={() => setOptionsOpen(true)}
              onOpenFolder={() => void openExistingFolderFromStartup()}
              onOpenRecent={(projectPath) => void openRecentProject(projectPath)}
              onPickCloneDestination={() => void pickDirectoryForClone()}
              onCloneProject={() => void cloneProject()}
            />
          ) : (
            <>
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
                  onToggleCollapse={toggleCollapse}
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
                    onToggleCollapse={toggleCollapse}
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
                    onToggleCollapse={toggleCollapse}
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
                  onToggleCollapse={toggleCollapse}
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
              onToggleCollapse={toggleCollapse}
              onHide={hidePanel}
              onFocus={bringPanelToFront}
            >
              {panelContent[panelId]}
            </PanelChrome>
          ))}
            </>
          )}
        </div>
      </div>
    </div>
  )
}

export default App
