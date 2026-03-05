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
  panelId: 'explorer' | 'editor' | 'bottom' | 'scratch'
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

type ScratchPadDocument = {
  title: string
  html: string
  updatedAt: string
}

type GitGraphSummary = {
  branch: string
  ahead: number
  behind: number
  dirtyCount: number
  clean: boolean
  localBranches: string[]
  remoteBranches: string[]
}

type GitGraphCommit = {
  id: string
  shortId: string
  message: string
  author: string
  authoredAt: string
  parents: string[]
  refs: string[]
  head: boolean
}

type GitGraphPayload = {
  ok: boolean
  error?: string
  summary: GitGraphSummary
  commits: GitGraphCommit[]
  offset: number
  limit: number
  hasMore: boolean
}

type GitCommitFileChange = {
  status: string
  path: string
}

type GitCommitDetailsPayload = {
  ok: boolean
  commitId: string
  files: GitCommitFileChange[]
  patch: string
}

type GitCommitStatsPayload = {
  ok: boolean
  commitId: string
  filesChanged: number
  insertions: number
  deletions: number
}

type GitBranchMutatePayload = {
  ok: boolean
  name?: string
  from?: string | null
  checkedOut?: string
  created?: boolean
}

type GitBranchChangeFile = {
  status: string
  path: string
  insertions: number
  deletions: number
}

type GitBranchChangesPayload = {
  ok: boolean
  branch: string
  base: string | null
  files: GitBranchChangeFile[]
  summary: {
    filesChanged: number
    insertions: number
    deletions: number
  }
}

declare global {
  interface Window {
    ide: {
      openProjectDirectory: () => Promise<string | null>
      prepareProjectFolder: (folderPath: string) => Promise<string>
      cloneRepository: (repoUrl: string, destinationDirectory: string) => Promise<string>
      getRecentProjects: () => Promise<string[]>
      getGitGraph: (
        projectRoot: string,
        options?: { offset?: number; limit?: number },
      ) => Promise<GitGraphPayload>
      getGitCommitStats: (projectRoot: string, commitId: string) => Promise<GitCommitStatsPayload>
      getGitCommitDetails: (projectRoot: string, commitId: string) => Promise<GitCommitDetailsPayload>
      createGitBranch: (
        projectRoot: string,
        payload: { name: string; from?: string },
      ) => Promise<GitBranchMutatePayload>
      checkoutGitBranch: (
        projectRoot: string,
        payload: { name: string },
      ) => Promise<GitBranchMutatePayload>
      getGitBranchChanges: (
        projectRoot: string,
        branchName?: string,
      ) => Promise<GitBranchChangesPayload>
      getSettings: () => Promise<AppSettings>
      saveSettings: (settings: AppSettings) => Promise<AppSettings>
      readProjectScratchpad: (projectRoot: string) => Promise<ScratchPadDocument>
      saveProjectScratchpad: (
        projectRoot: string,
        document: ScratchPadDocument,
      ) => Promise<ScratchPadDocument>
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
      onOpenOptionsRequest: (callback: () => void) => () => void
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
