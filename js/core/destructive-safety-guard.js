/* GotaVita Manager — destructive-operation safety boundary. */
(function () {
  "use strict";

  const guarded = new Set();

  function install(name) {
    if (guarded.has(name)) return;
    const original = window[name];
    if (typeof original !== "function" || original.__gvDestructiveSafetyGuard) return;

    const wrapped = async function (...args) {
      if (typeof window.makeAutoBackup !== "function") {
        throw new Error("Safety backup service is unavailable; destructive action blocked.");
      }

      // These handlers already perform their own confirmation and call
      // makeAutoBackup(false) immediately before mutating state. Turn a backup
      // failure into a thrown exception at that exact boundary so mutation
      // cannot continue.
      const nativeBackup = window.makeAutoBackup;
      window.makeAutoBackup = function (...backupArgs) {
        const result = nativeBackup.apply(this, backupArgs);
        if (result === false) {
          throw new Error("Safety backup could not be created; destructive action cancelled.");
        }
        return result;
      };

      try {
        return await original.apply(this, args);
      } catch (error) {
        if (typeof window.showToast === "function" && /Safety backup could not be created|Safety backup service is unavailable/.test(String(error?.message || ""))) {
          window.showToast(String(error.message), "error");
        }
        return undefined;
      } finally {
        window.makeAutoBackup = nativeBackup;
      }
    };

    wrapped.__gvDestructiveSafetyGuard = true;
    wrapped.__gvOriginal = original;
    window[name] = wrapped;
    guarded.add(name);
  }

  [
    "deleteExpense",
    "disbandGroup",
    "clearAllGroups",
    "deleteDailyReport",
    "clearDeletedLog"
  ].forEach(install);

  window.__GV_DESTRUCTIVE_SAFETY_GUARD__ = true;
})();
