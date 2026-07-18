# Commercial / NNN Module — V1 Brief

**Source:** Originally authored for `rei-fast-calc` (Commercial/NNN tab — the only authorized future change to the locked Fast Calc repo). Captured in this Baby Analyzer repo on 2026-05-08 because the same spec drives Baby Analyzer's Commercial tab and any future Deal Analyzer Commercial module.

**Isolation note:** Per the platform's bulletproof-modularity rule, this brief is a *spec contract*, not shared code. Each tool that implements it ports the math + UI into its own repo independently. No cross-repo imports.

**Status in this repo:** scaffolded only (placeholder tab in v0.0.1). Implementation lands in a future commit, with provenance comments showing the snapshot date and source.

---

## PRE-BUILD DECISIONS — CONFIRMED

| # | Decision | Answer |
|---|----------|--------|
| 1 | V1 = current contract rent only | **YES** — no rent steps, no free rent burn-off, no per-tenant TI amortization |
| 2 | TI/LC and capex reserves as single $/SF in V1 | **YES** — per-tenant detail in V2 |
| 3 | Rent roll table component | **FRESH BUILD** — commercial rent roll is fundamentally different from storage/MHP. Do not force-fit existing patterns. Build a proper spreadsheet-feel table. |
| 4 | Default lender terms: 1.25 DSCR / 5-yr term / 25-yr am / 7.75% rate | **YES** — all user-overridable |
| 5 | Site ID field in V1 | **YES** — placeholder input only, Site Linker not built yet |

---

## MODULE STRUCTURE

### Tab Label
`Commercial` — placed after MHP in the tab bar.

---

### SECTION 1 — PROPERTY SETUP

Inputs:
- Property name
- Address, County, State
- Asking price
- Year built
- Total building SF (gross)
- Total leasable SF (net rentable)
- Common area SF (auto-computed: gross − leasable, display only)
- Load factor % (auto-computed: common area / gross, display only)
- Building type (dropdown):
  - Single-tenant freestanding
  - Strip multi-tenant
  - Mixed-use
  - Medical Office Building (MOB)
  - Office building
  - Flex-industrial
  - Other
- Parcel / Tax ID (text)
- Site ID (text, optional — label: "Site ID (future Site Linker)")

---

### SECTION 2 — RENT ROLL TABLE

**Spreadsheet-feel table. This is the heart of the module.**

Keyboard navigable. Add-row button. Delete-row button. Drag-to-reorder (if reorder exists in other modules; skip if not).

**Visible columns (8):**

| Col | Label | Type | Notes |
|-----|-------|------|-------|
| 1 | Suite # | Text | Label only |
| 2 | Tenant Name | Text | |
| 3 | SF Leased | Number | Vacant rows: SF entered, no tenant/rent |
| 4 | Tenant Type | Dropdown | See list below |
| 5 | Lease Type | Dropdown | See list below — drives recoveries auto-calc |
| 6 | Base Rent ($/SF/yr) | Number | Tooltip: "Enter base rent only — recoveries calculated separately based on lease type" |
| 7 | Lease End Date | Date picker | |
| 8 | Annual Rent ($) | Computed | SF × $/SF/yr — read only |

**Expanded columns (collapsed by default):**

- Lease start date
- Renewal options (count, length, terms — text)
- Annual escalations (% or $/SF — text in V1)
- TI given to date / TI remaining ($ — V1 single field)
- Free rent remaining (months)
- Recoveries breakdown (auto-populated from lease type, editable override — 3 lines for NNN, 2 for NN, 1 for MG, 0 for FSG)
- Guarantor name
- Personal guarantee (Y/N toggle)
- Notes (text)

**Tenant Type Dropdown:**
- Retail — general
- Retail — food/beverage
- Retail — anchor (credit tenant)
- Medical — general
- Medical — specialty
- Office — general
- Office — professional
- Service (auto, repair, trades)
- Industrial / flex
- Other (free text sub-field)

**Lease Type Dropdown + Auto-Recoveries Logic:**

| Lease Type | Recoveries Auto-Populated |
|-----------|--------------------------|
| NNN (triple net) | Taxes + Insurance + CAM (3 lines, pro-rata by SF) |
| NN (double net) | Taxes + Insurance (2 lines, pro-rata by SF) |
| Modified Gross | Fixed CAM contribution OR base year stop (1 line, user editable) |
| Full Service Gross | No recoveries |
| Percentage rent | Base + breakpoint sub-field + % over breakpoint sub-field |
| Ground lease | Flat rent field, no recoveries |

User can override any auto-populated recovery amount per tenant.

**Vacant row behavior:** Row has SF, no tenant name, no rent → counts toward vacancy SF calculation.

---

### SECTION 3 — INCOME (COMPUTED)

All computed from rent roll. No manual overrides except Other Income.

- Total base rent income = Σ(SF × $/SF/yr) across all leased tenants
- Total reimbursement income = Σ recoveries across all tenants
- Other income (line items — user adds rows):
  - Percentage rent overage
  - Parking
  - Signage
  - Vending
  - Late fees
  - Other (free text + $)
- **GSI = base rent + reimbursements + other income**

---

### SECTION 4 — VACANCY / COLLECTION LOSS

- Physical vacancy % — auto-computed from rent roll: vacant SF ÷ total leasable SF (display only)
- Economic vacancy % — user override field (default = physical vacancy; user can set higher)
- Collection loss % — user input (default 2%)
- **EGI = GSI × (1 − economic vacancy%) × (1 − collection loss%)**

---

### SECTION 5 — MVM SCENARIOS (0% / 20% / 30%)

**Exact same pattern as storage / MHP / resi modules. Applied to GSI.**

Three scenarios side by side. Each drives separate NOI / DSCR / max loan / value / cash-on-cash.

---

### SECTION 6 — OPERATING EXPENSES

User enters GROSS expenses (actual building cost). Module nets out reimbursement income to show landlord-borne net OpEx.

Line items:
- Property tax (gross)
- Insurance (gross)
- CAM (gross)
  - Optional sub-bucket: lot maintenance, exterior lighting, landscaping, snow removal, trash, security, common utilities
- Common area utilities (if separate from CAM)
- Property management (% of EGI — default 5%, converts to $ display)
- Onsite manager / leasing agent ($ annual — leave blank if none)
- Office / admin / software
- Marketing / leasing
- Legal / professional
- Repairs & maintenance (landlord-borne, non-CAM)
- Roof / structure reserve (always landlord-borne)
- Other (free text + $)

**Net OpEx to landlord = Gross OpEx − Total reimbursement income**

---

### SECTION 7 — RESERVES

V1: single $/SF annual inputs (not per-tenant).

- TI/LC reserve ($/SF/yr)
  - Default: $0.75/SF (surfaces higher default suggestion if Medical > 50% of income: $1.25/SF)
- Capex reserve ($/SF/yr)
  - Default: $0.30/SF (surfaces higher default suggestion if year built < 1990: $0.50/SF)

Both hit NOI as annual line items.

```
Annual TI/LC reserve $ = TI/LC $/SF × leasable SF
Annual capex reserve $ = capex $/SF × leasable SF
```

---

### SECTION 8 — ASSUMPTIONS BLOCK (USER-OVERRIDABLE)

Match storage/MHP assumptions block exactly.

- DSCR (default 1.25)
- Senior loan rate (default 7.75%)
- Senior loan amortization (default 25 years)
- Senior loan term (default 5 years)
- Seller finance rate (default match storage/MHP pattern)
- Seller finance amortization (default match storage/MHP pattern)
- Hard cost pad multiplier (placeholder in V1 — hard costs are V2)

---

### SECTION 9 — VALUATION / OUTPUTS

**Per MVM scenario (0%, 20%, 30%) — match storage/MHP layout:**

- GSI
- Economic vacancy loss
- Collection loss
- EGI
- Gross OpEx
- Total reimbursement income
- Net OpEx to landlord
- TI/LC reserve
- Capex reserve
- **NOI** (bold)
- Implied cap rate (NOI ÷ asking price — computed, not input)
- Max annual debt service (NOI ÷ DSCR)
- Max senior loan (back-calculated from debt service at lender terms)
- Senior annual debt service
- Seller-fi amount (Total project cost − senior loan — V1: no hard costs yet, so = asking price − senior loan)
- Seller-fi annual debt service
- Total annual debt service
- **DSCR check** (NOI ÷ total DS — flag red if < 1.20)
- Cash flow after all debt service
- Cash to close (asking price − senior loan − seller-fi)
- **Cash-on-cash** (cash flow ÷ cash to close)

**Commercial-specific outputs (below main grid):**

- Revenue contribution per tenant ($/yr and % of total) — table
- Top-tenant concentration (largest tenant % of income) — single number
- Tenant mix by SF (% by tenant type)
- Tenant mix by income (% by tenant type)
- Lease type mix (% NNN / NN / MG / Gross — by SF and by income)
- WALT — Weighted Average Lease Term remaining (years) — computed from lease end dates
- Rollover schedule — % of SF rolling in each of next 5 calendar years
- Vacancy % by SF
- Weighted average rent $/SF (across leased SF only)
- Recovery ratio (total reimbursement income ÷ total recoverable gross expenses)

---

### SECTION 10 — WARNINGS / FLAGS (PRIORITY V1 FLAGS ONLY)

Surface conditionally. Show in a warnings banner above or below outputs.

| Condition | Warning Text |
|-----------|-------------|
| Largest tenant > 40% of income | ⚠️ Tenant concentration risk — largest tenant is X% of income |
| WALT < 3 years | ⚠️ High rollover risk — weighted avg lease term is X years |
| DSCR < 1.20 | 🔴 Below typical commercial lender threshold (1.20 minimum) |
| Vacancy > 20% | ⚠️ Reposition deal — verify lease-up assumptions |
| TI/LC reserve < $0.50/SF | ⚠️ Likely under-reserved — consider $0.75-1.50/SF for this tenant mix |
| Capex reserve < $0.20/SF | ⚠️ Likely under-reserved for asset class |
| Lease end date < 12 months from today on largest tenant | ⚠️ Top-tenant rollover imminent |

V2 flags (do not build now): heavy medical lender suggestion, anchor risk, office post-pandemic flag, expense pass-through warning, recovery ratio extremes.

---

## AUTO-CALC ON LINK LOAD

Detection rule for Commercial: `askingPrice` + `totalLeasableSF` + ≥ 1 tenant row in rent roll (with SF + $/SF populated).

If all present in URL params → auto-fire calculate after hydration.

Show "Loaded from shared link" badge near Calculate button.

---

## V1 SCOPE — SHIP CHECKLIST

Before committing, verify all of these pass:

- [ ] Tab renders alongside existing tabs
- [ ] Property setup inputs save and hydrate
- [ ] Rent roll: add row, delete row, all 8 visible columns functional
- [ ] Lease type dropdown → recoveries auto-populate per tenant
- [ ] Vacant row (no tenant, no rent) drives vacancy % correctly
- [ ] Income computed correctly from rent roll
- [ ] MVM 0/20/30 fires on Calculate
- [ ] OpEx gross − reimbursements = net OpEx to landlord (correct)
- [ ] Reserves hit NOI correctly
- [ ] Valuation outputs match expected math (spot check one scenario manually)
- [ ] WALT computed from lease end dates
- [ ] Rollover schedule 5 years correct
- [ ] Priority warnings surface on correct conditions
- [ ] Auto-calc fires on link load when minimum fields present
- [ ] Site ID field present (placeholder only)
- [ ] No console errors on load or calculate

---

## DO NOT BUILD IN V1

- Hard cost actual + padded display (V2)
- Rent step / escalation modeling (V2)
- Free rent burn-off modeling (V2)
- Per-tenant TI/LC amortization (V2)
- PA transfer tax estimator (V2)
- Lender profile auto-suggest (V2)
- All V2 warning flags
- Site Linker / Shared Expense Allocator (future)

---

## Adaptation notes for THIS repo (rei-baby-analyzer)

The brief was originally scoped against `rei-fast-calc`. When implementing in Baby Analyzer:

- **Tabs in this repo:** Storage / Residential / MHP / **Commercial** (no Flip / Rental — those are Fast Calc tabs).
- **"Reuse senior-debt calc component from storage/MHP"** in the original brief assumed within-tool reuse. This repo follows the V2.6 self-containment rule (per Fast Calc's MATH_SPEC.md): each math file owns its own constants and helpers. So Commercial gets its **own** `annualLoanConstant`, its **own** lender-term constants, its **own** seller-finance helper — no cross-tab imports.
  - **SUPERSEDED 2026-07-17 — this is the part that caused the drift.** Self-containment of *helpers* (a module's own `annualLoanConstant`, no cross-tab imports) is fine and stays. Self-containment of *underwriting constants* is retired: no math file may own a rate, amort, DSCR, LTV, fee, or pad of its own. Every such number is read from the live Math Bible (`https://shared-underwriting-standards.vercel.app/bible.json`) at runtime and passed into the math as `assumptions`; a module with a missing Bible value **throws** rather than falling back to a stored default. "Own constants" was how `commercial.js` came to price at 7% / 30yr while the Bible said 7.25% / 25yr (an 8.64% overpay on every commercial deal).
- **UI components** can be shared across tabs within this repo (e.g., a `<Money>` formatter, a `<TabSection>` wrapper) — the isolation rule is about math and tools, not within-tool UI primitives.
- **Deploy target:** Vercel (same as Fast Calc / Rehab Calc), not Railway. Vite dev server on default port 5173.
- **Site Linker:** placeholder input only, no integration yet.

When porting from this brief, copy this entire file into the implementation commit's notes and add a provenance line at the top of `src/math/commercial.js`:

```
// PORTED FROM docs/COMMERCIAL_BRIEF_V1.md (V1 spec) on YYYY-MM-DD
// V1 scope: current contract rent only, single $/SF reserves, V2 deferred per brief.
```

---

*Brief version: Commercial V1 | original May 2026 | captured into rei-baby-analyzer 2026-05-08*
