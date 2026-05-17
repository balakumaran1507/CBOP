# CBOP HANDOFF

## Last updated
2026-05-17 — Patches 1–5: GST compliance, seal, templates, PWA, n8n email fix

## Completed slices
✅ Slice 0 — Infrastructure Setup
✅ Slice 1 — Auth + Shell
✅ Slice 2 — Home Dashboard
✅ Slice 3 — Sales Pipeline
✅ Slice 4 — Invoices + PDF
✅ Slice 4.5 — Invoice PDF v2 (full rebuild)
✅ Slice 5 — Leads + Clients
✅ Slice 6 — Tasks + Projects
✅ Slice 7 — Work Sessions
✅ Slice 8 — Templates + PDF Export
✅ Slice 9 — CEO Panel
✅ Slice 10 — Settings + System Jobs
✅ Slice 11 — n8n Automations
✅ Slice 12 — OpenClaw Agents
✅ Slice 13 — Security Audit + Deploy
✅ Patch 1 — GST address fields: supplier + client address on invoices
✅ Patch 2 — Company seal support on invoice PDF
✅ Patch 3 — 10 professional templates seeded
✅ Patch 4 — PWA manifest + service worker — installable on phone
✅ Patch 5 — n8n email workflows verified on internal SMTP (already correct)

## What works right now
Full CBOP v2 feature set (all 13 slices) plus patches 1–5.

### Post-patch additions
- Invoices now render supplier address (below company name) and client address (in Bill To)
- Company seal renders in signature section of invoice PDF (path-based, semi-transparent)
- Settings → Companies slide-over now has Address textarea and Seal Image Path input
- 10 professional templates in DB (run `node scripts/seed-templates.js` to populate)
- Template PDF export redesigned: Zoho-style with circle logo, company name, address, GSTIN, doc type in header. Inter-only, zero amber.
- CBOP is a PWA: manifest.json, sw.js, icons in /public/icons/. Add to Home Screen works on mobile.
- n8n welcome email workflows (client_onboarding + employee_onboarding) already use POST /api/internal/send-email — confirmed correct, no changes needed.

### Security hardening (Slice 13)
- Rate limiting on `/api/auth/*` — 10 requests/60s per IP, in-memory Map, auto-prune
- Security headers on all API responses via `hono/secure-headers`
- IDOR fixed: getOverdueInvoices, getTodaysTasks, getPipelineSummary
- All finance routes: `requireRole('ceo')` ✅
- All queries filter by `company_id = ANY(companyIds)` ✅

### Core platform
- Auth (better-auth v0.8.8), session, health check at `/api/health`
- Dashboard — stat cards, alert bar, today's priorities, tasks, activity feed, invoice alerts
- Full sales pipeline: leads, deals, clients, invoices + PDF
- Full ops: projects, tasks, work sessions
- Templates + PDF export (Zoho-style)
- Finance (CEO-only): P&L, holdings, expenses, personal wealth
- Mentor Council AI (CEO-only)
- CEO Panel with cbop_control agent
- Settings: users, companies (address + seal), system jobs, integrations
- n8n: 7 workflows; email via internal SMTP endpoint

### Infrastructure
- PostgreSQL container: `cbop-postgres` — Running ✅
- n8n container: `cbop-n8n` — Running ✅
- CBOP app: runs natively via `npm start -p 3003`
- `npm run build` — clean ✅

## DB bootstrap (run once on fresh postgres — in this exact order)
1. `docker exec -i cbop-postgres psql -U cbop_user -d cbop_v2 < migrations/001_initial_schema.sql`
2. `docker exec -i cbop-postgres psql -U cbop_user -d cbop_v2 < migrations/002_auth_tables.sql`
3. `docker exec -i cbop-postgres psql -U cbop_user -d cbop_v2 < migrations/003_add_updated_at.sql`
4. `docker exec -i cbop-postgres psql -U cbop_user -d cbop_v2 < migrations/004_updated_at_triggers.sql`
5. `docker exec -i cbop-postgres psql -U cbop_user -d cbop_v2 < migrations/005_invoice_details.sql`
6. `docker exec -i cbop-postgres psql -U cbop_user -d cbop_v2 < migrations/006_invoice_v2.sql`
7. `docker exec -i cbop-postgres psql -U cbop_user -d cbop_v2 < migrations/007_ceo_panel.sql`
8. `docker exec -i cbop-postgres psql -U cbop_user -d cbop_v2 < migrations/008_invoice_pdf_v3.sql`
9. `docker exec -i cbop-postgres psql -U cbop_user -d cbop_v2 < migrations/009_address_fields.sql`
10. `docker exec -i cbop-postgres psql -U cbop_user -d cbop_v2 < migrations/010_company_seal.sql`
11. `npm run dev` — start the app first (seed calls the auth HTTP API)
12. `npm run db:seed`
13. `node scripts/seed-templates.js`

## Manual steps still needed
- Run migrations 009 and 010 against the live database:
  ```
  docker exec -i cbop-postgres psql -U cbop_user -d cbop_v2 < migrations/009_address_fields.sql
  docker exec -i cbop-postgres psql -U cbop_user -d cbop_v2 < migrations/010_company_seal.sql
  ```
- Seed templates: `node scripts/seed-templates.js`
- Add real company addresses: Settings → Companies → edit each company
- Upload real company seal PNGs to `/public/seals/` and set path in Settings → Companies
- Re-import n8n workflows after any future workflow changes:
  `docker exec cbop-n8n n8n import:workflow --separate --input=/workflows/`
  Then re-select CBOP Postgres credential in updated workflows + activate
- n8n: toggle all 7 workflows to Active in n8n UI; set error_handler as global error workflow

## Files changed this session
- `migrations/009_address_fields.sql` — NEW: IF NOT EXISTS for companies.address and sales_clients.address
- `migrations/010_company_seal.sql` — NEW: IF NOT EXISTS for companies.company_seal
- `api/routes/settings.ts` — GET /api/settings/companies now returns address + company_seal; PATCH now accepts and saves both fields
- `app/(dashboard)/settings/page.tsx` — SettingsCompany interface + EditCompanySlideOver form: added address textarea and company_seal path input
- `api/routes/templates.ts` — PDF endpoint now fetches company address, gstin, logo, theme, seal; buildTemplatePdf rebuilt as Zoho-style (circle logo, Inter-only, doc type header, no amber)
- `scripts/seed-templates.js` — NEW: seeds 10 professional templates (Indian jurisdiction)
- `public/manifest.json` — NEW: PWA manifest
- `public/sw.js` — NEW: service worker (network-first, offline fallback)
- `public/icons/icon-192.png` — NEW: generated PWA icon
- `public/icons/icon-512.png` — NEW: generated PWA icon
- `public/seals/.gitkeep` — NEW: placeholder for company seal PNGs
- `scripts/generate-icons.js` — NEW: generates PWA icons via sharp
- `app/components/ServiceWorkerRegistration.tsx` — NEW: client component that registers sw.js
- `app/layout.tsx` — added PWA meta tags + manifest link + ServiceWorkerRegistration component
- `next.config.js` — added Service-Worker-Allowed header for /sw.js

## Failed attempts — do not retry
(All from prior sessions — see git log for v2.0.0 context)
- Mapping better-auth to our `users` table via `advanced.database` — v0.8 requires Kysely dialect.
- Snake_case columns in `002_auth_tables.sql` — better-auth v0.8 expects camelCase. Do not revert.
- `token` column in session table — NOT NULL kills sign-up silently. Removed.
- `new Hono()` without type params + `c.get('userId')` — TypeScript infers `never`. Fix: use hono-vars.ts.
- `const guard = [requireAuth, requireRole('ceo')]` + `...guard` spread in Hono routes — TypeScript infers incorrectly. Always inline middleware.
- `use(params)` in Next.js 14 page components — params is a plain object in Next.js 14. Always destructure directly.
- `permissionsPolicy` in `hono/secure-headers` — use `false` or remove; set via next.config.js.
- Dockerfile + cbop-app Docker service — CBOP runs natively on homeserver, not in Docker.

## Known issues
- **`updated_at` is trigger-managed** — never set manually in PATCH queries.
- **n8n credential ID mismatch after import** — after importing, re-select `CBOP Postgres` credential per workflow.
- **Auth rate limiter is in-memory** — resets on app restart. Acceptable for 3-user homeserver.
- **Uptime Kuma monitors** — configure `/api/health` monitor manually in Uptime Kuma UI.
- **morning_briefing daily 8am** — only fires via Monday reporting workflow. Needs dedicated n8n cron.
- **Work page has no frontend role gate** — CTO only sees Etherence IT data via companyIds API filter.

## Credentials
- founders@cybercomctf.com / T6Y8F9juH6mYVn (CEO — all companies)
- nabeelahanjum.wrk@gmail.com / hNuPgNmY7iUmtG (COO — all companies)
- guru2006may@gmail.com / sv27FCpRUc4FbF (CTO — Etherence IT only)

## OpenClaw context
- URL: http://127.0.0.1:18789
- Auth: Bearer e56ccc6f20041f83804af50cdadd1fb6c12949bd642dfe02
- Send messages: POST /send
- Trigger agents: POST /agent
- Bala Telegram chat ID: 6316112708

## Infra notes — READ FIRST every session

**ALWAYS build before starting. Never serve stale `.next/` output.**

```bash
# Full restart (use this every time — takes ~15s):
fuser -k 3003/tcp 2>/dev/null; npm run build && npm start &

# Quick health check after restart:
curl -s http://localhost:3003/api/health

# Docker infra only (postgres + n8n):
docker compose up -d postgres n8n
```

- **Never `npm run dev` through a tunnel** — HMR WebSocket breaks chunk loading
- **404 on frontend resources = stale build.** Fix: kill + rebuild + restart.
- **Puppeteer flags** — `--no-sandbox --disable-setuid-sandbox --disable-dev-shm-usage` required.
- **Outline is on port 3001** — not 3000 (3000 is Gitea)

## Next session
v2.5 planning — client portal, mobile app (React Native/Expo), or agentic architecture improvements.
