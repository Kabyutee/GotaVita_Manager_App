# GotaVita P0 Master Data Protection Policy

Clients, Employees, and Products are Priority-0 master data.

Passive synchronization must never infer deletion from a smaller or empty remote snapshot for these resources. A size reduction requires an explicit manager CRUD action or an explicitly confirmed recovery operation.

The canonical repository recovery source is `supabase/seed/master-data.json`.

The 2026-08-24 forensic incident established that record-level master data is stronger evidence than a summary counter. The repository payload is therefore retained as the authoritative recovery source for these P0 resources.

P0 changes must originate from authenticated manager CRUD or deliberate confirmed recovery. Passive sync is not an authority for P0 deletion.