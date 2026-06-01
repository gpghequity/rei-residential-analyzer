// api/helperAuth.js
//
// Server-side auth + base URLs for the helper services Baby Analyzer
// orchestrates. The operator password and tokens live ONLY on the server
// (Railway env) — never shipped to the browser. The browser talks only to
// Baby Analyzer's own /api/* routes, which proxy to the helpers.

export const HELPERS = {
  docReader: process.env.DOC_READER_URL || 'https://rei-doc-reader-production.up.railway.app',
  picRehab: process.env.PIC_REHAB_URL || 'https://rei-pic-rehab-production.up.railway.app',
  dataEnrichment: process.env.DATA_ENRICHMENT_URL || 'https://rei-data-enrichment-production.up.railway.app'
};

// HTTP Basic header used by doc-reader / pic-rehab paid endpoints:
//   Authorization: Basic base64('operator:' + REI_OPERATOR_PASSWORD)
export function basicAuthHeader() {
  const pw = process.env.REI_OPERATOR_PASSWORD;
  if (!pw) return null;
  return 'Basic ' + Buffer.from(`operator:${pw}`).toString('base64');
}

// Bearer token for data-enrichment /api/research (falls back to operator pw).
export function enrichmentBearer() {
  const t = process.env.REI_ENRICHMENT_TOKEN || process.env.REI_OPERATOR_PASSWORD;
  return t ? `Bearer ${t}` : null;
}

export function helperConfigured() {
  return Boolean(process.env.REI_OPERATOR_PASSWORD);
}
