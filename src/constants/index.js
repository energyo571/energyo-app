// ─── Konstanten ───────────────────────────────────────────────────────────────
export const STATUS_OPTIONS = ["Neu", "Kontaktiert", "Angebot", "Nachfassen", "CLOSED", "Verloren"];
export const STATUS_META = {
  Neu:         { color: "#6b7280", bg: "#f3f4f6" },
  Kontaktiert: { color: "#1d4ed8", bg: "#dbeafe" },
  Angebot:     { color: "#c2410c", bg: "#ffedd5" },
  Nachfassen:  { color: "#b45309", bg: "#fef3c7" },
  CLOSED:      { color: "#065f46", bg: "#d1fae5" },
  Verloren:    { color: "#991b1b", bg: "#fee2e2" },
};
export const CALL_OUTCOMES = [
  "Kein Kontakt", "Mailbox hinterlassen", "Kurzes Gespräch",
  "Ausführliches Gespräch", "Termin vereinbart", "Angebot besprochen", "Abschluss",
];
export const MAX_ATTACHMENT_SIZE_BYTES = 10 * 1024 * 1024;
export const RENEWAL_RESURFACE_MONTHS = 6;
export const buildAttachmentId = () => `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
export const getAttachmentHref = (attachment) => attachment?.url || attachment?.data || "";
export const EMPTY_METER = { zählernummer: "", maloId: "", verbrauchKwh: "", jahreskosten: "", lieferStrasse: "", lieferHausnummer: "", lieferPlz: "", lieferStadt: "" };
export const initialForm = {
  company: "", person: "", anrede: "", titel: "", geburtsdatum: "", phone: "", email: "",
  consumption: "", annualCosts: "", contractEnd: "unknown",
  customerType: "Privat", currentProvider: "",
  bundleInquiry: false, energyAuditEligible: false, followUp: "", attachments: [],
  energyType: "strom",
  energy: {
    strom: [{ ...EMPTY_METER }],
    gas:   [{ ...EMPTY_METER }],
  },
  deliveryAddress: { straße: "", hausnummer: "", plz: "", ort: "" },
  hasAlternativeInvoiceAddress: false,
  invoiceAddress: { straße: "", hausnummer: "", plz: "", stadt: "" },
};
export const USER_CALENDLY_LINKS_BY_EMAIL = {
  "y.oezdemir@energyo.de": "https://calendly.com/yasin-oezdemir-energyo",
  "o.balcioglu@energyo.de": "https://calendly.com/energyobalcioglu",
};
export const WECHSEL_STEPS = [
  { id: "antrag",        label: "Wechselantrag gestellt",       desc: "Antrag bei ENERGYO eingereicht" },
  { id: "kuendigung",    label: "Kündigung beim Altanbieter",   desc: "Kündigung versendet & bestätigt" },
  { id: "netzanmeldung", label: "Netzanmeldung bestätigt",      desc: "Netzbetreiber-Rückmeldung erhalten" },
  { id: "liefertag",     label: "Erster Liefertag",             desc: "Energielieferung startet" },
  { id: "abschluss",     label: "Abgeschlossen",                desc: "Wechsel erfolgreich — Empfehlung anfragen" },
];
export const PROVISION_STATUS = [
  { id: "offen",      label: "Offen",      icon: "⏳" },
  { id: "gebucht",    label: "Gebucht",    icon: "📋" },
  { id: "ausgezahlt", label: "Ausgezahlt", icon: "✅" },
];
