# GotaVita P0 Master Data Protection

## Protected resources

Clients, Employees, and Products are Priority-0 master data.

## Rule

Passive synchronization must never infer deletion from a smaller or empty remote snapshot for these resources. A size reduction requires an explicit manager CRUD operation or an explicitly confirmed recovery operation.

## Recovery source

The canonical repository master source is `supabase/seed/master-data.json`. It contains the record-level master payload used to restore Clients, Employees, and Products.

## Incident baseline

The production forensic audit on 2026-08-24 established a last-known-good application snapshot of 64 Clients, 7 Products, and 9 Employees, while the record-level repository master payload contained 66 Clients, 7 Products, and 9 Employees. The record-level payload is retained as the recovery source; no client rows are removed merely to reconcile the summary counter.

## Release protection

The fail-closed cloud snapshot safety gate is implemented in `js/core/sync-cloud-snapshot-safety.js` and is validated by `tests/p0-master-data-safety.test.js`.

## Change authority

P0 changes must originate from an authenticated manager CRUD action or a deliberate, confirmed recovery operation. Automated passive sync is not an authority for deletion of P0 master data.
