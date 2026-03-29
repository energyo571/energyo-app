module.exports = async function handler(req, res) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  }

  const months = Math.min(parseInt(req.query?.months, 10) || 12, 24);
  const end = new Date();
  const start = new Date();
  start.setMonth(start.getMonth() - months);

  const fmt = (d) => d.toISOString().split("T")[0];

  // --- Strom: Energy-Charts Day-Ahead -------
  const stromUrl = `https://api.energy-charts.info/price?country=de&start=${fmt(start)}&end=${fmt(end)}`;

  // --- Gas: Yahoo Finance TTF front-month futures ---
  const rangeMap = { 1: "1mo", 3: "3mo", 6: "6mo", 12: "1y", 24: "2y" };
  const yRange = rangeMap[months] || (months <= 6 ? "6mo" : months <= 12 ? "1y" : "2y");
  const gasUrl = `https://query1.finance.yahoo.com/v8/finance/chart/TTF%3DF?range=${yRange}&interval=1d`;

  try {
    const [stromRes, gasRes] = await Promise.all([
      fetch(stromUrl),
      fetch(gasUrl, { headers: { "User-Agent": "Mozilla/5.0" } }),
    ]);

    // --- Process Strom ---
    let strom = [];
    if (stromRes.ok) {
      const stromData = await stromRes.json();
      const dailyMap = {};
      const timestamps = stromData.unix_seconds || [];
      const prices = stromData.price || [];
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

    // --- Process Gas (TTF) ---
    let gas = [];
    if (gasRes.ok) {
      const gasData = await gasRes.json();
      const result = gasData?.chart?.result?.[0];
      if (result) {
        const ts = result.timestamp || [];
        const closes = result.indicators?.quote?.[0]?.close || [];
        for (let i = 0; i < ts.length; i++) {
          const price = closes[i];
          if (price == null || !Number.isFinite(price)) continue;
          const day = new Date(ts[i] * 1000).toISOString().split("T")[0];
          // TTF is in EUR/MWh → convert to ct/kWh (÷10)
          gas.push({ date: day, ctKwh: Math.round((price / 10) * 100) / 100 });
        }
      }
    }

    res.setHeader("Cache-Control", "s-maxage=3600, stale-while-revalidate=7200");
    return res.status(200).json({
      ok: true,
      strom,
      gas,
      unit: "ct/kWh",
      source: "Energy-Charts.info (BNetzA) · TTF (ICE Endex)",
      license: "CC BY 4.0 (Strom)",
      period: { start: fmt(start), end: fmt(end) },
    });
  } catch (err) {
    return res.status(502).json({ ok: false, error: err.message || "Fetch failed" });
  }
};
