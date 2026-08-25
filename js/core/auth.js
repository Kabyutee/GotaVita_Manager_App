/* GotaVita Manager — Authentication Lockdown Sprint
 * Hard boundary: Supabase session -> manager role -> company verification -> unlock.
 */
(function () {
  "use strict";

  let client = null;
  let currentSession = null;
  let initialized = false;
  let managerProfile = null;
  let authorized = false;
  let lastEmittedAuthState = null;
  let validationPromise = null;
  let validationUserId = "";

  function config() { return window.GV_SUPABASE_CONFIG || {}; }
  function isConfigured() {
    const cfg = config();
    return typeof window.supabase !== "undefined" && !!cfg.url && !!cfg.publishableKey;
  }

  function setAuthStatus(message, type) {
    const el = document.getElementById("gvAuthStatus");
    if (!el) return;
    el.textContent = message || "";
    el.dataset.status = type || "neutral";
  }
  function setLoggedInUI(session) {
    currentSession = session || null;

    const loginButton = document.getElementById("gvCloudLoginBtn");
    const logoutButton = document.getElementById("gvCloudLogoutBtn");
    const identity = document.getElementById("gvAuthIdentity");

    if (loginButton) loginButton.hidden = !!session;
    if (logoutButton) logoutButton.hidden = !session;

    if (identity) {
      identity.textContent = session?.user?.email
        ? `Manager: ${session.user.email}`
        : "";
    }
  }

  function emitAuthState(force = false) {
    const authenticated = authorized === true;
    if (!force && lastEmittedAuthState === authenticated) return;
    lastEmittedAuthState = authenticated;
    window.dispatchEvent(
      new CustomEvent("gv-auth-state-changed", {
        detail: { authenticated }
      })
    );
  }

  function setApplicationLock(locked, reason = "") {
    const root = document.documentElement;
    const modal = document.getElementById("gvAuthModal");
    const closeButton = document.getElementById("gvAuthCloseBtn");

    root.dataset.gvAuthState = locked ? "locked" : "unlocked";
    root.setAttribute("aria-busy", locked ? "true" : "false");

    if (modal) {
      if (locked) {
        modal.classList.add("open");
        modal.setAttribute("aria-hidden", "false");
        requestAnimationFrame(() => {
          const emailInput = document.getElementById("gvAuthEmail");
          if (emailInput && !modal.hidden) emailInput.focus();
        });
      } else {
        if (modal.contains(document.activeElement)) document.activeElement.blur();
        modal.classList.remove("open");
        modal.setAttribute("aria-hidden", "true");
      }
    }

    if (closeButton) closeButton.hidden = locked;
    if (locked && reason) setAuthStatus(reason, "error");
  }

  function openLogin() { setApplicationLock(true); }

  function closeLogin() {
    if (!authorized) return;
    const modal = document.getElementById("gvAuthModal");
    if (!modal) return;
    if (modal.contains(document.activeElement)) document.activeElement.blur();
    modal.classList.remove("open");
    modal.setAttribute("aria-hidden", "true");
    setAuthStatus("Manager authenticated ✓", "success");
  }

  async function getManagerProfile(session) {
    if (!client || !session?.user?.id) return null;
    const { data, error } = await client
      .from("profiles")
      .select("id, company_id, role")
      .eq("id", session.user.id)
      .maybeSingle();
    if (error) throw error;
    if (!data) throw new Error("This account has no GotaVita manager profile.");
    if (String(data.role || "").toLowerCase() !== "manager") {
      throw new Error("This account is not authorized as a GotaVita manager.");
    }
    if (!data.company_id) throw new Error("This manager is not assigned to a company.");

    const companyResult = await client
      .from("companies")
      .select("id, name")
      .eq("id", data.company_id)
      .maybeSingle();
    if (companyResult.error) throw companyResult.error;
    if (!companyResult.data) throw new Error("The manager's company could not be verified.");

    return { ...data, company: companyResult.data };
  }

  async function validateSession(session, signOutInvalid = false) {
    const userId = String(session?.user?.id || "");

    if (!session) {
      if (validationPromise) {
        try { await validationPromise; } catch (_) {}
      }
      authorized = false;
      managerProfile = null;
      validationUserId = "";
      setLoggedInUI(null);
      setApplicationLock(true, "Login required.");
      emitAuthState();
      return false;
    }

    if (validationPromise && validationUserId === userId) {
      return validationPromise;
    }

    validationUserId = userId;
    validationPromise = (async () => {
      try {
        const profile = await getManagerProfile(session);
        managerProfile = profile;
        currentSession = session;
        authorized = true;
        setLoggedInUI(session);
        setAuthStatus("Manager + company verified ✓", "success");
        setApplicationLock(false);
        emitAuthState();
        return true;
      } catch (error) {
        authorized = false;
        managerProfile = null;
        currentSession = null;
        setLoggedInUI(null);
        setApplicationLock(true, error?.message || "Authorization failed.");
        if (signOutInvalid && client) {
          try { await client.auth.signOut(); } catch (_) {}
        }
        emitAuthState();
        return false;
      } finally {
        validationPromise = null;
      }
    })();

    return validationPromise;
  }

  async function requireManagerSession() {
    if (!isConfigured()) {
      setApplicationLock(true, "Supabase authentication is required before GotaVita can unlock.");
      return { configured: false, authenticated: false, profile: null, session: null };
    }
    if (!client) await init();
    const { data, error } = await client.auth.getSession();
    if (error) return { configured: true, authenticated: false, profile: null, session: null, error };
    const ok = await validateSession(data?.session || null, false);
    return { configured: true, authenticated: ok, profile: managerProfile, session: ok ? data.session : null };
  }

  async function login(email, password) {
    if (!client) throw new Error("Supabase authentication is not configured.");
    const result = await client.auth.signInWithPassword({ email, password });
    if (result.error) throw result.error;
    const valid = await validateSession(result.data.session, true);
    if (!valid) throw new Error("Login succeeded, but manager/company authorization failed.");
    setTimeout(closeLogin, 300);
    return result.data.session;
  }

  async function logout() {
    authorized = false;
    currentSession = null;
    managerProfile = null;
    validationUserId = "";

    setLoggedInUI(null);
    setApplicationLock(true);
    setAuthStatus("Signed out. Login required.", "success");
    emitAuthState(true);

    if (client) {
      const { error } = await client.auth.signOut();
      if (error) {
        console.warn("GotaVita Supabase sign-out:", error.message);
        setAuthStatus("Signed out locally. Session cleanup will retry.", "error");
        return false;
      }
    }

    return true;
  }

  async function init() {
    if (initialized) return client;
    initialized = true;
    setApplicationLock(true);

    const loginButton = document.getElementById("gvCloudLoginBtn");
    const logoutButton = document.getElementById("gvCloudLogoutBtn");
    const form = document.getElementById("gvAuthForm");
    const closeButton = document.getElementById("gvAuthCloseBtn");

    if (loginButton) loginButton.addEventListener("click", openLogin);
    if (logoutButton) logoutButton.addEventListener("click", () => logout().catch((e) => setAuthStatus(e.message, "error")));
    if (closeButton) closeButton.addEventListener("click", closeLogin);
    if (form) {
      form.addEventListener("submit", async (event) => {
        event.preventDefault();
        const email = String(document.getElementById("gvAuthEmail")?.value || "").trim();
        const password = String(document.getElementById("gvAuthPassword")?.value || "");
        if (!email || !password) { setAuthStatus("Enter the manager email and password.", "error"); return; }
        setAuthStatus("Authenticating manager…", "syncing");
        try { await login(email, password); }
        catch (error) { setAuthStatus(error?.message || "Authentication failed.", "error"); setApplicationLock(true); }
      });
    }

    if (!isConfigured()) {
      setApplicationLock(true, "Supabase authentication is not configured. The application remains locked.");
      return null;
    }

    client = window.supabase.createClient(config().url, config().publishableKey, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false }
    });

    const { data, error } = await client.auth.getSession();
    if (error) await validateSession(null, false);
    else await validateSession(data?.session || null, false);

    client.auth.onAuthStateChange(async (_event, session) => {
      if (_event === "SIGNED_OUT") {
        authorized = false;
        managerProfile = null;
        currentSession = null;
        validationUserId = "";
        setLoggedInUI(null);
        setApplicationLock(true);
        setAuthStatus("Signed out. Login required.", "success");
        emitAuthState(true);
        return;
      }

      if (_event === "TOKEN_REFRESHED" && session && authorized && currentSession?.user?.id === session.user?.id) {
        currentSession = session;
        setLoggedInUI(session);
        return;
      }

      if (session) {
        await validateSession(session, false);
      } else {
        await validateSession(null, false);
      }
    });
  }

  window.GVAuth = Object.freeze({
    init,
    isConfigured,
    isAuthorized: () => authorized,
    getClient: () => client,
    getSession: () => currentSession,
    getProfile: () => managerProfile,
    requireManagerSession,
    openLogin,
    closeLogin,
    login,
    logout,
    lock: () => setApplicationLock(true),
    unlock: () => authorized && setApplicationLock(false)
  });
})();