import React, { useState } from "react";
import { formatDateTime } from "../utils/dates";

function ActivityItem({ item, onEdit, onDelete, canEdit }) {
  const [editing, setEditing] = useState(false);
  const [editText, setEditText] = useState(item.text || "");
  const [confirmDelete, setConfirmDelete] = useState(false);

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
    <div className={`activity-item ${cfg.cls}`}>
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
