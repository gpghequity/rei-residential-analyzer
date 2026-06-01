import { uploadDealArtifacts } from './drive.js';
import { writeProperty } from './sheetIndex.js';

// Legacy save endpoint (used by Quick Analysis tab). Saves the analysis JSON to
// the address-keyed Drive folder and records a row on the shared Properties tab.
// Never blocks on persistence failure — returns ok with persistError instead.
export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'POST only' });
  }

  try {
    const { address, propertyName, analysisType, inputs, results, extractedData } = req.body || {};
    if (!address) {
      return res.status(400).json({ error: 'Address is required' });
    }

    const analysis = {
      savedAt: new Date().toISOString(),
      address,
      propertyName,
      analysisType,
      inputs,
      results,
      extractedData: extractedData || {},
      metadata: { tool: 'baby-analyzer', endpoint: 'save-analysis' }
    };

    const drive = await uploadDealArtifacts({
      address,
      propertyType: analysisType,
      artifacts: { 'analysis.json': analysis }
    });

    let sheet = { ok: false, error: 'not attempted' };
    if (drive.ok) {
      sheet = await writeProperty({
        property: {
          address,
          asset_type: analysisType || '',
          one_line_summary: propertyName || '',
          drive_folder_url: drive.url || ''
        },
        editReason: 'Quick Analysis save'
      });
    }

    return res.json({
      ok: true,
      message: `Analysis saved for ${address}`,
      driveUrl: drive.ok ? drive.url : null,
      savedAt: analysis.savedAt,
      persistError: drive.ok ? (sheet.ok ? null : sheet.error) : drive.error
    });
  } catch (err) {
    console.error('Save analysis error:', err.message);
    return res.status(500).json({ error: err.message });
  }
}
