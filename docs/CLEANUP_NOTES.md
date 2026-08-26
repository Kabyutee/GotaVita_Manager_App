# Canonical Sync Cleanup

This cleanup removes temporary synchronization repair layers that duplicated responsibilities across state, gateway, queue, conflict, and Realtime modules.

Preserved: seed data, backups, business modules, authentication, state factory, data gateway, conflict policy, sync manager, UI bridge, Order write boundary, and sync status.

Runtime goal: one state owner, one gateway, one sync coordinator, one queue authority, one conflict policy, and one Realtime subscription.
