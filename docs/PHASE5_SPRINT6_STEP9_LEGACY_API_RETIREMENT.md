# GotaVita Manager — Phase 5 Sprint 6 Step 9

## Purpose
Retire the old Node/JSON `/api/*` server dependency from the Cloudflare Workers + Supabase production build.

## Changes
- Browser sync now stays local-first when Supabase is not configured.
- The production Worker returns an explicit `410 LEGACY_API_RETIRED` for legacy `/api/*` routes rather than allowing ambiguous platform errors.
- Existing manager authentication configuration remains unchanged.
- No business module or business data was removed.

## Validation
- `script.js` syntax: PASS
- `worker.js` syntax: PASS
