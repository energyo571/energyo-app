import React from "react";
import { STATUS_META } from "../constants";
import { isOpenCancellationWindow, isOverdue, isTodayDue, formatDate } from "../utils/dates";
import { formatEuro } from "../utils/format";
import { calculateUmsatzPotential, getEnergyMeterCount, getTotalDeliveryPoints } from "../utils/energy";
import {
  getLeadActivityCount, getLeadReadiness, getLeadTemperature,
  getNextAction, getLeadWinProbability, getLeadScoreTone, getLeadOwnerEmail, getLastActivityTimestamp
} from "../utils/leads";

function LeadRow({ lead, onSelect, isSelected, selectionMode, isChecked, onToggleCheck }) {
  const hasCancellationWindow = isOpenCancellationWindow(lead.contractEnd);
  const isOverdueNow = isOverdue(lead.followUp);
  const isTodayNow = isTodayDue(lead.followUp);
  const meta = STATUS_META[lead.status] || STATUS_META.Neu;
  const umsatz = calculateUmsatzPotential(lead.consumption);
  const activityCount = getLeadActivityCount(lead);
  const readiness = getLeadReadiness(lead);
  const temperature = getLeadTemperature(lead);
  const nextAction = getNextAction(lead);
  const closeProbability = getLeadWinProbability(lead);
  const scoreTone = getLeadScoreTone(closeProbability);
  const owner = getLeadOwnerEmail(lead);
  const lastActivityAt = getLastActivityTimestamp(lead);
  const stromCount = getEnergyMeterCount(lead, "strom");
  const gasCount = getEnergyMeterCount(lead, "gas");
  const deliveryPoints = getTotalDeliveryPoints(lead);

  return (
    <div
      className={`lead-row ${isSelected ? "selected" : ""} ${isChecked ? "bulk-checked" : ""}`}
      onClick={() => selectionMode ? onToggleCheck(lead.id) : onSelect(lead)}
    >
      {selectionMode && (
        <div className="lead-row-checkbox" onClick={e => e.stopPropagation()}>
          <input
            type="checkbox"
            checked={isChecked}
            onClick={e => e.stopPropagation()}
            onChange={() => onToggleCheck(lead.id)}
          />
        </div>
      )}
      {!selectionMode && <div className="lead-row-checkbox-placeholder" />}
      <div className="lead-row-signals">
        <span
          className={`ampel-pill ${readiness.tone}`}
          title={readiness.tone === "green" ? "Alle Daten vollständig" : "Daten unvollständig"}
          aria-label={readiness.tone === "green" ? "Alle Daten vollständig" : "Daten unvollständig"}
        >
          {readiness.tone === "green" ? "🟢" : "🛑"}
        </span>
        <span
          className={`health-pill ${temperature.tone}`}
          title={`Heat-Level: ${temperature.label}`}
          aria-label={`Heat-Level: ${temperature.label}`}
        >
          {temperature.label}
        </span>
        {lead.energyAuditEligible && (
          <span className="audit-pill" title="Energieaudit berechtigt">🔍 Audit</span>
        )}
        {lead.renewalResurfacedAt && (
          <span className="resurface-pill" title="Automatisch wiedervorgelegt">🔁 Renewal</span>
        )}
      </div>
      <div className="lead-row-main">
        <div className="lead-row-company">{lead.company || <em className="no-company">Kein Firmenname</em>}</div>
        <div className="lead-row-sub">
          {lead.person}
          {lead.phone ? (
            <>{" · "}<a className="lead-phone-link" href={`tel:${lead.phone}`} onClick={e => e.stopPropagation()}>{lead.phone}</a></>
          ) : ""}
        </div>
        <div className="lead-row-owner">Owner: {owner}</div>
      </div>
      <div className="lead-row-energy">
        {stromCount > 0 && <span className="energy-badge strom">🔌 Strom x{stromCount}</span>}
        {gasCount > 0 && <span className="energy-badge gas">🔥 Gas x{gasCount}</span>}
        {deliveryPoints > 0 && (<span className={`energy-badge total ${deliveryPoints >= 3 ? "high" : ""}`}>📍 {deliveryPoints} Lieferstellen</span>)}
      </div>
      <div className="lead-row-health">
        <span className={`lead-score-pill ${scoreTone}`}>Deal {closeProbability}%</span>
        <span className={`next-action-pill ${nextAction.tone}`}>{nextAction.label}</span>
      </div>
      <div className="lead-row-status">
        <span className="status-chip" style={{ background: meta.bg, color: meta.color }}>{lead.status}</span>
      </div>
      <div className="lead-row-umsatz">{formatEuro(umsatz)}</div>
      <div className="lead-row-followup">
        {lead.followUp ? (
          <span className={isOverdueNow ? "date-overdue" : isTodayNow ? "date-today" : ""}>{formatDate(lead.followUp)}</span>
        ) : hasCancellationWindow ? (
          <span className="followup-chip cancellation" title="Kündigungsfenster offen">Künd.-Fenster</span>
        ) : "—"}
      </div>
      <div className="lead-row-activity">
        <span className="activity-count">{activityCount}</span>
        <span className="last-activity-label">{lastActivityAt ? formatDate(lastActivityAt) : "Neu"}</span>
      </div>
    </div>
  );
}

export default LeadRow;
