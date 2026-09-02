/* GotaVita Manager — destructive-operation safety boundary. */
(function () {
  "use strict";

  const guarded = new Set();
  const SAFETY_MESSAGE = /Safety backup could not be created|Safety backup service is unavailable/;

  function safetyFailure(message) {
    const error = new Error(message);
    error.__gvSafetyBackupFailure = true;
    return error;
  }

  function guardedBackup(nativeBackup) {
    return function (...backupArgs) {
      const result = nativeBackup.apply(this, backupArgs);
      if (result === false) {
        throw safetyFailure("Safety backup could not be created; destructive action cancelled.");
      }
      return result;
    };
  }

  function showSafetyError(error) {
    if (typeof window.showToast === "function") {
      window.showToast(String(error?.message || error), "error");
    }
  }

  function install(name) {
    if (guarded.has(name)) return;
    const original = window[name];
    if (typeof original !== "function" || original.__gvDestructiveSafetyGuard) return;

    const wrapped = async function (...args) {
      if (typeof window.makeAutoBackup !== "function") {
        throw safetyFailure("Safety backup service is unavailable; destructive action blocked.");
      }

      // These handlers already perform their own confirmation and call
      // makeAutoBackup(false) immediately before mutating state. Turn a backup
      // failure into a thrown exception at that exact boundary so mutation
      // cannot continue.
      const nativeBackup = window.makeAutoBackup;
      window.makeAutoBackup = guardedBackup(nativeBackup);

      try {
        return await original.apply(this, args);
      } catch (error) {
        if (error?.__gvSafetyBackupFailure || SAFETY_MESSAGE.test(String(error?.message || ""))) {
          showSafetyError(error);
          return undefined;
        }
        throw error;
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
    "clearDeletedLog",
    "resetToSeed"
  ].forEach(install);

  window.__GV_DESTRUCTIVE_SAFETY_GUARD__ = true;
})();
