// api/enrich.js
//
// Proxies comp/AVM/enrichment lookups to rei-data-enrichment and returns a
// normalized bundle to the browser. Baby Analyzer gathers comps so the user
// never has to run a separate comp tool. We surface comps used/rejected with
// source, distance, date, price, confidence, and value impact where the
// provider supplies them.

import { HELPERS, basicAuthHeader, enrichmentBearer } from './helperAuth.js';

async function getJson(url, headers = {}) {
  const resp = await fetch(url, { method: 'GET', headers });
  const text = await resp.text();
  try { return { status: resp.status, json: JSON.parse(text) }; }
  catch { return { status: resp.status, json: { ok: false, raw: text } }; }
}

async function postJson(url, body, headers = {}) {
  const resp = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body)
  });
  const text = await resp.text();
  try { return { status: resp.status, json: JSON.parse(text) }; }
  catch { return { status: resp.status, json: { ok: false, raw: text } }; }
}

// Core: returns the normalized enrichment bundle for an address.
export async function enrichCore(b = {}) {
  const { address, city, state, zip, beds, baths, sqft, assetType } = b;
  if (!address) return { ok: false, error: 'address required' };

  const isResidential = !assetType || /resid|sfr|single|multi/i.test(assetType);
  const out = { ok: true, address, assetType: assetType || 'residential', avm: null, comps: [], rejected: [], rehabBenchmark: null, sources: {}, notes: [] };

  try {
    // AVM (no auth) — primary value + comp count
    const params = new URLSearchParams({ address });
    if (city) params.set('city', city);
    if (state) params.set('state', state);
    if (zip) params.set('zip', zip);
    if (beds) params.set('beds', String(beds));
    if (baths) params.set('baths', String(baths));
    if (sqft) params.set('sqft', String(sqft));
    const avm = await getJson(`${HELPERS.dataEnrichment}/api/avm?${params.toString()}`);
    if (avm.json?.ok) {
      out.avm = {
        value: avm.json.avm_value, low: avm.json.avm_low, high: avm.json.avm_high,
        source: avm.json.avm_source || 'data-enrichment',
        comparables: avm.json.avm_comparables ?? null,
        rent_estimate: avm.json.rent_estimate ?? null
      };
      out.sources.avm = avm.json.avm_source || 'data-enrichment';
      // Second, independent comp source (web: Zillow / Realtor via Firecrawl).
      if (avm.json.avm2_value != null) {
        out.avm2 = {
          value: avm.json.avm2_value,
          source: avm.json.avm2_source || 'web',
          basis: avm.json.avm2_basis || null,
          sites: avm.json.avm2_sites || []
        };
        out.sources.avm2 = avm.json.avm2_source || 'web';
      }
    } else {
      out.notes.push('AVM lookup returned no value');
    }

    // Richer server-to-server research bundle (flood/crime/rehab/comp context)
    const bearer = enrichmentBearer();
    if (bearer) {
      const research = await postJson(`${HELPERS.dataEnrichment}/api/research`, {
        address, city, state, zip, beds, baths, sqft, asset_type: assetType
      }, { Authorization: bearer });
      if (research.json?.ok) {
        const r = research.json;
        out.flood = { zone: r.flood_zone, sfha: r.flood_is_sfha, label: r.flood_label };
        out.crime = { score: r.neighborhood_safety_score, label: r.neighborhood_safety_label };
        out.demographics = (r.median_household_income != null || r.total_population != null) ? {
          medianIncome: r.median_household_income, population: r.total_population, povertyRate: r.poverty_rate
        } : null;
        out.rehabBenchmark = (r.rehab_low != null) ? {
          low: r.rehab_low, high: r.rehab_high, perSqft: r.rehab_per_sqft,
          tier: r.rehab_tier, source: r.rehab_source
        } : out.rehabBenchmark;
        // The FULL per-source ledger (every adapter + honest status). This is
        // what lets the UI show ALL sources, not just the ones that answered.
        if (Array.isArray(r.sources)) out.allSources = r.sources;
        if (r.source_counts) out.sourceCounts = r.source_counts;
        if (r.comp_context) out.compContext = r.comp_context;
        if (Array.isArray(r.comp_sources)) out.sources.comps = r.comp_sources.join(', ');
        if (!out.avm && r.avm_value != null) {
          out.avm = { value: r.avm_value, low: r.avm_low, high: r.avm_high, source: r.avm_source };
        }
      }
    } else {
      out.notes.push('No enrichment token; skipped /api/research bundle');
    }

    // Non-residential: perplexity comp context for storage/MHP/commercial/etc.
    if (!isResidential) {
      const p = new URLSearchParams({ address, asset_type: assetType });
      if (city) p.set('city', city);
      if (state) p.set('state', state);
      if (zip) p.set('zip', zip);
      const auth = basicAuthHeader();
      const headers = auth ? { Authorization: auth } : {};
      const px = await getJson(`${HELPERS.dataEnrichment}/api/perplexity/comps?${p.toString()}`, headers);
      if (px.json?.ok && px.json.result) {
        out.compContext = px.json.result.comp_context || out.compContext;
        if (!out.avm && px.json.result.avm_value != null) {
          out.avm = { value: px.json.result.avm_value, source: px.json.result.avm_source || 'perplexity_comps' };
        }
        if (Array.isArray(px.json.result.sources)) out.sources.comps = px.json.result.sources.join(', ');
      }
    }

    return out;
  } catch (e) {
    return { ok: false, error: e?.message || 'enrichment failed', address };
  }
}

// POST /api/enrich  { address, city, state, zip, beds, baths, sqft, assetType }
export async function enrich(req, res) {
  const out = await enrichCore(req.body || {});
  if (out.ok === false && out.error === 'address required') {
    return res.status(400).json(out);
  }
  return res.status(200).json(out);
}
