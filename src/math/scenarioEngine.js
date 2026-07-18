// PORTED FROM gorilla-ai/lib/math/scenarioEngine.js@63c651c on 2026-05-08
// Math is verbatim. Modifications: CommonJS → ESM only; customerId param dropped
// (Baby Analyzer is single-operator — see constants.js for rationale).
// Orchestrator — runs all 14 storage scenarios (3 groups × 2 lenses × 3 owner-equity
// treatments where applicable) or all residential modes, returning structured output.

import * as storage from './storage.js'
import * as residential from './residential.js'
import * as kicker from './kicker.js'
import * as sunset from './sunsetTest.js'
import * as ramp from './rampTest.js'

export function runStorageDeal(dealInputs) {
  const { grossDollarsIn, sellerStatedExpensePct, annualOpEx, kickerOptions, rehab = 0 } = dealInputs

  const noiResult = storage.storageNOI(grossDollarsIn, sellerStatedExpensePct)
  const noi = noiResult.noi

  const scenarios = []
  const lenses = [1.25, 1.15]
  const treatments = ['sunk', 'io', 'amort']

  for (const lens of lenses) {
    for (const treatment of treatments) {
      const result = storage.groupA_maxPurchase(noi, lens, rehab)
      const equityCost = storage.ownerEquityCost(result.equityAmount, treatment)
      const pocket = storage.pocketCash(noi, result.bankAnnualDS, 0, equityCost, 0)
      const equityReq = storage.groupA_equityRequirement(result.maxPurchase, result.bankAnnualDS, annualOpEx)
      const rampResult = result.requiresRampTest ? ramp.rampTest(noi, result.bankAnnualDS) : null
      scenarios.push({ ...result, treatment, equityCost, pocket, equityReq, rampResult })
    }
  }

  // Group B = seller note. The Math Bible defines EXACTLY 2 Group B scenarios
  // (one per DSCR lens), NOT 6. The old code fanned Group B across the three
  // owner-equity treatments (sunk/io/amort), inflating the scenario count to 14.
  // The Bible (STORAGE.scenarios groupB_sellerNote_1_25 / _1_15) and
  // META.critical_rules ("exactly 10") say Group B is 2. In a seller-note
  // structure the buyer's equity is sunk, so equityCost is 0.
  for (const lens of lenses) {
    const result = storage.groupB_maxPurchase(noi, lens, rehab)
    const equityCost = storage.ownerEquityCost(result.equityAmount, 'sunk')
    const pocket = storage.pocketCash(noi, 0, result.sellerAnnualDS, equityCost, 0)
    const rampResult = result.requiresRampTest ? ramp.rampTest(noi, result.sellerAnnualDS) : null
    const sellerLoan = result.maxPurchase * 0.75
    const entryCap = noi / result.maxPurchase
    const sunsetResult = sunset.sunsetTest(sellerLoan, noi, entryCap)
    scenarios.push({ ...result, treatment: 'sunk', equityCost, pocket, rampResult, sunsetResult })
  }

  for (const lens of lenses) {
    const result = storage.groupC_maxPurchase(noi, lens, rehab)
    const pocket = storage.pocketCash(noi, result.bankAnnualDS, result.sellerAnnualPI, 0, 0)
    const rampResult = result.requiresRampTest ? ramp.rampTest(noi, result.bankAnnualDS) : null
    const entryCap = noi / result.maxPurchase
    const sunsetResult = sunset.sunsetTest(result.equityAmount, noi, entryCap)
    scenarios.push({ ...result, pocket, rampResult, sunsetResult })
  }

  let kickerProj = null
  if (kickerOptions) {
    kickerProj = kicker.kickerProjection(
      noi,
      kickerOptions.growthRate || 0.03,
      kickerOptions.pct,
      kickerOptions.cap,
      kickerOptions.windowYears
    )
  }

  return { inputs: dealInputs, noiResult, scenarios, kickerProj }
}

export function runResidentialDeal(dealInputs) {
  const { grossDollarsIn, hardCosts, arv, rehab, comps } = dealInputs

  const arvResult = comps ? residential.arv40thPercentile(comps) : { arv, confidence: 'OPERATOR_PROVIDED', flag: null }
  const usedARV = arvResult.arv || arv

  const modes = residential.residentialAllModes(grossDollarsIn, hardCosts)
  const mao = residential.residentialMAO(usedARV, rehab)

  const dscrLight    = residential.residentialDSCR(modes.light.noi,    mao.endBuyer)
  const dscrStandard = residential.residentialDSCR(modes.standard.noi, mao.endBuyer)
  const dscrHarsh    = residential.residentialDSCR(modes.harsh.noi,    mao.endBuyer)

  const hardMode = residential.ownerHardMode(modes.standard.noi, rehab)

  return {
    inputs: dealInputs,
    arvResult,
    modes,
    mao,
    dscr: { light: dscrLight, standard: dscrStandard, harsh: dscrHarsh },
    ownerHardMode: hardMode
  }
}
