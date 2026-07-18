// PORTED FROM docs/COMMERCIAL_BRIEF_V1.md (V1 spec) on 2026-05-13
// V1 scope: current contract rent only, single $/SF reserves, V2 deferred.
//
// Self-contained per platform isolation rule. UI primitives may reuse with
// other tabs in this repo only — math file (commercial.js) is its own
// snapshot of the spec.

import { useState, useMemo } from 'react'
import { loadConstants } from '../math/constants.js'
import {
  computeCommercial,
  DEFAULT_COLLECTION_LOSS, DEFAULT_TI_LC_PSF, DEFAULT_CAPEX_PSF,
  LEASE_TYPE_RECOVERIES,
  COMMERCIAL_SUBCLASSES, SUBCLASS_DEFAULTS, getSubclassDefaults,
  detectMixedUse
} from '../math/commercial.js'

const SUBCLASS_LABELS = {
  retail_strip: 'Retail — strip / multi-tenant',
  retail_single: 'Retail — single-tenant NNN',
  office_general: 'Office — general / multi-tenant',
  office_medical: 'Office — medical (MOB)',
  industrial_flex: 'Industrial — flex / light',
  industrial_warehouse: 'Industrial — warehouse / distribution',
  mixed_use: 'Mixed-use (retail + office/residential)',
  restaurant: 'Restaurant / QSR',
  self_serve_carwash: 'Self-serve car wash',
  special_purpose: 'Special purpose (bank, daycare, vet)',
  other: 'Other / generic commercial'
}

const BUILDING_TYPES = [
  'Single-tenant freestanding', 'Strip multi-tenant', 'Mixed-use',
  'Medical Office Building (MOB)', 'Office building', 'Flex-industrial', 'Other'
]

const TENANT_TYPES = [
  'Retail — general', 'Retail — food/beverage', 'Retail — anchor (credit tenant)',
  'Medical — general', 'Medical — specialty',
  'Office — general', 'Office — professional',
  'Service (auto, repair, trades)', 'Industrial / flex', 'Other'
]

const LEASE_TYPES = [
  { val: 'NNN', label: 'NNN (triple net)' },
  { val: 'NN', label: 'NN (double net)' },
  { val: 'MG', label: 'Modified Gross' },
  { val: 'FSG', label: 'Full Service Gross' },
  { val: 'PERCENTAGE', label: 'Percentage rent' },
  { val: 'GROUND', label: 'Ground lease' }
]

const blankTenant = () => ({
  suite: '', tenantName: '', sfLeased: '', tenantType: '',
  leaseType: '', baseRentPsf: '', leaseEndDate: '',
  recoveryOverrides: {}
})

const blankOtherIncome = () => ({ label: '', amount: '' })

// Build the initial form state from the LIVE Bible (fail closed). The lender + seller
// underwriting terms are NO LONGER seeded from owned constants — they came to default
// to 7% / 30-yr lender + 6% / 20-yr seller (an 8.64% overpay). They now default to the
// Bible's 7.25% / 25-yr lender + 5% / 25-yr seller (COMMERCIAL.mortgageRate /
// amortizationYears / sellerFinance). loadConstants() throws if the Bible was never
// read, so the form cannot open on stale numbers. Reserves/collection still default to
// the Bible-matching owned constants (user-overridable).
function makeInitial(C) {
  return {
    propertyName: '', address: '', county: '', state: '',
    askingPrice: '', yearBuilt: '',
    totalBuildingSF: '', totalLeasableSF: '',
    buildingType: '', subclass: '', parcelId: '', siteId: '',

    rentRoll: [blankTenant(), blankTenant()],
    otherIncomeLines: [],

    econVacancyPct: '',
    collectionLossPct: String(DEFAULT_COLLECTION_LOSS),

    opEx: {
      propertyTax: '', insurance: '', cam: '',
      commonUtilities: '',
      propMgmtIsPct: true,
      propMgmtPct: '0.05',
      propMgmtPctOrAmount: '',
      onsiteManager: '', officeAdmin: '', marketing: '', legal: '',
      repairs: '', roofReserve: '', other: ''
    },
    reserves: { tiLcPsf: String(DEFAULT_TI_LC_PSF), capexPsf: String(DEFAULT_CAPEX_PSF) },
    terms: {
      dscr: String(C.DSCR_COMMERCIAL),
      lenderRate: String(C.RATE_BANK_COMMERCIAL),
      lenderAm: String(C.AMORT_BANK_COMMERCIAL),
      lenderTerm: String(C.LENDER_TERM_COMMERCIAL),
      sellerRate: String(C.RATE_SELLER_COMMERCIAL),
      sellerAm: String(C.AMORT_SELLER_COMMERCIAL)
    }
  }
}

function fmtMoney(n) {
  if (n == null || !Number.isFinite(Number(n))) return '—'
  const v = Number(n)
  if (v === 0) return '$0'
  const neg = v < 0
  return (neg ? '-$' : '$') + Math.abs(Math.round(v)).toLocaleString('en-US')
}
function fmtPct(n, digits = 1) {
  if (n == null || !Number.isFinite(Number(n))) return '—'
  return (Number(n) * 100).toFixed(digits) + '%'
}
function fmtNumber(n, digits = 1) {
  if (n == null || !Number.isFinite(Number(n))) return '—'
  return Number(n).toFixed(digits)
}

const stickyTh = {
  padding: '6px 8px', background: '#1a2456', color: '#fff', fontSize: 11,
  textTransform: 'uppercase', letterSpacing: '0.04em', textAlign: 'left', fontWeight: 700
}
const td = { padding: '4px 6px', borderTop: '1px solid #e2e8f0', fontSize: 12, verticalAlign: 'top' }
const inp = { width: '100%', padding: '4px 6px', border: '1px solid #cbd5e1', borderRadius: 3, font: 'inherit', fontSize: 12 }

export default function CommercialTab(_props) {
  const [inputs, setInputs] = useState(() => makeInitial(loadConstants()))
  const [results, setResults] = useState(null)
  const [showExpanded, setShowExpanded] = useState(false)

  const update = (field, value) => setInputs(prev => ({ ...prev, [field]: value }))
  const updateOpEx = (k, v) => setInputs(prev => ({ ...prev, opEx: { ...prev.opEx, [k]: v } }))
  const updateReserves = (k, v) => setInputs(prev => ({ ...prev, reserves: { ...prev.reserves, [k]: v } }))
  const updateTerms = (k, v) => setInputs(prev => ({ ...prev, terms: { ...prev.terms, [k]: v } }))
  const updateTenant = (idx, k, v) => {
    setInputs(prev => {
      const rr = [...prev.rentRoll]
      rr[idx] = { ...rr[idx], [k]: v }
      return { ...prev, rentRoll: rr }
    })
  }
  const addTenant = () => setInputs(prev => ({ ...prev, rentRoll: [...prev.rentRoll, blankTenant()] }))
  const removeTenant = (idx) => setInputs(prev => ({
    ...prev, rentRoll: prev.rentRoll.filter((_, i) => i !== idx)
  }))
  const addOtherIncome = () => setInputs(prev => ({ ...prev, otherIncomeLines: [...prev.otherIncomeLines, blankOtherIncome()] }))
  const removeOtherIncome = (idx) => setInputs(prev => ({
    ...prev, otherIncomeLines: prev.otherIncomeLines.filter((_, i) => i !== idx)
  }))
  const updateOtherIncome = (idx, k, v) => setInputs(prev => {
    const lines = [...prev.otherIncomeLines]
    lines[idx] = { ...lines[idx], [k]: v }
    return { ...prev, otherIncomeLines: lines }
  })

  const totalBuildingSF = Number(inputs.totalBuildingSF) || 0
  const totalLeasableSF = Number(inputs.totalLeasableSF) || 0
  const commonAreaSF = Math.max(0, totalBuildingSF - totalLeasableSF)
  const loadFactor = totalBuildingSF > 0 ? commonAreaSF / totalBuildingSF : 0

  const calc = () => {
    const out = computeCommercial(inputs)
    setResults(out)
  }

  const reset = () => {
    setInputs(makeInitial(loadConstants()))
    setResults(null)
  }

  return (
    <section>
      <h2 style={{ margin: '0 0 8px', fontSize: 22, fontWeight: 600 }}>Commercial / NNN</h2>
      <p style={{ color: '#5a6a8a', fontSize: 13, lineHeight: 1.6, margin: '0 0 16px' }}>
        Operator-grade commercial deal analyzer. Rent roll with NNN/NN/MG/FSG lease types and auto-recoveries,
        MVM 0/20/30 scenarios, full landlord-net OpEx, WALT, rollover schedule, tenant concentration, V1 warnings.
        Spec: <code style={{ background: '#fff', padding: '1px 5px', borderRadius: 3 }}>docs/COMMERCIAL_BRIEF_V1.md</code>
      </p>

      {/* ── Section 1: Property Setup ──────────────────────────── */}
      <fieldset style={{ border: '1px solid #d4dae8', borderRadius: 6, background: '#fff', padding: 14, marginBottom: 14 }}>
        <legend style={{ padding: '0 8px', fontWeight: 700, fontSize: 13, color: '#1a2456', textTransform: 'uppercase', letterSpacing: '0.04em' }}>1. Property Setup</legend>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10 }}>
          <div><label style={lbl}>Property name</label><input style={inp} value={inputs.propertyName} onChange={e => update('propertyName', e.target.value)} /></div>
          <div><label style={lbl}>Address</label><input style={inp} value={inputs.address} onChange={e => update('address', e.target.value)} /></div>
          <div><label style={lbl}>Year built</label><input type="number" style={inp} value={inputs.yearBuilt} onChange={e => update('yearBuilt', e.target.value)} /></div>
          <div><label style={lbl}>County</label><input style={inp} value={inputs.county} onChange={e => update('county', e.target.value)} /></div>
          <div><label style={lbl}>State</label><input style={inp} value={inputs.state} onChange={e => update('state', e.target.value)} /></div>
          <div><label style={lbl}>Asking price ($)</label><input type="number" style={inp} value={inputs.askingPrice} onChange={e => update('askingPrice', e.target.value)} /></div>
          <div><label style={lbl}>Total building SF (gross)</label><input type="number" style={inp} value={inputs.totalBuildingSF} onChange={e => update('totalBuildingSF', e.target.value)} /></div>
          <div><label style={lbl}>Total leasable SF (net)</label><input type="number" style={inp} value={inputs.totalLeasableSF} onChange={e => update('totalLeasableSF', e.target.value)} /></div>
          <div><label style={lbl}>Common area SF (auto)</label><input style={{ ...inp, background: '#f8fafc' }} value={commonAreaSF.toLocaleString('en-US')} readOnly /></div>
          <div><label style={lbl}>Load factor % (auto)</label><input style={{ ...inp, background: '#f8fafc' }} value={fmtPct(loadFactor)} readOnly /></div>
          <div>
            <label style={lbl}>Building type</label>
            <select style={inp} value={inputs.buildingType} onChange={e => update('buildingType', e.target.value)}>
              <option value="">—</option>
              {BUILDING_TYPES.map(t => <option key={t}>{t}</option>)}
            </select>
          </div>
          <div>
            <label style={lbl}>Asset subclass <span style={{fontWeight: 400, color: '#64748b', fontSize: 11}}>(drives cap-rate band + warnings)</span></label>
            <select style={inp} value={inputs.subclass} onChange={e => update('subclass', e.target.value)}>
              <option value="">— pick to enable subclass-aware warnings —</option>
              {COMMERCIAL_SUBCLASSES.map(k => <option key={k} value={k}>{SUBCLASS_LABELS[k] || k}</option>)}
            </select>
            {inputs.subclass && (
              <div style={{fontSize: 11, color: '#475569', marginTop: 4, padding: 6, background: '#faf7ec', border: '1px solid #f0e9c8', borderRadius: 4}}>
                <strong>{SUBCLASS_LABELS[inputs.subclass]}</strong> · typical cap {(getSubclassDefaults(inputs.subclass).typicalCapRateLow * 100).toFixed(1)}–{(getSubclassDefaults(inputs.subclass).typicalCapRateHigh * 100).toFixed(1)}% · vacancy floor {(getSubclassDefaults(inputs.subclass).vacancyFloorPct * 100).toFixed(0)}% · TI/LC ${getSubclassDefaults(inputs.subclass).tiLcPsf.toFixed(2)}/SF · CapEx ${getSubclassDefaults(inputs.subclass).capexPsf.toFixed(2)}/SF
                <div style={{marginTop: 4, fontStyle: 'italic'}}>{getSubclassDefaults(inputs.subclass).notes}</div>
              </div>
            )}
          </div>
          <div><label style={lbl}>Parcel / Tax ID</label><input style={inp} value={inputs.parcelId} onChange={e => update('parcelId', e.target.value)} /></div>
          <div><label style={lbl}>Site ID (future Site Linker)</label><input style={inp} value={inputs.siteId} onChange={e => update('siteId', e.target.value)} /></div>
        </div>
      </fieldset>

      {/* ── Section 2: Rent Roll ──────────────────────────── */}
      <fieldset style={{ border: '1px solid #d4dae8', borderRadius: 6, background: '#fff', padding: 14, marginBottom: 14 }}>
        <legend style={{ padding: '0 8px', fontWeight: 700, fontSize: 13, color: '#1a2456', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
          2. Rent Roll
          <button type="button" onClick={() => setShowExpanded(!showExpanded)} style={{ marginLeft: 12, padding: '2px 8px', fontSize: 11, background: '#fff', color: '#1a2456', border: '1px solid #1a2456', borderRadius: 3, cursor: 'pointer' }}>
            {showExpanded ? 'Hide' : 'Show'} expanded columns
          </button>
        </legend>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                <th style={stickyTh}>Suite #</th>
                <th style={stickyTh}>Tenant Name</th>
                <th style={stickyTh}>SF Leased</th>
                <th style={stickyTh}>Tenant Type</th>
                <th style={stickyTh}>Lease Type</th>
                <th style={stickyTh}>$/SF/yr</th>
                <th style={stickyTh}>Lease End</th>
                <th style={stickyTh}>Annual Rent ($)</th>
                {showExpanded && <th style={stickyTh}>Guarantor</th>}
                {showExpanded && <th style={stickyTh}>Notes</th>}
                <th style={stickyTh}></th>
              </tr>
            </thead>
            <tbody>
              {inputs.rentRoll.map((row, i) => {
                const sf = Number(row.sfLeased) || 0
                const psf = Number(row.baseRentPsf) || 0
                const annual = sf * psf
                return (
                  <tr key={i}>
                    <td style={td}><input style={inp} value={row.suite} onChange={e => updateTenant(i, 'suite', e.target.value)} /></td>
                    <td style={td}><input style={inp} value={row.tenantName} onChange={e => updateTenant(i, 'tenantName', e.target.value)} placeholder="vacant if blank" /></td>
                    <td style={td}><input type="number" style={inp} value={row.sfLeased} onChange={e => updateTenant(i, 'sfLeased', e.target.value)} /></td>
                    <td style={td}>
                      <select style={inp} value={row.tenantType} onChange={e => updateTenant(i, 'tenantType', e.target.value)}>
                        <option value="">—</option>
                        {TENANT_TYPES.map(t => <option key={t}>{t}</option>)}
                      </select>
                    </td>
                    <td style={td}>
                      <select style={inp} value={row.leaseType} onChange={e => updateTenant(i, 'leaseType', e.target.value)}>
                        <option value="">—</option>
                        {LEASE_TYPES.map(t => <option key={t.val} value={t.val}>{t.label}</option>)}
                      </select>
                    </td>
                    <td style={td}><input type="number" step="0.01" style={inp} value={row.baseRentPsf} onChange={e => updateTenant(i, 'baseRentPsf', e.target.value)} /></td>
                    <td style={td}><input type="date" style={inp} value={row.leaseEndDate} onChange={e => updateTenant(i, 'leaseEndDate', e.target.value)} /></td>
                    <td style={{ ...td, fontFamily: 'ui-monospace, monospace', textAlign: 'right' }}>{fmtMoney(annual)}</td>
                    {showExpanded && <td style={td}><input style={inp} value={row.guarantor || ''} onChange={e => updateTenant(i, 'guarantor', e.target.value)} /></td>}
                    {showExpanded && <td style={td}><input style={inp} value={row.notes || ''} onChange={e => updateTenant(i, 'notes', e.target.value)} /></td>}
                    <td style={td}><button type="button" onClick={() => removeTenant(i)} style={{ padding: '2px 8px', background: '#991b1b', color: '#fff', border: 0, borderRadius: 3, cursor: 'pointer', fontSize: 10 }}>×</button></td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
        <div style={{ marginTop: 8 }}>
          <button type="button" onClick={addTenant} style={{ padding: '6px 14px', background: '#1a2456', color: '#fff', border: 0, borderRadius: 4, cursor: 'pointer', fontSize: 12, fontWeight: 700 }}>+ Add tenant</button>
          <span style={{ marginLeft: 12, fontSize: 11, color: '#5a6a8a' }}>Leave Tenant Name blank for vacant rows. Recoveries auto-populate from Lease Type.</span>
        </div>
      </fieldset>

      {/* ── Section 3: OpEx + Reserves + Assumptions ─────── */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12, marginBottom: 14 }}>

        <fieldset style={fset}>
          <legend style={leg}>3. Operating Expenses (gross, building-wide)</legend>
          <div style={twoCol}>
            <Field label="Property tax" value={inputs.opEx.propertyTax} onChange={v => updateOpEx('propertyTax', v)} />
            <Field label="Insurance" value={inputs.opEx.insurance} onChange={v => updateOpEx('insurance', v)} />
            <Field label="CAM" value={inputs.opEx.cam} onChange={v => updateOpEx('cam', v)} />
            <Field label="Common utilities" value={inputs.opEx.commonUtilities} onChange={v => updateOpEx('commonUtilities', v)} />
            <Field label="Prop mgmt (% of EGI)" value={inputs.opEx.propMgmtPct} onChange={v => updateOpEx('propMgmtPct', v)} placeholder="0.05" />
            <Field label="Onsite manager $" value={inputs.opEx.onsiteManager} onChange={v => updateOpEx('onsiteManager', v)} />
            <Field label="Office / admin" value={inputs.opEx.officeAdmin} onChange={v => updateOpEx('officeAdmin', v)} />
            <Field label="Marketing / leasing" value={inputs.opEx.marketing} onChange={v => updateOpEx('marketing', v)} />
            <Field label="Legal / professional" value={inputs.opEx.legal} onChange={v => updateOpEx('legal', v)} />
            <Field label="Repairs (non-CAM)" value={inputs.opEx.repairs} onChange={v => updateOpEx('repairs', v)} />
            <Field label="Roof/structure reserve" value={inputs.opEx.roofReserve} onChange={v => updateOpEx('roofReserve', v)} />
            <Field label="Other" value={inputs.opEx.other} onChange={v => updateOpEx('other', v)} />
          </div>
        </fieldset>

        <fieldset style={fset}>
          <legend style={leg}>4. Reserves ($/SF/yr)</legend>
          <Field label="TI/LC reserve $/SF" value={inputs.reserves.tiLcPsf} onChange={v => updateReserves('tiLcPsf', v)} placeholder="0.75" />
          <Field label="Capex reserve $/SF" value={inputs.reserves.capexPsf} onChange={v => updateReserves('capexPsf', v)} placeholder="0.30" />
          <p style={hint}>Defaults: TI/LC $0.75 (medical-heavy: $1.25), Capex $0.30 (pre-1990: $0.50)</p>

          <legend style={leg}>5. Vacancy / Collection</legend>
          <Field label="Economic vacancy % (override)" value={inputs.econVacancyPct} onChange={v => update('econVacancyPct', v)} placeholder="defaults to physical" />
          <Field label="Collection loss %" value={inputs.collectionLossPct} onChange={v => update('collectionLossPct', v)} placeholder="0.02" />
        </fieldset>

        <fieldset style={fset}>
          <legend style={leg}>6. Assumptions</legend>
          <Field label="DSCR" value={inputs.terms.dscr} onChange={v => updateTerms('dscr', v)} placeholder="1.25" />
          <Field label="Senior loan rate" value={inputs.terms.lenderRate} onChange={v => updateTerms('lenderRate', v)} placeholder="0.0775" />
          <Field label="Senior amortization (years)" value={inputs.terms.lenderAm} onChange={v => updateTerms('lenderAm', v)} placeholder="25" />
          <Field label="Senior term (years)" value={inputs.terms.lenderTerm} onChange={v => updateTerms('lenderTerm', v)} placeholder="5" />
          <Field label="Seller-fi rate" value={inputs.terms.sellerRate} onChange={v => updateTerms('sellerRate', v)} placeholder="0.06" />
          <Field label="Seller-fi amortization (years)" value={inputs.terms.sellerAm} onChange={v => updateTerms('sellerAm', v)} placeholder="20" />
        </fieldset>

      </div>

      <div style={{ display: 'flex', gap: 12, marginBottom: 16 }}>
        <button type="button" onClick={calc} style={{ padding: '12px 22px', background: '#C9A84C', color: '#1a2456', border: 0, borderRadius: 6, fontWeight: 700, fontSize: 15, cursor: 'pointer' }}>Calculate</button>
        <button type="button" onClick={reset} style={{ padding: '12px 22px', background: '#fff', color: '#1a2456', border: '1px solid #1a2456', borderRadius: 6, fontWeight: 700, cursor: 'pointer' }}>Reset</button>
      </div>

      {/* ── Output ────────────────────── */}
      {results && (() => {
        const mixedCheck = detectMixedUse({
          subclass: inputs.subclass,
          tenants: results.income?.tenants || [],
          additionalAssets: []
        })
        return (
        <>
          {mixedCheck.isMixedUse && (
            <div style={{ background: '#eff6ff', border: '2px solid #2563eb', borderRadius: 6, padding: 12, marginBottom: 14 }}>
              <strong style={{ color: '#1e3a8a', display: 'block', marginBottom: 6 }}>⊕ Looks like a mixed-use property</strong>
              <div style={{ fontSize: 13, color: '#1e3a8a' }}>
                Detected: <em>{mixedCheck.reason}</em>. Single-class commercial math may understate value when retail / office / residential / storage are blended.
                <br/>
                <a href="https://rei-mixed-use-production.up.railway.app/" target="_blank" rel="noopener" style={{ color: '#1d4ed8', fontWeight: 700 }}>Open Mixed-Use Blend Tool →</a>
                <span style={{ color: '#475569', marginLeft: 8 }}>for combined per-asset valuation</span>
              </div>
            </div>
          )}
          {results.warnings.length > 0 && (
            <div style={{ background: '#fff8e6', border: '2px solid #C9A84C', borderRadius: 6, padding: 12, marginBottom: 14 }}>
              <strong style={{ color: '#1a2456', display: 'block', marginBottom: 6 }}>Warnings ({results.warnings.length})</strong>
              <ul style={{ margin: 0, paddingLeft: 20, fontSize: 13 }}>
                {results.warnings.map((w, i) => (
                  <li key={i} style={{ color: w.severity === 'error' ? '#991b1b' : '#b45309', marginBottom: 4 }}>
                    {w.severity === 'error' ? '🔴 ' : '⚠️ '}{w.message}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* MVM scenarios */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12, marginBottom: 14 }}>
            {results.results.map((r, i) => (
              <fieldset key={i} style={{ ...fset, borderLeft: '6px solid ' + (i === 0 ? '#15803d' : i === 1 ? '#b45309' : '#991b1b') }}>
                <legend style={leg}>MVM {(r.mvmPct * 100).toFixed(0)}%</legend>
                <Row k="GSI" v={fmtMoney(r.gsi)} />
                <Row k="Econ vacancy loss" v={fmtMoney(r.econVacancyLoss)} />
                <Row k="Collection loss" v={fmtMoney(r.collectionLossDollar)} />
                <Row k="EGI" v={fmtMoney(r.egi)} bold />
                <Row k="Gross OpEx" v={fmtMoney(r.grossOpEx)} />
                <Row k="Reimbursements" v={fmtMoney(r.totalReimbursements)} />
                <Row k="Net OpEx (landlord)" v={fmtMoney(r.netOpExToLandlord)} />
                <Row k="TI/LC reserve" v={fmtMoney(r.tiLcAnnual)} />
                <Row k="Capex reserve" v={fmtMoney(r.capexAnnual)} />
                <Row k="NOI" v={fmtMoney(r.noi)} bold large />
                <Row k="Implied cap rate" v={fmtPct(r.impliedCapRate, 2)} />
                <Row k="Max senior loan" v={fmtMoney(r.maxSeniorLoan)} />
                <Row k="Senior annual DS" v={fmtMoney(r.seniorDS)} />
                <Row k="Seller-fi amount" v={fmtMoney(r.sellerFiAmount)} />
                <Row k="Seller-fi annual DS" v={fmtMoney(r.sellerDS)} />
                <Row k="Total annual DS" v={fmtMoney(r.totalDS)} />
                <Row k="DSCR check" v={r.dscrCheck ? r.dscrCheck.toFixed(2) : '—'} danger={r.dscrFlagsRed} bold />
                <Row k="Cash flow after DS" v={fmtMoney(r.cashFlowAfterDS)} bold />
                <Row k="Cash to close" v={fmtMoney(r.cashToClose)} />
                <Row k="Cash-on-cash" v={fmtPct(r.cashOnCash, 1)} bold />
              </fieldset>
            ))}
          </div>

          {/* Commercial-specific outputs */}
          <fieldset style={fset}>
            <legend style={leg}>Commercial-specific outputs</legend>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
              <div>
                <h4 style={h4}>Tenant concentration</h4>
                <Row k="Top tenant % of income" v={fmtPct(results.commercial.conc.topTenantPct)} />
                {results.commercial.conc.rows.length > 0 && (
                  <table style={{ width: '100%', fontSize: 11, borderCollapse: 'collapse', marginTop: 6 }}>
                    <thead><tr><th style={stickyTh}>Tenant</th><th style={stickyTh}>$/yr</th><th style={stickyTh}>%</th></tr></thead>
                    <tbody>
                      {results.commercial.conc.rows.slice(0, 8).map((row, i) => (
                        <tr key={i}>
                          <td style={td}>{row.tenantName}</td>
                          <td style={{ ...td, fontFamily: 'ui-monospace, monospace', textAlign: 'right' }}>{fmtMoney(row.annual)}</td>
                          <td style={{ ...td, textAlign: 'right' }}>{fmtPct(row.pctOfTotal)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
              <div>
                <h4 style={h4}>WALT + rollover</h4>
                <Row k="WALT (years)" v={fmtNumber(results.commercial.walt, 2)} />
                <Row k="Rolling Y1" v={fmtPct(results.commercial.rollover.year_1)} />
                <Row k="Rolling Y2" v={fmtPct(results.commercial.rollover.year_2)} />
                <Row k="Rolling Y3" v={fmtPct(results.commercial.rollover.year_3)} />
                <Row k="Rolling Y4" v={fmtPct(results.commercial.rollover.year_4)} />
                <Row k="Rolling Y5" v={fmtPct(results.commercial.rollover.year_5)} />
                <Row k="Beyond 5yr" v={fmtPct(results.commercial.rollover.beyond)} />
                <Row k="Weighted avg rent $/SF" v={'$' + fmtNumber(results.commercial.avgRentPsf, 2)} />
                <Row k="Recovery ratio" v={results.commercial.recRatio != null ? fmtPct(results.commercial.recRatio, 1) : '—'} />
                <Row k="Vacancy by SF" v={fmtPct(results.income.physicalVacancyPct)} />
              </div>
            </div>
          </fieldset>
        </>
        )
      })()}
    </section>
  )
}

const lbl = { display: 'block', fontSize: 10, color: '#5a6a8a', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 3 }
const fset = { border: '1px solid #d4dae8', borderRadius: 6, background: '#fff', padding: 12 }
const leg = { padding: '0 8px', fontWeight: 700, fontSize: 12, color: '#1a2456', textTransform: 'uppercase', letterSpacing: '0.04em' }
const twoCol = { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }
const hint = { fontSize: 10, color: '#5a6a8a', fontStyle: 'italic', margin: '4px 0' }
const h4 = { fontSize: 12, color: '#1a2456', textTransform: 'uppercase', letterSpacing: '0.04em', margin: '0 0 6px' }

function Field({ label, value, onChange, placeholder }) {
  return (
    <div style={{ marginBottom: 6 }}>
      <label style={lbl}>{label}</label>
      <input style={inp} value={value || ''} onChange={e => onChange(e.target.value)} placeholder={placeholder || ''} />
    </div>
  )
}

function Row({ k, v, bold, large, danger }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', padding: '3px 0', borderBottom: '1px dashed #e2e8f0', fontSize: large ? 14 : 12 }}>
      <span style={{ color: danger ? '#991b1b' : '#5a6a8a', fontWeight: bold ? 700 : 400 }}>{k}</span>
      <span style={{ fontFamily: 'ui-monospace, monospace', fontWeight: bold ? 700 : 400, color: danger ? '#991b1b' : '#0f172a' }}>{v}</span>
    </div>
  )
}
