import type { MouseEvent as ReactMouseEvent } from 'react'
import { X } from 'lucide-react'

type HelpWindowState = {
  x: number
  y: number
  z: number
}

type HelpPanelProps = {
  isOpen: boolean
  width: number
  height: number
  windowState: HelpWindowState
  onClose: () => void
  onBringToFront: () => void
  onDragStart: (event: ReactMouseEvent<HTMLElement>) => void
}

export function HelpPanel({
  isOpen,
  width,
  height,
  windowState,
  onClose,
  onBringToFront,
  onDragStart,
}: HelpPanelProps) {
  if (!isOpen) {
    return null
  }

  const handleMouseDown = (event: ReactMouseEvent<HTMLElement>) => {
    onBringToFront()
    const target = event.target as HTMLElement
    if (target.closest('button')) {
      return
    }
    event.preventDefault()
    onDragStart(event)
  }

  return (
    <section
      className="panel-window floating help-floating"
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
        <div className="panel-window-title">Help</div>
        <div className="panel-window-actions">
          <button className="panel-close-btn" onClick={onClose} aria-label="Close help">
            <X size={14} />
          </button>
        </div>
      </header>
      <div className="panel-window-content help-content" />
    </section>
  )
}
