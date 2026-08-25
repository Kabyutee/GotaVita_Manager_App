# Order Delete Sync Fix

Remote `deleted_orders` tombstones are authoritative deletion evidence. The canonical reconciliation path must not resurrect an order that is already tombstoned remotely.

The bridge runs after canonical reconciliation, removes local `orders` entries whose remote tombstone is at least as new, persists the corrected state, and renders the canonical UI.
