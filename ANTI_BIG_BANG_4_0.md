# ANTI BIG BANG 4.0 — System Audit + Release Gate

## Purpose

ANTI BIG BANG 4.0 replaces symptom-by-symptom patching with a staged system audit. A change cannot reach browser verification until the application has one clear synchronization authority and the cloud boundary is proven healthy.

## Release rule

**No production merge while any earlier layer is red.**

Production remains untouched until all gates below are green against the exact candidate SHA.

## Gate 0 — Production freeze

Record the production SHA before any work begins. Reject any operation that targets `main`, the production Worker, or production Supabase data.

## Gate 1 — Repository/system audit

Scan the whole repository before changing behavior.

Check:

- state authority
- dirty/changed-resource detection
- queue ownership
- sync ownership
- UI render ownership
- authentication lifecycle
- Supabase company/RLS boundary
- schema migrations vs gateway assumptions
- deployment workflows and exact release-SHA reporting
- duplicate/legacy synchronization code

Red flags become release blockers, not follow-up cleanup.

## Gate 2 — One synchronization authority

The target architecture is:

`state -> dirty detection -> queue -> GVData.sync() -> Supabase -> remote state -> UI render`

Only one layer owns each responsibility.

Forbidden release conditions:

- parallel `syncLocalMirror` and baseline-based dirty detectors
- multiple wrappers that replace/monkey-patch `GVData.sync`
- UI code that independently mutates the sync queue
- health checks that hydrate state without the sync authority
- background render paths that bypass the interaction guard

## Gate 3 — Cloud write proof

A local save is not considered a successful save until the authoritative cloud write succeeds.

For every important transactional resource verify:

1. authentication is valid
2. manager role is valid
3. company scope exists
4. RLS permits the operation
5. schema supports the gateway conflict key
6. upsert/insert succeeds
7. a subsequent read returns the written record

A non-empty queue is treated as an unresolved cloud-write failure, not a harmless status.

## Gate 4 — Partial failure semantics

One failed resource must not erase or hide unrelated successful changes.

Required behavior:

- failed resource remains queued
- successful resources remain committed
- remote pull still occurs where safe
- failure reason is observable
- queue drains only after authoritative success

## Gate 5 — Receiver convergence

A second window/device must converge from cloud state without refresh or manual Sync.

Required invariant:

`remoteChanged -> stateChanged -> renderRequired`

No receiver render may be based only on a successful health check.

## Gate 6 — Interaction preservation

Background synchronization must never destroy active controls, selected orders, forms, dialogs, or filters.

Focused controls are part of the protected interaction boundary.

## Gate 7 — Exact deployment proof

The preview must report the exact candidate SHA through `/gv-health` before browser verification.

Testing an older preview is considered an invalid test result.

Production SHA and preview SHA must be reported separately.

## Gate 8 — Browser matrix

Only after Gates 0–7 pass:

**Window A**

- create order
- edit order
- verify save
- observe queue drain

**Window B**

- keep selected orders checked
- do not refresh
- do not press Sync Now
- verify automatic create/update arrival
- verify selections remain intact

Then reverse the direction and repeat.

## Gate 9 — Release decision

Merge only when:

- repository audit green
- architecture audit green
- cloud write/read proof green
- Supabase migration/RLS alignment green
- exact preview SHA green
- browser matrix green
- production remains unchanged until merge

## Important operating principle

When a browser symptom repeats after multiple patches, stop patching and return to Gate 1. Repeated symptoms are evidence that the architecture, not the UI, is the failure surface.

<!-- ANTI BIG BANG 4.0 CI retrigger checkpoint: no runtime behavior change. -->
<!-- PR40 canonical preview retrigger: no runtime behavior change. -->
