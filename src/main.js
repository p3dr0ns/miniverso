import "./style.css";
import { contributeCatalogItem, createAccount, findCatalogItem, getCurrentSession, onAuthStateChange, signIn, signOut } from "./auth.js";

const LEGACY_STORAGE_KEY = "garagem-mvp-v1";
const STORAGE_MIGRATION_KEY = "miniverso-storage-migrated-to-user";
const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const freshState = () => ({ minis: [], showcases: [], placements: {}, drafts: {}, activeShowcaseId: null });
let currentUserId = null;
let state = freshState();
let activeView = "collection";
let toastTimer;
let modalReturnFocus = null;
let draggedMiniId = null;
let draggedSlot = null;
let selectedMiniId = null;
let photoData = "";
let collectionPage = 1;
const COLLECTION_PAGE_SIZE = 40;
let collectionLayout = localStorage.getItem("miniverso-collection-layout") || "list";
const THEME_KEY = "miniverso-theme";

function applyTheme(theme) {
  const selected = theme === "dark" ? "dark" : "light";
  document.documentElement.dataset.theme = selected;
  localStorage.setItem(THEME_KEY, selected);
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", selected === "dark" ? "#101722" : "#f4f1e9");
  $$('[data-theme-toggle]').forEach((button) => {
    const dark = selected === "dark";
    button.innerHTML = `<span aria-hidden="true">${dark ? "☀" : "☾"}</span>`;
    button.setAttribute("aria-label", dark ? "Ativar tema claro" : "Ativar tema escuro");
    button.title = dark ? "Tema claro" : "Tema escuro";
  });
}

function parseCsv(text) {
  const rows = [];
  let row = [], field = "", quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (quoted) {
      if (char === '"' && text[index + 1] === '"') { field += '"'; index += 1; }
      else if (char === '"') quoted = false;
      else field += char;
    } else if (char === '"') quoted = true;
    else if (char === "," || char === ";") { row.push(field.trim()); field = ""; }
    else if (char === "\n") { row.push(field.trim()); if (row.some(Boolean)) rows.push(row); row = []; field = ""; }
    else if (char !== "\r") field += char;
  }
  row.push(field.trim()); if (row.some(Boolean)) rows.push(row);
  if (quoted) throw new Error("Há aspas não fechadas no arquivo CSV.");
  return rows;
}

const CSV_FIELDS = {
  name: ["nome", "name", "miniatura"], maker: ["fabricante", "maker"], vehicleBrand: ["marca", "marca do veiculo", "vehicle brand"],
  model: ["modelo", "model"], scale: ["escala", "scale"], color: ["cor", "color"], catalogCode: ["codigo", "codigo de catalogo", "catalog code", "toy number"],
  releaseYear: ["ano", "ano da edicao", "release year"], category: ["categoria", "linha", "category"], series: ["serie", "colecao", "series"],
  seriesNumber: ["numero na serie", "series number"], wheelType: ["tipo de roda", "wheel type"], steeringSide: ["direcao", "steering side"],
  editionSize: ["tiragem", "edition size"], exclusivity: ["exclusividade", "exclusivity"], sealed: ["lacrada", "sealed"], notes: ["observacoes", "notas", "notes"], quantity: ["quantidade", "quantity"],
  condition: ["condicao", "condition"], displayStatus: ["situacao", "status", "display status"]
};

function csvRecords(text) {
  const rows = parseCsv(text.replace(/^\uFEFF/, ""));
  if (rows.length < 2) throw new Error("O CSV precisa ter cabeçalho e pelo menos uma linha de dados.");
  const headers = rows[0].map(normalizeText);
  const indexes = Object.fromEntries(Object.entries(CSV_FIELDS).map(([field, aliases]) => [field, headers.findIndex((header) => aliases.includes(header))]));
  if (indexes.name < 0) throw new Error('Inclua uma coluna chamada "nome" ou "name".');
  const imported = [], ignored = [];
  rows.slice(1).forEach((values, rowIndex) => {
    const value = (field) => indexes[field] >= 0 ? String(values[indexes[field]] || "").trim() : "";
    const name = value("name").slice(0, 90);
    if (!name) { ignored.push(rowIndex + 2); return; }
    const sealedText = normalizeText(value("sealed"));
    const conditionText = normalizeText(value("condition"));
    const statusText = normalizeText(value("displayStatus"));
    const condition = ["loose", "solta", "solto"].includes(conditionText) || ["nao", "no", "false", "0", "solta"].includes(sealedText) ? "loose" : "blister";
    imported.push({ id: createId(), name, maker: value("maker").slice(0, 60), vehicleBrand: value("vehicleBrand").slice(0, 60), model: value("model").slice(0, 70), scale: value("scale").slice(0, 20), color: value("color").slice(0, 40), catalogCode: value("catalogCode").slice(0, 40), releaseYear: value("releaseYear").slice(0, 4), category: value("category").slice(0, 80), series: value("series").slice(0, 90), seriesNumber: value("seriesNumber").slice(0, 30), wheelType: value("wheelType").slice(0, 50), steeringSide: value("steeringSide").slice(0, 20), editionSize: value("editionSize").slice(0, 40), exclusivity: value("exclusivity").slice(0, 100), quantity: Math.min(999, Math.max(1, Number.parseInt(value("quantity"), 10) || 1)), condition, displayStatus: ["exposto", "exposta", "displayed"].includes(statusText) ? "displayed" : "stored", sealed: condition === "blister", notes: value("notes").slice(0, 500), photo: "", createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
  });
  return { imported, ignored };
}

function confirmCsvImport(records, ignored) {
  modal(`<div class="modal-head"><div><p class="eyebrow">IMPORTAR COLEÇÃO</p><h2>Confirmar arquivo CSV</h2></div><button class="modal-close" data-modal-close aria-label="Fechar">×</button></div><div class="csv-summary"><strong>${records.length}</strong><p>miniatura(s) pronta(s) para importar${ignored.length ? ` · ${ignored.length} linha(s) sem nome serão ignoradas` : ""}.</p><small>Os itens serão adicionados à coleção atual. Fotos e posições em expositores não são importadas.</small></div><div class="modal-actions"><button class="button button-quiet" data-modal-close type="button">Cancelar</button><button class="button button-primary" id="confirm-csv-import" type="button">Importar coleção</button></div>`, true);
  $("#confirm-csv-import").addEventListener("click", () => {
    const previous = state.minis;
    state.minis = [...records, ...state.minis];
    if (!saveState()) { state.minis = previous; return; }
    closeModal(); renderCollection(); if (activeView === "planner") renderPlanner(); showToast(`${records.length} miniatura(s) importada(s).`);
  });
}

function exportCollectionCsv() {
  const fields = [["nome","name"],["fabricante","maker"],["escala","scale"],["cor","color"],["codigo","catalogCode"],["ano","releaseYear"],["linha","category"],["serie","series"],["quantidade","quantity"],["condicao","condition"],["situacao","displayStatus"]];
  const cell = (value) => `"${String(value ?? "").replaceAll('"','""')}"`;
  const lines = [fields.map(([label]) => cell(label)).join(";")];
  state.minis.forEach((mini) => lines.push(fields.map(([,field]) => cell(field === "condition" ? (mini.condition === "loose" ? "Loose" : "Blister") : field === "displayStatus" ? (isDisplayed(mini) ? "Exposto" : "Guardado") : mini[field])).join(";")));
  const blob = new Blob(["\uFEFF", lines.join("\r\n")], { type: "text/csv;charset=utf-8" });
  const link = document.createElement("a"); link.href = URL.createObjectURL(blob); link.download = `miniverso-colecao-${new Date().toISOString().slice(0,10)}.csv`; link.click(); setTimeout(() => URL.revokeObjectURL(link.href), 1000);
  showToast(`${state.minis.length} miniatura(s) exportada(s).`);
}

function loadState() {
  try {
    let saved = localStorage.getItem(storageKey());
    if (!saved && currentUserId && !localStorage.getItem(STORAGE_MIGRATION_KEY)) {
      saved = localStorage.getItem(LEGACY_STORAGE_KEY);
      if (saved) {
        localStorage.setItem(storageKey(), saved);
        localStorage.setItem(STORAGE_MIGRATION_KEY, currentUserId);
      }
    }
    if (!saved) return freshState();
    return normalizeState(JSON.parse(saved));
  } catch (error) {
    console.error("Não foi possível carregar os dados salvos.", error);
    return freshState();
  }
}

function storageKey() {
  return currentUserId ? `${LEGACY_STORAGE_KEY}:${currentUserId}` : LEGACY_STORAGE_KEY;
}

function normalizeState(raw) {
  if (!raw || typeof raw !== "object") return freshState();
  const minis = Array.isArray(raw.minis)
    ? raw.minis.filter((mini) => mini && typeof mini.id === "string" && typeof mini.name === "string" && mini.name.trim()).map((mini) => ({ ...mini, quantity: Math.min(999, Math.max(1, Number.parseInt(mini.quantity, 10) || 1)), condition: mini.condition === "loose" || mini.sealed === false ? "loose" : "blister", displayStatus: mini.displayStatus === "displayed" ? "displayed" : "stored" }))
    : [];
  const miniIds = new Set(minis.map((mini) => mini.id));
  const showcases = Array.isArray(raw.showcases)
    ? raw.showcases.filter((item) => item && typeof item.id === "string" && typeof item.name === "string").map((item) => ({
        ...item,
        rows: Math.min(10, Math.max(1, Number.parseInt(item.rows, 10) || 1)),
        columns: Math.min(12, Math.max(1, Number.parseInt(item.columns, 10) || 1))
      }))
    : [];
  const showcaseMap = new Map(showcases.map((item) => [item.id, item]));
  const placements = {};
  const occupiedSlots = new Set();
  if (raw.placements && typeof raw.placements === "object") {
    Object.entries(raw.placements).forEach(([miniId, placement]) => {
      const showcase = showcaseMap.get(placement?.showcaseId);
      const slot = Number(placement?.slot);
      const slotKey = `${placement?.showcaseId}:${slot}`;
      if (miniIds.has(miniId) && showcase && Number.isInteger(slot) && slot >= 0 && slot < showcase.rows * showcase.columns && !occupiedSlots.has(slotKey)) {
        placements[miniId] = { showcaseId: showcase.id, slot };
        occupiedSlots.add(slotKey);
      }
    });
  }
  minis.forEach((mini) => { if (placements[mini.id]) mini.displayStatus = "displayed"; });
  const placementBySlot = new Map(Object.entries(placements).map(([miniId, placement]) => [`${placement.showcaseId}:${placement.slot}`, miniId]));
  const drafts = {};
  showcases.forEach((showcase) => {
    const hasSource = Array.isArray(raw.drafts?.[showcase.id]);
    const source = hasSource ? raw.drafts[showcase.id] : [];
    const seen = new Set();
    drafts[showcase.id] = Array.from({ length: showcase.rows * showcase.columns }, (_, index) => {
      const placedMiniId = hasSource ? null : placementBySlot.get(`${showcase.id}:${index}`);
      const miniId = source[index] || placedMiniId;
      if (!miniIds.has(miniId) || seen.has(miniId)) return null;
      seen.add(miniId);
      return miniId;
    });
  });
  return {
    minis,
    showcases,
    placements,
    drafts,
    activeShowcaseId: showcaseMap.has(raw.activeShowcaseId) ? raw.activeShowcaseId : showcases[0]?.id || null
  };
}

function saveState() {
  if (!currentUserId) return false;
  try {
    localStorage.setItem(storageKey(), JSON.stringify(state));
    updateStats();
    return true;
  } catch (error) {
    console.error("Não foi possível salvar os dados.", error);
    showToast("Não foi possível salvar. A imagem pode ser grande demais.");
    return false;
  }
}

function escapeHtml(value = "") {
  return String(value).replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
}

function normalizeText(value = "") {
  return String(value).normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("pt-BR");
}

function createId() {
  return globalThis.crypto?.randomUUID?.() || `mini-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function showToast(message) {
  const toast = $("#toast");
  toast.textContent = message;
  toast.classList.add("visible");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove("visible"), 2600);
}

function authErrorMessage(error) {
  if (error?.retryAfter > 0) {
    const seconds = Math.ceil(error.retryAfter);
    const wait = seconds < 60 ? `${seconds} segundos` : `${Math.ceil(seconds / 60)} minuto(s)`;
    return `Muitas tentativas. Aguarde ${wait} e tente novamente.`;
  }
  const code = error?.code || "";
  if (code === "invalid_credentials") return "E-mail ou senha incorretos.";
  if (code === "email_in_use") return "Este e-mail já possui uma conta. Clique em “Já tenho conta”.";
  return error?.message || "Não foi possível concluir o acesso. Tente novamente.";
}

function setAuthMessage(message, isError = false) {
  const element = $("#auth-message");
  element.textContent = message;
  element.classList.toggle("error", isError);
}

function setFormBusy(form, busy) {
  $$('button, input', form).forEach((control) => { control.disabled = busy; });
  form.setAttribute("aria-busy", String(busy));
}

function showAuthMode(mode) {
  const registering = mode === "register";
  $("#register-form").hidden = !registering;
  $("#login-form").hidden = registering;
  $("#show-register-button").classList.toggle("active", registering);
  $("#show-login-button").classList.toggle("active", !registering);
  $("#show-register-button").setAttribute("aria-selected", String(registering));
  $("#show-login-button").setAttribute("aria-selected", String(!registering));
  setAuthMessage("");
  $(registering ? "#register-email" : "#login-email").focus();
}

function enterAuthenticatedApp(session) {
  if (!session?.user?.id) return;
  if (currentUserId !== session.user.id) resetAccountInteractions();
  currentUserId = session.user.id;
  state = loadState();
  const email = session.user.email || "Conta conectada";
  $("#user-email-desktop").textContent = email;
  $("#account-menu-email").textContent = email;
  $(".avatar").textContent = email.charAt(0).toLocaleUpperCase("pt-BR");
  $(".avatar").title = email;
  $("#auth-screen").hidden = true;
  $("#app-shell").hidden = false;
  $("#mobile-nav").hidden = false;
  renderCollection();
  renderPlanner();
}

function leaveAuthenticatedApp() {
  resetAccountInteractions();
  currentUserId = null;
  state = freshState();
  $("#app-shell").hidden = true;
  $("#mobile-nav").hidden = true;
  $("#auth-screen").hidden = false;
  showAuthMode("login");
}

function resetAccountInteractions() {
  modalReturnFocus = null;
  closeModal();
  draggedMiniId = null;
  draggedSlot = null;
  selectedMiniId = null;
  $$(".drag-over").forEach((slot) => slot.classList.remove("drag-over"));
}

async function initializeAuthentication() {
  try {
    const session = await getCurrentSession();
    if (session) enterAuthenticatedApp(session);
    else {
      $("#auth-screen").hidden = false;
      showAuthMode("register");
    }
  } catch (error) {
    setAuthMessage(authErrorMessage(error), true);
  }
  onAuthStateChange((session) => {
    if (session) enterAuthenticatedApp(session);
    else if (currentUserId) leaveAuthenticatedApp();
  });
}

function getMini(id) {
  return state.minis.find((mini) => mini.id === id);
}

function getShowcase(id) {
  return state.showcases.find((showcase) => showcase.id === id);
}

function isDisplayed(mini) {
  return mini?.displayStatus === "displayed" || Boolean(state.placements[mini?.id] && getShowcase(state.placements[mini.id].showcaseId));
}

function positionLabel(id) {
  const placement = state.placements[id];
  if (!placement) return getMini(id)?.displayStatus === "displayed" ? "Exposta (sem expositor)" : "Guardada";
  const showcase = getShowcase(placement.showcaseId);
  if (!showcase) return "Guardada";
  const row = Math.floor(placement.slot / showcase.columns) + 1;
  const column = (placement.slot % showcase.columns) + 1;
  return `${showcase.name} · ${row}×${column}`;
}

function updateStats() {
  $("#stat-total").textContent = state.minis.reduce((total, mini) => total + (mini.quantity || 1), 0);
  const displayed = state.minis.filter(isDisplayed).reduce((total, mini) => total + (mini.quantity || 1), 0);
  $("#stat-displayed").textContent = displayed;
  $("#stat-stored").textContent = state.minis.reduce((total, mini) => total + (mini.quantity || 1), 0) - displayed;
  $("#stat-showcases").textContent = state.showcases.length;
}

function setView(view) {
  activeView = view;
  $$(".view").forEach((section) => section.classList.toggle("active-view", section.id === `${view}-view`));
  $$("[data-view]").forEach((button) => button.classList.toggle("active", button.dataset.view === view));
  $("#crumb-current").textContent = view === "collection" ? "MINHA COLEÇÃO" : "EXPOSITORES";
  if (view === "planner") renderPlanner();
}

function renderCollection() {
  const makers = [...new Set(state.minis.map((mini) => mini.maker).filter(Boolean))].sort((a, b) => a.localeCompare(b, "pt-BR"));
  const makerFilter = $("#filter-maker");
  const selectedMaker = makerFilter.value;
  makerFilter.innerHTML = `<option value="all">Todos os fabricantes</option>${makers.map((maker) => `<option value="${escapeHtml(maker)}">${escapeHtml(maker)}</option>`).join("")}`;
  if (makers.includes(selectedMaker)) makerFilter.value = selectedMaker;

  const query = normalizeText($("#search-input").value.trim());
  const location = $("#filter-location").value;
  const maker = makerFilter.value;
  let filtered = state.minis.filter((mini) => {
    const text = normalizeText([mini.name, mini.maker, mini.vehicleBrand, mini.model, mini.scale, mini.color, mini.catalogCode, mini.releaseYear, mini.category, mini.series, mini.seriesNumber, mini.wheelType, mini.steeringSide, mini.editionSize, mini.exclusivity].join(" "));
    const displayed = isDisplayed(mini);
    return (!query || text.includes(query)) && (location === "all" || (location === "displayed" ? displayed : !displayed)) && (maker === "all" || mini.maker === maker);
  });
  const sort = $("#sort-collection").value;
  filtered = [...filtered].sort((a,b) => sort === "name" ? a.name.localeCompare(b.name,"pt-BR") : sort === "year" ? String(b.releaseYear||"").localeCompare(String(a.releaseYear||"")) : sort === "quantity" ? (b.quantity||1)-(a.quantity||1) : String(b.createdAt||"").localeCompare(String(a.createdAt||"")));
  $("#collection-count").textContent = filtered.length;
  const grid = $("#collection-grid");
  const pages = Math.max(1, Math.ceil(filtered.length / COLLECTION_PAGE_SIZE)); collectionPage = Math.min(collectionPage, pages);
  const visible = filtered.slice((collectionPage-1)*COLLECTION_PAGE_SIZE, collectionPage*COLLECTION_PAGE_SIZE);
  grid.classList.toggle("grid-mode", collectionLayout === "grid");
  grid.innerHTML = visible.map((mini) => miniCard(mini)).join("");
  const pagination = $("#collection-pagination"); pagination.hidden = filtered.length <= COLLECTION_PAGE_SIZE; $("#page-summary").textContent = `Página ${collectionPage} de ${pages} · ${filtered.length} itens`; $("#page-previous").disabled = collectionPage <= 1; $("#page-next").disabled = collectionPage >= pages;
  const hasItems = state.minis.length > 0;
  $("#empty-state").hidden = hasItems;
  $("#no-results").hidden = !hasItems || filtered.length > 0;
  grid.hidden = !hasItems || filtered.length === 0;
  updateStats();
}

function miniCard(mini) {
  const color = mini.color || "#d8753f";
  const photo = mini.photo
    ? `<img src="${mini.photo}" alt="${escapeHtml(mini.name)}" />`
    : `<div class="photo-placeholder" style="--car-color:${escapeHtml(color)}"><i class="placeholder-window"></i><i class="placeholder-body"></i><i class="placeholder-wheel"></i></div>`;
  const location = positionLabel(mini.id);
  return `<article class="mini-card" data-view-mini="${mini.id}" tabindex="0" role="button" aria-label="Visualizar ${escapeHtml(mini.name)}">
    <div class="mini-photo">${photo}<span class="photo-tag">${escapeHtml(mini.scale || "Escala não informada")}</span></div>
    <div class="card-info"><p class="card-maker">${escapeHtml(mini.maker || "Fabricante não informado")}</p><h3 class="card-title" title="${escapeHtml(mini.name)}">${escapeHtml(mini.name)}</h3>
      <p class="card-meta">${escapeHtml([mini.vehicleBrand, mini.model, mini.releaseYear, mini.category, mini.series].filter(Boolean).join(" · ") || "Veículo não informado")}</p><div class="card-divider"></div>
      <div class="card-bottom"><span class="condition-badge ${mini.condition === "loose" ? "loose" : ""}">${mini.condition === "loose" ? "Loose" : "Blister"} · ${mini.quantity || 1} unidade(s)</span><span class="display-location">⌂ ${escapeHtml(location)}</span></div>
      <div class="card-actions"><button class="icon-button" data-edit-mini="${mini.id}" aria-label="Editar miniatura" title="Editar">${iconSvg("edit")}</button><button class="icon-button danger" data-delete-mini="${mini.id}" aria-label="Excluir miniatura" title="Excluir">${iconSvg("trash")}</button></div>
    </div></article>`;
}

function iconSvg(name) {
  if (name === "edit") return '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 20h4l11-11-4-4L4 16v4Z"/><path d="m13.5 6.5 4 4"/></svg>';
  if (name === "trash") return '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M9 7V4h6v3m3 0-1 13H7L6 7m4 4v5m4-5v5"/></svg>';
  return '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 9 12 3l6 6M12 3v14M5 21h14"/></svg>';
}

function openMiniDetails(id) {
  const mini = getMini(id); if (!mini) return;
  const photo = mini.photo ? `<img src="${escapeHtml(mini.photo)}" alt="${escapeHtml(mini.name)}" />` : `<div class="detail-photo-placeholder">Sem foto cadastrada</div>`;
  const details = [["Código",mini.catalogCode],["Fabricante",mini.maker],["Escala",mini.scale],["Cor",mini.color],["Ano",mini.releaseYear],["Linha",mini.category],["Série / coleção",mini.series],["Quantidade",`${mini.quantity||1} unidade(s)`],["Condição",mini.condition === "loose" ? "Loose" : "Blister"],["Situação",isDisplayed(mini) ? "Exposto" : "Guardado"]].filter(([,value])=>value);
  modal(`<div class="mini-detail"><div class="mini-detail-visual">${photo}<span>${escapeHtml(mini.scale||"Escala não informada")}</span></div><div class="mini-detail-content"><div class="mini-detail-top"><div><p class="eyebrow">${escapeHtml(mini.maker||"MINIATURA")}</p><h2>${escapeHtml(mini.name)}</h2></div><button class="modal-close" data-modal-close aria-label="Fechar">×</button></div><div class="mini-detail-data">${details.map(([label,value])=>`<div><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong></div>`).join("")}</div><div class="mini-detail-location"><span>Localização</span><strong>${escapeHtml(positionLabel(mini.id))}</strong></div><div class="mini-detail-actions"><button class="button button-quiet" data-modal-close>Fechar</button><button class="button button-primary" data-detail-edit="${mini.id}">${iconSvg("edit")} Editar miniatura</button></div></div></div>`);
  $("[data-detail-edit]").addEventListener("click", (event) => { const miniId = event.currentTarget.dataset.detailEdit; closeModal(); openMiniForm(miniId); });
}

function modal(content, small = false) {
  modalReturnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  $("#modal-root").innerHTML = `<div class="modal-backdrop" data-close-modal><section class="modal ${small ? "modal-small" : ""}" role="dialog" aria-modal="true" tabindex="-1">${content}</section></div>`;
  const dialog = $(".modal");
  const title = $(".modal h2");
  if (title) {
    title.id = "modal-title";
    dialog.setAttribute("aria-labelledby", title.id);
  }
  document.body.classList.add("modal-open");
  $(".modal-backdrop").addEventListener("click", (event) => {
    if (event.target === event.currentTarget || event.target.closest("[data-modal-close]")) closeModal();
  });
  dialog.focus();
}

function closeModal() {
  $("#modal-root").innerHTML = "";
  document.body.classList.remove("modal-open");
  photoData = "";
  modalReturnFocus?.focus();
  modalReturnFocus = null;
}

function openMiniForm(id = null, initialCode = "") {
  if (!currentUserId) return;
  const formUserId = currentUserId;
  const mini = id ? getMini(id) : null;
  photoData = mini?.photo || "";
  const preview = photoData || "";
  modal(`<div class="modal-head"><div><p class="eyebrow">INVENTÁRIO PESSOAL</p><h2>${mini ? "Editar miniatura" : "Nova miniatura"}</h2></div><button class="modal-close" data-modal-close aria-label="Fechar">×</button></div>
    <form class="modal-form" id="mini-form"><div class="form-grid">
      <div class="catalog-lookup full"><div class="form-field"><label for="mini-catalog-code">Código da miniatura</label><input id="mini-catalog-code" name="catalogCode" maxlength="40" value="${escapeHtml(mini?.catalogCode || initialCode)}" placeholder="Ex.: HTB06" /></div><button class="button button-quiet" id="lookup-catalog-button" type="button">Buscar dados</button><span id="catalog-lookup-status">Digite o código para preencher os dados automaticamente.</span></div>
      <div class="form-field full"><span class="photo-label">Foto da miniatura</span><div class="photo-upload"><img id="photo-preview" class="photo-preview" src="${preview}" alt="Prévia da foto" ${preview ? "" : "hidden"} /><div class="photo-upload-info"><span id="photo-hint">${preview ? "Foto pronta para salvar" : "Uma foto ajuda a destacar sua miniatura"}</span><div class="photo-actions"><label class="upload-button"><span id="upload-button-label">${preview ? "Trocar foto" : "Escolher foto"}</span><input id="photo-input" type="file" accept="image/*" /></label><button id="remove-photo-button" class="upload-button remove-photo" type="button" ${preview ? "" : "hidden"}>Remover foto</button></div></div></div></div>
      <div class="form-field full"><label for="mini-name">Nome da miniatura *</label><input id="mini-name" name="name" required maxlength="90" value="${escapeHtml(mini?.name || "")}" placeholder="Ex.: Porsche 911 Carrera RS" /></div>
      <div class="form-field"><label for="mini-maker">Fabricante da miniatura</label><input id="mini-maker" name="maker" maxlength="60" value="${escapeHtml(mini?.maker || "")}" placeholder="Ex.: Mini GT" /></div>
      <div class="form-field"><label for="mini-scale">Escala</label><input id="mini-scale" name="scale" maxlength="20" value="${escapeHtml(mini?.scale || "")}" placeholder="Ex.: 1:64" /></div>
      <div class="form-field"><label for="mini-color">Cor</label><input id="mini-color" name="color" maxlength="40" value="${escapeHtml(mini?.color || "")}" placeholder="Ex.: Laranja" /></div>
      <div class="form-field"><label for="mini-release-year">Ano da edição</label><input id="mini-release-year" name="releaseYear" type="number" min="1960" max="2100" value="${escapeHtml(mini?.releaseYear || "")}" placeholder="Ex.: 2023" /></div>
      <div class="form-field"><label for="mini-category">Linha</label><input id="mini-category" name="category" maxlength="80" value="${escapeHtml(mini?.category || "")}" placeholder="Ex.: Mainline" /></div>
      <div class="form-field"><label for="mini-series">Série / coleção</label><input id="mini-series" name="series" maxlength="90" value="${escapeHtml(mini?.series || "")}" placeholder="Ex.: HW J-Imports" /></div>
      <div class="form-field"><label for="mini-quantity">Quantidade</label><div class="quantity-stepper"><button type="button" data-quantity-step="-1" aria-label="Diminuir quantidade">−</button><input id="mini-quantity" name="quantity" type="number" min="1" max="999" value="${mini?.quantity || 1}" /><button type="button" data-quantity-step="1" aria-label="Aumentar quantidade">+</button></div></div>
      <fieldset class="form-field choice-field"><legend>Condição</legend><div class="segmented-field"><label><input type="radio" name="condition" value="blister" ${mini?.condition !== "loose" ? "checked" : ""}><span>Blister</span></label><label><input type="radio" name="condition" value="loose" ${mini?.condition === "loose" ? "checked" : ""}><span>Loose</span></label></div></fieldset>
      <fieldset class="form-field choice-field"><legend>Situação</legend><div class="segmented-field"><label><input type="radio" name="displayStatus" value="displayed" ${isDisplayed(mini) ? "checked" : ""}><span>Exposto</span></label><label><input type="radio" name="displayStatus" value="stored" ${!isDisplayed(mini) ? "checked" : ""}><span>Guardado</span></label></div></fieldset>
    </div><div class="modal-actions"><button type="button" class="button button-quiet" data-modal-close>Cancelar</button><button class="button button-primary" type="submit">${mini ? "Salvar alterações" : "Adicionar à coleção"}</button></div></form>`);

  const miniForm = $("#mini-form");
  $$('[data-quantity-step]', miniForm).forEach((button) => button.addEventListener("click", () => { const input = $("#mini-quantity"); input.value = String(Math.min(999, Math.max(1, Number(input.value || 1) + Number(button.dataset.quantityStep)))); }));
  $("#photo-input").addEventListener("change", (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith("image/")) { showToast("Escolha um arquivo de imagem."); return; }
    if (file.size > 6 * 1024 * 1024) { showToast("A imagem deve ter até 6 MB."); event.target.value = ""; return; }
    const image = new Image();
    const objectUrl = URL.createObjectURL(file);
    image.onload = () => {
      if (currentUserId !== formUserId || !miniForm.isConnected) { URL.revokeObjectURL(objectUrl); return; }
      const scale = Math.min(1, 1200 / Math.max(image.naturalWidth, image.naturalHeight));
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
      canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
      const context = canvas.getContext("2d");
      if (!context) { URL.revokeObjectURL(objectUrl); showToast("Não foi possível processar a imagem."); return; }
      context.fillStyle = "#f4f1e9";
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.drawImage(image, 0, 0, canvas.width, canvas.height);
      const compressedPhoto = canvas.toDataURL("image/jpeg", 0.8);
      URL.revokeObjectURL(objectUrl);
      if (compressedPhoto.length > 3_500_000) {
        event.target.value = "";
        showToast("A foto ainda ficou grande demais. Escolha uma imagem menor.");
        return;
      }
      photoData = compressedPhoto;
      $("#photo-preview").src = photoData;
      $("#photo-preview").hidden = false;
      $("#photo-hint").textContent = "Foto pronta para salvar";
      $("#upload-button-label").textContent = "Trocar foto";
      $("#remove-photo-button").hidden = false;
    };
    image.onerror = () => { URL.revokeObjectURL(objectUrl); showToast("Não foi possível ler a imagem."); };
    image.src = objectUrl;
  });

  $("#remove-photo-button").addEventListener("click", () => {
    photoData = "";
    $("#photo-preview").src = "";
    $("#photo-preview").hidden = true;
    $("#photo-input").value = "";
    $("#photo-hint").textContent = "A foto será removida ao salvar";
    $("#upload-button-label").textContent = "Escolher foto";
    $("#remove-photo-button").hidden = true;
  });

  const lookupCatalog = async () => {
    const code = $("#mini-catalog-code").value.trim();
    if (!code) { $("#catalog-lookup-status").textContent = "Informe um código para buscar."; return; }
    const button = $("#lookup-catalog-button"); button.disabled = true; $("#catalog-lookup-status").textContent = "Buscando no catálogo...";
    try {
      const item = await findCatalogItem(code);
      if (!item) { $("#catalog-lookup-status").textContent = "Código ainda não catalogado. Preencha manualmente para colaborar."; return; }
      Object.entries(item).forEach(([field, value]) => { const control = miniForm.elements.namedItem(field === "code" ? "catalogCode" : field); if (control && typeof value === "string") control.value = value; });
      if (item.photo) { photoData = item.photo; $("#photo-preview").src = item.photo; $("#photo-preview").hidden = false; $("#photo-hint").textContent = "Foto encontrada na fonte licenciada"; $("#upload-button-label").textContent = "Trocar foto"; $("#remove-photo-button").hidden = false; }
      if (item.sourceUrl) $("#catalog-lookup-status").innerHTML = `Encontrado em <a href="${escapeHtml(item.sourceUrl)}" target="_blank" rel="noopener">${escapeHtml(item.sourceName)}</a>${item.license ? ` · ${escapeHtml(item.license)}` : ""}. Confira os dados antes de salvar.`;
      else $("#catalog-lookup-status").textContent = `Dados encontrados no catálogo Miniverso · ${item.contributions || 1} contribuição(ões).`;
      $("#mini-name").focus();
    } catch { $("#catalog-lookup-status").textContent = "Não foi possível consultar agora. Você pode preencher manualmente."; }
    finally { button.disabled = false; }
  };
  $("#lookup-catalog-button").addEventListener("click", lookupCatalog);
  $("#mini-catalog-code").addEventListener("change", lookupCatalog);
  if (initialCode && !mini) lookupCatalog();

  $("#mini-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    if (currentUserId !== formUserId || !miniForm.isConnected) return;
    const form = new FormData(event.currentTarget);
    const data = Object.fromEntries(form.entries());
    const record = {
      id: mini?.id || createId(),
      name: data.name.trim(),
      maker: (data.maker || "").trim(),
      vehicleBrand: (data.vehicleBrand || "").trim(),
      model: (data.model || "").trim(),
      scale: (data.scale || "").trim(),
      color: (data.color || "").trim(),
      catalogCode: (data.catalogCode || "").trim(),
      releaseYear: (data.releaseYear || "").trim(),
      category: (data.category || "").trim(),
      series: (data.series || "").trim(),
      seriesNumber: (data.seriesNumber || "").trim(),
      wheelType: (data.wheelType || "").trim(),
      steeringSide: (data.steeringSide || "").trim(),
      editionSize: (data.editionSize || "").trim(),
      exclusivity: (data.exclusivity || "").trim(),
      quantity: Math.min(999, Math.max(1, Number.parseInt(data.quantity, 10) || 1)),
      condition: data.condition === "loose" ? "loose" : "blister",
      displayStatus: data.displayStatus === "displayed" ? "displayed" : "stored",
      sealed: data.condition !== "loose",
      notes: (data.notes || "").trim(),
      photo: photoData,
      createdAt: mini?.createdAt || new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    const previousMinis = state.minis;
    if (mini) state.minis = state.minis.map((item) => item.id === mini.id ? record : item);
    else state.minis = [record, ...state.minis];
    if (record.displayStatus === "stored") {
      delete state.placements[record.id];
      Object.values(state.drafts).forEach((draft) => { const index = draft.indexOf(record.id); if (index >= 0) draft[index] = null; });
    }
    if (!saveState()) {
      state.minis = previousMinis;
      updateStats();
      return;
    }
    closeModal();
    renderCollection();
    if (activeView === "planner") renderPlanner();
    if (record.catalogCode) contributeCatalogItem({ code: record.catalogCode, ...record, id: undefined, photo: undefined, notes: undefined, sealed: undefined, condition: undefined, displayStatus: undefined, createdAt: undefined, updatedAt: undefined }).catch(() => {});
    showToast(mini ? "Miniatura atualizada." : "Miniatura adicionada à coleção.");
  });
  $("#mini-name").focus();
}

function confirmDeleteMini(id) {
  const mini = getMini(id);
  if (!mini) return;
  modal(`<div class="modal-head"><div><p class="eyebrow">REMOVER DO ACERVO</p><h2>Excluir miniatura?</h2></div><button class="modal-close" data-modal-close aria-label="Fechar">×</button></div><p class="modal-description">“${escapeHtml(mini.name)}” será removida da coleção e de qualquer expositor. Esta ação não pode ser desfeita.</p><div class="modal-actions" style="padding:0 21px 19px;border:0"><button class="button button-quiet" data-modal-close>Cancelar</button><button class="button button-primary" id="confirm-delete-mini" style="background:#a9503d;color:#fff">Excluir miniatura</button></div>`, true);
  $("#confirm-delete-mini").addEventListener("click", () => {
    state.minis = state.minis.filter((item) => item.id !== id);
    delete state.placements[id];
    Object.keys(state.drafts).forEach((key) => { state.drafts[key] = state.drafts[key].map((miniId) => miniId === id ? null : miniId); });
    closeModal(); saveState(); renderCollection(); renderPlanner(); showToast("Miniatura removida.");
  });
}

function openShowcaseForm(id = null) {
  const showcase = id ? getShowcase(id) : null;
  modal(`<div class="modal-head"><div><p class="eyebrow">PLANEJADOR DE EXPOSITORES</p><h2>${showcase ? "Editar expositor" : "Novo expositor"}</h2></div><button class="modal-close" data-modal-close aria-label="Fechar">×</button></div>
    <form class="modal-form" id="showcase-form"><div class="form-grid">
      <div class="form-field full"><label for="showcase-name">Nome do expositor *</label><input id="showcase-name" name="name" required maxlength="60" value="${escapeHtml(showcase?.name || "")}" placeholder="Ex.: Vitrine principal" /></div>
      <div class="form-field"><label for="showcase-columns">Colunas *</label><input id="showcase-columns" name="columns" type="number" min="1" max="12" required value="${showcase?.columns || 10}" /></div>
      <div class="form-field"><label for="showcase-rows">Linhas *</label><input id="showcase-rows" name="rows" type="number" min="1" max="10" required value="${showcase?.rows || 5}" /></div>
      <div class="form-field full"><p class="form-hint">Até 12 colunas e 8 linhas por expositor. Alterar o tamanho pode remover vagas excedentes do rascunho.</p></div>
    </div><div class="modal-actions"><button type="button" class="button button-quiet" data-modal-close>Cancelar</button><button class="button button-primary" type="submit">${showcase ? "Salvar alterações" : "Criar expositor"}</button></div></form>`);
  $("#showcase-form").addEventListener("submit", (event) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const rows = Number(form.get("rows"));
    const columns = Number(form.get("columns"));
    if (rows * columns > 96) { showToast("O expositor pode ter no máximo 96 vagas."); return; }
    const previousSize = showcase ? showcase.rows * showcase.columns : 0;
    const record = { id: showcase?.id || createId(), name: String(form.get("name")).trim(), rows, columns };
    if (showcase) {
      state.showcases = state.showcases.map((item) => item.id === showcase.id ? record : item);
      if (rows * columns < previousSize) {
        Object.keys(state.placements).forEach((miniId) => {
          const placement = state.placements[miniId];
          if (placement.showcaseId === showcase.id && placement.slot >= rows * columns) delete state.placements[miniId];
        });
        state.drafts[showcase.id] = (state.drafts[showcase.id] || []).slice(0, rows * columns);
      }
    } else {
      state.showcases.push(record);
      state.drafts[record.id] = Array(rows * columns).fill(null);
      state.activeShowcaseId = record.id;
    }
    closeModal(); saveState(); renderPlanner(); renderCollection(); showToast(showcase ? "Expositor atualizado." : "Expositor criado.");
  });
}

function currentDraft(showcase) {
  if (!Array.isArray(state.drafts[showcase.id])) {
    const draft = Array(showcase.rows * showcase.columns).fill(null);
    Object.entries(state.placements).forEach(([miniId, placement]) => {
      if (placement.showcaseId === showcase.id && placement.slot < draft.length) draft[placement.slot] = miniId;
    });
    state.drafts[showcase.id] = draft;
    saveState();
  }
  const draft = state.drafts[showcase.id].slice(0, showcase.rows * showcase.columns);
  while (draft.length < showcase.rows * showcase.columns) draft.push(null);
  state.drafts[showcase.id] = draft;
  return draft;
}

function renderPlanner() {
  const empty = state.showcases.length === 0;
  $("#planner-empty").hidden = !empty;
  $("#planner-content").hidden = empty;
  if (empty) { updateStats(); return; }
  if (!getShowcase(state.activeShowcaseId)) state.activeShowcaseId = state.showcases[0].id;
  const showcase = getShowcase(state.activeShowcaseId);
  const draft = currentDraft(showcase);
  $("#showcase-tabs").innerHTML = state.showcases.map((item) => `<button class="showcase-tab ${item.id === showcase.id ? "active" : ""}" data-showcase="${item.id}">${escapeHtml(item.name)}</button>`).join("");
  $("#active-showcase-title").textContent = showcase.name;
  $("#active-showcase-meta").textContent = `${showcase.rows} linhas · ${showcase.columns} colunas`;
  $("#grid-dimensions").textContent = `${showcase.columns} COLUNAS × ${showcase.rows} LINHAS`;
  $("#capacity-count").textContent = showcase.rows * showcase.columns;
  $("#occupied-count").textContent = draft.filter(Boolean).length;
  const grid = $("#showcase-grid");
  grid.style.gridTemplateColumns = `repeat(${showcase.columns}, minmax(0, 1fr))`;
  grid.innerHTML = draft.map((miniId, index) => {
    const mini = miniId ? getMini(miniId) : null;
    let visual = `<span class="slot-empty-mark">＋</span>`;
    if (mini) visual = mini.photo ? `<img class="slot-mini" src="${mini.photo}" alt="${escapeHtml(mini.name)}" draggable="false" />` : `<div class="photo-placeholder slot-mini-fallback" style="--car-color:${escapeHtml(mini.color || "#d8753f")}"><i class="placeholder-window"></i><i class="placeholder-body"></i><i class="placeholder-wheel"></i></div>`;
    return `<div class="showcase-slot ${miniId && miniId === selectedMiniId ? "selected" : ""}" tabindex="0" data-slot="${index}" data-mini-id="${miniId || ""}" aria-label="Vaga ${index + 1}${mini ? `, ${escapeHtml(mini.name)}` : ", vazia"}" draggable="${Boolean(mini)}"><span class="slot-number">${String(index + 1).padStart(2, "0")}</span>${visual}${mini ? `<button class="slot-remove" data-remove-slot="${index}" aria-label="Remover ${escapeHtml(mini.name)} desta vaga">×</button>` : ""}</div>`;
  }).join("");
  renderAvailable(showcase, draft);
  $("#draft-status").innerHTML = `<span class="status-dot"></span> Rascunho salvo automaticamente`;
}

function renderAvailable(showcase, draft) {
  const query = normalizeText($("#available-search").value.trim());
  const inDraft = new Set(draft.filter(Boolean));
  const available = state.minis.filter((mini) => !inDraft.has(mini.id) && normalizeText([mini.name, mini.maker, mini.vehicleBrand, mini.model, mini.catalogCode, mini.series].join(" ")).includes(query));
  $("#available-count").textContent = available.length;
  $("#available-list").innerHTML = available.length ? available.map((mini) => {
    const thumb = mini.photo ? `<img class="available-thumb" src="${mini.photo}" alt="" />` : `<div class="available-thumb available-thumb-fallback"><div class="photo-placeholder" style="--car-color:${escapeHtml(mini.color || "#d8753f")}"><i class="placeholder-window"></i><i class="placeholder-body"></i><i class="placeholder-wheel"></i></div></div>`;
    const realLocation = state.placements[mini.id] && getShowcase(state.placements[mini.id].showcaseId);
    const suffix = realLocation && realLocation.id !== showcase.id ? ` · hoje: ${escapeHtml(realLocation.name)}` : "";
    return `<div class="available-item ${mini.id === selectedMiniId ? "selected" : ""}" draggable="true" data-drag-mini="${mini.id}" tabindex="0" role="button" aria-pressed="${mini.id === selectedMiniId}" aria-label="Selecionar ou arrastar ${escapeHtml(mini.name)}">${thumb}<div class="available-info"><strong>${escapeHtml(mini.name)}</strong><span>${mini.id === selectedMiniId ? "Selecionada · toque em uma vaga para posicionar" : `${escapeHtml(mini.maker || "Fabricante não informado")}${suffix}`}</span></div></div>`;
  }).join("") : `<div class="available-empty">${state.minis.length ? "Todas as miniaturas já estão neste rascunho." : "Adicione miniaturas à coleção para começar a montar o expositor."}</div>`;
}

function saveDraft(showcaseId, draft) {
  state.drafts[showcaseId] = draft;
  saveState();
  renderPlanner();
}

function placeMini(slotIndex, miniId, sourceSlot = null) {
  const showcase = getShowcase(state.activeShowcaseId);
  if (!showcase || !getMini(miniId)) return;
  const draft = currentDraft(showcase);
  const oldSlot = draft.indexOf(miniId);
  const targetMiniId = draft[slotIndex];
  if (sourceSlot !== null) {
    if (sourceSlot === slotIndex) return;
    draft[sourceSlot] = targetMiniId || null;
  } else if (oldSlot !== -1) {
    draft[oldSlot] = targetMiniId || null;
  }
  draft[slotIndex] = miniId;
  saveDraft(showcase.id, draft);
}

function removeFromDraft(slotIndex) {
  const showcase = getShowcase(state.activeShowcaseId);
  if (!showcase) return;
  const draft = currentDraft(showcase);
  draft[slotIndex] = null;
  saveDraft(showcase.id, draft);
}

function resetDraft() {
  const showcase = getShowcase(state.activeShowcaseId);
  if (!showcase) return;
  const draft = Array(showcase.rows * showcase.columns).fill(null);
  Object.entries(state.placements).forEach(([miniId, placement]) => {
    if (placement.showcaseId === showcase.id && placement.slot < draft.length) draft[placement.slot] = miniId;
  });
  state.drafts[showcase.id] = draft;
  saveState(); renderPlanner(); showToast("Rascunho revertido à organização aplicada.");
}

function applyLayout() {
  const showcase = getShowcase(state.activeShowcaseId);
  if (!showcase) return;
  const draft = currentDraft(showcase);
  const selected = draft.filter(Boolean);
  if (new Set(selected).size !== selected.length) { showToast("Uma miniatura não pode ocupar mais de uma vaga."); return; }
  Object.keys(state.placements).forEach((miniId) => {
    if (state.placements[miniId].showcaseId === showcase.id || selected.includes(miniId)) delete state.placements[miniId];
  });
  draft.forEach((miniId, slot) => {
    if (miniId && getMini(miniId)) state.placements[miniId] = { showcaseId: showcase.id, slot };
  });
  state.minis = state.minis.map((mini) => state.placements[mini.id] ? { ...mini, displayStatus: "displayed" } : mini);
  saveState(); renderPlanner(); renderCollection(); showToast("Organização aplicada à sua coleção.");
}

function deleteShowcase() {
  const showcase = getShowcase(state.activeShowcaseId);
  if (!showcase) return;
  modal(`<div class="modal-head"><div><p class="eyebrow">GERENCIAR EXPOSITOR</p><h2>Excluir expositor?</h2></div><button class="modal-close" data-modal-close aria-label="Fechar">×</button></div><p class="modal-description">“${escapeHtml(showcase.name)}” será removido. As miniaturas continuarão na coleção como guardadas.</p><div class="modal-actions" style="padding:0 21px 19px;border:0"><button class="button button-quiet" data-modal-close>Cancelar</button><button class="button button-primary" id="confirm-delete-showcase" style="background:#a9503d;color:#fff">Excluir expositor</button></div>`, true);
  $("#confirm-delete-showcase").addEventListener("click", () => {
    state.showcases = state.showcases.filter((item) => item.id !== showcase.id);
    Object.keys(state.placements).forEach((miniId) => { if (state.placements[miniId].showcaseId === showcase.id) delete state.placements[miniId]; });
    delete state.drafts[showcase.id];
    state.activeShowcaseId = state.showcases[0]?.id || null;
    closeModal(); saveState(); renderPlanner(); renderCollection(); showToast("Expositor excluído. As minis estão guardadas.");
  });
}

document.addEventListener("click", (event) => {
  const viewButton = event.target.closest("[data-view]");
  if (viewButton) { setView(viewButton.dataset.view); return; }
  const editMini = event.target.closest("[data-edit-mini]");
  if (editMini) { openMiniForm(editMini.dataset.editMini); return; }
  const deleteMini = event.target.closest("[data-delete-mini]");
  if (deleteMini) { confirmDeleteMini(deleteMini.dataset.deleteMini); return; }
  const viewMini = event.target.closest("[data-view-mini]");
  if (viewMini) { openMiniDetails(viewMini.dataset.viewMini); return; }
  const showcaseTab = event.target.closest("[data-showcase]");
  if (showcaseTab) { state.activeShowcaseId = showcaseTab.dataset.showcase; saveState(); renderPlanner(); return; }
  const removeSlot = event.target.closest("[data-remove-slot]");
  if (removeSlot) { removeFromDraft(Number(removeSlot.dataset.removeSlot)); return; }
  const availableMini = event.target.closest("[data-drag-mini]");
  if (availableMini) {
    selectedMiniId = selectedMiniId === availableMini.dataset.dragMini ? null : availableMini.dataset.dragMini;
    renderPlanner();
    return;
  }
  const slot = event.target.closest(".showcase-slot");
  if (slot) {
    const index = Number(slot.dataset.slot);
    if (selectedMiniId) {
      if (slot.dataset.miniId === selectedMiniId) selectedMiniId = null;
      else {
        placeMini(index, selectedMiniId);
        selectedMiniId = null;
      }
    } else if (slot.dataset.miniId) selectedMiniId = slot.dataset.miniId;
    renderPlanner();
  }
});

$("#show-register-button").addEventListener("click", () => showAuthMode("register"));
$("#show-login-button").addEventListener("click", () => showAuthMode("login"));

$("#register-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const data = new FormData(form);
  const email = String(data.get("email") || "").trim().toLocaleLowerCase("pt-BR");
  const password = String(data.get("password") || "");
  if (password !== String(data.get("passwordConfirm") || "")) {
    setAuthMessage("As duas senhas precisam ser iguais.", true);
    return;
  }
  setFormBusy(form, true);
  setAuthMessage("Criando sua conta...");
  try {
    const session = await createAccount(email, password);
    enterAuthenticatedApp(session);
  } catch (error) {
    setAuthMessage(authErrorMessage(error), true);
  } finally {
    setFormBusy(form, false);
  }
});

$("#login-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const data = new FormData(form);
  const email = String(data.get("email") || "").trim().toLocaleLowerCase("pt-BR");
  const password = String(data.get("password") || "");
  setFormBusy(form, true);
  setAuthMessage("Entrando...");
  try {
    const session = await signIn(email, password);
    enterAuthenticatedApp(session);
  } catch (error) {
    setAuthMessage(authErrorMessage(error), true);
  } finally {
    setFormBusy(form, false);
  }
});

$$('[data-logout]').forEach((button) => button.addEventListener("click", async () => {
  button.disabled = true;
  try {
    await signOut();
    leaveAuthenticatedApp();
  } catch (error) {
    showToast(authErrorMessage(error));
  } finally {
    button.disabled = false;
  }
}));

$("#add-mini-button").addEventListener("click", () => openMiniForm());
$("#empty-add-button").addEventListener("click", () => openMiniForm());
$$('[data-theme-toggle]').forEach((button) => button.addEventListener("click", () => applyTheme(document.documentElement.dataset.theme === "dark" ? "light" : "dark")));
applyTheme(document.documentElement.dataset.theme);
$("#import-csv-button").addEventListener("click", () => $("#csv-file-input").click());
$("#export-csv-button").addEventListener("click", exportCollectionCsv);
$$('[data-account-trigger]').forEach((button) => button.addEventListener("click", (event) => {
  event.stopPropagation(); const menu = $("#account-menu"); menu.hidden = !menu.hidden;
}));
$("#account-menu").addEventListener("click", (event) => event.stopPropagation());
document.addEventListener("click", () => { $("#account-menu").hidden = true; });
$("#csv-file-input").addEventListener("change", async (event) => {
  const input = event.currentTarget;
  const file = input.files?.[0];
  input.value = "";
  if (!file) return;
  if (file.size > 2 * 1024 * 1024) { showToast("O CSV deve ter até 2 MB."); return; }
  try {
    const { imported, ignored } = csvRecords(await file.text());
    if (!imported.length) throw new Error("Nenhuma miniatura válida foi encontrada.");
    confirmCsvImport(imported, ignored);
  } catch (error) {
    showToast(error.message || "Não foi possível ler o CSV.");
  }
});
$("#add-showcase-button").addEventListener("click", () => openShowcaseForm());
$("#empty-showcase-button").addEventListener("click", () => openShowcaseForm());
$("#edit-showcase-button").addEventListener("click", () => openShowcaseForm(state.activeShowcaseId));
$("#delete-showcase-button").addEventListener("click", deleteShowcase);
$("#search-input").addEventListener("input", () => { collectionPage = 1; renderCollection(); });
$("#filter-location").addEventListener("change", () => { collectionPage = 1; renderCollection(); });
$("#filter-maker").addEventListener("change", () => { collectionPage = 1; renderCollection(); });
$("#sort-collection").addEventListener("change", () => { collectionPage = 1; renderCollection(); });
$("#page-previous").addEventListener("click", () => { collectionPage -= 1; renderCollection(); scrollTo({ top: 0, behavior: "smooth" }); });
$("#page-next").addEventListener("click", () => { collectionPage += 1; renderCollection(); scrollTo({ top: 0, behavior: "smooth" }); });
$("#view-list").addEventListener("click", () => { collectionLayout = "list"; localStorage.setItem("miniverso-collection-layout", collectionLayout); $("#view-list").classList.add("active"); $("#view-grid").classList.remove("active"); renderCollection(); });
$("#view-grid").addEventListener("click", () => { collectionLayout = "grid"; localStorage.setItem("miniverso-collection-layout", collectionLayout); $("#view-grid").classList.add("active"); $("#view-list").classList.remove("active"); renderCollection(); });
$("#quick-code-form").addEventListener("submit", (event) => { event.preventDefault(); const code = $("#quick-code-input").value.trim(); if (!code) return; openMiniForm(null, code); $("#quick-code-input").value = ""; });
$(collectionLayout === "grid" ? "#view-grid" : "#view-list").classList.add("active");
$("#available-search").addEventListener("input", renderPlanner);
$("#reset-draft-button").addEventListener("click", resetDraft);
$("#apply-layout-button").addEventListener("click", applyLayout);

document.addEventListener("keydown", (event) => {
  if (event.key === "Tab" && $(".modal")) {
    const focusable = $$('button:not([disabled]):not([hidden]), input:not([disabled]):not([hidden]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])', $(".modal"));
    if (focusable.length) {
      const first = focusable[0];
      const last = focusable.at(-1);
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    }
  }
  if (event.key === "Escape" && $(".modal-backdrop")) {
    closeModal();
    return;
  }
  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
    event.preventDefault();
    if (activeView !== "collection") setView("collection");
    $("#search-input").focus();
    return;
  }
  if (event.key === "Enter" && event.target.matches(".showcase-slot, .available-item, .mini-card")) event.target.click();
});

document.addEventListener("dragstart", (event) => {
  const available = event.target.closest("[data-drag-mini]");
  const slot = event.target.closest(".showcase-slot[data-mini-id]");
  if (available) {
    draggedMiniId = available.dataset.dragMini;
    draggedSlot = null;
    selectedMiniId = null;
  } else if (slot?.dataset.miniId) {
    draggedMiniId = slot.dataset.miniId;
    draggedSlot = Number(slot.dataset.slot);
  } else return;
  event.dataTransfer.effectAllowed = "move";
  event.dataTransfer.setData("text/plain", draggedMiniId);
});
document.addEventListener("dragover", (event) => {
  const slot = event.target.closest(".showcase-slot");
  if (slot) { event.preventDefault(); slot.classList.add("drag-over"); }
});
document.addEventListener("dragleave", (event) => {
  const slot = event.target.closest(".showcase-slot");
  if (slot && !slot.contains(event.relatedTarget)) slot.classList.remove("drag-over");
});
document.addEventListener("drop", (event) => {
  const slot = event.target.closest(".showcase-slot");
  if (!slot) return;
  event.preventDefault();
  slot.classList.remove("drag-over");
  const id = draggedMiniId || event.dataTransfer.getData("text/plain");
  if (id) placeMini(Number(slot.dataset.slot), id, draggedSlot);
  draggedMiniId = null; draggedSlot = null; selectedMiniId = null;
});
document.addEventListener("dragend", () => {
  draggedMiniId = null; draggedSlot = null;
  $$(".drag-over").forEach((slot) => slot.classList.remove("drag-over"));
});

initializeAuthentication();
