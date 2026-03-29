import { initializeApp } from "firebase/app";
import { getAuth } from "firebase/auth";
import { getFirestore } from "firebase/firestore";
import { getStorage } from "firebase/storage";

const firebaseConfig = {
  apiKey: "AIzaSyCP9bnFyHNm6LvKlzv-SHvrPLagWYE2MEQ",
  authDomain: "energyo-app.firebaseapp.com",
  projectId: "energyo-app",
  storageBucket: "energyo-app.firebasestorage.app",
  messagingSenderId: "788968793217",
  appId: "1:788968793217:web:be14f5c00689d42c161980",
  measurementId: "G-SP1GVLJSQG",
};

let app;
let auth;
let db;
let storage;

try {
  app = initializeApp(firebaseConfig);
  auth = getAuth(app);
  db = getFirestore(app);
  storage = getStorage(app);
  // initialized
} catch (error) {
  // init error handled silently
}

export { auth, db, storage };
export default app;
