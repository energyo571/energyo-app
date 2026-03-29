import React, { useState } from "react";
import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signOut,
} from "firebase/auth";
import { auth } from "./firebaseConfig";
import logo from "./logo.png";
import "./LoginPage.css";

export default function LoginPage({ onLogin, user }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [isSignUp, setIsSignUp] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const handleAuth = async (e) => {
    e.preventDefault();
    setError("");
    setLoading(true);

    try {
      if (isSignUp) {
        const userCredential = await createUserWithEmailAndPassword(
          auth,
          email,
          password
        );
        console.log("Benutzer erstellt:", userCredential.user.email);
        onLogin(userCredential.user);
      } else {
        const userCredential = await signInWithEmailAndPassword(
          auth,
          email,
          password
        );
        console.log("Angemeldet:", userCredential.user.email);
        onLogin(userCredential.user);
      }
    } catch (err) {
      setError(
        err.code === "auth/user-not-found"
          ? "Benutzer nicht gefunden"
          : err.code === "auth/wrong-password"
          ? "Falsches Passwort"
          : err.code === "auth/email-already-in-use"
          ? "E-Mail wird bereits verwendet"
          : err.code === "auth/weak-password"
          ? "Passwort mindestens 6 Zeichen"
          : err.message
      );
    }

    setLoading(false);
  };

  const handleLogout = async () => {
    try {
      await signOut(auth);
      onLogin(null);
    } catch (err) {
      console.error("Logout-Fehler:", err);
    }
  };

  if (user) {
    return (
      <div className="login-container logged-in">
        <div className="logged-in-content">
          <h2>Willkommen zurück!</h2>
          <p className="user-email">{user.email}</p>
          <button className="logout-btn" onClick={handleLogout}>
            Abmelden
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="login-container">
      <div className="login-card">
        <div className="login-header">
          <img src={logo} alt="ENERGYO" className="login-logo" />
          <h1>ENERGYO - Sales Engine</h1>
          <p className="login-subtitle">
            {isSignUp ? "Neuen Account erstellen" : "Anmelden"}
          </p>
        </div>

        {error && <div className="error-message">{error}</div>}

        <form onSubmit={handleAuth} className="login-form">
          <input
            type="email"
            placeholder="E-Mail"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            disabled={loading}
          />

          <input
            type="password"
            placeholder="Passwort"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            disabled={loading}
          />

          <button type="submit" className="login-btn" disabled={loading}>
            {loading
              ? "Wird bearbeitet..."
              : isSignUp
              ? "Account erstellen"
              : "Anmelden"}
          </button>
        </form>

        <div className="login-toggle">
          <p>
            {isSignUp
              ? "Hast du bereits einen Account? "
              : "Noch keinen Account? "}
            <button
              type="button"
              className="toggle-btn"
              onClick={() => {
                setIsSignUp(!isSignUp);
                setError("");
              }}
            >
              {isSignUp ? "Jetzt anmelden" : "Account erstellen"}
            </button>
          </p>
        </div>
      </div>
    </div>
  );
}
