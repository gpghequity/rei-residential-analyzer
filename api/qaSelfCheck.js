// api/qaSelfCheck.js
//
// READ-ONLY persistence diagnostic for the QA Runner. Confirms the Drive folder
// and the shared Properties sheet are reachable by the service account WITHOUT
// writing anything — so the QA harness can prove "saves to Drive / writes the
// Properties row" connectivity without polluting the live deal log with test rows.
//
// Never throws — always returns a JSON object describing what is/ isn't wired.

import { getDrive, getSheets, googleConfigured } from './googleClients.js';

export async function qaSelfCheck(req, res) {
  const out = {
    ok: false,
    google_configured: googleConfigured(),
    impersonate_user: Boolean(process.env.IMPERSONATE_USER),
    drive: { configured: Boolean(process.env.GOOGLE_DRIVE_PARENT_FOLDER_ID), ok: false },
    sheet: { configured: Boolean(process.env.GOOGLE_SHEETS_ID), ok: false }
  };

  // Drive: read the parent folder's metadata (read-only).
  try {
    const parent = process.env.GOOGLE_DRIVE_PARENT_FOLDER_ID;
    if (!parent) {
      out.drive.error = 'GOOGLE_DRIVE_PARENT_FOLDER_ID not set';
    } else {
      const d = getDrive();
      if (d.error) {
        out.drive.error = d.error;
      } else {
        const meta = await d.drive.files.get({ fileId: parent, fields: 'id, name', supportsAllDrives: true });
        out.drive.ok = true;
        out.drive.parentFolderId = parent;
        out.drive.parentFolderName = meta.data.name;
      }
    }
  } catch (e) {
    out.drive.error = e?.message || 'drive check failed';
  }

  // Sheet: read the Properties header row (read-only) and confirm the spine columns.
  try {
    const id = process.env.GOOGLE_SHEETS_ID;
    if (!id) {
      out.sheet.error = 'GOOGLE_SHEETS_ID not set';
    } else {
      const s = getSheets();
      if (s.error) {
        out.sheet.error = s.error;
      } else {
        const hdr = await s.sheets.spreadsheets.values.get({ spreadsheetId: id, range: `'Properties'!A1:AZ1` });
        const header = (hdr.data.values && hdr.data.values[0]) || [];
        out.sheet.ok = header.length > 0 && header.includes('property_id') && header.includes('address');
        out.sheet.headerCols = header.length;
        out.sheet.hasSpine = header.includes('property_id') && header.includes('address') && header.includes('verdict');
      }
    }
  } catch (e) {
    out.sheet.error = e?.message || 'sheet check failed';
  }

  out.ok = out.drive.ok && out.sheet.ok;
  return res.status(200).json(out);
}
