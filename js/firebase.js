
/* =====================================================================
   HUB DE FILMES & SÉRIES — Clpher
   firebase.js — autenticação Google + Firestore
   Usa o mesmo projeto Firebase do hub de animes, mas coleções próprias.
   ===================================================================== */
import { initializeApp } from "https://www.gstatic.com/firebasejs/13.2.0/firebase-app.js";
import {
  getAuth, GoogleAuthProvider, signInWithPopup, signOut,
  onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/13.2.0/firebase-auth.js";
import {
  initializeFirestore, persistentLocalCache, persistentMultipleTabManager,
  collection, doc, getDoc, getDocs, addDoc, setDoc, deleteDoc,
  serverTimestamp, query, where
} from "https://www.gstatic.com/firebasejs/13.2.0/firebase-firestore.js";

/* ---------- Config Firebase ---------- */
const app = initializeApp({
  apiKey: "AIzaSyCgHMZV_wIFOV4QuJi3bBRbu_iOXSJ1ahY",
  authDomain: "hub-pesoal.firebaseapp.com",
  projectId: "hub-pesoal",
  storageBucket: "hub-pesoal.firebasestorage.app",
  messagingSenderId: "335710840559",
  appId: "1:335710840559:web:1d99e078383a9819a99d1a",
});

const auth = getAuth(app);
const OWNER_UID = "X569uLFYFgcX6i9mbEVsylUX7Li1";

const db = initializeFirestore(app, {
  localCache: persistentLocalCache({
    tabManager: persistentMultipleTabManager()
  }),
});

const emit = (name, detail) =>
  window.dispatchEvent(new CustomEvent(name, { detail }));

/* ---------- Helpers ---------- */
const isOwner = () => auth.currentUser?.uid === OWNER_UID;

const requireOwner = () => {
  if (!isOwner()) {
    throw new Error("Somente a conta proprietária pode editar.");
  }
};

const notePath = (itemId, type) =>
  doc(
    db,
    "users",
    OWNER_UID,
    type === "movie" ? "movieNotes" : "showNotes",
    String(itemId)
  );

const logsCol = () =>
  collection(db, "users", OWNER_UID, "mediaLogs");

/* ---------- Cache via IndexedDB ---------- */
const CACHE_DB = "hub-filmes-cache-v1";
const CACHE_TTL = 6 * 60 * 60 * 1000;
let _cacheDb;

function openCache() {
  if (_cacheDb) return Promise.resolve(_cacheDb);

  return new Promise((res, rej) => {
    const req = indexedDB.open(CACHE_DB, 1);

    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains("entries")) {
        req.result.createObjectStore("entries");
      }
    };

    req.onsuccess = () => {
      _cacheDb = req.result;
      res(_cacheDb);
    };

    req.onerror = () => rej(req.error);
  });
}

async function cacheGet(key) {
  try {
    const d = await openCache();

    return await new Promise((resolve, reject) => {
      const q = d.transaction("entries", "readonly")
        .objectStore("entries").get(key);

      q.onsuccess = () => resolve(q.result || null);
      q.onerror = () => reject(q.error);
    });
  } catch {
    return null;
  }
}

async function cacheSet(key, data) {
  try {
    const d = await openCache();

    await new Promise((resolve, reject) => {
      const tx = d.transaction("entries", "readwrite");

      tx.objectStore("entries").put(
        { data, savedAt: Date.now() },
        key
      );

      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
    });
  } catch (e) {
    console.warn("Cache indisponível", e);
  }
}

// NOVO: exclusão direta de uma entrada do cache.
async function cacheDelete(key) {
  try {
    const d = await openCache();

    await new Promise((resolve, reject) => {
      const tx = d.transaction("entries", "readwrite");

      tx.objectStore("entries").delete(key);

      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  } catch (e) {
    console.warn("Não foi possível invalidar o cache:", e);
  }
}

async function freshOrCached(key, fetcher) {
  const c = await cacheGet(key);

  if (c && Date.now() - c.savedAt < CACHE_TTL) {
    return c.data;
  }

  try {
    const fresh = await fetcher();
    await cacheSet(key, fresh);
    return fresh;
  } catch (err) {
    if (c) return c.data;
    throw err;
  }
}

/* =====================================================================
   API pública do Firebase para o hub.js
   ===================================================================== */
window.hubFB = {
  /* Auth */
  login: async () => {
    if (auth.currentUser && !isOwner()) {
      await signOut(auth);
    }

    const result = await signInWithPopup(
      auth,
      new GoogleAuthProvider()
    );

    if (result.user.uid !== OWNER_UID) {
      await signOut(auth);
      throw new Error(
        "Esta conta Google não é a proprietária do Hub."
      );
    }

    return result;
  },

  logout: () => signOut(auth),

  /* Notas */
  getItemNote: async (itemId, type) =>
    freshOrCached(`note:${type}:${itemId}`, async () => {
      const snap = await getDoc(notePath(itemId, type));
      return snap.exists() ? snap.data() : {};
    }),

  saveItemNote: async (itemId, type, data) => {
    requireOwner();

    await setDoc(
      notePath(itemId, type),
      {
        itemId: String(itemId),
        type,
        ...data,
        updatedAt: serverTimestamp()
      },
      { merge: true }
    );

    const old =
      (await cacheGet(`note:${type}:${itemId}`))?.data ?? {};

    await cacheSet(`note:${type}:${itemId}`, {
      ...old,
      ...data
    });

    await cacheDelete(`all_${type}_notes`);
  },

  getAllMovieNotes: async ({ refresh = false } = {}) => {
    if (refresh) await cacheDelete("all_movie_notes");

    return freshOrCached("all_movie_notes", async () => {
      const snap = await getDocs(
        collection(db, "users", OWNER_UID, "movieNotes")
      );

      const out = {};
      snap.forEach(d => out[d.id] = d.data());

      return out;
    });
  },

  getAllShowNotes: async ({ refresh = false } = {}) => {
    if (refresh) await cacheDelete("all_show_notes");

    return freshOrCached("all_show_notes", async () => {
      const snap = await getDocs(
        collection(db, "users", OWNER_UID, "showNotes")
      );

      const out = {};
      snap.forEach(d => out[d.id] = d.data());

      return out;
    });
  },

  /* Logs de episódios / sessões */

  getItemLogs: async (itemId, type) => {
    const key = `logs:${type}:${itemId}`;
    const cached = await cacheGet(key);

    // Descarta caches antigos ou malformados.
    if (cached && !Array.isArray(cached.data)) {
      await cacheDelete(key);
    } else if (
      cached &&
      Date.now() - cached.savedAt < CACHE_TTL
    ) {
      return cached.data;
    }

    return freshOrCached(key, async () => {
      const q = query(
        logsCol(),
        where("itemId", "==", String(itemId)),
        where("type", "==", type)
      );

      const snap = await getDocs(q);

      return snap.docs.map(d => ({
        id: d.id,
        ...d.data(),
        createdAtMs:
          d.data().createdAt?.toMillis?.() ?? 0
      }));
    });
  },

  addItemLog: async ({
    itemId,
    type,
    episode,
    watchedAt,
    comment
  }) => {
    requireOwner();

    await addDoc(logsCol(), {
      itemId: String(itemId),
      type,
      ...(episode != null
        ? { episode: Number(episode) }
        : {}),
      watchedAt: watchedAt ?? "",
      comment,
      createdAt: serverTimestamp(),
    });

    // Invalida o cache após adicionar um registro.
    await cacheDelete(`logs:${type}:${itemId}`);
  },

  deleteItemLog: async (logId) => {
    requireOwner();

    const logRef = doc(
      db,
      "users",
      OWNER_UID,
      "mediaLogs",
      logId
    );

    const logSnap = await getDoc(logRef);
    const log = logSnap.exists() ? logSnap.data() : null;

    await deleteDoc(logRef);

    // Invalida o cache correspondente ao item excluído.
    if (log?.itemId != null && log?.type) {
      await cacheDelete(`logs:${log.type}:${log.itemId}`);
    }
  },
};

/* ---------- Observer de autenticação ---------- */
onAuthStateChanged(auth, u => {
  emit(
    "fb-user",
    u && u.uid === OWNER_UID
      ? {
          uid: u.uid,
          name: u.displayName || u.email
        }
      : null
  );

  if (u && u.uid !== OWNER_UID) {
    signOut(auth).catch(() => {});
  }
});
