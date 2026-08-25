// GotaVita Manager — Phase 4.5 Sprint M2
// Business-module extraction. Functions remain global for backward compatibility.

function makeAutoBackup(manual) {
  try {
    const list = readAutoBackupList();
    const payload = createBackupPayload();
    const entry = { timestamp: new Date().toISOString(), manual: !!manual, schemaVersion: payload.schemaVersion, checksum: payload.integrityChecksum, data: payload };
    list.push(entry);
    while (list.length > 10) list.shift();

    // Auto-backups are full-state snapshots. localStorage has a finite quota,
    // so retry from newest to oldest until the retained history fits. A failed
    // setItem leaves the existing value untouched; only after that failure do
    // we drop the oldest backup and retry. This preserves the newest recovery
    // point without allowing backup growth to block normal state persistence.
    let trimmed = 0;
    let saved = false;

    while (list.length) {
      const serialized = JSON.stringify(list);

      if (safeLocalStorageSet(KEYS.autobackup, serialized)) {
        saved = true;
        break;
      }

      if (list.length === 1) {
        break;
      }

      list.shift();
      trimmed += 1;
    }

    if (!saved) {
      throw new Error("Storage quota or write verification failed.");
    }

    audit("backup", "system", entry.timestamp, {
      manual: !!manual,
      summary: datasetSummary(state),
      integrity: payload.integrity,
      trimmedOldBackups: trimmed
    });
    renderAutoBackups();
    renderAuditLog();
    if (manual) showToast("Verified system backup created.");
    return true;
  } catch (e) {
    if (manual) showToast("Backup failed: " + e.message, "error");
    return false;
  }
}

function createBackupPayload() {
  normalizeState();
  const copy = clone(state);
  const check = validateDataIntegrity();
  const payload = {
    app: "GotaVita Managers Web Application",
    schemaVersion: 4,
    exportedAt: new Date().toISOString(),
    integrity: check,
    data: copy
  };
  const canonical = JSON.stringify(payload.data);
  payload.integrityChecksum = storageChecksum(canonical);
  return payload;
}

function describeBackup(b) {
  if (!b) return null;
  const raw = b.data?.data ? b.data : b.data;
  const data = raw?.data && raw.app ? raw.data : raw;
  return datasetSummary(data || {});
}

function validateBackupPayload(payload) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) throw new Error("Backup must be a JSON object.");
  const required = ["clients", "products", "orders", "expenses", "employees", "orderGroups", "dailyReports"];
  const missing = required.filter(k => !Array.isArray(payload[k]));
  if (missing.length) throw new Error(`Missing required data sections: ${missing.join(", ")}`);
  const candidate = clone(payload);
  if (payload.integrityChecksum) {
    const expected = storageChecksum(JSON.stringify(payload.data || payload));
    if (expected !== payload.integrityChecksum) throw new Error("Backup integrity checksum mismatch.");
  }
  const beforeState = state;
  try {
    replaceState(candidate);
    const check = validateDataIntegrity();
    if (check.invalidOrders) throw new Error(`Backup contains ${check.invalidOrders} invalid order reference(s).`);
    return { data: clone(state), summary: datasetSummary(state), integrity: check };
  } finally {
    replaceState(beforeState, { normalize: false });
  }
}

function exportData() {
  try {
    const payload = createBackupPayload();
    download(`GotaVita_Backup_${exportStamp()}.json`, JSON.stringify(payload, null, 2), "application/json");
    audit("export", "system", "json", { summary: datasetSummary(state), integrity: payload.integrity });
    showToast("Verified JSON backup exported.");
  } catch (e) {
    showToast("Export failed: " + e.message, "error");
  }
}

function triggerImport() {
  $("importFile").click();
}

function importData(e) {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = async (event) => {
    try {
      const raw = JSON.parse(event.target.result);
      const payload = raw?.app === "GotaVita Managers Web Application" && raw?.data ? raw.data : raw;
      const checked = validateBackupPayload(payload);
      const s = checked.summary;
      if (await requestConfirmation({title:"Import validated data", message:"Overwrite the current data with this validated backup?", details:`Clients: ${s.clients}\nProducts: ${s.products}\nOrders: ${s.orders}\nExpenses: ${s.expenses}\nEmployees: ${s.employees}\nGroups: ${s.groups}\n\nA safety backup will be created first.`, confirmLabel:"Import Data", tone:"warning"})) {
        saveStateForUndo();
        makeAutoBackup(false);
        replaceState(checked.data);
        audit("import", "system", "", { source: file.name, summary: s, integrity: checked.integrity });
        persistState();
        renderAll();
        showToast("Validated data imported successfully. Safety backup created.");
      }
    } catch (err) {
      showToast("Import blocked: " + err.message, "error");
    }
    e.target.value = "";
  };
  reader.readAsText(file);
}

function exportCSV(type) {
  const rows = [];
  if (type === "orders") {
    rows.push(["Order Number","Date","Client","Product","Gallons","Price","Total","Status","Delivery Status","Empty Containers Collected"]);
    state.orders.forEach(o => rows.push([o.orderNumber, new Date(o.date).toLocaleDateString(), o.clientName, o.custType, Number(o.gallons)||0, Number(o.price)||0, Number(o.total)||0, o.status, o.deliveryStatus || "Not Assigned", Number(o.emptyGallonsCollected)||0]));
  } else if (type === "clients") {
    rows.push(["Name","Group","Phone","Address","Default Price"]);
    state.clients.forEach(c => rows.push([c.name, c.group, c.phone, c.address, Number(c.defaultPrice)||0]));
  } else {
    showToast("Unsupported CSV export.", "error");
    return;
  }
  const csv = rows.map(row => row.map(csvCell).join(",")).join("\r\n") + "\r\n";
  download(`GotaVita_${type}_${stamp()}_${Date.now()}.csv`, csv, "text/csv;charset=utf-8");
  audit("export", "system", `csv:${type}`, { summary: datasetSummary(state) });
  showToast(`${type.charAt(0).toUpperCase() + type.slice(1)} CSV exported.`);
}

function download(name, content, mime) {
  const blob = new Blob([content], { type: mime });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob); a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

function stamp() { return new Date().toISOString().slice(0, 10); }
function exportStamp() { return new Date().toISOString().replace(/[:.]/g, "-"); }

/* L300 dashboard modules are loaded after the existing deferred application
 * boot completes. This preserves the existing script order while keeping the
 * new operating layer isolated from core business logic.
 */
(function loadL300DashboardModules() {
  function load(src) {
    return new Promise((resolve, reject) => {
      if (document.querySelector(`script[data-gv-module-src="${src}"]`)) return resolve();
      const script = document.createElement("script");
      script.src = src;
      script.defer = false;
      script.dataset.gvModuleSrc = src;
      script.onload = resolve;
      script.onerror = () => reject(new Error(`Unable to load ${src}`));
      document.head.appendChild(script);
    });
  }
  function start() {
    // Load the archive bridge independently from optional L300 modules.
    // A failure in an auxiliary dashboard module must never prevent the
    // production Client archive reconciliation bridge from loading.
    load("js/core/client-archive-sync-bridge.js").catch(error => {
      console.warn("GotaVita Client archive bridge initialization skipped:", error?.message || error);
    });

    load("js/modules/l300-reporting-adapter.js")
      .then(() => load("js/modules/daily-l300-runs.js"))
      .then(() => load("js/modules/l300-operations-dashboard.js"))
      .catch(error => console.warn("L300 dashboard modules initialization skipped:", error?.message || error));
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start, { once: true });
  else start();
})();
