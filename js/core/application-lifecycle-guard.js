/* GotaVita Manager — Application lifecycle / synchronization boundary. */
(function () {
  "use strict";

  const AUDIT_ONLY_RESOURCES = new Set(["audit_logs"]);
  let installed = false;

  function safeHealth() {
    return window.GVAuth?.requireManagerSession?.()
      .then((auth) => {
        const configured = auth?.configured === true;
        const authenticated = auth?.authenticated === true;
        return {
          ok: configured && authenticated,
          mode: "supabase",
          configured,
          authenticated,
          companyId: auth?.profile?.company_id || null,
          error: configured && authenticated ? null : "Manager session unavailable."
        };
      })
      .catch((error) => ({
        ok: false,
        mode: "supabase",
        configured: true,
        authenticated: false,
        companyId: null,
        error: String(error?.message || error)
      }));
  }

  function fenceLegacySyncEntryPoints() {
    const canonical = (...args) => {
      if (window.__GV_APP_READY === true && window.GVSync?.flush) return window.GVSync.flush(...args);
      return Promise.resolve({ ok: false, status: "booting" });
    };

    window.syncChangedResources = canonical;
    window.syncNow = canonical;
    try { window.stopSyncReliability?.(); } catch (_) {}
    window.startSyncReliability = () => {};
    window.__GV_CANONICAL_SYNC_ONLY = true;
  }

  function ensureRecoveryModule() {
    if (window.GVEmergencyRecovery?.run) return;
    if (document.querySelector('script[data-gv-emergency-recovery="true"]')) return;
    const script = document.createElement("script");
    script.src = "/js/core/emergency-recovery.js?gv_recovery=1";
    script.defer = false;
    script.dataset.gvEmergencyRecovery = "true";
    script.onerror = () => console.warn("GotaVita emergency recovery module failed to load.");
    (document.head || document.documentElement).appendChild(script);
  }

  function install() {
    if (installed) return true;
    if (!window.GVData) return false;

    const current = window.GVData;
    const originalSupported = typeof current.supportedResources === "function"
      ? current.supportedResources.bind(current)
      : () => [];

    const facade = Object.assign({}, current, {
      supportedResources() {
        return originalSupported().filter((resource) => !AUDIT_ONLY_RESOURCES.has(resource));
      },
      health: safeHealth,
      sync(...args) {
        if (window.__GV_APP_READY === true && window.GVSync?.flush) return window.GVSync.flush(...args);
        return Promise.resolve({ ok: false, status: "booting" });
      }
    });

    window.GVData = Object.freeze(facade);
    window.__GV_APPLICATION_LIFECYCLE_GUARD = Object.freeze({
      installed: true,
      auditExcludedFromBusinessSync: true,
      installedAt: new Date().toISOString()
    });

    try { window.GVSync?.stopPolling?.(); } catch (_) {}
    fenceLegacySyncEntryPoints();
    ensureRecoveryModule();

    installed = true;
    return true;
  }

  window.GVApplicationLifecycleGuard = Object.freeze({ install });
})();
