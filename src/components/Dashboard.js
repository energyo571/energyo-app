import React, { useMemo } from "react";
import { STATUS_OPTIONS } from "../constants";
import { formatEuro, getClosingRateClass } from "../utils/format";
import { calculateUmsatzPotential } from "../utils/energy";
import EnergyPriceChart from "./EnergyPriceChart";

function Dashboard({ leads, teamMembers, userRole }) {

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
      <div className="card dashboard-card epc-card">
        <EnergyPriceChart />
      </div>
    </div>
  );
}

export default Dashboard;
