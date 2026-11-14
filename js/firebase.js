/* =====================================================================
   HUB DE FILMES & SÉRIES — Clpher
   firebase.js — autenticação Google + Firestore
   Usa o mesmo projeto Firebase do hub de animes, mas coleções próprias.
   ===================================================================== */
import { initializeApp }           from "https://www.gstatic.com/firebasejs/13.2.0/firebase-app.js";
import { getAuth, GoogleAuthProvider, signInWithPopup, signOut, onAuthStateChanged }
  from "https://www.gstatic.com/firebasejs/13.2.0/firebase-auth.js";
import {
  initializeFirestore, persistentLocalCache, persistentMultipleTabManager,
  collection, doc, getDoc, getDocs, getDocsFromServer, addDoc, setDoc, updateDoc, deleteDoc,
  serverTimestamp, query, where,
} from "https://www.gstatic.com/firebasejs/13.2.0/firebase-firestore.js";

/* ---------- Config Firebase (mesmo projeto do hub de animes) ---------- */
const app = initializeApp({
  apiKey:            "AIzaSyCgHMZV_wIFOV4QuJi3bBRbu_iOXSJ1ahY",
  authDomain:        "hub-pesoal.firebaseapp.com",
  projectId:         "hub-pesoal",
  storageBucket:     "hub-pesoal.firebasestorage.app",
  messagingSenderId: "335710840559",
  appId:             "1:335710840559:web:1d99e078383a9819a99d1a",
});

const auth = getAuth(app);
const OWNER_UID = "X569uLFYFgcX6i9mbEVsylUX7Li1"; // mesmo UID do hub de animes

const db = initializeFirestore(app, {
  localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }),
});

const emit = (name, detail) => window.dispatchEvent(new CustomEvent(name, { detail }));

/* ---------- Helpers de caminho (coleções separadas do hub de animes) ---------- */
const isOwner       = () => auth.currentUser?.uid === OWNER_UID;
const requireOwner  = () => { if (!isOwner()) throw new Error("Somente a conta proprietária pode editar.") };

// Notas por item (tipo separado)
const notePath = (itemId, type) =>
  doc(db, "users", OWNER_UID, type === "movie" ? "movieNotes" : "showNotes", String(itemId));

// Logs de episódios/sessões unificados numa coleção só
const logsCol = () => collection(db, "users", OWNER_UID, "mediaLogs");

/* ---------- Cache leve via IndexedDB ---------- */
const CACHE_DB   = "hub-filmes-cache-v1";
const CACHE_TTL  = 6 * 60 * 60 * 1000; // 6 h
let _cacheDb;

function openCache() {
  if (_cacheDb) return Promise.resolve(_cacheDb);
  return new Promise((res, rej) => {
    const req = indexedDB.open(CACHE_DB, 1);
    req.onupgradeneeded = () => { if (!req.result.objectStoreNames.contains("entries")) req.result.createObjectStore("entries") };
    req.onsuccess = () => { _cacheDb = req.result; res(_cacheDb) };
    req.onerror   = () => rej(req.error);
  });
}
async function cacheGet(key) {
  try { const d = await openCache(); return await new Promise((r, x) => { const q = d.transaction("entries","readonly").objectStore("entries").get(key); q.onsuccess = () => r(q.result||null); q.onerror = () => x(q.error) }) } catch { return null }
}
async function cacheSet(key, data) {
  try {
    const d = await openCache();
    await new Promise((resolve, reject) => {
      const tx = d.transaction("entries", "readwrite");
      tx.objectStore("entries").put({ data, savedAt: Date.now() }, key);
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error || new Error("Cache transaction aborted"));
    });
  } catch (e) { console.warn("Cache indisponível", e); }
}
async function cacheDelete(key) {
  try {
    const d = await openCache();
    await new Promise((resolve, reject) => {
      const tx = d.transaction("entries", "readwrite");
      tx.objectStore("entries").delete(key);
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error || new Error("Cache transaction aborted"));
    });
  } catch (e) { console.warn("Não foi possível invalidar o cache", e); }
}
async function cacheDeletePrefix(prefix) {
  try {
    const d = await openCache();
    await new Promise((resolve, reject) => {
      const tx = d.transaction("entries", "readwrite");
      const store = tx.objectStore("entries");
      const request = store.openCursor();
      request.onsuccess = () => {
        const cursor = request.result;
        if (!cursor) return;
        if (String(cursor.key).startsWith(prefix)) cursor.delete();
        cursor.continue();
      };
      request.onerror = () => reject(request.error);
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error || new Error("Cache transaction aborted"));
    });
  } catch (e) { console.warn("Não foi possível invalidar o cache", e); }
}
async function freshOrCached(key, fetcher) {
  const c = await cacheGet(key);
  if (c && Date.now() - c.savedAt < CACHE_TTL) return c.data;
  try { const fresh = await fetcher(); await cacheSet(key, fresh); return fresh }
  catch (err) { if (c) return c.data; throw err }
}

/* =====================================================================
   API pública do Firebase para o hub.js
   ===================================================================== */
window.hubFB = {
  /* Auth */
  login: async () => {
    if (auth.currentUser && !isOwner()) await signOut(auth);
    const result = await signInWithPopup(auth, new GoogleAuthProvider());
    if (result.user.uid !== OWNER_UID) { await signOut(auth); throw new Error("Esta conta Google não é a proprietária do Hub.") }
    return result;
  },
  logout: () => signOut(auth),

  /* Biblioteca própria: catálogo marcado nos documentos já autorizados pelas regras atuais. */
  getCatalog: async ({ refresh = false } = {}) => {
    if (refresh) { await cacheDelete("personal_catalog"); await cacheDelete("all_movie_notes"); await cacheDelete("all_show_notes"); }
    return freshOrCached("personal_catalog", async () => {
      const [moviesSnap, showsSnap] = await Promise.all([
        getDocs(collection(db, "users", OWNER_UID, "movieNotes")),
        getDocs(collection(db, "users", OWNER_UID, "showNotes")),
      ]);
      const movies = moviesSnap.docs.filter(d => d.data().inCatalog === true).map(d => ({ ...d.data(), id: String(d.data().id || d.id), mediaType: "movie", type: "movie" }));
      const shows = showsSnap.docs.filter(d => d.data().inCatalog === true).map(d => ({ ...d.data(), id: String(d.data().id || d.id), mediaType: "tv", type: "show" }));
      return [...movies, ...shows];
    });
  },
  addCatalogItem: async item => {
    requireOwner();
    if (!item?.id || !["movie", "tv"].includes(item.mediaType)) throw new Error("Título TMDB inválido.");
    const id = String(item.id);
    const type = item.mediaType === "tv" ? "show" : "movie";
    const status = ["plantowatch", "watching", "paused", "completed", "dropped"].includes(item.status) ? item.status : "plantowatch";
    await setDoc(notePath(id, type), {
      ...item, id, itemId: id, type, inCatalog: true,
      status, addedAt: serverTimestamp()
    }, { merge: true });

    // Statuses that represent a viewing journey create one automatically.
    const journeyStatus = ({ watching: "in_progress", paused: "paused", completed: "completed", dropped: "abandoned" })[status];
    if (journeyStatus) {
      const now = new Date().toISOString().slice(0,10);
      const journey = {
        itemId: id, type, recordType: "journey", journeyType: "first",
        status: journeyStatus,
        startedAt: journeyStatus === "in_progress" ? now : "",
        endedAt: ["completed", "abandoned"].includes(journeyStatus) ? now : "",
        score: 0, progressSeason: "", progressEpisode: "", notes: "",
        createdAt: serverTimestamp(),
      };
      await addDoc(logsCol(), journey);
    }
    await cacheDelete("personal_catalog");
    await cacheDelete(`note:${type}:${id}`);
    await cacheDelete(`logs:${type}:${id}`);
    if (journeyStatus) await window.hubFB.syncOverallStatus(id, type);
  },
  removeCatalogItem: async (id, type) => {
    requireOwner();
    const itemType = type === "tv" ? "show" : type;
    await setDoc(notePath(id, itemType), { inCatalog: false, removedAt: serverTimestamp() }, { merge: true });
    await cacheDelete("personal_catalog");
  },
  // Exclusão definitiva: remove o documento da biblioteca e todos os registros
  // de experiência/diário associados ao mesmo item e tipo. Diferente de
  // removeCatalogItem, nenhum dado pessoal da obra é preservado.
  deleteAllItemData: async (id, type) => {
    requireOwner();
    const itemId = String(id);
    const itemType = type === "tv" ? "show" : type;
    if (!itemId || !["movie", "show"].includes(itemType)) throw new Error("Obra inválida para exclusão.");

    const relatedQuery = query(logsCol(), where("itemId", "==", itemId), where("type", "==", itemType));
    const related = await getDocsFromServer(relatedQuery);
    for (const record of related.docs) await deleteDoc(record.ref);
    await deleteDoc(notePath(itemId, itemType));

    await Promise.all([
      cacheDelete("personal_catalog"),
      cacheDelete(`note:${itemType}:${itemId}`),
      cacheDelete(`logs:${itemType}:${itemId}`),
      cacheDelete(itemType === "movie" ? "all_movie_notes" : "all_show_notes"),
    ]);
  },

  /* Notas de um item (plataforma, impressão geral, etc.) */
  getItemNote: async (itemId, type) =>
    freshOrCached(`note:${type}:${itemId}`, async () => {
      const snap = await getDoc(notePath(itemId, type));
      return snap.exists() ? snap.data() : {};
    }),

  saveItemNote: async (itemId, type, data) => {
    requireOwner();
    await setDoc(notePath(itemId, type), { itemId: String(itemId), type, ...data, updatedAt: serverTimestamp() }, { merge: true });
    const old = (await cacheGet(`note:${type}:${itemId}`))?.data ?? {};
    await cacheSet(`note:${type}:${itemId}`, { ...old, ...data });
    await cacheDelete(`all_${type}_notes`);
    await cacheDelete("personal_catalog");
  },

  getAllMovieNotes: async ({ refresh = false } = {}) => {
    if (refresh) await cacheDelete("all_movie_notes");
    return freshOrCached("all_movie_notes", async () => {
      const snap = await getDocs(collection(db, "users", OWNER_UID, "movieNotes"));
      const out = {};
      snap.forEach(d => out[d.id] = d.data());
      return out;
    });
  },

  getAllShowNotes: async ({ refresh = false } = {}) => {
    if (refresh) await cacheDelete("all_show_notes");
    return freshOrCached("all_show_notes", async () => {
      const snap = await getDocs(collection(db, "users", OWNER_UID, "showNotes"));
      const out = {};
      snap.forEach(d => out[d.id] = d.data());
      return out;
    });
  },

  /* Logs de episódios / sessões */
  getItemLogs: async (itemId, type) => {
    // Jornadas e Diário precisam refletir imediatamente alterações feitas nesta sessão
    // ou em outra aba/dispositivo. Não confiar no cache IndexedDB de até 6 horas.
    const key = `logs:${type}:${itemId}`;
    const q = query(logsCol(), where("itemId", "==", String(itemId)), where("type", "==", type));
    try {
      const snap = await getDocsFromServer(q);
      const fresh = snap.docs.map(d => ({
        id: d.id, ...d.data(),
        createdAtMs: d.data().createdAt?.toMillis?.() ?? 0
      }));
      await cacheSet(key, fresh);
      return fresh;
    } catch (error) {
      // Se estiver sem conexão, permite consulta ao cache local do Firestore/IndexedDB.
      console.warn("Não foi possível atualizar os registros no servidor; usando dados locais.", error);
      const cached = await cacheGet(key);
      if (Array.isArray(cached?.data)) return cached.data;
      const snap = await getDocs(q);
      const local = snap.docs.map(d => ({
        id: d.id, ...d.data(),
        createdAtMs: d.data().createdAt?.toMillis?.() ?? 0
      }));
      await cacheSet(key, local);
      return local;
    }
  },

  /* Jornadas independentes: armazenadas em mediaLogs para aproveitar as regras atuais. */
  getItemJourneys: async (itemId, type) => {
    const logs = await window.hubFB.getItemLogs(itemId, type);
    return logs.filter(x => x.recordType === "journey").sort((a,b) => (b.createdAtMs||0)-(a.createdAtMs||0));
  },

  createJourney: async ({ itemId, type }) => {
    requireOwner();
    if (!itemId || !["movie", "show"].includes(type)) throw new Error("Dados inválidos para a experiência.");
    await cacheDelete(`logs:${type}:${itemId}`);
    const previousJourneys = await window.hubFB.getItemJourneys(itemId, type);
    if (previousJourneys.some(j => j.status === "in_progress")) {
      throw new Error("Já existe uma experiência em andamento para esta obra. Conclua, pause ou abandone-a antes de iniciar outra.");
    }
    const latestJourney = [...previousJourneys].sort((a,b) => (b.createdAtMs||0)-(a.createdAtMs||0))[0];
    const journeyType = !latestJourney ? "first" : latestJourney.status === "completed" ? "rewatch" : "retry";
    const payload = {
      itemId: String(itemId), type, recordType: "journey", journeyType,
      status: "in_progress", startedAt: new Date().toISOString().slice(0,10), endedAt: "",
      score: 0, progressSeason: "", progressEpisode: "", notes: "",
      createdAt: serverTimestamp(),
    };
    const ref = await addDoc(logsCol(), payload);
    await cacheDelete(`logs:${type}:${itemId}`);
    await window.hubFB.syncOverallStatus(itemId, type);
    return ref.id;
  },

  syncOverallStatus: async (itemId, type) => {
    requireOwner();
    const journeys = await window.hubFB.getItemJourneys(itemId, type);
    if (!journeys.length) {
      await setDoc(notePath(itemId, type), { status: "plantowatch", updatedAt: serverTimestamp() }, { merge: true });
      await cacheDelete(`note:${type}:${itemId}`);
      await cacheDelete("personal_catalog");
      return "plantowatch";
    }
    const ordered = [...journeys].sort((a,b) => (b.createdAtMs||0)-(a.createdAtMs||0));
    const active = ordered.find(j => j.status === "in_progress");
    const paused = ordered.find(j => j.status === "paused");
    const latest = ordered[0];
    const status = active ? "watching" : latest?.status === "paused" ? "paused" : latest?.status === "abandoned" ? "dropped" : latest?.status === "completed" ? "completed" : "plantowatch";
    await setDoc(notePath(itemId, type), { status, updatedAt: serverTimestamp() }, { merge: true });
    await cacheDelete(`note:${type}:${itemId}`);
    await cacheDelete("personal_catalog");
    return status;
  },

  deleteJourney: async (journeyId) => {
    requireOwner();
    const ref = doc(db, "users", OWNER_UID, "mediaLogs", String(journeyId));
    const snap = await getDoc(ref);
    if (!snap.exists() || snap.data().recordType !== "journey") throw new Error("Experiência não encontrada.");
    const journey = snap.data();
    const q = query(logsCol(), where("itemId", "==", String(journey.itemId)), where("type", "==", journey.type));
    const related = await getDocs(q);
    // Preserva o Diário e remove somente o vínculo com a experiência excluída.
    const linked = related.docs.filter(d => d.id !== String(journeyId) && String(d.data().journeyId || "") === String(journeyId));
    for (const log of linked) await updateDoc(log.ref, { journeyId: "", updatedAt: serverTimestamp() });
    await deleteDoc(ref);
    await cacheDelete(`logs:${journey.type}:${journey.itemId}`);
    await cacheDelete("personal_catalog");
    await window.hubFB.syncOverallStatus(journey.itemId, journey.type);
  },

  updateJourney: async (journeyId, data) => {
    requireOwner();
    const ref = doc(db, "users", OWNER_UID, "mediaLogs", String(journeyId));
    const snap = await getDoc(ref);
    if (!snap.exists() || snap.data().recordType !== "journey") throw new Error("Experiência não encontrada.");
    const old = snap.data();
    // A edição manual permite corrigir um status marcado por engano.
    // A retomada pelas ações rápidas continua sujeita à regra de uma única experiência ativa.
    if (data.status === "in_progress" && old.status !== "in_progress") {
      await cacheDelete(`logs:${old.type}:${old.itemId}`);
      const journeys = await window.hubFB.getItemJourneys(old.itemId, old.type);
      if (journeys.some(j => j.id !== String(journeyId) && j.status === "in_progress")) {
        throw new Error("Outra experiência desta obra já está em andamento. Pause ou encerre-a antes de retomar esta.");
      }
    }
    const payload = { updatedAt: serverTimestamp() };
    for (const key of ["status", "startedAt", "endedAt", "notes"]) {
      if (Object.prototype.hasOwnProperty.call(data, key)) payload[key] = String(data[key] ?? "");
    }
    // `seasons` é um mapa estruturado (temporada -> episódios, nota e datas).
    // Convertê-lo para String destrói os dados como "[object Object]" e impede
    // que o progresso seja recuperado ao reabrir a série.
    if (Object.prototype.hasOwnProperty.call(data, "seasons")) {
      let seasons = data.seasons;
      // Normaliza formatos legados antes de persistir: o formato canônico é
      // um mapa { "1": { watchedEpisodes: [...], ... }, "2": { ... } }.
      if (typeof seasons === "string" && seasons.trim()) {
        try { seasons = JSON.parse(seasons); } catch { seasons = {}; }
      }
      if (Array.isArray(seasons)) {
        seasons = Object.fromEntries(seasons.map((season, index) => [
          String(season?.number ?? index + 1),
          season && typeof season === "object" ? season : {}
        ]));
      }
      if (!seasons || typeof seasons !== "object") seasons = {};
      payload.seasons = seasons;
    }
    for (const key of ["score", "progressSeason", "progressEpisode"]) {
      if (Object.prototype.hasOwnProperty.call(data, key)) payload[key] = key === "score" ? Math.max(0, Math.min(100, Number(data[key]) || 0)) : (data[key] === "" || data[key] == null ? "" : Number(data[key]));
    }
    if (data.status === "in_progress" || data.status === "paused") payload.endedAt = "";
    else if (data.status && !Object.prototype.hasOwnProperty.call(data, "endedAt")) payload.endedAt = old.endedAt || new Date().toISOString().slice(0,10);
    await setDoc(ref, payload, { merge: true });
    await cacheDelete(`logs:${old.type}:${old.itemId}`);
    await window.hubFB.syncOverallStatus(old.itemId, old.type);
  },

  addItemLog: async ({ itemId, type, journeyId, episode, watchedAt, comment }) => {
    requireOwner();
    if (!itemId || !["movie", "show"].includes(type)) throw new Error("Dados inválidos para o registro.");
    const payload = {
      itemId: String(itemId), type,
      ...(journeyId ? { journeyId: String(journeyId) } : {}),
      ...(episode != null ? { episode: Number(episode) } : {}),
      watchedAt: watchedAt ?? "",
      comment: String(comment ?? ""),
      createdAt: serverTimestamp(),
    };
    await addDoc(logsCol(), payload);
    await cacheDelete(`logs:${type}:${itemId}`);
  },

  updateItemLog: async (logId, data) => {
    requireOwner();
    const ref = doc(db, "users", OWNER_UID, "mediaLogs", String(logId));
    const snap = await getDoc(ref);
    if (!snap.exists()) throw new Error("Registro do diário não encontrado.");
    const payload = { updatedAt: serverTimestamp() };
    if (Object.prototype.hasOwnProperty.call(data, "comment")) payload.comment = String(data.comment ?? "");
    if (Object.prototype.hasOwnProperty.call(data, "watchedAt")) payload.watchedAt = String(data.watchedAt ?? "");
    if (Object.prototype.hasOwnProperty.call(data, "episode")) payload.episode = Number(data.episode);
    if (Object.prototype.hasOwnProperty.call(data, "journeyId")) payload.journeyId = String(data.journeyId ?? "");
    await setDoc(ref, payload, { merge: true });
    const old = snap.data();
    await cacheDelete(`logs:${old.type}:${old.itemId}`);
  },

  deleteItemLog: async (logId) => {
    requireOwner();
    const ref = doc(db, "users", OWNER_UID, "mediaLogs", String(logId));
    let related = null;
    try {
      const snap = await getDoc(ref);
      if (snap.exists()) related = snap.data();
    } catch (error) {
      console.warn("Não foi possível identificar o cache do registro; a exclusão continuará.", error);
    }
    await deleteDoc(ref);
    if (related?.type && related?.itemId != null) {
      await cacheDelete(`logs:${related.type}:${related.itemId}`);
    } else {
      await cacheDeletePrefix("logs:");
    }
  },
};

/* ---------- Observer de autenticação ---------- */
onAuthStateChanged(auth, u => {
  emit("fb-user", u && u.uid === OWNER_UID ? { uid: u.uid, name: u.displayName || u.email } : null);
  if (u && u.uid !== OWNER_UID) signOut(auth).catch(() => {});
});
