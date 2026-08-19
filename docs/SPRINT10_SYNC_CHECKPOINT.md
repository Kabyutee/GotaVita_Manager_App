# Sprint 10 — State Bridge, Supabase Hydration, and Cross-Device Sync Checkpoint

Base: `84e50ce`

Verified branch: `phase1-state-bridge`

## Completed

### State Bridge
- Retained the existing authoritative `replaceState(nextState)` / `getStateSnapshot()` boundary.
- Expanded `GV_CONFIG.SYNC_RESOURCES` to all 15 application-state collections.
- Added automated state-bridge contract coverage.

### Supabase Hydration
- Added a guarded hydration boundary through the existing `GVData.health()` startup path.
- Hydrates only for an authorized manager with a healthy Supabase connection.
- Empty cloud resources do not erase local data.
- Cloud read failures preserve local state.
- Hydrated state is installed only through `replaceState()` and persisted locally.

### Cross-Device Synchronization
- Added a single gateway facade that exposes the existing cloud adapter plus controlled `sync()` behavior.
- Queued local resources are upserted through `GVData.upsertResource()`.
- The complete supported cloud surface is pulled back after writes so devices converge on one authoritative cloud state.
- Queue entries are cleared only after successful convergence.
- Write/read failures preserve the local queue and state.

## Automated verification

All local checks passed from the verified branch:

```text
node --check script.js                    PASS
node --check js/core/state.js             PASS
node --check js/core/data-gateway.js      PASS
node --check js/core/ui-bridge.js         PASS

Sprint 10 State Bridge + Hydration verification: PASS
Phase 3 Supabase hydration runtime verification: PASS
Phase 4 cross-device sync runtime verification: PASS
```

The Phase 3 and Phase 4 runtime suites intentionally include RLS/read-write failure scenarios and verify that local state and the sync queue remain protected.

## Safety

- `main` remains untouched.
- The application keeps one authoritative in-memory state boundary.
- No service-role keys or secret credentials are introduced.
- No broad rewrite of `script.js` was required for the hydration/synchronization layers.
