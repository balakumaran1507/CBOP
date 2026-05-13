# CBOP v2 — MASTER DOCUMENT
**Version:** 5.0 (Final after critique + architecture review)
**Author:** Balakumaran D | **Status:** Ready for Vibe Coding
**Companies:** Etherence IT · Etherence Pentest · CYBERCOM CTF · AttackOS
**Last updated:** May 2026

> This document supersedes ALL previous versions including PRD v4 FINAL.
> Feature not in this document = does not exist in v2.
> Every architectural decision in this file was deliberately chosen — do not revert to Supabase, Bull.js, Redis, Twilio, or Notion without explicit sign-off from Bala.

---

## TABLE OF CONTENTS

1. Vision
2. What CBOP Replaces
3. Tech Stack (Final)
4. System Architecture
5. Design System
6. User Accounts & Access Control
7. Login Flow
8. Pages (7 total)
9. Client Lifecycle
10. Automations vs Agents
11. n8n Automation Workflows
12. CBOP Control Agent (Agent #6)
13. Agent + Automation Status Visibility
14. SOP-Based Task Creation
15. Invoice Quality Standard
16. Database Schema
17. Auth & Middleware (Hono.js, no Supabase)
18. Notification Architecture (OpenClaw)
19. Backup Strategy
20. Build Phases — Feature Slices
21. Handoff Session Template
22. Naming Rules & Function Registry

---

## 1. VISION

CBOP replaces the SaaS tools a real company pays for.
Invoices. Reports. Tasks. Leads. Onboarding. All in one place, on our own server.

Agents handle decisions. Automations handle execution. Humans close deals.

> **Rule:** If it doesn't require action, don't show it.

---

## 2. WHAT CBOP REPLACES

| SaaS Tool | What It Does | CBOP Module |
|---|---|---|
| Zoho Invoice / Freshbooks | Invoice generation + tracking | Sales → Invoices |
| HubSpot / Pipedrive | Lead + deal management | Sales → Leads + Pipeline |
| Jira / Asana | Task + project management | Work → Tasks + Projects |
| BambooHR / Keka | Employee onboarding | n8n → employee_onboarding |
| Databox / Metabase | Reports + dashboards | Reports + Morning Briefing |
| DocuSign / PandaDoc | Contract templates | Templates |
| Notion (retired) | SOPs | Outline (self-hosted, already running) |
| Twilio | WhatsApp messaging | WhatsApp Business API (free tier) via OpenClaw |
| Slack (partial) | Internal comms | Telegram via OpenClaw |

---

## 3. TECH STACK (FINAL)

| Layer | Technology | Reason |
|---|---|---|
| Frontend | Next.js 14 (App Router) + TypeScript + Tailwind CSS + TanStack Query | — |
| Backend | Hono.js + Node.js | Fast, lightweight, TypeScript-native |
| Database | PostgreSQL (standalone Docker container) | No Supabase — plain Postgres |
| Auth | better-auth + JWT + httpOnly cookies | Replaces Supabase Auth entirely |
| Automations | n8n (self-hosted Docker container) | Replaces Bull.js + Redis entirely |
| Agents | OpenClaw (self-hosted, same homeserver) | All 6 agents powered through OpenClaw |
| Messaging | OpenClaw internal API | All Telegram + WhatsApp calls go through OpenClaw only |
| Client notifications | WhatsApp Business API (free tier, via OpenClaw) | Invoice reminders to clients — free up to 1000 conversations/month |
| Internal notifications | Telegram Bot API (via OpenClaw) | Team alerts, morning briefing, agent failures |
| PDF Generation | Puppeteer (HTML template → PDF) | Zoho-quality invoices |
| Backup | AWS S3 free tier + daily pg_dump cron | 5GB free, ~₹5–10/month after 12 months |
| Infrastructure | Docker + Nginx Proxy Manager + Ubuntu 24.04 | Already running on homeserver |
| Git | Gitea (self-hosted) + GitHub private mirror | Already running |
| File Storage | Nextcloud (self-hosted) | Already running |
| SOPs | Outline (self-hosted) | Replaces Notion — already running |
| Monitoring | Uptime Kuma (self-hosted Docker) | Service health — Telegram alerts when anything dies |

**What was explicitly removed and must not return:**
- ❌ Supabase (all containers — GoTrue, PostgREST, Kong, Realtime, Storage, Studio, Meta)
- ❌ Bull.js (job queue)
- ❌ Redis (cache/queue)
- ❌ Twilio (WhatsApp)
- ❌ Notion API integration (read-only Notion calls)
- ❌ Trainer AI (all trainer_* tables and pages — deferred to v3)

---

## 4. SYSTEM ARCHITECTURE

```
┌──────────────────────────────────────────────────────────────┐
│                    HOME SERVER (Ubuntu 24.04)                 │
│                                                              │
│  ┌──────────────┐    HTTP calls     ┌───────────────────┐   │
│  │  CBOP        │ ──────────────── ▶│  OpenClaw         │   │
│  │  (Next.js +  │                   │  (Agent runner +  │   │
│  │   Hono.js)   │◀── agent results──│   Messaging hub)  │   │
│  └──────┬───────┘                   └────────┬──────────┘   │
│         │                                    │               │
│         │ SQL queries           Telegram Bot API             │
│         ▼                       WhatsApp Business API        │
│  ┌──────────────┐                            │               │
│  │  PostgreSQL  │                            ▼               │
│  │  (plain,     │               ┌────────────────────────┐  │
│  │   no RLS     │               │  Telegram (team)       │  │
│  │   magic)     │               │  WhatsApp (clients)    │  │
│  └──────────────┘               └────────────────────────┘  │
│                                                              │
│  ┌──────────────┐    webhooks    ┌───────────────────────┐  │
│  │  n8n         │◀──────────────│  CBOP Hono.js API     │  │
│  │  (automations│                │  (fires webhook on     │  │
│  │   6 workflows│─── OpenClaw ──▶│   DB events)          │  │
│  └──────────────┘    /send       └───────────────────────┘  │
│                                                              │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────────┐  │
│  │ Outline  │ │Nextcloud │ │  Gitea   │ │ Uptime Kuma  │  │
│  │ (SOPs)   │ │ (files)  │ │  (code)  │ │ (monitoring) │  │
│  └──────────┘ └──────────┘ └──────────┘ └──────────────┘  │
│                                                              │
│  ┌──────────────────────────────────────────────────────┐   │
│  │  Nginx Proxy Manager (routes all subdomains)         │   │
│  └──────────────────────────────────────────────────────┘   │
└──────────────────────────────────────────────────────────────┘

External:
  AWS S3 (backup only — pg_dump daily at 2am)
  GitHub (code mirror only)
```

**Key rules from this architecture:**
- CBOP never calls Telegram or WhatsApp APIs directly. Always via `POST http://openclaw:PORT/send`
- n8n never calls Telegram or WhatsApp directly. Always via OpenClaw `/send`
- Outline is the only SOP source. Notion is gone.
- All 6 AI agents run through OpenClaw. No direct Claude API calls from CBOP.

---

## 5. DESIGN SYSTEM — AWS STYLE

**Layout:**
```
┌─────────────────────────────────────────────┐
│  DARK TOPBAR  (#232F3E)                      │
├──────────────┬──────────────────────────────┤
│              │                              │
│ DARK SIDEBAR │   LIGHT CONTENT AREA         │
│ (#16191F)    │   (#F2F3F3) + white cards    │
│              │                              │
└──────────────┴──────────────────────────────┘
```

**Color tokens:**
```css
--topbar:  #232F3E;
--sidebar: #16191F;
--bg:      #F2F3F3;
--card:    #FFFFFF;
--border:  #D5DBDB;
--text1:   #16191F;
--text2:   #687078;
--text3:   #AAB5BB;
--amber:   #E8820C;
--green:   #1D8102;
--red:     #D13212;
--blue:    #0073BB;
```

**Typography:**
- Syne — headings only
- Inter — UI body, labels, buttons
- IBM Plex Mono — all numbers, amounts, invoice figures, IDs

**Component rules:**
- White cards, 1px `--border` border, subtle box-shadow
- Slide-over panels for ALL forms — no modals, no separate create pages
- Skeleton screens for loading — no spinners anywhere
- Mobile responsive (phone browser — no separate app in v2)

**Search rule (important — read carefully):**
There is NO global search bar anywhere in CBOP. No universal search, no command palette, no search icon in topbar or sidebar.
The ONLY filtering allowed is a per-table text input that filters visible rows client-side (e.g. Templates page has a filter above its table). This is a **table filter**, not a search bar. Search finds things across the app; filters narrow what's already on screen. CBOP has filters. CBOP has no search.

---

## 6. USER ACCOUNTS & ACCESS CONTROL

**3 users only in v2:**

| Role | User | Companies | Access |
|---|---|---|---|
| CEO (`ceo`) | Balakumaran | All 4 | Everything including CEO Panel |
| COO (`coo`) | Nabeelah | All 4 | All except CEO Panel |
| CTO (`cto`) | Guru | Etherence IT only | Work + limited Sales read |

**Team members (Jai, Hemantha) have no CBOP accounts in v2.** Nabeelah assigns their work via Slack/Telegram. Their tasks exist in CBOP — created by Nabeelah, tracked by Nabeelah, performance updated by Nabeelah. They are `owner_id` references in the DB but not users of the system.

**Company selector (topbar):**
- CEO + COO: dropdown to filter by company or view all
- CTO: no dropdown, fixed to Etherence IT

**Role gates enforced in Hono.js middleware — not in the database.**

```typescript
// Access matrix
const ACCESS = {
  ceo:  { pages: ['home','sales','work','templates','ceo_panel','settings'], companies: 'all' },
  coo:  { pages: ['home','sales','work','templates','settings'],             companies: 'all' },
  cto:  { pages: ['home','work'],                                            companies: ['etherence_it'] },
}
```

---

## 7. LOGIN FLOW

```
User visits /login
→ Email + password form
→ better-auth validates credentials
→ JWT issued: { user_id, role, company_ids[] }
→ httpOnly cookie set — 7 days, refresh on activity
→ Redirect to /dashboard (Home)
→ Hono.js middleware reads cookie on every request
→ All queries filter by user.company_ids[]
→ Role-restricted pages return 403 if role not in ACCESS matrix
→ Sidebar built based on role

Forgot password → magic link via email (better-auth built-in)
No sign-up page. Accounts created manually in Settings by CEO only.
```

---

## 8. PAGES

**7 total: Login · Home · Sales · Work · Templates · CEO Panel · Settings**
(Trainer AI is cut — v3)

---

### 8.1 Login
- Logo + tagline: "Your company. One OS."
- Email + password + Login button
- Forgot password link → magic link email

---

### 8.2 Home — Command Centre
**All users. Data filtered by role + company.**

**Alert bar** — invisible unless triggered:
- Invoice overdue 1+ days
- Task has no owner + due within 48h
- Deal unchanged for 7+ days
Multiple alerts → show worst one + "N more" link.

**4 stat cards (role-dependent):**
- Revenue this month (CEO + COO) / Active projects (CTO)
- Open deals (CEO + COO) / My tasks today (CTO)
- Tasks due today (all)
- Cash position (CEO only) / Team tasks pending (COO) / hidden (CTO)

**Today's priorities:** 3–5 items from morning briefing. One-click mark done.
**My tasks:** Due today or overdue. Quick-add inline.
**Agent + automation activity feed:** Last 5 completed jobs with status badges.
**Right column:** Morning briefing · Invoice alerts

---

### 8.3 Sales
**COO + CEO only.**
**Tabs:** Pipeline · Invoices · Leads · Clients

#### Pipeline
Kanban: Lead → Proposal → Negotiation → Closed/Won → Closed/Lost
Card: client · value · company · days in stage · owner
Moving to Closed/Won → triggers `deal_invoice_tasks` agent
Moving to Closed/Lost → modal requires lost reason before save
"+ New Deal" → slide-over: client / company / value / stage / service type / owner

**Service types** (determines which SOP is fetched from Outline):
- Cybersecurity Event
- Penetration Test
- IT Consulting
- Game Development
- Other

#### Invoices
Default: Overdue + due this week only. Toggle to all.
Row: client · ref · amount · due date · status · Download PDF · Send Reminder
Send Reminder → WhatsApp Business API (via OpenClaw) + logged in notifications_sent.
Status badges: Draft · Sent · Paid · Overdue

#### Leads
Table: name · org · source · score · status · last contact · owner
Score: 0–100 + Hot/Warm/Cold badge
Source: Inbound / Outbound / Referral / Event
"+ New Lead" → slide-over
Click row → slide-over: full detail + notes + Convert to Deal button

#### Clients
Table: name · org · email · deals count · total billed · last active
Auto-created when a deal is moved to Closed/Won.
Manual "+ Add Client" for legacy clients.
Leads = prospects. Clients = paying. Never mixed in UI.

---

### 8.4 Work
**All users. Filtered by role + company.**
**Tabs:** Tasks · Projects · Sessions

#### Tasks
Kanban: Todo → In Progress → Review → Done
Default view: my tasks. Toggle: all team tasks (CEO + COO only).
Card: title · owner · priority dot · due date · project · company tag
Every task must belong to a project (project_id required, not nullable).
"+ New Task" → slide-over: title / project (required) / owner / priority / due date

#### Projects
List: name · company · owner · status · deadline · % complete
Click row → project detail page (all tasks for that project)
"+ New Project" → slide-over: name / company / owner / deadline

#### Sessions
Goal is required before session can be created.
Completed session requires "what was done" (one line).
"+ New Session" → slide-over: goal / project / attendees / time

---

### 8.5 Templates
**COO + CEO only.**

Table with client-side text filter (NOT a global search bar).
Columns: name · type · last updated
Types: Invoice · Proposal · Contract · NDA · MOU · Email · Onboarding
Click → preview with live `{{variables}}` rendered
Export → PDF via Puppeteer
Edit → auto-versioned. Last 5 versions kept in templates_versions.

**Variables supported:** `{{client_name}}` `{{amount}}` `{{date}}` `{{company_name}}` `{{service_description}}` `{{due_date}}` `{{gstin}}` `{{gst_type}}` `{{cgst}}` `{{sgst}}` `{{igst}}` `{{amount_in_words}}` `{{upi_id}}`

**Templates in v2:**
Service Proposal · Invoice · Client Onboarding Email · Employee Onboarding Email · NDA · MOU · Follow-up Sequence (3 emails) · Project Kickoff Brief

---

### 8.6 CEO Panel
**CEO only. Route protected at middleware level. Completely absent from COO + CTO UI.**
**Tabs:** Company Health · Holdings · Personal Wealth · Mentor Council

**Company Health:** 4 cards per company — Revenue / Expenses / Net. Cash position (manual entry). Warning banner if runway < 60 days.

**Holdings:** Table — Company / Equity % / Valuation / Your Stake. Manual update.

**Personal Wealth:** Monthly snapshot — Net worth / Cash / Equity stakes / Other assets. Trend chart. Manual entry only.

> ⚠️ Personal wealth data is CEO-only RLS, separate backup lifecycle, and excluded from all agent context. Stored in finance_personal_wealth table — never passed to any agent prompt.

**Mentor Council:** Chat interface — select persona (CA / MBA / Marketing Advisor / Tech Consultant). History saved per mentor per session. Share via expiring read-only link (72-hour token, generated on demand).

---

### 8.7 Settings
**CEO: full access. COO: Team tab only. CTO: no access.**
**Tabs:** Team · Companies · System Jobs · Integrations

**Team:** Create/edit/deactivate users. Telegram chat_id shown. CEO creates accounts manually — no self-signup.

**Companies:** Manage the 4 companies. Name, type, owner.

**System Jobs:** Table of all automation + agent job history. Name · type · status · last run · next run · last result. Click failed job → error message + payload + retry button.

**Integrations:** Outline API key, WhatsApp Business API token, OpenClaw endpoint URL, AWS S3 config. All read from env — shown as masked values, no edit in UI (edit in .env + restart).

---

## 9. CLIENT LIFECYCLE

### Inbound
```
Client contacts you
→ COO adds to Leads (source = Inbound)
→ lead_scoring automation runs (n8n) → score updated
→ COO creates Deal from lead → "Convert to Deal" button
→ Deal moves to Closed/Won
→ deal_invoice_tasks agent fires (OpenClaw)
→ Client record + Invoice + Project + Tasks created automatically
```

### Outbound
Same flow from Leads onwards.

### Legacy / Direct
"+ Add Client" on Clients page. Manual. No deal required.

**Leads = prospects. Clients = paying. Never mixed in queries or UI.**

---

## 10. AUTOMATIONS VS AGENTS

**Critical distinction — do not blur this:**
- **Automation** = deterministic code. Cron + SQL + templates. No AI. Fast, reliable, zero cost. Runs in **n8n**.
- **Agent** = AI-powered via **OpenClaw**. Used only where human-like judgment, synthesis, or language generation is needed.

### Automations (n8n — 6 workflows)

| Name | Trigger | What it does |
|---|---|---|
| `follow_ups` | Cron: 9am daily | Checks invoices overdue > 7d + leads not contacted > 3d → sends template WhatsApp/Telegram via OpenClaw |
| `financial_calc` | Cron: Sunday midnight | SQL on paid invoices + expenses → updates finance_monthly_pl |
| `reporting` | Cron: Monday 9am | Query DB → PDF report → sends to CEO + COO via OpenClaw/Telegram |
| `client_onboarding` | Webhook: new client row | Reads SOP task template from ops_task_templates → creates tasks → sends welcome email via OpenClaw |
| `employee_onboarding` | Webhook: new user row | Same as above, employee SOP template |
| `lead_scoring` | Webhook: lead updated | Rule-based: last_contact days + source weight + deal size estimate → update score |

**All 6 automations call OpenClaw's `/send` endpoint for any messaging. They never call Telegram or WhatsApp APIs directly.**

### Agents (OpenClaw — 6 agents)

| Name | Trigger | What it does |
|---|---|---|
| `deal_invoice_tasks` | DB event: deal → Closed/Won | Reads deal + SOP from Outline → creates invoice + project + contextual task list |
| `morning_briefing` | Cron: 8am daily | Reads all operational tables → writes coherent briefing → sends via OpenClaw to all 3 users |
| `prospect_research` | Manual button (COO) | Web search → synthesises company profile → updates lead record |
| `social_media` | Manual approve (COO) | Reviews + schedules post content for LinkedIn/Instagram |
| `cbop_control` | Inbound message via OpenClaw | Parses natural language command → calls CBOP API → responds on same channel |
| `trainer_ai` | **DEFERRED TO v3** | — |

**5 active agents in v2. Keep it this way unless there is a clear reason to add AI.**

---

## 11. n8n AUTOMATION WORKFLOWS

Each workflow in n8n is described here so it can be built and version-controlled as exported JSON in Gitea.

### `follow_ups`
```
Trigger: Cron (9:00 AM daily)
Step 1: Postgres query → SELECT invoices WHERE status='overdue' AND due_date < NOW() - INTERVAL '7 days'
Step 2: For each invoice → POST OpenClaw /send { channel: 'whatsapp', to: client_phone, template: 'invoice_reminder', vars: {...} }
Step 3: Postgres query → SELECT leads WHERE last_contact_at < NOW() - INTERVAL '3 days' AND status != 'closed'
Step 4: For each lead → POST OpenClaw /send { channel: 'telegram', to: owner_telegram_id, message: 'Follow up with {lead_name} — {days} days since last contact' }
Step 5: Log all sends to notifications_sent
```

### `financial_calc`
```
Trigger: Cron (Sunday 23:59)
Step 1: Postgres query → aggregate paid invoices by company for current month
Step 2: Postgres query → aggregate expenses by company for current month
Step 3: Calculate profit = revenue - expenses per company
Step 4: Upsert finance_monthly_pl (month, company_id, revenue, expenses, profit)
```

### `reporting`
```
Trigger: Cron (Monday 9:00 AM)
Step 1: Postgres queries → weekly summary per company (deals closed, invoices sent, tasks completed, revenue)
Step 2: POST OpenClaw /agent { agent: 'morning_briefing', context: weeklyData } (optional — or template-based)
Step 3: Puppeteer → render HTML report → PDF
Step 4: POST OpenClaw /send { channel: 'telegram', to: ['bala', 'nabeelah'], attachment: pdfBuffer }
```

### `client_onboarding`
```
Trigger: Webhook POST from CBOP Hono.js (fired when new row inserted into sales_clients)
Payload: { client_id, service_type, deal_id }
Step 1: Postgres query → fetch ops_task_templates WHERE service_type = payload.service_type
Step 2: Create ops_tasks rows for each template task (owner = default_owner_role mapped to user_id)
Step 3: POST OpenClaw /send { channel: 'email', to: client_email, template: 'client_onboarding_email', vars: {...} }
```

### `employee_onboarding`
```
Trigger: Webhook POST from CBOP Hono.js (fired when new user row inserted — non-CEO)
Payload: { user_id, role }
Step 1: Fetch employee onboarding task template from ops_task_templates
Step 2: Create ops_tasks for onboarding checklist
Step 3: POST OpenClaw /send { channel: 'telegram', to: new_user_telegram_id, message: 'Welcome message + setup instructions' }
```

### `lead_scoring`
```
Trigger: Webhook POST from CBOP Hono.js (fired on lead update)
Payload: { lead_id }
Step 1: Postgres query → fetch full lead record
Step 2: Scoring logic (deterministic):
  - last_contact_at < 3 days: +20
  - source = 'Referral': +15
  - source = 'Inbound': +10
  - has email: +5
  - has phone: +5
  - status = 'contacted': +10
  - status = 'proposal_sent': +20
  Total 0–100. Hot: 70+. Warm: 40–69. Cold: <40.
Step 3: UPDATE sales_leads SET score = calculated, badge = 'hot'|'warm'|'cold'
```

---

## 12. CBOP CONTROL AGENT (Agent #6)

The `cbop_control` agent gives you a natural language interface to CBOP from Telegram, WhatsApp, or any channel OpenClaw manages. You send a message; it interprets it, calls CBOP's API, and replies.

**How it works:**
```
You send on Telegram: "what invoices are overdue?"
  ↓
OpenClaw receives → routes to cbop_control agent
  ↓
Agent calls GET /api/invoices?status=overdue&user_id=bala
  ↓
Agent formats: "3 overdue invoices:
  • Cyberdyne — ₹45,000 — 8 days late
  • Initech — ₹12,000 — 3 days late
  Reply 'remind all' to send reminders."
  ↓
OpenClaw sends reply on Telegram
```

**Access control:** OpenClaw maps inbound message sender (Telegram chat_id / WhatsApp number) to a user row in CBOP's `users` table. The agent receives a `user` object with role + company_ids. Same gates as the web UI apply — Guru cannot ask for financial data.

**API tools the agent can call:**
```
getOverdueInvoices(company_id?)
getTodaysTasks(user_id)
getPipelineSummary(company_id?)
getDealStatus(deal_id)
createTask(title, project_id, owner_id, due_date)
markTaskDone(task_id)
createLead(name, org, source, owner_id)
getMorningBriefing(user_id)
sendInvoiceReminder(invoice_id)
getProjectStatus(project_id)
```

**Commands it understands (examples):**
- "what's overdue?" → invoices + tasks overdue
- "mark task 42 done" → markTaskDone(42)
- "create a task: review pentest report by friday" → createTask(...)
- "how's the pipeline?" → getPipelineSummary()
- "remind cyberdyne about their invoice" → sendInvoiceReminder(...)
- "what did the morning briefing say?" → getMorningBriefing(user_id)

---

## 13. AGENT + AUTOMATION STATUS VISIBILITY

Every job — n8n automation or OpenClaw agent — writes to `system_jobs` on completion.

```sql
system_jobs (
  id            UUID PRIMARY KEY,
  name          TEXT,           -- 'follow_ups', 'deal_invoice_tasks', etc.
  type          TEXT,           -- 'automation' | 'agent'
  status        TEXT,           -- 'pending' | 'running' | 'done' | 'failed'
  started_at    TIMESTAMPTZ,
  completed_at  TIMESTAMPTZ,
  payload       JSONB,
  result        JSONB,
  error_message TEXT,
  retry_count   INT DEFAULT 0
)
```

**Settings → System Jobs page (CEO + COO):**
- Table: name · type · status badge · last run · next run
- Status badges: Running (amber pulse) · Done (green) · Failed (red)
- Click failed job → see error_message + payload + Retry button

**Failure handling:**
- n8n automations: n8n retries automatically (3 attempts, 30s gaps). After 3 failures → writes status=failed to system_jobs → POST OpenClaw /send to Bala's Telegram immediately.
- OpenClaw agents: retry logic configured in OpenClaw. After failure → same pattern.
- Manual retry from Settings page → re-enqueues the job with original payload.

**Telegram alert format:**
```
[CBOP ALERT] deal_invoice_tasks FAILED
Deal: #047 — Cyberdyne Pentest
Error: Outline API timeout
Retry in system: Settings → System Jobs
```

---

## 14. SOP-BASED TASK CREATION

When `deal_invoice_tasks` agent fires, it fetches the SOP from **Outline** (not Notion — Notion is retired).

**SOP document lookup:**
```
deal.service_type → ops_task_templates.sop_doc_id (Outline document ID)
→ GET {OUTLINE_URL}/api/documents.info { id: sop_doc_id }
→ parse SOP content → extract task list
→ create ops_tasks rows
```

**Outline document IDs are stored in `ops_task_templates.sop_doc_id`** — set manually once during setup via the Settings → System page (or seeded in initial migration).

**Fallback (if Outline unreachable):**
Falls back to hardcoded task titles in `ops_task_templates.task_title` column (seeded on setup):
```
Cybersecurity Event → briefing call, prep materials, delivery, post-event report, invoice follow-up
Penetration Test    → scope call, access setup, testing, report, client debrief
IT Consulting       → requirements, proposal, delivery, review, invoice
Game Development    → GDD review, milestone setup, build tasks, QA, delivery
Other               → kickoff call, delivery, review, invoice
```

**Full flow when deal closes:**
```
deal → Closed/Won
  ↓
CBOP API fires POST to OpenClaw /agent { name: 'deal_invoice_tasks', payload: deal }
  ↓
Agent: fetch SOP from Outline → create invoice → create project → create tasks
  ↓
Agent: write result to system_jobs
  ↓
OpenClaw /send → Telegram to Nabeelah: "Deal closed — invoice + tasks created for [client]"
```

---

## 15. INVOICE QUALITY STANDARD

Invoices must match Zoho Invoice quality. Puppeteer renders an HTML template to PDF.

**Invoice layout:**
```
┌─────────────────────────────────────────────────────┐
│ [LOGO]                          INVOICE             │
│ Company name                    No: ETH-2026-0047   │
│ Address                         Date: 12 May 2026   │
│ GSTIN: 33XXXXX                  Due: 26 May 2026    │
├─────────────────────────────────────────────────────┤
│ BILL TO                                             │
│ {{client_name}}                                     │
│ {{client_org}}, {{client_address}}                  │
├──────────────────────┬──────┬──────────┬────────────┤
│ Description          │  Qty │  Rate    │  Amount    │
├──────────────────────┼──────┼──────────┼────────────┤
│ {{service_desc}}     │   1  │ ₹X       │  ₹X        │
│   — {{scope_note}}   │      │          │            │
├──────────────────────┴──────┴──────────┼────────────┤
│                             Subtotal   │  ₹X        │
│                    {{gst_type}} 18%    │  ₹X        │
│                             TOTAL      │  ₹X        │
├────────────────────────────────────────┴────────────┤
│ Amount in words: Rupees [X] only                    │
├─────────────────────────────────────────────────────┤
│ Payment Details                    [UPI QR CODE]    │
│ Bank: HDFC | A/C: XXXX | IFSC: XXXX                │
│ UPI: {{upi_id}}                                     │
│ Payment within 14 days of invoice date              │
├─────────────────────────────────────────────────────┤
│ Notes: {{notes}}                                    │
│ Thank you for your business.                        │
└─────────────────────────────────────────────────────┘
```

**Non-negotiables:**
- IBM Plex Mono for all amounts and numbers
- Amber accent bar (`#E8820C`) at top of invoice
- GSTIN on invoice (mandatory for Indian B2B)
- GST breakdown: CGST + SGST for intra-state, IGST for inter-state (determined by `gst_type` variable)
- "Amount in words" line (standard in India — clients expect it)
- Diagonal "PAID" watermark in light green when `status = 'paid'`
- UPI QR code generated at render time (use `qrcode` npm package)
- PDF metadata: title, author, creation date

**Variables required in invoice template:**
`{{invoice_no}}` `{{date}}` `{{due_date}}` `{{client_name}}` `{{client_org}}` `{{client_address}}` `{{company_name}}` `{{company_gstin}}` `{{service_description}}` `{{scope_note}}` `{{amount}}` `{{gst_type}}` `{{cgst}}` `{{sgst}}` `{{igst}}` `{{total}}` `{{amount_in_words}}` `{{upi_id}}` `{{bank_details}}` `{{notes}}`

---

## 16. DATABASE SCHEMA

### Core
```sql
users (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email           TEXT UNIQUE NOT NULL,
  name            TEXT NOT NULL,
  role            TEXT NOT NULL CHECK (role IN ('ceo','coo','cto')),
  telegram_chat_id TEXT,
  whatsapp_number TEXT,
  is_active       BOOLEAN DEFAULT true,
  created_at      TIMESTAMPTZ DEFAULT NOW()
)

companies (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name        TEXT NOT NULL,
  type        TEXT,         -- 'security', 'it', 'ctf', 'gamedev'
  gstin       TEXT,
  upi_id      TEXT,
  bank_details JSONB,
  owner_id    UUID REFERENCES users(id),
  created_at  TIMESTAMPTZ DEFAULT NOW()
)

user_companies (
  user_id    UUID REFERENCES users(id),
  company_id UUID REFERENCES companies(id),
  PRIMARY KEY (user_id, company_id)
)
```

### Sales
```sql
sales_leads (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id      UUID REFERENCES companies(id),
  name            TEXT NOT NULL,
  email           TEXT,
  phone           TEXT,
  org_name        TEXT,
  source          TEXT CHECK (source IN ('inbound','outbound','referral','event')),
  score           INT DEFAULT 0,
  badge           TEXT CHECK (badge IN ('hot','warm','cold')),
  status          TEXT DEFAULT 'new',
  owner_id        UUID REFERENCES users(id),
  last_contact_at TIMESTAMPTZ,
  notes           TEXT,
  created_at      TIMESTAMPTZ DEFAULT NOW()
)

sales_deals (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id   UUID REFERENCES companies(id),
  lead_id      UUID REFERENCES sales_leads(id),
  client_id    UUID REFERENCES sales_clients(id),
  name         TEXT NOT NULL,
  value        NUMERIC(12,2),
  stage        TEXT CHECK (stage IN ('lead','proposal','negotiation','closed_won','closed_lost')),
  service_type TEXT CHECK (service_type IN ('cybersecurity_event','penetration_test','it_consulting','game_development','other')),
  owner_id     UUID REFERENCES users(id),
  lost_reason  TEXT,
  closed_at    TIMESTAMPTZ,
  created_at   TIMESTAMPTZ DEFAULT NOW()
)

sales_clients (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id  UUID REFERENCES companies(id),
  name        TEXT NOT NULL,
  email       TEXT,
  phone       TEXT,
  org_name    TEXT,
  added_by    UUID REFERENCES users(id),
  created_at  TIMESTAMPTZ DEFAULT NOW()
)

sales_invoices (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id  UUID REFERENCES companies(id),
  deal_id     UUID REFERENCES sales_deals(id),
  client_id   UUID REFERENCES sales_clients(id),
  invoice_no  TEXT UNIQUE NOT NULL,       -- format: ETH-2026-0047
  amount      NUMERIC(12,2),
  gst_type    TEXT CHECK (gst_type IN ('cgst_sgst','igst')),
  gst_amount  NUMERIC(12,2),
  total       NUMERIC(12,2),
  due_date    DATE,
  paid_at     TIMESTAMPTZ,
  pdf_url     TEXT,
  status      TEXT CHECK (status IN ('draft','sent','paid','overdue')),
  created_at  TIMESTAMPTZ DEFAULT NOW()
)
```

### Operations
```sql
ops_projects (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id  UUID REFERENCES companies(id),
  name        TEXT NOT NULL,
  owner_id    UUID REFERENCES users(id),
  status      TEXT CHECK (status IN ('active','on_hold','completed','cancelled')),
  deadline    DATE,
  description TEXT,
  created_at  TIMESTAMPTZ DEFAULT NOW()
)

ops_tasks (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id     UUID REFERENCES companies(id),
  project_id     UUID REFERENCES ops_projects(id) NOT NULL,  -- required, not nullable
  title          TEXT NOT NULL,
  owner_id       UUID REFERENCES users(id),
  priority       TEXT CHECK (priority IN ('low','medium','high','critical')),
  status         TEXT CHECK (status IN ('todo','in_progress','review','done')),
  due_date       DATE,
  linked_deal_id UUID REFERENCES sales_deals(id),
  notes          TEXT,
  created_at     TIMESTAMPTZ DEFAULT NOW()
)

ops_work_sessions (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id   UUID REFERENCES companies(id),
  project_id   UUID REFERENCES ops_projects(id),
  goal         TEXT NOT NULL,   -- required before session can be created
  output       TEXT,            -- required on completion
  attendees    JSONB,           -- [{ user_id, name }]
  scheduled_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ
)

ops_task_templates (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  service_type       TEXT NOT NULL,
  task_title         TEXT NOT NULL,
  default_owner_role TEXT,       -- 'ceo' | 'coo' | 'cto'
  days_offset        INT,        -- days from deal close for due date
  sop_doc_id         TEXT        -- Outline document ID for this service type's SOP
)
```

### Marketing
```sql
marketing_campaigns (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id  UUID REFERENCES companies(id),
  name        TEXT NOT NULL,
  type        TEXT,
  status      TEXT,
  created_by  UUID REFERENCES users(id),
  created_at  TIMESTAMPTZ DEFAULT NOW()
)

marketing_social_posts (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id  UUID REFERENCES marketing_campaigns(id),
  company_id   UUID REFERENCES companies(id),
  content      TEXT,
  platform     TEXT CHECK (platform IN ('linkedin','instagram','twitter')),
  scheduled_at TIMESTAMPTZ,
  posted_at    TIMESTAMPTZ,
  status       TEXT CHECK (status IN ('draft','scheduled','posted','failed'))
)
```

### Finance (CEO only — enforced in middleware)
```sql
finance_monthly_pl (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id  UUID REFERENCES companies(id),
  month       DATE NOT NULL,          -- first day of month
  revenue     NUMERIC(14,2),
  expenses    NUMERIC(14,2),
  profit      NUMERIC(14,2),
  updated_at  TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(company_id, month)
)

finance_expenses (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id  UUID REFERENCES companies(id),
  category    TEXT,
  amount      NUMERIC(12,2),
  description TEXT,
  date        DATE
)

finance_holdings (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_name TEXT,
  equity_pct   NUMERIC(5,2),
  valuation    NUMERIC(14,2),
  updated_at   TIMESTAMPTZ DEFAULT NOW()
)

finance_personal_wealth (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  snapshot_date DATE NOT NULL,
  net_worth     NUMERIC(14,2),
  cash          NUMERIC(14,2),
  equity_stakes NUMERIC(14,2),
  other_assets  NUMERIC(14,2)
  -- NEVER included in agent context. CEO-only middleware gate.
)
```

### Templates
```sql
templates (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id  UUID REFERENCES companies(id),
  name        TEXT NOT NULL,
  type        TEXT CHECK (type IN ('invoice','proposal','contract','nda','mou','email','onboarding')),
  content     TEXT,
  variables   JSONB,             -- list of {{variable}} names in use
  version     INT DEFAULT 1,
  updated_at  TIMESTAMPTZ DEFAULT NOW()
)

templates_versions (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  template_id UUID REFERENCES templates(id),
  content     TEXT,
  version     INT,
  saved_at    TIMESTAMPTZ DEFAULT NOW()
)
```

### System
```sql
system_jobs (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name          TEXT NOT NULL,
  type          TEXT CHECK (type IN ('automation','agent')),
  status        TEXT CHECK (status IN ('pending','running','done','failed')),
  started_at    TIMESTAMPTZ,
  completed_at  TIMESTAMPTZ,
  payload       JSONB,
  result        JSONB,
  error_message TEXT,
  retry_count   INT DEFAULT 0
)

notifications_sent (
  id        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id   UUID REFERENCES users(id),
  channel   TEXT CHECK (channel IN ('telegram','whatsapp','email')),
  message   TEXT,
  sent_at   TIMESTAMPTZ DEFAULT NOW()
)

audit_logs (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID REFERENCES users(id),
  company_id UUID REFERENCES companies(id),
  table_name TEXT,
  action     TEXT CHECK (action IN ('insert','update','delete')),
  old_val    JSONB,
  new_val    JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW()
)
```

---

## 17. AUTH & MIDDLEWARE

**No Supabase. No PostgREST. No `auth.uid()` / `auth.jwt()` magic.**
All authorization is explicit, readable Hono.js middleware.

### better-auth setup
```typescript
// lib/auth.ts
import { betterAuth } from 'better-auth'
import { Pool } from 'pg'

export const auth = betterAuth({
  database: new Pool({ connectionString: process.env.DATABASE_URL }),
  emailAndPassword: { enabled: true },
  session: {
    cookieName: 'cbop_session',
    expiresIn: 7 * 24 * 60 * 60, // 7 days
  },
  // Magic link for forgot password
  emailVerification: { sendVerificationEmail: async (user, url) => { /* send via OpenClaw */ } }
})
```

### Auth middleware (applied to all protected routes)
```typescript
// middleware/requireAuth.ts
export const requireAuth = async (c: Context, next: Next) => {
  const session = await auth.api.getSession({ headers: c.req.raw.headers })
  if (!session?.user) return c.json({ error: 'Unauthorized' }, 401)

  // Fetch role + company_ids from DB (cached in session)
  const user = await db.query(
    `SELECT u.id, u.role, array_agg(uc.company_id) as company_ids
     FROM users u
     JOIN user_companies uc ON uc.user_id = u.id
     WHERE u.id = $1
     GROUP BY u.id`,
    [session.user.id]
  )

  c.set('userId', user.id)
  c.set('role', user.role)
  c.set('companyIds', user.company_ids)
  await next()
}
```

### Role gate middleware
```typescript
// middleware/requireRole.ts
export const requireRole = (...roles: string[]) => async (c: Context, next: Next) => {
  const role = c.get('role')
  if (!roles.includes(role)) return c.json({ error: 'Forbidden' }, 403)
  await next()
}

// Usage:
app.get('/api/finance/*', requireAuth, requireRole('ceo'), handler)
app.get('/api/sales/*',   requireAuth, requireRole('ceo','coo'), handler)
app.get('/api/work/*',    requireAuth, handler)  // all roles
```

### Company filter (on every query)
```typescript
// Every DB query uses this pattern:
const companyIds = c.get('companyIds') // string[]

const deals = await db.query(
  `SELECT * FROM sales_deals WHERE company_id = ANY($1)`,
  [companyIds]
)
```

---

## 18. NOTIFICATION ARCHITECTURE

**All messaging goes through OpenClaw. No direct API calls to Telegram or WhatsApp from CBOP or n8n.**

### OpenClaw /send endpoint contract
```typescript
// CBOP and n8n call this endpoint:
POST http://openclaw:PORT/send
{
  channel: 'telegram' | 'whatsapp' | 'email',
  to: string,           // telegram_chat_id, phone number, or email
  message?: string,
  template?: string,    // template name in OpenClaw
  vars?: Record<string, string>,
  attachment?: Buffer   // for PDFs
}
```

### What channel goes to whom:

| Recipient | Channel | When |
|---|---|---|
| Bala (Telegram) | Telegram | Morning briefing, agent failures, system alerts, CBOP Control responses |
| Nabeelah (Telegram) | Telegram | Morning briefing, task assignments, deal closures |
| Guru (Telegram) | Telegram | Morning briefing, task assignments |
| Clients | WhatsApp Business API | Invoice reminders, welcome email |
| All team | Telegram | Weekly PDF report on Monday |

### Notification triggers:

| Event | Channel | Recipient |
|---|---|---|
| Deal closed → invoice + tasks created | Telegram | Nabeelah |
| Invoice overdue (daily 9am) | WhatsApp | Client |
| Invoice overdue > 7 days (daily 9am) | Telegram | Nabeelah |
| Morning briefing ready (8am) | Telegram | All 3 users |
| Agent/automation failure (immediate) | Telegram | Bala only |
| New task assigned | Telegram | Task owner |
| Follow-up sent on your behalf | Telegram | Lead owner |
| New inbound lead (if n8n lead_scoring fires) | Telegram | Nabeelah |

---

## 19. BACKUP STRATEGY

```bash
# Daily cron at 2am (runs on homeserver)
0 2 * * * pg_dump $DATABASE_URL | gzip > /tmp/cbop_$(date +%Y%m%d).sql.gz \
  && aws s3 cp /tmp/cbop_$(date +%Y%m%d).sql.gz s3://cbop-backups/ \
  && rm /tmp/cbop_$(date +%Y%m%d).sql.gz

# S3 lifecycle policy: delete objects older than 30 days
```

AWS S3 free tier: 5GB free for 12 months. CBOP DB will be well under 1GB for years.
After 12 months: ~₹5–10/month. Not worth thinking about.

**Gitea → GitHub mirror:** Set in Gitea admin. Code always offsite.

**Disaster recovery:** Restore DB from S3 latest backup → redeploy Docker containers → back online in under 4 hours.

**Uptime Kuma monitors (Telegram alerts on failure):**
- CBOP app (`/api/health` endpoint)
- PostgreSQL (TCP port check)
- n8n UI (HTTP)
- OpenClaw (HTTP health check)
- Gitea (HTTP)
- Nextcloud (HTTP)

---

## 20. BUILD PHASES — FEATURE SLICES

Do NOT build all frontend first (waterfall). Build in feature slices: each slice delivers a working vertical (schema + API + UI) that can be tested before moving on.

Claude Code receives a scoped context file per slice. Nothing from a later slice is written in an earlier one.

---

### SLICE 0 — Infrastructure Setup
**Goal:** Homeserver ready, all services running, CBOP repo initialized.

```
[ ] Docker Compose file — all services defined:
    postgres, nginx-proxy-manager, openclaw, n8n,
    outline, nextcloud, gitea, uptime-kuma
[ ] Nginx routes configured for each service subdomain
[ ] Gitea repo: cbop-v2 created
[ ] GitHub mirror connected
[ ] .env.example committed (no secrets)
[ ] CBOP Next.js project initialized (npx create-next-app)
[ ] Hono.js API initialized (/api directory)
[ ] PostgreSQL: cbop_v2 database created
[ ] better-auth installed + configured
[ ] Initial DB migration file created (empty schema)
[ ] Uptime Kuma: all 6 monitors configured
[ ] AWS S3: bucket created, lifecycle policy set, cron scheduled
```

---

### SLICE 1 — Auth + Shell
**Goal:** Login works. Session works. Sidebar renders based on role. 3 test accounts created.

```
Schema:   users, companies, user_companies
API:      POST /auth/login, POST /auth/logout, GET /auth/session
Frontend: /login page, sidebar, topbar, company selector
Test:     Login as Bala → see all companies. Login as Guru → see only Etherence IT. 401 on bad creds.
```

---

### SLICE 2 — Home Dashboard
**Goal:** Home page loads with real data. Alert bar logic works.

```
Schema:   (reads from all tables — no new tables)
API:      GET /api/dashboard (returns stat cards + today's tasks + alert bar data + activity feed)
Frontend: Home page — stat cards, today's priorities, tasks, activity feed, alert bar
Test:     Create a fake overdue invoice in DB → alert bar appears. CEO sees cash position, CTO does not.
```

---

### SLICE 3 — Sales Pipeline
**Goal:** Full pipeline CRUD works. Deal moves to Closed/Won trigger works.

```
Schema:   sales_deals, sales_clients (basic)
API:      GET/POST/PATCH /api/deals, PATCH /api/deals/:id/stage
Frontend: Sales → Pipeline tab, slide-over for new deal, lost reason modal
Test:     Create deal → move through stages → close won → system_jobs row created for deal_invoice_tasks
```

---

### SLICE 4 — Invoices + PDF
**Goal:** Invoice CRUD. Zoho-quality PDF generated and downloadable.

```
Schema:   sales_invoices
API:      GET/POST/PATCH /api/invoices, GET /api/invoices/:id/pdf
Frontend: Sales → Invoices tab, slide-over for manual invoice, PDF preview
Invoice:  Puppeteer HTML template — full Zoho-quality with GST, amount in words, UPI QR
Test:     Create invoice → Download PDF → check GSTIN, GST split, IBM Plex Mono numbers, QR code, amber bar.
          Mark as paid → PAID watermark on PDF.
```

---

### SLICE 5 — Leads + Clients
**Goal:** Full leads CRUD. Lead converts to deal. Clients auto-created on deal close.

```
Schema:   sales_leads (full), sales_clients (full)
API:      GET/POST/PATCH /api/leads, POST /api/leads/:id/convert-to-deal
          GET/POST /api/clients
Frontend: Sales → Leads tab, Sales → Clients tab, slide-overs
Test:     Create lead → convert to deal → client auto-created. lead_scoring webhook fires to n8n.
```

---

### SLICE 6 — Tasks + Projects
**Goal:** Full task + project CRUD. Task must belong to project. Role-based kanban filtering works.

```
Schema:   ops_projects, ops_tasks
API:      GET/POST/PATCH /api/projects, GET/POST/PATCH /api/tasks
Frontend: Work → Tasks (kanban), Work → Projects (list + detail), slide-overs
Test:     CTO only sees Etherence IT tasks. COO sees all team tasks via toggle. Task without project rejected.
```

---

### SLICE 7 — Work Sessions
**Goal:** Session CRUD. Goal required on create. Output required on completion.

```
Schema:   ops_work_sessions
API:      GET/POST/PATCH /api/sessions
Frontend: Work → Sessions tab, slide-over
Test:     Create session without goal → blocked. Complete session without output → blocked.
```

---

### SLICE 8 — Templates + PDF Export
**Goal:** Template CRUD with versioning. PDF export works for all template types.

```
Schema:   templates, templates_versions
API:      GET/POST/PATCH /api/templates, GET /api/templates/:id/pdf
Frontend: Templates page with table filter, preview with {{variables}} rendered, version history
Test:     Edit template twice → versions table has 2 entries. Export template → PDF correct. Filter works client-side.
```

---

### SLICE 9 — CEO Panel
**Goal:** All 4 tabs functional. Finance data CEO-only gated. Mentor Council saves history.

```
Schema:   finance_monthly_pl, finance_expenses, finance_holdings, finance_personal_wealth
API:      GET/POST /api/finance/* (all require requireRole('ceo'))
Frontend: CEO Panel — all 4 tabs, Mentor Council chat
Test:     Login as Nabeelah → /ceo-panel returns 403. Login as Bala → all data loads. Mentor chat saves history.
          Personal wealth data never appears in any agent log.
```

---

### SLICE 10 — Settings + System Jobs
**Goal:** User management, system jobs table, integration config display.

```
Schema:   system_jobs, notifications_sent, audit_logs
API:      GET/POST/PATCH /api/settings/users, GET /api/settings/jobs, POST /api/settings/jobs/:id/retry
Frontend: Settings — Team tab, System Jobs tab, Integrations tab (display only)
Test:     CEO creates new user → appears in team list. Failed job shows retry button. Retry re-enqueues.
```

---

### SLICE 11 — n8n Automations
**Goal:** All 6 automation workflows running in n8n. Webhook endpoints in CBOP wired up.

```
CBOP API: POST /webhooks/lead-updated, POST /webhooks/client-created, POST /webhooks/user-created
n8n:      Import and configure all 6 workflow JSON files
Test:     Update a lead → lead_scoring fires → badge updates.
          Manually trigger follow_ups → overdue invoices sent WhatsApp via OpenClaw.
          Export workflow JSON → commit to Gitea.
```

---

### SLICE 12 — OpenClaw Agents
**Goal:** All 5 active agents wired to OpenClaw. CBOP Control Agent working on Telegram.

```
OpenClaw: Configure deal_invoice_tasks, morning_briefing, prospect_research, social_media, cbop_control
CBOP API: POST /api/agents/trigger/:name (internal — not exposed externally)
          POST /api/agents/cbop-control/tools/* (tool endpoints for cbop_control agent)
Test:     Close a deal → deal_invoice_tasks fires → invoice + project + tasks created.
          Morning briefing sends at 8am (or trigger manually).
          Send "what's overdue?" on Telegram → cbop_control responds with correct data.
          Test role gates: ask as Guru for financial data → refused.
```

---

### SLICE 13 — Security Audit + Deploy
**Goal:** Bala pentests CBOP. All issues fixed. Production deploy.

```
[ ] Bala runs pentest on CBOP (auth bypass attempts, IDOR on company_id, RLS gaps, API enumeration)
[ ] All critical/high findings fixed
[ ] Env vars audited — no secrets in code or DB
[ ] Nginx: HTTPS, HSTS, rate limiting on /auth/*
[ ] Uptime Kuma: all monitors green
[ ] Final smoke test: all 3 users login, full workflow end-to-end
[ ] Tag release: v2.0.0 in Gitea
```

---

## 21. HANDOFF SESSION TEMPLATE

Copy this to the top of every new Claude Code session. Fill it in completely before starting.

```markdown
# CBOP SESSION HANDOFF

## 1. GOAL
What this session must accomplish (one clear sentence).
Ex: "Build Slice 4 — Invoice CRUD + Zoho-quality PDF generation"

## 2. CURRENT STATE
What is working right now (as of last session end).
Ex: "Slices 0–3 complete. Auth works. Pipeline CRUD works. DB has users, companies, deals tables."

## 3. FILES IN FLIGHT
Files that were being worked on when the last session ended (may be incomplete).
- path/to/file.ts — what state it's in
- path/to/file.ts — what state it's in

## 4. CHANGED FILES (last session)
All files that were modified or created in the last session.
- path/to/file.ts — what changed
- path/to/file.ts — what changed

## 5. FAILED ATTEMPTS
Approaches that were tried and didn't work. Do not retry these.
- Attempt: [what was tried] → Reason it failed: [why]
- Attempt: [what was tried] → Reason it failed: [why]

## 6. NEXT STEPS
Ordered list of what this session should do.
1. First thing
2. Second thing
3. Third thing

## 7. CONSTRAINTS (always present — copy every session)
- Postgres + better-auth only. No Supabase.
- n8n for automations. No Bull.js, no Redis.
- All messaging via OpenClaw /send. Never call Telegram or WhatsApp APIs directly.
- SOPs from Outline. Notion integration does not exist.
- No global search bar. Table filters only.
- Trainer AI does not exist in v2. Do not create any trainer_* files or tables.
- Finance endpoints require requireRole('ceo'). Personal wealth data never in agent context.
- Invoice PDF must include: GST split, amount in words, UPI QR code, IBM Plex Mono numbers, amber bar, PAID watermark when paid.
- Task project_id is NOT NULL — every task must belong to a project.
- All slide-over panels — no modals, no separate create pages.
```

---

## 22. NAMING RULES & FUNCTION REGISTRY

### The Ground Rules

These rules exist so that any LLM (Claude Code or otherwise) reading CBOP code produces names that are consistent with the rest of the codebase. Follow these without exception.

---

### File & Directory Names — `kebab-case` always

```
app/
  (auth)/
    login/
      page.tsx
  (dashboard)/
    home/
      page.tsx
    sales/
      page.tsx
      pipeline-tab.tsx
      invoices-tab.tsx
    work/
      page.tsx
      tasks-tab.tsx
api/
  routes/
    deals.ts
    invoices.ts
    tasks.ts
  middleware/
    require-auth.ts
    require-role.ts
  lib/
    db.ts
    openclaw.ts
    pdf-generator.ts
```

**Rule:** Directories = `kebab-case`. Files = `kebab-case.ts` or `kebab-case.tsx`. No underscores in file names. No PascalCase file names.

---

### React Components — `PascalCase`

```typescript
// CORRECT
export function PipelineCard() {}
export function InvoiceSlideOver() {}
export function DealStageColumn() {}
export function AlertBar() {}

// WRONG
export function pipeline_card() {}
export function invoiceSlideOver() {}
```

**Rule:** Every React component is PascalCase. File is `pipeline-card.tsx`, export is `PipelineCard`.

---

### Database Tables — `snake_case` with domain prefix

```
Domain prefixes:
  sales_       → sales_leads, sales_deals, sales_clients, sales_invoices
  ops_         → ops_projects, ops_tasks, ops_work_sessions, ops_task_templates
  finance_     → finance_monthly_pl, finance_expenses, finance_holdings, finance_personal_wealth
  marketing_   → marketing_campaigns, marketing_social_posts
  templates    → templates, templates_versions  (no prefix — it is the domain)
  system_      → system_jobs, notifications_sent, audit_logs
  users        → users, companies, user_companies  (core — no prefix)
```

**Rule:** All table names lowercase snake_case. Always prefixed by domain. Column names lowercase snake_case.

---

### API Routes — `kebab-case` nouns, plural, RESTful

```
GET    /api/deals                    → list deals
POST   /api/deals                    → create deal
GET    /api/deals/:id                → get one deal
PATCH  /api/deals/:id                → update deal
PATCH  /api/deals/:id/stage          → specific action (verb after resource)
GET    /api/invoices/:id/pdf         → file action
POST   /api/leads/:id/convert-to-deal → specific action

POST   /api/agents/trigger/:name     → trigger agent (internal only)
POST   /webhooks/lead-updated        → n8n webhook
POST   /webhooks/client-created      → n8n webhook

GET    /api/settings/users           → settings routes prefixed
POST   /api/settings/jobs/:id/retry  → specific action
```

**Rules:**
- Resources are plural nouns in kebab-case: `/deals` not `/deal`, `/invoices` not `/invoice`
- Actions on a resource are appended after the ID: `/deals/:id/stage`
- Internal agent triggers: `/api/agents/trigger/:name`
- n8n webhook receivers: `/webhooks/:event-name`

---

### TypeScript Functions — `camelCase`, verb-first

```typescript
// API handlers
async function getDeals(c: Context) {}
async function createDeal(c: Context) {}
async function updateDealStage(c: Context) {}
async function getInvoicePdf(c: Context) {}

// Service functions (business logic)
async function buildInvoicePdf(invoiceId: string): Promise<Buffer> {}
async function calculateLeadScore(lead: Lead): Promise<number> {}
async function fetchSopFromOutline(serviceType: ServiceType): Promise<string> {}
async function sendViaOpenClaw(payload: OpenClawPayload): Promise<void> {}
async function createTasksFromSop(dealId: string, sopContent: string): Promise<void> {}
async function fireWebhookToN8n(event: string, payload: unknown): Promise<void> {}

// DB query functions
async function getInvoiceById(id: string): Promise<Invoice | null> {}
async function getInvoicesByCompany(companyIds: string[]): Promise<Invoice[]> {}
async function updateInvoiceStatus(id: string, status: InvoiceStatus): Promise<void> {}

// Auth helpers
async function getUserFromSession(headers: Headers): Promise<User | null> {}
function requireRole(roles: Role[]): MiddlewareHandler {}
```

**Rules:**
- All functions camelCase
- Start with a verb: `get`, `create`, `update`, `delete`, `build`, `calculate`, `fetch`, `send`, `fire`, `mark`, `convert`
- DB query functions start with `get` or `update` or `create` or `delete`
- Never use `fetch` as a function name (conflicts with browser API) — use `fetchFromOutline`, `fetchSop`, etc.

---

### TypeScript Types & Interfaces — `PascalCase`

```typescript
type Role = 'ceo' | 'coo' | 'cto'
type InvoiceStatus = 'draft' | 'sent' | 'paid' | 'overdue'
type DealStage = 'lead' | 'proposal' | 'negotiation' | 'closed_won' | 'closed_lost'
type ServiceType = 'cybersecurity_event' | 'penetration_test' | 'it_consulting' | 'game_development' | 'other'
type NotificationChannel = 'telegram' | 'whatsapp' | 'email'

interface User {
  id: string
  email: string
  name: string
  role: Role
  telegramChatId?: string
  companyIds: string[]
}

interface Invoice {
  id: string
  companyId: string
  invoiceNo: string        // format: ETH-2026-0047
  amount: number
  gstType: 'cgst_sgst' | 'igst'
  gstAmount: number
  total: number
  status: InvoiceStatus
  dueDate: string          // ISO date string
}

interface OpenClawPayload {
  channel: NotificationChannel
  to: string
  message?: string
  template?: string
  vars?: Record<string, string>
  attachment?: Buffer
}
```

**Rule:** Types and interfaces PascalCase. Properties camelCase (even though DB columns are snake_case — transform at the DB query layer).

---

### n8n Workflow Names — `snake_case`

```
follow_ups
financial_calc
reporting
client_onboarding
employee_onboarding
lead_scoring
```

**Rule:** n8n workflow names match the automation names in this PRD exactly, in snake_case. This is also the name written to `system_jobs.name` when the workflow runs.

---

### OpenClaw Agent Names — `snake_case`

```
deal_invoice_tasks
morning_briefing
prospect_research
social_media
cbop_control
```

**Rule:** Agent names match the agent names in this PRD exactly, in snake_case. This is also the name written to `system_jobs.name`.

---

### Environment Variables — `SCREAMING_SNAKE_CASE`

```bash
DATABASE_URL=postgresql://...
BETTER_AUTH_SECRET=...
OPENCLAW_URL=http://openclaw:PORT
OPENCLAW_API_KEY=...
OUTLINE_URL=http://outline:PORT
OUTLINE_API_TOKEN=...
WHATSAPP_PHONE_NUMBER_ID=...
WHATSAPP_ACCESS_TOKEN=...
N8N_WEBHOOK_SECRET=...
AWS_ACCESS_KEY_ID=...
AWS_SECRET_ACCESS_KEY=...
S3_BUCKET_NAME=cbop-backups
```

**Rule:** All env vars SCREAMING_SNAKE_CASE. Never hardcode these. Never store in DB. Always read from `process.env`.

---

### Invoice Number Format

```
{COMPANY_CODE}-{YEAR}-{SEQUENCE}
Examples:
  ETH-2026-0001   (Etherence IT)
  PEN-2026-0001   (Etherence Pentest)
  CYB-2026-0001   (CYBERCOM CTF)
  ATK-2026-0001   (AttackOS)
```

Company codes defined in DB `companies.invoice_prefix` column (add to schema during Slice 4).
Sequence is zero-padded to 4 digits, per company, per year. Resets each January.

---

### CSS Class Naming — Tailwind only, no custom class names

No BEM. No custom class names. Tailwind utility classes only.
If a pattern repeats 3+ times, extract it as a React component, not a CSS class.

```tsx
// CORRECT
<div className="bg-white border border-[#D5DBDB] rounded shadow-sm p-4">

// WRONG
<div className="cbop-card">
```

---

### Commit Message Format

```
feat(slice-3): pipeline kanban CRUD + deal stage transitions
fix(auth): company_ids missing from session context
chore(n8n): export follow_ups workflow JSON
docs: update MASTER.md with Slice 4 handoff notes
```

Format: `type(scope): description`
Types: `feat` `fix` `chore` `docs` `test` `refactor`

---

*End of CBOP v2 Master Document*
*Version 5.0 · May 2026 · All previous documents superseded*
*Feature not in this document = does not exist in v2*
