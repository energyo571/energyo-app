import { normalizeText } from './format';

// ─── CSV Import Helpers ───────────────────────────────────────────────────────
export const findHeaderIndex = (headers, predicates) => {
  const normalized = headers.map(normalizeText);
  return normalized.findIndex((h) => predicates.some((p) => p(h)));
};
export const parseConsumptionNumber = (value) => {
  const raw = String(value || "").trim();
  if (!raw) return "";
  return raw.replace(/[^\d]/g, "") || "";
};
export const looksLikeCompanyName = (value) => {
  const text = String(value || "").trim();
  if (!text) return false;
  const n = normalizeText(text);
  return n.startsWith("firma ") || /(\bgmbh\b|\bag\b|\bug\b|\bkg\b|\bohg\b|\bgbr\b|\be\.?k\b|\bltd\b|\bllc\b|\binc\b)/.test(n);
};
export const parseZaehlerInfo = (value) => {
  const text = String(value || "").trim();
  if (!text) return { zaehlernummer: "", maloId: "" };
  const maloMatch = text.match(/malo\s*[:-=]?\s*([a-z0-9-]+)/i);
  const zaehlerMatch = text.match(/zaehler|zahler|zaehlernummer|zahlernummer/i)
    ? text.match(/(?:zaehler|zahler|zaehlernummer|zahlernummer)\s*[:-=]?\s*([a-z0-9-/]+)/i)
    : text.match(/([a-z0-9-/]{6,})/i);
  return { zaehlernummer: zaehlerMatch?.[1] || text, maloId: maloMatch?.[1] || "" };
};
export const detectColumnHeaders = (headers) => ({
  name: findHeaderIndex(headers, [(h) => h.includes("name"), (h) => h.includes("kontakt"), (h) => h.includes("ansprechpartner"), (h) => h.includes("person")]),
  firma: findHeaderIndex(headers, [(h) => h.includes("firma"), (h) => h.includes("company"), (h) => h.includes("unternehmen")]),
  phone: findHeaderIndex(headers, [(h) => h.includes("telefon"), (h) => h.includes("phone"), (h) => h === "tel", (h) => h.includes("mobil")]),
  email: findHeaderIndex(headers, [(h) => h.includes("email"), (h) => h.includes("e-mail"), (h) => h.includes("mail")]),
  plz: findHeaderIndex(headers, [(h) => h.includes("plz"), (h) => h.includes("postleitzahl"), (h) => h.includes("zip")]),
  verbrauch: findHeaderIndex(headers, [(h) => h.includes("verbrauch"), (h) => h.includes("kwh"), (h) => h.includes("consumption")]),
  stromZaehler: findHeaderIndex(headers, [(h) => h.includes("strom") && (h.includes("zahler") || h.includes("zaehler"))]),
  stromMalo: findHeaderIndex(headers, [(h) => h.includes("strom") && h.includes("malo")]),
  gasZaehler: findHeaderIndex(headers, [(h) => h.includes("gas") && (h.includes("zahler") || h.includes("zaehler"))]),
  gasMalo: findHeaderIndex(headers, [(h) => h.includes("gas") && h.includes("malo")]),
  energyType: findHeaderIndex(headers, [(h) => h.includes("strom / gas"), (h) => h.includes("energietyp"), (h) => h.includes("energieart")]),
  zaehlerInfos: findHeaderIndex(headers, [(h) => h.includes("zahlerinfo"), (h) => h.includes("zaehlerinfo"), (h) => h.includes("zahlerinfos"), (h) => h.includes("zaehlerinfos")]),
  lieferanschrift: findHeaderIndex(headers, [(h) => h.includes("lieferanschrift"), (h) => h.includes("adresse"), (h) => h.includes("address")]),
  owner: findHeaderIndex(headers, [(h) => h.includes("owner"), (h) => h.includes("agent"), (h) => h.includes("zustandig"), (h) => h.includes("zuständig")]),
});
export const buildLeadMergeKey = (lead) => {
  const phone = String(lead.phone || "").replace(/\D/g, "");
  if (phone) return `phone:${phone}`;
  const email = normalizeText(lead.email || "");
  const person = normalizeText(lead.person || "");
  const company = normalizeText(lead.company || "");
  if (email && person) return `emailperson:${email}|${person}`;
  return `personcompany:${person}|${company}`;
};
export const parseImportRow = (row, headers, cols, allUsers, currentUserEmail) => {
  const getValue = (idx) => { if (idx < 0 || idx >= row.length) return ""; return String(row[idx] ?? "").trim(); };
  const extras = {};
  const rawName = getValue(cols.name);
  const rawFirma = getValue(cols.firma);
  const inferredCompany = !rawFirma && looksLikeCompanyName(rawName) ? rawName : "";
  const name = inferredCompany ? "" : (rawName || rawFirma || "Unbekannt");
  const firma = rawFirma || inferredCompany;
  const phone = getValue(cols.phone);
  const email = getValue(cols.email);
  const plz = getValue(cols.plz);
  const verbrauch = parseConsumptionNumber(getValue(cols.verbrauch));
  const ownerEmail = getValue(cols.owner);
  const lieferanschrift = getValue(cols.lieferanschrift);
  const energyType = normalizeText(getValue(cols.energyType));
  const energy = { strom: [], gas: [] };
  const addMeter = (target, zaehlernummer, maloId = "") => {
    if (!zaehlernummer) return;
    energy[target].push({ zählernummer: zaehlernummer, maloId: maloId || "", lieferanschrift: lieferanschrift || "" });
  };
  addMeter("strom", getValue(cols.stromZaehler), getValue(cols.stromMalo));
  addMeter("gas", getValue(cols.gasZaehler), getValue(cols.gasMalo));
  const genericZaehler = getValue(cols.zaehlerInfos);
  if (genericZaehler) {
    const parsed = parseZaehlerInfo(genericZaehler);
    if (energyType.includes("strom")) addMeter("strom", parsed.zaehlernummer, parsed.maloId);
    else if (energyType.includes("gas")) addMeter("gas", parsed.zaehlernummer, parsed.maloId);
    else extras["zaehlerInfos"] = genericZaehler;
  }
  const mappedIndexes = new Set(Object.values(cols).filter((i) => i >= 0));
  for (let i = 0; i < row.length; i++) {
    if (!mappedIndexes.has(i) && String(row[i] || "").trim()) {
      const key = headers[i] ? String(headers[i]).trim() : `Spalte ${i + 1}`;
      extras[key] = String(row[i]).trim();
    }
  }
  return {
    person: name, company: firma, phone, email, postalCode: plz, consumption: verbrauch,
    energy, status: "Neu",
    createdBy: { email: ownerEmail && allUsers.find((u) => u.email === ownerEmail) ? ownerEmail : currentUserEmail, timestamp: new Date().toISOString() },
    extras: Object.keys(extras).length > 0 ? extras : null,
  };
};
export const mergeImportedLeads = (rowsWithLead) => {
  const map = new Map();
  rowsWithLead.forEach(({ row, lead }) => {
    const key = buildLeadMergeKey(lead);
    if (!map.has(key)) {
      map.set(key, { rows: [row], lead: { ...lead, energy: { strom: [...lead.energy.strom], gas: [...lead.energy.gas] } } });
      return;
    }
    const current = map.get(key);
    current.rows.push(row);
    current.lead.energy.strom.push(...lead.energy.strom);
    current.lead.energy.gas.push(...lead.energy.gas);
    current.lead.extras = { ...(current.lead.extras || {}), ...(lead.extras || {}) };
  });
  return Array.from(map.values()).map((entry) => ({ row: entry.rows.join(", "), lead: entry.lead }));
};
export const detectDuplicates = (newLead, existingLeads) => {
  const phone = String(newLead.phone || "").replace(/\D/g, "");
  if (phone) {
    const byPhone = existingLeads.find((l) => String(l.phone || "").replace(/\D/g, "") === phone);
    if (byPhone) return byPhone;
  }
  if (newLead.email && newLead.person) {
    return existingLeads.find(
      (l) => normalizeText(l.email || "") === normalizeText(newLead.email) && normalizeText(l.person || "") === normalizeText(newLead.person)
    );
  }
  return null;
};
