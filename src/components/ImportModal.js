import React, { useState, useRef, useCallback } from "react";
import Papa from "papaparse";
import readXlsxFile from "read-excel-file/browser";
import { detectColumnHeaders, parseImportRow, mergeImportedLeads, detectDuplicates } from "../utils/import";

function ImportModal({ isOpen, onClose, leads, users, currentUser, onImport }) {
  const [step, setStep] = useState(1);
  const [file, setFile] = useState(null);
  const [parsedLeads, setParsedLeads] = useState([]);
  const [duplicates, setDuplicates] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const fileInputRef = useRef(null);

  const processTabularData = useCallback((rows) => {
    if (!rows || rows.length < 2) { setError('Mindestens 1 Kopfzeile + 1 Datenzeile erforderlich'); return; }
    const headers = rows[0].map((h) => String(h || '').trim());
    const cols = detectColumnHeaders(headers);
    const parsedRows = [];
    const dups = [];
    for (let i = 1; i < rows.length; i++) {
      if (!rows[i] || rows[i].every((c) => !String(c || '').trim())) continue;
      const parsed = parseImportRow(rows[i], headers, cols, users, currentUser.email);
      parsedRows.push({ row: i + 1, lead: parsed });
    }
    const mergedLeads = mergeImportedLeads(parsedRows);
    const newLeads = [];
    mergedLeads.forEach((entry) => {
      const dup = detectDuplicates(entry.lead, leads);
      if (dup) dups.push({ row: entry.row, lead: entry.lead, duplicate: dup });
      else newLeads.push(entry);
    });
    setParsedLeads(newLeads);
    setDuplicates(dups);
    setStep(2);
  }, [currentUser.email, leads, users]);

  const handleFileChange = (e) => {
    const f = e.target.files?.[0];
    if (!f) return;
    setFile(f);
    setError('');
    const fileName = String(f.name || '').toLowerCase();
    if (fileName.endsWith('.xlsx') || fileName.endsWith('.xls')) {
      readXlsxFile(f).then((rows) => {
        processTabularData(rows.map(row => row.map(cell => cell != null ? cell : '')));
      }).catch((err) => { setError(`Excel-Fehler: ${err?.message}`); });
      return;
    }
    Papa.parse(f, { header: false, skipEmptyLines: true, delimiter: "", complete: (r) => processTabularData(r.data || []), error: (err) => setError(`Parse-Fehler: ${err.message}`) });
  };

  const handleImport = async () => {
    setLoading(true);
    try {
      await onImport(parsedLeads.map(p => p.lead));
      setStep(3);
      setTimeout(() => { resetModal(); onClose(); }, 2000);
    } catch (err) { setError(`Import-Fehler: ${err.message}`); }
    setLoading(false);
  };

  const resetModal = () => { setStep(1); setFile(null); setParsedLeads([]); setDuplicates([]); setError(''); if (fileInputRef.current) fileInputRef.current.value = ''; };

  if (!isOpen) return null;
  return (
    <div className="modal-backdrop" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal import-modal" onClick={e => e.stopPropagation()}>
        <div className="modal-header"><h2>Lead-Import</h2><button className="drawer-close-btn" onClick={onClose}>✕</button></div>
        {step === 1 && (
          <div className="import-step">
            <p className="step-desc">CSV- oder Excel-Datei hochladen</p>
            <div className="import-upload-zone" onClick={() => fileInputRef.current?.click()}>
              <span className="upload-icon">↑</span>
              <span className="upload-label">{file ? file.name : 'Datei auswählen'}</span>
              <span className="upload-hint">CSV oder Excel (.xlsx/.xls)</span>
            </div>
            <input ref={fileInputRef} type="file" accept=".csv,.xlsx,.xls" onChange={handleFileChange} style={{ display: 'none' }} />
            {error && <div className="import-error">{error}</div>}
          </div>
        )}
        {step === 2 && (
          <div className="import-step">
            <p className="step-desc">{parsedLeads.length} neue Leads, {duplicates.length} Duplikate</p>
            {duplicates.length > 0 && (
              <div className="import-warning">
                                {duplicates.length} Duplikat(e):
                <div className="dup-list">{duplicates.slice(0, 3).map((d, i) => (<div key={i} className="dup-item">Zeile {d.row}: {d.lead.person} ({d.lead.phone})</div>))}{duplicates.length > 3 && <div className="dup-item">+{duplicates.length - 3} weitere</div>}</div>
              </div>
            )}
            <div className="import-preview">
              <h4>Vorschau</h4>
              {parsedLeads.slice(0, 3).map((p, i) => (<div key={i} className="preview-item"><strong>{p.lead.person}</strong><br />{p.lead.company && <span>{p.lead.company} · </span>}{p.lead.phone && <span>{p.lead.phone}</span>}</div>))}
            </div>
            {error && <div className="import-error">{error}</div>}
          </div>
        )}
        {step === 3 && (
          <div className="import-step"><div className="import-success"><span className="success-icon">✓</span><h3>{parsedLeads.length} Leads importiert!</h3></div></div>
        )}
        <div className="modal-footer">
          {step === 1 && <button className="ghost-btn" onClick={onClose}>Abbrechen</button>}
          {step === 2 && (<><button className="ghost-btn" onClick={() => setStep(1)}>Zurück</button><button className="primary-btn" onClick={handleImport} disabled={loading || parsedLeads.length === 0}>{loading ? 'Importiere...' : `${parsedLeads.length} Leads importieren`}</button></>)}
          {step === 3 && <button className="primary-btn" onClick={onClose}>Schließen</button>}
        </div>
      </div>
    </div>
  );
}

export default ImportModal;
