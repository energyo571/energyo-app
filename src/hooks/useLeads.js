import { useState, useEffect, useRef } from "react";
import {
  collection, addDoc, onSnapshot, updateDoc, deleteDoc,
  doc, query, where,
} from "firebase/firestore";
import { getDownloadURL, ref as storageRef, uploadBytes } from "firebase/storage";
import { db, storage } from "../firebaseConfig";
import {
  MAX_ATTACHMENT_SIZE_BYTES, RENEWAL_RESURFACE_MONTHS, buildAttachmentId,
} from "../constants";
import { isOverdue, isOpenCancellationWindow } from "../utils/dates";
import { isContractEndUnrealistic } from "../utils/format";
import { isWonLeadRenewalDue } from "../utils/leads";
import { sanitizeObject, sanitizeValue, isAllowedLeadField } from "../utils/sanitize";

export default function useLeads(user, teamId, userRole) {
  const [leads, setLeads] = useState([]);
  const [loading, setLoading] = useState(false);
  const [notifSent, setNotifSent] = useState(false);
  const resurfacingLockRef = useRef(new Set());

  // ─── Firestore real-time listener ───────────────────────────────────────────
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

  // ─── Notification effect ────────────────────────────────────────────────────
  useEffect(() => {
    if (!user || !leads.length || notifSent) return;
    const overdueLeads = leads.filter(l => isOverdue(l.followUp));
    const cancellationLeads = leads.filter(l => isOpenCancellationWindow(l.contractEnd));
    if (overdueLeads.length > 0 || cancellationLeads.length > 0) {
      fetch("/api/send-notification", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ to: user.email, overdueCount: overdueLeads.length, cancellationCount: cancellationLeads.length }) })
        .then(() => setNotifSent(true)).catch(() => {});
    }
  }, [user, leads, notifSent]);

  // ─── Renewal auto-resurfacing ───────────────────────────────────────────────
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
              text: `Automatische Wiedervorlage: ${RENEWAL_RESURFACE_MONTHS} Monate vor Vertragsende wieder in aktive Pipeline überführt.`,
            },
          ],
        });
      } catch (e) {
        // silent – auto-resurface failure is non-critical
      } finally {
        resurfacingLockRef.current.delete(lead.id);
      }
    });
  }, [leads, teamId, user]);

  // ─── Helper: upload attachment to Firebase Storage ──────────────────────────
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

  // ─── CRUD ───────────────────────────────────────────────────────────────────

  /** Creates a new lead. Returns the Firestore doc ID on success, or null. */
  const addLead = async (form) => {
    if (!form.person.trim()) { alert("Bitte Ansprechpartner eintragen."); return null; }
    if (!form.phone.trim() || !form.email.trim() || !form.postalCode.trim()) { alert("Bitte Telefon, E-Mail und PLZ ausfüllen."); return null; }
    if (!teamId) { alert("Team-ID fehlt."); return null; }
    if (form.contractEnd !== "unknown" && isContractEndUnrealistic(form.contractEnd)) {
      if (!window.confirm("Vertragsende liegt in der Vergangenheit. Fortfahren?")) return null;
    }
    setLoading(true);
    try {
      const { attachments: rawAttachments = [], ...formData } = form;
      const safeData = sanitizeObject(formData);
      const createdAt = new Date().toISOString();
      const docRef = await addDoc(collection(db, "leads"), {
        ...safeData,
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
          alert(`Lead wurde angelegt, aber Anhänge konnten nicht vollständig hochgeladen werden. (${uploadError?.code || uploadError?.message || "Unbekannter Fehler"})`);
        }
      }

      setLoading(false);
      return docRef.id;
    } catch (e) {
      alert(`Fehler: ${e?.code || e?.message}`);
      setLoading(false);
      return null;
    }
  };

  const onImportLeads = async (importedLeads) => {
    if (!teamId || !user) throw new Error("Team/User nicht gefunden");
    const createdAt = new Date().toISOString();
    for (const lead of importedLeads) {
      const safeLead = sanitizeObject(lead);
      await addDoc(collection(db, "leads"), {
        ...safeLead, teamId, ownerUserId: user.uid, ownerEmail: safeLead.createdBy?.email || user.email,
        createdBy: { uid: user.uid, email: safeLead.createdBy?.email || user.email, timestamp: createdAt },
        status: safeLead.status || "Neu", createdAt,
        comments: safeLead.extras ? [{ timestamp: createdAt, text: `CSV-Import: ${JSON.stringify(safeLead.extras)}`, author: user.email }] : [],
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
    } catch (_) { /* silent */ }
  };

  const updateLeadField = async (id, field, value) => {
    if (!isAllowedLeadField(field)) return;
    try { await updateDoc(doc(db, "leads", id), { [field]: sanitizeValue(value) }); } catch (_) { /* silent */ }
  };

  const logCall = async (leadId, callData) => {
    const leadDoc = leads.find(l => l.id === leadId);
    if (!leadDoc) return;
    try { await updateDoc(doc(db, "leads", leadId), { callLogs: [...(leadDoc.callLogs || []), { ...sanitizeObject(callData), timestamp: new Date().toISOString(), author: user.email }] }); }
    catch (_) { /* silent */ }
  };

  const deleteLead = async (id) => {
    try { await deleteDoc(doc(db, "leads", id)); } catch (_) { /* silent */ }
  };

  /** Deletes multiple leads by ID array. */
  const bulkDeleteLeads = async (ids) => {
    for (const id of ids) {
      try { await deleteDoc(doc(db, "leads", id)); } catch (_) { /* silent */ }
    }
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
      alert(`Anhänge konnten nicht hochgeladen werden. (${e?.code || e?.message || "Unbekannter Fehler"})`);
    }
  };

  const removeLeadAttachment = async (leadId, attId) => {
    const leadDoc = leads.find(l => l.id === leadId);
    if (!leadDoc) return;
    try { await updateDoc(doc(db, "leads", leadId), { attachments: leadDoc.attachments.filter(a => a.id !== attId) }); }
    catch (_) { /* silent */ }
  };

  return {
    leads, loading,
    addLead, onImportLeads,
    updateLeadStatus, updateLeadField,
    logCall, deleteLead, bulkDeleteLeads,
    addLeadAttachment, removeLeadAttachment,
  };
}
