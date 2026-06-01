import { useState } from 'react'
import { PROPERTY_TYPES, getType, num } from './analyze/typeMap.js'

// ── formatting ──
const money = (v) => (v == null || v === '' || !Number.isFinite(Number(v)))
  ? '—'
  : '$' + Math.round(Number(v)).toLocaleString()
const pct = (v) => (v == null || !Number.isFinite(Number(v))) ? '—' : (Number(v) * 100).toFixed(1) + '%'

// Normalize broker-stated figures out of whatever shape the extractor returned.
function pullExtracted(extracted) {
  if (!extracted || extracted.ok === false) return null
  const r = extracted.result || {}
  const ex = r.extraction || r
  // OM extractor shape
  const out = {
    address: ex.property_address || ex.detected_address?.value || null,
    assetType: ex.asset_type?.value || ex.asset_type || null,
    brokerNOI: ex.noi_annual ?? ex.noi ?? null,
    grossIncome: ex.gross_income_annual ?? ex.gross_income ?? null,
    expenses: ex.total_expenses_annual ?? ex.expenses ?? null,
    asking: ex.asking_price ?? null,
    occupancy: ex.occupancy_pct ?? null,
    capRate: ex.cap_rate ?? null,
    units: ex.unit_count ?? null,
    sqft: ex.square_footage ?? null,
    redFlags: ex.red_flags || [],
    raw: ex
  }
  return out
}

// Robust POST that never crashes on a non-JSON response (e.g. a Railway
// "page could not be found" page during a redeploy, a 413, or a gateway
// timeout). Surfaces the real status + a readable snippet instead.
async function postForJson(url, opts, label) {
  let resp
  try {
    resp = await fetch(url, opts)
  } catch (e) {
    throw new Error(`${label}: network error (${e.message}). Check your connection and try again.`)
  }
  const text = await resp.text()
  let data
  try { data = JSON.parse(text) } catch {
    const hint = resp.status === 404
      ? ' — the app may be restarting/redeploying; wait ~30s and try again.'
      : (resp.status === 413 ? ' — uploaded files are too large.' : (resp.status >= 500 ? ' — server/extractor error or timeout; try again or with fewer files.' : ''))
    throw new Error(`${label} failed (HTTP ${resp.status})${hint}`)
  }
  if (!resp.ok) throw new Error(`${label} failed (HTTP ${resp.status}): ${data.error || 'unknown error'}`)
  return data
}

// Call the frozen bible-math endpoint.
async function runCalc(payload) {
  return postForJson('/api/calc', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload)
  }, 'Calculation')
}

// Normalize a calc result into headline figures used by the recommendation.
function headline(calcType, result) {
  if (!result) return {}
  if (calcType === 'residential_mao') {
    return { noiUsed: null, estValue: result.arv, maxOffer: result.maxOffer, dscr: null, dscrPass: null }
  }
  if (calcType === 'residential_dscr') {
    return { noiUsed: result.annualNOI, estValue: result.purchase, maxOffer: null, dscr: result.dscr, dscrPass: result.pass, pocket: result.pocketCashAnnual }
  }
  if (calcType === 'storage_group_a') {
    return { noiUsed: result.noi, estValue: result.maxPurchase, maxOffer: result.yourOffer, dscr: result.actualDSCR, dscrPass: result.dscrPass }
  }
  if (calcType === 'commercial_dscr') {
    const c = result.conservative || {}
    return { noiUsed: result.noi, estValue: c.maxPurchase, maxOffer: c.yourOffer, dscr: c.dscr, dscrPass: (c.dscr || 0) >= 1.25, scenarios: result }
  }
  return {}
}

// Transparent recommendation rule (presentation layer — not bible math).
function recommend({ asking, maxOffer, estValue, dscrPass, implemented, hasMath }) {
  if (!implemented || !hasMath) {
    return { verdict: 'INTAKE ONLY', basis: 'Analysis module not yet implemented for this property type — data captured and saved.' }
  }
  const ask = num(asking)
  const offer = num(maxOffer) || num(estValue)
  if (!offer) return { verdict: 'REVIEW', basis: 'Not enough inputs to compute an offer; review captured data.' }
  if (!ask) return { verdict: 'REVIEW', basis: `Computed offer ${money(offer)}; enter seller asking to compare.` }
  if (ask <= offer) return { verdict: 'PURSUE', basis: `Asking ${money(ask)} is at/below the max recommended offer ${money(offer)}.` }
  if (ask <= offer * 1.1) return { verdict: 'NEGOTIATE', basis: `Asking ${money(ask)} is within 10% of max offer ${money(offer)} — negotiable.` }
  return { verdict: 'PASS', basis: `Asking ${money(ask)} exceeds max offer ${money(offer)} by more than 10%.${dscrPass === false ? ' DSCR below target.' : ''}` }
}

const card = { background: '#fff', border: '1px solid #d4dae8', borderRadius: 8, padding: '14px 16px', marginBottom: 12 }
const h3 = { margin: '0 0 8px', fontSize: 15, color: '#0A0F2C', borderBottom: '2px solid #C9A84C', paddingBottom: 4 }
const inp = { width: '100%', padding: '8px 10px', border: '1px solid #d4dae8', borderRadius: 6, fontSize: 14, boxSizing: 'border-box' }
const lbl = { display: 'block', fontSize: 12, fontWeight: 600, color: '#1E2A45', margin: '10px 0 3px' }
const srcStyle = { fontSize: 11, color: '#6b7280', fontStyle: 'italic' }

function Val({ label, value, source }) {
  return (
    <div style={{ marginBottom: 8 }}>
      <div style={{ fontSize: 12, color: '#1E2A45', fontWeight: 600 }}>{label}</div>
      <div style={{ fontSize: 15 }}>{value}</div>
      {source && <div style={srcStyle}>Source: {source}</div>}
    </div>
  )
}

export default function AnalyzeDealTab() {
  const [typeId, setTypeId] = useState('residential')
  const [mode, setMode] = useState('flip')
  const [fields, setFields] = useState({ address: '', city: '', state: '', zip: '' })
  const [docs, setDocs] = useState([])
  const [photos, setPhotos] = useState([])
  const [phase, setPhase] = useState('idle')
  const [error, setError] = useState(null)
  const [result, setResult] = useState(null)

  const type = getType(typeId)
  const activeFields = (type.fields || []).filter(f => !f.modes || f.modes.includes(mode))
  const set = (k, v) => setFields(p => ({ ...p, [k]: v }))

  async function analyze() {
    setError(null); setResult(null)
    if (!fields.address) { setError('Enter a property address.'); return }
    setPhase('running')
    try {
      // 1) Orchestrate: store uploads + call extractor / photo / comps server-side.
      const fd = new FormData()
      docs.forEach(f => fd.append('docs', f))
      photos.forEach(f => fd.append('photos', f))
      fd.append('meta', JSON.stringify({
        propertyType: typeId, address: fields.address, city: fields.city, state: fields.state, zip: fields.zip,
        beds: fields.beds, baths: fields.baths, sqft: fields.sqft, dealType: mode
      }))
      const orch = await postForJson('/api/analyze-deal', { method: 'POST', body: fd }, 'Analyze')

      const extractedNorm = pullExtracted(orch.extracted)

      // 2) Compute headline via existing bible math (/api/calc). Prefer user fields; fall back to extracted.
      const calcFields = { ...fields }
      if (extractedNorm) {
        if (!num(calcFields.noi) && extractedNorm.brokerNOI) calcFields.noi = extractedNorm.brokerNOI
        if (!num(calcFields.grossIncome) && extractedNorm.grossIncome) calcFields.grossIncome = extractedNorm.grossIncome
        if (!num(calcFields.askingPrice) && extractedNorm.asking) calcFields.askingPrice = extractedNorm.asking
      }
      const calcPayload = type.buildCalc ? type.buildCalc(calcFields, mode) : null

      let calc = null, head = {}, calcTypeUsed = null
      if (calcPayload) {
        const first = await runCalc({ type: calcPayload.type, inputs: calcPayload.inputs })
        calc = first.result; calcTypeUsed = calcPayload.type
        // MHP: chain its NOI into the storage income engine for the offer headline.
        if (calcPayload.chainToStorage && calc && calc.noi > 0) {
          const second = await runCalc({ type: 'storage_group_a', inputs: { noi: calc.noi } })
          calc = { ...calc, storage: second.result }
          head = headline('storage_group_a', second.result)
          head.noiUsed = calc.noi
          calcTypeUsed = 'mhp_noi+storage_group_a'
        } else {
          head = headline(calcPayload.type, calc)
        }
      }

      // 3) Recommendation (transparent rule).
      const rec = recommend({
        asking: calcFields.askingPrice, maxOffer: head.maxOffer, estValue: head.estValue,
        dscrPass: head.dscrPass, implemented: type.implemented, hasMath: Boolean(calcPayload)
      })

      // 4) Broker vs calculated NOI.
      const brokerNOI = extractedNorm?.brokerNOI ?? null
      const calcNOI = head.noiUsed ?? null
      const noiDelta = (brokerNOI != null && calcNOI != null) ? (calcNOI - brokerNOI) : null

      // 5) Photos / rehab.
      const photoRes = orch.photos?.result || null

      // 6) Missing-info flags.
      const missing = []
      if (!calcFields.askingPrice) missing.push('Seller asking price')
      activeFields.forEach(f => { if (f.key !== 'askingPrice' && !fields[f.key] && !calcFields[f.key]) missing.push(f.label) })
      if (!docs.length) missing.push('Financial documents (OM / T12 / rent roll)')
      if (!photos.length) missing.push('Property photos')

      const report = {
        generatedAt: new Date().toISOString(),
        tool: 'baby-analyzer',
        propertyType: type.label, mode: type.subModes ? mode : null,
        implemented: type.implemented && Boolean(calcPayload),
        inputs: fields,
        extracted: extractedNorm, extractedRaw: orch.extracted,
        comps: orch.comps, photos: orch.photos, photoRes,
        calc, calcTypeUsed, headline: head,
        recommendation: rec,
        brokerNOI, calcNOI, noiDelta,
        missing,
        driveUrl: orch.driveUrl,
        folderId: orch.folderId,
        persistError: orch.persistError
      }
      setResult(report)
      setPhase('done')

      // 7) Persist report + write the shared Properties row.
      const sheet = {
        asking_price: num(calcFields.askingPrice) || '',
        arv: num(fields.arv) || '',
        rehab_estimate: photoRes?.rehab_estimate_mid || num(fields.rehab) || '',
        noi: calcNOI || '',
        units: num(fields.units) || '',
        verdict: rec.verdict,
        recommended_offer: head.maxOffer || head.estValue || '',
        recommended_offer_basis: rec.basis,
        one_line_summary: `${type.label} — ${rec.verdict}`
      }
      postForJson('/api/save-report', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          folderId: orch.folderId, address: fields.address, propertyType: typeId,
          sheet, analysis: report, reportHtml: buildReportHtml(report),
          user: fields.user || '', contact: fields.contact || ''
        })
      }, 'Save').then(s => {
        setResult(prev => prev ? { ...prev, saved: s.ok, savePersistError: s.persistError, driveUrl: s.driveUrl || prev.driveUrl } : prev)
      }).catch(err => {
        setResult(prev => prev ? { ...prev, saved: false, savePersistError: err.message } : prev)
      })
    } catch (e) {
      setError(e.message || 'Analysis failed')
      setPhase('idle')
    }
  }

  return (
    <div>
      <div style={card} className="no-print">
        <h3 style={h3}>1 · Property Type</h3>
        <select style={inp} value={typeId} onChange={e => { setTypeId(e.target.value); const t = getType(e.target.value); if (t.subModes) setMode(t.subModes[0].id) }}>
          {PROPERTY_TYPES.map(t => <option key={t.id} value={t.id}>{t.label}</option>)}
        </select>
        {type.subModes && (
          <div style={{ marginTop: 8, display: 'flex', gap: 8 }}>
            {type.subModes.map(m => (
              <button key={m.id} type="button" onClick={() => setMode(m.id)}
                style={{ padding: '6px 12px', borderRadius: 6, border: '1px solid #C9A84C', cursor: 'pointer', background: mode === m.id ? '#C9A84C' : '#fff', color: mode === m.id ? '#0A0F2C' : '#1E2A45', fontWeight: 600 }}>
                {m.label}
              </button>
            ))}
          </div>
        )}
        {type.note && <p style={{ ...srcStyle, marginTop: 8 }}>{type.note}</p>}
        {!type.implemented && <p style={{ color: '#C8851A', fontWeight: 600, marginTop: 8 }}>⚠ Supported intake — analysis module not yet implemented for this type.</p>}
      </div>

      <div style={card} className="no-print">
        <h3 style={h3}>2 · Deal Information</h3>
        <label style={lbl}>Property Address *</label>
        <input style={inp} value={fields.address} onChange={e => set('address', e.target.value)} placeholder="123 Main St, Lancaster, PA 17603" />
        <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr', gap: 8 }}>
          <div><label style={lbl}>City</label><input style={inp} value={fields.city} onChange={e => set('city', e.target.value)} /></div>
          <div><label style={lbl}>State</label><input style={inp} value={fields.state} onChange={e => set('state', e.target.value)} /></div>
          <div><label style={lbl}>ZIP</label><input style={inp} value={fields.zip} onChange={e => set('zip', e.target.value)} /></div>
        </div>
        {activeFields.map(f => (
          <div key={f.key}>
            <label style={lbl}>{f.label}</label>
            <input style={inp} value={fields[f.key] || ''} onChange={e => set(f.key, e.target.value)} inputMode={f.type === 'number' || f.type === 'money' ? 'decimal' : 'text'} />
            {f.hint && <div style={srcStyle}>{f.hint}</div>}
          </div>
        ))}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
          <div><label style={lbl}>Your Name</label><input style={inp} value={fields.user || ''} onChange={e => set('user', e.target.value)} /></div>
          <div><label style={lbl}>Your Contact (email/phone)</label><input style={inp} value={fields.contact || ''} onChange={e => set('contact', e.target.value)} /></div>
        </div>
      </div>

      <div style={card} className="no-print">
        <h3 style={h3}>3 · Upload Documents & Photos</h3>
        <label style={lbl}>Documents (OM, rent roll, T12, financials) — sent to the extractor</label>
        <input type="file" multiple accept=".pdf,.doc,.docx,.xls,.xlsx,.csv,.txt" onChange={e => setDocs([...e.target.files])} />
        {docs.length > 0 && <div style={srcStyle}>{docs.length} document(s) attached</div>}
        <label style={lbl}>Photos — sent to the photo analyzer</label>
        <input type="file" multiple accept="image/*" onChange={e => setPhotos([...e.target.files])} />
        {photos.length > 0 && <div style={srcStyle}>{photos.length} photo(s) attached</div>}
      </div>

      <div className="no-print" style={{ marginBottom: 16 }}>
        <button type="button" onClick={analyze} disabled={phase === 'running'}
          style={{ padding: '12px 28px', fontSize: 16, fontWeight: 700, borderRadius: 8, border: 'none', cursor: phase === 'running' ? 'wait' : 'pointer', background: '#0A0F2C', color: '#C9A84C' }}>
          {phase === 'running' ? 'Analyzing… (extracting, reviewing photos, pulling comps)' : 'Analyze Deal'}
        </button>
        {error && <p style={{ color: '#B23030', fontWeight: 600 }}>{error}</p>}
      </div>

      {result && <Results r={result} />}
    </div>
  )
}

// ── Results view: 3 zones (Raw → Calculations → Recommendation) + supporting sections ──
function Results({ r }) {
  const ex = r.extracted
  const comps = r.comps
  const ph = r.photoRes
  const vColor = { PURSUE: '#2F7A40', NEGOTIATE: '#C8851A', PASS: '#B23030', 'INTAKE ONLY': '#6b7280', REVIEW: '#1E2A45' }[r.recommendation.verdict] || '#1E2A45'

  return (
    <div>
      {/* QUICK RECOMMENDATION */}
      <div style={{ ...card, borderLeft: `6px solid ${vColor}` }}>
        <h3 style={h3}>Quick Recommendation</h3>
        <div style={{ fontSize: 26, fontWeight: 800, color: vColor }}>{r.recommendation.verdict}</div>
        <p style={{ margin: '4px 0' }}>{r.recommendation.basis}</p>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginTop: 8 }}>
          <Val label="Seller Asking" value={money(r.inputs.askingPrice || ex?.asking)} source={r.inputs.askingPrice ? 'User input' : (ex?.asking ? 'Extracted document' : 'n/a')} />
          <Val label="Estimated Value / Max Purchase" value={money(r.headline.estValue)} source="Baby Analyzer (bible math /api/calc)" />
          <Val label="Max Recommended Offer" value={money(r.headline.maxOffer)} source="Baby Analyzer calculation" />
          <Val label="DSCR" value={r.headline.dscr != null ? Number(r.headline.dscr).toFixed(2) : '—'} source="Baby Analyzer calculation" />
        </div>
      </div>

      {/* ZONE 1 — RAW EXTRACTED DATA */}
      <div style={card}>
        <h3 style={h3}>Raw Extracted Data <span style={srcStyle}>(exactly what the extractor returned — before any conclusion)</span></h3>
        {!ex && <p style={srcStyle}>No documents extracted. {r.extractedRaw?.error ? `(${r.extractedRaw.error})` : ''}</p>}
        {ex && (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
            <Val label="Broker / OM Stated NOI" value={money(ex.brokerNOI)} source="Extracted document" />
            <Val label="Gross Income" value={money(ex.grossIncome)} source="Extracted document" />
            <Val label="Total Expenses" value={money(ex.expenses)} source="Extracted document" />
            <Val label="Asking (stated)" value={money(ex.asking)} source="Extracted document" />
            <Val label="Occupancy" value={ex.occupancy != null ? ex.occupancy + '%' : '—'} source="Extracted document" />
            <Val label="Cap Rate (stated)" value={ex.capRate != null ? pct(ex.capRate) : '—'} source="Extracted document" />
            <Val label="Units" value={ex.units ?? '—'} source="Extracted document" />
            <Val label="Square Footage" value={ex.sqft ?? '—'} source="Extracted document" />
          </div>
        )}
        {ex?.redFlags?.length > 0 && <p style={{ color: '#B23030' }}><b>Document red flags:</b> {ex.redFlags.join('; ')}</p>}
      </div>

      {/* ZONE 2 — CALCULATIONS */}
      <div style={card}>
        <h3 style={h3}>Baby Analyzer Calculations <span style={srcStyle}>(bible math — engine: {r.calcTypeUsed || 'none'})</span></h3>
        {!r.calc && <p style={{ color: '#C8851A', fontWeight: 600 }}>ANALYSIS MODULE NOT YET IMPLEMENTED / insufficient inputs — data captured and saved.</p>}
        {r.calc && (
          <>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
              <Val label="NOI used" value={money(r.headline.noiUsed)} source={r.brokerNOI && r.calcNOI === r.brokerNOI ? 'Broker NOI (no override entered)' : 'User input / derived'} />
              <Val label="Estimated Value / Max Purchase" value={money(r.headline.estValue)} source="Bible math" />
              <Val label="Max Offer" value={money(r.headline.maxOffer)} source="Bible math (incl. wholesale fee)" />
              <Val label="DSCR" value={r.headline.dscr != null ? Number(r.headline.dscr).toFixed(3) : '—'} source="Bible math" />
            </div>
            <details style={{ marginTop: 8 }}>
              <summary style={{ cursor: 'pointer', fontWeight: 600 }}>Detailed math (raw calc output)</summary>
              <pre style={{ background: '#f4f6fb', padding: 10, borderRadius: 6, overflow: 'auto', fontSize: 12 }}>{JSON.stringify(r.calc, null, 2)}</pre>
            </details>
          </>
        )}
      </div>

      {/* BROKER vs CALCULATED NOI */}
      <div style={card}>
        <h3 style={h3}>Broker vs Calculated NOI</h3>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8 }}>
          <Val label="Broker / OM Stated NOI" value={money(r.brokerNOI)} source="Extracted document" />
          <Val label="Baby Analyzer NOI" value={money(r.calcNOI)} source="Baby Analyzer" />
          <Val label="Difference" value={r.noiDelta != null ? money(r.noiDelta) : '—'} source="Calculated − Broker" />
        </div>
        {r.noiDelta != null && Math.abs(r.noiDelta) > 0 && (
          <p style={srcStyle}>Difference reflects expense-floor enforcement / actual (not pro-forma) figures used by Baby Analyzer.</p>
        )}
      </div>

      {/* COMP REVIEW */}
      <div style={card}>
        <h3 style={h3}>Comp Review</h3>
        {!comps || comps.ok === false ? <p style={srcStyle}>No comp data{comps?.error ? `: ${comps.error}` : ''}.</p> : (
          <>
            <Val label="AVM / Estimated Market Value" value={money(comps.avm?.value)} source={comps.avm?.source || 'Data Enrichment'} />
            {comps.avm && (comps.avm.low || comps.avm.high) && <Val label="AVM Range" value={`${money(comps.avm.low)} – ${money(comps.avm.high)}`} source={comps.avm.source} />}
            {comps.avm?.rent_estimate != null && <Val label="Rent Estimate" value={money(comps.avm.rent_estimate) + '/mo'} source={comps.avm.source} />}
            {comps.compContext && <p><b>Comp context:</b> {comps.compContext} <span style={srcStyle}>({comps.sources?.comps || 'Data Enrichment'})</span></p>}
            {comps.flood && <Val label="Flood Zone" value={`${comps.flood.zone || '—'}${comps.flood.sfha ? ' (SFHA)' : ''}`} source="FEMA via Data Enrichment" />}
            {comps.crime && <Val label="Neighborhood Safety" value={`${comps.crime.score ?? '—'} ${comps.crime.label ? '(' + comps.crime.label + ')' : ''}`} source="FBI/Census via Data Enrichment" />}
          </>
        )}
      </div>

      {/* DOCUMENT FINDINGS */}
      <div style={card}>
        <h3 style={h3}>Document Findings</h3>
        {!r.extractedRaw ? <p style={srcStyle}>No documents uploaded.</p> : (
          <>
            <Val label="Extractor endpoint" value={r.extractedRaw.endpoint || '—'} source="rei-doc-reader" />
            <Val label="Detected asset type" value={ex?.assetType || '—'} source="Extractor" />
            <details><summary style={{ cursor: 'pointer', fontWeight: 600 }}>Full extractor payload</summary>
              <pre style={{ background: '#f4f6fb', padding: 10, borderRadius: 6, overflow: 'auto', fontSize: 12 }}>{JSON.stringify(r.extractedRaw, null, 2)}</pre>
            </details>
          </>
        )}
      </div>

      {/* PHOTO FINDINGS + REHAB */}
      <div style={card}>
        <h3 style={h3}>Photo Findings & Rehab Analysis</h3>
        {!ph ? <p style={srcStyle}>No photos analyzed.</p> : (
          <>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
              <Val label="Overall Condition Tier" value={ph.overall_condition_tier || '—'} source="Photo Analyzer" />
              <Val label="Photos Analyzed" value={ph.photos_analyzed ?? '—'} source="Photo Analyzer" />
              <Val label="Rehab Estimate (mid)" value={money(ph.rehab_estimate_mid)} source={`Photo-assisted tier × sqft (${ph.basis || 'benchmark'})`} />
              <Val label="Rehab Range" value={`${money(ph.rehab_estimate_low)} – ${money(ph.rehab_estimate_high)}`} source="±15% band, Photo Analyzer" />
            </div>
            {ph.per_system_tiers && (
              <div style={{ marginTop: 8 }}>
                <b>Per-system condition (basis for rehab tier):</b>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 4, marginTop: 4 }}>
                  {Object.entries(ph.per_system_tiers).map(([k, v]) => <div key={k} style={{ fontSize: 13 }}>{k}: <b>{v}</b></div>)}
                </div>
              </div>
            )}
            {ph.explanation_one_line && <p style={srcStyle}>{ph.explanation_one_line}</p>}
          </>
        )}
      </div>

      {/* ASSUMPTIONS + MISSING INFO */}
      <div style={card}>
        <h3 style={h3}>Assumptions & Missing Information</h3>
        <p style={{ fontSize: 13 }}><b>Assumptions used:</b> bible-math defaults (LTV, lender rate/amortization, DSCR target, wholesale fee) from /api/calc; expense ratio defaults to 40% when not provided.</p>
        {r.missing.length > 0
          ? <div><b style={{ color: '#C8851A' }}>Missing (analysis treated as incomplete):</b><ul>{r.missing.map((m, i) => <li key={i}>{m}</li>)}</ul></div>
          : <p style={{ color: '#2F7A40' }}>No required fields flagged missing.</p>}
      </div>

      {/* SAVE / DRIVE */}
      <div style={card}>
        <h3 style={h3}>Saved Deal Record</h3>
        {r.driveUrl
          ? <p>✅ Saved to Drive: <a href={r.driveUrl} target="_blank" rel="noreferrer">{r.driveUrl}</a></p>
          : <p style={{ color: '#C8851A' }}>⚠ Drive not configured on server — analysis shown but files not stored. {r.persistError ? `(${r.persistError})` : ''}</p>}
        {r.savePersistError && <p style={srcStyle}>Note: {r.savePersistError}</p>}
        <p style={srcStyle}>Recorded on the shared Properties deal log (tool = baby-analyzer) when storage is configured.</p>
        <button type="button" className="no-print" onClick={() => window.print()} style={{ padding: '8px 16px', borderRadius: 6, border: '1px solid #0A0F2C', background: '#fff', cursor: 'pointer', fontWeight: 600 }}>Print / Save PDF</button>
      </div>
    </div>
  )
}

// Minimal HTML snapshot stored to Drive.
function buildReportHtml(r) {
  const rows = []
  rows.push(`<h1>Baby Analyzer — ${r.propertyType}</h1>`)
  rows.push(`<p>Generated ${r.generatedAt}</p>`)
  rows.push(`<h2>${r.recommendation.verdict}</h2><p>${r.recommendation.basis}</p>`)
  rows.push(`<h3>Headline</h3><pre>${JSON.stringify(r.headline, null, 2)}</pre>`)
  rows.push(`<h3>Raw Extracted</h3><pre>${JSON.stringify(r.extracted, null, 2)}</pre>`)
  rows.push(`<h3>Calculations</h3><pre>${JSON.stringify(r.calc, null, 2)}</pre>`)
  rows.push(`<h3>Comps</h3><pre>${JSON.stringify(r.comps, null, 2)}</pre>`)
  rows.push(`<h3>Photos / Rehab</h3><pre>${JSON.stringify(r.photoRes, null, 2)}</pre>`)
  rows.push(`<h3>Missing</h3><ul>${r.missing.map(m => `<li>${m}</li>`).join('')}</ul>`)
  return `<!doctype html><html><head><meta charset="utf-8"><title>Baby Analyzer Report</title></head><body>${rows.join('\n')}</body></html>`
}
