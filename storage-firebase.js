// ============================================================================
// Ye file window.storage banati hai jo asal Claude Artifact wale storage jaisa
// hi kaam karta hai (get/set/delete/list), magar peechay asal Firebase Firestore
// (real, live database) use karta hai. App.jsx mein koi tabdeeli nahi karni parti.
//
// APNI FIREBASE DETAILS NEECHE firebaseConfig MEIN DAALEIN
// (Firebase Console > Project Settings > General > "Your apps" > Config)
// ============================================================================

import { initializeApp } from "firebase/app";
import {
  getFirestore,
  doc,
  getDoc,
  setDoc,
  deleteDoc,
  collection,
  getDocs,
  query,
  where,
} from "firebase/firestore";

// Ye values .env.local file se aati hain (README dekhein) — taake aapki
// Firebase keys code ke sath GitHub par public na jayein.
const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

// Firestore document IDs can't contain "/", the app's keys never do, but we
// still guard against illegal characters just in case.
const safeDocId = (key) => key.replace(/\//g, "__slash__");

window.storage = {
  async get(key) {
    const snap = await getDoc(doc(db, "kv", safeDocId(key)));
    if (!snap.exists()) {
      throw new Error("not found");
    }
    return { key, value: snap.data().value, shared: true };
  },

  async set(key, value) {
    await setDoc(doc(db, "kv", safeDocId(key)), {
      value,
      updatedAt: Date.now(),
    });
    return { key, value, shared: true };
  },

  async delete(key) {
    await deleteDoc(doc(db, "kv", safeDocId(key)));
    return { key, deleted: true, shared: true };
  },

  async list(prefix = "") {
    const col = collection(db, "kv");
    const q = prefix
      ? query(
          col,
          where("__name__", ">=", safeDocId(prefix)),
          where("__name__", "<", safeDocId(prefix) + "\uf8ff")
        )
      : query(col);
    const snaps = await getDocs(q);
    return {
      keys: snaps.docs.map((d) => d.id.replace(/__slash__/g, "/")),
      prefix,
      shared: true,
    };
  },
};
