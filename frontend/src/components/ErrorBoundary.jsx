import { Component } from "react"
import { RefreshCcw, AlertTriangle } from "lucide-react"

// Without this, any uncaught error while rendering (a bad API response
// shape, an undefined field on a freshly-created record, etc.) unmounts
// the whole React tree and leaves a blank white page with nothing in the
// UI to explain why — the only trace is in the browser console. This
// catches that, shows what actually broke, and offers a way back instead
// of a dead end.
export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props)
    this.state = { error: null }
  }

  static getDerivedStateFromError(error) {
    return { error }
  }

  componentDidCatch(error, info) {
    // Keep the full stack in the console for real debugging — the on-screen
    // message is intentionally short.
    console.error("Unhandled UI error:", error, info?.componentStack)
  }

  render() {
    if (!this.state.error) return this.props.children

    return (
      <div className="flex min-h-screen items-center justify-center bg-canvas p-6">
        <div className="card w-full max-w-md p-6 text-center">
          <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-chip-pink-bg text-chip-pink-fg">
            <AlertTriangle size={22} />
          </div>
          <h1 className="text-lg font-bold text-ink">Something went wrong</h1>
          <p className="mt-1.5 text-sm text-muted">
            This page hit an error and couldn't finish loading. Reloading usually fixes it — if it keeps happening,
            share the message below with support.
          </p>
          <pre className="mt-4 max-h-32 overflow-auto rounded-2xl bg-surface-2 p-3 text-left text-[11px] text-muted">
            {String(this.state.error?.message || this.state.error)}
          </pre>
          <button
            onClick={() => {
              this.setState({ error: null })
              window.location.reload()
            }}
            className="pill-accent mt-4 inline-flex items-center gap-1.5 px-4 py-2.5 text-sm"
          >
            <RefreshCcw size={14} /> Reload
          </button>
        </div>
      </div>
    )
  }
}
