// Vercel serverless function — regression-testable math endpoint.
// Self-contained: inlines Baby Analyzer math so Node runtime has no Vite deps.
// Called by rei-math-regression weekly. Not exposed in the UI.

// ── Constants (Math Bible v3 snapshot, same as src/config/defaults.json) ──
const STORAGE_EXPENSE_FLOOR = 0.35;
const LTV_STORAGE           = 0.75;
const LTV_RESI              = 0.80;
const RATE_BANK_STORAGE     = 0.0725;
const AMORT_BANK_STORAGE    = 25;
const RATE_BANK_RESI        = 0.0700;
const AMORT_BANK_RESI       = 30;
const DSCR_CONSERVATIVE     = 1.25;
const DSCR_STRETCH          = 1.15;
const MAO_FACTOR            = 0.70;
const WHOLESALE_FEE         = 10000;
const POCKET_FLOOR          = 10000;

function annualK(rate, years) {
  const r = rate / 12, n = years * 12;
  const f = (r * Math.pow(1 + r, n)) / (Math.pow(1 + r, n) - 1);
  return f * 12;
}

const K_BANK_STORAGE = annualK(RATE_BANK_STORAGE, AMORT_BANK_STORAGE);
const K_BANK_RESI    = annualK(RATE_BANK_RESI,    AMORT_BANK_RESI);

// Storage NOI with expense floor enforcement (the critical test)
function storageNOI(grossDollarsIn, sellerStatedExpensePct) {
  const expenseRatio = Math.max(sellerStatedExpensePct || 0, STORAGE_EXPENSE_FLOOR);
  const expenses     = grossDollarsIn * expenseRatio;
  const noi          = grossDollarsIn - expenses;
  const floorBinds   = expenseRatio === STORAGE_EXPENSE_FLOOR;
  return { grossDollarsIn, sellerStatedExpensePct,
           appliedExpenseRatio: expenseRatio, expenses, noi, floorBinds };
}

// Storage Group A max purchase (bank financing, conservative DSCR)
function storageGroupA(noi) {
  const annualBankFactor = LTV_STORAGE * K_BANK_STORAGE;
  const maxPurchase      = noi / (DSCR_CONSERVATIVE * annualBankFactor);
  const rounded          = Math.floor(maxPurchase / 1000) * 1000;
  const bankLoan         = rounded * LTV_STORAGE;
  const annualDS         = bankLoan * K_BANK_STORAGE;
  const actualDSCR       = noi / annualDS;
  return { noi, maxPurchase: rounded, yourOffer: rounded - WHOLESALE_FEE,
           annualDS, actualDSCR, dscrPass: actualDSCR >= DSCR_CONSERVATIVE };
}

// Residential MAO
function residentialMAO(arv, rehab) {
  const endBuyer  = (arv * MAO_FACTOR) - rehab;
  const yourOffer = endBuyer - WHOLESALE_FEE;
  return { arv, rehab, endBuyer, yourOffer };
}

// Residential DSCR check
function residentialDSCR(annualNOI, purchase) {
  const loan     = purchase * LTV_RESI;
  const annualDS = loan * K_BANK_RESI;
  const dscr     = annualNOI / annualDS;
  const pass     = dscr >= DSCR_CONSERVATIVE;
  const pocket   = annualNOI - annualDS;
  return { loan, annualDS, dscr, pass,
           pocketCashAnnual: pocket,
           pocketFloorBinds: pocket < POCKET_FLOOR };
}

// MHP NOI
function mhpNOI(lots, lotRent, pohUnits, pohRent, expenseRatio) {
  const lotIncome = lots * lotRent * 12;
  const pohIncome = pohUnits * pohRent * 12;
  const gross     = lotIncome + pohIncome;
  const expenses  = gross * expenseRatio;
  const noi       = gross - expenses;
  return { lotIncome, pohIncome, gross, expenses, noi,
           capRate: (purchasePrice) => noi / purchasePrice };
}

// ── Handler ──
export default function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'POST only' });
  }
  try {
    const { type, inputs = {} } = req.body || {};

    if (type === 'storage_noi') {
      const gross    = Number(inputs.grossDollarsIn        ?? 0);
      const expPct   = Number(inputs.sellerStatedExpensePct ?? 0);
      return res.json({ ok: true, type, result: storageNOI(gross, expPct) });
    }

    if (type === 'storage_group_a') {
      const noi = Number(inputs.noi ?? 0);
      return res.json({ ok: true, type, result: storageGroupA(noi) });
    }

    if (type === 'residential_mao') {
      const arv   = Number(inputs.arv   ?? 0);
      const rehab = Number(inputs.rehab ?? 0);
      return res.json({ ok: true, type, result: residentialMAO(arv, rehab) });
    }

    if (type === 'residential_dscr') {
      const noi      = Number(inputs.annualNOI ?? 0);
      const purchase = Number(inputs.purchase  ?? 0);
      return res.json({ ok: true, type, result: residentialDSCR(noi, purchase) });
    }

    if (type === 'mhp_noi') {
      const { lots=0, lotRent=0, pohUnits=0, pohRent=0, expenseRatio=0.45 } = inputs;
      return res.json({ ok: true, type, result: mhpNOI(
        Number(lots), Number(lotRent), Number(pohUnits), Number(pohRent), Number(expenseRatio)
      )});
    }

    if (type === 'constants') {
      return res.json({ ok: true, type, result: {
        STORAGE_EXPENSE_FLOOR, LTV_STORAGE, LTV_RESI,
        RATE_BANK_STORAGE, AMORT_BANK_STORAGE, K_BANK_STORAGE,
        RATE_BANK_RESI, AMORT_BANK_RESI, K_BANK_RESI,
        DSCR_CONSERVATIVE, DSCR_STRETCH, MAO_FACTOR, WHOLESALE_FEE, POCKET_FLOOR
      }});
    }

    return res.status(400).json({ error: `Unknown type: ${type}` });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
