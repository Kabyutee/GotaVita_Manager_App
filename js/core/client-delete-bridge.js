/* GotaVita Manager — client archive/delete boundary. */
(function () {
  "use strict";
  if (window.__GV_CLIENT_DELETE_BRIDGE__) return;

  async function deleteClient(id) {
    const legacyId = String(id ?? "").trim();
    if (!legacyId) return;

    const name = `client ${legacyId}`;

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

    try {
      const supabase = window.GVData?.getClient?.();
      if (!supabase) throw new Error("Authenticated Supabase client is unavailable.");

      const updatedAt = new Date().toISOString();
      const { error } = await supabase
        .from("clients")
        .update({
          active: false,
          updated_at: updatedAt
        })
        .eq("legacy_id", legacyId);

      if (error) throw error;

      window.showToast?.("Client archived. Historical records preserved.");

      // Let the canonical application startup/sync path rehydrate the updated
      // remote client state rather than mutating private module state here.
      window.location.reload();
    } catch (error) {
      console.error("GotaVita client archive:", error);
      window.showToast?.("Client could not be archived. No cloud change was applied.", "error");
    }
  }

  window.deleteClient = deleteClient;
  window.__GV_CLIENT_DELETE_BRIDGE__ = true;
})();
