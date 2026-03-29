import React, { useMemo } from "react";
import { STATUS_OPTIONS } from "../constants";
import { formatEuro, formatEnergyVolume } from "../utils/format";
import { calculateUmsatzPotential } from "../utils/energy";
import { isLeadInactiveForHours, calculatePriority, getLeadReadiness, getLeadWinProbability } from "../utils/leads";
import { isOverdue, isTodayDue, isOpenCancellationWindow } from "../utils/dates";
import EnergyPriceChart from "./EnergyPriceChart";
import { RankBadge, IconClipboard, IconCheck, IconArrowRight, IconZap, IconAlertTriangle, IconTarget, IconClock, IconStar, IconFlame, IconCalendar, IconPhone } from "./Icons";

const STATUS_COLORS = { Neu: "#6c757d", Kontaktiert: "#0d6efd", Angebot: "#fd7e14", "Follow-up": "#ffc107", Abschluss: "#198754", Verloren: "#dc3545" };

const FOCUS_SHORTCUTS = [
  { id: "hot",           label: "Hot Leads",       color: "#f59e0b", key: "priorityA" },
  { id: "overdue",       label: "Überfällig",      color: "#dc2626", key: "overdue" },
  { id: "today",         label: "Heute fällig",    color: "#7c3aed", key: "dueToday" },
  { id: "inactive48",    label: ">48h inaktiv",    color: "#6b7280", key: "inactive48" },
  { id: "cancellation",  label: "Kündigungsfenster",color: "#ea580c", key: "openCancellation" },
  { id: "won",           label: "Abschlüsse",      color: "#059669", key: "wonLeads" },
];

function getClosingColor(rate) {
  const r = Math.min(100, Math.max(0, rate));
  if (r <= 50) { const t = r / 50; return `rgb(${220 - Math.round(t * 3)}, ${38 + Math.round(t * 80)}, ${38 - Math.round(t * 12)})`; }
  const t = (r - 50) / 50;
  return `rgb(${217 - Math.round(t * 212)}, ${118 + Math.round(t * 32)}, ${26 + Math.round(t * 79)})`;
}

function Dashboard({ leads, teamMembers, userRole, stats, onNavigate }) {

  const pipeline = useMemo(() => {
    const byStatus = STATUS_OPTIONS.map(s => ({ label: s, count: leads.filter(l => l.status === s).length }));
    const maxCount = Math.max(...byStatus.map(s => s.count), 1);
    return { byStatus, maxCount };
  }, [leads]);

  const topPerformer = useMemo(() => {
    return teamMembers.map(m => {
      const ml = leads.filter(l => l.createdBy?.email === m.email);
      const won = ml.filter(l => l.status === "Abschluss").length;
      const rate = ml.length > 0 ? Math.round((won / ml.length) * 100) : 0;
      return { email: m.email, role: m.role, total: ml.length, won, rate, umsatz: ml.reduce((s, l) => s + calculateUmsatzPotential(l.consumption), 0) };
    }).sort((a, b) => b.won - a.won);
  }, [leads, teamMembers]);

  const closingColor = getClosingColor(stats.closingRate);

  // ── KI Action Engine ──
  const actions = useMemo(() => {
    const items = [];
    const active = leads.filter(l => l.status !== "Abschluss" && l.status !== "Verloren");

    // 1 — Stale offers: Angebote ohne Aktivität seit >72h
    const staleOffers = active.filter(l => l.status === "Angebot" && isLeadInactiveForHours(l, 72));
    if (staleOffers.length > 0) {
      const topStale = staleOffers.sort((a, b) => calculateUmsatzPotential(b.consumption) - calculateUmsatzPotential(a.consumption))[0];
      const pot = calculateUmsatzPotential(topStale.consumption);
      items.push({
        severity: "critical", icon: <IconAlertTriangle size={15} />, action: "stalledOffers",
        title: `${staleOffers.length} Angebot${staleOffers.length > 1 ? "e" : ""} ohne Reaktion seit 3+ Tagen`,
        detail: pot > 0 ? `Höchstes Potenzial: ${formatEuro(pot)} — sofort nachfassen` : "Jetzt Follow-up setzen",
      });
    }

    // 2 — Hot leads without appointment
    const hotNoAppt = active.filter(l => calculatePriority(l) === "A" && !l.appointmentDate);
    if (hotNoAppt.length > 0) {
      items.push({
        severity: "high", icon: <IconFlame size={15} />, action: "hot",
        title: `${hotNoAppt.length} Hot Lead${hotNoAppt.length > 1 ? "s" : ""} ohne Termin`,
        detail: "Priorität A — Terminvereinbarung beschleunigt den Abschluss um 40%",
      });
    }

    // 3 — Cancellation windows opening
    const cancWindows = active.filter(l => isOpenCancellationWindow(l.contractEnd) && l.status !== "Angebot");
    if (cancWindows.length > 0) {
      items.push({
        severity: "high", icon: <IconCalendar size={15} />, action: "cancellation",
        title: `${cancWindows.length} Lead${cancWindows.length > 1 ? "s" : ""} im Kündigungsfenster`,
        detail: "Zeitfenster nutzen — Angebot jetzt platzieren bevor der Altvertrag verlängert",
      });
    }

    // 4 — High-value untouched leads (Neu + consumption > 30k + no calls)
    const bigUntouched = active.filter(l => l.status === "Neu" && parseInt(l.consumption || 0) >= 30000 && (!l.callLogs || l.callLogs.length === 0));
    if (bigUntouched.length > 0) {
      const totalPot = bigUntouched.reduce((s, l) => s + calculateUmsatzPotential(l.consumption), 0);
      items.push({
        severity: "high", icon: <IconZap size={15} />, action: "uncontacted",
        title: `${bigUntouched.length} Großkunde${bigUntouched.length > 1 ? "n" : ""} noch nicht kontaktiert`,
        detail: `${formatEuro(totalPot)} Umsatzpotenzial wartet — Erstkontakt priorisieren`,
      });
    }

    // 5 — Overdue follow-ups
    const overdueLeads = active.filter(l => isOverdue(l.followUp));
    if (overdueLeads.length > 0) {
      const oldest = overdueLeads.sort((a, b) => new Date(a.followUp) - new Date(b.followUp))[0];
      const daysOver = Math.round((Date.now() - new Date(oldest.followUp)) / 86400000);
      items.push({
        severity: overdueLeads.length >= 5 ? "critical" : "medium", icon: <IconClock size={15} />, action: "overdue",
        title: `${overdueLeads.length} überfällige Wiedervorlage${overdueLeads.length > 1 ? "n" : ""}`,
        detail: `Älteste: ${daysOver} Tag${daysOver !== 1 ? "e" : ""} überfällig — jetzt abarbeiten`,
      });
    }

    // 6 — Closing rate insight
    if (stats.closingRate < 15 && leads.length >= 10) {
      const offerCount = leads.filter(l => l.status === "Angebot").length;
      items.push({
        severity: "medium", icon: <IconTarget size={15} />, action: "stalledOffers",
        title: "Closing Rate unter 15% — Optimierungspotenzial",
        detail: offerCount > 0 ? `${offerCount} offene Angebote nachfassen — jedes Closing zählt` : "Mehr Leads in die Angebotsphase bringen",
      });
    }

    // 7 — Data quality gaps
    const incomplete = active.filter(l => getLeadReadiness(l).tone === "red");
    if (incomplete.length >= 3) {
      items.push({
        severity: "low", icon: <IconClipboard size={15} />, action: "all",
        title: `${incomplete.length} Leads mit unvollständigen Daten`,
        detail: "Fehlende Verbrauchs- oder Kontaktdaten nachtragen — verbessert Angebotsfähigkeit",
      });
    }

    // 8 — Quick win: High prob leads close to conversion
    const quickWins = active.filter(l => getLeadWinProbability(l) >= 70 && l.status !== "Angebot");
    if (quickWins.length > 0) {
      items.push({
        severity: "positive", icon: <IconStar size={15} />, action: "hot",
        title: `${quickWins.length} Quick Win${quickWins.length > 1 ? "s" : ""} identifiziert`,
        detail: "Hohe Abschlusswahrscheinlichkeit — direkt zum Angebot überführen",
      });
    }

    // 9 — Today calls
    const todayDue = active.filter(l => isTodayDue(l.followUp));
    if (todayDue.length > 0) {
      items.push({
        severity: "medium", icon: <IconPhone size={15} />, action: "today",
        title: `${todayDue.length} Anruf${todayDue.length > 1 ? "e" : ""} für heute geplant`,
        detail: "Wiedervorlagen heute abarbeiten — Power Dialer nutzen",
      });
    }

    return items.sort((a, b) => {
      const order = { critical: 0, high: 1, positive: 2, medium: 3, low: 4 };
      return (order[a.severity] ?? 5) - (order[b.severity] ?? 5);
    }).slice(0, 6);
  }, [leads, stats.closingRate]);

  const nav = (preset) => { if (onNavigate) onNavigate(preset); };

  return (
    <div className="dashboard-layout">

      {/* ── Focus Shortcuts ── */}
      <div className="dash-shortcuts">
        {FOCUS_SHORTCUTS.map(s => (
          <button key={s.id} className="dash-shortcut" onClick={() => nav(s.id)}>
            <span className="dash-shortcut-count" style={{ color: s.color }}>{stats[s.key] ?? 0}</span>
            <span className="dash-shortcut-label">{s.label}</span>
            <IconArrowRight size={13} className="dash-shortcut-arrow" />
          </button>
        ))}
      </div>

      {/* ── KPI Row ── */}
      <div className="dash-kpi-row">
        <div className="dash-kpi"><span className="dash-kpi-val" style={{ color: "#2563eb" }}>{formatEnergyVolume(stats.movedEnergyKwh)}</span><span className="dash-kpi-label">Energiemenge</span></div>
        <div className="dash-kpi"><span className="dash-kpi-val">{stats.totalLeads}</span><span className="dash-kpi-label">Leads gesamt</span></div>
        <div className="dash-kpi"><span className="dash-kpi-val" style={{ color: "#059669" }}>{formatEuro(stats.totalUmsatzPotential)}</span><span className="dash-kpi-label">Umsatzpotenzial</span></div>
        <div className="dash-kpi dash-kpi-closing" style={{ borderColor: closingColor }}>
          <span className="dash-kpi-val" style={{ color: closingColor }}>{stats.closingRate}%</span>
          <span className="dash-kpi-label">Closing Rate</span>
        </div>
      </div>

      {/* ── KI Actions ── */}
      {actions.length > 0 && (
        <div className="card dash-card dash-actions-card">
          <h3 className="dash-card-title">KI-Handlungsempfehlungen</h3>
          <div className="dash-actions-list">
            {actions.map((a, i) => (
              <button key={i} className={`dash-action dash-action-${a.severity}`} onClick={() => nav(a.action)}>
                <span className="dash-action-icon">{a.icon}</span>
                <div className="dash-action-body">
                  <span className="dash-action-title">{a.title}</span>
                  <span className="dash-action-detail">{a.detail}</span>
                </div>
                <IconArrowRight size={14} className="dash-action-arrow" />
              </button>
            ))}
          </div>
        </div>
      )}

      {/* ── Main grid: Pipeline + Ranking ── */}
      <div className="dash-grid-2">
        <div className="card dash-card">
          <h3 className="dash-card-title">Pipeline</h3>
          <div className="bar-chart">
            {pipeline.byStatus.map(s => (
              <button key={s.label} className="bar-row bar-row-clickable" onClick={() => nav(s.label === "Abschluss" ? "won" : s.label === "Verloren" ? "lost" : s.label === "Follow-up" ? "action" : "status:" + s.label)}>
                <span className="bar-label">{s.label}</span>
                <div className="bar-track"><div className="bar-fill" style={{ width: `${(s.count / pipeline.maxCount) * 100}%`, background: STATUS_COLORS[s.label] || "#0d6efd" }} /></div>
                <span className="bar-count">{s.count}</span>
              </button>
            ))}
          </div>
        </div>

        <div className="card dash-card">
          <h3 className="dash-card-title">Ranking</h3>
          {topPerformer.length === 0 ? (
            <p className="empty-text">Keine Teammitglieder</p>
          ) : (
            <div className="ranking-table">
              <div className="ranking-header">
                <span className="ranking-col-rank">#</span>
                <span className="ranking-col-name">Mitarbeiter</span>
                <span className="ranking-col-stat">Leads</span>
                <span className="ranking-col-stat">Won</span>
                <span className="ranking-col-stat">Rate</span>
                <span className="ranking-col-stat">Umsatz</span>
              </div>
              {topPerformer.map((p, idx) => (
                <div key={p.email} className={`ranking-row${idx === 0 ? " ranking-row-first" : ""}`}>
                  <span className="ranking-col-rank"><RankBadge rank={idx + 1} /></span>
                  <span className="ranking-col-name">
                    <span className="ranking-name">{p.email.split("@")[0]}</span>
                    <span className="ranking-role">{p.role === "admin" ? "Admin" : "Agent"}</span>
                  </span>
                  <span className="ranking-col-stat"><IconClipboard size={12} /> {p.total}</span>
                  <span className="ranking-col-stat"><IconCheck size={12} /> {p.won}</span>
                  <span className="ranking-col-stat" style={{ color: getClosingColor(p.rate) }}>{p.rate}%</span>
                  <span className="ranking-col-stat ranking-umsatz" style={{ color: "#059669" }}>{formatEuro(p.umsatz)}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* ── Energy Prices (dual Strom + Gas) ── */}
      <div className="card dash-card dash-energy-card">
        <EnergyPriceChart />
      </div>
    </div>
  );
}

export default Dashboard;
