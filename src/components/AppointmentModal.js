import React, { useState } from "react";
import { formatDate } from "../utils/dates";
import { resolveUserCalendlyBaseUrl } from "../utils/calendly";

function AppointmentModal({ lead, currentUserEmail, onClose, onSave }) {
  const [date, setDate] = useState(lead.appointmentDate || "");
  const [time, setTime] = useState(lead.appointmentTime || "");
  const [notes, setNotes] = useState(lead.appointmentNotes || "");
  const [title, setTitle] = useState(lead.appointmentTitle || `Termin: ${lead.company || lead.person || ""}`);
  const [saved, setSaved] = useState(false);
  const [calendarExported, setCalendarExported] = useState(null);

  const handleSave = async () => {
    await onSave({ appointmentDate: date, appointmentTime: time, appointmentNotes: notes, appointmentTitle: title });
    setSaved(true);
  };

  const buildGoogleCalendarUrl = () => {
    const start = date.replace(/-/g, "") + (time ? "T" + time.replace(":", "") + "00" : "");
    const end = start;
    return `https://www.google.com/calendar/render?action=TEMPLATE&text=${encodeURIComponent(title)}&dates=${start}/${end}&details=${encodeURIComponent(notes || "")}`;
  };

  const buildIcalContent = () => {
    const uid = `energyo-${lead.id}-${Date.now()}`;
    const dtStart = date.replace(/-/g, "") + (time ? "T" + time.replace(":", "") + "00" : "");
    return [
      "BEGIN:VCALENDAR", "VERSION:2.0", "BEGIN:VEVENT",
      `UID:${uid}`, `DTSTART:${dtStart}`, `SUMMARY:${title}`,
      notes ? `DESCRIPTION:${notes.replace(/\n/g, "\\n")}` : "",
      "END:VEVENT", "END:VCALENDAR",
    ].filter(Boolean).join("\r\n");
  };

  const buildCalendlyUrl = () => {
    const ownerEmail = lead.ownerEmail || lead.createdBy?.email || "";
    const base = resolveUserCalendlyBaseUrl(currentUserEmail, ownerEmail);
    if (!base) return "";
    const params = new URLSearchParams();
    if (lead.person) params.set("name", lead.person);
    if (lead.email) params.set("email", lead.email);
    const qs = params.toString();
    return qs ? `${base}?${qs}` : base;
  };

  const handleCalendarExport = (type) => {
    if (type === "google") {
      window.open(buildGoogleCalendarUrl(), "_blank", "noopener,noreferrer");
    }
    if (type === "ical") {
      const blob = new Blob([buildIcalContent()], { type: "text/calendar" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url; a.download = `termin-${lead.company || "lead"}.ics`;
      a.click(); URL.revokeObjectURL(url);
    }
    if (type === "calendly") {
      const url = buildCalendlyUrl();
      if (url) window.open(url, "_blank", "noopener,noreferrer");
    }
    setCalendarExported(type);
  };

  const executeCalendarExport = (type) => {
    handleCalendarExport(type);
  };

  return (
    <div className="modal-backdrop" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal appointment-modal">
        <div className="modal-header">
          <h2>📅 Termin planen</h2>
          <button className="drawer-close-btn" onClick={onClose}>✕</button>
        </div>
        {saved ? (
          <div className="appointment-saved">
            <div className="appointment-confirm">✅ Termin gespeichert!</div>
            <p className="appointment-detail">
              <strong>{title}</strong><br />
              {formatDate(date)}{time ? ` um ${time} Uhr` : ""}
            </p>
            <div className="calendar-export-section">
              <p className="calendar-export-label">Termin exportieren:</p>
              <div className="calendar-export-buttons">
                <button className="calendar-export-btn google" onClick={() => executeCalendarExport("google")}>
                  📅 Google Calendar
                  {calendarExported === "google" && <span className="export-check">✓</span>}
                </button>
                <button className="calendar-export-btn ical" onClick={() => executeCalendarExport("ical")}>
                  📥 iCal / Outlook
                  {calendarExported === "ical" && <span className="export-check">✓</span>}
                </button>
                <button className="calendar-export-btn calendly" onClick={() => executeCalendarExport("calendly")} disabled={!buildCalendlyUrl()}>
                  🔗 Calendly
                  {calendarExported === "calendly" && <span className="export-check">✓</span>}
                </button>
              </div>
            </div>
            <button className="ghost-btn" style={{ marginTop: 16 }} onClick={onClose}>Schließen</button>
          </div>
        ) : (
          <div className="appointment-form">
            <div className="form-group">
              <label>Titel</label>
              <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Gesprächstitel" />
            </div>
            <div className="appt-date-row">
              <div className="form-group">
                <label>Datum *</label>
                <input type="date" value={date} onChange={(e) => setDate(e.target.value)} min={new Date().toISOString().split("T")[0]} />
              </div>
              <div className="form-group">
                <label>Uhrzeit</label>
                <input type="time" value={time} onChange={(e) => setTime(e.target.value)} />
              </div>
            </div>
            <div className="form-group">
              <label>Notizen</label>
              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Gesprächsagenda, Themen..."
                rows={3}
              />
            </div>
            {lead.appointmentDate && (
              <div className="existing-appointment">
                <span>📅 Bestehender Termin: {formatDate(lead.appointmentDate)} {lead.appointmentTime && `um ${lead.appointmentTime} Uhr`}</span>
              </div>
            )}
            <div className="modal-footer">
              <button className="ghost-btn" onClick={onClose}>Abbrechen</button>
              <button className="primary-btn-modal" onClick={handleSave} disabled={!date}>
                Termin speichern
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default AppointmentModal;
