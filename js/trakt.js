/* =====================================================================
   HUB DE FILMES & SÉRIES — Clpher
   trakt.js — Autenticação PKCE + chamadas à API do Trakt
   ===================================================================== */

const TRAKT_CLIENT_ID = "DvAFy0GF0AHogpxgm9MdBfZFt_JzylHAJsjfifVSbug";
const TRAKT_API       = "https://api.trakt.tv";
const TRAKT_OWNER     = "Cypher169"; // username fixo no Trakt

/* URI de redirecionamento — normaliza localhost/127.0.0.1 e remove index.html */
function getRedirectUri() {
  if (location.hostname.includes("github.io")) {
    return "https://cipher-169.github.io/hub-series-filmes/";
  }
  const port = location.port ? `:${location.port}` : "";
  let path = location.pathname;
  if (path.endsWith("index.html")) path = path.slice(0, -10);
  if (!path.endsWith("/")) path += "/";
  // Usa localhost se estiver rodando localmente
  const host = (location.hostname === "127.0.0.1" || location.hostname === "localhost") ? "localhost" : location.hostname;
  return `${location.protocol}//${host}${port}${path}`;
}
const REDIRECT_URI = getRedirectUri();

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

  const redirectUri = getRedirectUri();
  const params = new URLSearchParams({
    response_type:         "code",
    client_id:             TRAKT_CLIENT_ID,
    redirect_uri:          redirectUri,
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
      redirect_uri:  getRedirectUri(),
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

async function _request(endpoint) {
  const headers = {
    "Content-Type":      "application/json",
    "trakt-api-version": "2",
    "trakt-api-key":     TRAKT_CLIENT_ID,
  };
  const token = localStorage.getItem(LS_TOKEN);
  if (token) {
    headers["Authorization"] = `Bearer ${token}`;
  }

  const res = await fetch(`${TRAKT_API}${endpoint}`, { headers });
  if (!res.ok) throw new Error(`Trakt ${res.status}: ${endpoint}`);
  return res.json();
}

/* ---- Catálogo do usuário ---- */

/**
 * Busca todo o catálogo do usuário no Trakt.
 * Se autenticado, usa os endpoints oficiais /sync do Trakt que acessam a conta diretamente.
 * Se não, tenta os endpoints públicos /users/{username}.
 */
async function fetchCatalog(username = TRAKT_OWNER) {
  const isAuth = isAuthenticated();

  const endpoints = isAuth ? {
    wMovies:  `/sync/watched/movies?extended=full`,
    wlMovies: `/sync/watchlist/movies?extended=full`,
    cMovies:  `/sync/collection/movies?extended=full`,
    wShows:   `/sync/watched/shows?extended=full`,
    wlShows:  `/sync/watchlist/shows?extended=full`,
    cShows:   `/sync/collection/shows?extended=full`,
  } : {
    wMovies:  `/users/${username}/watched/movies?extended=full`,
    wlMovies: `/users/${username}/watchlist/movies?extended=full`,
    cMovies:  `/users/${username}/collection/movies?extended=full`,
    wShows:   `/users/${username}/watched/shows?extended=full`,
    wlShows:  `/users/${username}/watchlist/shows?extended=full`,
    cShows:   `/users/${username}/collection/shows?extended=full`,
  };

  const [wMovies, wlMovies, cMovies, wShows, wlShows, cShows] = await Promise.all([
    _request(endpoints.wMovies).catch(e => { console.warn("Trakt wMovies:", e); return []; }),
    _request(endpoints.wlMovies).catch(e => { console.warn("Trakt wlMovies:", e); return []; }),
    _request(endpoints.cMovies).catch(e => { console.warn("Trakt cMovies:", e); return []; }),
    _request(endpoints.wShows).catch(e => { console.warn("Trakt wShows:", e); return []; }),
    _request(endpoints.wlShows).catch(e => { console.warn("Trakt wlShows:", e); return []; }),
    _request(endpoints.cShows).catch(e => { console.warn("Trakt cShows:", e); return []; }),
  ]);

  return { wMovies, wlMovies, cMovies, wShows, wlShows, cShows };
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
  return _request(`/users/${username}/shows/${id}/progress/watched`);
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
function transformCatalog({ wMovies = [], wlMovies = [], cMovies = [], wShows = [], wlShows = [], cShows = [] } = {}, fbNotes = {}) {
  /* ---- FILMES ---- */
  const movieMap = new Map();

  // 1. Filmes assistidos
  (Array.isArray(wMovies) ? wMovies : []).forEach(item => {
    const movie = item.movie || item;
    if (!movie?.ids?.trakt) return;
    const id = String(movie.ids.trakt);
    movieMap.set(id, {
      id,
      type:     "movie",
      title:    movie.title || "Filme sem título",
      year:     movie.year || null,
      status:   "completed",
      plays:    item.plays ?? 1,
      traktId:  movie.ids.trakt,
      tmdbId:   movie.ids.tmdb,
      imdbId:   movie.ids.imdb,
      slug:     movie.ids.slug,
      overview: movie.overview ?? "",
      traktUrl: movie.ids.slug ? `https://trakt.tv/movies/${movie.ids.slug}` : `https://trakt.tv`,
      cover:    null,
      banner:   null,
      score:    fbNotes[`movie_${id}`]?.score ?? 0,
    });
  });

  // 2. Filmes na watchlist (quero assistir)
  (Array.isArray(wlMovies) ? wlMovies : []).forEach(item => {
    const movie = item.movie || item;
    if (!movie?.ids?.trakt) return;
    const id = String(movie.ids.trakt);
    if (!movieMap.has(id)) {
      movieMap.set(id, {
        id,
        type:     "movie",
        title:    movie.title || "Filme sem título",
        year:     movie.year || null,
        status:   "plantowatch",
        plays:    0,
        traktId:  movie.ids.trakt,
        tmdbId:   movie.ids.tmdb,
        imdbId:   movie.ids.imdb,
        slug:     movie.ids.slug,
        overview: movie.overview ?? "",
        traktUrl: movie.ids.slug ? `https://trakt.tv/movies/${movie.ids.slug}` : `https://trakt.tv`,
        cover:    null,
        banner:   null,
        score:    fbNotes[`movie_${id}`]?.score ?? 0,
      });
    }
  });

  // 3. Filmes na coleção (se não estiver nos anteriores)
  (Array.isArray(cMovies) ? cMovies : []).forEach(item => {
    const movie = item.movie || item;
    if (!movie?.ids?.trakt) return;
    const id = String(movie.ids.trakt);
    if (!movieMap.has(id)) {
      movieMap.set(id, {
        id,
        type:     "movie",
        title:    movie.title || "Filme sem título",
        year:     movie.year || null,
        status:   "plantowatch",
        plays:    0,
        traktId:  movie.ids.trakt,
        tmdbId:   movie.ids.tmdb,
        imdbId:   movie.ids.imdb,
        slug:     movie.ids.slug,
        overview: movie.overview ?? "",
        traktUrl: movie.ids.slug ? `https://trakt.tv/movies/${movie.ids.slug}` : `https://trakt.tv`,
        cover:    null,
        banner:   null,
        score:    fbNotes[`movie_${id}`]?.score ?? 0,
      });
    }
  });

  /* ---- SÉRIES ---- */
  const showMap = new Map();

  // 1. Séries assistidas
  (Array.isArray(wShows) ? wShows : []).forEach(item => {
    const show = item.show || item;
    if (!show?.ids?.trakt) return;
    const id      = String(show.ids.trakt);
    const seasons = item.seasons || [];
    const watched = _countWatchedEps(seasons);
    const status  = _showStatus({ show, seasons });

    showMap.set(id, {
      id,
      type:     "show",
      title:    show.title || "Série sem título",
      year:     show.year || null,
      status,
      plays:    item.plays ?? 1,
      progress: watched,
      eps:      null,
      seasons,
      traktId:  show.ids.trakt,
      tmdbId:   show.ids.tmdb,
      imdbId:   show.ids.imdb,
      slug:     show.ids.slug,
      overview: show.overview ?? "",
      traktUrl: show.ids.slug ? `https://trakt.tv/shows/${show.ids.slug}` : `https://trakt.tv`,
      cover:    null,
      banner:   null,
      score:    fbNotes[`show_${id}`]?.scoreOverall ?? 0,
    });
  });

  // 2. Séries na watchlist
  (Array.isArray(wlShows) ? wlShows : []).forEach(item => {
    const show = item.show || item;
    if (!show?.ids?.trakt) return;
    const id = String(show.ids.trakt);
    if (!showMap.has(id)) {
      showMap.set(id, {
        id,
        type:     "show",
        title:    show.title || "Série sem título",
        year:     show.year || null,
        status:   "plantowatch",
        plays:    0,
        progress: 0,
        eps:      null,
        seasons:  [],
        traktId:  show.ids.trakt,
        tmdbId:   show.ids.tmdb,
        imdbId:   show.ids.imdb,
        slug:     show.ids.slug,
        overview: show.overview ?? "",
        traktUrl: show.ids.slug ? `https://trakt.tv/shows/${show.ids.slug}` : `https://trakt.tv`,
        cover:    null,
        banner:   null,
        score:    fbNotes[`show_${id}`]?.scoreOverall ?? 0,
      });
    }
  });

  // 3. Séries na coleção
  (Array.isArray(cShows) ? cShows : []).forEach(item => {
    const show = item.show || item;
    if (!show?.ids?.trakt) return;
    const id = String(show.ids.trakt);
    if (!showMap.has(id)) {
      showMap.set(id, {
        id,
        type:     "show",
        title:    show.title || "Série sem título",
        year:     show.year || null,
        status:   "plantowatch",
        plays:    0,
        progress: 0,
        eps:      null,
        seasons:  [],
        traktId:  show.ids.trakt,
        tmdbId:   show.ids.tmdb,
        imdbId:   show.ids.imdb,
        slug:     show.ids.slug,
        overview: show.overview ?? "",
        traktUrl: show.ids.slug ? `https://trakt.tv/shows/${show.ids.slug}` : `https://trakt.tv`,
        cover:    null,
        banner:   null,
        score:    fbNotes[`show_${id}`]?.scoreOverall ?? 0,
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
   IMAGENS VIA TMDB — Cloudflare Worker + cache local
   O token do TMDB fica exclusivamente como Secret no Cloudflare Worker.
   ===================================================================== */

const TMDB_WORKER_URL = "https://hub-filmes-series.world-testaocenter790.workers.dev";

/**
 * Enriquece filmes e séries com pôster e imagem de fundo do TMDB.
 * Usa o cache IndexedDB existente e limita a concorrência para não disparar
 * dezenas de requisições simultâneas ao Worker.
 */
async function enrichWithPosters(items = []) {
  const queue = items.filter(item => item?.tmdbId && !(item.cover && item.banner));
  let cursor = 0;

  async function worker() {
    while (cursor < queue.length) {
      const item = queue[cursor++];
      const kind = item.type === "movie" ? "movie" : "tv";
      const cacheKey = `tmdb_images_v2_${kind}_${item.tmdbId}`;

      try {
        let images = await cacheGet(cacheKey);
        if (!images) {
          const response = await fetch(`${TMDB_WORKER_URL}/api/tmdb/${kind}/${encodeURIComponent(item.tmdbId)}`);
          if (!response.ok) throw new Error(`TMDB Worker ${response.status}`);
          images = await response.json();
          await cacheSet(cacheKey, images);
        }

        item.cover = item.cover || images.posterUrl || null;
        item.banner = item.banner || images.backdropUrl || null;
      } catch (error) {
        console.warn(`Não foi possível carregar imagens de ${item.title}:`, error);
      }
    }
  }

  const concurrency = Math.min(6, queue.length);
  await Promise.all(Array.from({ length: concurrency }, () => worker()));
  return items;
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
