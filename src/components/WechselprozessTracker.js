import React, { useState } from "react";
import { WECHSEL_STEPS } from "../constants";
import { formatDate } from "../utils/dates";

function WechselprozessTracker({ lead, user, onUpdateField }) {
  const [editingStep, setEditingStep] = useState(null);
  const [editDate, setEditDate] = useState("");
  const [editNote, setEditNote] = useState("");

  const process = lead.wechselProcess || {};
  const steps = process.steps || {};
  const completedCount = WECHSEL_STEPS.filter(s => !!steps[s.id]?.completedAt).length;
  const progress = Math.round((completedCount / WECHSEL_STEPS.length) * 100);
  const allDone = completedCount === WECHSEL_STEPS.length;

  const completeStep = async (stepId) => {
    const date = editDate || new Date().toISOString().split("T")[0];
    await onUpdateField(lead.id, "wechselProcess", {
      ...process,
      steps: { ...steps, [stepId]: { completedAt: date, completedBy: user.email, note: editNote } },
    });
    setEditingStep(null);
    setEditDate("");
    setEditNote("");
  };

  const resetStep = async (stepId) => {
    const updated = { ...steps };
    delete updated[stepId];
    await onUpdateField(lead.id, "wechselProcess", { ...process, steps: updated });
  };

  return (
    <div className="wechsel-tracker">
      <div className="wechsel-header">
        <div>
          <p className="wechsel-title">🔄 Wechselprozess</p>
          <p className="wechsel-sub">{completedCount} von {WECHSEL_STEPS.length} Schritten abgeschlossen</p>
        </div>
        {allDone && <span className="wechsel-done-badge">✅</span>}
      </div>
      <div className="wechsel-progress-track">
        <div className="wechsel-progress-fill" style={{ width: `${progress}%` }} />
      </div>
      <div className="wechsel-steps">
        {WECHSEL_STEPS.map((step, idx) => {
          const done = !!steps[step.id]?.completedAt;
          const isNext = !done && idx === completedCount;
          const cls = done ? "done" : isNext ? "active" : "future";
          return (
            <div key={step.id} className={`wechsel-step ${cls}`}>
              <div className="wechsel-step-icon">{done ? "✓" : idx + 1}</div>
              <div className="wechsel-step-body">
                <div className="wechsel-step-label">
                  <strong>{step.label}</strong>
                  {done && steps[step.id]?.completedAt && (
                    <span className="wechsel-step-date">{formatDate(steps[step.id].completedAt)}</span>
                  )}
                </div>
                <p className="wechsel-step-desc">{step.desc}</p>
                {done && steps[step.id]?.note && (
                  <p className="wechsel-step-note">{steps[step.id].note}</p>
                )}
                {editingStep === step.id ? (
                  <div className="wechsel-edit-form">
                    <input type="date" className="wechsel-date-input" value={editDate} onChange={e => setEditDate(e.target.value)} />
                    <input type="text" className="wechsel-note-input" placeholder="Notiz (optional)" value={editNote} onChange={e => setEditNote(e.target.value)} />
                    <div className="wechsel-edit-actions">
                      <button className="wechsel-confirm-btn" onClick={() => completeStep(step.id)}>Bestätigen</button>
                      <button className="wechsel-cancel-btn" onClick={() => setEditingStep(null)}>Abbrechen</button>
                    </div>
                  </div>
                ) : (
                  !done && isNext && (
                    <button className="wechsel-complete-btn" onClick={() => { setEditingStep(step.id); setEditDate(""); setEditNote(""); }}>
                      Abschließen
                    </button>
                  )
                )}
                {done && (
                  <button className="wechsel-reset-btn" onClick={() => resetStep(step.id)}>Rückgängig</button>
                )}
              </div>
            </div>
          );
        })}
      </div>
      {allDone && (
        <div style={{ padding: "12px 16px", background: "#f0fdf4", color: "#16a34a", fontSize: "0.82rem", fontWeight: 700, borderTop: "1px solid #dcfce7" }}>
          🏆 Wechsel abgeschlossen! Jetzt Empfehlung anfragen.
        </div>
      )}
    </div>
  );
}

export default WechselprozessTracker;
