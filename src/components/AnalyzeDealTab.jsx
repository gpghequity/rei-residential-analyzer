import { useState } from 'react'
import { PROPERTY_TYPES, getType, num } from './analyze/typeMap.js'
import { buildIncomeMatrix, isIncomeAsset } from './analyze/incomeMatrix.js'
import { storageNOI } from '../math/storage.js'

// ── formatting ──
const money = (v) => (v == null || v === '' || !Number.isFinite(Number(v)))
  ? '—'
  : '$' + Math.round(Number(v)).toLocaleString()
const pct = (v) => (v == null || !Number.isFinite(Number(v))) ? '—' : (Number(v) * 100).toFixed(1) + '%'

// Normalize broker-stated figures out of whatever shape the extractor returned.
// Handles BOTH shapes: single-PDF /extract/om (figures at extraction.*) and
// multi-file /extract (figures under extraction.fast_calc.{storage|rental|flip|mhp}).
function pullExtracted(extracted) {
  if (!extracted || extracted.ok === false) return null
  const r = extracted.result || {}
  const ex = r.extraction || r
  // Multi-file /extract nests numbers under fast_calc by asset type.
  const fc = ex.fast_calc || {}
  const fcBlock = fc.storage || fc.rental || fc.mhp || fc.flip || {}
  const pick = (...vals) => {
    for (const v of vals) if (v !== undefined && v !== null && v !== '') return v
    return null
  }
  const out = {
    address: pick(ex.property_address, ex.detected_address?.value, ex.detected_address),
    assetType: pick(ex.asset_type?.value, ex.asset_type),
    brokerNOI: pick(ex.noi_annual, ex.noi, fcBlock.noi, fcBlock.noi_annual),
    grossIncome: pick(ex.gross_income_annual, ex.gross_income, fcBlock.gross, fcBlock.gross_income, fcBlock.gross_dollars_in),
    expenses: pick(ex.total_expenses_annual, ex.expenses, fcBlock.expenses, fcBlock.total_expenses),
    asking: pick(ex.asking_price, fcBlock.ask, fcBlock.asking_price, fcBlock.purchase),
    occupancy: pick(ex.occupancy_pct, ex.occupancy, fcBlock.occupancy_pct),
    capRate: pick(ex.cap_rate, fcBlock.cap_rate),
    units: pick(ex.unit_count, ex.units, fcBlock.units),
    sqft: pick(ex.square_footage, ex.sqft, fcBlock.sqft, fcBlock.square_footage),
    rehab: pick(ex.rehab_cost, fcBlock.rehab_cost, fcBlock.rehab),
    arv: pick(ex.arv, fcBlock.arv),
    redFlags: ex.red_flags || [],
    raw: ex
  }
  // If nothing meaningful was extracted, treat as empty so the UI says so.
  const hasAny = out.brokerNOI || out.grossIncome || out.asking || out.units || out.sqft || out.address
  return hasAny ? out : null
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
  if (calcType === 'storage_group_a' || calcType === 'multifamily_small' || calcType === 'multifamily_large') {
    return { noiUsed: result.noi, estValue: result.maxPurchase, maxOffer: result.yourOffer, dscr: result.actualDSCR, dscrPass: result.dscrPass }
  }
  if (calcType === 'commercial_dscr') {
    const c = result.conservative || {}
    return { noiUsed: result.noi, estValue: c.maxPurchase, maxOffer: c.yourOffer, dscr: c.dscr, dscrPass: (c.dscr || 0) >= 1.25, scenarios: result }
  }
  return {}
}

// Transparent recommendation rule (presentation layer — not bible math).
function recommend({ asking, maxOffer, estValue, dscrPass, typeImplemented, hasMath, isIncome }) {
  // Distinguish "no engine for this type" from "engine exists but we lack inputs".
  if (!typeImplemented) {
    return { verdict: 'INTAKE ONLY', basis: 'No analysis engine exists for this property type yet — data captured and saved.' }
  }
  if (!hasMath) {
    return isIncome
      ? { verdict: 'NEEDS INCOME', basis: 'This asset type IS supported — it just needs income. Enter NOI (or Gross Income + expense ratio) above, or upload an OM / T-12 / rent roll that states them, then re-run. Data captured and saved.' }
      : { verdict: 'REVIEW', basis: 'Not enough inputs to compute an offer; review captured data and add the missing fields.' }
  }
  const ask = num(asking)
  const offer = num(maxOffer) || num(estValue)
  if (!offer) return { verdict: 'REVIEW', basis: 'Not enough inputs to compute an offer; review captured data.' }
  if (!ask) return { verdict: 'REVIEW', basis: `Computed offer ${money(offer)}; enter seller asking to compare.` }
  // Thresholds: at/below offer = PURSUE (more spread the lower it is); up to 25% over = NEGOTIATE; beyond = WARNING.
  if (ask <= offer) return { verdict: 'PURSUE', basis: `Asking ${money(ask)} is at/below the max recommended offer ${money(offer)} — the lower the ask, the more spread.` }
  if (ask <= offer * 1.25) return { verdict: 'NEGOTIATE', basis: `Asking ${money(ask)} is up to 25% over the max offer ${money(offer)} — negotiable.` }
  return { verdict: 'WARNING', basis: `Asking ${money(ask)} is more than 25% over the max offer ${money(offer)}.${dscrPass === false ? ' DSCR below target.' : ''}` }
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

const cell = (v) => (v == null || v === 0) ? '—' : money(v)

// ── SECTION 1: Executive Summary (income assets) ──
function ExecutiveSummary({ r }) {
  const s = r.matrix.summary
  const ex = r.extracted
  return (
    <div style={{ ...card, borderLeft: '6px solid #C9A84C' }}>
      <h3 style={h3}>Executive Summary — The Answer</h3>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
        <Val label="NOI Used" value={money(s.noi)} source={r.noiBasis || 'Calculated'} />
        <Val label="Asset Type" value={r.propertyType} source="User selection" />
        <Val label="Conservative Value (1.25 DSCR)" value={money(s.conservativeValue)} source="Math Bible — bank-only @1.25" />
        <Val label="Aggressive Value (1.15 DSCR)" value={money(s.aggressiveValue)} source="Math Bible — bank-only @1.15" />
        <Val label="Best Seller-Finance Value" value={money(s.bestSellerFinanceValue)} source="Math Bible — $100k + seller structure" />
        <Val label="Recommended Offer Range" value={`${money(s.recommendedOfferRange[0])} – ${money(s.recommendedOfferRange[1])}`} source="1.25 → 1.15 DSCR band" />
        <Val label="Pocket Money Range" value={`${money(s.pocketRange[0])} – ${money(s.pocketRange[1])}`} source="Across all 8 structures" />
        <Val label="Seller Asking" value={money(r.inputs.askingPrice || ex?.asking)} source={r.inputs.askingPrice ? 'User input' : (ex?.asking ? 'Extracted document' : 'not provided')} />
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginTop: 8 }}>
        <div>
          <b style={{ color: '#C8851A' }}>Major Missing Information</b>
          {r.missing.length ? <ul style={{ margin: '4px 0' }}>{r.missing.map((m, i) => <li key={i} style={{ fontSize: 13 }}>{m}</li>)}</ul> : <p style={{ fontSize: 13, color: '#2F7A40' }}>None flagged.</p>}
        </div>
        <div>
          <b style={{ color: '#B23030' }}>Key Risks</b>
          <ul style={{ margin: '4px 0' }}>
            {(ex?.redFlags?.length ? ex.redFlags : []).map((m, i) => <li key={i} style={{ fontSize: 13 }}>{m}</li>)}
            {r.matrix.summary.pocketRange[0] < 0 && <li style={{ fontSize: 13 }}>Some structures produce negative pocket money.</li>}
            {!r.inputs.askingPrice && !ex?.asking && <li style={{ fontSize: 13 }}>No asking price — cannot gauge spread.</li>}
            <li style={{ fontSize: 13 }}>Estimates only; verify NOI and bank terms before offer.</li>
          </ul>
        </div>
      </div>
      <div style={{ marginTop: 6, fontSize: 11, color: '#6b7280' }}>
        Source attribution — NOI: {r.noiBasis || 'calculated'} · Bank terms: {r.matrix.assumptions.bankTerms} · Comp: {r.comps?.avm?.source || 'Data Enrichment'} · Math: Math Bible v3.
      </div>
    </div>
  )
}

// ── SECTION 2: Financing Matrix (operator dashboard, exact labels, no jargon) ──
function FinancingMatrix({ rows }) {
  const cols = [
    ['Structure', r => r.structure], ['DSCR', r => r.dscr.toFixed(2)], ['NOI', r => money(r.noi)],
    ['Offer', r => money(r.offer)], ['Bank', r => money(r.bank)], ['Borrower', r => money(r.borrower)],
    ['Seller FI', r => cell(r.sellerFi)], ['Bank Payment', r => money(r.bankPayment)],
    ['Borrower Cost', r => cell(r.borrowerCost)], ['Seller Payment', r => cell(r.sellerPayment)],
    ['Total Capital Cost', r => money(r.totalCapitalCost)], ['Pocket Money', r => money(r.pocketMoney)],
    ['Balloon', r => cell(r.balloon)]
  ]
  const th = { padding: '6px 8px', background: '#0A0F2C', color: '#fff', fontSize: 11, textAlign: 'right', whiteSpace: 'nowrap', position: 'sticky', top: 0 }
  const td = { padding: '6px 8px', fontSize: 12, textAlign: 'right', borderBottom: '1px solid #eef1f7', whiteSpace: 'nowrap' }
  return (
    <div style={card}>
      <h3 style={h3}>Financing Matrix <span style={srcStyle}>(operator dashboard — compare all 8 structures)</span></h3>
      <div style={{ overflowX: 'auto' }}>
        <table style={{ borderCollapse: 'collapse', width: '100%', minWidth: 900 }}>
          <thead><tr>{cols.map(([h], i) => <th key={i} style={{ ...th, textAlign: i === 0 ? 'left' : 'right' }}>{h}</th>)}</tr></thead>
          <tbody>
            {rows.map((row, ri) => (
              <tr key={ri} style={{ background: row.pocketMoney < 0 ? '#fdeaea' : (ri % 2 ? '#f7f9fd' : '#fff') }}>
                {cols.map(([, fn], ci) => <td key={ci} style={{ ...td, textAlign: ci === 0 ? 'left' : 'right', fontWeight: ci === 0 ? 600 : 400 }}>{fn(row)}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p style={srcStyle}>Bank funds its asset-correct LTV share (storage / MF 20+ = 75%; commercial = 75%), DSCR-sized; equity cost & seller financing apply only to the equity gap, never the full price. All figures from the Math Bible engine.</p>
    </div>
  )
}

// ── SECTION 4: Practical Recommendation ──
function PracticalRecommendation({ rec }) {
  return (
    <div style={{ ...card, borderLeft: '6px solid #2F7A40' }}>
      <h3 style={h3}>Practical Recommendation</h3>
      <p style={{ fontWeight: 700, fontSize: 15 }}>{rec.headline}</p>
      <ul style={{ margin: '4px 0' }}>{rec.notes.map((n, i) => <li key={i} style={{ fontSize: 13, marginBottom: 4 }}>{n}</li>)}</ul>
    </div>
  )
}

// ── SECTION 3: Detail cards (one per scenario) ──
function DetailCards({ rows, assumptions }) {
  return (
    <div style={card}>
      <h3 style={h3}>Detailed Scenario Cards <span style={srcStyle}>(backup for every matrix row)</span></h3>
      {rows.map((r, i) => (
        <details key={i} style={{ border: '1px solid #d4dae8', borderRadius: 6, padding: '8px 12px', marginBottom: 8 }} open={r.structureKey === 'bank_only'}>
          <summary style={{ cursor: 'pointer', fontWeight: 700, color: '#0A0F2C' }}>{r.structure} — {r.dscr.toFixed(2)} DSCR · Offer {money(r.offer)} · Pocket {money(r.pocketMoney)}</summary>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6, marginTop: 8 }}>
            <Val label="NOI" value={money(r.noi)} source="Calculated" />
            <Val label="Purchase Price / Offer" value={money(r.offer)} source="Math Bible (DSCR × bank terms)" />
            <Val label="Bank" value={money(r.bank)} source="70% DSCR-sized senior debt" />
            <Val label="Borrower" value={money(r.borrower)} source="Equity / buyer cash" />
            <Val label="Seller Finance" value={cell(r.sellerFi)} source={r.sellerFi ? 'Equity gap after $100k buyer cash' : 'n/a'} />
            <Val label="Annual Bank Payment" value={money(r.bankPayment)} source="Math Bible" />
            <Val label="Annual Borrower Cost" value={cell(r.borrowerCost)} source={r.borrowerCost ? '8% on borrower equity only' : 'none'} />
            <Val label="Annual Seller Payment" value={cell(r.sellerPayment)} source={r.sellerPayment ? '5% / 25-yr on seller note only' : 'n/a'} />
            <Val label="Total Capital Cost" value={money(r.totalCapitalCost)} source="Bank + borrower + seller" />
            <Val label="Pocket Money" value={money(r.pocketMoney)} source="NOI − total capital cost" />
            <Val label="Seller Balloon (yr 15)" value={cell(r.balloon)} source={r.balloon ? 'Remaining seller note @ yr 15' : 'n/a'} />
            <Val label="Cap Rate (derived)" value={r.capRate != null ? pct(r.capRate) : '—'} source="NOI ÷ offer" />
            <Val label="Debt Yield (derived)" value={r.debtYield != null ? pct(r.debtYield) : '—'} source="NOI ÷ bank loan" />
            <Val label="Cash-on-Cash (derived)" value={r.cashOnCash != null ? pct(r.cashOnCash) : '—'} source="Pocket ÷ cash invested" />
          </div>
        </details>
      ))}
      <p style={srcStyle}>Assumptions: bank {assumptions.bankTerms}, LTV {(assumptions.bankLtv * 100).toFixed(0)}%; equity {assumptions.equityRate}; seller note {assumptions.sellerNote}; buyer cash ${assumptions.buyerCashInSellerStructure.toLocaleString()} in the seller structure. {assumptions.note}</p>
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
  const [step, setStep] = useState('')
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
      const work = []
      if (docs.length) work.push(`extracting ${docs.length} document(s)`)
      if (photos.length) work.push(`analyzing ${photos.length} photo(s)`)
      work.push('pulling comps')
      setStep(`Working: ${work.join(', ')}… this can take 20–60s for documents/photos (AI reading).`)
      const orch = await postForJson('/api/analyze-deal', { method: 'POST', body: fd }, 'Analyze')

      const extractedNorm = pullExtracted(orch.extracted)

      // Surface a real extractor failure (e.g. doc-reader Claude key invalid → 401)
      // instead of silently showing blank fields. This is the difference between
      // "the document had nothing" and "the extractor service is down".
      let extractorError = null
      if (docs.length && (!extractedNorm)) {
        const er = orch.extracted || {}
        const inner = er.result || {}
        const raw = inner.error || er.error || null
        if (raw) {
          const s = String(raw)
          extractorError = /invalid x-api-key|authentication_error|401/i.test(s)
            ? 'Document extractor is DOWN — the rei-doc-reader Anthropic API key is invalid (401). No documents can be read until that key is renewed. (This is a service issue, not your file.)'
            : `Document extractor error: ${s.slice(0, 240)}`
        } else if (er.configured === false) {
          extractorError = 'Document extractor not configured on the server (REI_OPERATOR_PASSWORD).'
        }
      }

      // 2) Compute headline via existing bible math (/api/calc). Prefer user fields; fall back to extracted.
      const calcFields = { ...fields }
      if (extractedNorm) {
        if (!num(calcFields.noi) && extractedNorm.brokerNOI) calcFields.noi = extractedNorm.brokerNOI
        if (!num(calcFields.grossIncome) && extractedNorm.grossIncome) calcFields.grossIncome = extractedNorm.grossIncome
        if (!num(calcFields.askingPrice) && extractedNorm.asking) calcFields.askingPrice = extractedNorm.asking
      }
      setStep('Running Math Bible analysis…')
      let calc = null, head = {}, calcTypeUsed = null, matrix = null, noiBasis = null

      // ── Income/NOI assets → standardized Financing Matrix (Math Bible engine) ──
      if (isIncomeAsset(typeId)) {
        const grossN = num(calcFields.grossIncome)
        const expDollars = num(calcFields.expenses)
        let matrixNOI = num(calcFields.noi)
        if (matrixNOI > 0) {
          noiBasis = num(fields.noi) ? 'User-entered NOI' : 'Broker/OM NOI (no override)'
        } else if (grossN > 0) {
          // Expense ratio is a whole percent (41 → 0.41). An out-of-range value
          // (e.g. 41000, dollars typed into the % field) is treated as unset so a
          // typo can never drive NOI negative and break the matrix.
          let er = (calcFields.expenseRatio !== '' && calcFields.expenseRatio != null) ? num(calcFields.expenseRatio) / 100 : null
          if (er != null && (er < 0 || er > 1)) er = null
          if (expDollars > 0) {
            // Operator entered actual expense DOLLARS — the intuitive path.
            if (typeId === 'self_storage') {
              const sn = storageNOI(grossN, Math.min(0.95, expDollars / grossN))
              matrixNOI = sn.noi
              noiBasis = sn.floorBinds
                ? `Gross $${grossN.toLocaleString()} − expenses (35% storage floor binds)`
                : `Gross $${grossN.toLocaleString()} − expenses $${expDollars.toLocaleString()}`
            } else {
              matrixNOI = Math.max(0, Math.round(grossN - expDollars))
              noiBasis = `Gross $${grossN.toLocaleString()} − expenses $${expDollars.toLocaleString()}`
            }
          } else if (typeId === 'self_storage') {
            const sn = storageNOI(grossN, er || 0)
            matrixNOI = sn.noi
            noiBasis = sn.floorBinds
              ? `Gross $${grossN.toLocaleString()} × (1 − 35% storage expense floor)`
              : `Gross $${grossN.toLocaleString()} × (1 − ${Math.round(sn.expenseRatio * 100)}% expense ratio)`
          } else {
            const erUsed = er != null ? er : 0.40
            matrixNOI = Math.round(grossN * (1 - erUsed))
            noiBasis = `Gross $${grossN.toLocaleString()} × (1 − ${Math.round(erUsed * 100)}% expense ratio)`
          }
        }
        if (matrixNOI > 0) {
          matrix = buildIncomeMatrix({ assetType: typeId, noi: matrixNOI })
          calcTypeUsed = 'Math Bible income engine (financing matrix)'
          head = {
            noiUsed: matrixNOI,
            estValue: matrix.summary.aggressiveValue,   // highest supportable (1.15)
            maxOffer: matrix.summary.conservativeValue,  // prudent recommended (1.25 bank-only)
            dscr: 1.25
          }
        }
      } else {
        // Residential / IOS-land etc. → existing frozen /api/calc path.
        const calcPayload = type.buildCalc ? type.buildCalc(calcFields, mode) : null
        if (calcPayload) {
          const first = await runCalc({ type: calcPayload.type, inputs: calcPayload.inputs })
          calc = first.result; calcTypeUsed = calcPayload.type
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
      }
      const hasMath = Boolean(matrix) || Boolean(calc)

      // 3) Recommendation (transparent rule).
      const rec = recommend({
        asking: calcFields.askingPrice, maxOffer: head.maxOffer, estValue: head.estValue,
        dscrPass: head.dscrPass, typeImplemented: type.implemented, hasMath,
        isIncome: isIncomeAsset(typeId)
      })

      // 4) Broker vs calculated NOI.
      const brokerNOI = extractedNorm?.brokerNOI ?? null
      const calcNOI = head.noiUsed ?? null
      const noiDelta = (brokerNOI != null && calcNOI != null) ? (calcNOI - brokerNOI) : null

      // 5) Photos / rehab.
      const photoRes = orch.photos?.result || null

      // 6) Missing-info flags — evaluated against EFFECTIVE inputs, not raw blanks.
      const noiSatisfied = num(calcFields.noi) > 0 || num(calcFields.grossIncome) > 0 || (matrix != null)
      const missing = []
      if (!num(calcFields.askingPrice)) missing.push('Seller asking price')
      activeFields.forEach(f => {
        if (f.key === 'askingPrice') return
        // NOI / gross / expense are satisfied once an NOI is derivable.
        if (['noi', 'grossIncome', 'expenses', 'expenseRatio'].includes(f.key) && noiSatisfied) return
        if (!fields[f.key] && !calcFields[f.key]) missing.push(f.label)
      })
      if (!docs.length) missing.push('Financial documents (OM / T12 / rent roll)')
      if (!photos.length) missing.push('Property photos')

      const report = {
        generatedAt: new Date().toISOString(),
        tool: 'baby-analyzer',
        propertyType: type.label, mode: type.subModes ? mode : null,
        assetTypeId: typeId,
        isIncome: isIncomeAsset(typeId),
        implemented: type.implemented && hasMath,
        inputs: fields,
        extracted: extractedNorm, extractedRaw: orch.extracted, extractorError,
        comps: orch.comps, photos: orch.photos, photoRes,
        calc, calcTypeUsed, headline: head, matrix, noiBasis,
        recommendation: rec,
        brokerNOI, calcNOI, noiDelta,
        missing,
        driveUrl: orch.driveUrl,
        folderId: orch.folderId,
        persistError: orch.persistError
      }
      setResult(report)
      setPhase('done')
      setStep('')

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
      setStep('')
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
        <style>{`@keyframes baspin{to{transform:rotate(360deg)}}`}</style>
        <button type="button" onClick={analyze} disabled={phase === 'running'}
          style={{ padding: '12px 28px', fontSize: 16, fontWeight: 700, borderRadius: 8, border: 'none', cursor: phase === 'running' ? 'wait' : 'pointer', background: phase === 'running' ? '#1E2A45' : '#0A0F2C', color: '#C9A84C', opacity: phase === 'running' ? 0.85 : 1 }}>
          {phase === 'running' ? 'Analyzing…' : 'Analyze Deal'}
        </button>
        {phase === 'running' && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 12, padding: '12px 16px', background: '#fff7e6', border: '1px solid #C8851A', borderRadius: 8 }}>
            <span style={{ width: 22, height: 22, border: '3px solid #d8bd6e', borderTopColor: '#0A0F2C', borderRadius: '50%', display: 'inline-block', animation: 'baspin 0.8s linear infinite', flex: '0 0 auto' }} />
            <span style={{ fontWeight: 600, color: '#0A0F2C' }}>{step || 'Working…'}</span>
          </div>
        )}
        {error && (
          <div style={{ marginTop: 12, padding: '12px 16px', background: '#fdeaea', border: '1px solid #B23030', borderRadius: 8 }}>
            <b style={{ color: '#B23030' }}>Could not complete:</b> <span>{error}</span>
          </div>
        )}
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
  const vColor = { PURSUE: '#2F7A40', NEGOTIATE: '#C8851A', WARNING: '#B23030', PASS: '#2F7A40', 'INTAKE ONLY': '#6b7280', 'NEEDS INCOME': '#C8851A', REVIEW: '#1E2A45' }[r.recommendation.verdict] || '#1E2A45'

  return (
    <div>
      {/* Verdict badge */}
      <div style={{ ...card, borderLeft: `6px solid ${vColor}` }}>
        <h3 style={h3}>Quick Recommendation</h3>
        <div style={{ fontSize: 26, fontWeight: 800, color: vColor }}>{r.recommendation.verdict}</div>
        <p style={{ margin: '4px 0' }}>{r.recommendation.basis}</p>
        {!r.matrix && (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginTop: 8 }}>
            <Val label="Seller Asking" value={money(r.inputs.askingPrice || ex?.asking)} source={r.inputs.askingPrice ? 'User input' : (ex?.asking ? 'Extracted document' : 'n/a')} />
            <Val label="Estimated Value / Max Purchase" value={money(r.headline.estValue)} source="Baby Analyzer (bible math)" />
            <Val label="Max Recommended Offer" value={money(r.headline.maxOffer)} source="Baby Analyzer calculation" />
            <Val label="DSCR" value={r.headline.dscr != null ? Number(r.headline.dscr).toFixed(2) : '—'} source="Baby Analyzer calculation" />
          </div>
        )}
      </div>

      {/* INCOME ASSETS — standardized report: Exec Summary → Matrix → Practical Rec → Detail Cards */}
      {r.matrix && (
        <>
          <ExecutiveSummary r={r} />
          <FinancingMatrix rows={r.matrix.rows} />
          <PracticalRecommendation rec={r.matrix.recommendation} />
          <DetailCards rows={r.matrix.rows} assumptions={r.matrix.assumptions} />
        </>
      )}

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

      {/* ZONE 2 — CALCULATIONS (non-income; income assets use the matrix above) */}
      {!r.matrix && (
      <div style={card}>
        <h3 style={h3}>Baby Analyzer Calculations <span style={srcStyle}>(bible math — engine: {r.calcTypeUsed || 'none'})</span></h3>
        {!r.calc && (r.isIncome
          ? <p style={{ color: '#C8851A', fontWeight: 600 }}>No NOI yet — this asset type IS supported. Enter NOI, or Gross Income + Annual Expenses (or an expense ratio %), or upload an OM / T-12 that states them, then re-run. Raw data captured and saved.</p>
          : <p style={{ color: '#C8851A', fontWeight: 600 }}>Insufficient inputs to compute — data captured and saved.</p>)}
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
      )}

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
            {r.isIncome
              ? <p style={{ fontSize: 13, color: '#6b7280' }}><b>Note:</b> for income property, value is driven by the NOI/DSCR matrix above, not a residential AVM. The figures below are residential-style estimates shown for reference only.</p>
              : null}
            <Val label={r.isIncome ? 'Residential AVM (reference only — not used for income valuation)' : 'AVM / Estimated Market Value'} value={money(comps.avm?.value)} source={comps.avm?.source || 'Data Enrichment'} />
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
        {r.extractorError && (
          <div style={{ marginBottom: 8, padding: '10px 14px', background: '#fdeaea', border: '1px solid #B23030', borderRadius: 6 }}>
            <b style={{ color: '#B23030' }}>Extractor problem:</b> <span>{r.extractorError}</span>
          </div>
        )}
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
  if (r.matrix) {
    const s = r.matrix.summary
    rows.push(`<h3>Executive Summary</h3><pre>NOI Used: ${money(s.noi)}
Conservative (1.25): ${money(s.conservativeValue)}
Aggressive (1.15): ${money(s.aggressiveValue)}
Best Seller-Finance: ${money(s.bestSellerFinanceValue)}
Recommended Offer: ${money(s.recommendedOfferRange[0])} – ${money(s.recommendedOfferRange[1])}
Pocket Money: ${money(s.pocketRange[0])} – ${money(s.pocketRange[1])}</pre>`)
    const cols = ['Structure', 'DSCR', 'NOI', 'Offer', 'Bank', 'Borrower', 'Seller FI', 'Bank Payment', 'Borrower Cost', 'Seller Payment', 'Total Capital Cost', 'Pocket Money', 'Balloon']
    const trs = r.matrix.rows.map(x => `<tr><td>${x.structure}</td><td>${x.dscr.toFixed(2)}</td><td>${money(x.noi)}</td><td>${money(x.offer)}</td><td>${money(x.bank)}</td><td>${money(x.borrower)}</td><td>${cell(x.sellerFi)}</td><td>${money(x.bankPayment)}</td><td>${cell(x.borrowerCost)}</td><td>${cell(x.sellerPayment)}</td><td>${money(x.totalCapitalCost)}</td><td>${money(x.pocketMoney)}</td><td>${cell(x.balloon)}</td></tr>`).join('')
    rows.push(`<h3>Financing Matrix</h3><table border="1" cellpadding="4" style="border-collapse:collapse"><tr>${cols.map(c => `<th>${c}</th>`).join('')}</tr>${trs}</table>`)
    rows.push(`<h3>Practical Recommendation</h3><p>${r.matrix.recommendation.headline}</p><ul>${r.matrix.recommendation.notes.map(n => `<li>${n}</li>`).join('')}</ul>`)
  }
  rows.push(`<h3>Headline</h3><pre>${JSON.stringify(r.headline, null, 2)}</pre>`)
  rows.push(`<h3>Raw Extracted</h3><pre>${JSON.stringify(r.extracted, null, 2)}</pre>`)
  rows.push(`<h3>Calculations</h3><pre>${JSON.stringify(r.calc, null, 2)}</pre>`)
  rows.push(`<h3>Comps</h3><pre>${JSON.stringify(r.comps, null, 2)}</pre>`)
  rows.push(`<h3>Photos / Rehab</h3><pre>${JSON.stringify(r.photoRes, null, 2)}</pre>`)
  rows.push(`<h3>Missing</h3><ul>${r.missing.map(m => `<li>${m}</li>`).join('')}</ul>`)
  return `<!doctype html><html><head><meta charset="utf-8"><title>Baby Analyzer Report</title></head><body>${rows.join('\n')}</body></html>`
}
