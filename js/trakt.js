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
const LS_REFRESH  = "trakt_refresh_token";
const LS_STATE    = "trakt_oauth_state";

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
  const stateBytes = new Uint8Array(24);
  crypto.getRandomValues(stateBytes);
  const state = _base64url(stateBytes);
  localStorage.setItem(LS_VERIFIER, verifier);
  localStorage.setItem(LS_STATE, state);

  const redirectUri = getRedirectUri();
  const params = new URLSearchParams({
    response_type:         "code",
    client_id:             TRAKT_CLIENT_ID,
    redirect_uri:          redirectUri,
    code_challenge:        challenge,
    code_challenge_method: "S256",
    state,
  });

  window.location.href = `https://auth.trakt.tv/oauth/authorize?${params}`;
}

/** Troca o código pelo token — chamado ao detectar ?code= na URL */
async function handleCallback() {
  const params = new URLSearchParams(location.search);
  const code = params.get("code");
  const returnedState = params.get("state");
  const oauthError = params.get("error");
  if (!code && !oauthError) return false;

  const verifier = localStorage.getItem(LS_VERIFIER);
  const expectedState = localStorage.getItem(LS_STATE);
  const cleanUrl = () => history.replaceState({}, "", location.pathname + location.hash);

  if (oauthError) {
    localStorage.removeItem(LS_VERIFIER);
    localStorage.removeItem(LS_STATE);
    cleanUrl();
    throw new Error(`Autorização Trakt não concluída: ${oauthError}`);
  }
  if (!code || !verifier || !expectedState || returnedState !== expectedState) {
    localStorage.removeItem(LS_VERIFIER);
    localStorage.removeItem(LS_STATE);
    cleanUrl();
    throw new Error("Retorno OAuth inválido ou expirado. Tente conectar novamente.");
  }

  const res = await fetch(`${TRAKT_API}/oauth/token`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      code, client_id: TRAKT_CLIENT_ID, redirect_uri: getRedirectUri(),
      code_verifier: verifier, grant_type: "authorization_code",
    }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    cleanUrl();
    throw new Error(`Falha ao conectar ao Trakt (HTTP ${res.status}): ${data.error_description || data.error || "erro desconhecido"}`);
  }
  _storeTokens(data);
  localStorage.removeItem(LS_VERIFIER);
  localStorage.removeItem(LS_STATE);
  cleanUrl();
  return true;
}

function _storeTokens(data) {
  if (!data?.access_token || !data?.refresh_token || !Number.isFinite(Number(data.expires_in))) {
    throw new Error("Resposta de autenticação do Trakt incompleta.");
  }
  localStorage.setItem(LS_TOKEN, data.access_token);
  localStorage.setItem(LS_REFRESH, data.refresh_token);
  localStorage.setItem(LS_EXPIRY, String(Date.now() + Number(data.expires_in) * 1000));
}

let _refreshPromise = null;
async function _refreshAccessToken() {
  if (_refreshPromise) return _refreshPromise;
  _refreshPromise = (async () => {
    const refreshToken = localStorage.getItem(LS_REFRESH);
    if (!refreshToken) {
      logout();
      throw new Error("A sessão Trakt expirou. Conecte sua conta novamente.");
    }
    const res = await fetch(`${TRAKT_API}/oauth/token`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ refresh_token: refreshToken, client_id: TRAKT_CLIENT_ID, grant_type: "refresh_token", redirect_uri: getRedirectUri() }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      if ([400, 401].includes(res.status)) logout();
      throw new Error(`Não foi possível renovar a sessão Trakt (HTTP ${res.status}).`);
    }
    _storeTokens(data);
    return data.access_token;
  })();
  try { return await _refreshPromise; }
  finally { _refreshPromise = null; }
}

/** Faz logout */
function logout() {
  localStorage.removeItem(LS_TOKEN);
  localStorage.removeItem(LS_REFRESH);
  localStorage.removeItem(LS_EXPIRY);
  localStorage.removeItem(LS_VERIFIER);
  localStorage.removeItem(LS_STATE);
}

/** Token ainda válido? */
function isAuthenticated() {
  const token = localStorage.getItem(LS_TOKEN);
  const refreshToken = localStorage.getItem(LS_REFRESH);
  const expiry = Number(localStorage.getItem(LS_EXPIRY) || 0);
  return !!token && (Date.now() < expiry || !!refreshToken);
}

/* =====================================================================
   CHAMADAS À API
   ===================================================================== */

async function _request(endpoint, { retryAuth = true, retry429 = true } = {}) {
  const headers = {
    "Content-Type": "application/json",
    "trakt-api-version": "2",
    "trakt-api-key": TRAKT_CLIENT_ID,
  };
  let token = localStorage.getItem(LS_TOKEN);
  const expiry = Number(localStorage.getItem(LS_EXPIRY) || 0);
  if ((token && expiry <= Date.now() + 60_000) || (!token && localStorage.getItem(LS_REFRESH))) {
    token = await _refreshAccessToken();
  }
  if (token) headers.Authorization = `Bearer ${token}`;

  const res = await fetch(`${TRAKT_API}${endpoint}`, { headers });
  if (res.status === 401 && token && retryAuth) {
    // Outra requisição pode já ter renovado o token em paralelo.
    if (localStorage.getItem(LS_TOKEN) === token) await _refreshAccessToken();
    return _request(endpoint, { retryAuth: false, retry429 });
  }
  if (res.status === 429 && retry429) {
    const retryAfter = res.headers.get("Retry-After") || "1";
    const seconds = Number(retryAfter);
    const delayMs = Number.isFinite(seconds)
      ? Math.max(1, seconds) * 1000
      : Math.max(1000, Date.parse(retryAfter) - Date.now());
    await new Promise(resolve => setTimeout(resolve, delayMs));
    return _request(endpoint, { retryAuth, retry429: false });
  }
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Trakt HTTP ${res.status}: ${endpoint}${body ? ` — ${body.slice(0, 180)}` : ""}`);
  }
  if (res.status === 204) return null;
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

  const keys = ["wMovies", "wlMovies", "cMovies", "wShows", "wlShows", "cShows"];
  const results = await Promise.allSettled(keys.map(key => _request(endpoints[key])));
  const failures = results.flatMap((result, index) => result.status === "rejected"
    ? [{ collection: keys[index], error: result.reason }] : []);
  if (failures.length) {
    const error = new Error(`Não foi possível carregar completamente o catálogo do Trakt (${failures.map(f => f.collection).join(", ")}).`);
    error.failures = failures;
    throw error;
  }
  return Object.fromEntries(keys.map((key, index) => [key, results[index].value]));
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
  const queue = items.filter(item => item?.tmdbId);

  let cursor = 0;

  function isValidImageUrl(url) {
    return (
      typeof url === "string" &&
      /^https:\/\/image\.tmdb\.org\/t\/p\//i.test(url)
    );
  }

  function hasValidImages(images) {
    return (
      images &&
      typeof images === "object" &&
      (
        isValidImageUrl(images.posterUrl) ||
        isValidImageUrl(images.backdropUrl)
      )
    );
  }

  async function worker() {
    while (cursor < queue.length) {
      const item = queue[cursor++];
      const kind = item.type === "movie" ? "movie" : "tv";
      const cacheKey = `tmdb_images_v3_${kind}_${item.tmdbId}`;

      const diagnostic = {
        titulo: item.title,
        tipo: kind,
        tmdbId: item.tmdbId,
        cache: "não consultado",
        worker: "não consultado",
        poster: false,
        banner: false
      };

      try {
        let images = await cacheGet(cacheKey);

        if (hasValidImages(images)) {
          diagnostic.cache = "válido";
        } else {
          diagnostic.cache = "ausente ou inválido";

          const response = await fetch(
            `${TMDB_WORKER_URL}/api/tmdb/${kind}/${encodeURIComponent(item.tmdbId)}`
          );

          if (!response.ok) {
            throw new Error(`Worker respondeu HTTP ${response.status}`);
          }

          images = await response.json();

          if (!hasValidImages(images)) {
            throw new Error("Worker retornou dados sem URLs de imagem válidas.");
          }

          await cacheSet(cacheKey, images);
          diagnostic.worker = "sucesso";
        }

        // Prioriza as imagens válidas do TMDB.
        if (isValidImageUrl(images.posterUrl)) {
          item.cover = images.posterUrl;
        }

        if (isValidImageUrl(images.backdropUrl)) {
          item.banner = images.backdropUrl;
        }

        diagnostic.poster = !!item.cover;
        diagnostic.banner = !!item.banner;

        console.log(`[TMDB] ${item.title}`, diagnostic);

      } catch (error) {
        diagnostic.worker = "erro";
        diagnostic.erro = error.message;

        console.error(`[TMDB] Falha em ${item.title}`, diagnostic, error);
      }
    }
  }

  const concurrency = Math.min(6, queue.length);

  await Promise.all(
    Array.from({ length: concurrency }, () => worker())
  );

  console.table(
    items.map(item => ({
      titulo: item.title,
      tipo: item.type,
      tmdbId: item.tmdbId,
      poster: !!item.cover,
      banner: !!item.banner
    }))
  );

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
