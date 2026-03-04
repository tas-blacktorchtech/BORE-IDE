import { useEffect, useRef } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'

type TerminalViewProps = {
  terminalId: string
  mode: 'pty' | 'pipe'
  initialBuffer: string
  active: boolean
  onInput: (terminalId: string, value: string) => void
  onResize: (terminalId: string, cols: number, rows: number) => void
}

export function TerminalView({ terminalId, mode, initialBuffer, active, onInput, onResize }: TerminalViewProps) {
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
