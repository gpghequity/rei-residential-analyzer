// src/qa/fixtures.js
//
// FROZEN golden test deals for the Baby Analyzer QA Runner. Expected values were
// computed ONCE from the real Math Bible engines (incomeMatrix.js / api/calc.js /
// land.js) and frozen here. The QA runner re-runs the SAME engines and compares —
// so any future drift in the math (or routing) fails QA. These fixtures add NO new
// math; they are golden expectations only.
//
// Constants (Math Bible v3 / v3.1):
//   K_BANK_STORAGE = 0.0867368  (7.25% / 25-yr)   storage / MF-20+ / MHP
//   K_BANK_RESI    = 0.0798363  (7%    / 30-yr)   residential / MF-1-19 / commercial / mixed
//   K_SELLER       = 0.0701508  (5%    / 25-yr)   seller note

export const K = { STORAGE: 0.08673682369165958, RESI: 0.07983629942150189, SELLER: 0.07015080498095762 }
export const POCKET_FLOOR = 10000

// engine: 'matrix' = storage/commercial income scenario matrix (incomeMatrix.js)
//         'calc'   = /api/calc engine (residential_*, multifamily_small)
//         'land'   = land.js deterministic metrics
export const FIXTURES = [
  // ─── Residential ────────────────────────────────────────────────────────────
  {
    id: 'resi_flip', label: 'Residential — Flip (MAO)', assetClass: 'Residential',
    type: 'residential', engine: 'calc', calc: { type: 'residential_mao', inputs: { arv: 250000, rehab: 50000 } },
    bibleSection: 'v3 Part 2 — Residential MAO (70% rule)',
    expected: { ltv: 0.80, rate: 0.07, amort: 30, dscrLens: 'n/a (flip)', maxOffer: 115000, status: 'MAO_COMPUTED' },
    formula: 'Offer = (ARV × 0.70) − rehab − $10k wholesale = (250k×0.70) − 50k − 10k'
  },
  {
    id: 'resi_rental', label: 'Residential — Rental (DSCR)', assetClass: 'Residential',
    type: 'residential', engine: 'calc', calc: { type: 'residential_dscr', inputs: { annualNOI: 24000, purchase: 200000 } },
    bibleSection: 'v3 Part 2 — Residential DSCR (80/20 @ 7%/30yr)',
    expected: { ltv: 0.80, rate: 0.07, amort: 30, dscrLens: 1.25, loan: 160000, dscr: 1.8788, pocket: 11226, status: 'DSCR_PASS' },
    formula: 'loan = purchase × 0.80; DSCR = NOI ÷ (loan × K_BANK_RESI)'
  },

  // ─── Multifamily 1–19 (agency) ──────────────────────────────────────────────
  {
    id: 'mf_small', label: 'Multifamily 1–19 (agency)', assetClass: 'Multifamily 1–19',
    type: 'multifamily_small', engine: 'calc', calc: { type: 'multifamily_small', inputs: { noi: 120000 } },
    bibleSection: 'v3.1 Part 5 — MF Tier A (80/20 @ 7%/30yr)',
    expected: { ltv: 0.80, rate: 0.07, amort: 30, dscrLens: 1.25, maxPurchase: 1503000, offer: 1493000, bank: 1202400, dscr: 1.2501, pocket: 24005, status: 'CLEARS_FLOOR' },
    formula: 'P_max = NOI ÷ (1.25 × 0.80 × K_BANK_RESI); Offer = P_max − $10k'
  },

  // ─── Multifamily 20+ (storage/commercial income) ────────────────────────────
  {
    id: 'mf_large', label: 'Multifamily 20+ (commercial income)', assetClass: 'Multifamily 20+',
    type: 'multifamily_large', engine: 'matrix', noi: 120000, capitalStack: true,
    bibleSection: 'v3.1 Part 5 — MF Tier B (75/25 @ 7.25%/25yr) = Storage Group A',
    expected: {
      ltv: 0.75, rate: 0.0725, amort: 25, dscrLens: [1.25, 1.15],
      maxPurchase: 1475000, aggressive: 1604000, offer: 1475000, bank: 1106250, borrower: 368750, pocket: 24047,
      sfBorrower: 100000, sfSeller: 268750, sfBorrowerCost: 8000, sfSellerPayment: 18853, status: 'CLEARS_FLOOR'
    },
    formula: 'P_max = NOI ÷ (1.25 × 0.75 × K_BANK_STORAGE) — identical to Storage Group A'
  },

  // ─── Self Storage (full capital stack) ──────────────────────────────────────
  {
    id: 'storage', label: 'Self Storage', assetClass: 'Self Storage',
    type: 'self_storage', engine: 'matrix', noi: 104400, capitalStack: true,
    bibleSection: 'v3 Part 1 — Storage Group A/B/C (75/25 @ 7.25%/25yr, 35% floor)',
    expected: {
      ltv: 0.75, rate: 0.0725, amort: 25, dscrLens: [1.25, 1.15],
      maxPurchase: 1283000, aggressive: 1395000, offer: 1283000, bank: 962250, borrower: 320750, pocket: 20937,
      sfBorrower: 100000, sfSeller: 220750, sfBorrowerCost: 8000, sfSellerPayment: 15486, status: 'CLEARS_FLOOR'
    },
    formula: 'P_max = NOI ÷ (1.25 × 0.75 × K_BANK_STORAGE); bank=75%, equity=25%'
  },

  // ─── Commercial ─────────────────────────────────────────────────────────────
  {
    id: 'commercial', label: 'Commercial (Retail/Office/Warehouse)', assetClass: 'Commercial',
    type: 'commercial', engine: 'matrix', noi: 200000,
    bibleSection: 'Commercial income engine (75/25 @ 7.25%/25yr)',
    expected: {
      ltv: 0.75, rate: 0.0725, amort: 25, dscrLens: [1.25, 1.15],
      maxPurchase: 2459000, aggressive: 2673000, offer: 2459000, bank: 1844250, borrower: 614750, pocket: 40036, status: 'CLEARS_FLOOR'
    },
    formula: 'P_max = NOI ÷ (1.25 × 0.75 × K_commercial[7.25%/25yr])'
  },

  // ─── MHP / RV ───────────────────────────────────────────────────────────────
  {
    id: 'mhp', label: 'MHP / RV Park', assetClass: 'MHP / RV',
    type: 'mhp_rv', engine: 'matrix', noi: 90000,
    bibleSection: 'Storage/commercial income framework (full engine on MHP tab)',
    expected: {
      ltv: 0.75, rate: 0.0725, amort: 25, dscrLens: [1.25, 1.15],
      maxPurchase: 1106000, aggressive: 1203000, offer: 1106000, bank: 829500, borrower: 276500, pocket: 18052, status: 'CLEARS_FLOOR'
    },
    formula: 'P_max = NOI ÷ (1.25 × 0.75 × K_BANK_STORAGE)'
  },

  // ─── Mixed Use ──────────────────────────────────────────────────────────────
  {
    id: 'mixed', label: 'Mixed Use (blended NOI)', assetClass: 'Mixed Use',
    type: 'mixed_use', engine: 'matrix', noi: 150000,
    bibleSection: 'Commercial income engine on blended NOI (full split on Mixed Use tab)',
    expected: {
      ltv: 0.75, rate: 0.0725, amort: 25, dscrLens: [1.25, 1.15],
      maxPurchase: 1844000, aggressive: 2005000, offer: 1844000, bank: 1383000, borrower: 461000, pocket: 30043, status: 'CLEARS_FLOOR'
    },
    formula: 'P_max = NOI ÷ (1.25 × 0.75 × K_commercial[7.25%/25yr])'
  },

  // ─── Land / IOS (no offer engine) ───────────────────────────────────────────
  {
    id: 'land', label: 'Land / IOS — raw (no income)', assetClass: 'Land / IOS',
    type: 'ios_land', engine: 'land', inputs: { askingPrice: 500000, acres: 5, truckSpaces: 50 },
    bibleSection: 'v3.1 Part 6 — Land supported-intake (NO offer engine)',
    expected: { pricePerAcre: 100000, pricePerSqft: 2.2957, pricePerTruckSpace: 10000, hasOffer: false, capRateIfIncome: null, status: 'SUPPORTED_INTAKE' },
    formula: 'price/acre = ask÷acres; price/sqft = ask÷(acres×43560); NO offer math'
  },
  {
    id: 'land_income', label: 'Land / IOS — with actual income', assetClass: 'Land / IOS',
    type: 'ios_land', engine: 'land', inputs: { askingPrice: 1000000, acres: 10, currentIncome: 100000, currentNOI: 70000 },
    bibleSection: 'v3.1 Part 6 — Land income metrics (labeled estimate only)',
    expected: { pricePerAcre: 100000, currentIncomeMultiple: 10, capRateIfIncome: 0.07, hasOffer: false, status: 'SUPPORTED_INTAKE' },
    formula: 'cap = current NOI ÷ ask; multiple = ask ÷ current income; NO offer math'
  }
]

// One canonical fixture id per asset class (used by the deploy guardrail).
export const ASSET_CLASSES = ['Residential', 'Multifamily 1–19', 'Multifamily 20+', 'Self Storage', 'Commercial', 'MHP / RV', 'Mixed Use', 'Land / IOS']
