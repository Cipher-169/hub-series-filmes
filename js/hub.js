/* =====================================================================
   HUB DE FILMES & SÉRIES — Clpher
   hub.js — lógica principal (UI, abas, renderização, TMDB + Firebase)
   =====================================================================
   CONTROLE DE VERSÃO:
   Sempre que modificar este arquivo incremente HUB_VERSION em +1.
   ===================================================================== */
const HUB_VERSION = 36;
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
let diaryRequestToken = 0; // impede respostas antigas de sobrescreverem experiências/diário
let seriesSeasonsRequestToken = 0; // impede renderização de temporadas com experiências desatualizadas
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

const TMDB_STATUS_PT = {
  "Returning Series": "Em exibição",
  "Ended": "Finalizada",
  "Canceled": "Cancelada",
  "Cancelled": "Cancelada",
  "In Production": "Em produção",
  "Planned": "Planejada",
  "Pilot": "Piloto",
  "Rumored": "Rumorada",
  "Post Production": "Pós-produção",
  "Released": "Lançado",
  "On Hiatus": "Em pausa",
  "Airing": "Em exibição",
};
function translateTmdbStatus(value) {
  const raw = String(value || "").trim();
  return TMDB_STATUS_PT[raw] || raw;
}

// Tradução apenas para apresentação: os metadados originais do TMDB permanecem intactos.
const TMDB_COUNTRY_CODES = {
  "United States of America":"US", "United States":"US", "United Kingdom":"GB", "South Korea":"KR", "North Korea":"KP",
  "Russia":"RU", "Türkiye":"TR", "Turkey":"TR", "Czech Republic":"CZ", "Czechia":"CZ", "Taiwan":"TW",
  "Hong Kong":"HK", "Iran":"IR", "Syria":"SY", "Vietnam":"VN", "Laos":"LA", "Moldova":"MD",
  "Tanzania":"TZ", "Bolivia":"BO", "Venezuela":"VE", "Brunei":"BN", "Palestine":"PS", "Ivory Coast":"CI",
  "Côte d'Ivoire":"CI", "Democratic Republic of the Congo":"CD", "Republic of the Congo":"CG", "North Macedonia":"MK",
  "Swaziland":"SZ", "Eswatini":"SZ", "Micronesia":"FM", "Cape Verde":"CV", "Curaçao":"CW", "Kosovo":"XK",
  "Afghanistan":"AF", "Albania":"AL", "Algeria":"DZ", "Argentina":"AR", "Australia":"AU", "Austria":"AT",
  "Bangladesh":"BD", "Belgium":"BE", "Brazil":"BR", "Brasil":"BR", "Canada":"CA", "Chile":"CL", "China":"CN",
  "Colombia":"CO", "Croatia":"HR", "Cuba":"CU", "Denmark":"DK", "Egypt":"EG", "Finland":"FI", "France":"FR",
  "Germany":"DE", "Greece":"GR", "Hungary":"HU", "Iceland":"IS", "India":"IN", "Indonesia":"ID", "Iraq":"IQ",
  "Ireland":"IE", "Israel":"IL", "Italy":"IT", "Japan":"JP", "Kenya":"KE", "Malaysia":"MY", "Mexico":"MX",
  "Morocco":"MA", "Nepal":"NP", "Netherlands":"NL", "New Zealand":"NZ", "Nigeria":"NG", "Norway":"NO",
  "Pakistan":"PK", "Peru":"PE", "Philippines":"PH", "Poland":"PL", "Portugal":"PT", "Romania":"RO", "Saudi Arabia":"SA",
  "Serbia":"RS", "Singapore":"SG", "South Africa":"ZA", "Spain":"ES", "Sweden":"SE", "Switzerland":"CH", "Thailand":"TH",
  "Ukraine":"UA", "United Arab Emirates":"AE", "Uruguay":"UY", "Uzbekistan":"UZ", "Zimbabwe":"ZW"
};
function translateTmdbCountry(value) {
  const raw = String(value || "").trim();
  if (!raw) return raw;
  const code = TMDB_COUNTRY_CODES[raw] || (/^[A-Z]{2}$/.test(raw) ? raw : "");
  if (!code) return raw;
  try { return new Intl.DisplayNames(["pt-BR"], { type: "region" }).of(code) || raw; }
  catch (_) { return raw; }
}
function translateTmdbLanguage(value) {
  const raw = String(value || "").trim();
  if (!raw) return raw;
  try {
    const translated = new Intl.DisplayNames(["pt-BR"], { type: "language" }).of(raw.toLowerCase());
    return translated && translated.toLowerCase() !== raw.toLowerCase() ? translated : raw.toUpperCase();
  } catch (_) { return raw.toUpperCase(); }
}

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
  const type=item.mediaType==="tv"?"show":"movie";
  const existing=[...movies,...shows].find(x=>x.type===type&&String(x.id)===String(item.id));
  const disabled=!fbUser;
  const poster=item.posterUrl?`<img src="${esc(item.posterUrl)}" alt="Pôster de ${esc(item.title)}" loading="lazy">`:`<div class="discover-no-poster">Sem pôster</div>`;
  const actions=existing?`
    <div class="poster-quick-actions" aria-label="Editar ${esc(item.title)}">
      <button type="button" class="poster-action" data-edit-catalog="${esc(item.id)}" data-edit-type="${type}" title="Editar na biblioteca" aria-label="Editar na biblioteca">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m14 5 5 5M4 20l4.2-.9L19 8.3a2.1 2.1 0 0 0-3-3L5.2 16.1 4 20Z"/></svg>
      </button>
    </div>`:`
    <div class="poster-quick-actions" aria-label="Adicionar ${esc(item.title)}">
      <button type="button" class="poster-action" data-add-tmdb="${esc(item.id)}" data-media-type="${item.mediaType}" data-add-status="watching" title="Marcar como assistindo" aria-label="Marcar como assistindo" ${disabled?"disabled":""}>
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5.8v12.4L18 12 8 5.8Z"/></svg>
      </button>
      <button type="button" class="poster-action" data-add-tmdb="${esc(item.id)}" data-media-type="${item.mediaType}" data-add-status="plantowatch" title="Adicionar a Quero assistir" aria-label="Adicionar a Quero assistir" ${disabled?"disabled":""}>
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 4.8h12a1 1 0 0 1 1 1v14l-7-4-7 4v-14a1 1 0 0 1 1-1Z"/></svg>
      </button>
      <button type="button" class="poster-action" data-add-tmdb="${esc(item.id)}" data-media-type="${item.mediaType}" data-add-status="completed" title="Marcar como concluído" aria-label="Marcar como concluído" ${disabled?"disabled":""}>
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3.5a8.5 8.5 0 1 0 0 17 8.5 8.5 0 0 0 0-17Z"/><path d="m8.2 12.2 2.5 2.5 5.2-5.4"/></svg>
      </button>
      <button type="button" class="poster-action poster-action-manual" data-manual-add="${esc(item.id)}" data-media-type="${item.mediaType}" title="Adicionar manualmente" aria-label="Adicionar manualmente" ${disabled?"disabled":""}>
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>
      </button>
    </div>`;
  return `<article class="discover-card" tabindex="0" aria-label="Ver detalhes de ${esc(item.title)}" data-preview-id="${esc(item.id)}" data-preview-type="${item.mediaType}"><div class="discover-poster-wrap">${poster}${actions}${existing?'<span class="poster-in-library">Na biblioteca</span>':""}</div><div class="discover-card-info"><strong>${esc(item.title)}</strong><span>${item.year||"Ano desconhecido"} · ${type==="show"?"Série":"Filme"}</span><span class="discover-rating">★ ${Number(item.voteAverage||0).toFixed(1)}</span></div></article>`;
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
  try {
    const r = await fetch(`${TMDB_WORKER_URL}/api/tmdb/${mediaType}/${id}`, { signal: AbortSignal.timeout(15000) });
    if (!r.ok) throw new Error("Não foi possível carregar os detalhes. Tente novamente.");
    const d = await r.json();
    await openItem(id, type, d);
  } catch (e) {
    const dialog = $("dlg");
    if (dialog?.open) dialog.close();
    alert(e.name === "TimeoutError" || e.name === "AbortError" ? "A consulta ao catálogo demorou demais. Verifique sua conexão e tente novamente." : e.message);
  }
}

/* ---- Aba "Estatísticas" ---- */
function statsDonut(entries, total, centerLabel = "TOTAL") {
  const positive=entries.filter(x=>x[1]>0), colors=["#d9b477","#8f9db7","#c17b58","#8caa83","#a88dbb","#6eaaa7","#d2a45b"];
  if(!total||!positive.length)return `<div class="stats-donut-empty">Sem dados</div>`;
  let cursor=0; const stops=positive.map(([label,value],i)=>{const from=cursor;cursor+=value/total*100;return `${colors[i%colors.length]} ${from.toFixed(2)}% ${cursor.toFixed(2)}%`;});
  return `<div class="stats-donut" style="background:conic-gradient(${stops.join(",")})"><div class="stats-donut-hole"><strong>${total}</strong><small>${esc(centerLabel)}</small></div></div>`;
}
function statsLegend(entries,total){
  const colors=["#d9b477","#8f9db7","#c17b58","#8caa83","#a88dbb","#6eaaa7","#d2a45b"];
  return `<div class="stats-legend">${entries.map(([label,value],i)=>`<div><i style="--legend:${colors[i%colors.length]}"></i><span>${esc(label)}</span><b>${value} <small>${total?Math.round(value/total*100):0}%</small></b></div>`).join("")}</div>`;
}
function statsBars(entries,suffix=""){
  const max=Math.max(1,...entries.map(x=>x[1]));
  if(!entries.some(x=>x[1]>0))return `<p class="meta">Ainda não há dados suficientes.</p>`;
  return `<div class="stats-bars">${entries.map(([label,value])=>`<div class="stats-bar-row"><span>${esc(label)}</span><div><i style="width:${value/max*100}%"></i></div><b>${value}${suffix}</b></div>`).join("")}</div>`;
}
function formatWatchTime(minutes){
  const value=Math.max(0,Math.round(Number(minutes)||0));
  const days=Math.floor(value/1440),hours=Math.floor((value%1440)/60),mins=value%60;
  if(days)return `${days}d ${hours}h`;
  if(hours)return `${hours}h ${mins}min`;
  return `${mins}min`;
}
function getAverageEpisodeRuntime(item,seen=new Set()){
  if(!item||typeof item!=="object"||seen.has(item))return 0;
  seen.add(item);
  const keys=["episodeRunTime","episode_run_time","episodeRuntime","averageEpisodeRuntime","average_episode_runtime","runtime","runtimeMinutes","episode_runtime","duration"];
  for(const key of keys){
    const raw=item[key];
    if(Array.isArray(raw)){
      const values=raw.map(Number).filter(n=>Number.isFinite(n)&&n>0);
      if(values.length)return values.reduce((a,b)=>a+b,0)/values.length;
    }else if(raw!==undefined&&raw!==null&&raw!==""){
      const n=Number(raw);if(Number.isFinite(n)&&n>0)return n;
    }
  }
  // O Worker pode encapsular a resposta em diferentes envelopes.
  for(const key of ["data","tv","details","result","payload","response"]){
    const value=getAverageEpisodeRuntime(item[key],seen);
    if(value>0)return value;
  }
  return 0;
}
function findEpisodeArray(payload,seen=new Set()){
  if(!payload||typeof payload!=="object"||seen.has(payload))return [];
  seen.add(payload);
  if(Array.isArray(payload.episodes))return payload.episodes;
  for(const key of ["data","tv","details","result","payload","response"]){
    const found=findEpisodeArray(payload[key],seen);
    if(found.length)return found;
  }
  return [];
}
function getSeasonEpisodeRuntimeMap(payload,seasonNumber){
  const episodes=findEpisodeArray(payload),result=new Map();
  episodes.forEach(ep=>{
    const number=Number(ep?.episode_number??ep?.episodeNumber??ep?.number);
    const raw=ep?.runtime??ep?.episodeRunTime??ep?.episode_run_time??ep?.runtimeMinutes??ep?.runtime_minutes??ep?.duration;
    const runtime=Number(raw);
    if(Number.isInteger(number)&&number>0&&Number.isFinite(runtime)&&runtime>0){
      result.set(`${seasonNumber}:${number}`,runtime);
    }
  });
  return result;
}
const showRuntimeCache=new Map();
async function resolveShowEpisodeRuntimes(item,seasonNumbers=[]){
  const id=String(item?.id||"");
  if(!id)return {episodes:new Map(),average:0};
  const seasons=[...new Set(seasonNumbers.map(Number).filter(n=>Number.isInteger(n)&&n>=0))].sort((a,b)=>a-b);
  const cacheKey=`${id}:${seasons.join(",")}`;
  if(!showRuntimeCache.has(cacheKey)){
    showRuntimeCache.set(cacheKey,(async()=>{
      let average=getAverageEpisodeRuntime(item);
      const episodeRuntimes=new Map();
      let detailStatus="não consultado";
      try{
        const detailResponse=await fetch(`${TMDB_WORKER_URL}/api/tmdb/tv/${encodeURIComponent(id)}`,{signal:AbortSignal.timeout(12000)});
        detailStatus=String(detailResponse.status);
        if(detailResponse.ok){
          const detail=await detailResponse.json();
          average=getAverageEpisodeRuntime(detail)||average;
        }
      }catch(error){
        detailStatus=error?.name||error?.message||"erro de rede";
        console.warn(`[NEXUS tempo] Falha ao consultar detalhes da série ${id}:`,error);
      }
      // Prioriza a duração individual dos episódios; usa a média da série como fallback.
      const seasonResponses=await Promise.all(seasons.map(async number=>{
        try{
          const response=await fetch(`${TMDB_WORKER_URL}/api/tmdb/tv/${encodeURIComponent(id)}/season/${number}`,{signal:AbortSignal.timeout(12000)});
          if(!response.ok){
            console.warn(`[NEXUS tempo] Série ${id}, temporada ${number}: HTTP ${response.status}`);
            return {number,payload:null};
          }
          return {number,payload:await response.json()};
        }catch(error){
          console.warn(`[NEXUS tempo] Falha ao consultar série ${id}, temporada ${number}:`,error);
          return {number,payload:null};
        }
      }));
      seasonResponses.forEach(({number,payload})=>{
        getSeasonEpisodeRuntimeMap(payload,number).forEach((runtime,key)=>episodeRuntimes.set(key,runtime));
      });
      if(!average&&!episodeRuntimes.size){
        console.warn(`[NEXUS tempo] Nenhuma duração encontrada para ${item?.name||item?.title||id}. Detalhes HTTP: ${detailStatus}; temporadas consultadas: ${seasons.join(", ")||"nenhuma"}.`,{item});
      }
      return {episodes:episodeRuntimes,average};
    })());
  }
  return showRuntimeCache.get(cacheKey);
}
function renderStats(){
  const root=$("view"),token=(window.__statsRenderToken=(window.__statsRenderToken||0)+1);
  root.innerHTML=`<div class="stats-loading">Analisando sua biblioteca…</div>`;
  (async()=>{
    let logs=[];try{logs=await hubFB.getAllMediaLogs();}catch(err){console.warn("Falha ao carregar registros para estatísticas",err);}
    if(token!==window.__statsRenderToken||tab!=="stats")return;
    const catalog=[...movies,...shows],total=catalog.length;
    const byStatus=[["Concluídos",catalog.filter(i=>i.status==="completed").length],["Assistindo",catalog.filter(i=>i.status==="watching").length],["Quero assistir",catalog.filter(i=>i.status==="plantowatch").length],["Pausados",catalog.filter(i=>i.status==="paused").length],["Abandonados",catalog.filter(i=>i.status==="dropped").length]];
    const rated=catalog.filter(i=>Number(i.score)>0),average=rated.length?rated.reduce((s,i)=>s+Number(i.score),0)/rated.length:null;
    const journeys=logs.filter(x=>x.recordType==="journey"),diary=logs.filter(x=>x.recordType!=="journey"),completed=journeys.filter(x=>x.status==="completed");
    const rewatches=journeys.filter(x=>x.journeyType==="rewatch").length;
    const years={};completed.forEach(j=>{const m=String(j.endedAt||"").match(/^(\d{4})/);if(m)years[m[1]]=(years[m[1]]||0)+1;});
    const yearEntries=Object.entries(years).sort((a,b)=>Number(a[0])-Number(b[0])).slice(-8);
    const ratings=[["95–100",0],["90–94",0],["80–89",0],["70–79",0],["60–69",0],["0–59",0]];
    rated.forEach(i=>{const s=Number(i.score),n=s>=95?0:s>=90?1:s>=80?2:s>=70?3:s>=60?4:5;ratings[n][1]++;});
    const genreCounts={},countryCounts={};
    catalog.forEach(i=>{
      const gs=Array.isArray(i.genres)?i.genres:(typeof i.genres==="string"?i.genres.split(/[·,]/):[]);
      gs.forEach(g=>{const n=String(g?.name||g||"").trim();if(n)genreCounts[n]=(genreCounts[n]||0)+1;});
      const c=i.originCountry||i.origin_country||i.production_countries||i.productionCountries||i.country;
      if(Array.isArray(c))c.forEach(v=>countryCounts[v]=(countryCounts[v]||0)+1);else if(c)countryCounts[c]=(countryCounts[c]||0)+1;
    });
    const topGenres=Object.entries(genreCounts).sort((a,b)=>b[1]-a[1]).slice(0,7),topCountries=Object.entries(countryCounts).sort((a,b)=>b[1]-a[1]).slice(0,6);
    const seasonStats=journeys.reduce((a,j)=>{
      let map=j.seasons;if(typeof map==="string"){try{map=JSON.parse(map)}catch{map={}}}
      if(Array.isArray(map))map=Object.fromEntries(map.map((v,i)=>[String(v?.number??i+1),v]));
      if(map&&typeof map==="object")Object.values(map).forEach(s=>{const n=Array.isArray(s?.watchedEpisodes)?s.watchedEpisodes.length:0;a.episodes+=n;if(n)a.seasons++;});
      return a;
    },{episodes:0,seasons:0});
    // Estimativa de tempo: filmes usam jornadas concluídas; séries usam episódios
    // marcados como assistidos em cada jornada. Só calcula quando há duração conhecida.
    const catalogByKey=new Map(catalog.map(i=>[`${i.type}:${i.id}`,i]));
    let movieMinutes=0,showMinutes=0,movieViews=0,watchedEpisodes=0,unestimatedMovies=0,unestimatedEpisodes=0;
    completed.forEach(j=>{
      if(j.type!=="movie")return;
      const item=catalogByKey.get(`movie:${j.itemId}`),runtime=Number(item?.runtime||item?.duration||item?.runtimeMinutes||0);
      if(runtime>0){movieMinutes+=runtime;movieViews++;}else unestimatedMovies++;
    });
    const showJourneys=journeys.filter(j=>j.type==="show");
    // Use the dedicated shows collection as the primary lookup. This avoids
    // losing episode runtimes when the journey's itemId is stored with a
    // different primitive type or catalog key representation.
    const showsById=new Map(shows.map(item=>[String(item.id),item]));
    const showItems=[...new Map(showJourneys.map(j=>{
      const id=String(j.itemId??j.mediaId??j.tmdbId??"");
      const item=showsById.get(id)||catalogByKey.get(`show:${id}`);
      return [id,item];
    }).filter(([,item])=>Boolean(item))).values()];
    const seasonsByShowId=new Map();
    showJourneys.forEach(j=>{
      const id=String(j.itemId??j.mediaId??j.tmdbId??"");
      let map=j.seasons;
      if(typeof map==="string"){try{map=JSON.parse(map)}catch{map={}}}
      if(Array.isArray(map))map=Object.fromEntries(map.map((v,i)=>[String(v?.number??i+1),v]));
      const numbers=Object.keys(map&&typeof map==="object"?map:{}).map(Number).filter(Number.isFinite);
      seasonsByShowId.set(id,[...(seasonsByShowId.get(id)||[]),...numbers]);
    });
    const showRuntimes=new Map(await Promise.all(showItems.map(async item=>[String(item.id),await resolveShowEpisodeRuntimes(item,seasonsByShowId.get(String(item.id))||[])])));
    showJourneys.forEach(j=>{
      let map=j.seasons;
      if(typeof map==="string"){try{map=JSON.parse(map)}catch{map={}}}
      if(Array.isArray(map))map=Object.fromEntries(map.map((v,i)=>[String(v?.number??i+1),v]));
      const itemId=String(j.itemId??j.mediaId??j.tmdbId??"");
      const item=showsById.get(itemId)||catalogByKey.get(`show:${itemId}`);
      const runtimes=showRuntimes.get(String(item?.id??itemId))||{episodes:new Map(),average:0};
      if(map&&typeof map==="object")Object.entries(map).forEach(([seasonNumber,season])=>{
        const raw=season?.watchedEpisodes;
        const watched=[...new Set((Array.isArray(raw)?raw:[]).map(Number).filter(n=>Number.isInteger(n)&&n>0))];
        if(!watched.length)return;
        watchedEpisodes+=watched.length;
        watched.forEach(episodeNumber=>{
          const individual=runtimes.episodes.get(`${Number(seasonNumber)}:${episodeNumber}`)||0;
          const runtime=individual||runtimes.average||0;
          if(runtime>0)showMinutes+=runtime;
          else unestimatedEpisodes++;
        });
      });
    });
    const estimatedMinutes=movieMinutes+showMinutes;
    const statusTotal=byStatus.reduce((s,x)=>s+x[1],0),typeEntries=[["Filmes",movies.length],["Séries",shows.length]];
    const journeyEntries=[["Primeiras experiências",journeys.filter(j=>j.journeyType==="first").length],["Reassistidas",rewatches],["Retomadas",journeys.filter(j=>j.journeyType==="retry").length]];
    root.innerHTML=`
      <section class="stats-overview"><div class="stats-heading"><div><span class="eyebrow">SEU HISTÓRICO EM NÚMEROS</span><h2>Visão geral</h2><p>Uma leitura da sua biblioteca e das suas experiências.</p></div><span class="stats-updated">Dados da biblioteca</span></div>
      <div class="stats-kpis">
        <article class="stat-card"><small>Títulos na biblioteca</small><strong>${total}</strong><span>${movies.length} filmes · ${shows.length} séries</span></article>
        <article class="stat-card"><small>Concluídos</small><strong>${byStatus[0][1]}</strong><span>${total?Math.round(byStatus[0][1]/total*100):0}% do catálogo</span></article>
        <article class="stat-card"><small>Experiências registradas</small><strong>${journeys.length}</strong><span>${rewatches} reassistidas</span></article>
        <article class="stat-card"><small>Nota média pessoal</small><strong>${average===null?"—":average.toFixed(1)}<em>/100</em></strong><span>${rated.length} títulos avaliados</span></article></div></section>
      <section class="stats-section"><div class="stats-section-title"><span class="eyebrow">COMPOSIÇÃO</span><h2>Como sua biblioteca se distribui</h2></div><div class="stats-chart-grid">
        <article class="stats-panel"><h3>Filmes × Séries</h3><div class="stats-donut-layout">${statsDonut(typeEntries,total,"TÍTULOS")}${statsLegend(typeEntries,total)}</div></article>
        <article class="stats-panel"><h3>Status da biblioteca</h3><div class="stats-donut-layout">${statsDonut(byStatus,statusTotal,"TÍTULOS")}${statsLegend(byStatus,statusTotal)}</div></article>
        <article class="stats-panel"><h3>Distribuição das suas notas</h3><p class="stats-subtitle">Somente títulos com avaliação pessoal</p>${statsBars(ratings," títulos")}</article></div></section>
      <section class="stats-section"><div class="stats-section-title"><span class="eyebrow">ATIVIDADE</span><h2>Sua trajetória como espectador</h2></div><div class="stats-chart-grid">
        <article class="stats-panel"><h3>Experiências</h3><div class="stats-donut-layout">${statsDonut(journeyEntries,journeys.length,"JORNADAS")}${statsLegend(journeyEntries,journeys.length)}</div><div class="stats-mini-kpis"><div><strong>${completed.length}</strong><span>Experiências concluídas</span></div><div><strong>${diary.length}</strong><span>Registros no diário</span></div></div></article>
        <article class="stats-panel"><h3>Conclusões por ano</h3><p class="stats-subtitle">Data de término de cada experiência concluída</p>${yearEntries.length?statsBars(yearEntries,""): `<p class="meta">Ainda não há datas de conclusão suficientes.</p>`}</article>
        <article class="stats-panel"><h3>Progresso de séries</h3><div class="stats-big-number">${seasonStats.episodes}</div><p class="stats-subtitle">Episódios marcados como assistidos nas experiências</p><div class="stats-mini-kpis"><div><strong>${seasonStats.seasons}</strong><span>Temporadas com progresso</span></div><div><strong>${shows.length}</strong><span>Séries na biblioteca</span></div></div></article></div></section>
      <section class="stats-section"><div class="stats-section-title"><span class="eyebrow">TEMPO DE TELA</span><h2>Quanto tempo você passou assistindo</h2><p class="stats-subtitle">Uma estimativa baseada nas durações disponíveis e no seu histórico de experiências.</p></div>
        <div class="stats-time-hero"><div><span class="eyebrow">TEMPO ESTIMADO TOTAL</span><strong>${estimatedMinutes?formatWatchTime(estimatedMinutes):"—"}</strong><small>${estimatedMinutes?`${(estimatedMinutes/60).toFixed(1).replace(".",",")} horas de conteúdo`:"Ainda não há durações suficientes para estimar."}</small></div><div class="stats-time-icon">◷</div></div>
        <div class="stats-chart-grid stats-chart-grid-two stats-time-grid">
          <article class="stats-panel"><h3>Onde seu tempo foi investido</h3><div class="stats-donut-layout">${statsDonut([["Filmes",movieMinutes], ["Séries",showMinutes]],estimatedMinutes,"MINUTOS")}${statsLegend([["Filmes",movieMinutes], ["Séries",showMinutes]],estimatedMinutes)}</div></article>
          <article class="stats-panel"><h3>Detalhamento</h3><div class="stats-time-breakdown"><div><span>🎬 Tempo com filmes</span><strong>${formatWatchTime(movieMinutes)}</strong><small>${movieViews} experiências concluídas com duração conhecida</small></div><div><span>📺 Tempo com séries</span><strong>${formatWatchTime(showMinutes)}</strong><small>${watchedEpisodes} episódios registrados${unestimatedEpisodes?` · ${unestimatedEpisodes} sem duração`:''}</small></div></div></article>
        </div>
        ${(unestimatedMovies||unestimatedEpisodes)?`<p class="stats-footnote">Alguns registros não entraram na estimativa porque o catálogo não forneceu duração: ${unestimatedMovies} experiências de filmes e ${unestimatedEpisodes} episódios. O total considera apenas dados com duração conhecida.</p>`:""}
      </section>
      <section class="stats-section"><div class="stats-section-title"><span class="eyebrow">SEUS GOSTOS</span><h2>O que aparece mais na sua coleção</h2></div><div class="stats-chart-grid stats-chart-grid-two">
        <article class="stats-panel"><h3>Gêneros mais frequentes</h3>${topGenres.length?statsBars(topGenres," títulos"):`<p class="meta">Gêneros indisponíveis no catálogo.</p>`}</article>
        <article class="stats-panel"><h3>Países de origem</h3>${topCountries.length?statsBars(topCountries," títulos"):`<p class="meta">Países de origem indisponíveis.</p>`}</article></div></section>
      <p class="stats-footnote">Títulos contam cada obra uma única vez. Experiências e episódios são contabilizados separadamente por jornada, permitindo reconhecer reassistidas sem duplicar o total da biblioteca. Datas ausentes não entram no gráfico anual.</p>`;
  })();
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
  ++diaryRequestToken;
  ++seriesSeasonsRequestToken;
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
  // openTmdbPreview já buscou a ficha completa antes de chamar openItem.
  // Evita repetir a mesma requisição e deixar a janela presa no carregamento.
  if (!previewData && (!item.cast?.length || !item.genres?.length)) {
    try {
      const mediaType = isShow ? "tv" : "movie";
      const response = await fetch(`${TMDB_WORKER_URL}/api/tmdb/${mediaType}/${encodeURIComponent(id)}`, {
        signal: AbortSignal.timeout(12000)
      });
      if (response.ok) {
        const fresh = await response.json();
        Object.assign(item, fresh, { cover:fresh.posterUrl || item.cover, banner:fresh.backdropUrl || item.banner });
        if (inCatalog && window.hubFB && fbUser) {
          // A atualização auxiliar não deve impedir a abertura da ficha.
          hubFB.saveItemNote(id, type, fresh).catch(error => console.warn("Não foi possível salvar os metadados atualizados", error));
        }
      }
    } catch (error) { console.warn("Não foi possível atualizar a ficha do TMDB", error); }
  }

  if (requestToken !== modalRequestToken) return;
  let note = {};
  if (window.hubFB) {
    try {
      // Firestore pode demorar ou ficar sem resposta; a ficha deve continuar abrindo.
      note = await Promise.race([
        hubFB.getItemNote(id, type),
        new Promise(resolve => setTimeout(() => resolve({}), 7000))
      ]) || {};
    } catch (e) { console.warn("Não foi possível carregar as anotações pessoais", e); }
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
          <div class="custom-number score-number">
            <input type="number" id="input-item-score" min="0" max="100" step="1" value="${currentScore > 0 ? currentScore : ""}" placeholder="0–100" ${(!inCatalog || !fbUser) ? "disabled" : ""}>
            <span class="number-stepper" aria-label="Ajustar nota geral">
              <button type="button" data-score-step="-1" aria-label="Diminuir nota geral" ${(!inCatalog || !fbUser) ? "disabled" : ""}>−</button>
              <button type="button" data-score-step="1" aria-label="Aumentar nota geral" ${(!inCatalog || !fbUser) ? "disabled" : ""}>+</button>
            </span>
          </div>
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
          ${item.statusText ? `<div><small>SITUAÇÃO</small><strong>${esc(translateTmdbStatus(item.statusText))}</strong></div>` : ""}
          ${item.networks?.length ? `<div><small>EMISSORAS</small><strong>${esc(item.networks.join(" · "))}</strong></div>` : ""}
          ${item.productionCountries?.length ? `<div><small>PAÍS DE ORIGEM</small><strong>${esc(item.productionCountries.map(translateTmdbCountry).join(" · "))}</strong></div>` : ""}
          ${item.originalLanguage ? `<div><small>IDIOMA ORIGINAL</small><strong>${esc(translateTmdbLanguage(item.originalLanguage))}</strong></div>` : ""}
          ${item.crew?.length ? `<div><small>${isShow ? "PRODUÇÃO" : "DIREÇÃO"}</small><strong>${esc(item.crew.join(" · "))}</strong></div>` : ""}
        </div>
        <p class="diary-intro detail-overview">${esc(item.overview || "Sem sinopse disponível.")}</p>
        ${item.cast?.length ? `<div class="detail-cast"><h3>Elenco principal</h3><p>${esc(item.cast.join(" · "))}</p></div>` : ""}
        ${inCatalog && isOwner() ? `<div class="catalog-removal-actions"><button type="button" class="remove-catalog-btn" id="btn-remove-catalog">Remover da minha biblioteca</button><button type="button" class="delete-all-media-btn" id="btn-delete-all-media">Excluir todos os dados</button></div>` : !inCatalog ? `<div class="detail-add-controls"><label for="detail-add-status">Adicionar como</label><select id="detail-add-status" ${!fbUser?"disabled":""}><option value="plantowatch">Quero assistir</option><option value="watching">Assistindo</option><option value="completed">Concluído</option><option value="paused">Pausado</option><option value="dropped">Abandonado</option></select><button type="button" class="tmdb-add-btn" id="btn-add-preview" ${!fbUser?"disabled":""}>${fbUser?"Adicionar à minha biblioteca":"Entre para adicionar"}</button></div>` : ""}
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
    const approved = await showAppConfirm(
      `Remover “${item.title}” da sua biblioteca? Os registros do Diário serão preservados.`,
      "Remover da biblioteca?",
      "Remover",
      true
    );
    if (!approved) return;
    try { await hubFB.removeCatalogItem(id,type); await loadCatalog(); d.close(); }
    catch(err) { alert(`Não foi possível remover: ${err.code || err.message}`); }
  });
  $("btn-delete-all-media")?.addEventListener("click", async () => {
    if (!isOwner()) { alert("Somente o proprietário pode excluir os dados desta obra."); return; }
    const approved = await showAppConfirm(
      `Excluir permanentemente todos os dados de “${item.title}”? Isso apagará a obra da biblioteca, todas as experiências, o progresso de temporadas e episódios, avaliações e todos os registros do Diário. Esta ação não pode ser desfeita.`,
      "Excluir todos os dados?",
      "Excluir tudo",
      true
    );
    if (!approved) return;
    const button = $("btn-delete-all-media");
    if (button) { button.disabled = true; button.textContent = "Excluindo…"; }
    try {
      await hubFB.deleteAllItemData(id, type);
      await loadCatalog();
      d.close();
    } catch (err) {
      if (button) { button.disabled = false; button.textContent = "Excluir todos os dados"; }
      alert(`Não foi possível excluir todos os dados: ${err.code || err.message}`);
    }
  });
  $("btn-add-preview")?.addEventListener("click", async () => {
    if (!fbUser) return;
    const button = $("btn-add-preview");
    if (button) { button.disabled = true; button.textContent = "Adicionando…"; }
    try {
      await hubFB.addCatalogItem({ ...previewData, status:$("detail-add-status")?.value || "plantowatch" });
      await loadCatalog();
      // Mantém o modal aberto durante a transição da prévia para a ficha completa.
      // Fechar e reabrir aqui dispara o evento "close", que invalida o token
      // da nova abertura e pode deixar a interface presa em "Abrindo detalhes…".
      await openItem(id, type);
    } catch(err) {
      if (button) { button.disabled = false; button.textContent = "Adicionar à minha biblioteca"; }
      alert(`Não foi possível adicionar: ${err.code || err.message}`);
    }
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

  // Ajustes rápidos da nota geral: alteram 1 ponto por clique, sem salvar automaticamente.
  document.querySelectorAll("[data-score-step]").forEach(button => {
    button.addEventListener("click", () => {
      const input = $("input-item-score");
      if (!input || input.disabled) return;
      const current = input.value.trim() === "" ? 0 : Number(input.value);
      const next = Math.min(100, Math.max(0, (Number.isFinite(current) ? current : 0) + Number(button.dataset.scoreStep)));
      input.value = String(next);
      input.dispatchEvent(new Event("input", { bubbles: true }));
      input.dispatchEvent(new Event("change", { bubbles: true }));
    });
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
async function loadSeriesSeasons(showId, savedNote, selectedJourneyId = "") {
  const container = $("series-seasons-container");
  if (!container) return;
  const requestToken = ++seriesSeasonsRequestToken;

  try {
    let seasonsData = showSeasonsCache.get(showId);
    if (!seasonsData) {
      const response = await fetch(`${TMDB_WORKER_URL}/api/tmdb/tv/${encodeURIComponent(showId)}`);
      if (!response.ok) throw new Error(`TMDB respondeu com HTTP ${response.status}`);
      const detail = await response.json();
      seasonsData = await Promise.all((detail.seasons || []).map(async season => {
        const result = await fetch(`${TMDB_WORKER_URL}/api/tmdb/tv/${encodeURIComponent(showId)}/season/${season.seasonNumber}`);
        if (!result.ok) throw new Error(`Não foi possível carregar a temporada ${season.seasonNumber}.`);
        const data = await result.json();
        return { number: data.seasonNumber, name: data.name, episode_count: data.episodes?.length || season.episodeCount || 0,
          episodes: (data.episodes || []).map(ep => ({ number: ep.number, name: ep.name, overview: ep.overview, stillUrl: ep.stillUrl })) };
      }));
      showSeasonsCache.set(showId, seasonsData);
    }
    if (!seasonsData?.length) {
      container.innerHTML = `<div class="msg">Informações de temporadas indisponíveis no momento.</div>`;
      return;
    }

    const regularSeasons = seasonsData.filter(s => s.number > 0);
    const seasonsList = regularSeasons.length ? regularSeasons : seasonsData;
    // O progresso das experiências é público para leitura; autenticação é exigida
    // somente para editar. Visitantes também precisam carregar as jornadas para
    // enxergar os episódios já marcados pelo proprietário.
    const journeys = hubFB?.getItemJourneys ? await hubFB.getItemJourneys(showId, "show") : [];
    if (requestToken !== seriesSeasonsRequestToken ||
        !activeItem || String(activeItem.id) !== String(showId) || activeItem.type !== "show" ||
        !$("dlg")?.open) return;
    const selectedJourney = journeys.find(j => String(j.id) === String(selectedJourneyId)) || journeys.find(j => j.status === "in_progress") || journeys[0] || null;
    // Compatibilidade com dados legados: versões anteriores podem ter gravado
    // temporadas como array ou JSON textual. A interface e o Firestore usam um
    // mapa por número de temporada; normalizamos antes de qualquer alteração.
    const normalizeSeasonMap = value => {
      if (value && typeof value === "object" && !Array.isArray(value)) return value;
      if (Array.isArray(value)) {
        return Object.fromEntries(value.map((season, index) => [
          String(season?.number ?? index + 1),
          season && typeof season === "object" ? season : {}
        ]));
      }
      if (typeof value === "string" && value.trim()) {
        try {
          const parsed = JSON.parse(value);
          if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return parsed;
          if (Array.isArray(parsed)) return normalizeSeasonMap(parsed);
        } catch { /* dado legado não estruturado: começa vazio sem bloquear o progresso */ }
      }
      return {};
    };
    // Compatibilidade: registros antigos salvos na obra continuam visíveis caso não haja jornada.
    const savedSeasons = normalizeSeasonMap(selectedJourney?.seasons ?? (journeys.length ? {} : savedNote?.seasons));
    const saveSeasonData = async () => {
      if (!isOwner()) throw new Error("Somente o proprietário pode editar temporadas e episódios.");
      if (selectedJourney) await hubFB.updateJourney(selectedJourney.id, { seasons: savedSeasons });
      else await hubFB.saveItemNote(showId, "show", { seasons: savedSeasons });
    };

    container.innerHTML = `
      <h3 style="font:600 1.25rem var(--serif);margin:20px 0 10px">Temporadas &amp; Episódios</h3>
      ${journeys.length ? `<div class="season-journey-picker"><label for="season-journey-select">Progresso desta experiência</label><select id="season-journey-select">${journeys.map((j,i)=>`<option value="${esc(j.id)}" ${selectedJourney?.id===j.id?"selected":""}>Experiência ${String(journeys.length-i).padStart(2,"0")} — ${{in_progress:"Em andamento",paused:"Pausada",completed:"Concluída",abandoned:"Abandonada"}[j.status]||"Não definido"}</option>`).join("")}</select></div>` : `<p class="meta">${isOwner() ? "Inicie uma experiência para acompanhar temporadas separadamente." : "Ainda não há experiências registradas para esta obra."}</p>`}
      <div class="seasons-accordion">
        ${seasonsList.map(season => {
          const sn = String(season.number), data = savedSeasons[sn] || {};
          const episodes = season.episodes || Array.from({length:season.episode_count||0},(_,i)=>({number:i+1}));
          const watched = new Set(data.watchedEpisodes || []), total = episodes.length || season.episode_count || 0;
          const count = watched.size, pct = total ? Math.round(count/total*100) : 0, finished = total > 0 && count >= total;
          const scoreValue = data.score === 0 || data.score ? Number(data.score) : "";
          return `<section class="season-block" data-season="${sn}">
            <button type="button" class="season-header" data-toggle-season="${sn}" aria-expanded="false" aria-controls="season-content-${sn}">
              <span class="season-title"><strong>Temporada ${sn}</strong>${scoreValue !== "" ? ` · ${badge(scoreValue)}` : ""}</span>
              <span class="season-header-meta"><span>${count} / ${total} eps (${pct}%)</span><span class="season-progress-bar"><i style="width:${pct}%"></i></span><span class="season-chevron" aria-hidden="true">⌄</span></span>
            </button>
            <div class="season-content" id="season-content-${sn}" hidden>
              ${isOwner() ? `<div class="season-rating-grid">
                <label>Nota da temporada (0–100)<input class="season-score-input" type="number" min="0" max="100" step="1" value="${scoreValue}" placeholder="Não avaliada"></label>
                <label>Data de início${calendarPickerMarkup({name:"seasonStartedAt",value:data.startedAt||"",placeholder:"Selecionar data"})}</label>
                <label>Data de conclusão${calendarPickerMarkup({name:"seasonEndedAt",value:data.endedAt||"",placeholder:"Selecionar data"})}</label>
                <div class="season-save-row"><button type="button" class="btn-save-season-data" data-season="${sn}">Salvar temporada</button><span class="meta season-save-status" aria-live="polite"></span><button type="button" class="btn-toggle-season-watched" data-season="${sn}">${finished?"Desmarcar temporada":"Marcar temporada como assistida"}</button></div>
              </div>` : `<div class="season-readonly-meta">${scoreValue !== "" ? `Nota: ${scoreValue}/100` : "Sem avaliação"}${data.startedAt ? ` · Início: ${esc(data.startedAt)}` : ""}${data.endedAt ? ` · Conclusão: ${esc(data.endedAt)}` : ""}</div>`}
              ${finished ? `<small class="season-finished-note">Temporada concluída nesta experiência.</small>` : ""}
              <div class="episodes-grid">${episodes.map(ep=>`<button type="button" class="ep-btn ${watched.has(ep.number)?"watched":""}" ${!isOwner()?"disabled":""} data-season="${sn}" data-ep="${ep.number}" title="Episódio ${ep.number}">E${ep.number}</button>`).join("")}</div>
            </div>
          </section>`;
        }).join("")}
      </div>`;

    container.querySelector("#season-journey-select")?.addEventListener("change", e => loadSeriesSeasons(showId, savedNote, e.target.value));

    container.querySelectorAll("[data-toggle-season]").forEach(header => header.addEventListener("click", () => {
      const content = header.closest(".season-block")?.querySelector(".season-content");
      if (!content) return;
      content.hidden = !content.hidden;
      header.setAttribute("aria-expanded", String(!content.hidden));
    }));

    const refreshSeasonProgress = (block, data) => {
      const buttons = [...block.querySelectorAll(".ep-btn")], total = buttons.length;
      const count = (data.watchedEpisodes || []).length, pct = total ? Math.round(count/total*100) : 0;
      const finished = total > 0 && count >= total;
      const meta = block.querySelector(".season-header-meta > span"), bar = block.querySelector(".season-progress-bar i");
      if (meta) meta.textContent = `${count} / ${total} eps (${pct}%)`;
      if (bar) bar.style.width = `${pct}%`;
      const bulk = block.querySelector(".btn-toggle-season-watched");
      if (bulk) bulk.textContent = finished ? "Desmarcar temporada" : "Marcar temporada como assistida";
      return {total, finished};
    };

    // Salva nota e datas de cada temporada, dentro da experiência selecionada.
    container.querySelectorAll(".btn-save-season-data").forEach(btn => btn.addEventListener("click", async () => {
      const sn = btn.dataset.season, block = btn.closest(".season-block"), status = block.querySelector(".season-save-status");
      const raw = block.querySelector(".season-score-input").value.trim();
      const score = raw === "" ? null : Number(raw);
      if (score !== null && (!Number.isInteger(score) || score < 0 || score > 100)) { status.textContent = "A nota deve ser um número inteiro entre 0 e 100."; return; }
      const data = savedSeasons[sn] = savedSeasons[sn] || {watchedEpisodes:[]};
      if (score === null) delete data.score; else data.score = score;
      const nextStartedAt = block.querySelector('[name="seasonStartedAt"]').value;
      const nextEndedAt = block.querySelector('[name="seasonEndedAt"]').value;
      data.startedAtSource = nextStartedAt ? (nextStartedAt !== String(data.startedAt || "") ? "user" : (data.startedAtSource || "legacy")) : "unknown";
      data.endedAtSource = nextEndedAt ? (nextEndedAt !== String(data.endedAt || "") ? "user" : (data.endedAtSource || (data.endedAtAuto ? "automatic" : "legacy"))) : "unknown";
      data.startedAt = nextStartedAt;
      data.endedAt = nextEndedAt;
      delete data.endedAtAuto;
      status.textContent = "Salvando…"; btn.disabled = true;
      try {
        await saveSeasonData();
        const title = block.querySelector(".season-title");
        const scoreBadge = score !== null ? ` · ${badge(score)}` : "";
        title.innerHTML = `<strong>Temporada ${sn}</strong>${scoreBadge}`;
        status.textContent = "Temporada salva!";
      } catch (err) { status.textContent = `Erro ao salvar: ${err.message || err.code}`; }
      finally { btn.disabled = false; }
    }));

    // Marcar/desmarcar a temporada inteira também atualiza automaticamente a data de conclusão.
    container.querySelectorAll(".btn-toggle-season-watched").forEach(btn => btn.addEventListener("click", async () => {
      const sn = btn.dataset.season, block = btn.closest(".season-block"), buttons = [...block.querySelectorAll(".ep-btn")];
      if (!buttons.length) return;
      const data = savedSeasons[sn] = savedSeasons[sn] || {watchedEpisodes:[]};
      const wasFinished = buttons.every(ep => ep.classList.contains("watched"));
      const previous = [...(data.watchedEpisodes || [])];
      data.watchedEpisodes = wasFinished ? [] : buttons.map(ep => Number(ep.dataset.ep));
      if (!wasFinished) {
        if (!data.startedAt) { data.startedAt = localDateISO(); data.startedAtSource = "automatic"; }
        if (!data.endedAt || data.endedAtAuto) { data.endedAt = localDateISO(); data.endedAtAuto = true; data.endedAtSource = "automatic"; }
      } else if (data.endedAtAuto) { data.endedAt = ""; data.endedAtAuto = false; data.endedAtSource = "unknown"; }
      buttons.forEach(ep => ep.classList.toggle("watched", !wasFinished));
      btn.disabled = true;
      try {
        await saveSeasonData();
        refreshSeasonProgress(block, data);
        const start = block.querySelector('[name="seasonStartedAt"]'), end = block.querySelector('[name="seasonEndedAt"]');
        if (start) setCalendarValue(start.closest(".hub-calendar"), data.startedAt || "");
        if (end) setCalendarValue(end.closest(".hub-calendar"), data.endedAt || "");
        btn.textContent = wasFinished ? "Marcar temporada como assistida" : "Desmarcar temporada";
      } catch (err) {
        data.watchedEpisodes = previous;
        buttons.forEach(ep => ep.classList.toggle("watched", previous.includes(Number(ep.dataset.ep))));
        refreshSeasonProgress(block, data);
        alert(`Não foi possível salvar a temporada: ${err.message || err.code}`);
      } finally { btn.disabled = false; }
    }));

    // Marcação individual: primeira visualização registra início; conclusão de todos os episódios registra término.
    container.querySelectorAll(".ep-btn").forEach(btn => btn.addEventListener("click", async () => {
      const sn = btn.dataset.season, epNum = Number(btn.dataset.ep), block = btn.closest(".season-block");
      const data = savedSeasons[sn] = savedSeasons[sn] || {watchedEpisodes:[]};
      const set = new Set(data.watchedEpisodes || []), wasWatched = set.has(epNum);
      if (wasWatched) set.delete(epNum); else set.add(epNum);
      const previous = [...(data.watchedEpisodes || [])];
      data.watchedEpisodes = [...set];
      if (!wasWatched && !data.startedAt) { data.startedAt = localDateISO(); data.startedAtSource = "automatic"; }
      const total = block.querySelectorAll(".ep-btn").length;
      if (total > 0 && set.size >= total) {
        if (!data.endedAt || data.endedAtAuto) { data.endedAt = localDateISO(); data.endedAtAuto = true; }
      } else if (data.endedAtAuto) { data.endedAt = ""; data.endedAtAuto = false; data.endedAtSource = "unknown"; }
      btn.classList.toggle("watched", !wasWatched);
      btn.disabled = true;
      try {
        await saveSeasonData();
        refreshSeasonProgress(block, data);
        const start = block.querySelector('[name="seasonStartedAt"]'), end = block.querySelector('[name="seasonEndedAt"]');
        if (start) setCalendarValue(start.closest(".hub-calendar"), data.startedAt || "");
        if (end) setCalendarValue(end.closest(".hub-calendar"), data.endedAt || "");
      } catch (err) {
        data.watchedEpisodes = previous;
        btn.classList.toggle("watched", wasWatched);
        refreshSeasonProgress(block, data);
        alert(`Não foi possível salvar o episódio: ${err.message || err.code}`);
      } finally { btn.disabled = false; }
    }));
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


function calendarPickerMarkup({name="",id="",value="",placeholder="Selecionar data"}={}) {
  const field = name ? `name="${esc(name)}"` : `id="${esc(id)}"`;
  const shown = value ? diaryDate(value) : placeholder;
  return `<div class="hub-calendar" data-calendar>
    <input type="hidden" ${field} value="${esc(value)}">
    <button type="button" class="hub-calendar-trigger" data-calendar-open aria-haspopup="dialog" aria-expanded="false">
      <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3.5" y="5" width="17" height="15.5" rx="2"/><path d="M7.5 3.5v3M16.5 3.5v3M3.5 9.5h17"/></svg>
      <span>${esc(shown)}</span><span class="hub-calendar-chevron">⌄</span>
    </button><div class="hub-calendar-popover" data-calendar-popover hidden></div>
  </div>`;
}
function calendarMonthMarkup(root, monthDate) {
  const year=monthDate.getFullYear(), month=monthDate.getMonth();
  const first=new Date(year,month,1), offset=first.getDay(), days=new Date(year,month+1,0).getDate();
  const input=root.querySelector('input[type="hidden"]'), selected=input?.value||"";
  const today=localDateISO();
  const cells=[];
  for(let i=0;i<offset;i++) cells.push('<span class="hub-calendar-empty"></span>');
  for(let day=1;day<=days;day++){
    const iso=`${year}-${String(month+1).padStart(2,"0")}-${String(day).padStart(2,"0")}`;
    cells.push(`<button type="button" class="hub-calendar-day ${iso===selected?"is-selected":""} ${iso===today?"is-today":""}" data-calendar-day="${iso}">${day}</button>`);
  }
  const monthNames=["Janeiro","Fevereiro","Março","Abril","Maio","Junho","Julho","Agosto","Setembro","Outubro","Novembro","Dezembro"];
  const currentYear=new Date().getFullYear();
  const yearOptions=Array.from({length:currentYear+10-1900+1},(_,i)=>1900+i).map(y=>`<option value="${y}" ${y===year?"selected":""}>${y}</option>`).join("");
  return `<div class="hub-calendar-head"><button type="button" data-calendar-prev aria-label="Mês anterior">‹</button><select class="hub-calendar-month" data-calendar-month aria-label="Selecionar mês">${monthNames.map((m,i)=>`<option value="${i}" ${i===month?"selected":""}>${m}</option>`).join("")}</select><select class="hub-calendar-year" data-calendar-year aria-label="Selecionar ano">${yearOptions}</select><button type="button" data-calendar-next aria-label="Próximo mês">›</button></div>
    <div class="hub-calendar-week">${["D","S","T","Q","Q","S","S"].map(x=>`<span>${x}</span>`).join("")}</div>
    <div class="hub-calendar-grid">${cells.join("")}</div>
    <div class="hub-calendar-foot"><button type="button" data-calendar-clear>Limpar</button><button type="button" data-calendar-today>Hoje</button></div>`;
}
function setCalendarValue(root,value) {
  const input=root.querySelector('input[type="hidden"]'), label=root.querySelector('.hub-calendar-trigger span');
  if(!input||!label)return;
  input.value=value;
  label.textContent=value?diaryDate(value):"Selecionar data";
  input.dispatchEvent(new Event("change",{bubbles:true}));
  root.querySelector('[data-calendar-popover]').hidden=true;
  root.querySelector('[data-calendar-open]').setAttribute("aria-expanded","false");
}
document.addEventListener("change",e=>{
  if(!e.target.matches("[data-calendar-month], [data-calendar-year]")) return;
  const pop=e.target.closest("[data-calendar-popover]"), root=pop?.closest("[data-calendar]");
  if(!pop||!root) return;
  const current=new Date((pop.dataset.month||localDateISO().slice(0,7)+"-01")+"T12:00:00");
  const month=Number(pop.querySelector("[data-calendar-month]")?.value ?? current.getMonth());
  const year=Number(pop.querySelector("[data-calendar-year]")?.value ?? current.getFullYear());
  const next=new Date(year,month,1);
  pop.dataset.month=`${next.getFullYear()}-${String(next.getMonth()+1).padStart(2,"0")}-01`;
  pop.innerHTML=calendarMonthMarkup(root,next);
});

document.addEventListener("click",e=>{
  const open=e.target.closest("[data-calendar-open]");
  if(open){
    const root=open.closest("[data-calendar]"), pop=root.querySelector("[data-calendar-popover]");
    document.querySelectorAll("[data-calendar-popover]").forEach(p=>{if(p!==pop)p.hidden=true;});
    const current=root.querySelector('input[type="hidden"]').value;
    const d=current?new Date(current+"T12:00:00"):new Date();
    pop.dataset.month=`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-01`;
    pop.innerHTML=calendarMonthMarkup(root,d);pop.hidden=false;open.setAttribute("aria-expanded","true");return;
  }
  const pop=e.target.closest("[data-calendar-popover]");
  if(pop){
    const root=pop.closest("[data-calendar]"), base=new Date((pop.dataset.month||localDateISO().slice(0,7)+"-01")+"T12:00:00");
    if(e.target.closest("[data-calendar-prev]")||e.target.closest("[data-calendar-next]")){
      base.setMonth(base.getMonth()+(e.target.closest("[data-calendar-prev]")?-1:1));
      pop.dataset.month=`${base.getFullYear()}-${String(base.getMonth()+1).padStart(2,"0")}-01`;
      pop.innerHTML=calendarMonthMarkup(root,base);return;
    }
    const day=e.target.closest("[data-calendar-day]");
    if(day){setCalendarValue(root,day.dataset.calendarDay);return;}
    if(e.target.closest("[data-calendar-clear]")){setCalendarValue(root,"");return;}
    if(e.target.closest("[data-calendar-today]")){setCalendarValue(root,localDateISO());return;}
    return;
  }
  document.querySelectorAll("[data-calendar-popover]").forEach(p=>{p.hidden=true;p.closest("[data-calendar]")?.querySelector("[data-calendar-open]")?.setAttribute("aria-expanded","false");});
});

function diaryDate(value) {
  if (!value) return "Data não informada";
  const d = new Date(value + "T12:00:00");
  return Number.isNaN(d.getTime()) ? value : d.toLocaleDateString("pt-BR");
}


function showAppConfirm(message, title = "Confirmar ação", confirmLabel = "Confirmar", danger = false) {
  return new Promise(resolve => {
    let dialog = document.getElementById("app-confirm-dialog");
    if (!dialog) {
      dialog = document.createElement("dialog");
      dialog.id = "app-confirm-dialog";
      dialog.className = "app-confirm-dialog";
      dialog.innerHTML = `<form method="dialog" class="app-confirm-card"><div class="app-confirm-mark">!</div><h3 class="app-confirm-title"></h3><p class="app-confirm-message"></p><div class="app-confirm-actions"><button value="cancel" class="app-confirm-cancel">Cancelar</button><button value="confirm" class="app-confirm-ok">Confirmar</button></div></form>`;
      document.body.appendChild(dialog);
    }
    dialog.querySelector(".app-confirm-title").textContent = title;
    dialog.querySelector(".app-confirm-message").textContent = message;
    const confirmButton = dialog.querySelector(".app-confirm-ok");
    confirmButton.textContent = confirmLabel;
    confirmButton.classList.toggle("is-danger", danger);
    const done = value => { dialog.removeEventListener("close", onClose); resolve(value); };
    const onClose = () => done(dialog.returnValue === "confirm");
    dialog.addEventListener("close", onClose, { once: true });
    dialog.showModal();
  });
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
        <div class="journey-card-meta"><span>${Number(j.score)>0?`Nota ${j.score}/100`:"Sem nota individual"}</span></div>
        <div class="diary-actions"><button type="button" data-toggle-journey="${esc(j.id)}" aria-expanded="false">Editar experiência</button>
        ${j.status==="in_progress"?`<button type="button" data-journey-status="paused" data-journey-id="${esc(j.id)}">Pausar</button><button type="button" data-journey-status="completed" data-journey-id="${esc(j.id)}">Concluir</button><button type="button" data-journey-status="abandoned" data-journey-id="${esc(j.id)}">Abandonar</button>`:j.status==="paused"?`<button type="button" data-journey-status="in_progress" data-journey-id="${esc(j.id)}" ${active.length?"disabled":""}>Retomar</button>`:""}
        <button type="button" class="journey-delete-btn" data-delete-journey="${esc(j.id)}">Excluir experiência</button></div>
        <form class="journey-inline-form hidden" data-journey-form="${esc(j.id)}">
          <div class="journey-edit-grid">
            <label>Status<select name="status"><option value="in_progress" ${j.status==="in_progress"?"selected":""}>Em andamento</option><option value="paused" ${j.status==="paused"?"selected":""}>Pausada</option><option value="completed" ${j.status==="completed"?"selected":""}>Concluída</option><option value="abandoned" ${j.status==="abandoned"?"selected":""}>Abandonada</option></select></label>
            <label>Nota individual (0–100)<div class="custom-number"><input name="score" type="number" min="0" max="100" step="1" value="${Number(j.score)>0?Number(j.score):""}" placeholder="Não avaliada"><span class="number-stepper"><button type="button" data-number-step="-1" aria-label="Diminuir nota">−</button><button type="button" data-number-step="1" aria-label="Aumentar nota">+</button></span></div></label>
            <label>Data de início${calendarPickerMarkup({name:"startedAt",value:j.startedAt||""})}<small>Deixe em branco se não souber.</small></label><label>Data de conclusão${calendarPickerMarkup({name:"endedAt",value:j.endedAt||""})}<small>Informe quando terminou; pode ficar em branco.</small></label>
            <label class="journey-edit-wide">Observações desta experiência<textarea name="notes" rows="4" maxlength="10000" placeholder="Anotações sobre esta jornada…">${esc(j.notes||"")}</textarea></label>
          </div><div class="journey-edit-footer"><span class="diary-status" role="status"></span><button type="button" data-cancel-journey="${esc(j.id)}">Cancelar</button><button type="submit" class="journey-save-btn">Salvar alterações</button></div>
        </form>
      </article>`).join(""):`<div class="msg">Você ainda não iniciou nenhuma experiência com esta obra.</div>`}</div>
    </section>` : `<section class="journey-panel"><h3>Minhas experiências</h3><div class="journey-list">${journeys.map(j=>`<article class="journey-card"><strong>${label(j)}</strong><small>${statusText[j.status]||j.status||""}</small></article>`).join("")}</div></section>`;
  const form = editable ? `<p class="diary-intro">Registre suas impressões ${isShow?"episódio por episódio":"sobre o filme"}.</p><form class="diary-form" id="diary-form">
    <div class="wide-field diary-journey-field"><label id="diary-journey-label">Experiência</label><select id="diary-journey" class="diary-journey-native" required tabindex="-1" aria-hidden="true">${journeys.map(j=>`<option value="${esc(j.id)}">${label(j)} — ${statusText[j.status]||"Não definido"}</option>`).join("")}</select><div class="diary-select"><button type="button" class="diary-select-trigger" aria-haspopup="listbox" aria-expanded="false" aria-labelledby="diary-journey-label diary-journey-value" ${journeys.length?"":"disabled"}><span id="diary-journey-value">${journeys.length?`${label(journeys[0])} — ${statusText[journeys[0].status]||"Não definido"}`:"Nenhuma experiência disponível"}</span><span class="diary-select-chevron" aria-hidden="true">⌄</span></button><div class="diary-select-menu" role="listbox" aria-labelledby="diary-journey-label" hidden>${journeys.map((j,i)=>`<button type="button" class="diary-select-option ${i===0?"is-selected":""}" role="option" aria-selected="${i===0}" data-journey-option="${esc(j.id)}">${label(j)} — ${statusText[j.status]||"Não definido"}</button>`).join("")}</div></div>${journeys.length?"":`<small>Inicie uma experiência em “Minhas experiências” para adicionar registros vinculados.</small>`}</div>
    ${isShow?`<div><label for="diary-episode">Episódio</label><input id="diary-episode" type="number" min="0" step="1" value="1" required></div>`:""}
    <div class="diary-date-field"><label for="diary-date">Data</label>${calendarPickerMarkup({id:"diary-date",value:localDateISO()})}<label class="diary-forgot-label"><input id="diary-forgot" type="checkbox"> <span>Esqueci a data</span></label></div>
    <div class="wide-field"><label for="diary-comment">Seu comentário</label><textarea id="diary-comment" maxlength="10000" placeholder="O que achou?" required></textarea></div><button type="submit" ${journeys.length?"":"disabled"}>Adicionar registro</button><span class="diary-status" id="diary-status" role="status"></span></form>` : `<p class="diary-intro">Diário público de impressões.</p>`;
  $("experiences-content").innerHTML = journeyPanel;
  $("diary-content").innerHTML = form + `<h3 style="font:600 1.2rem var(--serif);margin:0 0 12px">Registros <span class="meta">${diaryLogs.length} registro(s)</span></h3><div class="diary-list">${diaryLogs.length?diaryLogs.map(log=>`<article class="diary-entry" data-log-entry="${esc(log.id)}"><div class="diary-entry-head"><strong>${isShow?`Episódio ${Number(log.episode)||"?"}`:"Sessão"}</strong><span class="meta">${diaryDate(log.watchedAt)}</span></div><p>${esc(log.comment)}</p><small>${journeys.some(j=>j.id===log.journeyId)?label(journeys.find(j=>j.id===log.journeyId)):"Registro antigo — sem experiência vinculada"}</small>${editable?`<div class="diary-actions"><button type="button" data-edit-log="${esc(log.id)}">Editar</button><button type="button" data-delete-log="${esc(log.id)}">Excluir</button></div>`:""}</article>`).join(""):`<div class="msg">Ainda não há registros para este título.</div>`}</div>`;
  if (!editable) return;

  // Seletor de experiência com identidade visual do Hub (sem realce azul nativo).
  const diarySelect = $("diary-content")?.querySelector(".diary-select");
  if (diarySelect) {
    const trigger = diarySelect.querySelector(".diary-select-trigger");
    const menu = diarySelect.querySelector(".diary-select-menu");
    const nativeSelect = $("diary-journey");
    trigger?.addEventListener("click", () => {
      const opening = menu.hidden;
      menu.hidden = !opening;
      trigger.setAttribute("aria-expanded", String(opening));
    });
    menu?.querySelectorAll("[data-journey-option]").forEach(option => option.addEventListener("click", () => {
      nativeSelect.value = option.dataset.journeyOption;
      $("diary-journey-value").textContent = option.textContent;
      menu.querySelectorAll(".diary-select-option").forEach(item => {
        const selected = item === option;
        item.classList.toggle("is-selected", selected);
        item.setAttribute("aria-selected", String(selected));
      });
      menu.hidden = true;
      trigger.setAttribute("aria-expanded", "false");
      nativeSelect.dispatchEvent(new Event("change", {bubbles:true}));
    }));
    document.addEventListener("click", event => {
      if (!diarySelect.contains(event.target)) {
        menu.hidden = true;
        trigger?.setAttribute("aria-expanded", "false");
      }
    }, {once:false});
  }

  $("btn-new-journey")?.addEventListener("click", async ev=>{const b=ev.currentTarget;b.disabled=true;b.textContent="Criando…";try{await hubFB.createJourney({itemId:id,type});await loadCatalog();await loadDiary(id,type);}catch(err){alert(`Não foi possível iniciar a experiência: ${err.message||err.code}`);b.disabled=false;b.textContent="+ Iniciar nova experiência";}});

  const experienceRoot = $("experiences-content");
  experienceRoot.onclick = async e => {
    const stepButton = e.target.closest("[data-number-step]");
    if (stepButton) {
      const input = stepButton.closest(".custom-number")?.querySelector("input");
      if (input) {
        const min = input.min === "" ? -Infinity : Number(input.min);
        const max = input.max === "" ? Infinity : Number(input.max);
        const next = Math.min(max, Math.max(min, (Number(input.value) || 0) + Number(stepButton.dataset.numberStep)));
        input.value = String(next);
        input.dispatchEvent(new Event("input", { bubbles: true }));
        input.dispatchEvent(new Event("change", { bubbles: true }));
      }
      return;
    }
    const toggle = e.target.closest("[data-toggle-journey]");
    if (toggle) {
      const idToOpen = toggle.dataset.toggleJourney;
      experienceRoot.querySelectorAll("[data-journey-form]").forEach(form => {
        const opening = form.dataset.journeyForm === idToOpen && form.classList.contains("hidden");
        form.classList.toggle("hidden", !opening);
        const button = experienceRoot.querySelector(`[data-toggle-journey="${CSS.escape(form.dataset.journeyForm)}"]`);
        button?.setAttribute("aria-expanded", String(opening));
      });
      return;
    }
    const cancel = e.target.closest("[data-cancel-journey]");
    if (cancel) { const form=experienceRoot.querySelector(`[data-journey-form="${CSS.escape(cancel.dataset.cancelJourney)}"]`); form?.classList.add("hidden"); experienceRoot.querySelector(`[data-toggle-journey="${CSS.escape(cancel.dataset.cancelJourney)}"]`)?.setAttribute("aria-expanded","false"); return; }
    const del = e.target.closest("[data-delete-journey]");
    if (del) {
      const journey = journeys.find(x=>String(x.id)===String(del.dataset.deleteJourney));
      if (!journey || !(await showAppConfirm("A experiência será excluída permanentemente. Os registros do Diário serão preservados, mas ficarão sem vínculo com ela.", "Excluir experiência?"))) return;
      del.disabled=true; del.textContent="Excluindo…";
      try { await hubFB.deleteJourney(journey.id); await loadCatalog(); await loadDiary(id,type); }
      catch(err) { alert(`Não foi possível excluir a experiência: ${err.message||err.code}`); del.disabled=false; del.textContent="Excluir experiência"; }
      return;
    }
    const action=e.target.closest("[data-journey-status]");
    if(action){action.disabled=true;const status=action.dataset.journeyStatus;try{await hubFB.updateJourney(action.dataset.journeyId,{status,...(status==="completed"||status==="abandoned"?{endedAt:localDateISO(),endedAtSource:"automatic"}:{})});await loadCatalog();await loadDiary(id,type);}catch(err){alert(`Não foi possível atualizar: ${err.message||err.code}`);action.disabled=false;}return;}
  };
  experienceRoot.onsubmit = async e => {
    const form=e.target.closest("[data-journey-form]"); if(!form)return; e.preventDefault();
    const d=new FormData(form), status=String(d.get("status")||"in_progress"), raw=String(d.get("score")||"").trim(), score=raw===""?0:Number(raw), msg=form.querySelector(".diary-status");
    if(!Number.isInteger(score)||score<0||score>100){msg.textContent="A nota deve estar entre 0 e 100.";return;}
    const payload={status,score,startedAt:String(d.get("startedAt")||""),endedAt:String(d.get("endedAt")||""),notes:String(d.get("notes")||"").trim()};
    if(["completed","abandoned"].includes(journeys.find(j=>String(j.id)===form.dataset.journeyForm)?.status)&&["in_progress","paused"].includes(status)){msg.textContent="Uma experiência encerrada não pode ser reaberta.";return;}
    if(status==="in_progress"||status==="paused")payload.endedAt="";
    const save=form.querySelector('button[type="submit"]');save.disabled=true;msg.textContent="Salvando…";
    try{await hubFB.updateJourney(form.dataset.journeyForm,payload);await loadCatalog();await loadDiary(id,type);}catch(err){msg.textContent=err.message||err.code||"Erro ao salvar.";save.disabled=false;}
  };

  $("diary-form")?.addEventListener("submit",async ev=>{ev.preventDefault();const status=$("diary-status"),episode=isShow?Number($("diary-episode").value):null,watchedAt=$("diary-forgot").checked?"":$("diary-date").value,comment=$("diary-comment").value.trim();if(!comment){status.textContent="Preencha o comentário.";return;}const submit=ev.currentTarget.querySelector('button[type="submit"]');submit.disabled=true;status.textContent="Salvando…";try{const journeyId=$("diary-journey")?.value;if(!journeyId)throw new Error("Inicie uma experiência antes de registrar.");await hubFB.addItemLog({itemId:id,type,journeyId,episode,watchedAt,comment});await loadDiary(id,type);}catch(err){status.textContent="Não foi possível salvar: "+(err.code||err.message);submit.disabled=false;}});
  $("diary-content").onsubmit=async ev=>{const f=ev.target.closest("[data-save-log]");if(!f)return;ev.preventDefault();const d=new FormData(f),payload={comment:String(d.get("comment")||"").trim(),watchedAt:String(d.get("watchedAt")||"")};if(isShow){payload.episode=Number(d.get("episode"));if(!Number.isInteger(payload.episode)||payload.episode<0){alert("Número de episódio inválido.");return;}}if(!payload.comment){alert("O comentário não pode ficar vazio.");return;}const b=f.querySelector('button[type="submit"]');b.disabled=true;try{await hubFB.updateItemLog(f.dataset.saveLog,payload);await loadDiary(id,type);}catch(err){b.disabled=false;alert(`Não foi possível editar: ${err.code||err.message}`);}};
  $("diary-content").onclick=async e=>{const edit=e.target.closest("[data-edit-log]");if(edit){const log=logs.find(x=>String(x.id)===String(edit.dataset.editLog)),article=edit.closest("[data-log-entry]");if(!log||!article)return;article.innerHTML=`<form class="diary-edit-form" data-save-log="${esc(log.id)}"><label>Experiência<select name="journeyId"><option value="">Sem vínculo</option>${journeys.map(j=>`<option value="${esc(j.id)}" ${String(log.journeyId||"")===String(j.id)?"selected":""}>${label(j)} — ${statusText[j.status]||"Não definido"}</option>`).join("")}</select></label>${isShow?`<label>Episódio<input name="episode" type="number" min="0" step="1" value="${Number(log.episode)||1}" required></label>`:""}<label>Data${calendarPickerMarkup({name:"watchedAt",value:log.watchedAt||""})}</label><label>Comentário<textarea name="comment" maxlength="10000" required>${esc(log.comment||"")}</textarea></label><div class="diary-actions"><button type="submit">Salvar alterações</button><button type="button" data-cancel-edit>Cancelar</button></div></form>`;return;}if(e.target.closest("[data-cancel-edit]")){await loadDiary(id,type);return;}const del=e.target.closest("[data-delete-log]");if(del){if(!(await showAppConfirm("Este registro será excluído permanentemente do Diário.","Excluir registro?","Excluir",true)))return;del.disabled=true;try{await hubFB.deleteItemLog(del.dataset.deleteLog);await loadDiary(id,type);}catch(err){alert("Não foi possível excluir: "+(err.code||err.message));del.disabled=false;}}};
}

async function loadDiary(id, type) {
  const requestToken = ++diaryRequestToken;
  const diaryRoot = $("diary-content");
  const experiencesRoot = $("experiences-content");
  if (diaryRoot) {
    diaryRoot.className = "msg";
    diaryRoot.textContent = "Carregando diário…";
  }
  if (experiencesRoot) {
    experiencesRoot.className = "msg";
    experiencesRoot.textContent = "Atualizando experiências…";
  }
  try {
    // getItemLogs consulta o servidor (com fallback offline). O token impede que
    // uma leitura iniciada antes de uma alteração/tabulação sobrescreva dados novos.
    const logs = await hubFB.getItemLogs(id, type);
    const sameItemIsOpen = $("dlg")?.open &&
      String(activeItem?.id) === String(id) &&
      String(activeItem?.type) === String(type);
    if (requestToken !== diaryRequestToken || !sameItemIsOpen) return;
    renderDiaryEntries(id, type, logs);
    // A aba de experiências pode criar/editar/excluir jornadas. Reconstrua também
    // o seletor de progresso e os episódios com a lista mais recente do Firebase.
    if (type === "show") {
      let latestNote = {};
      try { latestNote = await hubFB.getItemNote(id, type); } catch (_) {}
      if (requestToken !== diaryRequestToken || !sameItemIsOpen) return;
      const selected = $("season-journey-select")?.value || "";
      await loadSeriesSeasons(id, latestNote, selected);
    }
  } catch (err) {
    if (requestToken !== diaryRequestToken) return;
    const message = `Não consegui atualizar as experiências e o diário (${esc(err.code || err.message)}).`;
    if (experiencesRoot) experiencesRoot.innerHTML = `<div class="msg err">${message}</div>`;
    if (diaryRoot) diaryRoot.innerHTML = `<div class="msg err">${message}</div>`;
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
    const calendar = dateField?.closest("[data-calendar]");
    const trigger = calendar?.querySelector("[data-calendar-open]");
    if (forgot.checked) setCalendarValue(calendar, "");
    else if (!dateField.value) setCalendarValue(calendar, localDateISO());
    if (trigger) {
      trigger.disabled = forgot.checked;
      trigger.setAttribute("aria-disabled", String(forgot.checked));
    }
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
  const page=e.target.closest("[data-discover-page]");if(page){discoverPage=Math.max(1,discoverPage+(page.dataset.discoverPage==="next"?1:-1));renderDiscover();window.scrollTo({top:0,behavior:"smooth"});return;}
  const searchPageButton=e.target.closest("[data-search-page]");if(searchPageButton){runDiscoverSearch(Math.max(1,searchPage+(searchPageButton.dataset.searchPage==="next"?1:-1)));return;}
  if(e.target.closest("[data-discover-retry]")){discoverCache.delete(`${discoverView}:${discoverPage}`);renderDiscover();return;}
  const preview=e.target.closest("[data-preview-id]");if(preview&&!e.target.closest("[data-add-tmdb],[data-manual-add],[data-edit-catalog]")){openTmdbPreview(preview.dataset.previewId,preview.dataset.previewType);return;}
  const editButton=e.target.closest("[data-edit-catalog]");
  if(editButton){openItem(editButton.dataset.editCatalog,editButton.dataset.editType);return;}
  const manualButton=e.target.closest("[data-manual-add]");
  if(manualButton){if(!fbUser||!window.hubFB){alert("Entre com sua conta Google para adicionar títulos.");return;}openTmdbPreview(manualButton.dataset.manualAdd,manualButton.dataset.mediaType);return;}
  const button=e.target.closest("[data-add-tmdb]"); if(!button)return;
  if(!fbUser||!window.hubFB){alert("Entre com sua conta Google para adicionar títulos.");return;}
  const id=button.dataset.addTmdb, mediaType=button.dataset.mediaType||tmdbSearchResults.find(x=>String(x.id)===id)?.mediaType; if(!mediaType)return;
  button.disabled=true;button.classList.add("is-loading");button.title="Adicionando…";
  const preservedSearch = {
    query: $("tmdb-search-input")?.value ?? searchQuery,
    type: $("tmdb-search-type")?.value ?? searchType,
    page: searchPage
  };
  try {
    const r=await fetch(`${TMDB_WORKER_URL}/api/tmdb/${mediaType}/${id}`);
    if(!r.ok)throw new Error("Não foi possível carregar os detalhes do título.");
    const detail=await r.json();
    const selectedStatus=button.dataset.addStatus || "plantowatch";
    await hubFB.addCatalogItem({...detail,status:selectedStatus});
    await loadCatalog();
    if (tab === "descobrir" && discoverView === "home" && preservedSearch.query.trim().length >= 2) {
      $("tmdb-search-input").value = preservedSearch.query;
      $("tmdb-search-type").value = preservedSearch.type;
      await runDiscoverSearch(preservedSearch.page);
    }
  } catch(err) {
    console.error(err);
    button.disabled=false;
    button.classList.remove("is-loading");
    button.title="Tentar novamente";
    alert(`Não foi possível adicionar: ${err.code||err.message}`);
  }
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
