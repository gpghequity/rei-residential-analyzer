// URL param ingestion for rei-baby-analyzer.
//
// Reads `rei.deal.v1` URL params (compatible with Fast Calc's deep-link format)
// and hydrates the active tab's initial state. Lets you click "Open in Baby
// Analyzer" from Fast Calc's deal package and arrive with everything pre-filled
// for the operator-grade pre-LOI cross-check.
//
// Param vocabulary (matches Fast Calc's where possible):
//   tab            storage | residential | mhp | commercial
//   address        string
//   propname       property name
//   ask            asking price (number)
//
//   STORAGE tab:
//     gross        T-12 gross dollars in
//     sellerpct    seller-stated expense ratio (decimal)
//     opex         annual OpEx (for working-capital calc)
//     growth       NOI growth rate for kicker projection (decimal)
//     verified     comma-separated: t12,rentroll,occupancy
//     verifiedby   "Steve" | "team" | "qualified third party"
//
//   RESIDENTIAL tab:
//     mode         flip | rental
//     arv          after-repair value
//     rehab        rehab budget
//     income       (rental) gross annual rent
//     expenses     (rental) annual hard OpEx
//     comps        comma-separated comp sale prices
//
//   MHP tab — TODO in a follow-up commit (URL params for the full lot
//             accounting + utility matrix + assumption block is substantial)
//   COMMERCIAL tab — placeholder, no inputs yet (per V1 brief in repo)

const num = (v) => {
  if (v === null || v === undefined || v === '') return null
  const n = parseFloat(v)
  return Number.isFinite(n) ? n : null
}

const str = (v) => (v === null || v === undefined || v === '' ? null : String(v))

// Parse a URL search string (with or without leading '?').
// Returns: { tab, address, propertyName, askingPrice, storage:{...}, residential:{...} }
// Any field absent → null.
export function parseSearchString(search) {
  const params = new URLSearchParams(search || '')
  return {
    tab: validTab(params.get('tab')),
    address: str(params.get('address')),
    propertyName: str(params.get('propname')),
    askingPrice: num(params.get('ask')),
    storage: {
      grossDollarsIn: num(params.get('gross')),
      sellerExpensePct: num(params.get('sellerpct')),
      annualOpEx: num(params.get('opex')),
      growthRate: num(params.get('growth')),
      ...parseVerifiedFlags(params)
    },
    residential: {
      mode: validResidentialMode(params.get('mode')),
      arv: num(params.get('arv')),
      rehab: num(params.get('rehab')),
      grossDollarsIn: num(params.get('income')),
      hardCosts: num(params.get('expenses')),
      compsRaw: parseCompsToRaw(params.get('comps'))
    }
  }
}

function validTab(t) {
  if (!t) return null
  const lower = String(t).toLowerCase()
  return ['storage', 'residential', 'mhp', 'commercial', 'land', 'qa'].includes(lower) ? lower : null
}

function validResidentialMode(m) {
  if (!m) return null
  const lower = String(m).toLowerCase()
  return ['flip', 'rental'].includes(lower) ? lower : null
}

// "t12,rentroll,occupancy" → { t12Verified: true, rentRollVerified: true, occupancyVerified: true, verifiedBy: 'Steve' }
function parseVerifiedFlags(params) {
  const verified = String(params.get('verified') || '').toLowerCase().split(',').map((s) => s.trim()).filter(Boolean)
  return {
    t12Verified: verified.includes('t12'),
    rentRollVerified: verified.includes('rentroll'),
    occupancyVerified: verified.includes('occupancy'),
    verifiedBy: str(params.get('verifiedby'))
  }
}

// "200000,220000,240000" → "200000\n220000\n240000" (one-per-line for the textarea)
function parseCompsToRaw(comps) {
  if (!comps) return null
  return String(comps)
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .join('\n')
}

// Build a search string from the current state — for shareable links.
// Operators may copy-paste the URL after Calculate to share a Residential Analyzer
// view back to a teammate or Fast Calc.
export function buildSearchString(state) {
  const params = new URLSearchParams()
  if (state.tab) params.set('tab', state.tab)
  if (state.address) params.set('address', state.address)
  if (state.propertyName) params.set('propname', state.propertyName)
  if (state.askingPrice) params.set('ask', String(state.askingPrice))

  if (state.tab === 'storage' && state.storage) {
    const s = state.storage
    if (s.grossDollarsIn) params.set('gross', String(s.grossDollarsIn))
    if (s.sellerExpensePct) params.set('sellerpct', String(s.sellerExpensePct))
    if (s.annualOpEx) params.set('opex', String(s.annualOpEx))
    if (s.growthRate) params.set('growth', String(s.growthRate))
    const flags = []
    if (s.t12Verified) flags.push('t12')
    if (s.rentRollVerified) flags.push('rentroll')
    if (s.occupancyVerified) flags.push('occupancy')
    if (flags.length) params.set('verified', flags.join(','))
    if (s.verifiedBy) params.set('verifiedby', s.verifiedBy)
  }

  if (state.tab === 'residential' && state.residential) {
    const r = state.residential
    if (r.mode) params.set('mode', r.mode)
    if (r.arv) params.set('arv', String(r.arv))
    if (r.rehab) params.set('rehab', String(r.rehab))
    if (r.grossDollarsIn) params.set('income', String(r.grossDollarsIn))
    if (r.hardCosts) params.set('expenses', String(r.hardCosts))
    if (r.compsRaw) {
      const comps = r.compsRaw.split('\n').map((s) => s.trim()).filter(Boolean)
      if (comps.length) params.set('comps', comps.join(','))
    }
  }

  return params.toString()
}
