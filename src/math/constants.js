// constants.js — LIVE BIBLE READER (2026-07-16 live-read migration)
//
// This file NO LONGER does `import STANDARDS from 'shared-underwriting-standards'`.
// That build-time import bundled a FROZEN, STALE photocopy of the Bible into the
// app. Proven stale: the npm/github copy still carries residential expense pads
// 0.20 / 0.33 and has NO CLOSING_COSTS, NO REFI, and NO STORAGE.sellerKicker
// sections at all — while the LIVE Bible
// (https://shared-underwriting-standards.vercel.app/bible.json, v11.25) carries
// pads 0.15 / 0.30 and every expanded section. Bundling the photocopy is exactly
// why this app was underwriting on the wrong numbers (and rendering NaN where the
// missing keys were read).
//
// The app now fetches the live Bible at launch (see main.jsx + src/bible/liveBible.js)
// and hydrates the module singleton below via setBibleStandards(). loadConstants()
// reads that singleton and FAILS CLOSED — it THROWS if the Bible was never read.
// There are deliberately NO `|| default` fallbacks: a fallback is a stored number,
// a stored number drifts, and every money bug found in this codebase was a dead
// Bible key silently caught by a fallback.
//
// Tests hydrate the singleton from a committed snapshot of the live Bible
// (src/tests/bibleSnapshot.json) in src/tests/setup.js — a test is not the app, so
// it may read the Bible at build time; the app may not.

let _std = null

export function setBibleStandards(standards) {
  if (!standards || typeof standards !== 'object') {
    throw new Error('setBibleStandards: expected the live Bible `standards` object.')
  }
  _std = standards
}

export function getBibleStandards() {
  if (!_std) {
    throw new Error(
      'The live Bible has not been read yet — refusing to supply underwriting ' +
      'constants (fail closed). The app must call hydrateBibleFromLive() at launch.'
    )
  }
  return _std
}

export function hasBibleStandards() { return _std != null }

// Require a value to be present in the live Bible. No fallback — throw instead of
// guessing, so a dead key surfaces loudly rather than silently underwriting wrong.
function req(value, path) {
  if (value === undefined || value === null ||
      (typeof value === 'number' && !Number.isFinite(value))) {
    throw new Error(
      `constants.loadConstants: the live Bible is missing "${path}". ` +
      `Refusing to guess a value (fail closed).`
    )
  }
  return value
}

export function loadConstants() {
  const S = getBibleStandards()
  const RES  = req(S.RESIDENTIAL, 'RESIDENTIAL')
  const STOR = req(S.STORAGE, 'STORAGE')
  const GLOB = req(S.GLOBAL, 'GLOBAL')
  const CC   = req(S.CLOSING_COSTS, 'CLOSING_COSTS')
  const REFI = req(S.REFI, 'REFI')
  const GROWTH = req(S.GROWTH, 'GROWTH')

  const flat = {}

  // ── Residential ──────────────────────────────────────────────────────────
  flat.RATE_BANK_RESI  = req(RES.mortgageRate, 'RESIDENTIAL.mortgageRate')
  flat.AMORT_BANK_RESI = req(RES.amortizationYears, 'RESIDENTIAL.amortizationYears')
  flat.LTV_RESI        = req(RES.ltv, 'RESIDENTIAL.ltv')
  // RESIDENTIAL.dscr is a scalar in the live Bible (1.25). Tolerate an object
  // shape too (older readers used {standard} / {conservative}) — but require it.
  flat.DSCR_RESI = req(
    typeof RES.dscr === 'object'
      ? (RES.dscr.standard ?? RES.dscr.conservative)
      : RES.dscr,
    'RESIDENTIAL.dscr'
  )

  // ── Storage ──────────────────────────────────────────────────────────────
  flat.RATE_BANK_STORAGE  = req(STOR.mortgageRate, 'STORAGE.mortgageRate')
  flat.AMORT_BANK_STORAGE = req(STOR.amortizationYears, 'STORAGE.amortizationYears')
  flat.LTV_STORAGE        = req(STOR.ltv, 'STORAGE.ltv')
  flat.DSCR_CONSERVATIVE  = req(STOR.dscr && STOR.dscr.standard, 'STORAGE.dscr.standard')
  flat.DSCR_STRETCH       = req(STOR.dscr && STOR.dscr.stretch, 'STORAGE.dscr.stretch')

  // ── Commercial income-property terms ─────────────────────────────────────
  // The Bible prices commercial at 7.25% / 25-yr (same as storage), NOT the old
  // hardcoded 7% / 30-yr in incomeMatrix.js — a systematic ~8.6% overpay on every
  // commercial deal. Sourced live so it can never silently diverge again.
  const COMM = req(S.COMMERCIAL, 'COMMERCIAL')
  flat.RATE_BANK_COMMERCIAL  = req(COMM.mortgageRate, 'COMMERCIAL.mortgageRate')       // 0.0725
  flat.AMORT_BANK_COMMERCIAL = req(COMM.amortizationYears, 'COMMERCIAL.amortizationYears') // 25
  flat.LTV_COMMERCIAL        = req(COMM.ltv, 'COMMERCIAL.ltv')                          // 0.75
  flat.K_BANK_COMMERCIAL     = annualLoanConstant(flat.RATE_BANK_COMMERCIAL, flat.AMORT_BANK_COMMERCIAL)

  // ── Global ───────────────────────────────────────────────────────────────
  flat.POCKET_FLOOR = req(GLOB.pocketCashFloor, 'GLOBAL.pocketCashFloor')
  flat.EXPENSE_FLOOR = req(STOR.expenseFloor, 'STORAGE.expenseFloor')

  // ── Derived loan constants (rate + amortization → annual K) ──────────────
  flat.K_BANK_STORAGE = annualLoanConstant(flat.RATE_BANK_STORAGE, flat.AMORT_BANK_STORAGE)
  flat.K_BANK_RESI    = annualLoanConstant(flat.RATE_BANK_RESI,    flat.AMORT_BANK_RESI)
  flat.K_OWNER_IO     = req(RES.ownerFinanceRate, 'RESIDENTIAL.ownerFinanceRate')  // 0.08 IO
  flat.K_OWNER_AMORT  = annualLoanConstant(flat.K_OWNER_IO, 25)

  // ── Seller-finance (Math Bible storage Group B) ──────────────────────────
  flat.RATE_SELLER  = req(STOR.sellerFinance && STOR.sellerFinance.rate, 'STORAGE.sellerFinance.rate')
  flat.AMORT_SELLER = req(STOR.sellerFinance && STOR.sellerFinance.amortYears, 'STORAGE.sellerFinance.amortYears')
  flat.K_SELLER     = annualLoanConstant(flat.RATE_SELLER, flat.AMORT_SELLER)

  // ── Closing costs / fees (equity-requirement line items) ─────────────────
  flat.WHOLESALE_FEE    = req(GLOB.wholesaleFeeAmount, 'GLOBAL.wholesaleFeeAmount')
  flat.CLOSING_COSTS    = req(GLOB.closingCostsFlatAmount, 'GLOBAL.closingCostsFlatAmount')
  flat.TITLE_PCT        = req(GLOB.titleEscrowRecordingPercent, 'GLOBAL.titleEscrowRecordingPercent')
  flat.TRANSFER_TAX_PCT = req(GLOB.transferTaxPercent, 'GLOBAL.transferTaxPercent')
  flat.APPRAISAL        = req(CC.appraisalFee, 'CLOSING_COSTS.appraisalFee')          // 4000 (was hardcoded 4500)
  flat.SURVEY           = req(CC.surveyFee, 'CLOSING_COSTS.surveyFee')
  flat.LEGAL            = req(CC.legalFee, 'CLOSING_COSTS.legalFee')
  flat.ENVIRONMENTAL    = req(CC.environmentalFee, 'CLOSING_COSTS.environmentalFee')  // 3500 (was hardcoded 500 — 7x low)
  flat.INSURANCE_SETUP  = req(CC.insuranceSetupFee, 'CLOSING_COSTS.insuranceSetupFee')
  flat.BANK_POINTS_PCT  = req(CC.bankPointsPct, 'CLOSING_COSTS.bankPointsPct')
  // Bank lender fee is a PERCENT of the loan in the Bible, not a flat $2,500.
  // Old code hardcoded `BANK_LENDER_FEES = 2500` (wrong shape). Consumers now
  // compute bankLoan * LENDER_FEES_PCT (see storage.js groupA_equityRequirement).
  flat.LENDER_FEES_PCT  = req(CC.lenderFeesPct, 'CLOSING_COSTS.lenderFeesPct')        // 0.01
  flat.PITI_RESERVE_MONTHS = req(STOR.pitiReserveMonths, 'STORAGE.pitiReserveMonths')
  flat.WORKING_CAPITAL_PCT = req(STOR.workingCapitalPct, 'STORAGE.workingCapitalPct') // 0.25

  // ── Residential MVM pads (applies to gross income) ───────────────────────
  flat.PAD_LIGHT    = req(RES.expensePads && RES.expensePads.light, 'RESIDENTIAL.expensePads.light')       // 0
  flat.PAD_STANDARD = req(RES.expensePads && RES.expensePads.standard, 'RESIDENTIAL.expensePads.standard') // 0.15 (was stale 0.20)
  flat.PAD_HARSH    = req(RES.expensePads && RES.expensePads.harsh, 'RESIDENTIAL.expensePads.harsh')       // 0.30 (was stale 0.33)

  // ── Residential MAO / hard mode / ARV ────────────────────────────────────
  flat.MAO_FACTOR     = req(RES.arvMultiplier, 'RESIDENTIAL.arvMultiplier')
  flat.CLOSING_RESI   = req(GLOB.closingCostsFlatAmount, 'GLOBAL.closingCostsFlatAmount')
  flat.RATE_OWNER     = req(RES.ownerFinanceRate, 'RESIDENTIAL.ownerFinanceRate')
  flat.ARV_MIN_COMPS  = req(GLOB.arvMinComps, 'GLOBAL.arvMinComps')
  flat.ARV_PERCENTILE = req(GLOB.arvPercentile, 'GLOBAL.arvPercentile')

  // ── Seller kicker (storage Group C upside participation) ─────────────────
  // These three were referenced but NEVER defined by the old loadConstants()
  // (they lived only in a dead defaults.json), so StorageTab rendered NaN.
  flat.WINDOW_YEARS = req(STOR.sellerKicker && STOR.sellerKicker.windowYears, 'STORAGE.sellerKicker.windowYears') // 5
  flat.PCT_DEFAULT  = req(STOR.sellerKicker && STOR.sellerKicker.pctDefault, 'STORAGE.sellerKicker.pctDefault')   // 0.20
  flat.CAP_DEFAULT  = req(STOR.sellerKicker && STOR.sellerKicker.capCumulative, 'STORAGE.sellerKicker.capCumulative') // 50000
  flat.KICKER_DEFAULT = req(GROWTH.noiStretch, 'GROWTH.noiStretch') // 0.05 default kicker growth rate

  // ── Flip holding / selling (ResidentialTab flipper profit) ───────────────
  // Referenced but never defined by the old loadConstants() → flipperProfit
  // rendered NaN and the label printed "Holding (undefined months × $undefined)".
  flat.SELLING_COSTS_PCT = req(GLOB.sellingCostsPercent, 'GLOBAL.sellingCostsPercent') // 0.08
  flat.HOLDING_PER_MONTH = req(GLOB.holdingCostPerMonth, 'GLOBAL.holdingCostPerMonth') // 350
  flat.HOLDING_MONTHS    = req(GLOB.holdingMonthsDefault, 'GLOBAL.holdingMonthsDefault') // 6

  // ── Growth / refi (sunsetTest / rampTest) ────────────────────────────────
  flat.NOI_GROWTH_CONSERVATIVE = req(GROWTH.noiConservative, 'GROWTH.noiConservative') // 0.03
  // 15-yr refi at the Bible's refi rate (7.25%), NOT the old hardcoded 6.5%.
  flat.K_REFI_15 = annualLoanConstant(
    req(REFI.mortgageRate, 'REFI.mortgageRate'),
    req(REFI.amortizationYears, 'REFI.amortizationYears')
  )

  return flat
}

export function annualLoanConstant(annualRate, amortYears) {
  const r = annualRate / 12
  const n = amortYears * 12
  const monthlyFactor = (r * Math.pow(1 + r, n)) / (Math.pow(1 + r, n) - 1)
  return monthlyFactor * 12
}
