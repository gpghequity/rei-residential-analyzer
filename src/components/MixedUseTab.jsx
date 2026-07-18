import { useState } from 'react'
import { blendComponents, ASSET_TYPE_CAP_RANGES, ASSET_TYPE_LABELS } from '../math/mixedUse.js'

const ASSET_TYPES = Object.keys(ASSET_TYPE_CAP_RANGES)

let _id = 0
const newComponent = () => ({
  id: ++_id,
  label: '',
  assetType: 'storage',
  noi: '',
  capRate: ''
})

export default function MixedUseTab() {
  const [components, setComponents] = useState([newComponent(), newComponent()])
  const [discount, setDiscount] = useState('0')
  const [results, setResults] = useState(null)

  const add = () => setComponents(p => [...p, newComponent()])
  const remove = (id) => {
    if (components.length <= 2) return
    setComponents(p => p.filter(c => c.id !== id))
    setResults(null)
  }
  const update = (id, field, val) => {
    setComponents(p => p.map(c => c.id === id ? { ...c, [field]: val } : c))
    setResults(null)
  }

  const calc = () => {
    const parsed = components.map(c => ({
      ...c,
      noi: parseFloat(c.noi) || 0,
      capRate: parseFloat(c.capRate) / 100 || 0
    }))
    const r = blendComponents(parsed, parseFloat(discount) || 0)
    setResults(r)
  }

  return (
    <section style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
      <header>
        <h2 style={{ margin: '0 0 8px', fontSize: 22, fontWeight: 600 }}>Mixed Use</h2>
        <p style={{ color: '#5a6a8a', fontSize: 14, lineHeight: 1.6, margin: 0 }}>
          One parcel, multiple income types. Enter each component's NOI and cap rate — the tool blends them into one value and one offer number.
          Run each component through its own Residential Analyzer tab first to get the NOI, then bring it here.
        </p>
      </header>

      <div style={{ padding: '10px 14px', background: '#fffbeb', border: '1px solid #fde68a', borderRadius: 6, fontSize: 13, color: '#78350f' }}>
        <strong>When to use this:</strong> Two or more income streams on the same parcel that each have distinct cap rates (e.g., storage building + commercial office, MHP + retail strip, multifamily + ground-floor commercial).
        If one component is under 10% of total NOI, fold it into OpEx instead — the tool will flag it.
      </div>

      {/* Component rows */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {components.map((c, i) => (
          <ComponentRow
            key={c.id}
            component={c}
            index={i}
            onUpdate={(f, v) => update(c.id, f, v)}
            onRemove={() => remove(c.id)}
            canRemove={components.length > 2}
          />
        ))}
      </div>

      <div style={{ display: 'flex', gap: 12, alignItems: 'flex-end', flexWrap: 'wrap' }}>
        <button type="button" onClick={add} style={addBtnStyle}>
          + Add Component
        </button>

        <label style={{ display: 'flex', flexDirection: 'column', gap: 4, minWidth: 200 }}>
          <span style={{ fontSize: 13, fontWeight: 600, color: '#1a2456' }}>
            Mixed-use discount (%)
          </span>
          <span style={{ fontSize: 12, color: '#8a96b0', fontStyle: 'italic' }}>
            0–15%. Reflects illiquidity of mixed-use vs. pure-play asset. Typical: 5%.
          </span>
          <input
            type="number" min="0" max="15" step="1"
            value={discount}
            onChange={e => { setDiscount(e.target.value); setResults(null) }}
            style={inputStyle}
            placeholder="0"
          />
        </label>

        <button type="button" onClick={calc} style={calcBtnStyle}>
          Blend &amp; Calculate
        </button>
      </div>

      {results && results.error && (
        <div style={errorStyle}>{results.error}</div>
      )}

      {results && results.ok && <BlendResults r={results} />}
    </section>
  )
}

function ComponentRow({ component: c, index, onUpdate, onRemove, canRemove }) {
  const ranges = ASSET_TYPE_CAP_RANGES[c.assetType]
  return (
    <div style={{ border: '1px solid #d4dae8', borderRadius: 8, padding: 16, background: '#fff', display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span style={{ fontWeight: 700, color: '#1a2456', fontSize: 14 }}>Component {index + 1}</span>
        {canRemove && (
          <button type="button" onClick={onRemove} style={{ background: 'none', border: 'none', color: '#9ca3af', cursor: 'pointer', fontSize: 18, lineHeight: 1 }}>×</button>
        )}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 12 }}>
        <label style={fgStyle}>
          <span style={labelStyle}>Label (optional)</span>
          <input type="text" value={c.label} onChange={e => onUpdate('label', e.target.value)}
            placeholder={ASSET_TYPE_LABELS[c.assetType]}
            style={inputStyle} />
        </label>

        <label style={fgStyle}>
          <span style={labelStyle}>Asset type</span>
          <select value={c.assetType} onChange={e => onUpdate('assetType', e.target.value)} style={inputStyle}>
            {ASSET_TYPES.map(t => (
              <option key={t} value={t}>{ASSET_TYPE_LABELS[t]}</option>
            ))}
          </select>
        </label>

        <label style={fgStyle}>
          <span style={labelStyle}>Annual NOI ($)</span>
          <span style={hintStyle}>Net operating income after all expenses</span>
          <input type="number" value={c.noi} onChange={e => onUpdate('noi', e.target.value)}
            placeholder="85000" style={inputStyle} />
        </label>

        <label style={fgStyle}>
          <span style={labelStyle}>Cap rate (%)</span>
          <span style={hintStyle}>
            {ranges ? `Market range: ${(ranges.low * 100).toFixed(1)}–${(ranges.high * 100).toFixed(1)}% · Mid: ${(ranges.mid * 100).toFixed(1)}%` : ''}
          </span>
          <input type="number" step="0.1" value={c.capRate} onChange={e => onUpdate('capRate', e.target.value)}
            placeholder={ranges ? (ranges.mid * 100).toFixed(1) : '7.0'}
            style={inputStyle} />
        </label>
      </div>
    </div>
  )
}

function BlendResults({ r }) {
  const hasMinor = r.components.some(c => c.minor)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16, paddingTop: 16, borderTop: '2px solid #1a2456' }}>
      <h3 style={{ margin: 0, fontSize: 18, fontWeight: 700, color: '#1a2456' }}>Blended Valuation</h3>

      {hasMinor && (
        <div style={{ padding: '10px 14px', background: '#fff7ed', border: '1px solid #fed7aa', borderRadius: 6, fontSize: 13, color: '#9a3412' }}>
          <strong>Minor component flagged.</strong> One or more components is under 10% of total NOI.
          Consider folding it into OpEx on the primary asset instead of valuing it separately — it won't move the needle and creates financing complexity.
        </div>
      )}

      {/* Per-component breakdown */}
      <div style={{ border: '1px solid #d4dae8', borderRadius: 8, overflow: 'hidden' }}>
        <div style={{ background: '#1a2456', color: '#f0d080', display: 'grid', gridTemplateColumns: '2fr 1fr 1fr 1fr 1fr', padding: '10px 16px', fontSize: 13, fontWeight: 700 }}>
          <span>Component</span>
          <span style={{ textAlign: 'right' }}>Annual NOI</span>
          <span style={{ textAlign: 'right' }}>Cap Rate</span>
          <span style={{ textAlign: 'right' }}>Value</span>
          <span style={{ textAlign: 'right' }}>% of Deal</span>
        </div>
        {r.components.map(c => (
          <div key={c.id} style={{
            display: 'grid', gridTemplateColumns: '2fr 1fr 1fr 1fr 1fr',
            padding: '10px 16px', fontSize: 14,
            borderTop: '1px solid #e5e7eb',
            background: c.minor ? '#fff7ed' : '#fff'
          }}>
            <span style={{ fontWeight: 600, color: '#1a2456' }}>
              {c.label}
              {c.minor && <span style={{ fontSize: 11, color: '#9a3412', marginLeft: 6 }}>⚠ minor</span>}
            </span>
            <span style={{ textAlign: 'right', color: '#374151' }}>{fm(c.noi)}</span>
            <span style={{ textAlign: 'right', color: '#374151' }}>{fp(c.capRate)}</span>
            <span style={{ textAlign: 'right', fontWeight: 700, color: '#1a2456' }}>{fm(c.value)}</span>
            <span style={{ textAlign: 'right', color: '#6b7280' }}>{fp(c.pctOfNoi)}</span>
          </div>
        ))}
      </div>

      {/* Blended totals */}
      <div style={{ border: '1px solid #d4dae8', borderRadius: 8, background: '#fff', padding: 16 }}>
        <h4 style={{ margin: '0 0 12px', fontSize: 15, fontWeight: 600, color: '#1a2456' }}>Totals</h4>
        <Row label="Total NOI (all components)" value={fm(r.totalNoi)} />
        <Row label="Sum of component values" value={fm(r.totalValue)} />
        <Row label="Blended cap rate" value={fp(r.blendedCapRate)} accent="Total NOI ÷ total value" />
        <Row label="Dominant component" value={r.dominant?.label || '—'} accent={`${fp(r.dominant?.pctOfNoi)} of NOI · drives the deal`} />

        {r.discount > 0 && (
          <>
            <Row label={`Mixed-use discount (${r.discount}%)`} value={`− ${fm(r.discountAmount)}`} accentColor="#9a3412" accent="Illiquidity / financing complexity haircut" />
            <Row label="Discounted blended value" value={fm(r.discountedValue)} bold accentColor="#0d5e2c" accent="Use this as your valuation basis" />
          </>
        )}

        {r.discount === 0 && (
          <Row label="Blended value (no discount)" value={fm(r.totalValue)} bold accentColor="#0d5e2c" accent="Consider a 3–7% mixed-use discount if financing will be harder to place" />
        )}
      </div>

      <div style={{ fontSize: 12, fontStyle: 'italic', color: '#8a96b0', padding: '10px 14px', background: '#f8f9fc', border: '1px solid #e4e8f0', borderRadius: 6 }}>
        Mixed-use valuation is for internal offer pricing only. Lenders will often finance each component separately or apply their own haircut.
        Confirm cap rate assumptions with recent local comps before submitting an LOI.
      </div>

      <div className="no-print">
        <button type="button" onClick={() => window.print()} style={calcBtnStyle}>Print / Save PDF</button>
      </div>
    </div>
  )
}

function Row({ label, value, bold, accent, accentColor }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', fontSize: 14, paddingBottom: 6, marginBottom: 6, borderBottom: '1px dashed #eef2fb' }}>
      <span style={{ color: '#5a6a8a' }}>{label}</span>
      <span style={{ textAlign: 'right' }}>
        <span style={{ fontWeight: bold ? 700 : 500, color: '#1a2456' }}>{value}</span>
        {accent && <div style={{ fontSize: 11, color: accentColor || '#8a96b0', marginTop: 2 }}>{accent}</div>}
      </span>
    </div>
  )
}

const fgStyle = { display: 'flex', flexDirection: 'column', gap: 4 }
const labelStyle = { fontSize: 13, fontWeight: 600, color: '#1a2456' }
const hintStyle = { fontSize: 11, color: '#8a96b0', fontStyle: 'italic' }
const inputStyle = { padding: '8px 10px', fontSize: 14, border: '1px solid #c8d0e0', borderRadius: 4, fontFamily: 'inherit', color: '#1a2456', backgroundColor: '#fff' }
const calcBtnStyle = { padding: '12px 24px', fontSize: 15, fontWeight: 600, color: '#fff', backgroundColor: '#1a2456', border: 'none', borderRadius: 6, cursor: 'pointer' }
const addBtnStyle = { padding: '10px 18px', fontSize: 14, fontWeight: 600, color: '#1a2456', backgroundColor: '#eef2fb', border: '2px dashed #c8d0e0', borderRadius: 6, cursor: 'pointer' }
const errorStyle = { padding: 12, border: '1px solid #d04040', borderRadius: 6, backgroundColor: '#fde2e2', color: '#7a0000', fontSize: 13 }

function fm(n) {
  if (n === null || n === undefined || !Number.isFinite(n)) return '—'
  const sign = n < 0 ? '-' : ''
  return `${sign}$${Math.abs(n).toLocaleString('en-US', { maximumFractionDigits: 0 })}`
}
function fp(n) {
  if (n === null || n === undefined || !Number.isFinite(n)) return '—'
  return `${(n * 100).toFixed(1)}%`
}
