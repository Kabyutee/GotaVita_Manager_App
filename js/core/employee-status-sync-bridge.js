/* GotaVita Manager — Employee status sync bridge.
 *
 * Employee status changes already mutate local state and call persistState().
 * When local persistence is blocked by browser storage quota, the normal
 * persistence path may never reach the cloud reconciliation trigger. This
 * narrow bridge writes the changed Employee through the canonical GVData
 * upsert path without invoking the unrelated whole-resource reconciliation
 * pass, which includes append-only audit logs that do not support deletes.
 */
(function () {
  "use strict";

  let installed = false;
  let attempts = 0;
  let timer = null;

  function install() {
    if (installed || typeof window.toggleEmployeeStatus !== "function") {
      return false;
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
          typeof window.GVData?.upsertResource === "function"
        ) {
          if (typeof window.GVData.requireAuthenticatedManager === "function") {
            await window.GVData.requireAuthenticatedManager();
          }

          await window.GVData.upsertResource("employees", [row]);
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
    if (timer) {
      clearInterval(timer);
      timer = null;
    }
    return true;
  }

  function tryInstall() {
    try {
      if (install()) return;
      attempts += 1;
      if (attempts >= 120 && timer) {
        clearInterval(timer);
        timer = null;
      }
    } catch (error) {
      console.warn(
        "GotaVita Employee status sync bridge initialization skipped:",
        error?.message || error
      );
    }
  }

  tryInstall();
  if (!installed) {
    timer = setInterval(tryInstall, 50);
  }
})();
