/* =====================================================================
   HUB DE FILMES & SÉRIES — Clpher
   hub.js — lógica principal (UI, abas, renderização, TMDB + Firebase)
   =====================================================================
   CONTROLE DE VERSÃO:
   Sempre que modificar este arquivo incremente HUB_VERSION em +1.
   ===================================================================== */
const HUB_VERSION = 21;
window.HUB_VERSION = HUB_VERSION;
document.getElementById("project-version").textContent = `v${HUB_VERSION}`;

/* ---------- Utilitários ---------- */
const $   = id => document.getElementById(id);
const esc = s => String(s ?? "").replace(/[&<>"]/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));
const bg  = u => u ? `style="background-image:url('${u}')"` : "";

/* ---------- Estado global ---------- */
let tab        = "agora";
let fbUser     = null;
const OWNER_UID = "X569uLFYFgcX6i9mbEVsylUX7Li1";
const isOwner   = () => Boolean(fbUser && fbUser.uid === OWNER_UID);
let movies     = [];   // catálogo de filmes
let shows      = [];   // catálogo de séries
let watching   = [];   // em andamento (filmes + séries)
let activeItem = null;
let modalRequestToken = 0; // item aberto no modal
let showSeasonsCache = new Map(); // cache das temporadas de séries
let tmdbSearchResults = [];
const TMDB_WORKER_URL = "https://hub-filmes-series.world-testaocenter790.workers.dev";

/* ---------- Tiers de nota (0–100) ---------- */
const TIERS = [
  [95, "Obra-prima",    "#f1c879"],
  [90, "Excelente",     "#ff7a4d"],
  [85, "Muito bom",     "#f5a63c"],
  [80, "Bom",           "#7ac36a"],
  [75, "Razoável",      "#4aa8e0"],
  [60, "Mediano",       "#98a2bd"],
  [0,  "Fraco",         "#c0453f"],
];
const tierFor = s => TIERS.find(t => s >= t[0]);
const badge   = s => {
  if (!s || s <= 0) return "";
  const t = tierFor(s);
  return `<span class="badge" style="--c:${t[2]}">${s}<small>${t[1]}</small></span>`;
};

/* =====================================================================
   RENDERIZAÇÃO DE VIEWS
   ===================================================================== */

/* ---- Hero dinâmico ---- */
function renderHero() {
  const pool = watching.filter(i => i.banner || i.cover);
  const best = [...movies, ...shows].filter(i => (i.banner || i.cover) && i.score >= 80);
  const list = pool.length ? pool : best.length ? best : [...movies, ...shows].filter(i => i.banner || i.cover);

  if (!list.length) {
    $("heroin").innerHTML = `<h1>Meu hub de<br>filmes &amp; séries</h1><p>Organize, acompanhe e avalie o que assiste.</p>`;
    return;
  }
  const item = list[Math.floor(Math.random() * list.length)];
  if (item.banner) {
    $("hero").style.backgroundImage = `url('${item.banner}')`;
  }
  const isWatching = item.status === "watching";
  $("heroin").innerHTML = `
    <small>${isWatching ? `Assistindo agora${item.progress ? ` — ep ${item.progress}` : ""}` : `Avaliado com ${item.score}/100`}</small>
    <h1>${esc(item.title)}</h1>
    <p>${item.year ?? ""}${item.type === "show" ? " · Série" : " · Filme"}</p>
    <button class="go" data-id="${item.id}" data-type="${item.type}">Ver detalhes</button>`;
}

/* ---- Aba "Agora" ---- */
function renderAgora() {
  const w = watching;
  if (!w.length) {
    $("view").innerHTML = `
      <h2>Assistindo agora</h2>
      <div class="msg">Nenhum título em andamento no momento. <a href="#" data-tab-link="filmes">Explore seus filmes</a> ou <a href="#" data-tab-link="series">suas séries</a>.</div>`;
    return;
  }
  $("view").innerHTML = `
    <h2>Assistindo agora <span class="meta">${w.length}</span></h2>
    <div class="wides">${w.map(wideCard).join("")}</div>`;
}

/* ---- Aba "Filmes" ---- */
function renderFilmes() {
  const list = filtered(movies);
  if (!list.length) {
    $("view").innerHTML = `<h2>Meus filmes</h2><div class="msg">Sua biblioteca de filmes está vazia. Use a seção Descobrir para encontrar títulos e adicioná-los à sua biblioteca.</div>`;
    return;
  }
  const byStatus = groupByStatus(list);
  $("view").innerHTML = Object.entries(byStatus)
    .filter(([, items]) => items.length)
    .map(([st, items]) => `
      <h2>${statusLabel(st)} <span class="meta">${items.length}</span></h2>
      <div class="grid">${items.map(posterCard).join("")}</div>`)
    .join("");
}

/* ---- Aba "Séries" ---- */
function renderSeries() {
  const list = filtered(shows);
  if (!list.length) {
    $("view").innerHTML = `<h2>Minhas séries</h2><div class="msg">Sua biblioteca de séries está vazia. Use a seção Descobrir para encontrar títulos e adicioná-los à sua biblioteca.</div>`;
    return;
  }
  const byStatus = groupByStatus(list);
  $("view").innerHTML = Object.entries(byStatus)
    .filter(([, items]) => items.length)
    .map(([st, items]) => `
      <h2>${statusLabel(st)} <span class="meta">${items.length}</span></h2>
      <div class="grid">${items.map(posterCard).join("")}</div>`)
    .join("");
}


/* ---- Descobrir: página inicial e categorias independentes ---- */
const DISCOVER_CATEGORIES = [
  {id:"trending", title:"Em alta esta semana", icon:"↗", path:"/api/tmdb/trending/all/week", type:"all"},
  {id:"popular-movies", title:"Filmes populares", icon:"▣", path:"/api/tmdb/discover/movie?sort_by=popularity.desc", type:"movie"},
  {id:"popular-tv", title:"Séries populares", icon:"▤", path:"/api/tmdb/discover/tv?sort_by=popularity.desc", type:"tv"},
  {id:"top-movies", title:"Filmes mais bem avaliados", icon:"★", path:"/api/tmdb/discover/movie?sort_by=vote_average.desc&vote_count.gte=500", type:"movie"},
  {id:"top-tv", title:"Séries mais bem avaliadas", icon:"☆", path:"/api/tmdb/discover/tv?sort_by=vote_average.desc&vote_count.gte=200", type:"tv"},
  {id:"upcoming", title:"Próximos lançamentos", icon:"◷", path:"/api/tmdb/discover/movie?sort_by=primary_release_date.asc&primary_release_date.gte="+new Date().toISOString().slice(0,10), type:"movie"}
];
let discoverView = "home";
let discoverPage = 1;
let discoverCache = new Map();
let discoverRenderToken = 0;
let searchPage = 1;
let searchQuery = "";
let searchType = "multi";
const DISCOVER_CACHE_TTL = 6 * 60 * 60 * 1000;
const SEARCH_CACHE_TTL = 30 * 60 * 1000;
function readApiCache(key, ttl) {
  try {
    const raw = localStorage.getItem(`hub_tmdb_${key}`);
    if (!raw) return null;
    const entry = JSON.parse(raw);
    if (!entry || Date.now() - entry.savedAt > ttl) { localStorage.removeItem(`hub_tmdb_${key}`); return null; }
    return entry.data;
  } catch { return null; }
}
function writeApiCache(key, data) {
  try { localStorage.setItem(`hub_tmdb_${key}`, JSON.stringify({ savedAt: Date.now(), data })); }
  catch (error) { console.warn("Cache local indisponível; usando apenas cache do Worker.", error); }
}
async function fetchCachedJson(url, cacheKey, ttl) {
  const cached = readApiCache(cacheKey, ttl);
  if (cached) return cached;
  const response = await fetch(url);
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
  writeApiCache(cacheKey, data);
  return data;
}
async function renderDiscover() {
  const view = $("view");
  const token = ++discoverRenderToken;
  if (discoverView === "home") {
    view.innerHTML = `<section class="discover-head"><span class="eyebrow">EXPLORE O UNIVERSO DO CINEMA</span><h2>Encontre sua próxima história.</h2><p>Escolha uma categoria ou pesquise diretamente no catálogo.</p>
      <form id="tmdb-search-form" class="catalog-search-form discover-search"><select id="tmdb-search-type" aria-label="Tipo de título"><option value="multi">Tudo</option><option value="movie">Filmes</option><option value="tv">Séries</option></select><input id="tmdb-search-input" type="search" minlength="2" placeholder="Qual título você procura?" autocomplete="off" required><button type="submit" id="tmdb-search-submit">Buscar</button></form><p class="search-hint" id="tmdb-search-status">Pesquise no TMDB ou escolha uma das coleções abaixo.</p><div class="search-result-actions" id="search-result-actions" hidden><button type="button" id="tmdb-search-clear" class="search-clear">Limpar pesquisa ×</button><div class="search-pagination" id="search-pagination"></div></div><div id="tmdb-search-results" class="tmdb-search-results"></div></section>
      <section class="discover-category-grid">${DISCOVER_CATEGORIES.map(c=>`<button class="discover-category" type="button" data-discover-category="${c.id}"><span>${c.icon}</span><strong>${esc(c.title)}</strong><small>Explorar coleção</small><b>→</b></button>`).join("")}</section>`;
    bindDiscoverSearch(); return;
  }
  const category = DISCOVER_CATEGORIES.find(c=>c.id===discoverView);
  if (!category) { discoverView="home"; return renderDiscover(); }
  view.innerHTML = `<div class="discover-category-top"><button type="button" class="text-back" data-discover-home>← Todas as categorias</button><span class="eyebrow">DESCOBRIR</span><h2>${esc(category.title)}</h2><p>Explore títulos selecionados pelo catálogo do TMDB.</p></div><div id="discover-results" class="discover-grid discover-grid-large"><div class="msg">Carregando títulos…</div></div><div class="discover-pagination"><button type="button" data-discover-page="prev" ${discoverPage<=1?"disabled":""}>← Anterior</button><span>Página ${discoverPage}</span><button type="button" data-discover-page="next">Próxima →</button></div>`;
  const key=`${discoverView}:${discoverPage}`;
  try {
    let data=discoverCache.get(key);
    if(!data){const url=new URL(`${TMDB_WORKER_URL}${category.path}`,location.href);url.searchParams.set("page",discoverPage);data=await fetchCachedJson(url.toString(),`discover_${key}`,DISCOVER_CACHE_TTL);discoverCache.set(key,data);}
    if(token!==discoverRenderToken || tab!=="descobrir" || discoverView!==category.id) return;
    const target=$("discover-results");
    if(target) target.innerHTML=(data.results||[]).map(discoverCard).join("")||`<div class="msg">Nenhum título encontrado.</div>`;
  } catch(e){if(token===discoverRenderToken){const target=$("discover-results");if(target)target.innerHTML=`<div class="msg err">Não foi possível carregar esta coleção: ${esc(e.message)}.</div><button type="button" class="discover-retry" data-discover-retry>Tentar novamente</button>`;}}
}
function discoverCard(item) {
  const type=item.mediaType==="tv"?"show":"movie", exists=[...movies,...shows].some(x=>x.type===type&&String(x.id)===String(item.id));
  const poster=item.posterUrl?`<img src="${esc(item.posterUrl)}" alt="Pôster de ${esc(item.title)}" loading="lazy">`:`<div class="discover-no-poster">Sem pôster</div>`;
  return `<article class="discover-card" tabindex="0" aria-label="Ver detalhes de ${esc(item.title)}" data-preview-id="${esc(item.id)}" data-preview-type="${item.mediaType}">${poster}<div class="discover-card-info"><strong>${esc(item.title)}</strong><span>${item.year||"Ano desconhecido"} · ${type==="show"?"Série":"Filme"}</span><span class="discover-rating">★ ${Number(item.voteAverage||0).toFixed(1)}</span><button type="button" data-add-tmdb="${esc(item.id)}" data-media-type="${item.mediaType}" ${exists||!fbUser?"disabled":""}>${exists?"Na biblioteca":fbUser?"+ Adicionar":"Entre para adicionar"}</button></div></article>`;
}
function renderSearchPagination(totalPages=1) {
  const holder=$("search-pagination");
  if(!holder) return;
  holder.innerHTML = `<button type="button" data-search-page="prev" ${searchPage<=1?"disabled":""}>← Anterior</button><span>Página ${searchPage} de ${Math.max(1,totalPages)}</span><button type="button" data-search-page="next" ${searchPage>=totalPages?"disabled":""}>Próxima →</button>`;
}
async function runDiscoverSearch(page=1) {
  const status=$("tmdb-search-status"), out=$("tmdb-search-results"), submit=$("tmdb-search-submit");
  if(!status||!out) return;
  searchPage=page; searchQuery=$("tmdb-search-input")?.value.trim()||searchQuery; searchType=$("tmdb-search-type")?.value||searchType;
  if(searchQuery.length<2){status.textContent="Digite pelo menos 2 caracteres.";return;}
  status.textContent="Buscando no TMDB…"; out.innerHTML=""; if(submit)submit.disabled=true;
  const actions=$("search-result-actions"); if(actions)actions.hidden=false;
  try {
    const url=`${TMDB_WORKER_URL}/api/tmdb/search/${searchType}?query=${encodeURIComponent(searchQuery)}&page=${searchPage}`;
    const cacheKey=`search_${searchType}_${searchQuery.toLocaleLowerCase()}_${searchPage}`;
    const data=await fetchCachedJson(url,cacheKey,SEARCH_CACHE_TTL);
    tmdbSearchResults=data.results||[];
    status.textContent=tmdbSearchResults.length?`${data.total_results||tmdbSearchResults.length} resultado(s) encontrados.`:"Nenhum resultado encontrado.";
    out.innerHTML=tmdbSearchResults.slice(0,20).map(discoverCard).join("")||`<div class="msg">Nenhum resultado nesta página.</div>`;
    renderSearchPagination(Math.min(20,Number(data.total_pages)||1));
  } catch(err){status.textContent=`Não foi possível pesquisar: ${err.message}`;}
  finally{if(submit)submit.disabled=false;}
}
function bindDiscoverSearch(){
  $("tmdb-search-form")?.addEventListener("submit",async e=>{e.preventDefault();searchPage=1;await runDiscoverSearch(1);});
  $("tmdb-search-clear")?.addEventListener("click",()=>{
    const input=$("tmdb-search-input"), status=$("tmdb-search-status"), out=$("tmdb-search-results"), actions=$("search-result-actions");
    if(input)input.value=""; if(out)out.innerHTML=""; if(actions)actions.hidden=true;
    if(status)status.textContent="Pesquise no TMDB ou escolha uma das coleções abaixo.";
    searchQuery="";searchPage=1;tmdbSearchResults=[];input?.focus();
  });
}
async function openTmdbPreview(id, mediaType){
  const type=mediaType==="tv"?"show":"movie";
  const existing=(type==="movie"?movies:shows).find(x=>String(x.id)===String(id));
  if(existing) return openItem(id,type);
  try{const r=await fetch(`${TMDB_WORKER_URL}/api/tmdb/${mediaType}/${id}`);if(!r.ok)throw new Error("Não foi possível carregar os detalhes.");const d=await r.json();await openItem(id,type,d);}catch(e){alert(e.message);}
}

/* ---- Aba "Estatísticas" ---- */
function renderStats() {
  const total   = movies.length + shows.length;
  const done    = [...movies, ...shows].filter(i => i.status === "completed").length;
  const rated   = [...movies, ...shows].filter(i => i.score > 0);
  const avg     = rated.length ? (rated.reduce((s, i) => s + i.score, 0) / rated.length).toFixed(1) : "—";

  $("view").innerHTML = `
    <div class="stats-grid">
      <article class="stat-card"><small>Total no catálogo</small><strong>${total}</strong><span>Filmes e séries</span></article>
      <article class="stat-card"><small>Concluídos</small><strong>${done}</strong><span>Histórias finalizadas</span></article>
      <article class="stat-card"><small>Assistindo agora</small><strong>${watching.length}</strong><span>Em andamento</span></article>
      <article class="stat-card" style="border-color:#ff916b45;background:linear-gradient(145deg,#292033,#151827)"><small>Nota média pessoal</small><strong>${avg}<span style="font:400 .85rem var(--sans);display:inline"> /100</span></strong><span>${rated.length} títulos avaliados</span></article>
    </div>
    <div class="stats-columns">
      <div class="stats-panel">
        <h3>Distribuição por status</h3>
        ${statBars([
          ["Concluídos",     [...movies, ...shows].filter(i => i.status === "completed").length],
          ["Assistindo",     watching.length],
          ["Quero assistir", [...movies, ...shows].filter(i => i.status === "plantowatch").length],
          ["Pausados",       [...movies, ...shows].filter(i => i.status === "paused").length],
          ["Abandonados",    [...movies, ...shows].filter(i => i.status === "dropped").length],
        ], total)}
      </div>
      <div class="stats-panel">
        <h3>Filmes vs. Séries</h3>
        ${statBars([["Filmes", movies.length], ["Séries", shows.length]], total)}
      </div>
    </div>`;
}

/* =====================================================================
   COMPONENTES DE CARD
   ===================================================================== */

const posterCard = item => {
  const pct = item.eps ? Math.min(100, (item.progress || 0) / item.eps * 100) : 0;
  const imgContent = item.cover
    ? `<img src="${esc(item.cover)}" alt="" loading="lazy">`
    : `<div class="poster-fallback"><span class="fallback-icon">${item.type === "movie" ? "🎬" : "📺"}</span><b>${esc(item.title)}</b></div>`;

  return `<button class="poster" data-id="${item.id}" data-type="${item.type}">
    ${imgContent}
    <div class="cap">
      <b>${esc(item.title)}</b>
      ${item.status === "watching"
        ? `<div class="pb"><i style="width:${pct}%"></i></div><span>ep ${item.progress ?? "?"}${item.eps ? " / " + item.eps : ""}</span>`
        : `<span>${item.year ?? ""}${item.score ? " · " + item.score : ""}</span>`}
    </div>
  </button>`;
};

const wideCard = item => {
  const pct = item.eps ? Math.min(100, (item.progress || 0) / item.eps * 100) : 0;
  const imgContent = item.cover
    ? `<img src="${esc(item.cover)}" alt="">`
    : `<div style="width:86px;aspect-ratio:2/3;border-radius:9px;background:#131a2c;display:flex;align-items:center;justify-content:center;font-size:1.6rem">${item.type === "movie" ? "🎬" : "📺"}</div>`;

  return `<button class="wide" data-id="${item.id}" data-type="${item.type}" ${bg(item.banner)}>
    ${imgContent}
    <div>
      <b>${esc(item.title)}</b>
      <div class="meta">${item.year ?? ""}${item.type === "show" ? " · Série" : " · Filme"} ${item.score ? " · " + badge(item.score) : ""}</div>
      ${item.eps ? `<div class="pb"><i style="width:${pct}%"></i></div>
      <span class="meta">ep ${item.progress ?? "?"}${item.eps ? " / " + item.eps : ""}</span>` : ""}
    </div>
  </button>`;
};

/* =====================================================================
   MODAL DE DETALHES EXPANDIDO
   - Filmes: Nota 0-100, Status, Sinopse e Diário
   - Séries: Nota Geral, Notas por Temporada, Episódios marcáveis e Diário
   ===================================================================== */

async function openItem(id, type, previewData = null) {
  const requestToken = ++modalRequestToken;
  const d = $("dlg");
  // Abra imediatamente: a busca de metadados/notas não deve bloquear a interação.
  d.innerHTML = `<div class="msg modal-loading"><span class="loading-spinner"></span> Abrindo detalhes…</div>`;
  if (!d.open) d.showModal();
  const item = (type === "movie" ? movies : shows).find(i => String(i.id) === String(id)) || (previewData ? { ...previewData, id:String(id), type, title:previewData.title || "Sem título", cover:previewData.posterUrl, banner:previewData.backdropUrl, status:"plantowatch", score:0 } : null);
  if (!item) return;
  const inCatalog = (type === "movie" ? movies : shows).some(i => String(i.id) === String(id));
  activeItem = item;
  const isShow = type === "show";
  // Atualiza metadados antigos com a ficha técnica mais completa do TMDB.
  if (!item.cast?.length || !item.genres?.length) {
    try {
      const mediaType = isShow ? "tv" : "movie";
      const response = await fetch(`${TMDB_WORKER_URL}/api/tmdb/${mediaType}/${encodeURIComponent(id)}`);
      if (response.ok) {
        const fresh = await response.json();
        Object.assign(item, fresh, { cover:fresh.posterUrl || item.cover, banner:fresh.backdropUrl || item.banner });
        if (inCatalog && window.hubFB && fbUser) await hubFB.saveItemNote(id, type, fresh);
      }
    } catch (error) { console.warn("Não foi possível atualizar a ficha do TMDB", error); }
  }

  if (requestToken !== modalRequestToken) return;
  let note = {};
  if (window.hubFB) {
    try { note = await hubFB.getItemNote(id, type); } catch (e) {}
  }
  if (requestToken !== modalRequestToken) return;
  const currentStatus = note.status || item.status || "plantowatch";
  const currentScore  = isShow ? (note.scoreOverall ?? item.score ?? 0) : (note.score ?? item.score ?? 0);

  const statusOptions = [
    ["plantowatch", "Quero assistir"],
    ["watching",    "Assistindo"],
    ["completed",   "Concluído"],
    ["paused",      "Pausado"],
    ["dropped",     "Abandonado"],
  ];

  d.innerHTML = `
    <div class="dh" ${bg(item.banner || item.cover)}>
      <button class="dx" onclick="document.getElementById('dlg').close()">Fechar</button>
      <h2>${esc(item.title)}</h2>
      <div class="modal-top-meta">
        <span>${item.year ?? ""}${isShow ? " · Série" : " · Filme"}</span>
        ${inCatalog && fbUser ? `<div class="status-dropdown" id="status-dropdown">
          <select class="quick-status-select status-native-select" id="modal-status-select" tabindex="-1" aria-hidden="true">
            ${statusOptions.map(([val, label]) => `<option value="${val}" ${currentStatus === val ? "selected" : ""}>${label}</option>`).join("")}
          </select>
          <button class="status-dropdown-trigger" id="status-dropdown-trigger" type="button" aria-haspopup="listbox" aria-expanded="false" aria-controls="status-dropdown-menu"><span id="status-dropdown-label">${statusOptions.find(([val]) => val === currentStatus)?.[1] || "Quero assistir"}</span><svg class="status-chevron" viewBox="0 0 20 20" aria-hidden="true" focusable="false"><path d="m5.5 7.5 4.5 4.5 4.5-4.5" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg></button>
          <div class="status-dropdown-menu" id="status-dropdown-menu" role="listbox" aria-label="Status do título" aria-hidden="true">${statusOptions.map(([val, label]) => `<button type="button" class="status-dropdown-option${currentStatus === val ? " is-selected" : ""}" role="option" aria-selected="${currentStatus === val}" data-status-value="${val}">${label}</button>`).join("")}</div>
        </div>` : inCatalog ? `<span class="catalog-source-label">${statusOptions.find(([val]) => val === currentStatus)?.[1] || "Quero assistir"}</span>` : `<span class="catalog-source-label">Catálogo TMDB</span>`}
        <span id="header-score-badge">${badge(currentScore)}</span>
        · <span>TMDB</span>
      </div>
    </div>
    <div class="db">
      <div class="detail-tabs">
        <button type="button" data-detail-tab="info" aria-selected="true">${isShow ? "Temporadas &amp; Avaliação" : "Avaliação &amp; Info"}</button>
        ${inCatalog ? `<button type="button" data-detail-tab="experiences" aria-selected="false">Minhas experiências</button><button type="button" data-detail-tab="diary" aria-selected="false">Diário</button>` : ""}
      </div>

      <!-- Seção: Informações e Avaliação -->
      <section id="detail-info">
        <div class="score-box score-box-primary">
          <label for="input-item-score"><strong>${isShow ? "Nota Geral da Série" : "Sua Avaliação"} (0 a 100):</strong></label>
          <input type="number" id="input-item-score" min="0" max="100" value="${currentScore > 0 ? currentScore : ""}" placeholder="0–100" ${(!inCatalog || !fbUser) ? "disabled" : ""}>
          <button type="button" id="btn-save-score" ${(!inCatalog || !fbUser) ? "disabled" : ""}>Salvar Nota</button>
          <span class="meta" id="score-status"></span>
        </div>
        <div class="detail-facts">
          ${item.genres?.length ? `<div><small>GÊNEROS</small><strong>${esc(item.genres.join(" · "))}</strong></div>` : ""}
          ${item.runtime ? `<div><small>DURAÇÃO</small><strong>${item.runtime} min</strong></div>` : ""}
          ${isShow && item.numberOfSeasons ? `<div><small>TEMPORADAS</small><strong>${item.numberOfSeasons}</strong></div>` : ""}
          ${isShow && item.numberOfEpisodes ? `<div><small>EPISÓDIOS</small><strong>${item.numberOfEpisodes}</strong></div>` : ""}
          ${item.voteAverage ? `<div><small>NOTA TMDB</small><strong>★ ${Number(item.voteAverage).toFixed(1)} / 10</strong></div>` : ""}
          ${item.originalTitle ? `<div><small>TÍTULO ORIGINAL</small><strong>${esc(item.originalTitle)}</strong></div>` : ""}
          ${item.statusText ? `<div><small>SITUAÇÃO</small><strong>${esc(item.statusText)}</strong></div>` : ""}
          ${item.networks?.length ? `<div><small>EMISSORAS</small><strong>${esc(item.networks.join(" · "))}</strong></div>` : ""}
          ${item.productionCountries?.length ? `<div><small>PAÍS DE ORIGEM</small><strong>${esc(item.productionCountries.join(" · "))}</strong></div>` : ""}
          ${item.originalLanguage ? `<div><small>IDIOMA ORIGINAL</small><strong>${esc(item.originalLanguage.toUpperCase())}</strong></div>` : ""}
          ${item.crew?.length ? `<div><small>${isShow ? "PRODUÇÃO" : "DIREÇÃO"}</small><strong>${esc(item.crew.join(" · "))}</strong></div>` : ""}
        </div>
        <p class="diary-intro detail-overview">${esc(item.overview || "Sem sinopse disponível.")}</p>
        ${item.cast?.length ? `<div class="detail-cast"><h3>Elenco principal</h3><p>${esc(item.cast.join(" · "))}</p></div>` : ""}
        ${inCatalog && isOwner() ? `<button type="button" class="remove-catalog-btn" id="btn-remove-catalog">Remover da minha biblioteca</button>` : !inCatalog ? `<button type="button" class="tmdb-add-btn" id="btn-add-preview" ${!fbUser?"disabled":""}>${fbUser?"Adicionar à minha biblioteca":"Entre para adicionar"}</button>` : ""}
        ${isShow && inCatalog ? `<div id="series-seasons-container"><div class="msg">Carregando temporadas e episódios…</div></div>` : ""}
      </section>

      <!-- Seção: Minhas experiências -->
      <section id="detail-experiences" class="hidden">
        <div id="experiences-content" class="msg">Carregando experiências…</div>
      </section>

      <!-- Seção: Diário -->
      <section id="detail-diary" class="hidden">
        <div id="diary-content" class="msg">Carregando diário…</div>
      </section>
    </div>`;

  d.showModal();
  $("btn-remove-catalog")?.addEventListener("click", async () => {
    if (!isOwner()) { alert("Somente o proprietário pode remover títulos da biblioteca."); return; }
    if (!confirm(`Remover “${item.title}” da sua biblioteca? Os registros do diário serão preservados.`)) return;
    try { await hubFB.removeCatalogItem(id,type); await loadCatalog(); d.close(); }
    catch(err) { alert(`Não foi possível remover: ${err.code || err.message}`); }
  });
  $("btn-add-preview")?.addEventListener("click", async () => {
    if (!fbUser) return;
    try { await hubFB.addCatalogItem({ ...previewData, status:"plantowatch" }); await loadCatalog(); d.close(); }
    catch(err) { alert(`Não foi possível adicionar: ${err.code || err.message}`); }
  });

  // Dropdown customizado de status; o select oculto preserva o valor e a integração existentes.
  const statusDropdown = $("status-dropdown");
  const statusTrigger = $("status-dropdown-trigger");
  const statusMenu = $("status-dropdown-menu");
  const statusSelect = $("modal-status-select");

  const closeStatusMenu = () => {
    statusDropdown?.classList.remove("is-open");
    statusTrigger?.setAttribute("aria-expanded", "false");
    statusMenu?.setAttribute("aria-hidden", "true");
  };

  statusTrigger?.addEventListener("click", () => {
    const opening = !statusDropdown.classList.contains("is-open");
    statusDropdown.classList.toggle("is-open", opening);
    statusTrigger.setAttribute("aria-expanded", String(opening));
    statusMenu.setAttribute("aria-hidden", String(!opening));
  });

  statusDropdown?.querySelectorAll("[data-status-value]").forEach(option => {
    option.addEventListener("click", () => {
      statusSelect.value = option.dataset.statusValue;
      $("status-dropdown-label").textContent = option.textContent.trim();
      statusDropdown.querySelectorAll("[data-status-value]").forEach(button => {
        const selected = button === option;
        button.classList.toggle("is-selected", selected);
        button.setAttribute("aria-selected", String(selected));
      });
      closeStatusMenu();
      statusSelect.dispatchEvent(new Event("change", { bubbles: true }));
      statusTrigger.focus();
    });
  });

  statusDropdown?.addEventListener("keydown", e => {
    if (e.key === "Escape") {
      closeStatusMenu();
      statusTrigger?.focus();
    }
  });

  // Evento: Alterar status imediatamente
  statusSelect?.addEventListener("change", async e => {
    const newStatus = e.target.value;
    item.status = newStatus;
    if (window.hubFB && fbUser && inCatalog) {
      try { await hubFB.saveItemNote(id, type, { status: newStatus }); } catch (err) {}
    }
    watching = [...movies, ...shows].filter(i => i.status === "watching");
    render();
  });

  // Evento: Salvar Nota Geral
  $("btn-save-score")?.addEventListener("click", async () => {
    const rawVal = $("input-item-score").value.trim();
    const scoreVal = rawVal === "" ? 0 : Math.min(100, Math.max(0, Number(rawVal)));
    const statusEl = $("score-status");
    statusEl.textContent = "Salvando…";

    try {
      if (isShow) {
        item.score = scoreVal;
        if (window.hubFB && fbUser && inCatalog) await hubFB.saveItemNote(id, type, { scoreOverall: scoreVal });
      } else {
        item.score = scoreVal;
        if (window.hubFB && fbUser && inCatalog) await hubFB.saveItemNote(id, type, { score: scoreVal });
      }
      $("header-score-badge").innerHTML = badge(scoreVal);
      statusEl.textContent = "Nota salva!";
      render();
    } catch (err) {
      statusEl.textContent = "Erro ao salvar: " + (err.code || err.message);
    }
  });

  // Se for série, carrega temporadas e episódios
  if (isShow && inCatalog) {
    loadSeriesSeasons(id, note);
  }

  // O diário pertence à biblioteca pessoal; prévias do TMDB não carregam registros.
  if (inCatalog) loadDiary(id, type);
}

/* ---- Carrega temporadas e episódios de série ---- */
async function loadSeriesSeasons(showId, savedNote) {
  const container = $("series-seasons-container");
  if (!container) return;

  try {
    let seasonsData = showSeasonsCache.get(showId);
    if (!seasonsData) {
      const response = await fetch(`${TMDB_WORKER_URL}/api/tmdb/tv/${encodeURIComponent(showId)}`);
      if (!response.ok) throw new Error(`TMDB respondeu com HTTP ${response.status}`);
      const detail = await response.json();
      const seasons = detail.seasons || [];
      seasonsData = await Promise.all(seasons.map(async season => {
        const result = await fetch(`${TMDB_WORKER_URL}/api/tmdb/tv/${encodeURIComponent(showId)}/season/${season.seasonNumber}`);
        if (!result.ok) throw new Error(`Não foi possível carregar a temporada ${season.seasonNumber}.`);
        const data = await result.json();
        return { number: data.seasonNumber, name: data.name, episode_count: data.episodes?.length || season.episodeCount || 0,
          episodes: (data.episodes || []).map(ep => ({ number: ep.number, name: ep.name, overview: ep.overview, stillUrl: ep.stillUrl })) };
      }));
      showSeasonsCache.set(showId, seasonsData);
    }
    if (!seasonsData || !seasonsData.length) {
      container.innerHTML = `<div class="msg">Informações de temporadas indisponíveis no momento.</div>`;
      return;
    }

    // Filtra temporada 0 (especiais) se vazia, foca em temporadas regulares
    const regularSeasons = seasonsData.filter(s => s.number > 0);
    const seasonsList = regularSeasons.length ? regularSeasons : seasonsData;

    // Recupera dados salvos do Firebase sobre temporadas
    const savedSeasons = savedNote?.seasons || {};

    container.innerHTML = `
      <h3 style="font:600 1.25rem var(--serif);margin:20px 0 10px">Temporadas &amp; Episódios</h3>
      <div class="seasons-accordion">
        ${seasonsList.map(s => {
          const sNum = String(s.number);
          const sSaved = savedSeasons[sNum] || {};
          const watchedEps = new Set(sSaved.watchedEpisodes || []);
          const totalEps = s.episode_count || s.episodes?.length || 0;
          const watchedCount = watchedEps.size;
          const pct = totalEps ? Math.round((watchedCount / totalEps) * 100) : 0;
          const isFinished = totalEps > 0 && watchedCount >= totalEps;
          const sScore = sSaved.score || 0;

          return `
            <div class="season-block" data-season="${sNum}">
              <div class="season-header" data-toggle-season="${sNum}">
                <div>
                  <strong>Temporada ${sNum}</strong>
                  ${sScore > 0 ? ` · ${badge(sScore)}` : ""}
                </div>
                <div class="season-header-meta">
                  <span>${watchedCount} / ${totalEps} eps (${pct}%)</span>
                  <div class="season-progress-bar"><i style="width:${pct}%"></i></div>
                </div>
              </div>

              <!-- Sugestão opcional de nota ao concluir temporada -->
              ${isFinished && fbUser ? `
                <div class="season-score-prompt">
                  <strong>🎉 Temporada ${sNum} concluída!</strong>
                  <div style="display:flex;gap:8px;align-items:center;margin-top:6px;flex-wrap:wrap">
                    <span>Avalie esta temporada (opcional):</span>
                    <input type="number" min="0" max="100" class="season-score-input" value="${sScore > 0 ? sScore : ""}" placeholder="0–100" style="width:70px;background:#090c16;border:1px solid rgba(255,145,107,.4);border-radius:7px;padding:4px 7px;color:#fff">
                    <button type="button" class="btn-save-season-score" data-season="${sNum}" style="background:var(--sun);color:#1a0d08;border:0;border-radius:99px;padding:4px 12px;font-weight:600;font-size:.8rem">Salvar</button>
                    <span class="meta status-season-${sNum}"></span>
                  </div>
                </div>` : ""}

              <div class="episodes-grid" id="episodes-season-${sNum}">
                ${(s.episodes || Array.from({ length: totalEps }, (_, i) => ({ number: i + 1 }))).map(ep => {
                  const epNum = ep.number;
                  const isWatched = watchedEps.has(epNum);
                  return `<button type="button" class="ep-btn ${isWatched ? "watched" : ""}" ${!fbUser ? "disabled" : ""} data-season="${sNum}" data-ep="${epNum}" title="Episódio ${epNum}">E${epNum}</button>`;
                }).join("")}
              </div>
            </div>`;
        }).join("")}
      </div>`;

    // Eventos: Marcar/Desmarcar episódio ao clicar
    container.querySelectorAll(".ep-btn").forEach(btn => {
      btn.addEventListener("click", async () => {
        const sNum  = btn.dataset.season;
        const epNum = Number(btn.dataset.ep);
        const sSaved = savedSeasons[sNum] = savedSeasons[sNum] || { watchedEpisodes: [] };
        const watchedSet = new Set(sSaved.watchedEpisodes || []);

        if (watchedSet.has(epNum)) {
          watchedSet.delete(epNum);
          btn.classList.remove("watched");
        } else {
          watchedSet.add(epNum);
          btn.classList.add("watched");
        }
        sSaved.watchedEpisodes = [...watchedSet];

        if (window.hubFB && fbUser) {
          try {
            await hubFB.saveItemNote(showId, "show", { seasons: savedSeasons });
          } catch (err) {
            console.warn("Erro ao salvar episódio:", err);
          }
        }
        // Atualiza contadores visuais da temporada
        const seasonBlock = btn.closest(".season-block");
        const totalEps = seasonBlock.querySelectorAll(".ep-btn").length;
        const count = watchedSet.size;
        const pct = totalEps ? Math.round((count / totalEps) * 100) : 0;
        const metaSpan = seasonBlock.querySelector(".season-header-meta span");
        const barI = seasonBlock.querySelector(".season-progress-bar i");
        if (metaSpan) metaSpan.textContent = `${count} / ${totalEps} eps (${pct}%)`;
        if (barI) barI.style.width = `${pct}%`;
      });
    });

    // Eventos: Salvar nota de temporada
    container.querySelectorAll(".btn-save-season-score").forEach(btn => {
      btn.addEventListener("click", async () => {
        const sNum = btn.dataset.season;
        const prompt = btn.closest(".season-score-prompt");
        const input = prompt.querySelector(".season-score-input");
        const statusEl = prompt.querySelector(`.status-season-${sNum}`);
        const scoreVal = Math.min(100, Math.max(0, Number(input.value) || 0));

        statusEl.textContent = "Salvando…";
        savedSeasons[sNum] = savedSeasons[sNum] || {};
        savedSeasons[sNum].score = scoreVal;

        if (window.hubFB && fbUser) {
          try {
            await hubFB.saveItemNote(showId, "show", { seasons: savedSeasons });
            statusEl.textContent = "Salvo!";
          } catch (err) {
            statusEl.textContent = "Erro: " + (err.message || err.code);
          }
        }
      });
    });

  } catch (e) {
    container.innerHTML = `<div class="msg err">Não foi possível carregar as temporadas (${esc(e.message)}).</div>`;
  }
}

/* =====================================================================
   DIÁRIO DE EPISÓDIOS / SESSÕES
   ===================================================================== */

function localDateISO() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
}

function diaryDate(value) {
  if (!value) return "Data não informada";
  const d = new Date(value + "T12:00:00");
  return Number.isNaN(d.getTime()) ? value : d.toLocaleDateString("pt-BR");
}

function renderDiaryEntries(id, type, logs) {
  const editable = !!fbUser, isShow = type === "show";
  const journeys = logs.filter(x => x.recordType === "journey").sort((a,b)=>(b.createdAtMs||0)-(a.createdAtMs||0));
  const diaryLogs = logs.filter(x => x.recordType !== "journey");
  const active = journeys.filter(j => j.status === "in_progress");
  const paused = journeys.filter(j => j.status === "paused");
  const label = j => `Experiência ${String(journeys.length - journeys.findIndex(x=>x.id===j.id)).padStart(2,"0")}`;
  const statusText = {in_progress:"Em andamento",paused:"Pausada",completed:"Concluída",abandoned:"Abandonada"};
  const kindText = j => j.journeyType === "first" ? "Primeira experiência" : j.journeyType === "retry" ? "Nova tentativa" : "Reassistida";
  const overall = active.length ? "watching" : journeys[0]?.status === "paused" ? "paused" : journeys[0]?.status === "abandoned" ? "dropped" : journeys[0]?.status === "completed" ? "completed" : "plantowatch";
  if (journeys.length && editable) {
    const sel = $("modal-status-select"), trigger = $("status-dropdown-trigger");
    const labels = {watching:"Assistindo",paused:"Pausado",dropped:"Abandonado",completed:"Concluído",plantowatch:"Quero assistir"};
    if (sel) { sel.value = overall; sel.disabled = true; }
    if (trigger) { trigger.disabled = true; trigger.title = "Status atualizado automaticamente pelas experiências"; }
    if ($("status-dropdown-label")) $("status-dropdown-label").textContent = labels[overall];
  }
  $("diary-content").className = "";
  const journeyPanel = editable ? `
    <section class="journey-panel">
      <div class="journey-panel-head"><div><h3>Minhas experiências</h3><p class="diary-intro">Gerencie separadamente o status, a nota, as datas e o progresso de cada experiência.</p></div>
      <button type="button" id="btn-new-journey" ${active.length ? "disabled title=\"Já existe uma experiência em andamento\"" : ""}>+ Iniciar nova experiência</button></div>
      ${active.length ? `<p class="journey-notice">Já existe uma experiência em andamento nesta obra. Pause, conclua ou abandone-a antes de iniciar outra.</p>` : paused.length ? `<p class="journey-notice">Você tem uma experiência pausada. É possível retomá-la ou iniciar uma nova tentativa.</p>` : ""}
      <div class="journey-list">${journeys.length ? journeys.map(j=>`<article class="journey-card">
        <div class="diary-entry-head"><strong>${label(j)}</strong><span class="meta">${statusText[j.status]||"Não definido"}</span></div>
        <small>${kindText(j)}${j.startedAt?` · Início: ${diaryDate(j.startedAt)}`:" · Data de início não informada"}${j.endedAt?` · Término: ${diaryDate(j.endedAt)}`:""}</small>
        <div class="journey-card-meta">${isShow && (j.progressSeason||j.progressEpisode)?`<span>Temporada ${j.progressSeason||"—"} · Episódio ${j.progressEpisode||"—"}</span>`:""}<span>${Number(j.score)>0?`Nota ${j.score}/100`:"Sem nota individual"}</span></div>
        <div class="diary-actions"><button type="button" data-edit-journey="${esc(j.id)}">Editar experiência</button>
        ${j.status==="in_progress"?`<button type="button" data-journey-status="paused" data-journey-id="${esc(j.id)}">Pausar</button><button type="button" data-journey-status="completed" data-journey-id="${esc(j.id)}">Concluir</button><button type="button" data-journey-status="abandoned" data-journey-id="${esc(j.id)}">Abandonar</button>`:j.status==="paused"?`<button type="button" data-journey-status="in_progress" data-journey-id="${esc(j.id)}" ${active.length?"disabled":""}>Retomar</button>`:""}</div>
      </article>`).join(""):`<div class="msg">Você ainda não iniciou nenhuma experiência com esta obra.</div>`}</div>
      <dialog class="journey-edit-dialog" id="journey-edit-dialog"><form id="journey-edit-form" class="journey-edit-form">
        <div class="journey-edit-head"><div><h3>Editar experiência</h3><p class="diary-intro">As alterações afetam somente esta experiência.</p></div><button type="button" id="journey-edit-close" class="journey-edit-close">×</button></div>
        <input type="hidden" name="journeyId"><div class="journey-edit-grid">
          <label>Status<select name="status"><option value="in_progress">Em andamento</option><option value="paused">Pausada</option><option value="completed">Concluída</option><option value="abandoned">Abandonada</option></select></label>
          <label>Nota individual (0–100)<input name="score" type="number" min="0" max="100" step="1" placeholder="Não avaliada"></label>
          <label>Data de início<input name="startedAt" type="date"></label><label>Data de conclusão<input name="endedAt" type="date"></label>
          ${isShow?`<label>Temporada atual<input name="progressSeason" type="number" min="0" step="1"></label><label>Episódio atual<input name="progressEpisode" type="number" min="0" step="1"></label>`:""}
          <label class="journey-edit-wide">Observações desta experiência<textarea name="notes" rows="4" maxlength="10000" placeholder="Anotações sobre esta jornada…"></textarea></label>
        </div><div class="journey-edit-footer"><span id="journey-edit-status" class="diary-status" role="status"></span><button type="button" id="journey-edit-cancel">Cancelar</button><button type="submit" class="journey-save-btn">Salvar alterações</button></div>
      </form></dialog>
    </section>` : `<section class="journey-panel"><h3>Minhas experiências</h3><div class="journey-list">${journeys.map(j=>`<article class="journey-card"><strong>${label(j)}</strong><small>${statusText[j.status]||j.status||""}</small></article>`).join("")}</div></section>`;
  const form = editable ? `<p class="diary-intro">Registre suas impressões ${isShow?"episódio por episódio":"sobre o filme"}.</p><form class="diary-form" id="diary-form">
    <div class="wide-field"><label for="diary-journey">Experiência</label><select id="diary-journey" required>${active.map(j=>`<option value="${esc(j.id)}">${label(j)}</option>`).join("")}</select>${active.length?"":`<small>Inicie ou retome uma experiência em “Minhas experiências” para adicionar registros vinculados.</small>`}</div>
    ${isShow?`<div><label for="diary-episode">Episódio</label><input id="diary-episode" type="number" min="0" step="1" value="1" required></div>`:""}
    <div><label for="diary-date">Data</label><input id="diary-date" type="date" value="${localDateISO()}"><label style="display:flex;align-items:center;gap:7px;margin-top:8px"><input id="diary-forgot" type="checkbox" style="width:auto"> Esqueci a data</label></div>
    <div class="wide-field"><label for="diary-comment">Seu comentário</label><textarea id="diary-comment" maxlength="10000" placeholder="O que achou?" required></textarea></div><button type="submit" ${active.length?"":"disabled"}>Adicionar registro</button><span class="diary-status" id="diary-status" role="status"></span></form>` : `<p class="diary-intro">Diário público de impressões.</p>`;
  $("experiences-content").innerHTML = journeyPanel;
  $("diary-content").innerHTML = form + `<h3 style="font:600 1.2rem var(--serif);margin:0 0 12px">Registros <span class="meta">${diaryLogs.length} registro(s)</span></h3><div class="diary-list">${diaryLogs.length?diaryLogs.map(log=>`<article class="diary-entry" data-log-entry="${esc(log.id)}"><div class="diary-entry-head"><strong>${isShow?`Episódio ${Number(log.episode)||"?"}`:"Sessão"}</strong><span class="meta">${diaryDate(log.watchedAt)}</span></div><p>${esc(log.comment)}</p><small>${journeys.some(j=>j.id===log.journeyId)?label(journeys.find(j=>j.id===log.journeyId)):"Registro antigo — sem experiência vinculada"}</small>${editable?`<div class="diary-actions"><button type="button" data-edit-log="${esc(log.id)}">Editar</button><button type="button" data-delete-log="${esc(log.id)}">Excluir</button></div>`:""}</article>`).join(""):`<div class="msg">Ainda não há registros para este título.</div>`}</div>`;
  if (!editable) return;

  $("btn-new-journey")?.addEventListener("click", async ev=>{const b=ev.currentTarget;b.disabled=true;b.textContent="Criando…";try{await hubFB.createJourney({itemId:id,type});await loadCatalog();await loadDiary(id,type);}catch(err){alert(`Não foi possível iniciar a experiência: ${err.message||err.code}`);b.disabled=false;b.textContent="+ Iniciar nova experiência";}});

  const dialog=$("journey-edit-dialog"), editForm=$("journey-edit-form");
  $("experiences-content").addEventListener("click",async e=>{
    const edit=e.target.closest("[data-edit-journey]");
    if(edit){const j=journeys.find(x=>String(x.id)===String(edit.dataset.editJourney));if(!j||!dialog||!editForm)return;editForm.elements.journeyId.value=j.id;editForm.elements.status.value=j.status||"in_progress";[...editForm.elements.status.options].forEach(o=>{o.disabled=["completed","abandoned"].includes(j.status)&&["in_progress","paused"].includes(o.value);});editForm.elements.score.value=Number(j.score)>0?j.score:"";editForm.elements.startedAt.value=j.startedAt||"";editForm.elements.endedAt.value=j.endedAt||"";if(editForm.elements.progressSeason)editForm.elements.progressSeason.value=j.progressSeason??"";if(editForm.elements.progressEpisode)editForm.elements.progressEpisode.value=j.progressEpisode??"";editForm.elements.notes.value=j.notes||"";$("journey-edit-status").textContent="";dialog.showModal();return;}
    const action=e.target.closest("[data-journey-status]");if(action){action.disabled=true;const status=action.dataset.journeyStatus;try{await hubFB.updateJourney(action.dataset.journeyId,{status,...(status==="completed"||status==="abandoned"?{endedAt:localDateISO()}:{})});await loadCatalog();await loadDiary(id,type);}catch(err){alert(`Não foi possível atualizar: ${err.message||err.code}`);action.disabled=false;}return;}
    if(e.target.closest("#journey-edit-close,#journey-edit-cancel")){dialog?.close();}
  });
  editForm?.addEventListener("submit",async e=>{e.preventDefault();const data=new FormData(editForm),status=String(data.get("status")||"in_progress"),raw=String(data.get("score")||"").trim(),score=raw===""?0:Number(raw),msg=$("journey-edit-status");if(!Number.isInteger(score)||score<0||score>100){msg.textContent="A nota deve estar entre 0 e 100.";return;}const payload={status,score,startedAt:String(data.get("startedAt")||""),endedAt:String(data.get("endedAt")||""),notes:String(data.get("notes")||"").trim()};if(isShow){const a=String(data.get("progressSeason")||"").trim(),b=String(data.get("progressEpisode")||"").trim();payload.progressSeason=a===""?"":Number(a);payload.progressEpisode=b===""?"":Number(b);if([payload.progressSeason,payload.progressEpisode].some(v=>v!==""&&(!Number.isInteger(v)||v<0))){msg.textContent="Temporada e episódio devem ser inteiros positivos ou zero.";return;}}if(status==="in_progress"||status==="paused")payload.endedAt="";const save=editForm.querySelector('button[type="submit"]');save.disabled=true;msg.textContent="Salvando…";try{await hubFB.updateJourney(String(data.get("journeyId")),payload);dialog.close();await loadCatalog();await loadDiary(id,type);}catch(err){msg.textContent=err.message||err.code||"Erro ao salvar.";save.disabled=false;}});
  $("journey-edit-close")?.addEventListener("click",()=>dialog?.close());$("journey-edit-cancel")?.addEventListener("click",()=>dialog?.close());

  $("diary-form")?.addEventListener("submit",async ev=>{ev.preventDefault();const status=$("diary-status"),episode=isShow?Number($("diary-episode").value):null,watchedAt=$("diary-forgot").checked?"":$("diary-date").value,comment=$("diary-comment").value.trim();if(!comment){status.textContent="Preencha o comentário.";return;}const submit=ev.currentTarget.querySelector('button[type="submit"]');submit.disabled=true;status.textContent="Salvando…";try{const journeyId=$("diary-journey")?.value;if(!journeyId)throw new Error("Inicie ou retome uma experiência antes de registrar.");await hubFB.addItemLog({itemId:id,type,journeyId,episode,watchedAt,comment});await loadDiary(id,type);}catch(err){status.textContent="Não foi possível salvar: "+(err.code||err.message);submit.disabled=false;}});
  $("diary-content").onsubmit=async ev=>{const f=ev.target.closest("[data-save-log]");if(!f)return;ev.preventDefault();const d=new FormData(f),payload={comment:String(d.get("comment")||"").trim(),watchedAt:String(d.get("watchedAt")||"")};if(isShow){payload.episode=Number(d.get("episode"));if(!Number.isInteger(payload.episode)||payload.episode<0){alert("Número de episódio inválido.");return;}}if(!payload.comment){alert("O comentário não pode ficar vazio.");return;}const b=f.querySelector('button[type="submit"]');b.disabled=true;try{await hubFB.updateItemLog(f.dataset.saveLog,payload);await loadDiary(id,type);}catch(err){b.disabled=false;alert(`Não foi possível editar: ${err.code||err.message}`);}};
  $("diary-content").onclick=async e=>{const edit=e.target.closest("[data-edit-log]");if(edit){const log=logs.find(x=>String(x.id)===String(edit.dataset.editLog)),article=edit.closest("[data-log-entry]");if(!log||!article)return;article.innerHTML=`<form class="diary-edit-form" data-save-log="${esc(log.id)}">${isShow?`<label>Episódio<input name="episode" type="number" min="0" step="1" value="${Number(log.episode)||1}" required></label>`:""}<label>Data<input name="watchedAt" type="date" value="${esc(log.watchedAt||"")}"></label><label>Comentário<textarea name="comment" maxlength="10000" required>${esc(log.comment||"")}</textarea></label><div class="diary-actions"><button type="submit">Salvar alterações</button><button type="button" data-cancel-edit>Cancelar</button></div></form>`;return;}if(e.target.closest("[data-cancel-edit]")){await loadDiary(id,type);return;}const del=e.target.closest("[data-delete-log]");if(del){if(!confirm("Excluir este registro?"))return;try{await hubFB.deleteItemLog(del.dataset.deleteLog);await loadDiary(id,type);}catch(err){alert("Não foi possível excluir: "+(err.code||err.message));}}};
}

async function loadDiary(id, type) {
  $("diary-content").className = "msg";
  $("diary-content").textContent = "Carregando diário…";
  try {
    const logs = await hubFB.getItemLogs(id, type);
    if ($("dlg").open) renderDiaryEntries(id, type, logs);
  } catch (err) {
    $("diary-content").innerHTML = `<div class="msg err">Não consegui carregar o diário (${esc(err.code || err.message)}).</div>`;
  }
}

/* =====================================================================
   FILTROS
   ===================================================================== */

function filtered(list) {
  const q   = ($("search-query")?.value ?? "").trim().toLowerCase();
  const s   = $("filter-status")?.value ?? "";
  const y   = $("filter-year")?.value ?? "";
  const lim = Number($("filter-limit")?.value ?? 9999);

  return list.filter(i => {
    if (q && !String(i.title ?? "").toLowerCase().includes(q)) return false;
    if (s && i.status !== s) return false;
    if (y && String(i.year) !== y) return false;
    return true;
  }).slice(0, lim);
}

function populateYears() {
  const all   = [...movies, ...shows];
  const years = [...new Set(all.map(i => i.year).filter(Boolean))].sort((a, b) => b - a);
  $("filter-year").innerHTML = `<option value="">Todos os anos</option>` + years.map(y => `<option>${y}</option>`).join("");
}

/* =====================================================================
   NAVEGAÇÃO
   ===================================================================== */

function render() {
  document.body.classList.toggle("discover-mode", tab === "descobrir");
  const showFilters = tab === "filmes" || tab === "series";
  $("filters").classList.toggle("hidden", !showFilters);
  $("stats-tab").classList.remove("hidden");
  document.querySelector('[data-tab="descobrir"]')?.classList.toggle("hidden", !fbUser);
  document.querySelector('[data-quick="discover"]')?.classList.toggle("hidden", !fbUser);
  document.querySelector('[data-quick="search"]')?.classList.toggle("hidden", !fbUser);
  if (tab === "descobrir" && !fbUser) tab = "agora";

  ({ agora: renderAgora, filmes: renderFilmes, series: renderSeries, descobrir: renderDiscover, stats: renderStats })[tab]?.();
}

document.querySelectorAll(".tabs button").forEach(b => b.addEventListener("click", () => {
  if (b.dataset.tab === "descobrir" && !fbUser) return;
  tab = b.dataset.tab;
  if (tab === "descobrir") discoverView = "home";
  document.querySelectorAll(".tabs button").forEach(x => x.setAttribute("aria-selected", x === b));
  render();
}));

["search-query", "filter-status", "filter-year", "filter-limit"].forEach(id => {
  const el = $(id);
  if (!el) return;
  el.addEventListener("input",  () => render());
  el.addEventListener("change", () => render());
});

/* Clique global nos elementos */
document.addEventListener("click", e => {
  const link = e.target.closest("[data-tab-link]");
  if (link) {
    tab = link.dataset.tabLink;
    document.querySelectorAll(".tabs button").forEach(x => x.setAttribute("aria-selected", x.dataset.tab === tab));
    render(); return;
  }
  const detailTab = e.target.closest("[data-detail-tab]");
  if (detailTab) {
    const name = detailTab.dataset.detailTab;
    document.querySelectorAll("[data-detail-tab]").forEach(b => b.setAttribute("aria-selected", String(b === detailTab)));
    ["info", "experiences", "diary"].forEach(t => document.getElementById(`detail-${t}`)?.classList.toggle("hidden", t !== name));
    if ((name === "diary" || name === "experiences") && activeItem) loadDiary(activeItem.id, activeItem.type);
    return;
  }
  const forgot = e.target.closest("#diary-forgot");
  if (forgot) {
    const dateField = $("diary-date");
    dateField.disabled = forgot.checked;
    if (forgot.checked) dateField.value = "";
    else if (!dateField.value) dateField.value = localDateISO();
    return;
  }
  const copyBtn = e.target.closest("[data-copy]");
  if (copyBtn) {
    navigator.clipboard?.writeText(copyBtn.dataset.copy);
    const orig = copyBtn.textContent;
    copyBtn.textContent = "Copiado!";
    setTimeout(() => { copyBtn.textContent = orig; }, 1800);
    return;
  }
  const card = e.target.closest("[data-id]");
  if (card && !$("dlg").contains(card)) openItem(card.dataset.id, card.dataset.type);
});

$("dlg").addEventListener("close", () => { modalRequestToken++; });
$("dlg").addEventListener("click", e => {
  const dropdown = $("status-dropdown");
  if (dropdown && !dropdown.contains(e.target)) {
    dropdown.classList.remove("is-open");
    $("status-dropdown-trigger")?.setAttribute("aria-expanded", "false");
    $("status-dropdown-menu")?.setAttribute("aria-hidden", "true");
  }
  if (e.target === $("dlg")) $("dlg").close();
});

/* =====================================================================
   BIBLIOTECA PRÓPRIA — Firebase + metadados TMDB
   ===================================================================== */
async function loadCatalog() {
  const statusEl = $("sync-status");
  statusEl.textContent = "Carregando sua biblioteca…";
  try {
    if (!window.hubFB) throw new Error("Firebase ainda está inicializando.");
    const catalog = await hubFB.getCatalog({ refresh: true });
    movies = catalog.filter(x => x.type === "movie").map(x => ({ ...x, id: String(x.id), type: "movie", title: x.title || "Sem título", year: x.year || null, status: x.status || "plantowatch", score: Number(x.score || 0), cover: x.posterUrl || x.cover || null, banner: x.backdropUrl || x.banner || null, overview: x.overview || "" }));
    shows = catalog.filter(x => x.type === "show").map(x => ({ ...x, id: String(x.id), type: "show", title: x.title || "Sem título", year: x.year || null, status: x.status || "plantowatch", score: Number(x.score || 0), cover: x.posterUrl || x.cover || null, banner: x.backdropUrl || x.banner || null, overview: x.overview || "", eps: x.numberOfEpisodes || 0 }));
    watching = [...movies, ...shows].filter(i => i.status === "watching");
    populateYears(); renderHero(); render();
    statusEl.textContent = `Biblioteca carregada · ${movies.length} filmes, ${shows.length} séries`;
  } catch (error) {
    console.error("Falha ao carregar biblioteca:", error);
    statusEl.textContent = `Não foi possível carregar sua biblioteca: ${esc(error.message)}`;
    movies = []; shows = []; watching = []; renderHero(); render();
  }
}

/* Adicionar título à biblioteca a partir da busca ou das recomendações */
document.addEventListener("keydown",e=>{const card=e.target.closest("[data-preview-id]");if(card&&(e.key==="Enter"||e.key===" ")){e.preventDefault();openTmdbPreview(card.dataset.previewId,card.dataset.previewType);}});
document.addEventListener("click",async e=>{
  const quick=e.target.closest("[data-quick]");
  if(quick){const action=quick.dataset.quick;if(action==="discover"){if(!fbUser)return;document.querySelector('[data-tab="descobrir"]')?.click();}else if(action==="search"){if(!fbUser)return;document.querySelector('[data-tab="descobrir"]')?.click();setTimeout(()=>$ ("tmdb-search-input")?.focus(),50);}else if(action==="watchlist"){tab="filmes";render();document.querySelector('[data-tab="filmes"]')?.click();$("filter-status").value="plantowatch";render();}else if(action==="random"){const pool=[...movies,...shows].filter(x=>x.status==="plantowatch");if(pool.length){const pick=pool[Math.floor(Math.random()*pool.length)];openItem(pick.id,pick.type);}else alert("Adicione títulos à sua lista para usar esta função.");}return;}
  const cat=e.target.closest("[data-discover-category]");if(cat){discoverView=cat.dataset.discoverCategory;discoverPage=1;renderDiscover();return;}
  if(e.target.closest("[data-discover-home]")){discoverView="home";renderDiscover();return;}
  const page=e.target.closest("[data-discover-page]");if(page){discoverPage=Math.max(1,discoverPage+(page.dataset.discoverPage==="next"?1:-1));renderDiscover();return;}
  const searchPageButton=e.target.closest("[data-search-page]");if(searchPageButton){runDiscoverSearch(Math.max(1,searchPage+(searchPageButton.dataset.searchPage==="next"?1:-1)));return;}
  if(e.target.closest("[data-discover-retry]")){discoverCache.delete(`${discoverView}:${discoverPage}`);renderDiscover();return;}
  const preview=e.target.closest("[data-preview-id]");if(preview&&!e.target.closest("[data-add-tmdb]")){openTmdbPreview(preview.dataset.previewId,preview.dataset.previewType);return;}
  const button=e.target.closest("[data-add-tmdb]"); if(!button)return;
  if(!fbUser||!window.hubFB){alert("Entre com sua conta Google para adicionar títulos.");return;}
  const id=button.dataset.addTmdb, mediaType=button.dataset.mediaType||tmdbSearchResults.find(x=>String(x.id)===id)?.mediaType; if(!mediaType)return;
  button.disabled=true;button.textContent="Adicionando…";
  try{const r=await fetch(`${TMDB_WORKER_URL}/api/tmdb/${mediaType}/${id}`);if(!r.ok)throw new Error("Não foi possível carregar os detalhes do título.");const detail=await r.json();await hubFB.addCatalogItem({...detail,status:"plantowatch"});await loadCatalog();button.textContent="Adicionado";button.closest(".tmdb-result,.discover-card")?.classList.add("is-added");}
  catch(err){console.error(err);button.disabled=false;button.textContent="Tentar novamente";alert(`Não foi possível adicionar: ${err.code||err.message}`);}
});

/* Inicialização */
async function init() { if (window.hubFB) await loadCatalog(); else $("sync-status").textContent = "Conectando ao Firebase…"; }
window.addEventListener("fb-user", e => {
  fbUser = e.detail;
  const loginBtn = $("btn-login");
  if (loginBtn) { loginBtn.textContent = fbUser ? "Sair" : "Entrar com Google"; loginBtn.title = fbUser ? `Conectado como ${fbUser.name || fbUser.uid}. Clique para sair.` : "Entrar com sua conta Google"; }
  $("me").innerHTML = fbUser ? `Logado como ${esc(fbUser.name || "Proprietário")} · UID: <code>${esc(fbUser.uid)}</code> <button class="cp" data-copy="${esc(fbUser.uid)}">Copiar UID</button>` : "";
  loadCatalog(); render();
});
$("btn-login").addEventListener("click", () => {
  if (!window.hubFB) { alert("Firebase ainda não carregou. Recarregue a página."); return; }
  (fbUser ? hubFB.logout() : hubFB.login()).catch(err => alert("Não foi possível entrar: " + (err.code || err.message)));
});
init();

/* =====================================================================
   HELPERS
   ===================================================================== */

function groupByStatus(list) {
  const order = ["watching", "completed", "plantowatch", "paused", "dropped"];
  const groups = {};
  order.forEach(s => groups[s] = []);
  list.forEach(i => {
    const st = groups[i.status] ? i.status : "plantowatch";
    groups[st].push(i);
  });
  return groups;
}

function statusLabel(s) {
  return {
    watching:    "Assistindo",
    completed:   "Concluídos",
    plantowatch: "Quero assistir",
    paused:      "Pausados",
    dropped:     "Abandonados"
  }[s] ?? s;
}

function statBars(entries, total) {
  if (!entries.length) return `<p class="meta">Sem dados.</p>`;
  const max = Math.max(1, ...entries.map(x => x[1]));
  return entries.map(([label, value]) => `
    <div style="display:grid;grid-template-columns:minmax(100px,1fr) minmax(80px,2fr) auto;gap:10px;align-items:center;margin:10px 0;font-size:.88rem">
      <span>${esc(label)}</span>
      <div style="height:8px;background:#ffffff12;border-radius:99px;overflow:hidden">
        <i style="display:block;height:100%;width:${Math.max(0, value / max * 100)}%;background:var(--sun);border-radius:99px"></i>
      </div>
      <b style="font-variant-numeric:tabular-nums">${value} <span style="color:var(--muted)">(${total ? Math.round(value / total * 100) : 0}%)</span></b>
    </div>`).join("");
}
