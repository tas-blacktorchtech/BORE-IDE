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

declare global {
  interface Window {
    ide: {
      openProjectDirectory: () => Promise<string | null>
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
