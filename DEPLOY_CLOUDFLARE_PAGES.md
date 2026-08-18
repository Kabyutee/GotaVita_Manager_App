# GotaVita Manager — Cloudflare Workers Static Assets Deployment

## Current architecture
GitHub -> Cloudflare Workers Builds -> Cloudflare Worker + Static Assets -> Supabase

This project is deployed as a Cloudflare Worker with Static Assets. `worker.js` handles the small production endpoints and delegates all other requests to the static asset binding.

## Build settings
- Production branch: `main`
- Build command: leave empty
- Deploy command: `npx wrangler deploy`
- Static asset directory: `.`

## Variables
In Cloudflare Worker Settings -> Variables and Secrets, add for Production:
- `SUPABASE_URL` = your Supabase project URL
- `SUPABASE_PUBLISHABLE_KEY` = your browser-safe `sb_publishable_...` key

Do NOT add service-role, secret, database password, or other private credentials to public/browser configuration.

## Production routes
- `/` -> GotaVita static application
- `/gv-health` -> non-secret production health JSON
- `/gv-config` -> browser-safe Supabase runtime configuration

## Repository hygiene
`.assetsignore` excludes Git metadata, Wrangler temporary files, deployment-only source folders, documentation, and secrets/templates from the public static asset set.
