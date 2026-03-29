// ─── Date/Time Utilities ──────────────────────────────────────────────────────
export const formatDate = (d) => {
  if (!d || d === "unknown") return "—";
  return new Date(d).toLocaleDateString("de-DE");
};
export const formatDateTime = (d) => {
  if (!d) return "";
  const dt = new Date(d);
  return dt.toLocaleDateString("de-DE") + " " + dt.toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" });
};
export const isOverdue = (d) => !!d && d < new Date().toISOString().split("T")[0];
export const isTodayDue = (d) => !!d && d === new Date().toISOString().split("T")[0];
export const getHoursSince = (timestamp) => {
  if (!timestamp) return Number.POSITIVE_INFINITY;
  return (Date.now() - new Date(timestamp).getTime()) / (1000 * 60 * 60);
};
export const isOpenCancellationWindow = (contractEnd) => {
  if (contractEnd === "unknown" || !contractEnd) return false;
  const monthsUntilEnd = (new Date(contractEnd) - new Date()) / (1000 * 60 * 60 * 24 * 30);
  return monthsUntilEnd >= 0 && monthsUntilEnd <= 4;
};
export const getRestLaufzeit = (contractEnd) => {
  if (contractEnd === "unknown" || !contractEnd) return null;
  return (new Date(contractEnd) - new Date()) / (1000 * 60 * 60 * 24 * 365);
};
export const getMonthsUntil = (dateValue) => {
  if (!dateValue || dateValue === "unknown") return Number.POSITIVE_INFINITY;
  return (new Date(dateValue) - new Date()) / (1000 * 60 * 60 * 24 * 30);
};
export const addDaysToIso = (days) => {
  const dt = new Date();
  dt.setDate(dt.getDate() + days);
  return dt.toISOString().split("T")[0];
};
