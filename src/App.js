import React, { useMemo, useState, useEffect } from "react";
import { onAuthStateChanged, signOut } from "firebase/auth";
import {
  collection,
  addDoc,
  onSnapshot,
  updateDoc,
  deleteDoc,
  doc,
  query,
  where,
  getDoc,
  setDoc,
} from "firebase/firestore";
import { auth, db } from "./firebaseConfig";
import LoginPage from "./LoginPage";
import logo from "./logo.png";
import "./App.css";
// Lade-Overlay-Komponente
function LeadLoadingOverlay() {
  return (
    <div className="lead-loading-overlay">
      <div className="lead-loading-content">
        <img src={logo} alt="ENERGYO Logo" className="lead-loading-logo" />
        <div className="lead-loading-bar-container">
          <div className="lead-loading-bar" />
        </div>
        <div className="lead-loading-text">Tarifoptimierung gestartet ...</div>
      </div>
    </div>
  );
}

const initialForm = {
  company: "",
  person: "",
  phone: "",
  email: "",
  consumption: "",
  annualCosts: "",
  contractEnd: "unknown",
  customerType: "Privat",
  postalCode: "",
  currentProvider: "",
  bundleInquiry: false,
  followUp: "",
  attachments: [],
};

// Hilfsfunktionen
const isOpenCancellationWindow = (contractEnd) => {
  if (contractEnd === "unknown" || !contractEnd) return false;
  const end = new Date(contractEnd);
  const now = new Date();
  const daysUntilEnd = (end - now) / (1000 * 60 * 60 * 24);
  const monthsUntilEnd = daysUntilEnd / 30;
  return monthsUntilEnd >= 0 && monthsUntilEnd <= 4;
};

const getRestLaufzeit = (contractEnd) => {
  if (contractEnd === "unknown" || !contractEnd) return null;
  const end = new Date(contractEnd);
  const now = new Date();
  const daysLeft = (end - now) / (1000 * 60 * 60 * 24);
  const yearsLeft = daysLeft / 365;
  return yearsLeft;
};

const calculatePriority = (lead) => {
  const consumption = lead.consumption ? parseInt(lead.consumption) : 0;
  const laufzeit = getRestLaufzeit(lead.contractEnd);
  const hasCancellationWindow = isOpenCancellationWindow(lead.contractEnd);

  if (hasCancellationWindow || consumption >= 50000) {
    return "A";
  }

  if ((consumption >= 20000 && consumption < 50000) || (laufzeit && laufzeit >= 1 && laufzeit <= 2)) {
    return "B";
  }

  return "C";
};

const calculateUmsatzPotential = (consumption) => {
  if (!consumption) return 0;
  const kwh = parseInt(consumption);
  if (kwh >= 50000) {
    return kwh * 0.01;
  } else {
    return 150;
  }
};

const isContractEndUnrealistic = (contractEnd) => {
  if (contractEnd === "unknown" || !contractEnd) return false;
  const end = new Date(contractEnd);
  const now = new Date();
  return end < now;
};

const isTodayDue = (followUpDate) => {
  if (!followUpDate) return false;
  const today = new Date().toISOString().split("T")[0];
  return followUpDate === today;
};

const isOverdue = (followUpDate) => {
  if (!followUpDate) return false;
  const today = new Date().toISOString().split("T")[0];
  return followUpDate < today;
};

function App() {
  const [user, setUser] = useState(null);
  const [teamId, setTeamId] = useState(null);
  const [leads, setLeads] = useState([]);
  const [form, setForm] = useState(initialForm);
  const [commentText, setCommentText] = useState({});
  const [searchTerm, setSearchTerm] = useState("");
  const [filterPriority, setFilterPriority] = useState("all");
  const [filterStatus, setFilterStatus] = useState("all");
  const [filterCancellation, setFilterCancellation] = useState("all");
  const [loading, setLoading] = useState(false);

  // Auth State & Team Management
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (currentUser) => {
      setUser(currentUser);
      
      if (currentUser) {
        // Hole oder erstelle Team für User
        const userRef = doc(db, "users", currentUser.uid);
        try {
          const userDoc = await getDoc(userRef);
          if (userDoc.exists() && userDoc.data().teamId) {
            setTeamId(userDoc.data().teamId);
          } else {
            // Neuer User: Erstelle Team
            const newTeamId = `team-${currentUser.uid}`;
            await setDoc(userRef, {
              email: currentUser.email,
              teamId: newTeamId,
              createdAt: new Date().toISOString(),
            }, { merge: true });
            setTeamId(newTeamId);
          }
        } catch (error) {
          console.error("Fehler beim Team-Setup:", error);
          // Fallback: Erstelle Team direkt
          const newTeamId = `team-${currentUser.uid}`;
          setTeamId(newTeamId);
        }
      } else {
        setTeamId(null);
      }
    });
    return unsubscribe;
  }, []);

  // Real-time Firestore Listener - Team-based
  useEffect(() => {
    if (!user || !teamId) {
      setLeads([]);
      return;
    }

    const q = query(collection(db, "leads"), where("teamId", "==", teamId));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const leadsData = snapshot.docs.map((doc) => ({
        id: doc.id,
        ...doc.data(),
      }));
      setLeads(leadsData);
    });

    return unsubscribe;
  }, [user, teamId]);

  const handleChange = (e) => {
    const { name, value } = e.target;
    setForm((prev) => ({
      ...prev,
      [name]: value,
    }));
  };

  const addLead = async (e) => {
    e.preventDefault();

    if (!form.person.trim()) {
      alert("Bitte mindestens Ansprechpartner eintragen.");
      return;
    }

    if (!form.phone.trim() || !form.email.trim() || !form.postalCode.trim()) {
      alert("Bitte Telefon, E-Mail und PLZ ausfüllen.");
      return;
    }

    if (form.contractEnd !== "unknown" && isContractEndUnrealistic(form.contractEnd)) {
      const proceed = window.confirm("Das Vertragsende liegt in der Vergangenheit. Fortfahren?");
      if (!proceed) return;
    }

    setLoading(true);

    try {
      await addDoc(collection(db, "leads"), {
        ...form,
        teamId: teamId,
        createdBy: {
          email: user.email,
          timestamp: new Date().toISOString(),
        },
        status: "Neu",
        createdAt: new Date().toISOString(),
        comments: [],
      });
      // Lade-Overlay mindestens 1 Sekunde anzeigen
      setTimeout(() => {
        setForm(initialForm);
        setLoading(false);
      }, 1000);
    } catch (error) {
      console.error("Fehler beim Speichern:", error);
      alert("Fehler beim Speichern des Leads");
      setLoading(false);
    }
  };

  const updateLeadStatus = async (id, newStatus) => {
    try {
      await updateDoc(doc(db, "leads", id), { status: newStatus });
    } catch (error) {
      console.error("Fehler beim Update:", error);
    }
  };

  const updateLeadField = async (id, field, value) => {
    try {
      await updateDoc(doc(db, "leads", id), { [field]: value });
    } catch (error) {
      console.error("Fehler beim Update:", error);
    }
  };

  const addComment = async (leadId, text) => {
    if (!text.trim()) return;

    const leadDoc = leads.find((l) => l.id === leadId);
    if (!leadDoc) return;

    const updatedComments = (leadDoc.comments || []).concat({
      timestamp: new Date().toISOString(),
      text: text.trim(),
    });

    try {
      await updateDoc(doc(db, "leads", leadId), { comments: updatedComments });
      setCommentText((prev) => ({ ...prev, [leadId]: "" }));
    } catch (error) {
      console.error("Fehler beim Speichern des Kommentars:", error);
    }
  };

  const deleteLead = async (id) => {
    if (window.confirm("Lead wirklich löschen?")) {
      try {
        await deleteDoc(doc(db, "leads", id));
      } catch (error) {
        console.error("Fehler beim Löschen:", error);
      }
    }
  };

  const handleFileUpload = (e) => {
    const files = Array.from(e.target.files);
    files.forEach((file) => {
      if (file.size > 10 * 1024 * 1024) {
        alert(`Datei ${file.name} ist zu groß (max 10MB)`);
        return;
      }

      const reader = new FileReader();
      reader.onload = (event) => {
        setForm((prev) => ({
          ...prev,
          attachments: [
            ...prev.attachments,
            {
              id: Date.now() + Math.random(),
              name: file.name,
              size: file.size,
              type: file.type,
              data: event.target.result,
              uploadedAt: new Date().toISOString(),
            },
          ],
        }));
      };
      reader.readAsDataURL(file);
    });
  };

  const removeAttachment = (attachmentId) => {
    setForm((prev) => ({
      ...prev,
      attachments: prev.attachments.filter((att) => att.id !== attachmentId),
    }));
  };

  const addLeadAttachment = (leadId, files) => {
    Array.from(files).forEach((file) => {
      if (file.size > 10 * 1024 * 1024) {
        alert(`Datei ${file.name} ist zu groß (max 10MB)`);
        return;
      }

      const reader = new FileReader();
      reader.onload = async (event) => {
        const leadDoc = leads.find((l) => l.id === leadId);
        if (!leadDoc) return;

        const newAttachment = {
          id: Date.now() + Math.random(),
          name: file.name,
          size: file.size,
          type: file.type,
          data: event.target.result,
          uploadedAt: new Date().toISOString(),
        };

        try {
          await updateDoc(doc(db, "leads", leadId), {
            attachments: [...(leadDoc.attachments || []), newAttachment],
          });
        } catch (error) {
          console.error("Fehler beim Upload:", error);
        }
      };
      reader.readAsDataURL(file);
    });
  };

  const removeLeadAttachment = async (leadId, attachmentId) => {
    const leadDoc = leads.find((l) => l.id === leadId);
    if (!leadDoc) return;

    try {
      await updateDoc(doc(db, "leads", leadId), {
        attachments: leadDoc.attachments.filter((att) => att.id !== attachmentId),
      });
    } catch (error) {
      console.error("Fehler beim Löschen:", error);
    }
  };

  // Filtered & Sorted Leads
  const filteredAndSortedLeads = useMemo(() => {
    let filtered = leads.filter((lead) => {
      const priority = calculatePriority(lead);
      const hasCancellationWindow = isOpenCancellationWindow(lead.contractEnd);

      const searchLower = searchTerm.toLowerCase();
      const matchesSearch =
        lead.company.toLowerCase().includes(searchLower) ||
        lead.person.toLowerCase().includes(searchLower) ||
        lead.phone.includes(searchTerm) ||
        lead.email.toLowerCase().includes(searchLower);

      if (!matchesSearch) return false;
      if (filterPriority !== "all" && priority !== filterPriority) return false;
      if (filterStatus !== "all" && lead.status !== filterStatus) return false;
      if (filterCancellation !== "all") {
        if (filterCancellation === "open" && !hasCancellationWindow) return false;
        if (filterCancellation === "closed" && hasCancellationWindow) return false;
      }

      return true;
    });

    filtered.sort((a, b) => {
      const priorityA = calculatePriority(a);
      const priorityB = calculatePriority(b);
      const priorityOrder = { A: 0, B: 1, C: 2 };

      if (priorityOrder[priorityA] !== priorityOrder[priorityB]) {
        return priorityOrder[priorityA] - priorityOrder[priorityB];
      }

      const cancellationA = isOpenCancellationWindow(a.contractEnd);
      const cancellationB = isOpenCancellationWindow(b.contractEnd);
      if (cancellationA !== cancellationB) {
        return cancellationA ? -1 : 1;
      }

      return new Date(b.createdAt) - new Date(a.createdAt);
    });

    return filtered;
  }, [leads, searchTerm, filterPriority, filterStatus, filterCancellation]);

  // Stats
  const stats = useMemo(() => {
    const totalLeads = leads.length;
    const newLeads = leads.filter((lead) => lead.status === "Neu").length;
    const contactedLeads = leads.filter((lead) => lead.status === "Kontaktiert").length;
    const followUps = leads.filter((lead) => lead.status === "Nachfassen").length;
    const wonLeads = leads.filter((lead) => lead.status === "Gewonnen").length;
    const lostLeads = leads.filter((lead) => lead.status === "Verloren").length;

    const dueToday = leads.filter((lead) => isTodayDue(lead.followUp)).length;
    const overdue = leads.filter((lead) => isOverdue(lead.followUp)).length;

    const priorityA = leads.filter((lead) => calculatePriority(lead) === "A").length;
    const priorityB = leads.filter((lead) => calculatePriority(lead) === "B").length;
    const priorityC = leads.filter((lead) => calculatePriority(lead) === "C").length;

    const openCancellation = leads.filter((lead) => isOpenCancellationWindow(lead.contractEnd)).length;

    const totalUmsatzPotential = leads.reduce((sum, lead) => sum + calculateUmsatzPotential(lead.consumption), 0);

    const closingRate = totalLeads > 0 ? Math.round((wonLeads / totalLeads) * 100) : 0;

    return {
      totalLeads,
      newLeads,
      contactedLeads,
      followUps,
      wonLeads,
      lostLeads,
      dueToday,
      overdue,
      closingRate,
      priorityA,
      priorityB,
      priorityC,
      openCancellation,
      totalUmsatzPotential,
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [leads]);


  if (!user) {
    return <LoginPage onLogin={setUser} user={user} />;
  }

  return (
    <div className="app">
      {loading && <LeadLoadingOverlay />}
      <header className="hero">
        <div className="hero-content" style={{display: 'flex', flexDirection: 'column', alignItems: 'center'}}>
          <img src={logo} alt="ENERGYO Logo" style={{width: 180, height: 'auto', marginBottom: 8}} />
          <p className="subtitle energyo-subtitle">
            Leads erfassen, Nachfassen steuern, Abschlüsse im Blick behalten.
          </p>
        </div>
        <button className="logout-btn" onClick={() => signOut(auth)}>
          Abmelden ({user.email})
        </button>
      </header>

      <section className="stats-grid">
        <div className="card stat warning">
          <h3>Überfällig</h3>
          <p>{stats.overdue}</p>
        </div>

        <div className="card stat warning">
          <h3>Heute fällig</h3>
          <p>{stats.dueToday}</p>
        </div>

        <div className="card stat alert">
          <h3>Kündigungsfenster offen</h3>
          <p>{stats.openCancellation}</p>
        </div>

        <div className="card stat highlight">
          <h3>Priorität A</h3>
          <p>{stats.priorityA}</p>
        </div>

        <div className="card stat">
          <h3>Priorität B</h3>
          <p>{stats.priorityB}</p>
        </div>

        <div className="card stat">
          <h3>Priorität C</h3>
          <p>{stats.priorityC}</p>
        </div>

        <div className="card stat">
          <h3>Nachfassen aktiv</h3>
          <p>{stats.followUps}</p>
        </div>

        <div className="card stat">
          <h3>Kontaktiert</h3>
          <p>{stats.contactedLeads}</p>
        </div>

        <div className="card stat">
          <h3>Neu</h3>
          <p>{stats.newLeads}</p>
        </div>

        <div className="card stat success">
          <h3>Gewonnen</h3>
          <p>{stats.wonLeads}</p>
        </div>

        <div className="card stat">
          <h3>Verloren</h3>
          <p>{stats.lostLeads}</p>
        </div>

        <div className="card stat">
          <h3>Abschlussquote</h3>
          <p>{stats.closingRate}%</p>
        </div>

        <div className="card stat">
          <h3>Leads gesamt</h3>
          <p>{stats.totalLeads}</p>
        </div>

        <div className="card stat umsatz-card">
          <h3>Umsatzpotential</h3>
          <p>€{stats.totalUmsatzPotential.toFixed(0)}</p>
        </div>
      </section>

      <section className="grid">
        <div className="card form-card">
          <h2>Neuer Lead</h2>

          <form onSubmit={addLead} className="form-grid">
            <input
              name="company"
              placeholder="Firma"
              value={form.company}
              onChange={handleChange}
              disabled={loading}
            />

            <input
              name="person"
              placeholder="Ansprechpartner *"
              value={form.person}
              onChange={handleChange}
              disabled={loading}
            />

            <input
              name="phone"
              placeholder="Telefon *"
              value={form.phone}
              onChange={handleChange}
              disabled={loading}
            />

            <input
              name="email"
              placeholder="E-Mail *"
              value={form.email}
              onChange={handleChange}
              disabled={loading}
            />

            <input
              name="postalCode"
              placeholder="PLZ *"
              value={form.postalCode}
              onChange={handleChange}
              disabled={loading}
            />

            <select name="customerType" value={form.customerType} onChange={handleChange} disabled={loading}>
              <option>Privat</option>
              <option>Gewerbe</option>
              <option>Großkunde</option>
            </select>

            <input
              name="currentProvider"
              placeholder="Aktueller Anbieter"
              value={form.currentProvider}
              onChange={handleChange}
              disabled={loading}
            />

            <input
              name="consumption"
              placeholder="Verbrauch (kWh)"
              type="number"
              value={form.consumption}
              onChange={handleChange}
              disabled={loading}
            />

            <input
              name="annualCosts"
              placeholder="Jahreskosten (€)"
              type="number"
              value={form.annualCosts}
              onChange={handleChange}
              disabled={loading}
            />

            <select name="contractEnd" value={form.contractEnd} onChange={handleChange} disabled={loading}>
              <option value="unknown">Vertragsende unbekannt</option>
              <option value="">--- oder Datum eingeben ---</option>
            </select>

            {form.contractEnd && form.contractEnd !== "unknown" && (
              <input
                type="date"
                name="contractEnd"
                value={form.contractEnd}
                onChange={handleChange}
                disabled={loading}
              />
            )}

            <label className="checkbox-label">
              <input
                type="checkbox"
                name="bundleInquiry"
                checked={form.bundleInquiry}
                onChange={(e) => setForm((prev) => ({ ...prev, bundleInquiry: e.target.checked }))}
                disabled={loading}
              />
              Bündelanfrage (mehrere Lieferstellen)
            </label>

            <input
              type="date"
              name="followUp"
              placeholder="Nachfass-Datum"
              value={form.followUp}
              onChange={handleChange}
              disabled={loading}
            />

            <div className="file-upload-section">
              <label htmlFor="file-input" className="file-upload-label">
                📎 Dateien hochladen (max 10MB)
              </label>
              <input
                id="file-input"
                type="file"
                multiple
                onChange={handleFileUpload}
                className="file-input"
                disabled={loading}
              />
              {form.attachments.length > 0 && (
                <div className="attachment-list">
                  {form.attachments.map((att) => (
                    <div key={att.id} className="attachment-item">
                      <span className="attachment-name">{att.name}</span>
                      <span className="attachment-size">({(att.size / 1024).toFixed(1)} KB)</span>
                      <button type="button" onClick={() => removeAttachment(att.id)} className="attachment-remove">
                        ✕
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <button type="submit" className="primary-btn" disabled={loading}>
              {loading ? "Wird gespeichert..." : "Lead speichern"}
            </button>
          </form>
        </div>

        <div className="card leads-card">
          <h2>Lead-Pipeline</h2>

          <div className="search-filter-section">
            <input
              type="text"
              placeholder="🔍 Suche: Firma, Ansprechpartner, Telefon, E-Mail..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="search-input"
            />

            <div className="filter-controls">
              <select value={filterPriority} onChange={(e) => setFilterPriority(e.target.value)} className="filter-select">
                <option value="all">Alle Prioritäten</option>
                <option value="A">Priorität A</option>
                <option value="B">Priorität B</option>
                <option value="C">Priorität C</option>
              </select>

              <select value={filterStatus} onChange={(e) => setFilterStatus(e.target.value)} className="filter-select">
                <option value="all">Alle Status</option>
                <option value="Neu">Neu</option>
                <option value="Kontaktiert">Kontaktiert</option>
                <option value="Angebot">Angebot</option>
                <option value="Nachfassen">Nachfassen</option>
                <option value="Gewonnen">Gewonnen</option>
                <option value="Verloren">Verloren</option>
              </select>

              <select value={filterCancellation} onChange={(e) => setFilterCancellation(e.target.value)} className="filter-select">
                <option value="all">Kündigungsfenster: Alle</option>
                <option value="open">Fenster offen</option>
                <option value="closed">Fenster geschlossen</option>
              </select>
            </div>

            <div className="filter-summary">
              Zeige {filteredAndSortedLeads.length} von {leads.length} Leads
            </div>
          </div>

          {filteredAndSortedLeads.length === 0 ? (
            <p className="no-leads">
              Keine Leads gefunden. {searchTerm && "Suchbegriff prüfen."}
            </p>
          ) : (
            <div className="lead-list">
              {filteredAndSortedLeads.map((lead) => {
                const priority = calculatePriority(lead);
                const umsatzPotential = calculateUmsatzPotential(lead.consumption);
                const hasCancellationWindow = isOpenCancellationWindow(lead.contractEnd);
                const hasUnrealisticEnd = lead.contractEnd !== "unknown" && lead.contractEnd && isContractEndUnrealistic(lead.contractEnd);
                const isTodayDueNow = isTodayDue(lead.followUp);
                const isOverdueNow = isOverdue(lead.followUp);

                return (
                  <div key={lead.id} className={`lead-item priority-${priority}`}>
                    <div className="lead-header">
                      <div className="lead-title">
                        <h3>{lead.company}</h3>
                        <p className="muted">{lead.person}</p>
                      </div>

                      <div className="lead-badges">
                        <span className={`badge priority-${priority}`}>Prio {priority}</span>
                        {hasCancellationWindow && <span className="badge alert">🔔 Kündigungsfenster offen</span>}
                        {lead.contractEnd === "unknown" && <span className="badge warning">❓ Vertragsende unbekannt</span>}
                        {hasUnrealisticEnd && <span className="badge warning">⚠️ Vertragsende vergangen</span>}
                        {isTodayDueNow && <span className="badge success">📅 Heute fällig</span>}
                        {isOverdueNow && <span className="badge danger">⏰ Überfällig</span>}
                        {lead.bundleInquiry && <span className="badge info">📦 Bündelanfrage</span>}
                      </div>
                    </div>

                    <div className="lead-umsatz">
                      <span className="umsatz-label">Umsatzpotential:</span>
                      <span className="umsatz-value">
                        €{umsatzPotential.toFixed(2)}
                        {lead.consumption && parseInt(lead.consumption) >= 50000 ? ` (${parseInt(lead.consumption)} kWh × 0,01 €)` : " (pauschal)"}
                      </span>
                    </div>

                    {lead.createdBy && (
                      <div className="lead-created-by">
                        <small>Erstellt von: <strong>{lead.createdBy.email}</strong> am {new Date(lead.createdBy.timestamp).toLocaleDateString("de-DE")} {new Date(lead.createdBy.timestamp).toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" })}</small>
                      </div>
                    )}

                    <div className="lead-section">
                      <div className="lead-field">
                        <label>Kontakt</label>
                        <div className="field-content">
                          <span>{lead.phone || "—"}</span>
                          <span>{lead.email || "—"}</span>
                        </div>
                      </div>

                      <div className="lead-field">
                        <label>Kundentyp / PLZ</label>
                        <div className="field-content">
                          <span>{lead.customerType}</span>
                          <span>{lead.postalCode || "—"}</span>
                        </div>
                      </div>

                      <div className="lead-field">
                        <label>Anbieter / Verbrauch</label>
                        <div className="field-content">
                          <span>{lead.currentProvider || "—"}</span>
                          <span>{lead.consumption ? `${lead.consumption} kWh` : "—"}</span>
                        </div>
                      </div>

                      <div className="lead-field">
                        <label>Jahreskosten (aktuell)</label>
                        <div className="field-content">
                          <span>{lead.annualCosts ? `€${parseInt(lead.annualCosts).toLocaleString("de-DE")}` : "—"}</span>
                        </div>
                      </div>

                      <div className="lead-field">
                        <label>Vertragsende</label>
                        <select value={lead.contractEnd} onChange={(e) => updateLeadField(lead.id, "contractEnd", e.target.value)} className="lead-select">
                          <option value="unknown">Unbekannt</option>
                          <option value="">--- oder Datum wählen ---</option>
                          {lead.contractEnd && lead.contractEnd !== "unknown" && <option value={lead.contractEnd}>{lead.contractEnd}</option>}
                        </select>
                        {lead.contractEnd && lead.contractEnd !== "unknown" && (
                          <input
                            type="date"
                            value={lead.contractEnd}
                            onChange={(e) => updateLeadField(lead.id, "contractEnd", e.target.value)}
                            className="lead-input-date"
                          />
                        )}
                      </div>
                    </div>

                    <div className="lead-section">
                      <div className="lead-field">
                        <label>Status</label>
                        <select value={lead.status} onChange={(e) => updateLeadStatus(lead.id, e.target.value)} className="lead-select">
                          <option>Neu</option>
                          <option>Kontaktiert</option>
                          <option>Angebot</option>
                          <option>Nachfassen</option>
                          <option>Gewonnen</option>
                          <option>Verloren</option>
                        </select>
                      </div>

                      <div className="lead-field">
                        <label>Nachfass-Datum</label>
                        <input
                          type="date"
                          value={lead.followUp || ""}
                          onChange={(e) => updateLeadField(lead.id, "followUp", e.target.value)}
                          className="lead-input-date"
                        />
                      </div>
                    </div>

                    {lead.attachments && lead.attachments.length > 0 && (
                      <div className="lead-attachments">
                        <label>📎 Anhänge ({lead.attachments.length})</label>
                        <div className="attachments-list">
                          {lead.attachments.map((att) => (
                            <div key={att.id} className="attachment-item-lead">
                              <div className="attachment-info">
                                <span className="attachment-name">{att.name}</span>
                                <span className="attachment-size">({(att.size / 1024).toFixed(1)} KB)</span>
                                <span className="attachment-date">
                                  {new Date(att.uploadedAt).toLocaleDateString("de-DE")}
                                </span>
                              </div>
                              <div className="attachment-actions">
                                <a href={att.data} download={att.name} className="attachment-download" title="Herunterladen">
                                  ⬇️
                                </a>
                                <button type="button" onClick={() => removeLeadAttachment(lead.id, att.id)} className="attachment-delete" title="Löschen">
                                  ✕
                                </button>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    <div className="lead-file-upload">
                      <label htmlFor={`file-upload-${lead.id}`} className="file-upload-label-lead">
                        📁 Datei hochladen (Zählerfoto, Rechnung, etc.)
                      </label>
                      <input
                        id={`file-upload-${lead.id}`}
                        type="file"
                        multiple
                        onChange={(e) => addLeadAttachment(lead.id, e.target.files)}
                        className="file-input"
                      />
                    </div>

                    <div className="lead-comments">
                      <label>Kommentare</label>
                      <div className="comments-list">
                        {lead.comments && lead.comments.length > 0 ? (
                          lead.comments.map((comment, idx) => (
                            <div key={idx} className="comment-item">
                              <span className="comment-date">
                                {new Date(comment.timestamp).toLocaleDateString("de-DE")}{" "}
                                {new Date(comment.timestamp).toLocaleTimeString("de-DE", {
                                  hour: "2-digit",
                                  minute: "2-digit",
                                })}
                              </span>
                              <p className="comment-text">{comment.text}</p>
                            </div>
                          ))
                        ) : (
                          <p className="empty-text">Noch keine Kommentare</p>
                        )}
                      </div>

                      <div className="comment-input">
                        <input
                          type="text"
                          placeholder="Kommentar hinzufügen..."
                          value={commentText[lead.id] || ""}
                          onChange={(e) => setCommentText((prev) => ({ ...prev, [lead.id]: e.target.value }))}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") {
                              addComment(lead.id, commentText[lead.id] || "");
                            }
                          }}
                        />
                        <button type="button" onClick={() => addComment(lead.id, commentText[lead.id] || "")} className="comment-btn">
                          Speichern
                        </button>
                      </div>
                    </div>

                    <div className="lead-actions">
                      <button className="danger-btn" onClick={() => deleteLead(lead.id)}>
                        Löschen
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </section>
    </div>
  );
}

    e.preventDefault();

    if (!form.person.trim()) {
      alert("Bitte mindestens Ansprechpartner eintragen.");
      return;
    }

    if (!form.phone.trim() || !form.email.trim() || !form.postalCode.trim()) {
      alert("Bitte Telefon, E-Mail und PLZ ausfüllen.");
      return;
    }

    if (form.contractEnd !== "unknown" && isContractEndUnrealistic(form.contractEnd)) {
      const proceed = window.confirm("Das Vertragsende liegt in der Vergangenheit. Fortfahren?");
      if (!proceed) return;
    }

    if (!teamId) {
      alert("Team-ID ist noch nicht geladen. Bitte warte einen Moment und versuche es erneut.");
      return;
    }

    setLoading(true);

    try {
      await addDoc(collection(db, "leads"), {
        ...form,
        teamId: teamId,
        createdBy: {
          email: user.email,
          timestamp: new Date().toISOString(),
        },
        status: "Neu",
        createdAt: new Date().toISOString(),
        comments: [],
      });
      setForm(initialForm);
    } catch (error) {
      console.error("Fehler beim Speichern:", error);
      alert("Fehler beim Speichern des Leads");
    }
    setLoading(false);
  };
