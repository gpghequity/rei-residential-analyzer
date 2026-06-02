// src/math/rehab/rehabSystems.js
//
// PORTED FROM rei-rehab-calc (src/config/systems.residential.js,
// systems.storage.js, defaults.json) on 2026-06-02. Steve's LOCKED v2.0 numbers
// for residential + storage. Commercial system set added here from 2026 national
// averages (Rehab Calc has no commercial set) — sources: SolutionsGC, Harris
// Constructors, Veteran Roofing 2026 guides (roof $7.50–16/sf, HVAC $15–40/sf,
// electrical $2–15/sf, interior/TI $40–80/sf gut, asphalt ~$4/sf).
//
// Isolation rule: this is a snapshot copy. No live import from rei-rehab-calc.
// The math (rehabMath.js) consumes these defs; UI never imports math the other way.

export const TIER_RATES = {
  new: 0.00, modern: 0.25, semiModern: 0.50, old: 0.80, missing: 1.00,
  drywallNeeded: 2.00, studdedOut: 3.00
};
export const TIER_LABELS = {
  new: 'New', modern: 'Modern', semiModern: 'Semi Modern', old: 'Old',
  missing: 'Missing', drywallNeeded: 'Drywall needed', studdedOut: 'Studded out'
};
export const STANDARD_TIER_KEYS = ['new', 'modern', 'semiModern', 'old', 'missing'];
export const COSMETIC_TIER_KEYS = ['new', 'modern', 'semiModern', 'old', 'missing', 'drywallNeeded', 'studdedOut'];

const AMOUNTS = {
  holdingBudget:   [0, 200, 500, 1000, 1500, 3000, 5000],
  standardPrice:   [0, 500, 1500, 2500, 5000, 8000, 10000],
  furnace:         [0, 1000, 2000, 3000, 6000, 10000],
  plumbing:        [0, 1000, 2000, 3000, 4000, 5000, 6000, 7000, 8000],
  electrical:      [0, 500, 1000, 2000, 4000, 6000, 8000],
  storageGate:     [0, 4000, 8000, 12000, 20000],
  storageAccess:   [0, 2000, 5000, 10000, 20000],
  storageOffice:   [0, 2500, 5000, 10000, 15000],
  storageSignage:  [0, 1500, 3000, 5000, 10000],
  storageSiteWork: [0, 2500, 5000, 10000, 20000, 40000],
  commParking:     [0, 5000, 15000, 30000, 60000, 100000],
  commPlumbing:    [0, 5000, 15000, 30000, 60000, 120000],
  commStorefront:  [0, 5000, 15000, 30000, 60000],
  commSignage:     [0, 2500, 7500, 15000, 30000],
  commSiteWork:    [0, 10000, 25000, 50000, 100000]
};
export const HOLDING_BUDGET_AMOUNTS = AMOUNTS.holdingBudget;

// ── RESIDENTIAL (Steve's locked v2.0) ───────────────────────────────────────
export const RESIDENTIAL_SYSTEMS = [
  { id: 'cosmetic', label: 'Cosmetic condition', pattern: 'A', pricing: { kind: 'rate_x_sizing', baseCost: 15, sizingTerm: 'totalSqFt', sizingUnit: 'sqft', tierKeys: COSMETIC_TIER_KEYS } },
  { id: 'windows', label: 'Windows', pattern: 'A', pricing: { kind: 'rate_x_count', baseCost: 350, defaultCount: 20, countLabel: '# Windows', countUnit: 'windows' } },
  { id: 'siding', label: 'Siding', pattern: 'A', pricing: { kind: 'siding_formula', baseCost: 12, perimeterFactor: 4.5, wallHeight: 9, gableFactor: 1.10 } },
  { id: 'roof', label: 'Roof', pattern: 'A', pricing: { kind: 'roof_formula', baseCost: 7, pitchMultiplier: 1.12 } },
  { id: 'kitchen', label: 'Kitchen', pattern: 'A', pricing: { kind: 'static_per_unit', tiers: { new: 0, modern: 2000, semiModern: 4000, old: 7000, missing: 10000 }, unitWord: 'kitchen' } },
  { id: 'fullBath', label: 'Full bath', pattern: 'B', pricing: { kind: 'static_per_count', tiers: { new: 0, modern: 1500, semiModern: 2500, old: 4000, missing: 6000 }, defaultCount: 'units', countLabel: 'How many' } },
  { id: 'halfBath', label: '1/2 bath', pattern: 'B', pricing: { kind: 'static_per_count', tiers: { new: 0, modern: 800, semiModern: 1500, old: 2500, missing: 4500 }, defaultCount: 0, countLabel: 'How many' } },
  { id: 'threeQtrBath', label: '3/4 bath', pattern: 'B', pricing: { kind: 'static_per_count', tiers: { new: 0, modern: 1000, semiModern: 2000, old: 3000, missing: 5000 }, defaultCount: 0, countLabel: 'How many' } },
  { id: 'appliances', label: 'Appliances', pattern: 'A', pricing: { kind: 'static_per_unit', tiers: { new: 0, modern: 400, semiModern: 700, old: 1500, missing: 1800 }, unitWord: 'set' } },
  { id: 'exterior', label: 'Exterior', pattern: 'C', pricing: { kind: 'amounts', amounts: AMOUNTS.standardPrice } },
  { id: 'porch', label: 'Porch', pattern: 'C', pricing: { kind: 'amounts', amounts: AMOUNTS.standardPrice } },
  { id: 'basement', label: 'Basement', pattern: 'C', pricing: { kind: 'amounts', amounts: AMOUNTS.standardPrice } },
  { id: 'structure', label: 'Structure', pattern: 'C', pricing: { kind: 'amounts', amounts: AMOUNTS.standardPrice } },
  { id: 'furnace', label: 'Furnace', pattern: 'C', pricing: { kind: 'amounts', amounts: AMOUNTS.furnace } },
  { id: 'plumbing', label: 'Plumbing', pattern: 'C', pricing: { kind: 'amounts', amounts: AMOUNTS.plumbing } },
  { id: 'electrical', label: 'Electrical', pattern: 'C', pricing: { kind: 'amounts', amounts: AMOUNTS.electrical } },
  { id: 'holding', label: 'Holding costs', pattern: 'D', pricing: { kind: 'amounts', amounts: AMOUNTS.holdingBudget } }
];

// ── STORAGE (Steve's locked v2.0) ───────────────────────────────────────────
export const STORAGE_SYSTEMS = [
  { id: 'roof', label: 'Roof / membrane', pattern: 'A', pricing: { kind: 'rate_x_sizing', baseCost: 6, sizingTerm: 'roofSqFt', sizingUnit: 'sqft' } },
  { id: 'rollupDoors', label: 'Roll-up doors', pattern: 'A', pricing: { kind: 'rate_x_count', baseCost: 355, defaultCount: 'totalUnits', countLabel: '# Doors', countUnit: 'doors' } },
  { id: 'doorHardware', label: 'Door hardware', pattern: 'A', pricing: { kind: 'rate_x_count', baseCost: 50, defaultCount: 'totalUnits', countLabel: '# Doors', countUnit: 'doors' } },
  { id: 'pavement', label: 'Pavement / drive aisles', pattern: 'A', pricing: { kind: 'rate_x_sizing', baseCost: 5, sizingTerm: 'driveAisleSqFt', sizingUnit: 'sqft' } },
  { id: 'fencing', label: 'Perimeter fencing', pattern: 'A', pricing: { kind: 'rate_x_sizing', baseCost: 22, sizingTerm: 'perimeterLf', sizingUnit: 'lf' } },
  { id: 'gate', label: 'Gate / motor', pattern: 'C', pricing: { kind: 'amounts', amounts: AMOUNTS.storageGate } },
  { id: 'accessControl', label: 'Access control system', pattern: 'C', pricing: { kind: 'amounts', amounts: AMOUNTS.storageAccess } },
  { id: 'cameras', label: 'Cameras / security', pattern: 'A', pricing: { kind: 'rate_x_count', baseCost: 500, defaultCount: 8, countLabel: '# Cameras', countUnit: 'cameras' } },
  { id: 'poleLights', label: 'Pole / area lighting', pattern: 'A', pricing: { kind: 'rate_x_count', baseCost: 2000, defaultCount: 4, countLabel: '# Poles', countUnit: 'poles' } },
  { id: 'office', label: 'Office buildout', pattern: 'C', pricing: { kind: 'amounts', amounts: AMOUNTS.storageOffice } },
  { id: 'climateHallway', label: 'Climate hallway interior', pattern: 'A', pricing: { kind: 'rate_x_sizing', baseCost: 25, sizingTerm: 'climateHallwaySqFt', sizingUnit: 'sqft' } },
  { id: 'hvac', label: 'HVAC / climate control', pattern: 'A', pricing: { kind: 'hvac_storage_formula', baseCost: 10, avgUnitSize: 100, hideWhen: { sizingTerm: 'climateUnits', equals: 0 } } },
  { id: 'signage', label: 'Signage', pattern: 'C', pricing: { kind: 'amounts', amounts: AMOUNTS.storageSignage } },
  { id: 'siteWork', label: 'Site work / drainage', pattern: 'C', pricing: { kind: 'amounts', amounts: AMOUNTS.storageSiteWork } },
  { id: 'unitInterior', label: 'Unit interior repairs', pattern: 'A', pricing: { kind: 'rate_x_count', baseCost: 200, defaultCount: 'totalUnits', countLabel: '# Units', countUnit: 'units' } },
  { id: 'exteriorPaint', label: 'Exterior paint / cladding', pattern: 'A', pricing: { kind: 'rate_x_sizing', baseCost: 3, sizingTerm: 'exteriorSqFt', sizingUnit: 'sqft' } },
  { id: 'holding', label: 'Holding costs', pattern: 'D', pricing: { kind: 'amounts', amounts: AMOUNTS.holdingBudget } }
];

// ── COMMERCIAL (2026 national averages — full-replacement $/sf, tier-scaled) ──
export const COMMERCIAL_SYSTEMS = [
  { id: 'interior', label: 'Interior buildout / TI', pattern: 'A', pricing: { kind: 'rate_x_sizing', baseCost: 60, sizingTerm: 'buildingSqFt', sizingUnit: 'sqft', tierKeys: COSMETIC_TIER_KEYS } },
  { id: 'roof', label: 'Roof', pattern: 'A', pricing: { kind: 'rate_x_sizing', baseCost: 12, sizingTerm: 'roofSqFt', sizingUnit: 'sqft' } },
  { id: 'hvac', label: 'HVAC', pattern: 'A', pricing: { kind: 'rate_x_sizing', baseCost: 18, sizingTerm: 'buildingSqFt', sizingUnit: 'sqft' } },
  { id: 'electrical', label: 'Electrical', pattern: 'A', pricing: { kind: 'rate_x_sizing', baseCost: 8, sizingTerm: 'buildingSqFt', sizingUnit: 'sqft' } },
  { id: 'facade', label: 'Facade / exterior', pattern: 'A', pricing: { kind: 'rate_x_sizing', baseCost: 15, sizingTerm: 'buildingSqFt', sizingUnit: 'sqft' } },
  { id: 'parking', label: 'Parking lot', pattern: 'C', pricing: { kind: 'amounts', amounts: AMOUNTS.commParking } },
  { id: 'plumbing', label: 'Plumbing', pattern: 'C', pricing: { kind: 'amounts', amounts: AMOUNTS.commPlumbing } },
  { id: 'storefront', label: 'Storefront / glazing', pattern: 'C', pricing: { kind: 'amounts', amounts: AMOUNTS.commStorefront } },
  { id: 'signage', label: 'Signage', pattern: 'C', pricing: { kind: 'amounts', amounts: AMOUNTS.commSignage } },
  { id: 'siteWork', label: 'Site work / drainage', pattern: 'C', pricing: { kind: 'amounts', amounts: AMOUNTS.commSiteWork } },
  { id: 'holding', label: 'Holding costs', pattern: 'D', pricing: { kind: 'amounts', amounts: AMOUNTS.holdingBudget } }
];

export const SIZING_FIELDS = {
  residential: [
    { key: 'units', label: '# Units', placeholder: '1' },
    { key: 'sqFtPerUnit', label: 'Sq Ft / Unit', placeholder: '800' },
    { key: 'commonSqFt', label: 'Common Sq Ft', placeholder: '100' },
    { key: 'stories', label: '# Stories', placeholder: '1' }
  ],
  storage: [
    { key: 'totalUnits', label: 'Total units', placeholder: '200' },
    { key: 'climateUnits', label: 'Climate units', placeholder: '0' },
    { key: 'roofSqFt', label: 'Roof sq ft', placeholder: '30000' },
    { key: 'driveAisleSqFt', label: 'Drive aisle sq ft', placeholder: '18000' },
    { key: 'perimeterLf', label: 'Perimeter linear ft', placeholder: '800' },
    { key: 'climateHallwaySqFt', label: 'Climate hallway sq ft', placeholder: '0' },
    { key: 'exteriorSqFt', label: 'Building exterior sq ft', placeholder: '16000' }
  ],
  commercial: [
    { key: 'buildingSqFt', label: 'Building sq ft', placeholder: '10000' },
    { key: 'roofSqFt', label: 'Roof sq ft', placeholder: '10000' }
  ]
};

export const SYSTEMS_BY_MODE = {
  residential: RESIDENTIAL_SYSTEMS,
  storage: STORAGE_SYSTEMS,
  commercial: COMMERCIAL_SYSTEMS
};

// National-average rehab benchmark, $/sf by overall condition tier. Source:
// rei-data-enrichment /api/rehab-benchmark (Remodeling Magazine + HomeAdvisor,
// national median). This drives the "national averages" total shown beside
// Steve's line-item engine total. mid-Atlantic regional ≈ national × 1.07.
export const NATIONAL_PSF = { move_in: 8, light_rehab: 22, medium_rehab: 45, heavy_rehab: 80, studs: 130 };
export const REGIONAL_ADJ = 1.07; // mid-Atlantic (PA)

export const OVERALL_TIERS = [
  { id: 'move_in', label: 'Move-in ready' },
  { id: 'light_rehab', label: 'Light (cosmetic)' },
  { id: 'medium_rehab', label: 'Medium (kitchen/bath + cosmetics)' },
  { id: 'heavy_rehab', label: 'Heavy (multiple systems)' },
  { id: 'studs', label: 'Down to studs / gut' }
];

// Map a per-system condition tier (or pic-rehab overall tier) to a benchmark tier.
export function toBenchmarkTier(condition) {
  switch (condition) {
    case 'new': return 'move_in';
    case 'modern': return 'light_rehab';
    case 'semiModern': return 'medium_rehab';
    case 'old': return 'heavy_rehab';
    case 'missing': case 'drywallNeeded': case 'studdedOut': return 'studs';
    // pic-rehab style overall tiers pass through if already benchmark-shaped:
    case 'move_in': case 'light_rehab': case 'medium_rehab': case 'heavy_rehab': case 'studs': return condition;
    default: return 'medium_rehab';
  }
}

// Whether Baby has Steve's locked figures for this mode, or is using national
// averages (commercial). Surfaced in the UI so the source is never ambiguous.
export const RATE_SOURCE = {
  residential: "Steve's locked figures (Rehab Calc v2.0)",
  storage: "Steve's locked figures (Rehab Calc v2.0)",
  commercial: '2026 national averages (Rehab Calc has no commercial set)'
};

export function freshSystems(mode) {
  return (SYSTEMS_BY_MODE[mode] || RESIDENTIAL_SYSTEMS).map((def) => ({
    id: def.id, label: def.label, pattern: def.pattern, pricing: def.pricing,
    condition: null, count: null,
    selectedAmount: def.pricing?.kind === 'amounts' ? (def.pricing.amounts?.[0] ?? 0) : null
  }));
}
