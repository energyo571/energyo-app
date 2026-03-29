import React, { useState } from "react";
import { normalizeText, formatEuro } from "../utils/format";
import { authFetch } from "../utils/authFetch";
import { IconZap, IconFlame, IconRefresh, IconClipboard, IconDollar, IconStar, IconTrophy, IconAlertTriangle, IconInfo, IconLoader } from "./Icons";

function SavingsCalculator({ lead }) {
  const parseKwh = (value) => {
    const n = Number.parseFloat(String(value ?? "").replace(",", "."));
    return Number.isFinite(n) && n > 0 ? n : 0;
  };
  const meterConsumption = (meter) => (
    parseKwh(
      meter?.verbrauchKwh
      ?? meter?.verbrauch
      ?? meter?.consumption
      ?? meter?.jahresverbrauch
      ?? meter?.kwh
    )
  );

  const meterCosts = (meter) => {
    const n = Number.parseFloat(String(meter?.jahreskosten ?? "").replace(",", "."));
    return Number.isFinite(n) && n > 0 ? n : 0;
  };

  const stromMeters = Array.isArray(lead.energy?.strom) ? lead.energy.strom : [];
  const gasMeters = Array.isArray(lead.energy?.gas) ? lead.energy.gas : [];
  const stromFromMeters = stromMeters.reduce((sum, meter) => sum + meterConsumption(meter), 0);
  const gasFromMeters = gasMeters.reduce((sum, meter) => sum + meterConsumption(meter), 0);
  const stromCostsFromMeters = stromMeters.reduce((sum, meter) => sum + meterCosts(meter), 0);
  const gasCostsFromMeters = gasMeters.reduce((sum, meter) => sum + meterCosts(meter), 0);
  const fallbackConsumption = parseKwh(lead.consumption);
  const stromAnnualCosts = stromCostsFromMeters > 0 ? stromCostsFromMeters : (Number.parseFloat(lead.annualCosts || 0) || 0);
  const gasAnnualCosts = gasCostsFromMeters;
  const annualCosts = stromAnnualCosts + gasAnnualCosts;
  const normalizedEnergyType = normalizeText(lead.energyType || "");
  const hasStromMeters = stromMeters.length > 0;
  const hasGasMeters = gasMeters.length > 0;
  const inferFallbackCarrier = () => {
    if (hasStromMeters && !hasGasMeters) return "strom";
    if (hasGasMeters && !hasStromMeters) return "gas";
    if (normalizedEnergyType.includes("strom") && !normalizedEnergyType.includes("gas")) return "strom";
    if (normalizedEnergyType.includes("gas") && !normalizedEnergyType.includes("strom")) return "gas";
    if (!hasGasMeters) return "strom";
    if (!hasStromMeters) return "gas";
    return "";
  };

  const fallbackCarrier = inferFallbackCarrier();
  const stromKwh = stromFromMeters > 0 ? stromFromMeters : (fallbackConsumption > 0 && fallbackCarrier === "strom" ? fallbackConsumption : 0);
  const gasKwh = gasFromMeters > 0 ? gasFromMeters : (fallbackConsumption > 0 && fallbackCarrier === "gas" ? fallbackConsumption : 0);
  const totalKwh = stromKwh + gasKwh;

  const [stromCurrentPrice, setStromCurrentPrice] = useState("");
  const [gasCurrentPrice, setGasCurrentPrice] = useState("");
  const [stromOfferPrice, setStromOfferPrice] = useState("");
  const [gasOfferPrice, setGasOfferPrice] = useState("");
  const [stromOfferBasePrice, setStromOfferBasePrice] = useState("");
  const [gasOfferBasePrice, setGasOfferBasePrice] = useState("");
  const [referenceLoading, setReferenceLoading] = useState(false);
  const [referenceError, setReferenceError] = useState("");
  const [referenceMeta, setReferenceMeta] = useState({ strom: "", gas: "" });
  const [recommendations, setRecommendations] = useState({ strom: null, gas: null });
  const [selectedTile, setSelectedTile] = useState({ strom: "sweetspot", gas: "sweetspot" });

  const effectivePostalCode = String(lead.postalCode || lead.deliveryAddress?.plz || "").trim();
  const customerTypeNormalized = normalizeText(lead.customerType || "privat");

  const stromCurrentCt = parseFloat(stromCurrentPrice) || 0;
  const gasCurrentCt = parseFloat(gasCurrentPrice) || 0;
  const stromOfferCt = parseFloat(stromOfferPrice) || 0;
  const gasOfferCt = parseFloat(gasOfferPrice) || 0;
  const stromOfferGp = parseFloat(stromOfferBasePrice) || 0;
  const gasOfferGp = parseFloat(gasOfferBasePrice) || 0;
  const stromCurrentVariableAnnual = stromKwh > 0 && stromCurrentCt > 0 ? (stromCurrentCt / 100) * stromKwh : 0;
  const gasCurrentVariableAnnual = gasKwh > 0 && gasCurrentCt > 0 ? (gasCurrentCt / 100) * gasKwh : 0;
  const stromOfferVariableAnnual = stromKwh > 0 && stromOfferCt > 0 ? (stromOfferCt / 100) * stromKwh : 0;
  const gasOfferVariableAnnual = gasKwh > 0 && gasOfferCt > 0 ? (gasOfferCt / 100) * gasKwh : 0;
  const stromOfferAnnual = stromOfferVariableAnnual + stromOfferGp;
  const gasOfferAnnual = gasOfferVariableAnnual + gasOfferGp;
  const stromAnnualSavings = stromKwh > 0 && stromCurrentCt > 0 && stromOfferCt > 0 ? ((stromCurrentCt - stromOfferCt) / 100) * stromKwh : 0;
  const gasAnnualSavings = gasKwh > 0 && gasCurrentCt > 0 && gasOfferCt > 0 ? ((gasCurrentCt - gasOfferCt) / 100) * gasKwh : 0;

  const hasAnyOffer = (stromKwh > 0 && stromOfferCt > 0) || (gasKwh > 0 && gasOfferCt > 0);
  const hasCompleteOffer =
    (stromKwh <= 0 || stromOfferCt > 0) &&
    (gasKwh <= 0 || gasOfferCt > 0);
  const totalOfferAnnual = (stromKwh > 0 ? stromOfferAnnual : 0) + (gasKwh > 0 ? gasOfferAnnual : 0);
  const canEstimateTotal = annualCosts > 0 && hasCompleteOffer;
  const totalAnnualSavings = canEstimateTotal ? (annualCosts - totalOfferAnnual) : 0;
  const apOnlyAnnualSavings = stromAnnualSavings + gasAnnualSavings;
  const estimatedOfferAnnual = canEstimateTotal ? totalOfferAnnual : 0;
  const totalMonthlySavings = totalAnnualSavings / 12;
  const hasSavings = canEstimateTotal && totalAnnualSavings > 0;
  const hasNoAdvantage = canEstimateTotal && totalAnnualSavings <= 0;
  const hasAnyCurrentAp = (stromKwh > 0 && stromCurrentCt > 0) || (gasKwh > 0 && gasCurrentCt > 0);
  const missingGpCount = (stromKwh > 0 && stromOfferCt > 0 && stromOfferGp <= 0 ? 1 : 0) + (gasKwh > 0 && gasOfferCt > 0 && gasOfferGp <= 0 ? 1 : 0);

  const buildCopyText = () => {
    let text = "ENERGYO Einspar-Kalkulation\n";
    if (stromKwh > 0) text += `\nStrom Verbrauch: ${stromKwh.toLocaleString("de-DE")} kWh`;
    if (gasKwh > 0) text += `\nGas Verbrauch: ${gasKwh.toLocaleString("de-DE")} kWh`;
    if (stromAnnualCosts > 0) text += `\nJahreskosten Strom: ${formatEuro(stromAnnualCosts)}`;
    if (gasAnnualCosts > 0) text += `\nJahreskosten Gas: ${formatEuro(gasAnnualCosts)}`;
    if (stromKwh > 0) {
      text += `\n\nSTROM\nVerbrauch: ${stromKwh.toLocaleString("de-DE")} kWh\nENERGYO AP: ${stromOfferCt > 0 ? `${stromOfferCt.toFixed(2)} ct/kWh` : "offen"}`;
      if (stromOfferGp > 0) text += `\nENERGYO GP: ${formatEuro(stromOfferGp)}/Jahr`;
      if (stromCurrentCt > 0) text += `\nAktueller AP Kunde: ${stromCurrentCt.toFixed(2)} ct/kWh`;
      if (stromOfferVariableAnnual > 0) text += `\nENERGYO AP-Anteil/Jahr: ${formatEuro(stromOfferVariableAnnual)}`;
      if (stromOfferCt > 0) text += `\nENERGYO gesamt/Jahr: ${formatEuro(stromOfferAnnual)}`;
    }
    if (gasKwh > 0) {
      text += `\n\nGAS\nVerbrauch: ${gasKwh.toLocaleString("de-DE")} kWh\nENERGYO AP: ${gasOfferCt > 0 ? `${gasOfferCt.toFixed(2)} ct/kWh` : "offen"}`;
      if (gasOfferGp > 0) text += `\nENERGYO GP: ${formatEuro(gasOfferGp)}/Jahr`;
      if (gasCurrentCt > 0) text += `\nAktueller AP Kunde: ${gasCurrentCt.toFixed(2)} ct/kWh`;
      if (gasOfferVariableAnnual > 0) text += `\nENERGYO AP-Anteil/Jahr: ${formatEuro(gasOfferVariableAnnual)}`;
      if (gasOfferCt > 0) text += `\nENERGYO gesamt/Jahr: ${formatEuro(gasOfferAnnual)}`;
    }
    if (canEstimateTotal) {
      text += `\n\nENERGYO Jahreskosten: ${formatEuro(estimatedOfferAnnual)}`;
      text += `\nGESAMT ERSPARNIS\nJährlich: ${formatEuro(totalAnnualSavings)}\nMonatlich: ${formatEuro(totalMonthlySavings)}`;
    }
    return text;
  };

  const parseLocalizedNumber = (raw) => {
    const value = String(raw || "").trim();
    if (!value) return 0;
    let normalized = value.replace(/\s/g, "");
    if (normalized.includes(",") && normalized.includes(".")) {
      normalized = normalized.replace(/\./g, "").replace(",", ".");
    } else {
      normalized = normalized.replace(",", ".");
    }
    const n = Number.parseFloat(normalized);
    return Number.isFinite(n) ? n : 0;
  };

  const parseApGpFromText = (text) => {
    const source = String(text || "");
    const findByPattern = (patterns) => {
      for (const pattern of patterns) {
        const match = source.match(pattern);
        if (match?.[1]) {
          const number = parseLocalizedNumber(match[1]);
          if (number > 0) return number;
        }
      }
      return 0;
    };

    const ap = findByPattern([
      /(?:arbeitspreis|\bap\b)[^\d]{0,20}(\d{1,3}(?:[.,]\d{1,4})?)/i,
      /(\d{1,3}(?:[.,]\d{1,4})?)\s*ct\s*\/?\s*kwh/i,
    ]);

    const gp = findByPattern([
      /(?:grundpreis|\bgp\b)[^\d]{0,25}(\d{1,5}(?:[.,]\d{1,2})?)/i,
      /(\d{1,5}(?:[.,]\d{1,2})?)\s*(?:€|eur)[^\n]{0,18}(?:jahr|a)/i,
    ]);

    return { ap, gp };
  };

  // eslint-disable-next-line no-unused-vars
  const importApGpFromClipboard = async (sector) => {
    try {
      if (!navigator?.clipboard?.readText) {
        setReferenceError("Zwischenablage-Zugriff nicht verfügbar.");
        return;
      }
      const text = await navigator.clipboard.readText();
      const parsed = parseApGpFromText(text);
      if (parsed.ap <= 0 && parsed.gp <= 0) {
        setReferenceError("Kein AP/GP in der Zwischenablage erkannt.");
        return;
      }
      if (sector === "strom") {
        if (parsed.ap > 0) setStromOfferPrice(parsed.ap.toFixed(2));
        if (parsed.gp > 0) setStromOfferBasePrice(parsed.gp.toFixed(2));
      }
      if (sector === "gas") {
        if (parsed.ap > 0) setGasOfferPrice(parsed.ap.toFixed(2));
        if (parsed.gp > 0) setGasOfferBasePrice(parsed.gp.toFixed(2));
      }
      setReferenceError("");
    } catch (error) {
      setReferenceError("AP/GP konnte nicht aus der Zwischenablage importiert werden.");
    }
  };

  const loadReferenceForSector = async (sector, sectorConsumption) => {
    const apiBaseUrl = String(process.env.REACT_APP_API_BASE_URL || "").trim().replace(/\/+$/, "");
    const basePath = "/api/tariff-reference";
    const endpointCandidates = [
      `${apiBaseUrl}${basePath}`,
      `${apiBaseUrl}${basePath}.js`,
    ].filter((value, index, arr) => value && arr.indexOf(value) === index);

    let lastErrorMessage = "Referenztarife konnten nicht geladen werden.";

    for (const endpoint of endpointCandidates) {
      const response = await authFetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          postalCode: effectivePostalCode,
          sector,
          consumption: sectorConsumption,
          customerType: customerTypeNormalized === "privat" ? "Privat" : "Gewerbe",
        }),
      });

      const raw = await response.text();
      let payload = null;
      try {
        payload = raw ? JSON.parse(raw) : null;
      } catch (_) {
        const hint = (raw || "").trim().slice(0, 120);
        lastErrorMessage = `Tarif-API lieferte kein JSON (${response.status})${hint ? `: ${hint}` : ""}`;
        if (response.status === 404) continue;
        throw new Error(lastErrorMessage);
      }

      if (response.ok && payload?.ok) return payload;

      lastErrorMessage = payload?.error || `Tarif-API Fehler (${response.status})`;
      if (response.status === 404) continue;
      throw new Error(lastErrorMessage);
    }

    const localHint =
      typeof window !== "undefined" && /^(localhost|127\.0\.0\.1)$/.test(window.location.hostname)
        ? " Lokal: starte den Stack mit 'npm run start:full' (statt nur 'npm start')."
        : "";
    throw new Error(`${lastErrorMessage} (Endpoint nicht gefunden: /api/tariff-reference[.js]).${localHint}`);
  };

  const applyReferenceResult = (sector, payload) => {
    const recs = payload?.recommendations;
    if (recs) {
      setRecommendations(prev => ({ ...prev, [sector]: recs }));
      const sweetspot = recs.sweetspot;
      if (sweetspot) {
        applyTile(sector, sweetspot);
        setSelectedTile(prev => ({ ...prev, [sector]: "sweetspot" }));
      }
    } else {
      const ref = payload?.reference;
      if (ref) {
        applyTile(sector, ref);
      }
    }

    const serviceName = [payload?.reference?.resellerName, payload?.reference?.serviceName].filter(Boolean).join(" – ");
    if (serviceName) {
      setReferenceMeta((prev) => ({ ...prev, [sector]: serviceName }));
    }
  };

  const applyTile = (sector, tile) => {
    if (!tile) return;
    const ap = Number.parseFloat(tile.workingPriceCt || 0);
    const gp = Number.parseFloat(tile.basePriceEurYear || 0);
    if (sector === "strom") {
      if (ap > 0) setStromOfferPrice(ap.toFixed(2));
      if (gp > 0) setStromOfferBasePrice(gp.toFixed(2));
    }
    if (sector === "gas") {
      if (ap > 0) setGasOfferPrice(ap.toFixed(2));
      if (gp > 0) setGasOfferBasePrice(gp.toFixed(2));
    }
    const name = [tile.resellerName, tile.serviceName].filter(Boolean).join(" – ");
    if (name) setReferenceMeta(prev => ({ ...prev, [sector]: name }));
  };

  const handleTileSelect = (sector, tileKey) => {
    const recs = recommendations[sector];
    if (!recs) return;
    const tile = recs[tileKey];
    if (!tile) return;
    setSelectedTile(prev => ({ ...prev, [sector]: tileKey }));
    applyTile(sector, tile);
  };

  const loadReferenceTariffs = async () => {
    if (!effectivePostalCode) {
      setReferenceError("PLZ fehlt im Lead. Bitte zuerst PLZ pflegen.");
      return;
    }
    if (totalKwh <= 0) {
      setReferenceError("Verbrauch fehlt. Bitte zuerst Verbrauch erfassen.");
      return;
    }

    setReferenceLoading(true);
    setReferenceError("");

    try {
      const tasks = [];
      if (stromKwh > 0) tasks.push(loadReferenceForSector("strom", stromKwh).then((payload) => ({ sector: "strom", payload })));
      if (gasKwh > 0) tasks.push(loadReferenceForSector("gas", gasKwh).then((payload) => ({ sector: "gas", payload })));

      const results = await Promise.all(tasks);
      results.forEach(({ sector, payload }) => applyReferenceResult(sector, payload));
    } catch (error) {
      setReferenceError(error?.message || "Referenztarife konnten nicht geladen werden.");
    } finally {
      setReferenceLoading(false);
    }
  };

  const buildTariffKalkulatorUrl = () => {
    const kalkulatorBaseUrl = process.env.REACT_APP_TARIFKALKULATOR_URL || "https://tarifrechner.software/whitelabel/whitelabel/calculator?id=34ec3a70-d7d4-11ef-982f-df6ea12393d2";
    const preferredSector = stromKwh > 0 ? "strom" : (gasKwh > 0 ? "gas" : (normalizedEnergyType.includes("gas") ? "gas" : "strom"));
    const preferredConsumption = preferredSector === "strom"
      ? (stromKwh > 0 ? Math.round(stromKwh) : Math.round(totalKwh || fallbackConsumption || 0))
      : (gasKwh > 0 ? Math.round(gasKwh) : Math.round(totalKwh || fallbackConsumption || 0));

    const url = new URL(kalkulatorBaseUrl);
    url.searchParams.set("sector", preferredSector);
    url.searchParams.set("isCompanyService", customerTypeNormalized === "privat" ? "0" : "1");
    url.searchParams.set("plz", effectivePostalCode);
    url.searchParams.set("consumption", String(Math.max(preferredConsumption, 0)));
    url.searchParams.set("futureBaseSuppliers", "false");
    url.searchParams.set("ratesEnabled", "false");
    return url.toString();
  };

  // eslint-disable-next-line no-unused-vars
  const openTariffKalkulator = () => {
    if (!effectivePostalCode) {
      setReferenceError("PLZ fehlt im Lead. Bitte zuerst PLZ pflegen.");
      return;
    }
    if (totalKwh <= 0 && fallbackConsumption <= 0) {
      setReferenceError("Verbrauch fehlt. Bitte zuerst Verbrauch erfassen.");
      return;
    }
    window.open(buildTariffKalkulatorUrl(), "_blank", "noopener,noreferrer");
  };

  return (
    <div className="savings-calc">
      <div className="savings-header">
        <span><IconZap size={16} /></span>
        <div>
          <p className="savings-title">Einspar-Kalkulator</p>
          <p className="savings-sub">Live am Telefon ausrechnen — Abschluss sichern</p>
        </div>
      </div>

      <div className="savings-baseline">
        {stromKwh > 0 && <div className="savings-detail-item"><span>Strom Verbrauch</span><strong>{stromKwh.toLocaleString("de-DE")} kWh</strong></div>}
        {gasKwh > 0 && <div className="savings-detail-item"><span>Gas Verbrauch</span><strong>{gasKwh.toLocaleString("de-DE")} kWh</strong></div>}
        {stromKwh === 0 && gasKwh === 0 && <div className="savings-detail-item"><span>Verbrauch</span><strong>Nicht erfasst</strong></div>}
        {stromAnnualCosts > 0 && <div className="savings-detail-item"><span>Jahreskosten Strom</span><strong>{formatEuro(stromAnnualCosts)}</strong></div>}
        {gasAnnualCosts > 0 && <div className="savings-detail-item"><span>Jahreskosten Gas</span><strong>{formatEuro(gasAnnualCosts)}</strong></div>}
        {annualCosts <= 0 && <div className="savings-detail-item"><span>Jahreskosten</span><strong>Nicht erfasst</strong></div>}
      </div>

      <p className="savings-guidance">Ersparnis wird ueber die AP-Differenz berechnet. Der unbekannte Grundpreis bleibt als Konstante in den dokumentierten Jahreskosten des Kunden bestehen.</p>

      <div className="savings-actions">
        <button type="button" className="savings-copy-btn" onClick={loadReferenceTariffs} disabled={referenceLoading}>
          {referenceLoading ? <><IconLoader size={13} /> Tarife werden geladen...</> : <><IconRefresh size={13} /> Tarife laden</>}
        </button>
      </div>

      {referenceError && <div className="savings-warning neutral"><IconInfo size={13} /> {referenceError}</div>}

      {["strom", "gas"].map(sector => {
        const recs = recommendations[sector];
        const sectorKwh = sector === "strom" ? stromKwh : gasKwh;
        if (!recs || sectorKwh <= 0) return null;
        const tiles = [
          { key: "cheapest", label: "Günstigster Preis", icon: <IconDollar size={15} />, desc: "Maximale Ersparnis" },
          { key: "sweetspot", label: "Empfehlung", icon: <IconStar size={15} />, desc: "Bestes Verhältnis" },
          { key: "highestProvision", label: "Höchste Provision", icon: <IconTrophy size={15} />, desc: "Top-Provision" },
        ];
        return (
          <div key={sector} className="tariff-tiles-section">
            <p className="savings-section-title">{sector === "strom" ? <><IconZap size={14} /> Strom-Tarife</> : <><IconFlame size={14} /> Gas-Tarife</>}</p>
            <div className="tariff-tiles-row">
              {tiles.map(({ key, label, icon, desc }) => {
                const tile = recs[key];
                if (!tile) return null;
                const isActive = selectedTile[sector] === key;
                return (
                  <button
                    key={key}
                    type="button"
                    className={`tariff-tile${isActive ? " tariff-tile--active" : ""}`}
                    onClick={() => handleTileSelect(sector, key)}
                  >
                    <span className="tariff-tile-icon">{icon}</span>
                    <span className="tariff-tile-label">{label}</span>
                    <span className="tariff-tile-provider">{tile.resellerName}</span>
                    <span className="tariff-tile-name">{tile.serviceName}</span>
                    <span className="tariff-tile-ap">{tile.workingPriceCt.toFixed(2)} ct/kWh</span>
                    <span className="tariff-tile-gp">{tile.basePriceEurYear.toFixed(2)} €/Jahr GP</span>
                    <span className="tariff-tile-total">{formatEuro(tile.totalCostEurYear)}/Jahr</span>
                    {tile.provisionEuro > 0 && <span className="tariff-tile-prov">{formatEuro(tile.provisionEuro)} Prov.</span>}
                    {isActive && <span className="tariff-tile-check">✓ Ausgewählt</span>}
                  </button>
                );
              })}
            </div>
          </div>
        );
      })}

      {(referenceMeta.strom || referenceMeta.gas) && !recommendations.strom && !recommendations.gas && (
        <p className="savings-meter-hint">
          {referenceMeta.strom ? `Strom: ${referenceMeta.strom}` : ""}
          {referenceMeta.strom && referenceMeta.gas ? " · " : ""}
          {referenceMeta.gas ? `Gas: ${referenceMeta.gas}` : ""}
        </p>
      )}

      {stromKwh > 0 && (
        <div className="savings-section">
          <p className="savings-section-title">Strom</p>
          <div className="savings-inputs">
            <div className="savings-field">
              <label>ENERGYO AP (ct/kWh)</label>
              <input className="savings-input" type="number" step="0.01" value={stromOfferPrice} onChange={e => setStromOfferPrice(e.target.value)} placeholder="API / Tarifrechner" />
            </div>
            <div className="savings-field">
              <label>Aktueller AP Kunde</label>
              <input className="savings-input" type="number" step="0.01" value={stromCurrentPrice} onChange={e => setStromCurrentPrice(e.target.value)} placeholder="Optional aus Jahresabrechnung" />
            </div>
            <div className="savings-field">
              <label>ENERGYO GP (€/Jahr)</label>
              <input className="savings-input" type="number" step="0.01" value={stromOfferBasePrice} onChange={e => setStromOfferBasePrice(e.target.value)} placeholder="optional, z.B. 220.73" />
            </div>
          </div>
          <div className="savings-mini-grid">
            <div className="savings-detail-item"><span>ENERGYO AP-Anteil/Jahr</span><strong>{stromOfferVariableAnnual > 0 ? formatEuro(stromOfferVariableAnnual) : "Offen"}</strong></div>
            <div className="savings-detail-item"><span>Aktueller AP-Anteil/Jahr</span><strong>{stromCurrentCt > 0 ? formatEuro(stromCurrentVariableAnnual) : "Optional"}</strong></div>
            <div className="savings-detail-item"><span>ENERGYO gesamt/Jahr</span><strong>{stromOfferCt > 0 ? formatEuro(stromOfferAnnual) : "Offen"}</strong></div>
          </div>
        </div>
      )}

      {gasKwh > 0 && (
        <div className="savings-section">
          <p className="savings-section-title">Gas</p>
          <div className="savings-inputs">
            <div className="savings-field">
              <label>ENERGYO AP (ct/kWh)</label>
              <input className="savings-input" type="number" step="0.01" value={gasOfferPrice} onChange={e => setGasOfferPrice(e.target.value)} placeholder="API / Tarifrechner" />
            </div>
            <div className="savings-field">
              <label>Aktueller AP Kunde</label>
              <input className="savings-input" type="number" step="0.01" value={gasCurrentPrice} onChange={e => setGasCurrentPrice(e.target.value)} placeholder="Optional aus Jahresabrechnung" />
            </div>
            <div className="savings-field">
              <label>ENERGYO GP (€/Jahr)</label>
              <input className="savings-input" type="number" step="0.01" value={gasOfferBasePrice} onChange={e => setGasOfferBasePrice(e.target.value)} placeholder="optional, z.B. 180.50" />
            </div>
          </div>
          <div className="savings-mini-grid">
            <div className="savings-detail-item"><span>ENERGYO AP-Anteil/Jahr</span><strong>{gasOfferVariableAnnual > 0 ? formatEuro(gasOfferVariableAnnual) : "Offen"}</strong></div>
            <div className="savings-detail-item"><span>Aktueller AP-Anteil/Jahr</span><strong>{gasCurrentCt > 0 ? formatEuro(gasCurrentVariableAnnual) : "Optional"}</strong></div>
            <div className="savings-detail-item"><span>ENERGYO gesamt/Jahr</span><strong>{gasOfferCt > 0 ? formatEuro(gasOfferAnnual) : "Offen"}</strong></div>
          </div>
        </div>
      )}

      {stromKwh === 0 && gasKwh === 0 && (
        <div style={{ color: "#6b7280", fontSize: "0.82rem", padding: "12px 0", textAlign: "center" }}>
          <IconInfo size={13} /> Keine Verbrauchsdaten erfasst — Lead-Daten ergänzen
        </div>
      )}

      <p className="savings-meter-hint">
        Stromzähler: {stromMeters.filter((m) => !!m?.zählernummer).length} · Gaszähler: {gasMeters.filter((m) => !!m?.zählernummer).length}
      </p>

      {hasSavings && (
        <div className="savings-result positive">
          <div className="savings-result-main">
            <span className="savings-amount">{formatEuro(totalAnnualSavings)}</span>
            <span className="savings-period">Gesamt-Jahresersparnis</span>
          </div>
          <div className="savings-result-details">
            <div className="savings-detail-item"><span>Pro Monat</span><strong>{formatEuro(totalMonthlySavings)}</strong></div>
            <div className="savings-detail-item"><span>Kunde/Jahr</span><strong>{formatEuro(annualCosts)}</strong></div>
            <div className="savings-detail-item"><span>ENERGYO geschaetzt/Jahr</span><strong>{formatEuro(estimatedOfferAnnual)}</strong></div>
          </div>
          <div className="savings-actions">
            <button className="savings-copy-btn" onClick={() => navigator.clipboard.writeText(buildCopyText())}>
              <IconClipboard size={13} /> Kalkulation kopieren
            </button>
          </div>
        </div>
      )}

      {hasNoAdvantage && (
        <div className="savings-warning">
          <IconAlertTriangle size={13} /> Kein Vorteil: Die AP-Differenz fuehrt nicht zu niedrigeren geschaetzten Jahreskosten.
        </div>
      )}

      {annualCosts <= 0 && hasAnyOffer && (
        <div className="savings-warning neutral">
          <IconInfo size={13} /> Angebot erfasst, aber ohne dokumentierte Jahreskosten kann noch keine belastbare Ersparnis ausgewiesen werden.
        </div>
      )}

      {annualCosts > 0 && hasAnyOffer && !hasCompleteOffer && (
        <div className="savings-warning neutral">
          <IconInfo size={13} /> Fuer die Euro-Ersparnis wird pro vorhandenem Energieträger ein ENERGYO AP benötigt.
        </div>
      )}

      {hasAnyCurrentAp && (
        <div className="savings-warning neutral">
          <IconInfo size={13} /> AP-Vergleich Kunde vs. ENERGYO: {formatEuro(apOnlyAnnualSavings)} pro Jahr (nur Arbeitspreis-Anteil, ohne Grundpreis).
        </div>
      )}

      {missingGpCount > 0 && hasAnyOffer && (
        <div className="savings-warning neutral">
          <IconInfo size={13} /> Hinweis: Bei {missingGpCount} Energieträger(n) fehlt ENERGYO GP. Die Jahreskosten basieren dort nur auf AP-Anteil.
        </div>
      )}
    </div>
  );
}

export default SavingsCalculator;
