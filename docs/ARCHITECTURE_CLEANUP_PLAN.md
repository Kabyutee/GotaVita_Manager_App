# Architecture Cleanup Plan

The synchronization stack is being reduced to a small set of owners.

- State/UI: `script.js` + `js/core/state.js`
- Persistence: `js/core/data-gateway.js`
- Reconciliation/queue polling: `js/core/sync-manager.js`
- Conflict policy: `js/core/conflict-resolution-integration.js`
- Order write-through + Realtime: `js/core/order-write-boundary-bridge.js`
- Status: `js/core/sync-status.js`

Temporary repair modules and one-off recovery patches are removed rather than layered into runtime startup.
