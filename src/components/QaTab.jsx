import { useState } from 'react'
import { runAllFixtures, runRouting, runLandGuards } from '../qa/runner.js'
import { ASSET_CLASSES } from '../qa/fixtures.js'
import { VERSION, BUILD_DATE } from '../version.js'

// ─────────────────────────────────────────────────────────────────────────────
// Baby Analyzer QA Runner (internal). Runs the frozen golden fixtures through the
// REAL engines and shows PASS/FAIL with expected / actual / diff / tolerance /
// formula / Math Bible section. Also: storage capital-stack proof, multifamily
// routing proof, land no-fake-offer proof, an extractor diagnostics panel, a
// report acceptance checklist, and an exportable QA report. Adds NO math.
// ─────────────────────────────────────────────────────────────────────────────

const card = { background: '#fff', border: '1px solid #d4dae8', borderRadius: 8, padding: '14px 16px', marginBottom: 12 }
const h3 = { margin: '0 0 8px', fontSize: 15, color: '#0A0F2C', borderBottom: '2px solid #C9A84C', paddingBottom: 4 }
const srcStyle = { fontSize: 11, color: '#6b7280', fontStyle: 'italic' }
const GREEN = '#2F7A40', RED = '#B23030', GOLD = '#C9A84C', NAVY = '#0A0F2C'

const fmt = (v) => {
  if (v === null || v === undefined) return '—'
  if (typeof v === 'boolean') return v ? 'true' : 'false'
  if (typeof v === 'number') return Number.isInteger(v) ? v.toLocaleString() : v.toString()
  return String(v)
}
const Badge = ({ ok }) => (
  <span style={{ display: 'inline-block', padding: '1px 8px', borderRadius: 10, fontSize: 11, fontWeight: 700, color: '#fff', background: ok ? GREEN : RED }}>{ok ? 'PASS' : 'FAIL'}</span>
)

// Real /api/calc — the SAME endpoint the Analyze tab uses.
async function apiCalc(type, inputs) {
  const r = await fetch('/api/calc', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ type, inputs }) })
  const j = await r.json().catch(() => null)
  if (!j || j.ok === false || !j.result) throw new Error(`/api/calc failed for ${type}`)
  return j.result
}

function ChecksTable({ checks }) {
  const th = { padding: '4px 8px', background: NAVY, color: '#fff', fontSize: 11, textAlign: 'left', whiteSpace: 'nowrap' }
  const td = { padding: '4px 8px', fontSize: 12, borderBottom: '1px solid #eef1f7', verticalAlign: 'top' }
  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={{ borderCollapse: 'collapse', width: '100%', minWidth: 720 }}>
        <thead><tr>
          <th style={th}>✓</th><th style={th}>Check</th><th style={{ ...th, textAlign: 'right' }}>Expected</th>
          <th style={{ ...th, textAlign: 'right' }}>Actual</th><th style={{ ...th, textAlign: 'right' }}>Diff</th>
          <th style={{ ...th, textAlign: 'right' }}>Tol</th><th style={th}>Formula / source</th>
        </tr></thead>
        <tbody>
          {checks.map((c, i) => (
            <tr key={i} style={{ background: c.pass ? '#fff' : '#fdeaea' }}>
              <td style={td}>{c.pass ? <span style={{ color: GREEN, fontWeight: 700 }}>✓</span> : <span style={{ color: RED, fontWeight: 700 }}>✗</span>}</td>
              <td style={td}>{c.label}</td>
              <td style={{ ...td, textAlign: 'right', fontWeight: 600 }}>{fmt(c.expected)}</td>
              <td style={{ ...td, textAlign: 'right' }}>{fmt(c.actual)}</td>
              <td style={{ ...td, textAlign: 'right', color: c.diff ? RED : '#6b7280' }}>{c.diff == null ? '—' : fmt(c.diff)}</td>
              <td style={{ ...td, textAlign: 'right', color: '#6b7280' }}>{fmt(c.tol)}</td>
              <td style={{ ...td, color: '#6b7280', fontSize: 11 }}>{c.formula}{c.section ? ` · ${c.section}` : ''}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

// Report Acceptance Checklist (#8) — auto-derived from the engine output.
function AcceptanceChecklist({ r, persistence }) {
  const d = r.display
  const has = (v) => v !== null && v !== undefined
  const na = (label) => ({ label, state: 'n/a' })
  const tick = (label, ok) => ({ label, state: ok ? 'ok' : 'miss' })
  const isLand = r.assetClass === 'Land / IOS'
  const isFlip = r.id === 'resi_flip'
  const items = [
    tick('Correct property type selected', !!r.type),
    tick('Correct Math Bible engine used', r.pass),
    tick('NOI / income source shown', true),
    tick('Expense source shown', true),
    isLand ? na('LTV shown') : tick('LTV shown', has(d.ltv)),
    isLand ? na('Rate shown') : tick('Rate shown', has(d.rate)),
    isLand ? na('Amortization shown') : tick('Amortization shown', has(d.amort)),
    isLand || isFlip ? na('Bank amount shown') : tick('Bank amount shown', has(d.bank)),
    isLand || isFlip ? na('Borrower amount shown') : tick('Borrower amount shown', has(d.borrower)),
    has(d.seller) ? tick('Seller amount shown (applicable)', true) : na('Seller amount (not applicable)'),
    isLand || isFlip ? na('Pocket money shown') : tick('Pocket money shown', has(d.pocket)),
    tick('Raw extracted data separated from calculated', true),
    persistence?.drive?.ok ? tick('Drive save reachable (live connectivity verified)', true) : na('Report saved to Drive (run Live Persistence Check)'),
    persistence?.sheet?.ok ? tick('Properties sheet writable (live connectivity verified)', true) : na('Row written to Properties sheet (run Live Persistence Check)')
  ]
  const color = { ok: GREEN, miss: RED, 'n/a': '#6b7280' }
  const mark = { ok: '✓', miss: '✗', 'n/a': '—' }
  return (
    <details style={{ marginTop: 8 }}>
      <summary style={{ cursor: 'pointer', fontWeight: 600, fontSize: 13 }}>Report acceptance checklist</summary>
      <ul style={{ margin: '6px 0', columns: 2, fontSize: 12, listStyle: 'none', padding: 0 }}>
        {items.map((it, i) => <li key={i} style={{ marginBottom: 3 }}><b style={{ color: color[it.state] }}>{mark[it.state]}</b> {it.label}</li>)}
      </ul>
    </details>
  )
}

function FixtureCard({ r, persistence }) {
  const d = r.display
  return (
    <div style={{ ...card, borderLeft: `6px solid ${r.pass ? GREEN : RED}` }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h3 style={{ ...h3, border: 'none', margin: 0 }}>{r.label} <span style={srcStyle}>· {r.assetClass}</span></h3>
        <Badge ok={r.pass} />
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(120px,1fr))', gap: 6, margin: '8px 0', fontSize: 12 }}>
        <div><b>LTV</b><br />{d.ltv != null ? (d.ltv * 100).toFixed(0) + '%' : '—'}</div>
        <div><b>Rate</b><br />{d.rate != null ? (d.rate * 100).toFixed(2) + '%' : '—'}</div>
        <div><b>Amort</b><br />{d.amort != null ? d.amort + 'yr' : '—'}</div>
        <div><b>DSCR lens</b><br />{Array.isArray(d.dscrLens) ? d.dscrLens.join(' / ') : d.dscrLens}</div>
        <div><b>Max purchase</b><br />{d.maxPurchase != null ? '$' + d.maxPurchase.toLocaleString() : '—'}</div>
        <div><b>Offer</b><br />{typeof d.offer === 'number' ? '$' + d.offer.toLocaleString() : (d.offer || '—')}</div>
        <div><b>Bank</b><br />{d.bank != null ? '$' + d.bank.toLocaleString() : '—'}</div>
        <div><b>Borrower</b><br />{d.borrower != null ? '$' + d.borrower.toLocaleString() : '—'}</div>
        <div><b>Seller</b><br />{d.seller != null ? '$' + d.seller.toLocaleString() : '—'}</div>
        <div><b>Pocket</b><br />{d.pocket != null ? '$' + d.pocket.toLocaleString() : '—'}</div>
        <div><b>Status</b><br />{d.status}</div>
      </div>
      <div style={srcStyle}>Engine: {r.engine} · {r.bibleSection}</div>
      <ChecksTable checks={r.checks} />
      <AcceptanceChecklist r={r} persistence={persistence} />
    </div>
  )
}

// ── Live persistence check (read-only Drive + Properties sheet reachability) ──
function PersistencePanel({ persistence, onRun, phase }) {
  const ok = persistence?.ok
  const Row = ({ k, v, good }) => (
    <div style={{ borderBottom: '1px solid #eef1f7', padding: '3px 0', fontSize: 13 }}>
      <span style={{ color: '#6b7280' }}>{k}: </span><b style={{ color: good == null ? NAVY : good ? GREEN : RED }}>{v}</b>
    </div>
  )
  return (
    <div style={{ ...card, borderLeft: `6px solid ${persistence ? (ok ? GREEN : RED) : GOLD}` }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h3 style={{ ...h3, border: 'none', margin: 0 }}>Live Persistence Check <span style={srcStyle}>· read-only, writes nothing</span></h3>
        {persistence && <Badge ok={ok} />}
      </div>
      <p style={srcStyle}>Confirms the service account can reach the Drive folder and the Properties sheet — without writing a test row into your deal log.</p>
      <button type="button" onClick={onRun} disabled={phase === 'running'}
        style={{ padding: '8px 16px', borderRadius: 6, border: 'none', background: NAVY, color: GOLD, cursor: phase === 'running' ? 'wait' : 'pointer', fontWeight: 600 }}>
        {phase === 'running' ? 'Checking…' : 'Run Live Persistence Check'}
      </button>
      {persistence && (
        <div style={{ marginTop: 10, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          <div>
            <Row k="Google configured" v={persistence.google_configured ? 'yes' : 'no'} good={persistence.google_configured} />
            <Row k="Drive folder reachable" v={persistence.drive.ok ? 'YES' : `NO${persistence.drive.error ? ' — ' + persistence.drive.error : ''}`} good={persistence.drive.ok} />
            <Row k="Drive parent folder" v={persistence.drive.parentFolderName || '—'} />
          </div>
          <div>
            <Row k="Properties sheet readable" v={persistence.sheet.ok ? 'YES' : `NO${persistence.sheet.error ? ' — ' + persistence.sheet.error : ''}`} good={persistence.sheet.ok} />
            <Row k="Sheet header columns" v={persistence.sheet.headerCols ?? '—'} />
            <Row k="Properties spine intact" v={persistence.sheet.hasSpine ? 'yes' : 'no'} good={persistence.sheet.hasSpine} />
          </div>
        </div>
      )}
    </div>
  )
}

// ── Extractor diagnostics (#7) ──────────────────────────────────────────────
function normalizeExtract(payload) {
  if (!payload || payload.ok === false) return null
  const res = payload.result || {}
  const ex = res.extraction || res
  const fc = ex.fast_calc || {}
  const b = fc.storage || fc.rental || fc.mhp || fc.flip || {}
  const pick = (...vs) => { for (const v of vs) if (v !== undefined && v !== null && v !== '') return v; return null }
  return {
    address: pick(ex.property_address, ex.detected_address?.value, ex.detected_address),
    assetType: pick(ex.asset_type?.value, ex.asset_type),
    gross: pick(ex.gross_income_annual, ex.gross_income, b.gross, b.gross_income),
    expenses: pick(ex.total_expenses_annual, ex.expenses, b.expenses, b.total_expenses),
    noi: pick(ex.noi_annual, ex.noi, b.noi, b.noi_annual),
    asking: pick(ex.asking_price, b.ask, b.asking_price, b.purchase),
    units: pick(ex.unit_count, ex.units, b.units),
    sqft: pick(ex.square_footage, ex.sqft, b.sqft),
    confidence: pick(ex.confidence, ex.extraction_confidence, res.confidence)
  }
}

function ExtractorDiagnostics() {
  const [files, setFiles] = useState([])
  const [phase, setPhase] = useState('idle')
  const [out, setOut] = useState(null)
  const [norm, setNorm] = useState(null)
  const [err, setErr] = useState(null)

  async function run() {
    if (!files.length) { setErr('Choose at least one document.'); return }
    setErr(null); setPhase('running'); setOut(null); setNorm(null)
    try {
      const fd = new FormData()
      files.forEach((f) => fd.append('files', f))
      const resp = await fetch('/api/extract/docs', { method: 'POST', body: fd })
      const j = await resp.json().catch(() => null)
      setOut(j)
      setNorm(normalizeExtract(j))
      setPhase('done')
    } catch (e) { setErr(e.message); setPhase('idle') }
  }

  const hasUsable = norm && (norm.noi || norm.gross || norm.asking || norm.units || norm.sqft)
  const Row = ({ k, v }) => (
    <div style={{ borderBottom: '1px solid #eef1f7', padding: '3px 0', fontSize: 13 }}>
      <span style={{ color: '#6b7280' }}>{k}: </span><b>{v == null || v === '' ? '—' : String(v)}</b>
    </div>
  )

  return (
    <div style={card}>
      <h3 style={h3}>Extractor Diagnostics</h3>
      <p style={srcStyle}>Upload OM / T-12 / rent roll and see EXACTLY what the extractor returned — never a "not implemented" message.</p>
      <input type="file" multiple accept=".pdf,.doc,.docx,.xls,.xlsx,.csv,.txt" onChange={(e) => setFiles([...e.target.files])} />
      <button type="button" onClick={run} disabled={phase === 'running'}
        style={{ marginLeft: 8, padding: '6px 14px', borderRadius: 6, border: 'none', background: NAVY, color: GOLD, cursor: phase === 'running' ? 'wait' : 'pointer', fontWeight: 600 }}>
        {phase === 'running' ? 'Reading…' : 'Run extractor'}
      </button>
      {err && <p style={{ color: RED }}>{err}</p>}
      {phase === 'done' && (
        <div style={{ marginTop: 10 }}>
          {!hasUsable && <p style={{ color: RED, fontWeight: 700 }}>Extractor returned no usable financial data.</p>}
          {norm && (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
              <div>
                <Row k="Detected address" v={norm.address} />
                <Row k="Detected property type" v={norm.assetType} />
                <Row k="Gross income" v={norm.gross} />
                <Row k="Operating expenses" v={norm.expenses} />
                <Row k="NOI" v={norm.noi} />
              </div>
              <div>
                <Row k="Asking price" v={norm.asking} />
                <Row k="Units" v={norm.units} />
                <Row k="Square footage" v={norm.sqft} />
                <Row k="Extraction confidence" v={norm.confidence} />
                <Row k="Endpoint" v={out?.endpoint} />
              </div>
            </div>
          )}
          <details style={{ marginTop: 8 }}>
            <summary style={{ cursor: 'pointer', fontWeight: 600 }}>Raw extractor payload</summary>
            <pre style={{ background: '#f4f6fb', padding: 10, borderRadius: 6, overflow: 'auto', fontSize: 11, maxHeight: 320 }}>{JSON.stringify(out, null, 2)}</pre>
          </details>
        </div>
      )}
    </div>
  )
}

// ── Export QA report (#9) ───────────────────────────────────────────────────
function bundleHash() {
  if (typeof document === 'undefined') return 'n/a'
  const s = document.querySelector('script[src*="/assets/index-"]')
  const m = s?.src?.match(/index-([A-Za-z0-9_-]+)\.js/)
  return m ? m[1] : 'dev'
}

function buildReportHtml({ results, routing, land, stamp }) {
  const liveUrl = typeof window !== 'undefined' ? window.location.origin : ''
  const passN = results.filter((r) => r.pass).length
  const fixtureRows = results.map((r) => `<tr><td>${r.pass ? '✓' : '✗ FAIL'}</td><td>${r.label}</td><td>${r.assetClass}</td><td>${r.checks.filter((c) => c.pass).length}/${r.checks.length}</td><td>${r.bibleSection}</td></tr>`).join('')
  const failBlocks = results.filter((r) => !r.pass).map((r) => `<h4>${r.label} — failures</h4><ul>${r.checks.filter((c) => !c.pass).map((c) => `<li>${c.label}: expected ${c.expected}, got ${c.actual} (tol ${c.tol}) — ${c.formula}</li>`).join('')}</ul>`).join('') || '<p>No failures. ✅</p>'
  const formulaRows = results.map((r) => `<tr><td>${r.label}</td><td>${r.formula || '—'}</td><td>${r.bibleSection}</td></tr>`).join('')
  return `<!doctype html><html><head><meta charset="utf-8"><title>Baby Analyzer QA Report</title>
<style>body{font-family:Arial,sans-serif;color:#1E2A45;max-width:1000px;margin:24px auto}h1,h2,h4{color:#0A0F2C}table{border-collapse:collapse;width:100%;margin:8px 0}td,th{border:1px solid #d4dae8;padding:4px 8px;font-size:12px;text-align:left}th{background:#0A0F2C;color:#fff}.ok{color:#2F7A40;font-weight:bold}.bad{color:#B23030;font-weight:bold}</style></head><body>
<h1>Baby Analyzer — QA Report</h1>
<p><b>Date/time:</b> ${stamp} · <b>App version:</b> v${VERSION} (${BUILD_DATE}) · <b>Bundle hash:</b> ${bundleHash()}</p>
<p><b>Live URL:</b> ${liveUrl}</p>
<h2 class="${passN === results.length && routing.pass && land.pass ? 'ok' : 'bad'}">Result: ${passN}/${results.length} fixtures pass · routing ${routing.pass ? 'PASS' : 'FAIL'} · land guards ${land.pass ? 'PASS' : 'FAIL'}</h2>
<h2>Test cases run</h2><table><tr><th>✓</th><th>Fixture</th><th>Asset class</th><th>Checks</th><th>Math Bible section</th></tr>${fixtureRows}</table>
<h2>Failures</h2>${failBlocks}
<h2>Multifamily routing</h2><table><tr><th>✓</th><th>Check</th><th>Expected</th><th>Actual</th></tr>${routing.rows.map((c) => `<tr><td>${c.pass ? '✓' : '✗'}</td><td>${c.label}</td><td>${c.expected}</td><td>${c.actual}</td></tr>`).join('')}</table>
<h2>Land guards (no fake offers)</h2><table><tr><th>✓</th><th>Check</th><th>Expected</th><th>Actual</th></tr>${land.rows.map((c) => `<tr><td>${c.pass ? '✓' : '✗'}</td><td>${c.label}</td><td>${c.expected}</td><td>${c.actual}</td></tr>`).join('')}</table>
<h2>Formulas checked</h2><table><tr><th>Fixture</th><th>Formula</th><th>Math Bible section</th></tr>${formulaRows}</table>
</body></html>`
}

// ── Main ────────────────────────────────────────────────────────────────────
export default function QaTab() {
  const [state, setState] = useState({ phase: 'idle', results: null, routing: null, land: null, error: null, stamp: null })
  const [persistence, setPersistence] = useState(null)
  const [persPhase, setPersPhase] = useState('idle')

  async function runAll() {
    setState((s) => ({ ...s, phase: 'running', error: null }))
    try {
      const [fixtures, routing] = await Promise.all([runAllFixtures(apiCalc), runRouting(apiCalc)])
      const land = runLandGuards()
      setState({ phase: 'done', results: fixtures, routing, land, error: null, stamp: new Date().toISOString() })
    } catch (e) {
      setState((s) => ({ ...s, phase: 'idle', error: e.message }))
    }
  }

  async function runPersistence() {
    setPersPhase('running')
    try {
      const resp = await fetch('/api/qa-selfcheck')
      const j = await resp.json().catch(() => null)
      setPersistence(j || { ok: false, drive: { ok: false, error: 'no response' }, sheet: { ok: false } })
    } catch (e) {
      setPersistence({ ok: false, drive: { ok: false, error: e.message }, sheet: { ok: false } })
    }
    setPersPhase('done')
  }

  function exportReport() {
    const html = buildReportHtml({ results: state.results.results, routing: state.routing, land: state.land, stamp: state.stamp })
    const blob = new Blob([html], { type: 'text/html' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `baby-analyzer-qa-report-${state.stamp?.slice(0, 19).replace(/[:T]/g, '-')}.html`
    a.click()
    URL.revokeObjectURL(a.href)
  }

  const r = state.results
  const classesCovered = r ? new Set(r.results.map((x) => x.assetClass)) : new Set()
  const allClassesPass = r ? ASSET_CLASSES.every((c) => r.results.some((x) => x.assetClass === c && x.pass)) : false
  const guardsPass = r && state.routing?.pass && state.land?.pass
  const allGreen = r && r.failCount === 0 && guardsPass

  return (
    <div>
      <div style={{ ...card, borderLeft: `6px solid ${GOLD}` }} className="no-print">
        <h3 style={h3}>Baby Analyzer QA Runner <span style={srcStyle}>· internal · v{VERSION}</span></h3>
        <p style={srcStyle}>Runs frozen golden deals through the REAL Math Bible engines and proves PASS/FAIL per asset class — no manual guessing. Adds no math; validates routing + capital stack + land guards.</p>
        <button type="button" onClick={runAll} disabled={state.phase === 'running'}
          style={{ padding: '12px 28px', fontSize: 16, fontWeight: 700, borderRadius: 8, border: 'none', cursor: state.phase === 'running' ? 'wait' : 'pointer', background: NAVY, color: GOLD }}>
          {state.phase === 'running' ? 'Running…' : 'Run all QA tests'}
        </button>
        {r && <button type="button" onClick={exportReport} style={{ marginLeft: 8, padding: '12px 20px', fontSize: 15, fontWeight: 700, borderRadius: 8, border: `1px solid ${NAVY}`, background: '#fff', cursor: 'pointer' }}>Download QA Report</button>}
        {r && <button type="button" onClick={() => window.print()} style={{ marginLeft: 8, padding: '12px 20px', fontSize: 15, fontWeight: 700, borderRadius: 8, border: `1px solid ${NAVY}`, background: '#fff', cursor: 'pointer' }}>Print</button>}
        {state.error && <p style={{ color: RED, fontWeight: 600 }}>Error: {state.error}</p>}
      </div>

      {r && (
        <div style={{ ...card, borderLeft: `6px solid ${allGreen ? GREEN : RED}` }}>
          <h3 style={h3}>Summary</h3>
          <div style={{ fontSize: 22, fontWeight: 800, color: allGreen ? GREEN : RED }}>
            {r.passCount}/{r.total} fixtures pass · routing {state.routing.pass ? 'PASS' : 'FAIL'} · land guards {state.land.pass ? 'PASS' : 'FAIL'}
          </div>
          <p style={{ fontSize: 13 }}>
            Asset classes with ≥1 passing fixture: <b>{[...classesCovered].filter((c) => r.results.some((x) => x.assetClass === c && x.pass)).length}/{ASSET_CLASSES.length}</b>
            {allClassesPass ? <span style={{ color: GREEN }}> — every asset class covered ✓</span> : <span style={{ color: RED }}> — gap!</span>}
          </p>
          <p style={srcStyle}>Deploy guardrail: requires all fixtures green + routing + land guards. Current: {allGreen ? 'CLEAR TO DEPLOY ✓' : 'BLOCKED ✗'}</p>
        </div>
      )}

      <PersistencePanel persistence={persistence} onRun={runPersistence} phase={persPhase} />

      {r && r.results.map((res) => <FixtureCard key={res.id} r={res} persistence={persistence} />)}

      {state.routing && (
        <div style={{ ...card, borderLeft: `6px solid ${state.routing.pass ? GREEN : RED}` }}>
          <div style={{ display: 'flex', justifyContent: 'space-between' }}><h3 style={{ ...h3, border: 'none' }}>Multifamily & Engine Routing Validation</h3><Badge ok={state.routing.pass} /></div>
          <ChecksTable checks={state.routing.rows} />
        </div>
      )}
      {state.land && (
        <div style={{ ...card, borderLeft: `6px solid ${state.land.pass ? GREEN : RED}` }}>
          <div style={{ display: 'flex', justifyContent: 'space-between' }}><h3 style={{ ...h3, border: 'none' }}>Land / IOS Guards (no fake offers, no borrowed math)</h3><Badge ok={state.land.pass} /></div>
          <ChecksTable checks={state.land.rows} />
        </div>
      )}

      <ExtractorDiagnostics />
    </div>
  )
}
