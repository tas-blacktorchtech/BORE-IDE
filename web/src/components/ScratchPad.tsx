import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

type ScratchPadProps = {
  projectRoot: string | null
}

type SaveState = 'idle' | 'saving' | 'saved' | 'error'

type ScratchPadDocument = {
  title: string
  html: string
  updatedAt: string
}

const DEFAULT_DOCUMENT: ScratchPadDocument = {
  title: '',
  html: '',
  updatedAt: new Date(0).toISOString(),
}

const AUTOSAVE_DELAY_MS = 800

function formatRelativeTimestamp(value: string): string {
  const parsed = Date.parse(value)
  if (Number.isNaN(parsed) || parsed <= 0) {
    return 'Not saved yet'
  }

  const deltaSeconds = Math.floor((Date.now() - parsed) / 1000)
  if (deltaSeconds < 5) {
    return 'Saved just now'
  }
  if (deltaSeconds < 60) {
    return `Saved ${deltaSeconds}s ago`
  }
  const deltaMinutes = Math.floor(deltaSeconds / 60)
  if (deltaMinutes < 60) {
    return `Saved ${deltaMinutes}m ago`
  }
  return `Saved ${new Date(parsed).toLocaleString()}`
}

export function ScratchPad({ projectRoot }: ScratchPadProps) {
  const editorRef = useRef<HTMLDivElement | null>(null)
  const saveTimerRef = useRef<number | null>(null)
  const editVersionRef = useRef(0)
  const [documentState, setDocumentState] = useState<ScratchPadDocument>(DEFAULT_DOCUMENT)
  const [initialized, setInitialized] = useState(false)
  const [pendingSave, setPendingSave] = useState(false)
  const [saveState, setSaveState] = useState<SaveState>('idle')

  const resetLocalState = useCallback(() => {
    setDocumentState(DEFAULT_DOCUMENT)
    setInitialized(false)
    setPendingSave(false)
    setSaveState('idle')
    editVersionRef.current = 0
    if (editorRef.current) {
      editorRef.current.innerHTML = ''
    }
  }, [])

  useEffect(() => {
    if (!projectRoot) {
      resetLocalState()
      return
    }

    let cancelled = false
    setInitialized(false)
    setSaveState('idle')

    window.ide
      .readProjectScratchpad(projectRoot)
      .then((loaded) => {
        if (cancelled) {
          return
        }

        setDocumentState(loaded)
        setPendingSave(false)
        editVersionRef.current = 0
        if (editorRef.current) {
          editorRef.current.innerHTML = loaded.html
        }
      })
      .catch(() => {
        if (cancelled) {
          return
        }
        setDocumentState(DEFAULT_DOCUMENT)
        if (editorRef.current) {
          editorRef.current.innerHTML = ''
        }
      })
      .finally(() => {
        if (!cancelled) {
          setInitialized(true)
        }
      })

    return () => {
      cancelled = true
    }
  }, [projectRoot, resetLocalState])

  const runFormattingCommand = useCallback((command: string, commandValue?: string) => {
    if (!editorRef.current) {
      return
    }
    editorRef.current.focus()
    document.execCommand(command, false, commandValue)
    const html = editorRef.current.innerHTML
    editVersionRef.current += 1
    setDocumentState((previous) => ({ ...previous, html }))
    setPendingSave(true)
  }, [])

  const saveDocument = useCallback(
    async (source: 'manual' | 'autosave') => {
      if (!projectRoot) {
        return
      }

      const snapshotVersion = editVersionRef.current
      const payload: ScratchPadDocument = {
        ...documentState,
        updatedAt: new Date().toISOString(),
      }

      setSaveState('saving')
      try {
        const saved = await window.ide.saveProjectScratchpad(projectRoot, payload)
        if (editVersionRef.current === snapshotVersion) {
          setPendingSave(false)
          setDocumentState(saved)
        }
        setSaveState('saved')
      } catch {
        setSaveState(source === 'manual' ? 'error' : 'idle')
      }
    },
    [documentState, projectRoot],
  )

  useEffect(() => {
    if (!initialized || !pendingSave || !projectRoot) {
      return
    }

    if (saveTimerRef.current) {
      window.clearTimeout(saveTimerRef.current)
    }

    saveTimerRef.current = window.setTimeout(() => {
      void saveDocument('autosave')
    }, AUTOSAVE_DELAY_MS)

    return () => {
      if (saveTimerRef.current) {
        window.clearTimeout(saveTimerRef.current)
        saveTimerRef.current = null
      }
    }
  }, [initialized, pendingSave, projectRoot, saveDocument])

  useEffect(() => {
    if (!projectRoot) {
      return
    }

    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 's') {
        const target = event.target as HTMLElement | null
        if (!target || !target.closest('.scratchpad-content')) {
          return
        }
        event.preventDefault()
        void saveDocument('manual')
      }
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [projectRoot, saveDocument])

  const words = useMemo(() => {
    if (!editorRef.current) {
      return 0
    }
    const text = editorRef.current.innerText.trim()
    if (!text) {
      return 0
    }
    return text.split(/\s+/).length
  }, [documentState.html])

  const saveLabel = useMemo(() => {
    if (!projectRoot) {
      return 'Open a project to use scratch pad'
    }
    if (saveState === 'saving') {
      return 'Saving...'
    }
    if (saveState === 'error') {
      return 'Save failed'
    }
    if (pendingSave) {
      return 'Unsaved changes'
    }
    return formatRelativeTimestamp(documentState.updatedAt)
  }, [documentState.updatedAt, pendingSave, projectRoot, saveState])

  return (
    <section className="scratchpad-content">
      <header className="scratchpad-header">
        <input
          className="scratchpad-title"
          value={documentState.title}
          onChange={(event) => {
            editVersionRef.current += 1
            setDocumentState((previous) => ({ ...previous, title: event.target.value }))
            setPendingSave(true)
          }}
          placeholder="Untitled scratchpad"
          disabled={!projectRoot}
        />
        <div className="scratchpad-meta">
          <span>{words} words</span>
          <span>{saveLabel}</span>
          <button onClick={() => void saveDocument('manual')} disabled={!projectRoot || saveState === 'saving'}>
            Save
          </button>
        </div>
      </header>

      <div className="scratchpad-toolbar">
        <button onClick={() => runFormattingCommand('bold')} disabled={!projectRoot}>
          Bold
        </button>
        <button onClick={() => runFormattingCommand('italic')} disabled={!projectRoot}>
          Italic
        </button>
        <button onClick={() => runFormattingCommand('underline')} disabled={!projectRoot}>
          Underline
        </button>
        <button onClick={() => runFormattingCommand('formatBlock', '<h1>')} disabled={!projectRoot}>
          H1
        </button>
        <button onClick={() => runFormattingCommand('formatBlock', '<h2>')} disabled={!projectRoot}>
          H2
        </button>
        <button onClick={() => runFormattingCommand('insertUnorderedList')} disabled={!projectRoot}>
          Bullet List
        </button>
        <button onClick={() => runFormattingCommand('insertOrderedList')} disabled={!projectRoot}>
          Numbered List
        </button>
        <button onClick={() => runFormattingCommand('formatBlock', '<blockquote>')} disabled={!projectRoot}>
          Quote
        </button>
      </div>

      <div
        ref={editorRef}
        className="scratchpad-editor"
        contentEditable={Boolean(projectRoot)}
        suppressContentEditableWarning
        onInput={(event) => {
          editVersionRef.current += 1
          setDocumentState((previous) => ({
            ...previous,
            html: (event.currentTarget as HTMLDivElement).innerHTML,
          }))
          setPendingSave(true)
        }}
      />
    </section>
  )
}
