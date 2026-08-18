# GotaVita Manager — Phase 5 Sprint 6 Step 8 — Worker Route Fix

## Purpose
The production deployment is running as a Cloudflare Worker with Static Assets, not Cloudflare Pages. The previous `functions/` files were Pages Functions and therefore were not automatically exposed as `/gv-health` and `/gv-config`.

## Fix
- Added `worker.js` as the Cloudflare Worker entry point.
- Added `/gv-health` as a Worker route.
- Added `/gv-config` as a Worker route exposing only browser-safe Supabase configuration.
- Static application requests are delegated to the `ASSETS` binding.
- Added `wrangler.jsonc` to make the Worker configuration explicit and repeatable.
- Added `.assetsignore` to exclude Git metadata, Wrangler temporary files, source-only deployment folders, secrets/templates, and Worker source/config from public static assets.

## Runtime variables
Configure these Worker variables for Production:
- `SUPABASE_URL`
- `SUPABASE_PUBLISHABLE_KEY`

Never configure a service-role or secret Supabase key as a browser-visible variable.

## Validation
After deployment verify:
- `/` returns the GotaVita application.
- `/gv-health` returns JSON with `status: "ok"`.
- `/gv-config` returns `window.GV_PUBLIC_CONFIG=...` without server-only credentials.
- The browser application continues to load normally.
