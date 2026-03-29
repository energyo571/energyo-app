import React, { useState, useMemo } from "react";
import { formatDate } from "../utils/dates";

function CalendarView({ leads, onOpenLead }) {
  const [monthOffset, setMonthOffset] = useState(0);

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
      bucket.push(lead);
      map.set(lead.appointmentDate, bucket);
    });
    return map;
  }, [leads]);

  const upcomingAppointments = useMemo(() => {
    const today = new Date().toISOString().split("T")[0];
    return leads
      .filter((lead) => !!lead.appointmentDate && lead.appointmentDate >= today)
      .sort((a, b) => {
        if (a.appointmentDate !== b.appointmentDate) return a.appointmentDate.localeCompare(b.appointmentDate);
        return (a.appointmentTime || "23:59").localeCompare(b.appointmentTime || "23:59");
      })
      .slice(0, 8);
  }, [leads]);

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
                  {cell.events.length > 0 && <span className="calendar-day-dot">{cell.events.length}</span>}
                </div>
                <div className="calendar-day-events">
                  {cell.events.slice(0, 2).map((lead) => (
                    <button
                      key={lead.id}
                      className="calendar-event-chip"
                      onClick={() => onOpenLead(lead.id)}
                      title={`${lead.company || lead.person}${lead.appointmentTime ? ` · ${lead.appointmentTime}` : ""}`}
                    >
                      <span className="calendar-event-time">{lead.appointmentTime || "--:--"}</span>
                      <span className="calendar-event-title">{lead.company || lead.person}</span>
                    </button>
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
              {upcomingAppointments.map((lead) => (
                <button key={`upcoming-${lead.id}`} className="calendar-upcoming-item" onClick={() => onOpenLead(lead.id)}>
                  <div>
                    <strong>{lead.company || lead.person}</strong>
                    <span>{lead.person}</span>
                  </div>
                  <div>
                    <strong>{formatDate(lead.appointmentDate)}</strong>
                    <span>{lead.appointmentTime || "Ganztägig"}</span>
                  </div>
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
