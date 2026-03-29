import React, { useState, useEffect, useCallback, useMemo } from "react";
import { STATUS_OPTIONS } from "../constants";
import { formatDate } from "../utils/dates";
import { formatEuro, getClosingRateClass } from "../utils/format";
import { calculateUmsatzPotential } from "../utils/energy";

function Dashboard({ leads, teamMembers, userRole }) {
  const [trendInfo, setTrendInfo] = useState(null);
  const [trendHistory, setTrendHistory] = useState([]);
  const [trendLoading, setTrendLoading] = useState(false);
  const [trendError, setTrendError] = useState("");

  const loadMarketTrend = useCallback(async (forceRefresh = false) => {
    setTrendLoading(true);
    setTrendError("");
    try {
      const response = await fetch(`/api/market-trend${forceRefresh ? "?refresh=1" : ""}`);
      const data = await response.json();
      if (!response.ok || !data?.ok) {
        throw new Error(data?.error || "Trendquelle nicht erreichbar");
      }
      setTrendInfo({
        trendPct: data.trendPct,
        source: data.source || "unknown",
        asOf: data.asOf || "",
        updatedAt: data.updatedAt || "",
        cached: !!data.cached,
      });
      setTrendHistory(Array.isArray(data.history) ? data.history : []);
    } catch (error) {
      setTrendError(error?.message || "Trend konnte nicht geladen werden");
    } finally {
      setTrendLoading(false);
    }
  }, []);

  useEffect(() => {
    loadMarketTrend(false);
  }, [loadMarketTrend]);

  const stats = useMemo(() => {
    const byStatus = STATUS_OPTIONS.map(s => ({ label: s, count: leads.filter(l => l.status === s).length }));
    const topPerformer = teamMembers.map(m => {
      const ml = leads.filter(l => l.createdBy?.email === m.email);
      return { email: m.email, role: m.role, total: ml.length, won: ml.filter(l => l.status === "Abschluss").length, umsatz: ml.reduce((s, l) => s + calculateUmsatzPotential(l.consumption), 0) };
    }).sort((a, b) => b.won - a.won);
    const totalUmsatz = leads.reduce((s, l) => s + calculateUmsatzPotential(l.consumption), 0);
    const wonLeads = leads.filter(l => l.status === "Abschluss").length;
    const closingRate = leads.length > 0 ? Math.round((wonLeads / leads.length) * 100) : 0;
    return { byStatus, topPerformer, totalUmsatz, wonLeads, closingRate };
  }, [leads, teamMembers]);

  const maxCount = Math.max(...stats.byStatus.map(s => s.count), 1);
  const statusColors = { Neu: "#6c757d", Kontaktiert: "#0d6efd", Angebot: "#fd7e14", "Follow-up": "#ffc107", Abschluss: "#198754", Verloren: "#dc3545" };
  const trendSparkline = useMemo(() => {
    const points = trendHistory.filter((item) => Number.isFinite(item?.trendPct));
    if (points.length < 2) return null;

    const width = 280;
    const height = 64;
    const padding = 8;
    const values = points.map((p) => p.trendPct);
    const min = Math.min(...values);
    const max = Math.max(...values);
    const span = Math.max(0.001, max - min);

    const svgPoints = points.map((point, idx) => {
      const x = padding + (idx * (width - padding * 2)) / Math.max(1, points.length - 1);
      const y = height - padding - ((point.trendPct - min) / span) * (height - padding * 2);
      return { x, y, value: point.trendPct, asOf: point.asOf };
    });

    return {
      width,
      height,
      path: svgPoints.map((p, idx) => `${idx === 0 ? "M" : "L"}${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(" "),
      points: svgPoints,
    };
  }, [trendHistory]);

  return (
    <div className="dashboard-grid">
      <div className="card dashboard-card">
        <h2>📊 Leads nach Status</h2>
        <div className="bar-chart">
          {stats.byStatus.map(s => (
            <div key={s.label} className="bar-row">
              <span className="bar-label">{s.label}</span>
              <div className="bar-track"><div className="bar-fill" style={{ width: `${(s.count / maxCount) * 100}%`, background: statusColors[s.label] || "#0d6efd" }} /></div>
              <span className="bar-count">{s.count}</span>
            </div>
          ))}
        </div>
        <div className="dashboard-summary">
          <div className="summary-item"><span>Closing rate</span><strong className={getClosingRateClass(stats.closingRate)}>{stats.closingRate}%</strong></div>
          <div className="summary-item"><span>Abschlüsse</span><strong>{stats.wonLeads}</strong></div>
          <div className="summary-item"><span>Umsatzpotenzial</span><strong className="kpi-success">{formatEuro(stats.totalUmsatz)}</strong></div>
        </div>
      </div>
      <div className="card dashboard-card">
        <h2>🏆 Top-Performer</h2>
        {stats.topPerformer.length === 0 ? (
          <p className="empty-text">Noch keine Teammitglieder</p>
        ) : (
          <div className="performer-list">
            {stats.topPerformer.map((p, idx) => (
              <div key={p.email} className={`performer-item rank-${idx + 1}`}>
                <div className="performer-rank">{idx === 0 ? "🥇" : idx === 1 ? "🥈" : idx === 2 ? "🥉" : `#${idx + 1}`}</div>
                <div className="performer-info">
                  <span className="performer-email">{p.email}</span>
                  <span className="performer-role">{p.role === "admin" ? "👑 Admin" : "Agent"}</span>
                </div>
                <div className="performer-stats">
                  <span title="Leads">📋 {p.total}</span>
                  <span title="Abschlüsse">✅ {p.won}</span>
                  <span title="Umsatz">💶 {formatEuro(p.umsatz)}</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
      <div className="card dashboard-card market-trend-card">
        <div className="market-trend-head">
          <h2>📈 Markttrend (30 Tage)</h2>
          {userRole === "admin" && <span className="market-admin-badge">Admin</span>}
        </div>
        {trendError ? (
          <p className="market-trend-error">{trendError}</p>
        ) : (
          <>
            <div className="market-trend-value-wrap">
              <strong className={`market-trend-value ${(trendInfo?.trendPct || 0) >= 0 ? "up" : "down"}`}>
                {trendInfo?.trendPct != null
                  ? `${trendInfo.trendPct >= 0 ? "+" : ""}${trendInfo.trendPct.toFixed(1)}%`
                  : "--"}
              </strong>
              <span className="market-trend-sub">{(trendInfo?.trendPct || 0) >= 0 ? "Preisauftrieb" : "Preisrueckgang"}</span>
            </div>
            <div className="market-trend-meta">
              <span>Quelle: {trendInfo?.source || "--"}</span>
              <span>Stand: {trendInfo?.asOf ? formatDate(trendInfo.asOf) : "--"}</span>
              <span>{trendInfo?.cached ? "Aus Snapshot" : "Frisch geladen"}</span>
            </div>
            {trendSparkline && (
              <div className="market-trend-sparkline-wrap">
                <svg
                  className="market-trend-sparkline"
                  viewBox={`0 0 ${trendSparkline.width} ${trendSparkline.height}`}
                  role="img"
                  aria-label="Markttrend letzte 7 Tage"
                >
                  <path d={trendSparkline.path} fill="none" stroke="#2563eb" strokeWidth="2.5" strokeLinecap="round" />
                  {trendSparkline.points.map((point) => (
                    <circle key={point.asOf} cx={point.x} cy={point.y} r="2.7" fill="#1d4ed8">
                      <title>{`${formatDate(point.asOf)}: ${point.value >= 0 ? "+" : ""}${point.value.toFixed(1)}%`}</title>
                    </circle>
                  ))}
                </svg>
                <div className="market-trend-sparkline-labels">
                  <span>{formatDate(trendHistory[0]?.asOf)}</span>
                  <span>{formatDate(trendHistory[trendHistory.length - 1]?.asOf)}</span>
                </div>
              </div>
            )}
          </>
        )}
        <button
          type="button"
          className="ghost-btn market-refresh-btn"
          onClick={() => loadMarketTrend(true)}
          disabled={trendLoading}
        >
          {trendLoading ? "Aktualisiert..." : "Trend jetzt aktualisieren"}
        </button>
      </div>
    </div>
  );
}

export default Dashboard;
