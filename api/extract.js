// api/extract.js
//
// Proxies document + photo uploads to the helper services and returns RAW
// findings. Baby Analyzer never lets the extractor / photo analyzer draw
// conclusions — these return exactly what the helpers returned (income /
// expenses / broker NOI / rent roll for docs; condition tiers + rehab band for
// photos). Math + recommendation happen later (client math + analyzeDeal).
//
// Core functions (extractDocsCore / extractPhotosCore) are reused by the
// orchestrator (analyzeDeal.js) so the proxy logic lives in one place.

import { HELPERS, basicAuthHeader, helperConfigured } from './helperAuth.js';

function filesToFormData(files, fieldName) {
  const fd = new FormData();
  for (const f of files) {
    const blob = new Blob([f.buffer], { type: f.mimetype || 'application/octet-stream' });
    fd.append(fieldName, blob, f.originalname || 'upload');
  }
  return fd;
}

async function postForm(url, fd, extraHeaders = {}) {
  const auth = basicAuthHeader();
  const headers = { ...extraHeaders };
  if (auth) headers['Authorization'] = auth;
  const resp = await fetch(url, { method: 'POST', headers, body: fd });
  const text = await resp.text();
  let json;
  try { json = JSON.parse(text); } catch { json = { ok: false, raw: text }; }
  return { status: resp.status, json };
}

export async function extractDocsCore(files, { dealType = '', propertyAddress = '' } = {}) {
  if (!helperConfigured()) return { ok: false, configured: false, error: 'REI_OPERATOR_PASSWORD not set; extractor unavailable.' };
  if (!files || !files.length) return { ok: false, error: 'No documents provided' };
  try {
    const single = files.length === 1 && /pdf$/i.test(files[0].mimetype || files[0].originalname || '');
    if (single) {
      const fd = filesToFormData(files, 'file');
      const r = await postForm(`${HELPERS.docReader}/extract/om`, fd);
      return { ok: r.json?.ok !== false, endpoint: '/extract/om', result: r.json };
    }
    const fd = filesToFormData(files, 'files');
    if (dealType) fd.append('dealType', dealType);
    if (propertyAddress) fd.append('property_address', propertyAddress);
    const r = await postForm(`${HELPERS.docReader}/extract`, fd);
    return { ok: r.json?.ok !== false, endpoint: '/extract', result: r.json };
  } catch (e) {
    return { ok: false, error: e?.message || 'doc extraction failed' };
  }
}

export async function extractPhotosCore(files, { manualSqft = '', propertyAddress = '' } = {}) {
  if (!helperConfigured()) return { ok: false, configured: false, error: 'REI_OPERATOR_PASSWORD not set; photo analyzer unavailable.' };
  if (!files || !files.length) return { ok: false, error: 'No photos provided' };
  try {
    const fd = filesToFormData(files, 'photos');
    if (manualSqft) fd.append('manual_sqft', String(manualSqft));
    if (propertyAddress) fd.append('property_address', propertyAddress);
    const r = await postForm(`${HELPERS.picRehab}/api/analyze`, fd);
    return { ok: r.json?.ok !== false, endpoint: '/api/analyze', result: r.json };
  } catch (e) {
    return { ok: false, error: e?.message || 'photo analysis failed' };
  }
}

// ── Route handlers (browser can call these directly for incremental display) ──
export async function extractDocs(req, res) {
  const files = req.files || [];
  if (!files.length) return res.status(400).json({ ok: false, error: 'No files uploaded (field: files)' });
  const out = await extractDocsCore(files, { dealType: req.body?.dealType, propertyAddress: req.body?.property_address });
  return res.status(200).json(out);
}

export async function extractPhotos(req, res) {
  const files = req.files || [];
  if (!files.length) return res.status(400).json({ ok: false, error: 'No photos uploaded (field: photos)' });
  const out = await extractPhotosCore(files, { manualSqft: req.body?.manual_sqft, propertyAddress: req.body?.property_address });
  return res.status(200).json(out);
}
