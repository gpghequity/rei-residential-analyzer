// PORTED FROM docs/COMMERCIAL_BRIEF_V1.md (V1 spec) on 2026-05-13
// V1 scope: current contract rent only, single $/SF reserves, V2 deferred per brief.
//
// Self-contained HELPERS only (own annualLoanConstant, no imports from
// storage.js / mhp.js / residential.js). That part of the isolation rule stays.
//
// The DEFAULT_* underwriting constants below are a KNOWN DEFECT slated for
// removal: a math module must not own a rate, amort, DSCR, LTV, fee, or pad.
// They are being migrated to live Math Bible reads (values arrive via
// `assumptions`, built from https://shared-underwriting-standards.vercel.app/bible.json;
// a missing value throws instead of falling back). See rei-fast-calc/src/math/commercial.js
// for the finished pattern and COMMERCIAL_BRIEF_V1.md "SUPERSEDED 2026-07-17".
//
// Drift is NOT acceptable. The retired "drift is acceptable per the platform's
// bulletproof-modularity rule" policy is exactly how DEFAULT_LENDER_RATE below
// came to say 7% / 30yr while the Bible says 7.25% / 25yr — an 8.64% overpay on
// every commercial deal. That policy is dead.

// ── Lender + reserve defaults (all user-overridable in UI) ─────────────
export const DEFAULT_DSCR = 1.25
export const DEFAULT_LENDER_RATE = 0.07
export const DEFAULT_LENDER_AM_YEARS = 30
export const DEFAULT_LENDER_TERM_YEARS = 5
export const DEFAULT_SELLER_RATE = 0.06
export const DEFAULT_SELLER_AM_YEARS = 20
export const DEFAULT_COLLECTION_LOSS = 0.02
export const DEFAULT_PROP_MGMT_PCT = 0.05

export const DEFAULT_TI_LC_PSF = 0.75
export const DEFAULT_CAPEX_PSF = 0.30
export const MEDICAL_TI_LC_PSF = 1.25
export const OLD_BUILDING_CAPEX_PSF = 0.50
export const OLD_BUILDING_YEAR_CUTOFF = 1990

export const MVM_SCENARIOS = [0, 0.20, 0.30]

// ── Commercial asset subclasses ──────────────────────────────────────────
// Different commercial property types have different market norms. The
// subclass dropdown swaps the form's defaults to reflect what's typical for
// retail vs office vs industrial vs medical etc. Operator can still override
// any value — these are starting points + warning baselines.

export const COMMERCIAL_SUBCLASSES = [
  'retail_strip',       // strip center, in-line retail, small multi-tenant retail
  'retail_single',      // single-tenant retail (NNN ground lease, QSR pad, dollar store)
  'office_general',     // suburban office, multi-tenant
  'office_medical',     // medical office building (MOB)
  'industrial_flex',    // flex / light industrial, R&D
  'industrial_warehouse', // warehouse, distribution, last-mile
  'mixed_use',          // ground-floor retail + upper-floor office or residential
  'restaurant',         // standalone restaurant / QSR
  'self_serve_carwash', // car wash, drive-thru, single-purpose
  'special_purpose',    // bank branch, daycare, vet clinic, anything bespoke
  'other'
]

// Per-subclass defaults. These are RECOMMENDED starting points based on
// 2026 market norms — operator should override based on local data.
// capRate values are the BENCHMARK used for warnings ("your implied cap is
// outside the typical X-Y% band for retail strip"). They do NOT change the
// math directly.
export const SUBCLASS_DEFAULTS = {
  retail_strip: {
    typicalCapRateLow: 0.065, typicalCapRateHigh: 0.085,
    typicalVacancyPct: 0.08, vacancyFloorPct: 0.05,
    tiLcPsf: 1.00, capexPsf: 0.30,
    propMgmtPct: 0.05,
    typicalLeaseTypes: ['NNN', 'NN'],
    expenseRatioFloor: 0.25, expenseRatioCeiling: 0.40,
    notes: 'Retail strips price tighter on credit-tenant percentages. Watch top-tenant concentration.'
  },
  retail_single: {
    typicalCapRateLow: 0.055, typicalCapRateHigh: 0.075,
    typicalVacancyPct: 0.02, vacancyFloorPct: 0.00,
    tiLcPsf: 0.50, capexPsf: 0.20,
    propMgmtPct: 0.02,
    typicalLeaseTypes: ['NNN', 'GROUND'],
    expenseRatioFloor: 0.05, expenseRatioCeiling: 0.20,
    notes: 'Single-tenant NNN. Cap rate is mostly a function of tenant credit + lease term remaining.'
  },
  office_general: {
    typicalCapRateLow: 0.075, typicalCapRateHigh: 0.105,
    typicalVacancyPct: 0.15, vacancyFloorPct: 0.10,
    tiLcPsf: 1.50, capexPsf: 0.50,
    propMgmtPct: 0.05,
    typicalLeaseTypes: ['MG', 'FSG'],
    expenseRatioFloor: 0.35, expenseRatioCeiling: 0.55,
    notes: 'Office vacancy elevated post-2020. Underwrite to 12-18% vacancy minimum even if currently full.'
  },
  office_medical: {
    typicalCapRateLow: 0.065, typicalCapRateHigh: 0.080,
    typicalVacancyPct: 0.06, vacancyFloorPct: 0.05,
    tiLcPsf: 2.50, capexPsf: 0.60,
    propMgmtPct: 0.05,
    typicalLeaseTypes: ['NNN', 'MG'],
    expenseRatioFloor: 0.30, expenseRatioCeiling: 0.45,
    notes: 'Medical offices have heavy buildout costs (MOB TI often $50-150/SF on renewal).'
  },
  industrial_flex: {
    typicalCapRateLow: 0.055, typicalCapRateHigh: 0.075,
    typicalVacancyPct: 0.05, vacancyFloorPct: 0.03,
    tiLcPsf: 0.75, capexPsf: 0.25,
    propMgmtPct: 0.04,
    typicalLeaseTypes: ['NNN', 'NN'],
    expenseRatioFloor: 0.10, expenseRatioCeiling: 0.25,
    notes: 'Flex space — small bays, mix of office + warehouse. Strong fundamentals in most metros.'
  },
  industrial_warehouse: {
    typicalCapRateLow: 0.050, typicalCapRateHigh: 0.070,
    typicalVacancyPct: 0.04, vacancyFloorPct: 0.03,
    tiLcPsf: 0.40, capexPsf: 0.20,
    propMgmtPct: 0.03,
    typicalLeaseTypes: ['NNN'],
    expenseRatioFloor: 0.08, expenseRatioCeiling: 0.20,
    notes: 'Last-mile + distribution. Cap rates compressed since 2020. Roof + paving are the big capex items.'
  },
  mixed_use: {
    typicalCapRateLow: 0.065, typicalCapRateHigh: 0.090,
    typicalVacancyPct: 0.10, vacancyFloorPct: 0.05,
    tiLcPsf: 1.00, capexPsf: 0.40,
    propMgmtPct: 0.06,
    typicalLeaseTypes: ['NNN', 'MG', 'FSG'],
    expenseRatioFloor: 0.30, expenseRatioCeiling: 0.50,
    notes: 'Ground-floor retail + upper-floor office/residential. Consider rei-mixed-use for full per-asset blend.'
  },
  restaurant: {
    typicalCapRateLow: 0.055, typicalCapRateHigh: 0.080,
    typicalVacancyPct: 0.03, vacancyFloorPct: 0.00,
    tiLcPsf: 1.50, capexPsf: 0.40,
    propMgmtPct: 0.03,
    typicalLeaseTypes: ['NNN', 'PERCENTAGE'],
    expenseRatioFloor: 0.05, expenseRatioCeiling: 0.25,
    notes: 'QSR / national chain = tight cap. Independent = much wider cap, longer marketing if vacant.'
  },
  self_serve_carwash: {
    typicalCapRateLow: 0.075, typicalCapRateHigh: 0.110,
    typicalVacancyPct: 0.00, vacancyFloorPct: 0.00,
    tiLcPsf: 0.50, capexPsf: 1.00,
    propMgmtPct: 0.08,
    typicalLeaseTypes: ['NNN'],
    expenseRatioFloor: 0.30, expenseRatioCeiling: 0.55,
    notes: 'Equipment-heavy. Capex reserve must be high — tunnels and reclaim systems are expensive.'
  },
  special_purpose: {
    typicalCapRateLow: 0.070, typicalCapRateHigh: 0.110,
    typicalVacancyPct: 0.05, vacancyFloorPct: 0.00,
    tiLcPsf: 1.50, capexPsf: 0.50,
    propMgmtPct: 0.05,
    typicalLeaseTypes: ['NNN', 'GROUND'],
    expenseRatioFloor: 0.20, expenseRatioCeiling: 0.45,
    notes: 'Single-purpose buildings have re-tenanting risk. Discount cap rate for time-to-fill on rollover.'
  },
  other: {
    typicalCapRateLow: 0.060, typicalCapRateHigh: 0.100,
    typicalVacancyPct: 0.10, vacancyFloorPct: 0.05,
    tiLcPsf: DEFAULT_TI_LC_PSF, capexPsf: DEFAULT_CAPEX_PSF,
    propMgmtPct: DEFAULT_PROP_MGMT_PCT,
    typicalLeaseTypes: ['NNN', 'NN', 'MG'],
    expenseRatioFloor: 0.20, expenseRatioCeiling: 0.50,
    notes: 'Generic commercial defaults. Override based on local comps.'
  }
}

export function getSubclassDefaults(subclass) {
  return SUBCLASS_DEFAULTS[subclass] || SUBCLASS_DEFAULTS.other
}

export const LEASE_TYPE_RECOVERIES = {
  NNN: ['taxes', 'insurance', 'cam'],
  NN: ['taxes', 'insurance'],
  MG: ['cam_fixed'],
  FSG: [],
  PERCENTAGE: [],
  GROUND: []
}

function num(v) {
  if (v === undefined || v === null || v === '') return 0
  const n = typeof v === 'number' ? v : Number(String(v).replace(/[$,\s%]/g, ''))
  return Number.isFinite(n) ? n : 0
}

export function annualLoanConstant(annualRate, amYears) {
  const r = num(annualRate)
  const n = num(amYears) * 12
  if (n <= 0) return 0
  if (r <= 0) return 12 / n
  const i = r / 12
  const monthly = i / (1 - Math.pow(1 + i, -n))
  return monthly * 12
}

export function tenantContribution(row, gsiContext) {
  const sf = num(row.sfLeased)
  const ratePsf = num(row.baseRentPsf)
  const baseRent = sf * ratePsf
  const leaseType = row.leaseType || ''
  const isLeased = sf > 0 && (row.tenantName || '').trim() !== '' && ratePsf > 0

  let reimbursements = 0
  const overrides = row.recoveryOverrides || {}
  const recoveryKeys = LEASE_TYPE_RECOVERIES[leaseType] || []

  if (leaseType === 'NNN' || leaseType === 'NN') {
    const proRataShare = gsiContext.totalLeasableSF > 0 ? sf / gsiContext.totalLeasableSF : 0
    for (const k of recoveryKeys) {
      if (overrides[k] != null && overrides[k] !== '') reimbursements += num(overrides[k])
      else if (k === 'taxes') reimbursements += proRataShare * gsiContext.grossTaxes
      else if (k === 'insurance') reimbursements += proRataShare * gsiContext.grossInsurance
      else if (k === 'cam') reimbursements += proRataShare * gsiContext.grossCAM
    }
  } else if (leaseType === 'MG') {
    if (overrides.cam_fixed != null && overrides.cam_fixed !== '') {
      reimbursements += num(overrides.cam_fixed)
    } else {
      const proRataShare = gsiContext.totalLeasableSF > 0 ? sf / gsiContext.totalLeasableSF : 0
      reimbursements += proRataShare * gsiContext.grossCAM * 0.5
    }
  }

  return {
    sf, ratePsf, baseRent, reimbursements,
    totalAnnual: baseRent + reimbursements,
    isLeased, isVacant: sf > 0 && !isLeased,
    leaseEndDate: row.leaseEndDate || '',
    leaseType, tenantType: row.tenantType || '', tenantName: row.tenantName || ''
  }
}

function buildGsiContext(rentRoll, opEx) {
  const totalLeasableSF = rentRoll.reduce((sum, r) => sum + num(r.sfLeased), 0)
  return {
    totalLeasableSF,
    grossTaxes: num(opEx.propertyTax),
    grossInsurance: num(opEx.insurance),
    grossCAM: num(opEx.cam)
  }
}

export function computeIncome(rentRoll, opEx, otherIncomeLines) {
  const ctx = buildGsiContext(rentRoll, opEx)
  const tenants = (rentRoll || []).map(r => tenantContribution(r, ctx))
  const totalBaseRent = tenants.reduce((s, t) => s + t.baseRent, 0)
  const totalReimbursements = tenants.reduce((s, t) => s + t.reimbursements, 0)
  const otherIncome = (otherIncomeLines || []).reduce((s, l) => s + num(l.amount), 0)
  const gsi = totalBaseRent + totalReimbursements + otherIncome

  const leasedSF = tenants.filter(t => t.isLeased).reduce((s, t) => s + t.sf, 0)
  const vacantSF = tenants.filter(t => t.isVacant).reduce((s, t) => s + t.sf, 0)
  const totalSF = leasedSF + vacantSF
  const physicalVacancyPct = totalSF > 0 ? vacantSF / totalSF : 0

  return { tenants, totalBaseRent, totalReimbursements, otherIncome, gsi,
    leasedSF, vacantSF, totalSF, physicalVacancyPct }
}

export function computeScenario({ income, opEx, reserves, mvmPct, econVacancyPct, collectionLossPct, askingPrice, terms }) {
  const adjustedBaseRent = income.totalBaseRent * (1 - mvmPct)
  const adjustedGSI = adjustedBaseRent + income.totalReimbursements + income.otherIncome

  const econVac = num(econVacancyPct)
  const colLoss = num(collectionLossPct)
  const egi = adjustedGSI * (1 - econVac) * (1 - colLoss)

  let pmgmtAmount = num(opEx.propMgmtPctOrAmount)
  if (opEx.propMgmtIsPct) {
    pmgmtAmount = egi * num(opEx.propMgmtPct || DEFAULT_PROP_MGMT_PCT)
  }
  const grossOpEx = num(opEx.propertyTax) + num(opEx.insurance) + num(opEx.cam) +
    num(opEx.commonUtilities) + pmgmtAmount + num(opEx.onsiteManager) +
    num(opEx.officeAdmin) + num(opEx.marketing) + num(opEx.legal) +
    num(opEx.repairs) + num(opEx.roofReserve) + num(opEx.other)

  const netOpExToLandlord = grossOpEx - income.totalReimbursements

  const tiLcAnnual = num(reserves.tiLcPsf) * income.totalSF
  const capexAnnual = num(reserves.capexPsf) * income.totalSF
  const totalReserves = tiLcAnnual + capexAnnual

  const noi = egi - netOpExToLandlord - totalReserves

  const ask = num(askingPrice)
  const impliedCapRate = ask > 0 ? noi / ask : null

  const dscr = num(terms.dscr) || DEFAULT_DSCR
  const lenderRate = num(terms.lenderRate) || DEFAULT_LENDER_RATE
  const lenderAm = num(terms.lenderAm) || DEFAULT_LENDER_AM_YEARS
  const sellerRate = num(terms.sellerRate) || DEFAULT_SELLER_RATE
  const sellerAm = num(terms.sellerAm) || DEFAULT_SELLER_AM_YEARS

  const senior_K = annualLoanConstant(lenderRate, lenderAm)
  const seller_K = annualLoanConstant(sellerRate, sellerAm)

  const maxAnnualDS = dscr > 0 ? noi / dscr : 0
  const maxSeniorLoan = senior_K > 0 ? maxAnnualDS / senior_K : 0
  const seniorDS = maxSeniorLoan * senior_K
  const sellerFiAmount = Math.max(0, ask - maxSeniorLoan)
  const sellerDS = sellerFiAmount * seller_K
  const totalDS = seniorDS + sellerDS
  const dscrCheck = totalDS > 0 ? noi / totalDS : null
  const cashFlowAfterDS = noi - totalDS
  const cashToClose = Math.max(0, ask - maxSeniorLoan - sellerFiAmount)
  const cashOnCash = cashToClose > 0 ? cashFlowAfterDS / cashToClose : null

  return {
    mvmPct,
    gsi: adjustedGSI,
    econVacancyLoss: adjustedGSI * econVac,
    collectionLossDollar: adjustedGSI * (1 - econVac) * colLoss,
    egi, grossOpEx, totalReimbursements: income.totalReimbursements,
    netOpExToLandlord, tiLcAnnual, capexAnnual, totalReserves,
    noi, impliedCapRate,
    maxAnnualDS, maxSeniorLoan, seniorDS,
    sellerFiAmount, sellerDS, totalDS,
    dscrCheck, dscrFlagsRed: dscrCheck != null && dscrCheck < 1.20,
    cashFlowAfterDS, cashToClose, cashOnCash
  }
}

export function tenantConcentration(tenants) {
  const leased = tenants.filter(t => t.isLeased)
  if (leased.length === 0) return { rows: [], topTenantPct: 0 }
  const totalIncome = leased.reduce((s, t) => s + t.totalAnnual, 0)
  const rows = leased.map(t => ({
    tenantName: t.tenantName, tenantType: t.tenantType,
    annual: t.totalAnnual,
    pctOfTotal: totalIncome > 0 ? t.totalAnnual / totalIncome : 0,
    sf: t.sf, pctOfSF: 0
  }))
  rows.sort((a, b) => b.annual - a.annual)
  return { rows, topTenantPct: rows[0]?.pctOfTotal || 0 }
}

export function tenantMix(tenants) {
  const leased = tenants.filter(t => t.isLeased)
  const totalSF = leased.reduce((s, t) => s + t.sf, 0)
  const totalIncome = leased.reduce((s, t) => s + t.totalAnnual, 0)
  const bySF = {}, byIncome = {}
  for (const t of leased) {
    const type = t.tenantType || 'unknown'
    bySF[type] = (bySF[type] || 0) + (totalSF > 0 ? t.sf / totalSF : 0)
    byIncome[type] = (byIncome[type] || 0) + (totalIncome > 0 ? t.totalAnnual / totalIncome : 0)
  }
  return { bySF, byIncome }
}

export function leaseTypeMix(tenants) {
  const leased = tenants.filter(t => t.isLeased)
  const totalSF = leased.reduce((s, t) => s + t.sf, 0)
  const totalIncome = leased.reduce((s, t) => s + t.totalAnnual, 0)
  const bySF = {}, byIncome = {}
  for (const t of leased) {
    const lt = t.leaseType || 'unknown'
    bySF[lt] = (bySF[lt] || 0) + (totalSF > 0 ? t.sf / totalSF : 0)
    byIncome[lt] = (byIncome[lt] || 0) + (totalIncome > 0 ? t.totalAnnual / totalIncome : 0)
  }
  return { bySF, byIncome }
}

export function weightedAvgLeaseTerm(tenants) {
  const leased = tenants.filter(t => t.isLeased && t.leaseEndDate)
  if (leased.length === 0) return null
  const now = new Date()
  let weightedSum = 0, weightTotal = 0
  for (const t of leased) {
    const end = new Date(t.leaseEndDate)
    if (!Number.isFinite(end.getTime())) continue
    const yearsRemaining = Math.max(0, (end.getTime() - now.getTime()) / (365.25 * 24 * 3600 * 1000))
    weightedSum += yearsRemaining * t.sf
    weightTotal += t.sf
  }
  return weightTotal > 0 ? weightedSum / weightTotal : null
}

export function rolloverSchedule(tenants) {
  const leased = tenants.filter(t => t.isLeased && t.leaseEndDate)
  const totalSF = leased.reduce((s, t) => s + t.sf, 0)
  const now = new Date()
  const buckets = { year_1: 0, year_2: 0, year_3: 0, year_4: 0, year_5: 0, beyond: 0 }
  for (const t of leased) {
    const end = new Date(t.leaseEndDate)
    if (!Number.isFinite(end.getTime())) continue
    const yearsOut = (end.getTime() - now.getTime()) / (365.25 * 24 * 3600 * 1000)
    if (yearsOut <= 1) buckets.year_1 += t.sf
    else if (yearsOut <= 2) buckets.year_2 += t.sf
    else if (yearsOut <= 3) buckets.year_3 += t.sf
    else if (yearsOut <= 4) buckets.year_4 += t.sf
    else if (yearsOut <= 5) buckets.year_5 += t.sf
    else buckets.beyond += t.sf
  }
  const result = {}
  for (const k of Object.keys(buckets)) result[k] = totalSF > 0 ? buckets[k] / totalSF : 0
  return result
}

export function weightedAvgRentPsf(tenants) {
  const leased = tenants.filter(t => t.isLeased)
  const totalSF = leased.reduce((s, t) => s + t.sf, 0)
  if (totalSF === 0) return 0
  const totalBaseRent = leased.reduce((s, t) => s + t.baseRent, 0)
  return totalBaseRent / totalSF
}

export function recoveryRatio(income, opEx) {
  const totalRecoverable = num(opEx.propertyTax) + num(opEx.insurance) + num(opEx.cam)
  if (totalRecoverable === 0) return null
  return income.totalReimbursements / totalRecoverable
}

// Subclass-aware warnings — flag when the underwriting strays from the typical
// band for the chosen subclass. Operator can ignore; surfaces below the
// scenario table.
export function subclassWarnings({ subclass, results, income, opEx, reserves, askingPrice }) {
  const sub = subclass || 'other'
  const defaults = getSubclassDefaults(sub)
  const w = []
  if (!subclass || subclass === 'other') return w

  const baseline = (results || []).find(r => r.mvmPct === 0)
  if (!baseline) return w

  // Cap rate band check (only meaningful if asking price is entered)
  if (askingPrice > 0 && baseline.impliedCapRate != null) {
    if (baseline.impliedCapRate < defaults.typicalCapRateLow) {
      w.push({ severity: 'warn', message: `Implied cap ${(baseline.impliedCapRate * 100).toFixed(2)}% is BELOW the ${(defaults.typicalCapRateLow * 100).toFixed(1)}-${(defaults.typicalCapRateHigh * 100).toFixed(1)}% typical band for ${sub.replace(/_/g, ' ')} — verify NOI or price.` })
    } else if (baseline.impliedCapRate > defaults.typicalCapRateHigh) {
      w.push({ severity: 'info', message: `Implied cap ${(baseline.impliedCapRate * 100).toFixed(2)}% is ABOVE the typical band for ${sub.replace(/_/g, ' ')} — may indicate deferred maintenance, lease-up risk, or genuine value buy.` })
    }
  }

  // Vacancy floor check
  if (income.physicalVacancyPct < defaults.vacancyFloorPct) {
    w.push({ severity: 'warn', message: `Currently 100%+ leased, but underwrite to at least ${(defaults.vacancyFloorPct * 100).toFixed(0)}% vacancy floor for ${sub.replace(/_/g, ' ')} — leases roll, tenants move.` })
  }

  // Reserve floor checks
  if (num(reserves.tiLcPsf) < defaults.tiLcPsf * 0.5) {
    w.push({ severity: 'warn', message: `TI/LC reserve $${num(reserves.tiLcPsf).toFixed(2)}/SF is well below typical $${defaults.tiLcPsf.toFixed(2)}/SF for ${sub.replace(/_/g, ' ')}.` })
  }
  if (num(reserves.capexPsf) < defaults.capexPsf * 0.5) {
    w.push({ severity: 'warn', message: `CapEx reserve $${num(reserves.capexPsf).toFixed(2)}/SF is well below typical $${defaults.capexPsf.toFixed(2)}/SF for ${sub.replace(/_/g, ' ')}.` })
  }

  // Expense ratio sanity (OpEx / GSI)
  const grossOpEx = baseline.grossOpEx || 0
  const gsi = baseline.gsi || 0
  if (gsi > 0) {
    const expRatio = grossOpEx / gsi
    if (expRatio < defaults.expenseRatioFloor) {
      w.push({ severity: 'warn', message: `Expense ratio ${(expRatio * 100).toFixed(0)}% is suspiciously low for ${sub.replace(/_/g, ' ')} (typical ${(defaults.expenseRatioFloor * 100).toFixed(0)}-${(defaults.expenseRatioCeiling * 100).toFixed(0)}%) — verify all OpEx lines are captured.` })
    } else if (expRatio > defaults.expenseRatioCeiling) {
      w.push({ severity: 'info', message: `Expense ratio ${(expRatio * 100).toFixed(0)}% is above the typical ${(defaults.expenseRatioCeiling * 100).toFixed(0)}% ceiling for ${sub.replace(/_/g, ' ')} — investigate which line item is high.` })
    }
  }

  // Lease-type alignment
  const ltUsed = new Set((income.tenants || []).filter(t => t.isLeased).map(t => t.leaseType).filter(Boolean))
  const typical = new Set(defaults.typicalLeaseTypes)
  const atypical = [...ltUsed].filter(lt => !typical.has(lt))
  if (atypical.length > 0 && ltUsed.size > 0) {
    w.push({ severity: 'info', message: `Lease type(s) ${atypical.join(', ')} are atypical for ${sub.replace(/_/g, ' ')} (typical: ${defaults.typicalLeaseTypes.join('/')}) — confirm with seller.` })
  }

  return w
}

export function detectWarnings({ income, tenants, results, askingPrice, reserves, yearBuilt }) {
  const w = []
  const conc = tenantConcentration(tenants)
  if (conc.topTenantPct > 0.40) {
    w.push({ severity: 'warn', message: `Tenant concentration risk — largest tenant is ${(conc.topTenantPct * 100).toFixed(1)}% of income` })
  }
  const walt = weightedAvgLeaseTerm(tenants)
  if (walt != null && walt < 3) {
    w.push({ severity: 'warn', message: `High rollover risk — weighted avg lease term is ${walt.toFixed(1)} years` })
  }
  const baseline = results.find(r => r.mvmPct === 0)
  if (baseline && baseline.dscrCheck != null && baseline.dscrCheck < 1.20) {
    w.push({ severity: 'error', message: `Below typical commercial lender threshold — DSCR ${baseline.dscrCheck.toFixed(2)} < 1.20 minimum` })
  }
  if (income.physicalVacancyPct > 0.20) {
    w.push({ severity: 'warn', message: `Reposition deal — vacancy is ${(income.physicalVacancyPct * 100).toFixed(1)}%, verify lease-up assumptions` })
  }
  if (num(reserves.tiLcPsf) < 0.50) {
    w.push({ severity: 'warn', message: `Likely under-reserved — TI/LC reserve is $${num(reserves.tiLcPsf).toFixed(2)}/SF, consider $0.75–1.50/SF for this tenant mix` })
  }
  if (num(reserves.capexPsf) < 0.20) {
    w.push({ severity: 'warn', message: `Likely under-reserved for asset class — capex reserve is $${num(reserves.capexPsf).toFixed(2)}/SF` })
  }
  if (conc.rows.length > 0) {
    const top = tenants.find(t => t.isLeased && t.tenantName === conc.rows[0].tenantName)
    if (top && top.leaseEndDate) {
      const end = new Date(top.leaseEndDate)
      if (Number.isFinite(end.getTime())) {
        const monthsOut = (end.getTime() - Date.now()) / (30.44 * 24 * 3600 * 1000)
        if (monthsOut < 12 && monthsOut > -60) {
          w.push({ severity: 'warn', message: `Top-tenant rollover imminent — ${conc.rows[0].tenantName} lease ends in ${Math.round(monthsOut)} months` })
        }
      }
    }
  }
  return w
}

export function computeCommercial(inputs) {
  const income = computeIncome(inputs.rentRoll || [], inputs.opEx || {}, inputs.otherIncomeLines || [])
  const econVac = num(inputs.econVacancyPct) || income.physicalVacancyPct
  const colLoss = num(inputs.collectionLossPct) || DEFAULT_COLLECTION_LOSS
  const askingPrice = num(inputs.askingPrice)
  const terms = inputs.terms || {}
  const reserves = inputs.reserves || { tiLcPsf: DEFAULT_TI_LC_PSF, capexPsf: DEFAULT_CAPEX_PSF }

  const results = MVM_SCENARIOS.map(mvmPct => computeScenario({
    income, opEx: inputs.opEx || {}, reserves,
    mvmPct, econVacancyPct: econVac, collectionLossPct: colLoss,
    askingPrice, terms
  }))

  const conc = tenantConcentration(income.tenants)
  const mix = tenantMix(income.tenants)
  const ltMix = leaseTypeMix(income.tenants)
  const walt = weightedAvgLeaseTerm(income.tenants)
  const rollover = rolloverSchedule(income.tenants)
  const avgRentPsf = weightedAvgRentPsf(income.tenants)
  const recRatio = recoveryRatio(income, inputs.opEx || {})

  const warnings = detectWarnings({
    income, tenants: income.tenants, results, askingPrice, reserves,
    yearBuilt: num(inputs.yearBuilt)
  })

  // Subclass-specific warnings layered on top
  const subWarnings = subclassWarnings({
    subclass: inputs.subclass, results, income, opEx: inputs.opEx || {},
    reserves, askingPrice
  })

  return {
    income, results,
    warnings: [...warnings, ...subWarnings],
    subclass: inputs.subclass || null,
    subclassDefaults: inputs.subclass ? getSubclassDefaults(inputs.subclass) : null,
    commercial: { conc, mix, ltMix, walt, rollover, avgRentPsf, recRatio,
      econVacancyApplied: econVac, collectionLossApplied: colLoss }
  }
}

// ── Mixed-use auto-detection ─────────────────────────────────────────────
// When a deal has tenants spanning multiple asset categories (e.g. retail
// downstairs + residential upstairs + warehouse out back), single-class math
// understates the value. This helper flags it so the UI can route to
// rei-mixed-use instead.
export function detectMixedUse({ subclass, tenants, additionalAssets }) {
  // Explicit signal from operator
  if (subclass === 'mixed_use') return { isMixedUse: true, reason: 'subclass=mixed_use' }
  // Tenant types span major categories
  if (Array.isArray(tenants)) {
    const types = new Set(tenants.filter(t => t.isLeased && t.tenantType).map(t => t.tenantType.toLowerCase()))
    const major = ['retail', 'office', 'industrial', 'medical', 'residential', 'restaurant']
    const present = major.filter(m => [...types].some(t => t.includes(m)))
    if (present.length >= 2) return { isMixedUse: true, reason: `tenant categories span ${present.join(' + ')}` }
  }
  // Operator added non-commercial parallel assets (storage, MHP entries)
  if (Array.isArray(additionalAssets) && additionalAssets.length > 0) {
    return { isMixedUse: true, reason: `${additionalAssets.length} additional asset entries (e.g. ${additionalAssets.slice(0, 2).map(a => a.type || '').join(', ')})` }
  }
  return { isMixedUse: false, reason: null }
}
