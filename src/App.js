import React, { useMemo, useState, useEffect, useCallback, useRef } from "react";
import { onAuthStateChanged, signOut } from "firebase/auth";
import {
  collection, addDoc, onSnapshot, updateDoc, deleteDoc,
  doc, query, where, getDoc, setDoc, getDocs,
} from "firebase/firestore";
import { getDownloadURL, ref as storageRef, uploadBytes } from "firebase/storage";
import { auth, db, storage } from "./firebaseConfig";
import LoginPage from "./LoginPage";
import "./App.css";

// ─── Constants & Utils ────────────────────────────────────────────────────────
import {
  STATUS_OPTIONS, MAX_ATTACHMENT_SIZE_BYTES, RENEWAL_RESURFACE_MONTHS,
  buildAttachmentId,
} from "./constants";
import { formatDate, isOverdue, isTodayDue, isOpenCancellationWindow, getMonthsUntil, getHoursSince } from "./utils/dates";
import { formatEnergyVolume, parseOptionalNumber, isContractEndUnrealistic } from "./utils/format";
import { calculateUmsatzPotential } from "./utils/energy";
import {
  getLeadOwnerEmail, getLastActivityTimestamp, isLeadInactiveForHours,
  isWonLeadRenewalDue, getWechselProgress, hasSupplyConfirmation,
  calculatePriority, calculateLeadScore, getLeadTemperature,
  sortLeads, rankCockpitCtas,
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
  const [leads, setLeads] = useState([]);
  const [searchTerm, setSearchTerm] = useState("");
  const [filterPriority, setFilterPriority] = useState("all");
  const [filterStatus, setFilterStatus] = useState("all");
  const [loading, setLoading] = useState(false);
  const [activeTab, setActiveTab] = useState("leads");
  const [notifSent, setNotifSent] = useState(false);
  const [selectedLeadId, setSelectedLeadId] = useState(null);
  const [viewMode, setViewMode] = useState("list");
  const [showNewLeadModal, setShowNewLeadModal] = useState(false);
  const [showImportModal, setShowImportModal] = useState(false);
  const [showPowerDialer, setShowPowerDialer] = useState(false);
  const [smartView, setSmartView] = useState("all");
  const [sortMode, setSortMode] = useState("priority");
  const [kpiFocus, setKpiFocus] = useState("all");
  const [marketTrendPct, setMarketTrendPct] = useState(() => parseOptionalNumber(process.env.REACT_APP_MARKET_TREND_PCT));
  const [marketTrendSource, setMarketTrendSource] = useState("env");
  const [marketTrendHistory, setMarketTrendHistory] = useState([]);
  const [focusPreset, setFocusPreset] = useState("all");
  const [showAdvancedFilters, setShowAdvancedFilters] = useState(false);
  const [leadsPerPage, setLeadsPerPage] = useState(25);
  const [currentPage, setCurrentPage] = useState(1);

  // Multiselect state
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedLeadIds, setSelectedLeadIds] = useState(new Set());
  const resurfacingLockRef = useRef(new Set());

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

  useEffect(() => {
    if (!user || !teamId) { setLeads([]); return; }
    const q = userRole === "admin"
      ? query(collection(db, "leads"), where("teamId", "==", teamId))
      : query(collection(db, "leads"), where("teamId", "==", teamId), where("ownerUserId", "==", user.uid));
    return onSnapshot(q, snap => {
      const loaded = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      loaded.forEach(l => {
        if (l.status === "Gewonnen" || l.status === "CLOSED") {
          updateDoc(doc(db, "leads", l.id), { status: "Abschluss" }).catch(() => {});
          l.status = "Abschluss";
        }
        if (l.status === "Nachfassen") {
          updateDoc(doc(db, "leads", l.id), { status: "Follow-up" }).catch(() => {});
          l.status = "Follow-up";
        }
      });
      setLeads(loaded);
    });
  }, [user, teamId, userRole]);

  useEffect(() => {
    if (!user || !leads.length || notifSent) return;
    const overdueLeads = leads.filter(l => isOverdue(l.followUp));
    const cancellationLeads = leads.filter(l => isOpenCancellationWindow(l.contractEnd));
    if (overdueLeads.length > 0 || cancellationLeads.length > 0) {
      fetch("/api/send-notification", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ to: user.email, overdueCount: overdueLeads.length, cancellationCount: cancellationLeads.length }) })
        .then(() => setNotifSent(true)).catch(() => {});
    }
  }, [user, leads, notifSent]);

  useEffect(() => {
    if (!user || !teamId || leads.length === 0) return;
    const todayIso = new Date().toISOString().split("T")[0];
    const candidates = leads.filter((lead) =>
      lead.status === "Abschluss"
      && !lead.renewalResurfacedAt
      && isWonLeadRenewalDue(lead, RENEWAL_RESURFACE_MONTHS)
    );

    candidates.forEach(async (lead) => {
      if (resurfacingLockRef.current.has(lead.id)) return;
      resurfacingLockRef.current.add(lead.id);
      try {
        const now = new Date().toISOString();
        await updateDoc(doc(db, "leads", lead.id), {
          status: "Follow-up",
          followUp: lead.followUp || todayIso,
          renewalResurfacedAt: now,
          renewalResurfaceReason: `auto-${RENEWAL_RESURFACE_MONTHS}m-before-contract-end`,
          statusHistory: [
            ...(lead.statusHistory || []),
            { from: "Abschluss", to: "Follow-up", timestamp: now, author: "System" },
          ],
          comments: [
            ...(lead.comments || []),
            {
              timestamp: now,
              author: "System",
              text: `🔁 Automatische Wiedervorlage: ${RENEWAL_RESURFACE_MONTHS} Monate vor Vertragsende wieder in aktive Pipeline überführt.`,
            },
          ],
        });
      } catch (e) {
        console.error("Auto-Resurface fehlgeschlagen", e);
      } finally {
        resurfacingLockRef.current.delete(lead.id);
      }
    });
  }, [leads, teamId, user]);

  useEffect(() => {
    const cacheKey = "marketTrendCacheV1";
    const todayIso = new Date().toISOString().split("T")[0];

    try {
      const cachedRaw = window.localStorage.getItem(cacheKey);
      if (cachedRaw) {
        const cached = JSON.parse(cachedRaw);
        if (cached?.asOf === todayIso && Number.isFinite(cached?.trendPct)) {
          setMarketTrendPct(cached.trendPct);
          setMarketTrendSource(cached.source || "cache");
          setMarketTrendHistory(Array.isArray(cached.history) ? cached.history : []);
          return;
        }
      }
    } catch (_) { /* ignore */ }

    let isActive = true;
    fetch("/api/market-trend")
      .then((res) => res.json())
      .then((data) => {
        if (!isActive || !data?.ok || !Number.isFinite(data?.trendPct)) return;
        setMarketTrendPct(data.trendPct);
        setMarketTrendSource(data.source || "api");
        setMarketTrendHistory(Array.isArray(data.history) ? data.history : []);
        try {
          window.localStorage.setItem(cacheKey, JSON.stringify({
            trendPct: data.trendPct,
            source: data.source || "api",
            asOf: data.asOf || todayIso,
            history: Array.isArray(data.history) ? data.history : [],
          }));
        } catch (_) { /* ignore */ }
      })
      .catch(() => { /* keep env fallback */ });

    return () => { isActive = false; };
  }, []);

  const uploadAttachmentToStorage = async (leadId, file) => {
    if (!file) throw new Error("Datei fehlt");
    if (file.size > MAX_ATTACHMENT_SIZE_BYTES) {
      throw new Error(`${file.name} ist größer als 10MB`);
    }
    const safeName = (file.name || "datei").replace(/[^a-zA-Z0-9._-]/g, "_");
    const path = `leads/${teamId}/${leadId}/${buildAttachmentId()}-${safeName}`;
    const fileRef = storageRef(storage, path);
    await uploadBytes(fileRef, file, { contentType: file.type || "application/octet-stream" });
    const url = await getDownloadURL(fileRef);
    return {
      id: buildAttachmentId(),
      name: file.name,
      size: file.size,
      type: file.type || "",
      url,
      storagePath: path,
      uploadedAt: new Date().toISOString(),
    };
  };

  const addLead = async (form, onSuccess) => {
    if (!form.person.trim()) return alert("Bitte Ansprechpartner eintragen.");
    if (!form.phone.trim() || !form.email.trim() || !form.postalCode.trim()) return alert("Bitte Telefon, E-Mail und PLZ ausfüllen.");
    if (!teamId) return alert("Team-ID fehlt.");
    if (form.contractEnd !== "unknown" && isContractEndUnrealistic(form.contractEnd)) {
      if (!window.confirm("Vertragsende liegt in der Vergangenheit. Fortfahren?")) return;
    }
    setLoading(true);
    try {
      const { attachments: rawAttachments = [], ...formData } = form;
      const createdAt = new Date().toISOString();
      const docRef = await addDoc(collection(db, "leads"), {
        ...formData,
        attachments: [],
        teamId,
        ownerUserId: user.uid,
        ownerEmail: user.email,
        createdBy: { uid: user.uid, email: user.email, timestamp: createdAt },
        status: "Neu", createdAt, comments: [], callLogs: [],
      });

      const filesToUpload = rawAttachments
        .map((attachment) => attachment?.file)
        .filter((file) => file instanceof File);

      if (filesToUpload.length > 0) {
        try {
          const uploadedAttachments = await Promise.all(
            filesToUpload.map((file) => uploadAttachmentToStorage(docRef.id, file))
          );
          await updateDoc(doc(db, "leads", docRef.id), { attachments: uploadedAttachments });
        } catch (uploadError) {
          console.error(uploadError);
          alert(`Lead wurde angelegt, aber Anhänge konnten nicht vollständig hochgeladen werden. (${uploadError?.code || uploadError?.message || "Unbekannter Fehler"})`);
        }
      }

      setLoading(false);
      onSuccess?.();
      setSelectedLeadId(docRef.id);
    } catch (e) {
      alert(`Fehler: ${e?.code || e?.message}`);
      setLoading(false);
    }
  };

  const onImportLeads = async (importedLeads) => {
    if (!teamId || !user) throw new Error("Team/User nicht gefunden");
    const createdAt = new Date().toISOString();
    for (const lead of importedLeads) {
      await addDoc(collection(db, "leads"), {
        ...lead, teamId, ownerUserId: user.uid, ownerEmail: lead.createdBy?.email || user.email,
        createdBy: { uid: user.uid, email: lead.createdBy?.email || user.email, timestamp: createdAt },
        status: lead.status || "Neu", createdAt,
        comments: lead.extras ? [{ timestamp: createdAt, text: `📥 CSV-Import: ${JSON.stringify(lead.extras)}`, author: user.email }] : [],
        callLogs: [],
      });
    }
  };

  const updateLeadStatus = async (id, newStatus) => {
    const leadDoc = leads.find((lead) => lead.id === id);
    if (!leadDoc || leadDoc.status === newStatus) return;
    try {
      await updateDoc(doc(db, "leads", id), {
        status: newStatus,
        statusHistory: [...(leadDoc.statusHistory || []), { from: leadDoc.status, to: newStatus, timestamp: new Date().toISOString(), author: user.email }],
      });
    } catch (e) { console.error(e); }
  };

  const updateLeadField = async (id, field, value) => {
    try { await updateDoc(doc(db, "leads", id), { [field]: value }); } catch (e) { console.error(e); }
  };

  const logCall = async (leadId, callData) => {
    const leadDoc = leads.find(l => l.id === leadId);
    if (!leadDoc) return;
    try { await updateDoc(doc(db, "leads", leadId), { callLogs: [...(leadDoc.callLogs || []), { ...callData, timestamp: new Date().toISOString(), author: user.email }] }); }
    catch (e) { console.error(e); }
  };

  const deleteLead = async (id) => {
    try { await deleteDoc(doc(db, "leads", id)); } catch (e) { console.error(e); }
  };

  const bulkDeleteLeads = async () => {
    if (userRole !== "admin") return;
    const ids = Array.from(selectedLeadIds);
    for (const id of ids) {
      try { await deleteDoc(doc(db, "leads", id)); } catch (e) { console.error(e); }
    }
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

  const addLeadAttachment = async (leadId, files) => {
    const selectedFiles = Array.from(files || []);
    if (selectedFiles.length === 0) return;
    const oversized = selectedFiles.filter((file) => file.size > MAX_ATTACHMENT_SIZE_BYTES);
    if (oversized.length > 0) {
      alert(`${oversized[0].name} ist zu groß (max 10MB pro Datei)`);
    }

    const validFiles = selectedFiles.filter((file) => file.size <= MAX_ATTACHMENT_SIZE_BYTES);
    if (validFiles.length === 0) return;

    const leadDoc = leads.find((lead) => lead.id === leadId);
    if (!leadDoc) return;

    try {
      const uploadedAttachments = await Promise.all(
        validFiles.map((file) => uploadAttachmentToStorage(leadId, file))
      );
      await updateDoc(doc(db, "leads", leadId), {
        attachments: [...(leadDoc.attachments || []), ...uploadedAttachments],
      });
    } catch (e) {
      console.error(e);
      alert(`Anhänge konnten nicht hochgeladen werden. (${e?.code || e?.message || "Unbekannter Fehler"})`);
    }
  };

  const removeLeadAttachment = async (leadId, attId) => {
    const leadDoc = leads.find(l => l.id === leadId);
    if (!leadDoc) return;
    try { await updateDoc(doc(db, "leads", leadId), { attachments: leadDoc.attachments.filter(a => a.id !== attId) }); }
    catch (e) { console.error(e); }
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
    movedEnergyKwh: leads.reduce((sum, lead) => sum + (Number.parseInt(lead.consumption || 0, 10) || 0), 0),
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

  const closingRateCoach = useMemo(() => {
    if (stats.closingRate < 15) {
      return {
        tone: "alert",
        title: "Closing unter 15%: jetzt aktiv eingreifen",
        tips: [
          "Überfällige Leads heute priorisiert anrufen.",
          "Angebots-Leads ohne Touchpoint >48h zuerst bearbeiten.",
          "Jeden Kontakt mit konkretem Follow-up-Datum abschließen.",
        ],
      };
    }
    if (stats.closingRate < 25) {
      return {
        tone: "warning",
        title: "Closing 15-24%: Disziplin erhöht Conversion",
        tips: [
          "Follow-ups konsequent im 24-48h Rhythmus setzen.",
          "Einwandbehandlung im KI-Tab vor Calls vorbereiten.",
          "Pipeline-Mitte (Angebot/Nachfassen) täglich bewegen.",
        ],
      };
    }
    return {
      tone: "success",
      title: "Closing stark: Erfolgsroutine skalieren",
      tips: [
        "Top-Argumente aus CLOSED Leads als Script sichern.",
        "High-Potential-Leads mit gleichem Playbook spiegeln.",
        "Hot-Leads weiter mit kurzen 24h-Zyklen bearbeiten.",
      ],
    };
  }, [stats.closingRate]);

  const cockpitTrendSparkline = useMemo(() => {
    const points = marketTrendHistory.filter((item) => Number.isFinite(item?.trendPct));
    if (points.length < 2) return null;

    const width = 240;
    const height = 46;
    const padding = 6;
    const values = points.map((p) => p.trendPct);
    const min = Math.min(...values);
    const max = Math.max(...values);
    const span = Math.max(0.001, max - min);

    const chartPoints = points.map((point, idx) => {
      const x = padding + (idx * (width - padding * 2)) / Math.max(1, points.length - 1);
      const y = height - padding - ((point.trendPct - min) / span) * (height - padding * 2);
      return { x, y, asOf: point.asOf, value: point.trendPct };
    });

    return {
      width,
      height,
      path: chartPoints.map((p, idx) => `${idx === 0 ? "M" : "L"}${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(" "),
      points: chartPoints,
      start: points[0]?.asOf,
      end: points[points.length - 1]?.asOf,
    };
  }, [marketTrendHistory]);

  const cockpitCtas = useMemo(() => rankCockpitCtas({
    leads: activePipelineLeads,
    marketTrendPct,
  }), [activePipelineLeads, marketTrendPct]);

  const CTA_ACTION_PRESET = {
    inactive48: "inactive48",
    overdue: "overdue",
    cancellation: "cancellation",
    hot: "hot",
    uncontacted: "uncontacted",
    stalledOffers: "stalledOffers",
  };

  const runCockpitCtaAction = (cta) => {
    if (!cta) return;
    const targetPreset = CTA_ACTION_PRESET[cta.action];
    if (!targetPreset) return;
    if (focusPreset === targetPreset) {
      applyFocusPreset("all");
    } else {
      applyFocusPreset(targetPreset);
    }
  };

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
        stats={stats}
        user={user}
        userRole={userRole}
        userProfile={userProfile}
        avatarUploading={avatarUploading}
        onAvatarUpload={uploadUserAvatar}
        onSignOut={() => signOut(auth)}
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
                <input type="text" placeholder="🔍 Suche nach Firma, Kontakt, Telefon..." value={searchTerm} onChange={e => setSearchTerm(e.target.value)} className="toolbar-search" />
                <select value={sortMode} onChange={e => setSortMode(e.target.value)} className="filter-select-inline compact">
                  <option value="priority">Sortiert nach Priorität</option>
                  <option value="potential">Nach Potential</option>
                  <option value="activity">Nach Aktivität</option>
                  <option value="followUp">Nach Follow-up</option>
                </select>
                <div className="view-toggle-group">
                  <button className={`view-toggle-btn ${viewMode === "list" ? "active" : ""}`} onClick={() => setViewMode("list")}>≡ Liste</button>
                  <button className={`view-toggle-btn ${viewMode === "kanban" ? "active" : ""}`} onClick={() => setViewMode("kanban")}>⊞ Pipeline</button>
                </div>
                {userRole === "admin" && (
                  <button
                    className={`selection-mode-btn ${selectionMode ? "active" : ""}`}
                    onClick={() => { setSelectionMode(v => !v); setSelectedLeadIds(new Set()); }}
                    title="Mehrfachauswahl"
                  >
                    {selectionMode ? "✕ Auswahl" : "☑ Auswählen"}
                  </button>
                )}
              </div>
            </div>

            {selectionMode && selectedLeadIds.size > 0 && (
              <BulkActionBar
                selectedCount={selectedLeadIds.size}
                totalCount={displayLeads.length}
                onDelete={bulkDeleteLeads}
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
                ☑ Mehrfachauswahl aktiv – Leads anklicken zum Auswählen
                <button className="ghost-btn-sm" onClick={() => { setSelectionMode(false); setSelectedLeadIds(new Set()); }} style={{ marginLeft: 12 }}>Abbrechen</button>
              </div>
            )}

            <div className="focus-bar">
              <select value={focusPreset} onChange={(e) => applyFocusPreset(e.target.value)} className="filter-select-inline compact focus-select">
                <option value="all">Fokus: Alle Leads</option>
                <option value="mine">Fokus: Meine Leads</option>
                <option value="action">Fokus: Action Queue</option>
                <option value="hot">Fokus: Hot Deals</option>
                <option value="renewals">Fokus: Renewals</option>
                <option value="won">Fokus: Abschlüsse</option>
                <option value="lost">Fokus: Verloren</option>
                <option value="uncontacted">Fokus: Unkontaktiert</option>
                <option value="overdue">Fokus: Überfällig</option>
                <option value="today">Fokus: Heute fällig</option>
                <option value="inactive48">Fokus: {'>'}48h ohne Aktivität</option>
                <option value="cancellation">Fokus: Kündigungsfenster</option>
              </select>
              <button type="button" className="ghost-btn-sm" onClick={() => setShowAdvancedFilters(v => !v)}>
                {showAdvancedFilters ? "Erweiterte Filter ausblenden" : "Erweiterte Filter"}
              </button>
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

            <div className="kpi-strip">
              <div className="kpi-item kpi-umsatz">
                <span className="kpi-val">{formatEnergyVolume(stats.movedEnergyKwh)}</span>
                <span className="kpi-label">Bewegte Energiemenge</span>
              </div>
              <div className="kpi-item kpi-prio"><span className="kpi-val">{stats.priorityA}</span><span className="kpi-label">Hot</span></div>
              <div className="kpi-item kpi-warning"><span className="kpi-val">{stats.overdue}</span><span className="kpi-label">Überfällig</span></div>
              <div className="kpi-item kpi-today"><span className="kpi-val">{stats.dueToday}</span><span className="kpi-label">Heute fällig</span></div>
              <div className="kpi-item"><span className="kpi-val">{stats.inactive48}</span><span className="kpi-label">{'>'}48h ohne Aktivität</span></div>
              <div className="kpi-item kpi-alert">
                <span className="kpi-val">{stats.openCancellation}</span>
                <span className="kpi-label two-line"><span>Kündigungs</span><span>fenster</span></span>
              </div>
              <div className="kpi-item"><span className="kpi-val">{stats.wonLeads}</span><span className="kpi-label">Abschlüsse</span></div>
            </div>

            <div className={`cockpit-action-card compact ${closingRateCoach.tone}`}>
              <div className="cockpit-action-head">
                <strong>{closingRateCoach.title}</strong>
                <span>Closing Rate: {stats.closingRate}% · Preisquelle: {marketTrendSource}</span>
              </div>
              {cockpitTrendSparkline && (
                <div className="cockpit-trend-inline" title="Markttrend letzte 7 Tage">
                  <div className="cockpit-trend-title">Markttrend 7 Tage</div>
                  <svg className="cockpit-trend-svg" viewBox={`0 0 ${cockpitTrendSparkline.width} ${cockpitTrendSparkline.height}`} role="img" aria-label="Markttrend 7 Tage">
                    <path d={cockpitTrendSparkline.path} fill="none" stroke="#2563eb" strokeWidth="2" strokeLinecap="round" />
                    {cockpitTrendSparkline.points.map((point) => (
                      <circle key={point.asOf} cx={point.x} cy={point.y} r="2.2" fill="#1d4ed8">
                        <title>{`${formatDate(point.asOf)}: ${point.value >= 0 ? "+" : ""}${point.value.toFixed(1)}%`}</title>
                      </circle>
                    ))}
                  </svg>
                  <div className="cockpit-trend-labels">
                    <span>{formatDate(cockpitTrendSparkline.start)}</span>
                    <span>{formatDate(cockpitTrendSparkline.end)}</span>
                  </div>
                </div>
              )}
              <ul className="cockpit-action-list">
                {closingRateCoach.tips.slice(0, 2).map((tip) => <li key={tip}>{tip}</li>)}
              </ul>
              <div className="cockpit-cta-grid">
                {cockpitCtas.map((cta) => {
                  const ctaPreset = CTA_ACTION_PRESET[cta.action];
                  const isCtaActive = ctaPreset && focusPreset === ctaPreset;
                  return (
                    <div key={cta.id} className={`cockpit-cta-card ${cta.tone}${isCtaActive ? " active" : ""}`}>
                      <strong>{cta.title}</strong>
                      <p>{cta.message}</p>
                      <button type="button" className="ghost-btn-sm" onClick={() => runCockpitCtaAction(cta)}>
                        {isCtaActive ? "Ansicht schließen" : cta.actionLabel}
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>

            <div className="lead-list-controls">
              <div className="lead-actions-inline">
                <button type="button" className="kpi-action-btn dialer" onClick={() => setShowPowerDialer(true)}>⚡ Power Dialer</button>
                <button type="button" className="kpi-action-btn import" onClick={() => setShowImportModal(true)}>📥 CSV importieren</button>
                <button type="button" className="kpi-action-btn create" onClick={() => setShowNewLeadModal(true)}>＋ Neuer Lead</button>
              </div>
              <div className="lead-pagination-inline">
                <label htmlFor="lead-page-size">Leads pro Seite</label>
                <select id="lead-page-size" value={leadsPerPage} onChange={(e) => setLeadsPerPage(Number(e.target.value))}>
                  <option value={25}>25</option>
                  <option value={50}>50</option>
                  <option value={100}>100</option>
                </select>
                <button type="button" className="ghost-btn-sm" disabled={currentPage <= 1} onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}>Zurück</button>
                <span>Seite {currentPage} / {totalPipelinePages}</span>
                <button type="button" className="ghost-btn-sm" disabled={currentPage >= totalPipelinePages} onClick={() => setCurrentPage((p) => Math.min(totalPipelinePages, p + 1))}>Weiter</button>
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
            <Dashboard leads={leads} teamMembers={teamMembers} userRole={userRole} />
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
        <NewLeadModal onClose={() => setShowNewLeadModal(false)} onSubmit={addLead} loading={loading} />
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
    </div>
  );
}

export default App;
