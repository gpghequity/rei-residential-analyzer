// api/analyzeDeal.js
//
// The orchestrator. Keeps the user inside Baby Analyzer: one request fans out
// to the extractor (docs), the photo analyzer (photos), and the comp service,
// stores the raw uploads + raw findings in the address-keyed Drive folder, and
// returns the RAW data to the browser. Math + recommendation are computed by
// the browser using the existing bible-math /api/calc endpoint (no new math,
// no drift), then persisted via saveReport().
//
// Two endpoints:
//   POST /api/analyze-deal  (multipart: docs[], photos[], meta JSON)
//       → stores raw files, calls helpers, returns { extracted, photos, comps, driveUrl }
//   POST /api/save-report   (JSON: folderId, sheet fields, report, reportHtml)
//       → stores report.html + analysis.json, writes the shared Properties row

import { findOrCreateDealFolder, uploadFile } from './drive.js';
import { writeProperty } from './sheetIndex.js';
import { extractDocsCore, extractPhotosCore } from './extract.js';
import { enrichCore } from './enrich.js';
import { expandZips } from './unzipFiles.js';

function parseMeta(req) {
  const raw = req.body?.meta;
  if (!raw) return {};
  if (typeof raw === 'object') return raw;
  try { return JSON.parse(raw); } catch { return {}; }
}

export async function analyzeDeal(req, res) {
  try {
    const meta = parseMeta(req);
    const { propertyType, address, city, state, zip, beds, baths, sqft, dealType } = meta;
    if (!address) return res.status(400).json({ ok: false, error: 'address required in meta' });

    // Expand .zip files into individual docs/photos
    let docs = (req.files?.docs) || [];
    let photos = (req.files?.photos) || [];
    docs = await expandZips(docs);
    photos = await expandZips(photos);

    // 1) Folder (best-effort — analysis must not block on storage)
    const folder = await findOrCreateDealFolder(address, propertyType);
    const folderId = folder.ok ? folder.folderId : null;
    const driveUrl = folder.ok ? folder.url : null;
    const persistErrors = [];
    if (!folder.ok) persistErrors.push('folder: ' + folder.error);

    // 2) Store raw uploads
    if (folderId) {
      for (const f of [...docs, ...photos]) {
        const u = await uploadFile(folderId, { name: f.originalname || 'upload', mimeType: f.mimetype, body: f.buffer });
        if (!u.ok) persistErrors.push(`store ${f.originalname}: ${u.error}`);
      }
    }

    // 3) Helpers (raw data only — no conclusions)
    const extracted = docs.length ? await extractDocsCore(docs, { dealType, propertyAddress: address }) : null;
    const photoFindings = photos.length ? await extractPhotosCore(photos, { manualSqft: sqft, propertyAddress: address }) : null;
    const comps = await enrichCore({ address, city, state, zip, beds, baths, sqft, assetType: propertyType });

    // 4a) EVALUATOR INTEGRATION: Call Market Reality Engine with comprehensive market data
    let riskAnalysis = null;
    try {
      const evalPayload = {
        address: meta.propertyAddress || address,
        dealType: meta.propertyType || 'unknown',
        babyAnalyzerOutput: {
          inputs: {
            occupancy: meta.occupancy || extracted?.occupancy || 0,
            economicOccancy: meta.economicOccupancy || extracted?.economicOccupancy || 0,
            noi: meta.noi || extracted?.brokerNOI || 0,
            capRate: meta.capRate || 0,
            units: meta.totalUnits || extracted?.units || 0,
            sqft: meta.netRentableSqft || extracted?.sqft || 0
          },
          extracted: extracted ? {
            economicOccupancy: extracted.economicOccupancy,
            occupancy: extracted.occupancy,
            noi: extracted.brokerNOI,
            units: extracted.units,
            redFlags: extracted.redFlags
          } : {},
          isIncome: meta.propertyType && ['storage', 'multifamily', 'commercial', 'mhp', 'rv_park', 'ios'].includes(meta.propertyType)
        },
        demographic: {
          currentPopulation: comps?.demographics?.population,
          medianIncome: comps?.demographics?.medianIncome,
          povertyRate: comps?.demographics?.povertyRate,
          avgHouseholdSize: null,
          priorPopulation: null,
          projectedPopulation: null,
          householdGrowth: null
        },
        supply: {
          saturation: comps?.avm ? 'Adequate' : 'Unknown',
          existingSupply: null,
          underConstruction: null,
          sfPerCapita3Mile: null
        },
        demand: {
          overall: comps?.avm?.rent_estimate ? 'Average' : 'Unknown',
          population: 'unknown',
          household: 'unknown',
          employment: 'unknown',
          business: 'unknown',
          housing: null,
          occupancy: meta.occupancy || extracted?.occupancy
        },
        crime: comps?.crime ? {
          riskLevel: comps.crime.score > 60 ? 'high' : comps.crime.score > 40 ? 'elevated' : 'low',
          score: comps.crime.score,
          label: comps.crime.label
        } : {},
        flood: comps?.flood || {},
        environmental: {},
        housing: {},
        commercial: {},
        employment: {},
        income: {
          medianHouseholdIncome: comps?.demographics?.medianIncome,
          growthRate: null
        },
        docs: docs.map(d => d.originalname || 'doc'),
        sellerClaims: {
          rentGrowth: (meta.capRate > 0) || (extracted?.brokerNOI > 0),
          occupancy: (meta.occupancy > 80) || (extracted?.occupancy > 80),
          marketGrowth: false,
          supplyConstrained: false
        }
      };
      const evalRes = await fetch('https://rei-deal-risk-intelligence-production.up.railway.app/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(evalPayload),
        timeout: 15000
      });
      if (evalRes.ok) {
        const evalRaw = await evalRes.json();
        // Map evaluator response to Baby Analyzer's expected format
        const rec = evalRaw.recommendation || {};
        const score = rec.score || 0;

        // Generate red flags from scorecard breakdown
        const redFlags = [];
        if (evalRaw.scorecard?.scores) {
          const scores = evalRaw.scorecard.scores;
          if (scores.crime <= 2) redFlags.push({ category: 'Crime', severity: 'High', message: 'High crime rate in area' });
          if (scores.population <= 2) redFlags.push({ category: 'Population', severity: 'Medium', message: 'Declining or stagnant population' });
          if (scores.demand <= 3) redFlags.push({ category: 'Demand', severity: 'Medium', message: 'Weak buyer/tenant demand' });
          if (scores.supply <= 3 && scores.supply > 0) redFlags.push({ category: 'Supply', severity: 'Medium', message: 'Oversupplied market' });
          if (scores.income <= 3) redFlags.push({ category: 'Income', severity: 'Medium', message: 'Low median household income' });
        }

        riskAnalysis = {
          riskRating: score >= 85 ? 'Low' : score >= 70 ? 'Low' : score >= 50 ? 'Elevated' : 'High',
          confidence: evalRaw.transparency?.confidenceLevel || 'Medium',
          redFlagsCount: redFlags.length,
          topRedFlags: redFlags.slice(0, 3),
          topPositives: (evalRaw.evidence?.opportunities || []).slice(0, 3),
          documentationStatus: {
            received: evalRaw.transparency?.basedOn || [],
            missing: evalRaw.transparency?.morePreciseWith || []
          },
          score: score,
          recommendation: rec.recommendation,
          basis: rec.basis,
          transparency: evalRaw.transparency,
          raw: evalRaw
        };
      }
    } catch (evalErr) {
      console.warn('[EVALUATOR] Market Reality Engine failed (non-blocking):', evalErr.message);
      // Market analysis is optional — don't block deal analysis
    }

    // 4b) Store raw findings as JSON artifacts (including risk analysis)
    if (folderId) {
      const artifacts = { 'extracted.json': extracted, 'photos.json': photoFindings, 'comps.json': comps, 'risk.json': riskAnalysis };
      for (const [name, value] of Object.entries(artifacts)) {
        if (value == null) continue;
        const u = await uploadFile(folderId, { name, mimeType: 'application/json', body: JSON.stringify(value, null, 2) });
        if (!u.ok) persistErrors.push(`artifact ${name}: ${u.error}`);
      }
    }

    return res.status(200).json({
      ok: true,
      folderId,
      driveUrl,
      extracted,
      photos: photoFindings,
      comps,
      risk: riskAnalysis,
      uploadsStored: { docs: docs.length, photos: photos.length },
      persistError: persistErrors.length ? persistErrors.join('; ') : null
    });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e?.message || 'analyze-deal failed' });
  }
}

// Persist the computed report + write the shared Properties row.
export async function saveReport(req, res) {
  try {
    const b = req.body || {};
    const { folderId, address, propertyType, sheet, analysis, reportHtml, user, contact } = b;
    if (!address) return res.status(400).json({ ok: false, error: 'address required' });

    const persistErrors = [];

    // Store the report + full analysis JSON in the deal folder
    let fid = folderId;
    if (!fid) {
      const folder = await findOrCreateDealFolder(address, propertyType);
      if (folder.ok) fid = folder.folderId; else persistErrors.push('folder: ' + folder.error);
    }
    if (fid) {
      if (reportHtml) {
        const u = await uploadFile(fid, { name: 'report.html', mimeType: 'text/html', body: String(reportHtml) });
        if (!u.ok) persistErrors.push('report.html: ' + u.error);
      }
      if (analysis) {
        const u = await uploadFile(fid, { name: 'analysis.json', mimeType: 'application/json', body: JSON.stringify(analysis, null, 2) });
        if (!u.ok) persistErrors.push('analysis.json: ' + u.error);
      }
    }

    // Write the shared Properties row (one operational deal history)
    const driveUrl = fid ? `https://drive.google.com/drive/folders/${fid}` : '';
    const property = {
      address,
      asset_type: propertyType || '',
      drive_folder_url: driveUrl,
      source: 'baby-analyzer',
      submitter_name: user || '',
      submitter_email: contact || '',
      ...(sheet || {})
    };
    const w = await writeProperty({ property, editedBy: user || 'baby-analyzer', editReason: 'Baby Analyzer analysis' });
    if (!w.ok) persistErrors.push('sheet: ' + w.error);

    return res.status(200).json({
      ok: true,
      driveUrl: driveUrl || null,
      property_id: w.ok ? w.property_id : null,
      version: w.ok ? w.version : null,
      persistError: persistErrors.length ? persistErrors.join('; ') : null
    });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e?.message || 'save-report failed' });
  }
}
