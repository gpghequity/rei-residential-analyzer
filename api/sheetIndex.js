// api/sheetIndex.js
//
// Writes Baby Analyzer deals to the SHARED Properties tab on the REI Homepage
// Deal Log workbook (GOOGLE_SHEETS_ID) — one operational deal history, not a
// new silo. Reuses the versioned writeProperty pattern from
// rei-auto-offer/services/propertiesWriter.js (copied, not imported,
// re-expressed in ESM). Baby Analyzer rows are stamped last_tool_touch =
// 'baby-analyzer' so they are findable as Baby Analyzer output.
//
// The Properties spine is address-keyed and versioned: re-analyzing the same
// address marks the prior row is_current=FALSE and appends a new current row.

import { getSheets } from './googleClients.js';

const PROPERTIES_TAB = 'Properties';

const COLS = [
  'property_id', 'version', 'is_current', 'edited_on', 'edited_by', 'edit_reason',
  'address', 'city', 'state', 'zip', 'county', 'asset_type',
  'stage', 'stage_changed_on',
  'asking_price', 'arv', 'rehab_estimate', 'noi', 'units', 'monthly_rent',
  'verdict', 'composite_score', 'one_line_summary',
  'drive_folder_url', 'last_tool_touch',
  'source', 'submitter_name', 'submitter_email', 'submitter_phone',
  'internal_notes',
  'verdict_confidence', 'recommended_offer', 'recommended_offer_basis',
  'key_strengths', 'key_risks', 'red_flags',
  'questions_for_review', 'enrichment_log'
];

const META_COLS = new Set(['property_id', 'version', 'is_current', 'edited_on', 'edited_by', 'edit_reason']);

function canonicalAddress(addr) {
  if (!addr) return '';
  return String(addr).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function generatePropertyId() {
  return 'p_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8);
}

function colLetter(n) {
  let s = ''; let x = n;
  while (x >= 0) { s = String.fromCharCode((x % 26) + 65) + s; x = Math.floor(x / 26) - 1; }
  return s;
}

async function readAllRows(sheets) {
  const id = process.env.GOOGLE_SHEETS_ID;
  if (!id) return { error: 'GOOGLE_SHEETS_ID not set' };
  try {
    const res = await sheets.spreadsheets.values.get({
      spreadsheetId: id, range: `'${PROPERTIES_TAB}'!A:ZZ`
    });
    return { rows: res.data.values || [] };
  } catch (e) { return { error: e?.message || 'read failed' }; }
}

function findByAddress(rows, address) {
  const target = canonicalAddress(address);
  if (!target) return { propertyId: null, maxVersion: 0, current: null };
  const addrIdx = COLS.indexOf('address');
  const isCurrentIdx = COLS.indexOf('is_current');
  const propertyIdIdx = COLS.indexOf('property_id');
  const versionIdx = COLS.indexOf('version');
  let propertyId = null, maxVersion = 0, current = null;
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i]; if (!row) continue;
    if (canonicalAddress(row[addrIdx] || '') !== target) continue;
    const v = Number(row[versionIdx] || 0);
    if (v > maxVersion) maxVersion = v;
    if (!propertyId) propertyId = row[propertyIdIdx] || null;
    if (String(row[isCurrentIdx] || '').toUpperCase() === 'TRUE') {
      current = { sheetRowIndex: i + 1, rowData: row };
    }
  }
  return { propertyId, maxVersion, current };
}

async function setIsCurrent(sheets, sheetRowIndex, value) {
  const id = process.env.GOOGLE_SHEETS_ID;
  const letter = colLetter(COLS.indexOf('is_current'));
  try {
    await sheets.spreadsheets.values.update({
      spreadsheetId: id,
      range: `'${PROPERTIES_TAB}'!${letter}${sheetRowIndex}`,
      valueInputOption: 'RAW',
      requestBody: { values: [[value ? 'TRUE' : 'FALSE']] }
    });
    return { ok: true };
  } catch (e) { return { ok: false, error: e?.message || 'set is_current failed' }; }
}

async function appendRow(sheets, rowValues) {
  const id = process.env.GOOGLE_SHEETS_ID;
  try {
    await sheets.spreadsheets.values.append({
      spreadsheetId: id,
      range: `'${PROPERTIES_TAB}'!A:ZZ`,
      valueInputOption: 'USER_ENTERED',
      requestBody: { values: [rowValues] }
    });
    return { ok: true };
  } catch (e) { return { ok: false, error: e?.message || 'append failed' }; }
}

function buildRowFromObject(data) {
  return COLS.map(col => {
    const v = data[col];
    if (v === undefined || v === null) return '';
    return v;
  });
}

// Write a Baby Analyzer deal onto the shared Properties tab.
// `property` is an object keyed by COLS names. Returns { ok, property_id, version } or { ok:false, error }.
export async function writeProperty({ property, editedBy, editReason }) {
  if (!property || !property.address) return { ok: false, error: 'address required' };
  const r = getSheets();
  if (r.error) return { ok: false, error: r.error };
  const sheets = r.sheets;

  const all = await readAllRows(sheets);
  if (all.error) return { ok: false, error: all.error };
  const existing = findByAddress(all.rows, property.address);

  let propertyId, version, inherited = {};
  if (existing.propertyId) {
    propertyId = existing.propertyId;
    version = (existing.maxVersion || 0) + 1;
    if (existing.current) {
      const row = existing.current.rowData;
      COLS.forEach((col, idx) => {
        if (META_COLS.has(col)) return;
        const v = row[idx];
        if (v !== undefined && v !== '') inherited[col] = v;
      });
    }
  } else {
    propertyId = generatePropertyId();
    version = 1;
  }

  if (existing.current) {
    const demote = await setIsCurrent(sheets, existing.current.sheetRowIndex, false);
    if (!demote.ok) return { ok: false, error: 'demote: ' + demote.error };
  }

  const merged = { ...inherited, ...property };
  merged.property_id = propertyId;
  merged.version = version;
  merged.is_current = 'TRUE';
  merged.edited_on = new Date().toISOString();
  merged.edited_by = editedBy || 'baby-analyzer';
  merged.edit_reason = editReason || 'Baby Analyzer analysis';
  merged.last_tool_touch = 'baby-analyzer';

  const append = await appendRow(sheets, buildRowFromObject(merged));
  if (!append.ok) {
    if (existing.current) await setIsCurrent(sheets, existing.current.sheetRowIndex, true).catch(() => {});
    return { ok: false, error: append.error };
  }
  return { ok: true, property_id: propertyId, version };
}

export { COLS, canonicalAddress };
