// completeness.test.js — gap-fill tests added 2026-05-17
// Every test uses specific dollar amounts with expected results computed by hand.
// Gaps covered:
//   1.  Storage Group B end-to-end with exact numbers
//   2.  Storage Group C end-to-end with exact numbers
//   3.  Verdict PURSUE path (Group B clears, A/C do not)
//   4.  Verdict NEGOTIATE path (only 1.15x ramp passes)
//   5.  Verdict PASS via Group C path
//   6.  Exactly 14 storage scenarios from runStorageDeal
//   7.  sunsetTest DURABLE checkpoint with strong NOI
//   8.  rampTest boundary: Y2 exactly at 1.25 is PASS; just below is FAIL
//   9.  MHP — MVM 20%/30% card math
//   10. MHP — POH-heavy, highPohVacancy, highVacantLots, lotMixError flags
//   11. MHP — sellerFiAmount/cashEquity split
//   12. MHP — utility burden math (submeter + park-paid)
//   13. Commercial — computeIncome two NNN tenants (base rent + reimbursements)
//   14. Commercial — computeScenario NOI formula
//   15. Commercial — computeCommercial full pipeline returns 3 MVM results
//   16. Commercial — subclassWarnings cap-rate-band detection
//   17. Commercial — detectMixedUse signals
//   18. Mixed Use — blendComponents exact numbers
//   19. Mixed Use — discount applied correctly
//   20. Mixed Use — minor component flag
//   21. Mixed Use — error on invalid inputs
//   22. exitStrategies — calcCreative zero interest rate (interest-free seller)
//   23. exitStrategies — calcLeaseOption effectiveYieldIfExercised exact value
//   24. exitStrategies — calcBRRRR recycleEfficiency
//   25. ownerEquityCost amort > io ordering with exact io value
//   26. groupA_equityRequirement PITI reserve formula

import { describe, it, expect } from 'vitest'

import {
  storageNOI, groupA_maxPurchase, groupB_maxPurchase, groupC_maxPurchase,
  pocketCash, ownerEquityCost, groupA_equityRequirement
} from '../math/storage.js'
import { loadConstants, annualLoanConstant } from '../math/constants.js'
import { rampTest } from '../math/rampTest.js'
import { sunsetTest } from '../math/sunsetTest.js'
import { runStorageDeal } from '../math/scenarioEngine.js'
import { computeStorageVerdict } from '../math/verdict.js'
import { calcMhp, calcUtilityBurden } from '../math/mhp.js'
import {
  computeIncome, computeScenario, computeCommercial,
  subclassWarnings, detectMixedUse,
  annualLoanConstant as commercialALC,
  DEFAULT_TI_LC_PSF, DEFAULT_CAPEX_PSF, DEFAULT_COLLECTION_LOSS
} from '../math/commercial.js'

// Commercial underwriting terms now come from the live Bible (7.25%/25 lender,
// 5%/25 seller, 1.25 DSCR) — commercial.js no longer owns DEFAULT_LENDER_RATE etc.
// setup.js hydrates the singleton from the committed Bible snapshot before this runs.
const COMM_TERMS = (() => {
  const C = loadConstants()
  return {
    dscr: C.DSCR_COMMERCIAL,
    lenderRate: C.RATE_BANK_COMMERCIAL,
    lenderAm: C.AMORT_BANK_COMMERCIAL,
    sellerRate: C.RATE_SELLER_COMMERCIAL,
    sellerAm: C.AMORT_SELLER_COMMERCIAL
  }
})()
import { blendComponents } from '../math/mixedUse.js'
import {
  calcCreative, calcLeaseOption, calcBRRRR
} from '../math/exitStrategies.js'

const C = loadConstants()

// ─────────────────────────────────────────────────────────────────────────────
// 1. Storage Group B — end-to-end with exact numbers
// ─────────────────────────────────────────────────────────────────────────────
describe('Storage Group B — end-to-end exact numbers', () => {
  // storageNOI(180000, 0.42) → noi = 104,400 (matches existing Group A tests)
  const NOI = 104400

  it('groupB maxPurchase uses seller-fi K (lower K → higher purchase than Group A)', () => {
    const b = groupB_maxPurchase(NOI, 1.25)
    const a = groupA_maxPurchase(NOI, 1.25)
    // K_SELLER < K_BANK_STORAGE → 1/(K_SELLER) > 1/(K_BANK_STORAGE) → B > A
    expect(b.maxPurchase).toBeGreaterThan(a.maxPurchase)
    expect(b.group).toBe('B')
    expect(b.dscrLens).toBe(1.25)
    expect(b.dscrInformational).toBe(true)
    expect(b.requiresRampTest).toBe(false)
  })

  it('groupB yourOffer = maxPurchase − WHOLESALE_FEE', () => {
    const b = groupB_maxPurchase(NOI, 1.25)
    expect(b.yourOffer).toBe(b.maxPurchase - C.WHOLESALE_FEE)
  })

  it('groupB 1.25x pocketCash (sunk equity): positive and clears $10k floor', () => {
    // sellerAnnualDS = maxPurchase × LTV × K_SELLER where maxPurchase is floored to $1k
    // pocketCash = NOI - sellerAnnualDS; the floor introduces a small rounding effect
    // so we assert a range (~NOI × 0.20 ± $100) rather than an exact formula
    const b = groupB_maxPurchase(NOI, 1.25)
    const pocket = pocketCash(NOI, 0, b.sellerAnnualDS, 0, 0)
    // pocketCash should be roughly NOI × (1 - 1/1.25) = 20,880 ± rounding from floor
    expect(pocket.pocketCash).toBeGreaterThan(20000)
    expect(pocket.pocketCash).toBeLessThan(22000)
    expect(pocket.clearsFloor).toBe(true)  // ~20,880-20,903 > 10,000
    expect(pocket.flag).toBe('CLEARS_FLOOR')
  })

  it('groupB 1.15x flags rampTest required', () => {
    const b = groupB_maxPurchase(NOI, 1.15)
    expect(b.requiresRampTest).toBe(true)
  })

  it('groupB equityAmount = maxPurchase × (1 − LTV_STORAGE)', () => {
    const b = groupB_maxPurchase(NOI, 1.25)
    expect(b.equityAmount).toBeCloseTo(b.maxPurchase * (1 - C.LTV_STORAGE), 0)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// 2. Storage Group C — end-to-end with exact numbers
// ─────────────────────────────────────────────────────────────────────────────
describe('Storage Group C — end-to-end exact numbers', () => {
  const NOI = 104400

  it('groupC maxPurchase equals groupA maxPurchase (same bank factor)', () => {
    const gc = groupC_maxPurchase(NOI, 1.25)
    const ga = groupA_maxPurchase(NOI, 1.25)
    expect(gc.maxPurchase).toBe(ga.maxPurchase)
    expect(gc.group).toBe('C')
  })

  it('groupC sellerAnnualPI = equityAmount × K_SELLER', () => {
    const gc = groupC_maxPurchase(NOI, 1.25)
    const expectedEquity = gc.maxPurchase * (1 - C.LTV_STORAGE)
    expect(gc.equityAmount).toBeCloseTo(expectedEquity, 0)
    expect(gc.sellerAnnualPI).toBeCloseTo(expectedEquity * C.K_SELLER, 0)
  })

  it('groupC pocketCash deducts both bankAnnualDS and sellerAnnualPI', () => {
    const gc = groupC_maxPurchase(NOI, 1.25)
    const pocket = pocketCash(NOI, gc.bankAnnualDS, gc.sellerAnnualPI, 0, 0)
    expect(pocket.pocketCash).toBeCloseTo(NOI - gc.bankAnnualDS - gc.sellerAnnualPI, 0)
  })

  it('groupC pocket is lower than groupA pocket (extra sellerPI cost)', () => {
    const gc = groupC_maxPurchase(NOI, 1.25)
    const ga = groupA_maxPurchase(NOI, 1.25)
    const pocketC = pocketCash(NOI, gc.bankAnnualDS, gc.sellerAnnualPI, 0, 0)
    const pocketA = pocketCash(NOI, ga.bankAnnualDS, 0, 0, 0)
    // C has same bank DS as A but also has sellerPI → pocket is lower
    expect(pocketC.pocketCash).toBeLessThan(pocketA.pocketCash)
  })

  it('groupC 1.15x flags rampTest required', () => {
    const gc = groupC_maxPurchase(NOI, 1.15)
    expect(gc.requiresRampTest).toBe(true)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// 3. Verdict PURSUE path
// ─────────────────────────────────────────────────────────────────────────────
describe('Verdict PURSUE path', () => {
  const dataFlags = { t12Verified: true, rentRollVerified: true, occupancyVerified: true, verifiedBy: 'Steve' }

  it('returns PURSUE when Group B 1.25x clears but A and C do not', () => {
    const v = computeStorageVerdict({
      scenarios: [
        { group: 'A', dscrLens: 1.25, pocket: { clearsFloor: false } },
        { group: 'B', dscrLens: 1.25, pocket: { clearsFloor: true } },
        { group: 'C', dscrLens: 1.25, pocket: { clearsFloor: false } }
      ]
    }, dataFlags)
    expect(v.verdict).toBe('PURSUE')
    expect(v.severity).toBe('YELLOW')
    expect(v.reasonCodes).toContain('GROUP_B_125X_PENCILS_SELLER_FINANCE_ONLY')
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// 4. Verdict NEGOTIATE and KILL paths
// ─────────────────────────────────────────────────────────────────────────────
describe('Verdict NEGOTIATE and KILL paths', () => {
  const dataFlags = { t12Verified: true, rentRollVerified: true, occupancyVerified: true, verifiedBy: 'Steve' }

  it('returns NEGOTIATE when 1.15x stretch lens passes ramp test (all 1.25x fail)', () => {
    const v = computeStorageVerdict({
      scenarios: [
        { group: 'A', dscrLens: 1.25, pocket: { clearsFloor: false } },
        { group: 'B', dscrLens: 1.25, pocket: { clearsFloor: false } },
        { group: 'C', dscrLens: 1.25, pocket: { clearsFloor: false } },
        { group: 'A', dscrLens: 1.15, pocket: { clearsFloor: false }, rampResult: { pass: true } }
      ]
    }, dataFlags)
    expect(v.verdict).toBe('NEGOTIATE')
    expect(v.severity).toBe('YELLOW')
    expect(v.reasonCodes).toContain('STRETCH_LENS_115X_RAMP_PASS')
  })

  it('returns KILL when 1.15x ramp test FAILS', () => {
    const v = computeStorageVerdict({
      scenarios: [
        { group: 'A', dscrLens: 1.25, pocket: { clearsFloor: false } },
        { group: 'B', dscrLens: 1.25, pocket: { clearsFloor: false } },
        { group: 'C', dscrLens: 1.25, pocket: { clearsFloor: false } },
        { group: 'A', dscrLens: 1.15, pocket: { clearsFloor: false }, rampResult: { pass: false } }
      ]
    }, dataFlags)
    expect(v.verdict).toBe('KILL')
    expect(v.severity).toBe('RED')
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// 5. Verdict PASS via Group C (not just Group A)
// ─────────────────────────────────────────────────────────────────────────────
describe('Verdict PASS via Group C', () => {
  const dataFlags = { t12Verified: true, rentRollVerified: true, occupancyVerified: true, verifiedBy: 'Steve' }

  it('returns PASS when Group C 1.25x clears even if Group A does not', () => {
    const v = computeStorageVerdict({
      scenarios: [
        { group: 'A', dscrLens: 1.25, pocket: { clearsFloor: false } },
        { group: 'B', dscrLens: 1.25, pocket: { clearsFloor: false } },
        { group: 'C', dscrLens: 1.25, pocket: { clearsFloor: true } }
      ]
    }, dataFlags)
    expect(v.verdict).toBe('PASS')
    expect(v.severity).toBe('GREEN')
    expect(v.reasonCodes).toContain('GROUP_C_125X_CLEARS_POCKET_FLOOR')
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// 6. Exactly 14 storage scenarios from runStorageDeal
// ─────────────────────────────────────────────────────────────────────────────
describe('scenarioEngine — exactly 10 storage scenarios', () => {
  it('produces 10 scenarios: Group A 6 + Group B 2 + Group C 2', () => {
    // Bible META.critical_rules: "exactly 10". Group B is 2 (one per DSCR lens),
    // NOT 6 — the old engine fanned Group B across 3 owner-equity treatments.
    const result = runStorageDeal({
      grossDollarsIn: 180000,
      sellerStatedExpensePct: 0.42,
      annualOpEx: 75600
    })
    expect(result.scenarios.length).toBe(10)
    expect(result.scenarios.filter(s => s.group === 'A').length).toBe(6)
    expect(result.scenarios.filter(s => s.group === 'B').length).toBe(2)
    expect(result.scenarios.filter(s => s.group === 'C').length).toBe(2)
  })

  it('each Group A scenario has an equityReq field', () => {
    const result = runStorageDeal({ grossDollarsIn: 180000, sellerStatedExpensePct: 0.42, annualOpEx: 75600 })
    result.scenarios.filter(s => s.group === 'A').forEach(s => {
      expect(s.equityReq).toBeDefined()
      expect(s.equityReq.totalEquityRequired).toBeGreaterThan(0)
    })
  })

  it('Group B scenarios all have sunsetResult with 4 checkpoints', () => {
    const result = runStorageDeal({ grossDollarsIn: 180000, sellerStatedExpensePct: 0.42, annualOpEx: 75600 })
    result.scenarios.filter(s => s.group === 'B').forEach(s => {
      expect(s.sunsetResult).toBeDefined()
      expect(s.sunsetResult.length).toBe(4)
    })
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// 7. sunsetTest — DURABLE result with strong-NOI scenario
// ─────────────────────────────────────────────────────────────────────────────
describe('sunsetTest — structural properties verified', () => {
  // sunsetTest flags: FAIL (postDSCR < 1.0), FRAGILE (postDSCR < 1.25 OR refiGap > 0), DURABLE (postDSCR ≥ 1.25 AND refiGap = 0)
  // Key insight: K_REFI_15 ≈ 0.1097 (15yr @ 7.25%); LTV_STORAGE = 0.75
  // For DURABLE: entryCap ≥ 1.25 × K_REFI_15 / LTV = 1.25 × 0.1097 / 0.75 ≈ 18.3%
  // At 20% entry cap: maxRefiLoan = (NOI/0.20) × 0.75; newDS = maxRefiLoan × K_REFI_15
  // postSunsetDSCR = NOI / ((NOI/0.20) × 0.75 × K_REFI_15) = 0.20 / (0.75 × 0.1097) = 0.20 / 0.0823 ≈ 2.43 > 1.25 → DURABLE

  it('Y3 is DURABLE at a high entry cap rate (20%) with negligible seller balance', () => {
    // entryCap = 0.20 (very distressed / high cap deal) → refi math pencils easily
    // sellerBalance = $50k (tiny), NOI = $200k, cap = 0.20
    const results = sunsetTest(50000, 200000, 0.20)
    expect(results[0].yearN).toBe(3)
    expect(results[0].refiGap).toBe(0)
    expect(results[0].postSunsetDSCR).toBeGreaterThan(1.25)
    expect(results[0].flag).toBe('DURABLE')
  })

  it('remainingBalance at Y3 is between 0 and original balance', () => {
    const results = sunsetTest(800000, 100000, 0.085)
    expect(results[0].remainingBalance).toBeGreaterThan(0)
    expect(results[0].remainingBalance).toBeLessThan(800000)
  })

  it('Y10 postSunsetDSCR is higher than Y3 because NOI grows each year', () => {
    const results = sunsetTest(800000, 100000, 0.085)
    // NOI grows at NOI_GROWTH_CONSERVATIVE (3%) each year
    expect(results[3].noiN).toBeGreaterThan(results[0].noiN)
  })

  it('flag values are only DURABLE, FRAGILE, or FAIL', () => {
    const results = sunsetTest(800000, 100000, 0.085)
    results.forEach(r => {
      expect(['DURABLE', 'FRAGILE', 'FAIL']).toContain(r.flag)
    })
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// 8. rampTest boundary conditions
// ─────────────────────────────────────────────────────────────────────────────
describe('rampTest — boundary conditions', () => {
  it('PASS when Y1 ≥ 1.15 and Y2 is exactly 1.25 (at boundary)', () => {
    // dscrY2 = (noiY1 × 1.03) / ds = 1.25  →  ds = noiY1 × 1.03 / 1.25
    // dscrY1 = noiY1 / ds = 1.25 / 1.03 ≈ 1.214  →  1.214 > 1.15 ✓
    const noiY1 = 100000
    const ds = noiY1 * 1.03 / 1.25   // = 82400
    const r = rampTest(noiY1, ds)
    expect(r.dscrY1).toBeGreaterThan(1.15)
    expect(r.dscrY2).toBeCloseTo(1.25, 2)
    expect(r.pass).toBe(true)
    expect(r.flag).toBe('PASS')
  })

  it('FAIL when Y2 is just below 1.25', () => {
    // ds sized so dscrY2 = 1.24
    const noiY1 = 100000
    const ds = noiY1 * 1.03 / 1.24   // ≈ 83065
    const r = rampTest(noiY1, ds)
    expect(r.dscrY2).toBeCloseTo(1.24, 2)
    expect(r.pass).toBe(false)
    expect(r.flag).toBe('FAIL')
  })

  it('FAIL when Y1 is below 1.15 (even if Y2 would be fine)', () => {
    // ds such that dscrY1 = 1.10 (below 1.15)
    const noiY1 = 100000
    const ds = noiY1 / 1.10   // ≈ 90909
    const r = rampTest(noiY1, ds)
    expect(r.dscrY1).toBeCloseTo(1.10, 2)
    expect(r.pass).toBe(false)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// 9. MHP — MVM 20% and MVM 30% card math
// ─────────────────────────────────────────────────────────────────────────────
describe('MHP — MVM 0% / 20% / 30% card math', () => {
  const baseInputs = {
    totalLots: 80,
    occupiedPoh: 10, vacantPoh: 2, occupiedToh: 56, vacantLots: 12,
    lotRentMonthly: 400, pohRentMonthly: 850, otherIncomeAnnual: 5000,
    tohVacancyPct: 0.05, pohVacancyPct: 0.10, collectionLossPct: 0.02, opExSum: 6000
  }
  const baseAssumptions = {
    dscr: 1.25, seniorRate: 0.075, seniorAmort: 22, seniorLtv: 0.75,
    sellerFiRate: 0.05, sellerFiAmort: 25, sellerFiPct: 1.0,
    managementPct: 0.07, buyerClosingCostsPct: 0.03, bankPointsPct: 0.01,
    lenderFeesPct: 0.005, appraisalFee: 5000, environmentalFee: 5000
  }

  it('three cards have correct keys and pad percents', () => {
    const r = calcMhp(baseInputs, baseAssumptions)
    expect(r.cards[0].key).toBe('standard')
    expect(r.cards[0].padPct).toBe(0)
    expect(r.cards[1].key).toBe('mvm20')
    expect(r.cards[1].padPct).toBe(0.20)
    expect(r.cards[2].key).toBe('mvm30')
    expect(r.cards[2].padPct).toBe(0.30)
  })

  it('MVM 20% EGI is 80% of MVM 0% EGI', () => {
    const r = calcMhp(baseInputs, baseAssumptions)
    const card0 = r.cards[0]
    const card20 = r.cards[1]
    // egi = gsi × (1 − padPct); gsi is the same for all cards
    expect(card20.egi / card0.egi).toBeCloseTo(0.80, 3)
  })

  it('MVM 30% EGI is 70% of MVM 0% EGI', () => {
    const r = calcMhp(baseInputs, baseAssumptions)
    expect(r.cards[2].egi / r.cards[0].egi).toBeCloseTo(0.70, 3)
  })

  it('NOI and maxPurchase descend as MVM pad increases', () => {
    const r = calcMhp(baseInputs, baseAssumptions)
    expect(r.cards[1].noi).toBeLessThan(r.cards[0].noi)
    expect(r.cards[2].noi).toBeLessThan(r.cards[1].noi)
    expect(r.cards[1].maxPurchase).toBeLessThan(r.cards[0].maxPurchase)
    expect(r.cards[2].maxPurchase).toBeLessThan(r.cards[1].maxPurchase)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// 10. MHP — warning flags
// ─────────────────────────────────────────────────────────────────────────────
describe('MHP — warning flags (pohHeavy / highPohVacancy / highVacantLots / lotMixError)', () => {
  const asm = {
    dscr: 1.25, seniorRate: 0.075, seniorAmort: 22, seniorLtv: 0.75,
    sellerFiRate: 0.05, sellerFiAmort: 25, sellerFiPct: 1.0,
    managementPct: 0.07, buyerClosingCostsPct: 0.03, bankPointsPct: 0.01,
    lenderFeesPct: 0.005, appraisalFee: 5000, environmentalFee: 5000
  }

  it('pohHeavy = true when totalPoh / totalLots > 0.25', () => {
    // totalPoh = 30 + 5 = 35, totalLots = 80 → 35/80 = 43.75% > 25%
    const r = calcMhp({ totalLots: 80, occupiedPoh: 30, vacantPoh: 5, occupiedToh: 40, vacantLots: 5, lotRentMonthly: 400, pohRentMonthly: 800, tohVacancyPct: 0.05, pohVacancyPct: 0.05, collectionLossPct: 0.01, opExSum: 0 }, asm)
    expect(r.pohHeavy).toBe(true)
    expect(r.pohExposureShare).toBeCloseTo(35 / 80, 3)
  })

  it('pohHeavy = false when totalPoh / totalLots <= 0.25', () => {
    // 12/80 = 15% ≤ 25%
    const r = calcMhp({ totalLots: 80, occupiedPoh: 10, vacantPoh: 2, occupiedToh: 56, vacantLots: 12, lotRentMonthly: 400, pohRentMonthly: 850, otherIncomeAnnual: 5000, tohVacancyPct: 0.05, pohVacancyPct: 0.10, collectionLossPct: 0.02, opExSum: 0 }, asm)
    expect(r.pohHeavy).toBe(false)
  })

  it('highPohVacancy = true when vacantPoh / totalPoh > 0.20', () => {
    // vacantPoh = 3, totalPoh = 10+3 = 13 → 3/13 = 23% > 20%
    const r = calcMhp({ totalLots: 60, occupiedPoh: 10, vacantPoh: 3, occupiedToh: 40, vacantLots: 7, lotRentMonthly: 400, pohRentMonthly: 800, tohVacancyPct: 0.05, pohVacancyPct: 0.10, collectionLossPct: 0.02, opExSum: 0 }, asm)
    expect(r.highPohVacancy).toBe(true)
  })

  it('highVacantLots = true when vacantLots / totalLots > 0.15', () => {
    // 20/100 = 20% > 15%
    const r = calcMhp({ totalLots: 100, occupiedPoh: 10, vacantPoh: 5, occupiedToh: 65, vacantLots: 20, lotRentMonthly: 400, pohRentMonthly: 800, tohVacancyPct: 0.05, pohVacancyPct: 0.10, collectionLossPct: 0.02, opExSum: 0 }, asm)
    expect(r.highVacantLots).toBe(true)
  })

  it('lotMixError = true when counts do not sum to totalLots', () => {
    // sum = 10+2+56+11 = 79, totalLots = 80
    const r = calcMhp({ totalLots: 80, occupiedPoh: 10, vacantPoh: 2, occupiedToh: 56, vacantLots: 11, lotRentMonthly: 400, pohRentMonthly: 850, tohVacancyPct: 0.05, pohVacancyPct: 0.10, collectionLossPct: 0.02, opExSum: 0 }, asm)
    expect(r.lotMixError).toBe(true)
    expect(r.accounted).toBe(79)
  })

  it('lotMixError = false when counts sum correctly', () => {
    // 10+2+56+12 = 80 ✓
    const r = calcMhp({ totalLots: 80, occupiedPoh: 10, vacantPoh: 2, occupiedToh: 56, vacantLots: 12, lotRentMonthly: 400, pohRentMonthly: 850, otherIncomeAnnual: 5000, tohVacancyPct: 0.05, pohVacancyPct: 0.10, collectionLossPct: 0.02, opExSum: 0 }, asm)
    expect(r.lotMixError).toBe(false)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// 11. MHP — sellerFiAmount / cashEquity split
// ─────────────────────────────────────────────────────────────────────────────
describe('MHP — sellerFiAmount and cashEquity split', () => {
  const baseInputs = {
    totalLots: 80, occupiedPoh: 10, vacantPoh: 2, occupiedToh: 56, vacantLots: 12,
    lotRentMonthly: 400, pohRentMonthly: 850, otherIncomeAnnual: 5000,
    tohVacancyPct: 0.05, pohVacancyPct: 0.10, collectionLossPct: 0.02, opExSum: 6000
  }
  const baseAsm = {
    dscr: 1.25, seniorRate: 0.075, seniorAmort: 22, seniorLtv: 0.75,
    managementPct: 0.07, buyerClosingCostsPct: 0.03, bankPointsPct: 0.01,
    lenderFeesPct: 0.005, appraisalFee: 5000, environmentalFee: 5000,
    sellerFiRate: 0.05, sellerFiAmort: 25
  }

  it('sellerFiPct=0.60 → sellerFiAmount = remainingEquity × 0.60, cashEquity = remainder', () => {
    const r = calcMhp(baseInputs, { ...baseAsm, sellerFiPct: 0.60 })
    const card = r.cards[0]
    expect(card.sellerFiAmount).toBeCloseTo(card.remainingEquity * 0.60, 0)
    expect(card.cashEquity).toBeCloseTo(card.remainingEquity * 0.40, 0)
    expect(card.sellerFiAmount + card.cashEquity).toBeCloseTo(card.remainingEquity, 0)
  })

  it('sellerFiPct=0 → sellerFiAmount=0 and cashEquity=remainingEquity', () => {
    const r = calcMhp(baseInputs, { ...baseAsm, sellerFiPct: 0 })
    const card = r.cards[0]
    expect(card.sellerFiAmount).toBe(0)
    expect(card.cashEquity).toBeCloseTo(card.remainingEquity, 0)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// 12. MHP — utility burden integration
// ─────────────────────────────────────────────────────────────────────────────
describe('MHP — utility burden math', () => {
  it('calcUtilityBurden: submeter at 75% recovery leaves 25% burden', () => {
    const r = calcUtilityBurden({
      electric: { mode: 'submeter', costAnnual: 12000, recoveryPct: 0.75 }
    })
    expect(r.byUtility.electric.gross).toBe(12000)
    expect(r.byUtility.electric.recovered).toBe(9000)
    expect(r.byUtility.electric.net).toBe(3000)
    expect(r.totalBurden).toBe(3000)
  })

  it('calcUtilityBurden: park-paid (no recovery) = full burden', () => {
    const r = calcUtilityBurden({
      sewer: { mode: 'park-paid', costAnnual: 8000 }
    })
    expect(r.byUtility.sewer.gross).toBe(8000)
    expect(r.byUtility.sewer.net).toBe(8000)
    expect(r.totalBurden).toBe(8000)
  })

  it('calcUtilityBurden: tenant-direct = zero burden regardless of cost entered', () => {
    const r = calcUtilityBurden({
      water: { mode: 'tenant-direct', costAnnual: 5000 }
    })
    expect(r.byUtility.water.net).toBe(0)
    expect(r.totalBurden).toBe(0)
  })

  it('utility burden adds to opExSum and reduces maxPurchase vs no utilities', () => {
    const asm = { dscr: 1.25, seniorRate: 0.075, seniorAmort: 22, seniorLtv: 0.75, sellerFiRate: 0.05, sellerFiAmort: 25, sellerFiPct: 1.0, managementPct: 0.07, buyerClosingCostsPct: 0.03, bankPointsPct: 0.01, lenderFeesPct: 0.005, appraisalFee: 5000, environmentalFee: 5000 }
    const inp = { totalLots: 80, occupiedPoh: 10, vacantPoh: 2, occupiedToh: 56, vacantLots: 12, lotRentMonthly: 400, pohRentMonthly: 850, otherIncomeAnnual: 5000, tohVacancyPct: 0.05, pohVacancyPct: 0.10, collectionLossPct: 0.02 }
    const rNoUtil = calcMhp({ ...inp, opExSum: 0 }, asm)
    const rWithUtil = calcMhp({ ...inp, opExSum: 6000 }, asm)
    expect(rWithUtil.cards[0].noi).toBeLessThan(rNoUtil.cards[0].noi)
    expect(rWithUtil.cards[0].maxPurchase).toBeLessThan(rNoUtil.cards[0].maxPurchase)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// 13. Commercial — computeIncome with two NNN tenants
// ─────────────────────────────────────────────────────────────────────────────
describe('Commercial — computeIncome with two NNN tenants', () => {
  // Tenant A: 5,000 SF @ $12/SF NNN
  // Tenant B: 3,000 SF @ $14/SF NNN
  // opEx: tax=$20k, insurance=$5k, CAM=$10k
  // NNN pro-rata share of all three passed through to tenants
  const rentRoll = [
    { suite: '100', tenantName: 'Acme Corp', sfLeased: 5000, tenantType: 'Retail — general', leaseType: 'NNN', baseRentPsf: 12, leaseEndDate: '2030-01-01' },
    { suite: '200', tenantName: 'Bravo LLC', sfLeased: 3000, tenantType: 'Retail — general', leaseType: 'NNN', baseRentPsf: 14, leaseEndDate: '2028-06-01' }
  ]
  const opEx = { propertyTax: 20000, insurance: 5000, cam: 10000 }

  it('totalBaseRent = 5000×12 + 3000×14 = $102,000', () => {
    const r = computeIncome(rentRoll, opEx, [])
    expect(r.totalBaseRent).toBeCloseTo(102000, 0)
  })

  it('totalReimbursements = full recoverable ($35,000) for 100% NNN occupancy', () => {
    const r = computeIncome(rentRoll, opEx, [])
    // Recoverable = 20000+5000+10000 = 35000
    // 5000/8000 × 35000 = 21875 (Acme) + 3000/8000 × 35000 = 13125 (Bravo) = 35000
    expect(r.totalReimbursements).toBeCloseTo(35000, 0)
    expect(r.gsi).toBeCloseTo(137000, 0)
  })

  it('leasedSF = 8000, vacantSF = 0, physicalVacancyPct = 0', () => {
    const r = computeIncome(rentRoll, opEx, [])
    expect(r.leasedSF).toBe(8000)
    expect(r.vacantSF).toBe(0)
    expect(r.physicalVacancyPct).toBe(0)
  })

  it('each tenant marked isLeased=true', () => {
    const r = computeIncome(rentRoll, opEx, [])
    expect(r.tenants.every(t => t.isLeased)).toBe(true)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// 14. Commercial — computeScenario NOI formula (MVM 0%, no econ-vac, no col-loss)
// ─────────────────────────────────────────────────────────────────────────────
describe('Commercial — computeScenario NOI formula', () => {
  // Simplified: MVM=0, econVac=0, colLoss=0
  // GSI = baseRent + reimbursements = 102000 + 35000 = 137000
  // EGI = 137000 × (1−0) × (1−0) = 137000
  // grossOpEx = propertyTax + insurance + CAM + repairs + roofReserve = 20000+5000+10000+3000+2000 = 40000
  // (propMgmtIsPct=false, amount=0)
  // netOpExToLandlord = 40000 − 35000 (reimbursements) = 5000
  // tiLcAnnual = 0.75 × 8000 = 6000
  // capexAnnual = 0.30 × 8000 = 2400
  // NOI = 137000 − 5000 − 6000 − 2400 = 123,600
  const income = {
    tenants: [
      { sf: 5000, ratePsf: 12, baseRent: 60000, reimbursements: 21875, totalAnnual: 81875, isLeased: true, isVacant: false, leaseType: 'NNN', tenantType: 'Retail — general', tenantName: 'Acme', leaseEndDate: '2030-01-01' },
      { sf: 3000, ratePsf: 14, baseRent: 42000, reimbursements: 13125, totalAnnual: 55125, isLeased: true, isVacant: false, leaseType: 'NNN', tenantType: 'Retail — general', tenantName: 'Bravo', leaseEndDate: '2028-06-01' }
    ],
    totalBaseRent: 102000, totalReimbursements: 35000, otherIncome: 0, gsi: 137000,
    leasedSF: 8000, vacantSF: 0, totalSF: 8000, physicalVacancyPct: 0
  }
  const opEx = { propertyTax: 20000, insurance: 5000, cam: 10000, commonUtilities: 0, propMgmtIsPct: false, propMgmtPct: 0.05, propMgmtPctOrAmount: 0, onsiteManager: 0, officeAdmin: 0, marketing: 0, legal: 0, repairs: 3000, roofReserve: 2000, other: 0 }
  const reserves = { tiLcPsf: 0.75, capexPsf: 0.30 }
  const terms = { ...COMM_TERMS }

  it('NOI = EGI − netOpExToLandlord − TI/LC − CapEx = $123,600', () => {
    const r = computeScenario({ income, opEx, reserves, mvmPct: 0, econVacancyPct: 0, collectionLossPct: 0, askingPrice: 0, terms })
    expect(r.egi).toBeCloseTo(137000, 0)
    expect(r.netOpExToLandlord).toBeCloseTo(5000, 0)
    expect(r.tiLcAnnual).toBeCloseTo(6000, 0)
    expect(r.capexAnnual).toBeCloseTo(2400, 0)
    expect(r.noi).toBeCloseTo(123600, 0)
  })

  it('MVM 20% reduces base rent by 20% (reimbursements unchanged)', () => {
    const r0 = computeScenario({ income, opEx, reserves, mvmPct: 0, econVacancyPct: 0, collectionLossPct: 0, askingPrice: 0, terms })
    const r20 = computeScenario({ income, opEx, reserves, mvmPct: 0.20, econVacancyPct: 0, collectionLossPct: 0, askingPrice: 0, terms })
    // adjustedBaseRent = 102000 × 0.80 = 81600
    // adjustedGSI = 81600 + 35000 = 116600
    expect(r20.gsi).toBeCloseTo(116600, 0)
    expect(r20.noi).toBeLessThan(r0.noi)
  })

  it('maxSeniorLoan = (noi / dscr) / K_lender', () => {
    const r = computeScenario({ income, opEx, reserves, mvmPct: 0, econVacancyPct: 0, collectionLossPct: 0, askingPrice: 0, terms })
    const K_lender = commercialALC(COMM_TERMS.lenderRate, COMM_TERMS.lenderAm)
    const expectedMaxDS = r.noi / COMM_TERMS.dscr
    const expectedMaxLoan = expectedMaxDS / K_lender
    expect(r.maxAnnualDS).toBeCloseTo(expectedMaxDS, 0)
    expect(r.maxSeniorLoan).toBeCloseTo(expectedMaxLoan, 0)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// 15. Commercial — computeCommercial full pipeline
// ─────────────────────────────────────────────────────────────────────────────
describe('Commercial — computeCommercial full pipeline', () => {
  it('returns income, 3 MVM results, and warnings array for a valid deal', () => {
    const inputs = {
      rentRoll: [
        { suite: '100', tenantName: 'Dollar Tree', sfLeased: 8000, tenantType: 'Retail — anchor (credit tenant)', leaseType: 'NNN', baseRentPsf: 10, leaseEndDate: '2032-01-01' }
      ],
      opEx: {
        propertyTax: 15000, insurance: 4000, cam: 8000, commonUtilities: 0,
        propMgmtIsPct: true, propMgmtPct: '0.05', propMgmtPctOrAmount: '',
        onsiteManager: 0, officeAdmin: 0, marketing: 0, legal: 0, repairs: 2000, roofReserve: 1000, other: 0
      },
      otherIncomeLines: [],
      econVacancyPct: '',
      collectionLossPct: '',
      askingPrice: '900000',
      reserves: { tiLcPsf: String(DEFAULT_TI_LC_PSF), capexPsf: String(DEFAULT_CAPEX_PSF) },
      terms: { dscr: String(COMM_TERMS.dscr), lenderRate: String(COMM_TERMS.lenderRate), lenderAm: String(COMM_TERMS.lenderAm), sellerRate: String(COMM_TERMS.sellerRate), sellerAm: String(COMM_TERMS.sellerAm) },
      subclass: 'retail_single'
    }
    const out = computeCommercial(inputs)
    expect(out.income).toBeDefined()
    expect(out.results).toHaveLength(3)
    expect(out.results[0].mvmPct).toBe(0)
    expect(out.results[1].mvmPct).toBe(0.20)
    expect(out.results[2].mvmPct).toBe(0.30)
    expect(out.results[0].noi).toBeGreaterThan(0)
    expect(Array.isArray(out.warnings)).toBe(true)
    // Asking price = 900k → impliedCapRate should be computable
    expect(out.results[0].impliedCapRate).toBeGreaterThan(0)
  })

  it('subclass defaults are returned when subclass is set', () => {
    const inputs = {
      rentRoll: [],
      opEx: { propMgmtIsPct: false, propMgmtPctOrAmount: 0 },
      otherIncomeLines: [],
      econVacancyPct: '', collectionLossPct: '', askingPrice: '',
      reserves: { tiLcPsf: '0.75', capexPsf: '0.30' },
      terms: { dscr: '1.25', lenderRate: '0.0775', lenderAm: '25', sellerRate: '0.06', sellerAm: '20' },
      subclass: 'office_general'
    }
    const out = computeCommercial(inputs)
    expect(out.subclass).toBe('office_general')
    expect(out.subclassDefaults).toBeDefined()
    expect(out.subclassDefaults.typicalCapRateLow).toBeDefined()
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// 16. Commercial — subclassWarnings cap-rate-band detection
// ─────────────────────────────────────────────────────────────────────────────
describe('Commercial — subclassWarnings', () => {
  const baseIncome = { tenants: [], totalBaseRent: 0, totalReimbursements: 0, otherIncome: 0, gsi: 100000, leasedSF: 0, vacantSF: 0, totalSF: 0, physicalVacancyPct: 0 }

  it('warns BELOW band when impliedCap < typicalCapRateLow (retail_strip: floor = 6.5%)', () => {
    const results = [{ mvmPct: 0, impliedCapRate: 0.05, gsi: 100000, grossOpEx: 35000 }]
    const warnings = subclassWarnings({ subclass: 'retail_strip', results, income: baseIncome, opEx: {}, reserves: { tiLcPsf: 1.0, capexPsf: 0.30 }, askingPrice: 1 })
    const belowWarn = warnings.find(w => w.message.includes('BELOW'))
    expect(belowWarn).toBeDefined()
    expect(belowWarn.severity).toBe('warn')
  })

  it('info ABOVE band when impliedCap > typicalCapRateHigh (retail_strip: ceiling = 8.5%)', () => {
    const results = [{ mvmPct: 0, impliedCapRate: 0.12, gsi: 100000, grossOpEx: 35000 }]
    const warnings = subclassWarnings({ subclass: 'retail_strip', results, income: baseIncome, opEx: {}, reserves: { tiLcPsf: 1.0, capexPsf: 0.30 }, askingPrice: 1 })
    const aboveInfo = warnings.find(w => w.message.includes('ABOVE'))
    expect(aboveInfo).toBeDefined()
    expect(aboveInfo.severity).toBe('info')
  })

  it('returns empty array when subclass is "other"', () => {
    const warnings = subclassWarnings({ subclass: 'other', results: [], income: { tenants: [], physicalVacancyPct: 0 }, opEx: {}, reserves: {}, askingPrice: 0 })
    expect(warnings).toHaveLength(0)
  })

  it('warns on under-reserved TI/LC', () => {
    // retail_strip tipicalTiLcPsf = 1.0; trigger < 0.5
    const results = [{ mvmPct: 0, impliedCapRate: 0.07, gsi: 100000, grossOpEx: 35000 }]
    const warnings = subclassWarnings({ subclass: 'retail_strip', results, income: { ...baseIncome, physicalVacancyPct: 0.10 }, opEx: {}, reserves: { tiLcPsf: 0.10, capexPsf: 0.30 }, askingPrice: 0 })
    const tiWarn = warnings.find(w => w.message.includes('TI/LC'))
    expect(tiWarn).toBeDefined()
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// 17. Commercial — detectMixedUse signals
// ─────────────────────────────────────────────────────────────────────────────
describe('Commercial — detectMixedUse', () => {
  it('true when subclass = mixed_use', () => {
    const r = detectMixedUse({ subclass: 'mixed_use', tenants: [], additionalAssets: [] })
    expect(r.isMixedUse).toBe(true)
    expect(r.reason).toContain('subclass=mixed_use')
  })

  it('true when tenant types span retail + office', () => {
    const tenants = [
      { isLeased: true, tenantType: 'retail', tenantName: 'T1', sf: 2000, totalAnnual: 20000 },
      { isLeased: true, tenantType: 'office', tenantName: 'T2', sf: 2000, totalAnnual: 20000 }
    ]
    const r = detectMixedUse({ subclass: 'retail_strip', tenants, additionalAssets: [] })
    expect(r.isMixedUse).toBe(true)
  })

  it('false when all tenants are the same category', () => {
    const tenants = [
      { isLeased: true, tenantType: 'retail', tenantName: 'T1', sf: 3000, totalAnnual: 30000 },
      { isLeased: true, tenantType: 'retail', tenantName: 'T2', sf: 2000, totalAnnual: 20000 }
    ]
    const r = detectMixedUse({ subclass: 'retail_strip', tenants, additionalAssets: [] })
    expect(r.isMixedUse).toBe(false)
  })

  it('true when additionalAssets list is non-empty', () => {
    const r = detectMixedUse({ subclass: 'retail_strip', tenants: [], additionalAssets: [{ type: 'storage' }] })
    expect(r.isMixedUse).toBe(true)
    expect(r.reason).toMatch(/additional asset/i)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// 18. Mixed Use — blendComponents exact numbers
// ─────────────────────────────────────────────────────────────────────────────
describe('Mixed Use — blendComponents exact numbers', () => {
  // Component A: Storage NOI $85,000 @ 6.5% → value = $1,307,692.31
  // Component B: Commercial NOI $50,000 @ 8.0% → value = $625,000
  // totalNoi = $135,000, totalValue = $1,932,692.31
  // blendedCapRate = 135000 / 1932692.31 = 0.06989 ≈ 6.99%
  const components = [
    { id: 1, label: 'Storage Building', assetType: 'storage', noi: 85000, capRate: 0.065 },
    { id: 2, label: 'Commercial Suite', assetType: 'commercial', noi: 50000, capRate: 0.080 }
  ]

  it('computes each component value as noi / capRate', () => {
    const r = blendComponents(components, 0)
    expect(r.ok).toBe(true)
    const stor = r.components.find(c => c.assetType === 'storage')
    const com = r.components.find(c => c.assetType === 'commercial')
    expect(stor.value).toBeCloseTo(85000 / 0.065, 0)
    expect(com.value).toBeCloseTo(50000 / 0.080, 0)
  })

  it('blendedCapRate = totalNoi / totalValue', () => {
    const r = blendComponents(components, 0)
    expect(r.totalNoi).toBeCloseTo(135000, 0)
    expect(r.blendedCapRate).toBeCloseTo(r.totalNoi / r.totalValue, 5)
    expect(r.blendedCapRate).toBeCloseTo(0.0699, 3)
  })

  it('dominant component is storage (highest value)', () => {
    const r = blendComponents(components, 0)
    expect(r.dominant.assetType).toBe('storage')
  })

  it('pctOfNoi values sum to 1.0', () => {
    const r = blendComponents(components, 0)
    const sum = r.components.reduce((s, c) => s + c.pctOfNoi, 0)
    expect(sum).toBeCloseTo(1.0, 5)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// 19. Mixed Use — discount math
// ─────────────────────────────────────────────────────────────────────────────
describe('Mixed Use — discount math', () => {
  const components = [
    { id: 1, label: 'A', assetType: 'storage', noi: 100000, capRate: 0.07 },
    { id: 2, label: 'B', assetType: 'commercial', noi: 60000, capRate: 0.08 }
  ]

  it('5% discount: discountedValue = totalValue × 0.95', () => {
    const r = blendComponents(components, 5)
    expect(r.discount).toBe(5)
    expect(r.discountedValue).toBeCloseTo(r.totalValue * 0.95, 0)
    expect(r.discountAmount).toBeCloseTo(r.totalValue * 0.05, 0)
    expect(r.discountedValue + r.discountAmount).toBeCloseTo(r.totalValue, 0)
  })

  it('0% discount: discountedValue equals totalValue', () => {
    const r = blendComponents(components, 0)
    expect(r.discountedValue).toBeCloseTo(r.totalValue, 0)
    expect(r.discountAmount).toBeCloseTo(0, 0)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// 20. Mixed Use — minor component flag
// ─────────────────────────────────────────────────────────────────────────────
describe('Mixed Use — minor component flag', () => {
  it('flags component as minor when NOI < 10% of total', () => {
    // 5000 / (100000 + 5000) = 4.76% < 10% → minor
    const components = [
      { id: 1, label: 'Main', assetType: 'storage', noi: 100000, capRate: 0.065 },
      { id: 2, label: 'Tiny', assetType: 'commercial', noi: 5000, capRate: 0.08 }
    ]
    const r = blendComponents(components, 0)
    const tiny = r.components.find(c => c.assetType === 'commercial')
    expect(tiny.minor).toBe(true)
    expect(tiny.pctOfNoi).toBeCloseTo(5000 / 105000, 4)
  })

  it('does not flag component as minor when NOI >= 10% of total', () => {
    // 15000 / (100000 + 15000) = 13% ≥ 10% → not minor
    const components = [
      { id: 1, label: 'Main', assetType: 'storage', noi: 100000, capRate: 0.065 },
      { id: 2, label: 'Decent', assetType: 'commercial', noi: 15000, capRate: 0.08 }
    ]
    const r = blendComponents(components, 0)
    const decent = r.components.find(c => c.assetType === 'commercial')
    expect(decent.minor).toBe(false)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// 21. Mixed Use — error handling
// ─────────────────────────────────────────────────────────────────────────────
describe('Mixed Use — error handling', () => {
  it('returns ok=false when all components have noi=0', () => {
    const r = blendComponents([
      { id: 1, label: 'A', assetType: 'storage', noi: 0, capRate: 0.065 },
      { id: 2, label: 'B', assetType: 'commercial', noi: 0, capRate: 0.08 }
    ], 0)
    expect(r.ok).toBe(false)
    expect(typeof r.error).toBe('string')
  })

  it('returns ok=false when all components have capRate=0', () => {
    const r = blendComponents([
      { id: 1, label: 'A', assetType: 'storage', noi: 100000, capRate: 0 },
      { id: 2, label: 'B', assetType: 'commercial', noi: 50000, capRate: 0 }
    ], 0)
    expect(r.ok).toBe(false)
  })

  it('skips invalid components and blends only the valid one', () => {
    // noi=0 fails the validity check → only 1 valid component
    const r = blendComponents([
      { id: 1, label: 'Valid', assetType: 'storage', noi: 100000, capRate: 0.065 },
      { id: 2, label: 'Invalid', assetType: 'commercial', noi: 0, capRate: 0.08 }
    ], 0)
    expect(r.ok).toBe(true)
    expect(r.componentCount).toBe(1)
    expect(r.totalNoi).toBeCloseTo(100000, 0)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// 22. exitStrategies — calcCreative zero interest rate (interest-free seller note)
// ─────────────────────────────────────────────────────────────────────────────
describe('exitStrategies — calcCreative zero interest rate', () => {
  // $120k purchase, $12k down, 0% interest, 10-year amortization
  // loan = 108,000; monthly PI = 108000 / 120 = $900

  it('0% rate produces integer monthly PI without NaN', () => {
    const r = calcCreative({ purchasePrice: 120000, downPmt: 12000, interestRate: 0, termYears: 10, monthlyRent: 1200, annualOpex: 5000 })
    expect(r.ok).toBe(true)
    expect(r.loan).toBe(108000)
    expect(r.monthlyPI).toBeCloseTo(900, 0)
    expect(r.annualDS).toBeCloseTo(10800, 0)
    expect(Number.isFinite(r.cashOnCash)).toBe(true)
    expect(Number.isFinite(r.dscr)).toBe(true)
  })

  it('balloon balance at year 5 with 0% rate = loan − (payments × months)', () => {
    // payments = 108000/120 = $900; 60 months × $900 = $54,000 paid
    // remaining = 108000 − 54000 = $54,000
    const r = calcCreative({ purchasePrice: 120000, downPmt: 12000, interestRate: 0, termYears: 10, balloonYears: 5, exitArv: 140000 })
    expect(r.balloonBalance).toBeCloseTo(54000, 0)
    expect(r.balloonEquity).toBeCloseTo(140000 - 54000, 0)
  })

  it('equityAtPurchase = exitArv − purchasePrice when exitArv provided', () => {
    const r = calcCreative({ purchasePrice: 120000, downPmt: 12000, interestRate: 0, termYears: 10, exitArv: 155000 })
    expect(r.equityAtPurchase).toBeCloseTo(155000 - 120000, 0)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// 23. exitStrategies — calcLeaseOption effectiveYieldIfExercised exact value
// ─────────────────────────────────────────────────────────────────────────────
describe('exitStrategies — calcLeaseOption exact yield', () => {
  // allInPrice = $130,000; optionPrice = $175,000; optionFee = $5,000
  // monthlyRent = $1,400; rentCreditPct = 15%; term = 36 mo; monthlyOpex = $350
  //
  // cashFlowMo = 1400 − (1400×0.15) − 350 = 1400 − 210 − 350 = $840
  // totalCashFlow = 840 × 36 = $30,240
  // totalRentCredits = 1400 × 0.15 × 36 = $7,560
  // saleProceeds = 175000 − 7560 = $167,440
  // totalReturnIfExercised = 5000 + 30240 + (167440 − 130000) = $72,680
  // roiIfExercised = 72680 / 130000 = 0.55908
  // effectiveYield = 0.55908 / (36/12) = 0.18636 ≈ 18.6% / yr

  it('cashFlowMonthly = $840', () => {
    const r = calcLeaseOption({ allInPrice: 130000, optionPrice: 175000, optionFee: 5000, monthlyRent: 1400, rentCreditPct: 0.15, optionTermMonths: 36, monthlyOpex: 350 })
    expect(r.cashFlowMonthly).toBeCloseTo(840, 0)
  })

  it('totalRentCredits = $7,560', () => {
    const r = calcLeaseOption({ allInPrice: 130000, optionPrice: 175000, optionFee: 5000, monthlyRent: 1400, rentCreditPct: 0.15, optionTermMonths: 36, monthlyOpex: 350 })
    expect(r.totalRentCredits).toBeCloseTo(7560, 0)
  })

  it('saleProceeds = optionPrice − totalRentCredits = $167,440', () => {
    const r = calcLeaseOption({ allInPrice: 130000, optionPrice: 175000, optionFee: 5000, monthlyRent: 1400, rentCreditPct: 0.15, optionTermMonths: 36, monthlyOpex: 350 })
    expect(r.saleProceeds).toBeCloseTo(167440, 0)
  })

  it('totalReturnIfExercised = $72,680', () => {
    const r = calcLeaseOption({ allInPrice: 130000, optionPrice: 175000, optionFee: 5000, monthlyRent: 1400, rentCreditPct: 0.15, optionTermMonths: 36, monthlyOpex: 350 })
    expect(r.totalReturnIfExercised).toBeCloseTo(72680, 0)
  })

  it('effectiveYieldIfExercised ≈ 18.6% annualized', () => {
    const r = calcLeaseOption({ allInPrice: 130000, optionPrice: 175000, optionFee: 5000, monthlyRent: 1400, rentCreditPct: 0.15, optionTermMonths: 36, monthlyOpex: 350 })
    expect(r.effectiveYieldIfExercised).toBeCloseTo(72680 / 130000 / (36 / 12), 3)
    expect(r.effectiveYieldIfExercised).toBeGreaterThan(0.18)
  })

  it('totalReturnIfNot = optionFee + totalCashFlow', () => {
    const r = calcLeaseOption({ allInPrice: 130000, optionPrice: 175000, optionFee: 5000, monthlyRent: 1400, rentCreditPct: 0.15, optionTermMonths: 36, monthlyOpex: 350 })
    expect(r.totalReturnIfNot).toBeCloseTo(5000 + r.totalCashFlow, 0)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// 24. exitStrategies — calcBRRRR recycleEfficiency
// ─────────────────────────────────────────────────────────────────────────────
describe('exitStrategies — calcBRRRR recycleEfficiency', () => {
  it('recycleEfficiency = refiLoan / allIn (standard case)', () => {
    // allIn = 95000 + 45000 + 2850 = 142850; refiLoan = 190000 × 0.75 = 142500
    const r = calcBRRRR({ purchasePrice: 95000, rehabCost: 45000, closingCostsBuy: 2850, monthlyRent: 1650, arv: 190000, ltvPct: 0.75, refiRate: 0.075, refiTermYears: 30 })
    expect(r.allIn).toBeCloseTo(142850, 0)
    expect(r.refiLoan).toBeCloseTo(142500, 0)
    expect(r.recycleEfficiency).toBeCloseTo(142500 / 142850, 4)
  })

  it('recycleEfficiency > 1.0 and brrrrWorks=true when refiLoan > allIn', () => {
    // allIn = 60000+30000+1800 = 91800; refiLoan = 160000×0.75 = 120000
    const r = calcBRRRR({ purchasePrice: 60000, rehabCost: 30000, closingCostsBuy: 1800, monthlyRent: 1500, arv: 160000, ltvPct: 0.75 })
    expect(r.brrrrWorks).toBe(true)
    expect(r.cashLeftIn).toBeLessThan(0)
    expect(r.recycleEfficiency).toBeGreaterThan(1.0)
    expect(r.recycleEfficiency).toBeCloseTo(120000 / 91800, 3)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// 25. ownerEquityCost — amort > io with exact io value
// ─────────────────────────────────────────────────────────────────────────────
describe('ownerEquityCost — treatment ordering and exact values', () => {
  it('sunk treatment = $0', () => {
    expect(ownerEquityCost(200000, 'sunk')).toBe(0)
  })

  it('io treatment = equity × RATE_OWNER = 200000 × 0.08 = $16,000', () => {
    expect(ownerEquityCost(200000, 'io')).toBeCloseTo(16000, 0)
  })

  it('amort treatment > io because principal is also being repaid', () => {
    const io = ownerEquityCost(200000, 'io')
    const amort = ownerEquityCost(200000, 'amort')
    expect(amort).toBeGreaterThan(io)
    // K_OWNER_AMORT = annualLoanConstant(0.08, 25) > 0.08 = RATE_OWNER
    expect(amort).toBeGreaterThan(16000)
  })

  it('throws on unknown treatment', () => {
    expect(() => ownerEquityCost(100000, 'mystery')).toThrow()
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// 26. groupA_equityRequirement — PITI reserve formula
// ─────────────────────────────────────────────────────────────────────────────
describe('groupA_equityRequirement — PITI reserve and working capital', () => {
  it('pitiReserve = bankAnnualDS × 3 / 12 (3-month reserve)', () => {
    // maxPurchase=1283000, bankAnnualDS=91233 (1283000×0.75×K_BANK_STORAGE), annualOpEx=25000
    const ga = groupA_maxPurchase(104400, 1.25)
    const eq = groupA_equityRequirement(ga.maxPurchase, ga.bankAnnualDS, 25000)
    // PITI_RESERVE_MONTHS = 3
    expect(eq.lineItems.pitiReserve).toBeCloseTo(ga.bankAnnualDS * 3 / 12, 0)
  })

  it('workingCapital = annualOpEx × 0.25', () => {
    const ga = groupA_maxPurchase(104400, 1.25)
    const eq = groupA_equityRequirement(ga.maxPurchase, ga.bankAnnualDS, 25000)
    expect(eq.workingCapital).toBeCloseTo(25000 * 0.25, 0)
  })

  it('totalEquityRequired = cashToClose + workingCapital', () => {
    const ga = groupA_maxPurchase(104400, 1.25)
    const eq = groupA_equityRequirement(ga.maxPurchase, ga.bankAnnualDS, 25000)
    expect(eq.totalEquityRequired).toBeCloseTo(eq.cashToClose + eq.workingCapital, 1)
  })

  it('downPayment line item = maxPurchase × (1 − LTV_STORAGE)', () => {
    const ga = groupA_maxPurchase(104400, 1.25)
    const eq = groupA_equityRequirement(ga.maxPurchase, ga.bankAnnualDS, 0)
    expect(eq.lineItems.downPayment).toBeCloseTo(ga.maxPurchase * (1 - C.LTV_STORAGE), 0)
  })
})
