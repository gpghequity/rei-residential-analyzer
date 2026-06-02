import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect } from 'vitest'
import App from '../App.jsx'

// Single-path UI contract: top nav = "Analyze a Deal" + "QA Runner" only. Inside
// Analyze a Deal, ONE guided analyzer per type is the main screen (questions +
// document/photo upload + comps + bible math). The manual scenario tables are an
// OPTIONAL collapsed "Advanced" expander. We ask Income/Expenses, never NOI.
describe('App skeleton — one analyzer path', () => {
  it('renders the title and version', () => {
    render(<App />)
    expect(screen.getByRole('heading', { name: 'REI Baby Analyzer' })).toBeInTheDocument()
    expect(screen.getByText(/Operator-grade pre-LOI deal analysis/i)).toBeInTheDocument()
  })

  it('top nav has ONLY Analyze a Deal + QA Runner (no per-type tabs)', () => {
    render(<App />)
    expect(screen.getByRole('button', { name: 'Analyze a Deal' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'QA Runner' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Storage' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Residential' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Quick Analysis' })).not.toBeInTheDocument()
  })

  it('defaults to the guided screen: questions + document/photo upload', () => {
    render(<App />)
    expect(screen.getByRole('heading', { name: /Property Type/i })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: /Deal Information/i })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: /Upload Documents & Photos/i })).toBeInTheDocument()
    // No Fast/Deep mode toggle anymore.
    expect(screen.queryByRole('button', { name: /FastCalc/i })).not.toBeInTheDocument()
  })

  it('asks Income + Expenses, never NOI, for income types', async () => {
    const user = userEvent.setup()
    render(<App />)
    await user.selectOptions(screen.getByRole('combobox', { name: /property type/i }), 'self_storage')
    expect(screen.getByText(/Gross Annual Income/i)).toBeInTheDocument()
    expect(screen.getByText(/Annual Operating Expenses/i)).toBeInTheDocument()
    // The form must NOT ask the user to type an NOI.
    expect(screen.queryByText(/Net Operating Income/i)).not.toBeInTheDocument()
  })

  it('uses non-overlapping unit bands: 1-4 / 5-19 / 20+', async () => {
    const user = userEvent.setup()
    render(<App />)
    const select = screen.getByRole('combobox', { name: /property type/i })
    expect(screen.getByRole('option', { name: /1–4 units/i })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: /5–19 units/i })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: /20\+ units/i })).toBeInTheDocument()
    // No "1–19" overlapping band.
    expect(screen.queryByRole('option', { name: /1–19/i })).not.toBeInTheDocument()
    await user.selectOptions(select, 'self_storage') // sanity: selection works
  })

  it('exposes the deep underwriter as an optional collapsed Advanced section', () => {
    render(<App />)
    // Default type residential → Advanced manual underwriting is present but collapsed.
    expect(screen.getByText(/Advanced — manual Residential scenario underwriting/i)).toBeInTheDocument()
    // The deep "Residential" heading is inside <details> (collapsed) — not a top tab.
    expect(screen.queryByRole('button', { name: 'Residential' })).not.toBeInTheDocument()
  })

  it('shows the engine status line', () => {
    render(<App />)
    expect(screen.getByText(/Engine status/i)).toBeInTheDocument()
    expect(screen.getByText(/App v0\.9\.2/i)).toBeInTheDocument()
  })

  it('QA Runner tab loads without crashing', async () => {
    const user = userEvent.setup()
    render(<App />)
    await user.click(screen.getByRole('button', { name: 'QA Runner' }))
    expect(screen.getByRole('heading', { name: /Baby Analyzer QA Runner/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Run all QA tests/i })).toBeInTheDocument()
  })

  it('Portfolio checkbox (on the main dropdown) renders the multi-building analyzer', async () => {
    const user = userEvent.setup()
    render(<App />)
    // Type stays the agreed main dropdown; a checkbox turns on portfolio mode.
    await user.click(screen.getByRole('checkbox', { name: /Portfolio — analyze multiple buildings/i }))
    expect(screen.getByRole('heading', { name: /^Portfolio —/i })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: /Portfolio Offer/i })).toBeInTheDocument()
  })

  it('Land / IOS opens its dedicated intake as the main screen', async () => {
    const user = userEvent.setup()
    render(<App />)
    await user.selectOptions(screen.getByRole('combobox', { name: /property type/i }), 'ios_land')
    expect(screen.getByRole('heading', { name: /Land \/ IOS \/ Outdoor Storage/i })).toBeInTheDocument()
  })
})
