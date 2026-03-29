import React, { useState, useEffect, useCallback } from "react";
import { authFetch } from "../utils/authFetch";
import { IconMail, IconRefresh, IconPaperclip } from "./Icons";

const API = process.env.REACT_APP_API_BASE_URL || "";

function ImapSetup({ onConfigured }) {
  const [imapUser, setImapUser] = useState("");
  const [imapPassword, setImapPassword] = useState("");
  const [imapHost, setImapHost] = useState("imap.ionos.de");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const handleSave = async (e) => {
    e.preventDefault();
    setSaving(true);
    setError("");
    try {
      const res = await authFetch(`${API}/api/email-settings`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ imapUser, imapPassword, imapHost }),
      });
      const text = await res.text();
      let data;
      try { data = JSON.parse(text); } catch { throw new Error("Server-Antwort ungültig"); }
      if (!res.ok) throw new Error(data.error || "Fehler beim Speichern");
      onConfigured(data.imapUser);
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="mailbox-panel">
      <div className="mailbox-header">
        <h2><IconMail size={18} /> E-Mail einrichten</h2>
      </div>
      <form className="imap-setup-form" onSubmit={handleSave}>
        <p className="imap-setup-info">
          Gib deine IMAP-Zugangsdaten ein, um dein E-Mail-Postfach zu verbinden.
          Das Passwort wird verschlüsselt gespeichert.
        </p>
        <label className="imap-field">
          <span>E-Mail-Adresse</span>
          <input
            type="email"
            value={imapUser}
            onChange={(e) => setImapUser(e.target.value)}
            placeholder="name@energyo.de"
            required
            autoComplete="email"
          />
        </label>
        <label className="imap-field">
          <span>IMAP-Passwort</span>
          <input
            type="password"
            value={imapPassword}
            onChange={(e) => setImapPassword(e.target.value)}
            placeholder="Dein E-Mail-Passwort"
            required
            autoComplete="current-password"
          />
        </label>
        <label className="imap-field">
          <span>IMAP-Server</span>
          <input
            type="text"
            value={imapHost}
            onChange={(e) => setImapHost(e.target.value)}
            placeholder="imap.ionos.de"
          />
        </label>
        {error && <div className="mailbox-error">{error}</div>}
        <button type="submit" className="imap-save-btn" disabled={saving}>
          {saving ? "Speichern…" : "Postfach verbinden"}
        </button>
      </form>
    </div>
  );
}

function MailboxPanel() {
  const [emails, setEmails] = useState([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [selectedUid, setSelectedUid] = useState(null);
  const [detail, setDetail] = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [imapConfigured, setImapConfigured] = useState(null); // null = loading, true/false
  const [imapUser, setImapUser] = useState("");
  const limit = 20;

  // Check if IMAP is configured for this user
  useEffect(() => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);
    (async () => {
      try {
        const res = await authFetch(`${API}/api/email-settings`, { signal: controller.signal });
        if (!res.ok) throw new Error();
        const data = await res.json();
        setImapConfigured(data.configured);
        setImapUser(data.imapUser || "");
      } catch {
        setImapConfigured(false);
      } finally {
        clearTimeout(timeout);
      }
    })();
    return () => { controller.abort(); clearTimeout(timeout); };
  }, []);

  const fetchEmails = useCallback(async (pg = 1) => {
    setLoading(true);
    setError("");
    try {
      const res = await authFetch(`${API}/api/email-inbox?page=${pg}&limit=${limit}`);
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        if (data.code === "IMAP_NOT_CONFIGURED") {
          setImapConfigured(false);
          return;
        }
        throw new Error(data.error || `HTTP ${res.status}`);
      }
      const data = await res.json();
      setEmails(data.emails || []);
      setTotal(data.total || 0);
      setPage(pg);
    } catch (err) {
      setError(err.message || "Fehler beim Laden der E-Mails");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { if (imapConfigured) fetchEmails(1); }, [imapConfigured, fetchEmails]);

  const openMail = async (uid) => {
    setSelectedUid(uid);
    setDetail(null);
    setDetailLoading(true);
    try {
      const res = await authFetch(`${API}/api/email-inbox?uid=${uid}`);
      if (!res.ok) throw new Error("Nachricht konnte nicht geladen werden");
      const data = await res.json();
      setDetail(data);
    } catch (err) {
      setDetail({ error: err.message });
    } finally {
      setDetailLoading(false);
    }
  };

  const closeMail = () => { setSelectedUid(null); setDetail(null); };

  const totalPages = Math.max(1, Math.ceil(total / limit));

  const formatDate = (iso) => {
    if (!iso) return "";
    const d = new Date(iso);
    const today = new Date();
    if (d.toDateString() === today.toDateString()) {
      return d.toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" });
    }
    return d.toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit", year: "2-digit" });
  };

  const extractName = (from) => {
    if (!from) return "";
    const match = from.match(/^(.+?)\s*<.+>$/);
    return match ? match[1].trim() : from.replace(/<|>/g, "");
  };

  // ─── Loading config check ─────────────────────────────────────────────
  if (imapConfigured === null) {
    return (
      <div className="mailbox-panel">
        <div className="mailbox-loading">E-Mail-Konfiguration wird geprüft…</div>
      </div>
    );
  }

  // ─── Setup view ───────────────────────────────────────────────────────
  if (!imapConfigured) {
    return (
      <ImapSetup onConfigured={(user) => { setImapConfigured(true); setImapUser(user); }} />
    );
  }

  // ─── Detail view ──────────────────────────────────────────────────────
  if (selectedUid) {
    return (
      <div className="mailbox-panel">
        <div className="mailbox-header">
          <button className="ghost-btn mailbox-back-btn" onClick={closeMail}>← Zurück</button>
        </div>
        <div className="mailbox-detail">
          {detailLoading && <div className="mailbox-loading">Lade Nachricht…</div>}
          {detail?.error && <div className="mailbox-error">{detail.error}</div>}
          {detail && !detail.error && (
            <>
              <h2 className="mail-detail-subject">{detail.subject}</h2>
              <div className="mail-detail-meta">
                <span className="mail-detail-from">{detail.from}</span>
                <span className="mail-detail-date">{formatDate(detail.date)}</span>
              </div>
              {detail.to && <div className="mail-detail-to">An: {detail.to}</div>}
              {detail.attachments?.length > 0 && (
                <div className="mail-detail-attachments">
                  <IconPaperclip size={13} />
                  {detail.attachments.map((a, i) => (
                    <span key={i} className="mail-att-chip">{a.filename} ({Math.round(a.size / 1024)}KB)</span>
                  ))}
                </div>
              )}
              <div className="mail-detail-body">
                {detail.html ? (
                  <iframe
                    title="E-Mail-Inhalt"
                    srcDoc={detail.html}
                    sandbox="allow-same-origin"
                    className="mail-iframe"
                  />
                ) : (
                  <pre className="mail-text">{detail.text}</pre>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    );
  }

  // ─── List view ────────────────────────────────────────────────────────
  return (
    <div className="mailbox-panel">
      <div className="mailbox-header">
        <h2><IconMail size={18} /> Posteingang</h2>
        <div className="mailbox-header-actions">
          {imapUser && <span className="mailbox-connected-user">{imapUser}</span>}
          <button className="ghost-btn mailbox-refresh-btn" onClick={() => fetchEmails(page)} disabled={loading} title="Aktualisieren">
            <IconRefresh size={15} className={loading ? "spin" : ""} />
          </button>
        </div>
      </div>

      {error && <div className="mailbox-error">{error}</div>}

      {!error && emails.length === 0 && !loading && (
        <div className="mailbox-empty">Keine E-Mails gefunden</div>
      )}

      <div className="mailbox-list">
        {emails.map((mail) => {
          const isUnread = !mail.flags.includes("\\Seen");
          return (
            <div
              key={mail.uid}
              className={`mailbox-item${isUnread ? " unread" : ""}`}
              onClick={() => openMail(mail.uid)}
            >
              <div className="mailbox-item-left">
                <span className="mailbox-item-from">{extractName(mail.from)}</span>
                <span className="mailbox-item-subject">{mail.subject}</span>
              </div>
              <div className="mailbox-item-right">
                {mail.hasAttachment && <IconPaperclip size={12} className="mailbox-att-icon" />}
                <span className="mailbox-item-date">{formatDate(mail.date)}</span>
              </div>
            </div>
          );
        })}
      </div>

      {totalPages > 1 && (
        <div className="mailbox-pagination">
          <button className="ghost-btn" disabled={page <= 1 || loading} onClick={() => fetchEmails(page - 1)}>← Neuer</button>
          <span className="mailbox-page-info">Seite {page} / {totalPages}</span>
          <button className="ghost-btn" disabled={page >= totalPages || loading} onClick={() => fetchEmails(page + 1)}>Älter →</button>
        </div>
      )}
    </div>
  );
}

export default MailboxPanel;
