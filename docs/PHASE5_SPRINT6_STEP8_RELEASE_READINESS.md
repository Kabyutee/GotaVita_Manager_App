# Phase 5 Sprint 6 Step 8 — Worker Route Release Readiness

## Static checks
- Worker entry point is `worker.js`.
- `wrangler.jsonc` defines the static asset directory.
- `.assetsignore` excludes non-public files.
- No `functions/` Pages Functions directory is required by the Worker runtime.

## Required live checks
1. Open the root application URL.
2. Open `/gv-health` and confirm HTTP 200 and `status: "ok"`.
3. Open `/gv-config` and confirm only browser-safe Supabase configuration is exposed.
4. Confirm manager login and protected application flows after Supabase variables are configured.
