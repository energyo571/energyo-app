import React, { useMemo, useState, useEffect, useCallback, useRef } from "react";
import { onAuthStateChanged, signOut } from "firebase/auth";
import {
  collection, addDoc, onSnapshot, updateDoc, deleteDoc,
  doc, query, where, getDoc, setDoc, getDocs,
} from "firebase/firestore";
import { getDownloadURL, ref as storageRef, uploadBytes } from "firebase/storage";
import { auth, db, storage } from "./firebaseConfig";
import LoginPage from "./LoginPage";
import logo from "./logo.png";
import Papa from "papaparse";
import * as XLSX from "xlsx";
import "./App.css";

// ─── Konstanten ───────────────────────────────────────────────────────────────
const STATUS_OPTIONS = ["Neu", "Kontaktiert", "Angebot", "Nachfassen", "Gewonnen", "Verloren"];
const STATUS_META = {
  Neu:         { color: "#6b7280", bg: "#f3f4f6" },
  Kontaktiert: { color: "#1d4ed8", bg: "#dbeafe" },
  Angebot:     { color: "#c2410c", bg: "#ffedd5" },
  Nachfassen:  { color: "#b45309", bg: "#fef3c7" },
  Gewonnen:    { color: "#065f46", bg: "#d1fae5" },
  Verloren:    { color: "#991b1b", bg: "#fee2e2" },
};
const CALL_OUTCOMES = [
  "Kein Kontakt", "Mailbox hinterlassen", "Kurzes Gespräch",
  "Ausführliches Gespräch", "Termin vereinbart", "Angebot besprochen", "Abschluss",
];
const MAX_ATTACHMENT_SIZE_BYTES = 10 * 1024 * 1024;
const RENEWAL_RESURFACE_MONTHS = 6;
const buildAttachmentId = () => `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const getAttachmentHref = (attachment) => attachment?.url || attachment?.data || "";
const initialForm = {
  company: "", person: "", geburtsdatum: "", phone: "", email: "",
  consumption: "", annualCosts: "", contractEnd: "unknown",
  customerType: "Privat", postalCode: "", currentProvider: "",
  bundleInquiry: false, energyAuditEligible: false, followUp: "", attachments: [],
  energyType: "strom",
  energy: {
    strom: [{ zählernummer: "", maloId: "", lieferanschrift: "", kontaktanschrift: "" }],
    gas:   [{ zählernummer: "", maloId: "", lieferanschrift: "", kontaktanschrift: "" }],
  },
};

// ─── Hilfsfunktionen ──────────────────────────────────────────────────────────
const isOpenCancellationWindow = (contractEnd) => {
  if (contractEnd === "unknown" || !contractEnd) return false;
  const monthsUntilEnd = (new Date(contractEnd) - new Date()) / (1000 * 60 * 60 * 24 * 30);
  return monthsUntilEnd >= 0 && monthsUntilEnd <= 4;
};
const getRestLaufzeit = (contractEnd) => {
  if (contractEnd === "unknown" || !contractEnd) return null;
  return (new Date(contractEnd) - new Date()) / (1000 * 60 * 60 * 24 * 365);
};
const getMonthsUntil = (dateValue) => {
  if (!dateValue || dateValue === "unknown") return Number.POSITIVE_INFINITY;
  return (new Date(dateValue) - new Date()) / (1000 * 60 * 60 * 24 * 30);
};
const isWonLeadRenewalDue = (lead, monthsBefore = RENEWAL_RESURFACE_MONTHS) => {
  if (!lead || lead.status !== "Gewonnen") return false;
  const monthsUntilEnd = getMonthsUntil(lead.contractEnd);
  return monthsUntilEnd >= 0 && monthsUntilEnd <= monthsBefore;
};
const hasSupplyConfirmation = (lead) => !!lead?.wechselProcess?.steps?.liefertag?.completedAt;
const getWechselProgress = (lead) => {
  const steps = lead?.wechselProcess?.steps || {};
  const total = WECHSEL_STEPS.length;
  const completed = WECHSEL_STEPS.filter((step) => !!steps[step.id]?.completedAt).length;
  return { completed, total };
};
const calculatePriority = (lead) => {
  const consumption = lead.consumption ? parseInt(lead.consumption) : 0;
  const laufzeit = getRestLaufzeit(lead.contractEnd);
  const hasCancellationWindow = isOpenCancellationWindow(lead.contractEnd);
  if (hasCancellationWindow || consumption >= 50000) return "A";
  if ((consumption >= 20000 && consumption < 50000) || (laufzeit && laufzeit >= 1 && laufzeit <= 2)) return "B";
  return "C";
};
const calculateUmsatzPotential = (consumption) => {
  if (!consumption) return 0;
  const kwh = parseInt(consumption);
  return kwh >= 50000 ? kwh * 0.01 : 150;
};
const isContractEndUnrealistic = (contractEnd) => {
  if (contractEnd === "unknown" || !contractEnd) return false;
  return new Date(contractEnd) < new Date();
};
const isTodayDue = (d) => !!d && d === new Date().toISOString().split("T")[0];
const isOverdue = (d) => !!d && d < new Date().toISOString().split("T")[0];
const formatDate = (d) => {
  if (!d || d === "unknown") return "—";
  return new Date(d).toLocaleDateString("de-DE");
};
const formatDateTime = (d) => {
  if (!d) return "";
  const dt = new Date(d);
  return dt.toLocaleDateString("de-DE") + " " + dt.toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" });
};
const getHoursSince = (timestamp) => {
  if (!timestamp) return Number.POSITIVE_INFINITY;
  return (Date.now() - new Date(timestamp).getTime()) / (1000 * 60 * 60);
};
const formatEnergyVolume = (kwhRaw) => {
  const kwh = Number.parseInt(kwhRaw || 0, 10) || 0;
  if (kwh >= 1000000) return `${(kwh / 1000000).toFixed(2)} GWh`;
  if (kwh >= 1000) return `${(kwh / 1000).toFixed(1)} MWh`;
  return `${kwh.toLocaleString("de-DE")} kWh`;
};
const formatEuro = (value) => '€' + Math.round(value).toLocaleString('de-DE');
const formatWaPhone = (phone) => {
  if (!phone) return '';
  const digits = phone.replace(/\D/g, '');
  if (digits.startsWith('49')) return digits;
  if (digits.startsWith('0')) return '49' + digits.slice(1);
  return digits;
};
const getClosingRateClass = (rate) => {
  if (rate < 15) return 'kpi-alert';
  if (rate < 25) return 'kpi-warning';
  return 'kpi-success';
};
const USER_CALENDLY_LINKS_BY_EMAIL = {
  "y.oezdemir@energyo.de": "https://calendly.com/yasin-oezdemir-energyo",
  "o.balcioglu@energyo.de": "https://calendly.com/energyobalcioglu",
};
const normalizeCalendlyBaseUrl = (value) => {
  const raw = String(value || "").trim();
  if (!raw) return "";
  return /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
};
const resolveUserCalendlyBaseUrl = (currentUserEmail, ownerEmail) => {
  const emailCandidates = [currentUserEmail, ownerEmail]
    .map((email) => String(email || "").trim().toLowerCase())
    .filter(Boolean);

  for (const email of emailCandidates) {
    if (USER_CALENDLY_LINKS_BY_EMAIL[email]) return USER_CALENDLY_LINKS_BY_EMAIL[email];
  }

  return normalizeCalendlyBaseUrl(process.env.REACT_APP_CALENDLY_URL || "");
};
const getLeadOwnerEmail = (lead) => lead.ownerEmail || lead.createdBy?.email || "Nicht zugewiesen";
const getEnergyMeters = (lead, energyType) => {
  const raw = lead?.energy?.[energyType];
  if (Array.isArray(raw)) return raw.filter((m) => m?.zählernummer);
  if (raw?.zählernummer) return [raw];
  return [];
};
const getEnergyMeterCount = (lead, energyType) => getEnergyMeters(lead, energyType).length;
const getTotalDeliveryPoints = (lead) => getEnergyMeterCount(lead, "strom") + getEnergyMeterCount(lead, "gas");
const getLeadActivityCount = (lead) =>
  (lead.comments?.length || 0) + (lead.callLogs?.length || 0) + (lead.statusHistory?.length || 0);
const getLastActivityTimestamp = (lead) => {
  // createdAt is intentionally excluded: lead creation is not an engagement event.
  // Temperature only heats up through real actions (calls, comments, status changes).
  const timestamps = [];
  (lead.comments || []).forEach((item) => timestamps.push(item.timestamp));
  (lead.callLogs || []).forEach((item) => timestamps.push(item.timestamp));
  (lead.statusHistory || []).forEach((item) => timestamps.push(item.timestamp));
  return timestamps.filter(Boolean).sort((a, b) => new Date(b) - new Date(a))[0] || null;
};
const isLeadInactiveForHours = (lead, minHours = 48) => {
  if (!lead) return false;
  if (lead.status === "Gewonnen" || lead.status === "Verloren") return false;
  const lastActivity = getLastActivityTimestamp(lead);
  return getHoursSince(lastActivity) >= minHours;
};
const getLeadTemperature = (lead) => {
  if (lead.status === "Gewonnen") return { label: "Won", tone: "won", step: 3 };
  if (lead.status === "Verloren") return { label: "Lost", tone: "lost", step: 0 };
  if (isOverdue(lead.followUp)) return { label: "🚨 Kritisch", tone: "critical", step: 2 };
  // Bidirectional: purely activity-based — every lead can warm up through action
  const inactivityHours = getHoursSince(getLastActivityTimestamp(lead));
  if (inactivityHours < 24) return { label: "🔥 HOT", tone: "hot", step: 3 };
  if (inactivityHours < 72) return { label: "🌤 Warm", tone: "warm", step: 2 };
  return { label: "❄️ Cold", tone: "cold", step: 1 };
};
const getNextActionPlan = (lead) => {
  const hasPhone = !!lead.phone;
  const hasEmail = !!lead.email;

  if (lead.status === "Gewonnen") {
    return {
      label: "Abschluss sichern",
      tone: "success",
      channel: hasEmail ? "E-Mail" : "Telefon",
      when: "Heute",
      reason: "Onboarding und Referenzchance sichern",
    };
  }
  if (lead.status === "Verloren") {
    return {
      label: "Archiv prüfen",
      tone: "muted",
      channel: "CRM",
      when: "Diese Woche",
      reason: "Win/Loss-Learnings dokumentieren",
    };
  }
  if (isOverdue(lead.followUp)) {
    return {
      label: "Heute nachfassen",
      tone: "danger",
      channel: hasPhone ? "Telefon" : "E-Mail",
      when: "Innerhalb 2h",
      reason: "Follow-up ist überfällig",
    };
  }
  if (isTodayDue(lead.followUp)) {
    return {
      label: "Heute anrufen",
      tone: "today",
      channel: hasPhone ? "Telefon" : "E-Mail",
      when: "Heute vor 17:00",
      reason: "Fälliger Touchpoint im Plan",
    };
  }
  if (isOpenCancellationWindow(lead.contractEnd)) {
    return {
      label: "Angebot priorisieren",
      tone: "hot",
      channel: hasPhone ? "Telefon + E-Mail" : "E-Mail",
      when: "Heute",
      reason: "Kündigungsfenster ist offen",
    };
  }
  if ((lead.callLogs?.length || 0) === 0) {
    return {
      label: "Ersten Anruf machen",
      tone: "default",
      channel: hasPhone ? "Telefon" : "E-Mail",
      when: "Heute",
      reason: "Noch kein Erstkontakt dokumentiert",
    };
  }
  if (lead.status === "Angebot") {
    return {
      label: "Angebot nachhalten",
      tone: "warm",
      channel: hasPhone ? "Telefon" : "E-Mail",
      when: "In 24h",
      reason: "Entscheidung aktiv beschleunigen",
    };
  }
  return {
    label: "Nächsten Touchpoint planen",
    tone: "default",
    channel: hasEmail ? "E-Mail" : hasPhone ? "Telefon" : "CRM",
    when: "In 48h",
    reason: "Kontinuität im Deal aufrechterhalten",
  };
};
const getNextAction = (lead) => {
  const plan = getNextActionPlan(lead);
  return { label: plan.label, tone: plan.tone };
};
const addDaysToIso = (days) => {
  const dt = new Date();
  dt.setDate(dt.getDate() + days);
  return dt.toISOString().split("T")[0];
};
const getLeadSequencePlan = (lead) => {
  if (lead.status === "Gewonnen") {
    return {
      stage: "post-win",
      title: "Retention Sequenz",
      steps: [
        { id: "retention-1", title: "Onboarding-Call", channel: "Telefon", dueInDays: 0, purpose: "Sauberen Start und Ansprechpartner klären" },
        { id: "retention-2", title: "Mehrwert-Mail senden", channel: "E-Mail", dueInDays: 2, purpose: "Nutzung vertiefen und Vertrauen erhöhen" },
        { id: "retention-3", title: "Referenz anfragen", channel: "Telefon + E-Mail", dueInDays: 7, purpose: "Empfehlungen und Upsell vorbereiten" },
      ],
    };
  }

  const tone = getLeadTemperature(lead).tone;
  if (tone === "hot" || tone === "critical") {
    return {
      stage: "hot",
      title: "Hot Deal Sequenz",
      steps: [
        { id: "hot-1", title: "Entscheider direkt anrufen", channel: "Telefon", dueInDays: 0, purpose: "Momentum nutzen und Einwand sofort klären" },
        { id: "hot-2", title: "Angebot mit Deadline senden", channel: "E-Mail", dueInDays: 0, purpose: "Verbindlichkeit erzeugen" },
        { id: "hot-3", title: "Finales Follow-up", channel: "Telefon + WhatsApp", dueInDays: 1, purpose: "Entscheidung aktiv abschließen" },
      ],
    };
  }

  if (tone === "warm") {
    return {
      stage: "warm",
      title: "Warm Lead Sequenz",
      steps: [
        { id: "warm-1", title: "Bedarfs-Check", channel: "Telefon", dueInDays: 0, purpose: "Use Case und Pain Point präzisieren" },
        { id: "warm-2", title: "Case + Angebot senden", channel: "E-Mail", dueInDays: 1, purpose: "Mehrwert konkret machen" },
        { id: "warm-3", title: "Commitment-Termin sichern", channel: "Telefon", dueInDays: 3, purpose: "Deal in Angebotsphase schieben" },
      ],
    };
  }

  return {
    stage: "cold",
    title: "Cold Lead Sequenz",
    steps: [
      { id: "cold-1", title: "Erstkontakt aufbauen", channel: "E-Mail", dueInDays: 0, purpose: "Relevanz und Interesse testen" },
      { id: "cold-2", title: "Kurz-Call anbieten", channel: "Telefon", dueInDays: 2, purpose: "Persönlichen Kontakt initiieren" },
      { id: "cold-3", title: "Breakup oder Nurture", channel: "E-Mail", dueInDays: 5, purpose: "Pipeline bereinigen oder weiterentwickeln" },
    ],
  };
};
const clampScore = (value, min = 0, max = 100) => Math.min(max, Math.max(min, value));
const calculateLeadScore = (lead) => {
  if (lead.status === "Gewonnen") return 100;
  if (lead.status === "Verloren") return 5;

  let score = 30;
  const consumption = lead.consumption ? parseInt(lead.consumption, 10) : 0;
  const activityCount = getLeadActivityCount(lead);

  if (calculatePriority(lead) === "A") score += 15;
  else if (calculatePriority(lead) === "B") score += 8;
  else score += 2;

  if (isOpenCancellationWindow(lead.contractEnd)) score += 18;
  if (isTodayDue(lead.followUp)) score += 8;
  if (isOverdue(lead.followUp)) score -= 12;
  if (lead.appointmentDate) score += 16;

  if (lead.status === "Angebot") score += 12;
  if (lead.status === "Nachfassen") score += 8;
  if (lead.status === "Kontaktiert") score += 6;

  if (consumption >= 50000) score += 10;
  else if (consumption >= 20000) score += 5;

  if (lead.phone) score += 4;
  if (lead.email) score += 4;
  score += Math.min(12, activityCount * 2);

  return clampScore(Math.round(score));
};
const getLeadWinProbability = (lead) => {
  if (lead.status === "Gewonnen") return 100;
  if (lead.status === "Verloren") return 0;

  const score = calculateLeadScore(lead);
  let probability = Math.round(score * 0.82);

  if (lead.status === "Angebot") probability += 10;
  if (lead.appointmentDate) probability += 6;
  if (isOverdue(lead.followUp)) probability -= 8;

  return clampScore(probability, 1, 98);
};
const getLeadScoreTone = (probability) => {
  if (probability >= 70) return "high";
  if (probability >= 45) return "mid";
  return "low";
};
const getLeadReadiness = (lead) => {
  if (lead.status === "Gewonnen") {
    return {
      label: "🚦 Angebotsfaehig",
      tone: "green",
      reason: "Abschluss bereits erfolgt.",
      missing: [],
    };
  }
  if (lead.status === "Verloren") {
    return {
      label: "🚦 Daten fehlen",
      tone: "red",
      reason: "Lead ist als verloren markiert.",
      missing: [],
    };
  }

  const missing = [];
  const hasIdentity = !!(String(lead.company || "").trim() || String(lead.person || "").trim());
  const hasContactChannel = !!(String(lead.phone || "").trim() || String(lead.email || "").trim());
  const hasConsumption = Number.parseInt(String(lead.consumption || ""), 10) > 0;
  const hasContractEnd = !!lead.contractEnd && lead.contractEnd !== "unknown";
  const deliveryPoints = getTotalDeliveryPoints(lead);

  if (!hasIdentity) missing.push("Kontakt/Firma");
  if (!hasContactChannel) missing.push("Telefon oder E-Mail");
  if (!hasConsumption) missing.push("Verbrauch");
  if (!hasContractEnd) missing.push("Vertragsende");
  if (!String(lead.currentProvider || "").trim()) missing.push("Anbieter");
  if (!String(lead.postalCode || "").trim()) missing.push("PLZ");
  if (deliveryPoints === 0) missing.push("Zähler/Lieferstelle");

  if (missing.length > 0) {
    return {
      label: "🚦 Daten fehlen",
      tone: "red",
      reason: `Nicht angebotsfaehig: ${missing.slice(0, 2).join(", ")}`,
      missing,
    };
  }

  return {
    label: "🚦 Angebotsfaehig",
    tone: "green",
    reason: "Angebotsfaehig und bereit fuer Abschlussarbeit.",
    missing: [],
  };
};
const sortLeads = (items, sortMode) => {
  const sorted = [...items];
  if (sortMode === "potential") return sorted.sort((a, b) => calculateUmsatzPotential(b.consumption) - calculateUmsatzPotential(a.consumption));
  if (sortMode === "activity") return sorted.sort((a, b) => new Date(getLastActivityTimestamp(b) || 0) - new Date(getLastActivityTimestamp(a) || 0));
  if (sortMode === "followUp") {
    return sorted.sort((a, b) => {
      if (!a.followUp && !b.followUp) return 0;
      if (!a.followUp) return 1;
      if (!b.followUp) return -1;
      return new Date(a.followUp) - new Date(b.followUp);
    });
  }
  return sorted.sort((a, b) => {
    const order = { A: 0, B: 1, C: 2 };
    const diff = order[calculatePriority(a)] - order[calculatePriority(b)];
    if (diff !== 0) return diff;
    const ca = isOpenCancellationWindow(a.contractEnd);
    const cb = isOpenCancellationWindow(b.contractEnd);
    if (ca !== cb) return ca ? -1 : 1;
    return new Date(b.createdAt) - new Date(a.createdAt);
  });
};

// ─── CSV Import Helpers ───────────────────────────────────────────────────────
const normalizeText = (val) => String(val || "").toLowerCase().trim().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
const findHeaderIndex = (headers, predicates) => {
  const normalized = headers.map(normalizeText);
  return normalized.findIndex((h) => predicates.some((p) => p(h)));
};
const parseConsumptionNumber = (value) => {
  const raw = String(value || "").trim();
  if (!raw) return "";
  return raw.replace(/[^\d]/g, "") || "";
};
const looksLikeCompanyName = (value) => {
  const text = String(value || "").trim();
  if (!text) return false;
  const n = normalizeText(text);
  return n.startsWith("firma ") || /(\bgmbh\b|\bag\b|\bug\b|\bkg\b|\bohg\b|\bgbr\b|\be\.?k\b|\bltd\b|\bllc\b|\binc\b)/.test(n);
};
const parseZaehlerInfo = (value) => {
  const text = String(value || "").trim();
  if (!text) return { zaehlernummer: "", maloId: "" };
  const maloMatch = text.match(/malo\s*[:-=]?\s*([a-z0-9-]+)/i);
  const zaehlerMatch = text.match(/zaehler|zahler|zaehlernummer|zahlernummer/i)
    ? text.match(/(?:zaehler|zahler|zaehlernummer|zahlernummer)\s*[:-=]?\s*([a-z0-9-/]+)/i)
    : text.match(/([a-z0-9-/]{6,})/i);
  return { zaehlernummer: zaehlerMatch?.[1] || text, maloId: maloMatch?.[1] || "" };
};
const detectColumnHeaders = (headers) => ({
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
const buildLeadMergeKey = (lead) => {
  const phone = String(lead.phone || "").replace(/\D/g, "");
  if (phone) return `phone:${phone}`;
  const email = normalizeText(lead.email || "");
  const person = normalizeText(lead.person || "");
  const company = normalizeText(lead.company || "");
  if (email && person) return `emailperson:${email}|${person}`;
  return `personcompany:${person}|${company}`;
};
const parseImportRow = (row, headers, cols, allUsers, currentUserEmail) => {
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
    energy[target].push({ zählernummer: zaehlernummer, maloId: maloId || "", lieferanschrift: lieferanschrift || "", kontaktanschrift: "" });
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
const mergeImportedLeads = (rowsWithLead) => {
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
const detectDuplicates = (newLead, existingLeads) => {
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

// ─── UPDATED: KI-Assistent Panel (structured output + apply flow) ───────────
function AIAssistantPanel({ lead, user, userRole, onUpdateField, onUpdateStatus }) {
  const [mode, setMode] = useState(null); // 'prepare' | 'analyze' | 'nextSteps' | 'email'
  const [loading, setLoading] = useState(false);
  const [resultRaw, setResultRaw] = useState("");
  const [resultData, setResultData] = useState(null);
  const [error, setError] = useState(null);
  const [applyBusy, setApplyBusy] = useState(false);
  const [applyMsg, setApplyMsg] = useState("");

  const modes = [
    { id: "prepare", icon: "🎯", label: "Gesprächsvorbereitung" },
    { id: "analyze", icon: "🔍", label: "Lead analysieren" },
    { id: "nextSteps", icon: "📋", label: "Nächste Schritte" },
    { id: "email", icon: "✉️", label: "E-Mail-Entwurf" },
  ];

  const extractJsonFromText = (text) => {
    const raw = String(text || "").trim();
    if (!raw) return null;
    const withoutFence = raw
      .replace(/^```json\s*/i, "")
      .replace(/^```\s*/i, "")
      .replace(/```$/, "")
      .trim();

    try {
      return JSON.parse(withoutFence);
    } catch {
      const firstBrace = withoutFence.indexOf("{");
      const lastBrace = withoutFence.lastIndexOf("}");
      if (firstBrace >= 0 && lastBrace > firstBrace) {
        const candidate = withoutFence.slice(firstBrace, lastBrace + 1);
        try {
          return JSON.parse(candidate);
        } catch {
          return null;
        }
      }
      return null;
    }
  };

  const buildPrompt = (m) => {
    const leadScore = calculateLeadScore(lead);
    const closeProbability = getLeadWinProbability(lead);
    const nextAction = getNextActionPlan(lead);
    const recentCalls = (lead.callLogs || []).slice(-2).map((c) => `${c.outcome} (${formatDate(c.timestamp)})`).join(", ") || "keine";
    const recentNotes = (lead.comments || []).slice(-3).map((c) => c.text).join(" | ") || "keine";
    const standardObjections = [
      "Zu teuer",
      "Kein Interesse",
      "Ich entscheide später",
      "Bin vertraglich noch gebunden",
      "Schicken Sie erst mal Infos",
      "Ich habe schon einen Anbieter",
    ];

    const ctx = `
Lead-Informationen:
- Firma: ${lead.company || "—"}
- Ansprechpartner: ${lead.person || "—"}
- Status: ${lead.status}
- Priorität: ${calculatePriority(lead)}
- Lead-Score: ${leadScore}/100
- Abschlusswahrscheinlichkeit: ${closeProbability}%
- Verbrauch: ${lead.consumption ? lead.consumption + " kWh" : "unbekannt"}
- Jahreskosten: ${lead.annualCosts ? "€" + lead.annualCosts : "unbekannt"}
- Aktueller Anbieter: ${lead.currentProvider || "unbekannt"}
- Vertragsende: ${formatDate(lead.contractEnd)}
- Kündigungsfenster: ${isOpenCancellationWindow(lead.contractEnd) ? "JA – DRINGEND" : "nein"}
- Nachfassdatum: ${formatDate(lead.followUp)}
- Temperatur: ${getLeadTemperature(lead).label}
- Abschlussampel: ${getLeadReadiness(lead).label}
- Empfohlene nächste Aktion: ${nextAction.label}
- Kanal: ${nextAction.channel}
- Timing: ${nextAction.when}
- Grund: ${nextAction.reason}
- Letzte Aktivitäten: ${recentCalls}
- Notizen: ${recentNotes}
- Nutzerrolle: ${userRole || "agent"}
- Standard-Einwände VP: ${standardObjections.join(", ")}
    `.trim();

    const jsonRules = "Antworte ausschließlich als valides JSON (ohne Markdown, ohne Codeblock).";

    if (m === "prepare") {
      return `${ctx}\n\nAufgabe: Erstelle eine prägnante Gesprächsvorbereitung auf Deutsch. Gib konkrete Einwandbehandlung für die wichtigsten Standard-Einwände mit kurzen, schlagfertigen Antworten.\n${jsonRules}\nSchema:\n{\n  "title": "string",\n  "summary": "string",\n  "opening": "string",\n  "valuePoints": ["string"],\n  "objectionHandling": ["Einwand: ... | Antwort: ..."],\n  "closingQuestion": "string",\n  "reason": "string",\n  "suggestedUpdates": { "status": "Neu|Kontaktiert|Angebot|Nachfassen|Gewonnen|Verloren|", "followUp": "YYYY-MM-DD|" }\n}`;
    }
    if (m === "analyze") {
      return `${ctx}\n\nAufgabe: Analysiere den Lead kurz und konkret auf Deutsch und nenne die 2 wichtigsten Einwand-Antwort-Paare für den nächsten Kontakt.\n${jsonRules}\nSchema:\n{\n  "title": "string",\n  "summary": "string",\n  "priority": "low|mid|high",\n  "reason": "string",\n  "recommendedAction": {\n    "label": "string",\n    "channel": "Telefon|E-Mail|CRM|WhatsApp|Termin",\n    "when": "Heute|In 24h|In 48h|Diese Woche",\n    "reason": "string"\n  },\n  "objectionHandling": ["Einwand: ... | Antwort: ..."],\n  "suggestedUpdates": { "status": "Neu|Kontaktiert|Angebot|Nachfassen|Gewonnen|Verloren|", "followUp": "YYYY-MM-DD|" }\n}`;
    }
    if (m === "nextSteps") {
      return `${ctx}\n\nAufgabe: Gib 3–5 priorisierte nächste Schritte auf Deutsch. Ergänze am Ende eine kurze Einwandbehandlung für die 2 wahrscheinlichsten Standard-Einwände.\n${jsonRules}\nSchema:\n{\n  "title": "string",\n  "summary": "string",\n  "nextSteps": ["string"],\n  "recommendedAction": {\n    "label": "string",\n    "channel": "Telefon|E-Mail|CRM|WhatsApp|Termin",\n    "when": "Heute|In 24h|In 48h|Diese Woche",\n    "reason": "string"\n  },\n  "objectionHandling": ["Einwand: ... | Antwort: ..."],\n  "draftNote": "string",\n  "reason": "string",\n  "suggestedUpdates": { "status": "Neu|Kontaktiert|Angebot|Nachfassen|Gewonnen|Verloren|", "followUp": "YYYY-MM-DD|" }\n}`;
    }
    if (m === "email") {
      return `${ctx}\n\nAufgabe: Schreibe einen professionellen Follow-up-Mailentwurf auf Deutsch. Ergänze kurze Einwandbehandlung, falls der Empfänger zurückhaltend reagiert.\n${jsonRules}\nSchema:\n{\n  "title": "string",\n  "subject": "string",\n  "emailText": "string",\n  "tone": "warm|professional|urgent",\n  "objectionHandling": ["Einwand: ... | Antwort: ..."],\n  "reason": "string",\n  "suggestedUpdates": { "followUp": "YYYY-MM-DD|" }\n}`;
    }
    return ctx;
  };

  const runAI = async (m) => {
    setMode(m);
    setLoading(true);
    setResultRaw("");
    setResultData(null);
    setApplyMsg("");
    setError(null);
    try {
      const response = await fetch("/api/ai-proxy", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "claude-sonnet-4-5",
          max_tokens: 1000,
          messages: [{ role: "user", content: buildPrompt(m) }],
        }),
      });
      const data = await response.json();
      if (!response.ok) {
        setError(`KI-Fehler: ${data?.error || response.status}`);
      } else if (data.content?.[0]?.text) {
        const rawText = data.content[0].text;
        const parsed = extractJsonFromText(rawText);
        setResultRaw(rawText);
        if (parsed && typeof parsed === "object") {
          setResultData(parsed);
        } else {
          setError("KI-Antwort ist nicht als JSON parsebar. Bitte erneut versuchen.");
        }
      } else if (data.error) {
        setError(`KI-Fehler: ${data.error.message || data.error}`);
      } else {
        setError("Keine Antwort vom KI-System erhalten.");
      }
    } catch (e) {
      setError("Verbindungsfehler. Bitte erneut versuchen.");
    }
    setLoading(false);
  };

  const applySuggestion = async () => {
    if (!resultData || !onUpdateField || !onUpdateStatus) return;
    setApplyBusy(true);
    setApplyMsg("");

    try {
      const updates = resultData.suggestedUpdates || {};
      const nextComments = [...(lead.comments || [])];
      const nextAiLog = [...(lead.aiActionLog || [])];
      const now = new Date().toISOString();
      let appliedCount = 0;

      if (updates.followUp && /^\d{4}-\d{2}-\d{2}$/.test(updates.followUp)) {
        await onUpdateField(lead.id, "followUp", updates.followUp);
        appliedCount += 1;
      }

      if (updates.status && STATUS_OPTIONS.includes(updates.status) && updates.status !== lead.status) {
        await onUpdateStatus(lead.id, updates.status);
        appliedCount += 1;
      }

      const commentParts = [];
      if (resultData.summary) commentParts.push(`Zusammenfassung: ${resultData.summary}`);
      if (resultData.recommendedAction?.label) {
        commentParts.push(
          `Empfehlung: ${resultData.recommendedAction.label} (${resultData.recommendedAction.channel || "Kanal offen"}, ${resultData.recommendedAction.when || "Timing offen"})`
        );
      }
      if (resultData.subject) commentParts.push(`Mail-Betreff: ${resultData.subject}`);
      if (resultData.reason) commentParts.push(`Begründung: ${resultData.reason}`);

      if (commentParts.length > 0) {
        nextComments.push({
          timestamp: now,
          author: user?.email || "KI-System",
          text: `[KI Copilot:${mode}] ${commentParts.join(" | ")}`,
        });
        await onUpdateField(lead.id, "comments", nextComments);
        appliedCount += 1;
      }

      nextAiLog.push({
        id: `ai-apply-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        type: "ai-copilot-applied",
        mode,
        by: user?.email || "unbekannt",
        timestamp: now,
        suggestedUpdates: updates,
        title: resultData.title || modes.find((item) => item.id === mode)?.label || "KI Copilot",
      });
      await onUpdateField(lead.id, "aiActionLog", nextAiLog);

      setApplyMsg(appliedCount > 0 ? "Vorschlag wurde ins CRM übernommen." : "Kein direkt übernehmbares Feld erkannt.");
    } catch (e) {
      setApplyMsg(`Übernahme fehlgeschlagen (${e?.code || "unknown"}).`);
    }
    setApplyBusy(false);
  };

  const copyPayload = resultData ? JSON.stringify(resultData, null, 2) : resultRaw;

  return (
    <div className="ai-panel">
      <div className="ai-panel-header">
        <span className="ai-panel-icon" aria-hidden="true">
          <svg viewBox="0 0 24 24" role="img" focusable="false">
            <circle cx="12" cy="4" r="2" />
            <path d="M9.2 5.7h5.6v2H9.2z" />
            <rect x="4" y="8" width="16" height="11" rx="4" ry="4" />
            <circle cx="9" cy="13.4" r="1.4" />
            <circle cx="15" cy="13.4" r="1.4" />
            <path d="M8.4 17c.8.8 1.9 1.2 3.6 1.2s2.8-.4 3.6-1.2" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
          </svg>
        </span>
        <span className="ai-panel-title">KI-Assistent</span>
      </div>

      <div className="ai-mode-grid">
        {modes.map((m) => (
          <button
            key={m.id}
            className={`ai-mode-btn ${mode === m.id ? "active" : ""}`}
            onClick={() => runAI(m.id)}
            disabled={loading}
          >
            <span>{m.icon}</span>
            <span>{m.label}</span>
          </button>
        ))}
      </div>

      {loading && (
        <div className="ai-loading">
          <div className="ai-spinner" />
          <span>KI analysiert Lead...</span>
        </div>
      )}

      {error && <div className="ai-error">{error}</div>}
      {applyMsg && <div className="ai-apply-message">{applyMsg}</div>}

      {(resultData || resultRaw) && !loading && (
        <div className="ai-result">
          <div className="ai-result-header">
            <span>{modes.find((m) => m.id === mode)?.icon} {modes.find((m) => m.id === mode)?.label}</span>
            <button className="ai-copy-btn" onClick={() => navigator.clipboard.writeText(copyPayload)} title="Kopieren">📋</button>
          </div>

          {resultData ? (
            <div className="ai-result-structured">
              {resultData.title && <h4 className="ai-result-title">{resultData.title}</h4>}
              {resultData.summary && <p className="ai-result-line"><strong>Zusammenfassung:</strong> {resultData.summary}</p>}
              {resultData.priority && <p className="ai-result-line"><strong>Priorität:</strong> {resultData.priority}</p>}
              {resultData.reason && <p className="ai-result-line"><strong>Begründung:</strong> {resultData.reason}</p>}

              {Array.isArray(resultData.nextSteps) && resultData.nextSteps.length > 0 && (
                <div className="ai-result-list">
                  <strong>Nächste Schritte</strong>
                  <ul>{resultData.nextSteps.map((step, idx) => <li key={`${idx}-${step}`}>{step}</li>)}</ul>
                </div>
              )}

              {resultData.recommendedAction && (
                <div className="ai-result-card">
                  <strong>Nächste Aktion</strong>
                  <p><b>Label:</b> {resultData.recommendedAction.label || "—"}</p>
                  <p><b>Kanal:</b> {resultData.recommendedAction.channel || "—"}</p>
                  <p><b>Wann:</b> {resultData.recommendedAction.when || "—"}</p>
                  <p><b>Warum:</b> {resultData.recommendedAction.reason || "—"}</p>
                </div>
              )}

              {resultData.subject && <p className="ai-result-line"><strong>Betreff:</strong> {resultData.subject}</p>}
              {resultData.emailText && <div className="ai-result-text-block">{resultData.emailText}</div>}

              {resultData.opening && <p className="ai-result-line"><strong>Einstieg:</strong> {resultData.opening}</p>}
              {Array.isArray(resultData.valuePoints) && resultData.valuePoints.length > 0 && (
                <div className="ai-result-list">
                  <strong>Nutzenargumente</strong>
                  <ul>{resultData.valuePoints.map((point, idx) => <li key={`${idx}-${point}`}>{point}</li>)}</ul>
                </div>
              )}
              {Array.isArray(resultData.objectionHandling) && resultData.objectionHandling.length > 0 && (
                <div className="ai-result-list">
                  <strong>Einwandbehandlung</strong>
                  <ul>{resultData.objectionHandling.map((item, idx) => <li key={`${idx}-${item}`}>{item}</li>)}</ul>
                </div>
              )}

              <div className="ai-result-card">
                <strong>Vorgeschlagene CRM-Updates</strong>
                <pre>{JSON.stringify(resultData.suggestedUpdates || {}, null, 2)}</pre>
              </div>

              <div className="ai-result-actions">
                <button className="primary-btn-sm" onClick={applySuggestion} disabled={applyBusy || !onUpdateField || !onUpdateStatus}>
                  {applyBusy ? "Übernehme..." : "Vorschlag ins CRM übernehmen"}
                </button>
              </div>
            </div>
          ) : (
            <div className="ai-result-text">{resultRaw}</div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── NEW: Terminierungs-Modal mit Kalender-Sync ───────────────────────────────
function AppointmentModal({ lead, onClose, onSave, currentUserEmail }) {
  const [date, setDate] = useState(lead.appointmentDate || "");
  const [time, setTime] = useState(lead.appointmentTime || "10:00");
  const [title, setTitle] = useState(`Kundengespräch – ${lead.company || lead.person}`);
  const [notes, setNotes] = useState(lead.appointmentNotes || "");
  const [calendarSync, setCalendarSync] = useState(null); // null | 'google' | 'ical'
  const [syncConfirmed, setSyncConfirmed] = useState(false);
  const [saved, setSaved] = useState(false);

  const handleSave = async () => {
    await onSave({ appointmentDate: date, appointmentTime: time, appointmentNotes: notes, appointmentTitle: title });
    setSaved(true);
  };

  const buildGoogleCalendarUrl = () => {
    if (!date) return null;
    const start = `${date.replace(/-/g, "")}T${time.replace(":", "")}00`;
    const endHour = String(parseInt(time.split(":")[0]) + 1).padStart(2, "0");
    const end = `${date.replace(/-/g, "")}T${endHour}${time.split(":")[1]}00`;
    const params = new URLSearchParams({
      action: "TEMPLATE",
      text: title,
      dates: `${start}/${end}`,
      details: notes || `Lead: ${lead.person}, ${lead.company || ""}`,
    });
    return `https://calendar.google.com/calendar/render?${params}`;
  };

  const buildIcalContent = () => {
    if (!date) return null;
    const start = `${date.replace(/-/g, "")}T${time.replace(":", "")}00`;
    const endHour = String(parseInt(time.split(":")[0]) + 1).padStart(2, "0");
    const end = `${date.replace(/-/g, "")}T${endHour}${time.split(":")[1]}00`;
    return [
      "BEGIN:VCALENDAR",
      "VERSION:2.0",
      "BEGIN:VEVENT",
      `DTSTART:${start}`,
      `DTEND:${end}`,
      `SUMMARY:${title}`,
      `DESCRIPTION:${notes || ""}`,
      "END:VEVENT",
      "END:VCALENDAR",
    ].join("\r\n");
  };

  const buildCalendlyUrl = () => {
    const base = resolveUserCalendlyBaseUrl(currentUserEmail, getLeadOwnerEmail(lead));
    if (!base) return null;
    const params = new URLSearchParams();
    if (lead.person) params.set("name", lead.person);
    if (lead.email) params.set("email", lead.email);
    if (notes) params.set("a1", notes);
    if (date) params.set("a2", `${date}${time ? ` ${time}` : ""}`);
    if (lead.id) params.set("utm_content", lead.id);
    params.set("utm_campaign", "energyo-crm");
    const suffix = params.toString();
    if (!suffix) return base;
    return `${base}${base.includes("?") ? "&" : "?"}${suffix}`;
  };

  const handleCalendarExport = (type) => {
    if (!syncConfirmed) {
      setCalendarSync(type);
      return;
    }
    executeCalendarExport(type);
  };

  const executeCalendarExport = (type) => {
    if (type === "google") {
      const url = buildGoogleCalendarUrl();
      if (url) window.open(url, "_blank");
    } else if (type === "ical") {
      const content = buildIcalContent();
      if (content) {
        const blob = new Blob([content], { type: "text/calendar" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `termin-${lead.person || "lead"}.ics`;
        a.click();
        URL.revokeObjectURL(url);
      }
    } else if (type === "calendly") {
      const url = buildCalendlyUrl();
      if (!url) {
        alert("Calendly-Link fehlt. Bitte REACT_APP_CALENDLY_URL in .env setzen.");
      } else {
        window.open(url, "_blank", "noopener,noreferrer");
      }
    }
    setSyncConfirmed(false);
    setCalendarSync(null);
  };

  return (
    <div className="modal-backdrop" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal appointment-modal">
        <div className="modal-header">
          <h2>📅 Termin vereinbaren</h2>
          <button className="drawer-close-btn" onClick={onClose}>✕</button>
        </div>

        {saved ? (
          <div className="appointment-saved">
            <div className="appointment-saved-icon">✅</div>
            <h3>Termin gespeichert</h3>
            <p>{formatDate(date)} um {time} Uhr</p>
            <div className="calendar-export-section">
              <p className="cal-export-hint">Termin in Kalender exportieren:</p>
              <div className="cal-export-btns">
                <button className="cal-btn google" onClick={() => handleCalendarExport("google")}>
                  📅 Google Calendar
                </button>
                <button className="cal-btn ical" onClick={() => handleCalendarExport("ical")}>
                  📆 iCal / Outlook
                </button>
                <button className="cal-btn calendly" onClick={() => handleCalendarExport("calendly")}>
                  🔗 Calendly
                </button>
              </div>
            </div>
            {calendarSync && !syncConfirmed && (
              <div className="cal-confirm-box">
                <p>⚠️ Termin wirklich in <strong>{calendarSync === "google" ? "Google Calendar" : calendarSync === "ical" ? "iCal/Outlook" : "Calendly"}</strong> öffnen?</p>
                <p className="cal-confirm-sub">Dieser Termin wird nur für dich erstellt, nicht automatisch für den Kunden.</p>
                <div className="cal-confirm-actions">
                  <button className="ghost-btn" onClick={() => setCalendarSync(null)}>Abbrechen</button>
                  <button className="primary-btn-modal" onClick={() => { setSyncConfirmed(true); executeCalendarExport(calendarSync); }}>
                    Ja, eintragen
                  </button>
                </div>
              </div>
            )}
            <button className="ghost-btn" style={{ marginTop: 16 }} onClick={onClose}>Schließen</button>
          </div>
        ) : (
          <div className="appointment-form">
            <div className="form-group">
              <label>Titel</label>
              <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Gesprächstitel" />
            </div>
            <div className="appt-date-row">
              <div className="form-group">
                <label>Datum *</label>
                <input type="date" value={date} onChange={(e) => setDate(e.target.value)} min={new Date().toISOString().split("T")[0]} />
              </div>
              <div className="form-group">
                <label>Uhrzeit</label>
                <input type="time" value={time} onChange={(e) => setTime(e.target.value)} />
              </div>
            </div>
            <div className="form-group">
              <label>Notizen</label>
              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Gesprächsagenda, Themen..."
                rows={3}
              />
            </div>
            {lead.appointmentDate && (
              <div className="existing-appointment">
                <span>📅 Bestehender Termin: {formatDate(lead.appointmentDate)} {lead.appointmentTime && `um ${lead.appointmentTime} Uhr`}</span>
              </div>
            )}
            <div className="modal-footer">
              <button className="ghost-btn" onClick={onClose}>Abbrechen</button>
              <button className="primary-btn-modal" onClick={handleSave} disabled={!date}>
                Termin speichern
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── LeadLoadingOverlay ───────────────────────────────────────────────────────
function LeadLoadingOverlay() {
  return (
    <div className="lead-loading-overlay">
      <div className="lead-loading-content">
        <img src={logo} alt="ENERGYO Logo" className="lead-loading-logo" />
        <div className="lead-loading-bar-container"><div className="lead-loading-bar" /></div>
        <div className="lead-loading-text">Tarifoptimierung gestartet ...</div>
      </div>
    </div>
  );
}

// ─── InlineField ──────────────────────────────────────────────────────────────
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
          <span className="inline-edit-icon">✎</span>
        </div>
      )}
    </div>
  );
}

// ─── UPDATED: ActivityItem (editable comments) ────────────────────────────────
function ActivityItem({ item, onEdit, onDelete, canEdit }) {
  const [editing, setEditing] = useState(false);
  const [editText, setEditText] = useState(item.text || "");
  const [confirmDelete, setConfirmDelete] = useState(false);

  const cfg = {
    comment: { icon: "💬", cls: "act-comment" },
    call:    { icon: "📞", cls: "act-call" },
    status:  { icon: "🔄", cls: "act-status" },
  }[item.type] || { icon: "📝", cls: "act-comment" };

  const saveEdit = () => {
    if (editText.trim() && onEdit) onEdit(editText.trim());
    setEditing(false);
  };

  return (
    <div className={`activity-item ${cfg.cls}`}>
      <div className="activity-icon-wrap"><span>{cfg.icon}</span></div>
      <div className="activity-body">
        <div className="activity-meta">
          <span className="activity-author">{item.author || "System"}</span>
          <span className="activity-time">{formatDateTime(item.timestamp)}</span>
          {item.edited && <span className="activity-edited-badge">bearbeitet</span>}
          {canEdit && item.type === "comment" && (
            <div className="activity-actions">
              <button
                className="act-edit-btn"
                onClick={() => { setEditing(true); setEditText(item.text || ""); }}
                title="Bearbeiten"
              >✎</button>
              <button
                className="act-delete-btn"
                onClick={() => setConfirmDelete(true)}
                title="Löschen"
              >✕</button>
            </div>
          )}
        </div>

        {item.type === "comment" && (
          editing ? (
            <div className="activity-edit-area">
              <textarea
                value={editText}
                onChange={e => setEditText(e.target.value)}
                onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); saveEdit(); } if (e.key === "Escape") setEditing(false); }}
                rows={3}
                autoFocus
              />
              <div className="activity-edit-actions">
                <button className="primary-btn-sm" onClick={saveEdit}>Speichern</button>
                <button className="ghost-btn-sm" onClick={() => setEditing(false)}>Abbrechen</button>
              </div>
            </div>
          ) : (
            <p className="activity-text">{item.text}</p>
          )
        )}

        {item.type === "call" && (
          <div className="call-log-display">
            <span className="call-outcome-badge">{item.outcome}</span>
            {item.duration && <span className="call-duration"> · {item.duration} Min.</span>}
            {item.notes && <p className="activity-text">{item.notes}</p>}
          </div>
        )}
        {item.type === "status" && (
          <p className="activity-text">
            {item.from} <span className="status-arrow">→</span> <strong>{item.to}</strong>
          </p>
        )}
      </div>

      {confirmDelete && (
        <div className="activity-delete-confirm">
          <span>Kommentar löschen?</span>
          <button className="danger-btn-xs" onClick={() => { if (onDelete) onDelete(); setConfirmDelete(false); }}>Löschen</button>
          <button className="ghost-btn-xs" onClick={() => setConfirmDelete(false)}>Abbrechen</button>
        </div>
      )}
    </div>
  );
}

// ─── UPDATED: LeadDetailDrawer ────────────────────────────────────────────────
function LeadDetailDrawer({ lead, onClose, user, userRole, onUpdateField, onUpdateStatus, onDelete, onLogCall, onAddAttachment, onRemoveAttachment }) {
  const [drawerTab, setDrawerTab] = useState("activity");
  const [noteText, setNoteText] = useState("");
  const [showCallForm, setShowCallForm] = useState(false);
  const [callForm, setCallForm] = useState({ duration: "", outcome: CALL_OUTCOMES[0], notes: "" });
  const [saving, setSaving] = useState(false);
  const [previewAttachment, setPreviewAttachment] = useState(null);
  const [deleteConfirmId, setDeleteConfirmId] = useState(null);
  const [showAppointmentModal, setShowAppointmentModal] = useState(false);
  const [sequenceBusyId, setSequenceBusyId] = useState(null);
  const [sequenceMsg, setSequenceMsg] = useState("");
  const umsatz = calculateUmsatzPotential(lead.consumption);
  const hasCancellationWindow = isOpenCancellationWindow(lead.contractEnd);
  const isOverdueNow = isOverdue(lead.followUp);
  const isTodayNow = isTodayDue(lead.followUp);
  const leadScore = calculateLeadScore(lead);
  const closeProbability = getLeadWinProbability(lead);
  const nextAction = getNextActionPlan(lead);
  const sequencePlan = getLeadSequencePlan(lead);
  const scoreTone = getLeadScoreTone(closeProbability);
  const readiness = getLeadReadiness(lead);
  const temperature = getLeadTemperature(lead);
  const previewHref = getAttachmentHref(previewAttachment);

  const getSequenceOutcome = (stepId) => {
    const logs = lead.aiActionLog || [];
    const outcomeEntry = [...logs]
      .reverse()
      .find((entry) => entry?.type === "sequence-step-outcome" && entry?.stepId === stepId);
    return outcomeEntry?.outcome || null;
  };

  const timeline = useMemo(() => {
    const items = [];
    (lead.comments || []).forEach((c, idx) => items.push({ type: "comment", ...c, _idx: idx }));
    (lead.callLogs || []).forEach((c, idx) => items.push({ type: "call", ...c, _idx: idx }));
    (lead.statusHistory || []).forEach((c, idx) => items.push({ type: "status", ...c, _idx: idx }));
    return items.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
  }, [lead.comments, lead.callLogs, lead.statusHistory]);

  const submitNote = async () => {
    if (!noteText.trim()) return;
    setSaving(true);
    const newComment = { timestamp: new Date().toISOString(), text: noteText.trim(), author: user.email };
    await onUpdateField(lead.id, "comments", [...(lead.comments || []), newComment]);
    setNoteText("");
    setSaving(false);
  };

  const submitCall = async () => {
    setSaving(true);
    await onLogCall(lead.id, callForm);
    setCallForm({ duration: "", outcome: CALL_OUTCOMES[0], notes: "" });
    setShowCallForm(false);
    setSaving(false);
  };

  // UPDATED: edit comment by index
  const editComment = async (idx, newText) => {
    const updated = (lead.comments || []).map((c, i) =>
      i === idx ? { ...c, text: newText, edited: true, editedAt: new Date().toISOString(), editedBy: user.email } : c
    );
    await onUpdateField(lead.id, "comments", updated);
  };

  // UPDATED: delete comment by index
  const deleteComment = async (idx) => {
    const updated = (lead.comments || []).filter((_, i) => i !== idx);
    await onUpdateField(lead.id, "comments", updated);
  };

  const handleDelete = async () => {
    if (!window.confirm(`Lead "${lead.company || lead.person}" wirklich löschen?`)) return;
    await onDelete(lead.id);
    onClose();
  };

  const handleSaveAppointment = async (data) => {
    await onUpdateField(lead.id, "appointmentDate", data.appointmentDate);
    await onUpdateField(lead.id, "appointmentTime", data.appointmentTime);
    await onUpdateField(lead.id, "appointmentNotes", data.appointmentNotes);
    await onUpdateField(lead.id, "appointmentTitle", data.appointmentTitle);
  };

  const applySequenceStep = async (step) => {
    setSequenceBusyId(step.id);
    setSequenceMsg("");
    try {
      const now = new Date().toISOString();
      const followUpDate = addDaysToIso(step.dueInDays);
      const sequenceComment = {
        timestamp: now,
        author: user.email,
        text: `[Sequenz] ${step.title} | Kanal: ${step.channel} | Timing: ${step.dueInDays === 0 ? "Heute" : `+${step.dueInDays} Tage`} | Ziel: ${step.purpose}`,
      };
      const actionLogEntry = {
        id: `seq-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        type: "sequence-step-applied",
        stepId: step.id,
        stepTitle: step.title,
        channel: step.channel,
        dueInDays: step.dueInDays,
        plannedFollowUp: followUpDate,
        by: user.email,
        timestamp: now,
      };

      await onUpdateField(lead.id, "comments", [...(lead.comments || []), sequenceComment]);
      await onUpdateField(lead.id, "followUp", followUpDate);
      await onUpdateField(lead.id, "aiActionLog", [...(lead.aiActionLog || []), actionLogEntry]);
      setSequenceMsg(`Schritt "${step.title}" übernommen.`);
    } catch (e) {
      setSequenceMsg(`Übernahme fehlgeschlagen (${e?.code || "unknown"}).`);
    }
    setSequenceBusyId(null);
  };

  const trackSequenceOutcome = async (step, outcome) => {
    setSequenceBusyId(`${step.id}-${outcome}`);
    setSequenceMsg("");
    try {
      const now = new Date().toISOString();
      const outcomeEntry = {
        id: `seq-outcome-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        type: "sequence-step-outcome",
        stepId: step.id,
        stepTitle: step.title,
        outcome,
        by: user.email,
        timestamp: now,
      };
      await onUpdateField(lead.id, "aiActionLog", [...(lead.aiActionLog || []), outcomeEntry]);
      setSequenceMsg(`Outcome für "${step.title}" gespeichert: ${outcome}.`);
    } catch (e) {
      setSequenceMsg(`Outcome konnte nicht gespeichert werden (${e?.code || "unknown"}).`);
    }
    setSequenceBusyId(null);
  };

  const tabs = [
    { id: "activity",    label: "Aktivität" },
    { id: "details",     label: "Details" },
    { id: "calc",        label: "🧮 Kalkulator" },
    { id: "wechsel",     label: "🔄 Wechsel" },
    { id: "attachments", label: `Anhänge${lead.attachments?.length > 0 ? ` (${lead.attachments.length})` : ""}` },
    { id: "ai",          label: "KI Bot" },
  ];

  return (
    <div className="drawer-backdrop" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="drawer">
        {/* Header */}
        <div className="drawer-header">
          <div className="drawer-header-info">
            <h2 className="drawer-company">{lead.company || <em>Kein Firmenname</em>}</h2>
            <p className="drawer-person">
              {lead.person}{lead.customerType ? ` · ${lead.customerType}` : ""}{lead.postalCode ? ` · PLZ ${lead.postalCode}` : ""}
            </p>
            <div className="drawer-header-badges">
              {hasCancellationWindow && <span className="drawer-badge alert">🔔 Kündigungsfenster</span>}
              {isOverdueNow && <span className="drawer-badge danger">⏰ Überfällig</span>}
              {isTodayNow && <span className="drawer-badge today">📅 Heute fällig</span>}
              {lead.bundleInquiry && <span className="drawer-badge info">📦 Bündelanfrage</span>}
              {lead.energyAuditEligible && <span className="drawer-badge audit">🔍 Energieaudit berechtigt</span>}
              {lead.appointmentDate && (
                <span className="drawer-badge appointment" onClick={() => setShowAppointmentModal(true)} style={{ cursor: "pointer" }}>
                  📅 Termin: {formatDate(lead.appointmentDate)}{lead.appointmentTime ? ` ${lead.appointmentTime}` : ""}
                </span>
              )}
            </div>
          </div>
          <button className="drawer-close-btn" onClick={onClose} aria-label="Schließen">✕</button>
        </div>

        {/* Umsatz Banner */}
        <div className="drawer-umsatz-bar">
          <span className="drawer-umsatz-label">Umsatzpotenzial</span>
          <span className="drawer-umsatz-value">{formatEuro(umsatz)}</span>
          <span className="drawer-umsatz-hint">
            {lead.consumption && parseInt(lead.consumption) >= 50000
              ? `(${parseInt(lead.consumption).toLocaleString("de-DE")} kWh × 0,01 €)` : "(Pauschale)"}
          </span>
        </div>

        {/* Kontakt-Aktionen */}
        <div className="contact-bar">
          {lead.phone ? (
            <a className="contact-btn call" href={`tel:${lead.phone}`}>
              <span className="contact-btn-icon">📞</span>
              <span className="contact-btn-label">Anrufen</span>
              <span className="contact-btn-sub">{lead.phone}</span>
            </a>
          ) : (
            <div className="contact-btn call disabled">
              <span className="contact-btn-icon">📞</span>
              <span className="contact-btn-label">Anrufen</span>
              <span className="contact-btn-sub">Kein Tel.</span>
            </div>
          )}
          {lead.phone ? (
            <a className="contact-btn whatsapp" href={`https://wa.me/${formatWaPhone(lead.phone)}?text=${encodeURIComponent(`Hallo ${lead.person || ''},\n\nhier ist Ihr ENERGYO-Berater. Ich melde mich bezüglich Ihres Energievertrags. Haben Sie kurz Zeit?`)}`} target="_blank" rel="noreferrer">
              <span className="contact-btn-icon">💬</span>
              <span className="contact-btn-label">WhatsApp</span>
              <span className="contact-btn-sub">Nachricht</span>
            </a>
          ) : (
            <div className="contact-btn whatsapp disabled">
              <span className="contact-btn-icon">💬</span>
              <span className="contact-btn-label">WhatsApp</span>
              <span className="contact-btn-sub">Kein Tel.</span>
            </div>
          )}
          {lead.email ? (
            <a className="contact-btn email" href={`mailto:${lead.email}?subject=${encodeURIComponent('Ihr Energievertrag – ENERGYO')}&body=${encodeURIComponent(`Sehr geehrte/r ${lead.person || 'Kundin/Kunde'},\n\n`)}`}>
              <span className="contact-btn-icon">📧</span>
              <span className="contact-btn-label">E-Mail</span>
              <span className="contact-btn-sub">{lead.email}</span>
            </a>
          ) : (
            <div className="contact-btn email disabled">
              <span className="contact-btn-icon">📧</span>
              <span className="contact-btn-label">E-Mail</span>
              <span className="contact-btn-sub">Keine E-Mail</span>
            </div>
          )}
        </div>

        {/* Status Stepper */}
        <div className="drawer-status-stepper">
          {STATUS_OPTIONS.map(s => {
            const meta = STATUS_META[s];
            return (
              <button
                key={s}
                className={`status-step-btn ${lead.status === s ? "active" : ""}`}
                style={lead.status === s ? { background: meta.bg, color: meta.color, borderColor: meta.color } : {}}
                onClick={() => onUpdateStatus(lead.id, s)}
              >
                {s}
              </button>
            );
          })}
        </div>

        {/* Deal progress bar: Cold → Warm → Hot */}
        <div className="deal-progress-bar">
          {[{label:"❄️ Cold",tone:"cold",s:1},{label:"🌤 Warm",tone:"warm",s:2},{label:"🔥 Hot",tone:"hot",s:3}].map(({label,tone,s}) => (
            <div key={tone} className={`deal-progress-step ${temperature.step >= s ? tone : "inactive"} ${temperature.step === s ? "current" : ""}`}>
              <span>{label}</span>
            </div>
          ))}
          <div className="deal-progress-hint">{temperature.step < 3 ? (temperature.step === 1 ? "Aktivität auslösen → wird Warm" : "Kontakt intensivieren → wird Hot") : "Jetzt closing starten!"}</div>
        </div>

        <div className="drawer-signal-grid">
          <div className="drawer-signal-card">
            <span>Owner</span>
            <strong>{getLeadOwnerEmail(lead)}</strong>
          </div>
          <div className={`drawer-signal-card readiness-card ${readiness.tone}`}>
            <span>Abschlussampel</span>
            <strong>{readiness.label}</strong>
            <small>{readiness.reason}</small>
          </div>
          <div className={`drawer-signal-card lead-score-card ${scoreTone}`}>
            <span>Deal Score</span>
            <strong>{leadScore}/100</strong>
          </div>
          <div className={`drawer-signal-card lead-score-card ${scoreTone}`}>
            <span>Abschlusschance</span>
            <strong>{closeProbability}%</strong>
          </div>
          <div className="drawer-signal-card">
            <span>Letzte Aktivität</span>
            <strong>{formatDateTime(getLastActivityTimestamp(lead)) || "Noch keine"}</strong>
          </div>
          <div className="drawer-signal-card">
            <span>Nächste Aktion</span>
            <strong>{nextAction.label}</strong>
          </div>
          {lead.appointmentDate && (
            <div className="drawer-signal-card appointment-signal" onClick={() => setShowAppointmentModal(true)} style={{ cursor: "pointer" }}>
              <span>Nächster Termin</span>
              <strong>{formatDate(lead.appointmentDate)}{lead.appointmentTime ? ` · ${lead.appointmentTime}` : ""}</strong>
            </div>
          )}
        </div>

        <div className="quick-action-row">
          <button className="quick-action-btn" onClick={() => onUpdateField(lead.id, "followUp", new Date().toISOString().split("T")[0])}>Heute setzen</button>
          <button className="quick-action-btn" onClick={() => {
            const tomorrow = new Date();
            tomorrow.setDate(tomorrow.getDate() + 1);
            onUpdateField(lead.id, "followUp", tomorrow.toISOString().split("T")[0]);
          }}>Morgen nachfassen</button>
          <button className="quick-action-btn" onClick={() => onUpdateStatus(lead.id, "Angebot")}>Zu Angebot ziehen</button>
          <button className="quick-action-btn appointment" onClick={() => setShowAppointmentModal(true)}>📅 Termin planen</button>
        </div>

        <div className="next-action-playbook">
          <div className="next-action-playbook-head">
            <span>Next Best Action</span>
            <strong className={`next-action-pill ${nextAction.tone}`}>{nextAction.label}</strong>
          </div>
          <div className="next-action-playbook-grid">
            <div>
              <span>Kanal</span>
              <strong>{nextAction.channel}</strong>
            </div>
            <div>
              <span>Timing</span>
              <strong>{nextAction.when}</strong>
            </div>
            <div>
              <span>Grund</span>
              <strong>{nextAction.reason}</strong>
            </div>
          </div>

          <div className="sequence-playbook-head">
            <span>{sequencePlan.title}</span>
          </div>
          <div className="sequence-playbook-list">
            {sequencePlan.steps.map((step, idx) => {
              const outcome = getSequenceOutcome(step.id);
              return (
                <div key={step.id} className="sequence-step-card">
                  <div className="sequence-step-main">
                    <strong>{idx + 1}. {step.title}</strong>
                    <p>{step.purpose}</p>
                    <div className="sequence-step-meta">
                      <span>Kanal: {step.channel}</span>
                      <span>Timing: {step.dueInDays === 0 ? "Heute" : `+${step.dueInDays} Tage`}</span>
                      {outcome && <span className={`sequence-outcome-chip ${outcome === "erfolg" ? "success" : "neutral"}`}>Outcome: {outcome}</span>}
                    </div>
                  </div>
                  <div className="sequence-step-actions">
                    <button
                      type="button"
                      className="sequence-btn apply"
                      onClick={() => applySequenceStep(step)}
                      disabled={!!sequenceBusyId}
                    >
                      {sequenceBusyId === step.id ? "..." : "Übernehmen"}
                    </button>
                    <button
                      type="button"
                      className="sequence-btn success"
                      onClick={() => trackSequenceOutcome(step, "erfolg")}
                      disabled={!!sequenceBusyId}
                    >
                      Erfolg
                    </button>
                    <button
                      type="button"
                      className="sequence-btn neutral"
                      onClick={() => trackSequenceOutcome(step, "kein-kontakt")}
                      disabled={!!sequenceBusyId}
                    >
                      Kein Kontakt
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
          {sequenceMsg && <p className="sequence-msg">{sequenceMsg}</p>}
        </div>

        {/* Tabs */}
        <div className="drawer-tabs">
          {tabs.map(t => (
            <button
              key={t.id}
              className={`drawer-tab-btn ${t.id === "ai" ? "ai-tab" : ""} ${drawerTab === t.id ? "active" : ""}`}
              onClick={() => setDrawerTab(t.id)}
            >
              {t.id === "ai" ? (
                <span className="ai-tab-label">
                  <span className="ai-tab-badge" aria-hidden="true">
                    <svg viewBox="0 0 24 24" role="img" focusable="false">
                      <circle cx="12" cy="4" r="2" />
                      <path d="M9.2 5.7h5.6v2H9.2z" />
                      <rect x="4" y="8" width="16" height="11" rx="4" ry="4" />
                      <circle cx="9" cy="13.4" r="1.4" />
                      <circle cx="15" cy="13.4" r="1.4" />
                      <path d="M8.4 17c.8.8 1.9 1.2 3.6 1.2s2.8-.4 3.6-1.2" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
                    </svg>
                  </span>
                  <span>{t.label}</span>
                </span>
              ) : t.label}
            </button>
          ))}
        </div>

        {/* Tab: Aktivität */}
        {drawerTab === "activity" && (
          <div className="drawer-tab-content">
            <div className="activity-compose-bar">
              <button
                className={`compose-action-btn ${showCallForm ? "active" : ""}`}
                onClick={() => setShowCallForm(v => !v)}
              >
                📞 Anruf protokollieren
              </button>
            </div>

            {showCallForm && (
              <div className="call-form">
                <div className="call-form-row">
                  <select value={callForm.outcome} onChange={e => setCallForm(p => ({ ...p, outcome: e.target.value }))}>
                    {CALL_OUTCOMES.map(o => <option key={o}>{o}</option>)}
                  </select>
                  <input
                    type="number" min="0" max="999" placeholder="Dauer (Min.)"
                    value={callForm.duration}
                    onChange={e => setCallForm(p => ({ ...p, duration: e.target.value }))}
                  />
                </div>
                <textarea
                  placeholder="Gesprächsnotiz..."
                  value={callForm.notes}
                  onChange={e => setCallForm(p => ({ ...p, notes: e.target.value }))}
                  rows={2}
                />
                <div className="call-form-actions">
                  <button className="primary-btn-sm" onClick={submitCall} disabled={saving}>
                    {saving ? "..." : "Anruf speichern"}
                  </button>
                  <button className="ghost-btn-sm" onClick={() => setShowCallForm(false)}>Abbrechen</button>
                </div>
              </div>
            )}

            <div className="note-compose">
              <textarea
                placeholder="Notiz hinzufügen... (Enter zum Speichern)"
                value={noteText}
                onChange={e => setNoteText(e.target.value)}
                onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); submitNote(); } }}
                rows={2}
              />
              <button className="primary-btn-sm" onClick={submitNote} disabled={saving || !noteText.trim()}>
                {saving ? "..." : "Speichern"}
              </button>
            </div>

            <div className="activity-timeline">
              {timeline.length === 0 ? (
                <p className="empty-timeline">Noch keine Aktivitäten. Füge eine Notiz hinzu oder protokolliere einen Anruf.</p>
              ) : (
                timeline.map((item, idx) => (
                  <ActivityItem
                    key={idx}
                    item={item}
                    canEdit={item.type === "comment" && (item.author === user.email || userRole === "admin")}
                    onEdit={item.type === "comment" ? (newText) => editComment(item._idx, newText) : null}
                    onDelete={item.type === "comment" ? () => deleteComment(item._idx) : null}
                  />
                ))
              )}
            </div>
          </div>
        )}

        {/* Tab: Details */}
        {drawerTab === "details" && (
          <div className="drawer-tab-content">
            <div className="details-grid">
              <InlineField label="Firma" value={lead.company} onSave={v => onUpdateField(lead.id, "company", v)} />
              <InlineField label="Ansprechpartner" value={lead.person} onSave={v => onUpdateField(lead.id, "person", v)} />
              <InlineField label="Telefon" value={lead.phone} onSave={v => onUpdateField(lead.id, "phone", v)} type="tel" />
              <InlineField label="E-Mail" value={lead.email} onSave={v => onUpdateField(lead.id, "email", v)} type="email" />
              <InlineField label="PLZ" value={lead.postalCode} onSave={v => onUpdateField(lead.id, "postalCode", v)} />
              <InlineField label="Kundentyp" value={lead.customerType} onSave={v => onUpdateField(lead.id, "customerType", v)} options={["Privat", "Gewerbe", "Großkunde"]} />
              <InlineField label="Aktueller Anbieter" value={lead.currentProvider} onSave={v => onUpdateField(lead.id, "currentProvider", v)} />
              <InlineField label="Verbrauch (kWh)" value={lead.consumption} onSave={v => onUpdateField(lead.id, "consumption", v)} type="number" />
              <InlineField label="Jahreskosten (€)" value={lead.annualCosts} onSave={v => onUpdateField(lead.id, "annualCosts", v)} type="number" render={v => v ? `€${parseInt(v).toLocaleString("de-DE")}` : null} />
              {/* Energieaudit gate — ≥10.000 € + kein Privatkunde */}
              {(() => {
                const auditThreshold = 10000;
                const eligible = Number(lead.annualCosts || 0) >= auditThreshold && lead.customerType !== "Privat";
                const checked = !!lead.energyAuditEligible;
                return (
                  <div className={`inline-field audit-gate ${eligible ? "active" : "locked"}`}>
                    <label className="inline-label">Energieaudit</label>
                    <div className="inline-value-row">
                      <label className="checkbox-label">
                        <input
                          type="checkbox"
                          checked={checked}
                          disabled={!eligible}
                          onChange={e => eligible && onUpdateField(lead.id, "energyAuditEligible", e.target.checked)}
                        />
                        {eligible ? (checked ? "Berechtigt ✓" : "Klicken zum Aktivieren") : lead.customerType === "Privat" ? "Privatkunden ausgeschlossen" : "Ab €10.000/Jahr freischaltbar"}
                      </label>
                    </div>
                  </div>
                );
              })()}
              <InlineField label="Vertragsende" value={lead.contractEnd === "unknown" ? "" : lead.contractEnd} onSave={v => onUpdateField(lead.id, "contractEnd", v || "unknown")} type="date" render={v => (!v || v === "unknown") ? "Unbekannt" : formatDate(v)} />
              <InlineField label="Nachfass-Datum" value={lead.followUp} onSave={v => onUpdateField(lead.id, "followUp", v)} type="date" render={v => v ? formatDate(v) : null} />
              <InlineField label="Geburtsdatum" value={lead.geburtsdatum} onSave={v => onUpdateField(lead.id, "geburtsdatum", v)} type="date" render={v => v ? formatDate(v) : null} />
              {/* NEW: Termin inline */}
              <div className="inline-field">
                <label className="inline-label">Nächster Termin</label>
                <div className="inline-value-row" onClick={() => setShowAppointmentModal(true)}>
                  <span className="inline-value">
                    {lead.appointmentDate
                      ? `${formatDate(lead.appointmentDate)}${lead.appointmentTime ? ` · ${lead.appointmentTime}` : ""}`
                      : <em className="inline-empty">Klicken zum Planen</em>}
                  </span>
                  <span className="inline-edit-icon">📅</span>
                </div>
              </div>
            </div>

            <div className="details-energy-section">
              <h3>Energieversorgung</h3>
              <div className="energy-details-grid">
                {(lead.energy?.strom?.length > 0 && lead.energy.strom.some(m => m.zählernummer)) || (lead.energy?.gas?.length > 0 && lead.energy.gas.some(m => m.zählernummer)) ? (
                  <>
                    {lead.energy?.strom?.filter(m => m.zählernummer).map((meter, idx) => (
                      <div key={idx} className="energy-detail-card strom">
                        <div className="energy-detail-label">🔌 Strom {idx + 1}</div>
                        <div className="energy-detail-item"><span className="energy-detail-key">Zählernummer:</span><span className="energy-detail-value">{meter.zählernummer}</span></div>
                        {meter.maloId && <div className="energy-detail-item"><span className="energy-detail-key">MALO-ID:</span><span className="energy-detail-value">{meter.maloId}</span></div>}
                        {meter.lieferanschrift && <div className="energy-detail-item"><span className="energy-detail-key">Lieferanschrift:</span><span className="energy-detail-value">{meter.lieferanschrift}</span></div>}
                        {meter.kontaktanschrift && <div className="energy-detail-item"><span className="energy-detail-key">Kontaktanschrift:</span><span className="energy-detail-value">{meter.kontaktanschrift}</span></div>}
                      </div>
                    ))}
                    {lead.energy?.gas?.filter(m => m.zählernummer).map((meter, idx) => (
                      <div key={idx} className="energy-detail-card gas">
                        <div className="energy-detail-label">🔥 Gas {idx + 1}</div>
                        <div className="energy-detail-item"><span className="energy-detail-key">Zählernummer:</span><span className="energy-detail-value">{meter.zählernummer}</span></div>
                        {meter.maloId && <div className="energy-detail-item"><span className="energy-detail-key">MALO-ID:</span><span className="energy-detail-value">{meter.maloId}</span></div>}
                        {meter.lieferanschrift && <div className="energy-detail-item"><span className="energy-detail-key">Lieferanschrift:</span><span className="energy-detail-value">{meter.lieferanschrift}</span></div>}
                        {meter.kontaktanschrift && <div className="energy-detail-item"><span className="energy-detail-key">Kontaktanschrift:</span><span className="energy-detail-value">{meter.kontaktanschrift}</span></div>}
                      </div>
                    ))}
                  </>
                ) : (<p className="empty-energy-info">Keine Energieinformationen erfasst</p>)}
              </div>
            </div>
            {lead.createdBy && (
              <div className="drawer-created-by">
                Erstellt von <strong>{lead.createdBy.email}</strong> am {formatDateTime(lead.createdBy.timestamp)}
              </div>
            )}
          </div>
        )}

        {/* Tab: Kalkulator */}
        {drawerTab === "calc" && (
          <div className="drawer-tab-content">
            <SavingsCalculator lead={lead} />
          </div>
        )}

        {/* Tab: Wechsel & Provision */}
        {drawerTab === "wechsel" && (
          <div className="drawer-tab-content">
            {lead.status === "Gewonnen" ? (
              <>
                <WechselprozessTracker lead={lead} user={user} onUpdateField={onUpdateField} />
                <div style={{ marginTop: 20 }}>
                  <ProvisionsTracker lead={lead} onUpdateField={onUpdateField} />
                </div>
              </>
            ) : (
              <div className="wechsel-locked">
                🔒 Wechselprozess und Provision sind für gewonnene Leads (Status "Gewonnen") verfügbar.
              </div>
            )}
          </div>
        )}

        {/* Tab: KI-Assistent */}
        {drawerTab === "ai" && (
          <div className="drawer-tab-content">
            <AIAssistantPanel
              lead={lead}
              user={user}
              userRole={userRole}
              onUpdateField={onUpdateField}
              onUpdateStatus={onUpdateStatus}
            />
          </div>
        )}

        {/* Tab: Anhänge */}
        {drawerTab === "attachments" && (
          <div className="drawer-tab-content">
            <div className="attachments-upload-zone">
              <label htmlFor={`drawer-file-${lead.id}`} className="attachment-upload-label">
                📎 Dateien hochladen (max 10 MB)
              </label>
              <input id={`drawer-file-${lead.id}`} type="file" multiple className="file-input" onChange={e => onAddAttachment(lead.id, e.target.files)} />
            </div>
            {lead.attachments && lead.attachments.length > 0 ? (
              <div className="attachments-list-drawer">
                {lead.attachments.map(att => (
                  <div key={att.id} className="attachment-row">
                    <div className="attachment-row-info">
                      <span className="att-name">{att.name}</span>
                      <span className="att-meta">{(att.size / 1024).toFixed(1)} KB · {formatDate(att.uploadedAt)}</span>
                    </div>
                    <div className="attachment-row-actions">
                      <button type="button" onClick={() => setPreviewAttachment(att)} className="att-btn preview" title="Vorschau">👁</button>
                      <a href={getAttachmentHref(att)} download={att.name} className="att-btn download" title="Herunterladen">⬇</a>
                      <button type="button" onClick={() => setDeleteConfirmId(att.id)} className="att-btn delete" title="Löschen">✕</button>
                    </div>
                  </div>
                ))}
              </div>
            ) : (<p className="empty-timeline">Keine Anhänge vorhanden.</p>)}
          </div>
        )}

        {/* Preview Modal */}
        {previewAttachment && (
          <div className="modal-backdrop" onClick={() => setPreviewAttachment(null)}>
            <div className="preview-modal" onClick={e => e.stopPropagation()}>
              <div className="preview-header">
                <h3>{previewAttachment.name}</h3>
                <button className="preview-close" onClick={() => setPreviewAttachment(null)}>✕</button>
              </div>
              <div className="preview-content">
                {previewAttachment.type?.startsWith("image/") ? (
                  <img src={previewHref} alt={previewAttachment.name} className="preview-image" />
                ) : previewAttachment.type === "application/pdf" ? (
                  <div className="preview-pdf">
                    <p>📄 PDF-Datei</p>
                    <a href={previewHref} target="_blank" rel="noreferrer" className="primary-btn-modal">PDF öffnen</a>
                  </div>
                ) : previewAttachment.type?.startsWith("text/") || previewAttachment.name?.match(/\.(txt|json|csv|md)$/i) ? (
                  <div className="preview-text">
                    {previewAttachment.data ? (
                      <>
                        <pre>{previewAttachment.data.substring(0, 2000)}</pre>
                        {previewAttachment.data.length > 2000 && <p className="preview-truncated">... Datei gekürzt (max 2000 Zeichen)</p>}
                      </>
                    ) : (
                      <a href={previewHref} target="_blank" rel="noreferrer" className="primary-btn-modal">Datei öffnen</a>
                    )}
                  </div>
                ) : (
                  <div className="preview-generic">
                    <p>📎 {previewAttachment.type || "Unbekannter Dateityp"}</p>
                    <a href={previewHref} download={previewAttachment.name} className="primary-btn-modal">Datei herunterladen</a>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {deleteConfirmId && (
          <div className="modal-backdrop" onClick={() => setDeleteConfirmId(null)}>
            <div className="confirm-modal" onClick={e => e.stopPropagation()}>
              <div className="confirm-icon">⚠️</div>
              <h3>Anhang löschen?</h3>
              <p>Diese Aktion kann nicht rückgängig gemacht werden.</p>
              <div className="confirm-actions">
                <button className="ghost-btn" onClick={() => setDeleteConfirmId(null)}>Abbrechen</button>
                <button className="danger-btn" onClick={() => { onRemoveAttachment(lead.id, deleteConfirmId); setDeleteConfirmId(null); }}>Löschen</button>
              </div>
            </div>
          </div>
        )}

        <div className="drawer-footer">
          {userRole === "admin" && (
            <button className="danger-btn-sm" onClick={handleDelete}>Lead löschen</button>
          )}
        </div>
      </div>

      {/* Termin Modal */}
      {showAppointmentModal && (
        <AppointmentModal
          lead={lead}
          currentUserEmail={user?.email || ""}
          onClose={() => setShowAppointmentModal(false)}
          onSave={handleSaveAppointment}
        />
      )}
    </div>
  );
}

// ─── NewLeadModal ─────────────────────────────────────────────────────────────
function NewLeadModal({ onClose, onSubmit, loading }) {
  const [form, setForm] = useState(initialForm);
  const auditThreshold = 10000;
  const annualCostsValue = Number.parseFloat(form.annualCosts || 0) || 0;
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
  const handleFile = (e) => {
    const selectedFiles = Array.from(e.target.files || []);
    if (selectedFiles.length === 0) return;

    const oversized = selectedFiles.filter((file) => file.size > MAX_ATTACHMENT_SIZE_BYTES);
    if (oversized.length > 0) {
      alert(`${oversized[0].name} ist zu groß (max 10MB pro Datei)`);
    }

    const validFiles = selectedFiles.filter((file) => file.size <= MAX_ATTACHMENT_SIZE_BYTES);
    if (validFiles.length > 0) {
      setForm((prev) => ({
        ...prev,
        attachments: [
          ...prev.attachments,
          ...validFiles.map((file) => ({
            id: buildAttachmentId(),
            name: file.name,
            size: file.size,
            type: file.type,
            file,
            uploadedAt: new Date().toISOString(),
          })),
        ],
      }));
    }

    e.target.value = "";
  };
  const handleSubmit = (e) => {
    e.preventDefault();
    onSubmit(form, () => { setForm(initialForm); onClose(); });
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
            <div className="form-group"><label>Ansprechpartner *</label><input name="person" placeholder="Name" value={form.person} onChange={handleChange} disabled={loading} required /></div>
            <div className="form-group"><label>Geburtsdatum</label><input type="date" name="geburtsdatum" value={form.geburtsdatum} onChange={handleChange} disabled={loading} /></div>
            <div className="form-group"><label>Telefon *</label><input name="phone" type="tel" placeholder="+49..." value={form.phone} onChange={handleChange} disabled={loading} required /></div>
            <div className="form-group"><label>E-Mail *</label><input name="email" type="email" placeholder="name@firma.de" value={form.email} onChange={handleChange} disabled={loading} required /></div>
            <div className="form-group"><label>PLZ *</label><input name="postalCode" placeholder="12345" value={form.postalCode} onChange={handleChange} disabled={loading} required /></div>
            <div className="form-group"><label>Kundentyp</label><select name="customerType" value={form.customerType} onChange={handleChange} disabled={loading}><option>Privat</option><option>Gewerbe</option><option>Großkunde</option></select></div>
            <div className="form-group"><label>Aktueller Anbieter</label><input name="currentProvider" placeholder="z.B. E.ON" value={form.currentProvider} onChange={handleChange} disabled={loading} /></div>
            <div className="form-group"><label>Verbrauch (kWh)</label><input name="consumption" type="number" placeholder="50000" value={form.consumption} onChange={handleChange} disabled={loading} /></div>
            <div className="form-group"><label>Jahreskosten (€)</label><input name="annualCosts" type="number" placeholder="3500" value={form.annualCosts} onChange={handleChange} disabled={loading} /></div>
            <div className="form-group">
              <label>Vertragsende</label>
              <select name="contractEnd" value={form.contractEnd} onChange={handleChange} disabled={loading}>
                <option value="unknown">Unbekannt</option>
                <option value="">Datum eingeben...</option>
              </select>
              {form.contractEnd !== "unknown" && (<input type="date" name="contractEnd" value={form.contractEnd} onChange={handleChange} disabled={loading} style={{ marginTop: 6 }} />)}
            </div>
            <div className="form-group"><label>Nachfass-Datum</label><input type="date" name="followUp" value={form.followUp} onChange={handleChange} disabled={loading} /></div>

            <div className="form-group form-group-full">
              <div className="energy-section-header">
                <label>⚡ Stromzähler</label>
                <button type="button" className="add-meter-btn" onClick={() => setForm(p => ({ ...p, energy: { ...p.energy, strom: [...p.energy.strom, { zählernummer: "", maloId: "", lieferanschrift: "", kontaktanschrift: "" }] } }))} disabled={loading}>+ Zähler hinzufügen</button>
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
                    <div className="form-group"><label>Lieferanschrift</label><input type="text" placeholder="optional" value={meter.lieferanschrift} onChange={(e) => setForm(p => ({ ...p, energy: { ...p.energy, strom: p.energy.strom.map((m, i) => i === idx ? { ...m, lieferanschrift: e.target.value } : m) } }))} disabled={loading} /></div>
                    <div className="form-group"><label>Kontaktanschrift</label><input type="text" placeholder="optional" value={meter.kontaktanschrift} onChange={(e) => setForm(p => ({ ...p, energy: { ...p.energy, strom: p.energy.strom.map((m, i) => i === idx ? { ...m, kontaktanschrift: e.target.value } : m) } }))} disabled={loading} /></div>
                  </div>
                </div>
              ))}
            </div>

            <div className="form-group form-group-full">
              <div className="energy-section-header">
                <label>🔥 Gaszähler</label>
                <button type="button" className="add-meter-btn" onClick={() => setForm(p => ({ ...p, energy: { ...p.energy, gas: [...p.energy.gas, { zählernummer: "", maloId: "", lieferanschrift: "", kontaktanschrift: "" }] } }))} disabled={loading}>+ Zähler hinzufügen</button>
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
                    <div className="form-group"><label>Lieferanschrift</label><input type="text" placeholder="optional" value={meter.lieferanschrift} onChange={(e) => setForm(p => ({ ...p, energy: { ...p.energy, gas: p.energy.gas.map((m, i) => i === idx ? { ...m, lieferanschrift: e.target.value } : m) } }))} disabled={loading} /></div>
                    <div className="form-group"><label>Kontaktanschrift</label><input type="text" placeholder="optional" value={meter.kontaktanschrift} onChange={(e) => setForm(p => ({ ...p, energy: { ...p.energy, gas: p.energy.gas.map((m, i) => i === idx ? { ...m, kontaktanschrift: e.target.value } : m) } }))} disabled={loading} /></div>
                  </div>
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
                <input
                  type="checkbox"
                  name="energyAuditEligible"
                  checked={form.energyAuditEligible}
                  onChange={handleChange}
                  disabled={loading || !isAuditEligibleByCost}
                />
                Energieaudit berechtigt (ab 10.000 € Netto/Jahr, nur Gewerbe/Großkunde)
              </label>
              <small className="audit-gate-hint">
                {isPrivatCustomer
                  ? "Privatkunden sind vom Energieaudit ausgeschlossen."
                  : isAuditEligibleByCost
                    ? "Kriterium erfüllt: Feld kann aktiviert werden."
                    : `Noch gesperrt: Jahreskosten müssen mindestens ${formatEuro(auditThreshold)} betragen.`}
              </small>
            </div>
            <div className="form-group form-group-full">
              <div className="file-upload-zone">
                <label htmlFor="modal-file-input" className="file-upload-zone-label">📎 Dateien anfügen (max 10MB)</label>
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

// ─── UPDATED: LeadRow (with multiselect checkbox) ─────────────────────────────
function LeadRow({ lead, onSelect, isSelected, selectionMode, isChecked, onToggleCheck }) {
  const hasCancellationWindow = isOpenCancellationWindow(lead.contractEnd);
  const isOverdueNow = isOverdue(lead.followUp);
  const isTodayNow = isTodayDue(lead.followUp);
  const meta = STATUS_META[lead.status] || STATUS_META.Neu;
  const umsatz = calculateUmsatzPotential(lead.consumption);
  const activityCount = getLeadActivityCount(lead);
  const readiness = getLeadReadiness(lead);
  const temperature = getLeadTemperature(lead);
  const nextAction = getNextAction(lead);
  const closeProbability = getLeadWinProbability(lead);
  const scoreTone = getLeadScoreTone(closeProbability);
  const owner = getLeadOwnerEmail(lead);
  const lastActivityAt = getLastActivityTimestamp(lead);
  const stromCount = getEnergyMeterCount(lead, "strom");
  const gasCount = getEnergyMeterCount(lead, "gas");
  const deliveryPoints = getTotalDeliveryPoints(lead);

  return (
    <div
      className={`lead-row ${isSelected ? "selected" : ""} ${isChecked ? "bulk-checked" : ""}`}
      onClick={() => selectionMode ? onToggleCheck(lead.id) : onSelect(lead)}
    >
      {selectionMode && (
        <div className="lead-row-checkbox" onClick={e => e.stopPropagation()}>
          <input
            type="checkbox"
            checked={isChecked}
            onClick={e => e.stopPropagation()}
            onChange={() => onToggleCheck(lead.id)}
          />
        </div>
      )}
      {!selectionMode && <div className="lead-row-checkbox-placeholder" />}
      <div className="lead-row-signals">
        <span
          className={`ampel-pill ${readiness.tone}`}
          title={readiness.reason}
          aria-label={`Abschlussampel: ${readiness.label}`}
        >
          {readiness.tone === "green" ? "🚦 OK" : "🚦 FEHLT"}
        </span>
        <span
          className={`health-pill ${temperature.tone}`}
          title={`Heat-Level: ${temperature.label}`}
          aria-label={`Heat-Level: ${temperature.label}`}
        >
          {temperature.label}
        </span>
        {lead.energyAuditEligible && (
          <span className="audit-pill" title="Energieaudit berechtigt">🔍 Audit</span>
        )}
        {lead.renewalResurfacedAt && (
          <span className="resurface-pill" title="Automatisch wiedervorgelegt">🔁 Renewal</span>
        )}
      </div>
      <div className="lead-row-main">
        <div className="lead-row-company">{lead.company || <em className="no-company">Kein Firmenname</em>}</div>
        <div className="lead-row-sub">
          {lead.person}
          {lead.phone ? (
            <>{" · "}<a className="lead-phone-link" href={`tel:${lead.phone}`} onClick={e => e.stopPropagation()}>{lead.phone}</a></>
          ) : ""}
        </div>
        <div className="lead-row-owner">Owner: {owner}</div>
      </div>
      <div className="lead-row-energy">
        {stromCount > 0 && <span className="energy-badge strom">🔌 Strom x{stromCount}</span>}
        {gasCount > 0 && <span className="energy-badge gas">🔥 Gas x{gasCount}</span>}
        {deliveryPoints > 0 && (<span className={`energy-badge total ${deliveryPoints >= 3 ? "high" : ""}`}>📍 {deliveryPoints} Lieferstellen</span>)}
      </div>
      <div className="lead-row-health">
        <span className={`lead-score-pill ${scoreTone}`}>Deal {closeProbability}%</span>
        <span className={`next-action-pill ${nextAction.tone}`}>{nextAction.label}</span>
      </div>
      <div className="lead-row-status">
        <span className="status-chip" style={{ background: meta.bg, color: meta.color }}>{lead.status}</span>
      </div>
      <div className="lead-row-umsatz">{formatEuro(umsatz)}</div>
      <div className="lead-row-followup">
        {lead.followUp ? (
          <span className={isOverdueNow ? "date-overdue" : isTodayNow ? "date-today" : ""}>{formatDate(lead.followUp)}</span>
        ) : hasCancellationWindow ? (
          <span className="followup-chip cancellation" title="Kündigungsfenster offen">Künd.-Fenster</span>
        ) : "—"}
      </div>
      <div className="lead-row-activity">
        <span className="activity-count">{activityCount}</span>
        <span className="last-activity-label">{lastActivityAt ? formatDate(lastActivityAt) : "Neu"}</span>
      </div>
    </div>
  );
}

// ─── KanbanBoard ──────────────────────────────────────────────────────────────
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

// ─── Dashboard ────────────────────────────────────────────────────────────────
function Dashboard({ leads, teamMembers }) {
  const stats = useMemo(() => {
    const byStatus = STATUS_OPTIONS.map(s => ({ label: s, count: leads.filter(l => l.status === s).length }));
    const topPerformer = teamMembers.map(m => {
      const ml = leads.filter(l => l.createdBy?.email === m.email);
      return { email: m.email, role: m.role, total: ml.length, won: ml.filter(l => l.status === "Gewonnen").length, umsatz: ml.reduce((s, l) => s + calculateUmsatzPotential(l.consumption), 0) };
    }).sort((a, b) => b.won - a.won);
    const totalUmsatz = leads.reduce((s, l) => s + calculateUmsatzPotential(l.consumption), 0);
    const wonLeads = leads.filter(l => l.status === "Gewonnen").length;
    const closingRate = leads.length > 0 ? Math.round((wonLeads / leads.length) * 100) : 0;
    return { byStatus, topPerformer, totalUmsatz, wonLeads, closingRate };
  }, [leads, teamMembers]);

  const maxCount = Math.max(...stats.byStatus.map(s => s.count), 1);
  const statusColors = { Neu: "#6c757d", Kontaktiert: "#0d6efd", Angebot: "#fd7e14", Nachfassen: "#ffc107", Gewonnen: "#198754", Verloren: "#dc3545" };

  return (
    <div className="dashboard-grid">
      <div className="card dashboard-card">
        <h2>📊 Leads nach Status</h2>
        <div className="bar-chart">
          {stats.byStatus.map(s => (
            <div key={s.label} className="bar-row">
              <span className="bar-label">{s.label}</span>
              <div className="bar-track"><div className="bar-fill" style={{ width: `${(s.count / maxCount) * 100}%`, background: statusColors[s.label] || "#0d6efd" }} /></div>
              <span className="bar-count">{s.count}</span>
            </div>
          ))}
        </div>
        <div className="dashboard-summary">
          <div className="summary-item"><span>Closing rate</span><strong className={getClosingRateClass(stats.closingRate)}>{stats.closingRate}%</strong></div>
          <div className="summary-item"><span>Gewonnen</span><strong>{stats.wonLeads}</strong></div>
          <div className="summary-item"><span>Umsatzpotenzial</span><strong className="kpi-success">{formatEuro(stats.totalUmsatz)}</strong></div>
        </div>
      </div>
      <div className="card dashboard-card">
        <h2>🏆 Top-Performer</h2>
        {stats.topPerformer.length === 0 ? (
          <p className="empty-text">Noch keine Teammitglieder</p>
        ) : (
          <div className="performer-list">
            {stats.topPerformer.map((p, idx) => (
              <div key={p.email} className={`performer-item rank-${idx + 1}`}>
                <div className="performer-rank">{idx === 0 ? "🥇" : idx === 1 ? "🥈" : idx === 2 ? "🥉" : `#${idx + 1}`}</div>
                <div className="performer-info">
                  <span className="performer-email">{p.email}</span>
                  <span className="performer-role">{p.role === "admin" ? "👑 Admin" : "Agent"}</span>
                </div>
                <div className="performer-stats">
                  <span title="Leads">📋 {p.total}</span>
                  <span title="Gewonnen">✅ {p.won}</span>
                  <span title="Umsatz">💶 {formatEuro(p.umsatz)}</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Calendar View ───────────────────────────────────────────────────────────
function CalendarView({ leads, onOpenLead }) {
  const [monthOffset, setMonthOffset] = useState(0);

  const baseDate = useMemo(() => {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth() + monthOffset, 1);
  }, [monthOffset]);

  const monthLabel = baseDate.toLocaleDateString("de-DE", { month: "long", year: "numeric" });
  const monthStart = new Date(baseDate.getFullYear(), baseDate.getMonth(), 1);
  const monthEnd = new Date(baseDate.getFullYear(), baseDate.getMonth() + 1, 0);
  const gridStart = new Date(monthStart);
  gridStart.setDate(monthStart.getDate() - ((monthStart.getDay() + 6) % 7));
  const gridEnd = new Date(monthEnd);
  gridEnd.setDate(monthEnd.getDate() + (6 - ((monthEnd.getDay() + 6) % 7)));

  const eventsByDate = useMemo(() => {
    const map = new Map();
    leads.forEach((lead) => {
      if (!lead.appointmentDate) return;
      const bucket = map.get(lead.appointmentDate) || [];
      bucket.push(lead);
      map.set(lead.appointmentDate, bucket);
    });
    return map;
  }, [leads]);

  const upcomingAppointments = useMemo(() => {
    const today = new Date().toISOString().split("T")[0];
    return leads
      .filter((lead) => !!lead.appointmentDate && lead.appointmentDate >= today)
      .sort((a, b) => {
        if (a.appointmentDate !== b.appointmentDate) return a.appointmentDate.localeCompare(b.appointmentDate);
        return (a.appointmentTime || "23:59").localeCompare(b.appointmentTime || "23:59");
      })
      .slice(0, 8);
  }, [leads]);

  const dayCells = [];
  const cursor = new Date(gridStart);
  while (cursor <= gridEnd) {
    const iso = cursor.toISOString().split("T")[0];
    const isCurrentMonth = cursor.getMonth() === baseDate.getMonth();
    const isToday = iso === new Date().toISOString().split("T")[0];
    dayCells.push({
      iso,
      day: cursor.getDate(),
      isCurrentMonth,
      isToday,
      events: eventsByDate.get(iso) || [],
    });
    cursor.setDate(cursor.getDate() + 1);
  }

  return (
    <div className="tab-page">
      <div className="main-toolbar">
        <div className="toolbar-left">
          <h1 className="page-title">Kalender</h1>
          <span className="lead-count-badge">{upcomingAppointments.length} bevorstehend</span>
        </div>
        <div className="toolbar-right">
          <div className="calendar-nav-controls">
            <button className="ghost-btn-sm" onClick={() => setMonthOffset((v) => v - 1)}>◀</button>
            <strong className="calendar-month-label">{monthLabel}</strong>
            <button className="ghost-btn-sm" onClick={() => setMonthOffset((v) => v + 1)}>▶</button>
            <button className="ghost-btn-sm" onClick={() => setMonthOffset(0)}>Heute</button>
          </div>
        </div>
      </div>

      <div className="calendar-layout">
        <div className="calendar-month-board">
          <div className="calendar-weekday-row">
            {["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"].map((wd) => (
              <div key={wd} className="calendar-weekday-cell">{wd}</div>
            ))}
          </div>
          <div className="calendar-day-grid">
            {dayCells.map((cell) => (
              <div
                key={cell.iso}
                className={`calendar-day-cell ${cell.isCurrentMonth ? "" : "muted"} ${cell.isToday ? "today" : ""} ${cell.events.length ? "has-events" : ""}`}
              >
                <div className="calendar-day-header">
                  <span>{cell.day}</span>
                  {cell.events.length > 0 && <span className="calendar-day-dot">{cell.events.length}</span>}
                </div>
                <div className="calendar-day-events">
                  {cell.events.slice(0, 2).map((lead) => (
                    <button
                      key={lead.id}
                      className="calendar-event-chip"
                      onClick={() => onOpenLead(lead.id)}
                      title={`${lead.company || lead.person}${lead.appointmentTime ? ` · ${lead.appointmentTime}` : ""}`}
                    >
                      <span className="calendar-event-time">{lead.appointmentTime || "--:--"}</span>
                      <span className="calendar-event-title">{lead.company || lead.person}</span>
                    </button>
                  ))}
                  {cell.events.length > 2 && (
                    <span className="calendar-more-events">+{cell.events.length - 2} weitere</span>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>

        <aside className="calendar-upcoming-panel">
          <h3>Nächste Termine</h3>
          {upcomingAppointments.length === 0 ? (
            <p className="empty-text">Keine bevorstehenden Termine geplant.</p>
          ) : (
            <div className="calendar-upcoming-list">
              {upcomingAppointments.map((lead) => (
                <button key={`upcoming-${lead.id}`} className="calendar-upcoming-item" onClick={() => onOpenLead(lead.id)}>
                  <div>
                    <strong>{lead.company || lead.person}</strong>
                    <span>{lead.person}</span>
                  </div>
                  <div>
                    <strong>{formatDate(lead.appointmentDate)}</strong>
                    <span>{lead.appointmentTime || "Ganztägig"}</span>
                  </div>
                </button>
              ))}
            </div>
          )}
        </aside>
      </div>
    </div>
  );
}

// ─── Team-Verwaltung ──────────────────────────────────────────────────────────
function TeamManagement({ currentUser, teamId, teamMembers, onRefresh, userRole, canAssignAdmins }) {
  const [activeSection, setActiveSection] = useState("members");
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState("agent");
  const [manualEmail, setManualEmail] = useState("");
  const [manualRole, setManualRole] = useState("agent");
  const [inviteLink, setInviteLink] = useState(null);
  const [linkCopied, setLinkCopied] = useState(false);
  const [linkExpiry, setLinkExpiry] = useState("48");
  const linkRole = "agent";
  const [statusMsg, setStatusMsg] = useState(null);
  const [loading, setLoading] = useState(false);
  const isAdmin = userRole === "admin";
  const adminCount = teamMembers.filter(m => m.role === "admin").length;
  const setMsg = (type, msg) => { setStatusMsg({ type, msg }); setTimeout(() => setStatusMsg(null), 5000); };

  const inviteByEmail = async () => {
    if (!inviteEmail.trim()) return;
    setLoading(true);
    try {
      const normalizedEmail = inviteEmail.trim().toLowerCase();
      const nextRole = canAssignAdmins ? inviteRole : "agent";
      const q = query(collection(db, "users"), where("teamId", "==", teamId), where("email", "==", normalizedEmail));
      const snap = await getDocs(q);
      const existingInvQ = query(
        collection(db, "invitations"),
        where("teamId", "==", teamId),
        where("invitedEmail", "==", normalizedEmail),
        where("status", "==", "pending")
      );
      const existingInvSnap = await getDocs(existingInvQ);
      if (snap.empty) {
        if (!existingInvSnap.empty) {
          await updateDoc(existingInvSnap.docs[0].ref, { teamId, role: nextRole, invitedBy: currentUser.email, updatedAt: new Date().toISOString() });
          setMsg("info", `Einladung für ${inviteEmail} aktualisiert.`);
        } else {
          await addDoc(collection(db, "invitations"), { teamId, invitedBy: currentUser.email, invitedEmail: normalizedEmail, role: nextRole, createdAt: new Date().toISOString(), status: "pending" });
          setMsg("info", `Einladung für ${inviteEmail} gespeichert.`);
        }
      } else {
        try {
          await updateDoc(doc(db, "users", snap.docs[0].id), { teamId, role: nextRole });
          setMsg("success", `${inviteEmail} wurde hinzugefügt.`);
        } catch {
          await addDoc(collection(db, "invitations"), { teamId, invitedBy: currentUser.email, invitedEmail: normalizedEmail, role: nextRole, createdAt: new Date().toISOString(), status: "pending" });
          setMsg("info", `${inviteEmail} als Einladung hinterlegt.`);
        }
      }
      setInviteEmail(""); setInviteRole("agent"); onRefresh();
    } catch (e) { setMsg("error", `Fehler (${e?.code || "unknown"}): ${e?.message || "Unbekannt"}`); }
    setLoading(false);
  };

  const addManually = async () => {
    if (!manualEmail.trim()) return;
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(manualEmail.trim())) { setMsg("error", "Ungültige E-Mail."); return; }
    setLoading(true);
    try {
      const normalizedEmail = manualEmail.trim().toLowerCase();
      const nextRole = canAssignAdmins ? manualRole : "agent";
      const q = query(collection(db, "users"), where("teamId", "==", teamId), where("email", "==", normalizedEmail));
      const snap = await getDocs(q);
      if (!snap.empty) {
        try {
          await updateDoc(doc(db, "users", snap.docs[0].id), { teamId, role: nextRole });
          setMsg("success", `${manualEmail} hinzugefügt.`);
        } catch {
          await addDoc(collection(db, "invitations"), {
            teamId,
            invitedBy: currentUser.email,
            invitedEmail: normalizedEmail,
            role: nextRole,
            createdAt: new Date().toISOString(),
            status: "pending",
            addedManually: true,
          });
          setMsg("info", `${manualEmail} als Einladung vorgemerkt.`);
        }
      } else {
        await addDoc(collection(db, "invitations"), { teamId, invitedBy: currentUser.email, invitedEmail: normalizedEmail, role: nextRole, createdAt: new Date().toISOString(), status: "pending", addedManually: true });
        setMsg("info", `${manualEmail} vorgemerkt.`);
      }
      setManualEmail(""); setManualRole("agent"); onRefresh();
    } catch (e) { setMsg("error", `Fehler (${e?.code || "unknown"}): ${e?.message || "Unbekannt"}`); }
    setLoading(false);
  };

  const generateInviteLink = async () => {
    setLoading(true);
    try {
      const nextRole = canAssignAdmins ? linkRole : "agent";
      const token = [...crypto.getRandomValues(new Uint8Array(24))].map(b => b.toString(16).padStart(2, "0")).join("");
      const expiresAt = new Date(Date.now() + parseInt(linkExpiry) * 60 * 60 * 1000).toISOString();
      await setDoc(doc(db, "inviteLinks", token), { teamId, createdBy: currentUser.email, role: nextRole, createdAt: new Date().toISOString(), expiresAt, usageCount: 0 });
      setInviteLink(`${window.location.origin}?invite=${token}`);
      setMsg("success", "Link erstellt.");
    } catch (e) { setMsg("error", "Fehler."); }
    setLoading(false);
  };

  const copyLink = () => { navigator.clipboard.writeText(inviteLink).then(() => { setLinkCopied(true); setTimeout(() => setLinkCopied(false), 2500); }); };

  const removeMember = async (email) => {
    const target = teamMembers.find(m => m.email === email);
    if (target?.role === "admin" && adminCount <= 1) { setMsg("error", "Letzter Admin kann nicht entfernt werden."); return; }
    if (!window.confirm(`${email} entfernen?`)) return;
    try {
      const q = query(collection(db, "users"), where("email", "==", email));
      const snap = await getDocs(q);
      if (!snap.empty) { await updateDoc(doc(db, "users", snap.docs[0].id), { teamId: `team-${snap.docs[0].id}`, role: "admin" }); onRefresh(); }
    } catch (e) { console.error(e); }
  };

  const toggleRole = async (email, currentRole) => {
    if (!canAssignAdmins) { setMsg("error", "Keine Berechtigung."); return; }
    if (currentRole === "admin" && adminCount <= 1) { setMsg("error", "Letzter Admin."); return; }
    try {
      const q = query(collection(db, "users"), where("email", "==", email));
      const snap = await getDocs(q);
      if (!snap.empty) { await updateDoc(doc(db, "users", snap.docs[0].id), { role: currentRole === "admin" ? "agent" : "admin" }); onRefresh(); }
    } catch (e) { console.error(e); }
  };

  const SECTIONS = [
    { id: "members", label: "Mitglieder", icon: "👥" },
    { id: "invite-email", label: "Per E-Mail", icon: "✉️" },
    { id: "add-manual", label: "Manuell anlegen", icon: "➕" },
    { id: "invite-link", label: "Einladungslink", icon: "🔗" },
  ];

  return (
    <div className="team-page">
      <div className="team-page-header">
        <div>
          <h1 className="page-title">Team-Verwaltung</h1>
          <p className="team-id-info">Team-ID: <code>{teamId}</code></p>
        </div>
        {!isAdmin && <p className="team-role-hint">Du bist als Agent angemeldet.</p>}
      </div>
      <div className="team-section-nav">
        {SECTIONS.map(s => (
          <button key={s.id} className={`team-section-tab ${activeSection === s.id ? "active" : ""} ${!isAdmin && s.id !== "members" ? "disabled" : ""}`} onClick={() => isAdmin || s.id === "members" ? setActiveSection(s.id) : setMsg("error", "Nur für Admins.")}>
            <span>{s.icon}</span> {s.label}
            {s.id === "members" && <span className="team-tab-count">{teamMembers.length}</span>}
          </button>
        ))}
      </div>
      {statusMsg && <div className={`invite-status ${statusMsg.type}`}>{statusMsg.msg}</div>}
      {activeSection === "members" && (
        <div className="card team-members-card">
          {teamMembers.length === 0 ? (<p className="empty-text">Noch keine Teammitglieder.</p>) : (
            <table className="members-table">
              <thead><tr><th>E-Mail</th><th>Rolle</th><th>Beigetreten</th>{isAdmin && <th>Aktionen</th>}</tr></thead>
              <tbody>
                {teamMembers.map(m => (
                  <tr key={m.email} className={m.email === currentUser.email ? "members-table-self" : ""}>
                    <td><div className="member-email-cell"><div className="member-avatar-sm">{m.email[0].toUpperCase()}</div><span>{m.email}</span>{m.email === currentUser.email && <span className="you-chip">Du</span>}</div></td>
                    <td><span className={`member-role-badge ${m.role}`}>{m.role === "admin" ? "👑 Admin" : "🧑 Agent"}</span></td>
                    <td className="member-date">{m.createdAt ? formatDate(m.createdAt) : "—"}</td>
                    {isAdmin && (<td>{m.email !== currentUser.email ? (<div className="member-actions">{canAssignAdmins && <button className="small-btn" onClick={() => toggleRole(m.email, m.role)}>{m.role === "admin" ? "→ Agent" : "→ Admin"}</button>}<button className="small-btn danger" onClick={() => removeMember(m.email)}>Entfernen</button></div>) : <span className="muted-text">—</span>}</td>)}
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
      {activeSection === "invite-email" && isAdmin && (
        <div className="card team-action-card">
          <h3>Mitglied per E-Mail einladen</h3>
          <div className="action-form">
            <div className="form-row"><label>E-Mail-Adresse</label><input type="email" placeholder="kollege@beispiel.de" value={inviteEmail} onChange={e => setInviteEmail(e.target.value)} onKeyDown={e => e.key === "Enter" && inviteByEmail()} disabled={loading} /></div>
            {canAssignAdmins && (<div className="form-row"><label>Rolle</label><div className="role-picker"><button className={`role-pick-btn ${inviteRole === "agent" ? "active" : ""}`} onClick={() => setInviteRole("agent")}>🧑 Agent<span className="role-desc">Leads anlegen &amp; bearbeiten</span></button><button className={`role-pick-btn ${inviteRole === "admin" ? "active" : ""}`} onClick={() => setInviteRole("admin")}>👑 Admin<span className="role-desc">Team verwalten</span></button></div></div>)}
            <button className="primary-btn" onClick={inviteByEmail} disabled={loading || !inviteEmail.trim()}>{loading ? "..." : "Einladung senden"}</button>
          </div>
        </div>
      )}
      {activeSection === "add-manual" && isAdmin && (
        <div className="card team-action-card">
          <h3>Mitglied manuell hinzufügen</h3>
          <div className="action-form">
            <div className="form-row"><label>E-Mail-Adresse</label><input type="email" placeholder="kollege@beispiel.de" value={manualEmail} onChange={e => setManualEmail(e.target.value)} disabled={loading} /></div>
            {canAssignAdmins && (<div className="form-row"><label>Rolle</label><div className="role-picker"><button className={`role-pick-btn ${manualRole === "agent" ? "active" : ""}`} onClick={() => setManualRole("agent")}>🧑 Agent</button><button className={`role-pick-btn ${manualRole === "admin" ? "active" : ""}`} onClick={() => setManualRole("admin")}>👑 Admin</button></div></div>)}
            <button className="primary-btn" onClick={addManually} disabled={loading || !manualEmail.trim()}>{loading ? "..." : "Hinzufügen"}</button>
          </div>
        </div>
      )}
      {activeSection === "invite-link" && isAdmin && (
        <div className="card team-action-card">
          <h3>Einladungslink generieren</h3>
          <div className="action-form">
            <div className="form-row"><label>Gültig für</label><div className="expiry-picker">{[["24", "24h"], ["48", "48h"], ["168", "7 Tage"], ["720", "30 Tage"]].map(([val, label]) => (<button key={val} className={`expiry-btn ${linkExpiry === val ? "active" : ""}`} onClick={() => setLinkExpiry(val)}>{label}</button>))}</div></div>
            <button className="primary-btn" onClick={generateInviteLink} disabled={loading}>{loading ? "..." : "Link generieren"}</button>
          </div>
          {inviteLink && (
            <div className="invite-link-box">
              <div className="invite-link-url">{inviteLink}</div>
              <div className="invite-link-actions">
                <button className={`copy-link-btn ${linkCopied ? "copied" : ""}`} onClick={copyLink}>{linkCopied ? "✓ Kopiert!" : "Kopieren"}</button>
                <a href={`https://wa.me/?text=${encodeURIComponent("Einladung: " + inviteLink)}`} target="_blank" rel="noopener noreferrer" className="share-btn whatsapp">WhatsApp</a>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── InviteLink-Handler ───────────────────────────────────────────────────────
async function acceptInviteLink(token, userId, userEmail) {
  try {
    const linkDoc = await getDoc(doc(db, "inviteLinks", token));
    if (!linkDoc.exists()) return { ok: false, msg: "Ungültig." };
    const data = linkDoc.data();
    if (new Date(data.expiresAt) < new Date()) return { ok: false, msg: "Abgelaufen." };
    await updateDoc(doc(db, "users", userId), { teamId: data.teamId, role: data.role || "agent" });
    await updateDoc(doc(db, "inviteLinks", token), { usageCount: (data.usageCount || 0) + 1 });
    return { ok: true, teamId: data.teamId, role: data.role || "agent" };
  } catch (e) { return { ok: false, msg: "Fehler." }; }
}

// ─── Sidebar ──────────────────────────────────────────────────────────────────
function Sidebar({ activeTab, setActiveTab, stats, user, userRole, userProfile, avatarUploading, onAvatarUpload, onSignOut }) {
  const avatarInputRef = useRef(null);
  const avatarUrl = userProfile?.avatarDataUrl || "";

  const handleAvatarChange = (event) => {
    const file = event.target.files?.[0];
    if (file) onAvatarUpload(file);
    event.target.value = "";
  };

  const navItems = [
    { id: "leads", label: "Lead-Pipeline", icon: "📋" },
    { id: "calendar", label: "Kalender", icon: "🗓️" },
    { id: "dashboard", label: "Dashboard", icon: "📊" },
    { id: "team", label: "Team", icon: "👥" },
  ];

  const handleNavClick = (id) => {
    setActiveTab(id);
    if (id === "leads") {
      setTimeout(() => {
        document.querySelector(".main-content")?.scrollIntoView({ behavior: "smooth" });
      }, 50);
    }
  };

  return (
    <aside className="sidebar">
      <div className="sidebar-header"><img src={logo} alt="ENERGYO" className="sidebar-logo" /></div>
      <nav className="sidebar-nav">
        {navItems.map(item => (
          <button key={item.id} className={`sidebar-nav-item ${activeTab === item.id ? "active" : ""}`} onClick={() => handleNavClick(item.id)}>
            <span className="sidebar-item-icon">{item.icon}</span>
            <span className="sidebar-item-label">{item.label}</span>
          </button>
        ))}
      </nav>
      <div className="sidebar-kpis">
        <div className="sidebar-kpi-item" onClick={() => handleNavClick("leads")}>
          <span className="sidebar-kpi-value kpi-alert">{stats.inactive48}</span>
          <span className="sidebar-kpi-label">To Do</span>
        </div>
        <div className="sidebar-kpi-item" onClick={() => handleNavClick("leads")}>
          <span className="sidebar-kpi-value kpi-blue sidebar-kpi-value--compact">{formatEnergyVolume(stats.movedEnergyKwh)}</span>
          <span className="sidebar-kpi-label">Bewegte Energie</span>
        </div>
        <div className="sidebar-kpi-item" onClick={() => handleNavClick("leads")}>
          <span className="sidebar-kpi-value kpi-success sidebar-kpi-value--compact">{formatEuro(stats.totalUmsatzPotential)}</span>
          <span className="sidebar-kpi-label">Umsatzpotenzial</span>
        </div>
        <div className="sidebar-kpi-item">
          <span className={`sidebar-kpi-value ${getClosingRateClass(stats.closingRate)}`}>{stats.closingRate}%</span>
          <span className="sidebar-kpi-label">Closing Rate</span>
        </div>
      </div>
      <div className="sidebar-footer">
        <div className="sidebar-user">
          <button
            type="button"
            className="user-avatar-btn"
            onClick={() => avatarInputRef.current?.click()}
            title="Profilbild ändern"
            disabled={avatarUploading}
          >
            <div className="user-avatar">
              {avatarUrl ? (
                <img src={avatarUrl} alt="Profilbild" className="user-avatar-img" />
              ) : (
                user.email[0].toUpperCase()
              )}
            </div>
          </button>
          <input
            ref={avatarInputRef}
            type="file"
            accept="image/*"
            style={{ display: "none" }}
            onChange={handleAvatarChange}
          />
          <div className="user-info">
            <span className="user-email-short">{user.email.split("@")[0]}</span>
            <span className="user-domain">{user.email.split("@")[1]}</span>
            <span className={`user-role-chip ${userRole === "admin" ? "admin" : "agent"}`}>{userRole === "admin" ? "Admin" : "Agent"}</span>
            <button type="button" className="avatar-upload-link" onClick={() => avatarInputRef.current?.click()} disabled={avatarUploading}>
              {avatarUploading ? "Bild wird gespeichert..." : "Profilbild ändern"}
            </button>
          </div>
        </div>
        <button className="sidebar-signout-btn" onClick={onSignOut}>Abmelden</button>
      </div>
    </aside>
  );
}

// ─── Import Modal ─────────────────────────────────────────────────────────────
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
      const reader = new FileReader();
      reader.onload = (evt) => {
        try {
          const workbook = XLSX.read(evt.target?.result, { type: 'array' });
          const worksheet = workbook.Sheets[workbook.SheetNames[0]];
          processTabularData(XLSX.utils.sheet_to_json(worksheet, { header: 1, defval: '' }));
        } catch (err) { setError(`Excel-Fehler: ${err?.message}`); }
      };
      reader.readAsArrayBuffer(f);
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
        <div className="modal-header"><h2>📥 Lead-Import</h2><button className="drawer-close-btn" onClick={onClose}>✕</button></div>
        {step === 1 && (
          <div className="import-step">
            <p className="step-desc">CSV- oder Excel-Datei hochladen</p>
            <div className="import-upload-zone" onClick={() => fileInputRef.current?.click()}>
              <span className="upload-icon">📄</span>
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
                ⚠️ {duplicates.length} Duplikat(e):
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
          <div className="import-step"><div className="import-success"><span className="success-icon">✅</span><h3>{parsedLeads.length} Leads importiert!</h3></div></div>
        )}
        <div className="modal-footer">
          {step === 1 && <button className="ghost-btn" onClick={onClose}>Abbrechen</button>}
          {step === 2 && (<><button className="ghost-btn" onClick={() => setStep(1)}>Zurück</button><button className="primary-btn" onClick={handleImport} disabled={loading || parsedLeads.length === 0}>{loading ? '⏳' : `✅ ${parsedLeads.length} Leads importieren`}</button></>)}
          {step === 3 && <button className="primary-btn" onClick={onClose}>Schließen</button>}
        </div>
      </div>
    </div>
  );
}

// ─── SavingsCalculator ───────────────────────────────────────────────────────
function SavingsCalculator({ lead }) {
  const kWh = parseInt(lead.consumption) || 0;
  const annualCosts = parseFloat(lead.annualCosts) || 0;

  const [currentPrice, setCurrentPrice] = useState(() => {
    if (kWh > 0 && annualCosts > 0) return ((annualCosts / kWh) * 100).toFixed(2);
    return "";
  });
  const [newPrice, setNewPrice] = useState("");

  const currentCt = parseFloat(currentPrice) || 0;
  const newCt = parseFloat(newPrice) || 0;
  const diffCt = currentCt - newCt;
  const annualSavings = kWh > 0 ? (diffCt / 100 * kWh) : 0;
  const monthlySavings = annualSavings / 12;

  const copyText = `⚡ Energyo Einspar-Kalkulation\n\nJahresverbrauch: ${kWh.toLocaleString("de-DE")} kWh\nAktueller Preis: ${currentCt.toFixed(2)} ct/kWh → ${formatEuro(currentCt / 100 * kWh)}/Jahr\nNeuer Preis: ${newCt.toFixed(2)} ct/kWh → ${formatEuro(newCt / 100 * kWh)}/Jahr\n\n✅ Jahresersparnis: ${formatEuro(annualSavings)}\n✅ Monatsersparnis: ${formatEuro(monthlySavings)}`;

  return (
    <div className="savings-calc">
      <div className="savings-header">
        <span>⚡</span>
        <div>
          <p className="savings-title">Einspar-Kalkulator</p>
          <p className="savings-sub">Live am Telefon ausrechnen — Abschluss sichern</p>
        </div>
      </div>

      <div className="savings-inputs">
        <div className="savings-field">
          <label>Jahresverbrauch (kWh)</label>
          <input
            className="savings-input"
            type="number"
            readOnly
            value={kWh || ""}
            placeholder="Im Lead eintragen"
          />
        </div>
        <div className="savings-field">
          <label>Aktueller Preis (ct/kWh)</label>
          <input
            className="savings-input"
            type="number"
            step="0.01"
            value={currentPrice}
            onChange={e => setCurrentPrice(e.target.value)}
            placeholder="z.B. 28.5"
          />
        </div>
        <div className="savings-field">
          <label>Neuer Preis ENERGYO (ct/kWh)</label>
          <input
            className="savings-input"
            type="number"
            step="0.01"
            value={newPrice}
            onChange={e => setNewPrice(e.target.value)}
            placeholder="z.B. 22.0"
          />
        </div>
      </div>

      {currentCt > 0 && newCt > 0 && annualSavings > 0 && (
        <div className="savings-result positive">
          <div className="savings-result-main">
            <span className="savings-amount">{formatEuro(annualSavings)}</span>
            <span className="savings-period">Jahresersparnis</span>
          </div>
          <div className="savings-result-details">
            <div className="savings-detail-item"><span>Pro Monat</span><strong>{formatEuro(monthlySavings)}</strong></div>
            <div className="savings-detail-item"><span>Differenz</span><strong>{diffCt.toFixed(2)} ct/kWh</strong></div>
            <div className="savings-detail-item"><span>Aktuell/Jahr</span><strong>{formatEuro(currentCt / 100 * kWh)}</strong></div>
            <div className="savings-detail-item"><span>Neu/Jahr</span><strong>{formatEuro(newCt / 100 * kWh)}</strong></div>
          </div>
          <div className="savings-actions">
            <button className="savings-copy-btn" onClick={() => navigator.clipboard.writeText(copyText)}>
              📋 Kalkulation kopieren
            </button>
          </div>
        </div>
      )}
      {currentCt > 0 && newCt > 0 && annualSavings <= 0 && (
        <div style={{ color: "#ef4444", fontSize: "0.82rem", padding: "12px 0" }}>
          ⚠️ Kein Vorteil — neuer Preis liegt nicht unterhalb des aktuellen.
        </div>
      )}
    </div>
  );
}

// ─── WechselprozessTracker ───────────────────────────────────────────────────
const WECHSEL_STEPS = [
  { id: "antrag",        label: "Wechselantrag gestellt",       desc: "Antrag bei ENERGYO eingereicht" },
  { id: "kuendigung",    label: "Kündigung beim Altanbieter",   desc: "Kündigung versendet & bestätigt" },
  { id: "netzanmeldung", label: "Netzanmeldung bestätigt",      desc: "Netzbetreiber-Rückmeldung erhalten" },
  { id: "liefertag",     label: "Erster Liefertag",             desc: "Energielieferung startet" },
  { id: "abschluss",     label: "Abgeschlossen",                desc: "Wechsel erfolgreich — Empfehlung anfragen" },
];

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

// ─── ProvisionsTracker ───────────────────────────────────────────────────────
const PROVISION_STATUS = [
  { id: "offen",      label: "Offen",      icon: "⏳" },
  { id: "gebucht",    label: "Gebucht",    icon: "📋" },
  { id: "ausgezahlt", label: "Ausgezahlt", icon: "✅" },
];

function ProvisionsTracker({ lead, onUpdateField }) {
  const provision = lead.provision || {};

  const save = async (updates) => {
    await onUpdateField(lead.id, "provision", { ...provision, ...updates });
  };

  return (
    <div className="provisions-tracker">
      <h3 style={{ margin: "0 0 12px", fontSize: "0.95rem", fontWeight: 800, color: "#0f172a" }}>💶 Provisions-Tracker</h3>
      <div className="provision-grid">
        <div className="provision-field">
          <label>Provisionsbetrag (€)</label>
          <input type="number" step="0.01" min="0" placeholder="z.B. 250" value={provision.amount || ""} onChange={e => save({ amount: e.target.value })} />
        </div>
        <div className="provision-field">
          <label>Erwartete Auszahlung</label>
          <input type="date" value={provision.expectedDate || ""} onChange={e => save({ expectedDate: e.target.value })} />
        </div>
        <div className="provision-field">
          <label>Tatsächliche Auszahlung</label>
          <input type="date" value={provision.actualDate || ""} onChange={e => save({ actualDate: e.target.value })} />
        </div>
        <div className="provision-field">
          <label>Notiz</label>
          <input type="text" placeholder="z.B. Maklervertrag #12345" value={provision.note || ""} onChange={e => save({ note: e.target.value })} />
        </div>
      </div>
      <div className="provision-status-row">
        {PROVISION_STATUS.map(s => (
          <button key={s.id} className={`provision-status-btn ${provision.status === s.id ? "active" : ""}`} onClick={() => save({ status: s.id })}>
            {s.icon} {s.label}
          </button>
        ))}
      </div>
      {provision.status === "ausgezahlt" && provision.amount && (
        <div className="provision-confirmed">
          ✅ {formatEuro(parseFloat(provision.amount))} ausgezahlt{provision.actualDate ? ` am ${formatDate(provision.actualDate)}` : ""}
        </div>
      )}
    </div>
  );
}

// ─── PowerDialer ─────────────────────────────────────────────────────────────
function PowerDialer({ leads, user, onLogCall, onUpdateField, onClose }) {
  const queue = useMemo(() => {
    return leads
      .filter(l => l.phone && l.status !== "Verloren")
      .sort((a, b) => {
        const s = l => (isOverdue(l.followUp) ? 100 : 0) + (isTodayDue(l.followUp) ? 50 : 0) + calculateLeadScore(l);
        return s(b) - s(a);
      });
  }, [leads]);

  const [idx, setIdx] = useState(0);
  const [stats, setStats] = useState({ called: 0, reached: 0, appointments: 0 });
  const [showLog, setShowLog] = useState(false);
  const [logOutcome, setLogOutcome] = useState(CALL_OUTCOMES[0]);
  const [logNote, setLogNote] = useState("");
  const [saving, setSaving] = useState(false);

  const current = queue[idx] || null;
  const progress = queue.length > 0 ? Math.round((idx / queue.length) * 100) : 100;

  const advance = () => {
    setIdx(i => i + 1);
    setShowLog(false);
    setLogNote("");
    setLogOutcome(CALL_OUTCOMES[0]);
  };

  const logAndAdvance = async (outcome, note = "") => {
    if (!current) return;
    setSaving(true);
    await onLogCall(current.id, { outcome, notes: note, duration: "" });
    const reached = !["Kein Kontakt", "Mailbox hinterlassen"].includes(outcome);
    const appt = outcome === "Termin vereinbart";
    if (appt) await onUpdateField(current.id, "followUp", new Date().toISOString().split("T")[0]);
    setStats(prev => ({ called: prev.called + 1, reached: prev.reached + (reached ? 1 : 0), appointments: prev.appointments + (appt ? 1 : 0) }));
    setSaving(false);
    advance();
  };

  return (
    <div className="modal-backdrop" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal power-dialer-modal">
        {idx >= queue.length || queue.length === 0 ? (
          <div className="dialer-done">
            <div style={{ fontSize: "2.5rem" }}>🏁</div>
            <h3 style={{ color: "#f1f5f9", margin: "8px 0" }}>Session abgeschlossen</h3>
            <div style={{ display: "flex", gap: 20, margin: "16px 0" }}>
              {[["📞", stats.called, "Anrufe"], ["✅", stats.reached, "Erreicht"], ["📅", stats.appointments, "Termine"]].map(([icon, val, label]) => (
                <div key={label} style={{ textAlign: "center" }}>
                  <div style={{ fontSize: "1.6rem", fontWeight: 900, color: "#f1f5f9" }}>{icon} {val}</div>
                  <div style={{ fontSize: "0.72rem", color: "#64748b" }}>{label}</div>
                </div>
              ))}
            </div>
            <button className="dialer-close-btn" onClick={onClose}>Schließen</button>
          </div>
        ) : (
          <div className="power-dialer">
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <div>
                <strong style={{ color: "#f1f5f9", fontSize: "1rem" }}>⚡ Power Dialer</strong>
                <span style={{ color: "#64748b", marginLeft: 10, fontSize: "0.8rem" }}>Anruf {idx + 1} / {queue.length}</span>
              </div>
              <div style={{ display: "flex", gap: 12, alignItems: "center", fontSize: "0.8rem", color: "#64748b" }}>
                <span title="Anrufe">📞 {stats.called}</span>
                <span title="Erreicht">✅ {stats.reached}</span>
                <span title="Termine">📅 {stats.appointments}</span>
                <button className="drawer-close-btn" onClick={onClose} style={{ marginLeft: 4 }}>✕</button>
              </div>
            </div>
            <div className="dialer-progress">
              <div className="dialer-progress-bar"><div className="dialer-progress-fill" style={{ width: `${progress}%` }} /></div>
              <span className="dialer-progress-label">{progress}%</span>
            </div>
            <div className="dialer-card">
              <div className="dialer-context">
                <span className={`health-pill ${getLeadTemperature(current).tone}`}>{getLeadTemperature(current).label}</span>
                {isOverdue(current.followUp) && <span className="dialer-chip hot">⏰ Überfällig</span>}
                {isOpenCancellationWindow(current.contractEnd) && <span className="dialer-chip hot">🔔 Kündigungsfenster</span>}
              </div>
              <p className="dialer-company">{current.company || current.person}</p>
              <p className="dialer-person">{current.person}</p>
              <a className="dialer-call-btn" href={`tel:${current.phone}`}>📞 {current.phone}</a>
              {current.phone && (
                <a className="dialer-wa-btn" href={`https://wa.me/${formatWaPhone(current.phone)}`} target="_blank" rel="noreferrer">💬 WhatsApp</a>
              )}
              <div className="dialer-context" style={{ marginTop: 6 }}>
                {current.currentProvider && <span className="dialer-chip">Aktuell: {current.currentProvider}</span>}
                {current.consumption && <span className="dialer-chip">{parseInt(current.consumption).toLocaleString("de-DE")} kWh</span>}
                {current.annualCosts && <span className="dialer-chip">€{parseInt(current.annualCosts).toLocaleString("de-DE")}/Jahr</span>}
                {current.followUp && <span className="dialer-chip">Follow-up: {formatDate(current.followUp)}</span>}
              </div>
              {(current.callLogs || []).length > 0 && (
                <p className="dialer-last-note">
                  Letzter Anruf: {current.callLogs[current.callLogs.length - 1].outcome}
                  {current.callLogs[current.callLogs.length - 1].notes ? ` — ${current.callLogs[current.callLogs.length - 1].notes}` : ""}
                </p>
              )}
            </div>
            {showLog ? (
              <div className="dialer-log">
                <select className="dialer-outcome-select" value={logOutcome} onChange={e => setLogOutcome(e.target.value)}>
                  {CALL_OUTCOMES.map(o => <option key={o}>{o}</option>)}
                </select>
                <textarea className="dialer-note" placeholder="Gesprächsnotiz (optional)..." value={logNote} onChange={e => setLogNote(e.target.value)} rows={2} />
                <div className="dialer-actions">
                  <button className="dialer-skip-btn" onClick={() => setShowLog(false)}>Abbrechen</button>
                  <button className="dialer-next-btn logged" onClick={() => logAndAdvance(logOutcome, logNote)} disabled={saving}>
                    {saving ? "..." : "Speichern & Weiter"}
                  </button>
                </div>
              </div>
            ) : (
              <div className="dialer-log">
                <div className="dialer-log-row" style={{ flexWrap: "wrap", gap: 7 }}>
                  {[["❌ Kein Kontakt", "Kein Kontakt"], ["📱 Mailbox", "Mailbox hinterlassen"], ["📅 Termin", "Termin vereinbart"], ["✅ Abschluss", "Abschluss"]].map(([label, outcome]) => (
                    <button key={outcome} className="dialer-next-btn" style={{ flex: "1 1 45%", fontSize: "0.82rem" }} onClick={() => logAndAdvance(outcome)} disabled={saving}>
                      {label}
                    </button>
                  ))}
                </div>
                <div className="dialer-actions">
                  <button className="dialer-skip-btn" onClick={() => setShowLog(true)}>📝 Gespräch protokollieren</button>
                  <button className="dialer-skip-btn" onClick={advance}>Überspringen →</button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── NEW: BulkActionBar ───────────────────────────────────────────────────────
function BulkActionBar({ selectedCount, onDelete, onCancel, onSelectAll, totalCount }) {
  const [confirmDelete, setConfirmDelete] = useState(false);
  return (
    <div className="bulk-action-bar">
      <div className="bulk-action-left">
        <span className="bulk-count">{selectedCount} Lead{selectedCount !== 1 ? "s" : ""} ausgewählt</span>
        <button className="bulk-select-all-btn" onClick={onSelectAll}>
          {selectedCount === totalCount ? "Alle abwählen" : "Alle auswählen"}
        </button>
      </div>
      <div className="bulk-action-right">
        {confirmDelete ? (
          <div className="bulk-confirm-row">
            <span className="bulk-confirm-text">⚠️ {selectedCount} Leads wirklich löschen?</span>
            <button className="danger-btn" onClick={() => { onDelete(); setConfirmDelete(false); }}>Ja, löschen</button>
            <button className="ghost-btn" onClick={() => setConfirmDelete(false)}>Abbrechen</button>
          </div>
        ) : (
          <button className="danger-btn" onClick={() => setConfirmDelete(true)}>
            🗑 {selectedCount} Leads löschen
          </button>
        )}
        <button className="ghost-btn" onClick={onCancel}>Abbrechen</button>
      </div>
    </div>
  );
}

// ─── App ──────────────────────────────────────────────────────────────────────
function App() {
  const [user, setUser] = useState(null);
  const [userProfile, setUserProfile] = useState(null);
  const [avatarUploading, setAvatarUploading] = useState(false);
  const [userRole, setUserRole] = useState("agent");
  const [canAssignAdmins, setCanAssignAdmins] = useState(false);
  const [teamId, setTeamId] = useState(null);
  const [teamMembers, setTeamMembers] = useState([]);
  const [leads, setLeads] = useState([]);
  const [searchTerm, setSearchTerm] = useState("");
  const [filterPriority, setFilterPriority] = useState("all");
  const [filterStatus, setFilterStatus] = useState("all");
  const [loading, setLoading] = useState(false);
  const [activeTab, setActiveTab] = useState("leads");
  const [notifSent, setNotifSent] = useState(false);
  const [selectedLeadId, setSelectedLeadId] = useState(null);
  const [viewMode, setViewMode] = useState("list");
  const [showNewLeadModal, setShowNewLeadModal] = useState(false);
  const [showImportModal, setShowImportModal] = useState(false);
  const [showPowerDialer, setShowPowerDialer] = useState(false);
  const [smartView, setSmartView] = useState("all");
  const [sortMode, setSortMode] = useState("priority");
  const [kpiFocus, setKpiFocus] = useState("all");
  const [leadsPerPage, setLeadsPerPage] = useState(25);
  const [currentPage, setCurrentPage] = useState(1);

  // NEW: multiselect state
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedLeadIds, setSelectedLeadIds] = useState(new Set());
  const resurfacingLockRef = useRef(new Set());

  const applyKpiFocus = (focus) => {
    setKpiFocus(focus);
    if (focus === "overdue" || focus === "today") { setSortMode("followUp"); setSmartView("action"); return; }
    if (focus === "inactive48") { setSortMode("activity"); setSmartView("action"); return; }
    if (focus === "cancellation" || focus === "priorityA") { setSortMode("priority"); setSmartView("all"); return; }
    if (focus === "won") { setSortMode("activity"); setSmartView("won"); return; }
    setSmartView("all");
  };

  const selectedLead = useMemo(() => leads.find(l => l.id === selectedLeadId) || null, [leads, selectedLeadId]);

  useEffect(() => {
    const handle = (e) => {
      if (e.key === "Escape") {
        if (selectionMode) { setSelectionMode(false); setSelectedLeadIds(new Set()); }
        else if (showNewLeadModal) setShowNewLeadModal(false);
        else if (selectedLeadId) setSelectedLeadId(null);
      }
      if (e.key === "n" && !showNewLeadModal && !selectedLeadId && !selectionMode &&
        !["INPUT", "TEXTAREA", "SELECT"].includes(document.activeElement.tagName)) {
        setShowNewLeadModal(true);
      }
    };
    window.addEventListener("keydown", handle);
    return () => window.removeEventListener("keydown", handle);
  }, [showNewLeadModal, selectedLeadId, selectionMode]);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (currentUser) => {
      setUser(currentUser);
      if (!currentUser) { setTeamId(null); setTeamMembers([]); setCanAssignAdmins(false); setUserProfile(null); return; }
      const userRef = doc(db, "users", currentUser.uid);
      try {
        const userDoc = await getDoc(userRef);
        if (userDoc.exists() && userDoc.data().teamId) {
          const existingProfile = userDoc.data();
          const inferredRole = existingProfile.role || (existingProfile.teamId === `team-${currentUser.uid}` ? "admin" : "agent");
          const inferredCanAssignAdmins = existingProfile.canAssignAdmins === true || inferredRole === "admin";

          // Backfill legacy profiles so rules and client permissions stay in sync.
          if (!existingProfile.role || typeof existingProfile.canAssignAdmins === "undefined") {
            await setDoc(userRef, {
              role: inferredRole,
              canAssignAdmins: inferredCanAssignAdmins,
            }, { merge: true });
          }

          setUserProfile({ ...existingProfile, role: inferredRole, canAssignAdmins: inferredCanAssignAdmins });
          setTeamId(existingProfile.teamId);
          setUserRole(inferredRole);
          setCanAssignAdmins(inferredCanAssignAdmins);
        } else {
          const newTeamId = `team-${currentUser.uid}`;
          const newProfile = { email: currentUser.email, teamId: newTeamId, role: "admin", createdAt: new Date().toISOString(), canAssignAdmins: true };
          await setDoc(userRef, newProfile, { merge: true });
          setUserProfile(newProfile);
          setTeamId(newTeamId); setUserRole("admin"); setCanAssignAdmins(true);
        }
        const normalizedCurrentEmail = (currentUser.email || "").trim().toLowerCase();
        if (normalizedCurrentEmail) {
          const invQ = query(collection(db, "invitations"), where("invitedEmail", "==", normalizedCurrentEmail), where("status", "==", "pending"));
          const invSnap = await getDocs(invQ);
          if (!invSnap.empty) {
            const pendingInvites = invSnap.docs.map(d => ({ id: d.id, ref: d.ref, ...d.data() })).sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));
            const activeInvite = pendingInvites[0];
            await updateDoc(doc(db, "users", currentUser.uid), { teamId: activeInvite.teamId, role: activeInvite.role || "agent" });
            for (const invitation of pendingInvites) { await updateDoc(invitation.ref, { status: invitation.id === activeInvite.id ? "accepted" : "superseded" }); }
            setTeamId(activeInvite.teamId); setUserRole(activeInvite.role || "agent"); setCanAssignAdmins(false);
          }
        }
        const urlToken = new URLSearchParams(window.location.search).get("invite");
        if (urlToken) {
          const result = await acceptInviteLink(urlToken, currentUser.uid, currentUser.email);
          if (result.ok) { setTeamId(result.teamId); setUserRole(result.role); setCanAssignAdmins(false); window.history.replaceState({}, document.title, window.location.pathname); }
        }
      } catch (e) { console.error(e); setTeamId(`team-${currentUser.uid}`); setCanAssignAdmins(false); }
    });
    return unsubscribe;
  }, []);

  const uploadUserAvatar = async (file) => {
    if (!user) return;
    if (!file.type.startsWith("image/")) {
      alert("Bitte nur Bilddateien auswählen.");
      return;
    }
    if (file.size > 2 * 1024 * 1024) {
      alert("Profilbild ist zu groß (max 2MB).");
      return;
    }

    setAvatarUploading(true);
    try {
      const dataUrl = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = (event) => resolve(event.target?.result || "");
        reader.onerror = () => reject(new Error("Lesefehler beim Bild"));
        reader.readAsDataURL(file);
      });

      if (!dataUrl) throw new Error("Ungültiges Bildformat");

      await setDoc(doc(db, "users", user.uid), {
        avatarDataUrl: dataUrl,
        avatarUpdatedAt: new Date().toISOString(),
      }, { merge: true });

      setUserProfile((prev) => ({ ...(prev || {}), avatarDataUrl: dataUrl }));
    } catch (error) {
      console.error(error);
      alert(`Profilbild konnte nicht gespeichert werden. (${error?.message || "Unbekannter Fehler"})`);
    } finally {
      setAvatarUploading(false);
    }
  };

  const loadTeamMembers = useCallback(async () => {
    if (!teamId) return;
    try {
      const q = query(collection(db, "users"), where("teamId", "==", teamId));
      const snap = await getDocs(q);
      setTeamMembers(snap.docs.map(d => ({ id: d.id, ...d.data() })));
    } catch (e) { console.error(e); }
  }, [teamId]);

  useEffect(() => { loadTeamMembers(); }, [loadTeamMembers]);

  useEffect(() => {
    if (!user || !teamId) { setLeads([]); return; }
    const q = userRole === "admin"
      ? query(collection(db, "leads"), where("teamId", "==", teamId))
      : query(collection(db, "leads"), where("teamId", "==", teamId), where("ownerUserId", "==", user.uid));
    return onSnapshot(q, snap => setLeads(snap.docs.map(d => ({ id: d.id, ...d.data() }))));
  }, [user, teamId, userRole]);

  useEffect(() => {
    if (!user || !leads.length || notifSent) return;
    const overdueLeads = leads.filter(l => isOverdue(l.followUp));
    const cancellationLeads = leads.filter(l => isOpenCancellationWindow(l.contractEnd));
    if (overdueLeads.length > 0 || cancellationLeads.length > 0) {
      fetch("/api/send-notification", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ to: user.email, overdueCount: overdueLeads.length, cancellationCount: cancellationLeads.length }) })
        .then(() => setNotifSent(true)).catch(() => {});
    }
  }, [user, leads, notifSent]);

  useEffect(() => {
    if (!user || !teamId || leads.length === 0) return;
    const todayIso = new Date().toISOString().split("T")[0];
    const candidates = leads.filter((lead) =>
      lead.status === "Gewonnen"
      && !lead.renewalResurfacedAt
      && isWonLeadRenewalDue(lead, RENEWAL_RESURFACE_MONTHS)
    );

    candidates.forEach(async (lead) => {
      if (resurfacingLockRef.current.has(lead.id)) return;
      resurfacingLockRef.current.add(lead.id);
      try {
        const now = new Date().toISOString();
        await updateDoc(doc(db, "leads", lead.id), {
          status: "Nachfassen",
          followUp: lead.followUp || todayIso,
          renewalResurfacedAt: now,
          renewalResurfaceReason: `auto-${RENEWAL_RESURFACE_MONTHS}m-before-contract-end`,
          statusHistory: [
            ...(lead.statusHistory || []),
            { from: "Gewonnen", to: "Nachfassen", timestamp: now, author: "System" },
          ],
          comments: [
            ...(lead.comments || []),
            {
              timestamp: now,
              author: "System",
              text: `🔁 Automatische Wiedervorlage: ${RENEWAL_RESURFACE_MONTHS} Monate vor Vertragsende wieder in aktive Pipeline überführt.`,
            },
          ],
        });
      } catch (e) {
        console.error("Auto-Resurface fehlgeschlagen", e);
      } finally {
        resurfacingLockRef.current.delete(lead.id);
      }
    });
  }, [leads, teamId, user]);

  const uploadAttachmentToStorage = async (leadId, file) => {
    if (!file) throw new Error("Datei fehlt");
    if (file.size > MAX_ATTACHMENT_SIZE_BYTES) {
      throw new Error(`${file.name} ist größer als 10MB`);
    }
    const safeName = (file.name || "datei").replace(/[^a-zA-Z0-9._-]/g, "_");
    const path = `leads/${teamId}/${leadId}/${buildAttachmentId()}-${safeName}`;
    const fileRef = storageRef(storage, path);
    await uploadBytes(fileRef, file, { contentType: file.type || "application/octet-stream" });
    const url = await getDownloadURL(fileRef);
    return {
      id: buildAttachmentId(),
      name: file.name,
      size: file.size,
      type: file.type || "",
      url,
      storagePath: path,
      uploadedAt: new Date().toISOString(),
    };
  };

  const addLead = async (form, onSuccess) => {
    if (!form.person.trim()) return alert("Bitte Ansprechpartner eintragen.");
    if (!form.phone.trim() || !form.email.trim() || !form.postalCode.trim()) return alert("Bitte Telefon, E-Mail und PLZ ausfüllen.");
    if (!teamId) return alert("Team-ID fehlt.");
    if (form.contractEnd !== "unknown" && isContractEndUnrealistic(form.contractEnd)) {
      if (!window.confirm("Vertragsende liegt in der Vergangenheit. Fortfahren?")) return;
    }
    setLoading(true);
    try {
      const { attachments: rawAttachments = [], ...formData } = form;
      const createdAt = new Date().toISOString();
      const docRef = await addDoc(collection(db, "leads"), {
        ...formData,
        attachments: [],
        teamId,
        ownerUserId: user.uid,
        ownerEmail: user.email,
        createdBy: { uid: user.uid, email: user.email, timestamp: createdAt },
        status: "Neu", createdAt, comments: [], callLogs: [],
      });

      const filesToUpload = rawAttachments
        .map((attachment) => attachment?.file)
        .filter((file) => file instanceof File);

      if (filesToUpload.length > 0) {
        try {
          const uploadedAttachments = await Promise.all(
            filesToUpload.map((file) => uploadAttachmentToStorage(docRef.id, file))
          );
          await updateDoc(doc(db, "leads", docRef.id), { attachments: uploadedAttachments });
        } catch (uploadError) {
          console.error(uploadError);
          alert(`Lead wurde angelegt, aber Anhänge konnten nicht vollständig hochgeladen werden. (${uploadError?.code || uploadError?.message || "Unbekannter Fehler"})`);
        }
      }

      setLoading(false);
      onSuccess?.();
      setSelectedLeadId(docRef.id);
    } catch (e) {
      alert(`Fehler: ${e?.code || e?.message}`);
      setLoading(false);
    }
  };

  const onImportLeads = async (importedLeads) => {
    if (!teamId || !user) throw new Error("Team/User nicht gefunden");
    const createdAt = new Date().toISOString();
    for (const lead of importedLeads) {
      await addDoc(collection(db, "leads"), {
        ...lead, teamId, ownerUserId: user.uid, ownerEmail: lead.createdBy?.email || user.email,
        createdBy: { uid: user.uid, email: lead.createdBy?.email || user.email, timestamp: createdAt },
        status: lead.status || "Neu", createdAt,
        comments: lead.extras ? [{ timestamp: createdAt, text: `📥 CSV-Import: ${JSON.stringify(lead.extras)}`, author: user.email }] : [],
        callLogs: [],
      });
    }
  };

  const updateLeadStatus = async (id, newStatus) => {
    const leadDoc = leads.find((lead) => lead.id === id);
    if (!leadDoc || leadDoc.status === newStatus) return;
    try {
      await updateDoc(doc(db, "leads", id), {
        status: newStatus,
        statusHistory: [...(leadDoc.statusHistory || []), { from: leadDoc.status, to: newStatus, timestamp: new Date().toISOString(), author: user.email }],
      });
    } catch (e) { console.error(e); }
  };

  const updateLeadField = async (id, field, value) => {
    try { await updateDoc(doc(db, "leads", id), { [field]: value }); } catch (e) { console.error(e); }
  };

  const logCall = async (leadId, callData) => {
    const leadDoc = leads.find(l => l.id === leadId);
    if (!leadDoc) return;
    try { await updateDoc(doc(db, "leads", leadId), { callLogs: [...(leadDoc.callLogs || []), { ...callData, timestamp: new Date().toISOString(), author: user.email }] }); }
    catch (e) { console.error(e); }
  };

  const deleteLead = async (id) => {
    try { await deleteDoc(doc(db, "leads", id)); } catch (e) { console.error(e); }
  };

  // NEW: Bulk delete (admin only)
  const bulkDeleteLeads = async () => {
    if (userRole !== "admin") return;
    const ids = Array.from(selectedLeadIds);
    for (const id of ids) {
      try { await deleteDoc(doc(db, "leads", id)); } catch (e) { console.error(e); }
    }
    setSelectedLeadIds(new Set());
    setSelectionMode(false);
  };

  const toggleLeadCheck = (id) => {
    setSelectedLeadIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const addLeadAttachment = async (leadId, files) => {
    const selectedFiles = Array.from(files || []);
    if (selectedFiles.length === 0) return;
    const oversized = selectedFiles.filter((file) => file.size > MAX_ATTACHMENT_SIZE_BYTES);
    if (oversized.length > 0) {
      alert(`${oversized[0].name} ist zu groß (max 10MB pro Datei)`);
    }

    const validFiles = selectedFiles.filter((file) => file.size <= MAX_ATTACHMENT_SIZE_BYTES);
    if (validFiles.length === 0) return;

    const leadDoc = leads.find((lead) => lead.id === leadId);
    if (!leadDoc) return;

    try {
      const uploadedAttachments = await Promise.all(
        validFiles.map((file) => uploadAttachmentToStorage(leadId, file))
      );
      await updateDoc(doc(db, "leads", leadId), {
        attachments: [...(leadDoc.attachments || []), ...uploadedAttachments],
      });
    } catch (e) {
      console.error(e);
      alert(`Anhänge konnten nicht hochgeladen werden. (${e?.code || e?.message || "Unbekannter Fehler"})`);
    }
  };

  const removeLeadAttachment = async (leadId, attId) => {
    const leadDoc = leads.find(l => l.id === leadId);
    if (!leadDoc) return;
    try { await updateDoc(doc(db, "leads", leadId), { attachments: leadDoc.attachments.filter(a => a.id !== attId) }); }
    catch (e) { console.error(e); }
  };

  const filteredLeads = useMemo(() => {
    const sl = searchTerm.toLowerCase();
    return sortLeads(leads.filter(l => {
      const match = !sl || (l.company || "").toLowerCase().includes(sl) || (l.person || "").toLowerCase().includes(sl) || (l.phone || "").includes(searchTerm) || (l.email || "").toLowerCase().includes(sl);
      if (!match) return false;
      if (filterPriority !== "all" && calculatePriority(l) !== filterPriority) return false;
      if (filterStatus !== "all" && l.status !== filterStatus) return false;
      if (smartView === "mine" && getLeadOwnerEmail(l) !== user.email) return false;
      if (smartView === "action" && !(isOverdue(l.followUp) || isTodayDue(l.followUp))) return false;
      if (smartView === "hot" && getLeadTemperature(l).tone !== "hot") return false;
      if (smartView === "won" && l.status !== "Gewonnen") return false;
      if (smartView === "renewals" && !l.renewalResurfacedAt) return false;
      if (kpiFocus === "overdue" && !isOverdue(l.followUp)) return false;
      if (kpiFocus === "today" && !isTodayDue(l.followUp)) return false;
      if (kpiFocus === "inactive48" && !isLeadInactiveForHours(l, 48)) return false;
      if (kpiFocus === "cancellation" && !isOpenCancellationWindow(l.contractEnd)) return false;
      if (kpiFocus === "priorityA" && calculatePriority(l) !== "A") return false;
      if (kpiFocus === "won" && l.status !== "Gewonnen") return false;
      return true;
    }), sortMode);
  }, [leads, searchTerm, filterPriority, filterStatus, smartView, sortMode, user, kpiFocus]);

  const activePipelineLeads = useMemo(
    () => filteredLeads.filter((lead) => lead.status !== "Gewonnen" || isWonLeadRenewalDue(lead, RENEWAL_RESURFACE_MONTHS)),
    [filteredLeads],
  );

  const totalPipelinePages = Math.max(1, Math.ceil(activePipelineLeads.length / leadsPerPage));

  useEffect(() => {
    setCurrentPage(1);
  }, [searchTerm, filterPriority, filterStatus, smartView, sortMode, kpiFocus, leadsPerPage, viewMode]);

  useEffect(() => {
    if (currentPage > totalPipelinePages) setCurrentPage(totalPipelinePages);
  }, [currentPage, totalPipelinePages]);

  const paginatedActiveLeads = useMemo(() => {
    const start = (currentPage - 1) * leadsPerPage;
    return activePipelineLeads.slice(start, start + leadsPerPage);
  }, [activePipelineLeads, currentPage, leadsPerPage]);

  const wonBundleLeads = useMemo(() => {
    const bucket = filteredLeads.filter((lead) => lead.status === "Gewonnen" && !isWonLeadRenewalDue(lead, RENEWAL_RESURFACE_MONTHS));
    return [...bucket].sort((a, b) => {
      const ma = getMonthsUntil(a.contractEnd);
      const mb = getMonthsUntil(b.contractEnd);
      return ma - mb;
    });
  }, [filteredLeads]);

  const stats = useMemo(() => ({
    totalLeads: leads.length,
    wonLeads: leads.filter(l => l.status === "Gewonnen").length,
    overdue: leads.filter(l => isOverdue(l.followUp)).length,
    dueToday: leads.filter(l => isTodayDue(l.followUp)).length,
    inactive48: leads.filter(l => isLeadInactiveForHours(l, 48)).length,
    priorityA: leads.filter(l => calculatePriority(l) === "A").length,
    openCancellation: leads.filter(l => isOpenCancellationWindow(l.contractEnd)).length,
    movedEnergyKwh: leads.reduce((sum, lead) => sum + (Number.parseInt(lead.consumption || 0, 10) || 0), 0),
    totalUmsatzPotential: leads.reduce((s, l) => s + calculateUmsatzPotential(l.consumption), 0),
    closingRate: leads.length > 0 ? Math.round((leads.filter(l => l.status === "Gewonnen").length / leads.length) * 100) : 0,
  }), [leads]);

  const actionQueueLeads = useMemo(() =>
    leads
      .filter((lead) => isLeadInactiveForHours(lead, 48))
      .sort((a, b) => getHoursSince(getLastActivityTimestamp(b)) - getHoursSince(getLastActivityTimestamp(a)))
      .slice(0, 5),
  [leads]);

  const closingRateCoach = useMemo(() => {
    if (stats.closingRate < 15) {
      return {
        tone: "alert",
        title: "Closing unter 15%: jetzt aktiv eingreifen",
        tips: [
          "Überfällige Leads heute priorisiert anrufen.",
          "Angebots-Leads ohne Touchpoint >48h zuerst bearbeiten.",
          "Jeden Kontakt mit konkretem Follow-up-Datum abschließen.",
        ],
      };
    }
    if (stats.closingRate < 25) {
      return {
        tone: "warning",
        title: "Closing 15-24%: Disziplin erhöht Conversion",
        tips: [
          "Follow-ups konsequent im 24-48h Rhythmus setzen.",
          "Einwandbehandlung im KI-Tab vor Calls vorbereiten.",
          "Pipeline-Mitte (Angebot/Nachfassen) täglich bewegen.",
        ],
      };
    }
    return {
      tone: "success",
      title: "Closing stark: Erfolgsroutine skalieren",
      tips: [
        "Top-Argumente aus gewonnenen Leads als Script sichern.",
        "High-Potential-Leads mit gleichem Playbook spiegeln.",
        "Hot-Leads weiter mit kurzen 24h-Zyklen bearbeiten.",
      ],
    };
  }, [stats.closingRate]);

  if (!user) return <LoginPage onLogin={setUser} user={user} />;

  return (
    <div className="app-layout">
      {loading && <LeadLoadingOverlay />}
      <Sidebar
        activeTab={activeTab}
        setActiveTab={setActiveTab}
        stats={stats}
        user={user}
        userRole={userRole}
        userProfile={userProfile}
        avatarUploading={avatarUploading}
        onAvatarUpload={uploadUserAvatar}
        onSignOut={() => signOut(auth)}
      />

      <div className="main-content">
        {activeTab === "leads" && (
          <>
            <div className="main-toolbar">
              <div className="toolbar-left">
                <h1 className="page-title">Lead-Pipeline</h1>
                <span className="lead-count-badge">{activePipelineLeads.length}</span>
              </div>
              <div className="toolbar-right">
                <input type="text" placeholder="🔍 Suche nach Firma, Kontakt, Telefon..." value={searchTerm} onChange={e => setSearchTerm(e.target.value)} className="toolbar-search" />
                <select value={sortMode} onChange={e => setSortMode(e.target.value)} className="filter-select-inline compact">
                  <option value="priority">Sortiert nach Priorität</option>
                  <option value="potential">Nach Potential</option>
                  <option value="activity">Nach Aktivität</option>
                  <option value="followUp">Nach Follow-up</option>
                </select>
                <div className="view-toggle-group">
                  <button className={`view-toggle-btn ${viewMode === "list" ? "active" : ""}`} onClick={() => setViewMode("list")}>≡ Liste</button>
                  <button className={`view-toggle-btn ${viewMode === "kanban" ? "active" : ""}`} onClick={() => setViewMode("kanban")}>⊞ Pipeline</button>
                </div>
                {/* NEW: Multiselect toggle (admin only) */}
                {userRole === "admin" && (
                  <button
                    className={`selection-mode-btn ${selectionMode ? "active" : ""}`}
                    onClick={() => { setSelectionMode(v => !v); setSelectedLeadIds(new Set()); }}
                    title="Mehrfachauswahl"
                  >
                    {selectionMode ? "✕ Auswahl" : "☑ Auswählen"}
                  </button>
                )}
              </div>
            </div>

            {/* NEW: Bulk action bar */}
            {selectionMode && selectedLeadIds.size > 0 && (
              <BulkActionBar
                selectedCount={selectedLeadIds.size}
                totalCount={activePipelineLeads.length}
                onDelete={bulkDeleteLeads}
                onCancel={() => { setSelectionMode(false); setSelectedLeadIds(new Set()); }}
                onSelectAll={() => {
                  if (selectedLeadIds.size === activePipelineLeads.length) {
                    setSelectedLeadIds(new Set());
                  } else {
                    setSelectedLeadIds(new Set(activePipelineLeads.map(l => l.id)));
                  }
                }}
              />
            )}
            {selectionMode && selectedLeadIds.size === 0 && (
              <div className="bulk-hint-bar">
                ☑ Mehrfachauswahl aktiv – Leads anklicken zum Auswählen
                <button className="ghost-btn-sm" onClick={() => { setSelectionMode(false); setSelectedLeadIds(new Set()); }} style={{ marginLeft: 12 }}>Abbrechen</button>
              </div>
            )}

            {/* Smart-View Chips — replaces the removed CommandCenter */}
            <div className="smart-view-bar">
              {[
                { id: "all",    label: "Alle Leads" },
                { id: "mine",   label: "Meine Leads" },
                { id: "action", label: "Action Queue" },
                { id: "hot",    label: "Hot Deals" },
                { id: "renewals", label: "Renewals" },
                { id: "won",    label: "Gewonnen" },
              ].map(item => (
                <button
                  key={item.id}
                  className={`smart-view-chip ${smartView === item.id ? "active" : ""}`}
                  onClick={() => { setSmartView(item.id); setKpiFocus("all"); }}
                >
                  {item.label}
                </button>
              ))}
            </div>

            <div className="filter-bar">
              <select value={filterPriority} onChange={e => setFilterPriority(e.target.value)} className="filter-select-inline">
                <option value="all">Alle Heat-Level</option>
                <option value="A">Hot</option><option value="B">Warm</option><option value="C">Cold</option>
              </select>
              <select value={filterStatus} onChange={e => setFilterStatus(e.target.value)} className="filter-select-inline">
                <option value="all">Alle Status</option>
                {STATUS_OPTIONS.map(s => <option key={s}>{s}</option>)}
              </select>
              {kpiFocus !== "all" && (
                <button type="button" className="kpi-reset-btn" onClick={() => applyKpiFocus("all")}>KPI-Fokus zurücksetzen</button>
              )}
              <span className="filter-result-count">{activePipelineLeads.length} aktiv · {wonBundleLeads.length} gewonnen gebündelt</span>
            </div>

            <div className="kpi-strip">
              <button type="button" className="kpi-item kpi-umsatz clickable" onClick={() => applyKpiFocus("all")}>
                <span className="kpi-val">{formatEnergyVolume(stats.movedEnergyKwh)}</span>
                <span className="kpi-label">Bewegte Energiemenge</span>
              </button>
              <button type="button" className={`kpi-item kpi-warning clickable ${kpiFocus === "overdue" ? "active" : ""}`} onClick={() => applyKpiFocus("overdue")}><span className="kpi-val">{stats.overdue}</span><span className="kpi-label">Überfällig</span></button>
              <button type="button" className={`kpi-item kpi-today clickable ${kpiFocus === "today" ? "active" : ""}`} onClick={() => applyKpiFocus("today")}><span className="kpi-val">{stats.dueToday}</span><span className="kpi-label">Heute fällig</span></button>
              <button type="button" className={`kpi-item clickable ${kpiFocus === "inactive48" ? "active" : ""}`} onClick={() => applyKpiFocus("inactive48")}><span className="kpi-val">{stats.inactive48}</span><span className="kpi-label">>48h ohne Aktivität</span></button>
              <button type="button" className={`kpi-item kpi-alert clickable ${kpiFocus === "cancellation" ? "active" : ""}`} onClick={() => applyKpiFocus("cancellation")}>
                <span className="kpi-val">{stats.openCancellation}</span>
                <span className="kpi-label two-line"><span>Kündigungs</span><span>fenster</span></span>
              </button>
              <button type="button" className={`kpi-item kpi-prio clickable ${kpiFocus === "priorityA" ? "active" : ""}`} onClick={() => applyKpiFocus("priorityA")}><span className="kpi-val">{stats.priorityA}</span><span className="kpi-label">Hot</span></button>
              <button type="button" className={`kpi-item clickable ${kpiFocus === "won" ? "active" : ""}`} onClick={() => applyKpiFocus("won")}><span className="kpi-val">{stats.wonLeads}</span><span className="kpi-label">Gewonnen</span></button>
            </div>

            <div className={`cockpit-action-card compact ${closingRateCoach.tone}`}>
              <div className="cockpit-action-head">
                <strong>{closingRateCoach.title}</strong>
                <span>Closing Rate: {stats.closingRate}%</span>
              </div>
              <ul className="cockpit-action-list">
                {closingRateCoach.tips.slice(0, 2).map((tip) => <li key={tip}>{tip}</li>)}
              </ul>
              {stats.inactive48 > 0 && (
                <div className="cockpit-action-queue">
                  <div className="cockpit-action-queue-head">
                    <strong>{stats.inactive48} Leads seit mehr als 48h ohne Aktivität</strong>
                    <button type="button" className="ghost-btn-sm" onClick={() => applyKpiFocus("inactive48")}>Jetzt priorisieren</button>
                  </div>
                  <div className="cockpit-action-queue-list">
                    {actionQueueLeads.slice(0, 3).map((lead) => (
                      <button key={lead.id} type="button" className="cockpit-action-lead" onClick={() => setSelectedLeadId(lead.id)}>
                        <span>{lead.company || lead.person || "Lead"}</span>
                        <small>Letzte Aktivität vor {Math.round(getHoursSince(getLastActivityTimestamp(lead)))}h</small>
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>

            <div className="lead-list-controls">
              <div className="lead-actions-inline">
                <button type="button" className="kpi-action-btn dialer" onClick={() => setShowPowerDialer(true)}>⚡ Power Dialer</button>
                <button type="button" className="kpi-action-btn import" onClick={() => setShowImportModal(true)}>📥 CSV importieren</button>
                <button type="button" className="kpi-action-btn create" onClick={() => setShowNewLeadModal(true)}>＋ Neuer Lead</button>
              </div>
              <div className="lead-pagination-inline">
                <label htmlFor="lead-page-size">Leads pro Seite</label>
                <select id="lead-page-size" value={leadsPerPage} onChange={(e) => setLeadsPerPage(Number(e.target.value))}>
                  <option value={25}>25</option>
                  <option value={50}>50</option>
                  <option value={100}>100</option>
                </select>
                <button type="button" className="ghost-btn-sm" disabled={currentPage <= 1} onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}>Zurück</button>
                <span>Seite {currentPage} / {totalPipelinePages}</span>
                <button type="button" className="ghost-btn-sm" disabled={currentPage >= totalPipelinePages} onClick={() => setCurrentPage((p) => Math.min(totalPipelinePages, p + 1))}>Weiter</button>
              </div>
            </div>

            {viewMode === "list" ? (
              <div className="leads-table-wrap">
                <div className="leads-table-header">
                  <div className="lth-checkbox" />
                  <div className="lth-signals">Signale</div>
                  <div className="lth-main">Unternehmen / Kontakt</div>
                  <div className="lth-energy">Energie</div>
                  <div className="lth-flags">Next step / Deal</div>
                  <div className="lth-status">Status</div>
                  <div className="lth-umsatz">Potential</div>
                  <div className="lth-followup">Nachfassen</div>
                  <div className="lth-activity">Aktivität</div>
                </div>
                {activePipelineLeads.length === 0 ? (
                  <div className="empty-leads">
                    <p>Keine Leads gefunden.</p>
                    <button className="new-lead-btn" onClick={() => setShowNewLeadModal(true)}>+ Ersten Lead anlegen</button>
                  </div>
                ) : (
                  paginatedActiveLeads.map(lead => (
                    <LeadRow
                      key={lead.id}
                      lead={lead}
                      onSelect={l => { if (!selectionMode) setSelectedLeadId(l.id); }}
                      isSelected={selectedLeadId === lead.id}
                      selectionMode={selectionMode}
                      isChecked={selectedLeadIds.has(lead.id)}
                      onToggleCheck={toggleLeadCheck}
                    />
                  ))
                )}
              </div>
            ) : (
              <KanbanBoard leads={paginatedActiveLeads} onSelectLead={l => setSelectedLeadId(l.id)} />
            )}

            {wonBundleLeads.length > 0 && (
              <div className="won-bundle-section">
                <div className="won-bundle-head">
                  <h3>Gewonnen gebündelt</h3>
                  <span>{wonBundleLeads.length} Leads außerhalb der aktiven Pipeline</span>
                </div>
                <div className="won-bundle-list">
                  {wonBundleLeads.map((lead) => {
                    const progress = getWechselProgress(lead);
                    const supplyConfirmed = hasSupplyConfirmation(lead);
                    const monthsUntilEnd = getMonthsUntil(lead.contractEnd);
                    return (
                      <button key={lead.id} type="button" className="won-bundle-card" onClick={() => setSelectedLeadId(lead.id)}>
                        <div className="won-bundle-title">{lead.company || lead.person || "Lead"}</div>
                        <div className="won-bundle-meta">Vertragsende: {formatDate(lead.contractEnd)}</div>
                        <div className="won-bundle-meta">Wechselstatus: {progress.completed}/{progress.total} Schritte</div>
                        <div className={`won-bundle-meta ${supplyConfirmed ? "ok" : "warn"}`}>
                          Belieferungsbestätigung: {supplyConfirmed ? "Vorhanden" : "Fehlt"}
                        </div>
                        {Number.isFinite(monthsUntilEnd) && monthsUntilEnd > 0 && (
                          <div className="won-bundle-meta">Wiedervorlage automatisch bei ≤ 6 Monaten Restlaufzeit</div>
                        )}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
          </>
        )}

        {activeTab === "dashboard" && (
          <div className="tab-page">
            <div className="main-toolbar"><h1 className="page-title">Dashboard</h1></div>
            <Dashboard leads={leads} teamMembers={teamMembers} />
          </div>
        )}

        {activeTab === "calendar" && (
          <CalendarView leads={leads} onOpenLead={(leadId) => {
            setSelectedLeadId(leadId);
            setActiveTab("leads");
          }} />
        )}

        {activeTab === "team" && (
          <div className="tab-page">
            <TeamManagement currentUser={user} teamId={teamId} teamMembers={teamMembers} onRefresh={loadTeamMembers} userRole={userRole} canAssignAdmins={canAssignAdmins} />
          </div>
        )}
      </div>

      {selectedLead && (
        <LeadDetailDrawer
          lead={selectedLead}
          onClose={() => setSelectedLeadId(null)}
          user={user}
          userRole={userRole}
          onUpdateField={updateLeadField}
          onUpdateStatus={updateLeadStatus}
          onDelete={deleteLead}
          onLogCall={logCall}
          onAddAttachment={addLeadAttachment}
          onRemoveAttachment={removeLeadAttachment}
        />
      )}

      {showNewLeadModal && (
        <NewLeadModal onClose={() => setShowNewLeadModal(false)} onSubmit={addLead} loading={loading} />
      )}

      {showImportModal && (
        <ImportModal isOpen={showImportModal} onClose={() => setShowImportModal(false)} leads={leads} users={teamMembers} currentUser={user} onImport={onImportLeads} />
      )}

      {showPowerDialer && (
        <PowerDialer
          leads={filteredLeads.length > 0 ? filteredLeads : leads}
          user={user}
          onLogCall={logCall}
          onUpdateField={updateLeadField}
          onClose={() => setShowPowerDialer(false)}
        />
      )}
    </div>
  );
}

export default App;
