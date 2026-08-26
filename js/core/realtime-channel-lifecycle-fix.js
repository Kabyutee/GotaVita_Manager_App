/* GotaVita Manager — optional Realtime transport safety shim. */
(function () {
  "use strict";

  // Canonical synchronization is handled by GVSync's authenticated polling and
  // reconciliation path. The optional websocket channel previously produced
  // lifecycle errors in production and could interfere with the write path.
  // Keep the existing order bridge API satisfied without opening a broken
  // Realtime subscription. Durable cross-device convergence continues through
  // Supabase reads/writes every 5 seconds and on focus/visibility/online events.
  const auth = window.GVAuth;
  if (!auth || typeof auth.getClient !== "function") return;

  let patchedClient = null;

  function safeChannel() {
    const channel = {
      __GV_OPTIONAL_REALTIME_DISABLED__: true,
      on() {
        return channel;
      },
      subscribe(callback) {
        if (typeof callback === "function") {
          queueMicrotask(() => callback("SUBSCRIBED"));
        }
        return channel;
      }
    };
    return channel;
  }

  function patchClient(client) {
    if (!client || client.__GV_REALTIME_CHANNEL_PATCH__) return client;

    const originalChannel = client.channel;
    if (typeof originalChannel !== "function") return client;

    client.channel = function channel(topic, ...args) {
      if (topic === "gotavita-canonical-sync") {
        return safeChannel();
      }
      return originalChannel.apply(this, [topic, ...args]);
    };

    Object.defineProperty(client, "__GV_REALTIME_CHANNEL_PATCH__", {
      value: true,
      configurable: false,
      enumerable: false,
      writable: false
    });

    patchedClient = client;
    return client;
  }

  function patchCurrentClient() {
    try {
      const client = auth.getClient?.();
      if (client && client !== patchedClient) patchClient(client);
    } catch (_) {}
  }

  patchCurrentClient();

  window.addEventListener("gv-auth-state-changed", (event) => {
    if (event?.detail?.authenticated === true) setTimeout(patchCurrentClient, 0);
  });
})();
