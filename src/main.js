import "./style.css";
import { authConfigured, getCurrentSession, onAuthStateChange, sendEmailOtp, signOut, verifyEmailOtp } from "./auth.js";

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
let pendingLoginEmail = sessionStorage.getItem("miniverso-pending-email") || "";
let resendTimer = null;
let draggedMiniId = null;
let draggedSlot = null;
let selectedMiniId = null;
let photoData = "";

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
    ? raw.minis.filter((mini) => mini && typeof mini.id === "string" && typeof mini.name === "string" && mini.name.trim())
    : [];
  const miniIds = new Set(minis.map((mini) => mini.id));
  const showcases = Array.isArray(raw.showcases)
    ? raw.showcases.filter((item) => item && typeof item.id === "string" && typeof item.name === "string").map((item) => ({
        ...item,
        rows: Math.min(8, Math.max(1, Number.parseInt(item.rows, 10) || 1)),
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
  const code = error?.code || "";
  if (code === "otp_expired") return "O código expirou. Solicite um novo código.";
  if (code === "over_email_send_rate_limit") return "Aguarde um pouco antes de solicitar outro código.";
  if (code === "over_request_rate_limit") return "Muitas tentativas. Aguarde alguns minutos e tente novamente.";
  if (code === "otp_disabled") return "O envio de códigos está desativado no serviço de autenticação.";
  if (/invalid|expired/i.test(error?.message || "")) return "Código inválido ou expirado.";
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

function showOtpStep(email) {
  pendingLoginEmail = email;
  sessionStorage.setItem("miniverso-pending-email", email);
  $("#email-login-form").hidden = true;
  $("#otp-login-form").hidden = false;
  $("#otp-email").textContent = email;
  $("#login-code").value = "";
  $("#login-code").focus();
}

function showEmailStep() {
  $("#otp-login-form").hidden = true;
  $("#email-login-form").hidden = false;
  $("#login-email").value = pendingLoginEmail;
  setAuthMessage("");
  $("#login-email").focus();
}

function startResendCooldown(seconds = 60) {
  clearInterval(resendTimer);
  const button = $("#resend-code-button");
  let remaining = seconds;
  button.disabled = true;
  button.textContent = `Reenviar em ${remaining}s`;
  resendTimer = setInterval(() => {
    remaining -= 1;
    button.textContent = remaining > 0 ? `Reenviar em ${remaining}s` : "Reenviar código";
    if (remaining <= 0) {
      clearInterval(resendTimer);
      button.disabled = false;
    }
  }, 1000);
}

function enterAuthenticatedApp(session) {
  if (!session?.user?.id) return;
  currentUserId = session.user.id;
  state = loadState();
  const email = session.user.email || "Conta conectada";
  $("#user-email-desktop").textContent = email;
  $(".avatar").textContent = email.charAt(0).toLocaleUpperCase("pt-BR");
  $(".avatar").title = email;
  $("#auth-screen").hidden = true;
  $("#app-shell").hidden = false;
  $("#mobile-nav").hidden = false;
  sessionStorage.removeItem("miniverso-pending-email");
  renderCollection();
  renderPlanner();
}

function leaveAuthenticatedApp() {
  currentUserId = null;
  state = freshState();
  $("#app-shell").hidden = true;
  $("#mobile-nav").hidden = true;
  $("#auth-screen").hidden = false;
  showEmailStep();
}

async function initializeAuthentication() {
  if (!authConfigured) {
    setAuthMessage("Configure VITE_SUPABASE_URL e VITE_SUPABASE_PUBLISHABLE_KEY para ativar o envio de códigos.", true);
    setFormBusy($("#email-login-form"), true);
    return;
  }
  try {
    const session = await getCurrentSession();
    if (session) enterAuthenticatedApp(session);
    else {
      $("#auth-screen").hidden = false;
      if (pendingLoginEmail) showOtpStep(pendingLoginEmail);
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

function positionLabel(id) {
  const placement = state.placements[id];
  if (!placement) return "Guardada";
  const showcase = getShowcase(placement.showcaseId);
  if (!showcase) return "Guardada";
  const row = Math.floor(placement.slot / showcase.columns) + 1;
  const column = (placement.slot % showcase.columns) + 1;
  return `${showcase.name} · ${row}×${column}`;
}

function updateStats() {
  $("#stat-total").textContent = state.minis.length;
  $("#stat-displayed").textContent = state.minis.filter((mini) => state.placements[mini.id] && getShowcase(state.placements[mini.id].showcaseId)).length;
  $("#stat-stored").textContent = state.minis.length - Number($("#stat-displayed").textContent);
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
  const filtered = state.minis.filter((mini) => {
    const text = normalizeText([mini.name, mini.maker, mini.vehicleBrand, mini.model, mini.scale, mini.color, mini.catalogCode, mini.releaseYear, mini.category, mini.series, mini.seriesNumber, mini.wheelType, mini.steeringSide, mini.editionSize, mini.exclusivity].join(" "));
    const displayed = Boolean(state.placements[mini.id] && getShowcase(state.placements[mini.id].showcaseId));
    return (!query || text.includes(query)) && (location === "all" || (location === "displayed" ? displayed : !displayed)) && (maker === "all" || mini.maker === maker);
  });
  $("#collection-count").textContent = filtered.length;
  const grid = $("#collection-grid");
  grid.innerHTML = filtered.map((mini) => miniCard(mini)).join("");
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
  return `<article class="mini-card">
    <div class="mini-photo">${photo}<span class="photo-tag">${escapeHtml(mini.scale || "Escala não informada")}</span><div class="card-menu"><button class="card-menu-button" data-edit-mini="${mini.id}" aria-label="Editar ${escapeHtml(mini.name)}">•••</button></div></div>
    <div class="card-info"><p class="card-maker">${escapeHtml(mini.maker || "Fabricante não informado")}</p><h3 class="card-title" title="${escapeHtml(mini.name)}">${escapeHtml(mini.name)}</h3>
      <p class="card-meta">${escapeHtml([mini.vehicleBrand, mini.model, mini.releaseYear, mini.category, mini.series].filter(Boolean).join(" · ") || "Veículo não informado")}</p><div class="card-divider"></div>
      <div class="card-bottom"><span class="condition-badge ${mini.sealed ? "" : "loose"}">${mini.sealed ? "Lacrada" : "Fora da embalagem"}</span><span class="display-location">⌂ ${escapeHtml(location)}</span></div>
      <div class="card-actions"><button class="icon-button" data-edit-mini="${mini.id}" aria-label="Editar miniatura">✎</button><button class="icon-button" data-delete-mini="${mini.id}" aria-label="Excluir miniatura">⌫</button></div>
    </div></article>`;
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

function openMiniForm(id = null) {
  const mini = id ? getMini(id) : null;
  photoData = mini?.photo || "";
  const preview = photoData || "";
  modal(`<div class="modal-head"><div><p class="eyebrow">INVENTÁRIO PESSOAL</p><h2>${mini ? "Editar miniatura" : "Nova miniatura"}</h2></div><button class="modal-close" data-modal-close aria-label="Fechar">×</button></div>
    <form class="modal-form" id="mini-form"><div class="form-grid">
      <div class="form-field full"><span class="photo-label">Foto da miniatura</span><div class="photo-upload"><img id="photo-preview" class="photo-preview" src="${preview}" alt="Prévia da foto" ${preview ? "" : "hidden"} /><div class="photo-upload-info"><span id="photo-hint">${preview ? "Foto pronta para salvar" : "Uma foto ajuda a destacar sua miniatura"}</span><div class="photo-actions"><label class="upload-button"><span id="upload-button-label">${preview ? "Trocar foto" : "Escolher foto"}</span><input id="photo-input" type="file" accept="image/*" /></label><button id="remove-photo-button" class="upload-button remove-photo" type="button" ${preview ? "" : "hidden"}>Remover foto</button></div></div></div></div>
      <div class="form-field full"><label for="mini-name">Nome da miniatura *</label><input id="mini-name" name="name" required maxlength="90" value="${escapeHtml(mini?.name || "")}" placeholder="Ex.: Porsche 911 Carrera RS" /></div>
      <div class="form-field"><label for="mini-maker">Fabricante da miniatura</label><input id="mini-maker" name="maker" maxlength="60" value="${escapeHtml(mini?.maker || "")}" placeholder="Ex.: Mini GT" /></div>
      <div class="form-field"><label for="mini-vehicle-brand">Marca do veículo</label><input id="mini-vehicle-brand" name="vehicleBrand" maxlength="60" value="${escapeHtml(mini?.vehicleBrand || "")}" placeholder="Ex.: Porsche" /></div>
      <div class="form-field"><label for="mini-model">Modelo</label><input id="mini-model" name="model" maxlength="70" value="${escapeHtml(mini?.model || "")}" placeholder="Ex.: 911 Carrera RS" /></div>
      <div class="form-field"><label for="mini-scale">Escala</label><input id="mini-scale" name="scale" maxlength="20" value="${escapeHtml(mini?.scale || "")}" placeholder="Ex.: 1:64" /></div>
      <div class="form-field"><label for="mini-color">Cor</label><input id="mini-color" name="color" maxlength="40" value="${escapeHtml(mini?.color || "")}" placeholder="Ex.: Laranja" /></div>
      <div class="form-section-title full"><span>DADOS DE CATÁLOGO</span><small>Opcional · útil para Hot Wheels e outras linhas</small></div>
      <div class="form-field"><label for="mini-catalog-code">Código / Toy number</label><input id="mini-catalog-code" name="catalogCode" maxlength="40" value="${escapeHtml(mini?.catalogCode || "")}" placeholder="Ex.: HKG47" /></div>
      <div class="form-field"><label for="mini-release-year">Ano da edição</label><input id="mini-release-year" name="releaseYear" type="number" min="1960" max="2100" value="${escapeHtml(mini?.releaseYear || "")}" placeholder="Ex.: 2023" /></div>
      <div class="form-field full"><label for="mini-category">Linha / categoria</label><input id="mini-category" name="category" maxlength="80" value="${escapeHtml(mini?.category || "")}" placeholder="Ex.: Premium · Mainline · Super T-Hunt" /></div>
      <div class="form-field"><label for="mini-series">Série / coleção</label><input id="mini-series" name="series" maxlength="90" value="${escapeHtml(mini?.series || "")}" placeholder="Ex.: HW J-Imports" /></div>
      <div class="form-field"><label for="mini-series-number">Número na série</label><input id="mini-series-number" name="seriesNumber" maxlength="30" value="${escapeHtml(mini?.seriesNumber || "")}" placeholder="Ex.: 3/10" /></div>
      <div class="form-field"><label for="mini-wheel-type">Tipo de roda</label><input id="mini-wheel-type" name="wheelType" maxlength="50" value="${escapeHtml(mini?.wheelType || "")}" placeholder="Ex.: Real Riders" /></div>
      <div class="form-field"><label for="mini-steering-side">Direção</label><select id="mini-steering-side" name="steeringSide"><option value="" ${!mini?.steeringSide ? "selected" : ""}>Não informada</option><option value="LHD" ${mini?.steeringSide === "LHD" ? "selected" : ""}>LHD · volante à esquerda</option><option value="RHD" ${mini?.steeringSide === "RHD" ? "selected" : ""}>RHD · volante à direita</option><option value="LHD/RHD" ${mini?.steeringSide === "LHD/RHD" ? "selected" : ""}>Versões LHD e RHD</option></select></div>
      <div class="form-field"><label for="mini-edition-size">Tiragem</label><input id="mini-edition-size" name="editionSize" maxlength="40" value="${escapeHtml(mini?.editionSize || "")}" placeholder="Ex.: 1.200 peças" /></div>
      <div class="form-field"><label for="mini-exclusivity">Edição / exclusividade</label><input id="mini-exclusivity" name="exclusivity" maxlength="100" value="${escapeHtml(mini?.exclusivity || "")}" placeholder="Ex.: Japão · evento · chase" /></div>
      <div class="form-field"><label>Condição</label><label class="check-row"><input type="checkbox" name="sealed" ${mini?.sealed !== false ? "checked" : ""} /> Lacrada na embalagem</label></div>
      <div class="form-field full"><label for="mini-notes">Observações</label><textarea id="mini-notes" name="notes" maxlength="500" placeholder="Detalhes, edição, onde encontrou...">${escapeHtml(mini?.notes || "")}</textarea></div>
    </div><div class="modal-actions"><button type="button" class="button button-quiet" data-modal-close>Cancelar</button><button class="button button-primary" type="submit">${mini ? "Salvar alterações" : "Adicionar à coleção"}</button></div></form>`);

  $("#photo-input").addEventListener("change", (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith("image/")) { showToast("Escolha um arquivo de imagem."); return; }
    if (file.size > 6 * 1024 * 1024) { showToast("A imagem deve ter até 6 MB."); event.target.value = ""; return; }
    const image = new Image();
    const objectUrl = URL.createObjectURL(file);
    image.onload = () => {
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

  $("#mini-form").addEventListener("submit", (event) => {
    event.preventDefault();
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
      sealed: form.has("sealed"),
      notes: (data.notes || "").trim(),
      photo: photoData,
      createdAt: mini?.createdAt || new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    const previousMinis = state.minis;
    if (mini) state.minis = state.minis.map((item) => item.id === mini.id ? record : item);
    else state.minis = [record, ...state.minis];
    if (!saveState()) {
      state.minis = previousMinis;
      updateStats();
      return;
    }
    closeModal();
    renderCollection();
    if (activeView === "planner") renderPlanner();
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
      <div class="form-field"><label for="showcase-rows">Linhas *</label><input id="showcase-rows" name="rows" type="number" min="1" max="8" required value="${showcase?.rows || 5}" /></div>
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

$("#email-login-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const email = String(new FormData(form).get("email") || "").trim().toLocaleLowerCase("pt-BR");
  if (!email) return;
  setFormBusy(form, true);
  setAuthMessage("Enviando seu código...");
  try {
    await sendEmailOtp(email);
    showOtpStep(email);
    startResendCooldown();
    setAuthMessage("Código enviado. Verifique também a pasta de spam.");
  } catch (error) {
    setAuthMessage(authErrorMessage(error), true);
  } finally {
    setFormBusy(form, false);
  }
});

$("#otp-login-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const token = String(new FormData(form).get("code") || "").replace(/\D/g, "");
  if (!pendingLoginEmail || token.length < 6) {
    setAuthMessage("Digite o código completo recebido por e-mail.", true);
    return;
  }
  setFormBusy(form, true);
  setAuthMessage("Confirmando código...");
  try {
    const session = await verifyEmailOtp(pendingLoginEmail, token);
    if (!session) throw new Error("A sessão não foi criada.");
    enterAuthenticatedApp(session);
  } catch (error) {
    setAuthMessage(authErrorMessage(error), true);
  } finally {
    setFormBusy(form, false);
  }
});

$("#resend-code-button").addEventListener("click", async () => {
  if (!pendingLoginEmail) return showEmailStep();
  const button = $("#resend-code-button");
  button.disabled = true;
  setAuthMessage("Reenviando código...");
  try {
    await sendEmailOtp(pendingLoginEmail);
    startResendCooldown();
    setAuthMessage("Novo código enviado.");
  } catch (error) {
    button.disabled = false;
    setAuthMessage(authErrorMessage(error), true);
  }
});

$("#change-email-button").addEventListener("click", showEmailStep);

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
$("#add-showcase-button").addEventListener("click", () => openShowcaseForm());
$("#empty-showcase-button").addEventListener("click", () => openShowcaseForm());
$("#edit-showcase-button").addEventListener("click", () => openShowcaseForm(state.activeShowcaseId));
$("#delete-showcase-button").addEventListener("click", deleteShowcase);
$("#search-input").addEventListener("input", renderCollection);
$("#filter-location").addEventListener("change", renderCollection);
$("#filter-maker").addEventListener("change", renderCollection);
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
  if (event.key === "Enter" && event.target.matches(".showcase-slot, .available-item")) event.target.click();
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
