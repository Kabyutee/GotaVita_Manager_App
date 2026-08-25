/* GotaVita Manager — client archive/delete boundary. */
(function () {
  "use strict";
  if (window.__GV_CLIENT_DELETE_BRIDGE__) return;
  async function deleteClient(id) {
    const client = Array.isArray(window.state?.clients)
      ? window.state.clients.find((row) => String(row.id) === String(id))
      : null;
    if (!client) return;
    const name = String(client.name || "this client").trim();
    const before = window.clone?.(client) || { ...client };
    if (!(await window.requestConfirmation?.({
      title: "Archive client",
      message: `Archive ${name}?`,
      details: "The client will be hidden from the active directory but preserved in the cloud record. A safety backup will be created first.",
      confirmLabel: "Archive Client",
      tone: "warning"
    }))) return;
    if (typeof window.saveStateForUndo === "function") window.saveStateForUndo();
    if (typeof window.makeAutoBackup === "function" && !window.makeAutoBackup(false)) {
      window.showToast?.("Safety backup could not be created. Client was not archived.", "error");
      return;
    }
    client.active = false;
    client.updatedAt = new Date().toISOString();
    if (typeof window.audit === "function") {
      window.audit("update", "client", client.id, {
        before,
        after: window.clone?.(client) || { ...client },
        reason: "archive"
      });
    }
    if (typeof window.persistState === "function") window.persistState();
    if (typeof window.renderAll === "function") window.renderAll();
    window.showToast?.("Client archived. Safety backup created.");
  }
  window.deleteClient = deleteClient;
  window.__GV_CLIENT_DELETE_BRIDGE__ = true;
})();
