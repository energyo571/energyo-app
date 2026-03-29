import { useState, useEffect } from "react";
import {
  collection, addDoc, onSnapshot, updateDoc, deleteDoc,
  doc, query, where,
} from "firebase/firestore";
import { db } from "../firebaseConfig";

export default function useCalendarEvents(user, teamId) {
  const [events, setEvents] = useState([]);

  useEffect(() => {
    if (!user || !teamId) { setEvents([]); return; }
    const q = query(collection(db, "calendarEvents"), where("teamId", "==", teamId));
    return onSnapshot(q, snap => {
      setEvents(snap.docs.map(d => ({ id: d.id, ...d.data() })));
    });
  }, [user, teamId]);

  const addEvent = async (data) => {
    if (!user || !teamId) return;
    await addDoc(collection(db, "calendarEvents"), {
      ...data,
      teamId,
      createdBy: user.uid,
      createdAt: new Date().toISOString(),
    });
  };

  const updateEvent = async (id, data) => {
    await updateDoc(doc(db, "calendarEvents", id), data);
  };

  const removeEvent = async (id) => {
    await deleteDoc(doc(db, "calendarEvents", id));
  };

  return { events, addEvent, updateEvent, removeEvent };
}
