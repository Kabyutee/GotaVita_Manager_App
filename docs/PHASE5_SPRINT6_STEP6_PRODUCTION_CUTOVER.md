# GotaVita Manager — Phase 5 Sprint 6 Step 6
## Production Cutover & Smoke-Test Gate

Step 6 adds a minimal Cloudflare Pages health endpoint and a repeatable smoke-test script.

### Included production checks
- `/` returns the GotaVita Manager application.
- `/gv-health` returns non-secret deployment health information.
- `/gv-config` returns only the browser-safe Supabase URL and publishable key.
- Security headers and CSP remain enabled.
- Manager authentication, production guard, and sync manager remain wired into the application.
- Browser assets are scanned for obvious service-role/secret key patterns.

### Run static validation
From the project root:

`node scripts/verify-sprint6-step6.mjs`

### Run the live smoke test
PowerShell:

`$env:GOTAVITA_PRODUCTION_URL="https://YOUR-PAGES-DOMAIN"`
`node scripts/verify-sprint6-step6.mjs`

The smoke test does not log in, create records, or modify business data. Real manager-account/RLS verification remains a separate controlled test using dedicated test accounts.

### Cutover rule
Do not declare production fully validated until the smoke test passes against the deployed URL and the dedicated manager/RLS test has passed in the real Supabase project.
