/* =====================================================================
   HUB DE FILMES & SÉRIES — Clpher
   hub.js — lógica principal (UI, abas, renderização)
   =====================================================================
   CONTROLE DE VERSÃO:
   Sempre que modificar este arquivo incremente HUB_VERSION em +1.
   ===================================================================== */
const HUB_VERSION = 1;
window.HUB_VERSION = HUB_VERSION;
document.getElementById("project-version").textContent = `v${HUB_VERSION}`;

/* ---------- Utilitários ---------- */
const $ = id => document.getElementById(id);
const esc = s => String(s ?? "").replace(/[&<>"]/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));
const bg  = u => u ? `style="background-image:url('${u}')"` : "";

/* ---------- Estado global ---------- */
let tab       = "agora";
let fbUser    = null;
let movies    = [];   // catálogo de filmes
let shows     = [];   // catálogo de séries
let watching  = [];   // em andamento (filmes + séries)
let activeItem = null; // item aberto no modal

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
const tierFor  = s => TIERS.find(t => s >= t[0]);
const badge    = s => { const t = tierFor(s); return `<span class="badge" style="--c:${t[2]}">${s}<small>${t[1]}</small></span>` };

/* =====================================================================
   RENDERIZAÇÃO DE VIEWS
   ===================================================================== */

/* ---- Hero dinâmico ---- */
function renderHero() {
  const pool = watching.filter(i => i.banner);
  const all  = [...movies, ...shows].filter(i => i.banner && i.score >= 80);
  const list = pool.length ? pool : all.length ? all : [...movies, ...shows].filter(i => i.banner);
  if (!list.length) {
    $("heroin").innerHTML = `<h1>Meu hub de<br>filmes &amp; séries</h1>`;
    return;
  }
  const item = list[Math.floor(Math.random() * list.length)];
  $("hero").style.backgroundImage = `url('${item.banner}')`;
  const isWatching = item.status === "watching";
  $("heroin").innerHTML = `
    <small>${isWatching ? `Assistindo agora${item.progress ? ` — ep ${item.progress}` : ""}` : `Uma das minhas favoritas — ${item.score}`}</small>
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
      <div class="msg">Nenhum título em andamento. <a href="#" data-tab-link="filmes">Explore os filmes</a> ou <a href="#" data-tab-link="series">as séries</a>.</div>`;
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
    $("view").innerHTML = `<h2>Meus filmes</h2><div class="msg">Nenhum filme com esses filtros.</div>`;
    return;
  }
  const byStatus = groupByStatus(list);
  $("view").innerHTML = Object.entries(byStatus)
    .filter(([, items]) => items.length)
    .map(([status, items]) => `
      <h2>${statusLabel(status)} <span class="meta">${items.length}</span></h2>
      <div class="grid">${items.map(posterCard).join("")}</div>`)
    .join("");
}

/* ---- Aba "Séries" ---- */
function renderSeries() {
  const list = filtered(shows);
  if (!list.length) {
    $("view").innerHTML = `<h2>Minhas séries</h2><div class="msg">Nenhuma série com esses filtros.</div>`;
    return;
  }
  const byStatus = groupByStatus(list);
  $("view").innerHTML = Object.entries(byStatus)
    .filter(([, items]) => items.length)
    .map(([status, items]) => `
      <h2>${statusLabel(status)} <span class="meta">${items.length}</span></h2>
      <div class="grid">${items.map(posterCard).join("")}</div>`)
    .join("");
}

/* ---- Aba "Estatísticas" ---- */
function renderStats() {
  if (!fbUser) {
    $("view").innerHTML = `<div class="msg">Entre com a conta proprietária para ver suas estatísticas.</div>`;
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
      <article class="stat-card" style="border-color:#ff916b45;background:linear-gradient(145deg,#292033,#151827)"><small>Nota média</small><strong>${avg}<span style="font:400 .85rem var(--sans);display:inline"> /100</span></strong><span>${rated.length} avaliados</span></article>
    </div>
    <div class="stats-columns">
      <div class="stats-panel">
        <h3>Distribuição por status</h3>
        ${statBars([
          ["Concluídos",     [...movies, ...shows].filter(i => i.status === "completed").length],
          ["Assistindo",     watching.length],
          ["Quero assistir", [...movies, ...shows].filter(i => i.status === "plantowatch").length],
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
  const pct = item.eps ? Math.min(100, item.progress / item.eps * 100) : 0;
  return `<button class="poster" data-id="${item.id}" data-type="${item.type}">
    <img src="${esc(item.cover)}" alt="" loading="lazy">
    <div class="cap">
      <b>${esc(item.title)}</b>
      ${item.status === "watching"
        ? `<div class="pb"><i style="width:${pct}%"></i></div><span>ep ${item.progress ?? "?"}${item.eps ? " / " + item.eps : ""}</span>`
        : `<span>${item.year ?? ""}${item.score ? " · " + item.score : ""}</span>`}
    </div>
  </button>`;
};

const wideCard = item => {
  const pct = item.eps ? Math.min(100, item.progress / item.eps * 100) : 0;
  return `<button class="wide" data-id="${item.id}" data-type="${item.type}" ${bg(item.banner)}>
    <img src="${esc(item.cover)}" alt="">
    <div>
      <b>${esc(item.title)}</b>
      <div class="meta">${item.year ?? ""}${item.type === "show" ? " · Série" : " · Filme"}</div>
      ${item.eps ? `<div class="pb"><i style="width:${pct}%"></i></div>
      <span class="meta">ep ${item.progress ?? "?"}${item.eps ? " / " + item.eps : ""}</span>` : ""}
    </div>
  </button>`;
};

/* =====================================================================
   MODAL DE DETALHES
   ===================================================================== */

async function openItem(id, type) {
  const item = (type === "movie" ? movies : shows).find(i => i.id === id);
  if (!item) return;
  activeItem = item;
  const d = $("dlg");

  let note = {};
  try { note = await hubFB.getItemNote(id, type) } catch (e) {}

  d.innerHTML = `
    <div class="dh" ${bg(item.banner || item.cover)}>
      <button class="dx" onclick="document.getElementById('dlg').close()">Fechar</button>
      <h2>${esc(item.title)}</h2>
      <div class="meta">${item.year ?? ""}${item.type === "show" ? " · Série" : " · Filme"} ${item.score ? badge(item.score) : ""} · <a href="${esc(item.traktUrl ?? "#")}" target="_blank" rel="noopener">Trakt</a></div>
    </div>
    <div class="db">
      <div class="detail-tabs">
        <button type="button" data-detail-tab="info"   aria-selected="true">Informações</button>
        <button type="button" data-detail-tab="diary"  aria-selected="false">Diário</button>
      </div>
      <section id="detail-info">
        <p class="diary-intro">${esc(item.overview ?? "Sem sinopse disponível.")}</p>
        ${item.score ? badge(item.score) : ""}
      </section>
      <section id="detail-diary" class="hidden">
        <div id="diary-content" class="msg">Carregando diário…</div>
      </section>
    </div>`;

  d.showModal();
  loadDiary(id, type);
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
    </form>` : `<p class="diary-intro">Diário público.</p>`;

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
  const q = ($("search-query")?.value ?? "").trim().toLowerCase();
  const s = $("filter-status")?.value ?? "";
  const y = $("filter-year")?.value ?? "";
  const lim = Number($("filter-limit")?.value ?? 9999);
  return list.filter(i => {
    if (q && !String(i.title ?? "").toLowerCase().includes(q)) return false;
    if (s && i.status !== s) return false;
    if (y && String(i.year) !== y) return false;
    return true;
  }).slice(0, lim);
}

function populateYears() {
  const all  = [...movies, ...shows];
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

  ({ agora: renderAgora, filmes: renderFilmes, series: renderSeries, stats: renderStats })[tab]?.();
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

/* Clique nos cards ---------- */
document.addEventListener("click", e => {
  /* Link de aba no estado vazio */
  const link = e.target.closest("[data-tab-link]");
  if (link) {
    tab = link.dataset.tabLink;
    document.querySelectorAll(".tabs button").forEach(x => x.setAttribute("aria-selected", x.dataset.tab === tab));
    render(); return;
  }
  /* Abas internas do modal */
  const detailTab = e.target.closest("[data-detail-tab]");
  if (detailTab) {
    const name = detailTab.dataset.detailTab;
    document.querySelectorAll("[data-detail-tab]").forEach(b => b.setAttribute("aria-selected", String(b === detailTab)));
    ["info", "diary"].forEach(t => document.getElementById(`detail-${t}`)?.classList.toggle("hidden", t !== name));
    if (name === "diary" && activeItem) loadDiary(activeItem.id, activeItem.type);
    return;
  }
  /* Esqueci a data no modal */
  const forgot = e.target.closest("#diary-forgot");
  if (forgot) {
    const dateField = $("diary-date");
    dateField.disabled = forgot.checked;
    if (forgot.checked) dateField.value = "";
    else if (!dateField.value) dateField.value = localDateISO();
    return;
  }
  /* Abrir item (cards) */
  const card = e.target.closest("[data-id]");
  if (card && !$("dlg").contains(card)) openItem(card.dataset.id, card.dataset.type);
});

/* Fechar modal clicando no backdrop */
$("dlg").addEventListener("click", e => { if (e.target === $("dlg")) $("dlg").close(); });

/* =====================================================================
   SINCRONIZAÇÃO COM TRAKT (placeholder — será preenchido via Cloudflare Worker)
   ===================================================================== */

async function syncTrakt() {
  $("sync-status").textContent = "Sincronizando com o Trakt…";
  $("btn-sync").disabled = true;
  try {
    // TODO: chamar o Cloudflare Worker que faz OAuth e devolve o catálogo
    // const data = await fetch("/api/trakt/catalog").then(r => r.json());
    // loadCatalog(data.movies, data.shows);
    $("sync-status").textContent = "Integração com Trakt em breve. Exibindo dados de exemplo.";
    loadMockData();
  } catch (e) {
    $("sync-status").textContent = "Não foi possível sincronizar com o Trakt.";
  } finally {
    $("btn-sync").disabled = false;
  }
}

$("btn-sync").addEventListener("click", syncTrakt);

/* =====================================================================
   DADOS MOCK (removidos quando Trakt for integrado)
   ===================================================================== */

function loadMockData() {
  movies = [
    { id: "m1", type: "movie", title: "Dune: Part Two",        year: 2024, status: "completed", score: 92, cover: "https://image.tmdb.org/t/p/w500/1pdfLvkbY9ohJlCjQH2CZjjYVvJ.jpg",  banner: "https://image.tmdb.org/t/p/original/xOMo8BRK7PfcJv9JCnx7s5hj0PX.jpg", overview: "Paul Atreides une forças com Chani e os Fremen." },
    { id: "m2", type: "movie", title: "Oppenheimer",           year: 2023, status: "completed", score: 95, cover: "https://image.tmdb.org/t/p/w500/8Gxv8gSFCU0XGDykEGv7zR1n2ua.jpg",  banner: "https://image.tmdb.org/t/p/original/feSiISwgEpVzR1v3zv2n2LsbsL8.jpg", overview: "A história do pai da bomba atômica." },
    { id: "m3", type: "movie", title: "Past Lives",            year: 2023, status: "completed", score: 88, cover: "https://image.tmdb.org/t/p/w500/k3waqVXSnFLKGmFQp7GDCgDdNaR.jpg",  banner: null, overview: "Dois amigos de infância se reencontram décadas depois." },
    { id: "m4", type: "movie", title: "A Quiet Place: Day One",year: 2024, status: "plantowatch", score: 0, cover: "https://image.tmdb.org/t/p/w500/yrpPYKijwdMHyFGJCJzOtMoeZgH.jpg",  banner: null, overview: "" },
  ];
  shows = [
    { id: "s1", type: "show", title: "Shogun",         year: 2024, status: "watching",    score: 96, progress: 7, eps: 10, cover: "https://image.tmdb.org/t/p/w500/9bDdSgTOJ4U2i0TqoFoNFXG2QgL.jpg", banner: "https://image.tmdb.org/t/p/original/zGLHX92Gk96O1DJvLil7ObJTbaL.jpg", overview: "Japão feudal, guerras e honra." },
    { id: "s2", type: "show", title: "The Bear",       year: 2022, status: "watching",    score: 93, progress: 4, eps: 10, cover: "https://image.tmdb.org/t/p/w500/sHFlbKS3WLqMnp9t2ghADIJFnuQ.jpg", banner: "https://image.tmdb.org/t/p/original/0mHgHFBLV1LZO1qUcPH4bWrLMGy.jpg", overview: "Um chef herda o restaurante da família." },
    { id: "s3", type: "show", title: "Severance",      year: 2022, status: "completed",   score: 97, progress: 9, eps: 9,  cover: "https://image.tmdb.org/t/p/w500/lHra7VzOeCunGm3i2qJmAfDmhfF.jpg", banner: "https://image.tmdb.org/t/p/original/mInGl4nyiCqFSQvCDMzVw6nFMJo.jpg", overview: "Funcionários têm memórias separadas dentro e fora do trabalho." },
    { id: "s4", type: "show", title: "Dark Matter",    year: 2024, status: "plantowatch", score: 0,  progress: 0, eps: 9,  cover: "https://image.tmdb.org/t/p/w500/frwl2zBNAl5ZbFDJGoJv0CSd90X.jpg", banner: null, overview: "" },
  ];

  watching = [...movies, ...shows].filter(i => i.status === "watching");
  populateYears();
  renderHero();
  render();
  $("sync-status").textContent = `Dados de exemplo carregados · ${movies.length} filmes, ${shows.length} séries`;
}

/* =====================================================================
   INICIALIZAÇÃO
   ===================================================================== */

/* Ouve eventos do Firebase (firebase.js) */
window.addEventListener("fb-user", e => {
  fbUser = e.detail;
  $("btn-login").textContent = fbUser ? "Sair" : "Entrar com Google";
  $("me").innerHTML = fbUser
    ? `Logado como ${esc(fbUser.name)} · UID: <code>${esc(fbUser.uid)}</code>`
    : "";
  render();
});

$("btn-login").addEventListener("click", () => {
  if (!window.hubFB) { alert("Firebase ainda não carregou. Recarregue a página."); return; }
  (fbUser ? hubFB.logout() : hubFB.login()).catch(err => alert("Não foi possível entrar: " + err.code));
});

/* Carrega dados de exemplo ao abrir (enquanto Trakt não está integrado) */
loadMockData();

/* =====================================================================
   HELPERS
   ===================================================================== */

function groupByStatus(list) {
  const order = ["watching", "completed", "plantowatch", "dropped"];
  const groups = {};
  order.forEach(s => groups[s] = []);
  list.forEach(i => { if (groups[i.status]) groups[i.status].push(i); });
  return groups;
}

function statusLabel(s) {
  return { watching: "Assistindo", completed: "Concluídos", plantowatch: "Quero assistir", dropped: "Abandonados" }[s] ?? s;
}

function statBars(entries, total) {
  if (!entries.length) return `<p class="meta">Sem dados.</p>`;
  const max = Math.max(1, ...entries.map(x => x[1]));
  return entries.map(([label, value]) => `
    <div style="display:grid;grid-template-columns:minmax(90px,1fr) minmax(80px,2fr) auto;gap:10px;align-items:center;margin:10px 0;font-size:.88rem">
      <span>${esc(label)}</span>
      <div style="height:8px;background:#ffffff12;border-radius:99px;overflow:hidden">
        <i style="display:block;height:100%;width:${Math.max(0, value / max * 100)}%;background:var(--sun);border-radius:99px"></i>
      </div>
      <b style="font-variant-numeric:tabular-nums">${value} <span style="color:var(--muted)">(${total ? Math.round(value / total * 100) : 0}%)</span></b>
    </div>`).join("");
}
