# Sprint 12 — Hydration Hardening Checkpoint

ANTI BIG BANG checkpoint for the existing Supabase hydration boundary.

## Surgical change

A transient cloud-read failure no longer permanently occupies the one-shot hydration promise. The next authorized health check may retry hydration. Successful hydration remains single-install and single-persist.

## Regression contract

`tests/sprint12-hydration-hardening.test.js` verifies:

- failed cloud hydration does not replace local state;
- failed cloud hydration does not persist partial state;
- a later health check retries after the transient failure;
- the successful retry replaces and persists exactly once;
- later health checks do not hydrate a second time.

This file documents the checkpoint and is intentionally kept separate from application behavior.
