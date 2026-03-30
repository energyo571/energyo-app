const admin = require("firebase-admin");

function getPrivateKey() {
  const raw = process.env.FIREBASE_PRIVATE_KEY || "";
  return raw.replace(/\\n/g, "\n");
}

function getApp() {
  if (admin.apps.length > 0) return admin.app();

  const projectId = process.env.FIREBASE_PROJECT_ID;
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
  const privateKey = getPrivateKey();

  if (!projectId || !clientEmail || !privateKey) {
    throw new Error("Missing Firebase Admin env vars: FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL, FIREBASE_PRIVATE_KEY");
  }

  return admin.initializeApp({
    credential: admin.credential.cert({
      projectId,
      clientEmail,
      privateKey,
    }),
  });
}

function getDb() {
  getApp();
  return admin.firestore();
}

module.exports = {
  admin,
  getApp,
  getDb,
};
