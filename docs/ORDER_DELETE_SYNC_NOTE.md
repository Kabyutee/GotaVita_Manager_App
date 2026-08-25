# Order delete sync note

PR #136 is already deployed, and the remote `deleted_orders` tombstone exists for the failing test order. This follow-up changes only `js/core/sync-status.js` so the existing deletion bridge is cache-busted and a sync flush runs after the bridge loads. The protected `index.html` remains unchanged.
