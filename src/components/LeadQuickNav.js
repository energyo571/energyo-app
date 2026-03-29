import React, { useRef, useEffect } from "react";
import { STATUS_META } from "../constants";
import { calculateLeadScore } from "../utils/leads";

function LeadQuickNav({ leads, selectedLeadId, onSelectLead }) {
  const activeRef = useRef(null);

  useEffect(() => {
    if (activeRef.current) {
      activeRef.current.scrollIntoView({ block: "nearest", behavior: "smooth" });
    }
  }, [selectedLeadId]);

  if (!leads || leads.length === 0) return null;

  return (
    <div className="quick-nav">
      <div className="quick-nav-header">
        <span className="quick-nav-title">Leads</span>
        <span className="quick-nav-count">{leads.length}</span>
      </div>
      <div className="quick-nav-list">
        {leads.map((lead) => {
          const active = lead.id === selectedLeadId;
          const meta = STATUS_META[lead.status] || STATUS_META.Neu;
          const score = calculateLeadScore(lead);
          return (
            <button
              key={lead.id}
              ref={active ? activeRef : null}
              className={`quick-nav-item${active ? " active" : ""}`}
              onClick={() => onSelectLead(lead.id)}
              type="button"
            >
              <span className="quick-nav-dot" style={{ background: meta.color }} />
              <span className="quick-nav-name">{lead.company || lead.person || "Lead"}</span>
              <span className="quick-nav-score">{score}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

export default LeadQuickNav;
