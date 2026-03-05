import type { MouseEvent as ReactMouseEvent } from 'react'
import { X } from 'lucide-react'

type GitWindowState = {
  x: number
  y: number
  z: number
}

type GitCommandCenterPanelProps = {
  isOpen: boolean
  width: number
  height: number
  windowState: GitWindowState
  onClose: () => void
  onBringToFront: () => void
  onDragStart: (event: ReactMouseEvent<HTMLElement>) => void
}

export function GitCommandCenterPanel({
  isOpen,
  width,
  height,
  windowState,
  onClose,
  onBringToFront,
  onDragStart,
}: GitCommandCenterPanelProps) {
  if (!isOpen) {
    return null
  }

  const handleMouseDown = (event: ReactMouseEvent<HTMLElement>) => {
    onBringToFront()
    const target = event.target as HTMLElement
    if (target.closest('button, input, select, textarea')) {
      return
    }
    event.preventDefault()
    onDragStart(event)
  }

  return (
    <section
      className="panel-window floating git-command-floating"
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
        <div className="panel-window-title">Git Command Center</div>
        <div className="panel-window-actions">
          <button className="panel-close-btn" onClick={onClose} aria-label="Close git command center">
            <X size={14} />
          </button>
        </div>
      </header>
      <div className="panel-window-content git-command-content" />
    </section>
  )
}
