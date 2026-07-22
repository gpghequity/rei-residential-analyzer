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
  if (!R || !R.tiers || !R.systems || !R.nationalPsf || !Number.isFinite(R.nationalPsfRegionalAdj)) {
    throw new Error('rehabSystems: live Bible REHAB (tiers / systems / nationalPsf / regionalAdj) required — refusing to price rehab. No hardcoded fallback.')
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

// Storage/commercial dropdown ladders — ORPHANS (no Bible home). Residential
// dropdown amounts are NOT here anymore; they come live from REHAB.systems.
const ORPHAN_AMOUNTS = {
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
}

// ── RESIDENTIAL systems — BUILT FROM THE LIVE BIBLE ──────────────────────────
// baseCost / flat tier prices / dropdown amounts all read from REHAB.systems.*.
// Geometry factors (perimeter/wall/gable/pitch) and the window default count are
// construction models, not costs — they stay local.
function buildResidentialSystems() {
  const R = rehabStd()
  const S = R.systems
  const base = (id) => S[id].baseCost               // per-area $/unit base
  const tiers = (id) => S[id].tiers                 // flat $ per condition
  const amounts = (id) => S[id].amounts             // dropdown ladder
  return [
    { id: 'cosmetic', label: 'Cosmetic condition', pattern: 'A', pricing: { kind: 'rate_x_sizing', baseCost: base('cosmetic'), sizingTerm: 'totalSqFt', sizingUnit: 'sqft', tierKeys: COSMETIC_TIER_KEYS } },
    { id: 'windows', label: 'Windows', pattern: 'A', pricing: { kind: 'rate_x_count', baseCost: base('windows'), defaultCount: 20, countLabel: '# Windows', countUnit: 'windows' } },
    { id: 'siding', label: 'Siding', pattern: 'A', pricing: { kind: 'siding_formula', baseCost: base('siding'), perimeterFactor: 4.5, wallHeight: 9, gableFactor: 1.10 } },
    { id: 'roof', label: 'Roof', pattern: 'A', pricing: { kind: 'roof_formula', baseCost: base('roof'), pitchMultiplier: 1.12 } },
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

// ── STORAGE systems — base costs are ORPHANS (local); tier rates come live ────
function buildStorageSystems() {
  const holdingAmounts = rehabStd().systems.holding.amounts // shared holding ladder from the Bible
  return [
    { id: 'roof', label: 'Roof / membrane', pattern: 'A', pricing: { kind: 'rate_x_sizing', baseCost: 6, sizingTerm: 'roofSqFt', sizingUnit: 'sqft' } },
    { id: 'rollupDoors', label: 'Roll-up doors', pattern: 'A', pricing: { kind: 'rate_x_count', baseCost: 355, defaultCount: 'totalUnits', countLabel: '# Doors', countUnit: 'doors' } },
    { id: 'doorHardware', label: 'Door hardware', pattern: 'A', pricing: { kind: 'rate_x_count', baseCost: 50, defaultCount: 'totalUnits', countLabel: '# Doors', countUnit: 'doors' } },
    { id: 'pavement', label: 'Pavement / drive aisles', pattern: 'A', pricing: { kind: 'rate_x_sizing', baseCost: 5, sizingTerm: 'driveAisleSqFt', sizingUnit: 'sqft' } },
    { id: 'fencing', label: 'Perimeter fencing', pattern: 'A', pricing: { kind: 'rate_x_sizing', baseCost: 22, sizingTerm: 'perimeterLf', sizingUnit: 'lf' } },
    { id: 'gate', label: 'Gate / motor', pattern: 'C', pricing: { kind: 'amounts', amounts: ORPHAN_AMOUNTS.storageGate } },
    { id: 'accessControl', label: 'Access control system', pattern: 'C', pricing: { kind: 'amounts', amounts: ORPHAN_AMOUNTS.storageAccess } },
    { id: 'cameras', label: 'Cameras / security', pattern: 'A', pricing: { kind: 'rate_x_count', baseCost: 500, defaultCount: 8, countLabel: '# Cameras', countUnit: 'cameras' } },
    { id: 'poleLights', label: 'Pole / area lighting', pattern: 'A', pricing: { kind: 'rate_x_count', baseCost: 2000, defaultCount: 4, countLabel: '# Poles', countUnit: 'poles' } },
    { id: 'office', label: 'Office buildout', pattern: 'C', pricing: { kind: 'amounts', amounts: ORPHAN_AMOUNTS.storageOffice } },
    { id: 'climateHallway', label: 'Climate hallway interior', pattern: 'A', pricing: { kind: 'rate_x_sizing', baseCost: 25, sizingTerm: 'climateHallwaySqFt', sizingUnit: 'sqft' } },
    { id: 'hvac', label: 'HVAC / climate control', pattern: 'A', pricing: { kind: 'hvac_storage_formula', baseCost: 10, avgUnitSize: 100, hideWhen: { sizingTerm: 'climateUnits', equals: 0 } } },
    { id: 'signage', label: 'Signage', pattern: 'C', pricing: { kind: 'amounts', amounts: ORPHAN_AMOUNTS.storageSignage } },
    { id: 'siteWork', label: 'Site work / drainage', pattern: 'C', pricing: { kind: 'amounts', amounts: ORPHAN_AMOUNTS.storageSiteWork } },
    { id: 'unitInterior', label: 'Unit interior repairs', pattern: 'A', pricing: { kind: 'rate_x_count', baseCost: 200, defaultCount: 'totalUnits', countLabel: '# Units', countUnit: 'units' } },
    { id: 'exteriorPaint', label: 'Exterior paint / cladding', pattern: 'A', pricing: { kind: 'rate_x_sizing', baseCost: 3, sizingTerm: 'exteriorSqFt', sizingUnit: 'sqft' } },
    { id: 'holding', label: 'Holding costs', pattern: 'D', pricing: { kind: 'amounts', amounts: holdingAmounts } }
  ]
}

// ── COMMERCIAL systems — base costs are ORPHANS (2026 national averages) ──────
function buildCommercialSystems() {
  const holdingAmounts = rehabStd().systems.holding.amounts
  return [
    { id: 'interior', label: 'Interior buildout / TI', pattern: 'A', pricing: { kind: 'rate_x_sizing', baseCost: 60, sizingTerm: 'buildingSqFt', sizingUnit: 'sqft', tierKeys: COSMETIC_TIER_KEYS } },
    { id: 'roof', label: 'Roof', pattern: 'A', pricing: { kind: 'rate_x_sizing', baseCost: 12, sizingTerm: 'roofSqFt', sizingUnit: 'sqft' } },
    { id: 'hvac', label: 'HVAC', pattern: 'A', pricing: { kind: 'rate_x_sizing', baseCost: 18, sizingTerm: 'buildingSqFt', sizingUnit: 'sqft' } },
    { id: 'electrical', label: 'Electrical', pattern: 'A', pricing: { kind: 'rate_x_sizing', baseCost: 8, sizingTerm: 'buildingSqFt', sizingUnit: 'sqft' } },
    { id: 'facade', label: 'Facade / exterior', pattern: 'A', pricing: { kind: 'rate_x_sizing', baseCost: 15, sizingTerm: 'buildingSqFt', sizingUnit: 'sqft' } },
    { id: 'parking', label: 'Parking lot', pattern: 'C', pricing: { kind: 'amounts', amounts: ORPHAN_AMOUNTS.commParking } },
    { id: 'plumbing', label: 'Plumbing', pattern: 'C', pricing: { kind: 'amounts', amounts: ORPHAN_AMOUNTS.commPlumbing } },
    { id: 'storefront', label: 'Storefront / glazing', pattern: 'C', pricing: { kind: 'amounts', amounts: ORPHAN_AMOUNTS.commStorefront } },
    { id: 'signage', label: 'Signage', pattern: 'C', pricing: { kind: 'amounts', amounts: ORPHAN_AMOUNTS.commSignage } },
    { id: 'siteWork', label: 'Site work / drainage', pattern: 'C', pricing: { kind: 'amounts', amounts: ORPHAN_AMOUNTS.commSiteWork } },
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
  storage: 'Live Bible tier multipliers; storage base costs are local orphans (no Bible home yet)',
  commercial: 'Local commercial averages (no Bible commercial rehab section yet); tier multipliers live'
}

export function freshSystems(mode) {
  return buildSystems(mode).map((def) => ({
    id: def.id, label: def.label, pattern: def.pattern, pricing: def.pricing,
    condition: null, count: null,
    selectedAmount: def.pricing?.kind === 'amounts' ? (def.pricing.amounts?.[0] ?? 0) : null
  }))
}
