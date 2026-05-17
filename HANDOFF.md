# CBOP HANDOFF

## Last updated
2026-05-17 — Invoice PDF v3 template + migration 008

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

## Current slice
Slice 13 — Security Audit + Deploy — complete ✅

## What works right now
All v2 features are complete and security-hardened.

### Security hardening (Slice 13)
- Rate limiting on `/api/auth/*` — 10 requests/60s per IP, in-memory Map, auto-prune
- Security headers on all API responses via `hono/secure-headers`:
  - `Strict-Transport-Security: max-age=63072000; includeSubDomains; preload`
  - `X-Frame-Options: DENY`
  - `X-Content-Type-Options: nosniff`
  - `Referrer-Policy: strict-origin-when-cross-origin`
  - Full CSP: `default-src 'self'`, script/style/font/img whitelisted
- Security headers on all Next.js responses via `next.config.js` headers()
- IDOR fixed: `getOverdueInvoices` — validates query `company_id` against session companyIds
- IDOR fixed: `getTodaysTasks` — query `user_id` now restricted to CEO/COO only; CTO always sees own tasks
- IDOR fixed: `getPipelineSummary` — validates query `company_id` against session companyIds
- Defense-in-depth: invoice remind UPDATE now includes `AND company_id = ANY($2)` filter
- All finance routes: `requireRole('ceo')` — personal wealth never exposed outside CEO gate ✅
- All queries filter by `company_id = ANY(companyIds)` from session ✅
- No secrets in code or DB — all from `process.env` ✅

### Core platform
- Auth (better-auth v0.8.8), session, health check at `/api/health`
- Dashboard — stat cards, alert bar, today's priorities, tasks, activity feed, invoice alerts
- `GET /api/companies`, `GET /api/users` — dropdown data
- `GET/POST/PATCH /api/deals`, `PATCH /api/deals/:id/stage` — pipeline CRUD
- `GET/POST/PATCH /api/invoices` — invoice CRUD; auto invoice_no; GST calc
- `GET /api/invoices/:id/pdf` — enterprise themed PDF
- `POST /api/invoices/:id/remind` — WhatsApp via OpenClaw
- `GET/POST/PATCH /api/leads` — lead CRUD; n8n lead-updated webhook
- `POST /api/leads/:id/convert-to-deal` — upserts client, creates deal, fires webhooks
- `GET/POST /api/clients` — client CRUD
- `GET/POST/PATCH /api/projects` — project CRUD
- `GET/POST/PATCH /api/tasks` — task CRUD; project_id required
- `GET/POST/PATCH /api/sessions` — work session CRUD
- `GET/POST/PATCH /api/templates` + PDF export — with auto-versioning
- `GET /api/finance/*` — company health, P&L, holdings, expenses (requireRole ceo)
- `GET/POST /api/finance/personal-wealth` — CEO-only; NEVER in agent context
- `GET/POST /api/mentor/*` — mentor council chat, history, share links (requireRole ceo)
- `GET/POST/PATCH /api/settings/*` — users, companies, jobs, integrations
- `POST /webhooks/lead-updated|client-created|user-created` — n8n webhook receivers
- `POST /api/agents/trigger/:name` — async agent trigger with system_jobs tracking
- `/api/agents/cbop-control/tools/*` — 10 cbop_control tool endpoints

### Infrastructure
- PostgreSQL container: `cbop-postgres` — Running ✅
- n8n container: `cbop-n8n` — Running ✅
- CBOP app: running directly via `npm start -p 3003` (not Docker — homeserver native)
- Git tag: `v2.0.0` — tagged ✅
- `npm run build` — clean (warnings only, no errors) ✅

## DB bootstrap (run once on fresh postgres — in this exact order)
1. `docker exec -i cbop-postgres psql -U cbop_user -d cbop_v2 < migrations/001_initial_schema.sql`
2. `docker exec -i cbop-postgres psql -U cbop_user -d cbop_v2 < migrations/002_auth_tables.sql`
3. `docker exec -i cbop-postgres psql -U cbop_user -d cbop_v2 < migrations/003_add_updated_at.sql`
4. `docker exec -i cbop-postgres psql -U cbop_user -d cbop_v2 < migrations/004_updated_at_triggers.sql`
5. `docker exec -i cbop-postgres psql -U cbop_user -d cbop_v2 < migrations/005_invoice_details.sql`
6. `docker exec -i cbop-postgres psql -U cbop_user -d cbop_v2 < migrations/006_invoice_v2.sql`
7. `docker exec -i cbop-postgres psql -U cbop_user -d cbop_v2 < migrations/007_ceo_panel.sql`
8. `npm run dev` — start the app first (seed calls the auth HTTP API)
9. `npm run db:seed`

## Files changed this session
- `api/index.ts` — added `hono/secure-headers` middleware (HSTS, X-Frame-Options, X-Content-Type-Options, CSP), in-memory auth rate limiter (10 req/60s per IP on `/api/auth/*`); wired internalRoutes
- `api/routes/agents.ts` — fixed 3 IDOR vulnerabilities: getOverdueInvoices, getTodaysTasks, getPipelineSummary
- `api/routes/invoices.ts` — invoice remind UPDATE now includes company_id filter (defense-in-depth)
- `next.config.js` — added `headers()` for X-Frame-Options, X-Content-Type-Options, HSTS, Referrer-Policy, Permissions-Policy on all Next.js routes
- `api/lib/mailer.ts` — NEW: nodemailer SMTP module; single place all email leaves CBOP; config from SMTP_* env vars
- `api/lib/auth.ts` — added magicLink plugin (disableSignUp, 15min expiry); sendMagicLink uses mailer.ts (not OpenClaw)
- `api/lib/auth-client.ts` — added magicLinkClient() plugin
- `api/routes/internal.ts` — NEW: POST /api/internal/send-email for n8n; protected by N8N_WEBHOOK_SECRET (header: x-internal-secret); never expose externally
- `app/(auth)/login/page.tsx` — added "Forgot password?" link
- `app/(auth)/forgot-password/page.tsx` — NEW: email input → authClient.signIn.magicLink → confirmation state
- `CLAUDE.md` — updated constraints: Telegram/WhatsApp via OpenClaw only; email via mailer.ts only
- `n8n/workflows/client_onboarding.json` — co-node-08: replaced OpenClaw /send (channel: email) with POST /api/internal/send-email; inline subject/text/html; header x-internal-secret
- `n8n/workflows/employee_onboarding.json` — added eo-node-10 "Send Welcome Email" (POST /api/internal/send-email, x-internal-secret); chained before Telegram node; employee now receives welcome email + Telegram
- `api/routes/internal.ts` — fixed header check: x-webhook-secret → x-internal-secret (matches workflow spec)
- `api/lib/pdf-generator.ts` — Invoice PDF v3: replaced entire html template (clean Inter-only design, Balance Due in header, P.O. # row, compliance strip, discount column, seal in signature block); added po_number/discount_amount/balance_due to SELECT from sales_invoices; added company_address/company_seal to SELECT from companies; added discount + balanceDue computed values; added sealBase64 loading (same pattern as logo); initials sliced to 2 chars
- `migrations/008_invoice_pdf_v3.sql` — NEW: adds po_number, discount_amount, balance_due to sales_invoices; adds address, company_seal to companies; backfills balance_due

## Failed attempts — do not retry
- Mapping better-auth to our `users` table via `advanced.database` — v0.8 requires Kysely dialect.
- Snake_case columns in `002_auth_tables.sql` — better-auth v0.8 expects camelCase. Do not revert.
- `token` column in session table — NOT NULL kills sign-up silently. Removed.
- `accessTokenExpiresAt`/`refreshTokenExpiresAt` in account table — only `expiresAt` exists. Fixed.
- `new Hono()` without type params + `c.get('userId')` — TypeScript infers `never`. Fix: use hono-vars.ts.
- Using `new Date().toISOString().split('T')[0]` for SQL dates — always UTC, breaks IST before 5:30 AM. Use `CURRENT_DATE`.
- `ORDER BY priority DESC` on TEXT — alphabetical. Fix: CASE WHEN sort.
- `pg` returns `NUMERIC` as JS strings — must `parseFloat(String(amount))`.
- Passing `Buffer` to `new Response()` — cast `pdf as unknown as BodyInit`.
- Old `buildInvoicePdf(data: InvoiceRenderData)` — do not revert; new pattern is `buildInvoicePdf(invoiceId)`.
- TanStack Query `onSuccess` option in `useQuery` — does not exist in v5. Use `useEffect` watching the data ID.
- `const guard = [requireAuth, requireRole('ceo')]` + `...guard` spread in Hono routes — TypeScript infers incorrectly. Always inline middleware.
- `use(params)` in Next.js 14 page components — params is a plain object in Next.js 14. Always destructure directly.
- Keyed fragments in `<tbody>` — use `React.Fragment key={...}` not `<>` shorthand.
- Duplicate style object keys in React — last one wins silently.
- `mcpServers` in `~/.claude/settings.json` — schema validation rejects it. Use `claude mcp add` CLI instead.
- `permissionsPolicy` in `hono/secure-headers` — expects `boolean | string[]` not a string like `'()'`. Use `false` or remove it; set via next.config.js headers instead.
- Rate limiter function returning `c.json(...)` directly (non-async) — TypeScript rejects non-Promise middleware return. Must be `async` with `await next()`.
- Dockerfile + cbop-app Docker service — Dockerfile requires `output: 'standalone'` in next.config.js (not set). Also no Chromium for Puppeteer in node:18-alpine. CBOP app runs natively on homeserver, not in Docker. `docker compose up` should only target postgres and n8n.

## Known issues / deferred
- **`updated_at` is trigger-managed** — never set manually in PATCH queries.
- **n8n credential ID mismatch after import** — after importing workflows, open each in n8n UI and re-select the `CBOP Postgres` credential from the dropdown.
- **n8n workflows not yet activated** — all 7 workflows imported but need manual toggle to Active in n8n UI. Also set error_handler as global error workflow in Settings.
- **TELEGRAM_NABEELAH_CHAT_ID / TELEGRAM_GURU_CHAT_ID** — blank in .env; fill when available.
- **`employee_onboarding` templates** — requires `ops_task_templates` rows with `service_type = 'employee_onboarding'`.
- **Work page has no frontend role gate** — CTO only sees Etherence IT data via companyIds API filter.
- **Mentor Council AI** — calls OpenClaw `/agent` with name `mentor_council`; gracefully saves message and returns "[Mentor offline]" if unavailable.
- **Retry job is re-enqueue only** — creates new system_jobs row with status=pending.
- **OpenClaw cbop_control agent config** — tool URLs must be registered in OpenClaw's agent config for cbop_control. Format depends on OpenClaw agent definition file (not in this repo).
- **morning_briefing daily 8am** — spec says daily; currently only triggered by Monday reporting n8n workflow.
- **Auth rate limiter is in-memory** — resets on app restart. Acceptable for 3-user homeserver; upgrade to Redis-backed if attack surface grows.
- **Uptime Kuma monitors** — configure `/api/health` endpoint monitor and TCP port check for postgres. Manual step in Uptime Kuma UI.

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
- **Puppeteer flags** — `--no-sandbox --disable-setuid-sandbox --disable-dev-shm-usage` required on this homeserver.
- **Outline is on port 3001** — not 3000 (3000 is Gitea)
- **cbop-app Docker service in docker-compose.yml** — broken (no standalone output, no Chromium). Ignore it. CBOP runs natively.

## Next session
CBOP v2 is complete. All 13 slices delivered. Release tagged v2.0.0.

Post-release testing/fixes in progress.

Possible follow-up work:
- Test forgot password end-to-end: /forgot-password → email arrives → magic link → /dashboard
- Uptime Kuma: configure `/api/health` monitor (manual in Uptime Kuma UI)
- n8n: toggle all 7 workflows to Active, set error_handler as global error workflow; re-import client_onboarding + employee_onboarding JSONs (email nodes updated)
- OpenClaw: register cbop_control tool URLs in agent config
- Fill TELEGRAM_NABEELAH_CHAT_ID and TELEGRAM_GURU_CHAT_ID in .env when available
- Add morning_briefing daily n8n cron workflow (currently only fires via Monday reporting)
