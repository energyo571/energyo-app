import React from "react";
import { PROVISION_STATUS } from "../constants";
import { formatEuro } from "../utils/format";
import { formatDate } from "../utils/dates";
import { IconDollar, IconClock, IconClipboard, IconCheck } from "./Icons";

const PROVISION_ICONS = { pending: <IconClock size={13} />, booked: <IconClipboard size={13} />, done: <IconCheck size={13} /> };

function ProvisionsTracker({ lead, onUpdateField }) {
  const provision = lead.provision || {};

  const save = async (updates) => {
    await onUpdateField(lead.id, "provision", { ...provision, ...updates });
  };

  return (
    <div className="provisions-tracker">
      <h3 style={{ margin: "0 0 12px", fontSize: "0.95rem", fontWeight: 800, color: "#0f172a" }}><IconDollar size={14} /> Provisions-Tracker</h3>
      <div className="provision-grid">
        <div className="provision-field">
          <label>Provisionsbetrag (€)</label>
          <input type="number" step="0.01" min="0" placeholder="z.B. 250" value={provision.amount || ""} onChange={e => save({ amount: e.target.value })} />
        </div>
        <div className="provision-field">
          <label>Erwartete Auszahlung</label>
          <input type="date" value={provision.expectedDate || ""} onChange={e => save({ expectedDate: e.target.value })} />
        </div>
        <div className="provision-field">
          <label>Tatsächliche Auszahlung</label>
          <input type="date" value={provision.actualDate || ""} onChange={e => save({ actualDate: e.target.value })} />
        </div>
        <div className="provision-field">
          <label>Notiz</label>
          <input type="text" placeholder="z.B. Maklervertrag #12345" value={provision.note || ""} onChange={e => save({ note: e.target.value })} />
        </div>
      </div>
      <div className="provision-status-row">
        {PROVISION_STATUS.map(s => (
          <button key={s.id} className={`provision-status-btn ${provision.status === s.id ? "active" : ""}`} onClick={() => save({ status: s.id })}>
            {PROVISION_ICONS[s.icon]} {s.label}
          </button>
        ))}
      </div>
      {provision.status === "ausgezahlt" && provision.amount && (
        <div className="provision-confirmed">
          <IconCheck size={13} /> {formatEuro(parseFloat(provision.amount))} ausgezahlt{provision.actualDate ? ` am ${formatDate(provision.actualDate)}` : ""}
        </div>
      )}
    </div>
  );
}

export default ProvisionsTracker;
