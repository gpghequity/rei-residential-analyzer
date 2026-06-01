// api/googleClients.js
//
// Shared Google auth for Baby Analyzer's data layer (Drive + Sheets).
//
// Platform convention (copied, not imported — isolation-first): authenticate
// with a service account via the GOOGLE_SERVICE_ACCOUNT_JSON env var using
// google.auth.JWT. Clients are cached per-credential so a warm server reuses
// them across requests.
//
// Source pattern: rei-auto-offer/services/propertiesWriter.js (buildAuth/getSheets)
// and rei-email-intake/services/folderLookup.js. Re-expressed in ESM because
// this repo is "type":"module".

import { google } from 'googleapis';

const SCOPES = [
  'https://www.googleapis.com/auth/spreadsheets',
  'https://www.googleapis.com/auth/drive'
];

let _auth = null;
let _fingerprint = null;
let _sheets = null;
let _drive = null;

function buildAuth() {
  const json = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  if (!json) return { error: 'GOOGLE_SERVICE_ACCOUNT_JSON not set' };
  let creds;
  try {
    creds = JSON.parse(json);
  } catch (e) {
    return { error: 'GOOGLE_SERVICE_ACCOUNT_JSON parse: ' + e.message };
  }
  if (!creds.client_email || !creds.private_key) {
    return { error: 'GOOGLE_SERVICE_ACCOUNT_JSON missing client_email/private_key' };
  }
  if (_auth && _fingerprint === creds.client_email) {
    return { auth: _auth, fingerprint: creds.client_email };
  }
  _auth = new google.auth.JWT({
    email: creds.client_email,
    key: creds.private_key,
    scopes: SCOPES
  });
  _fingerprint = creds.client_email;
  // Clients depend on auth — drop caches so they rebind to the new auth.
  _sheets = null;
  _drive = null;
  return { auth: _auth, fingerprint: creds.client_email };
}

export function getSheets() {
  const r = buildAuth();
  if (r.error) return { error: r.error };
  if (!_sheets) _sheets = google.sheets({ version: 'v4', auth: r.auth });
  return { sheets: _sheets };
}

export function getDrive() {
  const r = buildAuth();
  if (r.error) return { error: r.error };
  if (!_drive) _drive = google.drive({ version: 'v3', auth: r.auth });
  return { drive: _drive };
}

// True when the data layer is configured enough to persist anything.
export function googleConfigured() {
  return Boolean(process.env.GOOGLE_SERVICE_ACCOUNT_JSON);
}
