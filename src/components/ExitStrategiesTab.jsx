import { useState } from 'react'
import {
  calcSTR, calcMTR, calcBRRRR, calcCoLiving,
  calcHouseHack, calcLeaseOption, calcCreative
} from '../math/exitStrategies.js'

const EXITS = [
  { id: 'str',   label: 'STR',          sub: 'Short-Term Rental (Airbnb/VRBO)' },
  { id: 'mtr',   label: 'MTR',          sub: 'Med-Term Rental (nurses / corporate)' },
  { id: 'brrrr', label: 'BRRRR',        sub: 'Buy · Rehab · Rent · Refi · Repeat' },
  { id: 'coliving', label: 'Co-Living', sub: 'By-the-room rental' },
  { id: 'househack', label: 'House Hack', sub: '2–4 unit owner-occupant' },
  { id: 'leaseoption', label: 'Lease Option', sub: 'Rent-to-own / H4H' },
  { id: 'creative', label: 'Creative Finance', sub: 'Seller-finance / subject-to' },
]

export default function ExitStrategiesTab() {
  const [exit, setExit] = useState('str')
  const [results, setResults] = useState(null)

  const selectExit = (id) => { setExit(id); setResults(null) }

  return (
    <section style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
      <header>
        <h2 style={{ margin: '0 0 8px', fontSize: 22, fontWeight: 600 }}>Alternative Exit Strategies</h2>
        <p style={{ color: '#5a6a8a', fontSize: 14, lineHeight: 1.6, margin: 0 }}>
          Seven exit models beyond the standard flip/LTR. Select a strategy, enter your numbers, get the key metrics.
          All math is additive — no existing Residential Analyzer formulas are modified.
        </p>
      </header>

      {/* Strategy picker */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
        {EXITS.map(e => (
          <button
            key={e.id}
            type="button"
            onClick={() => selectExit(e.id)}
            style={{
              padding: '10px 16px',
              border: exit === e.id ? '2px solid #c9a84c' : '2px solid #d4dae8',
              borderRadius: 8,
              backgroundColor: exit === e.id ? '#1a2456' : '#fff',
              color: exit === e.id ? '#f0d080' : '#1a2456',
              fontWeight: exit === e.id ? 700 : 400,
              fontSize: 13,
              cursor: 'pointer',
              textAlign: 'left',
              minWidth: 130
            }}
          >
            <div style={{ fontWeight: 700 }}>{e.label}</div>
            <div style={{ fontSize: 11, opacity: 0.8, marginTop: 2 }}>{e.sub}</div>
          </button>
        ))}
      </div>

      {/* Active form */}
      {exit === 'str'         && <STRForm         onResult={setResults} />}
      {exit === 'mtr'         && <MTRForm         onResult={setResults} />}
      {exit === 'brrrr'       && <BRRRRForm       onResult={setResults} />}
      {exit === 'coliving'    && <CoLivingForm    onResult={setResults} />}
      {exit === 'househack'   && <HouseHackForm   onResult={setResults} />}
      {exit === 'leaseoption' && <LeaseOptionForm onResult={setResults} />}
      {exit === 'creative'    && <CreativeForm    onResult={setResults} />}

      {/* Results */}
      {results && results.error && <ErrorBox msg={results.error} />}
      {results && !results.error && (
        <div className="results-section">
          {results.strategy === 'STR'         && <STRResults r={results} />}
          {results.strategy === 'MTR'         && <MTRResults r={results} />}
          {results.strategy === 'BRRRR'       && <BRRRRResults r={results} />}
          {results.strategy === 'CoLiving'    && <CoLivingResults r={results} />}
          {results.strategy === 'HouseHack'   && <HouseHackResults r={results} />}
          {results.strategy === 'LeaseOption' && <LeaseOptionResults r={results} />}
          {results.strategy === 'Creative'    && <CreativeResults r={results} />}
        </div>
      )}
    </section>
  )
}

// ════════════════════════════════════════ FORMS ════════════════════════════════════════

function STRForm({ onResult }) {
  const [f, setF] = useState({ nightlyRate: '', occupancyPct: '', avgStayNights: '3', cleaningFee: '85', platformFeePct: '3', annualOpex: '', allInPrice: '' })
  const u = (k, v) => setF(p => ({ ...p, [k]: v }))

  const calc = () => {
    const rate = parseFloat(f.nightlyRate) || 0
    const occ = parseFloat(f.occupancyPct) || 0
    if (rate <= 0) return onResult({ error: 'Nightly rate is required.' })
    if (occ <= 0 || occ > 1) return onResult({ error: 'Occupancy must be between 0 and 1 (e.g. 0.65 for 65%).' })
    onResult(calcSTR({
      nightlyRate: rate, occupancyPct: occ,
      avgStayNights: parseFloat(f.avgStayNights) || 3,
      cleaningFee: parseFloat(f.cleaningFee) || 85,
      platformFeePct: parseFloat(f.platformFeePct) / 100 || 0.03,
      annualOpex: parseFloat(f.annualOpex) || 0,
      allInPrice: parseFloat(f.allInPrice) || 0
    }))
  }

  return (
    <FormShell title="Short-Term Rental (Airbnb / VRBO)" onCalc={calc}>
      <FG label="Avg nightly rate ($) *"><Inp value={f.nightlyRate} on={v => u('nightlyRate', v)} ph="185" /></FG>
      <FG label="Occupancy rate (0–1) *" hint="e.g. 0.65 = 65% occupancy. Lancaster area STR avg: 0.55–0.72"><Inp value={f.occupancyPct} on={v => u('occupancyPct', v)} ph="0.65" /></FG>
      <FG label="Avg stay length (nights)" hint="Default 3 nights. Longer = fewer turns, lower cleaning cost."><Inp value={f.avgStayNights} on={v => u('avgStayNights', v)} ph="3" /></FG>
      <FG label="Cleaning fee per turn ($)" hint="What you pay your cleaner each turnover. Default $85."><Inp value={f.cleaningFee} on={v => u('cleaningFee', v)} ph="85" /></FG>
      <FG label="Platform fee (%)" hint="Airbnb host fee is ~3%. VRBO: ~5%."><Inp value={f.platformFeePct} on={v => u('platformFeePct', v)} ph="3" /></FG>
      <FG label="Annual operating expenses ($)" hint="Taxes + insurance + utilities (STR pays utilities) + mgmt if any."><Inp value={f.annualOpex} on={v => u('annualOpex', v)} ph="12000" /></FG>
      <FG label="All-in price ($, optional)" hint="Purchase + rehab. Used for cap rate + GRM."><Inp value={f.allInPrice} on={v => u('allInPrice', v)} ph="200000" /></FG>
    </FormShell>
  )
}

function MTRForm({ onResult }) {
  const [f, setF] = useState({ monthlyRate: '', occupancyPct: '', ltrComparison: '', furnishingCost: '', annualOpex: '', allInPrice: '' })
  const u = (k, v) => setF(p => ({ ...p, [k]: v }))

  const calc = () => {
    const rate = parseFloat(f.monthlyRate) || 0
    const occ = parseFloat(f.occupancyPct) || 0
    if (rate <= 0) return onResult({ error: 'Monthly rate is required.' })
    if (occ <= 0 || occ > 1) return onResult({ error: 'Occupancy must be between 0 and 1 (e.g. 0.90 for 90%).' })
    onResult(calcMTR({
      monthlyRate: rate, occupancyPct: occ,
      ltrComparison: parseFloat(f.ltrComparison) || 0,
      furnishingCost: parseFloat(f.furnishingCost) || 0,
      annualOpex: parseFloat(f.annualOpex) || 0,
      allInPrice: parseFloat(f.allInPrice) || 0
    }))
  }

  return (
    <FormShell title="Medium-Term Rental — Nurses / Corporate (30–90 day)" onCalc={calc}>
      <FG label="Monthly furnished rate ($) *" hint="Travel nurses: typically 2–3× local LTR. Lancaster LGH area: $2,400–$3,800/mo for 1–3 BR."><Inp value={f.monthlyRate} on={v => u('monthlyRate', v)} ph="2800" /></FG>
      <FG label="Occupancy rate (0–1) *" hint="Travel nurse MTR typically 0.88–0.93. Include gap weeks between contracts."><Inp value={f.occupancyPct} on={v => u('occupancyPct', v)} ph="0.90" /></FG>
      <FG label="LTR comparison (unfurnished monthly, $)" hint="Your market's standard unfurnished rate. Used to calculate premium."><Inp value={f.ltrComparison} on={v => u('ltrComparison', v)} ph="1400" /></FG>
      <FG label="Furnishing setup cost ($)" hint="One-time cost to furnish. Calculates payback via premium."><Inp value={f.furnishingCost} on={v => u('furnishingCost', v)} ph="8000" /></FG>
      <FG label="Annual operating expenses ($)" hint="Taxes + insurance + utilities (MTR typically tenant-pays utilities) + mgmt."><Inp value={f.annualOpex} on={v => u('annualOpex', v)} ph="10000" /></FG>
      <FG label="All-in price ($, optional)" hint="Purchase + rehab. Used for cap rate."><Inp value={f.allInPrice} on={v => u('allInPrice', v)} ph="175000" /></FG>
    </FormShell>
  )
}

function BRRRRForm({ onResult }) {
  const [f, setF] = useState({ purchasePrice: '', rehabCost: '', closingCostsBuy: '', monthlyRent: '', expenseRatioPct: '40', arv: '', ltvPct: '75', refiRate: '7.5', refiTermYears: '30' })
  const u = (k, v) => setF(p => ({ ...p, [k]: v }))

  const calc = () => {
    const price = parseFloat(f.purchasePrice) || 0
    const arv = parseFloat(f.arv) || 0
    if (price <= 0) return onResult({ error: 'Purchase price is required.' })
    if (arv <= 0) return onResult({ error: 'ARV is required for the refinance calculation.' })
    onResult(calcBRRRR({
      purchasePrice: price,
      rehabCost: parseFloat(f.rehabCost) || 0,
      closingCostsBuy: f.closingCostsBuy !== '' ? parseFloat(f.closingCostsBuy) : null,
      monthlyRent: parseFloat(f.monthlyRent) || 0,
      expenseRatioPct: parseFloat(f.expenseRatioPct) / 100 || 0.40,
      arv,
      ltvPct: parseFloat(f.ltvPct) / 100 || 0.75,
      refiRate: parseFloat(f.refiRate) / 100 || 0.075,
      refiTermYears: parseFloat(f.refiTermYears) || 30
    }))
  }

  return (
    <FormShell title="BRRRR — Buy · Rehab · Rent · Refinance · Repeat" onCalc={calc}>
      <FG label="Purchase price ($) *"><Inp value={f.purchasePrice} on={v => u('purchasePrice', v)} ph="95000" /></FG>
      <FG label="Rehab cost ($)"><Inp value={f.rehabCost} on={v => u('rehabCost', v)} ph="45000" /></FG>
      <FG label="Buy-side closing costs ($)" hint="Leave blank for 3% default."><Inp value={f.closingCostsBuy} on={v => u('closingCostsBuy', v)} ph="auto 3%" /></FG>
      <FG label="Stabilized monthly rent ($)"><Inp value={f.monthlyRent} on={v => u('monthlyRent', v)} ph="1650" /></FG>
      <FG label="Expense ratio (%)" hint="All expenses as % of gross rent. Standard: 40%. Duplexes/triplexes: 45%."><Inp value={f.expenseRatioPct} on={v => u('expenseRatioPct', v)} ph="40" /></FG>
      <FG label="ARV (after-repair value, $) *" hint="Basis for the refinance amount."><Inp value={f.arv} on={v => u('arv', v)} ph="190000" /></FG>
      <FG label="Refinance LTV (%)" hint="DSCR/conventional refi typically 70–75%. Portfolio lender: up to 80%."><Inp value={f.ltvPct} on={v => u('ltvPct', v)} ph="75" /></FG>
      <FG label="Refinance rate (%)"><Inp value={f.refiRate} on={v => u('refiRate', v)} ph="7.5" /></FG>
      <FG label="Amortization (years)"><Inp value={f.refiTermYears} on={v => u('refiTermYears', v)} ph="30" /></FG>
    </FormShell>
  )
}

function CoLivingForm({ onResult }) {
  const [f, setF] = useState({ bedrooms: '', perRoomRent: '', occupancyPct: '', wholeHouseLtr: '', annualOpex: '', allInPrice: '' })
  const u = (k, v) => setF(p => ({ ...p, [k]: v }))

  const calc = () => {
    const bds = parseInt(f.bedrooms) || 0
    const rent = parseFloat(f.perRoomRent) || 0
    const occ = parseFloat(f.occupancyPct) || 0
    if (bds <= 0) return onResult({ error: 'Number of bedrooms is required.' })
    if (rent <= 0) return onResult({ error: 'Per-room rent is required.' })
    if (occ <= 0 || occ > 1) return onResult({ error: 'Occupancy must be between 0 and 1.' })
    onResult(calcCoLiving({
      bedrooms: bds, perRoomRent: rent, occupancyPct: occ,
      wholeHouseLtr: parseFloat(f.wholeHouseLtr) || 0,
      annualOpex: parseFloat(f.annualOpex) || 0,
      allInPrice: parseFloat(f.allInPrice) || 0
    }))
  }

  return (
    <FormShell title="Co-Living — By-the-Room" onCalc={calc}>
      <FG label="Rentable bedrooms *" hint="Don't include owner's room if owner-occ."><Inp value={f.bedrooms} on={v => u('bedrooms', v)} ph="4" /></FG>
      <FG label="Monthly rent per room ($) *" hint="Lancaster workforce housing: $600–$900/room near LGH, HACC."><Inp value={f.perRoomRent} on={v => u('perRoomRent', v)} ph="750" /></FG>
      <FG label="Occupancy (0–1) *" hint="Co-living typically 0.90–0.95. Rooms turn faster than whole units."><Inp value={f.occupancyPct} on={v => u('occupancyPct', v)} ph="0.92" /></FG>
      <FG label="Whole-house LTR rate ($/mo)" hint="What you'd get renting the whole property unfurnished. Used to calculate premium."><Inp value={f.wholeHouseLtr} on={v => u('wholeHouseLtr', v)} ph="1600" /></FG>
      <FG label="Annual operating expenses ($)"><Inp value={f.annualOpex} on={v => u('annualOpex', v)} ph="11000" /></FG>
      <FG label="All-in price ($, optional)"><Inp value={f.allInPrice} on={v => u('allInPrice', v)} ph="180000" /></FG>
    </FormShell>
  )
}

function HouseHackForm({ onResult }) {
  const [f, setF] = useState({ purchasePrice: '', units: '2', rent1: '', rent2: '', rent3: '', monthlyPiti: '', marketRentOwner: '' })
  const u = (k, v) => setF(p => ({ ...p, [k]: v }))
  const units = parseInt(f.units) || 2

  const calc = () => {
    const price = parseFloat(f.purchasePrice) || 0
    const piti = parseFloat(f.monthlyPiti) || 0
    if (price <= 0) return onResult({ error: 'Purchase price is required.' })
    if (piti <= 0) return onResult({ error: 'Monthly PITI is required.' })
    const rentArr = [f.rent1, f.rent2, f.rent3].slice(0, units - 1).map(r => parseFloat(r) || 0)
    onResult(calcHouseHack({
      purchasePrice: price, units, unitRents: rentArr,
      monthlyPiti: piti, marketRentOwner: parseFloat(f.marketRentOwner) || 0
    }))
  }

  return (
    <FormShell title="House Hack — Live Free While Tenants Pay Your Mortgage" onCalc={calc}>
      <FG label="Purchase price ($) *"><Inp value={f.purchasePrice} on={v => u('purchasePrice', v)} ph="240000" /></FG>
      <FG label="Number of units *" hint="2–4 unit residential only.">
        <select value={f.units} onChange={e => u('units', e.target.value)} style={inputStyle}>
          <option value="2">Duplex (2 units)</option>
          <option value="3">Triplex (3 units)</option>
          <option value="4">Quadplex (4 units)</option>
        </select>
      </FG>
      <FG label="Monthly PITI ($) *" hint="Your principal + interest + taxes + insurance payment."><Inp value={f.monthlyPiti} on={v => u('monthlyPiti', v)} ph="1650" /></FG>
      {units >= 2 && <FG label="Tenant unit 1 monthly rent ($)"><Inp value={f.rent1} on={v => u('rent1', v)} ph="1100" /></FG>}
      {units >= 3 && <FG label="Tenant unit 2 monthly rent ($)"><Inp value={f.rent2} on={v => u('rent2', v)} ph="1050" /></FG>}
      {units >= 4 && <FG label="Tenant unit 3 monthly rent ($)"><Inp value={f.rent3} on={v => u('rent3', v)} ph="1000" /></FG>}
      <FG label="Market rent if you were renting ($)" hint="What you'd pay to rent a similar place. Used to calculate savings."><Inp value={f.marketRentOwner} on={v => u('marketRentOwner', v)} ph="1300" /></FG>
    </FormShell>
  )
}

function LeaseOptionForm({ onResult }) {
  const [f, setF] = useState({ allInPrice: '', optionPrice: '', optionFee: '', monthlyRent: '', rentCreditPct: '15', optionTermMonths: '36', monthlyOpex: '' })
  const u = (k, v) => setF(p => ({ ...p, [k]: v }))

  const calc = () => {
    const price = parseFloat(f.allInPrice) || 0
    const optPrice = parseFloat(f.optionPrice) || 0
    const fee = parseFloat(f.optionFee) || 0
    const rent = parseFloat(f.monthlyRent) || 0
    if (price <= 0 || optPrice <= 0 || rent <= 0) return onResult({ error: 'All-in price, option price, and monthly rent are required.' })
    onResult(calcLeaseOption({
      allInPrice: price, optionPrice: optPrice, optionFee: fee,
      monthlyRent: rent, rentCreditPct: parseFloat(f.rentCreditPct) / 100 || 0.15,
      optionTermMonths: parseFloat(f.optionTermMonths) || 36,
      monthlyOpex: parseFloat(f.monthlyOpex) || 0
    }))
  }

  return (
    <FormShell title="Lease Option / Rent-to-Own (H4H Model)" onCalc={calc}>
      <FG label="Your all-in price ($) *" hint="Purchase + rehab. Your basis."><Inp value={f.allInPrice} on={v => u('allInPrice', v)} ph="130000" /></FG>
      <FG label="Option price ($) *" hint="The price the tenant-buyer has the right to purchase at. Typically ARV or above."><Inp value={f.optionPrice} on={v => u('optionPrice', v)} ph="175000" /></FG>
      <FG label="Option fee (non-refundable, $)" hint="Upfront consideration. Keeps if they don't buy. H4H range: $2k–$10k."><Inp value={f.optionFee} on={v => u('optionFee', v)} ph="5000" /></FG>
      <FG label="Monthly rent ($) *"><Inp value={f.monthlyRent} on={v => u('monthlyRent', v)} ph="1400" /></FG>
      <FG label="Rent credit (%)" hint="Portion of monthly rent that credits toward the option price. Default 15%."><Inp value={f.rentCreditPct} on={v => u('rentCreditPct', v)} ph="15" /></FG>
      <FG label="Option term (months)" hint="Typical H4H: 24–60 months."><Inp value={f.optionTermMonths} on={v => u('optionTermMonths', v)} ph="36" /></FG>
      <FG label="Your monthly expenses ($)" hint="Taxes + insurance. Only fill if YOU pay these — many L/O have tenant pay all."><Inp value={f.monthlyOpex} on={v => u('monthlyOpex', v)} ph="350" /></FG>
    </FormShell>
  )
}

function CreativeForm({ onResult }) {
  const [f, setF] = useState({ purchasePrice: '', downPmt: '', interestRate: '', termYears: '30', monthlyRent: '', annualOpex: '', balloonYears: '', exitArv: '' })
  const u = (k, v) => setF(p => ({ ...p, [k]: v }))

  const calc = () => {
    const price = parseFloat(f.purchasePrice) || 0
    const down = parseFloat(f.downPmt) || 0
    const rate = parseFloat(f.interestRate) || 0
    if (price <= 0 || down <= 0) return onResult({ error: 'Purchase price and down payment are required.' })
    if (rate <= 0) return onResult({ error: 'Interest rate is required (0 for interest-free deals).' })
    onResult(calcCreative({
      purchasePrice: price, downPmt: down,
      interestRate: parseFloat(f.interestRate) / 100 || 0,
      termYears: parseFloat(f.termYears) || 30,
      monthlyRent: parseFloat(f.monthlyRent) || 0,
      annualOpex: parseFloat(f.annualOpex) || 0,
      balloonYears: parseFloat(f.balloonYears) || 0,
      exitArv: parseFloat(f.exitArv) || 0
    }))
  }

  return (
    <FormShell title="Creative Finance — Seller-Finance / Subject-To / Terms Deal" onCalc={calc}>
      <FG label="Purchase price ($) *"><Inp value={f.purchasePrice} on={v => u('purchasePrice', v)} ph="150000" /></FG>
      <FG label="Down payment ($) *" hint="For subject-to: 0 down. For seller-finance: negotiated with seller."><Inp value={f.downPmt} on={v => u('downPmt', v)} ph="15000" /></FG>
      <FG label="Interest rate (%) *" hint="Rate seller charges you. Often 5–8%. Subject-to: existing note rate."><Inp value={f.interestRate} on={v => u('interestRate', v)} ph="6.5" /></FG>
      <FG label="Amortization (years)"><Inp value={f.termYears} on={v => u('termYears', v)} ph="30" /></FG>
      <FG label="Monthly rent (if holding, $)" hint="Leave blank if flipping immediately."><Inp value={f.monthlyRent} on={v => u('monthlyRent', v)} ph="1500" /></FG>
      <FG label="Annual operating expenses ($)" hint="Taxes, insurance, maintenance, mgmt."><Inp value={f.annualOpex} on={v => u('annualOpex', v)} ph="8000" /></FG>
      <FG label="Balloon term (years, if any)" hint="If there's a balloon payment — when it's due."><Inp value={f.balloonYears} on={v => u('balloonYears', v)} ph="5" /></FG>
      <FG label="Exit ARV ($)" hint="Expected value at balloon/sale. Used for equity calc."><Inp value={f.exitArv} on={v => u('exitArv', v)} ph="190000" /></FG>
    </FormShell>
  )
}

// ════════════════════════════════════════ RESULTS ════════════════════════════════════════

function STRResults({ r }) {
  const warn = r.noi <= 0
  return (
    <ResultsShell strategy="STR — Short-Term Rental" warn={warn} warnMsg="NOI is negative at these inputs.">
      <Card title="Revenue">
        <Row label="Occupied nights/year" value={`${r.occupiedNights} nights`} />
        <Row label="Gross revenue" value={fm(r.grossRevenue)} bold />
        <Row label="− Platform fees" value={fm(-r.platformFees)} accent="Airbnb host fee" />
        <Row label={`− Cleaning (${r.turns} turns)`} value={fm(-r.cleaningCosts)} />
        <Row label="Effective net revenue" value={fm(r.effectiveRevenue)} bold />
      </Card>
      <Card title="NOI &amp; Returns">
        <Row label="− OpEx" value={fm(-r.annualOpex || 0)} />
        <Row label="Net Operating Income" value={fm(r.noi)} bold accentColor={warn ? '#7a0000' : '#0d5e2c'} accent={warn ? 'NEGATIVE' : 'positive'} />
        <Row label="Monthly net income" value={fm(r.monthlyNetIncome)} />
        <Row label="RevPAR (revenue/available night)" value={`$${r.revpar.toFixed(2)}`} accent="Higher = stronger STR performance" />
        {r.capRate != null && <Row label="Cap rate" value={fp(r.capRate)} bold accent="Based on all-in price" />}
        {r.grm != null && <Row label="Gross rent multiplier" value={r.grm.toFixed(2)} accent="Annual. Under 8 is strong." />}
      </Card>
      <Disclaimer text="STR income is variable and regulation-sensitive. Verify short-term rental ordinances in your municipality before closing." />
    </ResultsShell>
  )
}

function MTRResults({ r }) {
  const warn = r.noi <= 0
  return (
    <ResultsShell strategy="MTR — Medium-Term Rental (Nurses / Corporate)" warn={warn} warnMsg="NOI is negative at these inputs.">
      <Card title="Revenue">
        <Row label="Gross annual revenue" value={fm(r.grossAnnual)} bold />
        <Row label="Monthly net income" value={fm(r.monthlyNetIncome)} bold accentColor={warn ? '#7a0000' : '#0d5e2c'} />
        {r.premiumVsLtr != null && (
          <>
            <Row label="Premium vs. LTR (monthly)" value={fm(r.premiumVsLtr)} accent={r.premiumVsLtr > 0 ? 'positive premium' : 'below LTR — check assumptions'} accentColor={r.premiumVsLtr > 0 ? '#0d5e2c' : '#7a0000'} />
            <Row label="Premium %" value={fp(r.premiumPct)} />
          </>
        )}
        {r.furnishingPayback != null && <Row label="Furnishing payback" value={`${r.furnishingPayback.toFixed(1)} years`} accent="Via premium over LTR" />}
      </Card>
      {r.capRate != null && (
        <Card title="Returns">
          <Row label="NOI" value={fm(r.noi)} bold />
          <Row label="Cap rate" value={fp(r.capRate)} bold />
        </Card>
      )}
      <Disclaimer text="MTR income depends on local travel healthcare demand. Lancaster General Hospital / Penn Medicine health system drives strong nurse-travel demand in Lancaster County." />
    </ResultsShell>
  )
}

function BRRRRResults({ r }) {
  const win = r.brrrrWorks
  return (
    <ResultsShell strategy="BRRRR" warn={!r.ok} warnMsg="Check ARV and rent inputs.">
      <Card title="All-In Cost">
        <Row label="Purchase" value={fm(r.purchase)} />
        <Row label="Rehab" value={fm(r.rehab)} />
        <Row label="Closing costs" value={fm(r.closing)} />
        <Row label="Total all-in" value={fm(r.allIn)} bold />
        <Row label="ARV" value={fm(r.arv)} />
        <Row label="Equity created" value={fm(r.equityCreated)} bold accentColor={r.equityCreated > 0 ? '#0d5e2c' : '#7a0000'} accent="ARV − all-in" />
      </Card>
      <Card title="Refinance">
        <Row label={`Refi loan (${fp(r.ltvPct || 0.75)} LTV)`} value={fm(r.refiLoan)} />
        <Row label="Monthly P&I" value={fm(r.refiMonthlyPI)} />
        <Row label="Annual debt service" value={fm(r.refiAnnualDS)} />
        <Row label="Cash pulled out" value={fm(r.cashPulledOut)} bold accent="Refi loan − (purchase + closing)" />
        <Row label="Cash left in" value={fm(r.cashLeftIn)} bold accentColor={win ? '#0d5e2c' : '#5a6a8a'} accent={win ? '≤ 0 — full capital recycled (infinite return)' : 'Capital still deployed in this deal'} />
        <Row label="Capital recycled" value={fp(r.recycleEfficiency)} accent="Refi / all-in. 1.0 = full recycle" />
      </Card>
      <Card title="Cash Flow After Refi">
        <Row label="NOI" value={fm(r.noi)} />
        <Row label="− Annual debt service" value={fm(-r.refiAnnualDS)} />
        <Row label="Annual cash flow" value={fm(r.annualCashFlow)} bold accentColor={r.annualCashFlow >= 0 ? '#0d5e2c' : '#7a0000'} />
        {r.dscr != null && <Row label="DSCR" value={r.dscr.toFixed(2)} accent={r.dscr >= 1.25 ? '≥ 1.25 — lender-qualifying' : '< 1.25 — below standard DSCR floor'} accentColor={r.dscr >= 1.25 ? '#0d5e2c' : '#7a0000'} />}
        {r.cashOnCash != null && <Row label="Cash-on-cash (on cash left in)" value={fp(r.cashOnCash)} bold />}
      </Card>
      <Disclaimer text="BRRRR requires a lender willing to refinance after rehab. Confirm refinance availability before committing to this exit. DSCR lenders typically want 1.0+ at minimum, 1.25 preferred." />
    </ResultsShell>
  )
}

function CoLivingResults({ r }) {
  const warn = r.noi <= 0
  return (
    <ResultsShell strategy="Co-Living — By the Room" warn={warn} warnMsg="NOI is negative at these inputs.">
      <Card title="Revenue">
        <Row label={`${r.bedrooms} rooms × effective monthly`} value={fm(r.effectiveMonthlyPerRoom)} accent="per room (rate × occupancy)" />
        <Row label="Gross annual revenue" value={fm(r.grossAnnual)} bold />
        <Row label="NOI" value={fm(r.noi)} bold accentColor={warn ? '#7a0000' : '#0d5e2c'} />
        <Row label="Monthly net" value={fm(r.monthlyNetIncome)} />
      </Card>
      {(r.vsLtrAnnual != null || r.capRate != null) && (
        <Card title="vs. Traditional LTR">
          {r.vsLtrAnnual != null && <Row label="Annual premium vs. whole-house LTR" value={fm(r.vsLtrAnnual)} bold accentColor={r.vsLtrAnnual > 0 ? '#0d5e2c' : '#7a0000'} />}
          {r.premiumPct != null && <Row label="Premium %" value={fp(r.premiumPct)} accent="Room rev vs. whole-house LTR" />}
          {r.capRate != null && <Row label="Cap rate" value={fp(r.capRate)} bold />}
        </Card>
      )}
      <Disclaimer text="Co-living requires more management than single-tenant occupancy. Budget for faster turnover and shared-space upkeep. Fair housing rules apply per-room as they do per-unit." />
    </ResultsShell>
  )
}

function HouseHackResults({ r }) {
  const free = r.freeLiving
  return (
    <ResultsShell strategy="House Hack" warn={false}>
      <Card title="Monthly Economics">
        <Row label="Rental income from tenants" value={fm(r.rentalIncomeMo)} bold accent={`${r.units - 1} tenant unit(s)`} />
        <Row label="Your effective monthly cost" value={fm(r.effectiveMonthlyCost)} bold accentColor={free ? '#0d5e2c' : '#5a6a8a'} accent={free ? 'TENANTS COVER YOUR PITI — you live free' : 'Net cost after tenant income'} />
        <Row label="Tenants cover" value={fp(r.tenantCoversPct)} accent="% of your PITI covered" accentColor={r.tenantCoversPct >= 1 ? '#0d5e2c' : '#5a6a8a'} />
        {r.annualSavingsVsRenting != null && (
          <Row label="Annual savings vs. renting elsewhere" value={fm(r.annualSavingsVsRenting)} bold accentColor={r.annualSavingsVsRenting > 0 ? '#0d5e2c' : '#7a0000'} />
        )}
      </Card>
      <Card title="Annual Summary">
        <Row label="Rental income/year" value={fm(r.rentalIncomeAnn)} />
        <Row label="Effective annual housing cost" value={fm(r.effectiveMonthlyCost * 12)} />
      </Card>
      <Disclaimer text="House-hacking is owner-occupant financing (FHA 3.5%, conventional 5% down, USDA 0% in eligible areas). Verify the property qualifies as owner-occupied with your lender." />
    </ResultsShell>
  )
}

function LeaseOptionResults({ r }) {
  return (
    <ResultsShell strategy="Lease Option / Rent-to-Own" warn={false}>
      <Card title="During the Option Term">
        <Row label="Option fee (upfront)" value={fm(r.optionFee)} bold />
        <Row label="Monthly net cash flow" value={fm(r.cashFlowMonthly)} bold accent="Rent − rent credits − your expenses" />
        <Row label="Total rent collected" value={fm(r.totalRentCollected)} />
        <Row label="Total rent credits given" value={fm(-r.totalRentCredits)} />
        <Row label="Total net cash flow (term)" value={fm(r.totalCashFlow)} />
      </Card>
      <Card title="Scenario A: Tenant-Buyer Exercises Option">
        <Row label="Effective sale proceeds" value={fm(r.saleProceeds)} accent="Option price − rent credits" />
        <Row label="Total return (fee + flow + sale spread)" value={fm(r.totalReturnIfExercised)} bold accentColor={r.totalReturnIfExercised > 0 ? '#0d5e2c' : '#7a0000'} />
        {r.roiIfExercised != null && <Row label="ROI on all-in" value={fp(r.roiIfExercised)} bold />}
        {r.effectiveYieldIfExercised != null && <Row label="Annualized yield" value={fp(r.effectiveYieldIfExercised)} />}
      </Card>
      <Card title="Scenario B: Tenant-Buyer Does NOT Exercise (keep, re-list)">
        <Row label="Total return (fee + cash flow)" value={fm(r.totalReturnIfNot)} bold accentColor={r.totalReturnIfNot > 0 ? '#0d5e2c' : '#7a0000'} />
        {r.roiIfNot != null && <Row label="ROI on all-in" value={fp(r.roiIfNot)} />}
        <Row label="Then:" value="Re-list or offer new option" accent="Property still owned, equity intact" />
      </Card>
      <Disclaimer text="Lease-option documentation requires an attorney in PA. Option fee amount and rent-credit structure affect enforceability. Good People Good Homes uses a separate program-specific agreement — consult your attorney before any H4H transaction." />
    </ResultsShell>
  )
}

function CreativeResults({ r }) {
  const cashFlowPos = r.annualCashFlow >= 0
  return (
    <ResultsShell strategy="Creative Finance — Seller-Finance / Subject-To" warn={!r.ok}>
      <Card title="Loan Structure">
        <Row label="Purchase price" value={fm(r.purchasePrice)} />
        <Row label="Down payment" value={fm(r.down)} />
        <Row label="Loan amount" value={fm(r.loan)} bold />
        <Row label="Monthly P&I" value={fm(r.monthlyPI)} bold />
        <Row label="Annual debt service" value={fm(r.annualDS)} />
        {r.equityAtPurchase != null && r.equityAtPurchase > 0 && (
          <Row label="Equity at purchase (ARV − price)" value={fm(r.equityAtPurchase)} bold accent="Instant equity on acquisition" accentColor="#0d5e2c" />
        )}
      </Card>
      {r.grossAnnual > 0 && (
        <Card title="Hold as Rental">
          <Row label="Gross annual rent" value={fm(r.grossAnnual)} />
          <Row label="NOI" value={fm(r.noi)} />
          <Row label="Annual cash flow" value={fm(r.annualCashFlow)} bold accentColor={cashFlowPos ? '#0d5e2c' : '#7a0000'} accent={cashFlowPos ? 'positive' : 'negative'} />
          {r.dscr != null && <Row label="DSCR" value={r.dscr.toFixed(2)} accentColor={r.dscr >= 1.0 ? '#0d5e2c' : '#7a0000'} accent={r.dscr >= 1.0 ? 'covers debt' : 'does not cover debt'} />}
          {r.cashOnCash != null && <Row label="Cash-on-cash" value={fp(r.cashOnCash)} bold />}
        </Card>
      )}
      {r.balloonBalance != null && (
        <Card title="Balloon Event">
          <Row label="Balloon balance" value={fm(r.balloonBalance)} />
          {r.balloonEquity != null && <Row label="Equity at balloon (ARV − balance)" value={fm(r.balloonEquity)} bold accentColor={r.balloonEquity > 0 ? '#0d5e2c' : '#7a0000'} />}
        </Card>
      )}
      <Disclaimer text="Creative finance terms vary widely. Seller-finance requires a licensed mortgage originator in PA for installment sales over 3 transactions/year. Subject-to carries due-on-sale risk. Consult your attorney before executing." />
    </ResultsShell>
  )
}

// ════════════════════════════════════════ SHARED UI ════════════════════════════════════════

function FormShell({ title, children, onCalc }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <h3 style={{ margin: 0, fontSize: 16, fontWeight: 600, color: '#1a2456', borderBottom: '2px solid #c9a84c', paddingBottom: 8 }}>{title}</h3>
      {children}
      <button type="button" onClick={onCalc} style={btnStyle}>Calculate</button>
    </div>
  )
}

function ResultsShell({ strategy, warn, warnMsg, children }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16, paddingTop: 16, borderTop: '2px solid #1a2456' }}>
      <h3 style={{ margin: 0, fontSize: 18, fontWeight: 700, color: '#1a2456' }}>{strategy} — Results</h3>
      {warn && warnMsg && <ErrorBox msg={warnMsg} />}
      {children}
    </div>
  )
}

function Disclaimer({ text }) {
  return (
    <div style={{ fontSize: 12, fontStyle: 'italic', color: '#8a96b0', padding: '10px 14px', backgroundColor: '#f8f9fc', border: '1px solid #e4e8f0', borderRadius: 6 }}>
      {text}
    </div>
  )
}

function FG({ label, hint, children }) {
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <span style={{ fontSize: 13, fontWeight: 600, color: '#1a2456' }}>{label}</span>
      {children}
      {hint && <span style={{ fontSize: 12, color: '#8a96b0', fontStyle: 'italic' }}>{hint}</span>}
    </label>
  )
}

function Inp({ value, on, ph }) {
  return <input type="number" value={value} onChange={e => on(e.target.value)} placeholder={ph} style={inputStyle} />
}

function Card({ title, children }) {
  return (
    <div style={{ border: '1px solid #d4dae8', borderRadius: 6, backgroundColor: '#fff', padding: 16 }}>
      <h3 style={{ margin: '0 0 12px', fontSize: 15, fontWeight: 600, color: '#1a2456' }}>{title}</h3>
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

function ErrorBox({ msg }) {
  return <div style={{ padding: 12, border: '1px solid #d04040', borderRadius: 6, backgroundColor: '#fde2e2', color: '#7a0000', fontSize: 13 }}>{msg}</div>
}

const inputStyle = { padding: '8px 10px', fontSize: 14, border: '1px solid #c8d0e0', borderRadius: 4, fontFamily: 'inherit', color: '#1a2456', backgroundColor: '#fff' }
const btnStyle = { padding: '12px 24px', fontSize: 15, fontWeight: 600, color: '#fff', backgroundColor: '#1a2456', border: 'none', borderRadius: 6, cursor: 'pointer', alignSelf: 'flex-start' }

function fm(n) {
  if (n === null || n === undefined || !Number.isFinite(n)) return '—'
  const sign = n < 0 ? '-' : ''
  return `${sign}$${Math.abs(n).toLocaleString('en-US', { maximumFractionDigits: 0 })}`
}
function fp(n) {
  if (n === null || n === undefined || !Number.isFinite(n)) return '—'
  return `${(n * 100).toFixed(1)}%`
}
