import type { MouseEvent as ReactMouseEvent } from 'react'
import { X } from 'lucide-react'

type CommandLineWindow = {
  x: number
  y: number
  z: number
}

type CommandLinePanelProps = {
  isOpen: boolean
  projectOpen: boolean
  value: string
  windowState: CommandLineWindow
  width: number
  height: number
  onValueChange: (value: string) => void
  onSubmit: () => void
  onClose: () => void
  onBringToFront: () => void
  onDragStart: (event: ReactMouseEvent<HTMLElement>) => void
}

export function CommandLinePanel({
  isOpen,
  projectOpen,
  value,
  windowState,
  width,
  height,
  onValueChange,
  onSubmit,
  onClose,
  onBringToFront,
  onDragStart,
}: CommandLinePanelProps) {
  if (!isOpen) {
    return null
  }

  const handleMouseDown = (event: ReactMouseEvent<HTMLElement>) => {
    onBringToFront()
    const target = event.target as HTMLElement
    if (target.closest('input, button, select, textarea')) {
      return
    }
    event.preventDefault()
    onDragStart(event)
  }

  return (
    <section
      className="panel-window floating command-line-floating"
      style={{
        left: `${windowState.x}px`,
        top: `${windowState.y}px`,
        width: `${width}px`,
        height: `${height}px`,
        zIndex: windowState.z,
      }}
      onMouseDown={handleMouseDown}
    >
      <header className="panel-window-header drag-handle">
        <div className="panel-window-title">Command Line</div>
        <div className="panel-window-actions">
          <button className="panel-close-btn" onClick={onClose} aria-label="Close command line">
            <X size={14} />
          </button>
        </div>
      </header>
      <div className="panel-window-content command-line-content">
        <input
          autoFocus
          value={value}
          onChange={(event) => onValueChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault()
              onSubmit()
            }
            if (event.key === 'Escape') {
              event.preventDefault()
              onClose()
            }
          }}
          placeholder={
            projectOpen
              ? 'open explorer | close editor | toggle terminal'
              : 'Open a project, then run commands'
          }
        />
      </div>
    </section>
  )
}
