import React, { useState } from "react";
import { initialForm, EMPTY_METER, MAX_ATTACHMENT_SIZE_BYTES, buildAttachmentId } from "../constants";
import { formatEuro } from "../utils/format";

function NewLeadModal({ onClose, onSubmit, loading }) {
  const [form, setForm] = useState(initialForm);
  const auditThreshold = 10000;
  const parseFormNum = (v) => { const n = Number.parseFloat(String(v ?? "").replace(",", ".")); return Number.isFinite(n) && n > 0 ? n : 0; };
  const allFormMeters = [...(form.energy?.strom || []), ...(form.energy?.gas || [])];
  const annualCostsValue = allFormMeters.reduce((s, m) => s + parseFormNum(m.jahreskosten), 0) || (Number.parseFloat(form.annualCosts || 0) || 0);
  const isPrivatCustomer = form.customerType === "Privat";
  const isAuditEligibleByCost = annualCostsValue >= auditThreshold && !isPrivatCustomer;

  const handleChange = (e) => {
    const { name, value, type, checked } = e.target;
    setForm(prev => {
      const nextValue = type === "checkbox" ? checked : value;
      const next = { ...prev, [name]: nextValue };
      if (name === "annualCosts") {
        const nextCosts = Number.parseFloat(value || 0) || 0;
        if (nextCosts < auditThreshold) next.energyAuditEligible = false;
      }
      return next;
    });
  };

  const handleDeliveryAddressChange = (field, value) => {
    setForm(prev => ({ ...prev, deliveryAddress: { ...prev.deliveryAddress, [field]: value } }));
  };
  const handleInvoiceAddressChange = (field, value) => {
    setForm(prev => ({ ...prev, invoiceAddress: { ...prev.invoiceAddress, [field]: value } }));
  };
  const handleFile = (e) => {
    const selectedFiles = Array.from(e.target.files || []);
    if (selectedFiles.length === 0) return;
    const oversized = selectedFiles.filter((file) => file.size > MAX_ATTACHMENT_SIZE_BYTES);
    if (oversized.length > 0) alert(`${oversized[0].name} ist zu groß (max 10MB pro Datei)`);
    const validFiles = selectedFiles.filter((file) => file.size <= MAX_ATTACHMENT_SIZE_BYTES);
    if (validFiles.length > 0) {
      setForm((prev) => ({
        ...prev,
        attachments: [
          ...prev.attachments,
          ...validFiles.map((file) => ({ id: buildAttachmentId(), name: file.name, size: file.size, type: file.type, file, uploadedAt: new Date().toISOString() })),
        ],
      }));
    }
    e.target.value = "";
  };
  const handleSubmit = (e) => {
    e.preventDefault();
    if (!form.phone.trim() || !form.email.trim() || !form.deliveryAddress.plz.trim()) {
      return alert("Bitte Telefon, E-Mail und PLZ der Lieferadresse ausfüllen.");
    }
    const parseNum = (v) => { const n = Number.parseFloat(String(v ?? "").replace(",", ".")); return Number.isFinite(n) && n > 0 ? n : 0; };
    const allMeters = [...(form.energy?.strom || []), ...(form.energy?.gas || [])];
    const totalConsumption = allMeters.reduce((s, m) => s + parseNum(m.verbrauchKwh), 0);
    const totalAnnualCosts = allMeters.reduce((s, m) => s + parseNum(m.jahreskosten), 0);
    const formWithPostalCode = {
      ...form,
      postalCode: form.deliveryAddress.plz,
      consumption: totalConsumption > 0 ? String(totalConsumption) : form.consumption,
      annualCosts: totalAnnualCosts > 0 ? String(totalAnnualCosts) : form.annualCosts,
    };
    onSubmit(formWithPostalCode, () => { setForm(initialForm); onClose(); });
  };
  return (
    <div className="modal-backdrop" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal new-lead-modal">
        <div className="modal-header">
          <h2>Neuer Lead</h2>
          <button className="drawer-close-btn" onClick={onClose}>✕</button>
        </div>
        <form onSubmit={handleSubmit} className="modal-form">
          <div className="modal-form-grid">
            <div className="form-group"><label>Firma</label><input name="company" placeholder="Firmenname" value={form.company} onChange={handleChange} disabled={loading} /></div>
            <div className="form-group"><label>Anrede</label><select name="anrede" value={form.anrede} onChange={handleChange} disabled={loading}><option value="">–</option><option value="Herr">Herr</option><option value="Frau">Frau</option><option value="Divers">Divers</option></select></div>
            <div className="form-group"><label>Titel</label><select name="titel" value={form.titel} onChange={handleChange} disabled={loading}><option value="">–</option><option value="Dr.">Dr.</option><option value="Prof.">Prof.</option><option value="Prof. Dr.">Prof. Dr.</option></select></div>
            <div className="form-group"><label>Ansprechpartner *</label><input name="person" placeholder="Name" value={form.person} onChange={handleChange} disabled={loading} required /></div>
            <div className="form-group"><label>Geburtsdatum</label><input type="date" name="geburtsdatum" value={form.geburtsdatum} onChange={handleChange} disabled={loading} /></div>
            <div className="form-group"><label>Telefon *</label><input name="phone" type="tel" placeholder="+49..." value={form.phone} onChange={handleChange} disabled={loading} required /></div>
            <div className="form-group"><label>E-Mail *</label><input name="email" type="email" placeholder="name@firma.de" value={form.email} onChange={handleChange} disabled={loading} required /></div>
            <div className="form-group"><label>Kundentyp</label><select name="customerType" value={form.customerType} onChange={handleChange} disabled={loading}><option>Privat</option><option>Gewerbe</option><option>Großkunde</option></select></div>
            <div className="form-group"><label>Aktueller Anbieter</label><input name="currentProvider" placeholder="z.B. E.ON" value={form.currentProvider} onChange={handleChange} disabled={loading} /></div>
            <div className="form-group">
              <label>Vertragsende</label>
              <select name="contractEnd" value={form.contractEnd} onChange={handleChange} disabled={loading}>
                <option value="unknown">Unbekannt</option>
                <option value="">Datum eingeben...</option>
              </select>
              {form.contractEnd !== "unknown" && (<input type="date" name="contractEnd" value={form.contractEnd} onChange={handleChange} disabled={loading} style={{ marginTop: 6 }} />)}
            </div>

            <div className="form-group form-group-full address-section">
              <label className="section-label">Lieferadresse</label>
              <div className="address-grid">
                <div className="form-group"><label>Straße *</label><input type="text" placeholder="Hauptstraße" value={form.deliveryAddress.straße} onChange={(e) => handleDeliveryAddressChange("straße", e.target.value)} disabled={loading} /></div>
                <div className="form-group"><label>Hausnummer *</label><input type="text" placeholder="42" value={form.deliveryAddress.hausnummer} onChange={(e) => handleDeliveryAddressChange("hausnummer", e.target.value)} disabled={loading} /></div>
                <div className="form-group"><label>PLZ *</label><input type="text" placeholder="10115" value={form.deliveryAddress.plz} onChange={(e) => handleDeliveryAddressChange("plz", e.target.value)} disabled={loading} /></div>
                <div className="form-group"><label>Stadt *</label><input type="text" placeholder="Berlin" value={form.deliveryAddress.ort} onChange={(e) => handleDeliveryAddressChange("ort", e.target.value)} disabled={loading} /></div>
              </div>
            </div>

            <div className="form-group form-group-full">
              <label className="checkbox-label">
                <input type="checkbox" checked={form.hasAlternativeInvoiceAddress} onChange={(e) => setForm(p => ({ ...p, hasAlternativeInvoiceAddress: e.target.checked }))} disabled={loading} />
                Rechnungsadresse weicht von Lieferadresse ab
              </label>
            </div>

            {form.hasAlternativeInvoiceAddress && (
              <div className="form-group form-group-full address-section expanded">
                <label className="section-label">Rechnungsadresse</label>
                <div className="address-grid">
                  <div className="form-group"><label>Straße</label><input type="text" placeholder="Rechnungsstraße" value={form.invoiceAddress.straße} onChange={(e) => handleInvoiceAddressChange("straße", e.target.value)} disabled={loading} /></div>
                  <div className="form-group"><label>Hausnummer</label><input type="text" placeholder="42" value={form.invoiceAddress.hausnummer} onChange={(e) => handleInvoiceAddressChange("hausnummer", e.target.value)} disabled={loading} /></div>
                  <div className="form-group"><label>PLZ</label><input type="text" placeholder="10115" value={form.invoiceAddress.plz} onChange={(e) => handleInvoiceAddressChange("plz", e.target.value)} disabled={loading} /></div>
                  <div className="form-group"><label>Stadt</label><input type="text" placeholder="Berlin" value={form.invoiceAddress.stadt} onChange={(e) => handleInvoiceAddressChange("stadt", e.target.value)} disabled={loading} /></div>
                </div>
              </div>
            )}

            <div className="form-group form-group-full">
              <div className="energy-section-header">
                <label>Stromzähler</label>
                <button type="button" className="add-meter-btn" onClick={() => setForm(p => ({ ...p, energy: { ...p.energy, strom: [...p.energy.strom, { ...EMPTY_METER }] } }))} disabled={loading}>+ Zähler hinzufügen</button>
              </div>
              {form.energy.strom.map((meter, idx) => (
                <div key={idx} className="meter-card strom">
                  <div className="meter-card-header">
                    <span className="meter-index">Stromzähler {idx + 1}</span>
                    {form.energy.strom.length > 1 && (<button type="button" className="remove-meter-btn" onClick={() => setForm(p => ({ ...p, energy: { ...p.energy, strom: p.energy.strom.filter((_, i) => i !== idx) } }))} disabled={loading}>✕ Entfernen</button>)}
                  </div>
                  <div className="meter-grid">
                    <div className="form-group"><label>Zählernummer</label><input type="text" placeholder="z.B. 123456789" value={meter.zählernummer} onChange={(e) => setForm(p => ({ ...p, energy: { ...p.energy, strom: p.energy.strom.map((m, i) => i === idx ? { ...m, zählernummer: e.target.value } : m) } }))} disabled={loading} /></div>
                    <div className="form-group"><label>MALO-ID</label><input type="text" placeholder="Marktlokations-ID" value={meter.maloId} onChange={(e) => setForm(p => ({ ...p, energy: { ...p.energy, strom: p.energy.strom.map((m, i) => i === idx ? { ...m, maloId: e.target.value } : m) } }))} disabled={loading} /></div>
                    <div className="form-group"><label>Verbrauch (kWh) *</label><input type="number" placeholder="z.B. 25000" value={meter.verbrauchKwh} onChange={(e) => setForm(p => ({ ...p, energy: { ...p.energy, strom: p.energy.strom.map((m, i) => i === idx ? { ...m, verbrauchKwh: e.target.value } : m) } }))} disabled={loading} /></div>
                    <div className="form-group"><label>Jahreskosten (€)</label><input type="number" placeholder="z.B. 1800" value={meter.jahreskosten} onChange={(e) => setForm(p => ({ ...p, energy: { ...p.energy, strom: p.energy.strom.map((m, i) => i === idx ? { ...m, jahreskosten: e.target.value } : m) } }))} disabled={loading} /></div>
                  </div>
                  {idx > 0 && (
                    <div className="meter-address-block">
                      <p className="meter-address-hint">Abweichende Lieferadresse nur bei zusaetzlichem Zaehler ausfuellen. Leer lassen, wenn identisch zur Haupt-Lieferadresse.</p>
                      <div className="address-grid">
                        <div className="form-group"><label>Straße</label><input type="text" placeholder="Straße" value={meter.lieferStrasse || ""} onChange={(e) => setForm(p => ({ ...p, energy: { ...p.energy, strom: p.energy.strom.map((m, i) => i === idx ? { ...m, lieferStrasse: e.target.value } : m) } }))} disabled={loading} /></div>
                        <div className="form-group"><label>Hausnummer</label><input type="text" placeholder="Hausnummer" value={meter.lieferHausnummer || ""} onChange={(e) => setForm(p => ({ ...p, energy: { ...p.energy, strom: p.energy.strom.map((m, i) => i === idx ? { ...m, lieferHausnummer: e.target.value } : m) } }))} disabled={loading} /></div>
                        <div className="form-group"><label>PLZ</label><input type="text" placeholder="PLZ" value={meter.lieferPlz || ""} onChange={(e) => setForm(p => ({ ...p, energy: { ...p.energy, strom: p.energy.strom.map((m, i) => i === idx ? { ...m, lieferPlz: e.target.value } : m) } }))} disabled={loading} /></div>
                        <div className="form-group"><label>Stadt</label><input type="text" placeholder="Stadt" value={meter.lieferStadt || ""} onChange={(e) => setForm(p => ({ ...p, energy: { ...p.energy, strom: p.energy.strom.map((m, i) => i === idx ? { ...m, lieferStadt: e.target.value } : m) } }))} disabled={loading} /></div>
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>

            <div className="form-group form-group-full">
              <div className="energy-section-header">
                <label>Gaszähler</label>
                <button type="button" className="add-meter-btn" onClick={() => setForm(p => ({ ...p, energy: { ...p.energy, gas: [...p.energy.gas, { ...EMPTY_METER }] } }))} disabled={loading}>+ Zähler hinzufügen</button>
              </div>
              {form.energy.gas.map((meter, idx) => (
                <div key={idx} className="meter-card gas">
                  <div className="meter-card-header">
                    <span className="meter-index">Gaszähler {idx + 1}</span>
                    {form.energy.gas.length > 1 && (<button type="button" className="remove-meter-btn" onClick={() => setForm(p => ({ ...p, energy: { ...p.energy, gas: p.energy.gas.filter((_, i) => i !== idx) } }))} disabled={loading}>✕ Entfernen</button>)}
                  </div>
                  <div className="meter-grid">
                    <div className="form-group"><label>Zählernummer</label><input type="text" placeholder="z.B. 987654321" value={meter.zählernummer} onChange={(e) => setForm(p => ({ ...p, energy: { ...p.energy, gas: p.energy.gas.map((m, i) => i === idx ? { ...m, zählernummer: e.target.value } : m) } }))} disabled={loading} /></div>
                    <div className="form-group"><label>MALO-ID</label><input type="text" placeholder="Marktlokations-ID" value={meter.maloId} onChange={(e) => setForm(p => ({ ...p, energy: { ...p.energy, gas: p.energy.gas.map((m, i) => i === idx ? { ...m, maloId: e.target.value } : m) } }))} disabled={loading} /></div>
                    <div className="form-group"><label>Verbrauch (kWh) *</label><input type="number" placeholder="z.B. 15000" value={meter.verbrauchKwh} onChange={(e) => setForm(p => ({ ...p, energy: { ...p.energy, gas: p.energy.gas.map((m, i) => i === idx ? { ...m, verbrauchKwh: e.target.value } : m) } }))} disabled={loading} /></div>
                    <div className="form-group"><label>Jahreskosten (€)</label><input type="number" placeholder="z.B. 1200" value={meter.jahreskosten} onChange={(e) => setForm(p => ({ ...p, energy: { ...p.energy, gas: p.energy.gas.map((m, i) => i === idx ? { ...m, jahreskosten: e.target.value } : m) } }))} disabled={loading} /></div>
                  </div>
                  {idx > 0 && (
                    <div className="meter-address-block">
                      <p className="meter-address-hint">Abweichende Lieferadresse nur bei zusaetzlichem Zaehler ausfuellen. Leer lassen, wenn identisch zur Haupt-Lieferadresse.</p>
                      <div className="address-grid">
                        <div className="form-group"><label>Straße</label><input type="text" placeholder="Straße" value={meter.lieferStrasse || ""} onChange={(e) => setForm(p => ({ ...p, energy: { ...p.energy, gas: p.energy.gas.map((m, i) => i === idx ? { ...m, lieferStrasse: e.target.value } : m) } }))} disabled={loading} /></div>
                        <div className="form-group"><label>Hausnummer</label><input type="text" placeholder="Hausnummer" value={meter.lieferHausnummer || ""} onChange={(e) => setForm(p => ({ ...p, energy: { ...p.energy, gas: p.energy.gas.map((m, i) => i === idx ? { ...m, lieferHausnummer: e.target.value } : m) } }))} disabled={loading} /></div>
                        <div className="form-group"><label>PLZ</label><input type="text" placeholder="PLZ" value={meter.lieferPlz || ""} onChange={(e) => setForm(p => ({ ...p, energy: { ...p.energy, gas: p.energy.gas.map((m, i) => i === idx ? { ...m, lieferPlz: e.target.value } : m) } }))} disabled={loading} /></div>
                        <div className="form-group"><label>Stadt</label><input type="text" placeholder="Stadt" value={meter.lieferStadt || ""} onChange={(e) => setForm(p => ({ ...p, energy: { ...p.energy, gas: p.energy.gas.map((m, i) => i === idx ? { ...m, lieferStadt: e.target.value } : m) } }))} disabled={loading} /></div>
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
            <div className="form-group form-group-full">
              <label className="checkbox-label">
                <input type="checkbox" name="bundleInquiry" checked={form.bundleInquiry} onChange={handleChange} disabled={loading} />
                Bündelanfrage (mehrere Lieferstellen)
              </label>
            </div>
            <div className={`form-group form-group-full audit-gate ${isAuditEligibleByCost ? "active" : "locked"}`}>
              <label className="checkbox-label" title={isAuditEligibleByCost ? "Kriterium erfüllt" : isPrivatCustomer ? "Privatkunden ausgeschlossen" : "Ab 10.000 € Jahreskosten aktivierbar"}>
                <input type="checkbox" name="energyAuditEligible" checked={form.energyAuditEligible} onChange={handleChange} disabled={loading || !isAuditEligibleByCost} />
                Energieaudit berechtigt (ab 10.000 € Netto/Jahr, nur Gewerbe/Großkunde)
              </label>
              <small className="audit-gate-hint">
                {isPrivatCustomer ? "Privatkunden sind vom Energieaudit ausgeschlossen." : isAuditEligibleByCost ? "Kriterium erfüllt: Feld kann aktiviert werden." : `Noch gesperrt: Jahreskosten müssen mindestens ${formatEuro(auditThreshold)} betragen.`}
              </small>
            </div>
            <div className="form-group form-group-full">
              <div className="file-upload-zone">
                <label htmlFor="modal-file-input" className="file-upload-zone-label">Dateien anfügen (max 10MB)</label>
                <input id="modal-file-input" type="file" multiple onChange={handleFile} className="file-input" />
                {form.attachments.length > 0 && (
                  <div className="att-preview">
                    {form.attachments.map(a => (
                      <span key={a.id} className="att-chip">
                        {a.name}
                        <button type="button" onClick={() => setForm(p => ({ ...p, attachments: p.attachments.filter(x => x.id !== a.id) }))}>✕</button>
                      </span>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
          <div className="modal-footer">
            <button type="button" className="ghost-btn" onClick={onClose}>Abbrechen</button>
            <button type="submit" className="primary-btn-modal create-lead-submit" disabled={loading}>
              {loading ? "Wird gespeichert..." : "Lead anlegen"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default NewLeadModal;
