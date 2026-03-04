import { useEffect, useRef, useState } from 'react'
import type { MouseEvent as ReactMouseEvent, ReactNode } from 'react'
import { ChevronDown, X } from 'lucide-react'
import { PANEL_TITLES } from '../types/workbench'
import type { DockPosition, PanelId, PanelLayout, ResizeDirection } from '../types/workbench'

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
  onToggleCollapse: (panelId: PanelId) => void
  onHide: (panelId: PanelId) => void
  onFocus: (panelId: PanelId) => void
  children: ReactNode
}

export function PanelChrome({
  panelId,
  layout,
  onFloat,
  onDock,
  onDragStart,
  onResizeStart,
  onToggleCollapse,
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
      className={`panel-window ${layout.mode === 'float' ? 'floating' : 'docked'} ${layout.collapsed ? 'collapsed' : ''}`}
      style={
        layout.mode === 'float'
          ? {
              left: `${layout.x}px`,
              top: `${layout.y}px`,
              width: `${layout.width}px`,
              height: `${layout.collapsed ? 34 : layout.height}px`,
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
        onDoubleClick={() => {
          if (layout.mode === 'float') {
            onToggleCollapse(panelId)
          }
        }}
      >
        <div className="panel-window-title">{PANEL_TITLES[panelId]}</div>
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
      {layout.mode === 'float' && !layout.collapsed && (
        <>
          <div className="resize-handle n" onMouseDown={(event) => onResizeStart(panelId, 'n', event)} />
          <div className="resize-handle s" onMouseDown={(event) => onResizeStart(panelId, 's', event)} />
          <div className="resize-handle e" onMouseDown={(event) => onResizeStart(panelId, 'e', event)} />
          <div className="resize-handle w" onMouseDown={(event) => onResizeStart(panelId, 'w', event)} />
          <div className="resize-handle ne" onMouseDown={(event) => onResizeStart(panelId, 'ne', event)} />
          <div className="resize-handle nw" onMouseDown={(event) => onResizeStart(panelId, 'nw', event)} />
          <div className="resize-handle se" onMouseDown={(event) => onResizeStart(panelId, 'se', event)} />
          <div className="resize-handle sw" onMouseDown={(event) => onResizeStart(panelId, 'sw', event)} />
        </>
      )}
    </section>
  )
}
