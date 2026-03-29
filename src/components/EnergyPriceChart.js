import React, { useState, useEffect, useMemo } from "react";

const API_BASE = process.env.REACT_APP_API_BASE_URL || "";

const CHANNELS = [
  { key: "strom", label: "Strom", color: "#2563eb", gradId: "epcGradStrom" },
  { key: "gas",   label: "Gas",   color: "#ea580c", gradId: "epcGradGas"   },
];

function EnergyPriceChart() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [range, setRange] = useState(6);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError("");
    fetch(`${API_BASE}/api/energy-prices?months=${range}`)
      .then((r) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); })
      .then((json) => { if (cancelled) return; if (!json.ok) throw new Error(json.error || "Fehler"); setData(json); })
      .catch((e) => { if (!cancelled) setError(e.message); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [range]);

  return (
    <div className="epc-dual">
      <div className="epc-dual-header">
        <span className="epc-dual-title">Energiepreise</span>
        <div className="epc-range-btns">
          {[3, 6, 12].map((m) => (
            <button key={m} type="button" className={`epc-range-btn${range === m ? " active" : ""}`} onClick={() => setRange(m)}>{m}M</button>
          ))}
        </div>
      </div>
      {loading && <div className="epc-loading">Lade Preisdaten…</div>}
      {error && <div className="epc-error">{error}</div>}
      {!loading && !error && (
        <div className="epc-dual-row">
          {CHANNELS.map((ch) => (
            <SparkCard key={ch.key} channel={ch} rawPoints={data?.[ch.key] || []} range={range} />
          ))}
        </div>
      )}
    </div>
  );
}

/* ── Single spark card (Strom or Gas) ── */
function SparkCard({ channel, rawPoints, range }) {
  const pts = useMemo(() => {
    if (rawPoints.length <= 60) return rawPoints;
    const step = Math.max(1, Math.floor(rawPoints.length / 60));
    const s = [];
    for (let i = 0; i < rawPoints.length; i += step) s.push(rawPoints[i]);
    if (s[s.length - 1] !== rawPoints[rawPoints.length - 1]) s.push(rawPoints[rawPoints.length - 1]);
    return s;
  }, [rawPoints]);

  const stats = useMemo(() => {
    if (rawPoints.length < 2) return null;
    const latest = rawPoints[rawPoints.length - 1].ctKwh;
    const oldest = rawPoints[0].ctKwh;
    const max = Math.max(...rawPoints.map((p) => p.ctKwh));
    const min = Math.min(...rawPoints.map((p) => p.ctKwh));
    const avg = rawPoints.reduce((s, p) => s + p.ctKwh, 0) / rawPoints.length;
    const changePct = oldest !== 0 ? ((latest - oldest) / oldest) * 100 : 0;
    return { latest, max, min, avg: Math.round(avg * 100) / 100, changePct: Math.round(changePct * 10) / 10 };
  }, [rawPoints]);

  const W = 200, H = 48, PAD = 2;
  const svgPath = useMemo(() => {
    if (pts.length < 2) return null;
    const vals = pts.map((p) => p.ctKwh);
    const yMin = Math.min(...vals), yMax = Math.max(...vals);
    const yR = yMax - yMin || 1;
    const points = pts.map((p, i) => ({
      x: PAD + (i / (pts.length - 1)) * (W - PAD * 2),
      y: PAD + (H - PAD * 2) - ((p.ctKwh - yMin) / yR) * (H - PAD * 2),
    }));
    const line = points.map((p, i) => `${i === 0 ? "M" : "L"}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ");
    const area = `${line} L${(W - PAD).toFixed(1)},${(H - PAD).toFixed(1)} L${PAD},${(H - PAD).toFixed(1)} Z`;
    return { line, area, last: points[points.length - 1] };
  }, [pts]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!stats) return <div className="epc-spark-card"><span className="epc-spark-label">{channel.label}</span><span className="epc-no-data">Keine Daten</span></div>;

  return (
    <div className="epc-spark-card">
      <div className="epc-spark-head">
        <span className="epc-spark-label">{channel.label}</span>
        <strong className="epc-spark-price">{stats.latest.toFixed(1)} <small>ct/kWh</small></strong>
        <span className={`epc-spark-change ${stats.changePct >= 0 ? "up" : "down"}`}>
          {stats.changePct >= 0 ? "↑" : "↓"} {Math.abs(stats.changePct)}%
        </span>
      </div>
      <svg className="epc-spark-svg" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none">
        <defs>
          <linearGradient id={channel.gradId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={channel.color} stopOpacity="0.18" />
            <stop offset="100%" stopColor={channel.color} stopOpacity="0" />
          </linearGradient>
        </defs>
        {svgPath && <>
          <path d={svgPath.area} fill={`url(#${channel.gradId})`} />
          <path d={svgPath.line} fill="none" stroke={channel.color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          <circle cx={svgPath.last.x} cy={svgPath.last.y} r="2.5" fill={channel.color} />
        </>}
      </svg>
      <div className="epc-spark-meta">
        <span>Ø {range}M: {stats.avg.toFixed(1)} ct</span>
        <span>{stats.min.toFixed(1)} – {stats.max.toFixed(1)} ct</span>
      </div>
      <div className="epc-spark-source">
        {channel.key === "strom"
          ? "SMARD / BNetzA · Day-Ahead"
          : "TTF Front-Month · ICE Endex"}
      </div>
    </div>
  );
}

export default EnergyPriceChart;
