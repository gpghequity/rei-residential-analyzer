// api/drive.js
//
// Address-keyed Drive folder + file storage for Baby Analyzer.
//
// REWRITE (2026-06): the old version read a nonexistent keys/ file and used a
// nonexistent auth class. This version uses the platform convention
// (GOOGLE_SERVICE_ACCOUNT_JSON via google.auth.JWT) and reuses the existing
// address-keyed folder convention from rei-email-intake/services/folderLookup.js
// — one Drive folder per canonical property address under
// GOOGLE_DRIVE_PARENT_FOLDER_ID, so Baby Analyzer's files land alongside the
// same property's email attachments / doc-reader output / LOIs.
//
// Folder name:  [ASSET-TYPE] — [STREET ADDRESS]
// File naming:  YYYY-MM-DD-baby-analyzer-<name>
//
// Copied (not imported) per isolation-first. ESM (repo is "type":"module").

import { Readable } from 'stream';
import { getDrive } from './googleClients.js';

const SUFFIX_MAP = [
  [/\bstreet\b|\bst\.\b/g, 'st'],
  [/\broad\b|\brd\.\b/g, 'rd'],
  [/\bavenue\b|\bave\.\b/g, 'ave'],
  [/\bboulevard\b|\bblvd\.\b/g, 'blvd'],
  [/\bdrive\b|\bdr\.\b/g, 'dr'],
  [/\blane\b|\bln\.\b/g, 'ln'],
  [/\bcourt\b|\bct\.\b/g, 'ct'],
  [/\bcircle\b|\bcir\.\b/g, 'cir'],
  [/\bparkway\b|\bpkwy\.\b/g, 'pkwy'],
  [/\bplace\b|\bpl\.\b/g, 'pl'],
  [/\bterrace\b|\bter\.\b/g, 'ter'],
  [/\bhighway\b|\bhwy\.\b/g, 'hwy'],
  [/\broute\b|\brt\.\b/g, 'rt']
];

export function normalizeAddress(address) {
  if (!address || typeof address !== 'string') return null;
  let s = address.toLowerCase().replace(/\s+/g, ' ').trim();
  for (const [re, replacement] of SUFFIX_MAP) s = s.replace(re, replacement);
  s = s.replace(/[^a-z0-9 ,]/g, '').replace(/\s+/g, ' ').trim();
  return s || null;
}

export function buildFolderName(propertyType, address) {
  const type = (propertyType || 'UNKNOWN').toUpperCase();
  return `${type} — ${address}`;
}

export function buildFileName(name, isoDate) {
  const date = (isoDate || new Date().toISOString()).slice(0, 10);
  const safe = (name || 'file').replace(/[^a-zA-Z0-9._-]/g, '-');
  return `${date}-baby-analyzer-${safe}`;
}

function folderUrl(id) {
  return `https://drive.google.com/drive/folders/${id}`;
}

// Find (or create) the address-keyed folder under GOOGLE_DRIVE_PARENT_FOLDER_ID.
// Returns { ok, folderId, url, name, isNew } or { ok:false, error }.
export async function findOrCreateDealFolder(address, propertyType) {
  const parent = process.env.GOOGLE_DRIVE_PARENT_FOLDER_ID;
  if (!parent) return { ok: false, error: 'GOOGLE_DRIVE_PARENT_FOLDER_ID not set' };
  const normalized = normalizeAddress(address);
  if (!normalized) return { ok: false, error: 'address unusable for folder key' };

  const r = getDrive();
  if (r.error) return { ok: false, error: r.error };
  const drive = r.drive;
  const folderName = buildFolderName(propertyType, address);
  const escaped = normalized.replace(/'/g, "\\'");

  try {
    let listRes;
    try {
      listRes = await drive.files.list({
        q: [
          `'${parent}' in parents`,
          `mimeType = 'application/vnd.google-apps.folder'`,
          `appProperties has { key='canonical_address' and value='${escaped}' }`,
          `trashed = false`
        ].join(' and '),
        fields: 'files(id, name)',
        pageSize: 5
      });
    } catch {
      listRes = await drive.files.list({
        q: `'${parent}' in parents and name = '${folderName.replace(/'/g, "\\'")}' and mimeType = 'application/vnd.google-apps.folder' and trashed = false`,
        fields: 'files(id, name)',
        pageSize: 5
      });
    }

    if (listRes.data.files && listRes.data.files.length > 0) {
      const f = listRes.data.files[0];
      return { ok: true, folderId: f.id, url: folderUrl(f.id), name: f.name, isNew: false };
    }

    const created = await drive.files.create({
      requestBody: {
        name: folderName,
        mimeType: 'application/vnd.google-apps.folder',
        parents: [parent],
        appProperties: {
          canonical_address: normalized,
          property_type: (propertyType || 'unknown').toLowerCase(),
          first_seen: new Date().toISOString()
        }
      },
      fields: 'id, name'
    });
    return { ok: true, folderId: created.data.id, url: folderUrl(created.data.id), name: created.data.name, isNew: true };
  } catch (e) {
    return { ok: false, error: e?.message || 'drive folder failed' };
  }
}

// Upload one file (string, Buffer, or stream) into a folder.
// Returns { ok, id, url } or { ok:false, error }.
export async function uploadFile(folderId, { name, mimeType, body }) {
  const r = getDrive();
  if (r.error) return { ok: false, error: r.error };
  let mediaBody = body;
  if (Buffer.isBuffer(body)) mediaBody = Readable.from(body);
  try {
    const res = await r.drive.files.create({
      requestBody: { name: buildFileName(name), parents: [folderId] },
      media: { mimeType: mimeType || 'application/octet-stream', body: mediaBody },
      fields: 'id'
    });
    return { ok: true, id: res.data.id, url: `https://drive.google.com/file/d/${res.data.id}/view` };
  } catch (e) {
    return { ok: false, error: e?.message || 'upload failed' };
  }
}

// Persist a full deal: create/find folder, upload raw uploads, extracted JSON,
// photo findings, comp findings, the analysis JSON, and the report HTML.
// Never throws — returns { ok, folderId, url, uploaded[], errors[] }.
export async function uploadDealArtifacts({ address, propertyType, uploads = [], artifacts = {} }) {
  const folder = await findOrCreateDealFolder(address, propertyType);
  if (!folder.ok) return { ok: false, error: folder.error };

  const uploaded = [];
  const errors = [];

  // Raw user uploads (docs + photos): [{ originalname, mimetype, buffer }]
  for (const f of uploads) {
    if (!f || !f.buffer) continue;
    const u = await uploadFile(folder.folderId, {
      name: f.originalname || 'upload',
      mimeType: f.mimetype,
      body: f.buffer
    });
    if (u.ok) uploaded.push({ name: f.originalname, id: u.id, url: u.url });
    else errors.push(`upload ${f.originalname}: ${u.error}`);
  }

  // JSON / HTML artifacts: { 'extracted.json': obj, 'report.html': '<html>' , ... }
  for (const [name, value] of Object.entries(artifacts)) {
    if (value == null) continue;
    const isHtml = name.endsWith('.html');
    const body = isHtml ? String(value) : JSON.stringify(value, null, 2);
    const u = await uploadFile(folder.folderId, {
      name,
      mimeType: isHtml ? 'text/html' : 'application/json',
      body
    });
    if (u.ok) uploaded.push({ name, id: u.id, url: u.url });
    else errors.push(`artifact ${name}: ${u.error}`);
  }

  return { ok: true, folderId: folder.folderId, url: folder.url, isNew: folder.isNew, uploaded, errors };
}

// ── Backward-compatible helpers for load-analysis.js ──
// Load the most recent analysis JSON saved in this property's folder.
export async function loadLatestAnalysis(address) {
  const parent = process.env.GOOGLE_DRIVE_PARENT_FOLDER_ID;
  if (!parent) return null;
  const normalized = normalizeAddress(address);
  if (!normalized) return null;
  const r = getDrive();
  if (r.error) return null;
  const drive = r.drive;
  try {
    const folders = await drive.files.list({
      q: [
        `'${parent}' in parents`,
        `mimeType = 'application/vnd.google-apps.folder'`,
        `appProperties has { key='canonical_address' and value='${normalized.replace(/'/g, "\\'")}' }`,
        `trashed = false`
      ].join(' and '),
      fields: 'files(id)',
      pageSize: 1
    });
    if (!folders.data.files || !folders.data.files.length) return null;
    const folderId = folders.data.files[0].id;
    const files = await drive.files.list({
      q: `'${folderId}' in parents and name contains 'analysis' and trashed = false`,
      fields: 'files(id, name, createdTime)',
      orderBy: 'createdTime desc',
      pageSize: 1
    });
    if (!files.data.files || !files.data.files.length) return null;
    const fileRes = await drive.files.get(
      { fileId: files.data.files[0].id, alt: 'media' },
      { responseType: 'text' }
    );
    return typeof fileRes.data === 'string' ? JSON.parse(fileRes.data) : fileRes.data;
  } catch {
    return null;
  }
}
