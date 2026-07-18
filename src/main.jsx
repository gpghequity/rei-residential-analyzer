import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import { hydrateBibleFromLive } from './bible/liveBible.js'

// ── Fail-closed launch gate ──
// The whole app reads the live Bible BEFORE it renders a calculator. If the Bible
// can't be reached, we render a "calculator disabled" screen — never a calculator
// built on a stale/bundled number. App.jsx (and every tab under it) is imported
// only AFTER the Bible is hydrated, so the tabs' module-level loadConstants() calls
// see live constants instead of throwing.

const root = createRoot(document.getElementById('root'))

function Gate({ kind, message, onRetry }) {
  const box = {
    maxWidth: 560, margin: '12vh auto', padding: 24, borderRadius: 12,
    fontFamily: 'system-ui, -apple-system, Segoe UI, Roboto, sans-serif'
  }
  if (kind === 'loading') {
    return (
      <div style={{ ...box, textAlign: 'center', color: '#475569' }}>
        <div style={{ fontSize: 14 }}>Reading the Bible…</div>
      </div>
    )
  }
  return (
    <div style={{ ...box, border: '1px solid #fecaca', background: '#fef2f2' }}>
      <h1 style={{ fontSize: 18, fontWeight: 600, color: '#7f1d1d', margin: '0 0 8px' }}>
        Can’t reach the Bible — calculator disabled
      </h1>
      <p style={{ fontSize: 14, color: '#991b1b', margin: '0 0 10px' }}>
        Every number this analyzer uses comes from the live Bible, and it can’t be
        read right now. Rather than show an offer built on an out-of-date number,
        it shows you nothing. Nothing is broken in your deal — this is the analyzer
        refusing to guess.
      </p>
      <pre style={{ fontSize: 11, color: '#7f1d1d', whiteSpace: 'pre-wrap', margin: '0 0 12px' }}>{message}</pre>
      <button
        type="button"
        onClick={onRetry}
        style={{ padding: '8px 16px', borderRadius: 8, border: 0, background: '#b91c1c', color: '#fff', fontWeight: 600, cursor: 'pointer' }}
      >
        Try again
      </button>
    </div>
  )
}

async function boot() {
  root.render(<Gate kind="loading" />)
  try {
    await hydrateBibleFromLive()
  } catch (e) {
    root.render(<Gate kind="error" message={e && e.message ? e.message : String(e)} onRetry={boot} />)
    return
  }
  // Import the app tree ONLY after the Bible is live — this defers the tabs'
  // module-level loadConstants() until after hydration.
  const { default: App } = await import('./App.jsx')
  root.render(
    <StrictMode>
      <App />
    </StrictMode>
  )
}

boot()
