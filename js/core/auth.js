/* GotaVita Manager — Phase 5 Sprint 1 Manager Authentication
 * Optional cloud-auth layer. It stays dormant until valid Supabase URL + publishable key are configured.
 */
(function () {
  "use strict";

  let client = null;
  let currentSession = null;
  let initialized = false;
  let managerProfile = null;

  function config() {
    return window.GV_SUPABASE_CONFIG || {};
  }

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
    if (identity) identity.textContent = session?.user?.email ? `Manager: ${session.user.email}` : "";
  }

  function openLogin() {
    const modal = document.getElementById("gvAuthModal");
    if (!modal) return;
    modal.classList.add("open");
    modal.setAttribute("aria-hidden", "false");
    const input = document.getElementById("gvAuthEmail");
    if (input) input.focus();
  }

  function closeLogin() {
    const modal = document.getElementById("gvAuthModal");
    if (!modal) return;
    modal.classList.remove("open");
    modal.setAttribute("aria-hidden", "true");
    setAuthStatus("", "neutral");
  }

  async function getManagerProfile(session) {
    if (!client || !session?.user?.id) return null;
    const { data, error } = await client
      .from("profiles")
      .select("id, company_id, role")
      .eq("id", session.user.id)
      .maybeSingle();
    if (error) throw error;
    if (!data) throw new Error("This manager account is not assigned to a GotaVita company profile.");
    if (String(data.role || "").toLowerCase() !== "manager") throw new Error("This account is not authorized as a GotaVita manager.");
    return data;
  }

  async function validateSession(session, signOutInvalid = false) {
    if (!session) { managerProfile = null; setLoggedInUI(null); return false; }
    try {
      managerProfile = await getManagerProfile(session);
      setLoggedInUI(session);
      setAuthStatus("Manager authenticated ✓", "success");
      return true;
    } catch (error) {
      managerProfile = null;
      setLoggedInUI(null);
      setAuthStatus(error?.message || "Manager authorization failed.", "error");
      if (signOutInvalid && client) { try { await client.auth.signOut(); } catch (_) {} }
      return false;
    }
  }

  async function requireManagerSession() {
    if (!isConfigured()) return { configured: false, authenticated: false, profile: null };
    if (!client) await init();
    const { data } = await client.auth.getSession();
    const ok = await validateSession(data?.session || null, true);
    return { configured: true, authenticated: ok, profile: managerProfile, session: ok ? data.session : null };
  }

  async function login(email, password) {
    if (!client) throw new Error("Supabase authentication is not configured.");
    const result = await client.auth.signInWithPassword({ email, password });
    if (result.error) throw result.error;
    const authorized = await validateSession(result.data.session, true);
    if (!authorized) throw new Error("Manager authentication succeeded, but this account is not authorized for GotaVita.");
    setTimeout(closeLogin, 500);
    return result.data.session;
  }

  async function logout() {
    if (!client) return false;
    const { error } = await client.auth.signOut();
    if (error) throw error;
    managerProfile = null;
    setLoggedInUI(null);
    setAuthStatus("Signed out.", "success");
    return true;
  }

  async function init() {
    if (initialized) return client;
    initialized = true;

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
        if (!email || !password) {
          setAuthStatus("Enter the manager email and password.", "error");
          return;
        }
        setAuthStatus("Authenticating…", "syncing");
        try {
          await login(email, password);
        } catch (error) {
          setAuthStatus(error?.message || "Authentication failed.", "error");
        }
      });
    }

    if (!isConfigured()) {
      setAuthStatus("Cloud authentication is not configured yet. Local/offline mode remains active.", "neutral");
      if (loginButton) loginButton.title = "Configure Supabase first to enable manager login.";
      return null;
    }

    client = window.supabase.createClient(config().url, config().publishableKey, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false }
    });

    const { data } = await client.auth.getSession();
    if (data?.session) await validateSession(data.session, true);
    else { setLoggedInUI(null); setAuthStatus("Ready for manager login.", "neutral"); }

    client.auth.onAuthStateChange(async (_event, session) => {
      if (_event === "SIGNED_OUT") { managerProfile = null; setLoggedInUI(null); return; }
      if (session) await validateSession(session, true);
      else { managerProfile = null; setLoggedInUI(null); }
    });
    return client;
  }

  window.GVAuth = Object.freeze({
    init,
    isConfigured,
    getClient: () => client,
    getSession: () => currentSession,
    getProfile: () => managerProfile,
    requireManagerSession,
    openLogin,
    closeLogin,
    login,
    logout
  });
})();
