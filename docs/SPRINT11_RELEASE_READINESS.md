# Sprint 11 — Regression & Release Readiness

Base checkpoint: `425f30b` (Sprint 10 synchronization complete)

## Scope

Sprint 11 is a release-readiness layer. It does not introduce another application-state architecture.

### Automated regression coverage

`tests/sprint11-release-readiness.test.js` verifies:

- authentication loads before the Supabase gateway;
- the gateway loads before the hydration/synchronization facade;
- the hydration/synchronization facade loads before `script.js`;
- the document starts in the locked authentication state;
- protected application startup resets to initial state when authorization is absent;
- the frozen `GVData` facade is preserved;
- the existing authoritative `GV_STATE` factory remains intact.

### CI

The existing GitHub Actions workflow now runs:

- JavaScript syntax checks;
- State Bridge + Hydration contract tests;
- Supabase hydration runtime test;
- cross-device synchronization runtime test;
- Sprint 11 release-readiness regression test.

## Release gate

`main` remains untouched until the local regression suite and hosted CI are confirmed. The branch is deliberately isolated from the Sprint 10 checkpoint.
