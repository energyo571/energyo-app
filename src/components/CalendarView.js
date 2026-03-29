import React, { useState, useMemo } from "react";
import { formatDate } from "../utils/dates";
import { IconPlus, IconX, IconTrash } from "./Icons";

function CalendarView({ leads, onOpenLead, externalEvents = [], onAddEvent, onRemoveEvent }) {
  const [monthOffset, setMonthOffset] = useState(0);
  const [addingDate, setAddingDate] = useState(null);
  const [form, setForm] = useState({ title: "", time: "", notes: "" });
  const [editingEvent, setEditingEvent] = useState(null);

  const baseDate = useMemo(() => {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth() + monthOffset, 1);
  }, [monthOffset]);

  const monthLabel = baseDate.toLocaleDateString("de-DE", { month: "long", year: "numeric" });
  const monthStart = new Date(baseDate.getFullYear(), baseDate.getMonth(), 1);
  const monthEnd = new Date(baseDate.getFullYear(), baseDate.getMonth() + 1, 0);
  const gridStart = new Date(monthStart);
  gridStart.setDate(monthStart.getDate() - ((monthStart.getDay() + 6) % 7));
  const gridEnd = new Date(monthEnd);
  gridEnd.setDate(monthEnd.getDate() + (6 - ((monthEnd.getDay() + 6) % 7)));

  const eventsByDate = useMemo(() => {
    const map = new Map();
    leads.forEach((lead) => {
      if (!lead.appointmentDate) return;
      const bucket = map.get(lead.appointmentDate) || [];
      bucket.push({ type: "lead", ...lead });
      map.set(lead.appointmentDate, bucket);
    });
    externalEvents.forEach((evt) => {
      if (!evt.date) return;
      const bucket = map.get(evt.date) || [];
      bucket.push({ type: "external", ...evt });
      map.set(evt.date, bucket);
    });
    return map;
  }, [leads, externalEvents]);

  const upcomingAppointments = useMemo(() => {
    const today = new Date().toISOString().split("T")[0];
    const leadItems = leads
      .filter((lead) => !!lead.appointmentDate && lead.appointmentDate >= today)
      .map(l => ({ type: "lead", id: l.id, title: l.company || l.person, sub: l.person, date: l.appointmentDate, time: l.appointmentTime }));
    const extItems = externalEvents
      .filter(e => !!e.date && e.date >= today)
      .map(e => ({ type: "external", id: e.id, title: e.title, sub: e.notes, date: e.date, time: e.time }));
    return [...leadItems, ...extItems]
      .sort((a, b) => {
        if (a.date !== b.date) return a.date.localeCompare(b.date);
        return (a.time || "23:59").localeCompare(b.time || "23:59");
      })
      .slice(0, 10);
  }, [leads, externalEvents]);

  const dayCells = [];
  const cursor = new Date(gridStart);
  while (cursor <= gridEnd) {
    const iso = cursor.toISOString().split("T")[0];
    const isCurrentMonth = cursor.getMonth() === baseDate.getMonth();
    const isToday = iso === new Date().toISOString().split("T")[0];
    dayCells.push({
      iso,
      day: cursor.getDate(),
      isCurrentMonth,
      isToday,
      events: eventsByDate.get(iso) || [],
    });
    cursor.setDate(cursor.getDate() + 1);
  }

  const openAddForm = (iso) => {
    setAddingDate(iso);
    setForm({ title: "", time: "", notes: "" });
    setEditingEvent(null);
  };

  const handleSave = async () => {
    if (!form.title.trim()) return;
    if (editingEvent) {
      // currently not used, but ready
    } else if (onAddEvent) {
      await onAddEvent({ date: addingDate, title: form.title.trim(), time: form.time || null, notes: form.notes.trim() || null });
    }
    setAddingDate(null);
    setForm({ title: "", time: "", notes: "" });
    setEditingEvent(null);
  };

  return (
    <div className="tab-page">
      <div className="main-toolbar">
        <div className="toolbar-left">
          <h1 className="page-title">Kalender</h1>
          <span className="lead-count-badge">{upcomingAppointments.length} bevorstehend</span>
        </div>
        <div className="toolbar-right">
          <div className="calendar-nav-controls">
            <button className="ghost-btn-sm" onClick={() => setMonthOffset((v) => v - 1)}>◀</button>
            <strong className="calendar-month-label">{monthLabel}</strong>
            <button className="ghost-btn-sm" onClick={() => setMonthOffset((v) => v + 1)}>▶</button>
            <button className="ghost-btn-sm" onClick={() => setMonthOffset(0)}>Heute</button>
          </div>
        </div>
      </div>

      {/* ── Inline Add-Event Form ───────────────────────────────── */}
      {addingDate && (
        <div className="cal-add-overlay" onClick={() => setAddingDate(null)}>
          <div className="cal-add-modal" onClick={e => e.stopPropagation()}>
            <div className="cal-add-header">
              <strong>Termin am {new Date(addingDate + "T00:00").toLocaleDateString("de-DE", { day: "numeric", month: "long", year: "numeric" })}</strong>
              <button className="ghost-btn-sm" onClick={() => setAddingDate(null)}><IconX size={14} /></button>
            </div>
            <div className="cal-add-body">
              <input
                className="cal-add-input"
                placeholder="Titel (z.B. Kundentermin, Messe…)"
                value={form.title}
                onChange={e => setForm(f => ({ ...f, title: e.target.value }))}
                autoFocus
                onKeyDown={e => e.key === "Enter" && handleSave()}
              />
              <input
                className="cal-add-input"
                type="time"
                value={form.time}
                onChange={e => setForm(f => ({ ...f, time: e.target.value }))}
              />
              <textarea
                className="cal-add-input cal-add-textarea"
                placeholder="Notizen (optional)"
                value={form.notes}
                onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
                rows={2}
              />
            </div>
            <div className="cal-add-footer">
              <button className="ghost-btn-sm" onClick={() => setAddingDate(null)}>Abbrechen</button>
              <button className="primary-btn-sm" onClick={handleSave} disabled={!form.title.trim()}>Speichern</button>
            </div>
          </div>
        </div>
      )}

      <div className="calendar-layout">
        <div className="calendar-month-board">
          <div className="calendar-weekday-row">
            {["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"].map((wd) => (
              <div key={wd} className="calendar-weekday-cell">{wd}</div>
            ))}
          </div>
          <div className="calendar-day-grid">
            {dayCells.map((cell) => (
              <div
                key={cell.iso}
                className={`calendar-day-cell ${cell.isCurrentMonth ? "" : "muted"} ${cell.isToday ? "today" : ""} ${cell.events.length ? "has-events" : ""}`}
              >
                <div className="calendar-day-header">
                  <span>{cell.day}</span>
                  <button className="cal-day-add-btn" onClick={() => openAddForm(cell.iso)} title="Termin hinzufügen"><IconPlus size={12} /></button>
                  {cell.events.length > 0 && <span className="calendar-day-dot">{cell.events.length}</span>}
                </div>
                <div className="calendar-day-events">
                  {cell.events.slice(0, 2).map((evt) => (
                    evt.type === "external" ? (
                      <div key={evt.id} className="calendar-event-chip external" title={`${evt.title}${evt.time ? ` · ${evt.time}` : ""}${evt.notes ? `\n${evt.notes}` : ""}`}>
                        <span className="calendar-event-time">{evt.time || "--:--"}</span>
                        <span className="calendar-event-title">{evt.title}</span>
                        {onRemoveEvent && <button className="cal-evt-del" onClick={(e) => { e.stopPropagation(); onRemoveEvent(evt.id); }} title="Löschen"><IconX size={10} /></button>}
                      </div>
                    ) : (
                      <button
                        key={evt.id}
                        className="calendar-event-chip"
                        onClick={() => onOpenLead(evt.id)}
                        title={`${evt.company || evt.person}${evt.appointmentTime ? ` · ${evt.appointmentTime}` : ""}`}
                      >
                        <span className="calendar-event-time">{evt.appointmentTime || "--:--"}</span>
                        <span className="calendar-event-title">{evt.company || evt.person}</span>
                      </button>
                    )
                  ))}
                  {cell.events.length > 2 && (
                    <span className="calendar-more-events">+{cell.events.length - 2} weitere</span>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>

        <aside className="calendar-upcoming-panel">
          <h3>Nächste Termine</h3>
          {upcomingAppointments.length === 0 ? (
            <p className="empty-text">Keine bevorstehenden Termine geplant.</p>
          ) : (
            <div className="calendar-upcoming-list">
              {upcomingAppointments.map((item) => (
                <button
                  key={`upcoming-${item.type}-${item.id}`}
                  className={`calendar-upcoming-item${item.type === "external" ? " external" : ""}`}
                  onClick={() => item.type === "lead" ? onOpenLead(item.id) : null}
                >
                  <div>
                    <strong>{item.title}</strong>
                    {item.sub && <span>{item.sub}</span>}
                  </div>
                  <div>
                    <strong>{formatDate(item.date)}</strong>
                    <span>{item.time || "Ganztägig"}</span>
                  </div>
                  {item.type === "external" && onRemoveEvent && (
                    <button className="cal-upcoming-del" onClick={(e) => { e.stopPropagation(); onRemoveEvent(item.id); }} title="Löschen"><IconTrash size={12} /></button>
                  )}
                </button>
              ))}
            </div>
          )}
        </aside>
      </div>
    </div>
  );
}

export default CalendarView;
