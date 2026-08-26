/* GotaVita Manager — Realtime channel lifecycle compatibility fix. */
(function () {
  "use strict";

  const auth = window.GVAuth;
  if (!auth || typeof auth.getClient !== "function") return;
  if (auth.getClient.__GV_REALTIME_CHANNEL_PATCH__) return;

  const originalGetClient = auth.getClient.bind(auth);
  let sequence = 0;
  let patchedClient = null;

  function patchClient(client) {
    if (!client || client.__GV_REALTIME_CHANNEL_PATCH__) return client;
    const originalChannel = client.channel.bind(client);

    client.channel = function channel(topic, ...args) {
      if (topic !== "gotavita-canonical-sync") {
        return originalChannel(topic, ...args);
      }

      // Supabase Realtime keeps channel topics keyed internally. Reusing a
      // previously subscribed topic during retry causes later .on() calls to
      // be rejected. Give each canonical-sync attempt a fresh topic.
      sequence += 1;
      const uniqueTopic = `gotavita-canonical-sync-${Date.now()}-${sequence}`;
      return originalChannel(uniqueTopic, ...args);
    };

    Object.defineProperty(client, "__GV_REALTIME_CHANNEL_PATCH__", {
      value: true,
      configurable: false,
      enumerable: false,
      writable: false
    });

    return client;
  }

  function getClientPatched() {
    const client = originalGetClient();
    if (!client) return client;
    if (client !== patchedClient) patchedClient = patchClient(client);
    return patchedClient;
  }

  Object.defineProperty(getClientPatched, "__GV_REALTIME_CHANNEL_PATCH__", {
    value: true,
    configurable: false,
    enumerable: false,
    writable: false
  });

  auth.getClient = getClientPatched;
})();
