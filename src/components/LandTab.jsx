import { useState, useMemo } from 'react'
import { landMetrics } from '../math/land.js'

// ─────────────────────────────────────────────────────────────────────────────
// LAND / IOS / OUTDOOR STORAGE analysis section.
//
// Policy (Math Bible v3.1): there is NO approved land OFFER engine. This tab is
// INTAKE + FACT ORGANIZATION + RISK REVIEW + deterministic unit-price metrics.
// It never invents an offer. It never routes land through residential ARV,
// storage, MHP, or commercial building math. Residential AVM is never used as
// land value. If actual current income exists, income ratios are shown but
// explicitly labeled "income-based estimate only — not a land valuation engine".
//
// Output follows the platform report standard: Quick Answer → Property Facts →
// Zoning → type-specific questions → Valuation Metrics → Risk Rating → Offer
// Logic → LOI Terms → Final Recommendation. Saved to Drive + the Properties
// sheet like every other Residential Analyzer report.
// ─────────────────────────────────────────────────────────────────────────────

const money = (v) => (v == null || v === '' || !Number.isFinite(Number(v)))
  ? '—' : '$' + Math.round(Number(v)).toLocaleString()
const money2 = (v) => (v == null || !Number.isFinite(Number(v)))
  ? '—' : '$' + Number(v).toLocaleString(undefined, { maximumFractionDigits: 2 })
const pct = (v) => (v == null || !Number.isFinite(Number(v))) ? '—' : (Number(v) * 100).toFixed(2) + '%'

const card = { background: '#fff', border: '1px solid #d4dae8', borderRadius: 8, padding: '14px 16px', marginBottom: 12 }
const h3 = { margin: '0 0 8px', fontSize: 15, color: '#0A0F2C', borderBottom: '2px solid #C9A84C', paddingBottom: 4 }
const inp = { width: '100%', padding: '8px 10px', border: '1px solid #d4dae8', borderRadius: 6, fontSize: 14, boxSizing: 'border-box' }
const lbl = { display: 'block', fontSize: 12, fontWeight: 600, color: '#1E2A45', margin: '10px 0 3px' }
const srcStyle = { fontSize: 11, color: '#6b7280', fontStyle: 'italic' }

// Land types and which type-specific question block each one shows.
const LAND_TYPES = [
  { id: 'residential_infill', label: 'Residential infill lot', block: 'infill' },
  { id: 'larger_residential', label: 'Larger residential land parcel', block: 'larger' },
  { id: 'commercial_land', label: 'Commercial land', block: 'comind' },
  { id: 'industrial_land', label: 'Industrial land', block: 'comind' },
  { id: 'ios', label: 'Industrial Outdoor Storage (IOS)', block: 'ios' },
  { id: 'contractor_yard', label: 'Industrial Outdoor Supply / contractor yard', block: 'ios' },
  { id: 'truck_parking', label: 'Truck parking / equipment / laydown / storage yard', block: 'ios' }
]

const YNU = ['', 'Yes', 'No', 'Unknown']
const RISK_LEVELS = ['Unknown', 'Low', 'Medium', 'High']

// Field definitions per group. type: text | money | number | select | textarea
const FACTS = [
  { k: 'parcelNumber', l: 'Parcel number' },
  { k: 'municipality', l: 'Municipality' },
  { k: 'county', l: 'County' },
  { k: 'acres', l: 'Lot size (acres)', t: 'number' },
  { k: 'lotSqft', l: 'Lot size (sq ft) — leave blank to derive from acres', t: 'number' },
  { k: 'frontage', l: 'Frontage (ft)', t: 'number' },
  { k: 'depth', l: 'Depth (ft)', t: 'number' },
  { k: 'roadAccess', l: 'Road access (road name / type)' },
  { k: 'cornerInterior', l: 'Corner lot / interior lot', t: 'select', opts: ['', 'Corner', 'Interior', 'Through lot', 'Flag lot'] },
  { k: 'accessPoints', l: 'Number of access points', t: 'number' },
  { k: 'currentStructures', l: 'Current structures' },
  { k: 'currentTenants', l: 'Current tenants' },
  { k: 'currentIncome', l: 'Current ACTUAL income ($/yr) — leave blank if none', t: 'money' },
  { k: 'currentExpenses', l: 'Current expenses ($/yr)', t: 'money' },
  { k: 'taxes', l: 'Annual taxes ($)', t: 'money' },
  { k: 'assessedValue', l: 'Assessed value ($)', t: 'money' },
  { k: 'floodZone', l: 'Flood zone (FEMA zone, e.g. X / AE)' },
  { k: 'wetlands', l: 'Wetlands present?', t: 'select', opts: YNU },
  { k: 'topography', l: 'Topography', t: 'select', opts: ['', 'Level', 'Gently sloped', 'Steep', 'Mixed'] },
  { k: 'publicWater', l: 'Public water', t: 'select', opts: YNU },
  { k: 'publicSewer', l: 'Public sewer', t: 'select', opts: YNU },
  { k: 'electric', l: 'Electric available', t: 'select', opts: YNU },
  { k: 'gas', l: 'Gas available', t: 'select', opts: YNU },
  { k: 'stormwater', l: 'Stormwater access', t: 'select', opts: YNU },
  { k: 'driveway', l: 'Existing driveway / curb cut', t: 'select', opts: YNU },
  { k: 'fencing', l: 'Fencing present', t: 'select', opts: YNU },
  { k: 'lighting', l: 'Lighting present', t: 'select', opts: YNU },
  { k: 'paving', l: 'Paving / gravel', t: 'select', opts: ['', 'Paved', 'Gravel', 'Dirt/none', 'Partial'] },
  { k: 'environmental', l: 'Environmental concerns' },
  { k: 'easements', l: 'Easements' },
  { k: 'deedRestrictions', l: 'Deed restrictions' }
]

const ZONING = [
  { k: 'zoningClass', l: 'Current zoning classification' },
  { k: 'permittedUses', l: 'Permitted uses', t: 'textarea' },
  { k: 'conditionalUses', l: 'Conditional uses', t: 'textarea' },
  { k: 'specialExceptionUses', l: 'Special exception uses', t: 'textarea' },
  { k: 'prohibitedUses', l: 'Prohibited uses', t: 'textarea' },
  { k: 'setbacks', l: 'Setback requirements' },
  { k: 'lotCoverage', l: 'Lot coverage limits' },
  { k: 'heightLimit', l: 'Height limits' },
  { k: 'parkingReq', l: 'Parking requirements' },
  { k: 'outdoorStorageRules', l: 'Outdoor storage rules' },
  { k: 'screeningRules', l: 'Screening / fencing rules' },
  { k: 'bufferReq', l: 'Buffer requirements' },
  { k: 'stormwaterReq', l: 'Stormwater requirements' },
  { k: 'iosAllowed', l: 'IOS / contractor yard / truck parking appears allowed?', t: 'select', opts: YNU },
  { k: 'residentialAllowed', l: 'Residential development appears allowed?', t: 'select', opts: YNU },
  { k: 'subdivisionPossible', l: 'Subdivision appears possible?', t: 'select', opts: YNU },
  { k: 'rezoningNeeded', l: 'Rezoning or variance may be required?', t: 'select', opts: YNU }
]

const IOS_Q = [
  { k: 'ios_outdoorStorage', l: 'Outdoor storage permitted by right?', t: 'select', opts: YNU },
  { k: 'ios_truckParking', l: 'Truck parking permitted?', t: 'select', opts: YNU },
  { k: 'ios_equipment', l: 'Equipment storage permitted?', t: 'select', opts: YNU },
  { k: 'ios_contractor', l: 'Contractor yard permitted?', t: 'select', opts: YNU },
  { k: 'ios_container', l: 'Container storage permitted?', t: 'select', opts: YNU },
  { k: 'ios_vehicle', l: 'Vehicle storage permitted?', t: 'select', opts: YNU },
  { k: 'ios_fencingReq', l: 'Fencing required?', t: 'select', opts: YNU },
  { k: 'ios_screeningReq', l: 'Screening required?', t: 'select', opts: YNU },
  { k: 'ios_lightingAllowed', l: 'Lighting allowed?', t: 'select', opts: YNU },
  { k: 'ios_hours', l: 'Operating-hour restrictions?', t: 'select', opts: YNU },
  { k: 'ios_noise', l: 'Noise restrictions?', t: 'select', opts: YNU },
  { k: 'ios_envRestrict', l: 'Environmental restrictions?', t: 'select', opts: YNU },
  { k: 'ios_pavingReq', l: 'Paving required?', t: 'select', opts: YNU },
  { k: 'ios_gravelAllowed', l: 'Gravel allowed?', t: 'select', opts: YNU },
  { k: 'ios_stormwaterReq', l: 'Stormwater management required?', t: 'select', opts: YNU },
  { k: 'ios_turningRadius', l: 'Enough turning radius for trucks?', t: 'select', opts: YNU },
  { k: 'ios_highwayAccess', l: 'Highway access?', t: 'select', opts: YNU },
  { k: 'ios_distHighway', l: 'Distance to highway/interstate (mi)', t: 'number' },
  { k: 'ios_distIndustrial', l: 'Distance to industrial users (mi)', t: 'number' },
  { k: 'ios_residentialConflict', l: 'Nearby residential conflict risk', t: 'select', opts: RISK_LEVELS },
  { k: 'ios_codeRisk', l: 'Police / code enforcement risk', t: 'select', opts: RISK_LEVELS },
  { k: 'ios_neighborRisk', l: 'Neighbor objection risk', t: 'select', opts: RISK_LEVELS }
]

const INFILL_Q = [
  { k: 'inf_minLotSize', l: 'Minimum lot size' },
  { k: 'inf_minFrontage', l: 'Minimum frontage' },
  { k: 'inf_setbacks', l: 'Required setbacks' },
  { k: 'inf_dwellingType', l: 'Allowed dwelling type' },
  { k: 'inf_sfAllowed', l: 'Single-family allowed?', t: 'select', opts: YNU },
  { k: 'inf_duplexAllowed', l: 'Duplex allowed?', t: 'select', opts: YNU },
  { k: 'inf_mfAllowed', l: 'Multifamily allowed?', t: 'select', opts: YNU },
  { k: 'inf_mobileAllowed', l: 'Mobile/manufactured home allowed?', t: 'select', opts: YNU },
  { k: 'inf_modularAllowed', l: 'Modular allowed?', t: 'select', opts: YNU },
  { k: 'inf_parking', l: 'Parking requirements' },
  { k: 'inf_sewerLateral', l: 'Sewer lateral available?', t: 'select', opts: YNU },
  { k: 'inf_waterLateral', l: 'Water lateral available?', t: 'select', opts: YNU },
  { k: 'inf_sidewalkCurb', l: 'Sidewalk/curb requirements' },
  { k: 'inf_demoHistory', l: 'Demolition history' },
  { k: 'inf_blight', l: 'Blight / code issues' },
  { k: 'inf_buildability', l: 'Buildability risk', t: 'select', opts: RISK_LEVELS },
  { k: 'inf_encroachment', l: 'Neighbor encroachment risk', t: 'select', opts: RISK_LEVELS },
  { k: 'inf_finishedValue', l: 'Estimated finished home value if built ($)', t: 'money' },
  { k: 'inf_buildCost', l: 'Estimated build cost if available ($)', t: 'money' },
  { k: 'inf_buildableAsIs', l: 'Buildable as-is?', t: 'select', opts: YNU }
]

const LARGER_Q = [
  { k: 'lg_usableAcres', l: 'Usable acreage', t: 'number' },
  { k: 'lg_roadFrontage', l: 'Road frontage (ft)', t: 'number' },
  { k: 'lg_subdivisionPotential', l: 'Subdivision potential' },
  { k: 'lg_densityAllowed', l: 'Density allowed' },
  { k: 'lg_minLotSize', l: 'Minimum lot size' },
  { k: 'lg_maxUnits', l: 'Maximum units/lots possible', t: 'number' },
  { k: 'lg_publicSewer', l: 'Public sewer availability', t: 'select', opts: YNU },
  { k: 'lg_publicWater', l: 'Public water availability', t: 'select', opts: YNU },
  { k: 'lg_septicFeasible', l: 'Septic feasibility', t: 'select', opts: YNU },
  { k: 'lg_percStatus', l: 'Perc test status' },
  { k: 'lg_wetlands', l: 'Wetlands', t: 'select', opts: YNU },
  { k: 'lg_floodplain', l: 'Floodplain', t: 'select', opts: YNU },
  { k: 'lg_slope', l: 'Slope/topography' },
  { k: 'lg_accessRoad', l: 'Access road requirements' },
  { k: 'lg_stormwater', l: 'Stormwater requirements' },
  { k: 'lg_engineeringCost', l: 'Likely engineering cost ($)', t: 'money' },
  { k: 'lg_approvalRisk', l: 'Approval timeline risk', t: 'select', opts: RISK_LEVELS },
  { k: 'lg_builderDemand', l: 'Builder demand', t: 'select', opts: ['', 'Strong', 'Moderate', 'Weak', 'Unknown'] },
  { k: 'lg_exitOptions', l: 'Exit options (sell as-is / subdivide / entitle & sell / develop lots / hold)', t: 'textarea' }
]

const COMIND_Q = [
  { k: 'ci_commercialUses', l: 'Allowed commercial uses', t: 'textarea' },
  { k: 'ci_industrialUses', l: 'Allowed industrial uses', t: 'textarea' },
  { k: 'ci_trafficCount', l: 'Traffic count (AADT)', t: 'number' },
  { k: 'ci_roadClass', l: 'Road classification' },
  { k: 'ci_highwayAccess', l: 'Highway access', t: 'select', opts: YNU },
  { k: 'ci_visibility', l: 'Visibility', t: 'select', opts: ['', 'Excellent', 'Good', 'Fair', 'Poor'] },
  { k: 'ci_frontage', l: 'Frontage (ft)', t: 'number' },
  { k: 'ci_utilities', l: 'Utilities at site' },
  { k: 'ci_envHistory', l: 'Environmental history' },
  { k: 'ci_phase1', l: 'Phase I ESA needed?', t: 'select', opts: YNU },
  { k: 'ci_brownfield', l: 'Brownfield risk', t: 'select', opts: RISK_LEVELS },
  { k: 'ci_nearbyUsers', l: 'Nearby industrial/commercial users' },
  { k: 'ci_demandDrivers', l: 'Demand drivers', t: 'textarea' },
  { k: 'ci_leasePotential', l: 'Lease potential' },
  { k: 'ci_salePotential', l: 'Sale potential' },
  { k: 'ci_developmentPotential', l: 'Development potential' },
  { k: 'ci_requiredApprovals', l: 'Required approvals', t: 'textarea' }
]

const VALUATION_INPUTS = [
  { k: 'usableAcres', l: 'Usable acres (for $/usable acre)', t: 'number' },
  { k: 'buildableLots', l: 'Buildable lots (for $/buildable lot)', t: 'number' },
  { k: 'approvedUnits', l: 'Approved units (for $/approved unit)', t: 'number' },
  { k: 'truckSpaces', l: 'Truck spaces (for $/truck space)', t: 'number' },
  { k: 'outdoorStorageAcres', l: 'Outdoor storage acres (for $/storage acre)', t: 'number' },
  { k: 'currentNOI', l: 'Current ACTUAL NOI ($/yr) — only if income exists', t: 'money' }
]

const RISKS = [
  { k: 'r_zoning', l: 'Zoning risk' },
  { k: 'r_utility', l: 'Utility risk' },
  { k: 'r_environmental', l: 'Environmental risk' },
  { k: 'r_wetlandFlood', l: 'Wetlands / flood risk' },
  { k: 'r_access', l: 'Access risk' },
  { k: 'r_titleEasement', l: 'Title / easement risk' },
  { k: 'r_approval', l: 'Approval risk' },
  { k: 'r_neighbor', l: 'Neighbor objection risk' },
  { k: 'r_carrying', l: 'Carrying cost risk' },
  { k: 'r_exitLiquidity', l: 'Exit liquidity risk' }
]

const LOI_TERMS = [
  'Purchase price (manually underwritten — see Offer Logic)',
  'Long due diligence period (typically 60–120 days for land/IOS)',
  'Zoning verification contingency',
  'Municipal approval contingency',
  'Environmental inspection contingency (Phase I ESA where warranted)',
  'Survey contingency',
  'Title / easement review',
  'Utility verification',
  'Wetlands / floodplain review',
  'Engineering review',
  'Seller cooperation with approvals',
  'Assignment rights, if allowed',
  'Closing after approvals, if necessary',
  'Seller financing option, if applicable'
]

const DUE_DILIGENCE = [
  'Pull the zoning ordinance text for the parcel and confirm the use in writing with the municipality',
  'Order a boundary + topographic survey',
  'Confirm utility availability and tap/connection fees with each provider',
  'Check FEMA flood map + National Wetlands Inventory for the parcel',
  'Order a Phase I ESA if any environmental/industrial history',
  'Pull title commitment; review easements and deed restrictions',
  'Pull 3–5 comparable LAND sales (not improved-property AVMs) with $/acre and $/usable-acre',
  'For income parcels: obtain actual leases / ground lease and verify in-place rent'
]

// Static comp checklist used in the Offer Logic section.
const COMP_CHECKLIST = [
  'Same submarket / municipality',
  'Same or comparable zoning + permitted uses',
  'Similar usable-acreage ratio (net of wetlands/flood/slope)',
  'Comparable utilities at the site',
  'Comparable entitlement/approval status',
  'Comparable access (road frontage, curb cut, highway proximity)',
  'Adjust for: location, zoning, utilities, approvals, usable acreage, access, flood/wetland/topography, and any current income'
]

function Field({ def, value, onChange }) {
  const common = { style: inp, value: value ?? '', onChange: (e) => onChange(def.k, e.target.value) }
  return (
    <div>
      <label style={lbl}>{def.l}</label>
      {def.t === 'textarea'
        ? <textarea {...common} rows={2} />
        : def.t === 'select'
          ? <select {...common}>{def.opts.map((o) => <option key={o} value={o}>{o || '—'}</option>)}</select>
          : <input {...common} inputMode={def.t === 'number' || def.t === 'money' ? 'decimal' : 'text'} />}
    </div>
  )
}

function Val({ label, value, source }) {
  return (
    <div style={{ marginBottom: 8 }}>
      <div style={{ fontSize: 12, color: '#1E2A45', fontWeight: 600 }}>{label}</div>
      <div style={{ fontSize: 15 }}>{value}</div>
      {source && <div style={srcStyle}>Source: {source}</div>}
    </div>
  )
}

const riskColor = (lvl) => ({ Low: '#2F7A40', Medium: '#C8851A', High: '#B23030', Unknown: '#6b7280' }[lvl] || '#6b7280')

async function postForJson(url, opts, label) {
  let resp
  try { resp = await fetch(url, opts) } catch (e) { throw new Error(`${label}: network error (${e.message}).`) }
  const text = await resp.text()
  let data
  try { data = JSON.parse(text) } catch { throw new Error(`${label} failed (HTTP ${resp.status}).`) }
  if (!resp.ok) throw new Error(`${label} failed (HTTP ${resp.status}): ${data.error || 'unknown'}`)
  return data
}

export default function LandTab({ sharedUrlState }) {
  const [landType, setLandType] = useState('ios')
  const [address, setAddress] = useState(sharedUrlState?.address || '')
  const [stateCode, setStateCode] = useState('')
  const [askingPrice, setAskingPrice] = useState(sharedUrlState?.askingPrice || '')
  const [intendedUse, setIntendedUse] = useState('')
  const [highestUse, setHighestUse] = useState('')
  const [fields, setFields] = useState({})
  const [risks, setRisks] = useState(Object.fromEntries(RISKS.map((r) => [r.k, 'Unknown'])))
  const [verdict, setVerdict] = useState('Needs Research')
  const [recWhy, setRecWhy] = useState('')
  const [upside, setUpside] = useState('')
  const [biggestRisk, setBiggestRisk] = useState('')
  const [user, setUser] = useState('')
  const [contact, setContact] = useState('')

  const [report, setReport] = useState(null)
  const [phase, setPhase] = useState('idle')
  const [error, setError] = useState(null)

  const set = (k, v) => setFields((p) => ({ ...p, [k]: v }))
  const setRisk = (k, v) => setRisks((p) => ({ ...p, [k]: v }))
  const typeDef = LAND_TYPES.find((t) => t.id === landType)

  // Live metrics — recomputed as inputs change (pure ratios, no offer math).
  const metrics = useMemo(() => landMetrics({
    askingPrice,
    acres: fields.acres,
    lotSqft: fields.lotSqft,
    usableAcres: fields.usableAcres,
    buildableLots: fields.buildableLots,
    approvedUnits: fields.approvedUnits,
    truckSpaces: fields.truckSpaces,
    outdoorStorageAcres: fields.outdoorStorageAcres,
    currentIncome: fields.currentIncome,
    currentNOI: fields.currentNOI
  }), [askingPrice, fields])

  // Heuristic flags for the Quick Answer (presentation only — not underwriting).
  function computeFlags() {
    const red = []
    const fz = String(fields.floodZone || '').toUpperCase()
    if (/A|V/.test(fz) && fz !== 'X' && fz !== '') red.push(`Flood zone "${fields.floodZone}" — likely SFHA`)
    if (fields.wetlands === 'Yes') red.push('Wetlands present')
    if (fields.environmental && fields.environmental.trim()) red.push(`Environmental concern: ${fields.environmental}`)
    if (fields.zoningClass && fields.iosAllowed === 'No' && typeDef.block === 'ios') red.push('Zoning does not permit outdoor storage / IOS use')
    if (fields.rezoningNeeded === 'Yes') red.push('Rezoning or variance may be required')
    if (!fields.roadAccess) red.push('No confirmed road access')
    Object.entries(risks).forEach(([k, v]) => { if (v === 'High') red.push(`${RISKS.find((r) => r.k === k).l} rated HIGH`) })

    const missing = []
    if (!askingPrice) missing.push('Asking price')
    if (!fields.acres && !fields.lotSqft) missing.push('Lot size (acres or sq ft)')
    if (!fields.zoningClass) missing.push('Zoning classification')
    if (fields.iosAllowed === '' && typeDef.block === 'ios') missing.push('Whether outdoor storage is permitted')
    if (!fields.floodZone) missing.push('Flood zone')
    if (fields.publicWater === '' && fields.publicSewer === '') missing.push('Utility availability (water/sewer)')
    if (!fields.environmental) missing.push('Environmental review status')
    Object.entries(risks).forEach(([k, v]) => { if (v === 'Unknown') missing.push(`Risk rating: ${RISKS.find((r) => r.k === k).l}`) })
    return { red, missing }
  }

  function generate() {
    setError(null)
    if (!address) { setError('Enter a property address.'); return }
    const { red, missing } = computeFlags()
    const nextStep = missing.length
      ? `Resolve missing facts (${missing.length}) before any offer — start with zoning + utilities + flood/wetland confirmation.`
      : 'Facts sufficient for a manually-underwritten conditional LOI — see Offer Logic and LOI Terms.'
    setReport({
      generatedAt: new Date().toISOString(),
      landType, landTypeLabel: typeDef.label, block: typeDef.block,
      address, stateCode, askingPrice, intendedUse, highestUse,
      fields, risks, metrics,
      redFlags: red, missing, nextStep,
      verdict, recWhy, upside, biggestRisk
    })
    // jump to the report
    setTimeout(() => document.getElementById('land-report')?.scrollIntoView({ behavior: 'smooth' }), 50)
  }

  async function save() {
    if (!report) { setError('Generate the report first.'); return }
    setPhase('saving'); setError(null)
    try {
      const sheet = {
        asking_price: Number(String(askingPrice).replace(/[$,\s]/g, '')) || '',
        verdict,
        one_line_summary: `${typeDef.label} — ${verdict}`,
        recommended_offer: '',
        recommended_offer_basis: 'Land — manual underwriting (no approved land offer engine)'
      }
      const res = await postForJson('/api/save-report', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          address, propertyType: 'land', sheet, analysis: report,
          reportHtml: buildLandHtml(report), user, contact
        })
      }, 'Save')
      setReport((p) => ({ ...p, saved: res.ok, driveUrl: res.driveUrl, savePersistError: res.persistError }))
      setPhase('done')
    } catch (e) { setError(e.message); setPhase('idle') }
  }

  return (
    <div>
      <div style={{ ...card, borderLeft: '6px solid #C9A84C' }} className="no-print">
        <h3 style={h3}>Land / IOS / Outdoor Storage — Intake</h3>
        <p style={srcStyle}>
          SUPPORTED INTAKE — no approved Math Bible land OFFER engine exists. This tab organizes the facts,
          computes unit-price metrics, rates risk, and structures a conditional LOI so the deal can be
          underwritten manually. Land is never forced through residential, storage, MHP, or commercial
          building math, and residential AVM is never used as land value.
        </p>
      </div>

      {/* Type + headline inputs */}
      <div style={card} className="no-print">
        <h3 style={h3}>1 · Property Type & Headline</h3>
        <label style={lbl}>Land type</label>
        <select style={inp} value={landType} onChange={(e) => setLandType(e.target.value)}>
          {LAND_TYPES.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
        </select>
        <label style={lbl}>Property Address *</label>
        <input style={inp} value={address} onChange={(e) => setAddress(e.target.value)} placeholder="Parcel address or location, Lancaster County, PA" />
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
          <div><label style={lbl}>State</label><input style={inp} value={stateCode} onChange={(e) => setStateCode(e.target.value)} /></div>
          <div><label style={lbl}>Asking Price ($)</label><input style={inp} inputMode="decimal" value={askingPrice} onChange={(e) => setAskingPrice(e.target.value)} /></div>
        </div>
        <label style={lbl}>Intended use</label>
        <input style={inp} value={intendedUse} onChange={(e) => setIntendedUse(e.target.value)} />
        <label style={lbl}>Highest likely use (your assessment)</label>
        <input style={inp} value={highestUse} onChange={(e) => setHighestUse(e.target.value)} />
      </div>

      {/* Property facts */}
      <div style={card} className="no-print">
        <h3 style={h3}>2 · Property Facts</h3>
        {FACTS.map((d) => <Field key={d.k} def={d} value={fields[d.k]} onChange={set} />)}
      </div>

      {/* Zoning */}
      <div style={card} className="no-print">
        <h3 style={h3}>3 · Zoning / Use Review</h3>
        <p style={srcStyle}>Preliminary zoning review only — verify with municipality before offer or closing.</p>
        {ZONING.map((d) => <Field key={d.k} def={d} value={fields[d.k]} onChange={set} />)}
      </div>

      {/* Type-specific block */}
      {typeDef.block === 'ios' && (
        <div style={card} className="no-print">
          <h3 style={h3}>4 · IOS / Outdoor Storage Questions</h3>
          {IOS_Q.map((d) => <Field key={d.k} def={d} value={fields[d.k]} onChange={set} />)}
        </div>
      )}
      {typeDef.block === 'infill' && (
        <div style={card} className="no-print">
          <h3 style={h3}>5 · Residential Infill Lot Questions</h3>
          {INFILL_Q.map((d) => <Field key={d.k} def={d} value={fields[d.k]} onChange={set} />)}
        </div>
      )}
      {typeDef.block === 'larger' && (
        <div style={card} className="no-print">
          <h3 style={h3}>6 · Larger Residential Land Questions</h3>
          {LARGER_Q.map((d) => <Field key={d.k} def={d} value={fields[d.k]} onChange={set} />)}
        </div>
      )}
      {typeDef.block === 'comind' && (
        <div style={card} className="no-print">
          <h3 style={h3}>7 · Commercial / Industrial Land Questions</h3>
          {COMIND_Q.map((d) => <Field key={d.k} def={d} value={fields[d.k]} onChange={set} />)}
        </div>
      )}

      {/* Valuation inputs */}
      <div style={card} className="no-print">
        <h3 style={h3}>8 · Valuation Metric Inputs</h3>
        <p style={srcStyle}>Optional — each enables its matching $/unit metric. Cap rate appears only if actual NOI is entered.</p>
        {VALUATION_INPUTS.map((d) => <Field key={d.k} def={d} value={fields[d.k]} onChange={set} />)}
      </div>

      {/* Risk ratings */}
      <div style={card} className="no-print">
        <h3 style={h3}>9 · Risk Rating</h3>
        {RISKS.map((r) => (
          <div key={r.k}>
            <label style={lbl}>{r.l}</label>
            <select style={inp} value={risks[r.k]} onChange={(e) => setRisk(r.k, e.target.value)}>
              {RISK_LEVELS.map((o) => <option key={o} value={o}>{o}</option>)}
            </select>
          </div>
        ))}
      </div>

      {/* Final recommendation inputs */}
      <div style={card} className="no-print">
        <h3 style={h3}>12 · Final Recommendation (operator)</h3>
        <label style={lbl}>Verdict</label>
        <select style={inp} value={verdict} onChange={(e) => setVerdict(e.target.value)}>
          {['Proceed', 'Pause', 'Reject', 'Needs Research'].map((v) => <option key={v} value={v}>{v}</option>)}
        </select>
        <label style={lbl}>Why</label>
        <textarea style={inp} rows={2} value={recWhy} onChange={(e) => setRecWhy(e.target.value)} />
        <label style={lbl}>Biggest upside</label>
        <input style={inp} value={upside} onChange={(e) => setUpside(e.target.value)} />
        <label style={lbl}>Biggest risk</label>
        <input style={inp} value={biggestRisk} onChange={(e) => setBiggestRisk(e.target.value)} />
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
          <div><label style={lbl}>Your Name</label><input style={inp} value={user} onChange={(e) => setUser(e.target.value)} /></div>
          <div><label style={lbl}>Your Contact</label><input style={inp} value={contact} onChange={(e) => setContact(e.target.value)} /></div>
        </div>
      </div>

      <div className="no-print" style={{ marginBottom: 16 }}>
        <button type="button" onClick={generate}
          style={{ padding: '12px 28px', fontSize: 16, fontWeight: 700, borderRadius: 8, border: 'none', cursor: 'pointer', background: '#0A0F2C', color: '#C9A84C' }}>
          Generate Land Report
        </button>
        {error && <div style={{ marginTop: 12, padding: '12px 16px', background: '#fdeaea', border: '1px solid #B23030', borderRadius: 8 }}><b style={{ color: '#B23030' }}>Could not complete:</b> {error}</div>}
      </div>

      {report && <LandReport r={report} onSave={save} phase={phase} />}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// REPORT VIEW
// ─────────────────────────────────────────────────────────────────────────────
function LandReport({ r, onSave, phase }) {
  const m = r.metrics
  const f = r.fields
  const vColor = { Proceed: '#2F7A40', Pause: '#C8851A', Reject: '#B23030', 'Needs Research': '#1E2A45' }[r.verdict] || '#1E2A45'
  const factRows = FACTS.filter((d) => f[d.k] !== undefined && f[d.k] !== '')
  const zoningRows = ZONING.filter((d) => f[d.k] !== undefined && f[d.k] !== '')
  const blockDefs = { ios: IOS_Q, infill: INFILL_Q, larger: LARGER_Q, comind: COMIND_Q }[r.block] || []
  const blockTitle = { ios: '4 · IOS / Outdoor Storage', infill: '5 · Residential Infill', larger: '6 · Larger Residential Land', comind: '7 · Commercial / Industrial Land' }[r.block]
  const blockRows = blockDefs.filter((d) => f[d.k] !== undefined && f[d.k] !== '')

  return (
    <div id="land-report">
      {/* 1 · Quick Answer */}
      <div style={{ ...card, borderLeft: `6px solid ${vColor}` }}>
        <h3 style={h3}>1 · Quick Answer</h3>
        <div style={{ fontSize: 24, fontWeight: 800, color: vColor }}>{r.verdict}</div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginTop: 8 }}>
          <Val label="Property Type" value={r.landTypeLabel} source="Operator selection" />
          <Val label="Address / Parcel ID" value={`${r.address}${f.parcelNumber ? ' · ' + f.parcelNumber : ''}`} source="Operator input" />
          <Val label="Lot Size" value={m.acres ? `${m.acres} ac${m.lotSqft ? ` (${Math.round(m.lotSqft).toLocaleString()} sf)` : ''}` : '—'} source="Operator input" />
          <Val label="Zoning" value={f.zoningClass || '—'} source="Preliminary — verify with municipality" />
          <Val label="Current Use" value={f.currentStructures || f.currentTenants || 'Vacant / unknown'} source="Operator input" />
          <Val label="Intended Use" value={r.intendedUse || '—'} source="Operator input" />
          <Val label="Asking Price" value={money(m.askingPrice)} source="Operator input" />
          <Val label="Price / Acre" value={money(m.pricePerAcre)} source="Asking ÷ acres" />
          <Val label="Price / Sq Ft" value={money2(m.pricePerSqft)} source="Asking ÷ lot sq ft" />
          <Val label="Current Income" value={m.hasCurrentIncome ? money(f.currentIncome) : 'None'} source="Operator input" />
          <Val label="Highest Likely Use" value={r.highestUse || '—'} source="Operator assessment" />
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginTop: 8 }}>
          <div>
            <b style={{ color: '#B23030' }}>Immediate Red Flags</b>
            {r.redFlags.length ? <ul style={{ margin: '4px 0' }}>{r.redFlags.map((x, i) => <li key={i} style={{ fontSize: 13 }}>{x}</li>)}</ul> : <p style={{ fontSize: 13, color: '#2F7A40' }}>None flagged.</p>}
          </div>
          <div>
            <b style={{ color: '#C8851A' }}>Missing Information</b>
            {r.missing.length ? <ul style={{ margin: '4px 0' }}>{r.missing.map((x, i) => <li key={i} style={{ fontSize: 13 }}>{x}</li>)}</ul> : <p style={{ fontSize: 13, color: '#2F7A40' }}>None flagged.</p>}
          </div>
        </div>
        <p style={{ marginTop: 8 }}><b>Recommended Next Step:</b> {r.nextStep}</p>
        <p style={srcStyle}>No offer shown — land pricing requires manual underwriting (no approved Math Bible land engine).</p>
      </div>

      {/* 2 · Property Facts */}
      <SectionFacts title="2 · Property Facts" rows={factRows} f={f} empty="No property facts entered." />

      {/* 3 · Zoning */}
      <SectionFacts title="3 · Zoning / Use Review" rows={zoningRows} f={f} empty="No zoning data entered."
        note="Preliminary zoning review only — verify with municipality before offer or closing." />

      {/* 4-7 · Type-specific */}
      {blockRows.length > 0 && <SectionFacts title={blockTitle} rows={blockRows} f={f} empty="—" />}

      {/* 8 · Valuation Metrics */}
      <div style={card}>
        <h3 style={h3}>8 · Valuation Metrics</h3>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
          <Val label="Asking Price" value={money(m.askingPrice)} source="Operator input" />
          <Val label="Price / Acre" value={money(m.pricePerAcre)} source="Asking ÷ acres" />
          <Val label="Price / Sq Ft" value={money2(m.pricePerSqft)} source="Asking ÷ lot sq ft" />
          <Val label="Price / Usable Acre" value={money(m.pricePerUsableAcre)} source="Asking ÷ usable acres" />
          <Val label="Price / Buildable Lot" value={money(m.pricePerBuildableLot)} source="Asking ÷ buildable lots" />
          <Val label="Price / Approved Unit" value={money(m.pricePerApprovedUnit)} source="Asking ÷ approved units" />
          <Val label="Price / Truck Space" value={money(m.pricePerTruckSpace)} source="Asking ÷ truck spaces" />
          <Val label="Price / Outdoor Storage Acre" value={money(m.pricePerOutdoorStorageAcre)} source="Asking ÷ storage acres" />
        </div>
        {m.hasCurrentIncome ? (
          <div style={{ marginTop: 8, padding: '8px 12px', background: '#fff7e6', border: '1px solid #C8851A', borderRadius: 6 }}>
            <b style={{ color: '#C8851A' }}>Income-based estimate only — not a full approved land valuation engine.</b>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginTop: 6 }}>
              <Val label="Current Income Multiple" value={m.currentIncomeMultiple != null ? m.currentIncomeMultiple.toFixed(2) + '×' : '—'} source="Asking ÷ current gross income" />
              <Val label="Cap Rate (actual income only)" value={pct(m.capRateIfIncome)} source="Current NOI ÷ asking" />
            </div>
          </div>
        ) : <p style={srcStyle}>No current income entered — cap rate / income multiple intentionally omitted.</p>}
        <p style={{ ...srcStyle, marginTop: 6 }}>
          Comp adjustments to apply when pricing: location · zoning · utilities · approvals · usable acreage · access · flood/wetland/topography · current income.
          Do not use residential AVM as land value (reference only).
        </p>
      </div>

      {/* 9 · Risk Rating */}
      <div style={card}>
        <h3 style={h3}>9 · Risk Rating</h3>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
          {RISKS.map((rk) => (
            <div key={rk.k} style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid #eef1f7', padding: '4px 0' }}>
              <span style={{ fontSize: 13 }}>{rk.l}</span>
              <b style={{ fontSize: 13, color: riskColor(r.risks[rk.k]) }}>{r.risks[rk.k]}</b>
            </div>
          ))}
        </div>
      </div>

      {/* 10 · Offer Logic */}
      <div style={card}>
        <h3 style={h3}>10 · Offer Logic</h3>
        <p style={{ fontWeight: 700, color: '#B23030' }}>Land pricing requires manual underwriting because no approved Math Bible land engine exists.</p>
        <b>Facts collected:</b>
        <p style={{ fontSize: 13 }}>{[...factRows, ...zoningRows, ...blockRows].length} fields captured across facts, zoning, and type-specific questions (above).</p>
        <b>Missing facts:</b>
        {r.missing.length ? <ul style={{ margin: '4px 0' }}>{r.missing.map((x, i) => <li key={i} style={{ fontSize: 13 }}>{x}</li>)}</ul> : <p style={{ fontSize: 13 }}>None flagged.</p>}
        <b>Suggested due diligence:</b>
        <ul style={{ margin: '4px 0' }}>{DUE_DILIGENCE.map((x, i) => <li key={i} style={{ fontSize: 13 }}>{x}</li>)}</ul>
        <b>Comparable-sale checklist:</b>
        <ul style={{ margin: '4px 0' }}>{COMP_CHECKLIST.map((x, i) => <li key={i} style={{ fontSize: 13 }}>{x}</li>)}</ul>
        {m.hasCurrentIncome && <p style={{ fontSize: 13, color: '#C8851A' }}><b>Income-based estimate only</b> — current income exists; the income multiple and cap rate in section 8 are reference points, not a land valuation.</p>}
      </div>

      {/* 11 · LOI Terms */}
      <div style={card}>
        <h3 style={h3}>11 · Recommended LOI Terms</h3>
        <ul style={{ margin: '4px 0' }}>{LOI_TERMS.map((x, i) => <li key={i} style={{ fontSize: 13 }}>{x}</li>)}</ul>
      </div>

      {/* 12 · Final Recommendation */}
      <div style={{ ...card, borderLeft: `6px solid ${vColor}` }}>
        <h3 style={h3}>12 · Final Recommendation</h3>
        <div style={{ fontSize: 20, fontWeight: 800, color: vColor }}>{r.verdict}</div>
        {r.recWhy && <p><b>Why:</b> {r.recWhy}</p>}
        {r.upside && <p><b>Biggest upside:</b> {r.upside}</p>}
        {r.biggestRisk && <p><b>Biggest risk:</b> {r.biggestRisk}</p>}
        <b>Next 5 actions:</b>
        <ol style={{ margin: '4px 0' }}>{DUE_DILIGENCE.slice(0, 5).map((x, i) => <li key={i} style={{ fontSize: 13 }}>{x}</li>)}</ol>
        <b>Missing information needed before offer:</b>
        {r.missing.length ? <ul style={{ margin: '4px 0' }}>{r.missing.map((x, i) => <li key={i} style={{ fontSize: 13 }}>{x}</li>)}</ul> : <p style={{ fontSize: 13 }}>None flagged.</p>}
      </div>

      {/* Save / print */}
      <div style={card}>
        <h3 style={h3}>Saved Deal Record</h3>
        {r.driveUrl
          ? <p>✅ Saved to Drive: <a href={r.driveUrl} target="_blank" rel="noreferrer">{r.driveUrl}</a></p>
          : <p style={srcStyle}>Not yet saved. Save writes the report + a row to the shared Properties sheet (asset type = land).</p>}
        {r.savePersistError && <p style={srcStyle}>Note: {r.savePersistError}</p>}
        <div className="no-print" style={{ display: 'flex', gap: 8, marginTop: 6 }}>
          <button type="button" onClick={onSave} disabled={phase === 'saving'}
            style={{ padding: '8px 16px', borderRadius: 6, border: 'none', background: '#0A0F2C', color: '#C9A84C', cursor: phase === 'saving' ? 'wait' : 'pointer', fontWeight: 600 }}>
            {phase === 'saving' ? 'Saving…' : 'Save to Drive + Sheet'}
          </button>
          <button type="button" onClick={() => window.print()}
            style={{ padding: '8px 16px', borderRadius: 6, border: '1px solid #0A0F2C', background: '#fff', cursor: 'pointer', fontWeight: 600 }}>
            Print / Save PDF
          </button>
        </div>
      </div>
    </div>
  )
}

function SectionFacts({ title, rows, f, empty, note }) {
  return (
    <div style={card}>
      <h3 style={h3}>{title}</h3>
      {note && <p style={srcStyle}>{note}</p>}
      {rows.length === 0 ? <p style={srcStyle}>{empty}</p> : (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
          {rows.map((d) => (
            <div key={d.k} style={{ borderBottom: '1px solid #eef1f7', padding: '4px 0' }}>
              <div style={{ fontSize: 12, color: '#6b7280' }}>{d.l}</div>
              <div style={{ fontSize: 14 }}>{String(f[d.k])}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// Minimal HTML snapshot for Drive.
function buildLandHtml(r) {
  const f = r.fields
  const line = (k, v) => `<tr><td><b>${k}</b></td><td>${v == null ? '—' : v}</td></tr>`
  const facts = FACTS.filter((d) => f[d.k]).map((d) => line(d.l, f[d.k])).join('')
  const zoning = ZONING.filter((d) => f[d.k]).map((d) => line(d.l, f[d.k])).join('')
  const blockDefs = { ios: IOS_Q, infill: INFILL_Q, larger: LARGER_Q, comind: COMIND_Q }[r.block] || []
  const block = blockDefs.filter((d) => f[d.k]).map((d) => line(d.l, f[d.k])).join('')
  const m = r.metrics
  const riskRows = RISKS.map((rk) => line(rk.l, r.risks[rk.k])).join('')
  return `<!doctype html><html><head><meta charset="utf-8"><title>Land Report — ${r.address}</title>
<style>body{font-family:Arial,sans-serif;color:#1E2A45;max-width:900px;margin:24px auto}h1,h2{color:#0A0F2C}table{border-collapse:collapse;width:100%;margin:8px 0}td{border:1px solid #d4dae8;padding:4px 8px;font-size:13px}.flag{color:#B23030}</style></head><body>
<h1>Land / IOS Report — ${r.landTypeLabel}</h1>
<p>${r.address} · Generated ${r.generatedAt}</p>
<h2>1 · Quick Answer — ${r.verdict}</h2>
<table>${line('Asking Price', money(m.askingPrice))}${line('Price / Acre', money(m.pricePerAcre))}${line('Price / Sq Ft', money2(m.pricePerSqft))}${line('Zoning', f.zoningClass || '—')}${line('Intended Use', r.intendedUse || '—')}${line('Highest Likely Use', r.highestUse || '—')}${line('Current Income', m.hasCurrentIncome ? money(f.currentIncome) : 'None')}</table>
<p class="flag"><b>Red flags:</b> ${r.redFlags.join('; ') || 'None'}</p>
<p><b>Missing:</b> ${r.missing.join('; ') || 'None'}</p>
<p><b>Recommended next step:</b> ${r.nextStep}</p>
<h2>2 · Property Facts</h2><table>${facts || '<tr><td>—</td></tr>'}</table>
<h2>3 · Zoning / Use Review</h2><p><i>Preliminary — verify with municipality.</i></p><table>${zoning || '<tr><td>—</td></tr>'}</table>
${block ? `<h2>Type-specific questions</h2><table>${block}</table>` : ''}
<h2>8 · Valuation Metrics</h2>
<table>${line('Price / Usable Acre', money(m.pricePerUsableAcre))}${line('Price / Buildable Lot', money(m.pricePerBuildableLot))}${line('Price / Approved Unit', money(m.pricePerApprovedUnit))}${line('Price / Truck Space', money(m.pricePerTruckSpace))}${line('Price / Outdoor Storage Acre', money(m.pricePerOutdoorStorageAcre))}${m.hasCurrentIncome ? line('Current Income Multiple (income-based est. only)', (m.currentIncomeMultiple != null ? m.currentIncomeMultiple.toFixed(2) + '×' : '—')) + line('Cap Rate (actual income only)', pct(m.capRateIfIncome)) : ''}</table>
<p><i>Residential AVM is reference only — not reliable for land valuation.</i></p>
<h2>9 · Risk Rating</h2><table>${riskRows}</table>
<h2>10 · Offer Logic</h2><p class="flag">Land pricing requires manual underwriting because no approved Math Bible land engine exists.</p>
<h2>11 · Recommended LOI Terms</h2><ul>${LOI_TERMS.map((x) => `<li>${x}</li>`).join('')}</ul>
<h2>12 · Final Recommendation — ${r.verdict}</h2>
<p><b>Why:</b> ${r.recWhy || '—'}</p><p><b>Biggest upside:</b> ${r.upside || '—'}</p><p><b>Biggest risk:</b> ${r.biggestRisk || '—'}</p>
</body></html>`
}
