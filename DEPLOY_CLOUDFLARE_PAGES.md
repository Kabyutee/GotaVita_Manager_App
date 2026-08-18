# GotaVita Manager — Cloudflare Pages Deployment

## Architecture
GitHub -> Cloudflare Pages -> Supabase

The static application is deployed by Cloudflare Pages. A small Pages Function at `/gv-config` injects only the public Supabase URL and publishable key at runtime. This avoids hard-coding project-specific configuration in source control.

## Cloudflare Pages settings
- Connect the GitHub repository.
- Production branch: `main`.
- Build command: leave blank (static HTML application).
- Build output directory: `.`
- Framework preset: none / static HTML.

## Variables
In Cloudflare Pages -> Settings -> Environment variables / Variables and Secrets, add:
- `SUPABASE_URL` = your Supabase project URL
- `SUPABASE_PUBLISHABLE_KEY` = your `sb_publishable_...` key

Set them for Production and Preview as appropriate.

Do NOT add `SUPABASE_SECRET_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, or database passwords to the browser/public configuration.

## Supabase setup order
1. Run migration `supabase/migrations/202608180001_master_data.sql`.
2. Run `202608180002_operational_transactions.sql`.
3. Run `202608180003_security_sync_hardening.sql`.
4. Create the manager account in Supabase Auth.
5. Create/verify the manager profile and company membership.
6. Import master data using the dry-run migration first.
7. Verify counts and relationships.
8. Only then perform the controlled live migration/cutover.

## Cutover rule
Do not switch production writes to Supabase until:
- master-data counts match the source snapshot;
- transaction counts match the source snapshot;
- RLS tests pass;
- login/logout works;
- refresh/reopen persistence works;
- multi-device edits are verified;
- offline queue/retry is verified;
- backup/restore is verified;
- no secrets appear in the public bundle.

## Local mode
Opening `index.html` directly remains supported. The Cloudflare-only `/gv-config` endpoint will be unavailable and the app will safely remain in local/offline mode unless public Supabase values are supplied another way.
