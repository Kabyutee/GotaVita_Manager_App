/* GotaVita Phase 4.5 M3 — Data Gateway Boundary
 * Compatibility-first adapter for the existing application.
 * Phase 5 can replace these implementations with Supabase-backed services
 * without changing business modules or UI call sites.
 */
window.GVData = Object.freeze({
  getState() {
    return typeof window.state !== "undefined" ? window.state : null;
  },
  persist() {
    if (typeof window.persistState === "function") return window.persistState();
    return false;
  },
  loadServer() {
    if (typeof window.loadServerState === "function") return window.loadServerState();
    return Promise.resolve(false);
  },
  sync(force = false) {
    if (typeof window.syncNow === "function") return window.syncNow(force);
    return Promise.resolve(false);
  },
  health() {
    if (typeof window.runSystemHealthCheck === "function") return window.runSystemHealthCheck();
    return null;
  },
  backupList() {
    if (typeof window.readAutoBackupList === "function") return window.readAutoBackupList();
    return [];
  }
});
