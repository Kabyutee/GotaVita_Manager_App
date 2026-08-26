# Canonical Synchronization Architecture

GotaVita uses one authoritative browser state, one Supabase gateway, one synchronization coordinator, one write queue, and one Realtime subscription.

## Rules

1. `script.js` owns the in-memory application state and UI-facing state replacement.
2. `js/core/data-gateway.js` is the only browser-to-Supabase data adapter.
3. `js/core/sync-manager.js` owns background reconciliation and queue flushing.
4. `js/core/conflict-resolution-integration.js` owns conflict policy.
5. `js/core/order-write-boundary-bridge.js` owns Order write-through and the single Realtime subscription.
6. Realtime handlers are registered before `subscribe()` and a channel is replaced only after it is closed or errored.
7. A remote snapshot must never blindly replace newer local state. Reconciliation is row-aware and deletion requires explicit tombstone evidence.
8. Backups and seed data are preserved; repair history does not remain in runtime code.

No runtime module may monkey-patch another module's exported API merely to repair a synchronization race. Fix the owning boundary instead.
