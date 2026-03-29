// ─── Formatting Utilities ─────────────────────────────────────────────────────
export const formatEuro = (value) => '€' + Math.round(value).toLocaleString('de-DE');
export const formatWaPhone = (phone) => {
  if (!phone) return '';
  const digits = phone.replace(/\D/g, '');
  if (digits.startsWith('49')) return digits;
  if (digits.startsWith('0')) return '49' + digits.slice(1);
  return digits;
};
export const getClosingRateClass = (rate) => {
  if (rate < 15) return 'kpi-alert';
  if (rate < 25) return 'kpi-warning';
  return 'kpi-success';
};
export const normalizeText = (val) => String(val || "").toLowerCase().trim().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
export const formatEnergyVolume = (kwhRaw) => {
  const kwh = Number.parseInt(kwhRaw || 0, 10) || 0;
  if (kwh >= 1000000) return `${(kwh / 1000000).toFixed(2)} GWh`;
  if (kwh >= 1000) return `${(kwh / 1000).toFixed(1)} MWh`;
  return `${kwh.toLocaleString("de-DE")} kWh`;
};
export const formatMeterAddress = (meter) => {
  if (!meter) return "";
  const streetLine = [meter.lieferStrasse, meter.lieferHausnummer].filter(Boolean).join(" ");
  const cityLine = [meter.lieferPlz, meter.lieferStadt].filter(Boolean).join(" ");
  const structured = [streetLine, cityLine].filter(Boolean).join(", ");
  return structured || meter.lieferanschrift || "";
};
export const parseOptionalNumber = (value) => {
  const num = Number.parseFloat(String(value ?? "").replace(",", "."));
  return Number.isFinite(num) ? num : null;
};
export const isContractEndUnrealistic = (contractEnd) => {
  if (contractEnd === "unknown" || !contractEnd) return false;
  return new Date(contractEnd) < new Date();
};
