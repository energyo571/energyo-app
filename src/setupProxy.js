/**
 * CRA dev-server proxy – serves /api/energy-prices locally so the
 * EnergyPriceChart works without Vercel.  In production the Vercel
 * serverless function (api/energy-prices.js) handles the same route.
 */
module.exports = function (app) {
  app.get("/api/energy-prices", async (req, res) => {
    const months = Math.min(parseInt(req.query?.months, 10) || 12, 24);
    const end = new Date();
    const start = new Date();
    start.setMonth(start.getMonth() - months);

    const fmt = (d) => d.toISOString().split("T")[0];
    const stromUrl = `https://api.energy-charts.info/price?country=de&start=${fmt(start)}&end=${fmt(end)}`;

    const rangeMap = { 3: "3mo", 6: "6mo", 12: "1y" };
    const yRange = rangeMap[months] || `${months}mo`;
    const gasUrl = `https://query1.finance.yahoo.com/v8/finance/chart/TTF%3DF?range=${yRange}&interval=1d`;

    try {
      const [stromApiRes, gasApiRes] = await Promise.all([
        fetch(stromUrl),
        fetch(gasUrl, { headers: { "User-Agent": "Mozilla/5.0" } }),
      ]);

      // --- Strom ---
      let strom = [];
      if (stromApiRes.ok) {
        const raw = await stromApiRes.json();
        const dailyMap = {};
        const timestamps = raw.unix_seconds || [];
        const prices = raw.price || [];
        for (let i = 0; i < timestamps.length; i++) {
          const price = prices[i];
          if (price == null || !Number.isFinite(price)) continue;
          const day = new Date(timestamps[i] * 1000).toISOString().split("T")[0];
          if (!dailyMap[day]) dailyMap[day] = { sum: 0, count: 0 };
          dailyMap[day].sum += price;
          dailyMap[day].count += 1;
        }
        strom = Object.entries(dailyMap)
          .map(([date, v]) => ({
            date,
            ctKwh: Math.round((v.sum / v.count / 10) * 100) / 100,
          }))
          .sort((a, b) => a.date.localeCompare(b.date));
      }

      // --- Gas (TTF) ---
      let gas = [];
      if (gasApiRes.ok) {
        const gasData = await gasApiRes.json();
        const result = gasData?.chart?.result?.[0];
        if (result) {
          const ts = result.timestamp || [];
          const closes = result.indicators?.quote?.[0]?.close || [];
          for (let i = 0; i < ts.length; i++) {
            const price = closes[i];
            if (price == null || !Number.isFinite(price)) continue;
            const day = new Date(ts[i] * 1000).toISOString().split("T")[0];
            gas.push({ date: day, ctKwh: Math.round((price / 10) * 100) / 100 });
          }
        }
      }

      res.json({
        ok: true,
        strom,
        gas,
        unit: "ct/kWh",
        source: "Energy-Charts.info (BNetzA) · TTF (ICE Endex)",
        license: "CC BY 4.0 (Strom)",
        period: { start: fmt(start), end: fmt(end) },
      });
    } catch (err) {
      res.status(502).json({ ok: false, error: err.message || "Fetch failed" });
    }
  });
};
