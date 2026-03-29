import { WECHSEL_STEPS, RENEWAL_RESURFACE_MONTHS } from '../constants';
import { isOpenCancellationWindow, getRestLaufzeit, getMonthsUntil, isOverdue, isTodayDue, getHoursSince } from './dates';
import { getTotalDeliveryPoints, calculateUmsatzPotential } from './energy';

// ─── Lead Utilities ───────────────────────────────────────────────────────────
export const getLeadOwnerEmail = (lead) => lead.ownerEmail || lead.createdBy?.email || "Nicht zugewiesen";

export const getLeadActivityCount = (lead) =>
  (lead.comments?.length || 0) + (lead.callLogs?.length || 0) + (lead.statusHistory?.length || 0);

export const getLastActivityTimestamp = (lead) => {
  const timestamps = [];
  (lead.comments || []).forEach((item) => timestamps.push(item.timestamp));
  (lead.callLogs || []).forEach((item) => timestamps.push(item.timestamp));
  (lead.statusHistory || []).forEach((item) => timestamps.push(item.timestamp));
  return timestamps.filter(Boolean).sort((a, b) => new Date(b) - new Date(a))[0] || null;
};

export const isLeadInactiveForHours = (lead, minHours = 48) => {
  if (!lead) return false;
  if (lead.status === "Abschluss" || lead.status === "Verloren") return false;
  const lastActivity = getLastActivityTimestamp(lead);
  return getHoursSince(lastActivity) >= minHours;
};

export const getContactTouchCount = (lead) => (lead.callLogs?.length || 0) + (lead.comments?.length || 0);

export const isWonLeadRenewalDue = (lead, monthsBefore = RENEWAL_RESURFACE_MONTHS) => {
  if (!lead || lead.status !== "Abschluss") return false;
  const monthsUntilEnd = getMonthsUntil(lead.contractEnd);
  return monthsUntilEnd >= 0 && monthsUntilEnd <= monthsBefore;
};

export const hasSupplyConfirmation = (lead) => !!lead?.wechselProcess?.steps?.liefertag?.completedAt;

export const getWechselProgress = (lead) => {
  const steps = lead?.wechselProcess?.steps || {};
  const total = WECHSEL_STEPS.length;
  const completed = WECHSEL_STEPS.filter((step) => !!steps[step.id]?.completedAt).length;
  return { completed, total };
};

export const calculatePriority = (lead) => {
  const consumption = lead.consumption ? parseInt(lead.consumption) : 0;
  const laufzeit = getRestLaufzeit(lead.contractEnd);
  const hasCancellationWindow = isOpenCancellationWindow(lead.contractEnd);
  if (hasCancellationWindow || consumption >= 50000) return "A";
  if ((consumption >= 20000 && consumption < 50000) || (laufzeit && laufzeit >= 1 && laufzeit <= 2)) return "B";
  return "C";
};

export const clampScore = (value, min = 0, max = 100) => Math.min(max, Math.max(min, value));

export const calculateLeadScore = (lead) => {
  if (lead.status === "Abschluss") return 100;
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
  if (lead.status === "Follow-up") score += 8;
  if (lead.status === "Kontaktiert") score += 6;

  if (consumption >= 50000) score += 10;
  else if (consumption >= 20000) score += 5;

  if (lead.phone) score += 4;
  if (lead.email) score += 4;
  score += Math.min(12, activityCount * 2);

  return clampScore(Math.round(score));
};

export const getLeadWinProbability = (lead) => {
  if (lead.status === "Abschluss") return 100;
  if (lead.status === "Verloren") return 0;

  const score = calculateLeadScore(lead);
  let probability = Math.round(score * 0.82);

  if (lead.status === "Angebot") probability += 10;
  if (lead.appointmentDate) probability += 6;
  if (isOverdue(lead.followUp)) probability -= 8;

  return clampScore(probability, 1, 98);
};

export const getLeadScoreTone = (probability) => {
  if (probability >= 70) return "high";
  if (probability >= 45) return "mid";
  return "low";
};

export const getLeadTemperature = (lead) => {
  if (lead.status === "Abschluss") return { label: "Won", tone: "won", step: 3 };
  if (lead.status === "Verloren") return { label: "Lost", tone: "lost", step: 0 };
  if (isOverdue(lead.followUp)) return { label: "🚨 Kritisch", tone: "critical", step: 2 };
  const inactivityHours = getHoursSince(getLastActivityTimestamp(lead));
  if (inactivityHours < 24) return { label: "🔥 HOT", tone: "hot", step: 3 };
  if (inactivityHours < 72) return { label: "🌤 Warm", tone: "warm", step: 2 };
  return { label: "❄️ Cold", tone: "cold", step: 1 };
};

export const getLeadReadiness = (lead) => {
  if (lead.status === "Abschluss") {
    return { label: "🚦 Angebotsfaehig", tone: "green", reason: "Abschluss bereits erfolgt.", missing: [] };
  }
  if (lead.status === "Verloren") {
    return { label: "🚦 Daten fehlen", tone: "red", reason: "Lead ist als verloren markiert.", missing: [] };
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
      label: "🚦 Daten fehlen", tone: "red",
      reason: `Nicht angebotsfaehig: ${missing.slice(0, 2).join(", ")}`, missing,
    };
  }
  return { label: "🚦 Angebotsfaehig", tone: "green", reason: "Angebotsfaehig und bereit fuer Abschlussarbeit.", missing: [] };
};

export const getNextActionPlan = (lead) => {
  const hasPhone = !!lead.phone;
  const hasEmail = !!lead.email;

  if (lead.status === "Abschluss") {
    return { label: "Abschluss sichern", tone: "success", channel: hasEmail ? "E-Mail" : "Telefon", when: "Heute", reason: "Onboarding und Referenzchance sichern" };
  }
  if (lead.status === "Verloren") {
    return { label: "Archiv prüfen", tone: "muted", channel: "CRM", when: "Diese Woche", reason: "Win/Loss-Learnings dokumentieren" };
  }
  if (isOverdue(lead.followUp)) {
    return { label: "Heute nachfassen", tone: "danger", channel: hasPhone ? "Telefon" : "E-Mail", when: "Innerhalb 2h", reason: "Follow-up ist überfällig" };
  }
  if (isTodayDue(lead.followUp)) {
    return { label: "Heute anrufen", tone: "today", channel: hasPhone ? "Telefon" : "E-Mail", when: "Heute vor 17:00", reason: "Fälliger Touchpoint im Plan" };
  }
  if (isOpenCancellationWindow(lead.contractEnd)) {
    return { label: "Angebot priorisieren", tone: "hot", channel: hasPhone ? "Telefon + E-Mail" : "E-Mail", when: "Heute", reason: "Kündigungsfenster ist offen" };
  }
  if ((lead.callLogs?.length || 0) === 0) {
    return { label: "Ersten Anruf machen", tone: "default", channel: hasPhone ? "Telefon" : "E-Mail", when: "Heute", reason: "Noch kein Erstkontakt dokumentiert" };
  }
  if (lead.status === "Angebot") {
    return { label: "Angebot nachhalten", tone: "warm", channel: hasPhone ? "Telefon" : "E-Mail", when: "In 24h", reason: "Entscheidung aktiv beschleunigen" };
  }
  return { label: "Nächsten Touchpoint planen", tone: "default", channel: hasEmail ? "E-Mail" : hasPhone ? "Telefon" : "CRM", when: "In 48h", reason: "Kontinuität im Deal aufrechterhalten" };
};

export const getNextAction = (lead) => {
  const plan = getNextActionPlan(lead);
  return { label: plan.label, tone: plan.tone };
};

export const getLeadSequencePlan = (lead) => {
  if (lead.status === "Abschluss") {
    return {
      stage: "post-win", title: "Retention Sequenz",
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
      stage: "hot", title: "Hot Deal Sequenz",
      steps: [
        { id: "hot-1", title: "Entscheider direkt anrufen", channel: "Telefon", dueInDays: 0, purpose: "Momentum nutzen und Einwand sofort klären" },
        { id: "hot-2", title: "Angebot mit Deadline senden", channel: "E-Mail", dueInDays: 0, purpose: "Verbindlichkeit erzeugen" },
        { id: "hot-3", title: "Finales Follow-up", channel: "Telefon + WhatsApp", dueInDays: 1, purpose: "Entscheidung aktiv abschließen" },
      ],
    };
  }

  if (tone === "warm") {
    return {
      stage: "warm", title: "Warm Lead Sequenz",
      steps: [
        { id: "warm-1", title: "Bedarfs-Check", channel: "Telefon", dueInDays: 0, purpose: "Use Case und Pain Point präzisieren" },
        { id: "warm-2", title: "Case + Angebot senden", channel: "E-Mail", dueInDays: 1, purpose: "Mehrwert konkret machen" },
        { id: "warm-3", title: "Commitment-Termin sichern", channel: "Telefon", dueInDays: 3, purpose: "Deal in Angebotsphase schieben" },
      ],
    };
  }

  return {
    stage: "cold", title: "Cold Lead Sequenz",
    steps: [
      { id: "cold-1", title: "Erstkontakt aufbauen", channel: "E-Mail", dueInDays: 0, purpose: "Relevanz und Interesse testen" },
      { id: "cold-2", title: "Kurz-Call anbieten", channel: "Telefon", dueInDays: 2, purpose: "Persönlichen Kontakt initiieren" },
      { id: "cold-3", title: "Breakup oder Nurture", channel: "E-Mail", dueInDays: 5, purpose: "Pipeline bereinigen oder weiterentwickeln" },
    ],
  };
};

export const sortLeads = (items, sortMode) => {
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

export const rankCockpitCtas = ({ leads }) => {
  const workingLeads = leads.filter((lead) => lead.status !== "Abschluss" && lead.status !== "Verloren");
  const inactiveLeads = workingLeads.filter((lead) => isLeadInactiveForHours(lead, 48));
  const uncontactedLeads = workingLeads.filter((lead) => getContactTouchCount(lead) === 0);
  const overdueLeads = workingLeads.filter((lead) => isOverdue(lead.followUp));
  const cancelWindowLeads = workingLeads.filter((lead) => isOpenCancellationWindow(lead.contractEnd));
  const stalledOfferLeads = workingLeads.filter((lead) => (lead.status === "Angebot" || lead.status === "Follow-up") && getHoursSince(getLastActivityTimestamp(lead)) >= 72);
  const hotLeads = workingLeads.filter((lead) => getLeadTemperature(lead).tone === "hot");

  const cards = [];

  if (uncontactedLeads.length > 0) {
    cards.push({ id: "cta-uncontacted", tone: "warning", score: uncontactedLeads.length * 14, title: `${uncontactedLeads.length} unkontaktierte Leads`, message: "Schneller Erstkontakt bringt den \"ah ja stimmt\"-Momentum zurück.", actionLabel: "Unkontaktierte öffnen", action: "uncontacted", leadId: uncontactedLeads[0]?.id });
  }
  if (inactiveLeads.length > 0) {
    cards.push({ id: "cta-inactive", tone: "alert", score: inactiveLeads.length * 12, title: `${inactiveLeads.length} Leads ohne Aktivität >48h`, message: "Reaktivieren, bevor der Deal kalt wird.", actionLabel: "Jetzt priorisieren", action: "inactive48", leadId: inactiveLeads[0]?.id });
  }
  if (overdueLeads.length > 0) {
    cards.push({ id: "cta-overdue", tone: "alert", score: overdueLeads.length * 11, title: `${overdueLeads.length} Follow-ups überfällig`, message: "Heute zuerst diese Kontakte schließen.", actionLabel: "Überfällige anzeigen", action: "overdue", leadId: overdueLeads[0]?.id });
  }
  if (cancelWindowLeads.length > 0) {
    cards.push({ id: "cta-cancel-window", tone: "warning", score: cancelWindowLeads.length * 13, title: `${cancelWindowLeads.length} Leads im Kündigungsfenster`, message: "Timing-Vorteil jetzt nutzen und Abschluss sichern.", actionLabel: "Kündigungsfenster öffnen", action: "cancellation", leadId: cancelWindowLeads[0]?.id });
  }
  if (stalledOfferLeads.length > 0) {
    cards.push({ id: "cta-perfect-price-no-answer", tone: "warning", score: stalledOfferLeads.length * 10, title: "Perfekter Preis, aber keine Antwort", message: `${stalledOfferLeads.length} Angebots-Leads warten >72h ohne Reaktion.`, actionLabel: "Angebots-Stau öffnen", action: "stalledOffers", leadId: stalledOfferLeads[0]?.id });
  }

  if (hotLeads.length > 0) {
    cards.push({ id: "cta-hot", tone: "success", score: hotLeads.length * 9, title: `${hotLeads.length} Hot Leads`, message: "Heiße Leads jetzt mit kurzen Zyklen bearbeiten.", actionLabel: "Hot Leads öffnen", action: "hot", leadId: hotLeads[0]?.id });
  }

  return cards.sort((a, b) => b.score - a.score).slice(0, 6);
};
