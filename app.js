// app.js — Metro-ON PWA v2 (Supabase Auth + Offline-First + 8 Mejoras Entregable)
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.119.2";
import {
  STORES,
  openDB,
  cacheCollection,
  getCachedCollection,
  enqueueOfflineReport,
  getOfflineQueue,
  removeOfflineQueueItem,
  saveDraftLocal,
  getDraftLocal,
  setKV,
  getKV
} from "./db.js";
import {
  METRO_STATIONS,
  FAULT_TYPES,
  INITIAL_AVISOS,
  TECHNICAL_MANUAL_GUIDES
} from "./manual-data.js";

const SUPABASE_URL = "https://siwfcayaowckaplecocm.supabase.co";
const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_5OaZUhO-XYVAe39u65r3CA_1F1wfmrC";

const supabase = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true
  }
});

const DEFAULT_PHOTO_BEFORE = "./assets/foto-ascensor-antes.jpg";
const DEFAULT_PHOTO_AFTER = "./assets/foto-ascensor-despues.jpg";

// ============================================================================
// ESTADO GLOBAL
// ============================================================================
const state = {
  session: null,
  user: null,
  profile: {
    full_name: "Técnico Contratista",
    role: "contratista",
    company: "Contratista Externo"
  },
  assets: [],
  inventory: [],
  reports: [],
  commentsByReport: {},
  interventions: [],
  offlineQueue: [],
  avisos: INITIAL_AVISOS,
  chatMessages: [],

  // Filtros y navegación
  reportFilter: "all",
  inventoryFilter: "all",
  manualCategory: "all",
  activeReportId: null,
  activeReportTab: "Detalles",
  activeAssetId: "A-03",
  activeAssetTab: "Historial",
  showAllAssetHistory: false,
  lastSubmittedReportId: null,
  lastSavedOffline: false,

  // Borrador de Nuevo Reporte
  draft: {
    asset_id: "A-03",
    station: "Los Leones",
    equipment: "Ascensor A-03",
    fault_type: "No operativo",
    brief_description: "Ascensor detenido por falla eléctrica.",
    audio_transcript: "",
    preliminary_diagnosis: "Falla en sensor de puerta.",
    work_done: "Reemplazar sensor y realizar prueba de funcionamiento.",
    current_state: "Operativo.",
    parts_used: [{ part_code: "SP-102", name: "Sensor de puerta (SP-102)", qty: 1 }],
    activePartCode: "SP-102",
    review_status: "En revisión",
    photo_before: DEFAULT_PHOTO_BEFORE,
    photo_after: DEFAULT_PHOTO_AFTER,
    saveOffline: false
  },

  // Audio
  isRecording: false,
  recordSeconds: 0,
  recordTimerId: null,
  speechRecognition: null,

  // Cronómetro Pauta de Testeo
  testTimerRunning: false,
  testTimerSeconds: 0,
  testTimerId: null,

  // QR cámara & PWA install
  qrStream: null,
  qrScanTimer: null,
  deferredInstallPrompt: null,
  syncingQueue: false
};

// ============================================================================
// UTILIDADES DE SEGURIDAD, FORMATO Y DIALOGS
// ============================================================================
function escapeHtml(str) {
  return String(str ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function formatSimpleMarkdown(text) {
  return escapeHtml(text)
    .replace(/\*\*(.*?)\*\*/g, "<strong>$1</strong>")
    .replace(/\*(.*?)\*/g, "<em>$1</em>")
    .replace(/\n/g, "<br/>");
}

function formatTimer(sec) {
  const m = Math.floor(sec / 60);
  const s = String(sec % 60).padStart(2, "0");
  return `${m}:${s}`;
}

function formatServiceAge(installedAt) {
  if (!installedAt) return "6 años y 4 meses";
  const start = new Date(`${installedAt}T00:00:00`);
  const now = new Date();
  if (Number.isNaN(start.getTime())) return "6 años y 4 meses";
  let months = (now.getFullYear() - start.getFullYear()) * 12 + (now.getMonth() - start.getMonth());
  if (now.getDate() < start.getDate()) months -= 1;
  months = Math.max(1, months);
  const years = Math.floor(months / 12);
  const remMonths = months % 12;
  if (years <= 0) return `${remMonths} ${remMonths === 1 ? "mes" : "meses"}`;
  if (remMonths === 0) return `${years} ${years === 1 ? "año" : "años"}`;
  return `${years} ${years === 1 ? "año" : "años"} y ${remMonths} ${remMonths === 1 ? "mes" : "meses"}`;
}

function formatShortDate(dateStr) {
  if (!dateStr) return "Hoy";
  const d = new Date(dateStr.includes("T") ? dateStr : `${dateStr}T12:00:00`);
  if (Number.isNaN(d.getTime())) return dateStr;
  return d.toLocaleDateString("es-CL", { day: "2-digit", month: "short", year: "numeric" });
}

function formatTimeLabel(isoStr) {
  if (!isoStr) return "Ahora";
  const d = new Date(isoStr);
  if (Number.isNaN(d.getTime())) return "";
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  const hm = d.toLocaleTimeString("es-CL", { hour: "2-digit", minute: "2-digit" });
  return sameDay ? `Hoy ${hm}` : `${d.toLocaleDateString("es-CL", { day: "2-digit", month: "short" })} ${hm}`;
}

function showToast(msg) {
  const banner = document.getElementById("toastBanner");
  if (!banner) return;
  banner.textContent = msg;
  banner.classList.add("show");
  clearTimeout(banner._t);
  banner._t = setTimeout(() => banner.classList.remove("show"), 3000);
}

function getSelectedAsset() {
  return state.assets.find((a) => a.id === state.draft.asset_id) || state.assets[0] || null;
}

function compressUploadedPhoto(file, maxSide = 680) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (ev) => {
      const img = new Image();
      img.onload = () => {
        let { width, height } = img;
        if (width > height && width > maxSide) {
          height = Math.round((height * maxSide) / width);
          width = maxSide;
        } else if (height > maxSide) {
          width = Math.round((width * maxSide) / height);
          height = maxSide;
        }
        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext("2d");
        ctx.drawImage(img, 0, 0, width, height);
        resolve(canvas.toDataURL("image/jpeg", 0.78));
      };
      img.onerror = reject;
      img.src = ev.target.result;
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

// ============================================================================
// MODERN WEB GUIDANCE: <dialog> LIGHT-DISMISS FALLBACK + VALIDACIÓN ARIA
// ============================================================================
function initDialogControls() {
  const supportsClosedBy = "closedBy" in HTMLDialogElement.prototype;
  const outside = (e, dialog) => {
    const r = dialog.getBoundingClientRect();
    return e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom;
  };

  for (const dialog of document.querySelectorAll("dialog")) {
    dialog.addEventListener("close", () => {
      dialog.returnValue = "";
      if (dialog.id === "dialogQrScanner") {
        stopQrCamera();
      }
    });

    if (!supportsClosedBy && dialog.getAttribute("closedby") === "any") {
      let pressedOutside = false;
      dialog.addEventListener("pointerdown", (e) => {
        pressedOutside = outside(e, dialog);
      });
      dialog.addEventListener("pointerup", (e) => {
        if (pressedOutside && outside(e, dialog)) dialog.close();
      });
    }
  }
}

function initAccessibleFormValidation() {
  const linkError = (el, shown) => {
    const errorId = el.dataset.error;
    if (!errorId) return;
    const ids = (el.getAttribute("aria-describedby") || "")
      .split(/\s+/)
      .filter((id) => id && id !== errorId);
    if (shown) ids.push(errorId);
    if (ids.length) el.setAttribute("aria-describedby", ids.join(" "));
    else el.removeAttribute("aria-describedby");
  };

  const announcer = document.createElement("div");
  announcer.setAttribute("aria-live", "polite");
  announcer.classList.add("visually-hidden");
  document.body.append(announcer);
  let announceTimer;
  let announcedField;

  const spokenText = (node) => {
    const copy = node.cloneNode(true);
    copy.querySelectorAll('[aria-hidden="true"]').forEach((n) => n.remove());
    copy
      .querySelectorAll('[role="img"][aria-label]')
      .forEach((n) => n.replaceWith(`${n.getAttribute("aria-label")}: `));
    return copy.textContent.replace(/\s+/g, " ").trim();
  };

  const announceError = (el) => {
    const error = document.getElementById(el.dataset.error);
    if (!error) return;
    const label = el.labels?.[0] ? `${spokenText(el.labels[0])}: ` : "";
    clearTimeout(announceTimer);
    announcer.textContent = "";
    announcedField = el;
    announceTimer = setTimeout(() => {
      announcer.textContent = label + spokenText(error);
    }, 500);
  };

  const supportsUserInvalid = CSS.supports("selector(:user-invalid)");
  const dirtyState = new WeakMap();
  const flagged = new WeakSet();
  const announced = new WeakSet();

  const syncAria = (el, announce = false) => {
    if (!el?.matches?.("input, select, textarea")) return;
    let invalid = false;
    if (supportsUserInvalid) {
      invalid = el.matches(":user-invalid");
    } else {
      const st = dirtyState.get(el);
      invalid = Boolean(st?.hasBlurred && !el.validity.valid);
      if (st?.hasBlurred) {
        el.classList.toggle("user-invalid-fallback", !el.validity.valid);
        el.classList.toggle("user-valid-fallback", el.validity.valid);
      }
    }

    if (invalid) {
      if (announce && !announced.has(el)) {
        announceError(el);
        announced.add(el);
      }
      el.setAttribute("aria-invalid", "true");
      linkError(el, true);
      flagged.add(el);
    } else if (flagged.has(el) || el.getAttribute("aria-invalid") !== "true") {
      el.setAttribute("aria-invalid", "false");
      linkError(el, false);
      flagged.delete(el);
      announced.delete(el);
      if (announcedField === el) {
        clearTimeout(announceTimer);
        announcer.textContent = "";
      }
    }
  };

  const authRoot = document.getElementById("screen-auth");
  if (!authRoot) return;

  authRoot.querySelectorAll("input, select, textarea").forEach((el) => {
    el.setAttribute("aria-invalid", "false");
  });

  authRoot.addEventListener(
    "blur",
    (e) => {
      const el = e.target;
      if (!supportsUserInvalid && el.matches?.("input, select, textarea")) {
        const st = dirtyState.get(el) || { hasInteracted: false, hasBlurred: false };
        st.hasBlurred = true;
        dirtyState.set(el, st);
      }
      syncAria(el, true);
    },
    true
  );

  authRoot.addEventListener("input", (e) => {
    const el = e.target;
    if (!supportsUserInvalid && el.matches?.("input, select, textarea")) {
      const st = dirtyState.get(el) || { hasInteracted: false, hasBlurred: false };
      st.hasInteracted = true;
      dirtyState.set(el, st);
    }
    if (el.hasAttribute("aria-invalid")) syncAria(el, false);
  });

  authRoot.addEventListener(
    "invalid",
    (e) => {
      if (!supportsUserInvalid) {
        dirtyState.set(e.target, { hasInteracted: true, hasBlurred: true });
      }
      announced.add(e.target);
      syncAria(e.target, false);
    },
    true
  );

  authRoot.addEventListener(
    "reset",
    (e) => {
      setTimeout(() => {
        [...(e.target.elements || [])].forEach((el) => {
          dirtyState.delete(el);
          el.classList.remove("user-invalid-fallback", "user-valid-fallback");
          syncAria(el, false);
        });
      });
    },
    true
  );
}

// ============================================================================
// DATOS DE RESPALDO OFFLINE (SI ARRANCA SIN RED)
// ============================================================================
function getSeedFallbackData() {
  return {
    assets: [
      { id: "A-03", qr_code: "MTR-L1-A03", serial_number: "SN-2020-A03-L1", name: "Ascensor A-03", equipment_type: "Ascensor", station: "Los Leones", line: "L1", installed_at: "2020-07-24", status: "En revisión", recurrence_count: 3 },
      { id: "E-12", qr_code: "MTR-L1-E12", serial_number: "SN-2019-E12-L1", name: "Escalera E-12", equipment_type: "Escalera mecánica", station: "Baquedano", line: "L1", installed_at: "2019-03-15", status: "Operativo", recurrence_count: 2 },
      { id: "A-07", qr_code: "MTR-L3-A07", serial_number: "SN-2021-A07-L3", name: "Ascensor A-07", equipment_type: "Ascensor", station: "Hospitales", line: "L3", installed_at: "2021-05-10", status: "Pendiente (faltan materiales)", recurrence_count: 4 },
      { id: "T-04", qr_code: "MTR-L1-T04", serial_number: "SN-2022-T04-L1", name: "Torniquete T-04", equipment_type: "Torniquete / Peaje BIP", station: "Universidad de Chile", line: "L1", installed_at: "2022-01-12", status: "Operativo", recurrence_count: 1 }
    ],
    inventory: [
      { part_code: "SP-102", name: "Sensor de puerta (SP-102)", category: "Ascensor", warehouse: "Bodega Central L1", stock: 12, min_stock: 4 },
      { part_code: "M-210", name: "Motor de tracción (M-210)", category: "Ascensor", warehouse: "Bodega Central L1", stock: 2, min_stock: 3 },
      { part_code: "SKF-6205", name: "Rodamiento guía (SKF-6205)", category: "Escalera mecánica", warehouse: "Bodega Baquedano", stock: 14, min_stock: 5 },
      { part_code: "PP-08", name: "Placa peine superior (PP-08)", category: "Escalera mecánica", warehouse: "Bodega Baquedano", stock: 3, min_stock: 4 },
      { part_code: "SOL-24V", name: "Solenoide destrabe BIP (SOL-24V)", category: "Torniquete / Peaje BIP", warehouse: "Bodega U. de Chile", stock: 9, min_stock: 3 },
      { part_code: "FP-24", name: "Fuente poder 24V (FP-24)", category: "General", warehouse: "Bodega Central L1", stock: 1, min_stock: 3 }
    ],
    reports: [
      {
        id: "00000000-0000-4000-8000-000000004587",
        report_number: 4587,
        asset_id: "A-03",
        station: "Los Leones",
        equipment: "Ascensor A-03",
        fault_type: "No operativo",
        brief_description: "Falla en sensor de puerta.",
        preliminary_diagnosis: "Falla en sensor de puerta.",
        work_done: "Reemplazo de sensor y prueba de funcionamiento.",
        current_state: "Operativo.",
        parts_used: [{ part_code: "SP-102", name: "Sensor de puerta (SP-102)", qty: 1 }],
        review_status: "En revisión",
        photo_before: DEFAULT_PHOTO_BEFORE,
        photo_after: DEFAULT_PHOTO_AFTER,
        saved_offline: false,
        created_at: new Date().toISOString()
      }
    ],
    comments: [
      {
        id: "00000000-0000-4000-8000-000000014587",
        report_id: "00000000-0000-4000-8000-000000004587",
        author_name: "Supervisor",
        author_role: "metro",
        body: "Verificar calibración del sensor en la próxima mantención.",
        created_at: new Date().toISOString()
      }
    ],
    interventions: [
      { id: "int-1", asset_id: "A-03", intervention_date: "2026-10-10", summary: "Reemplazo de sensor (SP-102)", part_code: "SP-102" },
      { id: "int-2", asset_id: "A-03", intervention_date: "2026-07-14", summary: "Ajuste de puerta", part_code: null },
      { id: "int-3", asset_id: "A-03", intervention_date: "2026-02-02", summary: "Cambio de motor (M-210)", part_code: "M-210" }
    ]
  };
}

// ============================================================================
// CARGA DE DATOS SUPABASE + CACHÉ INDEXEDDB + COLA OFFLINE
// ============================================================================
async function ensureUserProfile(user) {
  if (!user) return;
  const meta = user.user_metadata || {};
  const fallbackName = meta.full_name || user.email?.split("@")[0] || "Usuario Metro-ON";
  const fallbackRole = meta.role === "metro" ? "metro" : "contratista";
  const fallbackCompany = meta.company || (fallbackRole === "metro" ? "Metro de Santiago (ITC)" : "Contratista Externo");

  try {
    const { data: existing } = await supabase
      .from("metro_profiles")
      .select("*")
      .eq("id", user.id)
      .maybeSingle();

    if (existing) {
      state.profile = existing;
      await setKV("cached_profile", existing);
      return;
    }

    const row = {
      id: user.id,
      email: user.email || "",
      full_name: fallbackName,
      role: fallbackRole,
      company: fallbackCompany
    };

    const { data: inserted } = await supabase
      .from("metro_profiles")
      .upsert(row, { onConflict: "id" })
      .select()
      .single();

    state.profile = inserted || row;
    await setKV("cached_profile", state.profile);
  } catch {
    const cached = await getKV("cached_profile");
    state.profile = cached || {
      id: user.id,
      email: user.email || "",
      full_name: fallbackName,
      role: fallbackRole,
      company: fallbackCompany
    };
  }
}

async function loadOperationalData() {
  state.offlineQueue = await getOfflineQueue();

  if (navigator.onLine && state.user) {
    try {
      await ensureUserProfile(state.user);

      const [assetsRes, invRes, repRes, commRes, intRes, chatRes] = await Promise.all([
        supabase.from("metro_assets").select("*").order("id", { ascending: true }),
        supabase.from("metro_inventory").select("*").order("part_code", { ascending: true }),
        supabase.from("metro_reports").select("*").order("created_at", { ascending: false }),
        supabase.from("metro_report_comments").select("*").order("created_at", { ascending: true }),
        supabase.from("metro_asset_interventions").select("*").order("intervention_date", { ascending: false }),
        supabase
          .from("metro_chat_messages")
          .select("*")
          .eq("user_id", state.user.id)
          .order("created_at", { ascending: true })
      ]);

      if (!assetsRes.error && assetsRes.data?.length) {
        state.assets = assetsRes.data;
        await cacheCollection(STORES.ASSETS, state.assets);
      }
      if (!invRes.error && invRes.data?.length) {
        state.inventory = invRes.data;
        await cacheCollection(STORES.INVENTORY, state.inventory);
      }
      if (!repRes.error && repRes.data) {
        state.reports = repRes.data;
        await cacheCollection(STORES.REPORTS, state.reports);
      }
      if (!commRes.error && commRes.data) {
        const grouped = {};
        for (const c of commRes.data) {
          if (!grouped[c.report_id]) grouped[c.report_id] = [];
          grouped[c.report_id].push(c);
        }
        state.commentsByReport = grouped;
        await cacheCollection(STORES.COMMENTS, commRes.data);
      }
      if (!intRes.error && intRes.data) {
        state.interventions = intRes.data;
        await cacheCollection(STORES.INTERVENTIONS, state.interventions);
      }
      if (!chatRes.error && chatRes.data) {
        state.chatMessages = chatRes.data.length
          ? chatRes.data
          : [getDefaultWelcomeChatMessage()];
      }
    } catch {
      await loadFromIndexedDBCache();
    }
  } else {
    await loadFromIndexedDBCache();
  }

  if (!state.assets.length) {
    const seed = getSeedFallbackData();
    state.assets = seed.assets;
    state.inventory = seed.inventory;
    state.reports = seed.reports;
    state.interventions = seed.interventions;
    state.commentsByReport = { [seed.reports[0].id]: seed.comments };
  }

  if (!state.chatMessages.length) {
    state.chatMessages = [getDefaultWelcomeChatMessage()];
  }

  populateFormSelects();
  renderAllUI();
}

async function loadFromIndexedDBCache() {
  const [assets, inv, reps, comms, ints, cachedProf] = await Promise.all([
    getCachedCollection(STORES.ASSETS),
    getCachedCollection(STORES.INVENTORY),
    getCachedCollection(STORES.REPORTS),
    getCachedCollection(STORES.COMMENTS),
    getCachedCollection(STORES.INTERVENTIONS),
    getKV("cached_profile")
  ]);

  if (cachedProf) state.profile = cachedProf;
  if (assets.length) state.assets = assets;
  if (inv.length) state.inventory = inv;
  if (reps.length) state.reports = reps.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
  if (ints.length) state.interventions = ints;
  if (comms.length) {
    const grouped = {};
    for (const c of comms) {
      if (!grouped[c.report_id]) grouped[c.report_id] = [];
      grouped[c.report_id].push(c);
    }
    state.commentsByReport = grouped;
  }
}

function getDefaultWelcomeChatMessage() {
  return {
    id: "welcome-msg",
    sender: "ai",
    author: "🚇 Metro de Santiago • Soporte IA",
    body: "¡Hola! Estás conectado al canal técnico de **Metro-ON**.\n\nConsulta por stock real de repuestos, protocolos de seguridad o resumen de reportes guardados."
  };
}

// ============================================================================
// SINCRONIZACIÓN DE COLA OFFLINE CON SUPABASE
// ============================================================================
async function syncOfflineQueue(showResultToast = true) {
  if (state.syncingQueue || !navigator.onLine || !state.user) return;
  const queue = await getOfflineQueue();
  state.offlineQueue = queue;
  if (!queue.length) {
    updateNetworkAndCountersUI();
    return;
  }

  state.syncingQueue = true;
  let syncedCount = 0;

  try {
    for (const item of queue) {
      const reportPayload = {
        user_id: state.user.id,
        author_name: state.profile.full_name || state.user.email,
        asset_id: item.asset_id,
        station: item.station,
        equipment: item.equipment,
        fault_type: item.fault_type,
        brief_description: item.brief_description,
        audio_transcript: item.audio_transcript,
        preliminary_diagnosis: item.preliminary_diagnosis,
        work_done: item.work_done,
        current_state: item.current_state,
        parts_used: item.parts_used || [],
        review_status: item.review_status,
        photo_before: item.photo_before,
        photo_after: item.photo_after,
        saved_offline: true
      };

      const { data: insertedReport, error: repErr } = await supabase
        .from("metro_reports")
        .insert(reportPayload)
        .select()
        .single();

      if (repErr) continue;

      await applySideEffectsForReport(insertedReport, item.parts_used || []);
      await removeOfflineQueueItem(item.qid);
      syncedCount += 1;
    }
  } finally {
    state.syncingQueue = false;
  }

  if (syncedCount > 0) {
    await loadOperationalData();
    if (showResultToast) {
      showToast(`✅ ${syncedCount} reporte(s) offline sincronizados con Supabase`);
    }
  } else {
    updateNetworkAndCountersUI();
  }
}

async function applySideEffectsForReport(report, partsUsed) {
  if (!state.user) return;

  // 1. Descontar piezas del inventario en tiempo real
  for (const part of partsUsed || []) {
    const invItem = state.inventory.find((i) => i.part_code === part.part_code);
    if (!invItem) continue;
    const newStock = Math.max(0, Number(invItem.stock) - Number(part.qty || 1));
    await supabase
      .from("metro_inventory")
      .update({
        stock: newStock,
        updated_by: state.user.id,
        updated_at: new Date().toISOString()
      })
      .eq("part_code", part.part_code);
  }

  // 2. Registrar intervención en historial del activo y actualizar reincidencia
  if (report.asset_id) {
    const firstPart = partsUsed?.[0]?.part_code || null;
    await supabase.from("metro_asset_interventions").insert({
      asset_id: report.asset_id,
      report_id: report.id,
      user_id: state.user.id,
      intervention_date: new Date().toISOString().slice(0, 10),
      summary: report.work_done || report.preliminary_diagnosis || "Intervención registrada",
      part_code: firstPart
    });

    const asset = state.assets.find((a) => a.id === report.asset_id);
    if (asset) {
      const newAssetStatus =
        report.review_status === "Finalizado"
          ? "Operativo"
          : report.review_status;
      await supabase
        .from("metro_assets")
        .update({
          status: newAssetStatus,
          recurrence_count: Number(asset.recurrence_count || 0) + 1,
          updated_by: state.user.id
        })
        .eq("id", asset.id);
    }
  }
}

// ============================================================================
// NAVEGACIÓN Y SINCRONIZACIÓN DE UI
// ============================================================================
function navigateToScreen(screenId) {
  document.querySelectorAll(".screen").forEach((sec) => {
    sec.classList.toggle("active", sec.id === screenId);
  });

  const tabbar = document.getElementById("bottomTabbar");
  const isAuth = screenId === "screen-auth";
  if (tabbar) {
    tabbar.classList.toggle("hidden", isAuth);
  }

  const navMap = {
    "screen-inicio": "screen-inicio",
    "screen-nuevo-reporte": "screen-inicio",
    "screen-grabar-audio": "screen-inicio",
    "screen-informe-generado": "screen-inicio",
    "screen-reporte-enviado": "screen-inicio",
    "screen-avisos": "screen-inicio",
    "screen-historial-equipos": "screen-inicio",
    "screen-equipo-detalle": "screen-inicio",
    "screen-inventario": "screen-inicio",
    "screen-mis-reportes": "screen-mis-reportes",
    "screen-detalle-reporte": "screen-mis-reportes",
    "screen-manual-tecnico": "screen-manual-tecnico",
    "screen-chat": "screen-chat",
    "screen-perfil": "screen-perfil"
  };

  const activeTarget = navMap[screenId] || "screen-inicio";
  document.querySelectorAll(".bottom-tabbar .tabbar-item").forEach((btn) => {
    btn.classList.toggle("active", btn.getAttribute("data-nav") === activeTarget);
  });

  if (screenId === "screen-mis-reportes") renderReportsList();
  else if (screenId === "screen-detalle-reporte") renderReportDetail();
  else if (screenId === "screen-historial-equipos") renderAssetsList();
  else if (screenId === "screen-equipo-detalle") renderAssetDetail();
  else if (screenId === "screen-manual-tecnico") renderManualList();
  else if (screenId === "screen-inventario") renderInventoryList();
  else if (screenId === "screen-chat") renderChatMessages();
  else if (screenId === "screen-avisos") renderAvisosList();
  else if (screenId === "screen-perfil") renderProfileScreen();
}

function updateNetworkAndCountersUI() {
  const strip = document.getElementById("networkStrip");
  const stripText = document.getElementById("networkStripText");
  const syncBtn = document.getElementById("btnStripSyncNow");
  const qCount = state.offlineQueue.length;

  if (strip && stripText) {
    if (!navigator.onLine) {
      strip.className = "network-strip offline";
      stripText.textContent = `📡 Sin señal bajo tierra (${qCount} en cola offline)`;
      if (syncBtn) syncBtn.hidden = true;
    } else if (qCount > 0) {
      strip.className = "network-strip pending-sync";
      stripText.textContent = `⏳ ${qCount} reporte(s) guardados offline listos para subir`;
      if (syncBtn) syncBtn.hidden = false;
    } else {
      strip.className = "network-strip";
    }
  }

  const allReports = getMergedReports();
  const homeCount = document.getElementById("homeReportsCountPill");
  if (homeCount) homeCount.textContent = String(allReports.length);

  const pendingCount = allReports.filter((r) => r.review_status !== "Finalizado").length;
  const tabBadge = document.getElementById("tabReportesBadge");
  if (tabBadge) {
    tabBadge.textContent = String(pendingCount);
    tabBadge.style.display = pendingCount > 0 ? "inline-block" : "none";
  }

  const hasLowStock = state.inventory.some((item) => Number(item.stock) <= Number(item.min_stock));
  const dot = document.getElementById("homeInventoryAlertDot");
  if (dot) dot.style.display = hasLowStock ? "inline-block" : "none";

  const isMetro = state.profile.role === "metro";
  const roleBadgeText = document.getElementById("roleBadgeText");
  const welcomeSubtitle = document.getElementById("welcomeRoleSubtitle");
  if (roleBadgeText) roleBadgeText.textContent = isMetro ? "🚇 Supervisor Metro" : "👷 Contratista";
  if (welcomeSubtitle) {
    const first = (state.profile.full_name || "").split(" ")[0];
    const roleName = isMetro ? "Supervisor Metro (ITC)" : "Contratista";
    welcomeSubtitle.textContent = first ? `${first} · ${roleName}` : roleName;
  }
}

function renderAllUI() {
  updateNetworkAndCountersUI();
  syncDraftToUI();
  renderReportsList();
  renderAssetsList();
  renderManualList();
  renderInventoryList();
  renderAvisosList();
  renderChatMessages();
  renderProfileScreen();
}

function getMergedReports() {
  const queuedFormatted = state.offlineQueue.map((q) => ({
    ...q,
    id: `offline-${q.qid}`,
    report_number: `OFF-${q.qid}`,
    isOfflineQueued: true,
    created_at: q.queuedAt
  }));
  return [...queuedFormatted, ...state.reports];
}

// ============================================================================
// SELECTS Y BORRADOR DE NUEVO REPORTE + IDENTIFICACIÓN QR / N° SERIE
// ============================================================================
function populateFormSelects() {
  const selAsset = document.getElementById("inputAssetId");
  const selEst = document.getElementById("inputEstacion");
  const selFault = document.getElementById("inputTipoAveria");
  const selPart = document.getElementById("selectPartToAdd");

  if (selAsset) {
    selAsset.innerHTML = state.assets
      .map(
        (a) =>
          `<option value="${escapeHtml(a.id)}">${escapeHtml(a.name)} — Est. ${escapeHtml(a.station)} (${escapeHtml(a.qr_code)})</option>`
      )
      .join("");
    selAsset.value = state.draft.asset_id;
  }

  if (selEst) {
    const stations = Array.from(new Set([...METRO_STATIONS, ...state.assets.map((a) => a.station)]));
    selEst.innerHTML = stations.map((s) => `<option value="${escapeHtml(s)}">${escapeHtml(s)}</option>`).join("");
    selEst.value = state.draft.station;
  }

  if (selFault) {
    selFault.innerHTML = FAULT_TYPES.map((f) => `<option value="${escapeHtml(f)}">${escapeHtml(f)}</option>`).join("");
    selFault.value = state.draft.fault_type;
  }

  if (selPart) {
    selPart.innerHTML =
      `<option value="">+ Agregar repuesto desde inventario...</option>` +
      state.inventory
        .map(
          (i) =>
            `<option value="${escapeHtml(i.part_code)}">${escapeHtml(i.name)} (${i.stock} disp.)</option>`
        )
        .join("");
  }
}

function applyIdentifiedAsset(asset) {
  if (!asset) return;
  state.draft.asset_id = asset.id;
  state.draft.equipment = asset.name;
  state.draft.station = asset.station;
  const selAsset = document.getElementById("inputAssetId");
  const selEst = document.getElementById("inputEstacion");
  if (selAsset) selAsset.value = asset.id;
  if (selEst) selEst.value = asset.station;
  syncDraftToUI();
  saveDraftLocal(state.draft).catch(() => {});
  showToast(`✅ Identificado: ${asset.name} (${asset.station})`);
}

function syncDraftToUI() {
  const asset = getSelectedAsset();
  const assetNameEl = document.getElementById("draftAssetNameLabel");
  const stationNameEl = document.getElementById("draftStationNameLabel");
  const recLabelEl = document.getElementById("draftAssetRecurrenceLabel");

  if (assetNameEl) assetNameEl.textContent = state.draft.equipment || asset?.name || "Ascensor A-03";
  if (stationNameEl) stationNameEl.textContent = state.draft.station || asset?.station || "Los Leones";
  if (recLabelEl) {
    const count = asset ? asset.recurrence_count : 3;
    recLabelEl.textContent = `${count} fallas`;
  }

  const descInput = document.getElementById("inputDescripcionBreve");
  if (descInput && document.activeElement !== descInput) {
    descInput.value = state.draft.brief_description || "";
  }

  const toggleOff = document.getElementById("toggleSaveOffline");
  if (toggleOff) toggleOff.checked = Boolean(state.draft.saveOffline);

  const imgInfBefore = document.getElementById("imgInformeBefore");
  const imgInfAfter = document.getElementById("imgInformeAfter");
  const modImgBefore = document.getElementById("modalImgBefore");
  const modImgAfter = document.getElementById("modalImgAfter");
  if (imgInfBefore) imgInfBefore.src = state.draft.photo_before;
  if (imgInfAfter) imgInfAfter.src = state.draft.photo_after;
  if (modImgBefore) modImgBefore.src = state.draft.photo_before;
  if (modImgAfter) modImgAfter.src = state.draft.photo_after;

  const chipAudio = document.getElementById("chipAudioStatus");
  if (chipAudio) {
    if (state.draft.audio_transcript?.trim()) {
      chipAudio.textContent = `🎙️ Audio listo (${formatTimer(state.recordSeconds || 18)})`;
      chipAudio.classList.add("done");
    } else {
      chipAudio.textContent = "🎙️ Audio pendiente";
      chipAudio.classList.remove("done");
    }
  }

  renderSelectedPartsUI();
}

// ============================================================================
// ESCÁNER QR Y CAPTURA DE N° DE SERIE
// ============================================================================
function stopQrCamera() {
  clearInterval(state.qrScanTimer);
  state.qrScanTimer = null;
  if (state.qrStream) {
    for (const track of state.qrStream.getTracks()) track.stop();
    state.qrStream = null;
  }
  const vid = document.getElementById("qrCameraVideo");
  if (vid) vid.srcObject = null;
}

async function openQrScannerDialog() {
  const dialog = document.getElementById("dialogQrScanner");
  const listEl = document.getElementById("qrQuickPickList");
  const msgEl = document.getElementById("qrCameraStatusMsg");
  if (!dialog || !listEl) return;

  listEl.innerHTML = state.assets
    .map(
      (a) => `
      <button type="button" class="quick-pick-item" data-pick-asset="${escapeHtml(a.id)}">
        <div>
          <div style="font-size:13.5px; font-weight:700;">${escapeHtml(a.name)} — Est. ${escapeHtml(a.station)}</div>
          <div style="font-size:11.5px; color:var(--text-secondary);">QR: ${escapeHtml(a.qr_code)}</div>
        </div>
        <span class="count-pill">Usar</span>
      </button>
    `
    )
    .join("");

  listEl.querySelectorAll("[data-pick-asset]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const asset = state.assets.find((x) => x.id === btn.dataset.pickAsset);
      if (asset) applyIdentifiedAsset(asset);
      dialog.close();
    });
  });

  dialog.showModal();

  if (navigator.mediaDevices?.getUserMedia) {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: "environment" } }
      });
      state.qrStream = stream;
      const vid = document.getElementById("qrCameraVideo");
      if (vid) {
        vid.srcObject = stream;
        await vid.play();
      }
      if ("BarcodeDetector" in window) {
        const detector = new window.BarcodeDetector({ formats: ["qr_code"] });
        state.qrScanTimer = setInterval(async () => {
          try {
            if (!vid || vid.readyState < 2) return;
            const codes = await detector.detect(vid);
            if (codes.length > 0) {
              const raw = (codes[0].rawValue || "").trim().toUpperCase();
              const matched = state.assets.find(
                (a) => raw.includes(a.qr_code.toUpperCase()) || raw.includes(a.id.toUpperCase())
              );
              if (matched) {
                applyIdentifiedAsset(matched);
                dialog.close();
              } else if (msgEl) {
                msgEl.textContent = `QR leído (${raw}), selecciona equipo abajo`;
              }
            }
          } catch {}
        }, 550);
      } else if (msgEl) {
        msgEl.textContent = "Cámara activa — usa un QR rápido abajo o apunta";
      }
    } catch {
      if (msgEl) msgEl.textContent = "Sin permiso de cámara — selecciona un equipo abajo";
    }
  } else if (msgEl) {
    msgEl.textContent = "Selecciona el código QR del equipo abajo";
  }
}

function openSerialCaptureDialog() {
  const dialog = document.getElementById("dialogSerialCapture");
  const listEl = document.getElementById("serialQuickPickList");
  if (!dialog || !listEl) return;

  listEl.innerHTML = state.assets
    .map(
      (a) => `
      <button type="button" class="quick-pick-item" data-pick-serial="${escapeHtml(a.id)}">
        <div>
          <div style="font-size:13.5px; font-weight:700;">${escapeHtml(a.serial_number)}</div>
          <div style="font-size:11.5px; color:var(--text-secondary);">${escapeHtml(a.name)} · Est. ${escapeHtml(a.station)}</div>
        </div>
        <span class="count-pill">Autocompletar</span>
      </button>
    `
    )
    .join("");

  listEl.querySelectorAll("[data-pick-serial]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const asset = state.assets.find((x) => x.id === btn.dataset.pickSerial);
      if (asset) applyIdentifiedAsset(asset);
      dialog.close();
    });
  });

  dialog.showModal();
}

// ============================================================================
// AUDIO Y GENERACIÓN DE BORRADOR IA EDITABLE + PIEZAS
// ============================================================================
function startOrPauseAudio() {
  if (state.isRecording) pauseAudio();
  else startAudio();
}

function startAudio() {
  state.isRecording = true;
  document.getElementById("btnBigMicCircle")?.classList.add("recording");
  document.getElementById("waveformBars")?.classList.add("recording");
  const lbl = document.getElementById("audioLiveStateLabel");
  const icon = document.getElementById("iconPauseRecord");
  if (lbl) lbl.textContent = "🔴 Grabando audio...";
  if (icon) icon.textContent = "❚❚";

  clearInterval(state.recordTimerId);
  state.recordTimerId = setInterval(() => {
    if (state.recordSeconds < 120) {
      state.recordSeconds += 1;
      const disp = document.getElementById("audioTimerDisplay");
      if (disp) disp.textContent = `${formatTimer(state.recordSeconds)} / 2:00`;
    } else {
      pauseAudio();
    }
  }, 1000);

  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (SpeechRecognition) {
    try {
      const rec = new SpeechRecognition();
      rec.lang = "es-CL";
      rec.continuous = true;
      rec.interimResults = true;
      const textarea = document.getElementById("audioTranscriptTextarea");
      const baseText = textarea ? textarea.value.trim() : "";

      rec.onresult = (event) => {
        let spoken = "";
        for (let i = 0; i < event.results.length; i++) {
          spoken += `${event.results[i][0].transcript} `;
        }
        if (textarea) {
          textarea.value = (baseText ? `${baseText} ` : "") + spoken.trim();
          state.draft.audio_transcript = textarea.value;
        }
      };
      rec.onerror = () => {};
      rec.start();
      state.speechRecognition = rec;
    } catch {}
  }
}

function pauseAudio() {
  state.isRecording = false;
  clearInterval(state.recordTimerId);
  document.getElementById("btnBigMicCircle")?.classList.remove("recording");
  document.getElementById("waveformBars")?.classList.remove("recording");
  const lbl = document.getElementById("audioLiveStateLabel");
  const icon = document.getElementById("iconPauseRecord");
  if (lbl) lbl.textContent = state.recordSeconds > 0 ? "⏸️ En pausa / listo" : "Listo para grabar";
  if (icon) icon.textContent = "▶";

  if (state.speechRecognition) {
    try {
      state.speechRecognition.stop();
    } catch {}
    state.speechRecognition = null;
  }
}

function resetAudio() {
  pauseAudio();
  state.recordSeconds = 0;
  state.draft.audio_transcript = "";
  const disp = document.getElementById("audioTimerDisplay");
  const txt = document.getElementById("audioTranscriptTextarea");
  if (disp) disp.textContent = "0:00 / 2:00";
  if (txt) txt.value = "";
  syncDraftToUI();
  showToast("🎙️ Grabación reiniciada");
}

function loadSampleVoice() {
  const asset = getSelectedAsset();
  const eqName = asset ? asset.name : state.draft.equipment;
  const stName = asset ? asset.station : state.draft.station;

  let text = `En estación ${stName}, revisamos el ${eqName}. Presentaba falla en sensor de puerta. Se reemplazó el sensor SP-102 y se realizó prueba de funcionamiento con 15 ciclos sin fallas.`;
  if (eqName.toLowerCase().includes("escalera")) {
    text = `En estación ${stName}, intervenimos ${eqName} por vibración. Se reemplazó el rodamiento guía SKF-6205 y se ajustó la placa peine superior dejando el equipo operativo.`;
  } else if (eqName.toLowerCase().includes("torniquete")) {
    text = `En estación ${stName}, revisamos ${eqName}. Se reemplazó el solenoide SOL-24V y se validó lectura BIP operativa.`;
  }

  state.draft.audio_transcript = text;
  state.recordSeconds = 18;
  const txt = document.getElementById("audioTranscriptTextarea");
  const disp = document.getElementById("audioTimerDisplay");
  const lbl = document.getElementById("audioLiveStateLabel");
  if (txt) txt.value = text;
  if (disp) disp.textContent = "0:18 / 2:00";
  if (lbl) lbl.textContent = "✅ Relato cargado (0:18)";
  syncDraftToUI();
  showToast("⚡ Relato de voz cargado");
}

function analyzeDraftWithAI() {
  const raw = (state.draft.audio_transcript || state.draft.brief_description || "").trim();
  const lower = raw.toLowerCase();
  const asset = getSelectedAsset();
  const eqType = (asset?.equipment_type || state.draft.equipment || "").toLowerCase();

  let preliminary = state.draft.brief_description?.trim() || "Falla en sensor de puerta.";
  if (lower.includes("sensor")) preliminary = "Falla en sensor de puerta.";
  else if (lower.includes("rodamiento") || lower.includes("vibración")) preliminary = "Desgaste en rodamiento guía superior.";
  else if (lower.includes("fuente") || lower.includes("eléctric") || lower.includes("24v")) preliminary = "Falla eléctrica en alimentación de 24V.";
  else if (lower.includes("solenoide") || lower.includes("torniquete")) preliminary = "Falla en solenoide de destrabe.";

  let workDone = raw
    ? raw
        .replace(/^(hola|buenas tardes|buenos días|reporto)[^.,:]*[.,:]\s*/i, "")
        .trim()
    : "Reemplazar sensor y realizar prueba de funcionamiento.";
  if (workDone.length > 180) workDone = `${workDone.slice(0, 177).trim()}...`;
  if (workDone && !workDone.endsWith(".")) workDone += ".";

  // Detección inteligente de repuesto
  let detectedCode = null;
  if (lower.includes("sp-102") || lower.includes("sensor")) detectedCode = "SP-102";
  else if (lower.includes("skf-6205") || lower.includes("rodamiento")) detectedCode = "SKF-6205";
  else if (lower.includes("m-210") || lower.includes("motor")) detectedCode = "M-210";
  else if (lower.includes("pp-08") || lower.includes("peine")) detectedCode = "PP-08";
  else if (lower.includes("sol-24v") || lower.includes("solenoide")) detectedCode = "SOL-24V";
  else if (lower.includes("fp-24") || lower.includes("fuente")) detectedCode = "FP-24";
  else if (eqType.includes("escalera")) detectedCode = "SKF-6205";
  else if (eqType.includes("torniquete")) detectedCode = "SOL-24V";
  else detectedCode = "SP-102";

  const invMatch = state.inventory.find((i) => i.part_code === detectedCode);
  if (invMatch && !state.draft.parts_used.some((p) => p.part_code === invMatch.part_code)) {
    state.draft.parts_used = [{ part_code: invMatch.part_code, name: invMatch.name, qty: 1 }];
    state.draft.activePartCode = invMatch.part_code;
  }

  let reviewStatus = "En revisión";
  if (lower.includes("falta") || lower.includes("sin stock") || lower.includes("materiales") || lower.includes("pendiente")) {
    reviewStatus = "Pendiente (faltan materiales)";
  } else if (lower.includes("finaliz") || lower.includes("listo y validado")) {
    reviewStatus = "Finalizado";
  }

  state.draft.preliminary_diagnosis = preliminary;
  state.draft.work_done = workDone.charAt(0).toUpperCase() + workDone.slice(1);
  state.draft.review_status = reviewStatus;
}

function goToGeneratedReportScreen() {
  pauseAudio();
  const txt = document.getElementById("audioTranscriptTextarea");
  if (txt && txt.value.trim()) {
    state.draft.audio_transcript = txt.value.trim();
  }
  const desc = document.getElementById("inputDescripcionBreve");
  if (desc) state.draft.brief_description = desc.value.trim();

  analyzeDraftWithAI();

  document.getElementById("editDiagnosticoPreliminar").value = state.draft.preliminary_diagnosis;
  document.getElementById("editTrabajoSugerido").value = state.draft.work_done;
  document.querySelectorAll('input[name="reviewStatus"]').forEach((r) => {
    r.checked = r.value === state.draft.review_status;
  });

  syncDraftToUI();
  navigateToScreen("screen-informe-generado");
}

function renderSelectedPartsUI() {
  const chipsContainer = document.getElementById("selectedPartsChips");
  const qtyEl = document.getElementById("partQtyDisplay");
  const stockHint = document.getElementById("selectedPartStockHint");
  if (!chipsContainer) return;

  if (!state.draft.parts_used.length) {
    chipsContainer.innerHTML = `<span style="font-size:12px; color:var(--text-muted);">Sin piezas seleccionadas (opcional si fue solo ajuste)</span>`;
    if (qtyEl) qtyEl.textContent = "0";
    if (stockHint) stockHint.textContent = "Stock disponible en bodega: —";
    return;
  }

  if (!state.draft.parts_used.some((p) => p.part_code === state.draft.activePartCode)) {
    state.draft.activePartCode = state.draft.parts_used[0].part_code;
  }

  chipsContainer.innerHTML = state.draft.parts_used
    .map((p) => {
      const active = p.part_code === state.draft.activePartCode;
      return `
        <span class="part-chip" style="${active ? "border-color:var(--metro-red); background:#FEF2F2;" : ""}">
          <button type="button" data-select-chip="${escapeHtml(p.part_code)}" style="border:none; background:none; font:inherit; cursor:pointer; color:inherit;">
            ${escapeHtml(p.name)} ×${p.qty}
          </button>
          <button type="button" class="part-chip-remove" data-remove-part="${escapeHtml(p.part_code)}" aria-label="Quitar pieza">✕</button>
        </span>
      `;
    })
    .join("");

  chipsContainer.querySelectorAll("[data-select-chip]").forEach((btn) => {
    btn.addEventListener("click", () => {
      state.draft.activePartCode = btn.dataset.selectChip;
      renderSelectedPartsUI();
    });
  });

  chipsContainer.querySelectorAll("[data-remove-part]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const code = btn.dataset.removePart;
      state.draft.parts_used = state.draft.parts_used.filter((p) => p.part_code !== code);
      renderSelectedPartsUI();
    });
  });

  const activePart = state.draft.parts_used.find((p) => p.part_code === state.draft.activePartCode);
  const invItem = state.inventory.find((i) => i.part_code === activePart?.part_code);
  if (qtyEl) qtyEl.textContent = String(activePart?.qty ?? 1);
  if (stockHint) {
    stockHint.textContent = invItem
      ? `Stock en ${invItem.warehouse}: ${invItem.stock} u. (${invItem.part_code})`
      : "Stock disponible: —";
  }
}

async function saveDraftReport() {
  state.draft.preliminary_diagnosis =
    document.getElementById("editDiagnosticoPreliminar")?.value.trim() || "Falla reportada.";
  state.draft.work_done =
    document.getElementById("editTrabajoSugerido")?.value.trim() || "Inspección y ajuste técnico.";

  const checkedStatus = document.querySelector('input[name="reviewStatus"]:checked');
  state.draft.review_status = checkedStatus?.value || "En revisión";
  state.draft.current_state =
    state.draft.review_status === "Pendiente (faltan materiales)"
      ? "Pendiente por falta de materiales."
      : "Operativo.";

  const shouldSaveOffline = state.draft.saveOffline || !navigator.onLine || !state.user;

  const basePayload = {
    asset_id: state.draft.asset_id,
    station: state.draft.station,
    equipment: state.draft.equipment,
    fault_type: state.draft.fault_type,
    brief_description: state.draft.brief_description,
    audio_transcript: state.draft.audio_transcript || state.draft.work_done,
    preliminary_diagnosis: state.draft.preliminary_diagnosis,
    work_done: state.draft.work_done,
    current_state: state.draft.current_state,
    parts_used: state.draft.parts_used,
    review_status: state.draft.review_status,
    photo_before: state.draft.photo_before,
    photo_after: state.draft.photo_after
  };

  if (shouldSaveOffline) {
    const queued = await enqueueOfflineReport(basePayload);
    // Descuento local optimista en caché de inventario
    for (const part of state.draft.parts_used) {
      const inv = state.inventory.find((i) => i.part_code === part.part_code);
      if (inv) inv.stock = Math.max(0, Number(inv.stock) - Number(part.qty || 1));
    }
    await cacheCollection(STORES.INVENTORY, state.inventory);

    state.lastSubmittedReportId = `offline-${queued.qid}`;
    state.lastSavedOffline = true;
    state.offlineQueue = await getOfflineQueue();
  } else {
    const { data: inserted, error } = await supabase
      .from("metro_reports")
      .insert({
        ...basePayload,
        user_id: state.user.id,
        author_name: state.profile.full_name || state.user.email,
        saved_offline: false
      })
      .select()
      .single();

    if (error) {
      // Respaldo automático offline si falla red durante envío
      const queued = await enqueueOfflineReport(basePayload);
      state.lastSubmittedReportId = `offline-${queued.qid}`;
      state.lastSavedOffline = true;
      state.offlineQueue = await getOfflineQueue();
    } else {
      await applySideEffectsForReport(inserted, state.draft.parts_used);
      state.lastSubmittedReportId = inserted.id;
      state.lastSavedOffline = false;
      await loadOperationalData();
    }
  }

  // Limpiar campos transitorios del borrador
  state.draft.brief_description = "";
  state.draft.audio_transcript = "";
  state.recordSeconds = 0;
  await saveDraftLocal(state.draft).catch(() => {});

  updateSentScreenUI();
  renderAllUI();
  navigateToScreen("screen-reporte-enviado");
}

function updateSentScreenUI() {
  const circle = document.getElementById("sentCheckCircle");
  const title = document.getElementById("sentTitle");
  const sub = document.getElementById("sentSubtitle");
  if (state.lastSavedOffline) {
    circle?.classList.add("offline-mode");
    if (title) title.textContent = "Guardado sin conexión";
    if (sub) {
      sub.textContent =
        "Tu reporte con fotos y piezas quedó respaldado en este teléfono y se enviará automáticamente al recuperar señal.";
    }
  } else {
    circle?.classList.remove("offline-mode");
    if (title) title.textContent = "Reporte enviado";
    if (sub) {
      sub.textContent =
        "El reporte quedó guardado en Supabase, descontó las piezas del inventario y está listo para revisión de Metro.";
    }
  }
}

// ============================================================================
// RENDERIZADO DE REPORTES, DETALLE DE REPORTE Y COMENTARIOS DE METRO
// ============================================================================
function getStatusBadgeClass(status, isOffline) {
  if (isOffline) return "offline";
  if (status === "Finalizado") return "finalized";
  if (status === "Pendiente (faltan materiales)") return "pending";
  return "review";
}

function renderReportsList() {
  const container = document.getElementById("savedReportsContainer");
  if (!container) return;

  const all = getMergedReports();
  const list = all.filter((r) => {
    if (state.reportFilter === "all") return true;
    if (state.reportFilter === "offline") return Boolean(r.isOfflineQueued);
    return r.review_status === state.reportFilter;
  });

  if (!list.length) {
    container.innerHTML = `
      <div class="report-summary-card" style="text-align:center; padding:24px 16px;">
        <div style="font-size:15px; font-weight:700;">No hay reportes en esta categoría</div>
        <div style="font-size:13px; color:var(--text-secondary); margin-top:4px;">
          Crea un nuevo reporte desde Inicio o cambia el filtro superior.
        </div>
      </div>
    `;
    return;
  }

  container.innerHTML = list
    .map((rep) => {
      const badgeClass = getStatusBadgeClass(rep.review_status, rep.isOfflineQueued);
      const badgeLabel = rep.isOfflineQueued
        ? "📡 Pendiente sincronizar"
        : rep.review_status || "En revisión";
      const commentsCount = (state.commentsByReport[rep.id] || []).length;

      return `
        <article class="saved-report-item">
          <div style="display:flex; justify-content:space-between; align-items:center; gap:8px; margin-bottom:8px;">
            <span class="status-badge ${badgeClass}">${escapeHtml(badgeLabel)}</span>
            <span style="font-size:12px; color:var(--text-muted); font-weight:700;">
              N° ${escapeHtml(rep.report_number || "—")} · ${escapeHtml(formatTimeLabel(rep.created_at))}
            </span>
          </div>

          <div style="font-size:15px; font-weight:800; margin-bottom:3px;">${escapeHtml(rep.equipment)}</div>
          <div style="font-size:12.5px; color:var(--text-secondary); margin-bottom:8px;">
            Estación: <strong>${escapeHtml(rep.station)}</strong> · ${escapeHtml(rep.fault_type)}
          </div>

          <div style="font-size:13px; color:var(--text-main); line-height:1.4; margin-bottom:10px;">
            ${escapeHtml(rep.work_done || rep.preliminary_diagnosis || rep.brief_description)}
          </div>

          <div style="display:flex; justify-content:space-between; align-items:center; gap:8px;">
            <span style="font-size:12px; color:var(--text-secondary); font-weight:600;">
              💬 ${commentsCount} comentario(s)
            </span>
            <button type="button" class="btn-metro btn-metro-red btn-open-report-detail" data-report-id="${escapeHtml(rep.id)}" style="width:auto; min-height:36px; padding:0 14px; font-size:13px;">
              Abrir reporte ›
            </button>
          </div>
        </article>
      `;
    })
    .join("");

  container.querySelectorAll(".btn-open-report-detail").forEach((btn) => {
    btn.addEventListener("click", () => {
      state.activeReportId = btn.dataset.reportId;
      state.activeReportTab = "Detalles";
      navigateToScreen("screen-detalle-reporte");
    });
  });
}

function renderReportDetail() {
  const container = document.getElementById("detailReportContainer");
  const titleEl = document.getElementById("detailReportTitle");
  if (!container) return;

  const all = getMergedReports();
  const rep = all.find((r) => r.id === state.activeReportId) || all[0];
  if (!rep) {
    container.innerHTML = `<div class="report-summary-card">Reporte no encontrado.</div>`;
    return;
  }
  state.activeReportId = rep.id;

  if (titleEl) titleEl.textContent = `Reporte N° ${rep.report_number || "4587"}`;
  const comments = state.commentsByReport[rep.id] || [];
  const badgeClass = getStatusBadgeClass(rep.review_status, rep.isOfflineQueued);
  const parts = Array.isArray(rep.parts_used) ? rep.parts_used : [];
  const assetInts = state.interventions.filter((i) => i.asset_id === rep.asset_id);

  let tabContentHtml = "";
  if (state.activeReportTab === "Detalles") {
    tabContentHtml = `
      <div style="font-size:13.5px; line-height:1.45; margin-bottom:10px;">
        <div style="font-weight:800;">Descripción</div>
        <div style="color:var(--text-secondary);">${escapeHtml(rep.preliminary_diagnosis || rep.brief_description)}</div>
      </div>

      <div style="font-size:13.5px; line-height:1.45; margin-bottom:10px;">
        <div style="font-weight:800;">Trabajo realizado</div>
        <div style="color:var(--text-secondary);">${escapeHtml(rep.work_done)}</div>
      </div>

      ${
        parts.length
          ? `<div style="font-size:13px; margin-bottom:10px;">
               <div style="font-weight:800; margin-bottom:4px;">Piezas utilizadas</div>
               <div class="parts-chips-list" style="margin:0;">
                 ${parts.map((p) => `<span class="part-chip">${escapeHtml(p.name || p.part_code)} ×${p.qty || 1}</span>`).join("")}
               </div>
             </div>`
          : ""
      }

      <div class="before-after-grid">
        <div class="ba-card">
          <div class="ba-img-wrap">
            <img src="${escapeHtml(rep.photo_before || DEFAULT_PHOTO_BEFORE)}" alt="Foto Antes" />
            <button type="button" class="ba-expand-btn" data-expand-src="${escapeHtml(rep.photo_before || DEFAULT_PHOTO_BEFORE)}" data-expand-title="Antes — Reporte N° ${escapeHtml(rep.report_number)}">⤢</button>
          </div>
          <div class="ba-caption">Antes</div>
        </div>
        <div class="ba-card">
          <div class="ba-img-wrap">
            <img src="${escapeHtml(rep.photo_after || DEFAULT_PHOTO_AFTER)}" alt="Foto Después" />
            <button type="button" class="ba-expand-btn" data-expand-src="${escapeHtml(rep.photo_after || DEFAULT_PHOTO_AFTER)}" data-expand-title="Después — Reporte N° ${escapeHtml(rep.report_number)}">⤢</button>
          </div>
          <div class="ba-caption">Después</div>
        </div>
      </div>
    `;
  } else if (state.activeReportTab === "Historial") {
    tabContentHtml = assetInts.length
      ? `<div class="timeline-list">
           ${assetInts
             .map(
               (it) => `
             <div class="timeline-item">
               <span class="timeline-dot"></span>
               <div class="timeline-date">${escapeHtml(formatShortDate(it.intervention_date))}</div>
               <div class="timeline-desc">${escapeHtml(it.summary)}</div>
             </div>`
             )
             .join("")}
         </div>`
      : `<div style="font-size:13px; color:var(--text-secondary);">Sin intervenciones previas registradas para este equipo.</div>`;
  } else {
    tabContentHtml = `<div style="font-size:13px; color:var(--text-secondary);">Observaciones directas entre Supervisor de Metro y Contratista:</div>`;
  }

  container.innerHTML = `
    <div class="report-summary-card">
      <div style="display:flex; align-items:center; justify-content:space-between; gap:8px; margin-bottom:10px;">
        <span class="status-badge ${badgeClass}">${escapeHtml(rep.isOfflineQueued ? "📡 Pendiente sincronizar" : rep.review_status)}</span>
        ${
          !rep.isOfflineQueued
            ? `<select id="detailStatusSelect" class="metro-select" style="width:auto; padding:5px 28px 5px 10px; font-size:12px;" aria-label="Cambiar estado de revisión">
                 <option value="En revisión" ${rep.review_status === "En revisión" ? "selected" : ""}>En revisión</option>
                 <option value="Pendiente (faltan materiales)" ${rep.review_status === "Pendiente (faltan materiales)" ? "selected" : ""}>Pendiente (faltan materiales)</option>
                 <option value="Finalizado" ${rep.review_status === "Finalizado" ? "selected" : ""}>Finalizado</option>
               </select>`
            : ""
        }
      </div>

      <div style="font-size:14px; line-height:1.45; margin-bottom:8px;">
        <div><strong>Equipo:</strong> ${escapeHtml(rep.equipment)}</div>
        <div><strong>Estación:</strong> ${escapeHtml(rep.station)}</div>
      </div>

      <div class="underline-tabs" role="tablist">
        <button type="button" class="underline-tab ${state.activeReportTab === "Detalles" ? "active" : ""}" data-det-tab="Detalles">Detalles</button>
        <button type="button" class="underline-tab ${state.activeReportTab === "Historial" ? "active" : ""}" data-det-tab="Historial">Historial</button>
        <button type="button" class="underline-tab ${state.activeReportTab === "Comentarios" ? "active" : ""}" data-det-tab="Comentarios">Comentarios (${comments.length})</button>
      </div>

      ${tabContentHtml}
    </div>

    <div style="font-size:15px; font-weight:800; margin:12px 0 8px;">Comentarios de Metro</div>
    <div id="detailCommentsList">
      ${
        comments.length
          ? comments
              .map(
                (c) => `
              <div class="comment-card">
                <svg class="comment-avatar-oval" viewBox="0 0 120 76" fill="none" aria-hidden="true">
                  <ellipse cx="60" cy="38" rx="55" ry="33" stroke="#B91C1C" stroke-width="6.5" fill="#FFFFFF"/>
                  <polygon points="32,16 44,38 32,60 20,38" fill="#B91C1C"/>
                  <polygon points="60,16 72,38 60,60 48,38" fill="#B91C1C"/>
                  <polygon points="88,16 100,38 88,60 76,38" fill="#B91C1C"/>
                </svg>
                <div style="flex:1;">
                  <div style="font-size:12.5px; font-weight:800; color:var(--text-main);">
                    ${escapeHtml(c.author_name)} <span style="font-weight:500; color:var(--text-muted);">· ${escapeHtml(formatTimeLabel(c.created_at))}</span>
                  </div>
                  <div style="font-size:13.5px; color:var(--text-secondary); margin-top:2px; line-height:1.4;">
                    ${escapeHtml(c.body)}
                  </div>
                </div>
              </div>
            `
              )
              .join("")
          : `<div style="font-size:13px; color:var(--text-muted); margin-bottom:8px;">Aún no hay observaciones en este reporte.</div>`
      }
    </div>

    ${
      !rep.isOfflineQueued
        ? `<form class="comment-composer" id="detailCommentForm">
             <span aria-hidden="true">💬</span>
             <input type="text" id="detailCommentInput" placeholder="Agregar comentario..." autocomplete="off" required />
             <button type="submit" class="comment-send-btn" aria-label="Enviar comentario">➤</button>
           </form>`
        : `<div style="font-size:12px; color:var(--text-muted); margin-top:6px;">Sincroniza este reporte offline para habilitar comentarios en Supabase.</div>`
    }
  `;

  container.querySelectorAll("[data-det-tab]").forEach((tab) => {
    tab.addEventListener("click", () => {
      state.activeReportTab = tab.dataset.detTab;
      renderReportDetail();
    });
  });

  container.querySelectorAll("[data-expand-src]").forEach((btn) => {
    btn.addEventListener("click", () => {
      openLightbox(btn.dataset.expandSrc, btn.dataset.expandTitle);
    });
  });

  const statusSel = document.getElementById("detailStatusSelect");
  if (statusSel) {
    statusSel.addEventListener("change", async () => {
      const nextStatus = statusSel.value;
      if (!navigator.onLine) {
        showToast("📡 Sin conexión: vuelve a intentarlo con señal");
        statusSel.value = rep.review_status;
        return;
      }
      const { error } = await supabase
        .from("metro_reports")
        .update({ review_status: nextStatus, updated_at: new Date().toISOString() })
        .eq("id", rep.id);
      if (error) {
        showToast("⚠️ Solo el autor o un Supervisor Metro puede cambiar el estado");
        statusSel.value = rep.review_status;
        return;
      }
      rep.review_status = nextStatus;
      showToast(`✅ Estado actualizado: ${nextStatus}`);
      renderAllUI();
      renderReportDetail();
    });
  }

  const commentForm = document.getElementById("detailCommentForm");
  if (commentForm) {
    commentForm.addEventListener("submit", async (e) => {
      e.preventDefault();
      const input = document.getElementById("detailCommentInput");
      const text = input?.value.trim();
      if (!text || !state.user) return;
      if (!navigator.onLine) {
        showToast("📡 Necesitas señal para publicar comentarios en Supabase");
        return;
      }

      const payload = {
        report_id: rep.id,
        user_id: state.user.id,
        author_name:
          state.profile.role === "metro"
            ? `Supervisor (${state.profile.full_name.split(" ")[0] || "Metro"})`
            : state.profile.full_name || "Contratista",
        author_role: state.profile.role === "metro" ? "metro" : "contratista",
        body: text
      };

      const { data, error } = await supabase
        .from("metro_report_comments")
        .insert(payload)
        .select()
        .single();

      if (error) {
        showToast("⚠️ No se pudo guardar el comentario");
        return;
      }

      if (!state.commentsByReport[rep.id]) state.commentsByReport[rep.id] = [];
      state.commentsByReport[rep.id].push(data);
      input.value = "";
      renderReportDetail();
      showToast("💬 Comentario publicado");
    });
  }
}

function openLightbox(src, title) {
  const dlg = document.getElementById("dialogLightbox");
  const img = document.getElementById("lightboxImg");
  const ttl = document.getElementById("dialogLightboxTitle");
  if (!dlg || !img) return;
  img.src = src;
  if (ttl) ttl.textContent = title || "Fotografía";
  dlg.showModal();
}

// ============================================================================
// HISTORIAL DE EQUIPOS, EQUIPO A-03, MANUAL TÉCNICO E INVENTARIO
// ============================================================================
function renderAssetsList() {
  const container = document.getElementById("assetsListContainer");
  if (!container) return;
  const query = (document.getElementById("assetSearchInput")?.value || "").trim().toLowerCase();

  const filtered = state.assets.filter((a) => {
    if (!query) return true;
    return `${a.id} ${a.name} ${a.station} ${a.serial_number} ${a.qr_code}`.toLowerCase().includes(query);
  });

  container.innerHTML = filtered
    .map(
      (a) => `
      <div class="saved-report-item">
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:6px;">
          <span class="status-badge ${a.status === "Operativo" ? "finalized" : a.status.includes("Pendiente") ? "pending" : "review"}">
            ${escapeHtml(a.status)}
          </span>
          <span style="font-size:12px; color:var(--text-muted); font-weight:700;">${escapeHtml(a.line)} · ${escapeHtml(a.qr_code)}</span>
        </div>
        <div style="font-size:16px; font-weight:800;">${escapeHtml(a.name)}</div>
        <div style="font-size:13px; color:var(--text-secondary); margin-bottom:10px;">
          Estación: <strong>${escapeHtml(a.station)}</strong> · Vida útil: ${escapeHtml(formatServiceAge(a.installed_at))} · <strong>${a.recurrence_count} fallas</strong>
        </div>
        <div style="display:flex; gap:8px;">
          <button type="button" class="btn-metro btn-metro-white btn-view-asset" data-asset-id="${escapeHtml(a.id)}" style="min-height:38px; font-size:13px;">
            Ver trazabilidad
          </button>
          <button type="button" class="btn-metro btn-metro-red btn-report-asset" data-asset-id="${escapeHtml(a.id)}" style="min-height:38px; font-size:13px;">
            Nuevo reporte
          </button>
        </div>
      </div>
    `
    )
    .join("");

  container.querySelectorAll(".btn-view-asset").forEach((btn) => {
    btn.addEventListener("click", () => {
      state.activeAssetId = btn.dataset.assetId;
      state.activeAssetTab = "Historial";
      state.showAllAssetHistory = false;
      navigateToScreen("screen-equipo-detalle");
    });
  });

  container.querySelectorAll(".btn-report-asset").forEach((btn) => {
    btn.addEventListener("click", () => {
      const asset = state.assets.find((a) => a.id === btn.dataset.assetId);
      if (asset) applyIdentifiedAsset(asset);
      navigateToScreen("screen-nuevo-reporte");
    });
  });
}

function renderAssetDetail() {
  const body = document.getElementById("assetDetailBody");
  const topTitle = document.getElementById("assetDetailTopTitle");
  const segHist = document.getElementById("segAssetHistorial");
  const segMan = document.getElementById("segAssetManual");
  if (!body) return;

  const asset = state.assets.find((a) => a.id === state.activeAssetId) || state.assets[0];
  if (!asset) return;

  if (topTitle) topTitle.textContent = `Equipo ${asset.id}`;
  segHist?.classList.toggle("active", state.activeAssetTab === "Historial");
  segMan?.classList.toggle("active", state.activeAssetTab === "Manual");

  if (state.activeAssetTab === "Manual") {
    const guides = TECHNICAL_MANUAL_GUIDES.filter(
      (g) => g.equipment_type === asset.equipment_type || g.equipment_type === "Protocolo Seguridad"
    );
    body.innerHTML = renderManualCardsHtml(guides) +
      `<button type="button" id="btnAssetCreateReportFromManual" class="btn-metro btn-metro-red" style="margin-top:8px;">
         Crear reporte para ${escapeHtml(asset.name)}
       </button>`;
    document.getElementById("btnAssetCreateReportFromManual")?.addEventListener("click", () => {
      applyIdentifiedAsset(asset);
      navigateToScreen("screen-nuevo-reporte");
    });
    return;
  }

  const assetInts = state.interventions.filter((i) => i.asset_id === asset.id);
  const shownInts = state.showAllAssetHistory ? assetInts : assetInts.slice(0, 3);

  body.innerHTML = `
    <div class="report-summary-card">
      <div class="asset-kpi-row">
        <div class="asset-kpi-icon">🛗</div>
        <div>
          <div style="font-size:17px; font-weight:800;">${escapeHtml(asset.name)}</div>
          <div style="font-size:13px; color:var(--text-secondary);">Estación: ${escapeHtml(asset.station)} · Serie ${escapeHtml(asset.serial_number)}</div>
        </div>
      </div>
      <div class="asset-kpi-row">
        <div class="asset-kpi-icon">📅</div>
        <div>
          <div style="font-size:14.5px; font-weight:800;">Vida útil</div>
          <div style="font-size:13.5px; color:var(--text-secondary);">${escapeHtml(formatServiceAge(asset.installed_at))}</div>
        </div>
      </div>
      <div class="asset-kpi-row">
        <div class="asset-kpi-icon">⚠️</div>
        <div>
          <div style="font-size:14.5px; font-weight:800;">Reincidencias</div>
          <div style="font-size:13.5px; color:var(--metro-red); font-weight:700;">${asset.recurrence_count} fallas registradas</div>
        </div>
      </div>
    </div>

    <div class="report-summary-card">
      <div style="font-size:15.5px; font-weight:800; margin-bottom:4px;">Últimas intervenciones</div>
      ${
        shownInts.length
          ? `<div class="timeline-list">
               ${shownInts
                 .map(
                   (it) => `
                 <div class="timeline-item">
                   <span class="timeline-dot"></span>
                   <div class="timeline-date">${escapeHtml(formatShortDate(it.intervention_date))}</div>
                   <div class="timeline-desc">${escapeHtml(it.summary)}</div>
                 </div>`
                 )
                 .join("")}
             </div>`
          : `<div style="font-size:13px; color:var(--text-muted); padding:8px 0;">Sin intervenciones registradas.</div>`
      }
      ${
        assetInts.length > 3
          ? `<button type="button" id="btnToggleMoreAssetHistory" class="btn-metro btn-metro-white" style="margin-top:12px; min-height:40px; font-size:13.5px;">
               ${state.showAllAssetHistory ? "Ver menos" : `Ver más historial (${assetInts.length})`}
             </button>`
          : ""
      }
    </div>

    <button type="button" id="btnCreateReportFromAssetDetail" class="btn-metro btn-metro-red">
      Crear reporte para ${escapeHtml(asset.name)}
    </button>
  `;

  document.getElementById("btnToggleMoreAssetHistory")?.addEventListener("click", () => {
    state.showAllAssetHistory = !state.showAllAssetHistory;
    renderAssetDetail();
  });

  document.getElementById("btnCreateReportFromAssetDetail")?.addEventListener("click", () => {
    applyIdentifiedAsset(asset);
    navigateToScreen("screen-nuevo-reporte");
  });
}

function renderManualCardsHtml(guides) {
  if (!guides.length) {
    return `<div class="report-summary-card">No se encontraron guías para tu búsqueda.</div>`;
  }
  return guides
    .map(
      (g) => `
      <details class="manual-details-card">
        <summary>
          <span>${escapeHtml(g.title)}</span>
          <span class="count-pill">${escapeHtml(g.part_code || g.equipment_type)}</span>
        </summary>
        <div style="font-size:12.5px; color:var(--text-secondary); margin-top:8px;">
          <strong>Síntoma:</strong> ${escapeHtml(g.symptom)}
        </div>
        <div style="font-size:12.5px; color:var(--text-secondary); margin-top:4px;">
          <strong>Causa probable:</strong> ${escapeHtml(g.cause)}
        </div>
        <ol class="manual-steps-ol">
          ${g.steps.map((s) => `<li>${escapeHtml(s)}</li>`).join("")}
        </ol>
        <div class="manual-safety-note">⚠️ <strong>Seguridad:</strong> ${escapeHtml(g.safety_note)}</div>
      </details>
    `
    )
    .join("");
}

function renderManualList() {
  const container = document.getElementById("manualListContainer");
  if (!container) return;
  const q = (document.getElementById("manualSearchInput")?.value || "").trim().toLowerCase();

  const list = TECHNICAL_MANUAL_GUIDES.filter((g) => {
    const catOk = state.manualCategory === "all" || g.equipment_type === state.manualCategory;
    const textOk =
      !q || `${g.title} ${g.symptom} ${g.cause} ${g.part_code} ${g.equipment_type}`.toLowerCase().includes(q);
    return catOk && textOk;
  });

  container.innerHTML = renderManualCardsHtml(list);
}

function renderInventoryList() {
  const container = document.getElementById("inventoryListContainer");
  if (!container) return;
  const q = (document.getElementById("inventorySearchInput")?.value || "").trim().toLowerCase();
  const isMetro = state.profile.role === "metro";

  const list = state.inventory.filter((item) => {
    const isLow = Number(item.stock) <= Number(item.min_stock);
    const filterOk = state.inventoryFilter === "all" || isLow;
    const queryOk = !q || `${item.part_code} ${item.name} ${item.category} ${item.warehouse}`.toLowerCase().includes(q);
    return filterOk && queryOk;
  });

  if (!list.length) {
    container.innerHTML = `<div class="report-summary-card">No hay repuestos que coincidan con el filtro.</div>`;
    return;
  }

  container.innerHTML = list
    .map((item) => {
      const isLow = Number(item.stock) <= Number(item.min_stock);
      const pct = Math.min(100, Math.round((Number(item.stock) / Math.max(1, Number(item.min_stock) * 3)) * 100));
      return `
        <div class="saved-report-item">
          <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:5px;">
            <span class="status-badge ${isLow ? "pending" : "review"}">
              ${isLow ? "⚠️ Stock crítico" : "✓ Stock disponible"}
            </span>
            <span style="font-size:12px; color:var(--text-muted); font-weight:700;">${escapeHtml(item.part_code)}</span>
          </div>
          <div style="font-size:15px; font-weight:800;">${escapeHtml(item.name)}</div>
          <div style="font-size:12.5px; color:var(--text-secondary); margin-top:2px;">
            ${escapeHtml(item.warehouse)} · Categoría: ${escapeHtml(item.category)}
          </div>
          <div style="display:flex; justify-content:space-between; align-items:center; margin-top:8px;">
            <span style="font-size:14px; font-weight:800;">${item.stock} unidades <span style="font-weight:500; color:var(--text-muted);">(mín. ${item.min_stock})</span></span>
            ${
              isMetro
                ? `<button type="button" class="topbar-mini-btn btn-restock-part" data-part-code="${escapeHtml(item.part_code)}">+5 Reponer</button>`
                : ""
            }
          </div>
          <div class="stock-bar-bg">
            <div class="stock-bar-fill ${isLow ? "low" : ""}" style="width:${pct}%"></div>
          </div>
        </div>
      `;
    })
    .join("");

  container.querySelectorAll(".btn-restock-part").forEach((btn) => {
    btn.addEventListener("click", async () => {
      if (!navigator.onLine || !state.user) {
        showToast("📡 Necesitas conexión para reponer bodega en Supabase");
        return;
      }
      const code = btn.dataset.partCode;
      const item = state.inventory.find((i) => i.part_code === code);
      if (!item) return;
      const nextStock = Number(item.stock) + 5;
      const { error } = await supabase
        .from("metro_inventory")
        .update({ stock: nextStock, updated_by: state.user.id, updated_at: new Date().toISOString() })
        .eq("part_code", code);
      if (error) {
        showToast("⚠️ Error al actualizar stock");
        return;
      }
      item.stock = nextStock;
      await cacheCollection(STORES.INVENTORY, state.inventory);
      renderInventoryList();
      populateFormSelects();
      updateNetworkAndCountersUI();
      showToast(`📦 Stock de ${code} actualizado a ${nextStock} u.`);
    });
  });
}

// ============================================================================
// AVISOS Y CHAT CONECTADO A SUPABASE + CONTEXTO REAL
// ============================================================================
function renderAvisosList() {
  const container = document.getElementById("avisosListContainer");
  if (!container) return;
  container.innerHTML = state.avisos
    .map(
      (av) => `
      <div class="saved-report-item">
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:6px;">
          <span class="count-pill">${escapeHtml(av.priority)}</span>
          <span style="font-size:12px; color:var(--text-muted); font-weight:700;">Est. ${escapeHtml(av.station)}</span>
        </div>
        <div style="font-size:15px; font-weight:800; margin-bottom:5px;">${escapeHtml(av.title)}</div>
        <div style="font-size:13px; color:var(--text-secondary); line-height:1.45; margin-bottom:10px;">
          ${escapeHtml(av.detail)}
        </div>
        <button type="button" class="btn-metro btn-metro-red btn-start-aviso" data-asset-id="${escapeHtml(av.asset_id)}" data-fault="${escapeHtml(av.fault_type)}" style="min-height:40px; font-size:13.5px;">
          Crear reporte para este aviso
        </button>
      </div>
    `
    )
    .join("");

  container.querySelectorAll(".btn-start-aviso").forEach((btn) => {
    btn.addEventListener("click", () => {
      const asset = state.assets.find((a) => a.id === btn.dataset.assetId);
      if (asset) applyIdentifiedAsset(asset);
      const selFault = document.getElementById("inputTipoAveria");
      if (selFault && btn.dataset.fault) {
        selFault.value = btn.dataset.fault;
        state.draft.fault_type = btn.dataset.fault;
      }
      navigateToScreen("screen-nuevo-reporte");
    });
  });
}

function buildSmartChatReply(question) {
  const q = question.toLowerCase();
  if (q.includes("stock") || q.includes("sp-102") || q.includes("fp-24") || q.includes("bodega") || q.includes("repuesto")) {
    const low = state.inventory.filter((i) => Number(i.stock) <= Number(i.min_stock));
    const sp102 = state.inventory.find((i) => i.part_code === "SP-102");
    const fp24 = state.inventory.find((i) => i.part_code === "FP-24");
    return (
      `📦 **Inventario en tiempo real (Supabase):**\n` +
      `• **${sp102?.name || "SP-102"}:** ${sp102?.stock ?? "—"} u. (${sp102?.warehouse || "Bodega Central"})\n` +
      `• **${fp24?.name || "FP-24"}:** ${fp24?.stock ?? "—"} u. (${fp24?.stock <= fp24?.min_stock ? "⚠️ stock crítico" : "disponible"})\n` +
      `• **Repuestos en alerta baja:** ${low.map((i) => `${i.part_code} (${i.stock} u.)`).join(", ") || "Ninguno"}`
    );
  }
  if (q.includes("audio") || q.includes("mencionar") || q.includes("datos")) {
    return (
      `🎙️ **Para un informe técnico completo en Metro-ON, menciona:**\n` +
      `1. **Pieza fallada y causa raíz** (ej. *sensor óptico SP-102 quemado*).\n` +
      `2. **Acción y repuesto utilizado** (descontará automáticamente de inventario).\n` +
      `3. **Prueba final realizada** y si el equipo quedó **Finalizado** o **Pendiente (faltan materiales)**.`
    );
  }
  if (q.includes("filtración") || q.includes("humedad") || q.includes("foso")) {
    return (
      `💧 **Protocolo de Seguridad por Filtración en Foso:**\n` +
      `1. Desenergiza y aplica bloqueo LOTO de inmediato.\n` +
      `2. Sube foto en **Antes** mostrando la filtración.\n` +
      `3. Marca estado **Pendiente (faltan materiales)** y solicita apoyo de Obras Civiles antes de reenergizar.`
    );
  }
  if (q.includes("reportes") || q.includes("estado") || q.includes("resúmeme")) {
    const all = getMergedReports().slice(0, 5);
    const lines = all
      .map((r) => `• **N° ${r.report_number} (${r.equipment} · ${r.station}):** ${r.isOfflineQueued ? "Pendiente sincronizar" : r.review_status}`)
      .join("\n");
    return `📄 **Estado actual de reportes:**\n\n${lines}`;
  }
  const asset = getSelectedAsset();
  return (
    `🚇 **Soporte Metro-ON:**\n` +
    `Recibimos tu consulta sobre **${asset?.name || state.draft.equipment}** en **Estación ${state.draft.station}**.\n` +
    `Puedes consultar las guías del **Manual técnico** sin perder tu borrador y guardar en modo **Sin conexión** si estás bajo tierra sin señal.`
  );
}

function renderChatMessages() {
  const feed = document.getElementById("chatMessagesFeed");
  if (!feed) return;
  feed.innerHTML = state.chatMessages
    .map(
      (m) => `
      <div class="chat-msg ${m.sender === "user" ? "user" : "ai"}">
        ${m.sender === "ai" ? `<div class="chat-msg-sender">${escapeHtml(m.author || "🚇 Metro de Santiago")}</div>` : ""}
        <div>${formatSimpleMarkdown(m.body || m.text || "")}</div>
      </div>
    `
    )
    .join("");
  feed.scrollTop = feed.scrollHeight;
}

async function sendChatMessage(question) {
  const text = (question || "").trim();
  if (!text) return;

  const userMsg = { sender: "user", author: state.profile.full_name || "Técnico", body: text };
  const replyText = buildSmartChatReply(text);
  const aiMsg = { sender: "ai", author: "🚇 Metro de Santiago • Soporte IA", body: replyText };

  state.chatMessages.push(userMsg, aiMsg);
  renderChatMessages();

  if (navigator.onLine && state.user) {
    await supabase.from("metro_chat_messages").insert([
      { user_id: state.user.id, sender: "user", author: userMsg.author, body: userMsg.body },
      { user_id: state.user.id, sender: "ai", author: aiMsg.author, body: aiMsg.body }
    ]);
  }
}

// ============================================================================
// PERFIL Y AUTENTICACIÓN SUPABASE
// ============================================================================
function renderProfileScreen() {
  const nameEl = document.getElementById("profileFullName");
  const emailEl = document.getElementById("profileEmail");
  const compEl = document.getElementById("profileCompany");
  const roleBadge = document.getElementById("profileRoleBadge");
  const qPill = document.getElementById("profileQueueCountPill");
  const syncDesc = document.getElementById("profileSyncStateDesc");
  const btnC = document.getElementById("btnSelectRoleContratista");
  const btnM = document.getElementById("btnSelectRoleMetro");

  if (nameEl) nameEl.textContent = state.profile.full_name || "Usuario Metro-ON";
  if (emailEl) emailEl.textContent = state.user?.email || state.profile.email || "";
  if (compEl) compEl.textContent = state.profile.company || "Contratista Externo";
  const isMetro = state.profile.role === "metro";
  if (roleBadge) roleBadge.textContent = isMetro ? "Supervisor Metro (ITC)" : "Contratista";

  if (btnC && btnM) {
    btnC.className = isMetro ? "btn-metro btn-metro-white" : "btn-metro btn-metro-red";
    btnM.className = isMetro ? "btn-metro btn-metro-red" : "btn-metro btn-metro-white";
  }

  if (qPill) qPill.textContent = `${state.offlineQueue.length} pendientes`;
  if (syncDesc) {
    syncDesc.textContent = navigator.onLine
      ? "En línea con Supabase. Tienes respaldo automático en IndexedDB para trabajar en túneles y andenes."
      : "Sin conexión a internet. Tus reportes se almacenan localmente en IndexedDB y subirán al volver a superficie.";
  }
}

async function updateProfileRole(nextRole) {
  state.profile.role = nextRole;
  updateNetworkAndCountersUI();
  renderProfileScreen();
  renderInventoryList();
  await setKV("cached_profile", state.profile).catch(() => {});

  if (navigator.onLine && state.user) {
    await supabase
      .from("metro_profiles")
      .update({ role: nextRole, updated_at: new Date().toISOString() })
      .eq("id", state.user.id);
  }
  showToast(nextRole === "metro" ? "🚇 Rol Supervisor Metro activo" : "👷 Rol Contratista activo");
}

function showAuthFeedback(msg, kind = "error") {
  const box = document.getElementById("authFeedbackBox");
  if (!box) return;
  if (!msg) {
    box.className = "auth-feedback-box";
    box.textContent = "";
    return;
  }
  box.className = `auth-feedback-box ${kind}`;
  box.textContent = msg;
}

function setupAuthForms() {
  const tabIn = document.getElementById("tabBtnSignIn");
  const tabUp = document.getElementById("tabBtnSignUp");
  const formIn = document.getElementById("formSignIn");
  const formUp = document.getElementById("formSignUp");

  const switchAuthMode = (mode) => {
    const isIn = mode === "in";
    tabIn?.classList.toggle("active", isIn);
    tabUp?.classList.toggle("active", !isIn);
    tabIn?.setAttribute("aria-selected", String(isIn));
    tabUp?.setAttribute("aria-selected", String(!isIn));
    if (formIn) formIn.hidden = !isIn;
    if (formUp) formUp.hidden = isIn;
    showAuthFeedback("");
  };

  tabIn?.addEventListener("click", () => switchAuthMode("in"));
  tabUp?.addEventListener("click", () => switchAuthMode("up"));

  document.querySelectorAll("[data-toggle-pass]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const target = document.getElementById(btn.dataset.togglePass);
      if (!target) return;
      const show = target.type === "password";
      target.type = show ? "text" : "password";
      btn.textContent = show ? "Ocultar" : "Mostrar";
      btn.setAttribute("aria-pressed", String(show));
    });
  });

  formIn?.addEventListener("submit", async (e) => {
    e.preventDefault();
    showAuthFeedback("");
    const email = document.getElementById("signin-email")?.value.trim();
    const password = document.getElementById("signin-password")?.value || "";
    const submitBtn = document.getElementById("btnSignInSubmit");
    if (!email || !password) return;

    if (submitBtn) {
      submitBtn.disabled = true;
      submitBtn.textContent = "Ingresando...";
    }

    const { error } = await supabase.auth.signInWithPassword({ email, password });

    if (submitBtn) {
      submitBtn.disabled = false;
      submitBtn.textContent = "Iniciar sesión";
    }

    if (error) {
      showAuthFeedback(
        error.message.includes("Email not confirmed")
          ? "Tu correo aún no está confirmado. Revisa tu bandeja de entrada y abre el enlace de confirmación."
          : `No se pudo iniciar sesión: ${error.message}`,
        "error"
      );
    }
  });

  formUp?.addEventListener("submit", async (e) => {
    e.preventDefault();
    showAuthFeedback("");
    const fullName = document.getElementById("signup-name")?.value.trim();
    const email = document.getElementById("signup-email")?.value.trim();
    const role = document.getElementById("signup-role")?.value || "contratista";
    const company = document.getElementById("signup-company")?.value.trim() || "Contratista Externo";
    const password = document.getElementById("signup-password")?.value || "";
    const submitBtn = document.getElementById("btnSignUpSubmit");

    if (!fullName || !email || !password) return;

    if (submitBtn) {
      submitBtn.disabled = true;
      submitBtn.textContent = "Creando cuenta...";
    }

    const redirectTo = `${window.location.origin}${window.location.pathname}`;
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        emailRedirectTo: redirectTo,
        data: {
          full_name: fullName,
          role,
          company
        }
      }
    });

    if (submitBtn) {
      submitBtn.disabled = false;
      submitBtn.textContent = "Crear cuenta";
    }

    if (error) {
      showAuthFeedback(`Error al crear cuenta: ${error.message}`, "error");
      return;
    }

    if (data?.session) {
      showToast("✅ Cuenta creada e iniciada");
    } else {
      showAuthFeedback(
        `✅ Cuenta creada para ${email}. Revisa tu correo electrónico para confirmar tu cuenta y luego inicia sesión.`,
        "success"
      );
      switchAuthMode("in");
      const signInEmail = document.getElementById("signin-email");
      if (signInEmail) signInEmail.value = email;
    }
  });

  document.getElementById("btnForgotPassword")?.addEventListener("click", async () => {
    const email = document.getElementById("signin-email")?.value.trim();
    if (!email) {
      showAuthFeedback("Escribe primero tu correo arriba para enviarte el enlace de recuperación.", "error");
      return;
    }
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}${window.location.pathname}`
    });
    if (error) {
      showAuthFeedback(`No se pudo enviar el correo: ${error.message}`, "error");
    } else {
      showAuthFeedback(`📧 Enviamos un enlace de recuperación a ${email}.`, "success");
    }
  });
}

// ============================================================================
// REGISTRO PWA Y EVENTOS GENERALES
// ============================================================================
function registerPWA() {
  if ("serviceWorker" in navigator && (location.protocol === "https:" || location.protocol === "http:")) {
    window.addEventListener("load", () => {
      navigator.serviceWorker.register("./sw.js").catch(() => {});
    });
  }

  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();
    state.deferredInstallPrompt = e;
    const btn = document.getElementById("btnInstallPwa");
    if (btn) btn.hidden = false;
  });
}

function attachAppEventListeners() {
  // Navegación Inicio (6 botones + Avisos + cambio rol)
  document.getElementById("btnHomeNuevoReporte")?.addEventListener("click", () => navigateToScreen("screen-nuevo-reporte"));
  document.getElementById("btnHomeMisReportes")?.addEventListener("click", () => navigateToScreen("screen-mis-reportes"));
  document.getElementById("btnHomeHistorial")?.addEventListener("click", () => navigateToScreen("screen-historial-equipos"));
  document.getElementById("btnHomeManual")?.addEventListener("click", () => navigateToScreen("screen-manual-tecnico"));
  document.getElementById("btnHomeInventario")?.addEventListener("click", () => navigateToScreen("screen-inventario"));
  document.getElementById("btnHomeChatMetro")?.addEventListener("click", () => navigateToScreen("screen-chat"));
  document.getElementById("btnHomeAvisos")?.addEventListener("click", () => navigateToScreen("screen-avisos"));

  document.getElementById("btnToggleRoleHome")?.addEventListener("click", () => {
    updateProfileRole(state.profile.role === "contratista" ? "metro" : "contratista");
  });

  // Tabbar inferior (5 pestañas)
  document.querySelectorAll(".bottom-tabbar .tabbar-item").forEach((tab) => {
    tab.addEventListener("click", () => {
      const target = tab.dataset.nav;
      if (target) navigateToScreen(target);
    });
  });

  // Nuevo reporte
  document.getElementById("btnBackFromNuevoReporte")?.addEventListener("click", () => navigateToScreen("screen-inicio"));
  document.getElementById("btnScanQrCode")?.addEventListener("click", openQrScannerDialog);
  document.getElementById("btnPhotoSerialNumber")?.addEventListener("click", openSerialCaptureDialog);

  document.getElementById("btnToggleManualAssetSelect")?.addEventListener("click", () => {
    const panel = document.getElementById("manualAssetSelectPanel");
    if (panel) panel.hidden = !panel.hidden;
  });

  document.getElementById("btnViewDraftAssetHistory")?.addEventListener("click", () => {
    state.activeAssetId = state.draft.asset_id;
    state.activeAssetTab = "Historial";
    navigateToScreen("screen-equipo-detalle");
  });

  document.getElementById("inputAssetId")?.addEventListener("change", (e) => {
    const asset = state.assets.find((a) => a.id === e.target.value);
    if (asset) applyIdentifiedAsset(asset);
  });

  document.getElementById("inputEstacion")?.addEventListener("change", (e) => {
    state.draft.station = e.target.value;
    syncDraftToUI();
  });

  document.getElementById("inputTipoAveria")?.addEventListener("change", (e) => {
    state.draft.fault_type = e.target.value;
  });

  document.getElementById("inputDescripcionBreve")?.addEventListener("input", (e) => {
    state.draft.brief_description = e.target.value;
  });

  document.getElementById("toggleSaveOffline")?.addEventListener("change", (e) => {
    state.draft.saveOffline = e.target.checked;
    showToast(e.target.checked ? "📡 Guardado sin conexión activado" : "☁️ Envío en línea activado");
  });

  document.getElementById("btnGoToGrabarAudio")?.addEventListener("click", () => navigateToScreen("screen-grabar-audio"));
  document.getElementById("btnSiguienteGenerarIA")?.addEventListener("click", goToGeneratedReportScreen);

  // Manual rápido modal dentro de Nuevo reporte
  document.getElementById("btnOpenQuickManual")?.addEventListener("click", () => {
    const dlg = document.getElementById("dialogManualQuick");
    const body = document.getElementById("dialogManualQuickBody");
    const asset = getSelectedAsset();
    if (!dlg || !body) return;
    const guides = TECHNICAL_MANUAL_GUIDES.filter(
      (g) => !asset || g.equipment_type === asset.equipment_type || g.equipment_type === "Protocolo Seguridad"
    );
    body.innerHTML = renderManualCardsHtml(guides);
    dlg.showModal();
  });

  // Fotos modal
  document.getElementById("btnOpenPhotosModal")?.addEventListener("click", () => {
    syncDraftToUI();
    document.getElementById("dialogPhotos")?.showModal();
  });
  document.getElementById("btnConfirmPhotosModal")?.addEventListener("click", () => {
    document.getElementById("dialogPhotos")?.close();
    showToast("🖼️ Fotografías confirmadas");
  });
  document.getElementById("btnRegenerateDemoPhotos")?.addEventListener("click", () => {
    state.draft.photo_before = DEFAULT_PHOTO_BEFORE;
    state.draft.photo_after = DEFAULT_PHOTO_AFTER;
    syncDraftToUI();
    showToast("🔄 Fotos del entregable cargadas");
  });
  document.getElementById("fileInputBefore")?.addEventListener("change", async (e) => {
    const f = e.target.files?.[0];
    if (!f) return;
    state.draft.photo_before = await compressUploadedPhoto(f);
    syncDraftToUI();
    showToast("📸 Foto Antes actualizada");
  });
  document.getElementById("fileInputAfter")?.addEventListener("change", async (e) => {
    const f = e.target.files?.[0];
    if (!f) return;
    state.draft.photo_after = await compressUploadedPhoto(f);
    syncDraftToUI();
    showToast("📸 Foto Después actualizada");
  });

  // Captura N° Serie
  document.getElementById("fileInputSerialPlate")?.addEventListener("change", async (e) => {
    const f = e.target.files?.[0];
    if (!f) return;
    const fname = f.name.toUpperCase();
    const matched =
      state.assets.find((a) => fname.includes(a.id.toUpperCase()) || fname.includes(a.serial_number.toUpperCase())) ||
      state.assets[0];
    if (matched) applyIdentifiedAsset(matched);
    document.getElementById("dialogSerialCapture")?.close();
  });

  document.getElementById("btnMatchSerialCode")?.addEventListener("click", () => {
    const val = (document.getElementById("inputManualSerial")?.value || "").trim().toUpperCase();
    if (!val) return;
    const matched = state.assets.find(
      (a) =>
        a.serial_number.toUpperCase().includes(val) ||
        a.qr_code.toUpperCase().includes(val) ||
        a.id.toUpperCase() === val
    );
    if (matched) {
      applyIdentifiedAsset(matched);
      document.getElementById("dialogSerialCapture")?.close();
    } else {
      showToast("⚠️ N° de serie no encontrado en maestro");
    }
  });

  // Audio screen
  document.getElementById("btnBackFromAudio")?.addEventListener("click", () => {
    pauseAudio();
    navigateToScreen("screen-nuevo-reporte");
  });
  document.getElementById("btnBigMicCircle")?.addEventListener("click", startOrPauseAudio);
  document.getElementById("btnAudioTogglePause")?.addEventListener("click", startOrPauseAudio);
  document.getElementById("btnAudioCancel")?.addEventListener("click", resetAudio);
  document.getElementById("btnLoadSampleVoice")?.addEventListener("click", loadSampleVoice);
  document.getElementById("btnAudioConfirm")?.addEventListener("click", goToGeneratedReportScreen);

  // Informe generado (IA) editable + piezas + estado
  document.getElementById("btnBackFromInforme")?.addEventListener("click", () => navigateToScreen("screen-nuevo-reporte"));
  document.getElementById("btnCancelarInforme")?.addEventListener("click", () => navigateToScreen("screen-nuevo-reporte"));
  document.getElementById("btnGuardarCambiosInforme")?.addEventListener("click", saveDraftReport);

  document.getElementById("selectPartToAdd")?.addEventListener("change", (e) => {
    const code = e.target.value;
    if (!code) return;
    const item = state.inventory.find((i) => i.part_code === code);
    if (item) {
      const existing = state.draft.parts_used.find((p) => p.part_code === code);
      if (existing) existing.qty += 1;
      else state.draft.parts_used.push({ part_code: item.part_code, name: item.name, qty: 1 });
      state.draft.activePartCode = code;
      renderSelectedPartsUI();
    }
    e.target.value = "";
  });

  document.getElementById("btnPartQtyMinus")?.addEventListener("click", () => {
    const active = state.draft.parts_used.find((p) => p.part_code === state.draft.activePartCode);
    if (!active) return;
    if (active.qty > 1) active.qty -= 1;
    renderSelectedPartsUI();
  });

  document.getElementById("btnPartQtyPlus")?.addEventListener("click", () => {
    const active = state.draft.parts_used.find((p) => p.part_code === state.draft.activePartCode);
    if (!active) return;
    active.qty += 1;
    renderSelectedPartsUI();
  });

  document.getElementById("btnPreviewExpandBefore")?.addEventListener("click", () => {
    openLightbox(state.draft.photo_before, "Antes — Borrador");
  });
  document.getElementById("btnPreviewExpandAfter")?.addEventListener("click", () => {
    openLightbox(state.draft.photo_after, "Después — Borrador");
  });

  // Reporte enviado
  document.getElementById("btnSentVerReporte")?.addEventListener("click", () => {
    state.activeReportId = state.lastSubmittedReportId;
    state.activeReportTab = "Detalles";
    navigateToScreen("screen-detalle-reporte");
  });
  document.getElementById("btnSentIrAlInicio")?.addEventListener("click", () => navigateToScreen("screen-inicio"));
  document.getElementById("btnSentIrAlChat")?.addEventListener("click", () => navigateToScreen("screen-chat"));

  // Mis reportes & Detalle
  document.getElementById("btnBackFromMisReportes")?.addEventListener("click", () => navigateToScreen("screen-inicio"));
  document.getElementById("btnNewFromMisReportes")?.addEventListener("click", () => navigateToScreen("screen-nuevo-reporte"));
  document.querySelectorAll("[data-rep-filter]").forEach((pill) => {
    pill.addEventListener("click", () => {
      state.reportFilter = pill.dataset.repFilter || "all";
      document.querySelectorAll("[data-rep-filter]").forEach((p) => p.classList.toggle("active", p === pill));
      renderReportsList();
    });
  });

  document.getElementById("btnBackFromDetalleReporte")?.addEventListener("click", () => navigateToScreen("screen-mis-reportes"));
  document.getElementById("btnDetailOpenAsset")?.addEventListener("click", () => {
    const all = getMergedReports();
    const rep = all.find((r) => r.id === state.activeReportId);
    if (rep?.asset_id) {
      state.activeAssetId = rep.asset_id;
      state.activeAssetTab = "Historial";
      navigateToScreen("screen-equipo-detalle");
    }
  });

  // Historial de equipos & Detalle equipo
  document.getElementById("btnBackFromHistorial")?.addEventListener("click", () => navigateToScreen("screen-inicio"));
  document.getElementById("btnQuickScanFromHistory")?.addEventListener("click", openQrScannerDialog);
  document.getElementById("assetSearchInput")?.addEventListener("input", renderAssetsList);

  document.getElementById("btnBackFromEquipoDetalle")?.addEventListener("click", () => navigateToScreen("screen-historial-equipos"));
  document.getElementById("segAssetHistorial")?.addEventListener("click", () => {
    state.activeAssetTab = "Historial";
    renderAssetDetail();
  });
  document.getElementById("segAssetManual")?.addEventListener("click", () => {
    state.activeAssetTab = "Manual";
    renderAssetDetail();
  });

  // Manual técnico
  document.getElementById("btnBackFromManual")?.addEventListener("click", () => navigateToScreen("screen-inicio"));
  document.getElementById("manualSearchInput")?.addEventListener("input", renderManualList);
  document.querySelectorAll("[data-manual-cat]").forEach((pill) => {
    pill.addEventListener("click", () => {
      state.manualCategory = pill.dataset.manualCat || "all";
      document.querySelectorAll("[data-manual-cat]").forEach((p) => p.classList.toggle("active", p === pill));
      renderManualList();
    });
  });

  // Inventario
  document.getElementById("btnBackFromInventario")?.addEventListener("click", () => navigateToScreen("screen-inicio"));
  document.getElementById("inventorySearchInput")?.addEventListener("input", renderInventoryList);
  document.querySelectorAll("[data-inv-filter]").forEach((pill) => {
    pill.addEventListener("click", () => {
      state.inventoryFilter = pill.dataset.invFilter || "all";
      document.querySelectorAll("[data-inv-filter]").forEach((p) => p.classList.toggle("active", p === pill));
      renderInventoryList();
    });
  });

  // Chat
  document.getElementById("btnBackFromChat")?.addEventListener("click", () => navigateToScreen("screen-inicio"));
  document.getElementById("btnResetChat")?.addEventListener("click", async () => {
    state.chatMessages = [getDefaultWelcomeChatMessage()];
    renderChatMessages();
    if (navigator.onLine && state.user) {
      await supabase.from("metro_chat_messages").delete().eq("user_id", state.user.id);
    }
    showToast("🔄 Chat reiniciado");
  });
  document.querySelectorAll("#presetChipsList .preset-q-chip").forEach((chip) => {
    chip.addEventListener("click", () => {
      if (chip.dataset.q) sendChatMessage(chip.dataset.q);
    });
  });
  document.getElementById("chatForm")?.addEventListener("submit", (e) => {
    e.preventDefault();
    const inp = document.getElementById("chatInputField");
    if (!inp?.value.trim()) return;
    const msg = inp.value.trim();
    inp.value = "";
    sendChatMessage(msg);
  });

  // Avisos
  document.getElementById("btnBackFromAvisos")?.addEventListener("click", () => navigateToScreen("screen-inicio"));

  // Perfil & Sync & Cronómetro & Sign Out
  document.getElementById("btnBackFromPerfil")?.addEventListener("click", () => navigateToScreen("screen-inicio"));
  document.getElementById("btnSelectRoleContratista")?.addEventListener("click", () => updateProfileRole("contratista"));
  document.getElementById("btnSelectRoleMetro")?.addEventListener("click", () => updateProfileRole("metro"));

  document.getElementById("btnStripSyncNow")?.addEventListener("click", () => syncOfflineQueue(true));
  document.getElementById("btnProfileSyncNow")?.addEventListener("click", () => syncOfflineQueue(true));

  document.getElementById("btnInstallPwa")?.addEventListener("click", async () => {
    if (!state.deferredInstallPrompt) return;
    state.deferredInstallPrompt.prompt();
    await state.deferredInstallPrompt.userChoice;
    state.deferredInstallPrompt = null;
    document.getElementById("btnInstallPwa").hidden = true;
  });

  document.getElementById("btnSignOut")?.addEventListener("click", async () => {
    await supabase.auth.signOut();
    showToast("Sesión cerrada");
  });

  const testDisp = document.getElementById("testTimerDisplay");
  const testBtn = document.getElementById("btnStartStopTestTimer");
  testBtn?.addEventListener("click", () => {
    if (state.testTimerRunning) {
      state.testTimerRunning = false;
      clearInterval(state.testTimerId);
      testBtn.textContent = "▶️ Reanudar";
    } else {
      state.testTimerRunning = true;
      testBtn.textContent = "⏸️ Pausar";
      state.testTimerId = setInterval(() => {
        state.testTimerSeconds += 1;
        if (testDisp) testDisp.textContent = formatTimer(state.testTimerSeconds);
      }, 1000);
    }
  });
  document.getElementById("btnResetTestTimer")?.addEventListener("click", () => {
    state.testTimerRunning = false;
    clearInterval(state.testTimerId);
    state.testTimerSeconds = 0;
    if (testDisp) testDisp.textContent = "00:00";
    if (testBtn) testBtn.textContent = "▶️ Iniciar";
  });

  window.addEventListener("online", () => {
    updateNetworkAndCountersUI();
    syncOfflineQueue(true);
  });
  window.addEventListener("offline", () => {
    updateNetworkAndCountersUI();
    showToast("📡 Sin señal — modo offline automático activo");
  });
}

// ============================================================================
// ARRANQUE DE LA APLICACIÓN
// ============================================================================
async function initApp() {
  await openDB().catch(() => {});
  registerPWA();
  initDialogControls();
  initAccessibleFormValidation();
  setupAuthForms();
  attachAppEventListeners();

  const savedDraft = await getDraftLocal().catch(() => null);
  if (savedDraft) {
    state.draft = { ...state.draft, ...savedDraft };
  }

  const handleSessionChange = async (session) => {
    state.session = session;
    state.user = session?.user || null;

    if (state.user) {
      await loadOperationalData();
      if (navigator.onLine) await syncOfflineQueue(false);
      navigateToScreen("screen-inicio");
    } else {
      navigateToScreen("screen-auth");
    }
  };

  supabase.auth.onAuthStateChange((_event, session) => {
    handleSessionChange(session);
  });

  const { data } = await supabase.auth.getSession();
  await handleSessionChange(data?.session || null);
}

document.addEventListener("DOMContentLoaded", initApp);
