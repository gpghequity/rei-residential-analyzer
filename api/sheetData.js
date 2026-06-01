// api/sheetData.js
//
// Resolves the previously-dangling GET /api/sheet-data call in QuickAnalysisTab.
// It is an optional pre-fill hook: if nothing is available it returns an empty
// object (200) so the UI silently proceeds with manual entry. Kept minimal —
// the primary intake path is the Analyze a Deal workspace.
export default async function handler(req, res) {
  return res.status(200).json({});
}
