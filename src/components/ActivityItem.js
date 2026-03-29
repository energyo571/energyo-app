import React, { useState } from "react";
import { formatDateTime } from "../utils/dates";

function ActivityItem({ item, onEdit, onDelete, canEdit, stack, linkedStatus }) {
  const [editing, setEditing] = useState(false);
  const [editText, setEditText] = useState(item?.text || "");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [stackOpen, setStackOpen] = useState(false);

  // ─── Stack mode: collapsed status changes ───
  if (stack) {
    const latest = stack[0];
    const rest = stack.slice(1);
    return (
      <div className="activity-item act-status act-stack">
        <div className="activity-icon-wrap"><span>🔄</span></div>
        <div className="activity-body">
          <div className="activity-meta">
            <span className="activity-author">{latest.author || "System"}</span>
            <span className="activity-time">{formatDateTime(latest.timestamp)}</span>
          </div>
          <p className="activity-text">
            {latest.from} <span className="status-arrow">→</span> <strong>{latest.to}</strong>
          </p>
          {rest.length > 0 && (
            <button
              type="button"
              className="stack-toggle-btn"
              onClick={() => setStackOpen(v => !v)}
            >
              {stackOpen ? "Weniger anzeigen" : `${rest.length} weitere Änderung${rest.length > 1 ? "en" : ""}`}
            </button>
          )}
          {stackOpen && rest.map((s, i) => (
            <div key={i} className="stack-item">
              <span className="activity-time">{formatDateTime(s.timestamp)}</span>
              <span className="activity-text">
                {s.from} <span className="status-arrow">→</span> <strong>{s.to}</strong>
              </span>
            </div>
          ))}
        </div>
      </div>
    );
  }

  // ─── Normal / Linked mode ───
  const cfg = {
    comment: { icon: "💬", cls: "act-comment" },
    call:    { icon: "📞", cls: "act-call" },
    status:  { icon: "🔄", cls: "act-status" },
  }[item.type] || { icon: "📝", cls: "act-comment" };

  const saveEdit = () => {
    if (editText.trim() && onEdit) onEdit(editText.trim());
    setEditing(false);
  };

  return (
    <div className={`activity-item ${cfg.cls}${linkedStatus ? " act-linked" : ""}`}>
      {linkedStatus && (
        <div className="linked-status-bar">
          <span className="linked-status-icon">🔄</span>
          <span>{linkedStatus.from} → <strong>{linkedStatus.to}</strong></span>
          <span className="activity-time">{formatDateTime(linkedStatus.timestamp)}</span>
        </div>
      )}
      <div className="activity-icon-wrap"><span>{cfg.icon}</span></div>
      <div className="activity-body">
        <div className="activity-meta">
          <span className="activity-author">{item.author || "System"}</span>
          <span className="activity-time">{formatDateTime(item.timestamp)}</span>
          {item.edited && <span className="activity-edited-badge">bearbeitet</span>}
          {canEdit && item.type === "comment" && (
            <div className="activity-actions">
              <button className="act-edit-btn" onClick={() => { setEditing(true); setEditText(item.text || ""); }} title="Bearbeiten">✎</button>
              <button className="act-delete-btn" onClick={() => setConfirmDelete(true)} title="Löschen">✕</button>
            </div>
          )}
        </div>

        {item.type === "comment" && (
          editing ? (
            <div className="activity-edit-area">
              <textarea
                value={editText}
                onChange={e => setEditText(e.target.value)}
                onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); saveEdit(); } if (e.key === "Escape") setEditing(false); }}
                rows={3}
                autoFocus
              />
              <div className="activity-edit-actions">
                <button className="primary-btn-sm" onClick={saveEdit}>Speichern</button>
                <button className="ghost-btn-sm" onClick={() => setEditing(false)}>Abbrechen</button>
              </div>
            </div>
          ) : (
            <p className="activity-text">{item.text}</p>
          )
        )}

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

      {confirmDelete && (
        <div className="activity-delete-confirm">
          <span>Kommentar löschen?</span>
          <button className="danger-btn-xs" onClick={() => { if (onDelete) onDelete(); setConfirmDelete(false); }}>Löschen</button>
          <button className="ghost-btn-xs" onClick={() => setConfirmDelete(false)}>Abbrechen</button>
        </div>
      )}
    </div>
  );
}

export default ActivityItem;
