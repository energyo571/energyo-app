import React, { useMemo, useState, useEffect, useCallback, useRef } from "react";
import { onAuthStateChanged, signOut } from "firebase/auth";
import {
  collection, addDoc, onSnapshot, updateDoc, deleteDoc,
  doc, query, where, getDoc, setDoc, getDocs,
} from "firebase/firestore";
import { auth, db } from "./firebaseConfig";
import LoginPage from "./LoginPage";
import logo from "./logo.png";
import "./App.css";

// ─── Konstanten ───────────────────────────────────────────────────────────────
const STATUS_OPTIONS = ["Neu", "Kontaktiert", "Angebot", "Nachfassen", "Gewonnen", "Verloren"];
const STATUS_META = {
  Neu:         { color: "#6b7280", bg: "#f3f4f6" },
  Kontaktiert: { color: "#1d4ed8", bg: "#dbeafe" },
  Angebot:     { color: "#c2410c", bg: "#ffedd5" },
  Nachfassen:  { color: "#b45309", bg: "#fef3c7" },
  Gewonnen:    { color: "#065f46", bg: "#d1fae5" },
  Verloren:    { color: "#991b1b", bg: "#fee2e2" },
};
const CALL_OUTCOMES = [
  "Kein Kontakt", "Mailbox hinterlassen", "Kurzes Gespräch",
  "Ausführliches Gespräch", "Termin vereinbart", "Angebot besprochen", "Abschluss",
];
const initialForm = {
  company: "", person: "", geburtsdatum: "", phone: "", email: "",
  consumption: "", annualCosts: "", contractEnd: "unknown",
  customerType: "Privat", postalCode: "", currentProvider: "",
  bundleInquiry: false, followUp: "", attachments: [],
  energyType: "strom",
  energy: {
    strom: [
      { zählernummer: "", maloId: "", lieferanschrift: "", kontaktanschrift: "" }
    ],
    gas: [
      { zählernummer: "", maloId: "", lieferanschrift: "", kontaktanschrift: "" }
    ],
  },
};

// ─── Hilfsfunktionen ──────────────────────────────────────────────────────────
const isOpenCancellationWindow = (contractEnd) => {
  if (contractEnd === "unknown" || !contractEnd) return false;
  const monthsUntilEnd = (new Date(contractEnd) - new Date()) / (1000 * 60 * 60 * 24 * 30);
  return monthsUntilEnd >= 0 && monthsUntilEnd <= 4;
};
const getRestLaufzeit = (contractEnd) => {
  if (contractEnd === "unknown" || !contractEnd) return null;
  return (new Date(contractEnd) - new Date()) / (1000 * 60 * 60 * 24 * 365);
};
const calculatePriority = (lead) => {
  const consumption = lead.consumption ? parseInt(lead.consumption) : 0;
  const laufzeit = getRestLaufzeit(lead.contractEnd);
  const hasCancellationWindow = isOpenCancellationWindow(lead.contractEnd);
  if (hasCancellationWindow || consumption >= 50000) return "A";
  if ((consumption >= 20000 && consumption < 50000) || (laufzeit && laufzeit >= 1 && laufzeit <= 2)) return "B";
  return "C";
};
const calculateUmsatzPotential = (consumption) => {
  if (!consumption) return 0;
  const kwh = parseInt(consumption);
  return kwh >= 50000 ? kwh * 0.01 : 150;
};
const isContractEndUnrealistic = (contractEnd) => {
  if (contractEnd === "unknown" || !contractEnd) return false;
  return new Date(contractEnd) < new Date();
};
const isTodayDue = (d) => !!d && d === new Date().toISOString().split("T")[0];
const isOverdue = (d) => !!d && d < new Date().toISOString().split("T")[0];
const formatDate = (d) => {
  if (!d || d === "unknown") return "—";
  return new Date(d).toLocaleDateString("de-DE");
};
const formatDateTime = (d) => {
  if (!d) return "";
  const dt = new Date(d);
  return dt.toLocaleDateString("de-DE") + " " + dt.toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" });
};
const formatEuro = (value) => '€' + Math.round(value).toLocaleString('de-DE');
const formatWaPhone = (phone) => {
  if (!phone) return '';
  const digits = phone.replace(/\D/g, '');
  if (digits.startsWith('49')) return digits;
  if (digits.startsWith('0')) return '49' + digits.slice(1);
  return digits;
};
const getClosingRateClass = (rate) => {
  if (rate < 15) return 'kpi-alert';
  if (rate < 25) return 'kpi-warning';
  return 'kpi-success';
};

const getLeadOwnerEmail = (lead) => lead.ownerEmail || lead.createdBy?.email || "Nicht zugewiesen";

const getEnergyMeters = (lead, energyType) => {
  const raw = lead?.energy?.[energyType];
  if (Array.isArray(raw)) return raw.filter((m) => m?.zählernummer);
  if (raw?.zählernummer) return [raw];
  return [];
};

const getEnergyMeterCount = (lead, energyType) => getEnergyMeters(lead, energyType).length;
const getTotalDeliveryPoints = (lead) => getEnergyMeterCount(lead, "strom") + getEnergyMeterCount(lead, "gas");

const getLeadActivityCount = (lead) =>
  (lead.comments?.length || 0) + (lead.callLogs?.length || 0) + (lead.statusHistory?.length || 0);

const getLastActivityTimestamp = (lead) => {
  const timestamps = [lead.createdAt];
  (lead.comments || []).forEach((item) => timestamps.push(item.timestamp));
  (lead.callLogs || []).forEach((item) => timestamps.push(item.timestamp));
  (lead.statusHistory || []).forEach((item) => timestamps.push(item.timestamp));
  return timestamps.filter(Boolean).sort((a, b) => new Date(b) - new Date(a))[0] || null;
};

const getLeadTemperature = (lead) => {
  if (lead.status === "Gewonnen") return { label: "Won", tone: "won" };
  if (lead.status === "Verloren") return { label: "Lost", tone: "lost" };
  if (isOverdue(lead.followUp)) return { label: "Kritisch", tone: "critical" };
  if (isOpenCancellationWindow(lead.contractEnd) || calculatePriority(lead) === "A") return { label: "Hot", tone: "hot" };
  if ((lead.callLogs?.length || 0) > 0 || (lead.comments?.length || 0) > 1) return { label: "Warm", tone: "warm" };
  return { label: "Cold", tone: "cold" };
};

const getNextAction = (lead) => {
  if (lead.status === "Gewonnen") return { label: "Abschluss sichern", tone: "success" };
  if (lead.status === "Verloren") return { label: "Archiv prüfen", tone: "muted" };
  if (isOverdue(lead.followUp)) return { label: "Heute nachfassen", tone: "danger" };
  if (isTodayDue(lead.followUp)) return { label: "Heute anrufen", tone: "today" };
  if (isOpenCancellationWindow(lead.contractEnd)) return { label: "Angebot priorisieren", tone: "hot" };
  if ((lead.callLogs?.length || 0) === 0) return { label: "Ersten Anruf machen", tone: "default" };
  if (lead.status === "Angebot") return { label: "Angebot nachhalten", tone: "warm" };
  return { label: "Nächsten Touchpoint planen", tone: "default" };
};

const sortLeads = (items, sortMode) => {
  const sorted = [...items];
  if (sortMode === "potential") {
    return sorted.sort((a, b) => calculateUmsatzPotential(b.consumption) - calculateUmsatzPotential(a.consumption));
  }
  if (sortMode === "activity") {
    return sorted.sort((a, b) => new Date(getLastActivityTimestamp(b) || 0) - new Date(getLastActivityTimestamp(a) || 0));
  }
  if (sortMode === "followUp") {
    return sorted.sort((a, b) => {
      if (!a.followUp && !b.followUp) return 0;
      if (!a.followUp) return 1;
      if (!b.followUp) return -1;
      return new Date(a.followUp) - new Date(b.followUp);
    });
  }
  return sorted.sort((a, b) => {
    const order = { A: 0, B: 1, C: 2 };
    const diff = order[calculatePriority(a)] - order[calculatePriority(b)];
    if (diff !== 0) return diff;
    const ca = isOpenCancellationWindow(a.contractEnd);
    const cb = isOpenCancellationWindow(b.contractEnd);
    if (ca !== cb) return ca ? -1 : 1;
    return new Date(b.createdAt) - new Date(a.createdAt);
  });
};

// ─── LeadLoadingOverlay ───────────────────────────────────────────────────────
function LeadLoadingOverlay() {
  return (
    <div className="lead-loading-overlay">
      <div className="lead-loading-content">
        <img src={logo} alt="ENERGYO Logo" className="lead-loading-logo" />
        <div className="lead-loading-bar-container"><div className="lead-loading-bar" /></div>
        <div className="lead-loading-text">Tarifoptimierung gestartet ...</div>
      </div>
    </div>
  );
}

// ─── InlineField ──────────────────────────────────────────────────────────────
function InlineField({ label, value, onSave, type = "text", options = null, render = null }) {
  const [editing, setEditing] = useState(false);
  const [val, setVal] = useState(value || "");
  const ref = useRef(null);
  useEffect(() => { setVal(value || ""); }, [value]);
  useEffect(() => { if (editing && ref.current) ref.current.focus(); }, [editing]);
  const save = () => { onSave(val); setEditing(false); };
  const cancel = () => { setVal(value || ""); setEditing(false); };
  return (
    <div className="inline-field">
      <label className="inline-label">{label}</label>
      {editing ? (
        <div className="inline-edit-row">
          {options ? (
            <select ref={ref} value={val} onChange={e => setVal(e.target.value)} onBlur={save}>
              {options.map(o => <option key={o} value={o}>{o}</option>)}
            </select>
          ) : (
            <input
              ref={ref} type={type} value={val}
              onChange={e => setVal(e.target.value)}
              onKeyDown={e => { if (e.key === "Enter") save(); if (e.key === "Escape") cancel(); }}
              onBlur={save}
            />
          )}
        </div>
      ) : (
        <div className="inline-value-row" onClick={() => setEditing(true)}>
          <span className="inline-value">
            {render ? render(value) : (value || <em className="inline-empty">Klicken zum Bearbeiten</em>)}
          </span>
          <span className="inline-edit-icon">✎</span>
        </div>
      )}
    </div>
  );
}

// ─── ActivityItem ─────────────────────────────────────────────────────────────
function ActivityItem({ item }) {
  const cfg = {
    comment: { icon: "💬", cls: "act-comment" },
    call:    { icon: "📞", cls: "act-call" },
    status:  { icon: "🔄", cls: "act-status" },
  }[item.type] || { icon: "📝", cls: "act-comment" };
  return (
    <div className={`activity-item ${cfg.cls}`}>
      <div className="activity-icon-wrap"><span>{cfg.icon}</span></div>
      <div className="activity-body">
        <div className="activity-meta">
          <span className="activity-author">{item.author || "System"}</span>
          <span className="activity-time">{formatDateTime(item.timestamp)}</span>
        </div>
        {item.type === "comment" && <p className="activity-text">{item.text}</p>}
        {item.type === "call" && (
          <div className="call-log-display">
            <span className="call-outcome-badge">{item.outcome}</span>
            {item.duration && <span className="call-duration"> · {item.duration} Min.</span>}
            {item.notes && <p className="activity-text">{item.notes}</p>}
          </div>
        )}
        {item.type === "status" && (
          <p className="activity-text">
            {item.from} <span className="status-arrow">→</span> <strong>{item.to}</strong>
          </p>
        )}
      </div>
    </div>
  );
}

function CommandCenter({ stats, filteredLeads, smartView, setSmartView, setKpiFocus }) {
  const hotLead = filteredLeads.find((lead) => getLeadTemperature(lead).tone === "hot");
  const urgentLead = filteredLeads.find((lead) => isOverdue(lead.followUp) || isTodayDue(lead.followUp));

  return (
    <section className="command-center">
      <div className="command-hero">
        <div>
          <span className="eyebrow">Sales cockpit</span>
          <h2>Fokus statt Hokus-Pokus</h2>
          <p>
            Klar arbeiten, sauber nachfassen, verlässlich abschließen.
          </p>
        </div>
        <div className="command-hero-metrics">
          <div className="hero-metric-card">
            <strong>{stats.overdue + stats.dueToday}</strong>
            <span>Action Queue</span>
          </div>
          <div className="hero-metric-card">
            <strong className="kpi-success">{formatEuro(stats.totalUmsatzPotential)}</strong>
            <span>Offenes Potenzial</span>
          </div>
          <div className="hero-metric-card">
            <strong className={getClosingRateClass(stats.closingRate)}>{stats.closingRate}%</strong>
            <span>Closing rate</span>
          </div>
        </div>
      </div>

      <div className="smart-view-bar">
        {[
          { id: "all", label: "Alle Leads" },
          { id: "mine", label: "Meine Leads" },
          { id: "action", label: "Action Queue" },
          { id: "hot", label: "Hot Deals" },
          { id: "won", label: "Gewonnen" },
        ].map((item) => (
          <button
            key={item.id}
            className={`smart-view-chip ${smartView === item.id ? "active" : ""}`}
            onClick={() => {
              setSmartView(item.id);
              setKpiFocus("all");
            }}
          >
            {item.label}
          </button>
        ))}
      </div>

      <div className="command-grid">
        <div className="command-card">
          <span className="command-card-label">Nächster kritischer Lead</span>
          {urgentLead ? (
            <>
              <strong>{urgentLead.company || urgentLead.person}</strong>
              <p>{getNextAction(urgentLead).label}</p>
              <span className="command-card-meta">Follow-up: {formatDate(urgentLead.followUp)}</span>
            </>
          ) : (
            <p>Keine kritischen Follow-ups offen.</p>
          )}
        </div>
        <div className="command-card">
          <span className="command-card-label">Heißester Deal</span>
          {hotLead ? (
            <>
              <strong>{hotLead.company || hotLead.person}</strong>
              <p>{getNextAction(hotLead).label}</p>
              <span className="command-card-meta">Potenzial: {formatEuro(calculateUmsatzPotential(hotLead.consumption))}</span>
            </>
          ) : (
            <p>Aktuell kein Deal mit Hot-Signal.</p>
          )}
        </div>
        <div className="command-card emphasize">
          <span className="command-card-label">Pipeline Fokus</span>
          <strong>{stats.priorityA} A-Leads</strong>
          <p>{stats.openCancellation} Leads im Kündigungsfenster</p>
          <span className="command-card-meta">Arbeite diese zuerst, bevor du neue Kaltleads ansprichst.</span>
        </div>
      </div>
    </section>
  );
}

// ─── LeadDetailDrawer ─────────────────────────────────────────────────────────
function LeadDetailDrawer({ lead, onClose, user, onUpdateField, onUpdateStatus, onDelete, onLogCall, onAddAttachment, onRemoveAttachment }) {
  const [drawerTab, setDrawerTab] = useState("activity");
  const [noteText, setNoteText] = useState("");
  const [showCallForm, setShowCallForm] = useState(false);
  const [callForm, setCallForm] = useState({ duration: "", outcome: CALL_OUTCOMES[0], notes: "" });
  const [saving, setSaving] = useState(false);
  const [previewAttachment, setPreviewAttachment] = useState(null);
  const [deleteConfirmId, setDeleteConfirmId] = useState(null);

  const priority = calculatePriority(lead);
  const umsatz = calculateUmsatzPotential(lead.consumption);
  const hasCancellationWindow = isOpenCancellationWindow(lead.contractEnd);
  const isOverdueNow = isOverdue(lead.followUp);
  const isTodayNow = isTodayDue(lead.followUp);

  const timeline = useMemo(() => {
    const items = [];
    (lead.comments || []).forEach(c => items.push({ type: "comment", ...c }));
    (lead.callLogs || []).forEach(c => items.push({ type: "call", ...c }));
    (lead.statusHistory || []).forEach(c => items.push({ type: "status", ...c }));
    return items.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
  }, [lead.comments, lead.callLogs, lead.statusHistory]);

  const submitNote = async () => {
    if (!noteText.trim()) return;
    setSaving(true);
    const newComment = { timestamp: new Date().toISOString(), text: noteText.trim(), author: user.email };
    await onUpdateField(lead.id, "comments", [...(lead.comments || []), newComment]);
    setNoteText("");
    setSaving(false);
  };

  const submitCall = async () => {
    setSaving(true);
    await onLogCall(lead.id, callForm);
    setCallForm({ duration: "", outcome: CALL_OUTCOMES[0], notes: "" });
    setShowCallForm(false);
    setSaving(false);
  };

  const handleDelete = async () => {
    if (!window.confirm(`Lead "${lead.company || lead.person}" wirklich löschen?`)) return;
    await onDelete(lead.id);
    onClose();
  };

  return (
    <div className="drawer-backdrop" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="drawer">
        {/* Header */}
        <div className="drawer-header">
          <div className="drawer-header-info">
            <h2 className="drawer-company">{lead.company || <em>Kein Firmenname</em>}</h2>
            <p className="drawer-person">
              {lead.person}{lead.customerType ? ` · ${lead.customerType}` : ""}{lead.postalCode ? ` · PLZ ${lead.postalCode}` : ""}
            </p>
            <div className="drawer-header-badges">
              <span className={`drawer-prio-badge prio-${priority}`}>Priorität {priority}</span>
              {hasCancellationWindow && <span className="drawer-badge alert">🔔 Kündigungsfenster</span>}
              {isOverdueNow && <span className="drawer-badge danger">⏰ Überfällig</span>}
              {isTodayNow && <span className="drawer-badge today">📅 Heute fällig</span>}
              {lead.bundleInquiry && <span className="drawer-badge info">📦 Bündelanfrage</span>}
            </div>
          </div>
          <button className="drawer-close-btn" onClick={onClose} aria-label="Schließen">✕</button>
        </div>

        {/* Umsatz Banner */}
        <div className="drawer-umsatz-bar">
          <span className="drawer-umsatz-label">Umsatzpotenzial</span>
          <span className="drawer-umsatz-value">{formatEuro(umsatz)}</span>
          <span className="drawer-umsatz-hint">
            {lead.consumption && parseInt(lead.consumption) >= 50000
              ? `(${parseInt(lead.consumption).toLocaleString("de-DE")} kWh × 0,01 €)`
              : "(Pauschale)"}
          </span>
        </div>

        {/* Kontakt-Aktionen */}
        <div className="contact-bar">
          {lead.phone ? (
            <a className="contact-btn call" href={`tel:${lead.phone}`}>
              <span className="contact-btn-icon">📞</span>
              <span className="contact-btn-label">Anrufen</span>
              <span className="contact-btn-sub">{lead.phone}</span>
            </a>
          ) : (
            <div className="contact-btn call disabled">
              <span className="contact-btn-icon">📞</span>
              <span className="contact-btn-label">Anrufen</span>
              <span className="contact-btn-sub">Kein Tel.</span>
            </div>
          )}
          {lead.phone ? (
            <a className="contact-btn whatsapp" href={`https://wa.me/${formatWaPhone(lead.phone)}?text=${encodeURIComponent(`Hallo ${lead.person || ''},\n\nhier ist Ihr ENERGYO-Berater. Ich melde mich bezüglich Ihres Energievertrags. Haben Sie kurz Zeit?`)}`} target="_blank" rel="noreferrer">
              <span className="contact-btn-icon">💬</span>
              <span className="contact-btn-label">WhatsApp</span>
              <span className="contact-btn-sub">Nachricht</span>
            </a>
          ) : (
            <div className="contact-btn whatsapp disabled">
              <span className="contact-btn-icon">💬</span>
              <span className="contact-btn-label">WhatsApp</span>
              <span className="contact-btn-sub">Kein Tel.</span>
            </div>
          )}
          {lead.email ? (
            <a className="contact-btn email" href={`mailto:${lead.email}?subject=${encodeURIComponent('Ihr Energievertrag – ENERGYO')}&body=${encodeURIComponent(`Sehr geehrte/r ${lead.person || 'Kundin/Kunde'},\n\n`)}`}>
              <span className="contact-btn-icon">📧</span>
              <span className="contact-btn-label">E-Mail</span>
              <span className="contact-btn-sub">{lead.email}</span>
            </a>
          ) : (
            <div className="contact-btn email disabled">
              <span className="contact-btn-icon">📧</span>
              <span className="contact-btn-label">E-Mail</span>
              <span className="contact-btn-sub">Keine E-Mail</span>
            </div>
          )}
        </div>

        {/* Status Stepper */}
        <div className="drawer-status-stepper">
          {STATUS_OPTIONS.map(s => {
            const meta = STATUS_META[s];
            return (
              <button
                key={s}
                className={`status-step-btn ${lead.status === s ? "active" : ""}`}
                style={lead.status === s ? { background: meta.bg, color: meta.color, borderColor: meta.color } : {}}
                onClick={() => onUpdateStatus(lead.id, s)}
              >
                {s}
              </button>
            );
          })}
        </div>

        <div className="drawer-signal-grid">
          <div className="drawer-signal-card">
            <span>Owner</span>
            <strong>{getLeadOwnerEmail(lead)}</strong>
          </div>
          <div className="drawer-signal-card">
            <span>Letzte Aktivität</span>
            <strong>{formatDateTime(getLastActivityTimestamp(lead)) || "Noch keine"}</strong>
          </div>
          <div className="drawer-signal-card">
            <span>Nächste Aktion</span>
            <strong>{getNextAction(lead).label}</strong>
          </div>
        </div>

        <div className="quick-action-row">
          <button className="quick-action-btn" onClick={() => onUpdateField(lead.id, "followUp", new Date().toISOString().split("T")[0])}>Heute setzen</button>
          <button className="quick-action-btn" onClick={() => {
            const tomorrow = new Date();
            tomorrow.setDate(tomorrow.getDate() + 1);
            onUpdateField(lead.id, "followUp", tomorrow.toISOString().split("T")[0]);
          }}>Morgen nachfassen</button>
          <button className="quick-action-btn" onClick={() => onUpdateStatus(lead.id, "Angebot")}>Zu Angebot ziehen</button>
        </div>

        {/* Tabs */}
        <div className="drawer-tabs">
          {[
            { id: "activity", label: "Aktivität" },
            { id: "details", label: "Details" },
            { id: "attachments", label: `Anhänge${lead.attachments?.length > 0 ? ` (${lead.attachments.length})` : ""}` },
          ].map(t => (
            <button
              key={t.id}
              className={`drawer-tab-btn ${drawerTab === t.id ? "active" : ""}`}
              onClick={() => setDrawerTab(t.id)}
            >
              {t.label}
            </button>
          ))}
        </div>

        {/* Tab: Aktivität */}
        {drawerTab === "activity" && (
          <div className="drawer-tab-content">
            <div className="activity-compose-bar">
              <button
                className={`compose-action-btn ${showCallForm ? "active" : ""}`}
                onClick={() => setShowCallForm(v => !v)}
              >
                📞 Anruf protokollieren
              </button>
            </div>

            {showCallForm && (
              <div className="call-form">
                <div className="call-form-row">
                  <select value={callForm.outcome} onChange={e => setCallForm(p => ({ ...p, outcome: e.target.value }))}>
                    {CALL_OUTCOMES.map(o => <option key={o}>{o}</option>)}
                  </select>
                  <input
                    type="number" min="0" max="999" placeholder="Dauer (Min.)"
                    value={callForm.duration}
                    onChange={e => setCallForm(p => ({ ...p, duration: e.target.value }))}
                  />
                </div>
                <textarea
                  placeholder="Gesprächsnotiz..."
                  value={callForm.notes}
                  onChange={e => setCallForm(p => ({ ...p, notes: e.target.value }))}
                  rows={2}
                />
                <div className="call-form-actions">
                  <button className="primary-btn-sm" onClick={submitCall} disabled={saving}>
                    {saving ? "..." : "Anruf speichern"}
                  </button>
                  <button className="ghost-btn-sm" onClick={() => setShowCallForm(false)}>Abbrechen</button>
                </div>
              </div>
            )}

            <div className="note-compose">
              <textarea
                placeholder="Notiz hinzufügen... (Enter zum Speichern)"
                value={noteText}
                onChange={e => setNoteText(e.target.value)}
                onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); submitNote(); } }}
                rows={2}
              />
              <button className="primary-btn-sm" onClick={submitNote} disabled={saving || !noteText.trim()}>
                {saving ? "..." : "Speichern"}
              </button>
            </div>

            <div className="activity-timeline">
              {timeline.length === 0 ? (
                <p className="empty-timeline">Noch keine Aktivitäten. Füge eine Notiz hinzu oder protokolliere einen Anruf.</p>
              ) : (
                timeline.map((item, idx) => <ActivityItem key={idx} item={item} />)
              )}
            </div>
          </div>
        )}

        {/* Tab: Details */}
        {drawerTab === "details" && (
          <div className="drawer-tab-content">
            <div className="details-grid">
              <InlineField label="Firma" value={lead.company} onSave={v => onUpdateField(lead.id, "company", v)} />
              <InlineField label="Ansprechpartner" value={lead.person} onSave={v => onUpdateField(lead.id, "person", v)} />
              <InlineField label="Telefon" value={lead.phone} onSave={v => onUpdateField(lead.id, "phone", v)} type="tel" />
              <InlineField label="E-Mail" value={lead.email} onSave={v => onUpdateField(lead.id, "email", v)} type="email" />
              <InlineField label="PLZ" value={lead.postalCode} onSave={v => onUpdateField(lead.id, "postalCode", v)} />
              <InlineField label="Kundentyp" value={lead.customerType} onSave={v => onUpdateField(lead.id, "customerType", v)} options={["Privat", "Gewerbe", "Großkunde"]} />
              <InlineField label="Aktueller Anbieter" value={lead.currentProvider} onSave={v => onUpdateField(lead.id, "currentProvider", v)} />
              <InlineField label="Verbrauch (kWh)" value={lead.consumption} onSave={v => onUpdateField(lead.id, "consumption", v)} type="number" />
              <InlineField
                label="Jahreskosten (€)" value={lead.annualCosts}
                onSave={v => onUpdateField(lead.id, "annualCosts", v)} type="number"
                render={v => v ? `€${parseInt(v).toLocaleString("de-DE")}` : null}
              />
              <InlineField
                label="Vertragsende"
                value={lead.contractEnd === "unknown" ? "" : lead.contractEnd}
                onSave={v => onUpdateField(lead.id, "contractEnd", v || "unknown")}
                type="date"
                render={v => (!v || v === "unknown") ? "Unbekannt" : formatDate(v)}
              />
              <InlineField
                label="Nachfass-Datum" value={lead.followUp}
                onSave={v => onUpdateField(lead.id, "followUp", v)} type="date"
                render={v => v ? formatDate(v) : null}
              />
              <InlineField
                label="Geburtsdatum" value={lead.geburtsdatum}
                onSave={v => onUpdateField(lead.id, "geburtsdatum", v)} type="date"
                render={v => v ? formatDate(v) : null}
              />
            </div>

            <div className="details-energy-section">
              <h3>Energieversorgung</h3>
              <div className="energy-details-grid">
                {(lead.energy?.strom?.length > 0 && lead.energy.strom.some(m => m.zählernummer)) || (lead.energy?.gas?.length > 0 && lead.energy.gas.some(m => m.zählernummer)) ? (
                  <>
                    {lead.energy?.strom?.filter(m => m.zählernummer).map((meter, idx) => (
                      <div key={idx} className="energy-detail-card strom">
                        <div className="energy-detail-label">🔌 Strom {idx + 1}</div>
                        <div className="energy-detail-item">
                          <span className="energy-detail-key">Zählernummer:</span>
                          <span className="energy-detail-value">{meter.zählernummer}</span>
                        </div>
                        {meter.maloId && (
                          <div className="energy-detail-item">
                            <span className="energy-detail-key">MALO-ID:</span>
                            <span className="energy-detail-value">{meter.maloId}</span>
                          </div>
                        )}
                        {meter.lieferanschrift && (
                          <div className="energy-detail-item">
                            <span className="energy-detail-key">Lieferanschrift:</span>
                            <span className="energy-detail-value">{meter.lieferanschrift}</span>
                          </div>
                        )}
                        {meter.kontaktanschrift && (
                          <div className="energy-detail-item">
                            <span className="energy-detail-key">Kontaktanschrift:</span>
                            <span className="energy-detail-value">{meter.kontaktanschrift}</span>
                          </div>
                        )}
                      </div>
                    ))}
                    {lead.energy?.gas?.filter(m => m.zählernummer).map((meter, idx) => (
                      <div key={idx} className="energy-detail-card gas">
                        <div className="energy-detail-label">🔥 Gas {idx + 1}</div>
                        <div className="energy-detail-item">
                          <span className="energy-detail-key">Zählernummer:</span>
                          <span className="energy-detail-value">{meter.zählernummer}</span>
                        </div>
                        {meter.maloId && (
                          <div className="energy-detail-item">
                            <span className="energy-detail-key">MALO-ID:</span>
                            <span className="energy-detail-value">{meter.maloId}</span>
                          </div>
                        )}
                        {meter.lieferanschrift && (
                          <div className="energy-detail-item">
                            <span className="energy-detail-key">Lieferanschrift:</span>
                            <span className="energy-detail-value">{meter.lieferanschrift}</span>
                          </div>
                        )}
                        {meter.kontaktanschrift && (
                          <div className="energy-detail-item">
                            <span className="energy-detail-key">Kontaktanschrift:</span>
                            <span className="energy-detail-value">{meter.kontaktanschrift}</span>
                          </div>
                        )}
                      </div>
                    ))}
                  </>
                ) : (
                  <p className="empty-energy-info">Keine Energieinformationen erfasst</p>
                )}
              </div>
            </div>
            {lead.createdBy && (
              <div className="drawer-created-by">
                Erstellt von <strong>{lead.createdBy.email}</strong> am {formatDateTime(lead.createdBy.timestamp)}
              </div>
            )}
          </div>
        )}

        {/* Tab: Anhänge */}
        {drawerTab === "attachments" && (
          <div className="drawer-tab-content">
            <div className="attachments-upload-zone">
              <label htmlFor={`drawer-file-${lead.id}`} className="attachment-upload-label">
                📎 Dateien hochladen (max 10 MB)
              </label>
              <input
                id={`drawer-file-${lead.id}`} type="file" multiple className="file-input"
                onChange={e => onAddAttachment(lead.id, e.target.files)}
              />
            </div>
            {lead.attachments && lead.attachments.length > 0 ? (
              <div className="attachments-list-drawer">
                {lead.attachments.map(att => (
                  <div key={att.id} className="attachment-row">
                    <div className="attachment-row-info">
                      <span className="att-name">{att.name}</span>
                      <span className="att-meta">{(att.size / 1024).toFixed(1)} KB · {formatDate(att.uploadedAt)}</span>
                    </div>
                    <div className="attachment-row-actions">
                      <button type="button" onClick={() => setPreviewAttachment(att)} className="att-btn preview" title="Vorschau">👁</button>
                      <a href={att.data} download={att.name} className="att-btn download" title="Herunterladen">⬇</a>
                      <button type="button" onClick={() => setDeleteConfirmId(att.id)} className="att-btn delete" title="Löschen">✕</button>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="empty-timeline">Keine Anhänge vorhanden.</p>
            )}
          </div>
        )}

        {/* Preview Modal */}
        {previewAttachment && (
          <div className="modal-backdrop" onClick={() => setPreviewAttachment(null)}>
            <div className="preview-modal" onClick={e => e.stopPropagation()}>
              <div className="preview-header">
                <h3>{previewAttachment.name}</h3>
                <button className="preview-close" onClick={() => setPreviewAttachment(null)}>✕</button>
              </div>
              <div className="preview-content">
                {previewAttachment.type?.startsWith("image/") ? (
                  <img src={previewAttachment.data} alt={previewAttachment.name} className="preview-image" />
                ) : previewAttachment.type === "application/pdf" ? (
                  <div className="preview-pdf">
                    <p>📄 PDF-Datei</p>
                    <a href={previewAttachment.data} target="_blank" rel="noreferrer" className="primary-btn-modal">PDF öffnen</a>
                  </div>
                ) : previewAttachment.type?.startsWith("text/") || previewAttachment.name?.match(/\.(txt|json|csv|md)$/i) ? (
                  <div className="preview-text">
                    <pre>{previewAttachment.data?.substring(0, 2000) || "Datei konnte nicht angezeigt werden"}</pre>
                    {previewAttachment.data?.length > 2000 && <p className="preview-truncated">... Datei gekürzt (max 2000 Zeichen)</p>}
                  </div>
                ) : (
                  <div className="preview-generic">
                    <p>📎 {previewAttachment.type || "Unbekannter Dateityp"}</p>
                    <a href={previewAttachment.data} download={previewAttachment.name} className="primary-btn-modal">Datei herunterladen</a>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Delete Confirmation Modal */}
        {deleteConfirmId && (
          <div className="modal-backdrop" onClick={() => setDeleteConfirmId(null)}>
            <div className="confirm-modal" onClick={e => e.stopPropagation()}>
              <div className="confirm-icon">⚠️</div>
              <h3>Anhang löschen?</h3>
              <p>Diese Aktion kann nicht rückgängig gemacht werden.</p>
              <div className="confirm-actions">
                <button className="ghost-btn" onClick={() => setDeleteConfirmId(null)}>Abbrechen</button>
                <button className="danger-btn" onClick={() => {
                  onRemoveAttachment(lead.id, deleteConfirmId);
                  setDeleteConfirmId(null);
                }}>Löschen</button>
              </div>
            </div>
          </div>
        )}

        <div className="drawer-footer">
          <button className="danger-btn-sm" onClick={handleDelete}>Lead löschen</button>
        </div>
      </div>
    </div>
  );
}

// ─── NewLeadModal ─────────────────────────────────────────────────────────────
function NewLeadModal({ onClose, onSubmit, loading }) {
  const [form, setForm] = useState(initialForm);
  const handleChange = (e) => {
    const { name, value, type, checked } = e.target;
    setForm(prev => ({ ...prev, [name]: type === "checkbox" ? checked : value }));
  };
  const handleFile = (e) => {
    Array.from(e.target.files).forEach(file => {
      if (file.size > 10 * 1024 * 1024) return alert(`${file.name} ist zu groß (max 10MB)`);
      const reader = new FileReader();
      reader.onload = ev => setForm(prev => ({
        ...prev,
        attachments: [...prev.attachments, {
          id: Date.now() + Math.random(), name: file.name,
          size: file.size, type: file.type, data: ev.target.result, uploadedAt: new Date().toISOString(),
        }],
      }));
      reader.readAsDataURL(file);
    });
  };
  const handleSubmit = (e) => {
    e.preventDefault();
    onSubmit(form, () => { setForm(initialForm); onClose(); });
  };
  return (
    <div className="modal-backdrop" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal">
        <div className="modal-header">
          <h2>Neuer Lead</h2>
          <button className="drawer-close-btn" onClick={onClose}>✕</button>
        </div>
        <form onSubmit={handleSubmit} className="modal-form">
          <div className="modal-form-grid">
            <div className="form-group">
              <label>Firma</label>
              <input name="company" placeholder="Firmenname" value={form.company} onChange={handleChange} disabled={loading} />
            </div>
            <div className="form-group">
              <label>Ansprechpartner *</label>
              <input name="person" placeholder="Name" value={form.person} onChange={handleChange} disabled={loading} required />
            </div>
            <div className="form-group">
              <label>Geburtsdatum</label>
              <input type="date" name="geburtsdatum" value={form.geburtsdatum} onChange={handleChange} disabled={loading} />
            </div>
            <div className="form-group">
              <label>Telefon *</label>
              <input name="phone" type="tel" placeholder="+49..." value={form.phone} onChange={handleChange} disabled={loading} required />
            </div>
            <div className="form-group">
              <label>E-Mail *</label>
              <input name="email" type="email" placeholder="name@firma.de" value={form.email} onChange={handleChange} disabled={loading} required />
            </div>
            <div className="form-group">
              <label>PLZ *</label>
              <input name="postalCode" placeholder="12345" value={form.postalCode} onChange={handleChange} disabled={loading} required />
            </div>
            <div className="form-group">
              <label>Kundentyp</label>
              <select name="customerType" value={form.customerType} onChange={handleChange} disabled={loading}>
                <option>Privat</option><option>Gewerbe</option><option>Großkunde</option>
              </select>
            </div>
            <div className="form-group">
              <label>Aktueller Anbieter</label>
              <input name="currentProvider" placeholder="z.B. E.ON" value={form.currentProvider} onChange={handleChange} disabled={loading} />
            </div>
            <div className="form-group">
              <label>Verbrauch (kWh)</label>
              <input name="consumption" type="number" placeholder="50000" value={form.consumption} onChange={handleChange} disabled={loading} />
            </div>
            <div className="form-group">
              <label>Jahreskosten (€)</label>
              <input name="annualCosts" type="number" placeholder="3500" value={form.annualCosts} onChange={handleChange} disabled={loading} />
            </div>
            <div className="form-group">
              <label>Vertragsende</label>
              <select name="contractEnd" value={form.contractEnd} onChange={handleChange} disabled={loading}>
                <option value="unknown">Unbekannt</option>
                <option value="">Datum eingeben...</option>
              </select>
              {form.contractEnd !== "unknown" && (
                <input type="date" name="contractEnd" value={form.contractEnd} onChange={handleChange} disabled={loading} style={{ marginTop: 6 }} />
              )}
            </div>
            <div className="form-group">
              <label>Nachfass-Datum</label>
              <input type="date" name="followUp" value={form.followUp} onChange={handleChange} disabled={loading} />
            </div>

            <div className="form-group form-group-full">
              <div className="energy-section-header">
                <label>⚡ Stromzähler</label>
                <button type="button" className="add-meter-btn" onClick={() => setForm(p => ({
                  ...p,
                  energy: { ...p.energy, strom: [...p.energy.strom, { zählernummer: "", maloId: "", lieferanschrift: "", kontaktanschrift: "" }] }
                }))} disabled={loading}>+ Zähler hinzufügen</button>
              </div>
              {form.energy.strom.map((meter, idx) => (
                <div key={idx} className="meter-card strom">
                  <div className="meter-card-header">
                    <span className="meter-index">Stromzähler {idx + 1}</span>
                    {form.energy.strom.length > 1 && (
                      <button type="button" className="remove-meter-btn" onClick={() => setForm(p => ({
                        ...p,
                        energy: { ...p.energy, strom: p.energy.strom.filter((_, i) => i !== idx) }
                      }))} disabled={loading}>✕ Entfernen</button>
                    )}
                  </div>
                  <div className="meter-grid">
                    <div className="form-group">
                      <label>Zählernummer</label>
                      <input type="text" placeholder="z.B. 123456789" value={meter.zählernummer} onChange={(e) => setForm(p => ({
                        ...p,
                        energy: { ...p.energy, strom: p.energy.strom.map((m, i) => i === idx ? { ...m, zählernummer: e.target.value } : m) }
                      }))} disabled={loading} />
                    </div>
                    <div className="form-group">
                      <label>MALO-ID</label>
                      <input type="text" placeholder="Marktlokations-ID" value={meter.maloId} onChange={(e) => setForm(p => ({
                        ...p,
                        energy: { ...p.energy, strom: p.energy.strom.map((m, i) => i === idx ? { ...m, maloId: e.target.value } : m) }
                      }))} disabled={loading} />
                    </div>
                    <div className="form-group">
                      <label>Lieferanschrift</label>
                      <input type="text" placeholder="optional" value={meter.lieferanschrift} onChange={(e) => setForm(p => ({
                        ...p,
                        energy: { ...p.energy, strom: p.energy.strom.map((m, i) => i === idx ? { ...m, lieferanschrift: e.target.value } : m) }
                      }))} disabled={loading} />
                    </div>
                    <div className="form-group">
                      <label>Kontaktanschrift</label>
                      <input type="text" placeholder="optional" value={meter.kontaktanschrift} onChange={(e) => setForm(p => ({
                        ...p,
                        energy: { ...p.energy, strom: p.energy.strom.map((m, i) => i === idx ? { ...m, kontaktanschrift: e.target.value } : m) }
                      }))} disabled={loading} />
                    </div>
                  </div>
                </div>
              ))}
            </div>

            <div className="form-group form-group-full">
              <div className="energy-section-header">
                <label>🔥 Gaszähler</label>
                <button type="button" className="add-meter-btn" onClick={() => setForm(p => ({
                  ...p,
                  energy: { ...p.energy, gas: [...p.energy.gas, { zählernummer: "", maloId: "", lieferanschrift: "", kontaktanschrift: "" }] }
                }))} disabled={loading}>+ Zähler hinzufügen</button>
              </div>
              {form.energy.gas.map((meter, idx) => (
                <div key={idx} className="meter-card gas">
                  <div className="meter-card-header">
                    <span className="meter-index">Gaszähler {idx + 1}</span>
                    {form.energy.gas.length > 1 && (
                      <button type="button" className="remove-meter-btn" onClick={() => setForm(p => ({
                        ...p,
                        energy: { ...p.energy, gas: p.energy.gas.filter((_, i) => i !== idx) }
                      }))} disabled={loading}>✕ Entfernen</button>
                    )}
                  </div>
                  <div className="meter-grid">
                    <div className="form-group">
                      <label>Zählernummer</label>
                      <input type="text" placeholder="z.B. 987654321" value={meter.zählernummer} onChange={(e) => setForm(p => ({
                        ...p,
                        energy: { ...p.energy, gas: p.energy.gas.map((m, i) => i === idx ? { ...m, zählernummer: e.target.value } : m) }
                      }))} disabled={loading} />
                    </div>
                    <div className="form-group">
                      <label>MALO-ID</label>
                      <input type="text" placeholder="Marktlokations-ID" value={meter.maloId} onChange={(e) => setForm(p => ({
                        ...p,
                        energy: { ...p.energy, gas: p.energy.gas.map((m, i) => i === idx ? { ...m, maloId: e.target.value } : m) }
                      }))} disabled={loading} />
                    </div>
                    <div className="form-group">
                      <label>Lieferanschrift</label>
                      <input type="text" placeholder="optional" value={meter.lieferanschrift} onChange={(e) => setForm(p => ({
                        ...p,
                        energy: { ...p.energy, gas: p.energy.gas.map((m, i) => i === idx ? { ...m, lieferanschrift: e.target.value } : m) }
                      }))} disabled={loading} />
                    </div>
                    <div className="form-group">
                      <label>Kontaktanschrift</label>
                      <input type="text" placeholder="optional" value={meter.kontaktanschrift} onChange={(e) => setForm(p => ({
                        ...p,
                        energy: { ...p.energy, gas: p.energy.gas.map((m, i) => i === idx ? { ...m, kontaktanschrift: e.target.value } : m) }
                      }))} disabled={loading} />
                    </div>
                  </div>
                </div>
              ))}
            </div>
            <div className="form-group form-group-full">
              <label className="checkbox-label">
                <input type="checkbox" name="bundleInquiry" checked={form.bundleInquiry} onChange={handleChange} disabled={loading} />
                Bündelanfrage (mehrere Lieferstellen)
              </label>
            </div>
            <div className="form-group form-group-full">
              <div className="file-upload-zone">
                <label htmlFor="modal-file-input" className="file-upload-zone-label">📎 Dateien anfügen (max 10MB)</label>
                <input id="modal-file-input" type="file" multiple onChange={handleFile} className="file-input" />
                {form.attachments.length > 0 && (
                  <div className="att-preview">
                    {form.attachments.map(a => (
                      <span key={a.id} className="att-chip">
                        {a.name}
                        <button type="button" onClick={() => setForm(p => ({ ...p, attachments: p.attachments.filter(x => x.id !== a.id) }))}>✕</button>
                      </span>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
          <div className="modal-footer">
            <button type="button" className="ghost-btn" onClick={onClose}>Abbrechen</button>
            <button type="submit" className="primary-btn-modal" disabled={loading}>
              {loading ? "Wird gespeichert..." : "Lead anlegen"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ─── LeadRow ──────────────────────────────────────────────────────────────────
function LeadRow({ lead, onSelect, isSelected }) {
  const priority = calculatePriority(lead);
  const hasCancellationWindow = isOpenCancellationWindow(lead.contractEnd);
  const isOverdueNow = isOverdue(lead.followUp);
  const isTodayNow = isTodayDue(lead.followUp);
  const meta = STATUS_META[lead.status] || STATUS_META.Neu;
  const umsatz = calculateUmsatzPotential(lead.consumption);
  const activityCount = getLeadActivityCount(lead);
  const temperature = getLeadTemperature(lead);
  const nextAction = getNextAction(lead);
  const owner = getLeadOwnerEmail(lead);
  const lastActivityAt = getLastActivityTimestamp(lead);
  const stromCount = getEnergyMeterCount(lead, "strom");
  const gasCount = getEnergyMeterCount(lead, "gas");
  const deliveryPoints = getTotalDeliveryPoints(lead);
  return (
    <div className={`lead-row ${isSelected ? "selected" : ""}`} onClick={() => onSelect(lead)}>
      <div className="lead-row-prio">
        <span className={`prio-dot prio-${priority}`} title={`Priorität ${priority}`} />
      </div>
      <div className="lead-row-main">
        <div className="lead-row-company">{lead.company || <em className="no-company">Kein Firmenname</em>}</div>
        <div className="lead-row-sub">
          {lead.person}
          {lead.phone ? (
            <>
              {" · "}
              <a
                className="lead-phone-link"
                href={`tel:${lead.phone}`}
                onClick={e => e.stopPropagation()}
              >{lead.phone}</a>
            </>
          ) : ""}
        </div>
        <div className="lead-row-owner">Owner: {owner}</div>
      </div>
      <div className="lead-row-energy">
        {stromCount > 0 && <span className="energy-badge strom">🔌 Strom x{stromCount}</span>}
        {gasCount > 0 && <span className="energy-badge gas">🔥 Gas x{gasCount}</span>}
        {deliveryPoints > 0 && (
          <span className={`energy-badge total ${deliveryPoints >= 3 ? "high" : ""}`}>
            📍 {deliveryPoints} Lieferstellen
          </span>
        )}
      </div>
      <div className="lead-row-health">
        <span className={`health-pill ${temperature.tone}`}>{temperature.label}</span>
        <span className={`next-action-pill ${nextAction.tone}`}>{nextAction.label}</span>
      </div>
      <div className="lead-row-status">
        <span className="status-chip" style={{ background: meta.bg, color: meta.color }}>{lead.status}</span>
      </div>
      <div className="lead-row-umsatz">{formatEuro(umsatz)}</div>
      <div className="lead-row-followup">
        {lead.followUp ? (
          <span className={isOverdueNow ? "date-overdue" : isTodayNow ? "date-today" : ""}>
            {formatDate(lead.followUp)}
          </span>
        ) : hasCancellationWindow ? (
          <span className="followup-chip cancellation" title="Kündigungsfenster offen">
            Künd.-Fenster
          </span>
        ) : "—"}
      </div>
      <div className="lead-row-activity">
        <span className="activity-count">{activityCount}</span>
        <span className="last-activity-label">{lastActivityAt ? formatDate(lastActivityAt) : "Neu"}</span>
      </div>
    </div>
  );
}

// ─── KanbanBoard ──────────────────────────────────────────────────────────────
function KanbanBoard({ leads, onSelectLead }) {
  return (
    <div className="kanban-board">
      {STATUS_OPTIONS.map(status => {
        const col = leads.filter(l => l.status === status);
        const meta = STATUS_META[status];
        const colUmsatz = col.reduce((s, l) => s + calculateUmsatzPotential(l.consumption), 0);
        return (
          <div key={status} className="kanban-col">
            <div className="kanban-col-header" style={{ borderTopColor: meta.color }}>
              <span className="kanban-status-name" style={{ color: meta.color }}>{status}</span>
              <div className="kanban-col-meta">
                <span className="kanban-count">{col.length}</span>
                <span className="kanban-col-umsatz">{formatEuro(colUmsatz)}</span>
              </div>
            </div>
            <div className="kanban-cards">
              {col.map(lead => {
                const p = calculatePriority(lead);
                const stromCount = getEnergyMeterCount(lead, "strom");
                const gasCount = getEnergyMeterCount(lead, "gas");
                const deliveryPoints = getTotalDeliveryPoints(lead);
                return (
                  <div key={lead.id} className={`kanban-card prio-border-${p}`} onClick={() => onSelectLead(lead)}>
                    <div className="kanban-card-header">
                      <span className="kanban-company">{lead.company || lead.person}</span>
                      <span className={`prio-dot prio-${p}`} />
                    </div>
                    <div className="kanban-person">{lead.person}</div>
                    <div className="kanban-energy">
                      {stromCount > 0 && <span className="energy-badge strom">🔌 x{stromCount}</span>}
                      {gasCount > 0 && <span className="energy-badge gas">🔥 x{gasCount}</span>}
                      {deliveryPoints > 0 && (
                        <span className={`energy-badge total ${deliveryPoints >= 3 ? "high" : ""}`}>
                          📍 {deliveryPoints}
                        </span>
                      )}
                    </div>
                    <div className="kanban-card-footer">
                      <span className="kanban-umsatz-chip">{formatEuro(calculateUmsatzPotential(lead.consumption))}</span>
                      <div className="kanban-flags">
                        {isOpenCancellationWindow(lead.contractEnd) && <span title="Kündigungsfenster">🔔</span>}
                        {isOverdue(lead.followUp) && <span title="Überfällig">⏰</span>}
                      </div>
                    </div>
                  </div>
                );
              })}
              {col.length === 0 && <div className="kanban-empty">Keine Leads</div>}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ─── Dashboard ────────────────────────────────────────────────────────────────
function Dashboard({ leads, teamMembers }) {
  const stats = useMemo(() => {
    const byStatus = STATUS_OPTIONS.map(s => ({ label: s, count: leads.filter(l => l.status === s).length }));
    const topPerformer = teamMembers.map(m => {
      const ml = leads.filter(l => l.createdBy?.email === m.email);
      return {
        email: m.email, role: m.role, total: ml.length,
        won: ml.filter(l => l.status === "Gewonnen").length,
        umsatz: ml.reduce((s, l) => s + calculateUmsatzPotential(l.consumption), 0),
      };
    }).sort((a, b) => b.won - a.won);
    const totalUmsatz = leads.reduce((s, l) => s + calculateUmsatzPotential(l.consumption), 0);
    const wonLeads = leads.filter(l => l.status === "Gewonnen").length;
    const closingRate = leads.length > 0 ? Math.round((wonLeads / leads.length) * 100) : 0;
    return { byStatus, topPerformer, totalUmsatz, wonLeads, closingRate };
  }, [leads, teamMembers]);

  const maxCount = Math.max(...stats.byStatus.map(s => s.count), 1);
  const statusColors = { Neu: "#6c757d", Kontaktiert: "#0d6efd", Angebot: "#fd7e14", Nachfassen: "#ffc107", Gewonnen: "#198754", Verloren: "#dc3545" };

  return (
    <div className="dashboard-grid">
      <div className="card dashboard-card">
        <h2>📊 Leads nach Status</h2>
        <div className="bar-chart">
          {stats.byStatus.map(s => (
            <div key={s.label} className="bar-row">
              <span className="bar-label">{s.label}</span>
              <div className="bar-track">
                <div className="bar-fill" style={{ width: `${(s.count / maxCount) * 100}%`, background: statusColors[s.label] || "#0d6efd" }} />
              </div>
              <span className="bar-count">{s.count}</span>
            </div>
          ))}
        </div>
        <div className="dashboard-summary">
          <div className="summary-item"><span>Closing rate</span><strong className={getClosingRateClass(stats.closingRate)}>{stats.closingRate}%</strong></div>
          <div className="summary-item"><span>Gewonnen</span><strong>{stats.wonLeads}</strong></div>
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
                  <span title="Gewonnen">✅ {p.won}</span>
                  <span title="Umsatz">💶 {formatEuro(p.umsatz)}</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Team-Verwaltung ──────────────────────────────────────────────────────────
function TeamManagement({ currentUser, teamId, teamMembers, onRefresh, userRole, canAssignAdmins }) {
  // Tabs: "invite-email" | "add-manual" | "invite-link" | "members"
  const [activeSection, setActiveSection] = useState("members");

  // Email-Einladung
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState("agent");

  // Manuell anlegen
  const [manualEmail, setManualEmail] = useState("");
  const [manualRole, setManualRole] = useState("agent");

  // Einladungslink
  const [inviteLink, setInviteLink] = useState(null);
  const [linkCopied, setLinkCopied] = useState(false);
  const [linkExpiry, setLinkExpiry] = useState("48"); // Stunden
  const [linkRole, setLinkRole] = useState("agent");

  const [statusMsg, setStatusMsg] = useState(null);
  const [loading, setLoading] = useState(false);

  // userRole prop is the authoritative source (set by onAuthStateChanged)
  const isAdmin = userRole === "admin";
  const adminCount = teamMembers.filter(m => m.role === "admin").length;

  const setMsg = (type, msg) => { setStatusMsg({ type, msg }); setTimeout(() => setStatusMsg(null), 5000); };

  // ── 1. Per E-Mail einladen ─────────────────────────────────────────────────
  const inviteByEmail = async () => {
    if (!inviteEmail.trim()) return;
    setLoading(true);
    try {
      const normalizedEmail = inviteEmail.trim().toLowerCase();
      const nextRole = canAssignAdmins ? inviteRole : "agent";
      const q = query(collection(db, "users"), where("email", "==", normalizedEmail));
      const snap = await getDocs(q);
      const existingInvQ = query(collection(db, "invitations"), where("invitedEmail", "==", normalizedEmail), where("status", "==", "pending"));
      const existingInvSnap = await getDocs(existingInvQ);
      if (snap.empty) {
        if (!existingInvSnap.empty) {
          await updateDoc(existingInvSnap.docs[0].ref, {
            teamId,
            role: nextRole,
            invitedBy: currentUser.email,
            updatedAt: new Date().toISOString(),
          });
          setMsg("info", `Einladung für ${inviteEmail} aktualisiert.`);
        } else {
          await addDoc(collection(db, "invitations"), {
            teamId,
            invitedBy: currentUser.email,
            invitedEmail: normalizedEmail,
            role: nextRole,
            createdAt: new Date().toISOString(),
            status: "pending",
          });
          setMsg("info", `Einladung für ${inviteEmail} gespeichert. Wird beim nächsten Login zugewiesen.`);
        }
      } else {
        try {
          await updateDoc(doc(db, "users", snap.docs[0].id), { teamId, role: nextRole });
          setMsg("success", `${inviteEmail} wurde als ${nextRole === "admin" ? "Admin" : "Agent"} hinzugefügt.`);
        } catch {
          if (!existingInvSnap.empty) {
            await updateDoc(existingInvSnap.docs[0].ref, {
              teamId,
              role: nextRole,
              invitedBy: currentUser.email,
              updatedAt: new Date().toISOString(),
            });
            setMsg("info", `${inviteEmail} wurde als Einladung aktualisiert.`);
          } else {
            await addDoc(collection(db, "invitations"), {
              teamId,
              invitedBy: currentUser.email,
              invitedEmail: normalizedEmail,
              role: nextRole,
              createdAt: new Date().toISOString(),
              status: "pending",
            });
            setMsg("info", `${inviteEmail} wurde als Einladung hinterlegt. Wird beim nächsten Login automatisch zugewiesen.`);
          }
        }
      }
      await fetch("/api/send-invite", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ to: normalizedEmail, invitedBy: currentUser.email, teamId, role: nextRole }),
      }).catch(() => {});
      setInviteEmail("");
      setInviteRole("agent");
      onRefresh();
    } catch (e) {
      console.error("inviteByEmail error:", e?.code, e?.message, e);
      setMsg("error", `Fehler beim Einladen (${e?.code || "unknown"}).`);
    }
    setLoading(false);
  };

  // ── 2. Manuell anlegen ────────────────────────────────────────────────────
  const addManually = async () => {
    if (!manualEmail.trim()) return;
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(manualEmail.trim())) {
      setMsg("error", "Bitte eine gültige E-Mail-Adresse eingeben.");
      return;
    }
    setLoading(true);
    try {
      const normalizedEmail = manualEmail.trim().toLowerCase();
      const nextRole = canAssignAdmins ? manualRole : "agent";
      const q = query(collection(db, "users"), where("email", "==", normalizedEmail));
      const snap = await getDocs(q);
      const existingInvQ = query(collection(db, "invitations"), where("invitedEmail", "==", normalizedEmail), where("status", "==", "pending"));
      const existingInvSnap = await getDocs(existingInvQ);
      if (!snap.empty) {
        try {
          await updateDoc(doc(db, "users", snap.docs[0].id), { teamId, role: nextRole });
          setMsg("success", `${manualEmail} wurde als ${nextRole === "admin" ? "Admin" : "Agent"} hinzugefügt.`);
        } catch {
          if (!existingInvSnap.empty) {
            await updateDoc(existingInvSnap.docs[0].ref, {
              teamId,
              role: nextRole,
              invitedBy: currentUser.email,
              addedManually: true,
              updatedAt: new Date().toISOString(),
            });
            setMsg("info", `${manualEmail} wurde als Einladung aktualisiert.`);
          } else {
            await addDoc(collection(db, "invitations"), {
              teamId,
              invitedBy: currentUser.email,
              invitedEmail: normalizedEmail,
              role: nextRole,
              createdAt: new Date().toISOString(),
              status: "pending",
              addedManually: true,
            });
            setMsg("info", `${manualEmail} wurde als Einladung hinterlegt. Beim nächsten Login erfolgt die Team-Zuweisung.`);
          }
        }
      } else {
        if (!existingInvSnap.empty) {
          await updateDoc(existingInvSnap.docs[0].ref, {
            teamId,
            role: nextRole,
            invitedBy: currentUser.email,
            addedManually: true,
            updatedAt: new Date().toISOString(),
          });
          setMsg("info", `${manualEmail} wurde vorgemerkt (Einladung aktualisiert).`);
        } else {
          await addDoc(collection(db, "invitations"), {
            teamId,
            invitedBy: currentUser.email,
            invitedEmail: normalizedEmail,
            role: nextRole,
            createdAt: new Date().toISOString(),
            status: "pending",
            addedManually: true,
          });
          setMsg("info", `${manualEmail} wurde vorgemerkt. Sobald sich diese Person registriert, wird sie automatisch zugewiesen.`);
        }
      }
      setManualEmail("");
      setManualRole("agent");
      onRefresh();
    } catch (e) {
      console.error("addManually error:", e?.code, e?.message, e);
      setMsg("error", `Fehler beim manuellen Hinzufügen (${e?.code || "unknown"}).`);
    }
    setLoading(false);
  };

  // ── 3. Einladungslink generieren ──────────────────────────────────────────
  const generateInviteLink = async () => {
    setLoading(true);
    try {
      const nextRole = canAssignAdmins ? linkRole : "agent";
      const token = [...crypto.getRandomValues(new Uint8Array(24))]
        .map(b => b.toString(16).padStart(2, "0")).join("");
      const expiresAt = new Date(Date.now() + parseInt(linkExpiry) * 60 * 60 * 1000).toISOString();
      await setDoc(doc(db, "inviteLinks", token), {
        teamId,
        createdBy: currentUser.email,
        role: nextRole,
        createdAt: new Date().toISOString(),
        expiresAt,
        usageCount: 0,
      });
      const link = `${window.location.origin}?invite=${token}`;
      setInviteLink(link);
      setLinkRole("agent");
      setMsg("success", "Einladungslink erstellt.");
    } catch (e) {
      setMsg("error", "Fehler beim Erstellen des Links.");
    }
    setLoading(false);
  };

  const copyLink = () => {
    navigator.clipboard.writeText(inviteLink).then(() => {
      setLinkCopied(true);
      setTimeout(() => setLinkCopied(false), 2500);
    });
  };

  // ── 4. Mitglied entfernen ─────────────────────────────────────────────────
  const removeMember = async (email) => {
    const target = teamMembers.find(m => m.email === email);
    if (target?.role === "admin" && adminCount <= 1) {
      setMsg("error", "Mindestens ein Admin muss im Team bleiben.");
      return;
    }
    if (!window.confirm(`${email} aus dem Team entfernen?`)) return;
    try {
      const q = query(collection(db, "users"), where("email", "==", email));
      const snap = await getDocs(q);
      if (!snap.empty) {
        await updateDoc(doc(db, "users", snap.docs[0].id), {
          teamId: `team-${snap.docs[0].id}`,
          role: "admin",
        });
        onRefresh();
      }
    } catch (e) { console.error(e); }
  };

  // ── 5. Rolle wechseln ─────────────────────────────────────────────────────
  const toggleRole = async (email, currentRole) => {
    if (!canAssignAdmins) {
      setMsg("error", "Nur freigeschaltete Top-Admins dürfen Admin-Rollen vergeben.");
      return;
    }
    if (currentRole === "admin" && adminCount <= 1) {
      setMsg("error", "Der letzte Admin kann nicht zu Agent geändert werden.");
      return;
    }
    try {
      const q = query(collection(db, "users"), where("email", "==", email));
      const snap = await getDocs(q);
      if (!snap.empty) {
        await updateDoc(doc(db, "users", snap.docs[0].id), {
          role: currentRole === "admin" ? "agent" : "admin",
        });
        onRefresh();
      }
    } catch (e) { console.error(e); }
  };

  const SECTIONS = [
    { id: "members",      label: "Mitglieder",       icon: "👥" },
    { id: "invite-email", label: "Per E-Mail",        icon: "✉️" },
    { id: "add-manual",   label: "Manuell anlegen",  icon: "➕" },
    { id: "invite-link",  label: "Einladungslink",   icon: "🔗" },
  ];

  return (
    <div className="team-page">
      <div className="team-page-header">
        <div>
          <h1 className="page-title">Team-Verwaltung</h1>
          <p className="team-id-info">Team-ID: <code>{teamId}</code></p>
          {isAdmin && !canAssignAdmins && <p className="team-role-hint">Neue Mitglieder werden standardmäßig als Agent angelegt. Admin-Rollen dürfen nur freigeschaltete Top-Admins vergeben.</p>}
        </div>
        {!isAdmin && (
          <p className="team-role-hint">Du bist als Agent angemeldet. Einladen und Rollen verwalten sind nur für Admins verfügbar.</p>
        )}
      </div>

      {/* Section-Tabs */}
      <div className="team-section-nav">
        {SECTIONS.map(s => (
          <button
            key={s.id}
            className={`team-section-tab ${activeSection === s.id ? "active" : ""} ${!isAdmin && s.id !== "members" ? "disabled" : ""}`}
            onClick={() => isAdmin || s.id === "members" ? setActiveSection(s.id) : setMsg("error", "Nur für Admins verfügbar.")}
          >
            <span>{s.icon}</span> {s.label}
            {s.id === "members" && <span className="team-tab-count">{teamMembers.length}</span>}
          </button>
        ))}
      </div>

      {statusMsg && <div className={`invite-status ${statusMsg.type}`}>{statusMsg.msg}</div>}

      {/* ── Mitglieder-Liste ── */}
      {activeSection === "members" && (
        <div className="card team-members-card">
          {teamMembers.length === 0 ? (
            <p className="empty-text">Noch keine Teammitglieder. Nutze die Tabs oben, um Mitglieder hinzuzufügen.</p>
          ) : (
            <table className="members-table">
              <thead>
                <tr>
                  <th>E-Mail</th>
                  <th>Rolle</th>
                  <th>Beigetreten</th>
                  {isAdmin && <th>Aktionen</th>}
                </tr>
              </thead>
              <tbody>
                {teamMembers.map(m => (
                  <tr key={m.email} className={m.email === currentUser.email ? "members-table-self" : ""}>
                    <td>
                      <div className="member-email-cell">
                        <div className="member-avatar-sm">{m.email[0].toUpperCase()}</div>
                        <span>{m.email}</span>
                        {m.email === currentUser.email && <span className="you-chip">Du</span>}
                      </div>
                    </td>
                    <td>
                      <span className={`member-role-badge ${m.role}`}>
                        {m.role === "admin" ? "👑 Admin" : "🧑 Agent"}
                      </span>
                    </td>
                    <td className="member-date">{m.createdAt ? formatDate(m.createdAt) : "—"}</td>
                    {isAdmin && (
                      <td>
                        {m.email !== currentUser.email ? (
                          <div className="member-actions">
                            {canAssignAdmins && <button className="small-btn" onClick={() => toggleRole(m.email, m.role)} title="Rolle wechseln">
                              {m.role === "admin" ? "→ Agent" : "→ Admin"}
                            </button>}
                            <button className="small-btn danger" onClick={() => removeMember(m.email)} title="Entfernen">Entfernen</button>
                          </div>
                        ) : <span className="muted-text">—</span>}
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {/* ── Per E-Mail einladen ── */}
      {activeSection === "invite-email" && isAdmin && (
        <div className="card team-action-card">
          <h3>Mitglied per E-Mail einladen</h3>
          <p className="action-desc">
            Gib die E-Mail-Adresse ein. Ist die Person bereits registriert, wird sie sofort dem Team zugeordnet.
            Andernfalls wird eine Einladung gespeichert und beim nächsten Login aktiviert.
          </p>
          <div className="action-form">
            <div className="form-row">
              <label>E-Mail-Adresse</label>
              <input
                type="email"
                placeholder="kollege@beispiel.de"
                value={inviteEmail}
                onChange={e => setInviteEmail(e.target.value)}
                onKeyDown={e => e.key === "Enter" && inviteByEmail()}
                disabled={loading}
              />
            </div>
            {canAssignAdmins ? (
              <div className="form-row">
                <label>Rolle</label>
                <div className="role-picker">
                  <button
                    className={`role-pick-btn ${inviteRole === "agent" ? "active" : ""}`}
                    onClick={() => setInviteRole("agent")}
                  >
                    🧑 Agent
                    <span className="role-desc">Leads anlegen &amp; bearbeiten</span>
                  </button>
                  <button
                    className={`role-pick-btn ${inviteRole === "admin" ? "active" : ""}`}
                    onClick={() => setInviteRole("admin")}
                  >
                    👑 Admin
                    <span className="role-desc">Team verwalten, alle Rechte</span>
                  </button>
                </div>
              </div>
            ) : <p className="team-inline-hint">Neue Einladungen werden in deinem Team automatisch als Agent angelegt.</p>}
            <button className="primary-btn" onClick={inviteByEmail} disabled={loading || !inviteEmail.trim()}>
              {loading ? "Wird gesendet..." : "Einladung senden"}
            </button>
          </div>
        </div>
      )}

      {/* ── Manuell anlegen ── */}
      {activeSection === "add-manual" && isAdmin && (
        <div className="card team-action-card">
          <h3>Mitglied manuell hinzufügen</h3>
          <p className="action-desc">
            Trage die E-Mail-Adresse direkt ein. Ist die Person bereits registriert, wird sie sofort zugeordnet.
            Noch nicht registrierte Personen werden vorgemerkt.
          </p>
          <div className="action-form">
            <div className="form-row">
              <label>E-Mail-Adresse</label>
              <input
                type="email"
                placeholder="kollege@beispiel.de"
                value={manualEmail}
                onChange={e => setManualEmail(e.target.value)}
                onKeyDown={e => e.key === "Enter" && addManually()}
                disabled={loading}
              />
            </div>
            {canAssignAdmins ? (
              <div className="form-row">
                <label>Rolle</label>
                <div className="role-picker">
                  <button
                    className={`role-pick-btn ${manualRole === "agent" ? "active" : ""}`}
                    onClick={() => setManualRole("agent")}
                  >
                    🧑 Agent
                    <span className="role-desc">Leads anlegen &amp; bearbeiten</span>
                  </button>
                  <button
                    className={`role-pick-btn ${manualRole === "admin" ? "active" : ""}`}
                    onClick={() => setManualRole("admin")}
                  >
                    👑 Admin
                    <span className="role-desc">Team verwalten, alle Rechte</span>
                  </button>
                </div>
              </div>
            ) : <p className="team-inline-hint">Manuell angelegte Mitglieder werden in deinem Team automatisch als Agent geführt.</p>}
            <button className="primary-btn" onClick={addManually} disabled={loading || !manualEmail.trim()}>
              {loading ? "Wird gespeichert..." : "Hinzufügen"}
            </button>
          </div>
        </div>
      )}

      {/* ── Einladungslink ── */}
      {activeSection === "invite-link" && isAdmin && (
        <div className="card team-action-card">
          <h3>Einladungslink generieren</h3>
          <p className="action-desc">
            Erstelle einen Link, den du per WhatsApp, Slack oder E-Mail teilen kannst.
            Jede Person, die den Link öffnet und sich einloggt oder registriert, wird automatisch deinem Team mit der gewählten Rolle zugewiesen.
          </p>
          <div className="action-form">
            {canAssignAdmins ? (
              <div className="form-row">
                <label>Rolle</label>
                <div className="role-picker">
                  <button
                    className={`role-pick-btn ${linkRole === "agent" ? "active" : ""}`}
                    onClick={() => setLinkRole("agent")}
                  >
                    🧑 Agent
                    <span className="role-desc">Leads anlegen &amp; bearbeiten</span>
                  </button>
                  <button
                    className={`role-pick-btn ${linkRole === "admin" ? "active" : ""}`}
                    onClick={() => setLinkRole("admin")}
                  >
                    👑 Admin
                    <span className="role-desc">Team verwalten, alle Rechte</span>
                  </button>
                </div>
              </div>
            ) : <p className="team-inline-hint">Einladungslinks erzeugen in deinem Team standardmäßig Agents.</p>}
            <div className="form-row">
              <label>Link gültig für</label>
              <div className="expiry-picker">
                {[["24", "24 Stunden"], ["48", "48 Stunden"], ["168", "7 Tage"], ["720", "30 Tage"]].map(([val, label]) => (
                  <button
                    key={val}
                    className={`expiry-btn ${linkExpiry === val ? "active" : ""}`}
                    onClick={() => setLinkExpiry(val)}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>
            <button className="primary-btn" onClick={generateInviteLink} disabled={loading}>
              {loading ? "Wird erstellt..." : "Link generieren"}
            </button>
          </div>

          {inviteLink && (
            <div className="invite-link-box">
              <div className="invite-link-url">{inviteLink}</div>
              <div className="invite-link-actions">
                <button className={`copy-link-btn ${linkCopied ? "copied" : ""}`} onClick={copyLink}>
                  {linkCopied ? "✓ Kopiert!" : "Kopieren"}
                </button>
                <a
                  href={`https://wa.me/?text=${encodeURIComponent("Du wurdest zu unserem ENERGYO Sales-Team eingeladen: " + inviteLink)}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="share-btn whatsapp"
                >
                  WhatsApp
                </a>
                <a
                  href={`mailto:?subject=ENERGYO Team-Einladung&body=${encodeURIComponent("Hallo,\n\nbitte klicke auf folgenden Link, um unserem Team beizutreten:\n\n" + inviteLink + "\n\nViele Grüße,\n" + currentUser.email)}`}
                  className="share-btn email"
                >
                  E-Mail
                </a>
              </div>
              <p className="invite-link-hint">
                Link läuft ab am {new Date(Date.now() + parseInt(linkExpiry) * 60 * 60 * 1000).toLocaleDateString("de-DE")}.
                Zuweisung als {(canAssignAdmins ? linkRole : "agent") === "admin" ? "Admin" : "Agent"}.
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── InviteLink-Handler (App-Level) ──────────────────────────────────────────
async function acceptInviteLink(token, userId, userEmail) {
  try {
    const linkDoc = await getDoc(doc(db, "inviteLinks", token));
    if (!linkDoc.exists()) return { ok: false, msg: "Einladungslink ungültig." };
    const data = linkDoc.data();
    if (new Date(data.expiresAt) < new Date()) return { ok: false, msg: "Einladungslink abgelaufen." };
    const userRef = doc(db, "users", userId);
    await updateDoc(userRef, { teamId: data.teamId, role: data.role || "agent" });
    await updateDoc(doc(db, "inviteLinks", token), { usageCount: (data.usageCount || 0) + 1 });
    return { ok: true, teamId: data.teamId, role: data.role || "agent" };
  } catch (e) {
    return { ok: false, msg: "Fehler beim Verarbeiten des Einladungslinks." };
  }
}

// ─── Sidebar ──────────────────────────────────────────────────────────────────
function Sidebar({ activeTab, setActiveTab, stats, user, userRole, onSignOut }) {
  const navItems = [
    { id: "leads", label: "Lead-Pipeline", icon: "📋" },
    { id: "dashboard", label: "Dashboard", icon: "📊" },
    { id: "team", label: "Team", icon: "👥" },
  ];
  return (
    <aside className="sidebar">
      <div className="sidebar-header">
        <img src={logo} alt="ENERGYO" className="sidebar-logo" />
      </div>
      <nav className="sidebar-nav">
        {navItems.map(item => (
          <button
            key={item.id}
            className={`sidebar-nav-item ${activeTab === item.id ? "active" : ""}`}
            onClick={() => setActiveTab(item.id)}
          >
            <span className="sidebar-item-icon">{item.icon}</span>
            <span className="sidebar-item-label">{item.label}</span>
          </button>
        ))}
      </nav>
      <div className="sidebar-kpis">
        <div className="sidebar-kpi-item" onClick={() => setActiveTab("leads")}>
          <span className="sidebar-kpi-value kpi-warning">{stats.overdue}</span>
          <span className="sidebar-kpi-label">Überfällig</span>
        </div>
        <div className="sidebar-kpi-item" onClick={() => setActiveTab("leads")}>
          <span className="sidebar-kpi-value kpi-alert">{stats.openCancellation}</span>
          <span className="sidebar-kpi-label">Kündigungsfenster</span>
        </div>
        <div className="sidebar-kpi-item">
          <span className="sidebar-kpi-value kpi-success">{stats.wonLeads}</span>
          <span className="sidebar-kpi-label">Gewonnen</span>
        </div>
        <div className="sidebar-kpi-item">
          <span className={`sidebar-kpi-value ${getClosingRateClass(stats.closingRate)}`}>{stats.closingRate}%</span>
          <span className="sidebar-kpi-label">Closing rate</span>
        </div>
      </div>
      <div className="sidebar-footer">
        <div className="sidebar-user">
          <div className="user-avatar">{user.email[0].toUpperCase()}</div>
          <div className="user-info">
            <span className="user-email-short">{user.email.split("@")[0]}</span>
            <span className="user-domain">{user.email.split("@")[1]}</span>
            <span className={`user-role-chip ${userRole === "admin" ? "admin" : "agent"}`}>
              {userRole === "admin" ? "Admin" : "Agent"}
            </span>
          </div>
        </div>
        <button className="sidebar-signout-btn" onClick={onSignOut}>Abmelden</button>
      </div>
    </aside>
  );
}

// ─── App ──────────────────────────────────────────────────────────────────────
function App() {
  const [user, setUser] = useState(null);
  const [userRole, setUserRole] = useState("agent");
  const [canAssignAdmins, setCanAssignAdmins] = useState(false);
  const [teamId, setTeamId] = useState(null);
  const [teamMembers, setTeamMembers] = useState([]);
  const [leads, setLeads] = useState([]);
  const [searchTerm, setSearchTerm] = useState("");
  const [filterPriority, setFilterPriority] = useState("all");
  const [filterStatus, setFilterStatus] = useState("all");
  const [filterCancellation, setFilterCancellation] = useState("all");
  const [loading, setLoading] = useState(false);
  const [activeTab, setActiveTab] = useState("leads");
  const [notifSent, setNotifSent] = useState(false);
  const [selectedLeadId, setSelectedLeadId] = useState(null);
  const [viewMode, setViewMode] = useState("list");
  const [showNewLeadModal, setShowNewLeadModal] = useState(false);
  const [smartView, setSmartView] = useState("all");
  const [sortMode, setSortMode] = useState("priority");
  const [kpiFocus, setKpiFocus] = useState("all");

  const applyKpiFocus = (focus) => {
    setKpiFocus(focus);
    if (focus === "overdue" || focus === "today") {
      setSortMode("followUp");
      setSmartView("action");
      return;
    }
    if (focus === "cancellation" || focus === "priorityA") {
      setSortMode("priority");
      setSmartView("all");
      return;
    }
    if (focus === "won") {
      setSortMode("activity");
      setSmartView("won");
      return;
    }
    setSmartView("all");
  };

  const selectedLead = useMemo(() => leads.find(l => l.id === selectedLeadId) || null, [leads, selectedLeadId]);

  useEffect(() => {
    const handle = (e) => {
      if (e.key === "Escape") {
        if (showNewLeadModal) setShowNewLeadModal(false);
        else if (selectedLeadId) setSelectedLeadId(null);
      }
      if (e.key === "n" && !showNewLeadModal && !selectedLeadId &&
        !["INPUT", "TEXTAREA", "SELECT"].includes(document.activeElement.tagName)) {
        setShowNewLeadModal(true);
      }
    };
    window.addEventListener("keydown", handle);
    return () => window.removeEventListener("keydown", handle);
  }, [showNewLeadModal, selectedLeadId]);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (currentUser) => {
      setUser(currentUser);
      if (!currentUser) { setTeamId(null); setTeamMembers([]); setCanAssignAdmins(false); return; }
      const userRef = doc(db, "users", currentUser.uid);
      try {
        const userDoc = await getDoc(userRef);
        if (userDoc.exists() && userDoc.data().teamId) {
          setTeamId(userDoc.data().teamId);
          setUserRole(userDoc.data().role || "admin");
          setCanAssignAdmins(userDoc.data().canAssignAdmins === true);
        } else {
          const newTeamId = `team-${currentUser.uid}`;
          await setDoc(userRef, { email: currentUser.email, teamId: newTeamId, role: "admin", createdAt: new Date().toISOString(), canAssignAdmins: true }, { merge: true });
          setTeamId(newTeamId); setUserRole("admin"); setCanAssignAdmins(true);
        }
        const normalizedCurrentEmail = (currentUser.email || "").trim().toLowerCase();
        if (normalizedCurrentEmail) {
          const invQ = query(collection(db, "invitations"), where("invitedEmail", "==", normalizedCurrentEmail), where("status", "==", "pending"));
          const invSnap = await getDocs(invQ);
          if (!invSnap.empty) {
            const pendingInvites = invSnap.docs
              .map(d => ({ id: d.id, ref: d.ref, ...d.data() }))
              .sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));
            const activeInvite = pendingInvites[0];

            await updateDoc(doc(db, "users", currentUser.uid), { teamId: activeInvite.teamId, role: activeInvite.role || "agent" });
            for (const invitation of pendingInvites) {
              await updateDoc(invitation.ref, { status: invitation.id === activeInvite.id ? "accepted" : "superseded" });
            }

            setTeamId(activeInvite.teamId);
            setUserRole(activeInvite.role || "agent");
            setCanAssignAdmins(false);
          }
        }
        const urlToken = new URLSearchParams(window.location.search).get("invite");
        if (urlToken) {
          const result = await acceptInviteLink(urlToken, currentUser.uid, currentUser.email);
          if (result.ok) {
            setTeamId(result.teamId);
            setUserRole(result.role);
            setCanAssignAdmins(false);
            window.history.replaceState({}, document.title, window.location.pathname);
          }
        }
      } catch (e) { console.error(e); setTeamId(`team-${currentUser.uid}`); setCanAssignAdmins(false); }
    });
    return unsubscribe;
  }, []);

  const loadTeamMembers = useCallback(async () => {
    if (!teamId) return;
    try {
      const q = query(collection(db, "users"), where("teamId", "==", teamId));
      const snap = await getDocs(q);
      setTeamMembers(snap.docs.map(d => ({ id: d.id, ...d.data() })));
    } catch (e) { console.error(e); }
  }, [teamId]);

  useEffect(() => { loadTeamMembers(); }, [loadTeamMembers]);

  useEffect(() => {
    if (!user || !teamId) { setLeads([]); return; }
    const q = userRole === "admin"
      ? query(collection(db, "leads"), where("teamId", "==", teamId))
      : query(collection(db, "leads"), where("teamId", "==", teamId), where("ownerUserId", "==", user.uid));
    return onSnapshot(q, snap => setLeads(snap.docs.map(d => ({ id: d.id, ...d.data() }))));
  }, [user, teamId, userRole]);

  useEffect(() => {
    if (!user || !leads.length || notifSent) return;
    const overdueLeads = leads.filter(l => isOverdue(l.followUp));
    const cancellationLeads = leads.filter(l => isOpenCancellationWindow(l.contractEnd));
    if (overdueLeads.length > 0 || cancellationLeads.length > 0) {
      fetch("/api/send-notification", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ to: user.email, overdueCount: overdueLeads.length, cancellationCount: cancellationLeads.length }),
      }).then(() => setNotifSent(true)).catch(() => {});
    }
  }, [user, leads, notifSent]);

  const addLead = async (form, onSuccess) => {
    if (!form.person.trim()) return alert("Bitte mindestens Ansprechpartner eintragen.");
    if (!form.phone.trim() || !form.email.trim() || !form.postalCode.trim()) return alert("Bitte Telefon, E-Mail und PLZ ausfüllen.");
    if (!teamId) return alert("Team-ID nicht gefunden. Bitte Seite neu laden.");
    if (form.contractEnd !== "unknown" && isContractEndUnrealistic(form.contractEnd)) {
      if (!window.confirm("Das Vertragsende liegt in der Vergangenheit. Fortfahren?")) return;
    }
    setLoading(true);
    try {
      const createdAt = new Date().toISOString();
      const docRef = await addDoc(collection(db, "leads"), {
        ...form, teamId,
        ownerUserId: user.uid,
        ownerEmail: user.email,
        createdBy: { uid: user.uid, email: user.email, timestamp: createdAt },
        status: "Neu", createdAt, comments: [], callLogs: [],
      });
      setLoading(false);
      onSuccess?.();
      setSelectedLeadId(docRef.id);
    } catch (e) {
      console.error("addLead error:", e?.code, e?.message, e);
      alert(`Fehler beim Speichern: ${e?.code || e?.message || "Unbekannter Fehler"}`);
      setLoading(false);
    }
  };

  const updateLeadStatus = async (id, newStatus) => {
    const leadDoc = leads.find((lead) => lead.id === id);
    if (!leadDoc || leadDoc.status === newStatus) return;
    try {
      await updateDoc(doc(db, "leads", id), {
        status: newStatus,
        statusHistory: [
          ...(leadDoc.statusHistory || []),
          {
            from: leadDoc.status,
            to: newStatus,
            timestamp: new Date().toISOString(),
            author: user.email,
          },
        ],
      });
    } catch (e) { console.error(e); }
  };
  const updateLeadField = async (id, field, value) => {
    try { await updateDoc(doc(db, "leads", id), { [field]: value }); } catch (e) { console.error(e); }
  };
  const logCall = async (leadId, callData) => {
    const leadDoc = leads.find(l => l.id === leadId);
    if (!leadDoc) return;
    try {
      await updateDoc(doc(db, "leads", leadId), {
        callLogs: [...(leadDoc.callLogs || []), { ...callData, timestamp: new Date().toISOString(), author: user.email }],
      });
    } catch (e) { console.error(e); }
  };
  const deleteLead = async (id) => {
    try { await deleteDoc(doc(db, "leads", id)); } catch (e) { console.error(e); }
  };
  const addLeadAttachment = (leadId, files) => {
    Array.from(files).forEach(file => {
      if (file.size > 10 * 1024 * 1024) return alert(`${file.name} ist zu groß (max 10MB)`);
      const reader = new FileReader();
      reader.onload = async ev => {
        const leadDoc = leads.find(l => l.id === leadId);
        if (!leadDoc) return;
        try {
          await updateDoc(doc(db, "leads", leadId), {
            attachments: [...(leadDoc.attachments || []), { id: Date.now() + Math.random(), name: file.name, size: file.size, type: file.type, data: ev.target.result, uploadedAt: new Date().toISOString() }],
          });
        } catch (e) { console.error(e); }
      };
      reader.readAsDataURL(file);
    });
  };
  const removeLeadAttachment = async (leadId, attId) => {
    const leadDoc = leads.find(l => l.id === leadId);
    if (!leadDoc) return;
    try { await updateDoc(doc(db, "leads", leadId), { attachments: leadDoc.attachments.filter(a => a.id !== attId) }); }
    catch (e) { console.error(e); }
  };

  const filteredLeads = useMemo(() => {
    const sl = searchTerm.toLowerCase();
    const visibleLeads = leads
      .filter(l => {
        const match = !sl || (l.company || "").toLowerCase().includes(sl) || (l.person || "").toLowerCase().includes(sl) || (l.phone || "").includes(searchTerm) || (l.email || "").toLowerCase().includes(sl);
        if (!match) return false;
        if (filterPriority !== "all" && calculatePriority(l) !== filterPriority) return false;
        if (filterStatus !== "all" && l.status !== filterStatus) return false;
        if (filterCancellation === "open" && !isOpenCancellationWindow(l.contractEnd)) return false;
        if (filterCancellation === "closed" && isOpenCancellationWindow(l.contractEnd)) return false;
        if (smartView === "mine" && getLeadOwnerEmail(l) !== user.email) return false;
        if (smartView === "action" && !(isOverdue(l.followUp) || isTodayDue(l.followUp))) return false;
        if (smartView === "hot" && getLeadTemperature(l).tone !== "hot") return false;
        if (smartView === "won" && l.status !== "Gewonnen") return false;
        if (kpiFocus === "overdue" && !isOverdue(l.followUp)) return false;
        if (kpiFocus === "today" && !isTodayDue(l.followUp)) return false;
        if (kpiFocus === "cancellation" && !isOpenCancellationWindow(l.contractEnd)) return false;
        if (kpiFocus === "priorityA" && calculatePriority(l) !== "A") return false;
        if (kpiFocus === "won" && l.status !== "Gewonnen") return false;
        return true;
      });
    return sortLeads(visibleLeads, sortMode);
  }, [leads, searchTerm, filterPriority, filterStatus, filterCancellation, smartView, sortMode, user, kpiFocus]);

  const stats = useMemo(() => ({
    totalLeads: leads.length,
    wonLeads: leads.filter(l => l.status === "Gewonnen").length,
    overdue: leads.filter(l => isOverdue(l.followUp)).length,
    dueToday: leads.filter(l => isTodayDue(l.followUp)).length,
    priorityA: leads.filter(l => calculatePriority(l) === "A").length,
    openCancellation: leads.filter(l => isOpenCancellationWindow(l.contractEnd)).length,
    totalUmsatzPotential: leads.reduce((s, l) => s + calculateUmsatzPotential(l.consumption), 0),
    closingRate: leads.length > 0 ? Math.round((leads.filter(l => l.status === "Gewonnen").length / leads.length) * 100) : 0,
  }), [leads]);

  if (!user) return <LoginPage onLogin={setUser} user={user} />;

  return (
    <div className="app-layout">
      {loading && <LeadLoadingOverlay />}
      <Sidebar activeTab={activeTab} setActiveTab={setActiveTab} stats={stats} user={user} userRole={userRole} onSignOut={() => signOut(auth)} />

      <div className="main-content">
        {activeTab === "leads" && (
          <>
            <div className="main-toolbar">
              <div className="toolbar-left">
                <h1 className="page-title">Lead-Pipeline</h1>
                <span className="lead-count-badge">{filteredLeads.length}</span>
              </div>
              <div className="toolbar-right">
                <input type="text" placeholder="🔍 Suche nach Firma, Kontakt, Telefon..." value={searchTerm} onChange={e => setSearchTerm(e.target.value)} className="toolbar-search" />
                <select value={sortMode} onChange={e => setSortMode(e.target.value)} className="filter-select-inline compact">
                  <option value="priority">Sortiert nach Priorität</option>
                  <option value="potential">Sortiert nach Potential</option>
                  <option value="activity">Sortiert nach letzter Aktivität</option>
                  <option value="followUp">Sortiert nach Follow-up</option>
                </select>
                <div className="view-toggle-group">
                  <button className={`view-toggle-btn ${viewMode === "list" ? "active" : ""}`} onClick={() => setViewMode("list")}>≡ Liste</button>
                  <button className={`view-toggle-btn ${viewMode === "kanban" ? "active" : ""}`} onClick={() => setViewMode("kanban")}>⊞ Pipeline</button>
                </div>
                <button className="new-lead-btn" onClick={() => setShowNewLeadModal(true)}>+ Neuer Lead</button>
              </div>
            </div>

            <CommandCenter stats={stats} filteredLeads={filteredLeads} smartView={smartView} setSmartView={setSmartView} setKpiFocus={setKpiFocus} />

            <div className="filter-bar">
              <select value={filterPriority} onChange={e => setFilterPriority(e.target.value)} className="filter-select-inline">
                <option value="all">Alle Prioritäten</option>
                <option value="A">Priorität A</option><option value="B">Priorität B</option><option value="C">Priorität C</option>
              </select>
              <select value={filterStatus} onChange={e => setFilterStatus(e.target.value)} className="filter-select-inline">
                <option value="all">Alle Status</option>
                {STATUS_OPTIONS.map(s => <option key={s}>{s}</option>)}
              </select>
              <select value={filterCancellation} onChange={e => setFilterCancellation(e.target.value)} className="filter-select-inline">
                <option value="all">Kündigungsfenster: Alle</option>
                <option value="open">Fenster offen</option><option value="closed">Fenster geschlossen</option>
              </select>
              {kpiFocus !== "all" && (
                <button type="button" className="kpi-reset-btn" onClick={() => applyKpiFocus("all")}>
                  KPI-Fokus zurücksetzen
                </button>
              )}
              <span className="filter-result-count">{filteredLeads.length} von {leads.length} Leads</span>
            </div>

            <div className="kpi-strip">
              <button type="button" className={`kpi-item kpi-warning clickable ${kpiFocus === "overdue" ? "active" : ""}`} onClick={() => applyKpiFocus("overdue")}><span className="kpi-val">{stats.overdue}</span><span className="kpi-label">Überfällig</span></button>
              <button type="button" className={`kpi-item kpi-today clickable ${kpiFocus === "today" ? "active" : ""}`} onClick={() => applyKpiFocus("today")}><span className="kpi-val">{stats.dueToday}</span><span className="kpi-label">Heute fällig</span></button>
              <button type="button" className={`kpi-item kpi-alert clickable ${kpiFocus === "cancellation" ? "active" : ""}`} onClick={() => applyKpiFocus("cancellation")}><span className="kpi-val">{stats.openCancellation}</span><span className="kpi-label">Kündigungsfenster</span></button>
              <button type="button" className={`kpi-item kpi-prio clickable ${kpiFocus === "priorityA" ? "active" : ""}`} onClick={() => applyKpiFocus("priorityA")}><span className="kpi-val">{stats.priorityA}</span><span className="kpi-label">Priorität A</span></button>
              <button type="button" className={`kpi-item clickable ${kpiFocus === "won" ? "active" : ""}`} onClick={() => applyKpiFocus("won")}><span className="kpi-val">{stats.wonLeads}</span><span className="kpi-label">Gewonnen</span></button>
              <div className="kpi-item"><span className={`kpi-val ${getClosingRateClass(stats.closingRate)}`}>{stats.closingRate}%</span><span className="kpi-label">Closing rate</span></div>
              <div className="kpi-item kpi-umsatz"><span className="kpi-val kpi-success">{formatEuro(stats.totalUmsatzPotential)}</span><span className="kpi-label">Umsatzpotenzial</span></div>
            </div>

            {viewMode === "list" ? (
              <div className="leads-table-wrap">
                <div className="leads-table-header">
                  <div className="lth-prio" />
                  <div className="lth-main">Unternehmen / Kontakt</div>
                  <div className="lth-energy">Energie</div>
                  <div className="lth-flags">Health / Next step</div>
                  <div className="lth-status">Status</div>
                  <div className="lth-umsatz">Potential</div>
                  <div className="lth-followup">Nachfassen</div>
                  <div className="lth-activity">Aktivität</div>
                </div>
                {filteredLeads.length === 0 ? (
                  <div className="empty-leads">
                    <p>Keine Leads gefunden.</p>
                    <button className="new-lead-btn" onClick={() => setShowNewLeadModal(true)}>+ Ersten Lead anlegen</button>
                  </div>
                ) : (
                  filteredLeads.map(lead => (
                    <LeadRow key={lead.id} lead={lead} onSelect={l => setSelectedLeadId(l.id)} isSelected={selectedLeadId === lead.id} />
                  ))
                )}
              </div>
            ) : (
              <KanbanBoard leads={filteredLeads} onSelectLead={l => setSelectedLeadId(l.id)} onUpdateStatus={updateLeadStatus} />
            )}
          </>
        )}

        {activeTab === "dashboard" && (
          <div className="tab-page">
            <div className="main-toolbar"><h1 className="page-title">Dashboard</h1></div>
            <Dashboard leads={leads} teamMembers={teamMembers} />
          </div>
        )}

        {activeTab === "team" && (
          <div className="tab-page">
            <TeamManagement currentUser={user} teamId={teamId} teamMembers={teamMembers} onRefresh={loadTeamMembers} userRole={userRole} canAssignAdmins={canAssignAdmins} />
          </div>
        )}
      </div>

      {selectedLead && (
        <LeadDetailDrawer
          lead={selectedLead}
          onClose={() => setSelectedLeadId(null)}
          user={user}
          onUpdateField={updateLeadField}
          onUpdateStatus={updateLeadStatus}
          onDelete={deleteLead}
          onLogCall={logCall}
          onAddAttachment={addLeadAttachment}
          onRemoveAttachment={removeLeadAttachment}
        />
      )}

      {showNewLeadModal && (
        <NewLeadModal onClose={() => setShowNewLeadModal(false)} onSubmit={addLead} loading={loading} />
      )}
    </div>
  );
}

export default App;
