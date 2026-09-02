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

      // These handlers already perform their own confirmation. We wrap the
      // backup primitive so a failed safety backup becomes a hard stop.
      const nativeBackup = window.makeAutoBackup;
      let backupFailed = false;
      window.makeAutoBackup = function (...backupArgs) {
        const result = nativeBackup.apply(this, backupArgs);
        if (result === false) backupFailed = true;
        return result;
      };

      try {
        const result = await original.apply(this, args);
        return backupFailed ? undefined : result;
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
