import React, { useState, useMemo } from "react";
import { CALL_OUTCOMES } from "../constants";
import { isOverdue, isTodayDue, formatDate, isOpenCancellationWindow } from "../utils/dates";
import { formatWaPhone } from "../utils/format";
import { calculateLeadScore, getLeadTemperature } from "../utils/leads";
import DialerEinwandPanel from "./DialerEinwandPanel";

function PowerDialer({ leads, user, onLogCall, onUpdateField, onClose, onSelectLead }) {
  const queue = useMemo(() => {
    return leads
      .filter(l => l.phone && l.status !== "Verloren")
      .sort((a, b) => {
        const s = l => (isOverdue(l.followUp) ? 100 : 0) + (isTodayDue(l.followUp) ? 50 : 0) + calculateLeadScore(l);
        return s(b) - s(a);
      });
  }, [leads]);

  const [idx, setIdx] = useState(0);
  const [stats, setStats] = useState({ called: 0, reached: 0, appointments: 0 });
  const [showLog, setShowLog] = useState(false);
  const [logOutcome, setLogOutcome] = useState(CALL_OUTCOMES[0]);
  const [logNote, setLogNote] = useState("");
  const [saving, setSaving] = useState(false);

  const current = queue[idx] || null;
  const progress = queue.length > 0 ? Math.round((idx / queue.length) * 100) : 100;

  const advance = () => {
    setIdx(i => i + 1);
    setShowLog(false);
    setLogNote("");
    setLogOutcome(CALL_OUTCOMES[0]);
  };

  const logAndAdvance = async (outcome, note = "") => {
    if (!current) return;
    setSaving(true);
    await onLogCall(current.id, { outcome, notes: note, duration: "" });
    const reached = !["Kein Kontakt", "Mailbox hinterlassen"].includes(outcome);
    const appt = outcome === "Termin vereinbart";
    if (appt) await onUpdateField(current.id, "followUp", new Date().toISOString().split("T")[0]);
    setStats(prev => ({ called: prev.called + 1, reached: prev.reached + (reached ? 1 : 0), appointments: prev.appointments + (appt ? 1 : 0) }));
    setSaving(false);
    advance();
  };

  return (
    <div className="power-dialer-panel">
      {idx >= queue.length || queue.length === 0 ? (
        <div className="dialer-done">
          <div style={{ fontSize: "2.5rem" }}>🏁</div>
          <h3 style={{ color: "#f1f5f9", margin: "8px 0" }}>Session abgeschlossen</h3>
          <div style={{ display: "flex", gap: 20, margin: "16px 0" }}>
            {[["📞", stats.called, "Anrufe"], ["✅", stats.reached, "Erreicht"], ["📅", stats.appointments, "Termine"]].map(([icon, val, label]) => (
              <div key={label} style={{ textAlign: "center" }}>
                <div style={{ fontSize: "1.6rem", fontWeight: 900, color: "#f1f5f9" }}>{icon} {val}</div>
                <div style={{ fontSize: "0.72rem", color: "#64748b" }}>{label}</div>
              </div>
            ))}
          </div>
          <button className="dialer-close-btn" onClick={onClose}>Schließen</button>
        </div>
      ) : (
        <div className="power-dialer">
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <div>
              <strong style={{ color: "#f1f5f9", fontSize: "1rem" }}>⚡ Power Dialer</strong>
              <span style={{ color: "#64748b", marginLeft: 10, fontSize: "0.8rem" }}>Anruf {idx + 1} / {queue.length}</span>
            </div>
            <div style={{ display: "flex", gap: 12, alignItems: "center", fontSize: "0.8rem", color: "#64748b" }}>
              <span title="Anrufe">📞 {stats.called}</span>
              <span title="Erreicht">✅ {stats.reached}</span>
              <span title="Termine">📅 {stats.appointments}</span>
              <button className="drawer-close-btn" onClick={onClose} style={{ marginLeft: 4 }}>✕</button>
            </div>
          </div>
          <div className="dialer-progress">
            <div className="dialer-progress-bar"><div className="dialer-progress-fill" style={{ width: `${progress}%` }} /></div>
            <span className="dialer-progress-label">{progress}%</span>
          </div>
          <div className="dialer-card">
            <div className="dialer-context">
              <span className={`health-pill ${getLeadTemperature(current).tone}`}>{getLeadTemperature(current).label}</span>
              {isOverdue(current.followUp) && <span className="dialer-chip hot">⏰ Überfällig</span>}
              {isOpenCancellationWindow(current.contractEnd) && <span className="dialer-chip hot">🔔 Kündigungsfenster</span>}
            </div>
            <p className="dialer-company dialer-company-link" onClick={() => onSelectLead && onSelectLead(current.id)}>{current.company || current.person}</p>
            <p className="dialer-person">{current.person}</p>
            <a className="dialer-call-btn" href={`tel:${current.phone}`}>📞 {current.phone}</a>
            {current.phone && (
              <a className="dialer-wa-btn" href={`https://wa.me/${formatWaPhone(current.phone)}`} target="_blank" rel="noreferrer">💬 WhatsApp</a>
            )}
            <div className="dialer-context" style={{ marginTop: 6 }}>
              {current.currentProvider && <span className="dialer-chip">Aktuell: {current.currentProvider}</span>}
              {current.consumption && <span className="dialer-chip">{parseInt(current.consumption).toLocaleString("de-DE")} kWh</span>}
              {current.annualCosts && <span className="dialer-chip">€{parseInt(current.annualCosts).toLocaleString("de-DE")}/Jahr</span>}
              {current.followUp && <span className="dialer-chip">Follow-up: {formatDate(current.followUp)}</span>}
            </div>
            {(current.callLogs || []).length > 0 && (
              <p className="dialer-last-note">
                Letzter Anruf: {current.callLogs[current.callLogs.length - 1].outcome}
                {current.callLogs[current.callLogs.length - 1].notes ? ` — ${current.callLogs[current.callLogs.length - 1].notes}` : ""}
              </p>
            )}
          </div>
          {showLog ? (
            <div className="dialer-log">
              <select className="dialer-outcome-select" value={logOutcome} onChange={e => setLogOutcome(e.target.value)}>
                {CALL_OUTCOMES.map(o => <option key={o}>{o}</option>)}
              </select>
              <textarea className="dialer-note" placeholder="Gesprächsnotiz (optional)..." value={logNote} onChange={e => setLogNote(e.target.value)} rows={2} />
              <div className="dialer-actions">
                <button className="dialer-skip-btn" onClick={() => setShowLog(false)}>Abbrechen</button>
                <button className="dialer-next-btn logged" onClick={() => logAndAdvance(logOutcome, logNote)} disabled={saving}>
                  {saving ? "..." : "Speichern & Weiter"}
                </button>
              </div>
            </div>
          ) : (
            <div className="dialer-log">
              <div className="dialer-log-row" style={{ flexWrap: "wrap", gap: 7 }}>
                {[["❌ Kein Kontakt", "Kein Kontakt"], ["📱 Mailbox", "Mailbox hinterlassen"], ["📅 Termin", "Termin vereinbart"], ["✅ Abschluss", "Abschluss"]].map(([label, outcome]) => (
                  <button key={outcome} className="dialer-next-btn" style={{ flex: "1 1 45%", fontSize: "0.82rem" }} onClick={() => logAndAdvance(outcome)} disabled={saving}>
                    {label}
                  </button>
                ))}
              </div>
              <div className="dialer-actions">
                <button className="dialer-skip-btn" onClick={() => setShowLog(true)}>📝 Gespräch protokollieren</button>
                <button className="dialer-skip-btn" onClick={advance}>Überspringen →</button>
              </div>
            </div>
          )}
        </div>
      )}
      {current && <DialerEinwandPanel lead={current} user={user} />}
    </div>
  );
}

export default PowerDialer;
