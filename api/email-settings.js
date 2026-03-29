const { verifyAuth } = require("./_lib/auth");
const { rateLimit } = require("./_lib/rateLimit");
const { getDb } = require("./_lib/firebaseAdmin");
const { encrypt } = require("./_lib/crypto");

module.exports = async function handler(req, res) {
  if (rateLimit(req, res, { max: 10, windowMs: 60000 })) return;
  const user = await verifyAuth(req, res);
  if (!user) return;

  const db = getDb();
  const ref = db.collection("users").doc(user.uid);

  // GET — check if IMAP is configured (returns boolean + masked user)
  if (req.method === "GET") {
    const snap = await ref.get();
    const data = snap.data() || {};
    const configured = !!(data.imapUser && data.imapPassword);
    return res.status(200).json({
      configured,
      imapUser: configured ? data.imapUser : "",
      imapHost: data.imapHost || "imap.ionos.de",
    });
  }

  // POST — save IMAP credentials
  if (req.method === "POST") {
    const { imapUser, imapPassword, imapHost } = req.body || {};

    if (!imapUser || !imapPassword) {
      return res.status(400).json({ error: "E-Mail-Adresse und Passwort sind erforderlich" });
    }

    // Basic email format check
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(imapUser)) {
      return res.status(400).json({ error: "Ungültige E-Mail-Adresse" });
    }

    if (imapPassword.length < 4 || imapPassword.length > 256) {
      return res.status(400).json({ error: "Passwort muss zwischen 4 und 256 Zeichen lang sein" });
    }

    const encryptedPassword = encrypt(imapPassword);

    await ref.set(
      {
        imapUser: imapUser.trim().toLowerCase(),
        imapPassword: encryptedPassword,
        imapHost: (imapHost || "imap.ionos.de").trim().toLowerCase(),
        imapUpdatedAt: new Date().toISOString(),
      },
      { merge: true }
    );

    return res.status(200).json({ ok: true, imapUser: imapUser.trim().toLowerCase() });
  }

  // DELETE — remove IMAP credentials
  if (req.method === "DELETE") {
    const { FieldValue } = require("firebase-admin/firestore");
    await ref.update({
      imapUser: FieldValue.delete(),
      imapPassword: FieldValue.delete(),
      imapHost: FieldValue.delete(),
      imapUpdatedAt: FieldValue.delete(),
    });
    return res.status(200).json({ ok: true });
  }

  return res.status(405).json({ error: "Method not allowed" });
};
