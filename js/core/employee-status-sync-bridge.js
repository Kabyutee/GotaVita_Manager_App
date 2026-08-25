/* GotaVita Manager — Employee status sync bridge.
 *
 * Employee status changes already mutate local state and call persistState().
 * When local persistence is blocked by browser storage quota, the normal
 * persistence path may never reach the cloud reconciliation trigger. This
 * narrow bridge invokes the existing conflict resolver immediately after a
 * successful Active <-> Inactive mutation so the canonical cloud path still
 * receives the changed employee.
 */
(function () {
  "use strict";

  let installed = false;

  function install() {
    if (installed || typeof window.toggleEmployeeStatus !== "function") {
      return;
    }

    const original = window.toggleEmployeeStatus;

    window.toggleEmployeeStatus = async function employeeStatusSyncBridge(...args) {
      const result = await original.apply(this, args);

      try {
        const id = args[0];
        const state = typeof window.getStateSnapshot === "function"
          ? window.getStateSnapshot()
          : null;
        const row = Array.isArray(state?.employees)
          ? state.employees.find((employee) => String(employee?.id) === String(id))
          : null;

        if (
          row &&
          typeof row.status === "string" &&
          typeof window.GVConflictIntegration?.run === "function"
        ) {
          await window.GVConflictIntegration.run(true);
        }
      } catch (error) {
        console.warn(
          "GotaVita Employee status sync bridge:",
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
      "GotaVita Employee status sync bridge initialization skipped:",
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
