import React, { useState, useMemo, useRef } from "react";
import ReactDOM from "react-dom";
import { STATUS_OPTIONS, STATUS_META, CALL_OUTCOMES, getAttachmentHref } from "../constants";
import { formatDate, formatDateTime, isOverdue, isTodayDue, isOpenCancellationWindow, addDaysToIso } from "../utils/dates";
import { formatEuro, formatWaPhone, formatMeterAddress } from "../utils/format";
import { calculateUmsatzPotential } from "../utils/energy";
import { calculateLeadScore, getLeadWinProbability, getNextActionPlan, getLeadSequencePlan, getLeadScoreTone, getLeadReadiness, getLeadTemperature } from "../utils/leads";
import InlineField from "./InlineField";
import ActivityItem from "./ActivityItem";
import AIAssistantPanel from "./AIAssistantPanel";
import AppointmentModal from "./AppointmentModal";
import SavingsCalculator from "./SavingsCalculator";
import WechselprozessTracker from "./WechselprozessTracker";
import ProvisionsTracker from "./ProvisionsTracker";
import { IconBell, IconClock, IconCalendar, IconSearch, IconPhone, IconComment, IconMail, IconZap, IconFlame, IconPaperclip, IconAlertTriangle } from "./Icons";

function LeadDetailDrawer({ lead, onClose, onNextLead, leadPosition, leadTotal, user, userRole, onUpdateField, onUpdateStatus, onDelete, onLogCall, onAddAttachment, onRemoveAttachment, dialerActive }) {
  const [drawerTab, setDrawerTab] = useState("activity");
  const [noteText, setNoteText] = useState("");
  const [showCallForm, setShowCallForm] = useState(false);
  const touchStartY = useRef(null);
  const drawerRef = useRef(null);
  const [callForm, setCallForm] = useState({ duration: "", outcome: CALL_OUTCOMES[0], notes: "" });
  const [saving, setSaving] = useState(false);
  const [previewAttachment, setPreviewAttachment] = useState(null);
  const [deleteConfirmId, setDeleteConfirmId] = useState(null);
  const [showAppointmentModal, setShowAppointmentModal] = useState(false);
  const [sequenceBusyId, setSequenceBusyId] = useState(null);
  const [sequenceMsg, setSequenceMsg] = useState("");
  const umsatz = calculateUmsatzPotential(lead.consumption);
  const hasCancellationWindow = isOpenCancellationWindow(lead.contractEnd);
  const isOverdueNow = isOverdue(lead.followUp);
  const isTodayNow = isTodayDue(lead.followUp);
  const leadScore = calculateLeadScore(lead);
  const closeProbability = getLeadWinProbability(lead);
  const nextAction = getNextActionPlan(lead);
  const sequencePlan = getLeadSequencePlan(lead);
  const scoreTone = getLeadScoreTone(closeProbability);
  const readiness = getLeadReadiness(lead);
  const temperature = getLeadTemperature(lead);
  const previewHref = getAttachmentHref(previewAttachment);

  const setFollowUpInDays = (days) => {
    const d = new Date();
    d.setDate(d.getDate() + days);
    onUpdateField(lead.id, "followUp", d.toISOString().split("T")[0]);
  };

  const statusActions = (() => {
    if (lead.status === "Neu") {
      return {
        title: "Nächster Schritt für Neu",
        actions: [
          { key: "mark-contacted", label: "Als kontaktiert markieren", onClick: () => onUpdateStatus(lead.id, "Kontaktiert") },
          { key: "plan-appointment", label: "Termin planen", onClick: () => setShowAppointmentModal(true), className: "appointment" },
          { key: "followup-today", label: "Heute Follow-up setzen", onClick: () => setFollowUpInDays(0) },
        ],
      };
    }
    if (lead.status === "Kontaktiert") {
      return {
        title: "Nächster Schritt nach Kontakt",
        actions: [
          { key: "plan-appointment", label: "Termin planen", onClick: () => setShowAppointmentModal(true), className: "appointment" },
          { key: "followup-today", label: "Heute Follow-up setzen", onClick: () => setFollowUpInDays(0) },
          { key: "followup-tomorrow", label: "Morgen Follow-up setzen", onClick: () => setFollowUpInDays(1) },
          { key: "move-offer", label: "Zu Angebot", onClick: () => onUpdateStatus(lead.id, "Angebot") },
        ],
      };
    }
    if (lead.status === "Angebot") {
      return {
        title: "Nächster Schritt für Angebot",
        actions: [
          { key: "plan-appointment", label: "Termin planen", onClick: () => setShowAppointmentModal(true), className: "appointment" },
          { key: "followup-tomorrow", label: "Morgen Follow-up setzen", onClick: () => setFollowUpInDays(1) },
          { key: "followup-three", label: "In 3 Tagen Follow-up setzen", onClick: () => setFollowUpInDays(3) },
        ],
      };
    }
    return {
      title: "Nächster Schritt",
      actions: [
        { key: "plan-appointment", label: "Termin planen", onClick: () => setShowAppointmentModal(true), className: "appointment" },
        { key: "followup-today", label: "Heute Follow-up setzen", onClick: () => setFollowUpInDays(0) },
        { key: "followup-tomorrow", label: "Morgen Follow-up setzen", onClick: () => setFollowUpInDays(1) },
      ],
    };
  })();

  const getSequenceOutcome = (stepId) => {
    const logs = lead.aiActionLog || [];
    const outcomeEntry = [...logs]
      .reverse()
      .find((entry) => entry?.type === "sequence-step-outcome" && entry?.stepId === stepId);
    return outcomeEntry?.outcome || null;
  };

  const timeline = useMemo(() => {
    const items = [];
    (lead.comments || []).forEach((c, idx) => items.push({ type: "comment", ...c, _idx: idx }));
    (lead.callLogs || []).forEach((c, idx) => items.push({ type: "call", ...c, _idx: idx }));
    (lead.statusHistory || []).forEach((c, idx) => items.push({ type: "status", ...c, _idx: idx }));
    return items.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
  }, [lead.comments, lead.callLogs, lead.statusHistory]);

  // Group timeline: stack consecutive status changes, link status+comment within 60s
  const groupedTimeline = useMemo(() => {
    const groups = [];
    const used = new Set();

    for (let i = 0; i < timeline.length; i++) {
      if (used.has(i)) continue;
      const item = timeline[i];

      // Link: status + comment within 60s
      if (item.type === "status") {
        const t = new Date(item.timestamp).getTime();
        const linkedIdx = timeline.findIndex((other, j) =>
          j !== i && !used.has(j) && other.type === "comment"
          && Math.abs(new Date(other.timestamp).getTime() - t) <= 60000
        );
        if (linkedIdx !== -1) {
          used.add(i);
          used.add(linkedIdx);
          groups.push({ kind: "linked", status: item, comment: timeline[linkedIdx] });
          continue;
        }

        // Stack: consecutive status changes
        const stack = [item];
        used.add(i);
        for (let j = i + 1; j < timeline.length; j++) {
          if (used.has(j)) continue;
          if (timeline[j].type !== "status") break;
          stack.push(timeline[j]);
          used.add(j);
        }
        if (stack.length > 1) {
          groups.push({ kind: "stack", items: stack });
        } else {
          groups.push({ kind: "single", item });
        }
        continue;
      }

      used.add(i);
      groups.push({ kind: "single", item });
    }
    return groups;
  }, [timeline]);

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

  const editComment = async (idx, newText) => {
    const updated = (lead.comments || []).map((c, i) =>
      i === idx ? { ...c, text: newText, edited: true, editedAt: new Date().toISOString(), editedBy: user.email } : c
    );
    await onUpdateField(lead.id, "comments", updated);
  };

  const deleteComment = async (idx) => {
    const updated = (lead.comments || []).filter((_, i) => i !== idx);
    await onUpdateField(lead.id, "comments", updated);
  };

  const handleDelete = async () => {
    if (!window.confirm(`Lead "${lead.company || lead.person}" wirklich löschen?`)) return;
    await onDelete(lead.id);
    onClose();
  };

  const handleSaveAppointment = async (data) => {
    await onUpdateField(lead.id, "appointmentDate", data.appointmentDate);
    await onUpdateField(lead.id, "appointmentTime", data.appointmentTime);
    await onUpdateField(lead.id, "appointmentNotes", data.appointmentNotes);
    await onUpdateField(lead.id, "appointmentTitle", data.appointmentTitle);
  };

  const applySequenceStep = async (step) => {
    setSequenceBusyId(step.id);
    setSequenceMsg("");
    try {
      const now = new Date().toISOString();
      const followUpDate = addDaysToIso(step.dueInDays);
      const sequenceComment = {
        timestamp: now,
        author: user.email,
        text: `[Sequenz] ${step.title} | Kanal: ${step.channel} | Timing: ${step.dueInDays === 0 ? "Heute" : `+${step.dueInDays} Tage`} | Ziel: ${step.purpose}`,
      };
      const actionLogEntry = {
        id: `seq-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        type: "sequence-step-applied",
        stepId: step.id,
        stepTitle: step.title,
        channel: step.channel,
        dueInDays: step.dueInDays,
        plannedFollowUp: followUpDate,
        by: user.email,
        timestamp: now,
      };

      await onUpdateField(lead.id, "comments", [...(lead.comments || []), sequenceComment]);
      await onUpdateField(lead.id, "followUp", followUpDate);
      await onUpdateField(lead.id, "aiActionLog", [...(lead.aiActionLog || []), actionLogEntry]);
      setSequenceMsg(`Schritt "${step.title}" übernommen.`);
    } catch (e) {
      setSequenceMsg(`Übernahme fehlgeschlagen (${e?.code || "unknown"}).`);
    }
    setSequenceBusyId(null);
  };

  const trackSequenceOutcome = async (step, outcome) => {
    setSequenceBusyId(`${step.id}-${outcome}`);
    setSequenceMsg("");
    try {
      const now = new Date().toISOString();
      const outcomeEntry = {
        id: `seq-outcome-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        type: "sequence-step-outcome",
        stepId: step.id,
        stepTitle: step.title,
        outcome,
        by: user.email,
        timestamp: now,
      };
      await onUpdateField(lead.id, "aiActionLog", [...(lead.aiActionLog || []), outcomeEntry]);
      setSequenceMsg(`Outcome für "${step.title}" gespeichert: ${outcome}.`);
    } catch (e) {
      setSequenceMsg(`Outcome konnte nicht gespeichert werden (${e?.code || "unknown"}).`);
    }
    setSequenceBusyId(null);
  };

  const tabs = [
    { id: "details",     label: "Details" },
    { id: "activity",    label: "Aktivität" },
    { id: "planung",     label: "Planung" },
    { id: "wechsel",     label: "Wechsel" },
    { id: "attachments", label: `Anhänge${lead.attachments?.length > 0 ? ` (${lead.attachments.length})` : ""}` },
    { id: "ai",          label: "KI Bot" },
  ];

  const Wrapper = dialerActive ? React.Fragment : ({ children }) => (
    <div className="drawer-backdrop" onClick={e => e.target === e.currentTarget && onClose()}>{children}</div>
  );

  return (
    <Wrapper>
      <div
        className={`drawer${dialerActive ? " drawer--dialer" : ""}`}
        ref={drawerRef}
        onTouchStart={e => { touchStartY.current = e.touches[0].clientY; }}
        onTouchMove={e => {
          if (touchStartY.current == null) return;
          const delta = e.touches[0].clientY - touchStartY.current;
          if (delta > 60 && drawerRef.current?.scrollTop === 0) onClose();
        }}
        onTouchEnd={() => { touchStartY.current = null; }}
      >
        <div className="drawer-swipe-handle" aria-hidden="true" />
        {/* Header */}
        <div className="drawer-header">
          <div className="drawer-header-info">
            <h2 className="drawer-company">{lead.company || <em>Kein Firmenname</em>}</h2>
            <p className="drawer-person">
              {[lead.anrede, lead.titel, lead.person].filter(Boolean).join(" ")}{lead.geburtsdatum ? ` · geb. ${formatDate(lead.geburtsdatum)}` : ""}{lead.customerType ? ` · ${lead.customerType}` : ""}
            </p>
            {(() => {
              const addr = lead.deliveryAddress || {};
              const street = [addr.straße, addr.hausnummer].filter(Boolean).join(" ");
              const city = [addr.plz || lead.postalCode, addr.ort].filter(Boolean).join(" ");
              const full = [street, city].filter(Boolean).join(", ");
              return full ? <p className="drawer-address">{full}</p> : null;
            })()}
            <div className="drawer-header-badges">
              {hasCancellationWindow && <span className="drawer-badge alert"><IconBell size={12} /> Kündigungsfenster</span>}
              {isOverdueNow && <span className="drawer-badge danger"><IconClock size={12} /> Überfällig</span>}
              {isTodayNow && <span className="drawer-badge today"><IconCalendar size={12} /> Heute fällig</span>}
              {lead.bundleInquiry && <span className="drawer-badge info">Bündelanfrage</span>}
              {lead.energyAuditEligible && <span className="drawer-badge audit"><IconSearch size={12} /> Energieaudit berechtigt</span>}
              {lead.appointmentDate && (
                <span className="drawer-badge appointment" onClick={() => setShowAppointmentModal(true)} style={{ cursor: "pointer" }}>
                  <IconCalendar size={12} /> Termin: {formatDate(lead.appointmentDate)}{lead.appointmentTime ? ` ${lead.appointmentTime}` : ""}
                </span>
              )}
            </div>
          </div>
          <div className="drawer-header-actions">
            <button className="drawer-close-btn" onClick={onClose} aria-label="Schließen">✕</button>
            {onNextLead && leadTotal > 1 && (
              <button className="drawer-next-btn" onClick={onNextLead} title={`Lead ${leadPosition} von ${leadTotal}`}>
                Nächster Lead ›
              </button>
            )}
          </div>
        </div>

        {/* Umsatz Banner */}
        <div className="drawer-umsatz-bar">
          <span className="drawer-umsatz-label">Umsatzpotenzial</span>
          <span className="drawer-umsatz-value">{formatEuro(umsatz)}</span>
          <span className="drawer-umsatz-hint">
            {lead.consumption && parseInt(lead.consumption) >= 50000
              ? `(${parseInt(lead.consumption).toLocaleString("de-DE")} kWh × 0,01 €)` : "(Pauschale)"}
          </span>
        </div>

        {/* Kontakt-Aktionen */}
        <div className="contact-bar">
          {lead.phone ? (
            <a className="contact-btn call" href={`tel:${lead.phone}`}>
              <span className="contact-btn-icon"><IconPhone size={16} /></span>
              <span className="contact-btn-label">Anrufen</span>
              <span className="contact-btn-sub">{lead.phone}</span>
            </a>
          ) : (
            <div className="contact-btn call disabled">
              <span className="contact-btn-icon"><IconPhone size={16} /></span>
              <span className="contact-btn-label">Anrufen</span>
              <span className="contact-btn-sub">Kein Tel.</span>
            </div>
          )}
          {lead.phone ? (
            <a className="contact-btn whatsapp" href={`https://wa.me/${formatWaPhone(lead.phone)}?text=${encodeURIComponent(`Hallo ${lead.person || ''},\n\nhier ist Ihr ENERGYO-Berater. Ich melde mich bezüglich Ihres Energievertrags. Haben Sie kurz Zeit?`)}`} target="_blank" rel="noreferrer">
              <span className="contact-btn-icon"><IconComment size={16} /></span>
              <span className="contact-btn-label">WhatsApp</span>
              <span className="contact-btn-sub">Nachricht</span>
            </a>
          ) : (
            <div className="contact-btn whatsapp disabled">
              <span className="contact-btn-icon"><IconComment size={16} /></span>
              <span className="contact-btn-label">WhatsApp</span>
              <span className="contact-btn-sub">Kein Tel.</span>
            </div>
          )}
          {lead.email ? (
            <a className="contact-btn email" href={`mailto:${lead.email}?subject=${encodeURIComponent('Ihr Energievertrag – ENERGYO')}&body=${encodeURIComponent(`Sehr geehrte/r ${lead.person || 'Kundin/Kunde'},\n\n`)}`}>
              <span className="contact-btn-icon"><IconMail size={16} /></span>
              <span className="contact-btn-label">E-Mail</span>
              <span className="contact-btn-sub">{lead.email}</span>
            </a>
          ) : (
            <div className="contact-btn email disabled">
              <span className="contact-btn-icon"><IconMail size={16} /></span>
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

        {/* Compact meta strip */}
        <div className="drawer-meta-strip">
          <span className={`drawer-meta-chip temp-${temperature.tone}`}>{temperature.label}</span>
          <span className={`drawer-meta-chip score-${scoreTone}`}>★ {leadScore}/100</span>
          <span className="drawer-meta-chip">{closeProbability}% Chance</span>
          <span className={`drawer-meta-chip readiness-${readiness.tone}`}>{readiness.label}</span>
          {lead.followUp && <span className={`drawer-meta-chip${isOverdueNow ? " overdue" : ""}`}>{isOverdueNow ? <IconClock size={12} /> : <IconCalendar size={12} />} {formatDate(lead.followUp)}</span>}
        </div>

        {/* Tabs */}
        <div className="drawer-tabs">
          {tabs.map(t => (
            <button
              key={t.id}
              className={`drawer-tab-btn ${t.id === "ai" ? "ai-tab" : ""} ${drawerTab === t.id ? "active" : ""}`}
              onClick={() => setDrawerTab(t.id)}
            >
              {t.id === "ai" ? (
                <span className="ai-tab-label">
                  <span className="ai-tab-badge" aria-hidden="true">
                    <svg viewBox="0 0 24 24" role="img" focusable="false">
                      <circle cx="12" cy="4" r="2" />
                      <path d="M9.2 5.7h5.6v2H9.2z" />
                      <rect x="4" y="8" width="16" height="11" rx="4" ry="4" />
                      <circle cx="9" cy="13.4" r="1.4" />
                      <circle cx="15" cy="13.4" r="1.4" />
                      <path d="M8.4 17c.8.8 1.9 1.2 3.6 1.2s2.8-.4 3.6-1.2" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
                    </svg>
                  </span>
                  <span>{t.label}</span>
                </span>
              ) : t.label}
            </button>
          ))}
        </div>

        {/* Tab: Details */}
        {drawerTab === "details" && (
          <div className="drawer-tab-content">
            <div className="details-grid">
              <InlineField label="Firma" value={lead.company} onSave={v => onUpdateField(lead.id, "company", v)} />
              <InlineField label="Anrede" value={lead.anrede} onSave={v => onUpdateField(lead.id, "anrede", v)} options={["", "Herr", "Frau", "Divers"]} />
              <InlineField label="Titel" value={lead.titel} onSave={v => onUpdateField(lead.id, "titel", v)} options={["", "Dr.", "Prof.", "Prof. Dr."]} />
              <InlineField label="Ansprechpartner" value={lead.person} onSave={v => onUpdateField(lead.id, "person", v)} />
              <InlineField label="Telefon" value={lead.phone} onSave={v => onUpdateField(lead.id, "phone", v)} type="tel" />
              <InlineField label="E-Mail" value={lead.email} onSave={v => onUpdateField(lead.id, "email", v)} type="email" />
              <InlineField label="PLZ" value={lead.postalCode} onSave={v => onUpdateField(lead.id, "postalCode", v)} />
              <InlineField label="Kundentyp" value={lead.customerType} onSave={v => onUpdateField(lead.id, "customerType", v)} options={["Privat", "Gewerbe", "Großkunde"]} />
              <InlineField label="Aktueller Anbieter" value={lead.currentProvider} onSave={v => onUpdateField(lead.id, "currentProvider", v)} />
              <InlineField label="Verbrauch (kWh)" value={lead.consumption} onSave={v => onUpdateField(lead.id, "consumption", v)} type="number" />
              <InlineField label="Jahreskosten (€)" value={lead.annualCosts} onSave={v => onUpdateField(lead.id, "annualCosts", v)} type="number" render={v => v ? `€${parseInt(v).toLocaleString("de-DE")}` : null} />
              {(() => {
                const auditThreshold = 10000;
                const eligible = Number(lead.annualCosts || 0) >= auditThreshold && lead.customerType !== "Privat";
                const checked = !!lead.energyAuditEligible;
                return (
                  <div className={`inline-field audit-gate ${eligible ? "active" : "locked"}`}>
                    <label className="inline-label">Energieaudit</label>
                    <div className="inline-value-row">
                      <label className="checkbox-label">
                        <input
                          type="checkbox"
                          checked={checked}
                          disabled={!eligible}
                          onChange={e => eligible && onUpdateField(lead.id, "energyAuditEligible", e.target.checked)}
                        />
                        {eligible ? (checked ? "Berechtigt ✓" : "Klicken zum Aktivieren") : lead.customerType === "Privat" ? "Privatkunden ausgeschlossen" : "Ab €10.000/Jahr freischaltbar"}
                      </label>
                    </div>
                  </div>
                );
              })()}
              <InlineField label="Vertragsende" value={lead.contractEnd === "unknown" ? "" : lead.contractEnd} onSave={v => onUpdateField(lead.id, "contractEnd", v || "unknown")} type="date" render={v => (!v || v === "unknown") ? "Unbekannt" : formatDate(v)} />
              <InlineField label="Geburtsdatum" value={lead.geburtsdatum} onSave={v => onUpdateField(lead.id, "geburtsdatum", v)} type="date" render={v => v ? formatDate(v) : null} />
            </div>

            <div className="details-energy-section">
              <h3>Energieversorgung</h3>
              <div className="energy-details-grid">
                {(lead.energy?.strom?.length > 0 && lead.energy.strom.some(m => m.zählernummer)) || (lead.energy?.gas?.length > 0 && lead.energy.gas.some(m => m.zählernummer)) ? (
                  <>
                    {lead.energy?.strom?.filter(m => m.zählernummer).map((meter, idx) => (
                      <div key={idx} className="energy-detail-card strom">
                        <div className="energy-detail-label"><IconZap size={13} /> Strom {idx + 1}</div>
                        <div className="energy-detail-item"><span className="energy-detail-key">Zählertyp:</span><span className="energy-detail-value">{meter.zählertyp || "SLP"}</span></div>
                        {meter.zählertyp === "RLM" && meter.spannungsebene && <div className="energy-detail-item"><span className="energy-detail-key">Spannungsebene:</span><span className="energy-detail-value">{meter.spannungsebene === "bekannt" ? (meter.spannungsebeneWert || "Bekannt") : "Unbekannt"}</span></div>}
                        <div className="energy-detail-item"><span className="energy-detail-key">Zählernummer:</span><span className="energy-detail-value">{meter.zählernummer}</span></div>
                        {meter.maloId && <div className="energy-detail-item"><span className="energy-detail-key">MALO-ID:</span><span className="energy-detail-value">{meter.maloId}</span></div>}
                        {meter.verbrauchKwh && <div className="energy-detail-item"><span className="energy-detail-key">Verbrauch:</span><span className="energy-detail-value">{Number(meter.verbrauchKwh).toLocaleString("de-DE")} kWh</span></div>}
                        {meter.jahreskosten && <div className="energy-detail-item"><span className="energy-detail-key">Jahreskosten:</span><span className="energy-detail-value">€{Number(meter.jahreskosten).toLocaleString("de-DE")}</span></div>}
                        {formatMeterAddress(meter) && <div className="energy-detail-item"><span className="energy-detail-key">Abweichende Lieferadresse:</span><span className="energy-detail-value">{formatMeterAddress(meter)}</span></div>}
                      </div>
                    ))}
                    {lead.energy?.gas?.filter(m => m.zählernummer).map((meter, idx) => (
                      <div key={idx} className="energy-detail-card gas">
                        <div className="energy-detail-label"><IconFlame size={13} /> Gas {idx + 1}</div>
                        <div className="energy-detail-item"><span className="energy-detail-key">Zählertyp:</span><span className="energy-detail-value">{meter.zählertyp || "SLP"}</span></div>
                        {meter.zählertyp === "RLM" && meter.spannungsebene && <div className="energy-detail-item"><span className="energy-detail-key">Spannungsebene:</span><span className="energy-detail-value">{meter.spannungsebene === "bekannt" ? (meter.spannungsebeneWert || "Bekannt") : "Unbekannt"}</span></div>}
                        <div className="energy-detail-item"><span className="energy-detail-key">Zählernummer:</span><span className="energy-detail-value">{meter.zählernummer}</span></div>
                        {meter.maloId && <div className="energy-detail-item"><span className="energy-detail-key">MALO-ID:</span><span className="energy-detail-value">{meter.maloId}</span></div>}
                        {meter.verbrauchKwh && <div className="energy-detail-item"><span className="energy-detail-key">Verbrauch:</span><span className="energy-detail-value">{Number(meter.verbrauchKwh).toLocaleString("de-DE")} kWh</span></div>}
                        {meter.jahreskosten && <div className="energy-detail-item"><span className="energy-detail-key">Jahreskosten:</span><span className="energy-detail-value">€{Number(meter.jahreskosten).toLocaleString("de-DE")}</span></div>}
                        {formatMeterAddress(meter) && <div className="energy-detail-item"><span className="energy-detail-key">Abweichende Lieferadresse:</span><span className="energy-detail-value">{formatMeterAddress(meter)}</span></div>}
                      </div>
                    ))}
                  </>
                ) : (<p className="empty-energy-info">Keine Energieinformationen erfasst</p>)}
              </div>
            </div>
            {lead.createdBy && (
              <div className="drawer-created-by">
                Erstellt von <strong>{lead.createdBy.email}</strong> am {formatDateTime(lead.createdBy.timestamp)}
              </div>
            )}
          </div>
        )}

        {/* Tab: Aktivität */}
        {drawerTab === "activity" && (
          <div className="drawer-tab-content">
            <div className="status-action-head">
              <strong>{statusActions.title}</strong>
              <span>Status: {lead.status}</span>
            </div>
            <div className="quick-action-row">
              {statusActions.actions.map((action) => (
                <button key={action.key} className={`quick-action-btn ${action.className || ""}`} onClick={action.onClick}>{action.label}</button>
              ))}
            </div>
            <div className="activity-compose-bar">
              <button
                className={`compose-action-btn ${showCallForm ? "active" : ""}`}
                onClick={() => setShowCallForm(v => !v)}
              >
                <IconPhone size={13} /> Anruf protokollieren
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
              {groupedTimeline.length === 0 ? (
                <p className="empty-timeline">Noch keine Aktivitäten. Füge eine Notiz hinzu oder protokolliere einen Anruf.</p>
              ) : (
                groupedTimeline.map((group, gIdx) => {
                  if (group.kind === "single") {
                    const item = group.item;
                    return (
                      <ActivityItem
                        key={gIdx}
                        item={item}
                        canEdit={item.type === "comment" && (item.author === user.email || userRole === "admin")}
                        onEdit={item.type === "comment" ? (newText) => editComment(item._idx, newText) : null}
                        onDelete={item.type === "comment" ? () => deleteComment(item._idx) : null}
                      />
                    );
                  }
                  if (group.kind === "stack") {
                    return <ActivityItem key={gIdx} stack={group.items} />;
                  }
                  if (group.kind === "linked") {
                    return (
                      <ActivityItem
                        key={gIdx}
                        item={group.comment}
                        linkedStatus={group.status}
                        canEdit={group.comment.author === user.email || userRole === "admin"}
                        onEdit={(newText) => editComment(group.comment._idx, newText)}
                        onDelete={() => deleteComment(group.comment._idx)}
                      />
                    );
                  }
                  return null;
                })
              )}
            </div>
          </div>
        )}

        {/* Tab: Planung */}
        {drawerTab === "planung" && (
          <div className="drawer-tab-content">
            <div className="planung-calc-wrap">
              <SavingsCalculator lead={lead} />
            </div>
            <div className="next-action-playbook">
              <div className="next-action-playbook-head">
                <span>Next Best Action</span>
                <strong className={`next-action-pill ${nextAction.tone}`}>{nextAction.label}</strong>
              </div>
              <div className="next-action-playbook-grid">
                <div><span>Kanal</span><strong>{nextAction.channel}</strong></div>
                <div><span>Timing</span><strong>{nextAction.when}</strong></div>
                <div><span>Grund</span><strong>{nextAction.reason}</strong></div>
              </div>
              <div className="sequence-playbook-head"><span>{sequencePlan.title}</span></div>
              <div className="sequence-playbook-list">
                {sequencePlan.steps.map((step, idx) => {
                  const outcome = getSequenceOutcome(step.id);
                  return (
                    <div key={step.id} className="sequence-step-card">
                      <div className="sequence-step-main">
                        <strong>{idx + 1}. {step.title}</strong>
                        <p>{step.purpose}</p>
                        <div className="sequence-step-meta">
                          <span>Kanal: {step.channel}</span>
                          <span>Timing: {step.dueInDays === 0 ? "Heute" : `+${step.dueInDays} Tage`}</span>
                          {outcome && <span className={`sequence-outcome-chip ${outcome === "erfolg" ? "success" : "neutral"}`}>Outcome: {outcome}</span>}
                        </div>
                      </div>
                      <div className="sequence-step-actions">
                        <button type="button" className="sequence-btn apply" onClick={() => applySequenceStep(step)} disabled={!!sequenceBusyId}>{sequenceBusyId === step.id ? "..." : "Übernehmen"}</button>
                        <button type="button" className="sequence-btn success" onClick={() => trackSequenceOutcome(step, "erfolg")} disabled={!!sequenceBusyId}>Erfolg</button>
                        <button type="button" className="sequence-btn neutral" onClick={() => trackSequenceOutcome(step, "kein-kontakt")} disabled={!!sequenceBusyId}>Kein Kontakt</button>
                      </div>
                    </div>
                  );
                })}
              </div>
              {sequenceMsg && <p className="sequence-msg">{sequenceMsg}</p>}
            </div>
          </div>
        )}

        {/* Tab: Wechsel & Provision */}
        {drawerTab === "wechsel" && (
          <div className="drawer-tab-content">
            {lead.status === "Abschluss" ? (
              <>
                <WechselprozessTracker lead={lead} user={user} onUpdateField={onUpdateField} />
                <div style={{ marginTop: 20 }}>
                  <ProvisionsTracker lead={lead} onUpdateField={onUpdateField} />
                </div>
              </>
            ) : (
              <div className="wechsel-locked">
                Wechselprozess und Provision sind für abgeschlossene Leads (Status „Abschluss“) verfügbar.
              </div>
            )}
          </div>
        )}

        {/* Tab: KI-Assistent */}
        {drawerTab === "ai" && (
          <div className="drawer-tab-content">
            <AIAssistantPanel
              lead={lead}
              user={user}
              userRole={userRole}
              onUpdateField={onUpdateField}
              onUpdateStatus={onUpdateStatus}
            />
          </div>
        )}

        {/* Tab: Anhänge */}
        {drawerTab === "attachments" && (
          <div className="drawer-tab-content">
            <div className="attachments-upload-zone">
              <label htmlFor={`drawer-file-${lead.id}`} className="attachment-upload-label">
                <IconPaperclip size={13} /> Dateien hochladen (max 10 MB)
              </label>
              <input id={`drawer-file-${lead.id}`} type="file" multiple className="file-input" onChange={e => onAddAttachment(lead.id, e.target.files)} />
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
                      <button type="button" onClick={() => setPreviewAttachment(att)} className="att-btn preview" title="Vorschau">▶</button>
                      <a href={getAttachmentHref(att)} download={att.name} className="att-btn download" title="Herunterladen">⬇</a>
                      <button type="button" onClick={() => setDeleteConfirmId(att.id)} className="att-btn delete" title="Löschen">✕</button>
                    </div>
                  </div>
                ))}
              </div>
            ) : (<p className="empty-timeline">Keine Anhänge vorhanden.</p>)}
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
                  <img src={previewHref} alt={previewAttachment.name} className="preview-image" />
                ) : previewAttachment.type === "application/pdf" ? (
                  <div className="preview-pdf">
                    <p>PDF-Datei</p>
                    <a href={previewHref} target="_blank" rel="noreferrer" className="primary-btn-modal">PDF öffnen</a>
                  </div>
                ) : previewAttachment.type?.startsWith("text/") || previewAttachment.name?.match(/\.(txt|json|csv|md)$/i) ? (
                  <div className="preview-text">
                    {previewAttachment.data ? (
                      <>
                        <pre>{previewAttachment.data.substring(0, 2000)}</pre>
                        {previewAttachment.data.length > 2000 && <p className="preview-truncated">... Datei gekürzt (max 2000 Zeichen)</p>}
                      </>
                    ) : (
                      <a href={previewHref} target="_blank" rel="noreferrer" className="primary-btn-modal">Datei öffnen</a>
                    )}
                  </div>
                ) : (
                  <div className="preview-generic">
                    <p>{previewAttachment.type || "Unbekannter Dateityp"}</p>
                    <a href={previewHref} download={previewAttachment.name} className="primary-btn-modal">Datei herunterladen</a>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {deleteConfirmId && (
          <div className="modal-backdrop" onClick={() => setDeleteConfirmId(null)}>
            <div className="confirm-modal" onClick={e => e.stopPropagation()}>
              <div className="confirm-icon"><IconAlertTriangle size={24} /></div>
              <h3>Anhang löschen?</h3>
              <p>Diese Aktion kann nicht rückgängig gemacht werden.</p>
              <div className="confirm-actions">
                <button className="ghost-btn" onClick={() => setDeleteConfirmId(null)}>Abbrechen</button>
                <button className="danger-btn" onClick={() => { onRemoveAttachment(lead.id, deleteConfirmId); setDeleteConfirmId(null); }}>Löschen</button>
              </div>
            </div>
          </div>
        )}

        <div className="drawer-footer">
          {userRole === "admin" && (
            <button className="danger-btn-sm" onClick={handleDelete}>Lead löschen</button>
          )}
        </div>
      </div>

      {/* Termin Modal */}
      {showAppointmentModal && ReactDOM.createPortal(
        <AppointmentModal
          lead={lead}
          currentUserEmail={user?.email || ""}
          onClose={() => setShowAppointmentModal(false)}
          onSave={handleSaveAppointment}
        />,
        document.body
      )}
    </Wrapper>
  );
}

export default LeadDetailDrawer;
