import { Component, type ErrorInfo, type ReactNode } from 'react'

type EditorCrashBoundaryProps = {
  children: ReactNode
  resetKey?: string | null
}

type EditorCrashBoundaryState = {
  hasError: boolean
}

export class EditorCrashBoundary extends Component<EditorCrashBoundaryProps, EditorCrashBoundaryState> {
  state: EditorCrashBoundaryState = {
    hasError: false,
  }

  static getDerivedStateFromError(): EditorCrashBoundaryState {
    return { hasError: true }
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    // Keep crash details visible in dev tools without taking down the full workspace.
    console.error('[bore-editor] editor render failure', error, errorInfo)
  }

  componentDidUpdate(prevProps: EditorCrashBoundaryProps) {
    if (this.state.hasError && prevProps.resetKey !== this.props.resetKey) {
      this.setState({ hasError: false })
    }
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="editor-fallback">
          Editor failed to render this file. Try opening another file or reload with `ref`.
        </div>
      )
    }

    return this.props.children
  }
}
