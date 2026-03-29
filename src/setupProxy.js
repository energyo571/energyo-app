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
    const url = `https://api.energy-charts.info/price?country=de&start=${fmt(start)}&end=${fmt(end)}`;

    try {
      const apiRes = await fetch(url);
      if (!apiRes.ok) throw new Error(`Energy-Charts API: ${apiRes.status}`);
      const raw = await apiRes.json();

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

      const strom = Object.entries(dailyMap)
        .map(([date, v]) => ({
          date,
          ctKwh: Math.round((v.sum / v.count / 10) * 100) / 100,
        }))
        .sort((a, b) => a.date.localeCompare(b.date));

      res.json({
        ok: true,
        strom,
        unit: "ct/kWh",
        source: "Energy-Charts.info (Bundesnetzagentur | SMARD.de)",
        license: "CC BY 4.0",
        period: { start: fmt(start), end: fmt(end) },
      });
    } catch (err) {
      res.status(502).json({ ok: false, error: err.message || "Fetch failed" });
    }
  });
};
