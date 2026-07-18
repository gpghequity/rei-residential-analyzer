// src/components/analyze/typeMap.js
//
// The single source of truth mapping each supported property type to:
//   - its question set (vertical-stacked fields) — the REAL questions for that
//     deal type, not a generic blob
//   - which existing bible-math /api/calc engine analyzes it (NO new math)
//   - how to build the /api/calc payload from the collected fields
//   - whether an analysis engine exists yet
//
// HARD RULES (per Steve):
//   • NEVER ask the user for NOI. Ask Gross Annual Income + Annual Operating
//     Expenses; Residential Analyzer computes NOI itself, ALWAYS.
//   • Unit bands do NOT overlap: 1–4 (residential), 5–19 (small MF), 20+ (large MF).
//   • Each deal type asks the questions that type actually needs.
//
// Engine routing per Steve's directive (unchanged math):
//   Residential 1–4      → residential_mao (flip) / residential_dscr (rental)
//   Self Storage         → storage_group_a
//   Multifamily 5–19     → multifamily_small  (agency 80/20 @ 7%/30yr — Bible v3.1 tier)
//   Multifamily 20+      → multifamily_large  (commercial 75/25 @ 7.25%/25yr — Bible v3.1 tier)
//   Commercial           → commercial_dscr   (Retail / Office / Warehouse)
//   MHP / RV Park        → mhp_noi → storage_group_a
//   Mixed Use            → commercial_dscr on blended NOI
//   IOS / Land           → LAND supported-intake (no offer engine)
//
// Lending is intentionally excluded from Residential Analyzer.

const num = (v) => {
  const n = parseFloat(String(v ?? '').replace(/[$,\s]/g, ''));
  return Number.isFinite(n) ? n : 0;
};

// NOI from Gross − Expenses($), else Gross × (1 − 40% default). A doc-extracted
// NOI (f.noi) is accepted as a fallback ONLY — the USER form never asks for NOI.
// An out-of-range expense ratio (e.g. 41000 fat-fingered into a % field) is
// ignored so a typo can never drive NOI negative.
function deriveNOI(f) {
  const gross = num(f.grossIncome);
  if (gross > 0) {
    const expD = num(f.expenses);
    if (expD > 0) return Math.max(0, Math.round(gross - expD));
    let er = (f.expenseRatio !== '' && f.expenseRatio != null) ? num(f.expenseRatio) / 100 : 0.4;
    if (!(er >= 0) || er > 1) er = 0.4;
    return Math.round(gross * (1 - er));
  }
  if (num(f.noi) > 0) return num(f.noi); // doc-extracted NOI fallback only
  return 0;
}

// Shared income questions — Income + Expenses ONLY (NOI is computed, never asked).
const INCOME_FIELDS = [
  { key: 'askingPrice', label: 'Seller Asking Price ($)', type: 'money' },
  { key: 'grossIncome', label: 'Gross Annual Income ($/yr)', type: 'money', hint: 'All rent + other income for the year, BEFORE expenses.' },
  { key: 'expenses', label: 'Annual Operating Expenses ($/yr)', type: 'money', hint: 'Taxes, insurance, utilities, management, repairs, reserves. Residential Analyzer computes NOI = Income − Expenses (storage enforces a 35% expense floor). Leave blank and a 40% expense assumption is used.' }
];

export const PROPERTY_TYPES = [
  {
    id: 'residential',
    label: 'Single Family / Residential — 1–4 units',
    enrichAssetType: 'residential',
    implemented: true,
    subModes: [
      { id: 'flip', label: 'Flip (MAO)' },
      { id: 'rental', label: 'Rental (DSCR)' }
    ],
    // Beds/baths/sqft/stories drive comps AND the rehab condition engine.
    fields: [
      { key: 'askingPrice', label: 'Seller Asking Price ($)', type: 'money' },
      { key: 'arv', label: 'After-Repair Value — ARV ($)', type: 'money', modes: ['flip'] },
      { key: 'rehab', label: 'Rehab Budget ($) — or use the condition section below', type: 'money', modes: ['flip'], hint: 'Enter a known rehab number, or leave blank and answer the property-condition questions to have Rehab Calc compute it.' },
      { key: 'grossIncome', label: 'Gross Annual Rent ($/yr)', type: 'money', modes: ['rental'], hint: 'All rent + other income for the year, before expenses.' },
      { key: 'expenses', label: 'Annual Operating Expenses ($/yr)', type: 'money', modes: ['rental'], hint: 'Taxes, insurance, management, repairs, reserves. NOI = Rent − Expenses (40% assumed if blank).' },
      { key: 'purchase', label: 'Purchase Price for DSCR ($)', type: 'money', modes: ['rental'], hint: 'Defaults to asking price if blank.' },
      { key: 'units', label: 'Number of Units (1–4)', type: 'number' },
      { key: 'beds', label: 'Beds', type: 'number' },
      { key: 'baths', label: 'Baths', type: 'number' },
      { key: 'sqft', label: 'Living Square Feet', type: 'number' },
      { key: 'stories', label: 'Stories', type: 'number' },
      { key: 'yearBuilt', label: 'Year Built', type: 'number' }
    ],
    buildCalc: (f, mode) => {
      if (mode === 'rental') {
        const noi = deriveNOI(f);
        const purchase = num(f.purchase) || num(f.askingPrice);
        if (noi <= 0 || purchase <= 0) return null;
        return { type: 'residential_dscr', inputs: { annualNOI: noi, purchase } };
      }
      const arv = num(f.arv);
      const rehab = num(f.rehab);
      if (arv <= 0) return null;
      return { type: 'residential_mao', inputs: { arv, rehab } };
    }
  },
  {
    id: 'self_storage',
    label: 'Self Storage',
    enrichAssetType: 'storage',
    implemented: true,
    fields: [
      { key: 'askingPrice', label: 'Seller Asking Price ($)', type: 'money' },
      { key: 'totalUnits', label: 'Total Units', type: 'number' },
      { key: 'climateUnits', label: 'Climate-Controlled Units', type: 'number' },
      { key: 'netRentableSqft', label: 'Net Rentable Square Feet', type: 'number' },
      { key: 'occupancy', label: 'Physical Occupancy (%)', type: 'number', hint: 'Percent of units currently rented, e.g. 88.' },
      { key: 'grossIncome', label: 'Gross Annual Income ($/yr)', type: 'money', hint: 'All rent + late fees + admin/insurance income, before expenses.' },
      { key: 'expenses', label: 'Annual Operating Expenses ($/yr)', type: 'money', hint: 'NOI = Income − Expenses; a 35% expense floor is enforced. 40% assumed if blank.' }
    ],
    buildCalc: (f) => { const noi = deriveNOI(f); return noi > 0 ? { type: 'storage_group_a', inputs: { noi } } : null; }
  },
  {
    id: 'multifamily_small',
    label: 'Multifamily — 5–19 units',
    enrichAssetType: 'multifamily',
    implemented: true,
    note: 'Agency-style financing: 80/20 LTV @ 7% / 30-yr (Math Bible v3.1 small-MF tier). NOI → 1.25 DSCR → max purchase. Reuses the residential bank engine — not a new engine.',
    fields: [
      { key: 'units', label: 'Number of Units (5–19)', type: 'number' },
      ...INCOME_FIELDS
    ],
    buildCalc: (f) => { const noi = deriveNOI(f); return noi > 0 ? { type: 'multifamily_small', inputs: { noi } } : null; }
  },
  {
    id: 'multifamily_large',
    label: 'Multifamily — 20+ units',
    enrichAssetType: 'multifamily',
    implemented: true,
    note: 'Storage / commercial income-property framework: 75/25 LTV @ 7.25% / 25-yr (Math Bible v3.1 large-MF tier). Routes through the income scenario matrix (Group A/B/C bank + seller-finance), identical capital stack to Storage Group A.',
    fields: [
      { key: 'units', label: 'Number of Units (20+)', type: 'number' },
      ...INCOME_FIELDS
    ],
    // Income-matrix asset (isIncomeAsset) — the matrix renders it. buildCalc is a
    // single-offer fallback (same number) kept for the /api/calc regression harness.
    buildCalc: (f) => { const noi = deriveNOI(f); return noi > 0 ? { type: 'multifamily_large', inputs: { noi } } : null; }
  },
  {
    id: 'commercial',
    label: 'Commercial (Retail / Office / Warehouse)',
    enrichAssetType: 'commercial',
    implemented: true,
    subModes: [
      { id: 'retail', label: 'Retail' },
      { id: 'office', label: 'Office' },
      { id: 'warehouse', label: 'Warehouse' }
    ],
    fields: [
      { key: 'askingPrice', label: 'Seller Asking Price ($)', type: 'money' },
      { key: 'sqft', label: 'Building Square Feet', type: 'number' },
      { key: 'leasableSqft', label: 'Net Leasable Square Feet', type: 'number' },
      { key: 'occupancy', label: 'Occupancy (%)', type: 'number', hint: 'Percent leased, e.g. 90.' },
      { key: 'grossIncome', label: 'Gross Annual Income ($/yr)', type: 'money', hint: 'Base rent + reimbursements + other income, before expenses.' },
      { key: 'expenses', label: 'Annual Operating Expenses ($/yr)', type: 'money', hint: 'NOI = Income − Expenses (40% assumed if blank).' }
    ],
    buildCalc: (f) => { const noi = deriveNOI(f); return noi > 0 ? { type: 'commercial_dscr', inputs: { annualNOI: noi } } : null; }
  },
  {
    id: 'mhp_rv',
    label: 'Mobile Home Park / RV Park',
    enrichAssetType: 'mhp',
    implemented: true,
    note: 'Income is built from lot economics (lots × lot rent + park-owned homes). Residential Analyzer computes NOI and runs the storage/commercial income framework.',
    fields: [
      { key: 'askingPrice', label: 'Seller Asking Price ($)', type: 'money' },
      { key: 'lots', label: 'Total Lots', type: 'number' },
      { key: 'lotRent', label: 'Lot Rent ($/lot/month)', type: 'money' },
      { key: 'pohUnits', label: 'Park-Owned Homes (count)', type: 'number' },
      { key: 'pohRent', label: 'POH Rent ($/unit/month)', type: 'money' },
      { key: 'expenses', label: 'Annual Operating Expenses ($/yr)', type: 'money', hint: 'Leave blank to use a 40% expense assumption on the gross lot income.' }
    ],
    // MHP is two-step: mhp_noi → storage_group_a on the resulting NOI. Income is
    // built from lot economics (lots × lot rent + park-owned homes) inside the
    // engine; we only convert an expense-dollars entry into the ratio it expects.
    buildCalc: (f) => {
      const lots = num(f.lots);
      if (lots <= 0) return null;
      const grossEst = lots * num(f.lotRent) * 12 + num(f.pohUnits) * num(f.pohRent) * 12;
      const er = (num(f.expenses) > 0 && grossEst > 0)
        ? Math.min(0.95, num(f.expenses) / grossEst)
        : 0.4;
      return {
        type: 'mhp_noi',
        inputs: {
          lots,
          lotRent: num(f.lotRent),
          pohUnits: num(f.pohUnits),
          pohRent: num(f.pohRent),
          expenseRatio: er
        },
        chainToStorage: true
      };
    }
  },
  {
    id: 'rv_park',
    label: 'RV Park',
    enrichAssetType: 'mhp',
    implemented: true,
    note: 'Income property. Headline value uses NOI × 13 (~7.7% cap — latest auto-offer method) alongside the full financing matrix.',
    fields: [
      { key: 'askingPrice', label: 'Seller Asking Price ($)', type: 'money' },
      { key: 'sites', label: 'Total RV Sites', type: 'number' },
      { key: 'siteRent', label: 'Avg Site Rent ($/site/month)', type: 'money' },
      { key: 'occupancy', label: 'Occupancy (%)', type: 'number' },
      { key: 'grossIncome', label: 'Gross Annual Income ($/yr)', type: 'money', hint: 'All site rent + other income, before expenses.' },
      { key: 'expenses', label: 'Annual Operating Expenses ($/yr)', type: 'money', hint: 'NOI = Income − Expenses (40% assumed if blank).' }
    ],
    buildCalc: (f) => { const noi = deriveNOI(f); return noi > 0 ? { type: 'storage_group_a', inputs: { noi } } : null; }
  },
  {
    id: 'ios',
    label: 'Industrial Outdoor Storage (IOS)',
    enrichAssetType: 'commercial',
    implemented: true,
    note: 'Income property (truck/trailer/equipment yards). Headline value uses NOI × 14 (~7.1% cap — latest auto-offer method) alongside the full financing matrix.',
    fields: [
      { key: 'askingPrice', label: 'Seller Asking Price ($)', type: 'money' },
      { key: 'acres', label: 'Usable Acres', type: 'number' },
      { key: 'occupancy', label: 'Occupancy (%)', type: 'number' },
      { key: 'grossIncome', label: 'Gross Annual Income ($/yr)', type: 'money', hint: 'All yard/space rent + other income, before expenses.' },
      { key: 'expenses', label: 'Annual Operating Expenses ($/yr)', type: 'money', hint: 'NOI = Income − Expenses (40% assumed if blank).' }
    ],
    buildCalc: (f) => { const noi = deriveNOI(f); return noi > 0 ? { type: 'storage_group_a', inputs: { noi } } : null; }
  },
  {
    id: 'mixed_use',
    label: 'Mixed Use',
    enrichAssetType: 'commercial',
    implemented: true,
    note: 'Headline uses blended NOI through the commercial engine. Open the Advanced section for full per-component blending.',
    fields: INCOME_FIELDS,
    buildCalc: (f) => { const noi = deriveNOI(f); return noi > 0 ? { type: 'commercial_dscr', inputs: { annualNOI: noi } } : null; }
  },
  {
    id: 'ios_land',
    label: 'Land / IOS / Outdoor Storage',
    enrichAssetType: 'land',
    implemented: false, // no approved land OFFER engine exists — land uses supported-intake
    note: 'Land / IOS / outdoor storage uses LAND supported-intake logic — the dedicated land underwriter opens automatically for this type. Land is NEVER routed through storage, residential, multifamily, or commercial building math.',
    fields: [
      { key: 'askingPrice', label: 'Seller Asking Price ($)', type: 'money' },
      { key: 'acres', label: 'Acres', type: 'number' }
    ],
    // Land has NO offer engine here — never borrow storage/other math, even with income.
    buildCalc: () => null
  }
];

export function getType(id) {
  return PROPERTY_TYPES.find((t) => t.id === id) || null;
}

export { num, deriveNOI };
