// src/math/rehab/rehabSystems.js
//
// REHAB pricing — READ LIVE FROM THE BIBLE (rewired 2026-07-22).
//
// Steve's rule: nothing hardcoded, everything reads the Bible live. This file used
// to be a SNAPSHOT COPY of Steve's locked v2.0 numbers (a const table). It now
// reads every money value from the hydrated live Bible (REHAB.*) via the same
// lazy-singleton pattern as src/config/BIBLE_CONSTANTS.js, and FAILS CLOSED if the
// Bible was never read — no bundled copy, no fallback.
//
//   - Condition tier multipliers      → REHAB.tiers
//   - Residential system base costs / flat-tier prices / dropdown amounts
//                                      → REHAB.systems.*
//   - National all-in $/SF benchmark  → REHAB.nationalPsf × REHAB.nationalPsfRegionalAdj
//
// WHAT STAYS LOCAL (and why — these are NOT underwriting money the Bible owns):
//   - Geometry/area models (siding perimeter 4.5 / wall 9 / gable 1.10, roof pitch
//     1.12, window default count) — construction geometry, not cost tables.
//   - Tier labels / key ordering / sizing-field UI metadata — display structure.
//   - STORAGE and COMMERCIAL system base costs — ORPHANS: the Bible's REHAB section
//     models RESIDENTIAL only. These stay local (logged) until Steve homes a
//     STORAGE.rehab / COMMERCIAL.rehab section. Their tier MULTIPLIERS still come
//     live from REHAB.tiers.

import { getBibleStandards } from '../constants.js'

// The live REHAB block, or throw (fail closed). getBibleStandards() itself throws
// if the Bible was never hydrated, so a missing Bible can never silently become a
// hardcoded rehab number.
function rehabStd() {
  const std = getBibleStandards()
  const R = std && std.REHAB
  if (!R || !R.tiers || !R.systems || !R.nationalPsf || !Number.isFinite(R.nationalPsfRegionalAdj)
      || !R.storage || !R.commercial || !R.geometry) {
    throw new Error('rehabSystems: live Bible REHAB (tiers / systems / nationalPsf / regionalAdj / storage / commercial / geometry) required — refusing to price rehab. No hardcoded fallback.')
  }
  return R
}

// Lazy object proxy — reads the live Bible on every property access, so importing
// this module never triggers a Bible read (the browser imports it before main.jsx
// hydrates). Behaves like a plain object for `x[key]`, spread, Object.keys, etc.
function lazy(pick) {
  return new Proxy({}, {
    get: (_t, prop) => pick(rehabStd())[prop],
    has: (_t, prop) => prop in pick(rehabStd()),
    ownKeys: () => Reflect.ownKeys(pick(rehabStd())),
    getOwnPropertyDescriptor: (_t, prop) => {
      const d = Object.getOwnPropertyDescriptor(pick(rehabStd()), prop)
      return d ? { ...d, configurable: true } : undefined
    }
  })
}

// ── Bible-derived money values (live) ────────────────────────────────────────
export const TIER_RATES = lazy(R => R.tiers)          // {new:0, modern:0.25, ... studdedOut:3}
export const NATIONAL_PSF = lazy(R => R.nationalPsf)  // {move_in, light_rehab, ... studs}

// Regional adjustment is a scalar (can't be proxied) — read it live via a call.
export function regionalAdj() { return rehabStd().nationalPsfRegionalAdj }

// ── Local display / structural metadata (no Bible home) ──────────────────────
export const TIER_LABELS = {
  new: 'New', modern: 'Modern', semiModern: 'Semi Modern', old: 'Old',
  missing: 'Missing', drywallNeeded: 'Drywall needed', studdedOut: 'Studded out'
}
export const STANDARD_TIER_KEYS = ['new', 'modern', 'semiModern', 'old', 'missing']
export const COSMETIC_TIER_KEYS = ['new', 'modern', 'semiModern', 'old', 'missing', 'drywallNeeded', 'studdedOut']

// ── RESIDENTIAL systems — BUILT FROM THE LIVE BIBLE ──────────────────────────
// baseCost / flat tier prices / dropdown amounts read from REHAB.systems.*, and
// the geometry factors (perimeter/wall/gable/pitch/window count) from
// REHAB.geometry. NOTHING hardcoded.
function buildResidentialSystems() {
  const R = rehabStd()
  const S = R.systems
  const G = R.geometry
  const base = (id) => S[id].baseCost               // per-area $/unit base
  const tiers = (id) => S[id].tiers                 // flat $ per condition
  const amounts = (id) => S[id].amounts             // dropdown ladder
  return [
    { id: 'cosmetic', label: 'Cosmetic condition', pattern: 'A', pricing: { kind: 'rate_x_sizing', baseCost: base('cosmetic'), sizingTerm: 'totalSqFt', sizingUnit: 'sqft', tierKeys: COSMETIC_TIER_KEYS } },
    { id: 'windows', label: 'Windows', pattern: 'A', pricing: { kind: 'rate_x_count', baseCost: base('windows'), defaultCount: G.defaultWindowCount, countLabel: '# Windows', countUnit: 'windows' } },
    { id: 'siding', label: 'Siding', pattern: 'A', pricing: { kind: 'siding_formula', baseCost: base('siding'), perimeterFactor: G.sidingPerimeterFactor, wallHeight: G.sidingWallHeight, gableFactor: G.sidingGableFactor } },
    { id: 'roof', label: 'Roof', pattern: 'A', pricing: { kind: 'roof_formula', baseCost: base('roof'), pitchMultiplier: G.roofPitchMultiplier } },
    { id: 'kitchen', label: 'Kitchen', pattern: 'A', pricing: { kind: 'static_per_unit', tiers: tiers('kitchen'), unitWord: 'kitchen' } },
    { id: 'fullBath', label: 'Full bath', pattern: 'B', pricing: { kind: 'static_per_count', tiers: tiers('fullBath'), defaultCount: 'units', countLabel: 'How many' } },
    { id: 'halfBath', label: '1/2 bath', pattern: 'B', pricing: { kind: 'static_per_count', tiers: tiers('halfBath'), defaultCount: 0, countLabel: 'How many' } },
    { id: 'threeQtrBath', label: '3/4 bath', pattern: 'B', pricing: { kind: 'static_per_count', tiers: tiers('threeQtrBath'), defaultCount: 0, countLabel: 'How many' } },
    { id: 'appliances', label: 'Appliances', pattern: 'A', pricing: { kind: 'static_per_unit', tiers: tiers('appliances'), unitWord: 'set' } },
    { id: 'exterior', label: 'Exterior', pattern: 'C', pricing: { kind: 'amounts', amounts: amounts('exterior') } },
    { id: 'porch', label: 'Porch', pattern: 'C', pricing: { kind: 'amounts', amounts: amounts('porch') } },
    { id: 'basement', label: 'Basement', pattern: 'C', pricing: { kind: 'amounts', amounts: amounts('basement') } },
    { id: 'structure', label: 'Structure', pattern: 'C', pricing: { kind: 'amounts', amounts: amounts('structure') } },
    { id: 'furnace', label: 'Furnace', pattern: 'C', pricing: { kind: 'amounts', amounts: amounts('furnace') } },
    { id: 'plumbing', label: 'Plumbing', pattern: 'C', pricing: { kind: 'amounts', amounts: amounts('plumbing') } },
    { id: 'electrical', label: 'Electrical', pattern: 'C', pricing: { kind: 'amounts', amounts: amounts('electrical') } },
    { id: 'holding', label: 'Holding costs', pattern: 'D', pricing: { kind: 'amounts', amounts: amounts('holding') } }
  ]
}

// ── STORAGE systems — BUILT FROM THE LIVE BIBLE (REHAB.storage.systems) ───────
function buildStorageSystems() {
  const R = rehabStd()
  const S = R.storage.systems
  const G = R.geometry
  const holdingAmounts = R.systems.holding.amounts // shared holding ladder
  return [
    { id: 'roof', label: 'Roof / membrane', pattern: 'A', pricing: { kind: 'rate_x_sizing', baseCost: S.roof.baseCost, sizingTerm: 'roofSqFt', sizingUnit: 'sqft' } },
    { id: 'rollupDoors', label: 'Roll-up doors', pattern: 'A', pricing: { kind: 'rate_x_count', baseCost: S.rollupDoors.baseCost, defaultCount: 'totalUnits', countLabel: '# Doors', countUnit: 'doors' } },
    { id: 'doorHardware', label: 'Door hardware', pattern: 'A', pricing: { kind: 'rate_x_count', baseCost: S.doorHardware.baseCost, defaultCount: 'totalUnits', countLabel: '# Doors', countUnit: 'doors' } },
    { id: 'pavement', label: 'Pavement / drive aisles', pattern: 'A', pricing: { kind: 'rate_x_sizing', baseCost: S.pavement.baseCost, sizingTerm: 'driveAisleSqFt', sizingUnit: 'sqft' } },
    { id: 'fencing', label: 'Perimeter fencing', pattern: 'A', pricing: { kind: 'rate_x_sizing', baseCost: S.fencing.baseCost, sizingTerm: 'perimeterLf', sizingUnit: 'lf' } },
    { id: 'gate', label: 'Gate / motor', pattern: 'C', pricing: { kind: 'amounts', amounts: S.gate.amounts } },
    { id: 'accessControl', label: 'Access control system', pattern: 'C', pricing: { kind: 'amounts', amounts: S.accessControl.amounts } },
    { id: 'cameras', label: 'Cameras / security', pattern: 'A', pricing: { kind: 'rate_x_count', baseCost: S.cameras.baseCost, defaultCount: G.storageCameraDefaultCount, countLabel: '# Cameras', countUnit: 'cameras' } },
    { id: 'poleLights', label: 'Pole / area lighting', pattern: 'A', pricing: { kind: 'rate_x_count', baseCost: S.poleLights.baseCost, defaultCount: G.storagePoleLightDefaultCount, countLabel: '# Poles', countUnit: 'poles' } },
    { id: 'office', label: 'Office buildout', pattern: 'C', pricing: { kind: 'amounts', amounts: S.office.amounts } },
    { id: 'climateHallway', label: 'Climate hallway interior', pattern: 'A', pricing: { kind: 'rate_x_sizing', baseCost: S.climateHallway.baseCost, sizingTerm: 'climateHallwaySqFt', sizingUnit: 'sqft' } },
    { id: 'hvac', label: 'HVAC / climate control', pattern: 'A', pricing: { kind: 'hvac_storage_formula', baseCost: S.hvac.baseCost, avgUnitSize: G.storageHvacAvgUnitSize, hideWhen: { sizingTerm: 'climateUnits', equals: 0 } } },
    { id: 'signage', label: 'Signage', pattern: 'C', pricing: { kind: 'amounts', amounts: S.signage.amounts } },
    { id: 'siteWork', label: 'Site work / drainage', pattern: 'C', pricing: { kind: 'amounts', amounts: S.siteWork.amounts } },
    { id: 'unitInterior', label: 'Unit interior repairs', pattern: 'A', pricing: { kind: 'rate_x_count', baseCost: S.unitInterior.baseCost, defaultCount: 'totalUnits', countLabel: '# Units', countUnit: 'units' } },
    { id: 'exteriorPaint', label: 'Exterior paint / cladding', pattern: 'A', pricing: { kind: 'rate_x_sizing', baseCost: S.exteriorPaint.baseCost, sizingTerm: 'exteriorSqFt', sizingUnit: 'sqft' } },
    { id: 'holding', label: 'Holding costs', pattern: 'D', pricing: { kind: 'amounts', amounts: holdingAmounts } }
  ]
}

// ── COMMERCIAL systems — BUILT FROM THE LIVE BIBLE (REHAB.commercial.systems) ─
function buildCommercialSystems() {
  const R = rehabStd()
  const S = R.commercial.systems
  const holdingAmounts = R.systems.holding.amounts
  return [
    { id: 'interior', label: 'Interior buildout / TI', pattern: 'A', pricing: { kind: 'rate_x_sizing', baseCost: S.interior.baseCost, sizingTerm: 'buildingSqFt', sizingUnit: 'sqft', tierKeys: COSMETIC_TIER_KEYS } },
    { id: 'roof', label: 'Roof', pattern: 'A', pricing: { kind: 'rate_x_sizing', baseCost: S.roof.baseCost, sizingTerm: 'roofSqFt', sizingUnit: 'sqft' } },
    { id: 'hvac', label: 'HVAC', pattern: 'A', pricing: { kind: 'rate_x_sizing', baseCost: S.hvac.baseCost, sizingTerm: 'buildingSqFt', sizingUnit: 'sqft' } },
    { id: 'electrical', label: 'Electrical', pattern: 'A', pricing: { kind: 'rate_x_sizing', baseCost: S.electrical.baseCost, sizingTerm: 'buildingSqFt', sizingUnit: 'sqft' } },
    { id: 'facade', label: 'Facade / exterior', pattern: 'A', pricing: { kind: 'rate_x_sizing', baseCost: S.facade.baseCost, sizingTerm: 'buildingSqFt', sizingUnit: 'sqft' } },
    { id: 'parking', label: 'Parking lot', pattern: 'C', pricing: { kind: 'amounts', amounts: S.parking.amounts } },
    { id: 'plumbing', label: 'Plumbing', pattern: 'C', pricing: { kind: 'amounts', amounts: S.plumbing.amounts } },
    { id: 'storefront', label: 'Storefront / glazing', pattern: 'C', pricing: { kind: 'amounts', amounts: S.storefront.amounts } },
    { id: 'signage', label: 'Signage', pattern: 'C', pricing: { kind: 'amounts', amounts: S.signage.amounts } },
    { id: 'siteWork', label: 'Site work / drainage', pattern: 'C', pricing: { kind: 'amounts', amounts: S.siteWork.amounts } },
    { id: 'holding', label: 'Holding costs', pattern: 'D', pricing: { kind: 'amounts', amounts: holdingAmounts } }
  ]
}

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
}

// Build the system defs for a mode from the live Bible (residential) or the local
// orphan sets (storage/commercial). Returns a REAL array each call.
function buildSystems(mode) {
  if (mode === 'storage') return buildStorageSystems()
  if (mode === 'commercial') return buildCommercialSystems()
  return buildResidentialSystems()
}

// SYSTEMS_BY_MODE[mode] → freshly built (live) array. Proxy so index access reads
// the Bible on demand without an import-time read.
export const SYSTEMS_BY_MODE = new Proxy({}, {
  get: (_t, mode) => buildSystems(typeof mode === 'string' ? mode : 'residential')
})

export const OVERALL_TIERS = [
  { id: 'move_in', label: 'Move-in ready' },
  { id: 'light_rehab', label: 'Light (cosmetic)' },
  { id: 'medium_rehab', label: 'Medium (kitchen/bath + cosmetics)' },
  { id: 'heavy_rehab', label: 'Heavy (multiple systems)' },
  { id: 'studs', label: 'Down to studs / gut' }
]

// Map a per-system condition tier (or pic-rehab overall tier) to a benchmark tier.
export function toBenchmarkTier(condition) {
  switch (condition) {
    case 'new': return 'move_in'
    case 'modern': return 'light_rehab'
    case 'semiModern': return 'medium_rehab'
    case 'old': return 'heavy_rehab'
    case 'missing': case 'drywallNeeded': case 'studdedOut': return 'studs'
    case 'move_in': case 'light_rehab': case 'medium_rehab': case 'heavy_rehab': case 'studs': return condition
    default: return 'medium_rehab'
  }
}

// Which Bible source produced each mode's numbers — surfaced in the UI so the
// source is never ambiguous.
export const RATE_SOURCE = {
  residential: 'Live Bible — REHAB.systems (line item) + REHAB.nationalPsf (national $/SF)',
  storage: 'Live Bible — REHAB.storage.systems + REHAB.tiers multipliers',
  commercial: 'Live Bible — REHAB.commercial.systems + REHAB.tiers multipliers'
}

export function freshSystems(mode) {
  return buildSystems(mode).map((def) => ({
    id: def.id, label: def.label, pattern: def.pattern, pricing: def.pricing,
    condition: null, count: null,
    selectedAmount: def.pricing?.kind === 'amounts' ? (def.pricing.amounts?.[0] ?? 0) : null
  }))
}
