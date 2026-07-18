import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect } from 'vitest'
import App from '../App.jsx'
import { VERSION } from '../version.js'

// Public-ready smoke contract for a SINGLE-TYPE specialized analyzer (this repo is
// one fork per asset class — Storage / Commercial / Residential / MHP — each a
// standalone deployed tool). The top nav is "Analyze a Deal" + "QA Runner"; inside
// Analyze a Deal is ONE guided intake (Property Type shown, Deal Information, Rehab,
// Upload) with the deep underwriter in an optional collapsed "Advanced" section.
//
// Fork-agnostic on purpose: it asserts the shared contract + branding sanity, not one
// fork's title/type, so the same file is correct in every specialized fork. (The
// unified multi-type tool with a property-type dropdown is rei-analyzer, tested there.)
describe('App skeleton — single-type analyzer', () => {
  it('renders the product title (REI <asset> Analyzer), not "Baby Analyzer"', () => {
    render(<App />)
    const h1 = screen.getByRole('heading', { level: 1 })
    expect(h1).toHaveTextContent(/REI .+ Analyzer/i)
    // The tool must NOT be branded "Baby Analyzer" anywhere the operator can see it.
    expect(h1).not.toHaveTextContent(/Baby Analyzer/i)
    // Version is surfaced somewhere on the page (subtitle + footer both carry it).
    expect(screen.getAllByText(new RegExp(`v${VERSION.replace(/\./g, '\\.')}`)).length).toBeGreaterThan(0)
  })

  it('top nav has ONLY Analyze a Deal + QA Runner (no per-type tabs)', () => {
    render(<App />)
    expect(screen.getByRole('button', { name: 'Analyze a Deal' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'QA Runner' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Storage' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Residential' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Quick Analysis' })).not.toBeInTheDocument()
  })

  it('defaults to the guided screen: Property Type + Deal Information + Upload', () => {
    render(<App />)
    expect(screen.getByRole('heading', { name: /Property Type/i })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: /Deal Information/i })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: /Upload Documents & Photos/i })).toBeInTheDocument()
    // No Fast/Deep mode toggle.
    expect(screen.queryByRole('button', { name: /FastCalc/i })).not.toBeInTheDocument()
  })

  it('offers the Analyze Deal action and shows the engine status line', () => {
    render(<App />)
    expect(screen.getByRole('button', { name: /Analyze Deal/i })).toBeInTheDocument()
    expect(screen.getByText(/Engine status/i)).toBeInTheDocument()
    expect(screen.getByText(new RegExp(`App v${VERSION.replace(/\./g, '\\.')}`, 'i'))).toBeInTheDocument()
  })

  it('exposes the deep underwriter as an optional collapsed Advanced section', () => {
    render(<App />)
    // Fork-agnostic: the deep tab for THIS fork's type sits in an <details> summary,
    // labelled "Advanced — manual <Type> scenario underwriting (optional)".
    expect(screen.getByText(/Advanced — manual .* scenario underwriting/i)).toBeInTheDocument()
    // It is NOT a top-level tab.
    expect(screen.queryByRole('button', { name: 'Storage' })).not.toBeInTheDocument()
  })

  it('QA Runner tab loads without crashing (and is not branded Baby Analyzer)', async () => {
    const user = userEvent.setup()
    render(<App />)
    await user.click(screen.getByRole('button', { name: 'QA Runner' }))
    expect(screen.getByRole('heading', { name: /QA Runner/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Run all QA tests/i })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: /Baby Analyzer/i })).not.toBeInTheDocument()
  })

  it('renders NO "NaN" and no stray "undefined" in visible text (kicker/flipper fix)', () => {
    const { container } = render(<App />)
    // The kicker + flipper-profit NaN and the "Holding (undefined months × $undefined)"
    // label were live money-panel defects. With the live-Bible constants hydrated they
    // must be gone — the deep underwriter renders inside the (collapsed but mounted)
    // <details>, so this exercises it.
    const text = container.textContent || ''
    expect(text).not.toMatch(/NaN/)
    expect(text).not.toMatch(/undefined months|\$undefined/)
  })
})
