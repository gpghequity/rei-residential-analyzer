// src/components/analyze/typeMap.js
//
// The single source of truth mapping each supported property type to:
//   - its question set (vertical-stacked fields)
//   - which existing bible-math /api/calc engine analyzes it (NO new math)
//   - how to build the /api/calc payload from the collected fields
//   - whether an analysis engine exists yet
//
// Engine routing per Steve's directive:
//   Residential        → residential_mao (flip) / residential_dscr (rental)
//   Self Storage       → storage_group_a
//   Multifamily (5+)   → storage_group_a   (existing income-property math; NOT a new engine)
//   Commercial         → commercial_dscr   (Retail / Office / Warehouse)
//   MHP / RV Park      → mhp_noi → storage_group_a
//   Mixed Use          → commercial_dscr on blended NOI
//   IOS / Land         → storage_group_a IF income present; else INTAKE-ONLY (no land math exists)
//
// Lending is intentionally excluded from Baby Analyzer.

const num = (v) => {
  const n = parseFloat(String(v ?? '').replace(/[$,\s]/g, ''));
  return Number.isFinite(n) ? n : 0;
};

// NOI from an explicit NOI field, else gross * (1 - expense ratio).
function deriveNOI(f) {
  if (num(f.noi) > 0) return num(f.noi);
  const gross = num(f.grossIncome);
  if (gross > 0) {
    const expPct = f.expenseRatio !== '' && f.expenseRatio != null ? num(f.expenseRatio) / 100 : 0.4;
    return Math.round(gross * (1 - expPct));
  }
  return 0;
}

const INCOME_FIELDS = [
  { key: 'askingPrice', label: 'Seller Asking Price ($)', type: 'money' },
  { key: 'noi', label: 'Net Operating Income — NOI ($/yr)', type: 'money', hint: 'If blank, enter Gross + Expense Ratio below and Baby Analyzer computes NOI.' },
  { key: 'grossIncome', label: 'Gross Income ($/yr)', type: 'money' },
  { key: 'expenseRatio', label: 'Operating Expense Ratio (%)', type: 'number', hint: 'Defaults to 40% if blank.' }
];

export const PROPERTY_TYPES = [
  {
    id: 'residential',
    label: 'Residential (SFR / 2–4 units)',
    enrichAssetType: 'residential',
    implemented: true,
    subModes: [
      { id: 'flip', label: 'Flip (MAO)' },
      { id: 'rental', label: 'Rental (DSCR)' }
    ],
    fields: [
      { key: 'askingPrice', label: 'Seller Asking Price ($)', type: 'money' },
      { key: 'arv', label: 'After-Repair Value — ARV ($)', type: 'money', modes: ['flip'] },
      { key: 'rehab', label: 'Rehab Budget ($)', type: 'money', modes: ['flip'] },
      { key: 'noi', label: 'Net Operating Income — NOI ($/yr)', type: 'money', modes: ['rental'] },
      { key: 'purchase', label: 'Purchase Price for DSCR ($)', type: 'money', modes: ['rental'], hint: 'Defaults to asking price if blank.' },
      { key: 'beds', label: 'Beds', type: 'number' },
      { key: 'baths', label: 'Baths', type: 'number' },
      { key: 'sqft', label: 'Square Feet', type: 'number' }
    ],
    buildCalc: (f, mode) => {
      if (mode === 'rental') {
        const noi = num(f.noi);
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
    fields: INCOME_FIELDS,
    buildCalc: (f) => { const noi = deriveNOI(f); return noi > 0 ? { type: 'storage_group_a', inputs: { noi } } : null; }
  },
  {
    id: 'multifamily',
    label: 'Multifamily (5+ units)',
    enrichAssetType: 'multifamily',
    implemented: true,
    note: 'Uses the existing Storage / income-property engine (NOI → cap/DSCR → offer). Not a new engine.',
    fields: [
      ...INCOME_FIELDS,
      { key: 'units', label: 'Number of Units', type: 'number' }
    ],
    buildCalc: (f) => { const noi = deriveNOI(f); return noi > 0 ? { type: 'storage_group_a', inputs: { noi } } : null; }
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
      ...INCOME_FIELDS,
      { key: 'sqft', label: 'Building Square Feet', type: 'number' }
    ],
    buildCalc: (f) => { const noi = deriveNOI(f); return noi > 0 ? { type: 'commercial_dscr', inputs: { annualNOI: noi } } : null; }
  },
  {
    id: 'mhp_rv',
    label: 'Mobile Home Park / RV Park',
    enrichAssetType: 'mhp',
    implemented: true,
    fields: [
      { key: 'askingPrice', label: 'Seller Asking Price ($)', type: 'money' },
      { key: 'lots', label: 'Total Lots', type: 'number' },
      { key: 'lotRent', label: 'Lot Rent ($/lot/month)', type: 'money' },
      { key: 'pohUnits', label: 'Park-Owned Homes (count)', type: 'number' },
      { key: 'pohRent', label: 'POH Rent ($/unit/month)', type: 'money' },
      { key: 'expenseRatio', label: 'Operating Expense Ratio (%)', type: 'number', hint: 'Defaults to 40% if blank.' }
    ],
    // MHP is two-step: mhp_noi → storage_group_a on the resulting NOI.
    buildCalc: (f) => {
      const lots = num(f.lots);
      if (lots <= 0) return null;
      return {
        type: 'mhp_noi',
        inputs: {
          lots,
          lotRent: num(f.lotRent),
          pohUnits: num(f.pohUnits),
          pohRent: num(f.pohRent),
          expenseRatio: f.expenseRatio !== '' && f.expenseRatio != null ? num(f.expenseRatio) / 100 : 0.4
        },
        chainToStorage: true
      };
    }
  },
  {
    id: 'mixed_use',
    label: 'Mixed Use',
    enrichAssetType: 'commercial',
    implemented: true,
    note: 'Headline uses blended NOI through the commercial engine. Use the Mixed Use tab for full per-component blending.',
    fields: INCOME_FIELDS,
    buildCalc: (f) => { const noi = deriveNOI(f); return noi > 0 ? { type: 'commercial_dscr', inputs: { annualNOI: noi } } : null; }
  },
  {
    id: 'ios_land',
    label: 'IOS / Land',
    enrichAssetType: 'land',
    implemented: false, // no land math exists platform-wide
    note: 'No land analysis engine exists yet. If the deal produces income (IOS rent / ground lease), enter NOI and Baby Analyzer runs the income engine; raw land is intake-only.',
    fields: [
      { key: 'askingPrice', label: 'Seller Asking Price ($)', type: 'money' },
      { key: 'acres', label: 'Acres', type: 'number' },
      { key: 'noi', label: 'NOI ($/yr) — IOS rent / ground lease (if any)', type: 'money' }
    ],
    buildCalc: (f) => { const noi = num(f.noi); return noi > 0 ? { type: 'storage_group_a', inputs: { noi } } : null; }
  }
];

export function getType(id) {
  return PROPERTY_TYPES.find((t) => t.id === id) || null;
}

export { num, deriveNOI };
