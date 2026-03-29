/**
 * Input sanitization utilities for Firestore writes.
 * Strips HTML/script tags from strings; whitelists lead fields.
 */

const ALLOWED_LEAD_FIELDS = new Set([
  "person", "company", "phone", "email", "postalCode", "address",
  "city", "notes", "status", "followUp", "contractEnd", "provider",
  "consumption", "monthlyPayment", "meterNumber", "contractNumber",
  "commentDraft", "attachments", "callLogs", "comments",
  "statusHistory", "renewalResurfacedAt", "renewalResurfaceReason",
  "ownerUserId", "ownerEmail",
]);

/** Strip HTML tags from a string value. */
function stripTags(str) {
  return str.replace(/<[^>]*>/g, "");
}

/** Sanitize a single value: strip tags from strings, recurse into plain objects/arrays. */
export function sanitizeValue(val) {
  if (typeof val === "string") return stripTags(val);
  if (Array.isArray(val)) return val.map(sanitizeValue);
  if (val && typeof val === "object" && val.constructor === Object) {
    return sanitizeObject(val);
  }
  return val;
}

/** Sanitize all string values in a plain object (shallow or nested). */
export function sanitizeObject(obj) {
  const out = {};
  for (const [k, v] of Object.entries(obj)) {
    out[k] = sanitizeValue(v);
  }
  return out;
}

/** Check if a field name is in the allowed lead-field whitelist. */
export function isAllowedLeadField(field) {
  return ALLOWED_LEAD_FIELDS.has(field);
}
