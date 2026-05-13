# CBOP v2 — Claude Code Permanent Context

## Read this first, every session
1. Read `HANDOFF.md` in the repo root — this tells you exactly where the last session ended
2. Read the relevant slice from `docs/MASTER.md`
3. Build fully without asking for approval on individual steps
4. When the session ends, overwrite `HANDOFF.md` with the current state using the template at the bottom of this file

---

## What this project is
Internal business operations platform for 4 companies. Self-hosted on a single Ubuntu 24.04 homeserver. 3 users only (Bala/CEO, Nabeelah/COO, Guru/CTO). Full spec is in `docs/MASTER.md`.

---

## Non-negotiable constraints — never violate these

- **Postgres + better-auth only.** No Supabase. No Redis. No Bull.js. No Supabase RLS.
- **n8n for all 6 automations.** No custom queue or scheduler code in CBOP.
- **All messaging through OpenClaw only.** Never call Telegram Bot API or WhatsApp Business API directly from CBOP or n8n. Always use `POST http://127.0.0.1:18789/send`. This is the only way messages leave the system.
- **SOPs from Outline only.** Notion does not exist in this project. No Notion API calls anywhere.
- **No global search bar.** Table filters only — client-side, per-table text inputs that filter visible rows. No universal search, no command palette.
- **Trainer AI does not exist in v2.** No `trainer_*` files, tables, components, routes, or imports. Do not create them. Do not reference them.
- **Finance routes are CEO-only.** Every `/api/finance/*` route must have `requireRole('ceo')` middleware. `finance_personal_wealth` data is never passed into any agent prompt or context.
- **Every task requires a project.** `ops_tasks.project_id` is NOT NULL. No orphan tasks under any circumstances.
- **Slide-over panels only.** No modals. No separate `/create` pages. Every form opens in a slide-over panel from the right edge.
- **No hardcoded secrets.** All config from `process.env`. Never in DB. Never in frontend code.
- **Existing homeserver services.** This project runs on a homeserver that already has Outline, Nextcloud, Gitea, Uptime Kuma, Nginx Proxy Manager, and OpenClaw running. `docker-compose.yml` only contains postgres and n8n. Never add the existing services. All of them are reachable at localhost.

---

## Tech stack

| Layer | Technology |
|---|---|
| Frontend | Next.js 14 (App Router) + TypeScript + Tailwind CSS + TanStack Query |
| Backend | Hono.js + Node.js |
| Database | PostgreSQL — plain Docker container, no extensions required |
| Auth | better-auth + JWT + httpOnly cookies (7-day session) |
| Automations | n8n (self-hosted Docker) — 6 workflows only |
| Agents | OpenClaw at `http://127.0.0.1:18789` |
| Messaging | OpenClaw `/send` endpoint — Telegram (team) + WhatsApp Business API (clients) |
| PDF | Puppeteer — HTML template to PDF |
| Backup | AWS S3 + pg_dump cron at 2am daily |
| Infrastructure | Docker + Nginx Proxy Manager + Ubuntu 24.04 |
| Git | Gitea (self-hosted) + GitHub private mirror |
| File storage | Nextcloud (self-hosted) |
| SOPs | Outline (self-hosted) — replaces Notion entirely |
| Monitoring | Uptime Kuma (self-hosted) |

---

## System architecture

```
CBOP Backend (Hono.js)
  → POST http://127.0.0.1:18789/send         (all outbound messages)
  → POST http://127.0.0.1:18789/agent        (trigger AI agents)
  → POST /webhooks/* on n8n                  (trigger automations)

n8n automations
  → POST http://127.0.0.1:18789/send         (any messaging n8n needs)
  → Direct Postgres queries                  (reads + writes)

OpenClaw (http://127.0.0.1:18789)
  → Telegram Bot API                         (team internal)
  → WhatsApp Business API                    (clients only)
```

---

## Auth pattern — Hono.js middleware only

No Supabase. No PostgREST. No `auth.uid()`. Authorization is explicit middleware on every route.

```typescript
// require-auth.ts
export const requireAuth = async (c: Context, next: Next) => {
  const session = await auth.api.getSession({ headers: c.req.raw.headers })
  if (!session?.user) return c.json({ error: 'Unauthorized' }, 401)
  const user = await db.query(
    `SELECT u.id, u.role, array_agg(uc.company_id) as company_ids
     FROM users u JOIN user_companies uc ON uc.user_id = u.id
     WHERE u.id = $1 GROUP BY u.id`,
    [session.user.id]
  )
  c.set('userId', user.id)
  c.set('role', user.role)
  c.set('companyIds', user.company_ids)
  await next()
}

// require-role.ts
export const requireRole = (...roles: string[]) => async (c: Context, next: Next) => {
  if (!roles.includes(c.get('role'))) return c.json({ error: 'Forbidden' }, 403)
  await next()
}

// Every query must include:
WHERE company_id = ANY($1)  -- param: c.get('companyIds')
```

Route protection matrix:
- `/api/finance/*` → `requireAuth, requireRole('ceo')`
- `/api/sales/*` → `requireAuth, requireRole('ceo', 'coo')`
- `/api/work/*` → `requireAuth` (all roles, filtered by companyIds)
- `/api/settings/*` → `requireAuth, requireRole('ceo')` except Team tab: `requireRole('ceo', 'coo')`

---

## OpenClaw /send contract

```typescript
POST http://127.0.0.1:18789/send
Body: {
  channel: 'telegram' | 'whatsapp' | 'email',
  to: string,              // telegram_chat_id | phone number | email address
  message?: string,
  template?: string,       // template name in OpenClaw
  vars?: Record<string, string>,
  attachment?: Buffer      // for PDF sends
}
```

---

## n8n webhook endpoints (CBOP exposes these — n8n calls them)

```
POST /webhooks/lead-updated     Body: { lead_id: string }
POST /webhooks/client-created   Body: { client_id: string, service_type: string, deal_id: string }
POST /webhooks/user-created     Body: { user_id: string, role: string }
```

Protect with `N8N_WEBHOOK_SECRET` header check.

---

## Naming rules

### Files and directories — kebab-case always
```
app/(auth)/login/page.tsx
app/(dashboard)/sales/page.tsx
app/(dashboard)/sales/pipeline-tab.tsx
api/routes/deals.ts
api/middleware/require-auth.ts
api/lib/openclaw.ts
api/lib/pdf-generator.ts
```

### React components — PascalCase
```typescript
export function PipelineCard() {}
export function InvoiceSlideOver() {}
export function AlertBar() {}
export function DealStageColumn() {}
```
File is `pipeline-card.tsx`, export is `PipelineCard`. Always.

### Database tables — snake_case, domain-prefixed
```
users               companies           user_companies
sales_leads         sales_deals         sales_clients        sales_invoices
ops_projects        ops_tasks           ops_work_sessions    ops_task_templates
finance_monthly_pl  finance_expenses    finance_holdings     finance_personal_wealth
marketing_campaigns marketing_social_posts
templates           templates_versions
system_jobs         notifications_sent  audit_logs
```

### API routes — plural kebab-case nouns, RESTful
```
GET    /api/deals
POST   /api/deals
PATCH  /api/deals/:id
PATCH  /api/deals/:id/stage
GET    /api/invoices/:id/pdf
POST   /api/leads/:id/convert-to-deal
POST   /api/agents/trigger/:name
POST   /webhooks/lead-updated
```

### TypeScript functions — camelCase, verb-first
```typescript
// Handlers
getDeals()  createDeal()  updateDealStage()  getInvoicePdf()

// Services
buildInvoicePdf()  calculateLeadScore()  fetchSopFromOutline()
sendViaOpenClaw()  createTasksFromSop()  fireWebhookToN8n()

// DB
getInvoiceById()  getInvoicesByCompany()  updateInvoiceStatus()
```
Never name a function `fetch` — conflicts with browser API. Use `fetchSop`, `fetchFromOutline`, etc.

### Types and interfaces — PascalCase
```typescript
type Role = 'ceo' | 'coo' | 'cto'
type InvoiceStatus = 'draft' | 'sent' | 'paid' | 'overdue'
type DealStage = 'lead' | 'proposal' | 'negotiation' | 'closed_won' | 'closed_lost'
type ServiceType = 'cybersecurity_event' | 'penetration_test' | 'it_consulting' | 'game_development' | 'other'
interface User { id: string; role: Role; companyIds: string[] }
interface OpenClawPayload { channel: NotificationChannel; to: string; message?: string }
```

### Environment variables — SCREAMING_SNAKE_CASE
```
DATABASE_URL
BETTER_AUTH_SECRET
OPENCLAW_URL=http://127.0.0.1:18789
OUTLINE_URL
OUTLINE_API_TOKEN
WHATSAPP_PHONE_NUMBER_ID
WHATSAPP_ACCESS_TOKEN
N8N_WEBHOOK_SECRET
N8N_URL
AWS_ACCESS_KEY_ID
AWS_SECRET_ACCESS_KEY
S3_BUCKET_NAME
```

### Agent names (OpenClaw) — snake_case
```
deal_invoice_tasks   morning_briefing   prospect_research
social_media         cbop_control
```

### Automation names (n8n) — snake_case
```
follow_ups   financial_calc   reporting
client_onboarding   employee_onboarding   lead_scoring
```

---

## Invoice number format
```
{COMPANY_CODE}-{YEAR}-{SEQUENCE}
ETH-2026-0001  (Etherence IT)
PEN-2026-0001  (Etherence Pentest)
CYB-2026-0001  (CYBERCOM CTF)
ATK-2026-0001  (AttackOS)
```
Sequence is 4-digit zero-padded, per company, per year, resets each January.
Add `invoice_prefix` column to `companies` table.

---

## Design system (for frontend work)

```
Topbar:     #232F3E  height 48px
Sidebar:    #16191F  width 240px
Content bg: #F2F3F3
Cards:      #FFFFFF  border 1px #D5DBDB  radius 8px  shadow 0 1px 3px rgba(0,0,0,0.08)
Inputs:     border 1px #D5DBDB  radius 6px  height 36px
Buttons:    primary #0073BB  radius 6px

Fonts:
  Syne       → headings, page titles
  Inter      → all UI, body, labels, buttons, nav
  IBM Plex Mono → all numbers, amounts, IDs, dates, invoice figures

Status colors:
  --amber: #E8820C  (warning, pending, running)
  --green: #1D8102  (success, paid, done)
  --red:   #D13212  (error, overdue, failed)
  --blue:  #0073BB  (primary action, active state)
```

---

## HANDOFF.md template

At the end of every session, overwrite `HANDOFF.md` with this structure filled in:

```markdown
# CBOP HANDOFF

## Last updated
[date and time]

## Completed slices
[list each completed slice with ✅]

## Current slice
Slice [N] — [Name] — [complete ✅ / in progress 🔄 / blocked ❌]

## What works right now
[bullet list of working functionality]

## Files changed this session
[file path] — [what changed]

## Failed attempts — do not retry
[approach tried] → [why it failed]

## Known issues
[issue] — [severity: low/medium/high]

## Next session
Build: Slice [N+1] — [Name]
Spec: docs/MASTER.md → SLICE [N+1] section
First action: [specific first step]
```
