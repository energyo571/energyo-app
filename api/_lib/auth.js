/**
 * Verify Firebase ID token from the Authorization header.
 * Returns the decoded token (uid, email, etc.) or null if invalid.
 *
 * Usage:
 *   const { verifyAuth } = require("./_lib/auth");
 *   const user = await verifyAuth(req, res);
 *   if (!user) return; // 401 already sent
 */
const { admin } = require("./firebaseAdmin");

async function verifyAuth(req, res) {
  const header = req.headers.authorization || "";
  const match = header.match(/^Bearer\s+(.+)$/i);
  if (!match) {
    res.status(401).json({ error: "Missing or invalid Authorization header" });
    return null;
  }

  try {
    const decoded = await admin.auth().verifyIdToken(match[1]);
    return decoded;
  } catch (e) {
    res.status(401).json({ error: "Invalid or expired token" });
    return null;
  }
}

module.exports = { verifyAuth };
