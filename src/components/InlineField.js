import React, { useState, useEffect, useRef } from "react";

function InlineField({ label, value, onSave, type = "text", options = null, render = null }) {
  const [editing, setEditing] = useState(false);
  const [val, setVal] = useState(value || "");
  const ref = useRef(null);
  useEffect(() => { setVal(value || ""); }, [value]);
  useEffect(() => { if (editing && ref.current) ref.current.focus(); }, [editing]);
  const save = () => { onSave(val); setEditing(false); };
  const cancel = () => { setVal(value || ""); setEditing(false); };
  return (
    <div className="inline-field">
      <label className="inline-label">{label}</label>
      {editing ? (
        <div className="inline-edit-row">
          {options ? (
            <select ref={ref} value={val} onChange={e => setVal(e.target.value)} onBlur={save}>
              {options.map(o => <option key={o} value={o}>{o}</option>)}
            </select>
          ) : (
            <input
              ref={ref} type={type} value={val}
              onChange={e => setVal(e.target.value)}
              onKeyDown={e => { if (e.key === "Enter") save(); if (e.key === "Escape") cancel(); }}
              onBlur={save}
            />
          )}
        </div>
      ) : (
        <div className="inline-value-row" onClick={() => setEditing(true)}>
          <span className="inline-value">
            {render ? render(value) : (value || <em className="inline-empty">Klicken zum Bearbeiten</em>)}
          </span>
        </div>
      )}
    </div>
  );
}

export default InlineField;
