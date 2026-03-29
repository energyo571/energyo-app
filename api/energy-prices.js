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

  const stromUrl = `https://api.energy-charts.info/price?country=de&start=${fmt(start)}&end=${fmt(end)}`;

  try {
    const stromRes = await fetch(stromUrl);
    if (!stromRes.ok) throw new Error(`Energy-Charts API: ${stromRes.status}`);
    const stromData = await stromRes.json();

    // Group hourly prices into daily averages and convert EUR/MWh → ct/kWh (÷10)
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

    const strom = Object.entries(dailyMap)
      .map(([date, v]) => ({
        date,
        ctKwh: Math.round((v.sum / v.count / 10) * 100) / 100,
      }))
      .sort((a, b) => a.date.localeCompare(b.date));

    res.setHeader("Cache-Control", "s-maxage=3600, stale-while-revalidate=7200");
    return res.status(200).json({
      ok: true,
      strom,
      unit: "ct/kWh",
      source: "Energy-Charts.info (Bundesnetzagentur | SMARD.de)",
      license: "CC BY 4.0",
      period: { start: fmt(start), end: fmt(end) },
    });
  } catch (err) {
    return res.status(502).json({ ok: false, error: err.message || "Fetch failed" });
  }
};
