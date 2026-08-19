/* ============================================================
   GotaVita Manager — Local-First Bookkeeping Application
   Fully optimized for Performance, UI, and Reliability
   ============================================================ */

"use strict";

const {
  KEYS,
  DAYS,
  MAX_UNDO,
  BIZ_DETAILS,
  CACHE_KEYS,
  SYNC_KEYS,
  SYNC_RESOURCES
} = window.GV_CONFIG;

const {
  peso,
  esc,
  jsAttrArg,
  clone,
  sameDay,
  fmtDate
} = window.GV_UTILS;

const SEED = window.GOTAVITA_SEED || {};

let state = window.GV_STATE.createInitialState();

// Centralize whole-state replacement so every imported, restored, cached,
// synced, or undo snapshot follows the same path. Existing feature code can
// continue to mutate individual collections normally.
function replaceState(nextState, { normalize = true } = {}) {
  if (
    !nextState ||
    typeof nextState !== "object" ||
    Array.isArray(nextState)
  ) {
    throw new Error("Invalid application state.");
  }

  state = nextState;

  if (normalize) {
    normalizeState();
  }

  return state;
}

function getStateSnapshot() {
  return clone(state);
}

let undoStack = [];

let sortConfig = {
  orders: {
    column: "orderNumber",
    asc: false
  },

  clients: {
    column: "name",
    asc: true
  },

  containers: {
    column: "outstanding",
    asc: false
  },

  receivables: {
    column: "balance",
    asc: false
  }
};

let groupPickerOrderIds = [];
let serverSnapshot = null;
let syncTimer = null;
let syncInFlight = false;
let lastRenderDurationMs = 0;

/* ---------------- Step 6 Production Hardening ---------------- */

function safeLocalStorageSet(key, value) {
  try {
    localStorage.setItem(key, value);
    return localStorage.getItem(key) === value;
  } catch (e) {
    console.warn(
      "GotaVita storage write failed:",
      key,
      e.message
    );
    return false;
  }
}

function safeLocalStorageGet(key, fallback = null) {
  try {
    const value = localStorage.getItem(key);

    return value == null
      ? fallback
      : value;
  } catch (e) {
    console.warn(
      "GotaVita storage read failed:",
      key,
      e.message
    );

    return fallback;
  }
}

function storageChecksum(value) {
  const text = String(value ?? "");

  let hash = 2166136261;

  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }

  return (hash >>> 0)
    .toString(16)
    .padStart(8, "0");
}

function writeLocalStateSnapshot(sourceState = state) {
  normalizeState();

  const data = clone(sourceState);
  const payload = JSON.stringify(data);

  const envelope = {
    version: CACHE_KEYS.version,
    savedAt: Date.now(),
    checksum: storageChecksum(payload),
    data
  };

  const serialized = JSON.stringify(envelope);

  const ok = safeLocalStorageSet(
    CACHE_KEYS.primary,
    serialized
  );

  if (!ok) {
    return false;
  }

  // Keep a second, independently written recovery copy.
  safeLocalStorageSet(
    CACHE_KEYS.recovery,
    serialized
  );

  return true;
}

function readLocalStateSnapshot() {
  const candidates = [
    CACHE_KEYS.primary,
    CACHE_KEYS.recovery
  ];

  for (const key of candidates) {
    const raw = safeLocalStorageGet(key);

    if (!raw) {
      continue;
    }

    try {
      const parsed = JSON.parse(raw);

      // Support the legacy raw-state cache created by earlier versions.
      if (
        parsed &&
        parsed.data &&
        parsed.checksum
      ) {
        const payload =
          JSON.stringify(parsed.data);

        if (
          storageChecksum(payload) !==
          parsed.checksum
        ) {
          throw new Error(
            "Cache checksum mismatch."
          );
        }

        const checked =
          validateBackupPayload(parsed.data);

        return checked.data;
      }

      const checked =
        validateBackupPayload(parsed);

      return checked.data;
    } catch (e) {
      console.warn(
        "GotaVita cached state rejected:",
        key,
        e.message
      );
    }
  }

  return null;
}

function readAutoBackupList() {
  const raw = safeLocalStorageGet(
    KEYS.autobackup,
    "[]"
  );

  try {
    const list =
      JSON.parse(raw || "[]");

    return Array.isArray(list)
      ? list.filter(Boolean)
      : [];
  } catch (e) {
    console.warn(
      "GotaVita backup index is invalid; rebuilding it.",
      e.message
    );

    return [];
  }
}

function getHealthRuntimeErrors() {
  try {
    return Number(
      localStorage.getItem(
        "gotavita_health_runtime_errors"
      ) || 0
    );
  } catch (_) {
    return 0;
  }
}

function recordHealthRuntimeError() {
  try {
    localStorage.setItem(
      "gotavita_health_runtime_errors",
      String(
        getHealthRuntimeErrors() + 1
      )
    );
  } catch (_) {}
}

function getLatestBackupHealth() {
  const list = readAutoBackupList();

  if (
    !Array.isArray(list) ||
    !list.length
  ) {
    return {
      ok: false,
      detail:
        "No automatic backup recorded"
    };
  }

  const latest = list[0] || {};
  const raw =
    latest.payload ||
    latest.data ||
    latest;

  try {
    if (latest.checksum && raw) {
      const payload =
        JSON.stringify(raw);

      if (
        storageChecksum(payload) !==
        latest.checksum
      ) {
        return {
          ok: false,
          detail:
            "Latest backup checksum mismatch"
        };
      }
    }
  } catch (_) {
    return {
      ok: false,
      detail:
        "Latest backup could not be validated"
    };
  }

  const stamp =
    latest.savedAt ||
    latest.createdAt ||
    latest.timestamp ||
    0;

  if (!stamp) {
    return {
      ok: false,
      detail:
        "Latest backup has no timestamp"
    };
  }

  return {
    ok: true,
    detail:
      `Latest backup ${new Date(stamp).toLocaleString()}`
  };
}

function runSystemHealthCheck() {
  const started =
    performance.now();

  const seenOrders = new Set();

  let duplicateOrderNumbers = 0;
  let orphanGroupOrders = 0;
  let invalidStatuses = 0;
  let invalidMoney = 0;
  let invalidContainers = 0;

  state.orders.forEach((o) => {
    const n = String(
      o.orderNumber ?? ""
    ).trim();

    if (n) {
      if (seenOrders.has(n)) {
        duplicateOrderNumbers++;
      } else {
        seenOrders.add(n);
      }
    }

    if (
      ![
        "Paid",
        "Unpaid",
        "Pending",
        "Cancelled"
      ].includes(o.status)
    ) {
      invalidStatuses++;
    }

    if (
      !Number.isFinite(Number(o.total)) ||
      Number(o.total) < 0
    ) {
      invalidMoney++;
    }

    const g =
      Number(o.gallons) || 0;

    const r =
      Number(o.emptyGallonsCollected) ||
      0;

    if (
      g < 0 ||
      r < 0 ||
      r > g
    ) {
      invalidContainers++;
    }
  });

  const orderIds = new Set(
    state.orders.map(
      (o) => String(o.id)
    )
  );

  state.orderGroups.forEach(
    (g) =>
      (g.orderIds || []).forEach(
        (id) => {
          if (
            !orderIds.has(
              String(id)
            )
          ) {
            orphanGroupOrders++;
          }
        }
      )
  );

  let storageBytes = 0;
  let storageReadable = true;
  let storageWritable = false;

  try {
    for (
      let i = 0;
      i < localStorage.length;
      i++
    ) {
      const key =
        localStorage.key(i);

      storageBytes +=
        String(key || "").length +
        String(
          localStorage.getItem(key) ||
          ""
        ).length;
    }

    const probe =
      `gotavita_health_probe_${Date.now()}`;

    storageWritable =
      safeLocalStorageSet(
        probe,
        "ok"
      );

    localStorage.removeItem(probe);
  } catch (_) {
    storageReadable = false;
  }

  const integrity =
    validateDataIntegrity({
      repair: false
    });

  const queue =
    getSyncQueue();

  const meta =
    getSyncMeta();

  const configured =
    window.location.protocol === "file:" ||
    !!(
      window.GV_SUPABASE_CONFIG?.url &&
      window.GV_SUPABASE_CONFIG?.publishableKey
    );

  const serverBoundary =
    window.location.protocol === "file:" ||
    typeof window.GVData?.sync ===
      "function";

  const backup =
    getLatestBackupHealth();

  const runtimeErrors =
    getHealthRuntimeErrors();

  const online =
    navigator.onLine !== false;

  const rawLastSync =
    meta.lastSync ||
    meta.lastSyncAt ||
    0;

  const lastSync =
    typeof rawLastSync === "string"
      ? Date.parse(rawLastSync)
      : Number(
          rawLastSync || 0
        );

  const lastSyncAge =
    lastSync
      ? Date.now() - lastSync
      : Infinity;

  const syncFresh =
    !online ||
    !configured ||
    !queue.length
      ? true
      : (
          Number.isFinite(
            lastSyncAge
          ) &&
          lastSyncAge <=
            24 * 60 * 60 * 1000
        );

  const results = [
    [
      "Data integrity",
      integrity.invalidOrders === 0 &&
        integrity.repairedTotals === 0 &&
        integrity.repairedContainers === 0 &&
        integrity.duplicateIds === 0 &&
        integrity.invalidExpenses === 0,
      integrity.invalidOrders
        ? `${integrity.invalidOrders} invalid reference(s)`
        : (
            integrity.duplicateIds
              ? `${integrity.duplicateIds} duplicate ID(s)`
              : (
                  integrity.invalidExpenses
                    ? `${integrity.invalidExpenses} invalid expense reference/value(s)`
                    : "OK"
                )
          )
    ],

    [
      "Duplicate order numbers",
      duplicateOrderNumbers === 0,
      duplicateOrderNumbers
        ? `${duplicateOrderNumbers} duplicate(s)`
        : "OK"
    ],

    [
      "Orphan group orders",
      orphanGroupOrders === 0 &&
        integrity.orphanGroupOrders === 0,
      (
        orphanGroupOrders ||
        integrity.orphanGroupOrders
      )
        ? `${
            orphanGroupOrders +
            integrity.orphanGroupOrders
          } orphan reference(s)`
        : "OK"
    ],

    [
      "Order statuses",
      invalidStatuses === 0,
      invalidStatuses
        ? `${invalidStatuses} invalid value(s)`
        : "OK"
    ],

    [
      "Money fields",
      invalidMoney === 0,
      invalidMoney
        ? `${invalidMoney} invalid value(s)`
        : "OK"
    ],

    [
      "Container quantities",
      invalidContainers === 0,
      invalidContainers
        ? `${invalidContainers} invalid value(s)`
        : "OK"
    ],

    [
      "Local storage",
      storageReadable &&
        storageWritable,
      storageReadable
        ? `${Math.round(storageBytes / 1024)} KB used locally`
        : "Storage unavailable"
    ],

    [
      "Backup integrity",
      backup.ok,
      backup.detail
    ],

    [
      "Sync queue",
      queue.length === 0,
      queue.length
        ? `${queue.length} resource(s) queued`
        : "Empty"
    ],

    [
      "Cloud configuration",
      configured,
      window.location.protocol ===
      "file:"
        ? "Local mode — cloud checks not applicable"
        : (
            configured
              ? "Configured"
              : "Not configured"
          )
    ],

    [
      "Sync transport",
      serverBoundary,
      window.location.protocol ===
      "file:"
        ? "Local mode — transport not required"
        : (
            serverBoundary
              ? "Application sync boundary available"
              : "Unavailable"
          )
    ],

    [
      "Connectivity",
      online,
      online
        ? "Online"
        : "Offline — local changes remain protected"
    ],

    [
      "Last synchronization",
      !online ||
        !configured ||
        (
          lastSync > 0 &&
          syncFresh
        ),
      !configured
        ? "Cloud synchronization not configured"
        : (
            lastSync
              ? new Date(
                  lastSync
                ).toLocaleString()
              : "No successful sync recorded"
          )
    ],

    [
      "Runtime errors",
      runtimeErrors === 0,
      runtimeErrors
        ? `${runtimeErrors} runtime error(s) recorded`
        : "None recorded"
    ],

    [
      "Last render",
      lastRenderDurationMs < 250,
      `${lastRenderDurationMs.toFixed(1)} ms`
    ]
  ];

  lastRenderDurationMs =
    Math.max(
      lastRenderDurationMs,
      performance.now() - started
    );

  const el =
    $("systemHealthBody");

  if (el) {
    el.innerHTML =
      results
        .map(
          ([label, ok, detail]) =>
            `<tr>` +
            `<td>${esc(label)}</td>` +
            `<td><span class="badge ${
              ok
                ? "paid"
                : "unpaid"
            }">${
              ok
                ? "PASS"
                : "CHECK"
            }</span></td>` +
            `<td><small>${esc(
              detail
            )}</small></td>` +
            `</tr>`
        )
        .join("");
  }

  const summary =
    $("systemHealthSummary");

  if (summary) {
    const failed =
      results.filter(
        (r) => !r[1]
      ).length;

    summary.textContent =
      failed
        ? `${failed} check(s) need attention.`
        : "All health checks passed.";

    summary.className =
      `emp-meta ${
        failed
          ? "bad"
          : "ok"
      }`;
  }

  return {
    results,
    failed:
      results.filter(
        (r) => !r[1]
      ).length
  };
}

// Explicit global bindings keep delegated data-action controls reliable across browsers.
window.runSystemHealthCheck =
  runSystemHealthCheck;

window.applyClientSortFromSelect =
  applyClientSortFromSelect;

window.setContainerSort =
  setContainerSort;

function initProductionHardening() {
  window.addEventListener(
    "error",
    (event) => {
      recordHealthRuntimeError();

      const message =
        String(
          event.message ||
          event.error?.message ||
          "Unknown runtime error"
        );

      handleAppError(
        "window-error",
        event.error ||
          new Error(message),
        {
          userMessage:
            "The application encountered an unexpected error. Your saved data is still protected."
        }
      );
    }
  );

  window.addEventListener(
    "unhandledrejection",
    (event) => {
      recordHealthRuntimeError();

      const reason =
        event.reason instanceof Error
          ? event.reason
          : new Error(
              String(
                event.reason ||
                  "Unknown promise rejection"
              )
            );

      event.preventDefault();

      handleAppError(
        "unhandled-rejection",
        reason,
        {
          userMessage:
            "An operation could not be completed. Please try again."
        }
      );
    }
  );

  window.addEventListener(
    "pagehide",
    () => {
      try {
        if (
          !writeLocalStateSnapshot(
            state
          )
        ) {
          console.warn(
            "GotaVita final cache write could not be verified."
          );
        }
      } catch (e) {
        handleAppError(
          "pagehide-save",
          e,
          {
            toast: false
          }
        );
      }
    }
  );
}

let syncLocalMirror = null;

/* ---------------- Helpers ---------------- */

const $ = (id) =>
  document.getElementById(id);

/* ---------------- Step 14: DOM Write Guard ----------------
   Many render functions intentionally rebuild their table/card markup from
   application state. Avoid touching the DOM when the generated markup is
   identical to what is already displayed. This keeps existing render
   functions and business logic unchanged while eliminating redundant DOM
   teardown/rebuild work during partial refreshes.
*/
(function installDomWriteGuard() {
  if (
    typeof Element ===
    "undefined"
  ) {
    return;
  }

  const proto =
    Element.prototype;

  const descriptor =
    Object.getOwnPropertyDescriptor(
      proto,
      "innerHTML"
    );

  if (
    !descriptor ||
    !descriptor.get ||
    !descriptor.set ||
    proto.__gotavitaInnerHTMLGuard
  ) {
    return;
  }

  const nativeGet =
    descriptor.get;

  const nativeSet =
    descriptor.set;

  Object.defineProperty(
    proto,
    "innerHTML",
    {
      configurable:
        descriptor.configurable,
      enumerable:
        descriptor.enumerable,

      get:
        nativeGet,

      set(value) {
        const next =
          String(
            value ?? ""
          );

        if (
          nativeGet.call(
            this
          ) === next
        ) {
          return;
        }

        nativeSet.call(
          this,
          next
        );
      }
    }
  );

  Object.defineProperty(
    proto,
    "__gotavitaInnerHTMLGuard",
    {
      value: true,
      configurable: false
    }
  );
})();

function showToast(
  message,
  type = "success"
) {
  const c =
    $("toastContainer");

  if (!c) return;

  const t =
    document.createElement(
      "div"
    );

  t.className =
    "toast animate__animated animate__fadeInUp " +
    (
      type === "error"
        ? "error"
        : ""
    );

  t.innerHTML =
    `<span>${
      type === "error"
        ? "⚠️"
        : "✅"
    }</span><span>${esc(
      message
    )}</span>`;

  c.appendChild(t);

  setTimeout(
    () => {
      t.classList.replace(
        "animate__fadeInUp",
        "animate__fadeOutDown"
      );

      setTimeout(
        () =>
          t.remove(),
        500
      );
    },
    2800
  );
}

let activeConfirmation =
  null;

function requestConfirmation({
  title = "Confirm action",
  message = "Are you sure?",
  details = "",
  confirmLabel = "Confirm",
  tone = "danger"
} = {}) {
  return new Promise(
    (resolve) => {
      const modal =
        $("confirmModal");

      const dialog =
        modal?.querySelector(
          ".confirm-dialog"
        );

      const titleEl =
        $("confirmModalTitle");

      const badgeEl =
        $("confirmModalBadge");

      const msgEl =
        $("confirmModalMessage");

      const detailsEl =
        $("confirmModalDetails");

      const acceptEl =
        $("confirmModalAccept");

      if (
        !modal ||
        !dialog ||
        !titleEl ||
        !badgeEl ||
        !msgEl ||
        !acceptEl
      ) {
        resolve(false);
        return;
      }

      activeConfirmation = {
        resolve
      };

      dialog.setAttribute(
        "data-tone",
        tone
      );

      titleEl.textContent =
        title;

      badgeEl.textContent =
        tone === "danger"
          ? "Safety confirmation"
          : tone === "warning"
            ? "Please review"
            : "Confirmation";

      msgEl.textContent =
        message;

      detailsEl.textContent =
        details;

      detailsEl.hidden =
        !details;

      acceptEl.textContent =
        confirmLabel;

      acceptEl.classList.toggle(
        "danger",
        tone === "danger"
      );

      openModal(
        "confirmModal"
      );

      setTimeout(
        () =>
          acceptEl.focus(),
        0
      );
    }
  );
}

function finishConfirmation(
  accepted
) {
  const current =
    activeConfirmation;

  activeConfirmation =
    null;

  closeModal(
    "confirmModal"
  );

  if (current?.resolve) {
    current.resolve(
      Boolean(accepted)
    );
  }
}

function acceptConfirm() {
  finishConfirmation(
    true
  );
}

function cancelConfirm() {
  finishConfirmation(
    false
  );
}

/* ---------------- Step 5: Error Handling ---------------- */

let lastHandledError = {
  key: "",
  at: 0
};

function errorMessage(
  error,
  fallback =
    "Something went wrong. Please try again."
) {
  const message =
    error?.message != null
      ? String(
          error.message
        ).trim()
      : String(
          error ?? ""
        ).trim();

  return (
    message ||
    fallback
  );
}

function handleAppError(
  context,
  error,
  {
    toast = true,
    userMessage =
      "Something went wrong. Your previous data remains unchanged.",
    fallback = false
  } = {}
) {
  const message =
    errorMessage(error);

  const key =
    `${context}:${message}`;

  const now =
    Date.now();

  const duplicate =
    key ===
      lastHandledError.key &&
    now -
      lastHandledError.at <
      1200;

  lastHandledError = {
    key,
    at: now
  };

  try {
    audit(
      "error",
      "system",
      context,
      {
        message
      }
    );
  } catch {}

  console.error(
    `[GotaVita] ${context}:`,
    error
  );

  if (
    toast &&
    !duplicate
  ) {
    showToast(
      userMessage ||
        message,
      "error"
    );
  }

  return fallback;
}

function safeRun(
  context,
  action,
  options = {}
) {
  try {
    return action();
  } catch (error) {
    return handleAppError(
      context,
      error,
      options
    );
  }
}

async function safeRunAsync(
  context,
  action,
  options = {}
) {
  try {
    return await action();
  } catch (error) {
    return handleAppError(
      context,
      error,
      options
    );
  }
}

function confetti() {
  if (
    window.matchMedia(
      "(prefers-reduced-motion: reduce)"
    ).matches
  ) {
    return;
  }

  const layer =
    $("confettiLayer");

  if (!layer) return;

  const colors = [
    "#0088ff",
    "#00d2ff",
    "#00a86b",
    "#ffd166",
    "#ff4d4f"
  ];

  for (
    let i = 0;
    i < 50;
    i++
  ) {
    const p =
      document.createElement(
        "i"
      );

    p.className =
      "confetti";

    p.style.cssText = `
      position: fixed; width: 8px; height: 12px;
      left: ${Math.random() * 100}vw; top: -10px;
      background: ${
        colors[
          (
            Math.random() *
            colors.length
          ) | 0
        ]
      };
      opacity: ${
        Math.random() + 0.5
      };
      transform: rotate(${
        Math.random() * 360
      }deg);
      transition: transform 2s ease-out;
      z-index: 3000; pointer-events: none;
    `;

    layer.appendChild(p);

    setTimeout(
      () => {
        p.style.top =
          "105vh";

        p.style.transform =
          `rotate(${
            Math.random() *
            720
          }deg)`;
      },
      50
    );

    setTimeout(
      () =>
        p.remove(),
      2200
    );
  }
}

function countUp(
  el,
  target,
  isCurrency
) {
  if (!el) return;

  const from =
    Number(
      el.dataset.val || 0
    );

  el.dataset.val =
    target;

  if (
    window.matchMedia(
      "(prefers-reduced-motion: reduce)"
    ).matches
  ) {
    el.textContent =
      isCurrency
        ? peso(target)
        : String(target);

    return;
  }

  const start =
    performance.now();

  const dur = 400;

  function step(now) {
    const p =
      Math.min(
        (now - start) /
          dur,
        1
      );

    const v =
      from +
      (
        target -
        from
      ) *
        (
          1 -
          Math.pow(
            1 - p,
            3
          )
        );

    el.textContent =
      isCurrency
        ? peso(v)
        : Math.round(
            v
          ).toLocaleString();

    if (p < 1) {
      requestAnimationFrame(
        step
      );
    }
  }

  requestAnimationFrame(
    step
  );
}

/* ---------------- State Management ---------------- */

function saveStateForUndo() {
  undoStack.push(
    clone(state)
  );

  if (
    undoStack.length >
    MAX_UNDO
  ) {
    undoStack.shift();
  }

  const b =
    $("undoBtn");

  if (b) {
    b.disabled = false;
  }
}

function undoLastAction() {
  if (!undoStack.length) {
    return;
  }

  replaceState(
    undoStack.pop()
  );

  persistState();
  renderAll();

  if (
    !undoStack.length
  ) {
    $("undoBtn").disabled =
      true;
  }

  showToast(
    "Reverted last action."
  );
}

function seedState() {
  state.products =
    clone(
      SEED.products || []
    );

  state.clients =
    clone(
      SEED.clients || []
    );

  state.orders =
    clone(
      SEED.orders || []
    );

  state.expenses =
    clone(
      SEED.expenses || []
    );

  state.deletedOrders =
    clone(
      SEED.deletedOrders || []
    );

  state.orderGroups =
    clone(
      SEED.orderGroups || []
    );

  state.dailyReports =
    clone(
      SEED.dailyReports || []
    );

  state.employees =
    clone(
      SEED.employees || []
    );

  state.orderCounter =
    SEED.orderCounter || 138;
}

/* ---------------- Step 2: Data Foundation ---------------- */

function toId(v) {
  return v == null
    ? ""
    : String(v);
}

function getClientById(id) {
  const found =
    derivedIndexes.clients.get(
      toId(id)
    );

  return (
    found ||
    state.clients.find(
      (c) =>
        toId(c.id) ===
        toId(id)
    )
  );
}

function getProductById(id) {
  const found =
    derivedIndexes.products.get(
      toId(id)
    );

  return (
    found ||
    state.products.find(
      (p) =>
        toId(p.id) ===
        toId(id)
    )
  );
}

function getOrderClient(o) {
  return (
    getClientById(
      o.clientId
    ) ||
    state.clients.find(
      (c) =>
        c.name ===
        o.clientName
    ) ||
    null
  );
}

function getOrderProduct(o) {
  return (
    getProductById(
      o.productId
    ) ||
    state.products.find(
      (p) =>
        p.name ===
        o.custType
    ) ||
    null
  );
}

function orderTotal(o) {
  return (
    Math.max(
      Number(o.gallons) || 0,
      0
    ) *
    Math.max(
      Number(o.price) || 0,
      0
    )
  );
}

function calculateClientStats(client) {
  const clientId =
    toId(client.id);

  let orders = 0;
  let gallons = 0;
  let revenue = 0;
  let due = 0;
  let emptyCollected = 0;

  state.orders.forEach(
    (o) => {
      if (
        o.status ===
        "Cancelled"
      ) {
        return;
      }

      const belongs =
        (
          o.clientId &&
          toId(
            o.clientId
          ) === clientId
        ) ||
        (
          !o.clientId &&
          o.clientName ===
            client.name
        );

      if (!belongs) {
        return;
      }

      orders++;

      gallons += Math.max(
        Number(
          o.gallons
        ) || 0,
        0
      );

      emptyCollected +=
        Math.min(
          Math.max(
            Number(
              o.emptyGallonsCollected
            ) || 0,
            0
          ),
          Math.max(
            Number(
              o.gallons
            ) || 0,
            0
          )
        );

      if (
        o.status ===
        "Paid"
      ) {
        revenue +=
          orderTotal(o);
      } else if (
        o.status !==
        "Cancelled"
      ) {
        due +=
          orderTotal(o);
      }
    }
  );

  return {
    orders,
    gallons,
    revenue,
    due,
    emptyCollected,
    outstandingContainers:
      Math.max(
        gallons -
          emptyCollected,
        0
      )
  };
}

function validationError(
  message
) {
  showToast(
    message,
    "error"
  );

  return false;
}

function requireText(
  value,
  label,
  minLength = 1,
  maxLength = 120
) {
  const text =
    String(
      value ?? ""
    ).trim();

  if (
    text.length <
    minLength
  ) {
    return {
      ok: false,
      message:
        `${label} is required.`
    };
  }

  if (
    text.length >
    maxLength
  ) {
    return {
      ok: false,
      message:
        `${label} is too long.`
    };
  }

  return {
    ok: true,
    value: text
  };
}

function requirePositiveNumber(
  value,
  label,
  {
    allowZero = false,
    max = 1000000,
    step = null
  } = {}
) {
  const num =
    Number(value);

  if (
    !Number.isFinite(num)
  ) {
    return {
      ok: false,
      message:
        `${label} must be a valid number.`
    };
  }

  if (
    allowZero
      ? num < 0
      : num <= 0
  ) {
    return {
      ok: false,
      message:
        `${label} must be ${
          allowZero
            ? "zero or greater"
            : "greater than zero"
        }.`
    };
  }

  if (
    num >
    max
  ) {
    return {
      ok: false,
      message:
        `${label} is too large.`
    };
  }

  if (
    step &&
    Math.abs(
      num / step -
      Math.round(
        num / step
      )
    ) >
      1e-9
  ) {
    return {
      ok: false,
      message:
        `${label} must use increments of ${step}.`
    };
  }

  return {
    ok: true,
    value: num
  };
}

function validateOrderInput(
  data
) {
  const client =
    requireText(
      data.clientName,
      "Client"
    );

  if (!client.ok) {
    return client;
  }

  if (!data.clientId) {
    return {
      ok: false,
      message:
        "Selected client is no longer available. Please choose the client again."
    };
  }

  const product =
    requireText(
      data.custType,
      "Product / Service"
    );

  if (!product.ok) {
    return product;
  }

  if (!data.productId) {
    return {
      ok: false,
      message:
        "Selected product / service is no longer available. Please choose it again."
    };
  }

  const gallons =
    requirePositiveNumber(
      data.gallons,
      "Container quantity",
      {
        max: 10000,
        step: 0.5
      }
    );

  if (!gallons.ok) {
    return gallons;
  }

  const price =
    requirePositiveNumber(
      data.price,
      "Unit price",
      {
        allowZero: true,
        max: 100000,
        step: 0.5
      }
    );

  if (!price.ok) {
    return price;
  }

  const empty =
    requirePositiveNumber(
      data.emptyGallonsCollected,
      "Empty containers collected",
      {
        allowZero: true,
        max: gallons.value,
        step: 0.5
      }
    );

  if (!empty.ok) {
    return empty;
  }

  if (
    ![
      "Paid",
      "Unpaid",
      "Pending",
      "Cancelled"
    ].includes(
      data.status
    )
  ) {
    return {
      ok: false,
      message:
        "Invalid order status."
    };
  }

  return {
    ok: true,
    value: {
      clientName:
        client.value,
      custType:
        product.value,
      gallons:
        gallons.value,
      price:
        price.value,
      emptyGallonsCollected:
        empty.value
    }
  };
}

function validateClientInput(
  data
) {
  const name =
    requireText(
      data.name,
      "Client name",
      2,
      120
    );

  if (!name.ok) {
    return name;
  }

  const price =
    requirePositiveNumber(
      data.defaultPrice,
      "Default refill price",
      {
        allowZero: true,
        max: 100000,
        step: 0.5
      }
    );

  if (!price.ok) {
    return price;
  }

  return {
    ok: true,
    value: {
      name:
        name.value,
      defaultPrice:
        price.value,
      phone:
        String(
          data.phone ??
            ""
        )
          .trim()
          .slice(0, 40),
      address:
        String(
          data.address ??
            ""
        )
          .trim()
          .slice(
            0,
            250
          )
    }
  };
}

function validateExpenseInput(
  data
) {
  const amount =
    requirePositiveNumber(
      data.amount,
      "Expense amount",
      {
        max: 10000000,
        step: 0.5
      }
    );

  if (!amount.ok) {
    return amount;
  }

  if (
    data.expenseType ===
      "Employee" &&
    !data.employeeId
  ) {
    return {
      ok: false,
      message:
        "Please select an employee for this expense."
    };
  }

  if (
    !String(
      data.category ?? ""
    ).trim()
  ) {
    return {
      ok: false,
      message:
        "Please select an expense category."
    };
  }

  return {
    ok: true,
    value: {
      amount:
        amount.value
    }
  };
}

function validateEmployeeInput(
  data
) {
  const name =
    requireText(
      data.name,
      "Employee name",
      2,
      120
    );

  if (!name.ok) {
    return name;
  }

  const rate =
    requirePositiveNumber(
      data.salaryRate,
      "Salary rate",
      {
        allowZero: true,
        max: 10000000,
        step: 1
      }
    );

  if (!rate.ok) {
    return rate;
  }

  if (
    ![
      "Daily",
      "Weekly",
      "Monthly"
    ].includes(
      data.salaryType
    )
  ) {
    return {
      ok: false,
      message:
        "Invalid salary basis."
    };
  }

  return {
    ok: true,
    value: {
      name:
        name.value,
      salaryRate:
        rate.value
    }
  };
}

function validateDataIntegrity(
  { repair = true } = {}
) {
  const clientIds =
    new Set(
      state.clients
        .map(
          (c) =>
            toId(c.id)
        )
        .filter(Boolean)
    );

  const productIds =
    new Set(
      state.products
        .map(
          (p) =>
            toId(p.id)
        )
        .filter(Boolean)
    );

  const employeeIds =
    new Set(
      state.employees
        .map(
          (e) =>
            toId(e.id)
        )
        .filter(Boolean)
    );

  const orderIds =
    new Set();

  const groupIds =
    new Set();

  let invalidOrders = 0;
  let repairedTotals = 0;
  let repairedContainers = 0;
  let duplicateIds = 0;
  let duplicateOrderNumbers = 0;
  let invalidExpenses = 0;
  let orphanGroupOrders = 0;
  let duplicateGroupOrderRefs = 0;

  const orderNumbers =
    new Set();

  state.orders.forEach(
    (o) => {
      const oid =
        toId(o.id);

      if (oid) {
        if (
          orderIds.has(oid)
        ) {
          duplicateIds++;
        } else {
          orderIds.add(
            oid
          );
        }
      }

      if (
        o.clientId &&
        !clientIds.has(
          toId(o.clientId)
        )
      ) {
        invalidOrders++;
      }

      if (
        o.productId &&
        !productIds.has(
          toId(o.productId)
        )
      ) {
        invalidOrders++;
      }

      const n =
        String(
          o.orderNumber ??
            ""
        ).trim();

      if (n) {
        if (
          orderNumbers.has(n)
        ) {
          duplicateOrderNumbers++;
        } else {
          orderNumbers.add(
            n
          );
        }
      }

      const total =
        orderTotal(o);

      if (
        Number(o.total) !==
        total
      ) {
        if (repair) {
          o.total =
            total;
        }

        repairedTotals++;
      }

      const balance =
        containerBalanceForOrder(
          o
        );

      if (
        Number(
          o.containerBalance
        ) !== balance
      ) {
        if (repair) {
          o.containerBalance =
            balance;
        }

        repairedContainers++;
      }
    }
  );

  state.expenses.forEach(
    (e) => {
      const amount =
        Number(e.amount);

      if (
        !Number.isFinite(
          amount
        ) ||
        amount < 0
      ) {
        invalidExpenses++;
      }

      if (
        e.employeeId &&
        !employeeIds.has(
          toId(
            e.employeeId
          )
        )
      ) {
        invalidExpenses++;
      }
    }
  );

  state.orderGroups.forEach(
    (g) => {
      const gid =
        String(
          g.id ?? ""
        );

      if (gid) {
        if (
          groupIds.has(gid)
        ) {
          duplicateIds++;
        } else {
          groupIds.add(
            gid
          );
        }
      }

      const seen =
        new Set();

      (
        g.orderIds ||
        []
      ).forEach(
        (id) => {
          const key =
            String(id);

          if (
            seen.has(key)
          ) {
            duplicateGroupOrderRefs++;
          } else {
            seen.add(key);
          }

          if (
            !orderIds.has(
              key
            )
          ) {
            orphanGroupOrders++;
          }
        }
      );
    }
  );

  return {
    clients:
      state.clients.length,
    products:
      state.products.length,
    orders:
      state.orders.length,
    invalidOrders,
    repairedTotals,
    repairedContainers,
    duplicateIds,
    duplicateOrderNumbers,
    invalidExpenses,
    orphanGroupOrders,
    duplicateGroupOrderRefs
  };
}

const derivedIndexes = {
  clients:
    new Map(),
  products:
    new Map()
};

function rebuildDerivedIndexes() {
  derivedIndexes.clients =
    new Map(
      (
        state.clients || []
      )
        .filter(
          (c) =>
            c?.id != null
        )
        .map(
          (c) => [
            toId(c.id),
            c
          ]
        )
    );

  derivedIndexes.products =
    new Map(
      (
        state.products || []
      )
        .filter(
          (p) =>
            p?.id != null
        )
        .map(
          (p) => [
            toId(p.id),
            p
          ]
        )
    );
}

function normalizeState() {
  if (
    !state ||
    typeof state !== "object" ||
    Array.isArray(state)
  ) {
    state =
      window.GV_STATE.createInitialState();
  }

  [
    "products",
    "clients",
    "orders",
    "expenses",
    "deletedOrders",
    "orderGroups",
    "dailyReports",
    "employees",
    "auditLog"
  ].forEach(
    (k) => {
      if (
        !Array.isArray(
          state[k]
        )
      ) {
        state[k] = [];
      }
    }
  );

  state.orderCounter =
    Number(
      state.orderCounter
    ) || 138;

  state._meta =
    Object.assign(
      {
        schemaVersion: 3,
        lastUpdated: 0,
        deviceId: ""
      },
      state._meta || {}
    );

  state.clients.forEach(
    (c) => {
      if (
        c.active == null
      ) {
        c.active = true;
      }
    }
  );

  // Build lookup maps once per normalization pass. This avoids repeated O(n)
  // client/product searches while normalizing large order datasets.
  const clientById =
    new Map(
      state.clients
        .filter(
          (c) =>
            c?.id != null
        )
        .map(
          (c) => [
            toId(c.id),
            c
          ]
        )
    );

  const clientByName =
    new Map(
      state.clients
        .filter(
          (c) =>
            c?.name
        )
        .map(
          (c) => [
            String(c.name),
            c
          ]
        )
    );

  const productById =
    new Map(
      state.products
        .filter(
          (p) =>
            p?.id != null
        )
        .map(
          (p) => [
            toId(p.id),
            p
          ]
        )
    );

  const productByName =
    new Map(
      state.products
        .filter(
          (p) =>
            p?.name
        )
        .map(
          (p) => [
            String(p.name),
            p
          ]
        )
    );

  state.orders.forEach(
    (o) => {
      if (
        ![
          "Paid",
          "Unpaid",
          "Pending",
          "Cancelled"
        ].includes(
          o.status
        )
      ) {
        o.status =
          o.deliveryStatus ===
          "Cancelled"
            ? "Cancelled"
            : (
                o.status ||
                "Unpaid"
              );
      }

      o.deliveryStatus =
        o.status ===
        "Paid"
          ? "Delivered"
          : (
              o.status ===
              "Unpaid"
                ? "Out for Delivery"
                : o.status
            );

      if (
        o.clientId == null
      ) {
        const c =
          clientByName.get(
            String(
              o.clientName ||
                ""
            )
          );

        if (c) {
          o.clientId =
            c.id;
        }
      }

      if (
        o.productId == null
      ) {
        const pr =
          productByName.get(
            String(
              o.custType ||
                ""
            )
          );

        if (pr) {
          o.productId =
            pr.id;
        }
      }

      if (
        o.emptyGallonsCollected ==
        null
      ) {
        o.emptyGallonsCollected =
          0;
      }

      o.total =
        orderTotal(o);

      o.containerBalance =
        containerBalanceForOrder(
          o
        );

      const c =
        clientById.get(
          toId(
            o.clientId
          )
        );

      if (c) {
        o.clientName =
          c.name;

        if (!o.address) {
          o.address =
            c.address || "";
        }
      }

      const pr =
        productById.get(
          toId(
            o.productId
          )
        );

      if (pr) {
        o.custType =
          pr.name;
      }

      if (!o.createdAt) {
        o.createdAt =
          o.date ||
          new Date().toISOString();
      }

      if (!o.updatedAt) {
        o.updatedAt =
          o.date ||
          o.createdAt;
      }
    }
  );

  state.employees.forEach(
    (e) => {
      e.schedule =
        Object.assign(
          {
            Mon: 0,
            Tue: 0,
            Wed: 0,
            Thu: 0,
            Fri: 0,
            Sat: 0
          },
          e.schedule || {}
        );
    }
  );

  derivedIndexes.clients =
    clientById;

  derivedIndexes.products =
    productById;
}

function audit(
  action,
  entity,
  entityId,
  details = {}
) {
  state.auditLog =
    Array.isArray(
      state.auditLog
    )
      ? state.auditLog
      : [];

  state.auditLog.push(
    {
      id: `audit_${Date.now()}_${Math.random()
        .toString(36)
        .slice(2, 7)}`,
      timestamp:
        new Date().toISOString(),
      action,
      entity,
      entityId:
        entityId == null
          ? ""
          : String(
              entityId
            ),
      details:
        clone(details)
    }
  );

  if (
    state.auditLog.length >
    500
  ) {
    state.auditLog =
      state.auditLog.slice(
        -500
      );
  }
}

function datasetSummary(
  data = state
) {
  return {
    clients:
      Array.isArray(
        data.clients
      )
        ? data.clients.length
        : 0,

    products:
      Array.isArray(
        data.products
      )
        ? data.products.length
        : 0,

    orders:
      Array.isArray(
        data.orders
      )
        ? data.orders.length
        : 0,

    expenses:
      Array.isArray(
        data.expenses
      )
        ? data.expenses.length
        : 0,

    employees:
      Array.isArray(
        data.employees
      )
        ? data.employees.length
        : 0,

    groups:
      Array.isArray(
        data.orderGroups
      )
        ? data.orderGroups.length
        : 0,

    reports:
      Array.isArray(
        data.dailyReports
      )
        ? data.dailyReports.length
        : 0
  };
}

/* ============================================================
   Supabase / Cloud Sync Boundary
   ------------------------------------------------------------
   The retired Node/JSON API is intentionally removed.
   Supabase access goes through GVAuth + GVData only.
   ============================================================ */

function setSyncStatus(
  text,
  kind = "local"
) {
  const el =
    $("syncStatus");

  if (!el) return;

  el.textContent =
    `● ${text}`;

  el.dataset.status =
    kind;
}

function getDeviceId() {
  let id =
    localStorage.getItem(
      SYNC_KEYS.deviceId
    );

  if (!id) {
    id =
      `device-${Date.now()}-${Math.random()
        .toString(36)
        .slice(2, 10)}`;

    localStorage.setItem(
      SYNC_KEYS.deviceId,
      id
    );
  }

  return id;
}

function getSyncQueue() {
  try {
    return JSON.parse(
      localStorage.getItem(
        SYNC_KEYS.queue
      ) || "[]"
    );
  } catch {
    return [];
  }
}

function setSyncQueue(
  queue
) {
  const unique = [
    ...new Set(
      (
        queue || []
      ).filter(Boolean)
    )
  ];

  safeLocalStorageSet(
    SYNC_KEYS.queue,
    JSON.stringify(
      unique
    )
  );
}

function getSyncMeta() {
  try {
    return JSON.parse(
      localStorage.getItem(
        SYNC_KEYS.meta
      ) || "{}"
    );
  } catch {
    return {};
  }
}

function setSyncMeta(
  meta
) {
  safeLocalStorageSet(
    SYNC_KEYS.meta,
    JSON.stringify(
      meta || {}
    )
  );
}

function queueSyncResources(
  resources
) {
  const queue =
    getSyncQueue();

  queue.push(
    ...(resources || [])
  );

  setSyncQueue(
    queue
  );
}

function syncRecordId(
  resource,
  record,
  index
) {
  if (
    record &&
    record.id != null
  ) {
    return String(
      record.id
    );
  }

  if (
    record &&
    record.orderNumber !=
      null
  ) {
    return `order:${record.orderNumber}`;
  }

  if (
    record &&
    record.legacy_id !=
      null
  ) {
    return `legacy:${record.legacy_id}`;
  }

  return `index:${index}`;
}

function stableJson(
  value
) {
  if (
    value === null ||
    value === undefined
  ) {
    return JSON.stringify(
      value
    );
  }

  if (
    Array.isArray(value)
  ) {
    return `[${value
      .map(stableJson)
      .join(",")}]`;
  }

  if (
    typeof value ===
    "object"
  ) {
    return `{${Object.keys(value)
      .sort()
      .map(
        (key) =>
          `${JSON.stringify(
            key
          )}:${stableJson(
            value[key]
          )}`
      )
      .join(",")}}`;
  }

  return JSON.stringify(
    value
  );
}

function syncResourceHash(
  resource,
  records
) {
  return stableJson(
    Array.isArray(records)
      ? records
      : []
  );
}

function recordStamp(
  record,
  fallback = 0
) {
  const raw =
    record?.updatedAt ??
    record?.updated_at ??
    record?.date ??
    record?.createdAt ??
    record?.created_at ??
    0;

  if (
    typeof raw ===
    "number"
  ) {
    return Number.isFinite(
      raw
    ) &&
      raw > 0
      ? raw
      : fallback;
  }

  if (
    typeof raw ===
    "string"
  ) {
    const parsed =
      Date.parse(raw);

    return Number.isFinite(
      parsed
    ) &&
      parsed > 0
      ? parsed
      : fallback;
  }

  const numeric =
    Number(raw);

  return Number.isFinite(
    numeric
  ) &&
    numeric > 0
    ? numeric
    : fallback;
}

function indexRecords(
  resource,
  records
) {
  const map =
    new Map();

  (
    Array.isArray(records)
      ? records
      : []
  ).forEach(
    (
      record,
      index
    ) => {
      map.set(
        syncRecordId(
          resource,
          record,
          index
        ),
        record
      );
    }
  );

  return map;
}

function threeWayMergeResource(
  resource,
  base,
  local,
  remote
) {
  const baseMap =
    indexRecords(
      resource,
      base
    );

  const localMap =
    indexRecords(
      resource,
      local
    );

  const remoteMap =
    indexRecords(
      resource,
      remote
    );

  const ids =
    new Set([
      ...baseMap.keys(),
      ...localMap.keys(),
      ...remoteMap.keys()
    ]);

  const merged = [];
  const conflicts = [];

  for (
    const id of ids
  ) {
    const b =
      baseMap.get(id);

    const l =
      localMap.get(id);

    const r =
      remoteMap.get(id);

    const bJson =
      JSON.stringify(
        b ?? null
      );

    const lJson =
      JSON.stringify(
        l ?? null
      );

    const rJson =
      JSON.stringify(
        r ?? null
      );

    const localChanged =
      lJson !== bJson;

    const remoteChanged =
      rJson !== bJson;

    if (
      !localChanged &&
      !remoteChanged
    ) {
      if (r) {
        merged.push(r);
      } else if (l) {
        merged.push(l);
      }

      continue;
    }

    if (
      localChanged &&
      !remoteChanged
    ) {
      if (l) {
        merged.push(l);
      }

      continue;
    }

    if (
      !localChanged &&
      remoteChanged
    ) {
      if (r) {
        merged.push(r);
      }

      continue;
    }

    if (
      lJson === rJson
    ) {
      if (l) {
        merged.push(l);
      }

      continue;
    }

    const lt =
      recordStamp(
        l,
        Date.now()
      );

    const rt =
      recordStamp(
        r,
        Date.now()
      );

    if (lt >= rt) {
      if (l) {
        merged.push(l);
      }

      conflicts.push({
        resource,
        id,
        resolution:
          "local-latest"
      });
    } else {
      if (r) {
        merged.push(r);
      }

      conflicts.push({
        resource,
        id,
        resolution:
          "remote-latest"
      });
    }
  }

  return {
    merged,
    conflicts
  };
}

function updateSyncStatus(
  text,
  kind = "local"
) {
  const queueCount =
    getSyncQueue().length;

  const label =
    queueCount
      ? `${text} · ${queueCount} queued`
      : text;

  setSyncStatus(
    label,
    kind
  );
}

/*
 * Supabase is intentionally used through GVData only.
 * This helper prevents accidental fallback to the retired
 * Node/JSON API.
 */
function getCloudDataGateway() {
  const gateway =
    window.GVData;

  if (
    !gateway ||
    typeof gateway.health !==
      "function"
  ) {
    throw new Error(
      "GotaVita Supabase data gateway is unavailable."
    );
  }

  return gateway;
}

async function requireCloudManager() {
  const gateway =
    getCloudDataGateway();

  if (
    typeof gateway.requireAuthenticatedManager !==
    "function"
  ) {
    throw new Error(
      "GotaVita cloud authentication boundary is unavailable."
    );
  }

  const auth =
    await gateway.requireAuthenticatedManager();

  if (
    !auth?.authenticated
  ) {
    throw new Error(
      "Manager authentication is required for cloud synchronization."
    );
  }

  if (
    !auth?.profile?.company_id
  ) {
    throw new Error(
      "Manager company assignment is missing."
    );
  }

  return auth;
}

function getSupportedCloudResources() {
  const gateway =
    window.GVData;

  if (
    !gateway ||
    typeof gateway.transactionResources !==
      "function"
  ) {
    return [];
  }

  try {
    return gateway.transactionResources();
  } catch {
    return [];
  }
}

function resourceCloudName(
  resource
) {
  const aliases = {
    orderGroups:
      "order_groups",

    deliveryRoutes:
      "delivery_routes",

    dailyReports:
      "daily_reports",

    deletedOrders:
      "deleted_orders",

    orderGroupItems:
      "order_group_items",

    deliveryRouteItems:
      "delivery_route_items",

    payrollRecords:
      "payroll_records",

    auditLog:
      "audit_logs"
  };

  return (
    aliases[resource] ||
    resource
  );
}

function resourceStateName(
  resource
) {
  const aliases = {
    order_groups:
      "orderGroups",

    delivery_routes:
      "deliveryRoutes",

    daily_reports:
      "dailyReports",

    deleted_orders:
      "deletedOrders",

    order_group_items:
      "orderGroupItems",

    delivery_route_items:
      "deliveryRouteItems",

    payroll_records:
      "payrollRecords",

    audit_logs:
      "auditLog"
  };

  return (
    aliases[resource] ||
    resource
  );
}

/*
 * Step 10 intentionally does not transform local camelCase
 * objects into the Supabase snake_case database schema.
 *
 * The Supabase tables use columns such as:
 *   order_number
 *   client_legacy_id
 *   product_legacy_id
 *   empty_gallons_collected
 *
 * The existing local application uses:
 *   orderNumber
 *   clientId
 *   productId
 *   emptyGallonsCollected
 *
 * Therefore we keep local-first operation authoritative until the
 * dedicated schema adapter is introduced. This prevents malformed
 * cloud writes and protects existing business data.
 */
function cloudSyncAdapterReady() {
  return false;
}

async function syncChangedResources(
  force = false
) {
  if (
    window.location.protocol ===
    "file:"
  ) {
    updateSyncStatus(
      "Local",
      "local"
    );

    return false;
  }

  const authClient =
  window.GVData?.getClient?.();

if (!authClient) {
  updateSyncStatus(
    "Local",
    "local"
  );

  return false;
}

const {
  data: authSessionData
} = await authClient.auth.getSession();

if (!authSessionData?.session) {
  updateSyncStatus(
    "Signed out",
    "local"
  );

  return false;
}

  if (
    !navigator.onLine
  ) {
    updateSyncStatus(
      "Offline",
      "offline"
    );

    return false;
  }

  if (
    !window.GVAuth?.isConfigured?.()
  ) {
    updateSyncStatus(
      "Local",
      "local"
    );

    return false;
  }

  if (
    syncInFlight
  ) {
    return false;
  }

  syncInFlight = true;

  try {
    updateSyncStatus(
      "Checking cloud…",
      "syncing"
    );

    const auth =
      await requireCloudManager();

    const queued =
      getSyncQueue();

    const gateway =
      getCloudDataGateway();

    const health =
      typeof gateway.health ===
      "function"
        ? await gateway.health()
        : null;

    /*
     * Do not write transaction records until the schema
     * adapter exists. Authentication/RLS has already been
     * validated separately and this keeps the application
     * safely local-first rather than sending malformed rows.
     */
    if (
      !cloudSyncAdapterReady()
    ) {
      const meta =
        getSyncMeta();

      meta.lastAuthCheck =
        Date.now();

      meta.lastAuthCompanyId =
        auth?.profile?.company_id ||
        null;

      meta.cloudGatewayReady =
        health?.ok === true;

      setSyncMeta(
        meta
      );

      if (
        queued.length
      ) {
        updateSyncStatus(
          "Cloud connected · local queue protected",
          "online"
        );
      } else {
        updateSyncStatus(
          "Cloud connected",
          "online"
        );
      }

      return true;
    }

    /*
     * Reserved for the schema-adapter phase.
     */
    const supported =
      new Set(
        getSupportedCloudResources()
      );

    const mergedByResource = {};

    for (
      const resource of SYNC_RESOURCES
    ) {
      const cloudName =
        resourceCloudName(
          resource
        );

      if (
        !supported.has(
          cloudName
        )
      ) {
        continue;
      }

      const stateName =
        resourceStateName(
          resource
        );

      mergedByResource[
        resource
      ] =
        Array.isArray(
          state[stateName]
        )
          ? state[stateName]
          : [];
    }

    const base =
      serverSnapshot || {};

    const allConflicts = [];

    for (
      const resource of Object.keys(
        mergedByResource
      )
    ) {
      const result =
        threeWayMergeResource(
          resource,
          base[resource] || [],
          mergedByResource[
            resource
          ] || [],
          []
        );

      mergedByResource[
        resource
      ] =
        result.merged;

      allConflicts.push(
        ...result.conflicts
      );
    }

    if (
      allConflicts.length
    ) {
      safeLocalStorageSet(
        SYNC_KEYS.conflicts,
        JSON.stringify(
          allConflicts.slice(-100)
        )
      );
    }

    return true;
    } catch (e) {
    const message =
      String(
        e?.message ||
        e ||
        ""
      );

    const authenticationRequired =
      /Manager authentication is required|authentication.*required|manager.*authentication/i
        .test(message);

    if (authenticationRequired) {
      updateSyncStatus(
        "Signed out",
        "local"
      );

      return false;
    }

    const online =
      navigator.onLine;

    updateSyncStatus(
      online
        ? "Sync error"
        : "Offline",
      online
        ? "error"
        : "offline"
    );

    console.warn(
      "GotaVita Supabase sync:",
      e?.message || e
    );

    return false;
  } finally {
    syncInFlight =
      false;
  }
}

async function syncNow() {
  const ok =
    await syncChangedResources(
      true
    );

  if (ok) {
    showToast(
      "Cloud connection verified. Local changes remain safely queued until transaction sync mapping is enabled."
    );
  } else if (
    navigator.onLine
  ) {
    showToast(
      "Cloud synchronization could not be verified. Local changes remain protected.",
      "error"
    );
  }

  return !!ok;
}

async function loadServerState() {
  if (
    window.location.protocol ===
    "file:"
  ) {
    updateSyncStatus(
      "Local",
      "local"
    );

    return false;
  }

  if (
    !navigator.onLine
  ) {
    updateSyncStatus(
      "Offline",
      "offline"
    );

    return false;
  }

  if (
    !window.GVAuth?.isConfigured?.()
  ) {
    updateSyncStatus(
      "Local",
      "local"
    );

    return false;
  }

  try {
    updateSyncStatus(
      "Connecting…",
      "syncing"
    );

    const auth =
      await requireCloudManager();

    const gateway =
      getCloudDataGateway();

    const health =
      await gateway.health();

    const meta =
      getSyncMeta();

    meta.lastAuthCheck =
      Date.now();

    meta.lastAuthCompanyId =
      auth?.profile?.company_id ||
      null;

    meta.cloudGatewayReady =
      health?.ok === true;

    setSyncMeta(
      meta
    );

    serverSnapshot =
      serverSnapshot || {};

    syncLocalMirror =
      clone(state);

    /*
     * No /api/data call here.
     * The legacy API has been retired.
     */
    updateSyncStatus(
      "Online · Supabase connected",
      "online"
    );

    return true;
  } catch (e) {
    updateSyncStatus(
      "Offline",
      "offline"
    );

    console.warn(
      "GotaVita Supabase unavailable; using local cache:",
      e?.message || e
    );

    return false;
  }
}
let syncReliabilityInterval = null;
let syncReliabilityAuthListener = null;

function stopSyncReliability() {
  if (syncReliabilityInterval) {
    clearInterval(syncReliabilityInterval);
    syncReliabilityInterval = null;
  }
}

function startSyncReliability() {
  stopSyncReliability();

  syncReliabilityInterval = setInterval(() => {
    if (
      navigator.onLine &&
      window.GVAuth?.getSession
    ) {
      syncChangedResources(false);
    }
  }, 15000);
}

function initSyncReliability() {
  getDeviceId();

  window.addEventListener(
    "online",
    () => {
      updateSyncStatus(
        "Reconnecting…",
        "syncing"
      );

      syncChangedResources(true);
    }
  );

  window.addEventListener(
    "offline",
    () =>
      updateSyncStatus(
        "Offline",
        "offline"
      )
  );

  document.addEventListener(
    "visibilitychange",
    () => {
      if (
        document.visibilityState === "visible" &&
        navigator.onLine
      ) {
        syncChangedResources(false);
      }
    }
  );

  syncReliabilityAuthListener = async (event) => {
    const authenticated =
      event?.detail?.authenticated === true;

    if (authenticated) {
      startSyncReliability();
      syncChangedResources(false);
    } else {
      stopSyncReliability();

      updateSyncStatus(
        "Signed out",
        "local"
      );
    }
  };

  window.addEventListener(
    "gv-auth-state-changed",
    syncReliabilityAuthListener
  );
window.addEventListener(
  "gv-auth-state-changed",
  async (event) => {
    const authenticated =
      event?.detail?.authenticated === true;

    if (authenticated) {
  try {
    installProductionHardening();
    installDuplicateOperationGuards();
    installUIEventDelegation();
    installProfessionalPolish();
    installBulkSelectionUX();
    installSearchOptimization();
    initDarkMode();

    if (typeof renderAll === "function") {
      renderAll();
    }

    switchTab("dashboard");
  } catch (error) {
    handleAppError(
      "post-auth-ui-init",
      error,
      {
        userMessage:
          "Manager authorization succeeded, but the application UI could not finish initializing."
      }
    );
  }

  return;
}

    stopSyncReliability();

    try {
      // Clear the in-memory business state so signed-out users
      // cannot continue viewing previously loaded records.
      if (window.GVData?.getState) {
        const appState = window.GVData.getState();

        if (appState && typeof appState === "object") {
          for (const key of Object.keys(appState)) {
            if (Array.isArray(appState[key])) {
              appState[key].length = 0;
            }
          }
        }
      }
    } catch (error) {
      console.warn(
        "GotaVita: failed to clear signed-out state:",
        error
      );
    }

    // Clear the rendered application before showing login.
    try {
      if (typeof renderAll === "function") {
        renderAll();
      }
    } catch (error) {
      console.warn(
        "GotaVita: failed to refresh signed-out UI:",
        error
      );
    }

    if (window.GVAuth?.openLogin) {
      window.GVAuth.openLogin();
    }
  }
);
  startSyncReliability();
}

function persistState() {
  try {
    normalizeState();

    validateDataIntegrity();

    state._meta =
      state._meta || {};

    state._meta.lastUpdated =
      Date.now();

    state._meta.deviceId =
      getDeviceId();

    if (
      !writeLocalStateSnapshot(
        state
      )
    ) {
      handleAppError(
        "persist-state",
        new Error(
          "Local data could not be verified after saving."
        ),
        {
          userMessage:
            "Your changes could not be verified as saved locally. Please export a backup before continuing.",
          fallback: false
        }
      );

      return false;
    }

    const resourcesChanged =
      [];

    if (
      syncLocalMirror
    ) {
      for (
        const resource of SYNC_RESOURCES
      ) {
        const stateName =
          resourceStateName(
            resource
          );

        const before =
          JSON.stringify(
            syncLocalMirror[
              stateName
            ] || []
          );

        const after =
          JSON.stringify(
            state[
              stateName
            ] || []
          );

        if (
          before !==
          after
        ) {
          resourcesChanged.push(
            resource
          );
        }
      }
    } else if (
      window.location.protocol !==
      "file:"
    ) {
      resourcesChanged.push(
        ...SYNC_RESOURCES
      );
    }

    queueSyncResources(
      resourcesChanged
    );

    syncLocalMirror =
      clone(state);

    clearTimeout(
      syncTimer
    );

    syncTimer =
      setTimeout(
        syncChangedResources,
        450
      );

    return true;
  } catch (error) {
    handleAppError(
      "persist-state",
      error,
      {
        userMessage:
          "The change could not be safely saved. Please try again.",
        fallback: false
      }
    );

    return false;
  }
}

/* ---------------- Backups & Restore ---------------- */

async function restoreBackup(
  ts
) {
  const list =
    readAutoBackupList();

  const b =
    list.find(
      (x) =>
        x.timestamp ===
        ts
    );

  if (!b) {
    showToast(
      "Backup not found.",
      "error"
    );

    return;
  }

  const summary =
    describeBackup(b);

  if (
    !(
      await requestConfirmation({
        title:
          "Restore verified backup",

        message:
          "Current data will be replaced by this verified backup.",

        details:
          `Clients: ${summary.clients}\nOrders: ${summary.orders}\nExpenses: ${summary.expenses}\nEmployees: ${summary.employees}`,

        confirmLabel:
          "Restore Backup",

        tone:
          "warning"
      })
    )
  ) {
    return;
  }

  try {
    const payload =
      b.data?.app &&
      b.data?.data
        ? b.data.data
        : (
            b.data?.data ||
            b.data
          );

    const checked =
      validateBackupPayload(
        payload
      );

    saveStateForUndo();

    if (
      !makeAutoBackup(
        false
      )
    ) {
      throw new Error(
        "Safety backup could not be created; restore cancelled."
      );
    }

    const previousState =
      getStateSnapshot();

    try {
      replaceState(
        checked.data
      );

      if (
        !persistState()
      ) {
        throw new Error(
          "Restored data could not be verified locally; previous data was restored."
        );
      }

      audit(
        "restore",
        "backup",
        ts,
        {
          sourceSummary:
            checked.summary
        }
      );

      renderAll();

      showToast(
        "Backup restored and verified."
      );
    } catch (
      restoreError
    ) {
      replaceState(
        previousState,
        {
          normalize:
            false
        }
      );

      persistState();
      renderAll();

      throw restoreError;
    }
  } catch (e) {
    showToast(
      "Restore blocked: " +
        e.message,
      "error"
    );
  }
}

async function resetToSeed() {
  const seedPreview = {
    clients:
      (
        SEED.clients ||
        []
      ).length,

    products:
      (
        SEED.products ||
        []
      ).length,

    orders:
      (
        SEED.orders ||
        []
      ).length,

    expenses:
      (
        SEED.expenses ||
        []
      ).length
  };

  if (
    !(
      await requestConfirmation({
        title:
          "Reset to seed data",

        message:
          "Reset the transactional data to the original seed dataset?",

        details:
          `Clients: ${seedPreview.clients}\nProducts: ${seedPreview.products}\nOrders: ${seedPreview.orders}\nExpenses: ${seedPreview.expenses}\n\nA safety backup will be created first.`,

        confirmLabel:
          "Reset Data",

        tone:
          "danger"
      })
    )
  ) {
    return;
  }

  saveStateForUndo();
  makeAutoBackup(false);

  seedState();
  normalizeState();

  audit(
    "reset",
    "system",
    "seed",
    {
      seedPreview
    }
  );

  persistState();
  renderAll();

  showToast(
    "Restored initial seed dataset. Safety backup created."
  );
}

/* ---------------- UI Theme & Navigation ---------------- */

function toggleDarkMode() {
  const isDark =
    document.body.getAttribute(
      "data-theme"
    ) === "dark";

  applyTheme(
    isDark
      ? "light"
      : "dark"
  );
}

function initDarkMode() {
  document.documentElement.classList.add(
    "theme-initializing"
  );

  const saved =
    safeLocalStorageGet(
      KEYS.darkMode,
      "light"
    ) === "dark"
      ? "dark"
      : "light";

  document.body.setAttribute(
    "data-theme",
    saved
  );

  document.documentElement.style.colorScheme =
    saved === "dark"
      ? "dark"
      : "light";

  const label =
    $("darkModeText");

  if (label) {
    label.textContent =
      saved === "dark"
        ? "Light Mode"
        : "Dark Mode";
  }
}

function applyTheme(
  theme
) {
  const next =
    theme === "dark"
      ? "dark"
      : "light";

  document.body.setAttribute(
    "data-theme",
    next
  );

  document.documentElement.style.colorScheme =
    next === "dark"
      ? "dark"
      : "light";

  const label =
    $("darkModeText");

  if (label) {
    label.textContent =
      next === "dark"
        ? "Light Mode"
        : "Dark Mode";
  }

  safeLocalStorageSet(
    KEYS.darkMode,
    next
  );
}

function moveUnderline(
  btn
) {
  const u =
    $("tabUnderline");

  if (!u || !btn) {
    return;
  }

  u.style.width =
    btn.offsetWidth +
    "px";

  u.style.transform =
    `translateX(${
      btn.offsetLeft
    }px)`;
}

function switchTab(
  name,
  options = {}
) {
  const btn =
    document.querySelector(
      `.tab[data-tab="${CSS.escape(
        name
      )}"]`
    );

  if (!btn) {
    return;
  }

  const alreadyActive =
    btn.classList.contains(
      "active"
    );

  document
    .querySelectorAll(
      ".tab"
    )
    .forEach(
      (t) => {
        const active =
          t === btn;

        t.classList.toggle(
          "active",
          active
        );

        t.setAttribute(
          "aria-selected",
          String(
            active
          )
        );

        t.setAttribute(
          "tabindex",
          active
            ? "0"
            : "-1"
        );
      }
    );

  document
    .querySelectorAll(
      ".panel"
    )
    .forEach(
      (p) => {
        const active =
          p.id ===
          "panel-" +
            name;

        p.classList.toggle(
          "active",
          active
        );

        if (active) {
          p.setAttribute(
            "aria-hidden",
            "false"
          );
        } else {
          p.setAttribute(
            "aria-hidden",
            "true"
          );
        }
      }
    );

  moveUnderline(
    btn
  );

  btn.scrollIntoView({
    inline:
      "nearest",
    block:
      "nearest",
    behavior:
      "auto"
  });

  if (
    location.hash !==
    "#" + name
  ) {
    history.replaceState(
      null,
      "",
      "#" + name
    );
  }

  if (
    options.scroll !==
    false
  ) {
    window.scrollTo({
      top: 0,
      behavior: "auto"
    });
  }

  if (
    name ===
      "neworder" &&
    !alreadyActive
  ) {
    requestAnimationFrame(
      () => {
        const client =
          $("clientSelect");

        if (
          client &&
          !client.value
        ) {
          client.focus();
        } else {
          $("gallons")?.focus();
        }
      }
    );
  }
}

/* ---------------- Orders & Operations ---------------- */

function handleOrderDateFilterChange() {
  const filter =
    $("orderDateFilter")
      ?.value ||
    "all";

  const custom =
    filter ===
    "custom";

  if (
    $("orderDateFromWrap")
  ) {
    $("orderDateFromWrap").style.display =
      custom
        ? "flex"
        : "none";
  }

  if (
    $("orderDateToWrap")
  ) {
    $("orderDateToWrap").style.display =
      custom
        ? "flex"
        : "none";
  }

  renderAllOrderViews();
}

function resetOrderDateFilter() {
  if (
    $("orderDateFilter")
  ) {
    $("orderDateFilter").value =
      "all";
  }

  if (
    $("orderDateFrom")
  ) {
    $("orderDateFrom").value =
      "";
  }

  if (
    $("orderDateTo")
  ) {
    $("orderDateTo").value =
      "";
  }

  handleOrderDateFilterChange();
}

async function deleteExpense(
  id
) {
  const item =
    state.expenses.find(
      (x) =>
        idsEqual(
          x.id,
          id
        )
    );

  if (!item) {
    return;
  }

  if (
    !(
      await requestConfirmation({
        title:
          "Delete expense",

        message:
          `Delete expense ${peso(
            item.amount
          )} for ${
            item.category ||
            "this record"
          }?`,

        details:
          "A safety backup will be created first.",

        confirmLabel:
          "Delete Expense"
      })
    )
  ) {
    return;
  }

  saveStateForUndo();
  makeAutoBackup(
    false
  );

  state.expenses =
    state.expenses.filter(
      (x) =>
        !idsEqual(
          x.id,
          id
        )
    );

  audit(
    "delete",
    "expense",
    id,
    {
      before: item
    }
  );

  persistState();
  renderAll();

  showToast(
    "Expense deleted. Safety backup created."
  );
}

/* ---------------- UNIFORM ORDER LISTING UI Across Tabs ---------------- */

function sortRows(
  rows,
  cfg
) {
  // Sort a copy so UI sorting never mutates shared application state.
  return (
    Array.isArray(rows)
      ? rows.slice()
      : []
  ).sort(
    (a, b) => {
      let x =
        a[cfg.column];

      let y =
        b[cfg.column];

      if (
        typeof x ===
        "string"
      ) {
        x =
          x.toLowerCase();

        y =
          String(
            y || ""
          ).toLowerCase();
      }

      if (x < y) {
        return cfg.asc
          ? -1
          : 1;
      }

      if (x > y) {
        return cfg.asc
          ? 1
          : -1;
      }

      return 0;
    }
  );
}

function normalizeSearchText(
  value
) {
  return String(
    value ?? ""
  )
    .normalize("NFD")
    .replace(
      /[\u0300-\u036f]/g,
      ""
    )
    .toLowerCase()
    .trim();
}

function searchHaystack(
  values
) {
  return normalizeSearchText(
    values
      .filter(
        (v) =>
          v !==
            undefined &&
          v !== null
      )
      .join(" ")
  );
}

const searchDebounceTimers =
  new Map();

const lazyListStates =
  new Map();

const LAZY_LIST_INITIAL =
  50;

const LAZY_LIST_CHUNK =
  50;

function renderLazyList(
  containerId,
  items,
  rowRenderer,
  emptyHtml,
  options = {}
) {
  const container =
    $(containerId);

  if (!container) {
    return;
  }

  const initial =
    Math.max(
      1,
      Number(
        options.initial
      ) ||
        LAZY_LIST_INITIAL
    );

  const chunk =
    Math.max(
      1,
      Number(
        options.chunk
      ) ||
        LAZY_LIST_CHUNK
    );

  const key =
    String(
      containerId
    );

  const list =
    Array.isArray(items)
      ? items.slice()
      : [];

  lazyListStates.set(
    key,
    {
      list,
      rowRenderer,
      chunk,
      colspan:
        Number(
          options.colspan
        ) || 10
    }
  );

  container.dataset.lazyColspan =
    String(
      Number(
        options.colspan
      ) || 10
    );

  if (!list.length) {
    container.innerHTML =
      emptyHtml;

    return;
  }

  renderLazyListChunk(
    key,
    initial,
    true
  );
}

function renderLazyListChunk(
  containerId,
  nextCount,
  replace = false
) {
  const state =
    lazyListStates.get(
      String(
        containerId
      )
    );

  const container =
    $(containerId);

  if (
    !state ||
    !container
  ) {
    return;
  }

  const currentCount =
    replace
      ? 0
      : Number(
          container.dataset
            .lazyRendered ||
            0
        );

  const targetCount =
    Math.min(
      state.list.length,
      Math.max(
        nextCount,
        currentCount
      )
    );

  const start =
    replace
      ? 0
      : currentCount;

  const html =
    state.list
      .slice(
        start,
        targetCount
      )
      .map(
        state.rowRenderer
      )
      .join("");

  if (replace) {
    container.innerHTML =
      html;
  } else {
    container
      .querySelector(
        "[data-lazy-more]"
      )
      ?.remove();

    container.insertAdjacentHTML(
      "beforeend",
      html
    );
  }

  container.dataset.lazyRendered =
    String(
      targetCount
    );

  container
    .querySelector(
      "[data-lazy-more]"
    )
    ?.remove();

  if (
    targetCount <
    state.list.length
  ) {
    const remaining =
      state.list.length -
      targetCount;

    const label =
      `Load more (${Math.min(
        state.chunk,
        remaining
      )} of ${remaining} remaining)`;

    const isTable =
      container.tagName ===
      "TBODY";

    const marker = isTable
      ? `<tr data-lazy-more><td colspan="${
          Number(
            container.dataset
              .lazyColspan
          ) || 10
        }" class="lazy-load-more-cell"><button type="button" class="btn ghost tiny" data-action="lazyLoadMore" data-action-args='[${jsAttrArg(
          containerId
        )}]'>${label}</button></td></tr>`
      : `<div data-lazy-more class="lazy-load-more"><button type="button" class="btn ghost tiny" data-action="lazyLoadMore" data-action-args='[${jsAttrArg(
          containerId
        )}]'>${label}</button></div>`;

    container.insertAdjacentHTML(
      "beforeend",
      marker
    );
  }
}

function lazyLoadMore(
  containerId
) {
  const state =
    lazyListStates.get(
      String(
        containerId
      )
    );

  const container =
    $(containerId);

  if (
    !state ||
    !container
  ) {
    return;
  }

  const rendered =
    Number(
      container.dataset
        .lazyRendered ||
        0
    );

  renderLazyListChunk(
    containerId,
    rendered +
      state.chunk,
    false
  );
}

function debounceSearchRender(
  inputId,
  renderFn,
  delay = 140
) {
  const key =
    String(
      inputId
    );

  const prior =
    searchDebounceTimers.get(
      key
    );

  if (prior) {
    clearTimeout(prior);
  }

  const timer =
    setTimeout(
      () => {
        searchDebounceTimers.delete(
          key
        );

        try {
          renderFn();
        } catch (error) {
          handleAppError(
            `search:${key}`,
            error,
            {
              userMessage:
                "Search could not be refreshed. Please try again."
            }
          );
        }
      },
      delay
    );

  searchDebounceTimers.set(
    key,
    timer
  );
}

function installSearchOptimization() {
  const config = {
    orderSearchInput:
      renderOrderLog,

    billingSearchInput:
      renderCompletedTransactions,

    allOrdersSearchInput:
      renderAllOrders,

    expenseSearchInput:
      renderExpenseLog,

    clientSearchInput:
      renderClientDirectory,

    empSearchInput:
      renderEmployees,

    groupManageSearch:
      renderGroupManager
  };

  Object.entries(
    config
  ).forEach(
    ([id, fn]) => {
      const input =
        $(id);

      if (
        !input ||
        input.dataset
          .searchOptimized ===
          "true"
      ) {
        return;
      }

      input.dataset
        .searchOptimized =
        "true";

      input.dataset
        .searchRender =
        fn.name;

      input.removeAttribute(
        "onkeyup"
      );

      input.addEventListener(
        "input",
        () =>
          debounceSearchRender(
            id,
            fn
          )
      );

      input.addEventListener(
        "search",
        () =>
          debounceSearchRender(
            id,
            fn,
            0
          )
      );
    }
  );
}

function tableRenderClass(
  rowCount
) {
  return Number(
    rowCount
  ) >= 100
    ? ""
    : "animate__animated animate__fadeIn";
}

function renderTableHtml(
  rows,
  rowRenderer,
  emptyHtml
) {
  if (!rows.length) {
    return emptyHtml;
  }

  return rows
    .map(rowRenderer)
    .join("");
}

async function deleteOrder(
  id
) {
  const target =
    state.orders.find(
      (x) =>
        idsEqual(
          x.id,
          id
        )
    );

  if (!target) {
    return;
  }

  const isCompleted =
    target.status ===
    "Paid";

  const details =
    isCompleted
      ? "This order is marked Paid/completed. Archiving removes it from active transaction views but preserves it in the archive. A safety backup will be created first."
      : "The order will be moved to the recoverable archive. A safety backup will be created first.";

  if (
    !(
      await requestConfirmation({
        title:
          isCompleted
            ? "Archive completed order"
            : "Archive order",

        message:
          `Move Order #${target.orderNumber} to archive?`,

        details,

        confirmLabel:
          "Archive Order",

        tone:
          isCompleted
            ? "warning"
            : "danger"
      })
    )
  ) {
    return;
  }

  saveStateForUndo();

  if (
    !makeAutoBackup(
      false
    )
  ) {
    showToast(
      "Safety backup could not be created. Order was not archived.",
      "error"
    );

    return;
  }

  archiveOrders(
    [id],
    "single-order"
  );

  persistState();
  renderPartial(
    "orders"
  );

  showToast(
    "Order archived."
  );
}

function getBulkCheckboxes(
  kind
) {
  const selector =
    kind === "active"
      ? ".order-checkbox"
      : kind === "billing"
        ? ".billing-checkbox"
        : ".all-order-checkbox";

  return Array.from(
    document.querySelectorAll(
      selector
    )
  );
}

function getSelectedBulkIds(
  kind
) {
  return getBulkCheckboxes(
    kind
  )
    .filter(
      (c) =>
        c.checked
    )
    .map(
      (c) =>
        c.value
    );
}

function updateBulkSelectionUI(
  kind
) {
  const ids =
    getSelectedBulkIds(
      kind
    );

  const countId =
    kind === "active"
      ? "activeBulkSelectionCount"
      : kind ===
          "billing"
        ? "billingBulkSelectionCount"
        : "allOrdersBulkSelectionCount";

  const el =
    $(countId);

  if (el) {
    el.textContent =
      `${ids.length} selected`;
  }

  return ids;
}

function clearBulkSelection(
  kind
) {
  getBulkCheckboxes(
    kind
  ).forEach(
    (c) =>
      (c.checked = false)
  );

  const master =
    document.querySelector(
      kind ===
        "active"
        ? ".subpanel.active .order-checkbox"
        : kind ===
            "billing"
          ? ".subpanel.active .billing-checkbox"
          : ".subpanel.active .all-order-checkbox"
    );

  if (master) {
    master.checked =
      false;
  }

  updateBulkSelectionUI(
    kind
  );

  const actionEl =
    $(
      kind ===
        "active"
        ? "bulkAction"
        : kind ===
            "billing"
          ? "billingBulkAction"
          : "allOrdersBulkAction"
    );

  if (actionEl) {
    actionEl.value =
      "";
  }
}

function toggleSelectAllOrders(
  master
) {
  getBulkCheckboxes(
    "active"
  ).forEach(
    (c) =>
      (c.checked =
        Boolean(
          master.checked
        ))
  );

  updateBulkSelectionUI(
    "active"
  );
}

async function applyBulkAction() {
  const action =
    $("bulkAction").value;

  const ids =
    getSelectedBulkIds(
      "active"
    );

  if (
    !action ||
    !ids.length
  ) {
    showToast(
      "Select orders and an action.",
      "error"
    );

    return;
  }

  if (
    action ===
    "group"
  ) {
    openGroupPicker(
      ids
    );

    return;
  }

  if (
    action ===
      "delete" &&
    !(
      await requestConfirmation({
        title:
          "Archive active orders",

        message:
          `Archive ${ids.length} active order(s)?`,

        details:
          "A safety backup will be created first.",

        confirmLabel:
          "Archive Orders"
      })
    )
  ) {
    return;
  }

  saveStateForUndo();

  if (
    action ===
    "delete"
  ) {
    archiveOrders(
      ids,
      "bulk-order"
    );
  } else if (
    action ===
    "ungroup"
  ) {
    state.orderGroups.forEach(
      (g) => {
        g.orderIds =
          (
            g.orderIds ||
            []
          ).filter(
            (x) =>
              !ids.some(
                (id) =>
                  idsEqual(
                    x,
                    id
                  )
              )
          );
      }
    );
  } else {
    state.orders.forEach(
      (o) => {
        if (
          o.status !==
            "Cancelled" &&
          ids.some(
            (id) =>
              idsEqual(
                id,
                o.id
              )
          ) &&
          applyOrderStatus(
            o,
            action
          )
        ) {
          audit(
            "update",
            "order",
            o.id,
            {
              status:
                action,
              source:
                "bulk"
            }
          );
        }
      }
    );

    if (
      action ===
      "Paid"
    ) {
      confetti();
    }
  }

  persistState();
  renderPartial(
    "orders"
  );

  $("bulkAction").value =
    "";

  showToast(
    `${ids.length} order(s) updated.`
  );
}

function toggleSelectAllBilling(
  master
) {
  getBulkCheckboxes(
    "billing"
  ).forEach(
    (c) =>
      (c.checked =
        Boolean(
          master.checked
        ))
  );

  updateBulkSelectionUI(
    "billing"
  );
}

async function applyBillingBulkAction() {
  const action =
    $("billingBulkAction").value;

  const ids =
    getSelectedBulkIds(
      "billing"
    );

  if (
    !action ||
    !ids.length
  ) {
    showToast(
      "Select orders and an action.",
      "error"
    );

    return;
  }

  if (
    action ===
    "group"
  ) {
    openGroupPicker(
      ids
    );

    $("billingBulkAction").value =
      "";

    return;
  }

  if (
    action === "delete" &&
    !(
      await requestConfirmation({
        title:
          "Archive completed orders",

        message:
          `Archive ${ids.length} completed order(s)?`,

        details:
          "A safety backup will be created first.",

        confirmLabel:
          "Archive Orders"
      })
    )
  ) {
    $("billingBulkAction").value =
      "";

    return;
  }

  saveStateForUndo();

  if (
    action ===
    "ungroup"
  ) {
    state.orderGroups.forEach(
      (g) =>
        (g.orderIds =
          (
            g.orderIds ||
            []
          ).filter(
            (x) =>
              !ids.some(
                (id) =>
                  idsEqual(
                    id,
                    x
                  )
              )
          ))
    );
  } else if (
    action ===
    "delete"
  ) {
    archiveOrders(
      ids,
      "completed-bulk-order"
    );
  } else {
    const status =
      action ===
      "unpaid"
        ? "Unpaid"
        : action;

    state.orders.forEach(
      (o) => {
        if (
          o.status !==
            "Cancelled" &&
          ids.some(
            (id) =>
              idsEqual(
                id,
                o.id
              )
          ) &&
          applyOrderStatus(
            o,
            status
          )
        ) {
          audit(
            "update",
            "order",
            o.id,
            {
              status,
              source:
                "bulk"
            }
          );
        }
      }
    );
  }

  persistState();
  renderPartial(
    "orders"
  );

  $("billingBulkAction").value =
    "";

  showToast(
    `${ids.length} completed order(s) updated.`
  );
}

function toggleSelectAllAllOrders(
  master
) {
  getBulkCheckboxes(
    "all"
  ).forEach(
    (c) =>
      (c.checked =
        Boolean(
          master.checked
        ))
  );

  updateBulkSelectionUI(
    "all"
  );
}

async function applyAllOrdersBulkAction() {
  const action =
    $("allOrdersBulkAction").value;

  const ids =
    getSelectedBulkIds(
      "all"
    );

  if (
    !action ||
    !ids.length
  ) {
    showToast(
      "Select orders and an action.",
      "error"
    );

    return;
  }

  if (
    action ===
    "group"
  ) {
    openGroupPicker(
      ids
    );

    $("allOrdersBulkAction").value =
      "";

    return;
  }

  if (
    action ===
      "delete" &&
    !(
      await requestConfirmation({
        title:
          "Archive orders",

        message:
          `Archive ${ids.length} order(s)?`,

        details:
          "A safety backup will be created first.",

        confirmLabel:
          "Archive Orders"
      })
    )
  ) {
    $("allOrdersBulkAction").value =
      "";

    return;
  }

  saveStateForUndo();

  if (
    action ===
    "ungroup"
  ) {
    state.orderGroups.forEach(
      (g) =>
        (g.orderIds =
          (
            g.orderIds ||
            []
          ).filter(
            (x) =>
              !ids.some(
                (id) =>
                  idsEqual(
                    id,
                    x
                  )
              )
          ))
    );
  } else if (
    action ===
    "delete"
  ) {
    archiveOrders(
      ids,
      "all-orders-bulk-order"
    );
  } else {
    state.orders.forEach(
      (o) => {
        if (
          ids.some(
            (id) =>
              idsEqual(
                id,
                o.id
              )
          ) &&
          applyOrderStatus(
            o,
            action
          )
        ) {
          audit(
            "update",
            "order",
            o.id,
            {
              status:
                action
            }
          );
        }
      }
    );

    if (
      action ===
      "Paid"
    ) {
      confetti();
    }
  }

  persistState();
  renderPartial(
    "orders"
  );

  $("allOrdersBulkAction").value =
    "";

  showToast(
    `${ids.length} order(s) updated.`
  );
}

function installBulkSelectionUX() {
  if (
    document.documentElement
      .dataset
      .bulkSelectionInstalled ===
    "true"
  ) {
    return;
  }

  document.documentElement
    .dataset
    .bulkSelectionInstalled =
    "true";

  document.addEventListener(
    "change",
    (event) => {
      const target =
        event.target;

      if (
        !(target instanceof Element)
      ) {
        return;
      }

      if (
        target.matches(
          ".order-checkbox"
        )
      ) {
        updateBulkSelectionUI(
          "active"
        );
      } else if (
        target.matches(
          ".billing-checkbox"
        )
      ) {
        updateBulkSelectionUI(
          "billing"
        );
      } else if (
        target.matches(
          ".all-order-checkbox"
        )
      ) {
        updateBulkSelectionUI(
          "all"
        );
      }
    }
  );
}

function renderUnpaidReceivables() {
  const tb =
    $("receivablesTableBody");

  if (!tb) {
    return;
  }

  const map = {};

  state.orders
    .filter(
      (o) =>
        o.status ===
          "Unpaid" ||
        o.status ===
          "Pending"
    )
    .forEach(
      (o) => {
        const k =
          o.clientName ||
          "Unknown";

        if (!map[k]) {
          map[k] = {
            name: k,
            orders: 0,
            containers: 0,
            balance: 0
          };
        }

        map[k].orders++;

        map[k].containers +=
          Number(
            o.gallons
          ) || 0;

        map[k].balance +=
          Number(
            o.total
          ) || 0;
      }
    );

  const rows =
    Object.values(
      map
    );

  const c =
    sortConfig.receivables;

  rows.sort(
    (a, b) => {
      const av =
        c.column ===
        "name"
          ? a.name.toLowerCase()
          : Number(
              a[c.column]
            ) || 0;

      const bv =
        c.column ===
        "name"
          ? b.name.toLowerCase()
          : Number(
              b[c.column]
            ) || 0;

      if (av === bv) {
        return 0;
      }

      return av < bv
        ? c.asc
          ? -1
          : 1
        : c.asc
          ? 1
          : -1;
    }
  );

  if (!rows.length) {
    tb.innerHTML =
      '<tr><td colspan="5" class="empty">No receivables. 🎉</td></tr>';

    return;
  }

  tb.innerHTML =
    rows
      .map(
        (r) =>
          `<tr>` +
          `<td><b>${esc(
            r.name
          )}</b></td>` +
          `<td>${r.orders}</td>` +
          `<td>${r.containers}</td>` +
          `<td><b class="bad">${peso(
            r.balance
          )}</b></td>` +
          `<td><button class="btn ghost tiny" data-action="openClientMiniPopup" data-action-args='[${jsAttrArg(
            r.name
          )}]'>View</button></td>` +
          `</tr>`
      )
      .join("");
}

function sortReceivables(
  col
) {
  const c =
    sortConfig.receivables;

  c.asc =
    c.column === col
      ? !c.asc
      : true;

  c.column =
    col;

  renderUnpaidReceivables();
}

async function settleClientAccount(
  name
) {
  if (
    !(
      await requestConfirmation({
        title:
          "Mark open orders paid",

        message:
          `Mark all open orders for ${name} as paid?`,

        confirmLabel:
          "Mark Paid",

        tone:
          "warning"
      })
    )
  ) {
    return;
  }

  saveStateForUndo();

  state.orders.forEach(
    (o) => {
      if (
        o.clientName ===
          name &&
        o.status !==
          "Paid"
      ) {
        o.status =
          "Paid";
      }
    }
  );

  persistState();
  renderAll();
  confetti();

  showToast(
    `${name}'s account settled.`
  );
}

/* ---------------- GROUPS AND DELIVERY ROUTES ---------------- */

async function disbandGroup(
  i
) {
  const g =
    state.orderGroups[i];

  if (!g) {
    return;
  }

  if (
    !(
      await requestConfirmation({
        title:
          "Disband delivery group",

        message:
          `Disband delivery group "${g.name}"?`,

        details:
          "A safety backup will be created first.",

        confirmLabel:
          "Disband Group"
      })
    )
  ) {
    return;
  }

  saveStateForUndo();
  makeAutoBackup(false);

  state.orderGroups.splice(
    i,
    1
  );

  audit(
    "delete",
    "orderGroup",
    g.id || i,
    {
      name:
        g.name,
      orderIds:
        g.orderIds ||
        []
    }
  );

  persistState();
  renderPartial(
    "groups"
  );

  showToast(
    "Group disbanded. Safety backup created."
  );
}

async function clearAllGroups() {
  if (
    !state.orderGroups.length
  ) {
    showToast(
      "No delivery groups to remove.",
      "error"
    );

    return;
  }

  if (
    !(
      await requestConfirmation({
        title:
          "Remove all delivery groups",

        message:
          `Remove all ${state.orderGroups.length} delivery groups?`,

        details:
          "A safety backup will be created first.",

        confirmLabel:
          "Remove Groups"
      })
    )
  ) {
    return;
  }

  saveStateForUndo();
  makeAutoBackup(false);

  const count =
    state.orderGroups.length;

  state.orderGroups =
    [];

  audit(
    "purge",
    "orderGroups",
    "",
    {
      count
    }
  );

  persistState();
  renderPartial(
    "groups"
  );

  showToast(
    "All delivery groups removed. Safety backup created."
  );
}

/* ---------------- Clients ---------------- */

async function deleteClient(
  id
) {
  const client =
    state.clients.find(
      (c) =>
        String(
          c.id
        ) ===
        String(id)
    );

  if (!client) {
    showToast(
      "Client record not found.",
      "error"
    );

    return;
  }

  if (
    client.active ===
    false
  ) {
    showToast(
      "Client is already archived.",
      "error"
    );

    return;
  }

  const relatedOrders =
    state.orders.filter(
      (o) =>
        o.clientName ===
        client.name
    );

  const stats =
    calculateClientStats(
      client
    );

  const risk = [];

  if (
    relatedOrders.length
  ) {
    risk.push(
      `${relatedOrders.length} existing order(s) will remain in history`
    );
  }

  if (
    Number(stats.due) ||
    0
  > 0) {
    risk.push(
      `${peso(
        stats.due
      )} outstanding receivables`
    );
  }

  if (
    Number(
      stats.outstandingContainers
    ) ||
    0
  > 0) {
    risk.push(
      `${stats.outstandingContainers} unreturned container(s)`
    );
  }

  const message =
    `Archive ${client.name} instead of permanently deleting the client record?`;

  const details =
    `${
      risk.length
        ? risk.join(
            " · "
          ) +
          ". "
        : "No linked transaction risk detected. "
    }The client will be hidden from new-order selection but all historical records will be preserved. A safety backup will be created first.`;

  if (
    !(
      await requestConfirmation({
        title:
          "Archive client",

        message,

        details,

        confirmLabel:
          "Archive Client",

        tone:
          "warning"
      })
    )
  ) {
    return;
  }

  saveStateForUndo();

  if (
    !makeAutoBackup(
      false
    )
  ) {
    showToast(
      "Safety backup could not be created. Client was not archived.",
      "error"
    );

    return;
  }

  const before =
    clone(client);

  client.active =
    false;

  client.archivedAt =
    new Date().toISOString();

  client.updatedAt =
    client.archivedAt;

  audit(
    "archive",
    "client",
    client.id,
    {
      before,
      preservedOrders:
        relatedOrders.length,
      receivables:
        Number(
          stats.due
        ) || 0,
      outstandingContainers:
        Number(
          stats.outstandingContainers
        ) || 0
    }
  );

  persistState();
  resetClientForm();
  renderAll();

  showToast(
    "Client archived. Historical records preserved."
  );
}

/* ---------------- Leaderboard & Insights ---------------- */

function generateAiInsights() {
  const el =
    $("aiInsights");

  if (!el) {
    return;
  }

  const out = [];

  const paid =
    state.orders.filter(
      (o) =>
        o.status ===
        "Paid"
    );

  const revenue =
    paid.reduce(
      (s, o) =>
        s +
        orderTotal(o),
      0
    );

  const expense =
    state.expenses.reduce(
      (s, o) =>
        s +
        (o.amount || 0),
      0
    );

  const due =
    state.orders
      .filter(
        (o) =>
          o.status !==
          "Paid"
      )
      .reduce(
        (s, o) =>
          s +
          orderTotal(o),
        0
      );

  out.push(
    `<b>Schedule Note:</b> Operating hours are Mon–Sat, 7:00 AM – 7:00 PM.`
  );

  out.push(
    `Net balance stands at <b>${peso(
      revenue -
        expense
    )}</b> across ${state.orders.length} recorded orders.`
  );

  if (due > 0) {
    out.push(
      `Outstanding receivables total <b class="bad">${peso(
        due
      )}</b>.`
    );
  }

  el.innerHTML =
    out
      .map(
        (t) =>
          `<div style="padding:12px; background:var(--primary-light); border-radius:var(--radius-sm); margin-bottom:10px; font-size:0.9rem;" class="animate__animated animate__fadeInRight">${t}</div>`
      )
      .join("");
}

/* ---------------- EMPLOYEES & MINI-PROFILES ---------------- */

async function deleteEmployee(
  id
) {
  const emp =
    state.employees.find(
      (x) =>
        String(x.id) ===
        String(id)
    );

  if (!emp) {
    return;
  }

  if (
    (
      emp.status ||
      "Active"
    ) ===
    "Inactive"
  ) {
    showToast(
      "Employee is already inactive.",
      "error"
    );

    return;
  }

  const linkedExpenses =
    state.expenses.filter(
      (x) =>
        String(
          x.employeeId ||
            ""
        ) ===
        String(id)
    );

  if (
    !(
      await requestConfirmation({
        title:
          "Deactivate employee",

        message:
          `Deactivate ${emp.name}?`,

        details:
          `${
            linkedExpenses.length
              ? linkedExpenses.length +
                " linked expense record(s) will remain preserved. "
              : "No linked expense records. "
          }The employee record and payroll history will be retained.`,

        confirmLabel:
          "Deactivate Employee",

        tone:
          "warning"
      })
    )
  ) {
    return;
  }

  saveStateForUndo();

  if (
    !makeAutoBackup(
      false
    )
  ) {
    showToast(
      "Safety backup could not be created. Employee was not deactivated.",
      "error"
    );

    return;
  }

  const before =
    clone(emp);

  emp.status =
    "Inactive";

  emp.archivedAt =
    new Date().toISOString();

  emp.updatedAt =
    emp.archivedAt;

  audit(
    "deactivate",
    "employee",
    emp.id,
    {
      before,
      linkedExpenses:
        linkedExpenses.length
    }
  );

  persistState();
  renderPartial(
    "employees"
  );

  showToast(
    "Employee deactivated. Payroll history preserved."
  );
}

/* ---------------- Save Daily & Weekly Reports ---------------- */

async function deleteDailyReport(
  id
) {
  if (
    !(
      await requestConfirmation({
        title:
          "Delete report",

        message:
          "Delete this report record?",

        details:
          "A safety backup will be created first.",

        confirmLabel:
          "Delete Report"
      })
    )
  ) {
    return;
  }

  saveStateForUndo();
  makeAutoBackup(
    false
  );

  state.dailyReports =
    state.dailyReports.filter(
      (r) =>
        r.id !==
        id
    );

  audit(
    "delete",
    "dailyReport",
    id
  );

  persistState();
  renderDailyReports();

  showToast(
    "Report deleted."
  );
}

async function restoreDeletedOrder(
  id
) {
  const o =
    state.deletedOrders.find(
      (x) =>
        idsEqual(
          x.id,
          id
        )
    );

  if (!o) {
    return;
  }

  if (
    !(
      await requestConfirmation({
        title:
          "Restore archived order",

        message:
          `Restore Order #${o.orderNumber}?`,

        confirmLabel:
          "Restore Order",

        tone:
          "warning"
      })
    )
  ) {
    return;
  }

  saveStateForUndo();

  if (
    state.orders.some(
      (existing) =>
        idsEqual(
          existing.id,
          o.id
        )
    )
  ) {
    showToast(
      "This order already exists in active records.",
      "error"
    );

    return;
  }

  if (
    state.orders.some(
      (existing) =>
        String(
          existing.orderNumber ||
            ""
        ) ===
        String(
          o.orderNumber ||
            ""
        )
    )
  ) {
    showToast(
      "An active order already uses this order number. Restore cancelled to prevent duplication.",
      "error"
    );

    return;
  }

  if (
    !makeAutoBackup(
      false
    )
  ) {
    showToast(
      "Safety backup could not be created. Order was not restored.",
      "error"
    );

    return;
  }

  state.orders.push(
    o
  );

  state.deletedOrders =
    state.deletedOrders.filter(
      (x) =>
        !idsEqual(
          x.id,
          id
        )
    );

  audit(
    "restore",
    "order",
    o.id,
    {
      orderNumber:
        o.orderNumber
    }
  );

  persistState();
  renderAll();

  showToast(
    "Order restored."
  );
}

async function clearDeletedLog() {
  if (
    !state.deletedOrders.length
  ) {
    showToast(
      "Archive is already empty.",
      "error"
    );

    return;
  }

  if (
    !(
      await requestConfirmation({
        title:
          "Permanently clear archive",

        message:
          `Permanently clear ${state.deletedOrders.length} archived order(s)?`,

        details:
          "This cannot be undone. A safety backup will be created first.",

        confirmLabel:
          "Permanently Clear"
      })
    )
  ) {
    return;
  }

  saveStateForUndo();
  makeAutoBackup(
    false
  );

  const count =
    state.deletedOrders.length;

  state.deletedOrders =
    [];

  audit(
    "purge",
    "deletedOrders",
    "",
    {
      count
    }
  );

  persistState();
  renderAll();

  showToast(
    "Archive permanently cleared. Safety backup created."
  );
}

/* ---------------- Receipts & Export / Import ---------------- */

function viewReceipt(
  id
) {
  const o =
    state.orders.find(
      (x) =>
        x.id ===
        id
    );

  if (!o) {
    return;
  }

  $("receiptContent").innerHTML = `
    <div style="text-align:center; margin-bottom:16px;">
      <h2>${BIZ_DETAILS.name}</h2>
      <div class="emp-meta">${BIZ_DETAILS.address}</div>
      <div class="emp-meta">${BIZ_DETAILS.email} <br> ${BIZ_DETAILS.phones}</div>
      <div class="emp-meta" style="margin-top:8px; font-weight:bold;">Official Receipt · ${new Date(o.date).toLocaleString()}</div>
    </div>

    <div style="display:flex; justify-content:space-between; padding:8px 0; border-bottom:1px dashed var(--border)">
      <span>Order #</span>
      <b>${esc(o.orderNumber)}</b>
    </div>

    <div style="display:flex; justify-content:space-between; padding:8px 0; border-bottom:1px dashed var(--border)">
      <span>Client</span>
      <b>${esc(o.clientName)}</b>
    </div>

    <div style="display:flex; justify-content:space-between; padding:8px 0; border-bottom:1px dashed var(--border)">
      <span>Address</span>
      <b style="text-align:right">${esc(o.address || "-")}</b>
    </div>

    <div style="display:flex; justify-content:space-between; padding:8px 0; border-bottom:1px dashed var(--border)">
      <span>Product / Item</span>
      <b>${esc(o.custType)}</b>
    </div>

    <div style="display:flex; justify-content:space-between; padding:8px 0; border-bottom:1px dashed var(--border)">
      <span>Containers / Qty</span>
      <b>${o.gallons}</b>
    </div>

    <div style="display:flex; justify-content:space-between; padding:8px 0; border-bottom:1px dashed var(--border)">
      <span>Unit Rate</span>
      <b>${peso(o.price)}</b>
    </div>

    <div style="display:flex; justify-content:space-between; padding:8px 0; border-bottom:1px dashed var(--border)">
      <span>Payment</span>
      <b>${esc(o.status)}</b>
    </div>

    <div style="display:flex; justify-content:space-between; padding:8px 0; border-bottom:1px dashed var(--border)">
      <span>Delivery</span>
      <b>${esc(o.deliveryStatus || "Not Assigned")}</b>
    </div>

    <div style="display:flex; justify-content:space-between; padding:8px 0; border-bottom:1px dashed var(--border)">
      <span>Empty Returned</span>
      <b>${Number(o.emptyGallonsCollected)||0}</b>
    </div>

    ${
      o.notes
        ? `
          <div style="display:flex; justify-content:space-between; padding:8px 0; border-bottom:1px dashed var(--border)">
            <span>Notes</span>
            <b style="text-align:right">${esc(o.notes)}</b>
          </div>
        `
        : ""
    }

    <div style="display:flex; justify-content:space-between; padding:12px 0; font-size:1.2rem; font-weight:800; color:var(--primary); border-top:2px solid var(--primary); margin-top:10px;">
      <span>TOTAL AMOUNT</span>
      <span>${peso(o.total)}</span>
    </div>

    <p class="emp-meta" style="text-align:center; margin-top:16px">
      Thank you for choosing GotaVita! 💧
    </p>
  `;

  openModal(
    "receiptModal"
  );
}

function printNode(
  id
) {
  const node =
    $(id);

  const w =
    window.open(
      "",
      "_blank",
      "width=450,height=650"
    );

  if (!w) {
    showToast(
      "Allow pop-ups to print documents.",
      "error"
    );

    return;
  }

  w.document.write(`
    <html>
      <head>
        <title>GotaVita Document</title>

        <style>
          body{
            font-family:Quicksand,Arial,sans-serif;
            padding:20px;
            color:#00203d;
            line-height:1.4
          }

          h2{
            text-align:center;
            color:#007aff;
            margin:0 0 6px;
            font-size:1.5rem
          }

          .emp-meta{
            text-align:center;
            color:#5c7b99;
            font-size:12px;
            margin-bottom:6px
          }
        </style>
      </head>

      <body>
        ${node.innerHTML}
      </body>
    </html>
  `);

  w.document.close();
  w.focus();

  setTimeout(
    () =>
      w.print(),
    250
  );
}

function csvCell(
  value
) {
  const text =
    String(
      value ?? ""
    ).replace(
      /"/g,
      '""'
    );

  return `"${text}"`;
}

function renderAuditLog() {
  const tb =
    $("auditTableBody");

  if (!tb) {
    return;
  }

  const rows =
    (
      state.auditLog ||
      []
    )
      .slice()
      .reverse()
      .slice(
        0,
        100
      );

  tb.innerHTML =
    rows.length
      ? rows
          .map(
            (x) =>
              `<tr>` +
              `<td><small>${new Date(
                x.timestamp
              ).toLocaleString()}</small></td>` +
              `<td><span class="badge soft">${esc(
                x.action
              )}</span></td>` +
              `<td>${esc(
                x.entity
              )}</td>` +
              `<td>${esc(
                x.entityId
              )}</td>` +
              `<td><small>${esc(
                JSON.stringify(
                  x.details ||
                    {}
                )
              )}</small></td>` +
              `</tr>`
          )
          .join("")
      : `<tr><td colspan="5" class="empty">No activity recorded yet.</td></tr>`;
}

async function clearAuditLog() {
  if (
    !state.auditLog?.length
  ) {
    return;
  }

  if (
    !(
      await requestConfirmation({
        title:
          "Clear audit history",

        message:
          "Clear the local audit history?",

        details:
          "This does not change business records.",

        confirmLabel:
          "Clear Audit"
      })
    )
  ) {
    return;
  }

  state.auditLog = [];

  persistState();
  renderAuditLog();

  showToast(
    "Audit history cleared."
  );
}

/* ---------------- Duplicate Operation Protection ---------------- */

const operationGuards =
  new Map();

function beginOperation(
  key,
  cooldown = 900
) {
  const normalized =
    String(
      key
    );

  const now =
    Date.now();

  const previous =
    operationGuards.get(
      normalized
    ) || 0;

  if (
    now - previous <
    cooldown
  ) {
    return false;
  }

  operationGuards.set(
    normalized,
    now
  );

  return true;
}

function runGuardedOperation(
  key,
  action,
  cooldown = 900
) {
  if (
    !beginOperation(
      key,
      cooldown
    )
  ) {
    showToast(
      "That action is already being processed. Please wait a moment.",
      "error"
    );

    return false;
  }

  try {
    return action();
  } catch (error) {
    return handleAppError(
      `guarded:${key}`,
      error,
      {
        userMessage:
          "That action could not be completed. No additional change was applied.",
        fallback: false
      }
    );
  }
}

function guardedSubmitHandler(
  form,
  key,
  handler
) {
  return function (
    event
  ) {
    if (
      !beginOperation(
        key,
        900
      )
    ) {
      event.preventDefault();

      showToast(
        "That form is already being submitted. Please wait a moment.",
        "error"
      );

      return false;
    }

    const submitButton =
      form?.querySelector(
        'button[type="submit"]'
      );

    const originalDisabled =
      submitButton?.disabled;

    if (
      submitButton
    ) {
      submitButton.disabled =
        true;
    }

    try {
      return handler.call(
        this,
        event
      );
    } finally {
      if (
        submitButton
      ) {
        submitButton.disabled =
          originalDisabled ||
          false;
      }
    }
  };
}

function installDuplicateOperationGuards() {
  const wrap = (
    name,
    keyBuilder,
    cooldown = 900
  ) => {
    const original =
      window[name];

    if (
      typeof original !==
        "function" ||
      original.__duplicateGuarded
    ) {
      return;
    }

    const wrapped =
      function (...args) {
        const key =
          typeof keyBuilder ===
          "function"
            ? keyBuilder(
                ...args
              )
            : keyBuilder;

        return runGuardedOperation(
          key,
          () =>
            original.apply(
              this,
              args
            ),
          cooldown
        );
      };

    wrapped.__duplicateGuarded =
      true;

    window[name] =
      wrapped;
  };

  wrap(
    "updateOrderStatus",
    (
      id,
      status
    ) =>
      `order-status:${String(
        id
      )}:${String(
        status
      )}`
  );

  wrap(
    "deleteOrder",
    (id) =>
      `order-delete:${String(
        id
      )}`
  );

  wrap(
    "deleteExpense",
    (id) =>
      `expense-delete:${String(
        id
      )}`
  );

  wrap(
    "deleteClient",
    (id) =>
      `client-delete:${String(
        id
      )}`
  );

  wrap(
    "deleteEmployee",
    (id) =>
      `employee-delete:${String(
        id
      )}`
  );

  wrap(
    "saveGroupManager",
    "group-manager-save"
  );

  wrap(
    "assignOrdersToGroup",
    (ids, group) =>
      `group-assign:${(
        ids || []
      )
        .map(String)
        .sort()
        .join(",")}:${String(
        group
      ).toLowerCase()}`
  );

  wrap(
    "removeOrderFromGroup",
    (id) =>
      `group-remove-order:${String(
        id
      )}`
  );

  wrap(
    "removeSelectedFromGroup",
    "group-remove-selected"
  );

  wrap(
    "markGroupPaid",
    (i) =>
      `group-paid:${String(
        i
      )}`
  );

  wrap(
    "disbandGroup",
    (i) =>
      `group-disband:${String(
        i
      )}`
  );

  wrap(
    "addEmployeeAdvance",
    (id) =>
      `employee-advance:${String(
        id
      )}`,
    1200
  );

  wrap(
    "saveDailyReport",
    "daily-report-save",
    1200
  );

  wrap(
    "saveWeeklyReport",
    "weekly-report-save",
    1200
  );
}

/* ---------------- Modal & UI Handlers ---------------- */

function openModal(
  id
) {
  const el =
    $(id);

  if (!el) {
    return;
  }

  el.classList.add(
    "open"
  );

  el.classList.remove(
    "active"
  );

  el.setAttribute(
    "aria-hidden",
    "false"
  );

  document.body.classList.add(
    "modal-open"
  );
}

function closeModal(
  id
) {
  const el =
    $(id);

  if (!el) {
    return;
  }

  el.classList.remove(
    "open",
    "active"
  );

  el.setAttribute(
    "aria-hidden",
    "true"
  );

  if (
    !document.querySelector(
      ".modal.open"
    )
  ) {
    document.body.classList.remove(
      "modal-open"
    );
  }
}

window.onclick =
  function (event) {
    if (
      event.target.classList.contains(
        "modal"
      )
    ) {
      closeModal(
        event.target.id
      );
    }
  };

/* ---------------- Initializer ---------------- */

function renderPartial(
  view = "core"
) {
  const common =
    () => {
      updateFinancialSummary();
      renderTodayOperations();
      renderRecentOrders();
      generateAiInsights();
      renderAuditLog();
    };

  switch (view) {
    case "orders":
      renderAllOrderViews();
      renderUnpaidReceivables();
      renderLeaderboard();
      renderUncollectedContainers();
      renderContainerControl();
      common();
      break;

    case "expenses":
      renderExpenseLog();
      renderDailyReports();
      common();
      break;

    case "clients":
      renderClientDropdowns();
      renderClientDirectory();
      renderLeaderboard();
      renderUncollectedContainers();
      renderContainerControl();
      common();
      break;

    case "employees":
      renderEmployeeDropdowns();
      renderEmployees();
      common();
      break;

    case "groups":
      renderOrderGroups();

      if (
        $("groupManageModal")
          ?.classList.contains(
            "open"
          )
      ) {
        renderGroupManager();
      }

      renderAllOrderViews();
      common();
      break;

    default:
      common();
  }
}

function deferNonCriticalRender(
  task
) {
  const runner =
    () => {
      try {
        task();
      } catch (error) {
        handleAppError(
          "deferred-render",
          error,
          {
            toast: false,
            userMessage:
              "A secondary dashboard view could not be refreshed."
          }
        );
      }
    };

  if (
    typeof window.requestIdleCallback ===
    "function"
  ) {
    window.requestIdleCallback(
      runner,
      {
        timeout: 250
      }
    );
  } else {
    setTimeout(
      runner,
      0
    );
  }
}

function renderAll() {
  const renderStart =
    performance.now();

  normalizeState();

  // Critical business views stay synchronous; secondary analytics are deferred so
  // large datasets do not block navigation and data-entry controls.
  renderProductDropdowns();
  renderClientDropdowns();
  renderEmployeeDropdowns();
  renderOrderLog();
  renderCompletedTransactions();
  renderAllOrders();
  renderUnpaidReceivables();
  renderExpenseLog();
  renderOrderGroups();
  renderClientDirectory();
  renderLeaderboard();
  renderUncollectedContainers();
  renderContainerControl();
  renderPriceUpdater();
  renderEmployees();
  renderDeletedArchives();
  updateFinancialSummary();
  renderTodayOperations();
  renderRecentOrders();
  renderAutoBackups();
  renderAuditLog();

  lastRenderDurationMs =
    performance.now() -
    renderStart;

  window.GVPerformance =
    window.GVPerformance || {
      renderSamples: [],
      lastRenderMs: 0
    };

  window.GVPerformance.lastRenderMs =
    Number(
      lastRenderDurationMs.toFixed(
        2
      )
    );

  window.GVPerformance.renderSamples.push(
    window.GVPerformance
      .lastRenderMs
  );

  if (
    window.GVPerformance
      .renderSamples.length >
    20
  ) {
    window.GVPerformance
      .renderSamples.shift();
  }

  if (
    lastRenderDurationMs >
    150
  ) {
    console.warn(
      `[GotaVita] slow render: ${lastRenderDurationMs.toFixed(
        1
      )}ms`
    );
  }

  deferNonCriticalRender(
    () =>
      generateAiInsights()
  );

  deferNonCriticalRender(
    () =>
      renderDailyReports()
  );

  const savedReportPeriod =
    safeLocalStorageGet(
      "water_report_period",
      "week"
    );

  if (
    savedReportPeriod ===
      "month" ||
    savedReportPeriod ===
      "week"
  ) {
    deferNonCriticalRender(
      () =>
        renderPeriodReport(
          savedReportPeriod
        )
    );
  }

  deferNonCriticalRender(
    () =>
      runSystemHealthCheck()
  );
}

function activateOrderSubtab(
  name,
  btn
) {
  const activeBtn =
    btn ||
    document.querySelector(
      `#orderSubtabs .subtab[data-sub="${name}"]`
    );

  document
    .querySelectorAll(
      "#orderSubtabs .subtab"
    )
    .forEach(
      (t) =>
        t.classList.toggle(
          "active",
          t === activeBtn
        )
    );

  document
    .querySelectorAll(
      "#panel-orderlog .subpanel"
    )
    .forEach(
      (p) =>
        p.classList.remove(
          "active"
        )
    );

  const target =
    $("sub-" + name);

  if (!target) {
    return;
  }

  target.classList.add(
    "active"
  );

  if (
    name ===
    "active"
  ) {
    renderOrderLog();
  }

  if (
    name ===
    "completed"
  ) {
    renderCompletedTransactions();
  }

  if (
    name ===
    "all"
  ) {
    renderAllOrders();
  }

  if (
    name ===
    "receivables"
  ) {
    renderUnpaidReceivables();
  }
}

/* ---------------- Centralized UI Event Delegation ---------------- */

function openReceivables() {
  activateOrderSubtab(
    "receivables"
  );

  switchTab(
    "orderlog"
  );
}

function toggleEmployeeForm() {
  const wrap =
    $("empFormWrapper");

  if (wrap) {
    wrap.classList.toggle(
      "open"
    );
  }
}

function resetEmployeeFormAndClose() {
  resetEmployeeForm();

  const wrap =
    $("empFormWrapper");

  if (wrap) {
    wrap.classList.remove(
      "open"
    );
  }
}

function closeEmployeeForm() {
  const wrap =
    $("empFormWrapper");

  if (wrap) {
    wrap.classList.remove(
      "open"
    );
  }
}

function dispatchUIAction(
  element,
  event
) {
  if (
    !element ||
    !element.dataset ||
    !element.dataset
      .action
  ) {
    return false;
  }

  const fnName =
    element.dataset
      .action;

  const fn =
    window[fnName];

  if (
    typeof fn !==
    "function"
  ) {
    handleAppError(
      "ui-action",
      new Error(
        `Unknown UI action: ${fnName}`
      ),
      {
        userMessage:
          "That action is currently unavailable. Please try again."
      }
    );

    return false;
  }

  let args = [];

  if (
    element.dataset
      .actionArgs
  ) {
    try {
      args =
        JSON.parse(
          element.dataset
            .actionArgs
        );
    } catch (error) {
      handleAppError(
        "ui-action-args",
        error,
        {
          toast: false
        }
      );

      return false;
    }
  }

  args = args.map(
    (arg) => {
      if (
        arg ===
        "__THIS__"
      ) {
        return element;
      }

      if (
        arg ===
        "__VALUE__"
      ) {
        return element.value;
      }

      if (
        arg ===
        "__CHECKED__"
      ) {
        return Boolean(
          element.checked
        );
      }

      return arg;
    }
  );

  if (
    element.dataset
      .actionEvent ===
    "true"
  ) {
    args.push(
      event
    );
  }

  fn(
    ...args
  );

  return true;
}

function installUIEventDelegation() {
  if (
    document.documentElement
      .dataset
      .uiDelegationInstalled ===
    "true"
  ) {
    return;
  }

  document.documentElement
    .dataset
    .uiDelegationInstalled =
    "true";

  document.addEventListener(
    "click",
    (event) => {
      const target =
        event.target instanceof
        Element
          ? event.target.closest(
              "[data-action]"
            )
          : null;

      if (!target) {
        return;
      }

      if (
        target.disabled ||
        target.getAttribute(
          "aria-disabled"
        ) === "true"
      ) {
        return;
      }

      if (
        dispatchUIAction(
          target,
          event
        ) &&
        target.tagName ===
          "BUTTON"
      ) {
        event.preventDefault();
      }
    }
  );

  document.addEventListener(
    "change",
    (event) => {
      const target =
        event.target instanceof
        Element
          ? event.target.closest(
              "[data-action]"
            )
          : null;

      if (target) {
        dispatchUIAction(
          target,
          event
        );
      }
    }
  );

  document.addEventListener(
    "input",
    (event) => {
      const target =
        event.target instanceof
        Element
          ? event.target.closest(
              "[data-action]"
            )
          : null;

      if (target) {
        dispatchUIAction(
          target,
          event
        );
      }
    }
  );
}

function activateClientSubtab(
  name,
  btn
) {
  const activeBtn =
    btn ||
    document.querySelector(
      `#clientSubtabs .subtab[data-client-sub="${name}"]`
    );

  document
    .querySelectorAll(
      "#clientSubtabs .subtab"
    )
    .forEach(
      (t) =>
        t.classList.toggle(
          "active",
          t === activeBtn
        )
    );

  document
    .querySelectorAll(
      "#panel-clients .client-subpanel"
    )
    .forEach(
      (p) =>
        p.classList.remove(
          "active"
        )
    );

  const target =
    $("client-sub-" + name);

  if (!target) {
    return;
  }

  target.classList.add(
    "active"
  );

  if (
    name ===
    "directory"
  ) {
    renderClientDirectory();
  }

  if (
    name ===
    "top"
  ) {
    renderLeaderboard();
  }

  if (
    name ===
    "containers"
  ) {
    renderUncollectedContainers();
    renderContainerControl();
  }
}

function installProfessionalKeyboardNavigation() {
  const tabs =
    Array.from(
      document.querySelectorAll(
        '.tab[role="tab"]'
      )
    );

  tabs.forEach(
    (tab, index) => {
      tab.addEventListener(
        "keydown",
        (event) => {
          if (
            ![
              "ArrowRight",
              "ArrowLeft",
              "Home",
              "End",
              "Enter",
              " "
            ].includes(
              event.key
            )
          ) {
            return;
          }

          event.preventDefault();

          if (
            event.key ===
              "Enter" ||
            event.key ===
              " "
          ) {
            switchTab(
              tab.dataset.tab
            );

            return;
          }

          let next =
            index;

          if (
            event.key ===
            "ArrowRight"
          ) {
            next =
              (index + 1) %
              tabs.length;
          }

          if (
            event.key ===
            "ArrowLeft"
          ) {
            next =
              (
                index -
                1 +
                tabs.length
              ) %
              tabs.length;
          }

          if (
            event.key ===
            "Home"
          ) {
            next =
              0;
          }

          if (
            event.key ===
            "End"
          ) {
            next =
              tabs.length -
              1;
          }

          tabs[next].focus();
        }
      );
    }
  );

  document
    .querySelectorAll(
      ".subtab"
    )
    .forEach(
      (tab) => {
        tab.addEventListener(
          "keydown",
          (event) => {
            if (
              ![
                "ArrowRight",
                "ArrowLeft",
                "Home",
                "End"
              ].includes(
                event.key
              )
            ) {
              return;
            }

            const siblings =
              Array.from(
                tab.parentElement
                  ?.querySelectorAll(
                    ".subtab"
                  ) || []
              );

            const index =
              siblings.indexOf(
                tab
              );

            if (
              index < 0
            ) {
              return;
            }

            event.preventDefault();

            let next =
              index;

            if (
              event.key ===
              "ArrowRight"
            ) {
              next =
                (index + 1) %
                siblings.length;
            }

            if (
              event.key ===
              "ArrowLeft"
            ) {
              next =
                (
                  index -
                  1 +
                  siblings.length
                ) %
                siblings.length;
            }

            if (
              event.key ===
              "Home"
            ) {
              next =
                0;
            }

            if (
              event.key ===
              "End"
            ) {
              next =
                siblings.length -
                1;
            }

            siblings[next].focus();
          }
        );
      }
    );
}

function installProfessionalPolish() {
  document.documentElement.classList.add(
    "gv-professional-polish"
  );

  installProfessionalKeyboardNavigation();

  const hashTab =
    location.hash.replace(
      /^#/,
      ""
    );

  if (
    hashTab &&
    document.querySelector(
      `.tab[data-tab="${CSS.escape(
        hashTab
      )}"]`
    )
  ) {
    requestAnimationFrame(
      () =>
        switchTab(
          hashTab,
          {
            scroll:
              false
          }
        )
    );
  }

  window.addEventListener(
    "hashchange",
    () => {
      const name =
        location.hash.replace(
          /^#/,
          ""
        );

      if (
        name &&
        document.querySelector(
          `.tab[data-tab="${CSS.escape(
            name
          )}"]`
        )
      ) {
        switchTab(
          name,
          {
            scroll:
              false
          }
        );
      }
    }
  );

  window.addEventListener(
    "resize",
    () => {
      const active =
        document.querySelector(
          ".tab.active"
        );

      if (active) {
        moveUnderline(
          active
        );
      }
    },
    {
      passive: true
    }
  );
}

window.addEventListener(
  "DOMContentLoaded",
  async () => {
    try {
      if (
        window.GVAuth
      ) {
        await window.GVAuth.init();
      }

const authorized =
  window.GVAuth?.isAuthorized?.() === true;

if (!authorized) {
  // Authentication boundary:
  // do not restore cached business data,
  // do not seed protected records,
  // and do not render the application.
  replaceState(
    window.GV_STATE.createInitialState()
  );

  return;
}

      initProductionHardening();
      installDuplicateOperationGuards();
      installUIEventDelegation();
      installProfessionalPolish();
      installBulkSelectionUX();
      installSearchOptimization();
      initDarkMode();

      const savedReportPeriod =
        safeLocalStorageGet(
          "water_report_period",
          "week"
        );

      if (
        savedReportPeriod ===
          "month" ||
        savedReportPeriod ===
          "week"
      ) {
        requestAnimationFrame(
          () =>
            renderPeriodReport(
              savedReportPeriod
            )
        );
      }

      initSyncReliability();

      const cachedState =
        readLocalStateSnapshot();

      if (cachedState) {
        replaceState(
          cachedState
        );
      } else {
        seedState();
        normalizeState();
        writeLocalStateSnapshot(
          state
        );
      }

      normalizeState();
      renderAll();

      updateBulkSelectionUI(
        "active"
      );

      updateBulkSelectionUI(
        "billing"
      );

      updateBulkSelectionUI(
        "all"
      );

      const orderForm =
        $("orderForm");

      if (orderForm) {
        orderForm.addEventListener(
          "submit",
          guardedSubmitHandler(
            orderForm,
            "order-form-submit",
            handleOrderSubmit
          )
        );
      }

      const expenseForm =
        $("expenseForm");

      if (expenseForm) {
        expenseForm.addEventListener(
          "submit",
          guardedSubmitHandler(
            expenseForm,
            "expense-form-submit",
            handleExpenseSubmit
          )
        );
      }

      const clientForm =
        $("clientForm");

      if (clientForm) {
        clientForm.addEventListener(
          "submit",
          guardedSubmitHandler(
            clientForm,
            "client-form-submit",
            handleClientSubmit
          )
        );
      }

      const employeeForm =
        $("employeeForm");

      if (employeeForm) {
        employeeForm.addEventListener(
          "submit",
          guardedSubmitHandler(
            employeeForm,
            "employee-form-submit",
            handleEmployeeSubmit
          )
        );
      }

      const orderEditForm =
        $("orderEditForm");

      if (orderEditForm) {
        orderEditForm.addEventListener(
          "submit",
          guardedSubmitHandler(
            orderEditForm,
            "order-edit-submit",
            handleOrderEditSubmit
          )
        );
      }

      [
        $("editOrderGallons"),
        $("editOrderPrice")
      ].forEach(
        (el) =>
          el &&
          el.addEventListener(
            "input",
            updateEditOrderTotal
          )
      );

      switchTab(
        "dashboard"
      );

      const beforeSyncSnapshot =
        JSON.stringify(
          state
        );

      await safeRunAsync(
        "initial-server-sync",
        () =>
          loadServerState(),
        {
          toast: false,
          fallback: false
        }
      );

      if (
        JSON.stringify(
          state
        ) !==
        beforeSyncSnapshot
      ) {
        renderAll();
      }

      updateSyncStatus(
        navigator.onLine &&
          window.location.protocol !==
            "file:"
          ? (
              window.GVAuth?.isConfigured?.()
                ? "Online · Supabase"
                : "Online"
            )
          : "Local",

        navigator.onLine &&
          window.location.protocol !==
            "file:"
          ? "online"
          : "local"
      );
    } catch (error) {
      handleAppError(
        "app-initialization",
        error,
        {
          userMessage:
            "GotaVita Manager could not finish loading. Your local saved data has not been deleted."
        }
      );
    }
  }
);

/* Phase 4 Step 21 — Responsive/accessibility runtime polish. */
(function initResponsiveAccessibilityPolish() {
  function enhance() {
    document
      .querySelectorAll(
        '.panel[role="tabpanel"]'
      )
      .forEach(
        function (panel) {
          var active =
            panel.classList.contains(
              "active"
            );

          panel.setAttribute(
            "aria-hidden",
            active
              ? "false"
              : "true"
          );

          if (
            !panel.hasAttribute(
              "tabindex"
            )
          ) {
            panel.setAttribute(
              "tabindex",
              "-1"
            );
          }
        }
      );

    document
      .querySelectorAll(
        '.tab[role="tab"]'
      )
      .forEach(
        function (tab) {
          var id =
            tab.getAttribute(
              "data-tab"
            );

          if (
            id &&
            !tab.getAttribute(
              "aria-controls"
            )
          ) {
            tab.setAttribute(
              "aria-controls",
              "panel-" +
                id
            );
          }
        }
      );
  }

  if (
    document.readyState ===
    "loading"
  ) {
    document.addEventListener(
      "DOMContentLoaded",
      enhance,
      {
        once: true
      }
    );
  } else {
    enhance();
  }
})();