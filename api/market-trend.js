const { getDb } = require("./_lib/firebaseAdmin");
const { rateLimit } = require("./_lib/rateLimit");
const { verifyAuth } = require("./_lib/auth");

function toIsoDay(date = new Date()) {
  return date.toISOString().split("T")[0];
}

function parseNumber(value) {
  const num = Number.parseFloat(String(value ?? "").replace(",", "."));
  return Number.isFinite(num) ? num : null;
}

function extractTrendPct(payload) {
  if (!payload || typeof payload !== "object") return null;

  const directKeys = [
    "trendPct",
    "marketTrendPct",
    "pct30d",
    "changePct",
    "change_percent",
    "changePercent",
  ];

  for (const key of directKeys) {
    const value = parseNumber(payload[key]);
    if (value !== null) return value;
  }

  const currentPrice = parseNumber(payload.currentPrice ?? payload.priceNow ?? payload.latestPrice);
  const oldPrice = parseNumber(payload.price30dAgo ?? payload.priceOld ?? payload.previousPrice);
  if (currentPrice !== null && oldPrice !== null && oldPrice !== 0) {
    return ((currentPrice - oldPrice) / oldPrice) * 100;
  }

  return null;
}

async function fetchMarketTrendFromApi() {
  const url = process.env.MARKET_TREND_API_URL;
  if (!url) return null;

  const headers = { "Content-Type": "application/json" };
  const apiKey = process.env.MARKET_TREND_API_KEY;
  const keyHeader = process.env.MARKET_TREND_API_KEY_HEADER || "x-api-key";
  if (apiKey) headers[keyHeader] = apiKey;

  const response = await fetch(url, { method: "GET", headers });
  if (!response.ok) {
    throw new Error(`MARKET_TREND_API_URL failed with ${response.status}`);
  }

  const data = await response.json();
  const trendPct = extractTrendPct(data);
  if (trendPct === null) {
    throw new Error("Could not parse trend percent from MARKET_TREND_API_URL response");
  }

  return {
    trendPct,
    source: data?.source || "market-api",
    raw: data,
  };
}

function fallbackTrend() {
  const envTrend = parseNumber(process.env.MARKET_TREND_PCT ?? process.env.REACT_APP_MARKET_TREND_PCT);
  if (envTrend === null) return null;
  return {
    trendPct: envTrend,
    source: "env-fallback",
    raw: null,
  };
}

async function loadRecentHistory(db, limit = 7) {
  if (!db) return [];
  const snap = await db
    .collection("marketTrendSnapshots")
    .orderBy("asOf", "desc")
    .limit(limit)
    .get();

  if (snap.empty) return [];

  return snap.docs
    .map((doc) => {
      const data = doc.data() || {};
      return {
        asOf: data.asOf || doc.id,
        trendPct: typeof data.trendPct === "number" ? data.trendPct : parseNumber(data.trendPct),
      };
    })
    .filter((item) => Number.isFinite(item.trendPct) && !!item.asOf)
    .sort((a, b) => a.asOf.localeCompare(b.asOf));
}

module.exports = async function handler(req, res) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  }

  if (rateLimit(req, res, { max: 30, windowMs: 60_000 })) return;

  const user = await verifyAuth(req, res);
  if (!user) return;

  const today = toIsoDay();
  const forceRefresh = String(req.query?.refresh || "") === "1";

  try {
    let db = null;
    try {
      db = getDb();
    } catch (_) {
      db = null;
    }

    if (db && !forceRefresh) {
      const existingSnap = await db.collection("marketTrendSnapshots").doc(today).get();
      if (existingSnap.exists) {
        const existing = existingSnap.data() || {};
        const history = await loadRecentHistory(db, 7);
        return res.status(200).json({
          ok: true,
          trendPct: existing.trendPct,
          source: existing.source || "snapshot",
          asOf: existing.asOf || today,
          cached: true,
          history,
        });
      }
    }

    let trend = null;
    try {
      trend = await fetchMarketTrendFromApi();
    } catch (err) {
      trend = null;
      console.warn("market-trend api fetch failed", err?.message || err);
    }

    if (!trend) trend = fallbackTrend();
    if (!trend) {
      return res.status(503).json({
        ok: false,
        error: "No trend source configured",
        hint: "Set MARKET_TREND_API_URL (preferred) or MARKET_TREND_PCT",
      });
    }

    const payload = {
      trendPct: Math.round(trend.trendPct * 100) / 100,
      source: trend.source,
      asOf: today,
      updatedAt: new Date().toISOString(),
    };

    if (db) {
      await db.collection("marketTrendSnapshots").doc(today).set(payload, { merge: true });
    }

    const history = db ? await loadRecentHistory(db, 7) : [{ asOf: payload.asOf, trendPct: payload.trendPct }];

    return res.status(200).json({
      ok: true,
      ...payload,
      cached: false,
      history,
    });
  } catch (error) {
    console.error("market-trend error", error);
    return res.status(500).json({ ok: false, error: "Failed to resolve market trend" });
  }
};
