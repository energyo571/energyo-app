import { USER_CALENDLY_LINKS_BY_EMAIL } from '../constants';

export const normalizeCalendlyBaseUrl = (value) => {
  const raw = String(value || "").trim();
  if (!raw) return "";
  return /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
};
export const resolveUserCalendlyBaseUrl = (currentUserEmail, ownerEmail) => {
  const emailCandidates = [currentUserEmail, ownerEmail]
    .map((email) => String(email || "").trim().toLowerCase())
    .filter(Boolean);

  for (const email of emailCandidates) {
    if (USER_CALENDLY_LINKS_BY_EMAIL[email]) return USER_CALENDLY_LINKS_BY_EMAIL[email];
  }

  return normalizeCalendlyBaseUrl(process.env.REACT_APP_CALENDLY_URL || "");
};
