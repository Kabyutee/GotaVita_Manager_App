/* GotaVita Manager — Client archive sync bridge.
 *
 * Client archive already mutates local state and persists it. The controlled
 * conflict resolver is the existing authoritative cloud write path, but it is
 * normally triggered by auth-state changes. Trigger it immediately after a
 * successful Client archive so the local active=false mutation reaches the
 * same Supabase conflict policy before the next reconciliation can restore
 * the remote active row.
 */
(function () {
  "use strict";

  let installed = false;

  function install() {
    if (installed || typeof window.deleteClient !== "function") {
      return;
    }

    const original = window.deleteClient;

    window.deleteClient = async function clientArchiveSyncBridge(...args) {
      const result = await original.apply(this, args);

      try {
        const id = args[0];
        const state = typeof window.getStateSnapshot === "function"
          ? window.getStateSnapshot()
          : null;
        const row = Array.isArray(state?.clients)
          ? state.clients.find((client) => String(client?.id) === String(id))
          : null;

        // Only reconcile when the targeted Client is actually archived.
        // If the user cancelled the confirmation or the handler refused the
        // operation, leave the existing behavior untouched.
        if (
          row?.active === false &&
          typeof window.GVConflictIntegration?.run === "function"
        ) {
          await window.GVConflictIntegration.run(true);
        }
      } catch (error) {
        console.warn(
          "GotaVita Client archive sync bridge:",
          error?.message || error
        );
      }

      return result;
    };

    installed = true;
  }

  try {
    install();
  } catch (error) {
    console.warn(
      "GotaVita Client archive sync bridge initialization skipped:",
      error?.message || error
    );
  }

  window.addEventListener(
    "DOMContentLoaded",
    () => {
      try {
        install();
      } catch (_) {}
    },
    { once: true }
  );
})();
