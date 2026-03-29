const { ImapFlow } = require("imapflow");
const { simpleParser } = require("mailparser");
const { verifyAuth } = require("./_lib/auth");
const { rateLimit } = require("./_lib/rateLimit");
const { getDb } = require("./_lib/firebaseAdmin");
const { decrypt } = require("./_lib/crypto");

module.exports = async function handler(req, res) {
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });
  if (rateLimit(req, res, { max: 15, windowMs: 60000 })) return;
  const user = await verifyAuth(req, res);
  if (!user) return;

  // Read per-user IMAP credentials from Firestore
  const db = getDb();
  const snap = await db.collection("users").doc(user.uid).get();
  const userData = snap.data() || {};

  if (!userData.imapUser || !userData.imapPassword) {
    return res.status(400).json({ error: "E-Mail nicht konfiguriert", code: "IMAP_NOT_CONFIGURED" });
  }

  let IMAP_PASSWORD;
  try {
    IMAP_PASSWORD = decrypt(userData.imapPassword);
  } catch (e) {
    return res.status(500).json({ error: "E-Mail-Konfiguration fehlerhaft" });
  }
  const IMAP_USER = userData.imapUser;
  const IMAP_HOST = userData.imapHost || "imap.ionos.de";

  const folder = req.query.folder || "INBOX";
  const page = Math.max(1, parseInt(req.query.page) || 1);
  const limit = Math.min(50, Math.max(1, parseInt(req.query.limit) || 20));
  const uid = req.query.uid;

  const client = new ImapFlow({
    host: IMAP_HOST || "imap.ionos.de",
    port: 993,
    secure: true,
    auth: { user: IMAP_USER, pass: IMAP_PASSWORD },
    logger: false,
  });

  try {
    await client.connect();
    const lock = await client.getMailboxLock(folder);

    try {
      const mailbox = client.mailbox;
      const total = mailbox.exists || 0;

      // Single mail detail
      if (uid) {
        const msg = await client.fetchOne(uid, { source: true }, { uid: true });
        if (!msg) return res.status(404).json({ error: "Nachricht nicht gefunden" });
        const parsed = await simpleParser(msg.source);
        return res.status(200).json({
          uid,
          subject: parsed.subject || "(Kein Betreff)",
          from: parsed.from?.text || "",
          to: parsed.to?.text || "",
          date: parsed.date?.toISOString() || "",
          html: parsed.html || "",
          text: parsed.text || "",
          attachments: (parsed.attachments || []).map((a) => ({
            filename: a.filename || "Anhang",
            size: a.size,
            contentType: a.contentType,
          })),
        });
      }

      // List mails
      if (total === 0) {
        return res.status(200).json({ total: 0, page, emails: [] });
      }

      const startSeq = Math.max(1, total - (page * limit) + 1);
      const endSeq = Math.max(1, total - ((page - 1) * limit));
      const range = `${startSeq}:${endSeq}`;

      const emails = [];
      for await (const msg of client.fetch(range, {
        uid: true,
        envelope: true,
        flags: true,
        bodyStructure: true,
      })) {
        const env = msg.envelope || {};
        emails.push({
          uid: msg.uid,
          seq: msg.seq,
          flags: Array.from(msg.flags || []),
          subject: env.subject || "(Kein Betreff)",
          from: env.from?.[0] ? `${env.from[0].name || ""} <${env.from[0].address || ""}>`.trim() : "",
          to: env.to?.[0]?.address || "",
          date: env.date?.toISOString() || "",
          hasAttachment: !!(msg.bodyStructure?.childNodes?.some((n) => n.disposition === "attachment")),
        });
      }

      emails.sort((a, b) => new Date(b.date) - new Date(a.date));

      return res.status(200).json({ total, page, limit, emails });
    } finally {
      lock.release();
    }
  } catch (err) {
    return res.status(502).json({ error: "E-Mail-Verbindung fehlgeschlagen" });
  } finally {
    try { await client.logout(); } catch (_) {}
  }
};
