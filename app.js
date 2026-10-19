"use strict";

const STORAGE_KEY = "tooltrack_kiosk_v1";
const USERS_KEY = "tooltrack_kiosk_users_v1";
const APP_VERSION = 1;
const PASSWORD_ITERATIONS = 120000;
const ROLE_LABELS = {
  admin: "Administrador",
  engineer: "Ingeniero",
  technician: "Técnico",
  operator: "Operador"
};
const ROLE_PERMISSIONS = {
  admin: ["*"],
  engineer: ["*"],
  technician: ["view", "createTool", "movement", "maintenance"],
  operator: ["view", "exportCsv"]
};

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

const dom = {
  appShell: $("#appShell"),
  authScreen: $("#authScreen"),
  sidebar: $("#sidebar"),
  pageTitle: $("#pageTitle"),
  siteNameLabel: $("#siteNameLabel"),
  lastSavedLabel: $("#lastSavedLabel"),
  operatorName: $("#operatorName"),
  operatorRole: $("#operatorRole"),
  operatorAvatar: $("#operatorAvatar"),
  modalBackdrop: $("#modalBackdrop"),
  modal: $("#modal"),
  modalEyebrow: $("#modalEyebrow"),
  modalTitle: $("#modalTitle"),
  modalBody: $("#modalBody"),
  modalForm: $("#modalForm"),
  modalSubmitButton: $("#modalSubmitButton"),
  modalCancelButton: $("#modalCancelButton"),
  toastRegion: $("#toastRegion")
};

let activeView = "dashboard";
let maintenanceFilter = "all";
let modalSubmitHandler = null;
let accountsLoadError = "";
let accounts = loadAccounts();
let currentUser = null;

function loadAccounts() {
  try {
    const raw = localStorage.getItem(USERS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed) || parsed.some((account) =>
      !account || typeof account.id !== "string" || typeof account.name !== "string" ||
      typeof account.username !== "string" || typeof account.salt !== "string" ||
      typeof account.passwordHash !== "string" || !ROLE_LABELS[account.role]
    )) throw new Error("La lista de usuarios no tiene un formato válido.");
    return parsed;
  } catch (error) {
    console.error("No fue posible leer las cuentas locales:", error);
    accountsLoadError = "No se pudo leer la lista de usuarios guardada. No se habilitó el acceso inicial.";
    return [];
  }
}

function saveAccounts() {
  localStorage.setItem(USERS_KEY, JSON.stringify(accounts));
}

function can(permission) {
  if (!currentUser) return false;
  if (permission === "manageUsers") return currentUser.role === "admin";
  const permissions = ROLE_PERMISSIONS[currentUser.role] || [];
  return permissions.includes("*") || permissions.includes(permission);
}

function canView(viewName) {
  return can("view") && (viewName !== "settings" || ["admin", "engineer"].includes(currentUser?.role));
}

function requirePermission(permission) {
  if (can(permission)) return true;
  showToast("Acceso no permitido", "Tu perfil no cuenta con permiso para realizar esta acción.", "error");
  return false;
}

function hashPassword(password, salt) {
  const encoder = new TextEncoder();
  const saltBytes = salt ? Uint8Array.from(atob(salt), (character) => character.charCodeAt(0)) : crypto.getRandomValues(new Uint8Array(16));
  return crypto.subtle.importKey("raw", encoder.encode(password), "PBKDF2", false, ["deriveBits"])
    .then((key) => crypto.subtle.deriveBits(
      { name: "PBKDF2", salt: saltBytes, iterations: PASSWORD_ITERATIONS, hash: "SHA-256" },
      key,
      256
    ))
    .then((bits) => ({
      salt: salt || btoa(String.fromCharCode(...saltBytes)),
      passwordHash: btoa(String.fromCharCode(...new Uint8Array(bits)))
    }));
}

function renderAuthScreen(errorMessage = "") {
  const firstAccount = accounts.length === 0 && !accountsLoadError;
  dom.authScreen.innerHTML = `
    <div class="auth-card">
      <div class="auth-brand"><div class="brand-mark" aria-hidden="true">TT</div><div><strong>ToolTrack</strong><span>Control de herramental</span></div></div>
      <p class="eyebrow">${firstAccount ? "CONFIGURACIÓN INICIAL" : "ACCESO AL SISTEMA"}</p>
      <h1>${accountsLoadError ? "Acceso no disponible" : firstAccount ? "Crear administrador" : "Iniciar sesión"}</h1>
      <p class="auth-description">${accountsLoadError
        ? "No se pudo cargar la configuración de usuarios de este navegador."
        : firstAccount
        ? "Registra la primera cuenta administradora para proteger esta instalación."
        : "Ingresa con tu usuario y contraseña para continuar."}</p>
      ${(errorMessage || accountsLoadError) ? `<p class="auth-error" role="alert">${escapeHtml(errorMessage || accountsLoadError)}</p>` : ""}
      ${accountsLoadError ? "" : `<form id="authForm" class="form-stack">
        ${firstAccount ? `<label><span>Nombre completo</span><input name="name" required maxlength="80" autocomplete="name"></label>` : ""}
        <label><span>Usuario</span><input name="username" required maxlength="40" autocomplete="username"></label>
        <label><span>Contraseña${firstAccount ? " (mínimo 8 caracteres)" : ""}</span><input name="password" type="password" required ${firstAccount ? "minlength='8'" : ""} autocomplete="${firstAccount ? "new-password" : "current-password"}"></label>
        ${firstAccount ? `<label><span>Confirmar contraseña</span><input name="confirmPassword" type="password" required minlength="8" autocomplete="new-password"></label>` : ""}
        <button class="button button-primary" type="submit">${firstAccount ? "Crear administrador" : "Entrar"}</button>
      </form>`}
    </div>`;
  dom.authScreen.hidden = false;
  dom.appShell.classList.remove("authenticated");
  $("#authForm")?.addEventListener("submit", onAuthSubmit);
  $("input", dom.authScreen)?.focus();
}

async function onAuthSubmit(event) {
  event.preventDefault();
  const formData = new FormData(event.currentTarget);
  const username = String(formData.get("username") || "").trim().toLocaleLowerCase("es-MX");
  const password = String(formData.get("password") || "");

  try {
    if (!accounts.length) {
      const name = String(formData.get("name") || "").trim();
      const confirmPassword = String(formData.get("confirmPassword") || "");
      if (password.length < 8 || password !== confirmPassword) {
        renderAuthScreen(password.length < 8 ? "La contraseña debe tener al menos 8 caracteres." : "Las contraseñas no coinciden.");
        return;
      }
      if (!name || !username) {
        renderAuthScreen("Completa el nombre y el usuario.");
        return;
      }
      const credentials = await hashPassword(password);
      const account = {
        id: newId("user"),
        name,
        username,
        role: "admin",
        ...credentials,
        createdAt: nowISO()
      };
      accounts.push(account);
      try {
        saveAccounts();
      } catch (error) {
        accounts.pop();
        throw error;
      }
      startSession(account);
      showToast("Administrador creado", "La configuración inicial quedó lista.", "success");
      return;
    }

    const account = accounts.find((item) => item.username === username);
    if (!account) {
      renderAuthScreen("Usuario o contraseña incorrectos.");
      return;
    }
    const credentials = await hashPassword(password, account.salt);
    if (credentials.passwordHash !== account.passwordHash) {
      renderAuthScreen("Usuario o contraseña incorrectos.");
      return;
    }
    startSession(account);
  } catch (error) {
    console.error("No fue posible completar el acceso:", error);
    renderAuthScreen("No se pudo validar la cuenta en este navegador. Intenta de nuevo.");
  }
}

function startSession(account) {
  currentUser = account;
  if (account.role !== "operator") {
    state.settings.currentOperator = account.name;
    saveState({ silent: true });
  }
  dom.authScreen.hidden = true;
  dom.appShell.classList.add("authenticated");
  $("#operatorButton").title = `${ROLE_LABELS[account.role]} · ${account.username}`;
  activeView = "dashboard";
  switchView(activeView);
  window.setTimeout(checkMaintenanceNotification, 1000);
}

function logout() {
  currentUser = null;
  dom.appShell.classList.remove("authenticated");
  closeModal();
  renderAuthScreen();
}

function newId(prefix = "id") {
  if (globalThis.crypto?.randomUUID) return `${prefix}_${crypto.randomUUID()}`;
  return `${prefix}_${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

function nowISO() {
  return new Date().toISOString();
}

function todayISO() {
  const date = new Date();
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function defaultState() {
  return {
    version: APP_VERSION,
    settings: {
      siteName: "Planta / Área",
      defaultWarningDays: 7,
      currentOperator: "Administrador",
      browserNotifications: false,
      lastNotificationDate: ""
    },
    types: [],
    tools: [],
    events: [],
    maintenanceRecords: [],
    meta: {
      createdAt: nowISO(),
      updatedAt: nowISO()
    }
  };
}

function normalizeState(candidate) {
  const base = defaultState();
  if (!candidate || typeof candidate !== "object") return base;

  return {
    version: APP_VERSION,
    settings: {
      ...base.settings,
      ...(candidate.settings && typeof candidate.settings === "object" ? candidate.settings : {})
    },
    types: Array.isArray(candidate.types) ? candidate.types : [],
    tools: Array.isArray(candidate.tools) ? candidate.tools : [],
    events: Array.isArray(candidate.events) ? candidate.events : [],
    maintenanceRecords: Array.isArray(candidate.maintenanceRecords) ? candidate.maintenanceRecords : [],
    meta: {
      ...base.meta,
      ...(candidate.meta && typeof candidate.meta === "object" ? candidate.meta : {})
    }
  };
}

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? normalizeState(JSON.parse(raw)) : defaultState();
  } catch (error) {
    console.error("No fue posible leer la información local:", error);
    return defaultState();
  }
}

let state = loadState();

function saveState({ silent = false } = {}) {
  state.meta.updatedAt = nowISO();
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  const time = new Date().toLocaleTimeString("es-MX", { hour: "2-digit", minute: "2-digit" });
  dom.lastSavedLabel.textContent = `Guardado ${time}`;
  if (!silent) showToast("Cambios guardados", "La información quedó almacenada en esta computadora.", "success");
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function parseLocalDate(value) {
  if (!value) return null;
  const [year, month, day] = value.split("-").map(Number);
  if (!year || !month || !day) return null;
  return new Date(year, month - 1, day, 12, 0, 0, 0);
}

function formatDate(value, fallback = "Sin fecha") {
  const date = parseLocalDate(value);
  if (!date) return fallback;
  return new Intl.DateTimeFormat("es-MX", {
    day: "2-digit",
    month: "short",
    year: "numeric"
  }).format(date).replaceAll(".", "");
}

function formatDateTime(value) {
  if (!value) return "Sin fecha";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Sin fecha";
  return new Intl.DateTimeFormat("es-MX", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  }).format(date).replaceAll(".", "");
}

function dateToISO(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function addFrequency(startValue, quantity, unit) {
  const date = parseLocalDate(startValue);
  const amount = Number(quantity);
  if (!date || !Number.isFinite(amount) || amount < 1) return "";

  if (unit === "days") date.setDate(date.getDate() + amount);
  if (unit === "weeks") date.setDate(date.getDate() + amount * 7);
  if (unit === "months") {
    const originalDay = date.getDate();
    date.setDate(1);
    date.setMonth(date.getMonth() + amount);
    const lastDay = new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate();
    date.setDate(Math.min(originalDay, lastDay));
  }
  return dateToISO(date);
}

function daysFromToday(dateValue) {
  const target = parseLocalDate(dateValue);
  const today = parseLocalDate(todayISO());
  if (!target || !today) return null;
  return Math.round((target.getTime() - today.getTime()) / 86400000);
}

function maintenanceState(tool) {
  if (tool.status === "scrap") return { key: "scrap", label: "Scrap", days: null, badge: "neutral" };
  const days = daysFromToday(tool.nextMaintenance);
  const warningDays = Number(tool.warningDays ?? state.settings.defaultWarningDays ?? 7);
  if (days === null) return { key: "unscheduled", label: "Sin programa", days: null, badge: "neutral" };
  if (days < 0) return { key: "overdue", label: `${Math.abs(days)} día${Math.abs(days) === 1 ? "" : "s"} vencido`, days, badge: "danger" };
  if (days === 0) return { key: "today", label: "Vence hoy", days, badge: "warning" };
  if (days <= warningDays) return { key: "dueSoon", label: `Vence en ${days} día${days === 1 ? "" : "s"}`, days, badge: "warning" };
  return { key: "current", label: `${days} días restantes`, days, badge: "success" };
}

function getType(typeId) {
  return state.types.find((item) => item.id === typeId) ?? null;
}

function getTool(toolId) {
  return state.tools.find((item) => item.id === toolId) ?? null;
}

function statusInfo(tool) {
  const map = {
    tool: { label: "En Tool Crib", badge: "success", location: "Tool Crib" },
    floor: { label: "En piso", badge: "purple", location: tool.location || "Línea sin especificar" },
    maintenance: { label: "En mantenimiento", badge: "warning", location: tool.location || "Área de mantenimiento" },
    scrap: { label: "Scrap", badge: "neutral", location: "Scrap" }
  };
  return map[tool.status] ?? map.tool;
}

function badge(label, kind = "neutral") {
  return `<span class="badge ${escapeHtml(kind)}">${escapeHtml(label)}</span>`;
}

function frequencyLabel(tool) {
  const units = { days: "día", weeks: "semana", months: "mes" };
  const unit = units[tool.frequencyUnit] ?? "periodo";
  const plural = Number(tool.frequencyValue) === 1 ? unit : `${unit}${unit === "mes" ? "es" : "s"}`;
  return `Cada ${tool.frequencyValue} ${plural}`;
}

function initials(name) {
  return String(name || "AD")
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("") || "AD";
}

function addEvent(tool, eventType, title, detail, options = {}) {
  state.events.push({
    id: newId("evt"),
    toolId: tool.id,
    eventType,
    title,
    detail,
    at: options.at || nowISO(),
    performedBy: options.performedBy || state.settings.currentOperator,
    requestedBy: options.requestedBy || "",
    location: options.location || statusInfo(tool).location,
    metadata: options.metadata || {}
  });
}

function emptyState(icon, title, text, action = "", actionLabel = "") {
  return `
    <div class="empty-state">
      <div>
        <div class="empty-state-icon">${icon}</div>
        <h3>${escapeHtml(title)}</h3>
        <p>${escapeHtml(text)}</p>
        ${action ? `<button class="button button-primary" data-action="${escapeHtml(action)}">${escapeHtml(actionLabel)}</button>` : ""}
      </div>
    </div>`;
}

function showToast(title, message, type = "info", duration = 4200) {
  const toast = document.createElement("div");
  toast.className = `toast ${type}`;
  const icons = { success: "✓", error: "!", warning: "△", info: "i" };
  toast.innerHTML = `
    <div class="toast-icon">${icons[type] || "i"}</div>
    <div><strong>${escapeHtml(title)}</strong><span>${escapeHtml(message)}</span></div>
    <button type="button" aria-label="Cerrar">×</button>`;
  $("button", toast).addEventListener("click", () => toast.remove());
  dom.toastRegion.appendChild(toast);
  window.setTimeout(() => toast.remove(), duration);
}

function switchView(viewName) {
  const target = $(`#view-${viewName}`);
  if (!target) return;
  if (!canView(viewName)) {
    showToast("Acceso no permitido", "Tu perfil no tiene acceso a esta sección.", "error");
    return;
  }
  activeView = viewName;
  $$(".view").forEach((view) => view.classList.toggle("active", view === target));
  $$(".nav-item").forEach((item) => item.classList.toggle("active", item.dataset.view === viewName));
  dom.pageTitle.textContent = target.dataset.title || "ToolTrack";
  dom.sidebar.classList.remove("open");
  if (window.matchMedia("(max-width: 850px)").matches) {
    dom.appShell.classList.remove("menu-open");
    $("#menuButton").setAttribute("aria-expanded", "false");
    $("#menuButton").setAttribute("aria-label", "Abrir menú");
  } else {
    const expanded = !dom.appShell.classList.contains("sidebar-collapsed");
    $("#menuButton").setAttribute("aria-expanded", String(expanded));
  }
  renderAll();
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function updateBranding() {
  dom.siteNameLabel.textContent = state.settings.siteName || "Planta / Área";
  dom.operatorName.textContent = currentUser?.name || "Sin sesión";
  dom.operatorRole.textContent = ROLE_LABELS[currentUser?.role] || "Sesión activa";
  dom.operatorAvatar.textContent = initials(currentUser?.name);
}

function updateClock() {
  const now = new Date();
  $("#clockTime").textContent = now.toLocaleTimeString("es-MX", { hour: "2-digit", minute: "2-digit" });
  $("#clockDate").textContent = now.toLocaleDateString("es-MX", { weekday: "short", day: "2-digit", month: "short" }).replaceAll(".", "");
}

function openModal({ eyebrow = "REGISTRO", title, body, submitLabel = "Guardar", onSubmit = null, wide = false, hideSubmit = false, cancelLabel = "Cancelar" }) {
  dom.modalEyebrow.textContent = eyebrow;
  dom.modalTitle.textContent = title;
  dom.modalBody.innerHTML = body;
  dom.modalSubmitButton.textContent = submitLabel;
  dom.modalSubmitButton.hidden = hideSubmit;
  dom.modalSubmitButton.disabled = false;
  dom.modalCancelButton.textContent = cancelLabel;
  dom.modal.classList.toggle("wide", wide);
  modalSubmitHandler = onSubmit;
  dom.modalBackdrop.hidden = false;
  document.body.style.overflow = "hidden";
  window.setTimeout(() => $("input:not([type='hidden']), select, textarea", dom.modalBody)?.focus(), 20);
}

function closeModal() {
  dom.modalBackdrop.hidden = true;
  document.body.style.overflow = "";
  dom.modalBody.innerHTML = "";
  dom.modalForm.reset();
  dom.modalSubmitButton.hidden = false;
  dom.modalSubmitButton.disabled = false;
  modalSubmitHandler = null;
}

function renderDashboard() {
  const activeTools = state.tools.filter((tool) => tool.status !== "scrap");
  const inTool = activeTools.filter((tool) => tool.status === "tool").length;
  const onFloor = activeTools.filter((tool) => tool.status === "floor").length;
  const overdue = activeTools.filter((tool) => maintenanceState(tool).key === "overdue").length;
  const dueSoon = activeTools.filter((tool) => ["today", "dueSoon"].includes(maintenanceState(tool).key)).length;

  const metrics = [
    { label: "Herramentales activos", value: activeTools.length, icon: "▣", accent: "#123c69", soft: "#e8f2fb" },
    { label: "Disponibles en Tool Crib", value: inTool, icon: "✓", accent: "#167551", soft: "#e7f7f0" },
    { label: "Actualmente en piso", value: onFloor, icon: "→", accent: "#6e4db2", soft: "#f0ebfb" },
    { label: "Mantenimiento vencido", value: overdue, icon: "!", accent: "#b4232a", soft: "#fdebec" }
  ];
  $("#dashboardMetrics").innerHTML = metrics.map((item) => `
    <article class="metric-card" style="--accent:${item.accent};--accent-soft:${item.soft}">
      <div class="metric-card-top"><span>${item.label}</span><span class="metric-icon">${item.icon}</span></div>
      <strong>${item.value}</strong>
    </article>`).join("");

  const alerts = activeTools
    .map((tool) => ({ tool, maintenance: maintenanceState(tool) }))
    .filter(({ maintenance }) => ["overdue", "today", "dueSoon"].includes(maintenance.key))
    .sort((a, b) => (a.maintenance.days ?? 9999) - (b.maintenance.days ?? 9999));

  const alertsContainer = $("#dashboardAlerts");
  if (!alerts.length) {
    alertsContainer.innerHTML = `<div class="empty-state compact"><div><div class="empty-state-icon">✓</div><h3>Sin mantenimientos urgentes</h3><p>${dueSoon ? `${dueSoon} próximos.` : "Todos los herramentales están dentro de su vigencia."}</p></div></div>`;
  } else {
    alertsContainer.innerHTML = `<div class="alert-list">${alerts.slice(0, 7).map(({ tool, maintenance }) => `
      <div class="alert-row">
        <span class="alert-marker ${maintenance.key === "overdue" ? "overdue" : ""}"></span>
        <div class="alert-copy">
          <strong>${escapeHtml(tool.assetCode)} · ${escapeHtml(tool.name)}</strong>
          <span>${escapeHtml(maintenance.label)} · ${escapeHtml(statusInfo(tool).location)}</span>
        </div>
        <span class="alert-date">${formatDate(tool.nextMaintenance)}</span>
        ${can("maintenance") ? `<button class="mini-button" data-action="maintenance" data-id="${tool.id}" ${tool.status === "floor" ? "disabled title='Primero debe regresar a Tool Crib'" : ""}>Atender</button>` : ""}
      </div>`).join("")}</div>`;
  }

  const recent = [...state.events].sort((a, b) => new Date(b.at) - new Date(a.at)).slice(0, 6);
  const activity = $("#recentActivity");
  if (!recent.length) {
    activity.innerHTML = `<div class="empty-state compact"><div><div class="empty-state-icon">↳</div><h3>Aún no hay actividad</h3><p>Los movimientos y mantenimientos aparecerán aquí.</p></div></div>`;
  } else {
    activity.innerHTML = `<div class="activity-list">${recent.map((event) => `
      <div class="activity-row">
        <div class="activity-icon">${eventIcon(event.eventType)}</div>
        <div class="activity-copy">
          <strong>${escapeHtml(event.title)}</strong>
          <span>${escapeHtml(event.detail)}</span>
          <small>${formatDateTime(event.at)} · ${escapeHtml(event.performedBy)}</small>
        </div>
      </div>`).join("")}</div>`;
  }
}

function eventIcon(type) {
  const map = {
    created: "+", edited: "✎", checkout: "→", return: "←",
    maintenance_success: "✓", maintenance_failed: "!", scrap: "×"
  };
  return map[type] || "•";
}

function renderTools() {
  const typeFilter = $("#toolTypeFilter");
  const currentType = typeFilter.value || "all";
  typeFilter.innerHTML = `<option value="all">Todos los tipos</option>${state.types.map((type) => `<option value="${type.id}">${escapeHtml(type.name)}</option>`).join("")}`;
  typeFilter.value = state.types.some((type) => type.id === currentType) ? currentType : "all";

  const search = $("#toolSearch").value.trim().toLocaleLowerCase("es-MX");
  const status = $("#toolStatusFilter").value;
  const type = typeFilter.value;
  const tools = state.tools
    .filter((tool) => status === "all" || tool.status === status)
    .filter((tool) => type === "all" || tool.typeId === type)
    .filter((tool) => !search || [tool.assetCode, tool.name, tool.serial].some((field) => String(field || "").toLocaleLowerCase("es-MX").includes(search)))
    .sort((a, b) => a.assetCode.localeCompare(b.assetCode, "es", { numeric: true }));

  $("#toolResultCount").textContent = `${tools.length} registro${tools.length === 1 ? "" : "s"}`;
  const body = $("#toolsTableBody");
  if (!tools.length) {
    body.innerHTML = `<tr><td colspan="6">${emptyState("▣", state.tools.length ? "No hay coincidencias" : "Da de alta el primer herramental", state.tools.length ? "Cambia los filtros o utiliza otro término de búsqueda." : "Primero crea un tipo de herramental con su checklist y después registra el equipo.", state.tools.length ? "" : "new-tool", "Nuevo herramental")}</td></tr>`;
    return;
  }

  body.innerHTML = tools.map((tool) => {
    const typeData = getType(tool.typeId);
    const statusData = statusInfo(tool);
    const maintenance = maintenanceState(tool);
    return `
      <tr>
        <td><span class="cell-title">${escapeHtml(tool.assetCode)} · ${escapeHtml(tool.name)}</span><span class="cell-subtitle">Serie: ${escapeHtml(tool.serial || "N/A")}</span></td>
        <td>${escapeHtml(typeData?.name || "Tipo no disponible")}</td>
        <td><span class="cell-title">${escapeHtml(statusData.location)}</span>${tool.requestedBy ? `<span class="cell-subtitle">Solicitó: ${escapeHtml(tool.requestedBy)}</span>` : ""}</td>
        <td><div class="maintenance-date ${maintenance.badge}"><strong>${formatDate(tool.nextMaintenance)}</strong><span>${escapeHtml(maintenance.label)}</span></div></td>
        <td>${badge(statusData.label, statusData.badge)}</td>
        <td class="align-right"><div class="table-actions"><button class="mini-button" data-action="view-tool" data-id="${tool.id}">Ver detalle</button></div></td>
      </tr>`;
  }).join("");
}

function renderTypes() {
  const grid = $("#typeGrid");
  if (!state.types.length) {
    grid.innerHTML = emptyState("☑", "Crea el primer tipo de herramental", "Define su checklist una sola vez. Los nuevos herramentales de ese tipo lo usarán automáticamente.", can("editTypes") ? "new-type" : "", "Nuevo tipo y checklist");
    return;
  }

  grid.innerHTML = state.types
    .slice()
    .sort((a, b) => a.name.localeCompare(b.name, "es"))
    .map((type) => {
      const associated = state.tools.filter((tool) => tool.typeId === type.id && tool.status !== "scrap").length;
      const visibleItems = (type.checklist || []).slice(0, 5);
      return `
        <article class="type-card">
          <div class="type-card-header">
            <div>
              <span class="type-code">${escapeHtml(type.code)}</span>
              <h3>${escapeHtml(type.name)}</h3>
              <p>${escapeHtml(type.description || "Sin descripción")}</p>
            </div>
            ${can("editTypes") ? `<button class="mini-button" data-action="edit-type" data-id="${type.id}">Editar</button>` : ""}
          </div>
          <div class="type-card-body">
            <p class="eyebrow">CHECKLIST · ${(type.checklist || []).length} PUNTOS</p>
            ${(type.checklist || []).length ? `<ul class="checklist-preview">${visibleItems.map((item) => `<li>${escapeHtml(item.text)}${item.required ? "" : " (opcional)"}</li>`).join("")}</ul>` : `<p class="muted">Este tipo aún no tiene puntos de validación.</p>`}
            ${(type.checklist || []).length > visibleItems.length ? `<p class="muted">+ ${(type.checklist || []).length - visibleItems.length} puntos adicionales</p>` : ""}
            <div class="type-card-footer"><span>${associated} herramental${associated === 1 ? "" : "es"} activo${associated === 1 ? "" : "s"}</span><span>Actualizado ${formatDate((type.updatedAt || type.createdAt || "").slice(0, 10))}</span></div>
          </div>
        </article>`;
    }).join("");
}

function renderMovements() {
  const movementEvents = state.events
    .filter((event) => ["checkout", "return"].includes(event.eventType))
    .sort((a, b) => new Date(b.at) - new Date(a.at));
  const body = $("#movementTableBody");
  if (!movementEvents.length) {
    body.innerHTML = `<tr><td colspan="6">${emptyState("⇄", "Sin movimientos registrados", "Utiliza los botones superiores para entregar o recibir un herramental.")}</td></tr>`;
    return;
  }
  body.innerHTML = movementEvents.slice(0, 100).map((event) => {
    const tool = getTool(event.toolId);
    return `
      <tr>
        <td class="nowrap">${formatDateTime(event.at)}</td>
        <td>${badge(event.eventType === "checkout" ? "Salida a piso" : "Regreso", event.eventType === "checkout" ? "purple" : "success")}</td>
        <td><span class="cell-title">${escapeHtml(tool?.assetCode || "ID no disponible")}</span><span class="cell-subtitle">${escapeHtml(tool?.name || "Herramental no disponible")}</span></td>
        <td>${escapeHtml(event.location || "—")}</td>
        <td>${escapeHtml(event.requestedBy || "—")}</td>
        <td>${escapeHtml(event.performedBy || "—")}</td>
      </tr>`;
  }).join("");
}

function renderMaintenance() {
  const tools = state.tools
    .filter((tool) => tool.status !== "scrap")
    .map((tool) => ({ tool, maintenance: maintenanceState(tool) }))
    .filter(({ maintenance }) => {
      if (maintenanceFilter === "all") return true;
      if (maintenanceFilter === "dueSoon") return ["today", "dueSoon"].includes(maintenance.key);
      return maintenance.key === maintenanceFilter;
    })
    .sort((a, b) => (a.maintenance.days ?? 999999) - (b.maintenance.days ?? 999999));

  const body = $("#maintenanceTableBody");
  if (!tools.length) {
    body.innerHTML = `<tr><td colspan="6">${emptyState("⚙", "No hay herramentales en este filtro", "Selecciona otra condición o registra un herramental.")}</td></tr>`;
  } else {
    body.innerHTML = tools.map(({ tool, maintenance }) => {
      const type = getType(tool.typeId);
      const floorBlocked = tool.status === "floor";
      return `
        <tr>
          <td><span class="cell-title">${escapeHtml(tool.assetCode)} · ${escapeHtml(tool.name)}</span><span class="cell-subtitle">${escapeHtml(statusInfo(tool).location)}</span></td>
          <td>${escapeHtml(type?.name || "Tipo no disponible")}</td>
          <td>${formatDate(tool.lastMaintenance, "Sin registro")}</td>
          <td><div class="maintenance-date ${maintenance.badge}"><strong>${formatDate(tool.nextMaintenance)}</strong><span>${escapeHtml(frequencyLabel(tool))}</span></div></td>
          <td>${badge(maintenance.label, maintenance.badge)}</td>
          <td class="align-right">${can("maintenance") ? `<button class="mini-button" data-action="maintenance" data-id="${tool.id}" ${floorBlocked ? "disabled title='Primero debe registrarse el regreso a Tool Crib'" : ""}>${floorBlocked ? "En piso" : "Realizar"}</button>` : "—"}</td>
        </tr>`;
    }).join("");
  }

  const history = [...state.maintenanceRecords].sort((a, b) => new Date(b.performedAt) - new Date(a.performedAt));
  const historyBody = $("#maintenanceHistoryBody");
  if (!history.length) {
    historyBody.innerHTML = `<tr><td colspan="6">${emptyState("✓", "Sin mantenimientos documentados", "Al completar un checklist, la evidencia quedará registrada aquí.")}</td></tr>`;
  } else {
    historyBody.innerHTML = history.slice(0, 100).map((record) => {
      const tool = getTool(record.toolId);
      return `
        <tr>
          <td>${formatDate(record.maintenanceDate)}</td>
          <td><span class="cell-title">${escapeHtml(tool?.assetCode || "ID no disponible")}</span><span class="cell-subtitle">${escapeHtml(tool?.name || "Herramental no disponible")}</span></td>
          <td>${escapeHtml(record.performedBy)}</td>
          <td>${badge(record.result === "passed" ? "Conforme" : "No conforme", record.result === "passed" ? "success" : "danger")}</td>
          <td>${record.nextDue ? formatDate(record.nextDue) : "Pendiente"}</td>
          <td><button class="mini-button" data-action="view-maintenance" data-id="${record.id}">Ver checklist</button></td>
        </tr>`;
    }).join("");
  }
}

function renderTraceability() {
  const select = $("#traceToolSelect");
  const current = select.value;
  select.innerHTML = `<option value="">Seleccionar…</option>${state.tools
    .slice()
    .sort((a, b) => a.assetCode.localeCompare(b.assetCode, "es", { numeric: true }))
    .map((tool) => `<option value="${tool.id}">${escapeHtml(tool.assetCode)} · ${escapeHtml(tool.name)}</option>`)
    .join("")}`;
  if (state.tools.some((tool) => tool.id === current)) select.value = current;

  const tool = getTool(select.value);
  const content = $("#traceabilityContent");
  if (!tool) {
    content.innerHTML = `<div class="panel">${emptyState("↳", state.tools.length ? "Selecciona un herramental" : "Aún no hay herramentales", state.tools.length ? "Consulta su ubicación actual y todos los eventos desde el alta." : "Da de alta un herramental para comenzar a construir su trazabilidad.")}</div>`;
    return;
  }

  const type = getType(tool.typeId);
  const status = statusInfo(tool);
  const maintenance = maintenanceState(tool);
  const events = state.events.filter((event) => event.toolId === tool.id).sort((a, b) => new Date(b.at) - new Date(a.at));
  content.innerHTML = `
    <div class="trace-layout">
      <article class="panel tool-summary-card">
        <div class="tool-summary-identity">
          ${badge(status.label, status.badge)}
          <h3>${escapeHtml(tool.assetCode)} · ${escapeHtml(tool.name)}</h3>
          <p>${escapeHtml(type?.name || "Tipo no disponible")} · Serie ${escapeHtml(tool.serial || "N/A")}</p>
        </div>
        <dl class="summary-list">
          <div><dt>Ubicación actual</dt><dd>${escapeHtml(status.location)}</dd></div>
          <div><dt>Solicitante</dt><dd>${escapeHtml(tool.requestedBy || "—")}</dd></div>
          <div><dt>Próximo mantenimiento</dt><dd>${formatDate(tool.nextMaintenance)}</dd></div>
          <div><dt>Condición</dt><dd>${escapeHtml(maintenance.label)}</dd></div>
          <div><dt>Frecuencia</dt><dd>${escapeHtml(frequencyLabel(tool))}</dd></div>
        </dl>
        <button class="button button-secondary" style="width:100%;margin-top:18px" data-action="view-tool" data-id="${tool.id}">Ver ficha completa</button>
      </article>
      <article class="panel timeline-panel">
        <div class="panel-header">
          <div><p class="eyebrow">BITÁCORA</p><h2>${events.length} evento${events.length === 1 ? "" : "s"} registrado${events.length === 1 ? "" : "s"}</h2></div>
        </div>
        ${events.length ? `<div class="timeline">${events.map((event) => `
          <div class="timeline-item">
            <div class="timeline-dot">${eventIcon(event.eventType)}</div>
            <div class="timeline-copy">
              <div class="timeline-copy-header"><strong>${escapeHtml(event.title)}</strong><time>${formatDateTime(event.at)}</time></div>
              <p>${escapeHtml(event.detail)}</p>
              <small>${escapeHtml(event.performedBy)} · ${escapeHtml(event.location || "Sin ubicación")}</small>
            </div>
          </div>`).join("")}</div>` : emptyState("↳", "Sin eventos", "Este herramental todavía no tiene actividad registrada.")}
      </article>
    </div>`;
}

function renderSettings() {
  $("#settingSiteName").value = state.settings.siteName || "";
  $("#settingWarningDays").value = state.settings.defaultWarningDays || 7;
  $("#dataSummary").textContent = `${state.tools.length} herramentales · ${state.types.length} tipos · ${state.events.length} eventos · ${state.maintenanceRecords.length} mantenimientos.`;
  updateNotificationStatus();
  $("#userManagementCard").hidden = currentUser?.role !== "admin";
}

function renderUserManagement() {
  const list = $("#userList");
  if (!list) return;
  if (!currentUser || currentUser.role !== "admin") {
    list.innerHTML = "";
    return;
  }
  list.innerHTML = `<div class="user-list-heading"><strong>Usuarios registrados</strong><span>${accounts.length}</span></div>
    ${accounts.map((account) => `<div class="user-list-row">
      <span class="operator-avatar">${escapeHtml(initials(account.name))}</span>
      <span><strong>${escapeHtml(account.name)}</strong><small>${escapeHtml(account.username)} · ${escapeHtml(ROLE_LABELS[account.role] || "Sin perfil")}</small></span>
    </div>`).join("")}`;
}

async function createUser(event) {
  event.preventDefault();
  if (!requirePermission("manageUsers")) return;
  const form = event.currentTarget;
  const values = new FormData(form);
  const name = String(values.get("name") || "").trim();
  const username = String(values.get("username") || "").trim().toLocaleLowerCase("es-MX");
  const password = String(values.get("password") || "");
  const role = String(values.get("role") || "");
  if (!name || !username || password.length < 8 || !ROLE_LABELS[role]) {
    showToast("Datos incompletos", "Revisa el nombre, usuario, perfil y contraseña (mínimo 8 caracteres).", "error");
    return;
  }
  if (accounts.some((account) => account.username === username)) {
    showToast("Usuario duplicado", "Ya existe una cuenta con ese usuario.", "error");
    return;
  }
  try {
    const credentials = await hashPassword(password);
    accounts.push({ id: newId("user"), name, username, role, ...credentials, createdAt: nowISO() });
    try {
      saveAccounts();
    } catch (error) {
      accounts.pop();
      throw error;
    }
    form.reset();
    renderUserManagement();
    showToast("Usuario dado de alta", `${name} quedó registrado como ${ROLE_LABELS[role]}.`, "success");
  } catch (error) {
    console.error("No fue posible crear la cuenta:", error);
    showToast("No se pudo crear el usuario", "El navegador no pudo proteger la contraseña. Intenta de nuevo.", "error");
  }
}

function applyAccessControls() {
  const actionPermissions = {
    "new-tool": "createTool",
    "edit-tool": "editTool",
    "new-type": "editTypes",
    "edit-type": "editTypes",
    checkout: "movement",
    "checkout-tool": "movement",
    return: "movement",
    "return-tool": "movement",
    maintenance: "maintenance",
    "scrap-tool": "scrapTool",
    "view-tool": "view",
    "view-maintenance": "view"
  };
  $$(".nav-item").forEach((item) => {
    item.hidden = !canView(item.dataset.view);
    item.setAttribute("aria-label", item.textContent.trim());
    item.title = item.textContent.trim();
  });
  $$("[data-action]").forEach((item) => {
    const permission = actionPermissions[item.dataset.action] || "view";
    item.hidden = !can(permission);
  });
  $$("[data-view-link]").forEach((item) => {
    item.hidden = !canView(item.dataset.viewLink);
  });
  $("#userManagementCard").hidden = currentUser?.role !== "admin";
}

function renderAll() {
  updateBranding();
  renderDashboard();
  renderTools();
  renderTypes();
  renderMovements();
  renderMaintenance();
  renderTraceability();
  renderSettings();
  renderUserManagement();
  applyAccessControls();
}

function checklistRowTemplate(item = {}) {
  return `
    <div class="checklist-builder-row" data-check-row>
      <input data-check-text maxlength="160" placeholder="Ej. Verificar ausencia de daño físico" value="${escapeHtml(item.text || "")}">
      <label class="required-toggle"><input data-check-required type="checkbox" ${item.required !== false ? "checked" : ""}> Obligatorio</label>
      <button class="remove-row-button" data-remove-check type="button" aria-label="Eliminar punto">×</button>
    </div>`;
}

function openTypeForm(typeId = "") {
  const existing = state.types.find((item) => item.id === typeId) || null;
  openModal({
    eyebrow: "PLANTILLA DE MANTENIMIENTO",
    title: existing ? "Editar tipo y checklist" : "Nuevo tipo y checklist",
    wide: true,
    body: `
      <div class="form-grid">
        <label><span>Nombre del tipo *</span><input name="name" required maxlength="80" value="${escapeHtml(existing?.name || "")}" placeholder="Ej. Fixture de ensamble"></label>
        <label><span>Código corto *</span><input name="code" required maxlength="20" value="${escapeHtml(existing?.code || "")}" placeholder="Ej. FIX-ENS"></label>
        <label class="span-2"><span>Descripción</span><textarea name="description" maxlength="300" placeholder="Uso, familia o alcance de este tipo…">${escapeHtml(existing?.description || "")}</textarea></label>
      </div>
      <div class="form-section">
        <div class="form-section-heading">
          <div><h3>Puntos del checklist</h3><p>Los cambios aplicarán a mantenimientos futuros; el historial conservará su evidencia original.</p></div>
          <button class="mini-button" data-add-check type="button">+ Agregar punto</button>
        </div>
        <div class="checklist-builder" id="checklistBuilder">
          ${(existing?.checklist?.length ? existing.checklist : [{ text: "", required: true }]).map(checklistRowTemplate).join("")}
        </div>
      </div>`,
    submitLabel: existing ? "Guardar cambios" : "Crear tipo",
    onSubmit: (formData) => {
      const name = String(formData.get("name") || "").trim();
      const code = String(formData.get("code") || "").trim().toUpperCase();
      const duplicate = state.types.find((item) => item.id !== existing?.id && item.code.toUpperCase() === code);
      if (duplicate) {
        showToast("Código duplicado", "Utiliza un código diferente para este tipo.", "error");
        return false;
      }
      const checklist = $$("[data-check-row]", dom.modalBody)
        .map((row) => ({
          id: row.dataset.itemId || newId("chk"),
          text: $("[data-check-text]", row).value.trim(),
          required: $("[data-check-required]", row).checked
        }))
        .filter((item) => item.text);
      if (!checklist.length) {
        showToast("Checklist requerido", "Agrega al menos un punto de validación.", "error");
        return false;
      }
      if (existing) {
        Object.assign(existing, { name, code, description: String(formData.get("description") || "").trim(), checklist, updatedAt: nowISO() });
      } else {
        state.types.push({ id: newId("type"), name, code, description: String(formData.get("description") || "").trim(), checklist, createdAt: nowISO(), updatedAt: nowISO() });
      }
      saveState({ silent: true });
      closeModal();
      renderAll();
      showToast(existing ? "Tipo actualizado" : "Tipo creado", "El checklist está listo para reutilizarse.", "success");
    }
  });

  $$("[data-check-row]", dom.modalBody).forEach((row, index) => {
    if (existing?.checklist?.[index]) row.dataset.itemId = existing.checklist[index].id;
  });
  $("[data-add-check]", dom.modalBody).addEventListener("click", () => {
    $("#checklistBuilder", dom.modalBody).insertAdjacentHTML("beforeend", checklistRowTemplate());
    $$('[data-check-text]', dom.modalBody).at(-1)?.focus();
  });
  dom.modalBody.addEventListener("click", (event) => {
    const remove = event.target.closest("[data-remove-check]");
    if (!remove) return;
    const rows = $$("[data-check-row]", dom.modalBody);
    if (rows.length === 1) {
      $("[data-check-text]", rows[0]).value = "";
      return;
    }
    remove.closest("[data-check-row]").remove();
  });
}

function openToolForm(toolId = "") {
  if (!state.types.length) {
    switchView("types");
    showToast("Primero crea un tipo", "El tipo contiene el checklist que usará el herramental.", "warning");
    return;
  }
  const existing = getTool(toolId);
  const baseline = existing?.lastMaintenance || todayISO();
  const frequencyValue = existing?.frequencyValue || 1;
  const frequencyUnit = existing?.frequencyUnit || "months";
  const computedNext = addFrequency(baseline, frequencyValue, frequencyUnit);

  openModal({
    eyebrow: "INVENTARIO MAESTRO",
    title: existing ? "Editar herramental" : "Dar de alta herramental",
    wide: true,
    body: `
      <div class="form-section">
        <div class="form-section-heading"><div><h3>Identificación</h3><p>Datos únicos del equipo.</p></div></div>
        <div class="form-grid">
          <label><span>ID del herramental *</span><input name="assetCode" required maxlength="40" value="${escapeHtml(existing?.assetCode || "")}" placeholder="Ej. TOOL-001"></label>
          <label><span>Nombre *</span><input name="name" required maxlength="100" value="${escapeHtml(existing?.name || "")}" placeholder="Ej. Fixture ICT modelo A"></label>
          <label><span>Tipo de herramental *</span><select name="typeId" id="toolTypeSelect" required>${state.types.map((type) => `<option value="${type.id}" ${type.id === existing?.typeId ? "selected" : ""}>${escapeHtml(type.name)} · ${escapeHtml(type.code)}</option>`).join("")}</select><p class="field-help" id="typeChecklistHint"></p></label>
          <label><span>Número de serie</span><input name="serial" maxlength="80" value="${escapeHtml(existing?.serial || "")}" placeholder="Serie del fabricante"></label>
          <label class="span-2"><span>Notas</span><textarea name="notes" maxlength="500" placeholder="Modelo, aplicación, condición inicial u observaciones…">${escapeHtml(existing?.notes || "")}</textarea></label>
        </div>
      </div>
      <div class="form-section">
        <div class="form-section-heading"><div><h3>Plan de mantenimiento</h3><p>La próxima fecha se calcula automáticamente desde la fecha base.</p></div></div>
        <div class="form-grid">
          <label><span>Fecha base *</span><input name="baseline" id="maintenanceBaseline" type="date" required value="${baseline}"><p class="field-help">Último mantenimiento o fecha de puesta en servicio.</p></label>
          <label><span>Frecuencia *</span><span class="inline-fields"><input name="frequencyValue" id="frequencyValue" type="number" min="1" max="999" required value="${frequencyValue}"><select name="frequencyUnit" id="frequencyUnit"><option value="days" ${frequencyUnit === "days" ? "selected" : ""}>Días</option><option value="weeks" ${frequencyUnit === "weeks" ? "selected" : ""}>Semanas</option><option value="months" ${frequencyUnit === "months" ? "selected" : ""}>Meses</option></select></span></label>
          <label><span>Alertar con anticipación</span><span class="inline-fields"><input name="warningDays" type="number" min="1" max="365" required value="${existing?.warningDays ?? state.settings.defaultWarningDays}"><input value="días antes" disabled></span></label>
          <div class="form-field"><span>Próximo mantenimiento</span><div class="computed-date"><span>Fecha calculada</span><strong id="nextMaintenancePreview" data-date="${computedNext}">${formatDate(computedNext)}</strong></div></div>
        </div>
      </div>`,
    submitLabel: existing ? "Guardar cambios" : "Dar de alta",
    onSubmit: (formData) => {
      const assetCode = String(formData.get("assetCode") || "").trim().toUpperCase();
      const duplicate = state.tools.find((tool) => tool.id !== existing?.id && tool.assetCode.toUpperCase() === assetCode);
      if (duplicate) {
        showToast("ID duplicado", "Ya existe un herramental con ese ID.", "error");
        return false;
      }
      const baselineDate = String(formData.get("baseline") || "");
      const frequency = Number(formData.get("frequencyValue"));
      const unit = String(formData.get("frequencyUnit"));
      const nextMaintenance = addFrequency(baselineDate, frequency, unit);
      const values = {
        assetCode,
        name: String(formData.get("name") || "").trim(),
        typeId: String(formData.get("typeId") || ""),
        serial: String(formData.get("serial") || "").trim(),
        notes: String(formData.get("notes") || "").trim(),
        frequencyValue: frequency,
        frequencyUnit: unit,
        warningDays: Number(formData.get("warningDays")),
        lastMaintenance: baselineDate,
        nextMaintenance,
        updatedAt: nowISO()
      };
      if (existing) {
        Object.assign(existing, values);
        addEvent(existing, "edited", "Ficha de herramental actualizada", `Se actualizaron los datos de ${assetCode}.`);
      } else {
        const tool = {
          id: newId("tool"),
          ...values,
          status: "tool",
          location: "Tool Crib",
          requestedBy: "",
          createdAt: nowISO()
        };
        state.tools.push(tool);
        addEvent(tool, "created", "Herramental dado de alta", `Se registró ${assetCode} y quedó disponible en Tool Crib.`);
      }
      saveState({ silent: true });
      closeModal();
      renderAll();
      showToast(existing ? "Herramental actualizado" : "Herramental registrado", `Próximo mantenimiento: ${formatDate(nextMaintenance)}.`, "success");
    }
  });

  const updatePreview = () => {
    const date = addFrequency($("#maintenanceBaseline").value, $("#frequencyValue").value, $("#frequencyUnit").value);
    const preview = $("#nextMaintenancePreview");
    preview.dataset.date = date;
    preview.textContent = formatDate(date);
  };
  const updateHint = () => {
    const type = getType($("#toolTypeSelect").value);
    $("#typeChecklistHint").textContent = `${type?.checklist?.length || 0} puntos en el checklist asignado.`;
  };
  [$("#maintenanceBaseline"), $("#frequencyValue"), $("#frequencyUnit")].forEach((input) => input.addEventListener("input", updatePreview));
  $("#toolTypeSelect").addEventListener("change", updateHint);
  updateHint();
}

function toolSelectOptions(tools, includeMaintenanceState = false) {
  return tools
    .slice()
    .sort((a, b) => a.assetCode.localeCompare(b.assetCode, "es", { numeric: true }))
    .map((tool) => {
      const maintenance = maintenanceState(tool);
      const suffix = includeMaintenanceState && ["overdue", "today", "dueSoon"].includes(maintenance.key) ? ` · ${maintenance.label}` : "";
      return `<option value="${tool.id}">${escapeHtml(tool.assetCode)} · ${escapeHtml(tool.name)}${escapeHtml(suffix)}</option>`;
    }).join("");
}

function openCheckoutModal(preselectedId = "") {
  const candidates = state.tools.filter((tool) => tool.status === "tool");
  if (!candidates.length) {
    showToast("No hay equipos disponibles", "No existe herramental en Tool Crib para entregar.", "warning");
    return;
  }
  openModal({
    eyebrow: "SALIDA A PISO",
    title: "Entregar herramental",
    body: `
      <div class="form-grid">
        <label class="span-2"><span>Herramental *</span><select name="toolId" id="checkoutToolSelect" required>${toolSelectOptions(candidates, true)}</select></label>
        <div class="span-2" id="checkoutStatus"></div>
        <label><span>Línea / ubicación destino *</span><input name="line" required maxlength="80" placeholder="Ej. Línea 4 · SMT"></label>
        <label><span>Quién lo solicita *</span><input name="requestedBy" required maxlength="100" placeholder="Nombre o número de empleado"></label>
        <label><span>Orden / motivo</span><input name="order" maxlength="100" placeholder="WO, modelo o motivo de uso"></label>
        <label><span>Registrado por</span><input value="${escapeHtml(state.settings.currentOperator)}" disabled></label>
        <label class="span-2"><span>Observaciones de salida</span><textarea name="notes" maxlength="500" placeholder="Condición o accesorios entregados…"></textarea></label>
      </div>`,
    submitLabel: "Confirmar salida",
    onSubmit: (formData) => {
      const tool = getTool(String(formData.get("toolId")));
      if (!tool || tool.status !== "tool") {
        showToast("Herramental no disponible", "Actualiza la pantalla y vuelve a intentarlo.", "error");
        return false;
      }
      if (maintenanceState(tool).key === "overdue") {
        showToast("Salida bloqueada", "El mantenimiento está vencido. Debe completarse antes de entregar el herramental.", "error", 6500);
        return false;
      }
      const line = String(formData.get("line") || "").trim();
      const requestedBy = String(formData.get("requestedBy") || "").trim();
      const order = String(formData.get("order") || "").trim();
      const notes = String(formData.get("notes") || "").trim();
      tool.status = "floor";
      tool.location = line;
      tool.requestedBy = requestedBy;
      tool.updatedAt = nowISO();
      addEvent(tool, "checkout", "Salida de herramental a piso", `${line}${order ? ` · ${order}` : ""}${notes ? ` · ${notes}` : ""}`, { requestedBy, location: line, metadata: { order, notes } });
      saveState({ silent: true });
      closeModal();
      renderAll();
      showToast("Salida registrada", `${tool.assetCode} fue entregado a ${requestedBy}.`, "success");
    }
  });
  const select = $("#checkoutToolSelect");
  if (candidates.some((tool) => tool.id === preselectedId)) select.value = preselectedId;
  const updateStatus = () => {
    const tool = getTool(select.value);
    const maintenance = tool ? maintenanceState(tool) : null;
    const box = $("#checkoutStatus");
    if (!tool || !maintenance) return;
    if (maintenance.key === "overdue") {
      box.innerHTML = `<div class="danger-box"><strong>Salida bloqueada.</strong> El mantenimiento venció el ${formatDate(tool.nextMaintenance)}. Realiza primero el checklist de mantenimiento.</div>`;
      dom.modalSubmitButton.disabled = true;
    } else if (["today", "dueSoon"].includes(maintenance.key)) {
      box.innerHTML = `<div class="warning-box"><strong>${escapeHtml(maintenance.label)}.</strong> Puede salir, pero debe programarse su mantenimiento.</div>`;
      dom.modalSubmitButton.disabled = false;
    } else {
      box.innerHTML = `<div class="success-box"><strong>Mantenimiento vigente.</strong> Próxima fecha: ${formatDate(tool.nextMaintenance)}.</div>`;
      dom.modalSubmitButton.disabled = false;
    }
  };
  select.addEventListener("change", updateStatus);
  updateStatus();
}

function openReturnModal(preselectedId = "") {
  const candidates = state.tools.filter((tool) => tool.status === "floor");
  if (!candidates.length) {
    showToast("No hay equipos en piso", "No existe herramental pendiente de regreso.", "warning");
    return;
  }
  openModal({
    eyebrow: "REGRESO A TOOL CRIB",
    title: "Recibir herramental",
    body: `
      <div class="form-grid">
        <label class="span-2"><span>Herramental *</span><select name="toolId" id="returnToolSelect" required>${toolSelectOptions(candidates)}</select></label>
        <div class="span-2" id="returnToolInfo"></div>
        <label><span>Condición al recibir *</span><select name="condition" required><option value="good">Sin anomalías</option><option value="maintenance">Requiere revisión / mantenimiento</option></select></label>
        <label><span>Registrado por</span><input value="${escapeHtml(state.settings.currentOperator)}" disabled></label>
        <label class="span-2"><span>Observaciones de entrada</span><textarea name="notes" maxlength="500" placeholder="Condición, faltantes, daño o comentarios…"></textarea></label>
      </div>`,
    submitLabel: "Confirmar regreso",
    onSubmit: (formData) => {
      const tool = getTool(String(formData.get("toolId")));
      if (!tool || tool.status !== "floor") {
        showToast("Movimiento no disponible", "El herramental ya no aparece como equipo en piso.", "error");
        return false;
      }
      const previousLine = tool.location;
      const previousRequester = tool.requestedBy;
      const needsMaintenance = formData.get("condition") === "maintenance";
      const notes = String(formData.get("notes") || "").trim();
      tool.status = needsMaintenance ? "maintenance" : "tool";
      tool.location = needsMaintenance ? "Área de mantenimiento" : "Tool Crib";
      tool.requestedBy = "";
      tool.updatedAt = nowISO();
      addEvent(tool, "return", "Regreso de herramental", `${previousLine} → ${tool.location}${notes ? ` · ${notes}` : ""}`, { requestedBy: previousRequester, location: tool.location, metadata: { previousLine, condition: needsMaintenance ? "maintenance" : "good", notes } });
      saveState({ silent: true });
      closeModal();
      renderAll();
      showToast("Regreso registrado", needsMaintenance ? `${tool.assetCode} quedó en mantenimiento.` : `${tool.assetCode} está disponible en Tool Crib.`, needsMaintenance ? "warning" : "success");
    }
  });
  const select = $("#returnToolSelect");
  if (candidates.some((tool) => tool.id === preselectedId)) select.value = preselectedId;
  const updateInfo = () => {
    const tool = getTool(select.value);
    $("#returnToolInfo").innerHTML = tool ? `<div class="tool-info-strip"><div><strong>${escapeHtml(tool.assetCode)} · ${escapeHtml(tool.name)}</strong><span>Actualmente: ${escapeHtml(tool.location)}</span></div><div><strong>${escapeHtml(tool.requestedBy || "Sin solicitante")}</strong><span>Solicitante</span></div></div>` : "";
  };
  select.addEventListener("change", updateInfo);
  updateInfo();
}

function openMaintenanceModal(toolId) {
  const tool = getTool(toolId);
  if (!tool || tool.status === "scrap") return;
  if (tool.status === "floor") {
    showToast("Herramental en piso", "Registra primero su regreso a Tool Crib para iniciar el mantenimiento.", "warning");
    return;
  }
  const type = getType(tool.typeId);
  const checklist = type?.checklist || [];
  if (!checklist.length) {
    showToast("Checklist no disponible", "Edita el tipo de herramental y agrega al menos un punto de validación.", "error");
    switchView("types");
    return;
  }
  const mState = maintenanceState(tool);
  openModal({
    eyebrow: "EJECUCIÓN DE MANTENIMIENTO",
    title: `${tool.assetCode} · ${tool.name}`,
    wide: true,
    body: `
      <div class="tool-info-strip">
        <div><strong>${escapeHtml(type?.name || "Tipo no disponible")}</strong><span>${escapeHtml(frequencyLabel(tool))}</span></div>
        <div><strong>${formatDate(tool.nextMaintenance)}</strong><span>${escapeHtml(mState.label)}</span></div>
      </div>
      <div class="form-grid" style="margin-bottom:18px">
        <label><span>Fecha de mantenimiento *</span><input name="maintenanceDate" type="date" required value="${todayISO()}"></label>
        <label><span>Realizado por *</span><input name="performedBy" required maxlength="100" value="${escapeHtml(state.settings.currentOperator)}"></label>
      </div>
      <div class="form-section-heading"><div><h3>Checklist de ${escapeHtml(type?.name || "mantenimiento")}</h3><p>Selecciona un resultado en cada punto obligatorio.</p></div><span class="badge neutral">${checklist.length} puntos</span></div>
      <div class="maintenance-checklist">
        ${checklist.map((item, index) => `
          <div class="maintenance-check-row" data-maint-row data-item-id="${item.id}">
            <div><strong>${index + 1}. ${escapeHtml(item.text)}</strong><small>${item.required ? "Obligatorio" : "Opcional"}</small></div>
            <select data-result ${item.required ? "required" : ""}>
              <option value="">Seleccionar…</option>
              <option value="ok">Conforme</option>
              <option value="na">No aplica</option>
              <option value="fail">No conforme</option>
            </select>
            <input data-comment maxlength="220" placeholder="Comentario / evidencia">
          </div>`).join("")}
      </div>
      <div class="form-section">
        <label class="form-field"><span>Observaciones generales</span><textarea name="notes" maxlength="700" placeholder="Trabajo realizado, refacciones, hallazgos o recomendaciones…"></textarea></label>
      </div>`,
    submitLabel: "Cerrar mantenimiento",
    onSubmit: (formData) => {
      const currentTool = getTool(toolId);
      if (!currentTool || currentTool.status === "floor" || currentTool.status === "scrap") {
        showToast("Estado no válido", "El herramental cambió de estado. Actualiza la pantalla.", "error");
        return false;
      }
      const results = $$("[data-maint-row]", dom.modalBody).map((row, index) => {
        const templateItem = checklist[index];
        return {
          itemId: row.dataset.itemId,
          text: templateItem.text,
          required: templateItem.required,
          result: $("[data-result]", row).value,
          comment: $("[data-comment]", row).value.trim()
        };
      });
      const pending = results.find((item) => item.required && !item.result);
      if (pending) {
        showToast("Checklist incompleto", `Selecciona el resultado de: ${pending.text}.`, "error");
        return false;
      }
      const failedWithoutComment = results.find((item) => item.result === "fail" && !item.comment);
      if (failedWithoutComment) {
        showToast("Comentario requerido", "Documenta el hallazgo en cada punto no conforme.", "error");
        return false;
      }
      const hasFailure = results.some((item) => item.result === "fail");
      const maintenanceDate = String(formData.get("maintenanceDate") || "");
      const performedBy = String(formData.get("performedBy") || "").trim();
      const notes = String(formData.get("notes") || "").trim();
      const nextDue = hasFailure ? "" : addFrequency(maintenanceDate, currentTool.frequencyValue, currentTool.frequencyUnit);
      const record = {
        id: newId("mnt"),
        toolId: currentTool.id,
        typeId: currentTool.typeId,
        typeName: type?.name || "",
        checklist: results,
        result: hasFailure ? "failed" : "passed",
        maintenanceDate,
        performedAt: nowISO(),
        performedBy,
        notes,
        previousDue: currentTool.nextMaintenance,
        nextDue
      };
      state.maintenanceRecords.push(record);
      if (hasFailure) {
        currentTool.status = "maintenance";
        currentTool.location = "Área de mantenimiento";
        addEvent(currentTool, "maintenance_failed", "Mantenimiento no conforme", `Se detectaron puntos no conformes. El herramental permanece bloqueado.${notes ? ` ${notes}` : ""}`, { performedBy, location: currentTool.location, metadata: { maintenanceRecordId: record.id } });
      } else {
        currentTool.lastMaintenance = maintenanceDate;
        currentTool.nextMaintenance = nextDue;
        currentTool.status = "tool";
        currentTool.location = "Tool Crib";
        addEvent(currentTool, "maintenance_success", "Mantenimiento completado", `Checklist conforme. Próximo mantenimiento: ${formatDate(nextDue)}.${notes ? ` ${notes}` : ""}`, { performedBy, location: currentTool.location, metadata: { maintenanceRecordId: record.id } });
      }
      currentTool.requestedBy = "";
      currentTool.updatedAt = nowISO();
      saveState({ silent: true });
      closeModal();
      renderAll();
      showToast(hasFailure ? "Mantenimiento no conforme" : "Mantenimiento completado", hasFailure ? `${currentTool.assetCode} permanece bloqueado en mantenimiento.` : `Nueva vigencia hasta ${formatDate(nextDue)}.`, hasFailure ? "error" : "success", 6500);
    }
  });
}

function openMaintenanceDetail(recordId) {
  const record = state.maintenanceRecords.find((item) => item.id === recordId);
  if (!record) return;
  const tool = getTool(record.toolId);
  openModal({
    eyebrow: "EVIDENCIA DE MANTENIMIENTO",
    title: `${tool?.assetCode || "Herramental"} · ${formatDate(record.maintenanceDate)}`,
    wide: true,
    hideSubmit: true,
    cancelLabel: "Cerrar",
    body: `
      <div class="tool-info-strip">
        <div><strong>${escapeHtml(record.performedBy)}</strong><span>Realizó el mantenimiento</span></div>
        <div>${badge(record.result === "passed" ? "Conforme" : "No conforme", record.result === "passed" ? "success" : "danger")}</div>
      </div>
      <div class="maintenance-checklist">
        ${record.checklist.map((item, index) => `
          <div class="maintenance-check-row">
            <div><strong>${index + 1}. ${escapeHtml(item.text)}</strong><small>${item.required ? "Obligatorio" : "Opcional"}</small></div>
            <div>${badge(item.result === "ok" ? "Conforme" : item.result === "na" ? "No aplica" : item.result === "fail" ? "No conforme" : "Sin respuesta", item.result === "ok" ? "success" : item.result === "fail" ? "danger" : "neutral")}</div>
            <span class="muted">${escapeHtml(item.comment || "Sin comentario")}</span>
          </div>`).join("")}
      </div>
      <div class="form-section"><div class="detail-grid">
        <div class="detail-item"><span>Fecha anterior</span><strong>${formatDate(record.previousDue)}</strong></div>
        <div class="detail-item"><span>Próxima fecha</span><strong>${record.nextDue ? formatDate(record.nextDue) : "Pendiente por no conformidad"}</strong></div>
        <div class="detail-item"><span>Observaciones</span><strong>${escapeHtml(record.notes || "Sin observaciones")}</strong></div>
      </div></div>`
  });
}

function openToolDetail(toolId) {
  const tool = getTool(toolId);
  if (!tool) return;
  const type = getType(tool.typeId);
  const status = statusInfo(tool);
  const maintenance = maintenanceState(tool);
  const records = state.maintenanceRecords.filter((record) => record.toolId === tool.id).sort((a, b) => new Date(b.performedAt) - new Date(a.performedAt));
  const actions = [];
  if (can("movement") && tool.status === "tool") actions.push(`<button class="button button-primary" type="button" data-action="checkout-tool" data-id="${tool.id}">Registrar salida</button>`);
  if (can("movement") && tool.status === "floor") actions.push(`<button class="button button-primary" type="button" data-action="return-tool" data-id="${tool.id}">Registrar regreso</button>`);
  if (can("maintenance") && !["floor", "scrap"].includes(tool.status)) actions.push(`<button class="button button-secondary" type="button" data-action="maintenance" data-id="${tool.id}">Realizar mantenimiento</button>`);
  if (can("editTool") && tool.status !== "scrap") actions.push(`<button class="button button-secondary" type="button" data-action="edit-tool" data-id="${tool.id}">Editar ficha</button>`);
  if (can("scrapTool") && !["floor", "scrap"].includes(tool.status)) actions.push(`<button class="button button-danger" type="button" data-action="scrap-tool" data-id="${tool.id}">Dar de baja a scrap</button>`);

  openModal({
    eyebrow: "FICHA DE HERRAMENTAL",
    title: `${tool.assetCode} · ${tool.name}`,
    wide: true,
    hideSubmit: true,
    cancelLabel: "Cerrar",
    body: `
      <div class="tool-info-strip">
        <div><strong>${escapeHtml(type?.name || "Tipo no disponible")}</strong><span>${escapeHtml(type?.code || "—")}</span></div>
        <div>${badge(status.label, status.badge)} ${badge(maintenance.label, maintenance.badge)}</div>
      </div>
      <div class="detail-grid">
        <div class="detail-item"><span>Ubicación actual</span><strong>${escapeHtml(status.location)}</strong></div>
        <div class="detail-item"><span>Quién lo solicitó</span><strong>${escapeHtml(tool.requestedBy || "—")}</strong></div>
        <div class="detail-item"><span>Número de serie</span><strong>${escapeHtml(tool.serial || "—")}</strong></div>
        <div class="detail-item"><span>Último mantenimiento</span><strong>${formatDate(tool.lastMaintenance, "Sin registro")}</strong></div>
        <div class="detail-item"><span>Próximo mantenimiento</span><strong>${formatDate(tool.nextMaintenance)}</strong></div>
        <div class="detail-item"><span>Frecuencia</span><strong>${escapeHtml(frequencyLabel(tool))}</strong></div>
      </div>
      <div class="detail-actions">${actions.join("")}</div>
      <div class="form-section">
        <div class="form-section-heading"><div><h3>Notas</h3><p>${escapeHtml(tool.notes || "Sin notas registradas.")}</p></div></div>
      </div>
      <div class="form-section">
        <div class="form-section-heading"><div><h3>Mantenimientos recientes</h3><p>Los últimos tres registros del equipo.</p></div></div>
        ${records.length ? `<div class="maintenance-record-list">${records.slice(0, 3).map((record) => `
          <div class="maintenance-record-row"><div><strong>${formatDate(record.maintenanceDate)} · ${escapeHtml(record.performedBy)}</strong>${badge(record.result === "passed" ? "Conforme" : "No conforme", record.result === "passed" ? "success" : "danger")}</div><p>${escapeHtml(record.notes || "Sin observaciones")}</p></div>`).join("")}</div>` : `<p class="muted">Sin mantenimientos documentados.</p>`}
      </div>`
  });
}

function openScrapModal(toolId) {
  const tool = getTool(toolId);
  if (!tool || tool.status === "scrap") return;
  if (tool.status === "floor") {
    showToast("Regreso requerido", "Antes de darlo de baja, registra el regreso del herramental.", "warning");
    return;
  }
  openModal({
    eyebrow: "BAJA CONTROLADA",
    title: `Enviar ${tool.assetCode} a scrap`,
    body: `
      <div class="danger-box"><strong>Esta acción retira el herramental del inventario activo.</strong> Su historial permanecerá disponible para trazabilidad.</div>
      <div class="form-grid">
        <label class="span-2"><span>Motivo de baja *</span><textarea name="reason" required maxlength="600" placeholder="Daño, obsolescencia, disposición autorizada…"></textarea></label>
        <label><span>Autorizó *</span><input name="authorizedBy" required maxlength="100" placeholder="Nombre o número de empleado"></label>
        <label><span>Folio / evidencia</span><input name="reference" maxlength="100" placeholder="Folio de scrap, NCR, ticket…"></label>
      </div>`,
    submitLabel: "Confirmar baja a scrap",
    onSubmit: (formData) => {
      const currentTool = getTool(toolId);
      if (!currentTool || currentTool.status === "floor" || currentTool.status === "scrap") {
        showToast("Estado no válido", "El herramental cambió de estado. Actualiza la pantalla.", "error");
        return false;
      }
      const reason = String(formData.get("reason") || "").trim();
      const authorizedBy = String(formData.get("authorizedBy") || "").trim();
      const reference = String(formData.get("reference") || "").trim();
      currentTool.status = "scrap";
      currentTool.location = "Scrap";
      currentTool.requestedBy = "";
      currentTool.scrap = { reason, authorizedBy, reference, date: todayISO(), registeredBy: state.settings.currentOperator };
      currentTool.updatedAt = nowISO();
      addEvent(currentTool, "scrap", "Herramental dado de baja a scrap", `${reason}${reference ? ` · Folio ${reference}` : ""} · Autorizó: ${authorizedBy}`, { location: "Scrap", metadata: currentTool.scrap });
      saveState({ silent: true });
      closeModal();
      renderAll();
      showToast("Baja registrada", `${currentTool.assetCode} quedó identificado como scrap.`, "success");
    }
  });
}

function downloadFile(filename, contents, mimeType) {
  const blob = new Blob([contents], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

function exportBackup() {
  const payload = { application: "ToolTrack", version: APP_VERSION, exportedAt: nowISO(), state };
  downloadFile(`ToolTrack_respaldo_${todayISO()}.json`, JSON.stringify(payload, null, 2), "application/json;charset=utf-8");
  showToast("Respaldo generado", "Guarda el archivo en una ubicación segura.", "success");
}

function csvCell(value) {
  const normalized = String(value ?? "").replaceAll('"', '""');
  return `"${normalized}"`;
}

function exportCsv() {
  const rows = [
    ["ID", "Nombre", "Tipo", "Serie", "Estado", "Ubicación", "Solicitante", "Último mantenimiento", "Próximo mantenimiento", "Frecuencia", "Notas"],
    ...state.tools.map((tool) => [
      tool.assetCode,
      tool.name,
      getType(tool.typeId)?.name || "",
      tool.serial || "",
      statusInfo(tool).label,
      statusInfo(tool).location,
      tool.requestedBy || "",
      tool.lastMaintenance || "",
      tool.nextMaintenance || "",
      frequencyLabel(tool),
      tool.notes || ""
    ])
  ];
  const csv = `\uFEFF${rows.map((row) => row.map(csvCell).join(",")).join("\r\n")}`;
  downloadFile(`ToolTrack_inventario_${todayISO()}.csv`, csv, "text/csv;charset=utf-8");
  showToast("Inventario exportado", `${state.tools.length} registros incluidos.`, "success");
}

async function importBackup(file) {
  try {
    const text = await file.text();
    const parsed = JSON.parse(text);
    const candidate = parsed.state || parsed;
    if (!candidate || !Array.isArray(candidate.tools) || !Array.isArray(candidate.types) || !Array.isArray(candidate.events) || !Array.isArray(candidate.maintenanceRecords)) {
      throw new Error("Estructura no compatible");
    }
    const confirmed = window.confirm(`El respaldo contiene ${candidate.tools.length} herramentales y reemplazará la información actual. ¿Deseas continuar?`);
    if (!confirmed) return;
    state = normalizeState(candidate);
    saveState({ silent: true });
    renderAll();
    showToast("Respaldo restaurado", "La información se cargó correctamente.", "success");
  } catch (error) {
    console.error(error);
    showToast("No se pudo importar", "Verifica que sea un respaldo JSON generado por ToolTrack.", "error", 6500);
  }
}

function buildDemoData() {
  const today = todayISO();
  const dateOffset = (days) => {
    const date = parseLocalDate(today);
    date.setDate(date.getDate() + days);
    return dateToISO(date);
  };
  const fixtureType = {
    id: newId("type"), name: "Fixture de ensamble", code: "FIX-ENS", description: "Fixtures mecánicos utilizados en estaciones de ensamble.", createdAt: nowISO(), updatedAt: nowISO(),
    checklist: [
      { id: newId("chk"), text: "Inspeccionar estructura, tornillería y superficies", required: true },
      { id: newId("chk"), text: "Verificar pernos, seguros y puntos de apoyo", required: true },
      { id: newId("chk"), text: "Limpiar residuos y contaminación", required: true },
      { id: newId("chk"), text: "Validar dimensión crítica con pieza patrón", required: true }
    ]
  };
  const stencilType = {
    id: newId("type"), name: "Stencil SMT", code: "STN-SMT", description: "Plantillas para impresión de pasta en líneas SMT.", createdAt: nowISO(), updatedAt: nowISO(),
    checklist: [
      { id: newId("chk"), text: "Inspeccionar aperturas por obstrucción", required: true },
      { id: newId("chk"), text: "Revisar tensión de la malla", required: true },
      { id: newId("chk"), text: "Verificar marco sin deformación", required: true },
      { id: newId("chk"), text: "Confirmar limpieza de ambas caras", required: true }
    ]
  };
  const gaugeType = {
    id: newId("type"), name: "Gauge de inspección", code: "GGE-INS", description: "Medidores y plantillas pasa/no pasa.", createdAt: nowISO(), updatedAt: nowISO(),
    checklist: [
      { id: newId("chk"), text: "Inspección visual de golpes y corrosión", required: true },
      { id: newId("chk"), text: "Comparar contra patrón de referencia", required: true },
      { id: newId("chk"), text: "Verificar identificación y etiqueta", required: true }
    ]
  };
  const types = [fixtureType, stencilType, gaugeType];
  const tools = [
    { id: newId("tool"), assetCode: "FIX-001", name: "Fixture prensado ZF", typeId: fixtureType.id, serial: "FZ-24018", notes: "Fixture principal de estación.", frequencyValue: 1, frequencyUnit: "months", warningDays: 7, lastMaintenance: dateOffset(-38), nextMaintenance: dateOffset(-8), status: "tool", location: "Tool Crib", requestedBy: "", createdAt: nowISO(), updatedAt: nowISO() },
    { id: newId("tool"), assetCode: "STN-014", name: "Stencil Top Rev C", typeId: stencilType.id, serial: "ST-7781", notes: "Producto controlador.", frequencyValue: 4, frequencyUnit: "weeks", warningDays: 5, lastMaintenance: dateOffset(-25), nextMaintenance: dateOffset(3), status: "floor", location: "Línea SMT 3", requestedBy: "María López", createdAt: nowISO(), updatedAt: nowISO() },
    { id: newId("tool"), assetCode: "GGE-022", name: "Gauge conector P2", typeId: gaugeType.id, serial: "GG-P2-22", notes: "Gauge pasa/no pasa.", frequencyValue: 3, frequencyUnit: "months", warningDays: 10, lastMaintenance: dateOffset(-80), nextMaintenance: dateOffset(10), status: "tool", location: "Tool Crib", requestedBy: "", createdAt: nowISO(), updatedAt: nowISO() },
    { id: newId("tool"), assetCode: "FIX-009", name: "Fixture Leak Test", typeId: fixtureType.id, serial: "LT-009-A", notes: "Incluye sellos de repuesto.", frequencyValue: 6, frequencyUnit: "weeks", warningDays: 7, lastMaintenance: dateOffset(-12), nextMaintenance: dateOffset(30), status: "tool", location: "Tool Crib", requestedBy: "", createdAt: nowISO(), updatedAt: nowISO() },
    { id: newId("tool"), assetCode: "GGE-031", name: "Gauge altura BGA", typeId: gaugeType.id, serial: "BGA-031", notes: "Pendiente reemplazo de inserto.", frequencyValue: 2, frequencyUnit: "months", warningDays: 7, lastMaintenance: dateOffset(-65), nextMaintenance: dateOffset(-5), status: "maintenance", location: "Área de mantenimiento", requestedBy: "", createdAt: nowISO(), updatedAt: nowISO() }
  ];
  return { types, tools };
}

function loadDemoData() {
  if (state.tools.length || state.types.length) {
    const confirmed = window.confirm("Ya existen datos. Cargar la demostración agregará registros adicionales. ¿Deseas continuar?");
    if (!confirmed) return;
  }
  const demo = buildDemoData();
  state.types.push(...demo.types);
  state.tools.push(...demo.tools);
  demo.tools.forEach((tool) => addEvent(tool, "created", "Herramental dado de alta", `Registro de demostración: ${tool.assetCode}.`, { location: statusInfo(tool).location }));
  const floorTool = demo.tools.find((tool) => tool.status === "floor");
  if (floorTool) addEvent(floorTool, "checkout", "Salida de herramental a piso", `Entregado a ${floorTool.location}.`, { requestedBy: floorTool.requestedBy, location: floorTool.location });
  saveState({ silent: true });
  renderAll();
  switchView("dashboard");
  showToast("Datos de demostración cargados", "Explora alertas, movimientos y trazabilidad.", "success");
}

function updateNotificationStatus() {
  const button = $("#notificationButton");
  const status = $("#notificationStatus");
  if (!("Notification" in window)) {
    button.disabled = true;
    status.textContent = "Este navegador no admite notificaciones. Las alertas internas siguen activas.";
    return;
  }
  if (Notification.permission === "granted") {
    button.textContent = "Notificaciones activadas";
    button.disabled = true;
    status.textContent = "Se mostrará un resumen diario mientras el kiosco esté abierto.";
  } else if (Notification.permission === "denied") {
    button.textContent = "Permiso bloqueado";
    button.disabled = true;
    status.textContent = "Habilita el permiso desde la configuración del navegador.";
  } else {
    button.textContent = "Activar notificaciones";
    button.disabled = false;
    status.textContent = "Las alertas dentro de la aplicación siempre están activas.";
  }
}

async function requestNotifications() {
  if (!("Notification" in window)) return;
  try {
    const permission = await Notification.requestPermission();
    state.settings.browserNotifications = permission === "granted";
    saveState({ silent: true });
    updateNotificationStatus();
    if (permission === "granted") {
      new Notification("ToolTrack", { body: "Las notificaciones de mantenimiento están activadas." });
      showToast("Notificaciones activadas", "Recibirás el resumen diario al abrir el kiosco.", "success");
    }
  } catch (error) {
    console.error(error);
    showToast("No fue posible activar", "Abre la aplicación desde localhost y vuelve a intentarlo.", "error");
  }
}

function checkMaintenanceNotification() {
  if (!currentUser || !can("maintenance")) return;
  if (!("Notification" in window) || Notification.permission !== "granted") return;
  if (state.settings.lastNotificationDate === todayISO()) return;
  const active = state.tools.filter((tool) => tool.status !== "scrap");
  const overdue = active.filter((tool) => maintenanceState(tool).key === "overdue").length;
  const upcoming = active.filter((tool) => ["today", "dueSoon"].includes(maintenanceState(tool).key)).length;
  if (!overdue && !upcoming) return;
  new Notification("Mantenimiento de herramental", {
    body: `${overdue} vencido${overdue === 1 ? "" : "s"} · ${upcoming} próximo${upcoming === 1 ? "" : "s"} a vencer.`,
    icon: "assets/favicon.svg"
  });
  state.settings.lastNotificationDate = todayISO();
  saveState({ silent: true });
}

function handleAction(action, id = "") {
  const requiredPermission = {
    "new-tool": "createTool",
    "edit-tool": "editTool",
    "new-type": "editTypes",
    "edit-type": "editTypes",
    checkout: "movement",
    "checkout-tool": "movement",
    return: "movement",
    "return-tool": "movement",
    maintenance: "maintenance",
    "scrap-tool": "scrapTool"
  }[action] || "view";
  if (!requirePermission(requiredPermission)) return;
  const modalChainedActions = ["edit-tool", "checkout-tool", "return-tool", "maintenance", "scrap-tool"];
  if (modalChainedActions.includes(action) && !dom.modalBackdrop.hidden) closeModal();
  if (action === "new-type") openTypeForm();
  if (action === "edit-type") openTypeForm(id);
  if (action === "new-tool") openToolForm();
  if (action === "edit-tool") openToolForm(id);
  if (action === "view-tool") openToolDetail(id);
  if (action === "checkout") openCheckoutModal();
  if (action === "checkout-tool") openCheckoutModal(id);
  if (action === "return") openReturnModal();
  if (action === "return-tool") openReturnModal(id);
  if (action === "maintenance") openMaintenanceModal(id);
  if (action === "view-maintenance") openMaintenanceDetail(id);
  if (action === "scrap-tool") openScrapModal(id);
}

function bindEvents() {
  $$(".nav-item").forEach((button) => button.addEventListener("click", () => switchView(button.dataset.view)));
  document.addEventListener("click", (event) => {
    const actionTarget = event.target.closest("[data-action]");
    if (actionTarget && !actionTarget.disabled) handleAction(actionTarget.dataset.action, actionTarget.dataset.id || "");
    const viewTarget = event.target.closest("[data-view-link]");
    if (viewTarget) switchView(viewTarget.dataset.viewLink);
  });
  $("#menuButton").addEventListener("click", () => {
    if (window.matchMedia("(max-width: 850px)").matches) {
      const isOpen = dom.appShell.classList.toggle("menu-open");
      dom.sidebar.classList.toggle("open", isOpen);
      $("#menuButton").setAttribute("aria-expanded", String(isOpen));
      $("#menuButton").setAttribute("aria-label", isOpen ? "Cerrar menú" : "Abrir menú");
    } else {
      const isCollapsed = dom.appShell.classList.toggle("sidebar-collapsed");
      $("#menuButton").setAttribute("aria-expanded", String(!isCollapsed));
      $("#menuButton").setAttribute("aria-label", isCollapsed ? "Expandir menú" : "Contraer menú");
    }
  });
  $("#sidebarScrim").addEventListener("click", () => {
    dom.appShell.classList.remove("menu-open");
    dom.sidebar.classList.remove("open");
    $("#menuButton").setAttribute("aria-expanded", "false");
    $("#menuButton").setAttribute("aria-label", "Abrir menú");
  });
  $("#logoutButton").addEventListener("click", logout);
  $("#modalCloseButton").addEventListener("click", closeModal);
  dom.modalCancelButton.addEventListener("click", closeModal);
  dom.modalBackdrop.addEventListener("click", (event) => {
    if (event.target === dom.modalBackdrop) closeModal();
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !dom.modalBackdrop.hidden) closeModal();
  });
  dom.modalForm.addEventListener("submit", (event) => {
    event.preventDefault();
    if (!modalSubmitHandler) return;
    const result = modalSubmitHandler(new FormData(dom.modalForm));
    if (result instanceof Promise) result.catch((error) => console.error(error));
  });
  $("#toolSearch").addEventListener("input", renderTools);
  $("#toolStatusFilter").addEventListener("change", renderTools);
  $("#toolTypeFilter").addEventListener("change", renderTools);
  $("#maintenanceFilter").addEventListener("click", (event) => {
    const button = event.target.closest("[data-maint-filter]");
    if (!button) return;
    maintenanceFilter = button.dataset.maintFilter;
    $$("button", $("#maintenanceFilter")).forEach((item) => item.classList.toggle("active", item === button));
    renderMaintenance();
  });
  $("#traceToolSelect").addEventListener("change", renderTraceability);
  $("#settingsForm").addEventListener("submit", (event) => {
    event.preventDefault();
    if (!requirePermission("settings")) return;
    const formData = new FormData(event.currentTarget);
    state.settings.siteName = String(formData.get("siteName") || "").trim();
    state.settings.defaultWarningDays = Number(formData.get("defaultWarningDays"));
    saveState({ silent: true });
    renderAll();
    showToast("Configuración guardada", "Los nuevos registros usarán estos valores.", "success");
  });
  $("#exportBackupButton").addEventListener("click", () => {
    if (requirePermission("settings")) exportBackup();
  });
  $("#exportCsvButton").addEventListener("click", () => {
    if (requirePermission("exportCsv")) exportCsv();
  });
  $("#importBackupInput").addEventListener("change", (event) => {
    const file = event.target.files?.[0];
    if (file && requirePermission("settings")) importBackup(file);
    event.target.value = "";
  });
  $("#notificationButton").addEventListener("click", () => {
    if (requirePermission("settings")) requestNotifications();
  });
  $("#demoDataButton").addEventListener("click", () => {
    if (requirePermission("settings")) loadDemoData();
  });
  $("#userCreateForm").addEventListener("submit", createUser);
}

function registerServiceWorker() {
  if ("serviceWorker" in navigator && location.protocol.startsWith("http")) {
    navigator.serviceWorker.register("service-worker.js").catch((error) => console.warn("Service worker no disponible:", error));
  }
}

function init() {
  bindEvents();
  updateClock();
  window.setInterval(updateClock, 30000);
  renderAll();
  renderAuthScreen();
  registerServiceWorker();
  window.setTimeout(checkMaintenanceNotification, 1000);
  window.setInterval(checkMaintenanceNotification, 60 * 60 * 1000);
}

init();
