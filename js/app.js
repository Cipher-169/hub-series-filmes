const navButtons = [...document.querySelectorAll(".nav-tab")];
const views = [...document.querySelectorAll(".view")];

function showView(viewId) {
  navButtons.forEach(button => {
    const selected = button.dataset.view === viewId;
    button.classList.toggle("active", selected);
    button.setAttribute("aria-current", selected ? "page" : "false");
  });
  views.forEach(view => view.classList.toggle("active", view.id === viewId));
  window.scrollTo({ top: document.querySelector(".main-nav").offsetTop - 12, behavior: "smooth" });
}

navButtons.forEach(button => button.addEventListener("click", () => showView(button.dataset.view)));

document.querySelectorAll("[data-jump]").forEach(button => {
  button.addEventListener("click", () => {
    const target = button.dataset.jump;
    showView(target === "catalogo" ? "catalogo-view" : "inicio-view");
  });
});

document.getElementById("search-focus").addEventListener("click", () => {
  showView("catalogo-view");
  setTimeout(() => document.getElementById("catalog-search").focus(), 180);
});

const dialog = document.getElementById("title-dialog");
document.getElementById("dialog-close").addEventListener("click", () => dialog.close());
dialog.addEventListener("click", event => {
  if (event.target === dialog) dialog.close();
});

// A interface começa sem catálogo fictício. Os filtros já ficam preparados
// para receber os títulos reais quando a integração com o Trakt for criada.
let activeType = "todos";
let activeStatus = "todos";
const searchInput = document.getElementById("catalog-search");

document.querySelectorAll("#type-filters [data-filter]").forEach(button => {
  button.addEventListener("click", () => {
    activeType = button.dataset.filter;
    document.querySelectorAll("#type-filters [data-filter]").forEach(item => item.classList.toggle("active", item === button));
    filterCatalog();
  });
});
document.querySelectorAll(".status-row [data-status]").forEach(button => {
  button.addEventListener("click", () => {
    activeStatus = button.dataset.status;
    document.querySelectorAll(".status-row [data-status]").forEach(item => item.classList.toggle("active", item === button));
    filterCatalog();
  });
});
searchInput.addEventListener("input", filterCatalog);
function filterCatalog() {
  // Será conectado à coleção pessoal quando os dados do Trakt/Firebase entrarem.
  const empty = document.querySelector("#catalogo-view .empty-state");
  empty.hidden = Boolean(searchInput.value.trim());
  if (searchInput.value.trim()) {
    empty.querySelector("h3").textContent = "Ainda não há títulos para buscar";
    empty.querySelector("p").textContent = "A busca ficará ativa assim que seu catálogo estiver conectado.";
  } else {
    empty.querySelector("h3").textContent = "Nenhum título por enquanto";
    empty.querySelector("p").textContent = "Quando conectarmos o Trakt, seus títulos aparecerão aqui.";
  }
}
