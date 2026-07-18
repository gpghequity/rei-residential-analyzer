import { useState, useEffect } from 'react'
import AnalyzeDealTab from './components/AnalyzeDealTab.jsx'
import QaTab from './components/QaTab.jsx'
import { parseSearchString } from './connectors/urlParams.js'
import { VERSION, BUILD_DATE } from './version.js'

// ── ONE deal path ──
// Per Steve's directive (2026-06-02): the top navigation no longer exposes a
// separate tab per property type. There is ONE analyzer path — "Analyze a Deal" —
// and the property type is chosen from a dropdown INSIDE it. Every deep
// underwriter (Storage / Residential / MHP / Commercial / Mixed Use / Land) is
// still here — it now mounts inside Analyze a Deal under "Full Analysis" mode,
// driven by the same Math Bible engines (src/math/*). Nothing was deleted; the
// strongest math is simply reached from the single dropdown instead of a tab bar.
// The only other top-level entry is the non-property QA Runner.
const TABS = [
  { id: 'analyze', label: 'Analyze a Deal', component: AnalyzeDealTab },
  { id: 'qa', label: 'QA Runner', component: QaTab }
]

// Read URL params once at module load — populates initial active tab + deep-tab states.
const initialUrlState = typeof window !== 'undefined'
  ? parseSearchString(window.location.search)
  : { tab: null, storage: {}, residential: {} }

// Only 'analyze' and 'qa' remain as real top-level tabs. A legacy ?tab=storage
// link (now a dropdown choice, not a tab) must NOT crash — fall back to analyze.
const VALID_TAB_IDS = new Set(TABS.map((t) => t.id))

export default function App() {
  const [activeTab, setActiveTab] = useState(
    VALID_TAB_IDS.has(initialUrlState.tab) ? initialUrlState.tab : 'analyze'
  )

  // Keep document title in sync with the active tab.
  useEffect(() => {
    document.title = `Residential Analyzer — ${TABS.find((t) => t.id === activeTab)?.label || ''}`
  }, [activeTab])

  const ActiveComponent = (TABS.find((t) => t.id === activeTab) || TABS[0]).component

  // Shared deal info (address / asking) handed to whichever deep underwriter
  // the dropdown mounts inside Analyze a Deal.
  const sharedUrlState = {
    address: initialUrlState.address,
    propertyName: initialUrlState.propertyName,
    askingPrice: initialUrlState.askingPrice
  }

  return (
    <div className="page">
      <header className="no-print">
        <h1>REI Residential Analyzer</h1>
        <p className="sub">Single-family (1-4 units) flip and rental analysis · Reads live Math Bible + calls external tools · v{VERSION}</p>
      </header>

      <nav className="no-print">
        {TABS.map((tab) => {
          const isActive = activeTab === tab.id
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveTab(tab.id)}
              className={isActive ? 'tab-btn active' : 'tab-btn'}
            >
              {tab.label}
            </button>
          )
        })}
      </nav>

      <main>
        <ActiveComponent sharedUrlState={sharedUrlState} deepUrlState={initialUrlState} />
      </main>

      <footer>
        <div className="footer-copy">© 2026 Projects with a Purpose LLC · Powered by REI Platform</div>
        <div>REI Residential Analyzer v{VERSION} · Released {BUILD_DATE}</div>
        <div>Underwriting standards from the REI Platform Math Bible · Calls: Doc Extractor · Photo Analyzer · Data Enrichment · Market Risk Engine.</div>
        <div className="footer-disclaimer">Estimates only. Operator assumes all underwriting and decision responsibility. Verify numbers independently before any offer or transaction.</div>
      </footer>
    </div>
  )
}
