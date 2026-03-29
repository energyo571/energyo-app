// ─── Energy Utilities ─────────────────────────────────────────────────────────
export const getEnergyMeters = (lead, energyType) => {
  const raw = lead?.energy?.[energyType];
  if (Array.isArray(raw)) return raw.filter((m) => m?.zählernummer);
  if (raw?.zählernummer) return [raw];
  return [];
};
export const getEnergyMeterCount = (lead, energyType) => getEnergyMeters(lead, energyType).length;
export const getTotalDeliveryPoints = (lead) => getEnergyMeterCount(lead, "strom") + getEnergyMeterCount(lead, "gas");
export const calculateUmsatzPotential = (consumption) => {
  if (!consumption) return 0;
  const kwh = parseInt(consumption);
  return kwh >= 50000 ? kwh * 0.01 : 150;
};
