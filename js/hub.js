/* =====================================================================
   HUB DE FILMES & SÉRIES — Clpher
   hub.js — lógica principal (UI, abas, renderização, TMDB + Firebase)
   =====================================================================
   CONTROLE DE VERSÃO:
   Sempre que modificar este arquivo incremente HUB_VERSION em +1.
   ===================================================================== */
const HUB_VERSION = 13;
window.HUB_VERSION = HUB_VERSION;
document.getElementById("project-version").textContent = `v${HUB_VERSION}`;

/* ---------- Utilitários ---------- */
const $   = id => document.getElementById(id);
const esc = s => String(s ?? "").replace(/[&<>"]/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));
const bg  = u => u ? `style="background-image:url('${u}')"` : "";

/* ---------- Estado global ---------- */
let tab        = "agora";
let fbUser     = null;
let movies     = [];   // catálogo de filmes
let shows      = [];   // catálogo de séries
let watching   = [];   // em andamento (filmes + séries)
let activeItem = null; // item aberto no modal
let showSeasonsCache = new Map(); // cache das temporadas de séries
let tmdbSearchResults = [];
let discoverLoaded = false;
let discoverLoading = false;
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
    $("view").innerHTML = `<h2>Meus filmes</h2><div class="msg">Sua biblioteca de filmes está vazia. Use “Adicionar título” acima para começar.</div>`;
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
    $("view").innerHTML = `<h2>Minhas séries</h2><div class="msg">Sua biblioteca de séries está vazia. Use “Adicionar título” acima para começar.</div>`;
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


/* ---- Descobrir: busca integrada + catálogo TMDB ---- */
async function renderDiscover() {
  $("view").innerHTML = `
    <section class="discover-head">
      <span class="eyebrow">EXPLORE O UNIVERSO DO CINEMA</span>
      <h2>Encontre sua próxima história.</h2>
      <p>Pesquise um título ou explore o que está em alta no cinema e na televisão.</p>
      <form id="tmdb-search-form" class="catalog-search-form discover-search">
        <select id="tmdb-search-type" aria-label="Tipo de título"><option value="multi">Tudo</option><option value="movie">Filmes</option><option value="tv">Séries</option></select>
        <input id="tmdb-search-input" type="search" minlength="2" placeholder="Qual título você procura?" autocomplete="off" required>
        <button type="submit" id="tmdb-search-submit">Buscar</button>
      </form>
      <p class="search-hint" id="tmdb-search-status">A busca consulta o catálogo do TMDB. Você pode adicionar os títulos à sua biblioteca.</p>
      <div id="tmdb-search-results" class="tmdb-search-results" aria-live="polite"></div>
    </section>
    <div id="discover-sections" class="discover-sections"><div class="discover-loading">Carregando recomendações…</div></div>`;
  bindDiscoverSearch();
  if (!discoverLoaded && !discoverLoading) await loadDiscoverSections();
}
async function loadDiscoverSections() {
  discoverLoading = true;
  const target = $("discover-sections");
  if (!target) { discoverLoading = false; return; }
  const sections = [
    ["Em alta esta semana", "/api/tmdb/trending/all/week"],
    ["Filmes populares", "/api/tmdb/discover/movie?sort_by=popularity.desc"],
    ["Séries populares", "/api/tmdb/discover/tv?sort_by=popularity.desc"],
    ["Filmes mais bem avaliados", "/api/tmdb/discover/movie?sort_by=vote_average.desc&vote_count.gte=500"],
    ["Séries mais bem avaliadas", "/api/tmdb/discover/tv?sort_by=vote_average.desc&vote_count.gte=200"]
  ];
  try {
    const data = await Promise.all(sections.map(async ([title,path]) => { const r=await fetch(`${TMDB_WORKER_URL}${path}`); if(!r.ok) throw new Error(`Falha ao carregar ${title.toLowerCase()}`); return {title,items:(await r.json()).results||[]}; }));
    discoverLoaded = true;
    target.innerHTML = data.map(s=>`<section class="discover-row"><div class="discover-row-heading"><h2>${esc(s.title)}</h2><span>TMDB</span></div><div class="discover-grid">${s.items.slice(0,12).map(discoverCard).join("")}</div></section>`).join("");
  } catch(e) { target.innerHTML=`<div class="msg err">Não foi possível carregar as sugestões: ${esc(e.message)}.</div><button class="discover-retry" id="discover-retry">Tentar novamente</button>`; }
  finally { discoverLoading=false; }
}
function discoverCard(item) {
  const type=item.mediaType==="tv"?"show":"movie";
  const exists=[...movies,...shows].some(x=>x.type===type&&String(x.id)===String(item.id));
  const poster=item.posterUrl?`<img src="${esc(item.posterUrl)}" alt="Pôster de ${esc(item.title)}" loading="lazy">`:`<div class="discover-no-poster">Sem pôster</div>`;
  return `<article class="discover-card">${poster}<div class="discover-card-info"><strong>${esc(item.title)}</strong><span>${item.year||"Ano desconhecido"} · ${type==="show"?"Série":"Filme"}</span><button type="button" data-add-tmdb="${esc(item.id)}" data-media-type="${item.mediaType}" ${exists||!fbUser?"disabled":""}>${exists?"Na biblioteca":fbUser?"+ Adicionar":"Entre para adicionar"}</button></div></article>`;
}
function bindDiscoverSearch() {
  $("tmdb-search-form")?.addEventListener("submit",async e=>{
    e.preventDefault(); const q=$("tmdb-search-input").value.trim(), type=$("tmdb-search-type").value, status=$("tmdb-search-status"), out=$("tmdb-search-results");
    if(q.length<2){status.textContent="Digite pelo menos 2 caracteres.";return;}
    status.textContent="Buscando no TMDB…";out.innerHTML="";$("tmdb-search-submit").disabled=true;
    try {
      const r=await fetch(`${TMDB_WORKER_URL}/api/tmdb/search/${type}?query=${encodeURIComponent(q)}`),d=await r.json(); if(!r.ok)throw new Error(d.error||`TMDB HTTP ${r.status}`);
      tmdbSearchResults=d.results||[]; if(!tmdbSearchResults.length){status.textContent="Nenhum resultado encontrado.";return;}
      status.textContent=`${d.totalResults||tmdbSearchResults.length} resultado(s) encontrado(s).`;
      const existing=new Set([...movies,...shows].map(x=>`${x.type}:${x.id}`));
      out.innerHTML=tmdbSearchResults.map(item=>{const t=item.mediaType==="tv"?"show":"movie",added=existing.has(`${t}:${item.id}`),img=item.posterUrl?`<img src="${esc(item.posterUrl)}" alt="" loading="lazy">`:`<div class="search-poster-fallback">▤</div>`;return `<article class="tmdb-result">${img}<div class="tmdb-result-info"><strong>${esc(item.title)}</strong><span>${item.year||"Ano não informado"} · ${t==="show"?"Série":"Filme"}</span><p>${esc(item.overview||"Sinopse indisponível.")}</p></div><button type="button" class="tmdb-add-btn" data-add-tmdb="${esc(item.id)}" data-media-type="${item.mediaType}" ${added||!fbUser?"disabled":""}>${added?"Na biblioteca":fbUser?"Adicionar":"Entre para adicionar"}</button></article>`;}).join("");
    } catch(err){status.textContent=`Não foi possível pesquisar: ${err.message}`;} finally{$("tmdb-search-submit").disabled=false;}
  });
}

/* ---- Aba "Estatísticas" ---- */
function renderStats() {
  if (!fbUser) {
    $("view").innerHTML = `<div class="msg">Entre com a conta proprietária para ver suas estatísticas pessoais.</div>`;
    return;
  }
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

async function openItem(id, type) {
  const item = (type === "movie" ? movies : shows).find(i => i.id === String(id));
  if (!item) return;
  activeItem = item;
  const d = $("dlg");
  const isShow = type === "show";

  let note = {};
  if (window.hubFB) {
    try { note = await hubFB.getItemNote(id, type); } catch (e) {}
  }
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
        <div class="status-dropdown" id="status-dropdown">
          <select class="quick-status-select status-native-select" id="modal-status-select" tabindex="-1" aria-hidden="true">
            ${statusOptions.map(([val, label]) => `<option value="${val}" ${currentStatus === val ? "selected" : ""}>${label}</option>`).join("")}
          </select>
          <button class="status-dropdown-trigger" id="status-dropdown-trigger" type="button" aria-haspopup="listbox" aria-expanded="false" aria-controls="status-dropdown-menu">
            <span id="status-dropdown-label">${statusOptions.find(([val]) => val === currentStatus)?.[1] || "Quero assistir"}</span>
            <svg class="status-chevron" viewBox="0 0 20 20" aria-hidden="true" focusable="false"><path d="m5.5 7.5 4.5 4.5 4.5-4.5" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>
          </button>
          <div class="status-dropdown-menu" id="status-dropdown-menu" role="listbox" aria-label="Status do título" aria-hidden="true">
            ${statusOptions.map(([val, label]) => `<button type="button" class="status-dropdown-option${currentStatus === val ? " is-selected" : ""}" role="option" aria-selected="${currentStatus === val}" data-status-value="${val}">${label}</button>`).join("")}
          </div>
        </div>
        <span id="header-score-badge">${badge(currentScore)}</span>
        · <span>TMDB</span>
      </div>
    </div>
    <div class="db">
      <div class="detail-tabs">
        <button type="button" data-detail-tab="info" aria-selected="true">${isShow ? "Temporadas &amp; Avaliação" : "Avaliação &amp; Info"}</button>
        <button type="button" data-detail-tab="diary" aria-selected="false">Diário</button>
      </div>

      <!-- Seção: Informações e Avaliação -->
      <section id="detail-info">
        <p class="diary-intro">${esc(item.overview || "Sem sinopse disponível.")}</p>

        <!-- Caixa de Nota Geral -->
        <div class="score-box">
          <label for="input-item-score"><strong>${isShow ? "Nota Geral da Série" : "Sua Avaliação"} (0 a 100):</strong></label>
          <input type="number" id="input-item-score" min="0" max="100" value="${currentScore > 0 ? currentScore : ""}" placeholder="0–100">
          <button type="button" id="btn-save-score">Salvar Nota</button>
          <span class="meta" id="score-status"></span>
        </div>

        ${isShow ? `<div id="series-seasons-container"><div class="msg">Carregando temporadas e episódios…</div></div>` : ""}
      </section>

      <!-- Seção: Diário -->
      <section id="detail-diary" class="hidden">
        <div id="diary-content" class="msg">Carregando diário…</div>
      </section>
    </div>`;

  d.showModal();

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
    if (window.hubFB && fbUser) {
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
        if (window.hubFB && fbUser) await hubFB.saveItemNote(id, type, { scoreOverall: scoreVal });
      } else {
        item.score = scoreVal;
        if (window.hubFB && fbUser) await hubFB.saveItemNote(id, type, { score: scoreVal });
      }
      $("header-score-badge").innerHTML = badge(scoreVal);
      statusEl.textContent = "Nota salva!";
      render();
    } catch (err) {
      statusEl.textContent = "Erro ao salvar: " + (err.code || err.message);
    }
  });

  // Se for série, carrega temporadas e episódios
  if (isShow) {
    loadSeriesSeasons(id, note);
  }

  // Carrega diário
  loadDiary(id, type);
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
              ${isFinished ? `
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
                  return `<button type="button" class="ep-btn ${isWatched ? "watched" : ""}" data-season="${sNum}" data-ep="${epNum}" title="Episódio ${epNum}">E${epNum}</button>`;
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
  const editable = !!fbUser;
  const sorted = [...logs].sort((a, b) =>
    String(b.watchedAt ?? "").localeCompare(String(a.watchedAt ?? "")) ||
    ((b.createdAtMs ?? 0) - (a.createdAtMs ?? 0)));

  const isShow = type === "show";
  $("diary-content").className = "";
  const form = editable ? `
    <p class="diary-intro">Registre suas impressões ${isShow ? "episódio por episódio" : "sobre o filme"}.</p>
    <form class="diary-form" id="diary-form">
      ${isShow ? `<div><label for="diary-episode">Episódio</label><input id="diary-episode" type="number" min="0" step="1" value="1" required></div>` : ""}
      <div><label for="diary-date">Data</label><input id="diary-date" type="date" value="${localDateISO()}">
        <label style="display:flex;align-items:center;gap:7px;margin-top:8px"><input id="diary-forgot" type="checkbox" style="width:auto"> Esqueci a data</label>
      </div>
      <div class="wide-field"><label for="diary-comment">Seu comentário</label><textarea id="diary-comment" maxlength="10000" placeholder="O que achou?" required></textarea></div>
      <button type="submit">Adicionar registro</button><span class="diary-status" id="diary-status" role="status"></span>
    </form>` : `<p class="diary-intro">Diário público de impressões.</p>`;

  $("diary-content").innerHTML = form + `
    <h3 style="font:600 1.2rem var(--serif);margin:0 0 12px">Histórico <span class="meta">${sorted.length} registro(s)</span></h3>
    <div class="diary-list">${sorted.length
      ? sorted.map(log => `
        <article class="diary-entry">
          <div class="diary-entry-head">
            <strong>${isShow ? `Episódio ${Number(log.episode) || "?"}` : "Sessão"}</strong>
            <span class="meta">${diaryDate(log.watchedAt)}</span>
          </div>
          <p>${esc(log.comment)}</p>
          ${editable ? `<div class="diary-actions">
            <button type="button" data-delete-log="${esc(log.id)}">Excluir</button>
          </div>` : ""}
        </article>`).join("")
      : `<div class="msg">Ainda não há registros para este título.</div>`}
    </div>`;

  if (!editable) return;

  $("diary-form").addEventListener("submit", async ev => {
    ev.preventDefault();
    const status = $("diary-status");
    const episode = isShow ? Number($("diary-episode").value) : null;
    const forgot = $("diary-forgot").checked;
    const watchedAt = forgot ? "" : $("diary-date").value;
    const comment = $("diary-comment").value.trim();
    if (!comment) { status.textContent = "Preencha o comentário."; return; }

    const submit = ev.currentTarget.querySelector('button[type="submit"]');
    submit.disabled = true; status.textContent = "Salvando…";
    try {
      await hubFB.addItemLog({ itemId: id, type, episode, watchedAt, comment });
      await loadDiary(id, type);
    } catch (err) {
      status.textContent = "Não foi possível salvar: " + (err.code || err.message);
      submit.disabled = false;
    }
  });

  $("diary-content").addEventListener("click", async e => {
    const del = e.target.closest("[data-delete-log]");
    if (del) {
      if (!confirm("Excluir este registro?")) return;
      try { await hubFB.deleteItemLog(del.dataset.deleteLog); await loadDiary(id, type); }
      catch (err) { alert("Não foi possível excluir: " + (err.code || err.message)); }
    }
  });
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
  const showFilters = tab === "filmes" || tab === "series";
  $("filters").classList.toggle("hidden", !showFilters);
  $("stats-tab").classList.toggle("hidden", !fbUser);

  ({ agora: renderAgora, filmes: renderFilmes, series: renderSeries, descobrir: renderDiscover, stats: renderStats })[tab]?.();
}

document.querySelectorAll(".tabs button").forEach(b => b.addEventListener("click", () => {
  tab = b.dataset.tab;
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
    ["info", "diary"].forEach(t => document.getElementById(`detail-${t}`)?.classList.toggle("hidden", t !== name));
    if (name === "diary" && activeItem) loadDiary(activeItem.id, activeItem.type);
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
document.addEventListener("click",async e=>{
  if(e.target.closest("#discover-retry")){discoverLoaded=false;loadDiscoverSections();return;}
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
