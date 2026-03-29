const crypto = require("crypto");
const { admin, getDb } = require("./_lib/firebaseAdmin");
const { rateLimit } = require("./_lib/rateLimit");

function parseSignature(signatureHeader) {
  if (!signatureHeader) return null;
  const parts = signatureHeader.split(",").map((p) => p.trim());
  const out = {};
  parts.forEach((part) => {
    const [k, v] = part.split("=");
    if (k && v) out[k] = v;
  });
  return out.t && out.v1 ? out : null;
}

function verifyCalendlySignature(req, rawBody) {
  const signingKey = process.env.CALENDLY_WEBHOOK_SIGNING_KEY;
  if (!signingKey) return false;

  const header = req.headers["calendly-webhook-signature"];
  const parsed = parseSignature(header);
  if (!parsed) return false;

  const signed = `${parsed.t}.${rawBody}`;
  const expected = crypto.createHmac("sha256", signingKey).update(signed).digest("hex");
  return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(parsed.v1));
}

function toDateParts(isoString) {
  if (!isoString) return { date: null, time: null };
  const d = new Date(isoString);
  if (Number.isNaN(d.getTime())) return { date: null, time: null };
  const date = d.toISOString().split("T")[0];
  const time = d.toISOString().split("T")[1].slice(0, 5);
  return { date, time };
}

function pickLeadIdFromPayload(payload) {
  const trackingLeadId = payload?.tracking?.utm_content;
  if (trackingLeadId) return trackingLeadId;

  const qa = payload?.questions_and_answers;
  if (Array.isArray(qa)) {
    const hint = qa.find((q) => /lead\s*id/i.test(String(q?.question || "")));
    if (hint?.answer) return String(hint.answer).trim();
  }

  return null;
}

function buildUpdateFromEvent(eventType, payload) {
  const nowIso = new Date().toISOString();
  const start =
    payload?.scheduled_event?.start_time ||
    payload?.event_start_time ||
    payload?.start_time ||
    null;

  const { date, time } = toDateParts(start);

  const base = {
    calendlyLastEvent: eventType || null,
    calendlyEventUri: payload?.scheduled_event?.uri || payload?.scheduled_event || null,
    calendlyInviteeUri: payload?.uri || null,
    calendlyUpdatedAt: nowIso,
  };

  if (eventType === "invitee.canceled") {
    return {
      ...base,
      appointmentCanceled: true,
      appointmentCanceledAt: nowIso,
    };
  }

  if (eventType === "invitee.created") {
    return {
      ...base,
      appointmentCanceled: false,
      appointmentDate: date,
      appointmentTime: time,
      appointmentSource: "calendly",
      appointmentTitle: payload?.name || payload?.event?.name || "Calendly Termin",
    };
  }

  return base;
}

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  }

  if (rateLimit(req, res, { max: 30, windowMs: 60_000 })) return;

  try {
    const rawBody = typeof req.body === "string" ? req.body : JSON.stringify(req.body || {});
    if (!verifyCalendlySignature(req, rawBody)) {
      return res.status(401).json({ ok: false, error: "Invalid Calendly signature" });
    }

    const body = typeof req.body === "string" ? JSON.parse(req.body) : req.body;
    const eventType = body?.event;
    const payload = body?.payload || {};
    const inviteeEmail = String(payload?.email || payload?.invitee?.email || "").trim().toLowerCase();
    const hintedLeadId = pickLeadIdFromPayload(payload);

    if (!eventType) {
      return res.status(400).json({ ok: false, error: "Missing event type" });
    }

    const db = getDb();
    const leadsCollection = db.collection("leads");
    let targetDoc = null;

    if (hintedLeadId) {
      const snap = await leadsCollection.doc(hintedLeadId).get();
      if (snap.exists) targetDoc = snap;
    }

    if (!targetDoc && inviteeEmail) {
      const qSnap = await leadsCollection.where("email", "==", inviteeEmail).get();
      if (!qSnap.empty) {
        const docs = qSnap.docs.sort((a, b) => {
          const aTs = new Date(a.data()?.createdAt || 0).getTime();
          const bTs = new Date(b.data()?.createdAt || 0).getTime();
          return bTs - aTs;
        });
        targetDoc = docs[0];
      }
    }

    if (!targetDoc) {
      return res.status(202).json({
        ok: true,
        matched: false,
        reason: "No matching lead found",
        eventType,
      });
    }

    const update = buildUpdateFromEvent(eventType, payload);
    if (eventType === "invitee.canceled") {
      update.appointmentDate = admin.firestore.FieldValue.delete();
      update.appointmentTime = admin.firestore.FieldValue.delete();
    }

    await leadsCollection.doc(targetDoc.id).update(update);

    return res.status(200).json({
      ok: true,
      matched: true,
      leadId: targetDoc.id,
      eventType,
    });
  } catch (error) {
    console.error("calendly-webhook error", error);
    return res.status(500).json({ ok: false, error: "Webhook processing failed" });
  }
};
