import React from "react";
import { STATUS_OPTIONS, STATUS_META } from "../constants";
import { isOpenCancellationWindow, isOverdue } from "../utils/dates";
import { formatDate } from "../utils/dates";
import { formatEuro } from "../utils/format";
import { calculateUmsatzPotential, getEnergyMeterCount, getTotalDeliveryPoints } from "../utils/energy";
import { calculatePriority, hasSupplyConfirmation } from "../utils/leads";

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
                    {lead.appointmentDate && (
                      <div className="kanban-appointment">📅 {formatDate(lead.appointmentDate)}</div>
                    )}
                    <div className="kanban-energy">
                      {stromCount > 0 && <span className="energy-badge strom">🔌 x{stromCount}</span>}
                      {gasCount > 0 && <span className="energy-badge gas">🔥 x{gasCount}</span>}
                      {deliveryPoints > 0 && (<span className={`energy-badge total ${deliveryPoints >= 3 ? "high" : ""}`}>📍 {deliveryPoints}</span>)}
                    </div>
                    <div className="kanban-card-footer">
                      <span className="kanban-umsatz-chip">{formatEuro(calculateUmsatzPotential(lead.consumption))}</span>
                      <div className="kanban-flags">
                        {isOpenCancellationWindow(lead.contractEnd) && <span title="Kündigungsfenster">🔔</span>}
                        {isOverdue(lead.followUp) && <span title="Überfällig">⏰</span>}
                        {hasSupplyConfirmation(lead) && <span title="Belieferungsbestätigung">⚡</span>}
                        {lead.renewalResurfacedAt && <span title="Automatische Wiedervorlage">🔁</span>}
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

export default KanbanBoard;
