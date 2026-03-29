import React, { useState } from "react";

function BulkActionBar({ selectedCount, onDelete, onCancel, onSelectAll, totalCount }) {
  const [confirmDelete, setConfirmDelete] = useState(false);
  return (
    <div className="bulk-action-bar">
      <div className="bulk-action-left">
        <span className="bulk-count">{selectedCount} Lead{selectedCount !== 1 ? "s" : ""} ausgewählt</span>
        <button className="bulk-select-all-btn" onClick={onSelectAll}>
          {selectedCount === totalCount ? "Alle abwählen" : "Alle auswählen"}
        </button>
      </div>
      <div className="bulk-action-right">
        {confirmDelete ? (
          <div className="bulk-confirm-row">
            <span className="bulk-confirm-text">{selectedCount} Leads wirklich löschen?</span>
            <button className="danger-btn" onClick={() => { onDelete(); setConfirmDelete(false); }}>Ja, löschen</button>
            <button className="ghost-btn" onClick={() => setConfirmDelete(false)}>Abbrechen</button>
          </div>
        ) : (
          <button className="danger-btn" onClick={() => setConfirmDelete(true)}>
            {selectedCount} Leads löschen
          </button>
        )}
        <button className="ghost-btn" onClick={onCancel}>Abbrechen</button>
      </div>
    </div>
  );
}

export default BulkActionBar;
