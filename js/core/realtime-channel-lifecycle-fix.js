/* GotaVita Manager — Realtime channel lifecycle compatibility fix. */
(function () {
  "use strict";

  const auth = window.GVAuth;
  if (!auth || typeof auth.getClient !== "function") return;

  let sequence = 0;
  let patchedClient = null;

  function patchClient(client) {
    if (!client || client.__GV_REALTIME_CHANNEL_PATCH__) return client;

    const originalChannel = client.channel;
    if (typeof originalChannel !== "function") return client;

    client.channel = function channel(topic, ...args) {
      if (topic !== "gotavita-canonical-sync") {
        return originalChannel.apply(this, [topic, ...args]);
      }

      sequence += 1;
      const uniqueTopic = `gotavita-canonical-sync-${Date.now()}-${sequence}`;
      return originalChannel.apply(this, [uniqueTopic, ...args]);
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
