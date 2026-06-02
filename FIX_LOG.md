# Phase 3: Standards Integration — rei-baby-analyzer

## Date: 2026-06-01
## Task: Integrate PLATFORM_UNDERWRITING_STANDARDS into rei-baby-analyzer commercial module

### Checklist

#### Infrastructure
- [x] Copied standards module to `src/config/underwriting-standards.js`
- [x] Created `src/config/standards-display.js` for commercial standards exposure
  - [x] Exports getCommercialDefaults(), getCommercialStandards(), getSubclassCapRateBand()
  - [x] Returns commercial assumptions with display formatting
  - [x] Provides per-subclass cap rate bands from standards

#### Math Module Updates
- [x] Updated `src/math/commercial.js`:
  - [x] DEFAULT_LENDER_RATE: 0.0775 → 0.07
  - [x] DEFAULT_LENDER_AM_YEARS: 25 → 30
  - [x] SUBCLASS_DEFAULTS cap rates now ready for alignment with standards values

#### API Integration
- [x] Updated `api/calc.js`:
  - [x] Updated constants: RATE_BANK_STORAGE, AMORT_BANK_STORAGE (0.07, 30)
  - [x] Updated DSCR_STRETCH: 1.15 → 1.10
  - [x] Added LTV_COMMERCIAL: 0.65
  - [x] Added RATE_BANK_COMMERCIAL, AMORT_BANK_COMMERCIAL, K_BANK_COMMERCIAL constants
  - [x] Added standards endpoint (POST /calc with type='standards')
  - [x] Supports asset_type query: 'commercial' or 'storage'

#### Deployment
- [ ] Test commercial quote with subclass defaults
- [ ] Verify /api/calc standards endpoint returns correct values
- [ ] Verify commercial module uses updated lender defaults
- [ ] Verify subclass cap rate bands are accessible

### Impact

**Commercial Module Updated:** ✅
- All lender rates and amortization aligned with standards (7%, 30 years)
- DSCR thresholds updated (stretch 1.15 → 1.10)
- Ready for subclass cap rate band warnings

**Storage Constants Corrected:** ✅
- RATE_BANK_STORAGE: 0.0725 → 0.07
- AMORT_BANK_STORAGE: 25 → 30
- Now consistent with standards across all asset classes

### Notes
- Commercial subclass cap rate bands available in standards-display.js
- No breaking changes to commercial math — just updated starting values
- All four asset classes now use unified standards values

### Status

**Phase 3 Code Complete:** ✅
- Standards module copied and isolated
- Commercial constants updated to 7%/30yr
- API standards endpoint ready
- Commercial subclass support wired up

**Next Steps**
1. Phase 4: rei-net-sheet (net sheet formula from standards)
2. Phase 5: rei-comp-snapshot (comp values from standards)
3. Phase 6+: Remaining P1 tools

---

## Date: 2026-06-01 (later)
## Task: Math Bible v3.1 — Multifamily tiers + Land/IOS section + Analyze-a-Deal NOI fix

### Multifamily 1–19 / 20+ tiers (Steve-confirmed constants, NO new math)
- `api/calc.js`: added `multifamily_small` (80/20 @ 7%/30yr = `K_BANK_RESI`) and
  `multifamily_large` (75/25 @ 7.25%/25yr = `K_BANK_STORAGE`). Both use the canonical
  Group-A formula `P_max = NOI/(1.25 × LTV × K)`; only LTV+K differ. No new constant.
  `multifamily_large` is identical to `storage_group_a` by construction (contract-tested).
- `typeMap.js`: split the single `multifamily` type into `multifamily_small` (1–19) and
  `multifamily_large` (20+). `headline()` handles both.
- New `src/tests/calc.test.js` drives the real handler: small > large price, large == storage_a.

### Land / IOS / Outdoor Storage (dedicated tab — intake, NOT an offer engine)
- New `src/math/land.js`: deterministic ratio metrics only ($/acre, $/sf, $/usable-acre,
  $/buildable-lot, $/approved-unit, $/truck-space, $/storage-acre; income multiple + cap rate
  ONLY when actual income). No offer math. + `src/tests/land.test.js`.
- New `src/components/LandTab.jsx`: full 12-section report (Quick Answer → Facts → Zoning →
  type-specific Qs → Valuation → Risk → Offer Logic → LOI → Final Rec). 7 land types.
  Saves to Drive + Properties sheet (asset type = land). Never routes land through other math;
  AVM labeled reference-only.
- `App.jsx`: added "Land / IOS" tab; version 0.5.0 → 0.6.0; footer updated.

### Analyze-a-Deal NOI intake fix (root cause of "not implemented" on Storage)
- Added an **"Annual Operating Expenses ($/yr)"** field (operators were typing dollars into
  the "Expense Ratio (%)" field → e.g. 41000% → negative NOI → matrix wouldn't build → the
  misleading "ANALYSIS MODULE NOT YET IMPLEMENTED" message).
- `deriveNOI()` + the income matrix path now prefer explicit NOI, then Gross−Expenses($),
  then Gross×(1−ratio%); out-of-range ratios (>100% or <0) are sanitized so a typo can never
  drive NOI negative. Storage 35% expense floor still enforced.
- Reworded the verdict/calc messages: income assets now say "this type IS supported — needs
  NOI/Gross+Expenses or an OM that states them" (verdict NEEDS INCOME), instead of "not implemented".

### Math Bible doc
- `Downloads/REI_Math_Bible_v3.1.docx` — locked v3 + new Part 5 (MF tiers) and Part 6 (Land/IOS).
  Source: `REI_Math_Bible_v3.1_addendum.md` / `.html`. Original v3.docx left untouched.

### Verification
- `npx vitest run` → 212 passed (9 files). `npx vite build` → clean.
- NOT yet deployed (local-first). Live service is still v0.5.0 until Steve OKs deploy.

---

## Date: 2026-06-01 (pre-deploy routing correction — per Steve's directive)
## Rule: correct engine per asset class; standardize layout only, NOT math.

### Violations found + fixed
1. **Land/IOS borrowed storage math.** `ios_land` routed to `storage_group_a` when income
   was present. FIXED: `ios_land.buildCalc` now ALWAYS returns null — land never runs
   storage/residential/MF/commercial math. Land uses the dedicated Land/IOS tab only.
2. **Analyze-a-Deal financing matrix used a blanket 0.70 LTV** (70/30) for ALL income
   assets — violates "Storage uses 75/25, not 70/30" and actually OVER-valued deals vs the
   Bible. FIXED: `bankTermsFor` now returns asset-correct LTV — storage / MF-20+ / MHP =
   75/25 @ 7.25%/25yr (K_BANK_STORAGE); commercial / mixed-use = 75/25 @ 7%/30yr.
3. **MF 20+ used the single-offer path**, not the storage/commercial scenario framework.
   FIXED: `multifamily_large` added to `INCOME_ASSET_TYPES` → now renders the full 8-row
   Group A/B/C bank + seller-finance matrix at 75/25 @ 7.25%/25yr.

### Routing now (HARD-VALIDATED in src/tests/routing.test.js, 21 assertions)
| Type | Engine | LTV / terms |
|---|---|---|
| Residential / 1–4 | residential_mao / residential_dscr | 80/20 @ 7%/30 |
| Multifamily 1–19 | multifamily_small (agency) | 80/20 @ 7%/30, 1.25 only, no storage floor |
| Multifamily 20+ | income matrix (storage/commercial) | 75/25 @ 7.25%/25 |
| Self Storage | income matrix / storage_group_a | 75/25 @ 7.25%/25, 35% floor |
| Commercial | income matrix / commercial_dscr | 75/25 @ 7%/30 |
| MHP / RV | income matrix (full engine on MHP tab) | 75/25 @ 7.25%/25 |
| Mixed Use | income matrix (full split on Mixed Use tab) | 75/25 @ 7%/30 |
| Land / IOS | LAND supported-intake (Land tab) | NO offer engine |

### Verification
- `npx vitest run` → **233 passed (10 files)** incl. new routing/LTV gate. `npx vite build` → clean.
- Bible doc unchanged — it was already 75/25; the CODE now matches it.
- **DEPLOYED — LIVE v0.6.0** at https://rei-baby-analyzer-production.up.railway.app (Railway). Smoke test passed.

---

## Date: 2026-06-01 (v0.6.1 — QA Test Harness)
## Task: repeatable operator QA system; no new math, no Bible/routing changes.

- **QA Runner tab** (`src/components/QaTab.jsx`, also deep-link `?tab=qa`): runs frozen
  golden deals through the REAL engines, shows PASS/FAIL + expected/actual/diff/tolerance/
  formula/Math-Bible-section per check.
- **`src/qa/fixtures.js`** — golden expected values per asset class (computed once from the
  real engines, frozen → drift detection).
- **`src/qa/runner.js`** — runMatrix/runCalc/runLand + storage capital-stack invariants
  (bank=75%, equity=25%, borrower+seller=equity, 8% borrower-only, 5% seller-only, DSCR
  bank-only, pocket = NOI − all obligations) + MF routing proof + land no-fake-offer guards.
- **Extractor diagnostics panel** — shows detected address/type/gross/expenses/NOI/asking/
  units/sqft/confidence + raw payload; empty → "Extractor returned no usable financial
  data." (never "not implemented").
- **Acceptance checklist** per fixture + **downloadable/printable QA Report** (date, version,
  bundle hash, live URL, pass/fail, failures, formulas).
- **Deploy guardrail** `src/tests/qa.test.js` + render smoke tests for QA + Land tabs.
- Shared `src/version.js` (v0.6.1).

### Verification (all deploy guardrails met)
- `npx vitest run` → **240 passed (11 files)**. `npx vite build` → clean (46 modules).
- Guardrails: tests pass ✓ · build ✓ · QA runner loads ✓ · ≥1 fixture/asset class ✓ ·
  storage capital-stack ✓ · MF routing ✓ · land no-fake-offer ✓.
- **DEPLOYED — LIVE v0.6.1** at https://rei-baby-analyzer-production.up.railway.app.
  Live smoke: QA strings present; live /api/calc MF1-19 = $1,503,000 (matches fixture).
