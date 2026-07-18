// src/components/analyze/incomeMatrix.js
//
// Builds the standardized Financing Matrix for ANY income/NOI asset
// (Self Storage, Multifamily, Commercial, MHP/RV, Mixed Use). This is a
// REPORTING layer only — it composes existing Math Bible primitives and
// constants. NO new underwriting math, NO changes to src/math/* or defaults.json.
//
// Framework (Math Bible storage Group-A generalized):
//   bankLoan      = noi / (DSCR × K_bank)         (DSCR-sized senior debt)
//   supportedOffer= floor(bankLoan / LTV)          (LTV converts loan → price)
//   equity        = supportedOffer − bankLoan      (borrower's gap)
// Equity cost (8%) and seller financing apply ONLY to that equity gap — never
// the full purchase price (the bank always funds its LTV share).
//
// 8 rows = 4 structures × 2 DSCR lenses (1.25 conservative, 1.15 aggressive):
//   Bank Only · Equity 8% IO · Equity 8% Amortized 25yr · $100k Buyer + Seller FI.
//
// Per-class bank terms (LTV + rate/amort) are pulled/derived from the existing
// engines; everything else (DSCR lenses, 8% equity, 5%/25yr seller note, balloon
// helper, fees, pocket floor) comes straight from loadConstants().

import { loadConstants, annualLoanConstant } from '../../math/constants.js'
import { ownerEquityCost } from '../../math/storage.js'
import { remainingPrincipal } from '../../math/sunsetTest.js'

const BUYER_CASH = 100000
const SELLER_BALLOON_YEARS = 15 // per spec for the $100k + seller structure

// Income assets that use the storage/commercial income-property scenario framework
// (the 8-row financing matrix). Per the Math Bible routing rules:
//   self_storage      → storage terms          (75/25 @ 7.25% / 25-yr)
//   multifamily_large → storage/commercial     (75/25 @ 7.25% / 25-yr) — 20+ units
//   commercial        → commercial terms       (75/25 @ 7%    / 30-yr)
//   mixed_use         → commercial terms       (blended NOI; full split on the Mixed Use tab)
//   mhp_rv            → storage/commercial      (75/25 @ 7.25% / 25-yr; full engine on the MHP tab)
// EXCLUDED (do NOT use this matrix):
//   residential, multifamily_small (1-19) → residential / agency-style math (80/20 @ 7% / 30-yr)
//   ios_land → land supported-intake (no offer engine)
export const INCOME_ASSET_TYPES = ['self_storage', 'multifamily_large', 'commercial', 'mhp_rv', 'mixed_use', 'rv_park', 'ios']

export function isIncomeAsset(typeId) {
  return INCOME_ASSET_TYPES.includes(typeId)
}

// Latest auto-offer cap-multiplier valuation for niche income classes (value =
// NOI × multiplier). Shown alongside the DSCR financing matrix, not instead of it.
export const CAP_MULTIPLIER = { rv_park: 13, ios: 14 }

// Per-class bank terms — LTV is asset-correct per the Math Bible (NOT a blanket
// 0.70). Storage/MF-20+/MHP carry 75/25 @ 7.25%/25yr; commercial carries its own
// engine terms (75/25 @ 7%/30yr). These match the dedicated tabs' engines so the
// Analyze-a-Deal headline reconciles with the Bible (no asset borrows another's math).
export function bankTermsFor(typeId, C) {
  switch (typeId) {
    case 'self_storage':
    case 'multifamily_large':
      return { ltv: C.LTV_STORAGE, K: C.K_BANK_STORAGE, rateLabel: '75/25 LTV · 7.25% / 25-yr (Math Bible storage / commercial income-property terms)' }
    case 'mhp_rv':
      return { ltv: C.LTV_STORAGE, K: C.K_BANK_STORAGE, rateLabel: '75/25 LTV · 7.25% / 25-yr (storage/commercial income terms — use the MHP tab for full lot/POH analysis)' }
    case 'rv_park':
    case 'ios':
      return { ltv: C.LTV_STORAGE, K: C.K_BANK_STORAGE, rateLabel: '75/25 LTV · 7.25% / 25-yr (storage/commercial income terms)' }
    case 'commercial':
    case 'mixed_use':
      // Bible COMMERCIAL terms: 75/25 LTV @ 7.25% / 25-yr (read live via constants).
      // Was hardcoded 7% / 30-yr here — an ~8.6% overpay on every commercial deal.
      return { ltv: C.LTV_COMMERCIAL, K: C.K_BANK_COMMERCIAL, rateLabel: '75/25 LTV · 7.25% / 25-yr (Math Bible commercial income-property terms)' }
    default:
      return { ltv: C.LTV_STORAGE, K: C.K_BANK_STORAGE, rateLabel: '75/25 LTV · 7.25% / 25-yr' }
  }
}

const STRUCTURES = [
  { key: 'bank_only', label: 'Bank Only' },
  { key: 'equity_io', label: 'Equity 8% IO' },
  { key: 'equity_amort', label: 'Equity 8% Amortized' },
  { key: 'seller_fi', label: '$100k Buyer + Seller Finance' }
]

function round1000(n) { return Math.floor(n / 1000) * 1000 }

// Build one matrix row for a given structure + DSCR lens.
function buildRow(structureKey, label, dscr, noi, terms, C) {
  const bankLoanRaw = noi / (dscr * terms.K)
  const supportedOffer = round1000(bankLoanRaw / terms.ltv)
  const bankLoan = Math.round(supportedOffer * terms.ltv)
  const equity = supportedOffer - bankLoan
  const bankPayment = bankLoan * terms.K

  let borrowerBrings = equity      // cash the borrower must bring
  let borrowerCost = 0             // annual cost of the borrower's equity capital
  let sellerFinance = 0
  let sellerPayment = 0
  let balloon = 0

  if (structureKey === 'equity_io') {
    borrowerCost = ownerEquityCost(equity, 'io')        // equity × 8%
  } else if (structureKey === 'equity_amort') {
    borrowerCost = ownerEquityCost(equity, 'amort')     // equity × K_OWNER_AMORT (8%/25yr)
  } else if (structureKey === 'seller_fi') {
    const buyerCash = Math.min(BUYER_CASH, equity)
    sellerFinance = Math.max(0, equity - BUYER_CASH)
    borrowerBrings = buyerCash
    borrowerCost = ownerEquityCost(buyerCash, 'io')     // 8% IO on the $100k only
    sellerPayment = sellerFinance * C.K_SELLER          // seller note 5%/25yr
    balloon = sellerFinance > 0
      // remainingPrincipal expects an annual LOAN CONSTANT as arg 2 (see
      // sunsetTest.js which calls it with C.K_SELLER). Passing C.RATE_SELLER (0.05)
      // understated the amortization and produced a wrong balloon on every
      // seller-finance row.
      ? remainingPrincipal(sellerFinance, C.K_SELLER, C.AMORT_SELLER, SELLER_BALLOON_YEARS)
      : 0
  }

  const totalCapitalCost = bankPayment + borrowerCost + sellerPayment
  const pocketMoney = noi - totalCapitalCost
  const cashInvested = borrowerBrings // operator's actual cash in the deal

  return {
    structureKey,
    structure: label,
    dscr,
    noi,
    offer: supportedOffer,
    bank: bankLoan,
    borrower: borrowerBrings,
    sellerFi: sellerFinance,
    bankPayment,
    borrowerCost,
    sellerPayment,
    totalCapitalCost,
    pocketMoney,
    balloon,
    // derived ratios (existing-output ratios, not new underwriting):
    capRate: supportedOffer > 0 ? noi / supportedOffer : null,
    debtYield: bankLoan > 0 ? noi / bankLoan : null,
    cashOnCash: cashInvested > 0 ? pocketMoney / cashInvested : null,
    clearsPocketFloor: pocketMoney >= C.POCKET_FLOOR
  }
}

// Main: returns the 8 rows (in spec order), a summary, a practical
// recommendation, and the documented assumptions.
export function buildIncomeMatrix({ assetType, noi }) {
  const C = loadConstants()
  const terms = bankTermsFor(assetType, C)
  const lenses = [C.DSCR_CONSERVATIVE, C.DSCR_STRETCH] // 1.25, 1.15

  // Spec row order: structure-major, DSCR 1.25 then 1.15 within each structure.
  const rows = []
  for (const s of STRUCTURES) {
    for (const dscr of lenses) {
      rows.push(buildRow(s.key, s.label, dscr, noi, terms, C))
    }
  }

  const bankOnly125 = rows.find(r => r.structureKey === 'bank_only' && r.dscr === C.DSCR_CONSERVATIVE)
  const bankOnly115 = rows.find(r => r.structureKey === 'bank_only' && r.dscr === C.DSCR_STRETCH)

  // SELLER-FINANCED MAXIMUM (Math Bible Group B): when the financed portion
  // carries the 5% seller rate instead of the bank rate, the same NOI/DSCR
  // supports a HIGHER price (cheaper debt). This is the bible's groupB formula
  // (maxPurchase = noi / (dscr × LTV × K_SELLER)) — the seller's incentive to
  // carry paper is this higher price. Exposed so seller finance is tested both
  // ways: (A) same offer / lower cash (the 8 rows above) and (B) higher offer.
  const groupB = (dscr) => round1000(noi / (dscr * terms.ltv * C.K_SELLER))
  const sellerFinanced = {
    conservative: groupB(C.DSCR_CONSERVATIVE),
    aggressive: groupB(C.DSCR_STRETCH),
    note: 'Group B — financed portion at the 5% seller rate; higher supported price than bank-rate debt.'
  }

  const pockets = rows.map(r => r.pocketMoney)
  const offers = rows.map(r => r.offer).concat([sellerFinanced.conservative, sellerFinanced.aggressive])

  const capMultiple = CAP_MULTIPLIER[assetType] || null
  const summary = {
    noi,
    assetType,
    capMultiple,                                  // RV ×13 / IOS ×14 (else null)
    capMultipleValue: capMultiple ? Math.round(noi * capMultiple) : null,
    conservativeValue: bankOnly125.offer,        // 1.25 bank-only
    aggressiveValue: bankOnly115.offer,           // 1.15 bank-only
    bestSellerFinanceValue: sellerFinanced.aggressive, // Group B @1.15 — highest supportable via cheaper seller debt
    sellerFinanced,
    pocketRange: [Math.min(...pockets), Math.max(...pockets)],
    offerRange: [Math.min(...offers), Math.max(...offers)],
    recommendedOfferRange: [bankOnly125.offer, sellerFinanced.aggressive]
  }

  const recommendation = buildRecommendation(rows, summary, C)

  const assumptions = {
    bankLtv: terms.ltv,
    bankTerms: terms.rateLabel,
    dscrLenses: lenses,
    equityRate: '8% (IO = 8% interest-only; Amortized = 8% / 25-yr)',
    sellerNote: `5% / ${C.AMORT_SELLER}-yr, balloon at year ${SELLER_BALLOON_YEARS}`,
    buyerCashInSellerStructure: BUYER_CASH,
    pocketFloor: C.POCKET_FLOOR,
    note: 'Bank funds its LTV share; equity cost and seller financing apply ONLY to the equity gap, never the full price. Per-asset LTV is Math-Bible-correct (storage/MF-20+ 75/25; commercial 75/25).'
  }

  return { rows, summary, recommendation, assumptions, bankTerms: terms }
}

// Practical recommendation — not just the highest offer. Compares bank-only vs
// the Group B seller-financed price; if within 5%, prefers the simplest (bank-only).
function buildRecommendation(rows, summary, C) {
  const notes = []
  const bankOnly125 = rows.find(r => r.structureKey === 'bank_only' && r.dscr === 1.25)
  const bankOnly115 = rows.find(r => r.structureKey === 'bank_only' && r.dscr === 1.15)
  const amort125 = rows.find(r => r.structureKey === 'equity_amort' && r.dscr === 1.25)
  const sellerB = summary.sellerFinanced.conservative   // Group B @1.25
  const sellerDelta = sellerB - bankOnly125.offer       // how much cheaper seller debt raises the price

  if (sellerDelta > bankOnly125.offer * 0.05) {
    notes.push(`Seller financing (5%) supports a materially higher price at 1.25 DSCR — about ${fmtSigned(sellerDelta)} over bank-only ($${sellerB.toLocaleString()} vs $${bankOnly125.offer.toLocaleString()}). Worth pursuing if the seller will carry paper; the higher price is the seller's incentive.`)
  } else {
    notes.push(`Seller financing raises the supported price by only ${fmtSigned(sellerDelta)} at 1.25 DSCR (within 5%) — keep it simple with bank-only unless the seller needs the price bump or you want to reduce cash in.`)
  }

  // Equity-cost caution (the financed-with-your-own-money case).
  if (amort125.pocketMoney < C.POCKET_FLOOR) {
    notes.push(`Funding the equity with amortized 8% capital drops pocket money to $${Math.round(amort125.pocketMoney).toLocaleString()} (below the $${C.POCKET_FLOOR.toLocaleString()} floor) — interest-only equity or seller financing preserves cash flow.`)
  }

  // Aggressive lens caution.
  if (bankOnly115.pocketMoney < C.POCKET_FLOOR) {
    notes.push(`At 1.15 DSCR the deal clears a higher bank offer ($${bankOnly115.offer.toLocaleString()}) but pocket money falls to $${Math.round(bankOnly115.pocketMoney).toLocaleString()} — aggressive; little margin for vacancy/expense surprises.`)
  } else {
    notes.push(`1.15 DSCR supports up to $${bankOnly115.offer.toLocaleString()} bank-only with $${Math.round(bankOnly115.pocketMoney).toLocaleString()} pocket — usable but tighter than the 1.25 case.`)
  }

  const headline = sellerDelta > bankOnly125.offer * 0.05
    ? `Recommended: pursue seller financing — it supports up to $${sellerB.toLocaleString()} at 1.25 DSCR (Group B), vs $${bankOnly125.offer.toLocaleString()} bank-only. Conservative bank-only floor is $${bankOnly125.offer.toLocaleString()}.`
    : `Recommended: Bank-Only at 1.25 DSCR ($${bankOnly125.offer.toLocaleString()}). Seller financing doesn't raise the price enough to justify the complexity — use it only to reduce cash in.`

  return { headline, notes }
}

function fmtSigned(n) {
  const s = Math.round(n)
  return (s >= 0 ? '+$' : '-$') + Math.abs(s).toLocaleString()
}
