/**
 * PLATFORM_UNDERWRITING_STANDARDS
 *
 * Authoritative source for all REI platform underwriting assumptions.
 * Used across: FastCalc, Auto Offer, Deal Analyzer, Baby Analyzer, Net Sheet,
 * Comp Snapshot, Lender Command, Lending Intake, Report Engine, Vendor Directory Scoring
 *
 * Source: REI_Math_Bible_v3.docx + CLAUDE.md locked deal rules + 14_MATH_BIBLE_VERIFICATION.md
 * Last Verified: 2026-06-01
 * Last Modified: 2026-06-01
 */

const PLATFORM_UNDERWRITING_STANDARDS = {

  // ============================================================================
  // GLOBAL DEFAULTS (all asset classes)
  // ============================================================================

  GLOBAL: {
    wholesaleFeeAmount: 10_000,           // Flat wholesale fee on all offers
    closingCostsFlatAmount: 2_000,        // Flat closing costs default
    insuranceMonthly: 1_200,              // Annual insurance estimate
    taxesMonthly: 0,                      // Computed per property, not flat
    holdingCostPercentMonthly: 0.01,      // 1% monthly holding cost
    transferTaxPercent: 0.01,             // PA: 1% seller transfer tax
    titleEscrowRecordingPercent: 0.005,   // PA: 0.5% title/escrow/recording
    commissionDefaultPercent: 0.03,       // 3% or $4K minimum
    commissionMinimum: 4_000,
    pocketCashFloor: 10_000,              // HARD FLOOR: flag if below this

    // Comps and AVM
    arvPercentile: 0.40,                  // ALWAYS 40th percentile, NEVER midpoint/average
    compSourcePriority: ['automatic', 'uploaded', 'manual'], // Order of preference

    // Income verification
    incomeVerification: 'current_verified_only', // Never use pro-forma
    daysOfIncomeHistory: 12,              // T-12 minimum for rentals
  },

  // ============================================================================
  // RESIDENTIAL (SFR, MF, Rental)
  // ============================================================================

  RESIDENTIAL: {
    assetClass: 'residential',
    mortgageRate: 0.07,                   // 7.00%
    amortizationYears: 30,
    ltv: 0.80,                            // 80% LTV
    dscr: 1.25,                           // Min 1.25x

    // Expense pads (applies to NOI calculation for rental scenarios)
    expensePads: {
      light: 0.00,      // No pad = gross - hard costs only
      standard: 0.20,   // 20% pad = conservative
      harsh: 0.33,      // 33% pad = very conservative
      default: 'standard'
    },

    // Specific subclass rates (mixed-use defaults to residential rate)
    subclassDefaults: {
      sfr: { capRate: null, dscr: 1.25, comments: 'Uses DSCR ladder, not cap rate' },
      mf: { capRate: null, dscr: 1.25, comments: 'Uses DSCR ladder, not cap rate' },
      rental: { capRate: null, dscr: 1.25, comments: 'Uses DSCR ladder, not cap rate' }
    },

    // Hard mode (internal only — owner financing)
    hardModeFormula: '(NOI / 1.25 - rehab - closing) / (0.8 * K + rate)',

    // Offer types
    cashAsIs: {
      formula: 'ARV × 0.70 - rehab_estimate',
      description: 'Cash offer for as-is property',
      requiresARV: true
    },

    termsOffer: {
      downPaymentPercent: 0.10,           // 10% down
      interestRate: 0.05,                 // 5% APR
      balloonYears: 7,                    // Balloon in 7 years
      amortizationYears: 30,              // Payments calculated over 30yr
      formula: 'seller_note_principal = (NOI / 1.25 - bank_DS - closing); monthly_payment = principal * K_SELLER(5%, 30yr)',
      description: 'Seller-financed offer'
    },

    listAsIs: {
      formula: 'ARV - (rehab_estimate * 0.93)',  // 93% realization
      description: 'List property as-is for retail sale',
      requiresARV: true
    },

    listAfterRepairs: {
      formula: 'ARV - commission_on_ARV',
      description: 'List property after repairs complete',
      requiresARV: true
    }
  },

  // ============================================================================
  // STORAGE (Mini storage, climate-controlled, outdoor)
  // ============================================================================

  STORAGE: {
    assetClass: 'storage',
    mortgageRate: 0.0725,                 // 7.25%
    amortizationYears: 25,
    ltv: 0.75,                            // 75% LTV (even seller finance)
    dscr: {
      standard: 1.25,
      stretch: 1.15
    },

    expenseFloor: 0.35,                   // 35% FLOOR — binds upward only
    pocketCashFloor: 10_000,              // $10K Y1 minimum
    stabilizedNOIFloor: 40_000,           // KILL if under $40K

    // 10-scenario matrix (6 conventional + 4 seller finance)
    scenarios: {
      groupA_v1_1_25: {
        name: 'Bank Only (1.25x DSCR)',
        bankOnly: true,
        dscr: 1.25,
        equityPercent: 0.25,
        equityType: 'sunk'
      },
      groupA_v1_1_15: {
        name: 'Bank Only (1.15x DSCR)',
        bankOnly: true,
        dscr: 1.15,
        equityPercent: 0.25,
        equityType: 'sunk'
      },
      groupA_v2_1_25: {
        name: 'Bank + IO Equity (1.25x DSCR)',
        bankPercent: 0.75,
        equityPercent: 0.25,
        equityType: 'interest_only',
        equityRate: 0.08,
        dscr: 1.25
      },
      groupA_v2_1_15: {
        name: 'Bank + IO Equity (1.15x DSCR)',
        bankPercent: 0.75,
        equityPercent: 0.25,
        equityType: 'interest_only',
        equityRate: 0.08,
        dscr: 1.15
      },
      groupA_v3_1_25: {
        name: 'Bank + Amortized Equity (1.25x DSCR)',
        bankPercent: 0.75,
        equityPercent: 0.25,
        equityType: 'amortized',
        equityRate: 0.08,
        equityTerm: 25,
        dscr: 1.25
      },
      groupA_v3_1_15: {
        name: 'Bank + Amortized Equity (1.15x DSCR)',
        bankPercent: 0.75,
        equityPercent: 0.25,
        equityType: 'amortized',
        equityRate: 0.08,
        equityTerm: 25,
        dscr: 1.15
      },
      groupB_sellerNote_1_25: {
        name: 'Seller Note (1.25x DSCR)',
        sellerNotePercent: 0.75,
        bankPercent: 0.25,
        sellerNoteRate: 0.05,
        sellerNoteTerm: 10,
        dscr: 1.25,
        requiresSunsetTest: true
      },
      groupB_sellerNote_1_15: {
        name: 'Seller Note (1.15x DSCR)',
        sellerNotePercent: 0.75,
        bankPercent: 0.25,
        sellerNoteRate: 0.05,
        sellerNoteTerm: 10,
        dscr: 1.15,
        requiresSunsetTest: true
      },
      groupC_sellerKicker_1_25: {
        name: 'Seller Note + Kicker (1.25x DSCR)',
        sellerNotePercent: 0.75,
        bankPercent: 0.25,
        sellerNoteRate: 0.05,
        sellerNoteTerm: 10,
        kickerPercent: 0.20,  // 20% NOI delta above baseline
        dscr: 1.25,
        requiresSunsetTest: true
      },
      groupC_sellerKicker_1_15: {
        name: 'Seller Note + Kicker (1.15x DSCR)',
        sellerNotePercent: 0.75,
        bankPercent: 0.25,
        sellerNoteRate: 0.05,
        sellerNoteTerm: 10,
        kickerPercent: 0.20,
        dscr: 1.15,
        requiresSunsetTest: true
      }
    }
  },

  // ============================================================================
  // COMMERCIAL (Office, retail, industrial, restaurant, etc.)
  // ============================================================================

  COMMERCIAL: {
    assetClass: 'commercial',
    mortgageRate: 0.0725,                 // 7.25% — storage = commercial = MF20+ (Steve / Bible §1)
    amortizationYears: 25,                // 25yr standard
    ltv: 0.75,                            // 75% LTV
    dscr: {
      standard: 1.25,
      stretch: 1.20
    },

    // Subclass-specific cap rates and vacancy floors
    subclasses: {
      retailStrip: { capRate: 0.08, vacancyFloor: 0.10, comments: 'Single-tenant or multi-tenant' },
      singleTenant: { capRate: 0.07, vacancyFloor: 0.05, comments: 'Credit tenant preferred' },
      officeGeneral: { capRate: 0.085, vacancyFloor: 0.12, comments: 'Class A/B/C varies' },
      officeMedical: { capRate: 0.085, vacancyFloor: 0.08, comments: 'Typically longer leases' },
      industrialFlex: { capRate: 0.075, vacancyFloor: 0.08, comments: '3PL, last-mile' },
      warehouse: { capRate: 0.065, vacancyFloor: 0.05, comments: 'Modern specs premium' },
      mixedUse: { capRate: null, vacancyFloor: 0.10, comments: 'Blended by tenant mix' },
      restaurant: { capRate: 0.10, vacancyFloor: 0.00, comments: 'Triple-net or proprietor' },
      carwash: { capRate: 0.095, vacancyFloor: 0.00, comments: 'High-margin, service' },
      specialPurpose: { capRate: null, vacancyFloor: null, comments: 'Case-by-case' }
    },

    // Mixed-use blending formula
    mixedUseFormula: 'blended_cap = (capRate_A * sqft_A + capRate_B * sqft_B) / total_sqft',

    // NNN and tenant concentration flags
    nnnFlowThrough: true,                 // NNN reimbursements are pass-through
    tenantConcentrationThreshold: 0.40,   // Flag if >40% of GLA

    // Lease audit required: must have current executed leases + estoppels
    leaseAuditRequired: true
  },

  // ============================================================================
  // MHP (Mobile Home Parks)
  // ============================================================================

  MHP: {
    assetClass: 'mhp',
    capRateRange: { min: 0.085, max: 0.10 }, // 8.5–10% typically
    mortgageRate: 0.0725,                  // 7.25% — MHP uses the storage framework (Bible §1)
    amortizationYears: 25,
    ltv: 0.75,
    dscr: 1.25,

    // Critical MHP factors
    padRentStability: 'required',         // 2yr history minimum
    pohVsToHSplit: 'required',            // Park-owned vs tenant-owned units affects valuation
    infillExecutionRisk: 'required',      // Can new units be added?
    utilityRedFlags: {
      ownerPays: 'MAJOR FLAG',            // Owner utility responsibility is high-risk
      regulatoryRisk: 'MAJOR FLAG'        // Rent caps, approval requirements vary by state
    }
  },

  // ============================================================================
  // LENDING (Private lending, fix-and-flip, fix-and-hold)
  // ============================================================================

  LENDING: {
    assetClass: 'lending',
    loanAmount: 'ARV based',
    ltv: { max: 0.75 },                   // ≤75% LTV of ARV (residential)
    interestRate: 0.12,                   // 12% baseline
    pointsPercent: 0.02,                  // 2% points
    term: '6-12 months',                  // Typically short-term bridge

    // Required docs
    requiredDocs: [
      'personal_guarantee',
      'lien_position_confirmed',
      'title_commitment',
      'proof_of_funds'
    ],

    // Stress test at ARV miss scenarios
    stressTests: [
      { miss: -0.10, label: '-10% ARV miss' },
      { miss: -0.20, label: '-20% ARV miss' },
      { miss: -0.25, label: '-25% ARV miss' },    // PRIMARY decision lens
      { miss: -0.30, label: '-30% ARV miss' },
      { miss: -0.50, label: '-50% ARV miss' }
    ],

    // Decision rule on stress test
    stressTestDecisionRule: 'If -25% ARV miss loses the lender money (first lien recovery breaks), WALK unless borrower has documented liquidity > shortfall'
  },

  // ============================================================================
  // OFFER TERMINOLOGY (Unified across all tools)
  // ============================================================================

  OFFER_VERDICTS: {
    PASS: 'Deal does not meet acquisition criteria. Do not pursue.',
    PURSUE: 'Deal meets criteria. Recommended action: make offer.',
    TENTATIVE: 'Deal may work but requires verified T-12 + rent roll + occupancy confirmation.',
    NEGOTIATE: 'Deal works at higher price or different terms. Counter or renegotiate.',
    KILL: 'Deal has unreconcilable issues. Do not pursue under any terms.'
  },

  OFFER_TYPES: {
    cash: 'Cash offer, no financing',
    terms: 'Seller-financed offer (10% down, 5% rate, 7yr balloon, 30yr amort)',
    list_as_is: 'List property as-is for retail sale (ARV - rehab * 0.93)',
    list_after_repairs: 'List property after repairs complete',
    wholesale: 'Assign to end buyer'
  },

  // ============================================================================
  // UI CONFIGURATION
  // ============================================================================

  UI: {
    // Which fields to display for internal/team users (can adjust)
    internalAdjustableFields: [
      'mortgageRate',
      'dscr',
      'expensePad',
      'ltv',
      'capRate',
      'wholesaleFee',
      'commissionPercent',
      'arvPercentile',
      'holdingCostPercent'
    ],

    // Which fields are displayed to public sellers (read-only, no adjustment)
    publicDisplayFields: [
      'ARV',
      'Rehab Estimate',
      'Your Cash Offer',
      'Terms Offer',
      'List-As-Is Offer',
      'Next Steps'
    ],

    // Never show to public sellers
    publicHiddenFields: [
      'DSCR',
      'LTV',
      'Expense Pad',
      'Mortgage Rate',
      'Pocket Cash Calculation',
      'Stress Tests'
    ]
  }
};

// ============================================================================
// EXPORT
// ============================================================================

module.exports = PLATFORM_UNDERWRITING_STANDARDS;
