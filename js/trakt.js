/* =====================================================================
   HUB DE FILMES & SÉRIES — Clpher
   trakt.js — Autenticação PKCE + chamadas à API do Trakt
   ===================================================================== */

const TRAKT_CLIENT_ID = "DvAFy0GF0AHogpxgm9MdBFZFt_Jzy1HAJsjfifVSbug";
const TRAKT_API       = "https://api.trakt.tv";
const TRAKT_OWNER     = "Clpher"; // username fixo no Trakt

/* URI de redirecionamento — detecta automaticamente o ambiente */
const REDIRECT_URI = `${location.origin}${location.pathname}`;

/* ---------- Chaves de armazenamento (localStorage) ---------- */
const LS_TOKEN    = "trakt_token";
const LS_VERIFIER = "trakt_verifier";
const LS_EXPIRY   = "trakt_expiry";

/* =====================================================================
   PKCE — funções criptográficas
   ===================================================================== */

function _base64url(buffer) {
  return btoa(String.fromCharCode(...new Uint8Array(buffer)))
    .replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
}

function _generateVerifier() {
  const arr = new Uint8Array(32);
  crypto.getRandomValues(arr);
  return _base64url(arr);
}

async function _generateChallenge(verifier) {
  const data = new TextEncoder().encode(verifier);
  const hash = await crypto.subtle.digest("SHA-256", data);
  return _base64url(hash);
}

/* =====================================================================
   AUTENTICAÇÃO
   ===================================================================== */

/** Inicia o login — redireciona para o Trakt */
async function login() {
  const verifier   = _generateVerifier();
  const challenge  = await _generateChallenge(verifier);
  localStorage.setItem(LS_VERIFIER, verifier);

  const params = new URLSearchParams({
    response_type:         "code",
    client_id:             TRAKT_CLIENT_ID,
    redirect_uri:          REDIRECT_URI,
    code_challenge:        challenge,
    code_challenge_method: "S256",
  });

  window.location.href = `https://trakt.tv/oauth/authorize?${params}`;
}

/** Troca o código pelo token — chamado ao detectar ?code= na URL */
async function handleCallback() {
  const params   = new URLSearchParams(location.search);
  const code     = params.get("code");
  const verifier = localStorage.getItem(LS_VERIFIER);

  if (!code || !verifier) return false;

  const res = await fetch(`${TRAKT_API}/oauth/token`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      code,
      client_id:     TRAKT_CLIENT_ID,
      redirect_uri:  REDIRECT_URI,
      code_verifier: verifier,
      grant_type:    "authorization_code",
    }),
  });

  if (!res.ok) {
    console.error("Trakt token exchange failed", res.status);
    return false;
  }

  const data = await res.json();
  localStorage.setItem(LS_TOKEN,  data.access_token);
  localStorage.setItem(LS_EXPIRY, Date.now() + data.expires_in * 1000);
  localStorage.removeItem(LS_VERIFIER);

  /* Limpa o ?code= da URL sem recarregar a página */
  history.replaceState({}, "", location.pathname);
  return true;
}

/** Faz logout */
function logout() {
  localStorage.removeItem(LS_TOKEN);
  localStorage.removeItem(LS_EXPIRY);
}

/** Token ainda válido? */
function isAuthenticated() {
  const token  = localStorage.getItem(LS_TOKEN);
  const expiry = Number(localStorage.getItem(LS_EXPIRY) || 0);
  return !!token && Date.now() < expiry;
}

/* =====================================================================
   CHAMADAS À API
   ===================================================================== */

async function _request(endpoint, { auth = false } = {}) {
  const headers = {
    "Content-Type":    "application/json",
    "trakt-api-version": "2",
    "trakt-api-key":   TRAKT_CLIENT_ID,
  };
  if (auth) {
    const token = localStorage.getItem(LS_TOKEN);
    if (token) headers["Authorization"] = `Bearer ${token}`;
  }

  const res = await fetch(`${TRAKT_API}${endpoint}`, { headers });
  if (!res.ok) throw new Error(`Trakt ${res.status}: ${endpoint}`);
  return res.json();
}

/* ---- Catálogo do usuário ---- */

/** Filmes assistidos */
async function fetchWatchedMovies(username = TRAKT_OWNER) {
  return _request(`/users/${username}/watched/movies?extended=full`);
}

/** Filmes da watchlist (quero assistir) */
async function fetchWatchlistMovies(username = TRAKT_OWNER) {
  return _request(`/users/${username}/watchlist/movies?extended=full`);
}

/** Séries assistidas (inclui episódios por temporada) */
async function fetchWatchedShows(username = TRAKT_OWNER) {
  return _request(`/users/${username}/watched/shows?extended=full`);
}

/** Séries da watchlist */
async function fetchWatchlistShows(username = TRAKT_OWNER) {
  return _request(`/users/${username}/watchlist/shows?extended=full`);
}

/** Busca todo o catálogo de uma vez */
async function fetchCatalog(username = TRAKT_OWNER) {
  const [wMovies, wlMovies, wShows, wlShows] = await Promise.all([
    fetchWatchedMovies(username),
    fetchWatchlistMovies(username),
    fetchWatchedShows(username),
    fetchWatchlistShows(username),
  ]);
  return { wMovies, wlMovies, wShows, wlShows };
}

/** Detalhes de uma série (sinopse, etc.) */
async function fetchShowDetail(id) {
  return _request(`/shows/${id}?extended=full`);
}

/** Temporadas + episódios de uma série */
async function fetchShowSeasons(id) {
  return _request(`/shows/${id}/seasons?extended=episodes`);
}

/** Progresso assistido de uma série para o usuário */
async function fetchShowProgress(id, username = TRAKT_OWNER) {
  return _request(`/users/${username}/shows/${id}/progress/watched`, { auth: true });
}

/* =====================================================================
   TRANSFORMAÇÃO DOS DADOS
   Converte os dados brutos do Trakt para o formato interno do hub.
   ===================================================================== */

/** Calcula status de uma série com base nos episódios assistidos */
function _showStatus(wShow) {
  if (!wShow) return "plantowatch";
  const seasons    = wShow.seasons ?? [];
  const watched    = seasons.reduce((n, s) => n + (s.episodes?.length ?? 0), 0);
  const airing     = wShow.show?.status ?? "";
  if (watched === 0) return "plantowatch";
  if (airing === "ended" || airing === "canceled") return "completed";
  return "watching";
}

/** Conta episódios assistidos de uma série */
function _countWatchedEps(seasons = []) {
  return seasons.reduce((n, s) => n + (s.episodes?.length ?? 0), 0);
}

/**
 * Transforma o catálogo bruto do Trakt em arrays {movies, shows}.
 * Também recebe as notas salvas no Firebase para mesclar.
 */
function transformCatalog({ wMovies, wlMovies, wShows, wlShows }, fbNotes = {}) {
  /* ---- FILMES ---- */
  const movieMap = new Map();

  wMovies.forEach(({ movie, plays }) => {
    const id = String(movie.ids.trakt);
    movieMap.set(id, {
      id,
      type:    "movie",
      title:   movie.title,
      year:    movie.year,
      status:  "completed",
      plays:   plays ?? 1,
      traktId: movie.ids.trakt,
      tmdbId:  movie.ids.tmdb,
      imdbId:  movie.ids.imdb,
      slug:    movie.ids.slug,
      overview: movie.overview ?? "",
      traktUrl: `https://trakt.tv/movies/${movie.ids.slug}`,
      cover:   null, // preenchido via TMDB depois
      banner:  null,
      score:   fbNotes[`movie_${id}`]?.score ?? 0,
    });
  });

  wlMovies.forEach(({ movie }) => {
    const id = String(movie.ids.trakt);
    if (!movieMap.has(id)) {
      movieMap.set(id, {
        id,
        type:    "movie",
        title:   movie.title,
        year:    movie.year,
        status:  "plantowatch",
        plays:   0,
        traktId: movie.ids.trakt,
        tmdbId:  movie.ids.tmdb,
        imdbId:  movie.ids.imdb,
        slug:    movie.ids.slug,
        overview: movie.overview ?? "",
        traktUrl: `https://trakt.tv/movies/${movie.ids.slug}`,
        cover:   null,
        banner:  null,
        score:   fbNotes[`movie_${id}`]?.score ?? 0,
      });
    }
  });

  /* ---- SÉRIES ---- */
  const showMap = new Map();

  wShows.forEach(({ show, seasons, plays }) => {
    const id      = String(show.ids.trakt);
    const watched = _countWatchedEps(seasons);
    const status  = _showStatus({ show, seasons });

    showMap.set(id, {
      id,
      type:     "show",
      title:    show.title,
      year:     show.year,
      status,
      plays:    plays ?? 1,
      progress: watched,
      eps:      null, // total de eps — buscamos depois ao abrir a série
      seasons,        // detalhes de episódios assistidos
      traktId:  show.ids.trakt,
      tmdbId:   show.ids.tmdb,
      imdbId:   show.ids.imdb,
      slug:     show.ids.slug,
      overview: show.overview ?? "",
      traktUrl: `https://trakt.tv/shows/${show.ids.slug}`,
      cover:    null,
      banner:   null,
      score:    fbNotes[`show_${id}`]?.scoreOverall ?? 0,
    });
  });

  wlShows.forEach(({ show }) => {
    const id = String(show.ids.trakt);
    if (!showMap.has(id)) {
      showMap.set(id, {
        id,
        type:    "show",
        title:   show.title,
        year:    show.year,
        status:  "plantowatch",
        plays:   0,
        progress: 0,
        eps:     null,
        seasons: [],
        traktId: show.ids.trakt,
        tmdbId:  show.ids.tmdb,
        imdbId:  show.ids.imdb,
        slug:    show.ids.slug,
        overview: show.overview ?? "",
        traktUrl: `https://trakt.tv/shows/${show.ids.slug}`,
        cover:   null,
        banner:  null,
        score:   fbNotes[`show_${id}`]?.scoreOverall ?? 0,
      });
    }
  });

  return {
    movies:   [...movieMap.values()],
    shows:    [...showMap.values()],
    watching: [...movieMap.values(), ...showMap.values()].filter(i => i.status === "watching"),
  };
}

/* =====================================================================
   IMAGENS VIA TMDB (opcional — precisa de API key)
   Chame enrichWithPosters(items, tmdbApiKey) para adicionar capas.
   ===================================================================== */

/**
 * Busca o pôster de um item via TMDB e preenche .cover e .banner.
 * Requer uma TMDB API key (gratuita em themoviedb.org).
 */
async function enrichWithPosters(items, tmdbApiKey) {
  if (!tmdbApiKey) return;
  const BASE = "https://api.themoviedb.org/3";
  const IMG  = "https://image.tmdb.org/t/p";

  await Promise.all(items.map(async item => {
    if (!item.tmdbId || (item.cover && item.banner)) return;
    try {
      const path  = item.type === "movie" ? `movie/${item.tmdbId}` : `tv/${item.tmdbId}`;
      const data  = await fetch(`${BASE}/${path}?api_key=${tmdbApiKey}`).then(r => r.json());
      const poster = data.poster_path   ?? null;
      const backdrop = data.backdrop_path ?? null;
      item.cover  = poster   ? `${IMG}/w500${poster}`   : null;
      item.banner = backdrop ? `${IMG}/w1280${backdrop}` : null;
    } catch { /* ignora falhas pontuais */ }
  }));
}

/* =====================================================================
   CACHE LOCAL (IndexedDB) para o catálogo do Trakt
   ===================================================================== */

const CACHE_DB_NAME = "hub-trakt-cache-v1";
const CACHE_TTL_MS  = 6 * 60 * 60 * 1000; // 6 horas
let _cacheDb;

function _openCacheDb() {
  if (_cacheDb) return Promise.resolve(_cacheDb);
  return new Promise((ok, fail) => {
    const req = indexedDB.open(CACHE_DB_NAME, 1);
    req.onupgradeneeded = () => { if (!req.result.objectStoreNames.contains("entries")) req.result.createObjectStore("entries") };
    req.onsuccess = () => { _cacheDb = req.result; ok(_cacheDb) };
    req.onerror   = () => fail(req.error);
  });
}

async function cacheGet(key) {
  try {
    const db  = await _openCacheDb();
    const row = await new Promise((r, x) => { const q = db.transaction("entries","readonly").objectStore("entries").get(key); q.onsuccess = () => r(q.result||null); q.onerror = () => x(q.error) });
    if (!row || Date.now() - row.savedAt > CACHE_TTL_MS) return null;
    return row.data;
  } catch { return null }
}

async function cacheSet(key, data) {
  try {
    const db = await _openCacheDb();
    await new Promise((r, x) => { const tx = db.transaction("entries","readwrite"); tx.objectStore("entries").put({data,savedAt:Date.now()},key); tx.oncomplete=r; tx.onerror=()=>x(tx.error) });
  } catch (e) { console.warn("Cache indisponível", e) }
}

async function cacheDelete(key) {
  try {
    const db = await _openCacheDb();
    await new Promise((r, x) => { const tx = db.transaction("entries","readwrite"); tx.objectStore("entries").delete(key); tx.oncomplete=r; tx.onerror=()=>x(tx.error) });
  } catch {}
}

/* =====================================================================
   API PÚBLICA — window.TraktAuth
   ===================================================================== */

window.TraktAuth = {
  login,
  logout,
  isAuthenticated,
  handleCallback,
  fetchCatalog,
  fetchShowSeasons,
  fetchShowProgress,
  enrichWithPosters,
  transformCatalog,
  cacheGet,
  cacheSet,
  cacheDelete,
  OWNER: TRAKT_OWNER,
};
