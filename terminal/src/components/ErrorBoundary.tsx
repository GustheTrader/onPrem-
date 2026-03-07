import { Component, type ReactNode } from 'react'

interface Props {
  children: ReactNode
}

interface State {
  error: Error | null
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, info: { componentStack: string }) {
    console.error('[ErrorBoundary] Caught render error:', error, info.componentStack)
  }

  render() {
    const { error } = this.state
    if (error) {
      return (
        <div className="flex flex-col items-center justify-center h-screen bg-surface text-slate-200 p-8 gap-4">
          <div className="text-down text-lg font-bold font-mono tracking-wide">
            ⚠ Render Error — Terminal Crashed
          </div>
          <div className="bg-surface-panel border border-down/40 rounded p-4 max-w-2xl w-full">
            <div className="text-down text-sm font-mono mb-2 font-semibold">
              {error.name}: {error.message}
            </div>
            {error.stack && (
              <pre className="text-2xs text-muted font-mono whitespace-pre-wrap break-all max-h-64 overflow-y-auto leading-relaxed">
                {error.stack}
              </pre>
            )}
          </div>
          <button
            onClick={() => window.location.reload()}
            className="px-4 py-2 bg-accent/20 text-accent border border-accent/40 rounded text-sm font-semibold font-mono hover:bg-accent/30 transition-colors"
          >
            ↺ Reload Terminal
          </button>
        </div>
      )
    }

    return this.props.children
  }
}
