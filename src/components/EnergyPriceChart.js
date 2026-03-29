import React, { useState, useEffect, useMemo } from "react";

const API_BASE = process.env.REACT_APP_API_BASE_URL || "";

const MODES = [
  { key: "strom", label: "⚡ Strom", color: "#2563eb", gradId: "epcGradStrom" },
  { key: "gas",   label: "🔥 Gas",   color: "#ea580c", gradId: "epcGradGas"   },
];

function EnergyPriceChart() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [range, setRange] = useState(6); // months
  const [mode, setMode] = useState("strom"); // "strom" | "gas"

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError("");

    fetch(`${API_BASE}/api/energy-prices?months=${range}`)
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then((json) => {
        if (cancelled) return;
        if (!json.ok) throw new Error(json.error || "Fehler");
        setData(json);
      })
      .catch((e) => {
        if (!cancelled) setError(e.message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [range]);

  const modeConfig = MODES.find((m) => m.key === mode);
  const rawPoints = data?.[mode] || [];

  // Downsample to ~60 points for readability
  const chartPoints = useMemo(() => {
    if (rawPoints.length <= 60) return rawPoints;
    const step = Math.max(1, Math.floor(rawPoints.length / 60));
    const sampled = [];
    for (let i = 0; i < rawPoints.length; i += step) sampled.push(rawPoints[i]);
    if (sampled[sampled.length - 1] !== rawPoints[rawPoints.length - 1]) sampled.push(rawPoints[rawPoints.length - 1]);
    return sampled;
  }, [rawPoints]);

  const stats = useMemo(() => {
    if (rawPoints.length < 2) return null;
    const latest = rawPoints[rawPoints.length - 1].ctKwh;
    const oldest = rawPoints[0].ctKwh;
    const max = Math.max(...rawPoints.map((p) => p.ctKwh));
    const min = Math.min(...rawPoints.map((p) => p.ctKwh));
    const avg = rawPoints.reduce((s, p) => s + p.ctKwh, 0) / rawPoints.length;
    const changePct = oldest !== 0 ? ((latest - oldest) / oldest) * 100 : 0;
    return { latest, oldest, max, min, avg: Math.round(avg * 100) / 100, changePct: Math.round(changePct * 10) / 10 };
  }, [rawPoints]);

  // SVG chart dimensions
  const W = 600;
  const H = 180;
  const PAD = { top: 10, right: 10, bottom: 24, left: 40 };
  const cw = W - PAD.left - PAD.right;
  const ch = H - PAD.top - PAD.bottom;

  const svgData = useMemo(() => {
    if (chartPoints.length < 2) return null;
    const vals = chartPoints.map((p) => p.ctKwh);
    const yMin = Math.floor(Math.min(...vals) * 0.9);
    const yMax = Math.ceil(Math.max(...vals) * 1.05);
    const yRange = yMax - yMin || 1;
    const points = chartPoints.map((p, i) => ({
      x: PAD.left + (i / (chartPoints.length - 1)) * cw,
      y: PAD.top + ch - ((p.ctKwh - yMin) / yRange) * ch,
      ...p,
    }));
    const path = points.map((p, i) => `${i === 0 ? "M" : "L"}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ");

    // Y-axis ticks
    const ticks = 5;
    const yTicks = [];
    for (let i = 0; i <= ticks; i++) {
      const val = yMin + (yRange / ticks) * i;
      yTicks.push({ val: Math.round(val * 10) / 10, y: PAD.top + ch - (i / ticks) * ch });
    }

    // X-axis labels (first, middle, last)
    const xLabels = [
      { label: fmtMonth(chartPoints[0].date), x: PAD.left },
      { label: fmtMonth(chartPoints[Math.floor(chartPoints.length / 2)].date), x: PAD.left + cw / 2 },
      { label: fmtMonth(chartPoints[chartPoints.length - 1].date), x: PAD.left + cw },
    ];

    return { points, path, yTicks, xLabels, yMin, yMax };
  }, [chartPoints, cw, ch]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="energy-price-chart">
      <div className="epc-header">
        <div className="epc-mode-btns">
          {MODES.map((m) => (
            <button key={m.key} type="button" className={`epc-mode-btn epc-mode-${m.key}${mode === m.key ? " active" : ""}`} onClick={() => setMode(m.key)}>
              {m.label}
            </button>
          ))}
        </div>
        <div className="epc-range-btns">
          {[3, 6, 12].map((m) => (
            <button key={m} type="button" className={`epc-range-btn${range === m ? " active" : ""}`} onClick={() => setRange(m)}>
              {m}M
            </button>
          ))}
        </div>
      </div>

      {loading && <div className="epc-loading">Lade Preisdaten…</div>}
      {error && <div className="epc-error">{error}</div>}

      {!loading && !error && rawPoints.length < 2 && (
        <div className="epc-error">Keine {mode === "gas" ? "Gas" : "Strom"}-Daten verfügbar</div>
      )}

      {!loading && !error && svgData && stats && (
        <>
          <div className="epc-stats">
            <div className="epc-stat">
              <span className="epc-stat-label">Aktuell</span>
              <strong>{stats.latest.toFixed(1)} ct</strong>
            </div>
            <div className="epc-stat">
              <span className="epc-stat-label">Ø {range}M</span>
              <strong>{stats.avg.toFixed(1)} ct</strong>
            </div>
            <div className="epc-stat">
              <span className="epc-stat-label">Min / Max</span>
              <strong>{stats.min.toFixed(1)} – {stats.max.toFixed(1)} ct</strong>
            </div>
            <div className="epc-stat">
              <span className="epc-stat-label">Veränderung</span>
              <strong className={stats.changePct >= 0 ? "epc-up" : "epc-down"}>
                {stats.changePct >= 0 ? "+" : ""}{stats.changePct}%
              </strong>
            </div>
          </div>
          <svg className="epc-svg" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`${mode === "gas" ? "Gas" : "Strom"}preis-Entwicklung`}>
            {/* Grid lines */}
            {svgData.yTicks.map((t) => (
              <g key={t.val}>
                <line x1={PAD.left} x2={W - PAD.right} y1={t.y} y2={t.y} stroke="#e2e8f0" strokeWidth="1" />
                <text x={PAD.left - 4} y={t.y + 3} textAnchor="end" fontSize="9" fill="#94a3b8">{t.val}</text>
              </g>
            ))}
            {/* X labels */}
            {svgData.xLabels.map((l, i) => (
              <text key={i} x={l.x} y={H - 4} textAnchor={i === 0 ? "start" : i === 2 ? "end" : "middle"} fontSize="9" fill="#94a3b8">{l.label}</text>
            ))}
            {/* Area fill */}
            <path
              d={`${svgData.path} L${(W - PAD.right).toFixed(1)},${(PAD.top + ch).toFixed(1)} L${PAD.left},${(PAD.top + ch).toFixed(1)} Z`}
              fill={`url(#${modeConfig.gradId})`} opacity="0.3"
            />
            {/* Line */}
            <path d={svgData.path} fill="none" stroke={modeConfig.color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            {/* Last-point dot */}
            <circle cx={svgData.points[svgData.points.length - 1].x} cy={svgData.points[svgData.points.length - 1].y} r="3.5" fill={modeConfig.color} />
            <defs>
              <linearGradient id="epcGradStrom" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#3b82f6" />
                <stop offset="100%" stopColor="#3b82f6" stopOpacity="0" />
              </linearGradient>
              <linearGradient id="epcGradGas" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#ea580c" />
                <stop offset="100%" stopColor="#ea580c" stopOpacity="0" />
              </linearGradient>
            </defs>
          </svg>
          <div className="epc-source">
            {mode === "strom"
              ? "Quelle: Energy-Charts.info (SMARD / BNetzA) · CC BY 4.0 · ct/kWh netto (Großhandel Day-Ahead)"
              : "Quelle: TTF Front-Month (ICE Endex) · ct/kWh netto (Großhandel)"}
          </div>
        </>
      )}
    </div>
  );
}

function fmtMonth(dateStr) {
  if (!dateStr) return "";
  const d = new Date(dateStr + "T00:00:00");
  return d.toLocaleDateString("de-DE", { month: "short", year: "2-digit" });
}

export default EnergyPriceChart;
