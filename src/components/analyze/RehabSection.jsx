import { useState, useEffect, useMemo } from 'react'
import { freshSystems, SIZING_FIELDS, RATE_SOURCE, TIER_LABELS, STANDARD_TIER_KEYS, OVERALL_TIERS } from '../../math/rehab/rehabSystems.js'
import { calcRehab, explainRow, pricesByCondition, pricesByConditionPerCount, resolveDefaultCount, isRowHidden, nationalTotal } from '../../math/rehab/rehabMath.js'

// Manual condition → rehab estimate, ported from Rehab Calc and embedded in the
// Analyze-a-Deal flow. Line-item breakout + total. Reports its total up via
// onTotalChange so the deal's flip MAO uses the condition-derived rehab number.
// Inline-styled to match AnalyzeDealTab (Baby uses inline styles, not Tailwind).

const money = (n) => (n == null || !Number.isFinite(Number(n))) ? '$0' : '$' + Math.round(Number(n)).toLocaleString()
const lbl = { display: 'block', fontSize: 12, fontWeight: 600, color: '#1E2A45', margin: '8px 0 3px' }
const inp = { width: '100%', padding: '7px 9px', border: '1px solid #d4dae8', borderRadius: 6, fontSize: 13, boxSizing: 'border-box' }
const COUNT_OPTS = [0, 1, 2, 3, 4, 5, 6, 8, 10]
const COUNT_OPTS_BY_ID = { windows: [0, 5, 10, 15, 20, 30, 40, 50], rollupDoors: [0, 50, 100, 200, 300, 500], doorHardware: [0, 50, 100, 200, 300, 500], cameras: [0, 4, 8, 12, 16, 24, 32], poleLights: [0, 2, 4, 6, 8, 12, 20], unitInterior: [0, 50, 100, 200, 300, 500] }

export default function RehabSection({ mode = 'residential', seed = {}, onTotalChange }) {
  const sizingFields = SIZING_FIELDS[mode] || SIZING_FIELDS.residential
  const [sizing, setSizing] = useState(() => {
    const s = {}
    sizingFields.forEach(f => { s[f.key] = seed[f.key] ?? '' })
    return s
  })
  const [systems, setSystems] = useState(() => freshSystems(mode))
  const [overallTier, setOverallTier] = useState('medium_rehab')

  // Recompute on every change; surface BOTH totals (Steve's line-item engine and
  // the national $/sf benchmark) to the parent.
  const result = useMemo(() => calcRehab(systems, sizing), [systems, sizing])
  const nat = useMemo(() => nationalTotal(mode, sizing, overallTier), [mode, sizing, overallTier])
  useEffect(() => {
    onTotalChange?.(result.totalRehab, { ...result, national: nat })
  }, [result.totalRehab, nat.total]) // eslint-disable-line react-hooks/exhaustive-deps

  const setSizeField = (k, v) => setSizing(p => ({ ...p, [k]: v }))
  const patchSystem = (id, patch) => setSystems(p => p.map(s => s.id === id ? { ...s, ...patch } : s))

  const visible = systems.filter(s => !isRowHidden(s, sizing))

  return (
    <div>
      <p style={{ fontSize: 12, color: '#6b7280', margin: '0 0 8px' }}>
        Rates: <b>{RATE_SOURCE[mode]}</b>. Pick a condition (or budget) per system — the total feeds the offer math below.
      </p>

      {/* Sizing inputs that scale the formulas */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(130px,1fr))', gap: 8, padding: '10px', background: '#f1f3f7', borderRadius: 8, marginBottom: 10 }}>
        {sizingFields.map(f => (
          <div key={f.key}>
            <label style={lbl}>{f.label}</label>
            <input style={inp} inputMode="decimal" value={sizing[f.key] ?? ''} placeholder={f.placeholder}
              onChange={e => setSizeField(f.key, e.target.value)} />
          </div>
        ))}
      </div>

      {/* One row per system */}
      <div style={{ display: 'grid', gap: 6 }}>
        {visible.map(s => <Row key={s.id} system={s} sizing={sizing} onChange={patch => patchSystem(s.id, patch)} />)}
      </div>

      {/* Overall condition → drives the national-average benchmark column */}
      <div style={{ marginTop: 12, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, alignItems: 'end' }}>
        <div>
          <label style={lbl}>Overall condition (for national-average benchmark)</label>
          <select style={inp} value={overallTier} onChange={e => setOverallTier(e.target.value)}>
            {OVERALL_TIERS.map(t => <option key={t.id} value={t.id}>{t.label}</option>)}
          </select>
        </div>
        <div style={{ fontSize: 11, color: '#6b7280' }}>National benchmark = {money(nat.psf)}/sf × {nat.area.toLocaleString()} sf (mid-Atlantic, source: data-enrichment)</div>
      </div>

      {/* Two totals: Steve's line-item engine vs national $/sf benchmark */}
      <div style={{ marginTop: 10, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
        <div style={{ padding: '10px 14px', background: '#0A0F2C', color: '#fff', borderRadius: 8 }}>
          <div style={{ fontWeight: 700, color: '#C9A84C', fontSize: 12 }}>Total — your numbers</div>
          <div style={{ fontWeight: 800, fontSize: 18 }}>{money(result.totalRehab)}</div>
          <div style={{ fontSize: 10, color: '#cdd6ec' }}>{RATE_SOURCE[mode]}</div>
        </div>
        <div style={{ padding: '10px 14px', background: '#1E2A45', color: '#fff', borderRadius: 8 }}>
          <div style={{ fontWeight: 700, color: '#C9A84C', fontSize: 12 }}>Total — national average</div>
          <div style={{ fontWeight: 800, fontSize: 18 }}>{money(nat.total)}</div>
          <div style={{ fontSize: 10, color: '#cdd6ec' }}>{nat.area.toLocaleString()} sf × {money(nat.psf)}/sf</div>
        </div>
      </div>
      {result.holdingCost > 0 && (
        <div style={{ fontSize: 12, color: '#6b7280', marginTop: 4 }}>+ Holding {money(result.holdingCost)} (carried separately, not in rehab total)</div>
      )}
    </div>
  )
}

function Row({ system, sizing, onChange }) {
  const { total, label } = explainRow(system, sizing)
  const p = system.pricing
  const isAmount = p?.kind === 'amounts'
  const isCount = p?.kind === 'rate_x_count'
  const isPerCount = p?.kind === 'static_per_count'

  return (
    <div style={{ border: '1px solid #d4dae8', borderRadius: 6, padding: '8px 10px', background: '#fff' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8 }}>
        <b style={{ fontSize: 13, color: '#0A0F2C' }}>{system.label}</b>
        <span style={{ fontSize: 13, fontWeight: 700, color: '#1a2456', fontFamily: 'monospace' }}>{money(total)}</span>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: (isCount || isPerCount) ? '1fr 1fr' : '1fr', gap: 6, marginTop: 4 }}>
        {(isCount || isPerCount) && (
          <select style={inp} value={countValue(system, sizing)} onChange={e => onChange({ count: Number(e.target.value) })}>
            {countOptions(system, sizing).map(n => <option key={n} value={n}>{(p.countLabel || 'Qty') + ': ' + n}</option>)}
          </select>
        )}
        {isAmount ? (
          <select style={inp} value={Number(system.selectedAmount ?? 0)} onChange={e => onChange({ selectedAmount: Number(e.target.value) })}>
            {(p.amounts || [0]).map(v => <option key={v} value={v}>{money(v)}</option>)}
          </select>
        ) : (
          <select style={inp} value={system.condition || ''} onChange={e => onChange({ condition: e.target.value || null })}>
            <option value="">— condition —</option>
            {conditionOptions(system, sizing).map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        )}
      </div>
      {label && <div style={{ fontSize: 10, color: '#9aa3b2', marginTop: 3, fontFamily: 'monospace' }}>{label}</div>}
    </div>
  )
}

function conditionOptions(system, sizing) {
  const keys = system?.pricing?.tierKeys || STANDARD_TIER_KEYS
  if (system?.pricing?.kind === 'static_per_count') {
    const per = pricesByConditionPerCount(system)
    return keys.map(k => ({ value: k, label: `${TIER_LABELS[k] || k} ($${(per[k] || 0).toLocaleString()}/ea)` }))
  }
  const prices = pricesByCondition(system, sizing)
  return keys.map(k => ({ value: k, label: `${TIER_LABELS[k] || k} (${money(prices[k] || 0)})` }))
}
function countValue(system, sizing) {
  return system.count != null && Number.isFinite(Number(system.count)) ? Number(system.count) : resolveDefaultCount(system.pricing?.defaultCount, sizing)
}
function countOptions(system, sizing) {
  const base = (COUNT_OPTS_BY_ID[system.id] || COUNT_OPTS).slice()
  const cur = countValue(system, sizing)
  if (cur != null && Number.isFinite(cur) && !base.includes(cur)) { base.push(cur); base.sort((a, b) => a - b) }
  return base
}
