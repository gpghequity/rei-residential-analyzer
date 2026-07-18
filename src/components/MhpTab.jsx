import { useState } from 'react'
import { calcMhp, calcUtilityBurden, UTILITY_KEYS, POH_OPEX_PAD } from '../math/mhp.js'
import { getBibleStandards } from '../math/constants.js'

// Assumption form defaults are SEEDED FROM THE LIVE BIBLE, not hardcoded. The old
// hardcoded seeds were wrong and drove every max-purchase: seniorRate 0.075 (Bible
// 0.0725), seniorAmort 22 (Bible 25), buyerClosing 0.03 (Bible 0.02), lenderFees
// 0.005 (Bible 0.01), appraisal $5,000 (Bible $4,000), environmental $5,000 (Bible
// $3,500). MhpTab mounts only after the Bible is hydrated (deferred App import in
// main.jsx; setup.js in tests), so getBibleStandards() is available here.
function bibleAssumptionDefaults() {
  const S = getBibleStandards()
  const M = S.MHP
  const CC = S.CLOSING_COSTS
  return {
    dscr: String(M.dscr),
    seniorRate: String(M.mortgageRate),
    seniorAmort: String(M.amortizationYears),
    seniorLtv: String(M.ltv),
    sellerFiRate: String(M.sellerFi.rate),
    sellerFiAmort: String(M.sellerFi.amortYears),
    sellerFiPct: String(M.sellerFi.pct),
    managementPct: String(M.managementPct),
    buyerClosingCostsPct: String(CC.buyerClosingCostsPct),
    bankPointsPct: String(CC.bankPointsPct),
    lenderFeesPct: String(CC.lenderFeesPct),
    appraisalFee: String(CC.appraisalFee),
    environmentalFee: String(CC.environmentalFee),
    tohVacancyPct: String(M.tohVacancyPct),
    pohVacancyPct: String(M.pohVacancyPct),
    collectionLossPct: String(M.collectionLossPct)
  }
}

const INITIAL = {
  // Lot accounting
  totalLots: '',
  occupiedPoh: '',
  vacantPoh: '',
  occupiedToh: '',
  vacantLots: '',
  // Rents
  lotRentMonthly: '',
  pohRentMonthly: '',
  otherIncomeAnnual: '',
  // OpEx (pre-utility-burden)
  opExLineItems: '',
  // Utilities
  utilities: UTILITY_KEYS.reduce((acc, k) => {
    acc[k] = { mode: 'tenant-direct', costAnnual: '', recoveryPct: '' }
    return acc
  }, {}),
  // Vacancy / collection + all assumptions — seeded live from the Bible.
  ...bibleAssumptionDefaults()
}

// Accepts urlState + sharedUrlState props for forward compat with App.jsx;
// MHP URL params not yet wired (TODO — per memory, the MHP form is large
// enough that URL hydration deserves its own commit).
export default function MhpTab(_props) {
  const [inputs, setInputs] = useState(INITIAL)
  const [results, setResults] = useState(null)
  const [showUtilities, setShowUtilities] = useState(false)
  const [showAssumptions, setShowAssumptions] = useState(false)

  const update = (f, v) => setInputs(p => ({ ...p, [f]: v }))
  const updateUtility = (key, field, value) => {
    setInputs(p => ({
      ...p,
      utilities: { ...p.utilities, [key]: { ...p.utilities[key], [field]: value } }
    }))
  }

  const calc = () => {
    const totalLots = num(inputs.totalLots)
    if (totalLots <= 0) {
      setResults({ error: 'Total lots is required.' })
      return
    }

    // Build the utility object only for utilities the user has touched
    const utilities = {}
    for (const key of UTILITY_KEYS) {
      const u = inputs.utilities[key]
      if (u.mode !== 'tenant-direct' && num(u.costAnnual) > 0) {
        utilities[key] = {
          mode: u.mode,
          costAnnual: num(u.costAnnual),
          recoveryPct: num(u.recoveryPct)
        }
      }
    }
    const utilityBurden = calcUtilityBurden(utilities)
    const opExSum = num(inputs.opExLineItems) + utilityBurden.totalBurden

    const r = calcMhp({
      totalLots,
      occupiedPoh: num(inputs.occupiedPoh),
      vacantPoh: num(inputs.vacantPoh),
      occupiedToh: num(inputs.occupiedToh),
      vacantLots: num(inputs.vacantLots),
      lotRentMonthly: num(inputs.lotRentMonthly),
      pohRentMonthly: num(inputs.pohRentMonthly),
      otherIncomeAnnual: num(inputs.otherIncomeAnnual),
      tohVacancyPct: num(inputs.tohVacancyPct),
      pohVacancyPct: num(inputs.pohVacancyPct),
      collectionLossPct: num(inputs.collectionLossPct),
      opExSum
    }, {
      dscr: num(inputs.dscr),
      seniorRate: num(inputs.seniorRate),
      seniorAmort: num(inputs.seniorAmort),
      seniorLtv: num(inputs.seniorLtv),
      sellerFiRate: num(inputs.sellerFiRate),
      sellerFiAmort: num(inputs.sellerFiAmort),
      sellerFiPct: num(inputs.sellerFiPct),
      managementPct: num(inputs.managementPct),
      buyerClosingCostsPct: num(inputs.buyerClosingCostsPct),
      bankPointsPct: num(inputs.bankPointsPct),
      lenderFeesPct: num(inputs.lenderFeesPct),
      appraisalFee: num(inputs.appraisalFee),
      environmentalFee: num(inputs.environmentalFee)
    })

    setResults({ ...r, utilityBurden, opExSum, opExLineItems: num(inputs.opExLineItems) })
  }

  return (
    <section style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
      <header>
        <h2 style={{ margin: '0 0 8px', fontSize: 22, fontWeight: 600 }}>MHP</h2>
        <p style={{ color: '#5a6a8a', fontSize: 14, lineHeight: 1.6, margin: 0 }}>
          Fast Calc V2.6 mobile-home-park engine (Math Bible has no MHP module). Three MVM scenarios
          (0% / 20% / 30%), four-disjoint-counts lot accounting with hard error on mismatch, POH OpEx pad
          ({formatPct(POH_OPEX_PAD)}) weighted by POH share of operating units, utility responsibility matrix.
        </p>
      </header>

      <Section title="Lot accounting">
        <FormGroup label="Total lots *" hint="Physical pad capacity. The 4 counts below must sum to this exactly.">
          <Input type="number" value={inputs.totalLots} onChange={v => update('totalLots', v)} placeholder="80" />
        </FormGroup>
        <FormGroup label="Occupied POH" hint="Park-owned homes currently rented to a tenant.">
          <Input type="number" value={inputs.occupiedPoh} onChange={v => update('occupiedPoh', v)} placeholder="10" />
        </FormGroup>
        <FormGroup label="Vacant POH" hint="Park-owned homes empty / available.">
          <Input type="number" value={inputs.vacantPoh} onChange={v => update('vacantPoh', v)} placeholder="2" />
        </FormGroup>
        <FormGroup label="Occupied TOH" hint="Lots rented to a tenant who owns their home.">
          <Input type="number" value={inputs.occupiedToh} onChange={v => update('occupiedToh', v)} placeholder="56" />
        </FormGroup>
        <FormGroup label="Vacant lots" hint="Empty pads with no home.">
          <Input type="number" value={inputs.vacantLots} onChange={v => update('vacantLots', v)} placeholder="12" />
        </FormGroup>
      </Section>

      <Section title="Rents">
        <FormGroup label="TOH lot rent ($ / month)">
          <Input type="number" value={inputs.lotRentMonthly} onChange={v => update('lotRentMonthly', v)} placeholder="400" />
        </FormGroup>
        <FormGroup label="POH all-in rent ($ / month)" hint="Includes home + lot.">
          <Input type="number" value={inputs.pohRentMonthly} onChange={v => update('pohRentMonthly', v)} placeholder="850" />
        </FormGroup>
        <FormGroup label="Other income ($ / year)" hint="Laundry, storage, late fees, etc.">
          <Input type="number" value={inputs.otherIncomeAnnual} onChange={v => update('otherIncomeAnnual', v)} placeholder="5000" />
        </FormGroup>
      </Section>

      <Section title="Vacancy / collection (cushion on real occupied counts)">
        <FormGroup label="TOH vacancy %"><Input type="number" step="0.01" value={inputs.tohVacancyPct} onChange={v => update('tohVacancyPct', v)} /></FormGroup>
        <FormGroup label="POH vacancy %"><Input type="number" step="0.01" value={inputs.pohVacancyPct} onChange={v => update('pohVacancyPct', v)} /></FormGroup>
        <FormGroup label="Collection loss %"><Input type="number" step="0.01" value={inputs.collectionLossPct} onChange={v => update('collectionLossPct', v)} /></FormGroup>
      </Section>

      <Section title="Operating expenses (annual)">
        <FormGroup label="OpEx line items sum ($)" hint="Property tax, insurance, mgmt staff, repairs, etc. (utilities tracked separately below).">
          <Input type="number" value={inputs.opExLineItems} onChange={v => update('opExLineItems', v)} placeholder="20000" />
        </FormGroup>
        <button type="button" onClick={() => setShowUtilities(!showUtilities)} style={collapseBtn}>
          {showUtilities ? '▾' : '▸'} Utility responsibility matrix (V2.5)
        </button>
        {showUtilities && (
          <div style={{ paddingLeft: 16, borderLeft: '2px solid #d4dae8', display: 'flex', flexDirection: 'column', gap: 16 }}>
            <p style={{ fontSize: 12, color: '#5a6a8a', margin: 0, lineHeight: 1.5 }}>
              Per utility: <em>tenant-direct</em> = $0 burden · <em>park-paid</em> = full cost · <em>submeter</em> = cost − recovery.
              Total burden adds to OpEx automatically.
            </p>
            {UTILITY_KEYS.map(key => (
              <UtilityRow key={key} utilityKey={key} u={inputs.utilities[key]} update={updateUtility} />
            ))}
          </div>
        )}
      </Section>

      <Section title="Assumptions">
        <button type="button" onClick={() => setShowAssumptions(!showAssumptions)} style={collapseBtn}>
          {showAssumptions ? '▾' : '▸'} {showAssumptions ? 'Hide' : 'Show'} assumption block
        </button>
        {showAssumptions && (
          <div style={{ paddingLeft: 16, borderLeft: '2px solid #d4dae8', display: 'flex', flexDirection: 'column', gap: 12 }}>
            <FormGroup label="DSCR"><Input type="number" step="0.05" value={inputs.dscr} onChange={v => update('dscr', v)} /></FormGroup>
            <FormGroup label="Senior rate (decimal)"><Input type="number" step="0.0025" value={inputs.seniorRate} onChange={v => update('seniorRate', v)} /></FormGroup>
            <FormGroup label="Senior amort (years)"><Input type="number" value={inputs.seniorAmort} onChange={v => update('seniorAmort', v)} /></FormGroup>
            <FormGroup label="Senior LTV"><Input type="number" step="0.05" value={inputs.seniorLtv} onChange={v => update('seniorLtv', v)} /></FormGroup>
            <FormGroup label="Seller-fi rate"><Input type="number" step="0.0025" value={inputs.sellerFiRate} onChange={v => update('sellerFiRate', v)} /></FormGroup>
            <FormGroup label="Seller-fi amort"><Input type="number" value={inputs.sellerFiAmort} onChange={v => update('sellerFiAmort', v)} /></FormGroup>
            <FormGroup label="Seller-fi % of remaining equity" hint="1.0 = seller carries 100% of the gap."><Input type="number" step="0.05" value={inputs.sellerFiPct} onChange={v => update('sellerFiPct', v)} /></FormGroup>
            <FormGroup label="Management %"><Input type="number" step="0.01" value={inputs.managementPct} onChange={v => update('managementPct', v)} /></FormGroup>
            <FormGroup label="Buyer closing costs %"><Input type="number" step="0.005" value={inputs.buyerClosingCostsPct} onChange={v => update('buyerClosingCostsPct', v)} /></FormGroup>
            <FormGroup label="Bank points %"><Input type="number" step="0.005" value={inputs.bankPointsPct} onChange={v => update('bankPointsPct', v)} /></FormGroup>
            <FormGroup label="Lender fees %"><Input type="number" step="0.001" value={inputs.lenderFeesPct} onChange={v => update('lenderFeesPct', v)} /></FormGroup>
            <FormGroup label="Appraisal fee ($ flat)"><Input type="number" value={inputs.appraisalFee} onChange={v => update('appraisalFee', v)} /></FormGroup>
            <FormGroup label="Environmental fee ($ flat)"><Input type="number" value={inputs.environmentalFee} onChange={v => update('environmentalFee', v)} /></FormGroup>
          </div>
        )}
      </Section>

      <button type="button" onClick={calc} style={btnStyle}>Calculate</button>

      {results && results.error && <div style={errorBoxStyle}>{results.error}</div>}
      {results && !results.error && <MhpResults r={results} />}
    </section>
  )
}

function UtilityRow({ utilityKey, u, update }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4, padding: 8, border: '1px solid #eef2fb', borderRadius: 4 }}>
      <div style={{ fontSize: 13, fontWeight: 600, color: '#1a2456', textTransform: 'capitalize' }}>{utilityKey}</div>
      <select value={u.mode} onChange={e => update(utilityKey, 'mode', e.target.value)} style={inputStyle}>
        <option value="tenant-direct">Tenant pays direct</option>
        <option value="park-paid">Park-paid</option>
        <option value="submeter">Submeter (park bills back)</option>
      </select>
      {u.mode !== 'tenant-direct' && (
        <>
          <Input type="number" value={u.costAnnual} onChange={v => update(utilityKey, 'costAnnual', v)} placeholder="Annual park cost ($)" />
          {u.mode === 'submeter' && (
            <Input type="number" step="0.05" value={u.recoveryPct} onChange={v => update(utilityKey, 'recoveryPct', v)} placeholder="Recovery % (decimal, e.g. 0.85)" />
          )}
        </>
      )}
    </div>
  )
}

function MhpResults({ r }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24, paddingTop: 16, borderTop: '2px solid #1a2456' }}>
      {r.lotMixError && (
        <div style={errorBoxStyle}>
          🔴 Lot mix error — counts ({r.accounted}) don't sum to total lots ({r.totalLots}). Fix the lot accounting before relying on these numbers.
        </div>
      )}

      <Card title="Lot accounting">
        <Row label="Total lots" value={r.totalLots} />
        <Row label="Occupied POH" value={r.occupiedPoh} />
        <Row label="Vacant POH" value={r.vacantPoh} />
        <Row label="Occupied TOH" value={r.occupiedToh} />
        <Row label="Vacant lots" value={r.vacantLots} />
        <Row label="Total POH" value={r.totalPoh} />
        <Row label="Total occupied" value={r.totalOccupied} bold />
        <Row label="POH share of operating" value={formatPct(r.pohShare)} accent="drives OpEx pad" />
        <Row label="POH exposure share of total" value={formatPct(r.pohExposureShare)} accent={r.pohHeavy ? '⚠ POH heavy — lender haircut likely (>25%)' : 'within range'} accentColor={r.pohHeavy ? '#7a5b00' : '#0d5e2c'} />
      </Card>

      <Card title="Income (pre-MVM)">
        <Row label="TOH GPR" value={formatMoney(r.tohGpr)} />
        <Row label="POH GPR" value={formatMoney(r.pohGpr)} />
        <Row label="Other income" value={formatMoney(r.otherIncomeAnnual)} />
        <Row label="Income after vacancy" value={formatMoney(r.incomeAfterVacancy)} />
        <Row label="GSI (after collection)" value={formatMoney(r.gsi)} bold />
      </Card>

      <Card title="Expenses">
        <Row label="OpEx line items" value={formatMoney(r.opExLineItems)} />
        <Row label="Utility burden (net park-paid + submeter retained)" value={formatMoney(r.utilityBurden.totalBurden)} accent={r.utilityBurden.totalGrossCost > 0 ? `Gross ${formatMoney(r.utilityBurden.totalGrossCost)} − recovered ${formatMoney(r.utilityBurden.totalRecovered)}` : 'no park-paid utilities'} />
        <Row label="OpEx sum (line items + utility net)" value={formatMoney(r.opExSum)} bold />
      </Card>

      <h3 style={{ margin: '8px 0 0', fontSize: 18, color: '#1a2456' }}>Three MVM scenarios</h3>
      {r.cards.map(card => (
        <Card key={card.key} title={card.label}>
          <Row label="EGI (after MVM pad)" value={formatMoney(card.egi)} />
          <Row label="Management fee" value={formatMoney(card.managementFee)} />
          <Row label={`POH OpEx pad (${formatPct(POH_OPEX_PAD)} × POH share)`} value={formatMoney(card.pohPad)} />
          <Row label="OpEx total" value={formatMoney(card.opEx)} />
          <Row label="NOI" value={formatMoney(card.noi)} bold />
          <Row label="Max purchase" value={formatMoney(card.maxPurchase)} bold />
          <Row label="Implied cap" value={formatPct(card.impliedCap)} />
          <Row label="Max senior loan" value={formatMoney(card.maxSeniorLoan)} />
          <Row label="Seller-fi amount" value={formatMoney(card.sellerFiAmount)} />
          <Row label="Cash equity" value={formatMoney(card.cashEquity)} />
          <Row label="Bank annual DS" value={formatMoney(card.bankAnnualDS)} />
          <Row label="Seller annual DS" value={formatMoney(card.sellerAnnualDS)} />
          <Row label="Total annual DS" value={formatMoney(card.totalAnnualDS)} bold />
          <Row label="Total bank fees (points / lender / appraisal / env)" value={formatMoney(card.totalBankFees)} />
          <Row label="Buyer closing costs" value={formatMoney(card.buyerClosingCosts)} />
          <Row label="Total cash to close" value={formatMoney(card.totalCashToClose)} bold />
          <Row label="Pocket cash (annual, post-DS)" value={formatMoney(card.pocketCashAnnual)} accent={card.pocketFloorBinds ? `BELOW pocket floor` : `clears pocket floor`} accentColor={card.pocketFloorBinds ? '#7a0000' : '#0d5e2c'} />
          <Row label="Cash-on-cash" value={formatPct(card.cashOnCash)} bold />
          <div style={{ marginTop: 8, paddingTop: 8, borderTop: '1px dashed #d4dae8', fontSize: 12, color: '#5a6a8a' }}>
            <strong>Per-lot:</strong> revenue {formatMoney(card.revenuePerLot)} · NOI {formatMoney(card.noiPerLot)} · value {formatMoney(card.valuePerLot)}
          </div>
        </Card>
      ))}

      {(r.highPohVacancy || r.highVacantLots) && (
        <Card title="Flags">
          {r.highPohVacancy && <Row label="High POH vacancy" value="⚠" accent="POH vacancy > 20% — likely renovation overhang or tenant-quality issue" accentColor="#7a5b00" />}
          {r.highVacantLots && <Row label="High vacant-lot inventory" value="⚠" accent="Vacant lots > 15% of total — significant lease-up assumption" accentColor="#7a5b00" />}
        </Card>
      )}
    </div>
  )
}

// ---------- helpers ----------

function num(v) {
  const n = parseFloat(v)
  return Number.isFinite(n) ? n : 0
}

function Section({ title, children }) {
  return (
    <fieldset style={{ border: '1px solid #d4dae8', borderRadius: 6, padding: 16, margin: 0, display: 'flex', flexDirection: 'column', gap: 12 }}>
      <legend style={{ padding: '0 8px', color: '#1a2456', fontSize: 13, fontWeight: 600 }}>{title}</legend>
      {children}
    </fieldset>
  )
}

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
const collapseBtn = { padding: '6px 0', fontSize: 13, fontWeight: 600, color: '#1a2456', background: 'transparent', border: 'none', cursor: 'pointer', textAlign: 'left' }
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
