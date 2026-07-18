// PORTED FROM gorilla-ai/lib/math/storage.js@63c651c on 2026-05-08
// Math is verbatim. Modifications: CommonJS → ESM only.
// Math Bible v3 — Group A/B/C max purchase, pocket cash, equity required.
//
// CoC POLICY for Baby Analyzer: Math Bible computes maxPurchase, pocketCash, and
// equityRequirement separately. CoC is derived as pocketCash ÷ totalEquityRequired
// at the UI layer using these Math Bible primitives. Fast Calc V2.6's offer-based
// CoC fix is intentionally NOT backported — Math Bible's maxPurchase-based math
// produces the more conservative ("tougher") result, which is what Baby Analyzer
// is for. (Code isolation — no cross-tab imports — stays; but drift in the NUMBERS
// is NOT acceptable: every constant here reads from the live Bible via loadConstants.)

import { loadConstants } from './constants.js'

export function storageNOI(grossDollarsIn, sellerStatedExpensePct) {
  const C = loadConstants()
  const expenseRatio = Math.max(sellerStatedExpensePct || 0, C.EXPENSE_FLOOR)
  const expenses = grossDollarsIn * expenseRatio
  return {
    grossDollarsIn,
    expenseRatio,
    expenses,
    noi: grossDollarsIn - expenses,
    floorBinds: expenseRatio === C.EXPENSE_FLOOR
  }
}

export function groupA_maxPurchase(noi, dscrLens, rehab = 0) {
  const C = loadConstants()
  const annualBankFactor = C.LTV_STORAGE * C.K_BANK_STORAGE
  const maxPurchase = noi / (dscrLens * annualBankFactor)
  const rounded = Math.floor(maxPurchase / 1000) * 1000
  return {
    group: 'A',
    dscrLens,
    maxPurchase: rounded,
    yourOffer: rounded - C.WHOLESALE_FEE - (rehab || 0),
    bankAnnualDS: rounded * annualBankFactor,
    equityAmount: rounded * (1 - C.LTV_STORAGE),
    requiresRampTest: dscrLens === C.DSCR_STRETCH
  }
}

export function groupB_maxPurchase(noi, dscrLens, rehab = 0) {
  const C = loadConstants()
  const annualSellerFactor = C.LTV_STORAGE * C.K_SELLER
  const maxPurchase = noi / (dscrLens * annualSellerFactor)
  const rounded = Math.floor(maxPurchase / 1000) * 1000
  return {
    group: 'B',
    dscrLens,
    maxPurchase: rounded,
    yourOffer: rounded - C.WHOLESALE_FEE - (rehab || 0),
    sellerAnnualDS: rounded * annualSellerFactor,
    equityAmount: rounded * (1 - C.LTV_STORAGE),
    dscrInformational: true,
    requiresRampTest: dscrLens === C.DSCR_STRETCH
  }
}

export function groupC_maxPurchase(noi, dscrLens, rehab = 0) {
  const C = loadConstants()
  const annualBankFactor = C.LTV_STORAGE * C.K_BANK_STORAGE
  const maxPurchase = noi / (dscrLens * annualBankFactor)
  const rounded = Math.floor(maxPurchase / 1000) * 1000
  const equityAmount = rounded * (1 - C.LTV_STORAGE)
  return {
    group: 'C',
    dscrLens,
    maxPurchase: rounded,
    yourOffer: rounded - C.WHOLESALE_FEE - (rehab || 0),
    bankAnnualDS: rounded * annualBankFactor,
    sellerAnnualPI: equityAmount * C.K_SELLER,
    equityAmount,
    requiresRampTest: dscrLens === C.DSCR_STRETCH
  }
}

export function pocketCash(noi, bankDS, sellerDS, ownerEquityCost, kickerPayment) {
  const C = loadConstants()
  const cash = noi - (bankDS || 0) - (sellerDS || 0) - (ownerEquityCost || 0) - (kickerPayment || 0)
  return {
    pocketCash: cash,
    clearsFloor: cash >= C.POCKET_FLOOR,
    flag: cash >= C.POCKET_FLOOR ? 'CLEARS_FLOOR' : 'BELOW_POCKET_FLOOR'
  }
}

export function ownerEquityCost(equityAmount, treatment) {
  const C = loadConstants()
  if (treatment === 'sunk')   return 0
  if (treatment === 'io')     return equityAmount * C.K_OWNER_IO
  if (treatment === 'amort')  return equityAmount * C.K_OWNER_AMORT
  throw new Error(`Unknown owner equity treatment: ${treatment}`)
}

export function groupA_equityRequirement(maxPurchase, bankDS, annualOpEx) {
  const C = loadConstants()
  const bankLoan = maxPurchase * C.LTV_STORAGE
  const lineItems = {
    downPayment:    maxPurchase * (1 - C.LTV_STORAGE),
    points:         bankLoan * C.BANK_POINTS_PCT,
    lenderFees:     bankLoan * C.LENDER_FEES_PCT,   // Bible lenderFeesPct (1% of loan), not a flat $2,500
    legal:          C.LEGAL,
    titleInsurance: bankLoan * C.TITLE_PCT,
    environmental:  C.ENVIRONMENTAL,
    appraisal:      C.APPRAISAL,
    survey:         C.SURVEY,
    insuranceSetup: C.INSURANCE_SETUP,
    pitiReserve:    bankDS / (12 / C.PITI_RESERVE_MONTHS)
  }
  const cashToClose = Object.values(lineItems).reduce((a, b) => a + b, 0)
  const workingCapital = annualOpEx * C.WORKING_CAPITAL_PCT
  return {
    lineItems,
    cashToClose,
    workingCapital,
    totalEquityRequired: cashToClose + workingCapital
  }
}
