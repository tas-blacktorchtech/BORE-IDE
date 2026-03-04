export {}

type EntryType = 'file' | 'directory'

type FsEntry = {
  name: string
  path: string
  type: EntryType
}

type TerminalDataEvent = {
  data: string
}

type TerminalExitEvent = {
  exitCode: number | null
}

type PanelVisibilityEvent = {
  panelId: 'explorer' | 'editor' | 'bottom'
  visible: boolean
}

type AnyTerminalExitEvent = {
  terminalId: string
  exitCode: number | null
}

type AnyTerminalDataEvent = {
  terminalId: string
  data: string
}

type TerminalCreateResult = {
  terminalId: string
  mode: 'pty' | 'pipe'
}

type PanelId = PanelVisibilityEvent['panelId']
type DockPosition = 'left' | 'right' | 'bottom' | 'center'

type SavedPanelLayout = {
  mode: 'dock' | 'float'
  dockPosition: DockPosition
  x: number
  y: number
  width: number
  height: number
  z: number
  collapsed: boolean
}

type ProjectLayoutPayload = {
  version: 1
  panelLayouts: Record<PanelId, SavedPanelLayout>
  panelVisibility: Record<PanelId, boolean>
}

type CommandLineAlias = {
  keyword: string
  target: 'editor' | 'explorer' | 'terminal'
}

type AppSettings = {
  commandLineAliases: CommandLineAlias[]
}

declare global {
  interface Window {
    ide: {
      openProjectDirectory: () => Promise<string | null>
      prepareProjectFolder: (folderPath: string) => Promise<string>
      cloneRepository: (repoUrl: string, destinationDirectory: string) => Promise<string>
      getRecentProjects: () => Promise<string[]>
      getSettings: () => Promise<AppSettings>
      saveSettings: (settings: AppSettings) => Promise<AppSettings>
      readProjectLayout: (projectRoot: string) => Promise<ProjectLayoutPayload | null>
      saveProjectLayout: (projectRoot: string, layoutState: ProjectLayoutPayload) => Promise<boolean>
      setPanelVisibility: (
        panelId: PanelId,
        visible: boolean,
      ) => Promise<boolean>
      readDirectory: (directoryPath: string) => Promise<FsEntry[]>
      readFile: (filePath: string) => Promise<string>
      writeFile: (filePath: string, content: string) => Promise<boolean>
      createTerminal: (cwd?: string | null) => Promise<TerminalCreateResult>
      sendTerminalInput: (terminalId: string, input: string) => void
      resizeTerminal: (terminalId: string, cols: number, rows: number) => void
      closeTerminal: (terminalId: string) => void
      onPanelVisibilityChange: (callback: (payload: PanelVisibilityEvent) => void) => () => void
      onSaveLayoutRequest: (callback: () => void) => () => void
      onToggleCommandLine: (callback: () => void) => () => void
      onCloseProjectRequest: (callback: () => void) => () => void
      onTerminalData: (
        terminalId: string,
        callback: (payload: TerminalDataEvent) => void,
      ) => () => void
      onAnyTerminalData: (callback: (payload: AnyTerminalDataEvent) => void) => () => void
      onTerminalExit: (
        terminalId: string,
        callback: (payload: TerminalExitEvent) => void,
      ) => () => void
      onAnyTerminalExit: (callback: (payload: AnyTerminalExitEvent) => void) => () => void
    }
  }
}
