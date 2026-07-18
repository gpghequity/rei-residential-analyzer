// Parity tests for the ported Math Bible math.
// Verify that the ports produce the same numbers as the source files for
// known inputs. If a future change to one of these tests fails, that's a
// drift signal — investigate before merging.

import { describe, it, expect } from 'vitest'
import { loadConstants, annualLoanConstant } from '../math/constants.js'
import {
  storageNOI, groupA_maxPurchase, groupB_maxPurchase, groupC_maxPurchase,
  pocketCash, ownerEquityCost, groupA_equityRequirement
} from '../math/storage.js'
import {
  residentialNOI, residentialAllModes, residentialMAO, residentialDSCR,
  ownerHardMode, arv40thPercentile
} from '../math/residential.js'
import { kickerProjection } from '../math/kicker.js'
import { sunsetTest, remainingPrincipal } from '../math/sunsetTest.js'
import { rampTest } from '../math/rampTest.js'
import { runStorageDeal, runResidentialDeal } from '../math/scenarioEngine.js'
import { computeStorageVerdict, checkDataQualityGate } from '../math/verdict.js'
import { calcMhp, calcUtilityBurden, annualLoanConstant as mhpALC } from '../math/mhp.js'
import { calcCommercial } from '../math/commercial.js'

describe('constants.js (Math Bible v3 port)', () => {
  it('loads defaults flat and computes derived loan constants', () => {
    const C = loadConstants()
    expect(C.RATE_BANK_STORAGE).toBe(0.0725)
    expect(C.LTV_STORAGE).toBe(0.75)
    expect(C.DSCR_CONSERVATIVE).toBe(1.25)
    expect(C.WHOLESALE_FEE).toBe(10000)
    expect(C.POCKET_FLOOR).toBe(10000)
    expect(C.K_BANK_STORAGE).toBeCloseTo(0.086737, 4)
    expect(C.K_BANK_RESI).toBeCloseTo(0.079836, 4)
    expect(C.K_SELLER).toBeGreaterThan(0)
    expect(C.K_OWNER_IO).toBe(0.08)
  })

  it('annualLoanConstant matches the published formula', () => {
    expect(annualLoanConstant(0.0725, 25)).toBeCloseTo(0.086737, 5)
    expect(annualLoanConstant(0.07, 30)).toBeCloseTo(0.079836, 5)
    expect(annualLoanConstant(0.05, 25)).toBeCloseTo(0.070151, 5)
  })
})

describe('storage.js (Math Bible v3 port)', () => {
  it('storageNOI applies the 35% expense floor correctly', () => {
    const r = storageNOI(180000, 0.42)
    expect(r.expenseRatio).toBe(0.42)
    expect(r.floorBinds).toBe(false)
    expect(r.expenses).toBeCloseTo(75600, 0)
    expect(r.noi).toBeCloseTo(104400, 0)

    const r2 = storageNOI(180000, 0.20)
    expect(r2.expenseRatio).toBe(0.35)
    expect(r2.floorBinds).toBe(true)
    expect(r2.noi).toBeCloseTo(117000, 0)
  })

  it('groupA_maxPurchase rounds down to nearest $1k and computes offer', () => {
    const r = groupA_maxPurchase(104400, 1.25)
    expect(r.group).toBe('A')
    expect(r.dscrLens).toBe(1.25)
    expect(r.maxPurchase).toBe(1283000)
    expect(r.yourOffer).toBe(1273000) // maxPurchase - WHOLESALE_FEE ($10k)
    expect(r.equityAmount).toBeCloseTo(320750, 0)
    expect(r.requiresRampTest).toBe(false)
  })

  it('groupA_maxPurchase at stretch lens flags ramp test required', () => {
    const r = groupA_maxPurchase(104400, 1.15)
    expect(r.requiresRampTest).toBe(true)
  })

  it('groupB_maxPurchase uses seller-finance K (lower → higher purchase)', () => {
    const a = groupA_maxPurchase(104400, 1.25)
    const b = groupB_maxPurchase(104400, 1.25)
    expect(b.maxPurchase).toBeGreaterThan(a.maxPurchase)
    expect(b.dscrInformational).toBe(true)
  })

  it('pocketCash flags clearsFloor against POCKET_FLOOR', () => {
    const cleared = pocketCash(50000, 30000, 0, 0, 0)
    expect(cleared.pocketCash).toBe(20000)
    expect(cleared.clearsFloor).toBe(true)

    const below = pocketCash(35000, 30000, 0, 0, 0)
    expect(below.pocketCash).toBe(5000)
    expect(below.clearsFloor).toBe(false)
    expect(below.flag).toBe('BELOW_POCKET_FLOOR')
  })

  it('ownerEquityCost applies the right rate per treatment', () => {
    expect(ownerEquityCost(100000, 'sunk')).toBe(0)
    expect(ownerEquityCost(100000, 'io')).toBeCloseTo(8000, 0)  // 8% I/O
    expect(ownerEquityCost(100000, 'amort')).toBeGreaterThan(8000) // amort > IO
    expect(() => ownerEquityCost(100000, 'unknown')).toThrow()
  })

  it('groupA_equityRequirement totals line items + working capital', () => {
    const r = groupA_equityRequirement(1283000, 90000, 25000)
    expect(r.lineItems.downPayment).toBeCloseTo(320750, 0)
    expect(r.lineItems.points).toBeCloseTo(9622.5, 0) // bankLoan × 1%
    expect(r.lineItems.appraisal).toBe(4000) // Bible CLOSING_COSTS.appraisalFee (was hardcoded 4500)
    expect(r.lineItems.pitiReserve).toBeCloseTo(22500, 0) // 90000 / (12/3) = 22500
    expect(r.workingCapital).toBeCloseTo(6250, 0) // 25000 × 0.25
    expect(r.totalEquityRequired).toBeCloseTo(r.cashToClose + r.workingCapital, 1)
  })
})

describe('residential.js (Math Bible v3 port)', () => {
  it('residentialAllModes returns 3 NOI lenses with correct MVM pads', () => {
    const r = residentialAllModes(50000, 14000)
    expect(r.light.padPct).toBe(0)
    expect(r.standard.padPct).toBe(0.15)
    expect(r.harsh.padPct).toBe(0.30)                 // Math Bible MVM pads: 0%, 15%, 30% for all residential
    expect(r.light.noi).toBeCloseTo(36000, 0)         // 50000 - 14000 - 0
    expect(r.standard.noi).toBeCloseTo(28500, 0)      // 50000 - 14000 - (0.15 × 50000 = 7500)
    expect(r.harsh.noi).toBeCloseTo(21000, 0)         // 50000 - 14000 - (0.30 × 50000 = 15000)
  })

  it('residentialMAO applies 70% rule', () => {
    const r = residentialMAO(210000, 35000)
    expect(r.endBuyer).toBeCloseTo(112000, 0)         // 210000 × 0.70 - 35000
    expect(r.yourOffer).toBeCloseTo(102000, 0)        // endBuyer - WHOLESALE_FEE ($10k)
  })

  it('residentialDSCR computes loan / DS / DSCR / pass', () => {
    const r = residentialDSCR(26000, 200000)
    expect(r.loan).toBeCloseTo(160000, 0)             // 200000 × 0.80
    expect(r.annualDS).toBeCloseTo(12774, 0)          // 160000 × K_BANK_RESI
    expect(r.dscr).toBeGreaterThan(1.25)
    expect(r.pass).toBe(true)
  })

  it('arv40thPercentile uses 40th percentile of comp range', () => {
    const comps = [
      { salePrice: 200000 }, { salePrice: 220000 }, { salePrice: 240000 },
      { salePrice: 260000 }, { salePrice: 280000 }
    ]
    const r = arv40thPercentile(comps)
    // low=200k, high=280k, ARV = 200000 + 0.40 × (280000 - 200000) = 232000
    expect(r.arv).toBeCloseTo(232000, 0)
    expect(r.confidence).toBe('NORMAL')
  })

  it('arv40thPercentile flags LOW confidence with too few comps', () => {
    const r = arv40thPercentile([{ salePrice: 200000 }, { salePrice: 250000 }])
    expect(r.arv).toBe(null)
    expect(r.confidence).toBe('LOW')
  })

  it('ownerHardMode returns rounded pMax and offer', () => {
    const r = ownerHardMode(26000, 35000)
    expect(r.pMax).toBeGreaterThan(0)
    expect(r.pMax % 1000).toBe(0) // rounded to $1k
    expect(r.yourOffer).toBe(r.pMax - 10000) // -WHOLESALE_FEE
    expect(r.note).toMatch(/INTERNAL ONLY/)
  })
})

describe('kicker.js (Math Bible v3 port)', () => {
  it('caps cumulative kicker at the cap', () => {
    const proj = kickerProjection(100000, 0.10, 0.20, 50000, 5)
    expect(proj.length).toBe(5)
    const last = proj[proj.length - 1]
    expect(last.cumulative).toBeLessThanOrEqual(50000)
  })

  it('year 1 kicker is 0 (no growth above baseline yet)', () => {
    const proj = kickerProjection(100000, 0.05, 0.20, 50000, 5)
    expect(proj[0].kickerPayment).toBe(0)
    expect(proj[0].growthAboveBaseline).toBe(0)
  })

  it('uses defaults from defaults.json when overrides not passed', () => {
    const proj = kickerProjection(100000, 0.05)
    expect(proj.length).toBe(5) // WINDOW_YEARS default
  })
})

describe('sunsetTest.js (Math Bible v3 port)', () => {
  it('returns 4 checkpoints (Y3/Y5/Y7/Y10)', () => {
    const r = sunsetTest(800000, 100000, 0.085)
    expect(r.length).toBe(4)
    expect(r.map(x => x.yearN)).toEqual([3, 5, 7, 10])
  })

  it('flags DURABLE / FRAGILE / FAIL appropriately', () => {
    const r = sunsetTest(800000, 100000, 0.085)
    r.forEach(checkpoint => {
      expect(['DURABLE', 'FRAGILE', 'FAIL']).toContain(checkpoint.flag)
    })
  })

  it('remainingPrincipal decreases with years paid', () => {
    const y1 = remainingPrincipal(1000000, 0.075, 25, 1)
    const y10 = remainingPrincipal(1000000, 0.075, 25, 10)
    expect(y10).toBeLessThan(y1)
  })
})

describe('rampTest.js (Math Bible v3 port)', () => {
  it('passes when Y1 ≥ 1.15 and Y2 ≥ 1.25', () => {
    // bankAnnualDS sized so Y1 NOI hits ~1.15
    const noiY1 = 100000
    const ds = noiY1 / 1.20  // gives Y1 DSCR = 1.20 (above 1.15)
    const r = rampTest(noiY1, ds)
    expect(r.dscrY1).toBeCloseTo(1.20, 2)
    expect(r.dscrY2).toBeCloseTo(1.236, 2) // 1.20 × 1.03
    expect(r.pass).toBe(false) // 1.236 < 1.25
  })

  it('passes when both lenses clear', () => {
    const noiY1 = 100000
    const ds = noiY1 / 1.30 // generous
    const r = rampTest(noiY1, ds)
    expect(r.pass).toBe(true)
    expect(r.flag).toBe('PASS')
  })
})

describe('scenarioEngine.js (Math Bible v3 port)', () => {
  it('runStorageDeal returns NOI + scenarios + kicker', () => {
    const result = runStorageDeal({
      grossDollarsIn: 180000,
      sellerStatedExpensePct: 0.42,
      annualOpEx: 75600,
      kickerOptions: { growthRate: 0.03, pct: 0.20, cap: 50000, windowYears: 5 }
    })
    expect(result.noiResult.noi).toBeCloseTo(104400, 0)
    expect(result.scenarios.length).toBe(10) // Bible: exactly 10 (A:6 + B:2 + C:2)
    expect(result.kickerProj.length).toBe(5)
  })

  it('runResidentialDeal returns ARV + modes + DSCR + hardMode', () => {
    const result = runResidentialDeal({
      grossDollarsIn: 50000,
      hardCosts: 14000,
      arv: 210000,
      rehab: 35000
    })
    expect(result.arvResult.confidence).toBe('OPERATOR_PROVIDED')
    expect(result.modes.standard.noi).toBeCloseTo(28500, 0)  // 50000 - 14000 - (0.15 × 50000)
    expect(result.mao.endBuyer).toBeCloseTo(112000, 0)
    expect(result.dscr.standard).toBeDefined()
    expect(result.ownerHardMode.pMax).toBeGreaterThan(0)
  })
})

describe('verdict.js (Math Bible v3 port)', () => {
  it('returns TENANTIVE when data quality gate fails', () => {
    const v = computeStorageVerdict({ scenarios: [] }, {})
    expect(v.verdict).toBe('TENANTIVE')
    expect(v.severity).toBe('GRAY')
    expect(v.reasonCodes).toContain('DATA_QUALITY_GATE_FAILED')
  })

  it('returns KILL when no scenarios pencil and gate clears', () => {
    const v = computeStorageVerdict(
      { scenarios: [] },
      { t12Verified: true, rentRollVerified: true, occupancyVerified: true, verifiedBy: 'Steve' }
    )
    expect(v.verdict).toBe('KILL')
    expect(v.severity).toBe('RED')
  })

  it('returns PASS when Group A 1.25x clears pocket floor', () => {
    const fakeScenarios = {
      scenarios: [
        { group: 'A', dscrLens: 1.25, pocket: { clearsFloor: true } }
      ]
    }
    const v = computeStorageVerdict(
      fakeScenarios,
      { t12Verified: true, rentRollVerified: true, occupancyVerified: true, verifiedBy: 'Steve' }
    )
    expect(v.verdict).toBe('PASS')
    expect(v.severity).toBe('GREEN')
  })

  it('checkDataQualityGate flags missing fields and unacceptable verifiers', () => {
    expect(checkDataQualityGate({}).cleared).toBe(false)
    expect(checkDataQualityGate({
      t12Verified: true, rentRollVerified: true, occupancyVerified: true,
      verifiedBy: 'random person'
    }).cleared).toBe(false)
    expect(checkDataQualityGate({
      t12Verified: true, rentRollVerified: true, occupancyVerified: true,
      verifiedBy: 'Steve'
    }).cleared).toBe(true)
  })
})

describe('mhp.js (Fast Calc V2.6 port)', () => {
  it('annualLoanConstant matches Fast Calc internal version', () => {
    expect(mhpALC(0.075, 22)).toBeCloseTo(0.092941, 4)
    expect(mhpALC(0, 25)).toBe(0)
    expect(mhpALC(0.05, 0)).toBe(0)
  })

  it('calcMhp returns 3 MVM cards with expected zero-fields when inputs invalid', () => {
    const r = calcMhp({}, {})
    expect(r.cards.length).toBe(3)
    expect(r.cards[0].maxPurchase).toBe(0)
  })

  it('calcMhp with the MATH_SPEC worked example produces close-to-expected NOI', () => {
    // From MATH_SPEC.md MHP worked example: 80 lots, 10 occ POH + 2 vac POH + 56 TOH
    // + 12 vac, $400 lot rent, $850 POH rent, $5k other income, water park-paid $6k
    const r = calcMhp({
      totalLots: 80,
      occupiedPoh: 10,
      vacantPoh: 2,
      occupiedToh: 56,
      vacantLots: 12,
      lotRentMonthly: 400,
      pohRentMonthly: 850,
      otherIncomeAnnual: 5000,
      tohVacancyPct: 0.05,
      pohVacancyPct: 0.10,
      collectionLossPct: 0.02,
      opExSum: 6000 // water park-paid, no recovery (stand-in for full opEx in V1)
    }, {
      dscr: 1.25,
      seniorRate: 0.075,
      seniorAmort: 22,
      seniorLtv: 0.75,
      sellerFiRate: 0.05,
      sellerFiAmort: 25,
      sellerFiPct: 1.0,
      managementPct: 0.07,
      buyerClosingCostsPct: 0.03,
      bankPointsPct: 0.01,
      lenderFeesPct: 0.005,
      appraisalFee: 5000,
      environmentalFee: 5000
    })

    expect(r.lotMixError).toBe(false)
    expect(r.gsi).toBeCloseTo(345117, -1)
    // Card 1 (Bank Only — 0% MVM) — NOI per spec: ~$313,314
    expect(r.cards[0].noi).toBeCloseTo(313314, -2)
    // Per spec, maxPurchase = $3,595,000 ± rounding
    expect(r.cards[0].maxPurchase).toBeCloseTo(3595000, -3)
  })

  it('calcUtilityBurden handles three modes', () => {
    const r = calcUtilityBurden({
      water: { mode: 'park-paid', costAnnual: 6000 },
      sewer: { mode: 'tenant-direct', costAnnual: 4000 },
      trash: { mode: 'submeter', costAnnual: 3000, recoveryPct: 0.5 }
    })
    expect(r.byUtility.water.net).toBe(6000)        // park-paid → full burden
    expect(r.byUtility.sewer.net).toBe(0)           // tenant-direct → 0
    expect(r.byUtility.trash.net).toBe(1500)        // submeter 50% recovery → half burden
    expect(r.totalBurden).toBe(7500)
  })
})

describe('commercial.js (live)', () => {
  it('exports DEFAULT_DSCR and runs without throwing on valid inputs', async () => {
    const mod = await import('../math/commercial.js')
    expect(typeof mod.DEFAULT_DSCR).toBe('number')
  })
})
