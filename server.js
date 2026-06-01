import express from 'express';
import multer from 'multer';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import calcHandler from './api/calc.js';
import saveAnalysisHandler from './api/save-analysis.js';
import loadAnalysisHandler from './api/load-analysis.js';
import sheetDataHandler from './api/sheetData.js';
import { extractDocs, extractPhotos } from './api/extract.js';
import { enrich } from './api/enrich.js';
import { analyzeDeal, saveReport } from './api/analyzeDeal.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 3000;

// In-memory uploads (forwarded to helpers + Drive; never written to local disk).
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 50 * 1024 * 1024 } });

app.use(express.json({ limit: '8mb' }));

// Serve the built SPA. Hashed JS/CSS can cache forever (their names change on
// every build); index.html must NOT be cached or users keep running an old
// bundle after a deploy.
app.use(express.static(join(__dirname, 'dist'), {
  setHeaders: (res, path) => {
    if (path.endsWith('.html')) res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
  }
}));

// ── Math (frozen bible-math endpoint, reused by the workspace) ──
app.post('/api/calc', (req, res) => calcHandler(req, res));

// ── Orchestration ──
app.post('/api/extract/docs', upload.array('files', 20), (req, res) => extractDocs(req, res));
app.post('/api/extract/photos', upload.array('photos', 30), (req, res) => extractPhotos(req, res));
app.post('/api/enrich', (req, res) => enrich(req, res));
app.post(
  '/api/analyze-deal',
  upload.fields([{ name: 'docs', maxCount: 20 }, { name: 'photos', maxCount: 30 }]),
  (req, res) => analyzeDeal(req, res)
);
app.post('/api/save-report', (req, res) => saveReport(req, res));

// ── Persistence (legacy + pre-fill) ──
app.post('/api/save-analysis', (req, res) => saveAnalysisHandler(req, res));
app.get('/api/load-analysis', (req, res) => loadAnalysisHandler(req, res));
app.get('/api/sheet-data', (req, res) => sheetDataHandler(req, res));

// ── Health ──
app.get('/healthz', (req, res) => {
  res.json({
    ok: true,
    service: 'rei-baby-analyzer',
    google_configured: Boolean(process.env.GOOGLE_SERVICE_ACCOUNT_JSON),
    helpers_configured: Boolean(process.env.REI_OPERATOR_PASSWORD)
  });
});

// SPA fallback — never cache the entry document.
app.get('*', (req, res) => {
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
  res.sendFile(join(__dirname, 'dist', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`Baby Analyzer server running on port ${PORT}`);
});
