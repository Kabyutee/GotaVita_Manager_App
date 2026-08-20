# Sprint 12 Hardening Notes

Sprint 18 follow-up: transaction synchronization is already routed through the GVData facade installed by js/core/ui-bridge.js. The facade sync() calls syncCrossDevice(), which pushes queued resources through upsertResource() and pulls supported resources through selectResource(). Do not enable the legacy cloudSyncAdapterReady() path as a second sync authority. Future work should harden and prove the active ui-bridge path instead.
