/**
 * Lightweight Express server that mounts the Vercel-style API handlers
 * for local / Docker development. CRA's proxy forwards /api/* requests here.
 */
const express = require("express");
const app = express();

app.use(express.json());

// Helper: mount a handler, skip gracefully if require fails ---------------
function mount(route, modulePath) {
  try {
    const handler = require(modulePath);
    app.all(route, (req, res) => handler(req, res));
    app.all(route + ".js", (req, res) => handler(req, res));
  } catch (err) {
    console.warn(`[dev-api-server] Skipping ${route}: ${err.message}`);
    app.all(route, (_req, res) => res.status(503).json({ ok: false, error: `Handler not available: ${err.message}` }));
  }
}

mount("/api/tariff-reference",  "./api/tariff-reference");
mount("/api/ai-proxy",          "./api/ai-proxy");
mount("/api/calendly-webhook",  "./api/calendly-webhook");
mount("/api/market-trend",      "./api/market-trend");

const PORT = process.env.API_PORT || 3002;
app.listen(PORT, "0.0.0.0", () => {
  console.log(`[dev-api-server] API running on http://0.0.0.0:${PORT}`);
});
