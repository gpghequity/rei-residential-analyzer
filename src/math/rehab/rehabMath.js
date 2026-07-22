// src/math/rehab/rehabMath.js
//
// PORTED FROM rei-rehab-calc/src/math/residential.js + index.js on 2026-06-02.
// Pattern + pricing.kind dispatch → per-row dollar totals, grand total, holding.
// Verbatim math; only the import of tier rates is rewired to ./rehabSystems.js.
// UI imports this; this never imports UI.

import { TIER_RATES, STANDARD_TIER_KEYS, NATIONAL_PSF, regionalAdj, toBenchmarkTier } from './rehabSystems.js'

// Rehabbable area used for the national $/sf benchmark, per mode.
export function rehabArea(mode, sizing) {
  if (mode === 'storage') return resolveSizingTerm('exteriorSqFt', sizing) || resolveSizingTerm('roofSqFt', sizing)
  if (mode === 'commercial') return resolveSizingTerm('buildingSqFt', sizing)
  return totalSqFt(sizing)
}

// National-average total = area × national median $/sf for the overall condition
// tier, regionally adjusted (mid-Atlantic). A real benchmark beside Steve's
// line-item engine total — NOT a per-line number.
export function nationalTotal(mode, sizing, conditionOrTier) {
  const area = rehabArea(mode, sizing)
  const tier = toBenchmarkTier(conditionOrTier)
  const psf = (NATIONAL_PSF[tier] ?? 0) * regionalAdj()
  return { tier, psf: Math.round(psf), area: Math.round(area), total: Math.round(area * psf) }
};

function rateForCondition(condition) {
  if (!condition) return 0;
  return TIER_RATES[condition] ?? 0;
}

export function computeRowTotal(system, sizing) {
  const p = system?.pricing;
  if (!p) return 0;
  switch (p.kind) {
    case 'rate_x_sizing':
      return numOr(p.baseCost, 0) * resolveSizingTerm(p.sizingTerm, sizing) * rateForCondition(system.condition);
    case 'rate_x_count': {
      const count = resolveCountWithDefault(system.count, p.defaultCount, sizing);
      return numOr(p.baseCost, 0) * count * rateForCondition(system.condition);
    }
    case 'roof_formula': {
      const roofSqFt = footprintSqFt(sizing) * numOr(p.pitchMultiplier, 1);
      return roofSqFt * numOr(p.baseCost, 0) * rateForCondition(system.condition);
    }
    case 'siding_formula':
      return sidingSqFt(p, sizing) * numOr(p.baseCost, 0) * rateForCondition(system.condition);
    case 'hvac_storage_formula':
      return numOr(sizing?.climateUnits, 0) * numOr(p.avgUnitSize, 0) * numOr(p.baseCost, 0) * rateForCondition(system.condition);
    case 'static_per_unit':
      return tierLookup(p.tiers, system.condition) * numOr(sizing?.units, 1);
    case 'static_per_count':
      return tierLookup(p.tiers, system.condition) * resolveCountWithDefault(system.count, p.defaultCount, sizing);
    case 'amounts':
      return numOr(system.selectedAmount, 0);
    default:
      return 0;
  }
}

export function explainRow(system, sizing) {
  const total = computeRowTotal(system, sizing);
  const p = system.pricing; const cond = system.condition;
  let label = '';
  if (cond && p) {
    if (p.kind === 'rate_x_sizing') label = `${fmtN(resolveSizingTerm(p.sizingTerm, sizing))} ${p.sizingUnit || ''} × $${p.baseCost} × ${pct(rateForCondition(cond))}`;
    else if (p.kind === 'rate_x_count') label = `${resolveCountWithDefault(system.count, p.defaultCount, sizing)} ${p.countUnit || ''} × $${p.baseCost} × ${pct(rateForCondition(cond))}`;
    else if (p.kind === 'roof_formula') label = `${fmtN(footprintSqFt(sizing) * numOr(p.pitchMultiplier, 1))} sqft roof × $${p.baseCost} × ${pct(rateForCondition(cond))}`;
    else if (p.kind === 'siding_formula') label = `${fmtN(sidingSqFt(p, sizing))} sqft siding × $${p.baseCost} × ${pct(rateForCondition(cond))}`;
    else if (p.kind === 'hvac_storage_formula') label = `${numOr(sizing?.climateUnits, 0)} climate units × $${numOr(p.avgUnitSize, 0) * numOr(p.baseCost, 0)} × ${pct(rateForCondition(cond))}`;
    else if (p.kind === 'static_per_unit') label = `$${tierLookup(p.tiers, cond)} × ${numOr(sizing?.units, 1)} ${p.unitWord || 'unit'}`;
    else if (p.kind === 'static_per_count') label = `${resolveCountWithDefault(system.count, p.defaultCount, sizing)} × $${tierLookup(p.tiers, cond)}`;
  }
  return { total, label };
}

// Per-condition dollar amounts for dropdown option labels.
export function pricesByCondition(system, sizing) {
  const keys = system?.pricing?.tierKeys || STANDARD_TIER_KEYS;
  const out = {};
  for (const k of keys) out[k] = computeRowTotal({ ...system, condition: k }, sizing);
  return out;
}
export function pricesByConditionPerCount(system) {
  const tiers = system?.pricing?.tiers || {};
  const out = {};
  for (const k of STANDARD_TIER_KEYS) out[k] = numOr(tiers[k], 0);
  return out;
}

// Sum all rows → totalRehab (excludes holding) + holdingCost + grandTotal.
export function calcRehab(systems, sizing) {
  const visible = (systems || []).filter((s) => !isRowHidden(s, sizing));
  const lineItems = visible.map((s) => ({ id: s.id, label: s.label, pattern: s.pattern, total: computeRowTotal(s, sizing) }));
  const totalRehab = lineItems.filter((li) => li.id !== 'holding').reduce((a, l) => a + l.total, 0);
  const holdingCost = lineItems.filter((li) => li.id === 'holding').reduce((a, l) => a + l.total, 0);
  return { lineItems, totalRehab, holdingCost, grandTotal: totalRehab + holdingCost };
}

export function isRowHidden(system, sizing) {
  const hide = system?.pricing?.hideWhen;
  if (!hide) return false;
  return resolveSizingTerm(hide.sizingTerm, sizing) === hide.equals;
}

// ── sizing helpers (ported) ──────────────────────────────────────────────────
export function totalSqFt(s) { s = s || {}; return numOr(s.sqFtPerUnit, 0) * numOr(s.units, 0) + numOr(s.commonSqFt, 0); }
export function footprintSqFt(s) { const st = numOr(s?.stories, 1) || 1; return totalSqFt(s) / st; }
export function sidingSqFt(p, s) {
  const fp = footprintSqFt(s); if (fp <= 0) return 0;
  const st = numOr(s?.stories, 1) || 1;
  return (Math.sqrt(fp) * numOr(p?.perimeterFactor, 4.5)) * (st * numOr(p?.wallHeight, 9)) * numOr(p?.gableFactor, 1.10);
}
export function resolveSizingTerm(term, sizing) {
  const s = sizing || {};
  switch (term) {
    case 'totalSqFt': return totalSqFt(s);
    case 'footprintSqFt': return footprintSqFt(s);
    case 'sqFtPerUnit': return numOr(s.sqFtPerUnit, 0);
    case 'units': return numOr(s.units, 0);
    case 'stories': return numOr(s.stories, 1);
    case 'totalUnits': return numOr(s.totalUnits, 0);
    case 'climateUnits': return numOr(s.climateUnits, 0);
    case 'roofSqFt': return numOr(s.roofSqFt, 0);
    case 'driveAisleSqFt': return numOr(s.driveAisleSqFt, 0);
    case 'perimeterLf': return numOr(s.perimeterLf, 0);
    case 'climateHallwaySqFt': return numOr(s.climateHallwaySqFt, 0);
    case 'exteriorSqFt': return numOr(s.exteriorSqFt, 0);
    case 'buildingSqFt': return numOr(s.buildingSqFt, 0);
    default: return 0;
  }
}
export function resolveDefaultCount(spec, sizing) {
  if (typeof spec === 'number') return spec;
  if (typeof spec === 'string') return resolveSizingTerm(spec, sizing);
  return 0;
}
function resolveCountWithDefault(stored, defaultSpec, sizing) {
  if (stored != null && Number.isFinite(Number(stored))) return Number(stored);
  return resolveDefaultCount(defaultSpec, sizing);
}
function tierLookup(tiers, condition) {
  if (!tiers || !condition) return 0;
  const v = tiers[condition];
  return Number.isFinite(v) ? v : 0;
}
function numOr(v, fallback) {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string' && v.trim() !== '') { const n = Number(v); if (Number.isFinite(n)) return n; }
  return fallback;
}
function fmtN(n) { return Number.isFinite(n) ? Math.round(n).toLocaleString('en-US') : '—'; }
function pct(r) { return `${Math.round((Number(r) || 0) * 100)}%`; }
