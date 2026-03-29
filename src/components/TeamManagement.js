import React, { useState } from "react";
import { collection, query, where, getDocs, addDoc, updateDoc, doc, setDoc } from "firebase/firestore";
import { db } from "../firebaseConfig";
import { formatDate } from "../utils/dates";
import { IconUsers, IconMail, IconPlus, IconLink, IconCrown } from "./Icons";

function TeamManagement({ currentUser, teamId, teamMembers, onRefresh, userRole, canAssignAdmins }) {
  const [activeSection, setActiveSection] = useState("members");
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState("agent");
  const [manualEmail, setManualEmail] = useState("");
  const [manualRole, setManualRole] = useState("agent");
  const [inviteLink, setInviteLink] = useState(null);
  const [linkCopied, setLinkCopied] = useState(false);
  const [linkExpiry, setLinkExpiry] = useState("48");
  const linkRole = "agent";
  const [statusMsg, setStatusMsg] = useState(null);
  const [loading, setLoading] = useState(false);
  const isAdmin = userRole === "admin";
  const adminCount = teamMembers.filter(m => m.role === "admin").length;
  const setMsg = (type, msg) => { setStatusMsg({ type, msg }); setTimeout(() => setStatusMsg(null), 5000); };

  const inviteByEmail = async () => {
    if (!inviteEmail.trim()) return;
    setLoading(true);
    try {
      const normalizedEmail = inviteEmail.trim().toLowerCase();
      const nextRole = canAssignAdmins ? inviteRole : "agent";
      const q = query(collection(db, "users"), where("teamId", "==", teamId), where("email", "==", normalizedEmail));
      const snap = await getDocs(q);
      const existingInvQ = query(
        collection(db, "invitations"),
        where("teamId", "==", teamId),
        where("invitedEmail", "==", normalizedEmail),
        where("status", "==", "pending")
      );
      const existingInvSnap = await getDocs(existingInvQ);
      if (snap.empty) {
        if (!existingInvSnap.empty) {
          await updateDoc(existingInvSnap.docs[0].ref, { teamId, role: nextRole, invitedBy: currentUser.email, updatedAt: new Date().toISOString() });
          setMsg("info", `Einladung für ${inviteEmail} aktualisiert.`);
        } else {
          await addDoc(collection(db, "invitations"), { teamId, invitedBy: currentUser.email, invitedEmail: normalizedEmail, role: nextRole, createdAt: new Date().toISOString(), status: "pending" });
          setMsg("info", `Einladung für ${inviteEmail} gespeichert.`);
        }
      } else {
        try {
          await updateDoc(doc(db, "users", snap.docs[0].id), { teamId, role: nextRole });
          setMsg("success", `${inviteEmail} wurde hinzugefügt.`);
        } catch {
          await addDoc(collection(db, "invitations"), { teamId, invitedBy: currentUser.email, invitedEmail: normalizedEmail, role: nextRole, createdAt: new Date().toISOString(), status: "pending" });
          setMsg("info", `${inviteEmail} als Einladung hinterlegt.`);
        }
      }
      setInviteEmail(""); setInviteRole("agent"); onRefresh();
    } catch (e) { setMsg("error", `Fehler (${e?.code || "unknown"}): ${e?.message || "Unbekannt"}`); }
    setLoading(false);
  };

  const addManually = async () => {
    if (!manualEmail.trim()) return;
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(manualEmail.trim())) { setMsg("error", "Ungültige E-Mail."); return; }
    setLoading(true);
    try {
      const normalizedEmail = manualEmail.trim().toLowerCase();
      const nextRole = canAssignAdmins ? manualRole : "agent";
      const q = query(collection(db, "users"), where("teamId", "==", teamId), where("email", "==", normalizedEmail));
      const snap = await getDocs(q);
      if (!snap.empty) {
        try {
          await updateDoc(doc(db, "users", snap.docs[0].id), { teamId, role: nextRole });
          setMsg("success", `${manualEmail} hinzugefügt.`);
        } catch {
          await addDoc(collection(db, "invitations"), {
            teamId,
            invitedBy: currentUser.email,
            invitedEmail: normalizedEmail,
            role: nextRole,
            createdAt: new Date().toISOString(),
            status: "pending",
            addedManually: true,
          });
          setMsg("info", `${manualEmail} als Einladung vorgemerkt.`);
        }
      } else {
        await addDoc(collection(db, "invitations"), { teamId, invitedBy: currentUser.email, invitedEmail: normalizedEmail, role: nextRole, createdAt: new Date().toISOString(), status: "pending", addedManually: true });
        setMsg("info", `${manualEmail} vorgemerkt.`);
      }
      setManualEmail(""); setManualRole("agent"); onRefresh();
    } catch (e) { setMsg("error", `Fehler (${e?.code || "unknown"}): ${e?.message || "Unbekannt"}`); }
    setLoading(false);
  };

  const generateInviteLink = async () => {
    setLoading(true);
    try {
      const nextRole = canAssignAdmins ? linkRole : "agent";
      const token = [...crypto.getRandomValues(new Uint8Array(24))].map(b => b.toString(16).padStart(2, "0")).join("");
      const expiresAt = new Date(Date.now() + parseInt(linkExpiry) * 60 * 60 * 1000).toISOString();
      await setDoc(doc(db, "inviteLinks", token), { teamId, createdBy: currentUser.email, role: nextRole, createdAt: new Date().toISOString(), expiresAt, usageCount: 0 });
      setInviteLink(`${window.location.origin}?invite=${token}`);
      setMsg("success", "Link erstellt.");
    } catch (e) { setMsg("error", "Fehler."); }
    setLoading(false);
  };

  const copyLink = () => { navigator.clipboard.writeText(inviteLink).then(() => { setLinkCopied(true); setTimeout(() => setLinkCopied(false), 2500); }); };

  const removeMember = async (email) => {
    const target = teamMembers.find(m => m.email === email);
    if (target?.role === "admin" && adminCount <= 1) { setMsg("error", "Letzter Admin kann nicht entfernt werden."); return; }
    if (!window.confirm(`${email} entfernen?`)) return;
    try {
      const q = query(collection(db, "users"), where("email", "==", email));
      const snap = await getDocs(q);
      if (!snap.empty) { await updateDoc(doc(db, "users", snap.docs[0].id), { teamId: `team-${snap.docs[0].id}`, role: "admin" }); onRefresh(); }
    } catch (e) { /* silent */ }
  };

  const toggleRole = async (email, currentRole) => {
    if (!canAssignAdmins) { setMsg("error", "Keine Berechtigung."); return; }
    if (currentRole === "admin" && adminCount <= 1) { setMsg("error", "Letzter Admin."); return; }
    try {
      const q = query(collection(db, "users"), where("email", "==", email));
      const snap = await getDocs(q);
      if (!snap.empty) { await updateDoc(doc(db, "users", snap.docs[0].id), { role: currentRole === "admin" ? "agent" : "admin" }); onRefresh(); }
    } catch (e) { /* silent */ }
  };

  const SECTIONS = [
    { id: "members", label: "Mitglieder", icon: <IconUsers size={15} /> },
    { id: "invite-email", label: "Per E-Mail", icon: <IconMail size={15} /> },
    { id: "add-manual", label: "Manuell anlegen", icon: <IconPlus size={15} /> },
    { id: "invite-link", label: "Einladungslink", icon: <IconLink size={15} /> },
  ];

  return (
    <div className="team-page">
      <div className="team-page-header">
        <div>
          <h1 className="page-title">Team-Verwaltung</h1>
          <p className="team-id-info">Team-ID: <code>{teamId}</code></p>
        </div>
        {!isAdmin && <p className="team-role-hint">Du bist als Agent angemeldet.</p>}
      </div>
      <div className="team-section-nav">
        {SECTIONS.map(s => (
          <button key={s.id} className={`team-section-tab ${activeSection === s.id ? "active" : ""} ${!isAdmin && s.id !== "members" ? "disabled" : ""}`} onClick={() => isAdmin || s.id === "members" ? setActiveSection(s.id) : setMsg("error", "Nur für Admins.")}>
            <span>{s.icon}</span> {s.label}
            {s.id === "members" && <span className="team-tab-count">{teamMembers.length}</span>}
          </button>
        ))}
      </div>
      {statusMsg && <div className={`invite-status ${statusMsg.type}`}>{statusMsg.msg}</div>}
      {activeSection === "members" && (
        <div className="card team-members-card">
          {teamMembers.length === 0 ? (<p className="empty-text">Noch keine Teammitglieder.</p>) : (
            <table className="members-table">
              <thead><tr><th>E-Mail</th><th>Rolle</th><th>Beigetreten</th>{isAdmin && <th>Aktionen</th>}</tr></thead>
              <tbody>
                {teamMembers.map(m => (
                  <tr key={m.email} className={m.email === currentUser.email ? "members-table-self" : ""}>
                    <td><div className="member-email-cell"><div className="member-avatar-sm">{m.email[0].toUpperCase()}</div><span>{m.email}</span>{m.email === currentUser.email && <span className="you-chip">Du</span>}</div></td>
                    <td><span className={`member-role-badge ${m.role}`}>{m.role === "admin" ? <><IconCrown size={12} /> Admin</> : "Agent"}</span></td>
                    <td className="member-date">{m.createdAt ? formatDate(m.createdAt) : "—"}</td>
                    {isAdmin && (<td>{m.email !== currentUser.email ? (<div className="member-actions">{canAssignAdmins && <button className="small-btn" onClick={() => toggleRole(m.email, m.role)}>{m.role === "admin" ? "→ Agent" : "→ Admin"}</button>}<button className="small-btn danger" onClick={() => removeMember(m.email)}>Entfernen</button></div>) : <span className="muted-text">—</span>}</td>)}
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
      {activeSection === "invite-email" && isAdmin && (
        <div className="card team-action-card">
          <h3>Mitglied per E-Mail einladen</h3>
          <div className="action-form">
            <div className="form-row"><label>E-Mail-Adresse</label><input type="email" placeholder="kollege@beispiel.de" value={inviteEmail} onChange={e => setInviteEmail(e.target.value)} onKeyDown={e => e.key === "Enter" && inviteByEmail()} disabled={loading} /></div>
            {canAssignAdmins && (<div className="form-row"><label>Rolle</label><div className="role-picker"><button className={`role-pick-btn ${inviteRole === "agent" ? "active" : ""}`} onClick={() => setInviteRole("agent")}>Agent<span className="role-desc">Leads anlegen &amp; bearbeiten</span></button><button className={`role-pick-btn ${inviteRole === "admin" ? "active" : ""}`} onClick={() => setInviteRole("admin")}><IconCrown size={12} /> Admin<span className="role-desc">Team verwalten</span></button></div></div>)}
            <button className="primary-btn" onClick={inviteByEmail} disabled={loading || !inviteEmail.trim()}>{loading ? "..." : "Einladung senden"}</button>
          </div>
        </div>
      )}
      {activeSection === "add-manual" && isAdmin && (
        <div className="card team-action-card">
          <h3>Mitglied manuell hinzufügen</h3>
          <div className="action-form">
            <div className="form-row"><label>E-Mail-Adresse</label><input type="email" placeholder="kollege@beispiel.de" value={manualEmail} onChange={e => setManualEmail(e.target.value)} disabled={loading} /></div>
            {canAssignAdmins && (<div className="form-row"><label>Rolle</label><div className="role-picker"><button className={`role-pick-btn ${manualRole === "agent" ? "active" : ""}`} onClick={() => setManualRole("agent")}>Agent</button><button className={`role-pick-btn ${manualRole === "admin" ? "active" : ""}`} onClick={() => setManualRole("admin")}><IconCrown size={12} /> Admin</button></div></div>)}
            <button className="primary-btn" onClick={addManually} disabled={loading || !manualEmail.trim()}>{loading ? "..." : "Hinzufügen"}</button>
          </div>
        </div>
      )}
      {activeSection === "invite-link" && isAdmin && (
        <div className="card team-action-card">
          <h3>Einladungslink generieren</h3>
          <div className="action-form">
            <div className="form-row"><label>Gültig für</label><div className="expiry-picker">{[["24", "24h"], ["48", "48h"], ["168", "7 Tage"], ["720", "30 Tage"]].map(([val, label]) => (<button key={val} className={`expiry-btn ${linkExpiry === val ? "active" : ""}`} onClick={() => setLinkExpiry(val)}>{label}</button>))}</div></div>
            <button className="primary-btn" onClick={generateInviteLink} disabled={loading}>{loading ? "..." : "Link generieren"}</button>
          </div>
          {inviteLink && (
            <div className="invite-link-box">
              <div className="invite-link-url">{inviteLink}</div>
              <div className="invite-link-actions">
                <button className={`copy-link-btn ${linkCopied ? "copied" : ""}`} onClick={copyLink}>{linkCopied ? "✓ Kopiert!" : "Kopieren"}</button>
                <a href={`https://wa.me/?text=${encodeURIComponent("Einladung: " + inviteLink)}`} target="_blank" rel="noopener noreferrer" className="share-btn whatsapp">WhatsApp</a>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default TeamManagement;
