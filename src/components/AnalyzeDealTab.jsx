import { useState, useEffect } from 'react'
import { PROPERTY_TYPES, getType, num } from './analyze/typeMap.js'
import { buildIncomeMatrix, isIncomeAsset } from './analyze/incomeMatrix.js'
import { storageNOI } from '../math/storage.js'
import { VERSION } from '../version.js'
// Deep underwriters — formerly separate top tabs, now mounted inline as the
// "Full Analysis" mode for their property type. Same Math Bible engines
// (src/math/*); reached from the single dropdown instead of a tab bar.
import ResidentialTab from './ResidentialTab.jsx'
import StorageTab from './StorageTab.jsx'
import MhpTab from './MhpTab.jsx'
import CommercialTab from './CommercialTab.jsx'
import MixedUseTab from './MixedUseTab.jsx'
import LandTab from './LandTab.jsx'
// Rehab is its OWN silo (rei-rehab-calc) — embedded here, never copied in. The
// total flows back via postMessage. One home for the rehab logic.
const REHAB_CALC_URL = 'https://rei-rehab-calc.vercel.app'
import PortfolioSection from './analyze/PortfolioSection.jsx'
import { NATIONAL_PSF, REGIONAL_ADJ, toBenchmarkTier } from '../math/rehab/rehabSystems.js'

// Which Rehab Calc system set each property type uses. EVERY type shows the
// embedded condition→rehab questions (per Steve) — residential rehab feeds the
// flip MAO; on every other type/mode it's captured as an output but does not
// alter the income/DSCR math. Anything unmapped falls back to the residential set.
const REHAB_MODE = {
  residential: 'residential',
  multifamily_small: 'residential',
  multifamily_large: 'residential',
  mhp_rv: 'residential',
  rv_park: 'residential',
  self_storage: 'storage',
  ios: 'storage',
  commercial: 'commercial',
  mixed_use: 'commercial',
  ios_land: 'commercial'
}

// ── formatting ──
const money = (v) => (v == null || v === '' || !Number.isFinite(Number(v)))
  ? '—'
  : '$' + Math.round(Number(v)).toLocaleString()
const pct = (v) => (v == null || !Number.isFinite(Number(v))) ? '—' : (Number(v) * 100).toFixed(1) + '%'

// Map a rehab-engine system id → pic-rehab's per-system key, and label its tier.
const PHOTO_KEY_FOR = { roof: 'roof', kitchen: 'kitchen', furnace: 'hvac', hvac: 'hvac', plumbing: 'plumbing', electrical: 'electrical', windows: 'windows', siding: 'siding', exterior: 'exterior', exteriorPaint: 'exterior', facade: 'exterior', structure: 'structure', cosmetic: 'cosmetic', interior: 'interior', fullBath: 'bath' }
const PHOTO_TIER_LABEL = { gold_leaf: 'Move-in', move_in: 'Move-in', light_rehab: 'Light', medium_rehab: 'Medium', heavy_rehab: 'Heavy', studs: 'Studs' }
function photoConditionFor(systemId, tiers) {
  if (!tiers) return '—'
  const key = PHOTO_KEY_FOR[systemId]
  const t = key && tiers[key]
  return t ? (PHOTO_TIER_LABEL[t] || t) : '—'
}

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

// ── Retail vs Wholesale offer tiers (presentation layer — NOT bible math) ─────
// Every deal, every asset type, shows the operator BOTH choices so a number like
// "$286,800 on a $424,000 house" reads as an investor/wholesale offer — not a
// mistake. Retail = market/listing value (what it sells for at retail); Wholesale
// = the discounted investor offer (the lower number). Pure presentation; the
// frozen Math Bible numbers are unchanged.
function offerTiers(r) {
  const h = r.headline || {}
  if (r.matrix) {
    const s = r.matrix.summary
    return {
      retail: s.aggressiveValue ?? null,
      wholesale: s.conservativeValue ?? null,
      retailLabel: 'Retail / Market Value',
      wholesaleLabel: 'Wholesale / Investor Offer',
      retailSrc: 'Math Bible — aggressive (1.15 DSCR) value',
      wholesaleSrc: 'Math Bible — conservative (1.25 DSCR) offer',
      note: 'Retail = the most a full-price buyer could justify. Wholesale = the prudent investor offer that keeps margin.'
    }
  }
  const isFlip = r.calcTypeUsed === 'residential_mao'
  return {
    retail: h.estValue ?? null,
    wholesale: (h.maxOffer != null) ? h.maxOffer : null,
    retailLabel: isFlip ? 'Retail Offer (Listing / Market)' : 'Retail / Market Value',
    wholesaleLabel: 'Wholesale Offer (Investor)',
    retailSrc: r.compSeeded ? 'Comp-seeded market value (preliminary)' : (isFlip ? 'After-Repair Value — what it sells for fixed up' : 'Bible math'),
    wholesaleSrc: r.compSeeded ? 'PRELIMINARY — confirm ARV/rehab' : 'Bible math (70% rule − fees − repairs)',
    note: isFlip
      ? 'Retail = the list / resale value once fixed up. Wholesale = the most an investor pays to flip it and keep margin (70% of value, minus repairs and fee). A house needing no repairs still shows a wholesale number — that is the investor price, not the market price.'
      : 'Retail = market value. Wholesale = the lower investor offer.'
  }
}

// Human-readable math (no JSON). Returns [{label, value, note}] rows so the
// operator sees the steps in plain English instead of a code dump.
function humanMath(r) {
  const c = r.calc || {}
  const ct = r.calcTypeUsed || ''
  const rows = []
  if (ct === 'residential_mao') {
    rows.push({ label: 'After-Repair Value (ARV)', value: money(c.arv), note: 'what the home sells for fully fixed up' })
    rows.push({ label: `× ${Math.round((c.maoFactor ?? 0.7) * 100)}% investor rule`, value: money(c.step1) })
    rows.push({ label: `− ${money(c.wholesaleFee)} assignment / wholesale fee`, value: money(c.step2) })
    rows.push({ label: `− ${money(c.rehab)} estimated repairs`, value: money(c.maxOffer), note: 'Wholesale Offer — the most an investor pays' })
    return rows
  }
  if (ct === 'residential_dscr') {
    rows.push({ label: 'Net Operating Income (NOI)', value: money(c.annualNOI) })
    rows.push({ label: 'Supported purchase price', value: money(c.purchase) })
    rows.push({ label: 'Bank loan (80% LTV)', value: money(c.loan) })
    rows.push({ label: 'Debt-service coverage (DSCR)', value: c.dscr != null ? Number(c.dscr).toFixed(2) : '—', note: 'target ≥ 1.25' })
    rows.push({ label: 'Annual cash flow (pocket)', value: money(c.pocketCashAnnual) })
    return rows
  }
  // Generic fallback — humanize the known numeric fields, skip the rest.
  const LABELS = {
    noi: 'NOI', maxPurchase: 'Max purchase', yourOffer: 'Your offer', maxOffer: 'Max offer',
    arv: 'ARV', rehab: 'Estimated repairs', gross: 'Gross income', expenses: 'Expenses',
    bankLoan: 'Bank loan', annualDS: 'Annual debt service', actualDSCR: 'DSCR', capRate: 'Cap rate'
  }
  for (const [k, v] of Object.entries(c)) {
    if (typeof v !== 'number' || !LABELS[k]) continue
    rows.push({ label: LABELS[k], value: /dscr|caprate/i.test(k) ? Number(v).toFixed(2) : money(v) })
  }
  return rows
}

// Two-tier offer display: Retail (Listing / Market) vs Wholesale (Investor).
function OfferTiers({ tiers }) {
  return (
    <div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, margin: '10px 0 6px' }}>
        <div style={{ background: '#eaf2ff', border: '1px solid #b9cdf0', borderRadius: 8, padding: '10px 12px' }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: '#1E2A45' }}>{tiers.retailLabel}</div>
          <div style={{ fontSize: 24, fontWeight: 800, color: '#0A0F2C' }}>{tiers.retail != null ? money(tiers.retail) : '—'}</div>
          <div style={srcStyle}>{tiers.retailSrc}</div>
        </div>
        <div style={{ background: '#fff4e0', border: '1px solid #e3c685', borderRadius: 8, padding: '10px 12px' }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: '#1E2A45' }}>{tiers.wholesaleLabel}</div>
          <div style={{ fontSize: 24, fontWeight: 800, color: '#9a6700' }}>{tiers.wholesale != null ? money(tiers.wholesale) : '—'}</div>
          <div style={srcStyle}>{tiers.wholesale != null ? tiers.wholesaleSrc : 'Not applicable for this hold / rental analysis'}</div>
        </div>
      </div>
      <p style={{ ...srcStyle, margin: '0 0 4px' }}>{tiers.note}</p>
    </div>
  )
}

// Two independent comp sources side by side: RentCast (licensed MLS/public-record)
// and Web (Zillow/Realtor estimate read live via Firecrawl). Lets the operator
// triangulate instead of trusting a single number.
function TwoCompSources({ primary, secondary }) {
  const nice = (s) => ({
    rentcast_sale_avm: 'RentCast (MLS + public records)',
    firecrawl_zillow: 'Zillow Zestimate (web)',
    firecrawl_realtor: 'Realtor.com estimate (web)',
    firecrawl_web: 'Web estimate'
  }[s] || s || 'source')
  const p = (primary && primary.value != null) ? primary.value : null
  const s = (secondary && secondary.value != null) ? secondary.value : null
  const spread = (p && s) ? Math.round((Math.abs(p - s) / ((p + s) / 2)) * 100) : null
  return (
    <div style={{ margin: '8px 0' }}>
      <div style={{ fontSize: 12, fontWeight: 700, color: '#1E2A45', marginBottom: 4 }}>Two comp sources</div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
        <div style={{ background: '#f1f6ff', border: '1px solid #c4d6f2', borderRadius: 6, padding: '8px 10px' }}>
          <div style={{ fontSize: 11, color: '#6b7280' }}>Source 1 · {nice(primary?.source)}</div>
          <div style={{ fontSize: 18, fontWeight: 800 }}>{p != null ? money(p) : '—'}</div>
        </div>
        <div style={{ background: '#f4fbf4', border: '1px solid #bfe0bf', borderRadius: 6, padding: '8px 10px' }}>
          <div style={{ fontSize: 11, color: '#6b7280' }}>Source 2 · {s != null ? nice(secondary?.source) : 'Web (Zillow/Realtor)'}</div>
          <div style={{ fontSize: 18, fontWeight: 800 }}>{s != null ? money(s) : '—'}</div>
          {secondary?.sites?.length > 0 && (
            <div style={srcStyle}>
              {secondary.sites.map((x, i) => (
                <span key={i}>{x.site}: {x.value != null ? money(x.value) : (x.stub ? 'off' : '—')}{i < secondary.sites.length - 1 ? ' · ' : ''}</span>
              ))}
            </div>
          )}
        </div>
      </div>
      <p style={{ ...srcStyle, margin: '4px 0 0' }}>
        {spread != null
          ? `The two sources are ${spread}% apart${spread <= 8 ? ' — tight agreement, confidence is good.' : spread <= 20 ? ' — moderate gap, sanity-check before relying on either.' : ' — wide gap, verify the address matched on both.'}`
          : (s == null ? 'Second (web) source returned no estimate for this address — Zillow/Realtor may not have a page for it, or Firecrawl is off.' : 'Only one source returned a value.')}
      </p>
    </div>
  )
}

// The actual comparable sales behind the AVM — the PROOF. Shows the subject
// property up top, then each comp with address (clickable), beds/baths/sqft,
// price and distance. Mismatched beds/baths/sqft are flagged so you can catch a
// 2-bed subject being valued off 4-bed comps.
function CompEvidence({ subject, comps }) {
  if (!comps || !comps.length) {
    return (
      <p style={{ ...srcStyle, marginTop: 6 }}>
        No individual comparable sales were returned for this address{subject ? '' : ''} — the AVM value above is the provider’s estimate without a comp list (often the case for unique or rural properties). Treat the number as lower-confidence.
      </p>
    )
  }
  const s = subject || {}
  const mism = (a, b) => (a != null && b != null && Number(a) !== Number(b))
  const sqftOff = (cs) => (s.sqft && cs && Math.abs(cs - s.sqft) / s.sqft > 0.25) // >25% sqft gap
  const th = { padding: '6px 8px', background: '#0A0F2C', color: '#fff', fontSize: 11, textAlign: 'right', whiteSpace: 'nowrap' }
  const td = { padding: '6px 8px', fontSize: 12, textAlign: 'right', borderBottom: '1px solid #eef1f7', whiteSpace: 'nowrap' }
  const warn = { color: '#B23030', fontWeight: 700 }
  return (
    <div style={{ marginTop: 10 }}>
      <div style={{ fontSize: 12, fontWeight: 700, color: '#1E2A45', marginBottom: 4 }}>
        How the AVM got here — {comps.length} comparable sale{comps.length === 1 ? '' : 's'}
      </div>
      <div style={{ background: '#eef3fb', border: '1px solid #c4d6f2', borderRadius: 6, padding: '6px 10px', marginBottom: 6, fontSize: 12 }}>
        <b>Subject:</b> {s.address || '—'} · {s.beds != null ? `${s.beds} bd` : 'beds ?'} · {s.baths != null ? `${s.baths} ba` : 'baths ?'} · {s.sqft != null ? `${Number(s.sqft).toLocaleString()} sf` : 'sqft ?'}{s.year_built ? ` · built ${s.year_built}` : ''}
        {(s.beds == null || s.sqft == null) && <span style={{ ...srcStyle, color: '#C8851A' }}> — enter beds/baths/sqft above for a sharper comp match.</span>}
      </div>
      <div style={{ overflowX: 'auto' }}>
        <table style={{ borderCollapse: 'collapse', width: '100%', minWidth: 640 }}>
          <thead><tr>
            {['Address', 'Beds', 'Baths', 'SqFt', 'Sale/List $', 'Dist (mi)', 'Age (d)'].map((h, i) => (
              <th key={i} style={{ ...th, textAlign: i === 0 ? 'left' : 'right' }}>{h}</th>
            ))}
          </tr></thead>
          <tbody>
            {comps.map((c, i) => (
              <tr key={i} style={{ background: i % 2 ? '#f7f9fd' : '#fff' }}>
                <td style={{ ...td, textAlign: 'left' }}>
                  {c.link ? <a href={c.link} target="_blank" rel="noreferrer" style={{ color: '#1E2A45' }}>{c.address || '—'}</a> : (c.address || '—')}
                </td>
                <td style={{ ...td, ...(mism(c.beds, s.beds) ? warn : {}) }}>{c.beds ?? '—'}</td>
                <td style={{ ...td, ...(mism(c.baths, s.baths) ? warn : {}) }}>{c.baths ?? '—'}</td>
                <td style={{ ...td, ...(sqftOff(c.sqft) ? warn : {}) }}>{c.sqft != null ? Number(c.sqft).toLocaleString() : '—'}</td>
                <td style={td}>{money(c.price)}</td>
                <td style={td}>{c.distance_mi ?? '—'}</td>
                <td style={td}>{c.days_old ?? '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p style={{ ...srcStyle, marginTop: 4 }}>
        Addresses link to their Zillow page. <span style={warn}>Red</span> = that comp differs from the subject (different bed/bath count, or sqft more than 25% off) — weigh those comps with caution. Source: RentCast (MLS + public records).
      </p>
    </div>
  )
}

// Embed the rei-rehab-calc SILO (not a copy). Lazy-loads on click so the deal's
// address + sqft are known when it opens, pre-fills the silo via URL params, and
// receives the rehab total back via postMessage → feeds the offer math.
function RehabEmbed({ mode, address, sqft, units, onResult }) {
  const [src, setSrc] = useState('')
  const build = () => {
    const siloMode = mode === 'storage' ? 'storage' : 'residential'
    const p = new URLSearchParams({ embed: '1', mode: siloMode })
    if (address) p.set('address', address)
    if (num(sqft)) p.set('sqft', String(num(sqft)))
    if (num(units)) p.set('units', String(num(units)))
    setSrc(`${REHAB_CALC_URL}/?${p.toString()}`)
  }
  useEffect(() => {
    function onMsg(e) {
      const d = e.data
      if (!d || d.type !== 'rei-rehab-total') return
      const breakdown = (d.lineItems || []).map(li => ({ id: li.id, label: li.label, condition: '', total: li.total }))
      onResult?.(Number(d.totalRehab) || 0, { breakdown, holdingCost: d.holdingCost, grandTotal: d.grandTotal, flatOverride: d.flatOverride })
    }
    window.addEventListener('message', onMsg)
    return () => window.removeEventListener('message', onMsg)
  }, [onResult])
  const btn = { padding: '8px 14px', fontSize: 13, fontWeight: 700, borderRadius: 6, border: '1px solid #0A0F2C', background: '#0A0F2C', color: '#C9A84C', cursor: 'pointer' }
  const isCommercial = mode === 'commercial'
  return (
    <div>
      {!src ? (
        <div>
          <button type="button" onClick={build} style={btn}>
            Open Rehab Calc{num(sqft) ? ` — uses this deal’s address & ${num(sqft).toLocaleString()} sf` : ' — enter sqft above for live line pricing'}
          </button>
          <p style={{ ...srcStyle, marginTop: 6 }}>
            This is the live Rehab Calc tool (its own silo) embedded here — the number you land on flows straight into the offer above. Or just use the flat-total box inside it.
          </p>
        </div>
      ) : (
        <>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6, gap: 8, flexWrap: 'wrap' }}>
            <span style={srcStyle}>Live Rehab Calc silo — your total feeds the offer automatically.</span>
            <button type="button" onClick={build} style={{ ...btn, padding: '5px 10px', fontSize: 12 }}>↻ Reload with current sqft</button>
          </div>
          {isCommercial && (
            <p style={{ ...srcStyle, color: '#C8851A', marginTop: 0 }}>
              Commercial line-items aren’t in the Rehab Calc silo yet (residential baseline shown) — use the flat-total box inside it for commercial rehab. Adding commercial lines to the silo is the next step.
            </p>
          )}
          <iframe title="Rehab Calc" src={src} style={{ width: '100%', height: 640, border: '1px solid #d4dae8', borderRadius: 8, background: '#fff' }} />
        </>
      )}
    </div>
  )
}

// Plain-English math rows (replaces the raw JSON dump).
function MathRows({ rows }) {
  if (!rows || !rows.length) return null
  return (
    <div style={{ display: 'grid', gap: 4, marginTop: 8 }}>
      {rows.map((row, i) => (
        <div key={i} style={{ display: 'flex', justifyContent: 'space-between', gap: 12, padding: '6px 10px', background: i % 2 ? '#f7f9fd' : '#fff', borderRadius: 6 }}>
          <span style={{ fontSize: 13, color: '#1E2A45' }}>{row.label}{row.note && <span style={srcStyle}> — {row.note}</span>}</span>
          <span style={{ fontSize: 14, fontWeight: 700, color: '#0A0F2C', whiteSpace: 'nowrap' }}>{row.value}</span>
        </div>
      ))}
    </div>
  )
}

// Transparent recommendation rule (presentation layer — not bible math).
function recommend({ asking, maxOffer, estValue, dscrPass, typeImplemented, hasMath, isIncome, compSeeded, seedNote, manualIncome }) {
  // Distinguish "no engine for this type" from "engine exists but we lack inputs".
  if (!typeImplemented) {
    return { verdict: 'INTAKE ONLY', basis: 'No analysis engine exists for this property type yet — data captured and saved.' }
  }
  if (!hasMath) {
    // If user entered income manually but math still failed, tell them to check their input.
    if (isIncome && manualIncome) {
      return { verdict: 'REVIEW', basis: 'Income was entered, but math could not complete. Check that Gross Income and Annual Operating Expenses are both filled and valid (numbers only, no text). If blank, enter a value or upload an OM / T-12 / rent roll.' }
    }
    return isIncome
      ? { verdict: 'NEEDS INCOME', basis: 'This asset type IS supported — it just needs income. Enter Gross Annual Income + Annual Operating Expenses above, or upload an OM / T-12 / rent roll, then re-run. Data captured and saved.' }
      : { verdict: 'REVIEW', basis: 'Not enough inputs to compute an offer; review captured data and add the missing fields.' }
  }
  const ask = num(asking)
  const offer = num(maxOffer) || num(estValue)
  if (!offer) return { verdict: 'REVIEW', basis: 'Not enough inputs to compute an offer; review captured data.' }
  // Comp-seeded from an address alone — a ballpark, NOT a verified offer. Never
  // promote to PURSUE/NEGOTIATE; the operator must confirm ARV/rehab (or rent).
  if (compSeeded) {
    const askBit = ask ? `Seller asking ${money(ask)}. ` : ''
    return { verdict: 'PRELIMINARY', basis: `Ballpark only — ${money(offer)} computed from comp data (${seedNote}). ${askBit}This is NOT an offer: confirm ARV and rehab (or rent) before relying on it.` }
  }
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

// ── Data Sources ledger — shows EVERY enrichment source and its honest status ──
const SRC_STATUS = {
  ok:      { color: '#2F7A40', bg: '#eaf6ed', label: 'LIVE' },
  no_data: { color: '#6b7280', bg: '#f1f3f7', label: 'NO DATA' },
  no_key:  { color: '#C8851A', bg: '#fff4e0', label: 'NEEDS KEY' },
  failed:  { color: '#B23030', bg: '#fdeaea', label: 'FAILED' }
}
function DataSources({ sources, counts }) {
  if (!sources || !sources.length) return null
  const order = { ok: 0, failed: 1, no_key: 2, no_data: 3 }
  const sorted = [...sources].sort((a, b) => (order[a.status] ?? 9) - (order[b.status] ?? 9))
  return (
    <div style={card}>
      <h3 style={h3}>Data Sources <span style={srcStyle}>(every service queried — nothing hidden)</span></h3>
      {counts && (
        <p style={{ fontSize: 13, margin: '0 0 8px' }}>
          <b style={{ color: '#2F7A40' }}>{counts.ok || 0} live</b> · {' '}
          <b style={{ color: '#B23030' }}>{counts.failed || 0} failed</b> · {' '}
          <b style={{ color: '#C8851A' }}>{counts.no_key || 0} need a key</b> · {' '}
          <span style={{ color: '#6b7280' }}>{counts.no_data || 0} no data</span>
        </p>
      )}
      <div style={{ display: 'grid', gap: 6 }}>
        {sorted.map((s, i) => {
          const st = SRC_STATUS[s.status] || SRC_STATUS.no_data
          return (
            <div key={i} style={{ display: 'grid', gridTemplateColumns: '92px 1fr', gap: 8, alignItems: 'start', padding: '6px 8px', background: i % 2 ? '#f7f9fd' : '#fff', borderRadius: 6 }}>
              <span style={{ fontSize: 11, fontWeight: 700, color: st.color, background: st.bg, border: `1px solid ${st.color}`, borderRadius: 4, padding: '2px 6px', textAlign: 'center' }}>{st.label}</span>
              <div>
                <div style={{ fontSize: 13, fontWeight: 600, color: '#0A0F2C' }}>{s.label}</div>
                <div style={{ fontSize: 12, color: '#1E2A45' }}>{s.summary || s.reason || '—'}</div>
                {s.status === 'no_key' && s.env_var && <div style={srcStyle}>Activate by setting {s.env_var} on rei-data-enrichment.</div>}
              </div>
            </div>
          )
        })}
      </div>
      <p style={srcStyle}>LIVE = real data used · NEEDS KEY = provider not yet activated · FAILED = lookup errored (treat as unverified) · NO DATA = source had nothing for this address.</p>
    </div>
  )
}

// ── SECTION 1: Executive Summary (income assets) ──
function ExecutiveSummary({ r }) {
  const s = r.matrix.summary
  const ex = r.extracted
  return (
    <div style={{ ...card, borderLeft: '6px solid #C9A84C' }}>
      <h3 style={h3}>Executive Summary — The Answer</h3>
      <OfferTiers tiers={offerTiers(r)} />
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
        <Val label="NOI Used" value={money(s.noi)} source={r.noiBasis || 'Calculated'} />
        <Val label="Asset Type" value={r.propertyType} source="User selection" />
        <Val label="Conservative Value (1.25 DSCR)" value={money(s.conservativeValue)} source="Math Bible — bank-only @1.25" />
        <Val label="Aggressive Value (1.15 DSCR)" value={money(s.aggressiveValue)} source="Math Bible — bank-only @1.15" />
        <Val label="Best Seller-Finance Value" value={money(s.bestSellerFinanceValue)} source="Math Bible — $100k + seller structure" />
        {s.capMultipleValue != null && <Val label={`Cap-Multiplier Value (NOI × ${s.capMultiple})`} value={money(s.capMultipleValue)} source="Latest auto-offer method (RV ×13 / IOS ×14)" />}
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

// Each property type with an OPTIONAL deeper manual underwriter maps here. The
// guided analyzer is always the main screen; these mount in a collapsed
// "Advanced — manual scenario underwriting" section below the result (you hand-
// enter every financing scenario yourself). Land has no guided offer engine, so
// for land this component IS the main screen. Same Math Bible engines (src/math/*).
const DEEP_COMPONENT = {
  self_storage: { Comp: StorageTab,    label: 'Self Storage',  extras: 'Group A/B/C scenarios, ramp & sunset tests, 5-yr kicker, equity/cash-to-close detail' },
  residential:  { Comp: ResidentialTab, label: 'Residential',  extras: '3-card pad stack, Owner Hard Mode, comps-based ARV percentile, alt exit strategies' },
  mhp_rv:       { Comp: MhpTab,         label: 'MHP / RV Park', extras: '3 vacancy scenarios, utility-responsibility matrix, lot-count validation, per-lot economics' },
  commercial:   { Comp: CommercialTab,  label: 'Commercial',    extras: 'full rent roll, tenant concentration, WALT + rollover, subclass warnings, TI/LC reserves' },
  mixed_use:    { Comp: MixedUseTab,    label: 'Mixed Use',     extras: 'per-component valuation + illiquidity discount' },
  ios_land:     { Comp: LandTab,        label: 'Land / IOS',    extras: '40-field intake, zoning review, 10-risk matrix, unit-price metrics, LOI terms' }
}

// Human-readable engine route for the status line. Confidence/debug only — it
// never changes any math; it just names which Bible engine is running.
function engineRoute(typeId) {
  if (typeId === 'ios_land') return 'Land / IOS · land.js supported-intake (no offer engine)'
  if (isIncomeAsset(typeId)) return `${getType(typeId)?.label || typeId} · income financing matrix (incomeMatrix.js) + docs/photos/comps`
  if (typeId === 'residential') return 'Residential · /api/calc residential_mao / residential_dscr + docs/photos/comps'
  if (typeId === 'multifamily_small') return 'Multifamily 5–19 · /api/calc multifamily_small (agency 80/20 · 7%/30yr)'
  if (typeId === 'multifamily_large') return 'Multifamily 20+ · income financing matrix (75/25 · 7.25%/25yr)'
  return getType(typeId)?.label || typeId
}

// Always-visible status line — tells the operator exactly which engine is running.
function StatusLine({ typeId, portfolio }) {
  const t = getType(typeId)
  return (
    <div className="no-print" style={{ marginTop: 16, padding: '8px 12px', background: '#0A0F2C', color: '#cdd6ec', borderRadius: 8, fontSize: 12, lineHeight: 1.6 }}>
      <b style={{ color: '#C9A84C' }}>Engine status</b> · Deal type: <b style={{ color: '#fff' }}>{t?.label || typeId}{portfolio ? ' (Portfolio)' : ''}</b>
      {' · '}Route: <span style={{ color: '#fff' }}>{portfolio ? 'Portfolio — per-building + pooled through this type’s engine' : engineRoute(typeId)}</span>
      {' · '}Math Bible v3.1 · App v{VERSION}
    </div>
  )
}

export default function AnalyzeDealTab({ sharedUrlState, deepUrlState }) {
  const [typeId, setTypeId] = useState('residential')
  const [mode, setMode] = useState('flip')
  const [advancedOpen, setAdvancedOpen] = useState(false)
  const [portfolio, setPortfolio] = useState(false)
  const [rehabCondition, setRehabCondition] = useState(0) // manual condition → rehab $ (your numbers)
  const [rehabDetail, setRehabDetail] = useState(null)    // { national: {area, psf, tier, total}, ... }
  const [fields, setFields] = useState({ address: '', city: '', state: '', zip: '' })
  const [docs, setDocs] = useState([])
  const [photos, setPhotos] = useState([])
  const [pastedText, setPastedText] = useState('') // dump an agent email / notes here
  const [phase, setPhase] = useState('idle')
  const [step, setStep] = useState('')
  const [error, setError] = useState(null)
  const [result, setResult] = useState(null)

  // NOTE: Removed auto-clear on typeId change — was potentially interfering with form state updates
  // User can manually select new type, form keeps old values (user can delete if needed)

  const type = getType(typeId)
  const isPortfolio = portfolio && typeId !== 'ios_land'
  const deep = DEEP_COMPONENT[typeId]
  const DeepComp = deep?.Comp
  // Land has NO guided offer engine — its dedicated intake IS the main screen.
  const isLand = typeId === 'ios_land'
  // URL slice handed to the inline deep underwriter (storage/residential carry
  // their own URL schema; other deep tools ignore it).
  const deepUrl = typeId === 'self_storage' ? deepUrlState?.storage
    : typeId === 'residential' ? deepUrlState?.residential
      : null
  const activeFields = (type.fields || []).filter(f => !f.modes || f.modes.includes(mode))
  const set = (k, v) => setFields(p => ({ ...p, [k]: v }))
  // Rehab is the rei-rehab-calc SILO, embedded (see RehabEmbed) — not a copy here.
  const rehabMode = REHAB_MODE[typeId] || 'residential'
  const showRehab = true // every property type & mode shows the rehab questions (per Steve)

  async function analyze() {
    setError(null); setResult(null)
    if (!fields.address) { setError('Enter a property address.'); return }

    // DIAGNOSTIC: If user selected income asset but no income in state, tell them exactly what we're seeing
    if (isIncomeAsset(typeId) && !num(fields.grossIncome) && !num(fields.expenses) && !num(fields.noi)) {
      setError(`DIAGNOSTIC: Selected ${getType(typeId).label} but no income found in form state. Form shows income but state is empty. This is a form-state sync bug. Fields in state: ${JSON.stringify(fields)}`)
      return
    }

    setPhase('running')
    try {
      // 1) Orchestrate: store uploads + call extractor / photo / comps server-side.
      const fd = new FormData()
      docs.forEach(f => fd.append('docs', f))
      // Pasted agent email / notes ride the SAME proven extraction path as an
      // uploaded document — wrapped as a .txt "file" and read by the Claude
      // extractor. It only fills gaps; anything you typed in the form wins.
      const pasted = pastedText.trim()
      if (pasted) fd.append('docs', new Blob([pasted], { type: 'text/plain' }), 'pasted-notes.txt')
      photos.forEach(f => fd.append('photos', f))
      fd.append('meta', JSON.stringify({
        propertyType: typeId, address: fields.address, city: fields.city, state: fields.state, zip: fields.zip,
        beds: fields.beds, baths: fields.baths, sqft: fields.sqft, dealType: mode,
        // Form field values (income-property + residential fields) — MUST be sent to calc engine
        askingPrice: fields.askingPrice, arv: fields.arv, rehab: fields.rehab,
        grossIncome: fields.grossIncome, expenses: fields.expenses, expenseRatio: fields.expenseRatio,
        totalUnits: fields.totalUnits, climateUnits: fields.climateUnits, netRentableSqft: fields.netRentableSqft,
        occupancy: fields.occupancy, units: fields.units, noi: fields.noi,
        purchase: fields.purchase, capRate: fields.capRate, yearBuilt: fields.yearBuilt, stories: fields.stories,
        // MHP-specific
        lots: fields.lots, lotRent: fields.lotRent, pohUnits: fields.pohUnits, pohRent: fields.pohRent,
        // RV Park / IOS-specific
        sites: fields.sites, siteRent: fields.siteRent, acres: fields.acres,
        // Commercial-specific
        leasableSqft: fields.leasableSqft
      }))
      const work = []
      const docCount = docs.length + (pasted ? 1 : 0)
      if (docCount) work.push(`extracting ${docCount} document(s)${pasted ? ' (incl. pasted notes)' : ''}`)
      if (photos.length) work.push(`analyzing ${photos.length} photo(s)`)
      work.push('pulling comps')
      setStep(`Working: ${work.join(', ')}… this can take 20–60s for documents/photos (AI reading).`)
      const orch = await postForJson('/api/analyze-deal', { method: 'POST', body: fd }, 'Analyze')

      const extractedNorm = pullExtracted(orch.extracted)

      // Auto-populate form from extracted data (address, city, state, zip)
      if (extractedNorm) {
        setFields(prev => ({
          ...prev,
          address: prev.address || extractedNorm.address || '',
          city: prev.city || extractedNorm.address?.split(',')[1]?.trim() || '',
          state: prev.state || extractedNorm.state || '',
          zip: prev.zip || extractedNorm.zip || ''
        }))
      }

      // Auto-detect asset type from extracted data and set typeId.
      // Matches extractor asset_type to Baby Analyzer PROPERTY_TYPES.
      if (extractedNorm && extractedNorm.assetType) {
        const detected = String(extractedNorm.assetType).toLowerCase().trim()
        // Check for mixed-use indicators first
        const multipleAssets = (
          (detected.includes('storage') && detected.includes('residential')) ||
          (detected.includes('storage') && detected.includes('commercial')) ||
          (detected.includes('commercial') && detected.includes('residential')) ||
          (detected.includes('mhp') && detected.includes('retail')) ||
          detected.includes('mixed') ||
          detected.includes('blend')
        )
        if (multipleAssets) {
          setTypeId('mixed_use')
        } else {
          // Single-asset mapping
          const mapping = {
            'residential': 'residential',
            'single family': 'residential',
            'single-family': 'residential',
            'sf': 'residential',
            'storage': 'self_storage',
            'self storage': 'self_storage',
            'self-storage': 'self_storage',
            'selfstorage': 'self_storage',
            'multifamily': 'multifamily_small', // default to small; refined by unit count if available
            'mf': 'multifamily_small',
            'apartment': 'multifamily_small',
            'commercial': 'commercial',
            'retail': 'commercial',
            'office': 'commercial',
            'warehouse': 'commercial',
            'mhp': 'mhp_rv',
            'mobile home park': 'mhp_rv',
            'mobile-home-park': 'mhp_rv',
            'rv park': 'rv_park',
            'rv-park': 'rv_park',
            'rvpark': 'rv_park',
            'ios': 'ios',
            'industrial outdoor storage': 'ios',
            'land': 'ios_land'
          }
          const matched = mapping[detected] || null
          if (matched) {
            setTypeId(matched)
            // For multifamily, refine based on unit count
            if (matched === 'multifamily_small' && extractedNorm.units) {
              const units = num(extractedNorm.units)
              if (units >= 20) setTypeId('multifamily_large')
            }
          }
        }
      }

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

      // 2) Compute headline via existing bible math (/api/calc). User fields win; extracted fills gaps.
      // CRITICAL: calcFields must include manual form values even if extraction fails.
      // Line 792 ensures this: calcFields = {...fields} copies the form state BEFORE extraction fallback.
      const calcFields = { ...fields }
      // Only merge extracted data into gaps — never overwrite manual user entry.
      if (extractedNorm) {
        if (!num(calcFields.noi) && extractedNorm.brokerNOI) calcFields.noi = extractedNorm.brokerNOI
        if (!num(calcFields.grossIncome) && extractedNorm.grossIncome) calcFields.grossIncome = extractedNorm.grossIncome
        if (!num(calcFields.expenses) && extractedNorm.expenses) calcFields.expenses = extractedNorm.expenses
        if (!num(calcFields.askingPrice) && extractedNorm.asking) calcFields.askingPrice = extractedNorm.asking
      }
      // Comp-seed: with only an address (no ARV / rent typed), seed the offer math
      // from the comp AVM so the operator still gets a PRELIMINARY ballpark instead
      // of a dead "REVIEW". Clearly flagged downstream — never promoted to a real
      // PURSUE/NEGOTIATE verdict. Flip rehab is assumed $0 unless square footage is
      // known (then a medium national benchmark), until the operator confirms.
      const avm = orch.comps?.avm || null
      const compSeed = { arv: false, rent: false, purchase: false, rehab: false }
      if (avm && typeId === 'residential' && !isIncomeAsset(typeId)) {
        if (mode === 'flip' && !num(calcFields.arv) && num(avm.value) > 0) {
          calcFields.arv = avm.value; compSeed.arv = true
          // DO NOT auto-seed rehab from national benchmark. Rehab must come from:
          // 1. User manual entry, OR
          // 2. Condition answers from the rehab tool
          // National benchmarks can be wildly inaccurate for low-value markets
          // (e.g., $49k rehab on a $63k house = negative offer).
        }
        if (mode === 'rental') {
          if (!num(calcFields.grossIncome) && num(avm.rent_estimate) > 0) {
            calcFields.grossIncome = Math.round(num(avm.rent_estimate) * 12); compSeed.rent = true
          }
          if (!num(calcFields.purchase) && !num(calcFields.askingPrice) && num(avm.value) > 0) {
            calcFields.purchase = avm.value; compSeed.purchase = true
          }
        }
      }
      const seedBits = []
      if (compSeed.arv) seedBits.push(`ARV seeded from ${avm.source || 'AVM'} ${money(avm.value)}, ${compSeed.rehab ? `rehab at national benchmark ${money(calcFields.rehab)} (${num(calcFields.sqft)} sf × medium)` : 'rehab assumed $0'}`)
      if (compSeed.rent) seedBits.push(`rent seeded from ${avm.source || 'AVM'} ${money(avm.rent_estimate)}/mo`)
      if (compSeed.purchase) seedBits.push(`purchase seeded from AVM ${money(avm.value)}`)
      const compSeeded = seedBits.length > 0
      const seedNote = seedBits.join('; ')
      // Condition-based rehab (from the embedded Rehab Calc) feeds the flip MAO when
      // the operator didn't type a manual rehab number.
      if (showRehab && !num(calcFields.rehab) && rehabCondition > 0) calcFields.rehab = rehabCondition
      setStep('Running Math Bible analysis…')
      let calc = null, head = {}, calcTypeUsed = null, matrix = null, noiBasis = null

      // ── FORCED: If user entered income, compute it. No conditions. ──
      // READ DIRECTLY FROM FORM STATE AS FALLBACK (defensive)
      const grossN = num(calcFields.grossIncome || fields.grossIncome)
      const expDollars = num(calcFields.expenses || fields.expenses)
      const expRatio = num(calcFields.expenseRatio || fields.expenseRatio)
      let matrixNOI = num(calcFields.noi || fields.noi)

      // If no explicit NOI but user entered income, compute it
      if (!matrixNOI && grossN > 0) {
        if (expDollars > 0) {
          // Income - Expenses, respecting type-specific rules
          if (typeId === 'self_storage') {
            const sn = storageNOI(grossN, Math.min(0.95, expDollars / grossN))
            matrixNOI = sn.noi
            noiBasis = sn.floorBinds
              ? `Gross $${grossN.toLocaleString()} − expenses (35% floor)`
              : `Gross $${grossN.toLocaleString()} − $${expDollars.toLocaleString()} expenses`
          } else {
            matrixNOI = Math.max(0, Math.round(grossN - expDollars))
            noiBasis = `$${grossN.toLocaleString()} − $${expDollars.toLocaleString()} = NOI`
          }
        } else if (expRatio > 0) {
          // Income × (1 - ratio)
          const ratio = expRatio / 100
          matrixNOI = typeId === 'self_storage'
            ? storageNOI(grossN, ratio).noi
            : Math.round(grossN * (1 - Math.min(ratio, 0.95)))
          noiBasis = `$${grossN.toLocaleString()} × (1 − ${expRatio}%)`
        } else {
          // Income only: assume 35% (storage) or 40% (other)
          const ratio = typeId === 'self_storage' ? 0.35 : 0.40
          matrixNOI = Math.round(grossN * (1 - ratio))
          noiBasis = `$${grossN.toLocaleString()} × (1 − ${Math.round(ratio * 100)}% assumed)`
        }
      }

      // Build matrix if NOI exists (from manual entry OR from calculation above)
      if (matrixNOI > 0) {
        try {
          const assetTypeForMatrix = isIncomeAsset(typeId) ? typeId : 'self_storage'
          matrix = buildIncomeMatrix({ assetType: assetTypeForMatrix, noi: matrixNOI })
          calcTypeUsed = 'Math Bible income engine (financing matrix)'
          head = {
            noiUsed: matrixNOI,
            estValue: matrix.summary.aggressiveValue,
            maxOffer: matrix.summary.conservativeValue,
            dscr: 1.25
          }
        } catch (e) {
          setError(`Matrix calculation failed: ${e?.message || e}`)
          setPhase('')
          return
        }
      }

      // Non-income assets (residential flip/rental, land, etc)
      if (!matrix) {
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
      // READ DIRECTLY FROM FORM STATE AS FALLBACK (defensive)
      const manualIncome = num(fields.grossIncome) > 0 || num(fields.expenses) > 0 || num(fields.expenseRatio) > 0
      const rec = recommend({
        asking: calcFields.askingPrice, maxOffer: head.maxOffer, estValue: head.estValue,
        dscrPass: head.dscrPass, typeImplemented: type.implemented, hasMath,
        isIncome: isIncomeAsset(typeId), compSeeded, seedNote, manualIncome
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

      // Data Reconciliation: compare manual vs extracted for all income/asset fields
      const reconcile = (fieldKey, label) => {
        const manual = fields[fieldKey]
        const fromExtract = extractedNorm?.[fieldKey]
        const numManual = num(manual)
        const numExtract = num(fromExtract)
        const used = num(calcFields[fieldKey]) || numManual || numExtract
        const conflict = numManual > 0 && numExtract > 0 && Math.abs(numManual - numExtract) > (numManual * 0.05) // >5% difference
        return {
          field: fieldKey,
          label,
          manual: numManual > 0 ? numManual : null,
          extracted: numExtract > 0 ? numExtract : null,
          used,
          source: numManual > 0 ? 'User-entered' : numExtract > 0 ? 'Extracted from document' : 'Not provided',
          conflict: conflict ? `Manual ${numManual.toLocaleString()} vs Extracted ${numExtract.toLocaleString()}` : null
        }
      }

      const dataReconciliation = [
        reconcile('grossIncome', 'Gross Annual Income'),
        reconcile('expenses', 'Annual Operating Expenses'),
        reconcile('noi', 'Net Operating Income'),
        reconcile('occupancy', 'Physical Occupancy %'),
        reconcile('askingPrice', 'Seller Asking Price')
      ]

      const report = {
        generatedAt: new Date().toISOString(),
        tool: 'baby-analyzer',
        propertyType: type.label, mode: type.subModes ? mode : null,
        assetTypeId: typeId, typeId,
        address: fields.address,
        isIncome: isIncomeAsset(typeId),
        implemented: type.implemented && hasMath,
        inputs: fields, fields,
        extracted: extractedNorm, extractedRaw: orch.extracted, extractorError,
        dataReconciliation,
        comps: orch.comps, photos: orch.photos, photoRes,
        risk: orch.risk,
        calc, calcTypeUsed, headline: head, matrix, noiBasis,
        recommendation: rec, compSeeded, seedNote,
        brokerNOI, calcNOI, noiDelta,
        // Rehab grid: human/manual condition vs photo-read (pic-rehab), each priced
        // your-numbers AND national-average.
        rehabCondition: showRehab ? rehabCondition : null,           // human · your numbers
        rehabConditionNational: showRehab ? (rehabDetail?.national?.total ?? null) : null, // human · national
        rehabPhoto: photoRes?.rehab_estimate_mid ?? null,            // photo · pic-rehab (your-ish)
        rehabPhotoNational: (showRehab && rehabDetail?.national?.area && photoRes?.overall_condition_tier)
          ? Math.round(rehabDetail.national.area * (NATIONAL_PSF[toBenchmarkTier(photoRes.overall_condition_tier)] ?? 0) * REGIONAL_ADJ)
          : null,
        rehabBreakdown: showRehab ? (rehabDetail?.breakdown ?? null) : null,  // human per-line
        rehabPhotoTiers: photoRes?.per_system_tiers ?? null,                   // photo per-system
        rehabUsed: num(calcFields.rehab) || null,
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
      <div style={{ ...card, background: '#fef3c7', border: '2px solid #f59e0b', marginBottom: 16 }} className="no-print">
        <h3 style={{ ...h3, color: '#78350f', marginBottom: 8 }}>🔀 Mixed-Use Property?</h3>
        <p style={{ margin: '0 0 8px', fontSize: 14, color: '#92400e', lineHeight: 1.6 }}>
          If this property has <strong>multiple asset types</strong> (storage + residential, commercial + storage, MHP + retail, etc), select <strong>"Mixed Use"</strong> below to enter each component separately with its own NOI and cap rate.
        </p>
        <p style={{ margin: 0, fontSize: 13, color: '#b45309', fontStyle: 'italic' }}>
          Alternatively: run each asset type through its own single-asset tab first to get the NOI, then bring those numbers to the Mixed Use section.
        </p>
      </div>

      <div style={card} className="no-print">
        <h3 style={h3}>1 · Property Type</h3>
        <select aria-label="Property type" style={inp} value={typeId} onChange={e => { setTypeId(e.target.value); const t = getType(e.target.value); if (t.subModes) setMode(t.subModes[0].id) }}>
          {PROPERTY_TYPES.map(t => <option key={t.id} value={t.id}>{t.label}</option>)}
        </select>
        {!isLand && (
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 10, fontSize: 13, fontWeight: 600, color: '#1E2A45', cursor: 'pointer' }}>
            <input type="checkbox" checked={portfolio} onChange={e => setPortfolio(e.target.checked)} />
            Portfolio — analyze multiple buildings of this type on one sheet
          </label>
        )}
        {/* Flip / Rental etc. submodes (guided screen only). */}
        {type.subModes && !isLand && (
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
        {!type.implemented && !deep && !isPortfolio && <p style={{ color: '#C8851A', fontWeight: 600, marginTop: 8 }}>⚠ Supported intake — analysis module not yet implemented for this type.</p>}
      </div>

      {isPortfolio ? (
        <PortfolioSection assetType={typeId} />
      ) : isLand ? (
        // Land has no guided offer engine — the dedicated land intake IS the screen.
        <div className="no-print">
          <DeepComp sharedUrlState={sharedUrlState} rehab={rehabCondition} />
        </div>
      ) : (<>
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

      {showRehab && (
        <div style={card} className="no-print">
          <h3 style={h3}>3 · Property Condition → Rehab Estimate</h3>
          <RehabEmbed
            mode={rehabMode}
            address={fields.address}
            sqft={fields.sqft}
            units={fields.units}
            onResult={(total, detail) => {
              setRehabCondition(total)
              // National-average cross-check from the benchmark constant (a small
              // snapshot, not the rehab tool) so the report keeps that column.
              const area = num(fields.sqft) || 0
              const national = area > 0
                ? { area, psf: Math.round(NATIONAL_PSF.medium_rehab * REGIONAL_ADJ), total: Math.round(area * NATIONAL_PSF.medium_rehab * REGIONAL_ADJ), tier: 'medium' }
                : null
              setRehabDetail({ ...detail, national })
            }}
          />
        </div>
      )}

      <div style={card} className="no-print">
        <h3 style={h3}>{showRehab ? '4' : '3'} · Upload Documents & Photos</h3>
        <label style={lbl}>Documents (OM, rent roll, T12, financials) — sent to the extractor</label>
        <input type="file" multiple accept=".pdf,.doc,.docx,.xls,.xlsx,.csv,.txt" onChange={e => setDocs([...e.target.files])} />
        {docs.length > 0 && <div style={srcStyle}>{docs.length} document(s) attached</div>}
        <label style={lbl}>Photos — sent to the photo analyzer</label>
        <input type="file" multiple accept="image/*" onChange={e => setPhotos([...e.target.files])} />
        {photos.length > 0 && <div style={srcStyle}>{photos.length} photo(s) attached</div>}

        <label style={{ ...lbl, marginTop: 14 }}>Or paste an agent email / notes — dump the whole thing here</label>
        <textarea
          value={pastedText}
          onChange={e => setPastedText(e.target.value)}
          rows={6}
          placeholder={'Paste the email or notes your agent sent — address, price, beds/baths, condition, NOI, whatever they wrote. The AI reads it and fills the gaps. Anything you typed in the form above always wins.'}
          style={{ ...inp, resize: 'vertical', fontFamily: 'inherit', lineHeight: 1.45 }}
        />
        {pastedText.trim() && <div style={srcStyle}>{pastedText.trim().length.toLocaleString()} characters — will be read by the extractor on Analyze. Check the “Raw Extracted Data” panel to see exactly what it pulled.</div>}
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

      {/* Advanced — OPTIONAL manual scenario underwriter for this type. Collapsed
          by default so the guided analysis above stays the clear main path. */}
      {deep && (
        <details className="no-print" style={card} onToggle={e => setAdvancedOpen(e.currentTarget.open)}>
          <summary style={{ cursor: 'pointer', fontWeight: 700, color: '#0A0F2C' }}>
            Advanced — manual {deep.label} scenario underwriting (optional)
          </summary>
          <p style={{ ...srcStyle, margin: '6px 0 10px' }}>
            The guided analysis above is the normal path (documents, photos, comps + offer). Open this only to hand-enter every financing scenario yourself: {deep.extras}. Same Math Bible engine — nothing here changes the numbers above.
          </p>
          {advancedOpen && <DeepComp urlState={deepUrl} sharedUrlState={sharedUrlState} rehab={rehabCondition} />}
        </details>
      )}
      </>)}

      <StatusLine typeId={typeId} portfolio={isPortfolio} />
    </div>
  )
}

// ── Results view: 3 zones (Raw → Calculations → Recommendation) + supporting sections ──
function Results({ r }) {
  const ex = r.extracted
  const comps = r.comps
  const ph = r.photoRes
  const vColor = { PURSUE: '#2F7A40', NEGOTIATE: '#C8851A', WARNING: '#B23030', PASS: '#2F7A40', 'INTAKE ONLY': '#6b7280', 'NEEDS INCOME': '#C8851A', PRELIMINARY: '#5B3FA6', REVIEW: '#1E2A45' }[r.recommendation.verdict] || '#1E2A45'

  return (
    <div>
      {/* Verdict badge */}
      <div style={{ ...card, borderLeft: `6px solid ${vColor}` }}>
        <h3 style={h3}>Quick Recommendation</h3>
        <div style={{ fontSize: 26, fontWeight: 800, color: vColor }}>{r.recommendation.verdict}</div>
        <p style={{ margin: '4px 0' }}>{r.recommendation.basis}</p>
        {!r.matrix && (
          <>
            <OfferTiers tiers={offerTiers(r)} />
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginTop: 4 }}>
              <Val label="Seller Asking" value={money(r.inputs.askingPrice || ex?.asking)} source={r.inputs.askingPrice ? 'User input' : (ex?.asking ? 'Extracted document' : 'n/a')} />
              <Val label="DSCR" value={r.headline.dscr != null ? Number(r.headline.dscr).toFixed(2) : '—'} source="Baby Analyzer calculation" />
            </div>
          </>
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

      {/* DEAL EVALUATOR — Risk Analysis */}
      {r.risk && (
        <div style={card}>
          <h3 style={h3}>Deal Evaluator — Risk Analysis</h3>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 }}>
            <div style={{ padding: '12px 14px', background: '#f0f7ff', border: '1px solid #b9cdf0', borderRadius: 8 }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: '#1E2A45', marginBottom: 4 }}>Risk Rating</div>
              <div style={{ fontSize: 22, fontWeight: 800, color: r.risk.riskRating === 'High' ? '#B23030' : r.risk.riskRating === 'Elevated' ? '#C8851A' : '#2F7A40' }}>{r.risk.riskRating}</div>
              <div style={srcStyle}>Confidence: {r.risk.confidence}</div>
            </div>
            <div style={{ padding: '12px 14px', background: '#fff4e0', border: '1px solid #e3c685', borderRadius: 8 }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: '#1E2A45', marginBottom: 4 }}>Red Flags Found</div>
              <div style={{ fontSize: 22, fontWeight: 800, color: '#9a6700' }}>{r.risk.redFlagsCount}</div>
              <div style={srcStyle}>Issues to review</div>
            </div>
          </div>
          {r.risk.topRedFlags && r.risk.topRedFlags.length > 0 && (
            <div style={{ marginBottom: 12 }}>
              <b style={{ color: '#B23030', fontSize: 14 }}>Top Red Flags:</b>
              <ul style={{ margin: '6px 0 0', fontSize: 13, paddingLeft: 20 }}>
                {r.risk.topRedFlags.map((flag, i) => (
                  <li key={i} style={{ marginBottom: 6, color: '#1E2A45' }}>
                    <strong>{flag.category}</strong> ({flag.severity}): {flag.message}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {r.risk.topPositives && r.risk.topPositives.length > 0 && (
            <div>
              <b style={{ color: '#2F7A40', fontSize: 14 }}>Positive Indicators:</b>
              <ul style={{ margin: '6px 0 0', fontSize: 13, paddingLeft: 20 }}>
                {r.risk.topPositives.map((pos, i) => <li key={i} style={{ marginBottom: 4, color: '#1E2A45' }}>{pos}</li>)}
              </ul>
            </div>
          )}
          {r.risk.documentationStatus && (
            <div style={{ marginTop: 12, paddingTop: 12, borderTop: '1px solid #d4dae8' }}>
              <b style={{ fontSize: 13, color: '#1E2A45' }}>Documentation Status:</b>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginTop: 8 }}>
                <div>
                  <span style={{ fontSize: 12, color: '#6b7280' }}>Received:</span>
                  <div style={{ fontSize: 13, color: '#2F7A40' }}>{r.risk.documentationStatus.received?.length > 0 ? r.risk.documentationStatus.received.join(', ') : 'None'}</div>
                </div>
                <div>
                  <span style={{ fontSize: 12, color: '#6b7280' }}>Missing:</span>
                  <div style={{ fontSize: 13, color: '#C8851A' }}>{r.risk.documentationStatus.missing?.length > 0 ? r.risk.documentationStatus.missing.join(', ') : 'None'}</div>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* SIDE-BY-SIDE RESULTS COMPARISON — Manual vs Extracted */}
      {r && r.fields && r.extracted && (
        <div style={card}>
          <h3 style={h3}>Analysis: Manual vs Extracted — Side-by-Side Results</h3>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20, marginBottom: 16 }}>
            {/* MANUAL SCENARIO */}
            <div style={{ border: '1px solid #d4dae8', borderRadius: 6, padding: 12, background: '#fafbfc' }}>
              <h4 style={{ margin: '0 0 12px', color: '#0A0F2C', fontWeight: 700 }}>📝 MANUAL ENTRY (What You Typed)</h4>
              <div style={{ fontSize: 13, lineHeight: 1.8 }}>
                {r.fields.grossIncome ? <div><strong>Income:</strong> {money(r.fields.grossIncome)}</div> : null}
                {r.fields.expenses ? <div><strong>Expenses:</strong> {money(r.fields.expenses)}</div> : null}
                {r.headline?.noiUsed != null ? <div style={{ marginTop: 8, paddingTop: 8, borderTop: '1px solid #e5e7eb' }}><strong>NOI Result:</strong> <span style={{ color: '#2F7A40', fontWeight: 700 }}>{money(r.headline.noiUsed)}</span></div> : null}
                {r.headline?.maxOffer != null ? <div><strong>Offer Result:</strong> <span style={{ color: '#2F7A40', fontWeight: 700 }}>{money(r.headline.maxOffer)}</span></div> : null}
                {r.calc?.capRate != null ? <div><strong>Cap Rate:</strong> {pct(r.calc.capRate)}</div> : null}
              </div>
            </div>

            {/* EXTRACTED SCENARIO */}
            <div style={{ border: '1px solid #d4dae8', borderRadius: 6, padding: 12, background: '#fafbfc' }}>
              <h4 style={{ margin: '0 0 12px', color: '#0A0F2C', fontWeight: 700 }}>📄 EXTRACTED (What Docs Say)</h4>
              <div style={{ fontSize: 13, lineHeight: 1.8 }}>
                {r.extracted?.grossIncome ? <div><strong>Income:</strong> {money(r.extracted.grossIncome)}</div> : <div style={{ color: '#9ca3af' }}>—</div>}
                {r.extracted?.expenses ? <div><strong>Expenses:</strong> {money(r.extracted.expenses)}</div> : <div style={{ color: '#9ca3af' }}>—</div>}
                {r.extracted?.brokerNOI != null ? <div style={{ marginTop: 8, paddingTop: 8, borderTop: '1px solid #e5e7eb' }}><strong>NOI Result:</strong> <span style={{ color: '#2F7A40', fontWeight: 700 }}>{money(r.extracted.brokerNOI)}</span></div> : <div style={{ color: '#9ca3af' }}>— (not extracted)</div>}
                {r.extracted?.asking != null ? <div><strong>Asking:</strong> {money(r.extracted.asking)}</div> : null}
              </div>
            </div>
          </div>

          {/* DIFFERENCES & FLAGS */}
          {(r.fields.grossIncome || r.extracted?.grossIncome) && (r.fields.grossIncome !== r.extracted?.grossIncome) && (
            <div style={{ background: '#fff3cd', border: '1px solid #ffc107', borderRadius: 6, padding: 12, marginBottom: 16 }}>
              <h4 style={{ margin: '0 0 8px', color: '#856404', fontWeight: 700 }}>⚠️ DIFFERENCES DETECTED</h4>
              <div style={{ fontSize: 13, color: '#856404', lineHeight: 1.6 }}>
                {r.fields.grossIncome && r.extracted?.grossIncome && (
                  <div>
                    <strong>Income:</strong> Manual ${r.fields.grossIncome.toLocaleString()} vs Extracted ${r.extracted.grossIncome.toLocaleString()}
                    <br />
                    <span style={{ fontSize: 12 }}>Difference: ${Math.abs(r.fields.grossIncome - r.extracted.grossIncome).toLocaleString()}
                    ({((Math.abs(r.fields.grossIncome - r.extracted.grossIncome) / r.fields.grossIncome) * 100).toFixed(1)}%)
                    </span>
                    <br />
                    <span style={{ fontSize: 12, marginTop: 4, display: 'block' }}>💡 <strong>QUESTION:</strong> Which OM/rent roll is current? Check document date vs. current year.</span>
                  </div>
                )}
                {r.fields.expenses && r.extracted?.expenses && r.fields.expenses !== r.extracted.expenses && (
                  <div style={{ marginTop: 8 }}>
                    <strong>Expenses:</strong> Manual ${r.fields.expenses.toLocaleString()} vs Extracted ${r.extracted.expenses.toLocaleString()}
                    <br />
                    <span style={{ fontSize: 12 }}>💡 <strong>QUESTION:</strong> Verify which expense breakdown (T12, P&L, or operator estimate) is most recent.</span>
                  </div>
                )}
                {r.headline?.noiUsed != null && r.extracted?.brokerNOI != null && r.headline.noiUsed !== r.extracted.brokerNOI && (
                  <div style={{ marginTop: 8, fontWeight: 700, color: '#B23030' }}>
                    <strong>NOI CONFLICT:</strong> Manual ${r.headline.noiUsed.toLocaleString()} vs Extracted ${r.extracted.brokerNOI.toLocaleString()}
                    <br />
                    <span style={{ fontSize: 12, fontWeight: 400 }}>💡 This cascades to offer. Recommend: verify with broker before making offer.</span>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      )}

      {/* DATA RECONCILIATION — All fields: manual vs extracted */}
      {r && r.fields && (
        <div style={card}>
          <h3 style={h3}>All Input Data — Manual vs Extracted from Documents</h3>
          <div style={{ overflowX: 'auto', marginBottom: 12 }}>
            <table style={{ borderCollapse: 'collapse', width: '100%', minWidth: 1000, fontSize: 12 }}>
              <thead>
                <tr style={{ background: '#0A0F2C', color: '#fff' }}>
                  <th style={{ padding: '10px 8px', textAlign: 'left', fontWeight: 600 }}>Field</th>
                  <th style={{ padding: '10px 8px', textAlign: 'right', fontWeight: 600 }}>You Entered</th>
                  <th style={{ padding: '10px 8px', textAlign: 'right', fontWeight: 600 }}>From Documents</th>
                  <th style={{ padding: '10px 8px', textAlign: 'right', fontWeight: 600 }}>Used in Analysis</th>
                  <th style={{ padding: '10px 8px', textAlign: 'left', fontWeight: 600, width: 200 }}>Source</th>
                </tr>
              </thead>
              <tbody>
                {[
                  { k: 'address', label: 'Address' },
                  { k: 'city', label: 'City' },
                  { k: 'state', label: 'State' },
                  { k: 'zip', label: 'ZIP' },
                  { k: 'user', label: 'Your Name' },
                  { k: 'contact', label: 'Contact' },
                  { k: 'askingPrice', label: 'Asking Price', fmt: money },
                  { k: 'arv', label: 'ARV', fmt: money },
                  { k: 'rehab', label: 'Rehab', fmt: money },
                  { k: 'beds', label: 'Beds' },
                  { k: 'baths', label: 'Baths' },
                  { k: 'sqft', label: 'Square Feet', fmt: (v) => v?.toLocaleString() },
                  { k: 'stories', label: 'Stories' },
                  { k: 'yearBuilt', label: 'Year Built' },
                  { k: 'grossIncome', label: 'Gross Income', fmt: money },
                  { k: 'expenses', label: 'Expenses', fmt: money },
                  { k: 'expenseRatio', label: 'Expense Ratio %', fmt: (v) => v ? `${(v*100).toFixed(1)}%` : null },
                  { k: 'noi', label: 'NOI', fmt: money },
                  { k: 'capRate', label: 'Cap Rate', fmt: pct },
                  { k: 'purchase', label: 'Purchase Price', fmt: money },
                  { k: 'units', label: 'Units' },
                  { k: 'totalUnits', label: 'Total Units' },
                  { k: 'occupancy', label: 'Occupancy %', fmt: (v) => v ? `${(v*100).toFixed(0)}%` : null },
                ].map(({ k, label, fmt }) => {
                  const manual = r.fields[k]
                  const extracted = r.extracted ? r.extracted[k] : null
                  const used = manual || extracted
                  const manualStr = manual ? (fmt ? fmt(manual) : String(manual)) : '—'
                  const extractedStr = extracted ? (fmt ? fmt(extracted) : String(extracted)) : '—'
                  const usedStr = used ? (fmt ? fmt(used) : String(used)) : '—'
                  const conflict = manual && extracted && String(manual) !== String(extracted)

                  return (
                    <tr key={k} style={{ background: (manual || extracted) ? (conflict ? '#fdeaea' : '#f7f9fd') : '#fff', borderBottom: '1px solid #e5e7eb' }}>
                      <td style={{ padding: '8px', fontWeight: 600, color: '#0A0F2C' }}>{label}</td>
                      <td style={{ padding: '8px', textAlign: 'right', color: manual ? '#2F7A40' : '#9ca3af' }}>{manualStr}</td>
                      <td style={{ padding: '8px', textAlign: 'right', color: extracted ? '#2F7A40' : '#9ca3af' }}>{extractedStr}</td>
                      <td style={{ padding: '8px', textAlign: 'right', fontWeight: 600, color: '#0A0F2C' }}>{usedStr}</td>
                      <td style={{ padding: '8px', fontSize: 11, color: conflict ? '#B23030' : '#6b7280' }}>
                        {conflict ? <span style={{ fontWeight: 600, color: '#B23030' }}>⚠ Manual chosen</span> : (extracted ? 'Extracted' : (manual ? 'Manual' : '—'))}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* DATA RECONCILIATION — Manual vs Extracted */}
      {r.dataReconciliation && r.dataReconciliation.some(d => d.manual || d.extracted) && (
        <div style={card}>
          <h3 style={h3}>Data Reconciliation — Manual Entry vs Extracted from Documents</h3>
          <div style={{ overflowX: 'auto', marginBottom: 12 }}>
            <table style={{ borderCollapse: 'collapse', width: '100%', minWidth: 600, fontSize: 13 }}>
              <thead>
                <tr style={{ background: '#f7f9fd' }}>
                  <th style={{ padding: '8px 10px', textAlign: 'left', fontWeight: 600, borderBottom: '2px solid #d4dae8' }}>Field</th>
                  <th style={{ padding: '8px 10px', textAlign: 'right', fontWeight: 600, borderBottom: '2px solid #d4dae8' }}>User-Entered</th>
                  <th style={{ padding: '8px 10px', textAlign: 'right', fontWeight: 600, borderBottom: '2px solid #d4dae8' }}>From Documents</th>
                  <th style={{ padding: '8px 10px', textAlign: 'right', fontWeight: 600, borderBottom: '2px solid #d4dae8' }}>Used in Analysis</th>
                  <th style={{ padding: '8px 10px', textAlign: 'left', fontWeight: 600, borderBottom: '2px solid #d4dae8' }}>Source</th>
                </tr>
              </thead>
              <tbody>
                {r.dataReconciliation.map((rec, i) => (
                  <tr key={i} style={{ background: i % 2 ? '#fff' : '#f7f9fd', borderBottom: '1px solid #e5e7eb' }}>
                    <td style={{ padding: '8px 10px', fontWeight: 600, color: '#0A0F2C' }}>{rec.label}</td>
                    <td style={{ padding: '8px 10px', textAlign: 'right', color: rec.manual ? '#2F7A40' : '#9ca3af' }}>
                      {rec.manual ? (typeof rec.manual === 'number' ? rec.manual.toLocaleString() : rec.manual) : '—'}
                    </td>
                    <td style={{ padding: '8px 10px', textAlign: 'right', color: rec.extracted ? '#2F7A40' : '#9ca3af' }}>
                      {rec.extracted ? (typeof rec.extracted === 'number' ? rec.extracted.toLocaleString() : rec.extracted) : '—'}
                    </td>
                    <td style={{ padding: '8px 10px', textAlign: 'right', fontWeight: 600, color: '#0A0F2C' }}>
                      {rec.used ? (typeof rec.used === 'number' ? rec.used.toLocaleString() : rec.used) : '—'}
                    </td>
                    <td style={{ padding: '8px 10px', fontSize: 12, color: rec.conflict ? '#B23030' : '#6b7280' }}>
                      {rec.conflict ? (
                        <span style={{ fontWeight: 600, color: '#B23030' }}>⚠ Conflict: {rec.conflict}</span>
                      ) : (
                        rec.source
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {r.dataReconciliation.some(d => d.conflict) && (
            <p style={{ color: '#B23030', fontSize: 12, fontWeight: 600 }}>
              ⚠ Conflicts detected between user-entered and extracted data. User-entered values take precedence in analysis.
            </p>
          )}
        </div>
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
            <OfferTiers tiers={offerTiers(r)} />
            <div style={{ fontSize: 13, fontWeight: 700, color: '#1E2A45', margin: '8px 0 2px' }}>How we got there</div>
            <MathRows rows={humanMath(r)} />
            {r.headline.noiUsed != null && (
              <p style={srcStyle}>NOI used: {money(r.headline.noiUsed)} ({r.brokerNOI && r.calcNOI === r.brokerNOI ? 'broker NOI, no override entered' : 'user input / derived'}).</p>
            )}
            <details style={{ marginTop: 8 }}>
              <summary style={{ cursor: 'pointer', fontWeight: 600, fontSize: 12, color: '#6b7280' }}>Developer view (raw calc output)</summary>
              <pre style={{ background: '#f4f6fb', padding: 10, borderRadius: 6, overflow: 'auto', fontSize: 12 }}>{JSON.stringify(r.calc, null, 2)}</pre>
            </details>
          </>
        )}
      </div>
      )}

      {/* REHAB — human vs photo, each priced your-numbers vs national-average */}
      {(r.rehabCondition != null || r.rehabPhoto != null) && (
        <div style={card}>
          <h3 style={h3}>Rehab — Human vs Photo · Your Numbers vs National Average</h3>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ borderCollapse: 'collapse', width: '100%', minWidth: 420 }}>
              <thead><tr>
                {['Source', 'Your numbers', 'National average'].map((h, i) => (
                  <th key={i} style={{ padding: '6px 10px', background: '#0A0F2C', color: '#fff', fontSize: 12, textAlign: i ? 'right' : 'left' }}>{h}</th>
                ))}
              </tr></thead>
              <tbody>
                <tr>
                  <td style={{ padding: '6px 10px', fontWeight: 600, borderBottom: '1px solid #eef1f7' }}>Human (condition answers)</td>
                  <td style={{ padding: '6px 10px', textAlign: 'right', borderBottom: '1px solid #eef1f7' }}>{money(r.rehabCondition)}</td>
                  <td style={{ padding: '6px 10px', textAlign: 'right', borderBottom: '1px solid #eef1f7' }}>{r.rehabConditionNational != null ? money(r.rehabConditionNational) : '—'}</td>
                </tr>
                <tr style={{ background: '#f7f9fd' }}>
                  <td style={{ padding: '6px 10px', fontWeight: 600 }}>Photo (pic-rehab read)</td>
                  <td style={{ padding: '6px 10px', textAlign: 'right' }}>{r.rehabPhoto != null ? money(r.rehabPhoto) : '—'}</td>
                  <td style={{ padding: '6px 10px', textAlign: 'right' }}>{r.rehabPhotoNational != null ? money(r.rehabPhotoNational) : '—'}</td>
                </tr>
              </tbody>
            </table>
          </div>
          <p style={srcStyle}>
            {r.rehabUsed != null
              ? `Offer math used ${money(r.rehabUsed)} (your manual condition total; a typed Rehab Budget overrides it).`
              : 'Enter property condition above (or upload photos) to drive the rehab number into the offer.'}
            {' '}Your numbers = Rehab Calc line-item engine. National = area × national $/sf benchmark (mid-Atlantic, data-enrichment). Photo line uses pic-rehab’s overall condition.
          </p>

          {/* Per-line: human condition + $ (your numbers) vs photo-assessed condition */}
          {r.rehabBreakdown && r.rehabBreakdown.length > 0 && (
            <details style={{ marginTop: 8 }}>
              <summary style={{ cursor: 'pointer', fontWeight: 600 }}>Line-by-line — your condition &amp; $ vs the photo read</summary>
              <div style={{ overflowX: 'auto', marginTop: 6 }}>
                <table style={{ borderCollapse: 'collapse', width: '100%', minWidth: 460 }}>
                  <thead><tr>{['System', 'Your condition', 'Your $', 'Photo says'].map((hh, i) => (
                    <th key={i} style={{ padding: '5px 8px', background: '#1E2A45', color: '#fff', fontSize: 11, textAlign: i === 0 ? 'left' : 'right' }}>{hh}</th>
                  ))}</tr></thead>
                  <tbody>
                    {r.rehabBreakdown.filter(li => li.id !== 'holding').map((li, i) => (
                      <tr key={li.id} style={{ background: i % 2 ? '#f7f9fd' : '#fff' }}>
                        <td style={{ padding: '5px 8px', fontWeight: 600 }}>{li.label}</td>
                        <td style={{ padding: '5px 8px', textAlign: 'right' }}>{li.condition}</td>
                        <td style={{ padding: '5px 8px', textAlign: 'right' }}>{money(li.total)}</td>
                        <td style={{ padding: '5px 8px', textAlign: 'right', color: '#6b7280' }}>{photoConditionFor(li.id, r.rehabPhotoTiers)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p style={srcStyle}>“Photo says” is pic-rehab’s per-system read where the photos covered that system (—  = not assessed). Your $ uses your locked Rehab Calc numbers.</p>
            </details>
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
            <TwoCompSources primary={comps.avm} secondary={comps.avm2} />
            <CompEvidence subject={comps.subject} comps={comps.comparables} />
            {comps.avm?.rent_estimate != null && <Val label="Rent Estimate" value={money(comps.avm.rent_estimate) + '/mo'} source={comps.avm.source} />}
            {comps.compContext && <p><b>Comp context:</b> {comps.compContext} <span style={srcStyle}>({comps.sources?.comps || 'Data Enrichment'})</span></p>}
            {comps.flood && <Val label="Flood Zone" value={`${comps.flood.zone || '—'}${comps.flood.sfha ? ' (SFHA — high risk)' : ''}`} source="FEMA via Data Enrichment" />}
            {comps.crime && comps.crime.score != null && <Val label="Neighborhood Safety" value={`${comps.crime.score}/100 ${comps.crime.label ? '(' + comps.crime.label + ')' : ''}`} source="FBI/Census via Data Enrichment" />}
            {comps.demographics && <Val label="Median Household Income" value={money(comps.demographics.medianIncome)} source="Census ACS via Data Enrichment" />}
            {comps.demographics && comps.demographics.population != null && <Val label="Area Population / Poverty" value={`${Number(comps.demographics.population).toLocaleString()}${comps.demographics.povertyRate ? ' · ' + comps.demographics.povertyRate + ' poverty' : ''}`} source="Census ACS via Data Enrichment" />}
          </>
        )}
      </div>

      {/* DATA SOURCES — full ledger of every service queried */}
      <DataSources sources={comps?.allSources} counts={comps?.sourceCounts} />

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
  const t = offerTiers(r)
  rows.push(`<h3>Your Two Choices</h3>
<table border="1" cellpadding="6" style="border-collapse:collapse">
<tr><th>${t.retailLabel}</th><th>${t.wholesaleLabel}</th></tr>
<tr><td>${t.retail != null ? money(t.retail) : '—'}</td><td>${t.wholesale != null ? money(t.wholesale) : '—'}</td></tr>
</table>
<p><i>${t.note}</i></p>`)
  if (r.calc) {
    const mr = humanMath(r).map(x => `<tr><td>${x.label}${x.note ? ` <i>(${x.note})</i>` : ''}</td><td style="text-align:right">${x.value}</td></tr>`).join('')
    rows.push(`<h3>How We Got There</h3><table border="1" cellpadding="6" style="border-collapse:collapse">${mr}</table>`)
  }
  if (r.risk) {
    rows.push(`<h3>Deal Evaluator — Risk Analysis</h3>
<table border="1" cellpadding="8" style="border-collapse:collapse;width:100%">
<tr><th colspan="2" style="background:#f0f7ff;text-align:left">Risk Assessment</th></tr>
<tr><td><strong>Risk Rating</strong></td><td>${r.risk.riskRating}</td></tr>
<tr><td><strong>Confidence</strong></td><td>${r.risk.confidence}</td></tr>
<tr><td><strong>Red Flags</strong></td><td>${r.risk.redFlagsCount}</td></tr>
${r.risk.topRedFlags?.map(f => `<tr><td colspan="2"><strong>${f.category}</strong>: ${f.message}</td></tr>`).join('') || ''}
</table>`)
  }
  rows.push(`<h3>Raw Extracted</h3><pre>${JSON.stringify(r.extracted, null, 2)}</pre>`)
  rows.push(`<details><summary>Developer view (raw calc + headline)</summary><pre>${JSON.stringify({ headline: r.headline, calc: r.calc }, null, 2)}</pre></details>`)
  rows.push(`<h3>Comps</h3><pre>${JSON.stringify(r.comps, null, 2)}</pre>`)
  rows.push(`<h3>Photos / Rehab</h3><pre>${JSON.stringify(r.photoRes, null, 2)}</pre>`)
  rows.push(`<h3>Missing</h3><ul>${r.missing.map(m => `<li>${m}</li>`).join('')}</ul>`)
  return `<!doctype html><html><head><meta charset="utf-8"><title>Baby Analyzer Report</title></head><body>${rows.join('\n')}</body></html>`
}
