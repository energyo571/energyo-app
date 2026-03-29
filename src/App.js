import React, { useMemo, useState, useEffect, useCallback } from "react";
import { onAuthStateChanged, signOut } from "firebase/auth";
import {
  collection, updateDoc, doc, query, where, getDoc, setDoc, getDocs,
} from "firebase/firestore";
import { auth, db } from "./firebaseConfig";
import LoginPage from "./LoginPage";
import "./App.css";
import "./mobile.css";

// ─── Custom Hooks ─────────────────────────────────────────────────────────────
import useLeads from "./hooks/useLeads";

// ─── Constants & Utils ────────────────────────────────────────────────────────
import { STATUS_OPTIONS, RENEWAL_RESURFACE_MONTHS } from "./constants";
import { formatDate, isOverdue, isTodayDue, isOpenCancellationWindow, getMonthsUntil, getHoursSince } from "./utils/dates";
import { calculateUmsatzPotential } from "./utils/energy";
import {
  getLeadOwnerEmail, getLastActivityTimestamp, isLeadInactiveForHours,
  isWonLeadRenewalDue, getWechselProgress, hasSupplyConfirmation,
  calculatePriority, calculateLeadScore, getLeadTemperature,
  sortLeads,
} from "./utils/leads";

// ─── Components ───────────────────────────────────────────────────────────────
import LeadLoadingOverlay from "./components/LeadLoadingOverlay";
import Sidebar from "./components/Sidebar";
import Dashboard from "./components/Dashboard";
import CalendarView from "./components/CalendarView";
import TeamManagement from "./components/TeamManagement";
import LeadRow from "./components/LeadRow";
import KanbanBoard from "./components/KanbanBoard";
import LeadDetailDrawer from "./components/LeadDetailDrawer";
import NewLeadModal from "./components/NewLeadModal";
import ImportModal from "./components/ImportModal";
import PowerDialer from "./components/PowerDialer";
import BulkActionBar from "./components/BulkActionBar";
import { IconSearch, IconList, IconGrid, IconCheckSquare, IconX, IconPlus, IconUpload, IconZap, IconFilter } from "./components/Icons";

// ─── InviteLink-Handler ───────────────────────────────────────────────────────
async function acceptInviteLink(token, userId, userEmail) {
  try {
    const linkDoc = await getDoc(doc(db, "inviteLinks", token));
    if (!linkDoc.exists()) return { ok: false, msg: "Ungültig." };
    const data = linkDoc.data();
    if (new Date(data.expiresAt) < new Date()) return { ok: false, msg: "Abgelaufen." };
    await updateDoc(doc(db, "users", userId), { teamId: data.teamId, role: data.role || "agent" });
    await updateDoc(doc(db, "inviteLinks", token), { usageCount: (data.usageCount || 0) + 1 });
    return { ok: true, teamId: data.teamId, role: data.role || "agent" };
  } catch (e) { return { ok: false, msg: "Fehler." }; }
}

// ─── App ──────────────────────────────────────────────────────────────────────
function App() {
  const [user, setUser] = useState(null);
  const [userProfile, setUserProfile] = useState(null);
  const [avatarUploading, setAvatarUploading] = useState(false);
  const [userRole, setUserRole] = useState("agent");
  const [canAssignAdmins, setCanAssignAdmins] = useState(false);
  const [teamId, setTeamId] = useState(null);
  const [teamMembers, setTeamMembers] = useState([]);
  const [searchTerm, setSearchTerm] = useState("");
  const [filterPriority, setFilterPriority] = useState("all");
  const [filterStatus, setFilterStatus] = useState("all");
  const [activeTab, setActiveTab] = useState("leads");
  const [selectedLeadId, setSelectedLeadId] = useState(null);
  const [viewMode, setViewMode] = useState("list");
  const [showNewLeadModal, setShowNewLeadModal] = useState(false);
  const [showImportModal, setShowImportModal] = useState(false);
  const [showPowerDialer, setShowPowerDialer] = useState(false);
  const [smartView, setSmartView] = useState("all");
  const [sortMode, setSortMode] = useState("priority");
  const [kpiFocus, setKpiFocus] = useState("all");
  const [focusPreset, setFocusPreset] = useState("all");
  const [showAdvancedFilters, setShowAdvancedFilters] = useState(false);
  const [leadsPerPage, setLeadsPerPage] = useState(25);
  const [currentPage, setCurrentPage] = useState(1);

  // Multiselect state
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedLeadIds, setSelectedLeadIds] = useState(new Set());

  // ─── Lead data & CRUD (custom hook) ─────────────────────────────────────────
  const {
    leads, loading,
    addLead, onImportLeads,
    updateLeadStatus, updateLeadField,
    logCall, deleteLead, bulkDeleteLeads: bulkDeleteLeadsById,
    addLeadAttachment, removeLeadAttachment,
  } = useLeads(user, teamId, userRole);

  const applyKpiFocus = (focus) => {
    setKpiFocus(focus);
    if (focus === "overdue" || focus === "today") {
      setFocusPreset(focus);
      setSortMode("followUp");
      setSmartView("action");
      setFilterStatus("all");
      return;
    }
    if (focus === "inactive48") {
      setFocusPreset("inactive48");
      setSortMode("activity");
      setSmartView("action");
      setFilterStatus("all");
      setFilterPriority("all");
      setSearchTerm("");
      return;
    }
    if (focus === "cancellation" || focus === "priorityA") {
      setFocusPreset(focus === "priorityA" ? "hot" : "cancellation");
      setSortMode("priority");
      setSmartView("all");
      return;
    }
    if (focus === "won") {
      setFocusPreset("won");
      setSortMode("activity");
      setSmartView("won");
      return;
    }
    setFocusPreset("all");
    setSmartView("all");
  };

  const applyFocusPreset = (preset) => {
    setFocusPreset(preset);
    if (preset === "all") {
      setSmartView("all");
      setKpiFocus("all");
      setFilterStatus("all");
      setFilterPriority("all");
      setSortMode("priority");
      return;
    }
    if (preset === "mine") { setSmartView("mine"); setKpiFocus("all"); return; }
    if (preset === "action") { setSmartView("action"); setKpiFocus("all"); setSortMode("followUp"); return; }
    if (preset === "hot") { setSmartView("hot"); setKpiFocus("all"); return; }
    if (preset === "renewals") { setSmartView("renewals"); setKpiFocus("all"); return; }
    if (preset === "won") { setSmartView("won"); setKpiFocus("won"); return; }
    if (preset === "lost") { setSmartView("lost"); setKpiFocus("all"); return; }
    if (preset === "uncontacted") {
      setSmartView("all"); setKpiFocus("all"); setFilterStatus("Neu"); setFilterPriority("all"); setSortMode("activity");
      return;
    }
    if (preset === "overdue" || preset === "today" || preset === "inactive48" || preset === "cancellation") {
      applyKpiFocus(preset);
      return;
    }
    if (preset === "stalledOffers") {
      setSmartView("all"); setKpiFocus("all"); setFilterStatus("Angebot"); setFilterPriority("all"); setSortMode("activity");
      return;
    }
  };

  // eslint-disable-next-line no-unused-vars
  const isFocusedView = useMemo(() => (
    focusPreset !== "all"
    || kpiFocus !== "all"
    || smartView !== "all"
    || filterPriority !== "all"
    || filterStatus !== "all"
    || !!searchTerm
  ), [focusPreset, kpiFocus, smartView, filterPriority, filterStatus, searchTerm]);

  const selectedLead = useMemo(() => leads.find(l => l.id === selectedLeadId) || null, [leads, selectedLeadId]);

  useEffect(() => {
    const handle = (e) => {
      if (e.key === "Escape") {
        if (selectionMode) { setSelectionMode(false); setSelectedLeadIds(new Set()); }
        else if (showNewLeadModal) setShowNewLeadModal(false);
        else if (selectedLeadId) setSelectedLeadId(null);
        else if (showPowerDialer) { setShowPowerDialer(false); }
      }
      if (e.key === "n" && !showNewLeadModal && !selectedLeadId && !selectionMode &&
        !["INPUT", "TEXTAREA", "SELECT"].includes(document.activeElement.tagName)) {
        setShowNewLeadModal(true);
      }
    };
    window.addEventListener("keydown", handle);
    return () => window.removeEventListener("keydown", handle);
  }, [showNewLeadModal, selectedLeadId, selectionMode, showPowerDialer]);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (currentUser) => {
      setUser(currentUser);
      if (!currentUser) { setTeamId(null); setTeamMembers([]); setCanAssignAdmins(false); setUserProfile(null); return; }
      const userRef = doc(db, "users", currentUser.uid);
      try {
        const userDoc = await getDoc(userRef);
        if (userDoc.exists() && userDoc.data().teamId) {
          const existingProfile = userDoc.data();
          const inferredRole = existingProfile.role || (existingProfile.teamId === `team-${currentUser.uid}` ? "admin" : "agent");
          const inferredCanAssignAdmins = existingProfile.canAssignAdmins === true || inferredRole === "admin";

          if (!existingProfile.role || typeof existingProfile.canAssignAdmins === "undefined") {
            await setDoc(userRef, {
              role: inferredRole,
              canAssignAdmins: inferredCanAssignAdmins,
            }, { merge: true });
          }

          setUserProfile({ ...existingProfile, role: inferredRole, canAssignAdmins: inferredCanAssignAdmins });
          setTeamId(existingProfile.teamId);
          setUserRole(inferredRole);
          setCanAssignAdmins(inferredCanAssignAdmins);
        } else {
          const newTeamId = `team-${currentUser.uid}`;
          const newProfile = { email: currentUser.email, teamId: newTeamId, role: "admin", createdAt: new Date().toISOString(), canAssignAdmins: true };
          await setDoc(userRef, newProfile, { merge: true });
          setUserProfile(newProfile);
          setTeamId(newTeamId); setUserRole("admin"); setCanAssignAdmins(true);
        }
        const normalizedCurrentEmail = (currentUser.email || "").trim().toLowerCase();
        if (normalizedCurrentEmail) {
          const invQ = query(collection(db, "invitations"), where("invitedEmail", "==", normalizedCurrentEmail), where("status", "==", "pending"));
          const invSnap = await getDocs(invQ);
          if (!invSnap.empty) {
            const pendingInvites = invSnap.docs.map(d => ({ id: d.id, ref: d.ref, ...d.data() })).sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));
            const activeInvite = pendingInvites[0];
            await updateDoc(doc(db, "users", currentUser.uid), { teamId: activeInvite.teamId, role: activeInvite.role || "agent" });
            for (const invitation of pendingInvites) { await updateDoc(invitation.ref, { status: invitation.id === activeInvite.id ? "accepted" : "superseded" }); }
            setTeamId(activeInvite.teamId); setUserRole(activeInvite.role || "agent"); setCanAssignAdmins(false);
          }
        }
        const urlToken = new URLSearchParams(window.location.search).get("invite");
        if (urlToken) {
          const result = await acceptInviteLink(urlToken, currentUser.uid, currentUser.email);
          if (result.ok) { setTeamId(result.teamId); setUserRole(result.role); setCanAssignAdmins(false); window.history.replaceState({}, document.title, window.location.pathname); }
        }
      } catch (e) { console.error(e); setTeamId(`team-${currentUser.uid}`); setCanAssignAdmins(false); }
    });
    return unsubscribe;
  }, []);

  const uploadUserAvatar = async (file) => {
    if (!user) return;
    if (!file.type.startsWith("image/")) {
      alert("Bitte nur Bilddateien auswählen.");
      return;
    }
    if (file.size > 2 * 1024 * 1024) {
      alert("Profilbild ist zu groß (max 2MB).");
      return;
    }

    setAvatarUploading(true);
    try {
      const dataUrl = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = (event) => resolve(event.target?.result || "");
        reader.onerror = () => reject(new Error("Lesefehler beim Bild"));
        reader.readAsDataURL(file);
      });

      if (!dataUrl) throw new Error("Ungültiges Bildformat");

      await setDoc(doc(db, "users", user.uid), {
        avatarDataUrl: dataUrl,
        avatarUpdatedAt: new Date().toISOString(),
      }, { merge: true });

      setUserProfile((prev) => ({ ...(prev || {}), avatarDataUrl: dataUrl }));
    } catch (error) {
      console.error(error);
      alert(`Profilbild konnte nicht gespeichert werden. (${error?.message || "Unbekannter Fehler"})`);
    } finally {
      setAvatarUploading(false);
    }
  };

  const loadTeamMembers = useCallback(async () => {
    if (!teamId) return;
    try {
      const q = query(collection(db, "users"), where("teamId", "==", teamId));
      const snap = await getDocs(q);
      setTeamMembers(snap.docs.map(d => ({ id: d.id, ...d.data() })));
    } catch (e) { console.error(e); }
  }, [teamId]);

  useEffect(() => { loadTeamMembers(); }, [loadTeamMembers]);

  // ─── Thin wrappers (UI side-effects around hook CRUD) ──────────────────────
  const handleAddLead = async (form, onSuccess) => {
    const newId = await addLead(form);
    if (newId) {
      onSuccess?.();
      setSelectedLeadId(newId);
    }
  };

  const handleBulkDelete = async () => {
    if (userRole !== "admin") return;
    await bulkDeleteLeadsById(Array.from(selectedLeadIds));
    setSelectedLeadIds(new Set());
    setSelectionMode(false);
  };

  const toggleLeadCheck = (id) => {
    setSelectedLeadIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };


  const filteredLeads = useMemo(() => {
    const sl = searchTerm.toLowerCase();
    return sortLeads(leads.filter(l => {
      const match = !sl || (l.company || "").toLowerCase().includes(sl) || (l.person || "").toLowerCase().includes(sl) || (l.phone || "").includes(searchTerm) || (l.email || "").toLowerCase().includes(sl);
      if (!match) return false;
      if (filterPriority !== "all" && calculatePriority(l) !== filterPriority) return false;
      if (filterStatus !== "all" && l.status !== filterStatus) return false;
      if (smartView === "mine" && getLeadOwnerEmail(l) !== user.email) return false;
      if (smartView === "action" && !(isOverdue(l.followUp) || isTodayDue(l.followUp) || isLeadInactiveForHours(l, 48))) return false;
      if (smartView === "hot" && getLeadTemperature(l).tone !== "hot") return false;
      if (smartView === "won" && l.status !== "Abschluss") return false;
      if (smartView === "lost" && l.status !== "Verloren") return false;
      if (smartView === "renewals" && !l.renewalResurfacedAt) return false;
      if (kpiFocus === "overdue" && !isOverdue(l.followUp)) return false;
      if (kpiFocus === "today" && !isTodayDue(l.followUp)) return false;
      if (kpiFocus === "inactive48" && !isLeadInactiveForHours(l, 48)) return false;
      if (kpiFocus === "cancellation" && !isOpenCancellationWindow(l.contractEnd)) return false;
      if (kpiFocus === "priorityA" && calculatePriority(l) !== "A") return false;
      if (kpiFocus === "won" && l.status !== "Abschluss") return false;
      return true;
    }), sortMode);
  }, [leads, searchTerm, filterPriority, filterStatus, smartView, sortMode, user, kpiFocus]);

  const activePipelineLeads = useMemo(
    () => filteredLeads.filter((lead) => (lead.status !== "Abschluss" || isWonLeadRenewalDue(lead, RENEWAL_RESURFACE_MONTHS)) && lead.status !== "Verloren"),
    [filteredLeads],
  );

  const displayLeads = useMemo(() => {
    if (smartView === "won" || kpiFocus === "won") return filteredLeads;
    if (smartView === "lost") return filteredLeads;
    return activePipelineLeads;
  }, [filteredLeads, activePipelineLeads, smartView, kpiFocus]);

  const totalPipelinePages = Math.max(1, Math.ceil(displayLeads.length / leadsPerPage));

  useEffect(() => {
    setCurrentPage(1);
  }, [searchTerm, filterPriority, filterStatus, smartView, sortMode, kpiFocus, leadsPerPage, viewMode]);

  useEffect(() => {
    if (currentPage > totalPipelinePages) setCurrentPage(totalPipelinePages);
  }, [currentPage, totalPipelinePages]);

  const paginatedActiveLeads = useMemo(() => {
    const start = (currentPage - 1) * leadsPerPage;
    return displayLeads.slice(start, start + leadsPerPage);
  }, [displayLeads, currentPage, leadsPerPage]);

  const wonBundleLeads = useMemo(() => {
    const bucket = filteredLeads.filter((lead) => lead.status === "Abschluss" && !isWonLeadRenewalDue(lead, RENEWAL_RESURFACE_MONTHS));
    return [...bucket].sort((a, b) => {
      const ma = getMonthsUntil(a.contractEnd);
      const mb = getMonthsUntil(b.contractEnd);
      return ma - mb;
    });
  }, [filteredLeads]);

  const lostBundleLeads = useMemo(() => {
    return filteredLeads.filter((lead) => lead.status === "Verloren")
      .sort((a, b) => new Date(b.updatedAt || b.createdAt || 0) - new Date(a.updatedAt || a.createdAt || 0));
  }, [filteredLeads]);

  const stats = useMemo(() => ({
    totalLeads: leads.length,
    wonLeads: leads.filter(l => l.status === "Abschluss").length,
    lostLeads: leads.filter(l => l.status === "Verloren").length,
    overdue: leads.filter(l => isOverdue(l.followUp)).length,
    dueToday: leads.filter(l => isTodayDue(l.followUp)).length,
    inactive48: leads.filter(l => isLeadInactiveForHours(l, 48)).length,
    priorityA: leads.filter(l => calculatePriority(l) === "A").length,
    openCancellation: leads.filter(l => isOpenCancellationWindow(l.contractEnd)).length,
    movedEnergyKwh: leads.filter(l => l.status !== "Verloren").reduce((sum, lead) => sum + (Number.parseInt(lead.consumption || 0, 10) || 0), 0),
    totalUmsatzPotential: leads.reduce((s, l) => s + calculateUmsatzPotential(l.consumption), 0),
    closingRate: leads.length > 0 ? Math.round((leads.filter(l => l.status === "Abschluss").length / leads.length) * 100) : 0,
  }), [leads]);

  // eslint-disable-next-line no-unused-vars
  const actionQueueLeads = useMemo(() =>
    leads
      .filter((lead) => isLeadInactiveForHours(lead, 48))
      .sort((a, b) => getHoursSince(getLastActivityTimestamp(b)) - getHoursSince(getLastActivityTimestamp(a)))
      .slice(0, 5),
  [leads]);

  const closeLeadDrawer = () => {
    setSelectedLeadId(null);
    if (!showPowerDialer) applyFocusPreset("all");
  };

  // Auto-open dialer on desktop when drawer opens
  useEffect(() => {
    if (selectedLeadId && window.innerWidth >= 1024 && !showPowerDialer) {
      setShowPowerDialer(true);
    }
  }, [selectedLeadId]); // eslint-disable-line react-hooks/exhaustive-deps

  const navigateToNextLead = useCallback(() => {
    if (!selectedLeadId || displayLeads.length === 0) return;
    const idx = displayLeads.findIndex(l => l.id === selectedLeadId);
    const nextIdx = idx + 1 < displayLeads.length ? idx + 1 : 0;
    setSelectedLeadId(displayLeads[nextIdx].id);
  }, [selectedLeadId, displayLeads]);

  if (!user) return <LoginPage onLogin={setUser} user={user} />;

  return (
    <div className={`app-layout${showPowerDialer ? " dialer-active" : ""}`}>
      {loading && <LeadLoadingOverlay />}
      <Sidebar
        activeTab={activeTab}
        setActiveTab={setActiveTab}
        user={user}
        userRole={userRole}
        userProfile={userProfile}
        avatarUploading={avatarUploading}
        onAvatarUpload={uploadUserAvatar}
        onSignOut={() => signOut(auth)}
        onCloseDrawer={closeLeadDrawer}
      />

      <div className="main-content">
        {activeTab === "leads" && (
          <>
            <div className="main-toolbar">
              <div className="toolbar-left">
                <h1 className="page-title">Lead-Pipeline</h1>
                <span className="lead-count-badge">{displayLeads.length}</span>
              </div>
              <div className="toolbar-right">
                <div className="toolbar-search-wrap">
                  <IconSearch size={14} className="toolbar-search-icon" />
                  <input type="text" placeholder="Suche nach Firma, Kontakt, Telefon..." value={searchTerm} onChange={e => setSearchTerm(e.target.value)} className="toolbar-search" />
                </div>
                <select value={sortMode} onChange={e => setSortMode(e.target.value)} className="filter-select-inline compact">
                  <option value="priority">Sortiert nach Priorität</option>
                  <option value="potential">Nach Potential</option>
                  <option value="activity">Nach Aktivität</option>
                  <option value="followUp">Nach Follow-up</option>
                </select>
                <select value={focusPreset} onChange={(e) => applyFocusPreset(e.target.value)} className="filter-select-inline compact focus-select">
                  <option value="all">Alle Leads</option>
                  <option value="mine">Meine Leads</option>
                  <option value="action">Action Queue</option>
                  <option value="hot">Hot Deals</option>
                  <option value="renewals">Renewals</option>
                  <option value="won">Abschlüsse</option>
                  <option value="lost">Verloren</option>
                  <option value="uncontacted">Unkontaktiert</option>
                  <option value="overdue">Überfällig</option>
                  <option value="today">Heute fällig</option>
                  <option value="inactive48">{'>'} 48h inaktiv</option>
                  <option value="cancellation">Kündigungsfenster</option>
                </select>
                <button type="button" className={`toolbar-icon-btn ${showAdvancedFilters ? 'active' : ''}`} onClick={() => setShowAdvancedFilters(v => !v)} title="Erweiterte Filter">
                  <IconFilter size={15} />
                </button>
                <div className="view-toggle-group">
                  <button className={`view-toggle-btn ${viewMode === "list" ? "active" : ""}`} onClick={() => setViewMode("list")}><IconList size={15} /></button>
                  <button className={`view-toggle-btn ${viewMode === "kanban" ? "active" : ""}`} onClick={() => setViewMode("kanban")}><IconGrid size={15} /></button>
                </div>
                {userRole === "admin" && (
                  <button
                    className={`selection-mode-btn ${selectionMode ? "active" : ""}`}
                    onClick={() => { setSelectionMode(v => !v); setSelectedLeadIds(new Set()); }}
                    title="Mehrfachauswahl"
                  >
                    {selectionMode ? <><IconX size={13} /> Auswahl</> : <><IconCheckSquare size={13} /> Auswählen</>}
                  </button>
                )}
                <div className="toolbar-actions">
                  <button type="button" className="toolbar-action-btn primary" onClick={() => setShowNewLeadModal(true)}><IconPlus size={14} /> Neuer Lead</button>
                  <button type="button" className="toolbar-action-btn" onClick={() => setShowImportModal(true)}><IconUpload size={14} /> Import</button>
                  <button type="button" className="toolbar-action-btn" onClick={() => setShowPowerDialer(true)}><IconZap size={14} /> Dialer</button>
                </div>
              </div>
            </div>

            {selectionMode && selectedLeadIds.size > 0 && (
              <BulkActionBar
                selectedCount={selectedLeadIds.size}
                totalCount={displayLeads.length}
                onDelete={handleBulkDelete}
                onCancel={() => { setSelectionMode(false); setSelectedLeadIds(new Set()); }}
                onSelectAll={() => {
                  if (selectedLeadIds.size === displayLeads.length) {
                    setSelectedLeadIds(new Set());
                  } else {
                    setSelectedLeadIds(new Set(displayLeads.map(l => l.id)));
                  }
                }}
              />
            )}
            {selectionMode && selectedLeadIds.size === 0 && (
              <div className="bulk-hint-bar">
                <IconCheckSquare size={14} /> Mehrfachauswahl aktiv – Leads anklicken zum Auswählen
                <button className="ghost-btn-sm" onClick={() => { setSelectionMode(false); setSelectedLeadIds(new Set()); }} style={{ marginLeft: 12 }}>Abbrechen</button>
              </div>
            )}

            <div className="focus-bar">
              <span className="filter-result-count">{displayLeads.length} sichtbar · {wonBundleLeads.length} Abschlüsse · {lostBundleLeads.length} Verloren gebündelt</span>
            </div>

            {showAdvancedFilters && (
              <div className="filter-bar compact">
                <select value={filterPriority} onChange={e => setFilterPriority(e.target.value)} className="filter-select-inline">
                  <option value="all">Alle Heat-Level</option>
                  <option value="A">Hot</option><option value="B">Warm</option><option value="C">Cold</option>
                </select>
                <select value={filterStatus} onChange={e => setFilterStatus(e.target.value)} className="filter-select-inline">
                  <option value="all">Alle Status</option>
                  {STATUS_OPTIONS.map(s => <option key={s}>{s}</option>)}
                </select>
                {(kpiFocus !== "all" || filterPriority !== "all" || filterStatus !== "all") && (
                  <button
                    type="button"
                    className="kpi-reset-btn"
                    onClick={() => {
                      setFilterPriority("all");
                      setFilterStatus("all");
                      setKpiFocus("all");
                      applyFocusPreset("all");
                    }}
                  >
                    Filter zurücksetzen
                  </button>
                )}
              </div>
            )}

            <div className="kpi-strip-compact">
              <div className="lead-pagination-inline">
                <select id="lead-page-size" value={leadsPerPage} onChange={(e) => setLeadsPerPage(Number(e.target.value))} className="filter-select-inline compact" style={{ minWidth: 60 }}>
                  <option value={25}>25</option><option value={50}>50</option><option value={100}>100</option>
                </select>
                <button type="button" className="ghost-btn-sm" disabled={currentPage <= 1} onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}>‹</button>
                <span>{currentPage}/{totalPipelinePages}</span>
                <button type="button" className="ghost-btn-sm" disabled={currentPage >= totalPipelinePages} onClick={() => setCurrentPage((p) => Math.min(totalPipelinePages, p + 1))}>›</button>
              </div>
            </div>

            {viewMode === "list" ? (
              <div className="leads-table-wrap">
                <div className="leads-table-header">
                  <div className="lth-checkbox" />
                  <div className="lth-signals">Signale</div>
                  <div className="lth-main">Unternehmen / Kontakt</div>
                  <div className="lth-energy">Energie</div>
                  <div className="lth-flags">Next step / Deal</div>
                  <div className="lth-status">Status</div>
                  <div className="lth-umsatz">Potential</div>
                  <div className="lth-followup">Follow-up</div>
                  <div className="lth-activity">Aktivität</div>
                </div>
                {displayLeads.length === 0 ? (
                  <div className="empty-leads">
                    <p>Keine Leads gefunden.</p>
                    <button className="new-lead-btn" onClick={() => setShowNewLeadModal(true)}>+ Ersten Lead anlegen</button>
                  </div>
                ) : (
                  paginatedActiveLeads.map(lead => (
                    <LeadRow
                      key={lead.id}
                      lead={lead}
                      onSelect={l => { if (!selectionMode) setSelectedLeadId(l.id); }}
                      isSelected={selectedLeadId === lead.id}
                      selectionMode={selectionMode}
                      isChecked={selectedLeadIds.has(lead.id)}
                      onToggleCheck={toggleLeadCheck}
                    />
                  ))
                )}
              </div>
            ) : (
              <KanbanBoard leads={paginatedActiveLeads} onSelectLead={l => setSelectedLeadId(l.id)} />
            )}

            {smartView !== "won" && kpiFocus !== "won" && wonBundleLeads.length > 0 && (
              <div className="won-bundle-section">
                <div className="won-bundle-head">
                  <h3>Abschlüsse gebündelt</h3>
                  <span>{wonBundleLeads.length} Leads außerhalb der aktiven Pipeline</span>
                </div>
                <div className="won-bundle-list">
                  {wonBundleLeads.map((lead) => {
                    const progress = getWechselProgress(lead);
                    const supplyConfirmed = hasSupplyConfirmation(lead);
                    const monthsUntilEnd = getMonthsUntil(lead.contractEnd);
                    return (
                      <button key={lead.id} type="button" className="won-bundle-card" onClick={() => setSelectedLeadId(lead.id)}>
                        <div className="won-bundle-title">{lead.company || lead.person || "Lead"}</div>
                        <div className="won-bundle-meta">Vertragsende: {formatDate(lead.contractEnd)}</div>
                        <div className="won-bundle-meta">Wechselstatus: {progress.completed}/{progress.total} Schritte</div>
                        <div className={`won-bundle-meta ${supplyConfirmed ? "ok" : "warn"}`}>
                          Belieferungsbestätigung: {supplyConfirmed ? "Vorhanden" : "Fehlt"}
                        </div>
                        {Number.isFinite(monthsUntilEnd) && monthsUntilEnd > 0 && (
                          <div className="won-bundle-meta">Wiedervorlage automatisch bei ≤ 6 Monaten Restlaufzeit</div>
                        )}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            {smartView !== "lost" && lostBundleLeads.length > 0 && (
              <div className="won-bundle-section lost-bundle-section">
                <div className="won-bundle-head">
                  <h3>Verloren gebündelt</h3>
                  <span>{lostBundleLeads.length} verlorene Leads</span>
                </div>
                <div className="won-bundle-list">
                  {lostBundleLeads.map((lead) => {
                    const temp = getLeadTemperature(lead);
                    return (
                      <button key={lead.id} type="button" className="won-bundle-card lost-card" onClick={() => setSelectedLeadId(lead.id)}>
                        <div className="won-bundle-title">{lead.company || lead.person || "Lead"}</div>
                        {lead.lossReason && <div className="won-bundle-meta">Grund: {lead.lossReason}</div>}
                        <div className="won-bundle-meta">Status seit: {formatDate(lead.updatedAt || lead.createdAt)}</div>
                        <div className="won-bundle-meta">Score: {calculateLeadScore(lead)}/100 · {temp.label}</div>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
          </>
        )}

        {activeTab === "dashboard" && (
          <div className="tab-page">
            <div className="main-toolbar"><h1 className="page-title">Dashboard</h1></div>
            <Dashboard leads={leads} teamMembers={teamMembers} userRole={userRole} stats={stats} onNavigate={(preset) => {
              setActiveTab("leads");
              if (preset.startsWith("status:")) {
                const status = preset.slice(7);
                setSmartView("all"); setKpiFocus("all"); setFilterStatus(status); setFilterPriority("all"); setSortMode("activity"); setFocusPreset("all");
              } else {
                applyFocusPreset(preset);
              }
            }} />
          </div>
        )}

        {activeTab === "calendar" && (
          <CalendarView leads={leads} onOpenLead={(leadId) => {
            setSelectedLeadId(leadId);
            setActiveTab("leads");
          }} />
        )}

        {activeTab === "team" && (
          <div className="tab-page">
            <TeamManagement currentUser={user} teamId={teamId} teamMembers={teamMembers} onRefresh={loadTeamMembers} userRole={userRole} canAssignAdmins={canAssignAdmins} />
          </div>
        )}
      </div>

      {selectedLead && (
        <LeadDetailDrawer
          lead={selectedLead}
          onClose={closeLeadDrawer}
          onNextLead={navigateToNextLead}
          leadPosition={displayLeads.findIndex(l => l.id === selectedLead.id) + 1}
          leadTotal={displayLeads.length}
          user={user}
          userRole={userRole}
          onUpdateField={updateLeadField}
          onUpdateStatus={updateLeadStatus}
          onDelete={deleteLead}
          onLogCall={logCall}
          onAddAttachment={addLeadAttachment}
          onRemoveAttachment={removeLeadAttachment}
          dialerActive={showPowerDialer}
        />
      )}

      {showNewLeadModal && (
        <NewLeadModal onClose={() => setShowNewLeadModal(false)} onSubmit={handleAddLead} loading={loading} />
      )}

      {showImportModal && (
        <ImportModal isOpen={showImportModal} onClose={() => setShowImportModal(false)} leads={leads} users={teamMembers} currentUser={user} onImport={onImportLeads} />
      )}

      {showPowerDialer && (
        <PowerDialer
          leads={filteredLeads.length > 0 ? filteredLeads : leads}
          user={user}
          onLogCall={logCall}
          onUpdateField={updateLeadField}
          onClose={() => { setShowPowerDialer(false); }}
          onSelectLead={(leadId) => setSelectedLeadId(leadId)}
          displayLeads={displayLeads}
          selectedLeadId={selectedLeadId}
          drawerOpen={!!selectedLeadId}
        />
      )}

      {activeTab === "leads" && !showNewLeadModal && !selectedLeadId && !showPowerDialer && (
        <button className="mobile-fab" onClick={() => setShowNewLeadModal(true)} aria-label="Neuer Lead">＋</button>
      )}
    </div>
  );
}

export default App;
