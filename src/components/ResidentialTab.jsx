import { useState } from 'react'
import {
  residentialAllModes, residentialMAO, residentialDSCR,
  ownerHardMode, arv40thPercentile
} from '../math/residential.js'
import { runResidentialDeal } from '../math/scenarioEngine.js'
import { loadConstants } from '../math/constants.js'
import ExitStrategiesTab from './ExitStrategiesTab.jsx'

const C = loadConstants()

const INITIAL_FLIP = {
  arv: '',
  rehab: '',
  // optional comps for ARV percentile derivation
  compsRaw: ''
}

const INITIAL_RENTAL = {
  arv: '',
  rehab: '',
  grossDollarsIn: '',
  hardCosts: '',
  compsRaw: ''
}

function buildFlipInitial(urlState) {
  const u = urlState || {}
  return {
    ...INITIAL_FLIP,
    arv: u.arv != null ? String(u.arv) : INITIAL_FLIP.arv,
    rehab: u.rehab != null ? String(u.rehab) : INITIAL_FLIP.rehab,
    compsRaw: u.compsRaw ?? INITIAL_FLIP.compsRaw
  }
}

function buildRentalInitial(urlState) {
  const u = urlState || {}
  return {
    ...INITIAL_RENTAL,
    arv: u.arv != null ? String(u.arv) : INITIAL_RENTAL.arv,
    rehab: u.rehab != null ? String(u.rehab) : INITIAL_RENTAL.rehab,
    grossDollarsIn: u.grossDollarsIn != null ? String(u.grossDollarsIn) : INITIAL_RENTAL.grossDollarsIn,
    hardCosts: u.hardCosts != null ? String(u.hardCosts) : INITIAL_RENTAL.hardCosts,
    compsRaw: u.compsRaw ?? INITIAL_RENTAL.compsRaw
  }
}

export default function ResidentialTab({ urlState, sharedUrlState }) {
  const [mode, setMode] = useState((urlState && urlState.mode) || 'flip')
  const [flipInputs, setFlipInputs] = useState(() => buildFlipInitial(urlState))
  const [rentalInputs, setRentalInputs] = useState(() => buildRentalInitial(urlState))
  const [results, setResults] = useState(null)
  const propertyContext = sharedUrlState || {}

  const updateFlip = (f, v) => setFlipInputs(p => ({ ...p, [f]: v }))
  const updateRental = (f, v) => setRentalInputs(p => ({ ...p, [f]: v }))

  const calc = () => {
    if (mode === 'flip') {
      const arv = parseFloat(flipInputs.arv) || 0
      const rehab = parseFloat(flipInputs.rehab) || 0
      const comps = parseComps(flipInputs.compsRaw)
      if (arv <= 0 && comps.length === 0) {
        setResults({ error: 'Provide either ARV or comps (one comp per line as a number).' })
        return
      }
      const arvResult = comps.length > 0 ? arv40thPercentile(comps) : { arv, confidence: 'OPERATOR_PROVIDED', flag: null }
      const usedARV = arvResult.arv ?? arv
      if (!usedARV || usedARV <= 0) {
        setResults({ error: arvResult.flag || 'Invalid ARV.' })
        return
      }
      const mao = residentialMAO(usedARV, rehab)
      // Implied flipper profit (Math Bible: not computed; matches Fast Calc pattern):
      const sellingCosts = usedARV * C.SELLING_COSTS_PCT
      const holdingCosts = C.HOLDING_PER_MONTH * C.HOLDING_MONTHS
      const endBuyerTotalCost = mao.endBuyer + rehab + sellingCosts + holdingCosts
      const flipperProfit = usedARV - endBuyerTotalCost

      setResults({
        mode: 'flip',
        arvResult,
        usedARV,
        rehab,
        mao,
        sellingCosts,
        holdingCosts,
        endBuyerTotalCost,
        flipperProfit
      })
    } else {
      const arv = parseFloat(rentalInputs.arv) || 0
      const rehab = parseFloat(rentalInputs.rehab) || 0
      const grossDollarsIn = parseFloat(rentalInputs.grossDollarsIn) || 0
      const hardCosts = parseFloat(rentalInputs.hardCosts) || 0
      const comps = parseComps(rentalInputs.compsRaw)
      if (grossDollarsIn <= 0) {
        setResults({ error: 'Gross dollars in (annual rent) is required.' })
        return
      }
      const dealResult = runResidentialDeal({
        grossDollarsIn,
        hardCosts,
        arv: arv || null,
        rehab,
        comps: comps.length > 0 ? comps : null
      })
      setResults({ mode: 'rental', ...dealResult })
    }
  }

  return (
    <section style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
      <header>
        <h2 style={{ margin: '0 0 8px', fontSize: 22, fontWeight: 600 }}>Residential</h2>
        <p style={{ color: '#5a6a8a', fontSize: 14, lineHeight: 1.6, margin: 0 }}>
          Math Bible v3 residential engine — flip MAO (70% rule with $10k wholesale fee), rental DSCR
          (3-tier MVM: 0% / 15% / 30% maintenance &amp; vacancy), 40th-percentile ARV from comps, Owner Hard Mode (internal).
        </p>
      </header>

      <ModeToggle mode={mode} setMode={setMode} setResults={setResults} />

      {mode === 'altexit' ? (
        <ExitStrategiesTab />
      ) : (
        <>
          {mode === 'flip' ? (
            <FlipForm inputs={flipInputs} update={updateFlip} />
          ) : (
            <RentalForm inputs={rentalInputs} update={updateRental} />
          )}

          <button type="button" onClick={calc} style={btnStyle}>Calculate</button>

          {results && results.error && <div style={errorBoxStyle}>{results.error}</div>}
          {results && !results.error && (
            <div className="results-section">
              {results.mode === 'flip' && <FlipResults r={results} />}
              {results.mode === 'rental' && <RentalResults r={results} />}
              <LoiPrepResidential mode={results.mode} results={results} propertyContext={propertyContext} />
            </div>
          )}
        </>
      )}
    </section>
  )
}

function LoiPrepResidential({ mode, results, propertyContext }) {
  const printNow = () => { window.print() }
  const ctx = propertyContext || {}

  const rows = []
  if (ctx.propertyName) rows.push(['Property', ctx.propertyName])
  if (ctx.address) rows.push(['Address', ctx.address])
  rows.push(['Asset type', mode === 'flip' ? 'Residential — Flip' : 'Residential — Rental'])
  if (ctx.askingPrice) rows.push(['Asking price', formatMoney(ctx.askingPrice)])

  if (mode === 'flip') {
    rows.push(['ARV used', formatMoney(results.usedARV)])
    rows.push(['ARV source', `${results.arvResult.confidence}${results.arvResult.flag ? ' — ' + results.arvResult.flag : ''}`])
    rows.push(['Rehab budget', formatMoney(results.rehab)])
    rows.push(['End-buyer max purchase (70% rule)', formatMoney(results.mao.endBuyer)])
    rows.push(['Recommended offer (− wholesale fee)', formatMoney(results.mao.yourOffer)])
    rows.push(['Implied flipper profit (sanity check)', formatMoney(results.flipperProfit)])
  } else {
    const standard = results.modes.standard
    const dscrStd = results.dscr.standard
    rows.push(['Annual rent (gross)', formatMoney(results.inputs.grossDollarsIn)])
    rows.push(['MVM (15% of income)', formatMoney(standard.pad)])
    rows.push(['Hard OpEx', formatMoney(results.inputs.hardCosts)])
    rows.push(['NOI (Standard, 15% MVM)', formatMoney(standard.noi)])
    if (results.mao.endBuyer > 0) {
      rows.push(['MAO end-buyer purchase', formatMoney(results.mao.endBuyer)])
      rows.push(['Recommended offer', formatMoney(results.mao.yourOffer)])
      rows.push(['DSCR @ MAO (Standard NOI)', dscrStd.dscr.toFixed(2)])
      rows.push(['Pass DSCR floor?', dscrStd.pass ? 'YES (≥ 1.25)' : 'NO (< 1.25)'])
    }
    rows.push(['Owner Hard Mode pMax (INTERNAL ONLY)', formatMoney(results.ownerHardMode.pMax)])
  }

  return (
    <div className="loi-prep-section">
      <h3>LOI Prep — {mode === 'flip' ? 'Residential Flip' : 'Residential Rental'}</h3>
      <div className="loi-prep-grid">
        {rows.map(([k, v]) => (
          <div key={k} className="loi-prep-row">
            <span className="lp-k">{k}</span>
            <span className="lp-v">{v}</span>
          </div>
        ))}
      </div>
      <div style={{ marginTop: 16, paddingTop: 12, borderTop: '1px dashed #d4dae8', fontSize: 12, color: '#5a6a8a', fontStyle: 'italic' }}>
        Pre-LOI internal worksheet. Math Bible v3 — tougher of the available engines.
        Owner Hard Mode is INTERNAL — never put on a team report or seller letter.
      </div>
      <div className="no-print" style={{ marginTop: 16 }}>
        <button type="button" onClick={printNow} style={btnStyle}>Print LOI Prep</button>
      </div>
    </div>
  )
}

function ModeToggle({ mode, setMode, setResults }) {
  const swap = (m) => { setMode(m); setResults(null) }
  return (
    <div style={{ display: 'flex', gap: 8, padding: 4, backgroundColor: '#eef2fb', borderRadius: 6, alignSelf: 'flex-start' }}>
      <ModeButton active={mode === 'flip'} onClick={() => swap('flip')}>Flip (MAO)</ModeButton>
      <ModeButton active={mode === 'rental'} onClick={() => swap('rental')}>Rental (DSCR)</ModeButton>
      <ModeButton active={mode === 'altexit'} onClick={() => swap('altexit')}>Alt Exit Strategy</ModeButton>
    </div>
  )
}

function ModeButton({ active, children, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        padding: '8px 16px',
        border: 'none',
        borderRadius: 4,
        backgroundColor: active ? '#1a2456' : 'transparent',
        color: active ? '#fff' : '#1a2456',
        fontWeight: active ? 600 : 400,
        fontSize: 14,
        cursor: 'pointer'
      }}
    >
      {children}
    </button>
  )
}

function FlipForm({ inputs, update }) {
  return (
    <>
      <FormGroup label="ARV (after-repair value, $)" hint="Required if no comps provided. Otherwise comps win.">
        <Input type="number" value={inputs.arv} onChange={v => update('arv', v)} placeholder="210000" />
      </FormGroup>
      <FormGroup label="Rehab budget ($)" hint="Total estimated repair cost.">
        <Input type="number" value={inputs.rehab} onChange={v => update('rehab', v)} placeholder="35000" />
      </FormGroup>
      <FormGroup
        label="Comps (optional — one sale price per line)"
        hint={`Min ${C.ARV_MIN_COMPS} comps. ARV = low + ${formatPct(C.ARV_PERCENTILE)} × (high − low) — Math Bible 40th percentile rule.`}
      >
        <Textarea value={inputs.compsRaw} onChange={v => update('compsRaw', v)} placeholder={'200000\n220000\n240000\n260000\n280000'} />
      </FormGroup>
    </>
  )
}

function RentalForm({ inputs, update }) {
  return (
    <>
      <FormGroup label="Gross dollars in (annual rent, $) *">
        <Input type="number" value={inputs.grossDollarsIn} onChange={v => update('grossDollarsIn', v)} placeholder="42000" />
      </FormGroup>
      <FormGroup label="Hard costs (annual OpEx — taxes, insurance, mgmt, maintenance, $)">
        <Input type="number" value={inputs.hardCosts} onChange={v => update('hardCosts', v)} placeholder="14000" />
      </FormGroup>
      <FormGroup label="ARV ($, optional)" hint="Used as an alternative basis for DSCR check vs end-buyer purchase price.">
        <Input type="number" value={inputs.arv} onChange={v => update('arv', v)} placeholder="200000" />
      </FormGroup>
      <FormGroup label="Rehab ($, optional)" hint="Used in MAO + Owner Hard Mode.">
        <Input type="number" value={inputs.rehab} onChange={v => update('rehab', v)} placeholder="8000" />
      </FormGroup>
      <FormGroup label="Comps (optional)">
        <Textarea value={inputs.compsRaw} onChange={v => update('compsRaw', v)} placeholder={'200000\n220000\n240000'} />
      </FormGroup>
    </>
  )
}

function FlipResults({ r }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24, paddingTop: 16, borderTop: '2px solid #1a2456' }}>
      <Card title="ARV">
        <Row label="ARV used" value={formatMoney(r.usedARV)} bold />
        <Row label="Source" value={r.arvResult.confidence} accent={r.arvResult.flag || 'as entered'} />
        {r.arvResult.low !== undefined && (
          <>
            <Row label="Comp low" value={formatMoney(r.arvResult.low)} />
            <Row label="Comp high" value={formatMoney(r.arvResult.high)} />
            <Row label="40th percentile" value={formatMoney(r.usedARV)} accent="low + 0.40 × (high − low)" />
          </>
        )}
      </Card>

      <Card title={`MAO — Math Bible 70% rule (factor ${formatPct(C.MAO_FACTOR)})`}>
        <Row label="ARV × 70%" value={formatMoney(r.usedARV * C.MAO_FACTOR)} />
        <Row label="− Rehab" value={formatMoney(-r.rehab)} />
        <Row label="End-buyer max purchase" value={formatMoney(r.mao.endBuyer)} bold />
        <Row label="Your offer (− wholesale fee)" value={formatMoney(r.mao.yourOffer)} bold accent={`wholesale fee ${formatMoney(C.WHOLESALE_FEE)}`} />
      </Card>

      <Card title="Implied flipper economics (sanity check)">
        <Row label="End-buyer purchase" value={formatMoney(r.mao.endBuyer)} />
        <Row label="+ Rehab" value={formatMoney(r.rehab)} />
        <Row label={`+ Selling costs (${formatPct(C.SELLING_COSTS_PCT)} of ARV)`} value={formatMoney(r.sellingCosts)} />
        <Row label={`+ Holding (${C.HOLDING_MONTHS} months × $${C.HOLDING_PER_MONTH})`} value={formatMoney(r.holdingCosts)} />
        <Row label="End-buyer total cost" value={formatMoney(r.endBuyerTotalCost)} />
        <Row label="Flipper profit" value={formatMoney(r.flipperProfit)} bold accentColor={r.flipperProfit > 0 ? '#0d5e2c' : '#7a0000'} accent={r.flipperProfit > 0 ? 'positive' : 'negative — deal does not pencil for end buyer'} />
      </Card>
    </div>
  )
}

function RentalResults({ r }) {
  const { modes, mao, dscr, ownerHardMode: hardMode, arvResult } = r
  const cardData = [
    { key: 'light',    label: 'Light (0% MVM)',      m: modes.light,    d: dscr.light },
    { key: 'standard', label: 'Standard (15% MVM)',  m: modes.standard, d: dscr.standard },
    { key: 'harsh',    label: 'Harsh (30% MVM)',     m: modes.harsh,    d: dscr.harsh }
  ]
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24, paddingTop: 16, borderTop: '2px solid #1a2456' }}>
      <Card title="Inputs summary">
        <Row label="Gross dollars in" value={formatMoney(r.inputs.grossDollarsIn)} />
        <Row label="Hard costs" value={formatMoney(r.inputs.hardCosts)} />
        {r.inputs.arv > 0 && <Row label="ARV (entered)" value={formatMoney(r.inputs.arv)} />}
        {r.inputs.rehab > 0 && <Row label="Rehab" value={formatMoney(r.inputs.rehab)} />}
        <Row label="ARV source" value={arvResult.confidence} accent={arvResult.flag || 'as entered'} />
      </Card>

      {cardData.map(card => (
        <Card key={card.key} title={`Rental ${card.label}`}>
          <Row label="Gross income" value={formatMoney(card.m.grossDollarsIn)} />
          <Row label="− MVM (maintenance & vacancy)" value={formatMoney(-card.m.pad)} accent={`${formatPct(card.m.padPct)} of income`} />
          <Row label="− Hard costs" value={formatMoney(-card.m.hardCosts)} />
          <Row label="NOI" value={formatMoney(card.m.noi)} bold />
          {mao.endBuyer > 0 && (
            <>
              <Row label="DSCR check vs MAO end-buyer" value={card.d.dscr.toFixed(2)} accent={card.d.pass ? `≥ ${C.DSCR_CONSERVATIVE} — pass` : `< ${C.DSCR_CONSERVATIVE} — fail`} accentColor={card.d.pass ? '#0d5e2c' : '#7a0000'} />
              <Row label="Loan @ MAO" value={formatMoney(card.d.loan)} accent={`${formatPct(C.LTV_RESI)} LTV`} />
              <Row label="Annual DS" value={formatMoney(card.d.annualDS)} />
            </>
          )}
        </Card>
      ))}

      {mao.endBuyer > 0 && (
        <Card title="MAO — 70% rule (residential flip cross-check)">
          <Row label="ARV × 70%" value={formatMoney((r.inputs.arv || 0) * C.MAO_FACTOR)} />
          <Row label="End-buyer purchase" value={formatMoney(mao.endBuyer)} bold />
          <Row label="Your offer" value={formatMoney(mao.yourOffer)} bold />
        </Card>
      )}

      {hardMode.pMax > 0 && (
        <Card title="Owner Hard Mode (INTERNAL — not for team report or seller letter)">
          <Row label="pMax" value={formatMoney(hardMode.pMax)} bold />
          <Row label="Your offer" value={formatMoney(hardMode.yourOffer)} bold />
          <div style={{ fontSize: 11, fontStyle: 'italic', color: '#7a0000', marginTop: 4 }}>{hardMode.note}</div>
        </Card>
      )}
    </div>
  )
}

// ---------- helpers ----------

function parseComps(raw) {
  if (!raw) return []
  return raw
    .split(/[\n,]/)
    .map(line => line.trim().replace(/[$,\s]/g, ''))
    .filter(line => line.length > 0)
    .map(line => parseFloat(line))
    .filter(n => Number.isFinite(n) && n > 0)
    .map(salePrice => ({ salePrice }))
}

// ---------- shared little components (duplicated per-tab per isolation rule) ----------

function FormGroup({ label, hint, children }) {
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <span style={{ fontSize: 13, fontWeight: 600, color: '#1a2456' }}>{label}</span>
      {children}
      {hint && <span style={{ fontSize: 12, color: '#8a96b0', fontStyle: 'italic' }}>{hint}</span>}
    </label>
  )
}

function Input({ type = 'text', value, onChange, placeholder, step }) {
  return <input type={type} step={step} value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder} style={inputStyle} />
}

function Textarea({ value, onChange, placeholder }) {
  return <textarea rows={5} value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder} style={{ ...inputStyle, fontFamily: 'monospace', resize: 'vertical' }} />
}

function Card({ title, children }) {
  return (
    <div style={{ border: '1px solid #d4dae8', borderRadius: 6, backgroundColor: '#fff', padding: 16 }}>
      <h3 style={{ margin: '0 0 12px', fontSize: 16, fontWeight: 600, color: '#1a2456' }}>{title}</h3>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>{children}</div>
    </div>
  )
}

function Row({ label, value, bold, accent, accentColor }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', fontSize: 14, paddingBottom: 4, borderBottom: '1px dashed #eef2fb' }}>
      <span style={{ color: '#5a6a8a' }}>{label}</span>
      <span style={{ textAlign: 'right' }}>
        <span style={{ fontWeight: bold ? 700 : 500, color: '#1a2456' }}>{value}</span>
        {accent && <div style={{ fontSize: 11, color: accentColor || '#8a96b0', marginTop: 2 }}>{accent}</div>}
      </span>
    </div>
  )
}

const inputStyle = { padding: '8px 10px', fontSize: 14, border: '1px solid #c8d0e0', borderRadius: 4, fontFamily: 'inherit', color: '#1a2456', backgroundColor: '#fff' }
const btnStyle = { padding: '12px 24px', fontSize: 15, fontWeight: 600, color: '#fff', backgroundColor: '#1a2456', border: 'none', borderRadius: 6, cursor: 'pointer', alignSelf: 'flex-start' }
const errorBoxStyle = { padding: 12, border: '1px solid #d04040', borderRadius: 6, backgroundColor: '#fde2e2', color: '#7a0000', fontSize: 13 }

function formatMoney(n) {
  if (n === null || n === undefined || !Number.isFinite(n)) return '—'
  const sign = n < 0 ? '-' : ''
  const abs = Math.abs(n)
  return `${sign}$${abs.toLocaleString('en-US', { maximumFractionDigits: 0 })}`
}
function formatPct(n) {
  if (n === null || n === undefined || !Number.isFinite(n)) return '—'
  return `${(n * 100).toFixed(2)}%`
}
