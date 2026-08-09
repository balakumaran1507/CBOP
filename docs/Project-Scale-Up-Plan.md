# CBOP — Project Scale-Up Plan

**The master build plan for the pivot from internal 3-user ops tool to multi-tenant SaaS.**
This is the document to build against. The four research docs
(`ENTERPRISE_ARCHITECTURE_RESEARCH.md`, `SECURITY_COMPLIANCE_RESEARCH.md`,
`SAAS_UX_RESEARCH.md`, `CURRENT_STATE_AUDIT.md`) are the evidence base; this is the
execution plan synthesized from them. Where a claim here is contested, the research doc
wins on *fact* and this doc wins on *sequencing*.

Created 2026-08-05. Supersedes nothing — it sits above the per-module plans
(`ACCOUNTING_Build_Plan.md`, `SEO_Build_Plan.md`, `SOCIAL_Build_Plan.md`,
`HIRING_OVERHAUL_PLAN.md`, `EMAIL_STUDIO.md`, `WORK_MODULE.md`), which stay authoritative
inside their own module and are folded in by reference, not rewritten.

---

## TL;DR

CBOP becomes a **multi-tenant "Super OS" for SMBs and agentic enterprises** — one identity,
one shell, many apps, sold by plan rather than by page. The five companies Bala already
runs become **tenant zero**: the first customer on the same deployment, dogfooding the same
code path every paying tenant gets. Every existing module (sales, hiring, email studio,
social, SEO/blog, documents, campaigns, accounting, work) graduates from "a page in an
internal tool" to a **real SaaS app** — entitlement-gated, tenant-scoped, self-serviceable,
and priced.

The pivot is not a rewrite. `CURRENT_STATE_AUDIT.md` and `ENTERPRISE_ARCHITECTURE_RESEARCH.md`
independently reached the same conclusion: **~80% of the multi-tenant data model already
exists** (migration 057's `company_roles`/`role_module_access`/`user_invites`, migration
055's `company_modules`, `require-module.ts`, the 18-key module registry, the
`WHERE company_id = ANY($1)` pattern applied consistently across 32 of 37 route files).
What is missing is a **tenant boundary above `companies`**, **enforcement wired to the
schema that already exists**, and a **product shell** on top. That is the shape of this plan.

---

## Non-negotiable read-first

**This document recommends constraint changes. It does not enact them.** `CLAUDE.md`'s
"Non-negotiable constraints" section is, per `SECURITY_CHECKLIST.md` GV.PO, CBOP's security
policy in practice — it is not a style guide and it is not editable as a side effect of
building a feature. Every row in "Constraint changes required" below is a **proposal
pending Bala's explicit sign-off**, and no agent or session may edit `CLAUDE.md` on the
strength of this document alone. Until a constraint is signed off, **the existing CLAUDE.md
text remains binding and is followed as written** — including the ones this plan argues are
wrong. If a build task cannot proceed without a constraint change, that task is blocked and
escalated, not worked around. When a change *is* signed off, `CLAUDE.md` is edited in the
same commit that first depends on it, with the sign-off date in the commit message, so the
policy and the code never drift apart.

The one exception that needs stating plainly: several constraints have **already** drifted
(`docker-compose.yml` runs `cbop-app`, not just postgres and n8n; `users.role`'s CHECK
constraint was dropped by migration 057; `require-module.ts` exists but is wired to zero
routes). Those are documentation-vs-reality bugs, not policy changes, and correcting the
text to match reality is a `docs` fix, not a constraint amendment.

---

## Constraint changes required

Sourced from `ENTERPRISE_ARCHITECTURE_RESEARCH.md` §5 (the 6 keep / 4 amend / 6 break
audit), `SECURITY_COMPLIANCE_RESEARCH.md` §6, and `SAAS_UX_RESEARCH.md` §7.3.
**Verdict legend:** KEEP = survives verbatim · AMEND = intent survives, wording changes ·
BREAK = incompatible with the pivot · ADD = new constraint that does not exist today.

| # | Current CLAUDE.md constraint | Verdict | What changes | Why | Source |
|---|---|---|---|---|---|
| C1 | "Postgres + better-auth only. No Supabase. No Redis. No Bull.js. **No Supabase RLS.**" | **AMEND** | → "No Supabase, no PostgREST, no browser-to-database access. Authorization decisions are made in Hono middleware. **Postgres row-level security is mandatory on every tenant-scoped table** as a second layer, never as the primary mechanism." | Supabase RLS (browser→PostgREST→`auth.uid()`) and Postgres RLS (core server feature since 9.5, no extension) are different things. The ban was aimed at the first; banning the second by accident forfeits the cheapest cross-tenant breach protection available. | ENTERPRISE §1.2, §5 row 1; SECURITY §4.1(b) |
| C2 | "No Redis. No Bull.js." | **KEEP (for now)** | Unchanged, plus a note: permission caching is in-process LRU keyed on a `tenants.policy_version` token; Redis is revisited only when multi-replica cache coherence is a *measured* problem. | The intent — don't add a second datastore — is right, and pg-boss honors it. Don't pre-emptively concede it. | ENTERPRISE §4.3, §5 row 2 |
| C3 | "**n8n for all 6 automations. No custom queue or scheduler code in CBOP.**" | **BREAK** | → "**pg-boss** is CBOP's job queue and scheduler. n8n is retained for *internal-only* automation across Bala's own companies and is never in the path of a paying tenant's workflow." | **Licensing first, not scale.** n8n's Sustainable Use License prohibits embedding n8n as the automation backend of a paid customer-facing product; the sanctioned route is an Embed License from ~$50k/yr. Technically it is also not multi-tenant — a runaway workflow in tenant A starves tenant B. | ENTERPRISE §4.4, §5 row 3 |
| C4 | "Telegram + WhatsApp + Discord through the cbop-bridge only." | **AMEND** | Keep the single-egress principle. Make the bridge tenant-aware: per-tenant credentials, per-tenant rate limits, per-tenant delivery logs, and treat it as an HA-needing SPOF. | The abstraction is correct and becomes a *compliance asset* (one place to log, throttle and attribute every outbound message). A single shared bot identity across customers is not — customers need their own WhatsApp sender and Telegram bot. | ENTERPRISE §5 row 4; SECURITY §6.6 |
| C5 | "Email via nodemailer only… `/api/internal/send-email` never exposed externally." | **KEEP, extend** | Keep both clauses. Add per-tenant sending identity, per-tenant suppression lists, per-tenant reputation isolation. | Single email egress is exactly right; it just needs a tenant dimension. One tenant's spam must not burn another tenant's deliverability on shared SMTP. | ENTERPRISE §4.5, §5 row 5 |
| C6 | "SOPs from Outline only. Notion does not exist." | **BREAK** | → Ship a native SOP/knowledge surface or a pluggable connector. Outline stays as one option for self-hosting tenants. The "no Notion" clause stays (scope discipline). | Customers will not stand up a self-hosted Outline in order to use CBOP. This is a hard product blocker, not an architecture one. | ENTERPRISE §5 row 6 |
| C7 | "**No global search bar.** Table filters only." | **BREAK (partially)** | → Add scoped search: Postgres full-text, tenant-scoped, permission-filtered, surfaced **through the existing command palette**, not as new chrome. Keep table filters everywhere. **No search bar in the topbar.** | Defensible at 3 users and ~50 records; a product defect at 10,000 records × 18 modules. `SAAS_UX_RESEARCH` §1.7 shows the compliant expression: extend `command-palette.tsx` from route-jumping to record-returning. Audit log stays **filter-driven, not search-driven** (GitHub's model) — that half of the rule survives intact. | ENTERPRISE §5 row 7; UX R1.7, R5.4 |
| C8 | "**Finance routes are CEO-only.** `creator` bypasses every `requireRole` gate by design." | **BREAK** | → `requirePermission('finance','read'\|'write')` resolved against the tenant's own roles. **`creator` becomes tenant-scoped `owner`.** Cross-tenant access moves to an audited, break-glass `platform_admin` that writes an audit row on every use, is time-boxed, reason-required and tenant-notified. RLS policies carry **no** role exemption. | A global unaudited bypass is a standing cross-customer breach and an automatic SOC 2 CC6 finding. It also already causes a live bug: because no account holds plain `ceo`, coo/cto get 403 on every finance call (`ACCOUNTING_Build_Plan.md` root-cause section). | ENTERPRISE §5 row 8; SECURITY §4.4, §6.2, §6.3 |
| C9 | "Every task requires a project. `ops_tasks.project_id` NOT NULL. No orphan tasks." | **KEEP** | Unchanged — and **generalize the pattern**: NOT NULL on the scoping FK, enforced in the schema, is exactly what `tenant_id` needs. | Good invariant; tenants define their own project taxonomy, the FK stays. `SECURITY §6.5` explicitly cites this rule as the template for the tenancy work. | ENTERPRISE §5 row 9; SECURITY §6.5 |
| C10 | "Slide-over panels only. No modals. No separate `/create` pages." | **KEEP, with one stated carve-out** | Unchanged inside the authenticated shell. **Carve-out:** `app/(onboarding)/` is a pre-tenant wizard with its own chrome and no sidebar — it is not an in-app create form, because there is no app yet. State this explicitly rather than working around it. | Consistency matters more at product scale, not less. Everything in `SAAS_UX_RESEARCH` — app enable/disable, invites, role edits, upsells, uninstall confirmation — fits in slide-overs. `/apps` is a **page**, not a launcher modal. | UX §3.3, §7.3 |
| C11 | "No hardcoded secrets. All config from `process.env`. Never in DB. Never in frontend." | **AMEND (harden)** | → "No *platform* secrets in the DB. **Tenant-owned** credentials (customer SMTP, OAuth tokens, IdP configs) are stored encrypted at rest with envelope encryption, keys never in the DB. Secrets live in a vault, not `.env`; rotation schedule defined; secret access logged." | There are N per-tenant credentials and they're customer-owned — they cannot live in `.env`. Also: production credentials in git history since `efa2a37` were consciously accepted on the premise "repo is private" — that premise expires the moment other companies' data runs on this platform. | ENTERPRISE §5 row 11; SECURITY §4.3 |
| C12 | "Existing homeserver services… `docker-compose.yml` only contains postgres and n8n." | **BREAK** | → Split infrastructure. Homeserver keeps Bala's internal ops; the SaaS runs on real infra. Nextcloud → object storage. Uptime Kuma → real APM + error tracking. NPM → Caddy (or NPM+Caddy) for per-tenant TLS. Rewrite the constraint as **intent** ("no third-party service that duplicates something already running") rather than an enumeration that goes stale quarterly. | A single Ubuntu box is not a place to host other companies' business data — availability, backup and jurisdiction all fail an enterprise DDQ. **Already stale**: `docker-compose.yml` runs `cbop-app` today. | ENTERPRISE §5 row 12; SECURITY §4.9, §6.7 |
| C13 | "3 users only. Roles are `creator\|ceo\|coo\|cto`." | **BREAK** | → Replace wholesale: `tenant` → `workspace` (today's `companies`) → `team` → `member`; six role templates (owner, admin, manager, member, viewer, billing_admin); tenant-owned custom roles that must **clone** a template. | This is the pivot's core. The `users.role` CHECK constraint was already dropped by migration 057 — the schema is ahead of the docs. | ENTERPRISE §2.5, §5 row 13; AUDIT §1 |
| C14 | "Trainer AI does not exist in v2." | **KEEP** | Unchanged. | Scope discipline. Still valid. | ENTERPRISE §5 row 14 |
| C15 | Invoice format `{COMPANY_CODE}-{YEAR}-{SEQUENCE}` | **AMEND** | → Make the pattern **per-tenant configurable**, seeded with the current default. | Customers have their own numbering conventions and some are statutory. Related open bug: `{YEAR}` must be the *financial* year for Indian GST, not calendar (`ACCOUNTING_Build_Plan.md` open question 4). | ENTERPRISE §5 row 15 |
| C16 | MCP layer: `caller_telegram_id` → user → role; hardcoded `6316112708 → Bala → creator`. | **BREAK** | → MCP calls authenticate a **tenant-scoped service token**; caller identity resolves within a tenant. Delete hardcoded IDs. Agents get their **own principal** with a narrower permission set — never `creator`, never a borrowed human identity. | A hardcoded Telegram ID mapping to a global super-admin is a backdoor the moment a second tenant exists. Per OWASP Agentic Top 10 (ASI01–ASI10), a delegated-authority agent inheriting an unconditional bypass is the canonical failure. | ENTERPRISE §5 row 16; SECURITY §3.3 |
| C17 | "`finance_personal_wealth` data is never passed into any agent prompt or context." | **AMEND (mechanism, not intent)** | The hard rule survives; the **enforcement changes** from a documented convention naming one table to a **deny-by-default classification check at a single choke point**: three tiers (`llm_never`, `llm_tenant_scoped`, `llm_public`), a registry keyed on table+column, one prompt-builder function that refuses unclassified fields, and prompt logging (model version + input classifications + tenant) into `audit_logs`. Cross-tenant data may never appear in one prompt under any circumstance. | A named-table rule cannot express a *per-tenant* obligation — every tenant has a `finance_personal_wealth` equivalent. Under a DPA this becomes contractual, not just internal. A rule upheld by everyone remembering it is not a control. | SECURITY §6.1 |
| C18 | *(new)* | **ADD** | "Every table carrying tenant data has a NOT NULL `tenant_id` and an RLS policy. No exceptions, enforced at migration review **and by a CI test** that fails the build if any `tenant_id`-bearing table lacks `relrowsecurity`." | Policy without enforcement is decoration. | ENTERPRISE §1.4(4); SECURITY §6.8 |
| C19 | *(new)* | **ADD** | "The runtime Postgres role does not own tables." (`cbop_migrator` owns + migrates; `cbop_app` runs the pool and is subject to RLS; a separate `BYPASSRLS` analytics role for cross-tenant reporting only.) | Table owners bypass RLS by default. CBOP runs one `cbop_user` role for both migrations and runtime, so **naively added RLS would be a complete no-op.** The role split is a prerequisite, not an optimization. | SECURITY §4.1(b) |
| C20 | *(new)* | **ADD** | "Every mutating route writes to `audit_logs` via shared middleware, and `set_config('cbop.current_user_id', …, true)` is set once in `requireAuth` per transaction — never per handler." | `audit_logs` exists in migration 001 and has **zero writers**. Per-handler `set_config` is one forgotten line away from a systemic NULL-actor evidence gap (`ACCOUNTING_Build_Plan.md` already flags this exact trap). | SECURITY §4.5 |
| C21 | *(new)* | **ADD** | "No agent tool has an external effect without an approval step." Tools split into read (auto), internal-write (auto, logged), external-effect (approval required — anything that emails/messages a third party or moves money). Plus a platform-wide kill switch that disables all agent tool execution without a deploy. | `cbop_send_invoice` under multi-tenancy means an LLM can send a document, in a customer's name, to *that customer's* customer. No regulation covers this yet; the liability is real. | SECURITY §3.3 |
| C22 | *(new)* | **ADD** | "No customer data trains any model. All inference is local (Ollama via OpenClaw) — no customer data crosses a third-party model provider's boundary." | Currently true, and worth locking in: it removes every hosted-LLM sub-processor from the DPA disclosure list, which is a genuine competitive differentiator against competitors piping customer data to OpenAI. | SECURITY §2.1, §8 |
| C23 | *(new)* | **ADD** | "Breach detection precedes breach-notification promises. Never sign a DPA window shorter than the platform can detect within." | CERT-In's clock is **6 hours from awareness** — and awareness requires a signal. A 24-hour DPA commitment with no detection capability is a contractual liability manufactured out of nothing. | SECURITY §2.4, §2.6 |
| C24 | *(new)* | **ADD** | "Once tenants exist, migrations are **expand/contract only**. Add column → dual-write → backfill → switch reads → drop old, across separate deploys. No destructive migration, ever." | `scripts/migrate.js` is forward-only, which is fine — but a one-step rename or drop is an outage once other people's data is in there. | ENTERPRISE §4.2, §4.5 |

**Net: 5 keeps, 5 amends, 6 breaks, 7 additions.** The breaks cluster in exactly two places
— the role model and the single-box/single-org infrastructure assumptions. The data model,
the naming rules, the UI conventions and the security posture largely survive, which is what
a healthy architecture looks like under this kind of pivot.

---

## Immediate fixes — do these regardless of pivot timing

These are **live problems today**, at 3 users, on the current single-tenant deployment.
None of them depend on the multi-tenancy rebuild, none of them are large, and every one of
them gets *harder* to fix once a second tenant exists. They are not Phase 0 of the pivot —
they are maintenance that should ship independently and can be done in any order except
where noted.

### IF-1 — `resume-scorer.ts`: EU AI Act Annex III + GDPR Art. 22 exposure
**Severity: highest — this is a legal problem now, not post-launch.**
`api/lib/resume-scorer.ts` → `api/lib/local-llm.ts` sends resume text to an LLM and returns
a 0–100 score and A–F grade used to rank candidates. Annex III classifies AI used for
"application filtering and candidate evaluation" as high-risk. Separately and **enforceable
since May 2018**, GDPR Art. 22 restricts decisions based *solely* on automated processing;
the CJEU **SCHUFA** judgment closed the rubber-stamp loophole — review must be *meaningful*,
not formal. Top-tier penalty band (€20M / 4% global turnover). This bites today if any
candidate is an EU data subject.

Ship, in this order:
1. **Disclose at application.** Privacy notice + application form state that AI assists
   screening, what it evaluates, and how it influences the decision.
2. **No auto-reject.** Audit `api/routes/hiring.ts` and `api/routes/hiring-batches.ts` for
   any path that filters, hides, or bulk-rejects below a score threshold without a human
   opening the application. **A score-ordered list a human never scrolls past is
   functionally an auto-reject** — check the UI, not just the query.
3. **Record the human decision separately** from the AI score, with reviewer identity and
   timestamp. This is the *evidence* that review was meaningful; without a record the
   defence does not exist. (Depends on IF-2's audit log.)
4. **Contestation path** — a route for a candidate to request human reconsideration and an
   explanation.
5. **Retention limit** on resume text and scores.
6. **Store the prompt text and model version alongside every score.** Required for AI Act
   record-keeping and the only way to answer "why was I scored 41" a year later.

Flagged for a lawyer (see Open Decision 14) — whether the current flow is "solely
automated" and whether it reaches Annex III are close calls with a €20M band attached.
Bring the actual prompt and the hiring UI flow to that conversation; the classification
turns on operational specifics.

### IF-2 — `audit_logs` has zero writers
`audit_logs` is created in `migrations/001_initial_schema.sql:363` with four indexes and
**nothing in `api/` writes to it** (verified: grep returns index/DDL hits only). `CLAUDE.md`
lists it as a platform table. This is four compliance failures in one missing writer:
DPDP Rule 6(4) (logs ≥1 year), CERT-In 2022 (180 days rolling, stored in India), SOC 2 CC7
(system-generated evidence over the observation window), and the Companies (Accounts) Rules
2021 non-disableable audit trail the accounting plan already documents.

Build it **once**, generalizing `ACCOUNTING_Build_Plan.md`'s `acct_audit_log` design rather
than inventing a second one: before/after JSONB, actor + actor-role snapshot, immutability
via a trigger that unconditionally `RAISE`s on UPDATE/DELETE (**not** `REVOKE` — the single
`cbop_user` role owns the table and owners bypass `REVOKE`). Minimum event coverage now:
auth success/failure/lockout/session-create, **every authorization denial** (the 403s are
the interesting ones), admin actions (role change, company edit, integration config), data
exports and bulk reads, and every MCP/agent tool invocation with full arguments. Set
`cbop.current_user_id`/`cbop.current_role` once in `requireAuth`, per transaction, in
shared middleware — never per handler. Retention: take the **union** of the two conflicting
regimes — ≥1 year, stored in India.
*Dependency: nothing. Everything else that needs evidence depends on this.*

### IF-3 — `GET /api/settings/modules` returns every company × every module
`api/routes/settings.ts:890` runs `SELECT id, name FROM companies` with **no `companyIds`
filter** and returns the full matrix to any `ceo`-or-above caller. Not exploitable today
(there is no real second tenant), which is exactly why it should be fixed before one
exists. **Also check the write side**: `PATCH /api/settings/modules/:companyId/:module`
(`settings.ts:930`) verifies the company *exists* but never checks it is in the caller's
`companyIds` — that is a cross-tenant **write**, which is worse. Add the scope filter to
both, and add a regression test asserting a caller gets 404 (not 403 — don't confirm
existence) for a company outside their scope.
`SAAS_UX_RESEARCH` calls this "the most security-relevant single line in this document"
and ranks it #1 in its build order.

### IF-4 — The company switcher does not switch anything server-side
`api/middleware/require-auth.ts:46` loads `enabledModules` from `companyIds[0]` — a
"primary" company that is simply the first row of an `array_agg`. The topbar switcher
(`app/components/topbar.tsx` + `app/lib/company-context.tsx`) writes
`cbop_active_company_id` to `localStorage` **and nothing else**. A user in two companies
with different module sets gets company A's entitlements no matter what the UI claims is
active — and the array order is not even stable.

Minimum fix now (full fix is P2.4, org-in-URL): accept the active company as an explicit,
**server-validated** request input, reject any value not in `c.get('companyIds')`, and load
`enabledModules` for the *requested* company. `localStorage` drops to remembering the last
choice for a bare `/` visit — a convenience, **never an authorization input**.

### IF-5 — Sidebar duplicates the module registry, and the two have already drifted
`app/components/sidebar.tsx:15` declares its own `type Role` union and `NAV_GROUPS` carries
its own `roles?: Role[]`, independent of `api/lib/modules.ts`. They disagree **in both
directions**: sidebar gates Social/Blog/SEO to `['creator','ceo']` while `modules.ts` grants
`blog`/`seo` to `coo` **and** `cto` and `social` to `coo`; Campaigns is ungated in the
sidebar but excludes `cto` in the registry. Worse, `castRole()` (`sidebar.tsx:83-85`)
force-casts any unrecognized role string to `'cto'` — so a DB-driven custom role from
migration 057 silently inherits CTO's nav today.
Fix: delete `roles?` from `NAV_GROUPS`, extend `MODULES` to carry `href`/`icon`/`space`,
serve the manifest from `GET /api/session`, render the sidebar from that array and nothing
else. Drift becomes structurally impossible because there is only one list.

### IF-6 — 402 vs 403 are collapsed in `require-module.ts`
`api/middleware/require-module.ts:35` and `:41` both return **403** — one for "your role
doesn't have this module," one for "this company doesn't have this module enabled." The UI
cannot tell "ask your admin" from "buy this," which is why the current accounting page
shows blanket 403s with no explanation. Return **402 Payment Required** (or a typed error
body) for the entitlement failure and 403 for the permission failure. Two lines. Unblocks
the entire locked-module UX later.

### IF-7 — Rotate every credential in git history
`SECURITY_CHECKLIST.md` Finding #4: production credentials have been in git history since
`efa2a37`, consciously accepted on the stated premise "repo is private, never goes public."
That premise is what changes under this pivot. **An accepted risk whose premise expired is
just an unaccepted risk.** Rotate everything, document the rotation date, and re-record the
acceptance decision explicitly rather than letting it lapse silently. Cheapest high-impact
item in the entire plan.

### IF-8 — Backups. There are none.
`SECURITY_CHECKLIST.md` RECOVER ranks this above every code-level finding: there is
currently **no backup of the production database**, despite `CLAUDE.md` specifying S3 +
2am `pg_dump` cron. Automated, **encrypted** (they contain PII by definition), offsite (a
second disk on the same box is not a backup), and — the line item buyers actually ask for —
**a tested restore with the date documented**. Anything that runs beats a better plan that
doesn't.

### IF-9 — Hardcoded personal identifiers in route code
`const ALERT_TELEGRAM_ID = '6316112708'` is a module-level constant in **two unrelated
files** — `api/routes/documents.ts:17` (used at `:799`) and `api/routes/email-campaigns.ts:13`
(used at `:270` and `:291`) — paging one specific human whenever *any* company's document
batch or campaign event fires. Also `team_lead_email: 'nabeelah@etherence.com'` hardcoded at
`api/routes/templates.ts:150`. Replace with a per-company "who gets ops alerts" setting
(one column or a small table); it is a one-session fix now and a per-tenant migration later.

### IF-10 — Outstanding `SECURITY_CHECKLIST.md` findings that are cheap now
CSP on HTML-rendering pages (#10), auth on uploads (#12), DOMPurify on any
`dangerouslySetInnerHTML` path (#9 — the Campaigns preview is the known one), `zod` at API
boundaries (#16 — the package is installed and unused, which stops being stylistic the
moment input comes from untrusted users), and soft-delete instead of `ON DELETE CASCADE`
(#15 — deleting one company today silently removes every deal, invoice, task and document,
with no backup and no undo).

---

## Phased build plan

Sequencing logic, stated once so the phase boundaries make sense:

1. **Evidence before enforcement.** The audit log ships before the authorization rework, so
   the rework is observable and so denials are recorded from day one.
2. **Shim before rewrite.** `requireRole` becomes a thin shim over the new permission
   engine *before* any of the 227 call sites are touched. The engine changes underneath a
   stable API; nothing breaks at 3 users; every subsequent phase builds on proven plumbing.
3. **Boundary before isolation.** `tenants` and `tenant_id` land before RLS, because RLS
   policies need a column to reference.
4. **Isolation before customers.** RLS + the Postgres role split + the isolation test suite
   all land while there is still exactly one tenant, so a policy bug is visible immediately
   and harms nobody.
5. **Plumbing before product.** The shell, onboarding and billing come after the tenant
   boundary is real, because every one of them is unsound without server-side scope
   resolution.
6. **Tenant #2 last.** Everything before it is rehearsal.

**No calendar estimates appear in this plan.** None of the research produced them and
inventing them would be worse than omitting them. Phases are ordered by dependency; each
card states what it depends on.

**Compliance gate mapping** (from `SECURITY_COMPLIANCE_RESEARCH.md` §7):
Gate 1 (before *any* external user) = Immediate Fixes + Phases 1–3 + parts of 5.
Gate 2 (before the first paying client) = Phases 5–6 + the legal/pen-test track.
Gate 3 (before the first enterprise client) = SOC 2 / ISO 27001, deferred, $45–70k, and
explicitly **not** to be spent before revenue proves the deals exist.

---

### Phase 1 — Foundation: role wiring, audit subsystem, and the permission engine

**Ships:** the DB-driven role system that migration 057 already built actually takes effect,
behind an unchanged public API. The audit log gets its first writers. Zero user-visible
change.

| Card | What ships | Files / tables |
|---|---|---|
| **P1.1** | **`audit_logs` writer subsystem.** Generalize `acct_audit_log`'s design: before/after JSONB, actor + actor-role snapshot, immutability trigger (`RAISE` on UPDATE/DELETE, not `REVOKE`). Shared middleware sets `cbop.current_user_id`/`cbop.current_role` once per transaction in `requireAuth`. Event names follow `category.operation` (`invoice.create`, `module.disable`, `member.role_change`) per GitHub's model. | new migration; `audit_logs` (001:363); `api/middleware/require-auth.ts`; new `api/lib/audit.ts` |
| **P1.2** | **Permission engine.** `resolvePermissions(userId, companyId) → Map<module, {read, write, scope}>`, sourced from `role_module_access` + `company_modules`, with an in-process LRU keyed `perm:{tenantId}:{userId}` and a `policy_version` invalidation token. Short TTL on allows (~300s), longer on denies. Fails **closed**: no context → 401. | new `api/lib/permissions.ts`; `company_roles`, `role_module_access`, `company_modules` |
| **P1.3** | **`requireRole` becomes a shim.** Reimplement `requireRole(...roles)` internally as a permission lookup so all 227 call sites across 24 route files keep working unchanged while the engine underneath changes. **Zero route edits in this card.** | `api/middleware/require-role.ts:3,12-28` |
| **P1.4** | **Consolidate the copy-pasted role checks.** One `isPlatformAdmin(role)` / permission helper replaces the inline `role === 'ceo' \|\| role === 'creator'` comparisons at `api/routes/mcp.ts:650-651`, `api/routes/dashboard.ts:137`, `require-role.ts:20`, `require-module.ts:29-30`. | those four files |
| **P1.5** | **Seed on company creation.** `POST /api/settings/companies` (`settings.ts:234-269`) must create default `company_roles` + `role_module_access` + `company_modules` rows. Migration 057's seed ran once for pre-existing companies; 055's header comment says new companies "must be backfilled by the route" — verify and implement. | `api/routes/settings.ts:234` |
| **P1.6** | **`company_modules` provenance.** `ADD COLUMN source TEXT NOT NULL DEFAULT 'plan' CHECK (source IN ('plan','admin','trial'))`, `ADD COLUMN trial_ends_at TIMESTAMPTZ`. Read-time resolution: `plan` sets the ceiling → `admin` may turn a granted module **off** but never on → `trial` grants temporarily. **Do this before any billing code** — retrofitting provenance onto rows already written by a plan change is materially harder. | new migration; `company_modules` (055) |

**Depends on:** IF-2 (or ships as part of it), IF-6.
**Exit criteria:** all existing behavior identical at 3 users; `role_module_access` is the
actual source of truth; every authorization denial produces an audit row; a newly created
company is fully provisioned without manual SQL.

---

### Phase 2 — Tenant boundary

**Ships:** a real tenant object above `companies`, exactly one tenant backfilled, the
`creator` global-enumeration bug removed, and org identity moved into the URL.

| Card | What ships | Files / tables |
|---|---|---|
| **P2.1** | **`tenants` table.** `id, name, slug UNIQUE, plan, placement TEXT DEFAULT 'pool' CHECK (placement IN ('pool','silo')), db_dsn_ref (an env **key name**, never a DSN — C11 holds), status, data_region DEFAULT 'in', policy_version, created_at`. `placement` and `data_region` are inert on day one; having the columns is what makes a dedicated-silo enterprise tenant a *routing change* later instead of a schema migration across 60 tables. | new migration |
| **P2.2** | **`tenant_id` everywhere + backfill one tenant.** `ALTER TABLE companies ADD COLUMN tenant_id`. Every tenant-scoped table gets `tenant_id UUID NOT NULL` — **denormalized deliberately**, even where derivable via `company_id`, so RLS is one predicate on one indexed column and never a join. Composite indexes lead with `tenant_id`. All 5 existing companies backfill to tenant zero. | ~60 tables; new migration |
| **P2.3** | **Kill `SELECT id FROM companies`.** The creator-sees-everything enumeration is copy-pasted in four places: `require-auth.ts:27-36`, `mcp.ts:35-40`, `session.ts:33-36`, plus the bypass semantics in `require-role.ts:20` / `require-module.ts:29-30`. `creator` becomes **owner of tenant zero**; a separate `platform_admins` table (not a role string) holds cross-tenant capability, every use of which writes an audit row and is time-boxed + reason-required. | those five files; new `platform_admins` |
| **P2.4** | **Org in the URL.** Move `app/(dashboard)/*` → `app/(dashboard)/[org]/*`, Vercel's shape. `companies.slug` added (unique, immutable — `invoice_prefix` already proves the pattern). `requireAuth` resolves the org from `params`, validates it against `companyIds`, and loads entitlements for the **requested** org. Permanently closes IF-4. | `app/(dashboard)/**`, `api/middleware/require-auth.ts`, `app/lib/company-context.tsx:4-8` |
| **P2.5** | **Same page, other scope.** Switching orgs keeps you on the equivalent page (`/acme/sales/invoices` → `/globex/sales/invoices`), not the dashboard. If the target org lacks that module, land on its `/apps` with the module card focused and its locked-state slide-over open — turning a dead end into a discovery moment. | `app/components/topbar.tsx` |
| **P2.6** | **Default org + the zero-org state.** `users.default_company_id`; `/` redirects there; if null or no longer in `companyIds`, fall back to first-alphabetically and rewrite the stored value (Vercel's auto-reassign). A user with **zero** orgs is a real state in a self-serve product — route to onboarding, never to an empty dashboard. | `users`, `app/(dashboard)/layout.tsx` |
| **P2.7** | **Scope the "assignable companies" surfaces.** `api/routes/settings.ts` user/company management lets any `ceo`/`creator` attach any user to any company in the whole table, with no tenant filter on the picker or the `user_companies` INSERT. Filter both to the caller's tenant. | `api/routes/settings.ts` |

**Depends on:** Phase 1 (the shim must be live so role resolution doesn't have to change
in the same PR as the schema), IF-3.
**Exit criteria:** no unfiltered `SELECT … FROM companies` on any request path; every
tenant-scoped table has `tenant_id NOT NULL`; the org switcher changes server-side
entitlements; a user cannot be attached to a company outside their tenant through any UI.

---

### Phase 3 — Isolation: RLS, the Postgres role split, and the test suite that proves it

**Ships:** database-enforced tenant isolation, while there is still exactly one tenant.

| Card | What ships | Files / tables |
|---|---|---|
| **P3.1** | **Postgres role split — the prerequisite, not a detail.** `cbop_migrator` owns tables and runs migrations; `cbop_app` runs the connection pool, owns nothing, holds neither superuser nor `BYPASSRLS`; a third analytics role holds `BYPASSRLS` deliberately for cross-tenant reporting. **Without this, RLS is a complete no-op** — CBOP's single `cbop_user` owns every table and owners bypass RLS by default. | `docker-compose.yml`, `scripts/migrate.js`, `api/lib/db.ts`, `.env` |
| **P3.2** | **RLS on every tenant-scoped table**, both `ENABLE` **and** `FORCE`. Policies use `NULLIF(current_setting('app.tenant_id', true), '')::uuid` so an *unset* context denies everything rather than erroring or matching. Both `USING` (reads) and `WITH CHECK` (stops a tenant writing a row stamped with someone else's `tenant_id` — `USING` alone leaves an insert-side hole, and this is the DB-level expression of E2 SOP §8.4 mass assignment). Keep FKs tenant-local: RI checks always bypass RLS, so a cross-tenant FK error message is itself a covert channel confirming a row exists. | new migration, all tenant-scoped tables |
| **P3.3** | **`withTenant()` in `api/lib/db.ts`.** `SET LOCAL` / `set_config(..., true)` — **transaction-scoped, third argument `true`, never `false`.** Under PgBouncer transaction mode a session-scoped `SET` persists onto the *next tenant's* request; this is a documented cross-tenant leak and it is the single most important line in the architecture research. The raw `query()` export stops being the default path. | `api/lib/db.ts` |
| **P3.4** | **CI coverage test.** Fails the build if any table with a `tenant_id` column lacks `relrowsecurity` (query `pg_class` / `pg_policies` and assert coverage). Policy without enforcement is decoration. | CI / test suite |
| **P3.5** | **Tenant isolation test suite.** For every `tenant_id`-bearing table, assert tenant A's session cannot read, update, or delete tenant B's rows. This is also **the single most useful artifact to hand an auditor or an enterprise security reviewer** — build it as a deliverable, not just a test. | `tests/security/` |
| **P3.6** | **PgBouncer, transaction mode.** Two pools: transaction mode for the app tier; a **session-mode or direct** pool for pg-boss workers, which need `LISTEN`/`NOTIFY`. Transaction mode forbids session state — no `SET`, no session advisory locks, no cross-transaction prepared-statement reuse. | infra, `api/lib/db.ts` |
| **P3.7** | **Statement timeouts + per-tenant rate limits.** Named constants per E2 SOP §9.1, never inlined. Multi-tenant adds a second axis: limits per tenant **and** per user, so one customer's runaway integration cannot consume the shared pool. | `api/lib/db.ts`, `api/lib/constants.ts` |

**Depends on:** P2.2 (the column must exist).
**Exit criteria:** CI fails if a tenant-scoped table lacks `FORCE ROW LEVEL SECURITY`; the
isolation suite passes; a route deliberately shipped *without* its `WHERE` clause returns an
empty page instead of another tenant's data. Note: **RLS does not remove `WHERE tenant_id = $1`
from queries.** Keep writing them. RLS is the seatbelt, not the steering wheel.

---

### Phase 4 — Authorization: the 227 call sites, role templates, and scopes

**Ships:** `requireRole` is deleted from `api/routes/`; tenants can define their own roles.

| Card | What ships | Files / tables |
|---|---|---|
| **P4.1** | **`requirePermission(module, action)`** replaces the shim as the real gate. Fails closed: no tenant context → 401; no grant → **403**; module not in the tenant's plan → **402**. | `api/middleware/` |
| **P4.2** | **Route migration, module by module, one PR each**, in blast-radius order: `work` → `sales` → `hiring` → `documents` → `email_studio` → `templates`/`subscribers`/`campaigns` → `blog`/`seo`/`social` → `settings` → **`finance` last**. Every PR carries an authorization test asserting a member of tenant B gets **404, not 403** on tenant A's object (don't confirm existence). | all 24 route files carrying `requireRole` |
| **P4.3** | **Object-level authorization.** Per E2 SOP §8.2 and OWASP API1:2023 — every route accepting an object ID re-verifies that *this specific object* belongs to the caller's tenant, per call, never inherited from an earlier check. Pattern: `loadX` middleware that 404s, then the permission gate, then the handler. | all `:id` routes |
| **P4.4** | **Role templates.** `role_templates` + `role_template_modules`, seeded with exactly six: **owner, admin, manager, member, viewer, billing_admin** — the union of what Slack, Notion and Linear actually ship. `company_roles` gains `tenant_id` and `template_slug`. **Custom roles must clone a template** (WorkOS's anti-role-explosion guardrail; Clerk caps custom roles at 10 per instance for the same reason). Resist a seventh template. | new migration; `company_roles` (057) |
| **P4.5** | **`role_scopes` — the thin ABAC layer.** `(role_id, module_key, scope)` with `scope IN ('all','workspace','team','own')`. Four values wide, deliberately. Turns `requirePermission('sales')` into "sales, but only rows where `owner_id = me`" with no policy language, no new service, and no rule that can't be explained to a customer. Composes with RLS: the tenant predicate stays in the policy, the scope predicate is appended by the query helper. | new migration |
| **P4.6** | **`teams` + `team_members`, with `is_private`.** Structural isolation — Linear's lesson that private teams do the isolation work more cheaply than a permission matrix. | new migration |
| **P4.7** | **`tenant_members`.** `(tenant_id, user_id, role_id, status)` composite PK. Role becomes a property of **(user, tenant)**, not of user. `users.role` dies here. | new migration; `users`, `user_companies` |
| **P4.8** | **MCP/agent principals.** Delete the hardcoded `6316112708 → creator` mapping (`api/routes/mcp.ts:22-43`). Agents get their own principal with a narrower permission set, tool-level authorization per tenant, and the read/internal-write/external-effect split from C21, plus a kill switch. | `api/routes/mcp.ts` |

**Explicitly deferred: ReBAC / OpenFGA / SpiceDB.** Not now — with a **written trigger**:
adopt a policy engine when **any two** of these become true: (a) customers need to share an
individual record with a named user *outside* their workspace; (b) permission inheritance
exceeds two levels; (c) a customer needs "this contractor sees only projects they're
assigned to, across three workspaces"; (d) authorization logic appears in more than ~5
places outside the middleware layer. Linear and Notion ship to very large enterprises
without a Zanzibar engine — **ReBAC is not the price of admission to enterprise; per-object
sharing is.**

**Depends on:** Phases 1–3.
**Exit criteria:** zero `requireRole` occurrences in `api/routes/`; a tenant admin can
create a custom role by cloning a template; a cross-tenant object request returns 404.

---

### Phase 5 — Platform runtime: jobs, storage, email, secrets, observability

**Ships:** the parts of the stack that are single-tenant by construction get a tenant
dimension, and n8n leaves the customer path.

| Card | What ships | Files / tables |
|---|---|---|
| **P5.1** | **`api/lib/jobs.ts` job abstraction** — `enqueue(name, payload, { tenantId, runAt })`. Design the interface first so the queue behind it is swappable. Every job carries `tenant_id`. | new |
| **P5.2** | **pg-boss replaces n8n on the customer path.** Postgres-native (`FOR UPDATE SKIP LOCKED` + `LISTEN`/`NOTIFY`), **no Redis, no Bull.js** — the original constraint's actual intent survives; only "no custom queue code" changes. ACID with the business transaction: enqueue the job in the same transaction that creates the invoice, so there is no dual-write, no lost job, no phantom job. Port the six workflows (`follow_ups`, `financial_calc`, `reporting`, `client_onboarding`, `employee_onboarding`, `lead_scoring`). **Keep n8n for internal-only ops** — that use *is* permitted by the Sustainable Use License — and write the boundary into CLAUDE.md so it doesn't drift back. | new; replaces `api/routes/webhooks.ts` triggers |
| **P5.3** | **Per-tenant concurrency caps.** One tenant importing 50,000 leads must not starve everyone else. Noisy-neighbor control is a multi-tenant *requirement*, not an optimization. | `api/lib/jobs.ts` |
| **P5.4** | **Puppeteer moves to a dedicated worker pool** with a hard concurrency cap and a queue in front. Each Chromium is hundreds of MB; in the API process it OOMs the box under concurrent invoice generation. Cache generated PDFs by content hash. | new worker service |
| **P5.5** | **Object storage replaces Nextcloud for tenant files.** Per-tenant key prefixes, presigned URLs. | uploads paths |
| **P5.6** | **Per-tenant email identity.** `api/lib/mailer.ts:41-47`'s `DOMAIN_FALLBACK` and `api/routes/internal.ts:24-30`'s `getHiringInboxes()` each hardcode the same five `SMTP_*` env-var name pairs, independently — **onboarding a sixth company today requires editing source in two files.** `email_domains` (migrations 014/029) already models domain → company → smtp routing as data; the remaining hardcoding is the env-var *names*. Replace with encrypted per-tenant credentials, plus per-tenant suppression lists and reputation isolation. Extend `docs/modules/EMAIL_DELIVERABILITY.md`, don't restart it. | `api/lib/mailer.ts`, `api/routes/internal.ts`, `email_domains` |
| **P5.7** | **Tenant-aware bridge.** Per-tenant OpenClaw credentials (today one global `OPENCLAW_API_KEY` at `api/lib/openclaw.ts:22` authenticates every company's outbound traffic), per-tenant Telegram bot / WhatsApp sender, per-tenant rate limits and delivery logs. Same for `N8N_WEBHOOK_SECRET` (one shared value across 6 files / 14 call sites) and `CBOP_MCP_TOKEN` (`mcp.ts:12`). | `api/lib/openclaw.ts`, `api/lib/hermes.ts`, `api/routes/webhooks.ts` |
| **P5.8** | **Secrets: OpenBao.** OpenSSF-governed fork of Vault 1.14.0 (the last MPL-2.0 release), self-hostable alongside Postgres, with dynamic short-lived Postgres credentials, automatic rotation, per-secret access policies, and an audit log of every retrieval. **Namespaces and horizontal read scaling are free in OpenBao core** where they're Enterprise-only in Vault — directly relevant to a multi-tenant product. Staged: rotate git-history credentials (IF-7) → per-tenant credentials encrypted at rest → stand up OpenBao → dynamic Postgres credentials, retiring the static `DATABASE_URL` password. | infra |
| **P5.9** | **Observability.** Structured logs with `tenant_id` on **every line**, error tracking, per-tenant metrics. Per E2 SOP §10, never log passwords/tokens/secrets, full request or response bodies, raw query params, `Authorization`/`Cookie` headers, or raw email addresses. **Breach detection minimum** (C23): alerting on auth failures, authz denials, and bulk reads — six hours starts at *awareness*. | new |
| **P5.10** | **PITR + per-tenant logical export.** WAL archiving replaces the single nightly dump; per-tenant export exists because GDPR Art. 20 portability and tenant offboarding both need it. | infra |
| **P5.11** | **Soft-delete + retention window** replaces `ON DELETE CASCADE` as the default; hard purge only via an explicit, logged, scheduled job. Plus the **documented data map**: for each data category — where it lives (DB, uploads, backups, logs, object storage, SES, Outline), retention period, deletion mechanism. This artifact also answers the "what data do you hold" section of every security questionnaire, so it pays for itself twice. | schema-wide |

**Depends on:** Phase 3 (jobs carry `tenant_id`; workers need the session-mode pool).
**Exit criteria:** no customer-path workflow runs in n8n; every log line carries `tenant_id`;
a tenant's data can be exported and purged as a documented, logged procedure.

---

### Phase 6 — Enterprise identity

**Ships:** SSO, org modelling, and the audit-log export enterprise buyers ask for.
**The good news of the whole architecture review: no auth vendor migration is required.**
better-auth is MIT and already ships `organization`, `@better-auth/sso` (SAML 2.0 + OIDC)
and `@better-auth/scim`.

| Card | What ships | Files |
|---|---|---|
| **P6.1** | **better-auth `organization` plugin wired to `tenants`** (not to `companies` — keeping identity and business hierarchy cleanly separated; see Open Decision 1). Creates `organization`/`member`/`invitation`, adds `activeOrganizationId` to `session`. `teams.enabled` maps to CBOP `teams`. Plan guardrails via `organizationLimit`, `membershipLimit`, `allowUserToCreateOrganization`, `invitationExpiresIn`. | `api/lib/auth.ts:23-97` |
| **P6.2** | **Dynamic origins.** `auth.ts` currently hardcodes `trustedOrigins` including `cbop.etherence.com` and derives `baseURL` from a single `NEXT_PUBLIC_APP_URL`. Per-tenant domains break both. Three of the last five commits are auth-origin fixes — this is already a sore spot. | `api/lib/auth.ts` |
| **P6.3** | **`@better-auth/sso` — SAML 2.0 + OIDC.** Table stakes: missing "SAML support" on a security questionnaire disqualifies a vendor before technical evaluation, and CISA's *Secure by Demand* guidance pushes buyers to require SSO **at no additional cost** — so treat SSO-tax pricing as a risk, not a plan. Per-org provider config by `domain` or explicit `organizationId`. JIT via `provisionUser` + `provisionUserOnEveryLogin`. **Assume the first several SSO customers are hand-configured by us** — that is normal and it is how WorkOS-less companies do their first 20 deals. | `api/lib/auth.ts` |
| **P6.4** | **IdP owns membership; CBOP owns permissions.** `organizationProvisioning: { defaultRole, getRole }` may inspect SSO attributes, but role *definitions* stay tenant-owned. WorkOS is blunt about this and they're right. | `api/lib/auth.ts` |
| **P6.5** | **Audit log export.** Structured qualifier filters (`operation:`, `actor:`, `created:>=`, ISO 8601 with `..` ranges), CSV + JSON export, stated retention window, owners-only. **No free-text search** — GitHub deliberately doesn't have it, structured filters are faster, and it satisfies C7's surviving half for free. | `api/routes/audit.ts`, `app/(dashboard)/[org]/settings/audit` |
| **P6.6** | **Signup exists at all.** `magicLink({ disableSignUp: true })` at `auth.ts:47-49` plus MASTER.md §7 means there is no signup page anywhere; `find app -iname "*signup*"` returns nothing. Self-service or admin-provisioned tenant provisioning must be **built from scratch**, not adapted. | `app/(auth)/`, `app/(onboarding)/` |
| **P6.7** | **SCIM — second wave, when a deal requires it.** `@better-auth/scim` supports **Users only, no Groups.** Users-only covers deprovisioning, which is the security-critical half (27% of 2025 SaaS security incidents traced to misconfigured SSO, largely incomplete deprovisioning). Group-based role assignment is custom work on top. | deferred |
| **P6.8** | **Domains — subdomains first.** `{tenant-slug}.cbop.app` behind **one wildcard cert via DNS-01**. Do *not* use HTTP-01 per subdomain — Let's Encrypt's limits (~300 new orders/account/3h, 50 certs/registered domain/week) make it fail at scale. True customer-owned domains later via **Caddy on-demand TLS**, which **must** be paired with an ask endpoint confirming the hostname is a registered tenant, or anyone pointing DNS at the IP burns the rate limit. NPM has no equivalent. Cookie note: `advanced.crossSubDomainCookies` with `.cbop.app` works for subdomains (the technique `ACCOUNTING_Build_Plan.md` R&D 3 already chose); customer-owned domains are their own cookie origin — better isolation, but the session must be established per-domain. | infra, `api/lib/auth.ts` |

**Depends on:** Phase 2 (tenants must exist to map an organization onto).

---

### Phase 7 — The Super OS shell

**Ships:** the product surface. Fixes all four defects `SAAS_UX_RESEARCH.md` found, and turns
18 module keys into an app marketplace.

| Card | What ships | Files |
|---|---|---|
| **P7.1** | **One registry, served.** Extend `api/lib/modules.ts` entries with `href`, `icon` (lucide name, resolved client-side), `space`, `dependsOn: ModuleKey[]`, `dataTables: string[]`. `GET /api/session` returns a `modules[]` manifest of `{ key, label, href, icon, space, state }` where `state ∈ 'enabled' \| 'locked_plan' \| 'locked_role'`. The sidebar renders **that array and nothing else**. Permanently kills IF-5. | `api/lib/modules.ts:14-33`, `api/routes/session.ts`, `app/components/sidebar.tsx:30-92` |
| **P7.2** | **Close the registry/route gap.** Add module keys for `accounting`, `tax`, `people` (employees), `website` — all have sidebar routes and no key. Give `mentor`, `goals`, `rnd` nav entries or drop them. `/dashboard`, `/profile`, `/command` are **shell routes, not apps** — topbar/footer, never the module list. In a marketplace where a tenant buys apps, "app" must be one enumerable concept. | `api/lib/modules.ts`, `app/components/sidebar.tsx` |
| **P7.3** | **Spaces, not hardcoded groups.** Keep today's five groups as *default Spaces* (`revenue`, `growth`, `people`, `knowledge`, `system`) but move them to a `space` field on each module, and add a **Pinned** space at top, persisted **per user, not per company** (Microsoft 365's pin behaviour). Zoho's lesson: at 18+ apps, grouping by *who you are* beats grouping by *what the app does*. The existing `localStorage`-backed group collapse is already the right mechanic — extend it. | `app/components/sidebar.tsx` |
| **P7.4** | **`/[org]/apps` — a real page, not a launcher popover.** The Odoo Apps dashboard: card grid of every module, filter chips (All / Enabled / Available / by Space), search input, state badge per card. **Locked cards render with a lock glyph and a tier badge, never hidden** — visible-but-locked converts, hidden does not. A full page satisfies the no-modals rule by construction and gives the marketplace a URL to link to from email and billing. | new route |
| **P7.5** | **Enable and disable through slide-overs**, with Odoo's uninstall confirmation ported exactly: two labelled sections — *Apps that will also be disabled* (from `dependsOn`) and *Data that becomes inaccessible* (from `dataTables`, with live row counts) — plus type-to-confirm. **One deliberate divergence from Odoo: CBOP disables, it never deletes.** `is_enabled = false` hides the app and 402/403s its routes; rows stay on disk. Say so in the copy — "your data is retained and returns if you re-enable" removes the biggest objection to trying a module off. | new slide-over |
| **P7.6** | **`<AppPage title tabs filters primaryAction>`** — one page shell, enforced across every module route. Rippling's "learn it once, know it everywhere" is a component decision, not a design one, and it is why adding app #19 will be cheap. | `app/components/` |
| **P7.7** | **Scoped search through the command palette.** Extend `app/components/command-palette.tsx` from route-jumping to returning records across enabled modules, scoped to the active org and filtered by permission. Zero new chrome. Teach `⌘K` on first dashboard load with one dismissible inline hint — because the no-search-bar rule means the palette is the *only* way to search, and a user who never discovers it experiences a product with no search at all. | `app/components/command-palette.tsx` |
| **P7.8** | **Settings restructured into nine sections** as a sub-sidebar inside the settings route (CBOP's version of Slack's separate admin page — same isolation, no new app): General (danger zone at the **bottom**, type-to-confirm) · Members (+ access rules) · Roles · Apps · Billing · Integrations · Security · Audit log · Health. **Apps and Roles ship first** — their backends already exist (`GET/PATCH /api/settings/modules`, `/api/settings/roles` + `role_module_access`) and they are the marketplace's control surface. | `app/(dashboard)/[org]/settings/` |
| **P7.9** | **Conditional Assignment** (Zoho's mechanic): a rule row — *"role = Sales → grant Revenue pack modules"* — evaluated on member creation. Reuses `role_module_access` entirely; the only new things are a rule table and a slide-over to author rules. Zoho's stated rationale (fewer missed permissions at onboarding) is exactly the failure mode a tenant admin hits at 20 employees. | new |
| **P7.10** | **`/[org]/settings/health`** — the M365 Health page. CBOP already tracks `system_jobs`, agent runs and automation status: surface last run / status / next scheduled per job to tenant admins. "Is the automation running" is the #1 support question in a self-hosted ops OS, and this deflects it. | `system_jobs` |
| **P7.11** | **Inbox at `/[org]/inbox`** — Linear's split layout (list left, detail right). Bell stays as unread count + top-5 peek + "View all". `ALTER TABLE app_notifications ADD COLUMN tier SMALLINT DEFAULT 2 CHECK (tier IN (1,2,3)), module_key TEXT, snoozed_until TIMESTAMPTZ, actor_user_id UUID`. Tier decides delivery and the channels already exist: **tier 1 → in-app + Telegram/WhatsApp via the bridge; tier 2 → in-app only; tier 3 → rolled into the morning briefing.** Mapping: invoice overdue / task assigned to you / your deal stuck 7+ days / **automation job failed** = tier 1; comments, status changes, someone else closed a deal = tier 2; campaign sent, blog published, SEO crawl done, **automation succeeded** = tier 3 (never notify on success). Module chips + actor filter (CBOP's agents are exactly the noisy non-human actors Linear built that filter for). Every notification states *why you got it*, with an unsubscribe affordance. Cap and prune before multi-tenant volume arrives. | `app_notifications` (058), `app/components/notification-bell.tsx` |
| **P7.12** | **Onboarding route group `app/(onboarding)/`** — the stated C10 carve-out. `/signup` (≤3 fields; async verification — **8,325 of 25,000 users in the cited sample abandoned between account creation and email verification**, so never block on the email; SSO/social bypasses it entirely) → `/onboarding/org` (name → slug auto-derived + editable, country/currency — invoicing is ₹/en-IN today and must not stay assumed) → `/onboarding/use` (**one routing question**, Notion's move: "What do you run on CBOP?" multi-select over four Spaces, not eighteen checkboxes) → `/onboarding/apps` (pre-checked from that answer, every box editable, writes `company_modules`) → `/[org]/dashboard` seeded with demo data. **Skip on every configuration screen; no progress bar** (22/37 audited flows offer skip; only 41% show progress). Instead of a bar, a contextual task card on the dashboard that survives past onboarding. | new route group |
| **P7.13** | **Seed demo data, tagged and reversible.** `is_demo BOOLEAN DEFAULT false` on `sales_clients`, `sales_deals`, `sales_invoices`, `ops_projects`, `ops_tasks`. One banner: *"Showing sample data — Remove sample data."* Pipedrive's lesson: the seed must demonstrate the **relationships** (deal→client→invoice→project→task) — which is precisely what `ops_tasks.project_id NOT NULL` is about, so seed the project first. 37/37 audited flows prevented the empty first screen. | new migration |
| **P7.14** | **Invite after the first real record**, not before — via a topbar slide-over with pre-filled subject and body. `api/routes/settings.ts` already has the invite path (`genTempPassword`/`newAuthId`); reuse it. Accounts with 3+ active users churn at a fraction of the single-user rate, but only 15/37 flows invite early — individual-first activation dominates. | `api/routes/settings.ts` |

**Depends on:** P2.4 (org in URL), IF-6 (402/403 split), P1.6 (module provenance).

---

### Phase 8 — Commercial surface

| Card | What ships |
|---|---|
| **P8.1** | **Usage dashboard ships *before* metering.** `/[org]/settings/usage`: seats used vs included, emails sent this cycle, LLM calls, storage. Read-only, no pricing attached. The hybrid-pricing research is explicit: *customers accept usage-based billing only if they trust their ability to monitor and control it* — decoupling visibility from pricing risk is what buys acceptance. |
| **P8.2** | **Bundled tiers with module *packs*, not à-la-carte per-app pricing** (Zoho's shape, not Atlassian's). Reasons specific to CBOP: 18 modules à la carte is 2^18 billable configurations; the modules are heavily cross-referential (one invoice touches `sales`, `finance`, `documents`, `templates`, `email_studio`); and Atlassian's own docs show the complexity tax — separate billing accounts, a separate billing-admin role, per-product user tiers. Map packs onto the `space` grouping: **Core** (`work`, `documents`, `templates`, `goals`) · **Revenue** (+ `sales`, `accounting`, `tax`, `finance`) · **Growth** (+ `campaigns`, `email_studio`, `subscribers`, `social`, `blog`, `seo`, `website`) · **Full OS** (everything incl. `hiring`, `mentor`, `audit`, `legal`, `rnd`). |
| **P8.3** | **Hybrid, not seat-only.** Seats for the platform; metered **only** where marginal cost is real — outbound email (`mailer.ts`), LLM calls (`openclaw.ts`/`local-llm.ts`), PDF generation. Seat-only models show ~2.3× higher churn than hybrid/usage-based; 43% of companies were on hybrid in 2025, projected 61% by end of 2026. |
| **P8.4** | **Buy the portal, own the plan picker.** Stripe's hosted Billing customer portal handles payment method, invoice history, cancel and dunning — do not rebuild any of it. Build only CBOP's plan/module picker, because it must render against the module registry and show exactly which apps a change adds or removes. Configure cancellation as **at end of billing period**, not immediate. |
| **P8.5** | **Three locked states, rendered identically in sidebar, `/apps` and the palette.** `enabled` → normal. `locked_plan` → dimmed + lock glyph + tier badge; click opens a slide-over naming **three things**: the exact feature, the plan that unlocks it, the concrete benefit (gating at the moment of intent converts at ~12% vs ~5% for a generic paywall). `locked_role` → **hidden**; a permission failure must never read as an upsell, because showing an upgrade CTA to a user whose *role* excludes a module generates a support ticket their own admin has to answer. |
| **P8.6** | **`billing_admin` is its own grantable capability**, not folded into owner/ceo. A real tenant routinely has a finance person who must see invoices and touch nothing else, and `role_module_access` already provides the mechanism. |

**Depends on:** P1.6 (provenance), P7.1/P7.4 (registry + `/apps`), P8.1 before P8.3.

---

### Phase 9 — Legal, evidence, and the compliance gates

Not a build phase in the same sense; a parallel track with hard ordering against the others.

| Card | What ships | Gate |
|---|---|---|
| **P9.1** | **Lawyer engagement** — ToS/MSA, Privacy Policy, DPA, AUP, SLA. Bring pre-prepared: the data map (P5.11), the sub-processor list, the architecture description, the AI-feature inventory. A lawyer who has to extract these from conversation bills several times what one handed a written pack will. | 2 |
| **P9.2** | **Sub-processor list**, published, with a change-notification subscription and a 30-day advance-notice mechanism. Read `.env.example` as the inventory. **Self-hosting Outline/n8n/Ollama is a genuine differentiator here** — those drop off the list entirely because no data leaves CBOP's control. Say so in the whitepaper. | 2 |
| **P9.3** | **Third-party penetration test — after Phase 3, never before.** A report whose headline is "tenant isolation is application-layer only and one role bypasses all authorization" is a report you can't show anyone, and you'll pay for a re-test. | 2 |
| **P9.4** | **Incident response plan** on NIST SP 800-61r3's shape (which slots into `SECURITY_CHECKLIST.md`'s existing CSF 2.0 structure): named roles, severity ladder with the notification clock attached per level, detection sources, notification decision tree **with pre-written templates** (six hours does not allow for drafting), escalation contacts, evidence preservation before remediation, post-incident review, annual tabletop. | 2 |
| **P9.5** | **The clock table, pinned somewhere visible.** CERT-In **6 hours** from awareness · GDPR Art. 33(2) processor→controller without undue delay (contract for 24h) · GDPR Art. 33(1) 72h · DPDP on discovery + 72h detailed · customer DPA whatever was signed. **Never sign shorter than you can detect** (C23). | 2 |
| **P9.6** | **Data-subject-rights plumbing as actual endpoints** — export, deletion, rectification. Plus tenant offboarding: export, purge within a stated window, notify sub-processors, log the whole thing. | 2 |
| **P9.7** | **Erasure vs statutory retention reconciliation.** Accounting's no-hard-deletes-ever rule and GDPR Art. 17 genuinely conflict. The standard resolution — a statutory retention obligation is a lawful basis to refuse erasure of *financial records*, while everything not subject to it is still erased — must be **written into the privacy policy and the DPA**. Lawyer question, not an engineering one. | 2 |
| **P9.8** | **Change management: PR + one review + linked issue.** Cheap now, expensive to retrofit as SOC 2 CC8 evidence later. `SECURITY_CHECKLIST.md` Finding #24 (~90 files, 8,811 insertions as one unreviewed batch) is a textbook audit exception. Note CC8 does **not** require heavyweight process — a Gitea PR with one reviewer and a linked issue satisfies it. | 2 |
| **P9.9** | **Trust package**: pre-filled SIG Lite / CAIQ, pen-test summary (full report NDA-gated), sub-processor list with locations, security whitepaper (architecture, encryption, tenant isolation, backup/DR), **RTO/RPO in writing**, counter-signable DPA, public Trust Center. Self-serve availability is measurably the difference between a 3-week and a 3-month security review. | 2→3 |
| **P9.10** | **SOC 2 Type II** — compliance platform, readiness assessment, then a 3–6 month first observation window. $45k–$70k all-in. **Do not spend this before revenue proves the deals exist.** ISO 27001 when the first serious EU/APAC/Gulf/public-sector prospect appears (~65–75% control overlap makes the second one far cheaper). ISO 42001: **build to its 38 Annex A controls, don't certify** — doing so makes later certification a 2–4 month add-on instead of a 12-month project. | 3 |
| **P9.11** | **DPDP full compliance ahead of 13 May 2027** — the hard planning deadline, and conveniently roughly the horizon on which the SaaS reaches real customer volume, meaning the compliance build and the product build are the same project rather than sequential ones. | 3 |

**Explicit non-goals** (following `ACCOUNTING_Build_Plan.md`'s practice of naming these so
scope doesn't creep): no SOC 2 before revenue · no speculative EU region (design for it,
build it when someone pays) · no ISO 42001 certification yet · no GRC platform before Gate 3
· **no mTLS/zero-trust on a single host** — `SECURITY_CHECKLIST.md` was right and stays
right until host #2 · no client-facing portal for tenants' *end*-customers (that is a second
product with a second compliance surface) · **no customer data to a hosted LLM API** · no
legal text drafted in this repo.

---

### Phase 10 — Tenant #2

The real test. Everything before it is rehearsal. Ships when: the isolation suite passes,
the pen test is clean, the DPA is counter-signable, RTO/RPO are stated and met, and the
onboarding flow can provision a tenant end-to-end without a human running SQL.

---

## Per-module SaaS-ification

What "full SaaS app" means for each existing module, at a feature-card level. Every module
inherits the same **five baseline requirements** from the phases above, so they aren't
repeated per module:

> **B1** `tenant_id NOT NULL` + RLS policy on every table the module owns ·
> **B2** `requirePermission(module, action)` + object-level check on every `:id` route ·
> **B3** every mutation writes `audit_logs` · **B4** entitlement-gated with a real
> `locked_plan` upsell state · **B5** renders inside `<AppPage>` with slide-over forms only.

Modules are listed in build order — the same blast-radius ordering as P4.2. Work and Sales
first because they're the lowest-risk and highest-traffic; Finance/Accounting last.

---

### 10.1 Work / Projects / Tasks / R&D / Goals
*Existing plan: `docs/modules/WORK_MODULE.md` (authoritative on internals — 4 tabs, kanban, `work_type` client/internal split, R&D initiatives + dated log). Do not re-litigate its decisions.*

| Card | What ships |
|---|---|
| **WORK-1** | **Per-tenant project taxonomy.** `work_type` stays `client`/`internal`; project *categories* become tenant-configurable rather than freeform names. `ops_tasks.project_id NOT NULL` is preserved verbatim (C9). |
| **WORK-2** | **Scope-aware task views.** `role_scopes` with `scope='own'` gives "my tasks" vs "team tasks" vs "all tasks" without a new permission per view — the first real consumer of P4.5. |
| **WORK-3** | **Teams as the isolation primitive.** `teams.is_private` (P4.6) means a tenant can have a contractor who sees only their team's projects, structurally — Linear's lesson, and cheaper than a permission matrix. |
| **WORK-4** | **R&D gets company scoping.** Today all users see all initiatives regardless of `companyIds` — deliberate at 3 users, indefensible at N tenants. |
| **WORK-5** | **Job-backed reminders.** The automations `WORK_MODULE.md` lists as "likely next steps" (task overdue digest, R&D initiative idle 14+ days) are built on **pg-boss** (P5.2), not n8n — and route through the tier-1/tier-3 notification split (P7.11). |
| **WORK-6** | **Billable time → invoice line.** `ops_work_sessions` gains a billable flag + rate; convert-to-invoice-line closes the loop to Sales and Accounting. `ACCOUNTING_Build_Plan.md` R&D 1 already lists this as a SHOULD-HAVE. |

### 10.2 Sales / CRM (leads, deals, clients, invoices)

| Card | What ships |
|---|---|
| **SALES-1** | **`service_type` becomes tenant-configurable.** `migrations/001_initial_schema.sql:102` hardcodes a CHECK of Etherence's five service lines. A tenant selling "managed IT support" or "graphic design" has no path today without a migration. Replace the CHECK with a per-tenant list table, defaulting to `'other'` so no tenant is blocked at onboarding. Same for `ops_task_templates.service_type` (`001:198-206`), which is joined by convention rather than FK. |
| **SALES-2** | **Tenant-configurable pipeline stages.** `DealStage` is a product constant today; it becomes tenant data with the current five as the seeded default. |
| **SALES-3** | **Invoice numbering per tenant** (C15). Keep the race-safe `pg_advisory_xact_lock` generation and `invoice_prefix` uniqueness — those are genuinely tenant-agnostic and need no rework. Make the *pattern* configurable, and fix `{YEAR}` → financial year (`ACCOUNTING_Build_Plan.md` open question 4). |
| **SALES-4** | **Lead scoring becomes a pg-boss job** with per-tenant concurrency, replacing the `lead_scoring` n8n workflow. |
| **SALES-5** | **Client/deal/invoice sharing boundary.** This is the ReBAC trigger to watch (P4 deferral criterion (a)) — if tenants need to share one deal or invoice with an external accountant, that's one of the two conditions for revisiting OpenFGA. Until then: no per-object ACLs. |
| **SALES-6** | **Import.** Every CRM migration starts with a CSV import of leads/clients/deals. Blank-state prevention (P7.13) covers day one; import covers day two. |

### 10.3 Hiring / ATS
*Existing plan: `docs/modules/HIRING_OVERHAUL_PLAN.md` (Ollama+Gemma local scoring, mammoth.js DOCX viewer, comparison-speed UX redesign). Its decisions stand; the cards below are the SaaS layer on top.*

**This is the highest-regulatory-risk module in the product, and the sequencing reflects that.**

| Card | What ships |
|---|---|
| **HIRE-1** | **IF-1 in full, as a shipped feature, not a patch** — disclosure at application, no auto-reject, separately recorded human decision with reviewer identity + timestamp, contestation route, retention limit, prompt + model version stored per score. |
| **HIRE-2** | **Provider-vs-deployer decision, made explicitly.** Today CBOP is both provider and deployer of its own recruitment AI. Sold as SaaS to a customer screening *their* applicants, CBOP becomes the **provider of a high-risk AI system** — risk management across the lifecycle, data governance, technical documentation, record-keeping, instructions enabling deployer compliance, human-oversight-by-design, accuracy/robustness, and a QMS. Three options: (a) full high-risk conformity, (b) geo-restrict the module out of the EU, (c) **restructure so the AI produces decision support under demonstrably meaningful human review rather than a ranking.** Option (c) is cheapest and is what GDPR Art. 22 independently requires. See Open Decision 15. |
| **HIRE-3** | **Per-tenant hiring inboxes as data, not env vars.** `api/routes/internal.ts:24-30` hardcodes five `SMTP_*` pairs for IMAP hiring-inbox reads, duplicating `mailer.ts`. Move to the encrypted per-tenant credential store (P5.6/P5.8). |
| **HIRE-4** | **Per-tenant scorecards/rubrics.** The scoring criteria are CBOP's (CTF prizes, pentest projects, final-year status). A logistics firm needs its own. Rubric becomes tenant-configurable data feeding the prompt through the classification choke point (C17). |
| **HIRE-5** | **Batch interview + job pipeline stays**, but per-tenant job boards and per-tenant careers-page publishing become the SaaS surface (ties to SEO/blog's public content API). |
| **HIRE-6** | **Candidate PII retention + erasure**, wired to P9.6's data-subject-rights endpoints. Candidates are the largest volume of *third-party* PII in the product. |

### 10.4 Email Studio
*Existing plan: `docs/modules/EMAIL_STUDIO.md` — one `email_designs` table, one editor, one send log; every module composes through it. That consolidation is exactly right and is the foundation the SaaS layer needs.*

| Card | What ships |
|---|---|
| **MAIL-1** | **Per-tenant sending identity** (P5.6): verified domains, DKIM/SPF/DMARC guidance in-product, per-tenant suppression lists, per-tenant reputation isolation. One tenant's spam must not torch another's deliverability — this is a real multi-tenant risk, not hypothetical, and it's why the AUP clause in P9.1 matters. |
| **MAIL-2** | **Design library gets tenant + global scoping.** `is_global` designs today mean "not tied to one company"; under multi-tenancy they must mean "platform-provided starter template," with tenant-owned designs strictly tenant-scoped. |
| **MAIL-3** | **`email_send_log` becomes a metered surface** — it's already the per-send record, so it's the natural source for P8.3's email metering and P8.1's usage dashboard. |
| **MAIL-4** | **Close the known gaps** already logged in `EMAIL_STUDIO.md`: the three unwired hiring email types (`shortlist_notification`, `interview_reschedule`, `interview_cancellation`), `marketing_campaigns.source_design_id` so Load/Save-as-Design becomes a persistent link rather than a one-way copy, and an assets-management UI over `email_design_assets`. |
| **MAIL-5** | **`POST /api/internal/send-email` stays internal-only** (C5, unchanged) but gains tenant attribution and per-tenant rate limits, and its n8n caller is replaced by a pg-boss job. |

### 10.5 Campaigns + Subscribers

| Card | What ships |
|---|---|
| **CAMP-1** | **Per-tenant throttling and quota**, enforced against the plan's email allowance, with the auto-pause/bounce-rate alerts routed to a **per-tenant** alert destination instead of `ALERT_TELEGRAM_ID` (IF-9, `email-campaigns.ts:13,270,291`). |
| **CAMP-2** | **Consent + preference centre per tenant.** Under DPDP and GDPR, subscriber consent is the tenant's obligation and CBOP is the processor — so the platform must record lawful basis, source, and timestamp per subscriber, and expose withdrawal that is as easy as granting. |
| **CAMP-3** | **AUP enforcement hooks** — the clause prohibiting unsolicited bulk email is the one that protects every *other* tenant on shared SMTP. It needs a technical counterpart: bounce/complaint thresholds that suspend sending, not just an alert. |
| **CAMP-4** | **Sanitize the composer preview.** The raw-HTML `dangerouslySetInnerHTML` path is IF-10's DOMPurify item; untrusted tenant-authored HTML makes it a real stored-XSS vector rather than a stylistic finding. |

### 10.6 SEO + Blog CMS
*Existing plan: `docs/modules/SEO_Build_Plan.md` — Build Units 1–7 COMPLETE (GSC/GA4/PageSpeed integration, monitoring dashboard, in-house technical auditor, blog CMS backend + editor, site settings, Pulse + MCP tools). Treat as built; these are the SaaS deltas.*

| Card | What ships |
|---|---|
| **SEO-1** | **One OAuth app, many customer connections.** The Google/LinkedIn OAuth *apps* are single platform-level registrations — which is normal SaaS shape and **not** a blocker — but each tenant's connected property/token must be tenant-scoped and encrypted at rest (P5.8). `seo_site_connections` and `social_connections` already model per-company connections; they inherit `tenant_id`. |
| **SEO-2** | **Public content API becomes the tenant's headless CMS endpoint** — per-tenant API keys, per-tenant rate limits, cache headers. This is the "CBOP is the CMS" promise made multi-tenant. |
| **SEO-3** | **Scheduled publish moves to pg-boss.** `SEO_Build_Plan` deferred blog scheduling because of the no-custom-scheduler constraint (C3); that constraint is exactly what changes. |
| **SEO-4** | **Per-tenant PageSpeed/GSC quota accounting** — these are metered upstream APIs, so they belong in P8.1's usage dashboard before they're ever billed. |
| **SEO-5** | **Site Settings → JSON-LD generation** stays as built, scoped per tenant per site. Multi-site per tenant is the natural extension for agencies (see Open Decision 1). |

### 10.7 Social
*Existing plan: `docs/modules/SOCIAL_Build_Plan.md` — monitor prototype built; LinkedIn Path A (personal, `w_member_social`) built and awaiting real credentials; Path B (company page, Community Management API) is gated on a weeks-to-months LinkedIn approval plus an Ads account per page.*

| Card | What ships |
|---|---|
| **SOC-1** | **Per-tenant platform connections with encrypted tokens** and honest per-platform state (the module's existing "connected / pending approval / not recommended" pattern generalizes cleanly — keep it). |
| **SOC-2** | **Path A token expiry becomes a tenant-visible health item.** The self-serve tier has no refresh token and expires in ~60 days; today that's a Pulse reminder for Bala, and it becomes a per-tenant reconnect prompt on `/settings/health` (P7.10). |
| **SOC-3** | **Path B is per-tenant by construction** — each tenant files their own Community Management API application against their own page. CBOP ships the connect flow and the org-URN capture; the approval is the customer's external step. Document it as such, the same way the plan already documents Meta's review. |
| **SOC-4** | **Scheduled publish on pg-boss**, replacing the deferred n8n cron (same as SEO-3). |
| **SOC-5** | **AI draft stays "AI drafts, human approves," never auto-publish** — consistent with C21's external-effect rule and with the module's existing posture. |

### 10.8 Documents + Templates (Document Studio)

| Card | What ships |
|---|---|
| **DOC-1** | **Per-tenant branding is already data-driven** — `email_branding`/`logo_initials`/`company-brand.ts` (migration 051) replaced hardcoded per-company constants. New tenants need a DB row, no code change. **Reuse as-is**; the only cleanup is the 4 literal company UUIDs still typed into `api/lib/company-brand.ts:36-40` as a cold-start fallback. |
| **DOC-2** | **Puppeteer to a worker pool** (P5.4) with per-tenant concurrency, plus content-hash PDF caching. Document batch generation is the single most likely OOM source at 10 tenants. |
| **DOC-3** | **Batch-complete alerts per tenant**, replacing `documents.ts:17,799`'s hardcoded Telegram ID (IF-9). |
| **DOC-4** | **Template library scoping** — platform starter templates vs tenant-owned, same split as MAIL-2. `templates_versions` is already the right revision-history pattern and needs no rework. |
| **DOC-5** | **Files to object storage** with per-tenant prefixes and presigned URLs (P5.5); attachments stop assuming Nextcloud. |

### 10.9 Accounting / Finance / Tax
*Existing plan: `docs/modules/ACCOUNTING_Build_Plan.md` — locked decisions (Zoho Books as reference, subdomain "app inside an app" at `accounting.etherence.com`, statutory-grade filing-ready depth), full DDL for `migrations/059_acct_accounting_module.sql`, 9 build slices. **Absorb, don't duplicate or contradict.***

The accounting rebuild is the **first precedent for "existing module → full SaaS app"** and
several of its design calls are being promoted to platform-wide patterns by this plan:
its `acct_audit_log` becomes the template for IF-2/P1.1's platform audit log; its
trigger-not-`REVOKE` immutability reasoning is the same root cause as C19's Postgres role
split; its cross-subdomain SSO work is the template for P6.8.

| Card | What ships |
|---|---|
| **ACCT-1** | **Ship the accounting plan as written.** Slices 1–9 stand. Its schema is `company_id`-scoped, which is correct — `tenant_id` is added by P2.2 alongside every other table, not by re-designing the accounting schema. |
| **ACCT-2** | **The finance 403 bug is fixed by C8/P4.2, not by the accounting rebuild.** `ACCOUNTING_Build_Plan.md` correctly diagnoses it as an access-control bug ("company select doesn't work" = coo/cto get 403 on every `/api/finance/*` call because no account holds plain `ceo`). Do **not** paper over it with more `creator` usage. Under multi-tenancy, tenants will absolutely have users who need finance access without being the tenant owner. |
| **ACCT-3** | **Chart of accounts per company stays per company** — 5 separate legal entities, separate GSTINs, separate ROC filings. Under tenancy that becomes "per workspace within a tenant," and the cross-company rollup the plan requires must work **within** a tenant and be **impossible across** tenants. One column cannot mean both — this is precisely why `companies` cannot be reused as the tenant. |
| **ACCT-4** | **Jurisdiction becomes a tenant property.** The whole module is India/GST-shaped by design (correct for tenant zero). International tenants need `tenants.data_region`-adjacent jurisdiction config: which statutory reports exist, which tax model applies, financial-year boundaries. **Do not generalize speculatively** — ship India-complete, and treat a second jurisdiction as a funded project when a customer needs one. |
| **ACCT-5** | **`finance_personal_wealth` stays exactly as gated**, and its enforcement migrates to C17's classification choke point rather than remaining a named-table rule. |
| **ACCT-6** | **The subdomain pattern needs a decision** before it's repeated (Open Decision 6). If `accounting.*` is the template for all future apps, the app switcher must handle cross-origin navigation and the shared shell must become a published package — a materially different Phase 7. |

### 10.10 Dashboard / Command / Mentor / Legal / Goals / R&D (shell + long-tail)

| Card | What ships |
|---|---|
| **TAIL-1** | **Dashboard becomes per-tenant configurable widgets** rather than a fixed set; `dashboard.ts:137`'s inline role check goes through the permission engine (P1.4). |
| **TAIL-2** | **Mentor Council is tenant-scoped or dropped.** It's CEO-tier strategy data over a tenant's own business; either it becomes a real per-tenant feature or it stays tenant-zero-only and is excluded from every plan. Decide, don't drift. |
| **TAIL-3** | **Legal module** is the natural home for the tenant-facing half of P9 (DPA acceptance, AUP acknowledgement, sub-processor change notifications). |
| **TAIL-4** | **Registry/route reconciliation** (P7.2) resolves the long tail: `mentor`/`goals`/`rnd` have module keys and no nav; `/accounting`, `/tax`, `/people`, `/website` have nav and no keys. |

---

## Engineering conventions

Grounded in `docs/engineering/E2_BACKEND_SOP.md` and `docs/engineering/E2_FRONTEND_SOP.md`. Those docs are
FastAPI/Python and generic-Next.js respectively — **the principles carry, the file layouts
do not.** CBOP is Hono.js + Next.js 14 App Router, and the naming rules in `CLAUDE.md`
(kebab-case files, PascalCase components, snake_case domain-prefixed tables, plural
kebab-case REST routes) remain authoritative over anything in the SOPs.

**Layering (E2 backend §1).** The principle is a fixed request path with mechanically
checkable boundaries. CBOP's Hono equivalent: **route → service → data**, where
`api/routes/*.ts` parses and delegates, business logic lives in `api/lib/*.ts`, and SQL
lives in the data layer. Today most route files carry all three. Migrating wholesale is not
worth it; the rule going forward is that **any route file touched during Phase 4's migration
extracts its business logic** as it goes. One resource per module per layer; a file that
starts handling two resources gets split.

**Authorization as build-time discipline (E2 backend §8).**
§8.1 — every route has an *explicit* guard; an unguarded route is a reviewed decision, never
a default. §8.2 — object-level authorization is re-verified per call, never inherited from
an earlier check (P4.3). §8.3/§8.4 — response and request shapes exclude fields **by
construction**, not by remembering to strip them; this is what makes `WITH CHECK` in P3.2
the DB-level expression of the same rule. §7.2 — when the revocation/permission store is
unreachable, **fail closed**.

**Named constants (E2 backend §9.1).** Rate limits, quotas, thresholds and retention windows
are named constants referenced by routes, never inlined — an inlined limit cannot be audited
or changed in one place. Multi-tenancy adds a second axis: per tenant *and* per user.

**Logging (E2 backend §10).** Four layers: application, request/response with a request ID,
audit/security as its **own stream** (login attempts, 403s, 429s, admin actions), and infra.
Never log passwords/tokens/secrets, full bodies, raw query params, `Authorization`/`Cookie`
headers, or raw email addresses. Add `tenant_id` to every line (P5.9). JSON in production,
human-readable in development, never the reverse.

**Dependency tiering (E2 backend §3).** Three tiers: *required* (the app is not correct or
safe without it), *required-when-a-condition-applies*, and *optional-only-when-the-backing-
service-exists*. **Do not add a dependency with no wired consumer** — a package declared but
never imported misrepresents what the system does. Concretely for this plan: `zod` is
currently installed and unused (IF-10), which is the inverse failure and equally wrong —
either wire it at the API boundaries or remove it.

**Migrations (E2 backend §6, amended by C24).** The SOP's `downgrade()` requirement does not
map — `scripts/migrate.js` is forward-only, and that stays. What does carry: every migration
is reviewed line by line before being applied; a migration merged to a shared branch is
never edited after the fact (a mistake gets a new migration); no column is dropped without a
deprecation period; no direct `ALTER TABLE` against a running database in any environment;
no `SELECT *` in query code. Once tenants exist, expand/contract becomes mandatory (C24).

**Testing (E2 backend §12).** Three tiers — unit (no DB, no HTTP), integration (real
throwaway Postgres, **never a mocked database**), and **security** (authorization
boundaries, rate limits, tenant isolation). CBOP has essentially no test suite today; the
security tier is the one this plan actually requires, and P3.5's isolation suite is its
first member. Tests do not depend on execution order; each creates its own data.

**Frontend security as build-time discipline (E2 frontend §3).** `server-only` on data-access
modules; validate at every boundary and treat client-side validation as UX, never a security
control; strict CSP (internal tools render dynamically anyway, so the nonce-vs-static
tradeoff is a non-issue here); the full security-header set; never destructure `process.env`
or use dynamic keys. **Version currency is the single most important operational rule** —
the 2025–26 RSC "Flight" deserialization cluster (CVE-2025-55182/66478 at CVSS 10.0,
exploited in the wild, through the May 2026 13-advisory batch) is an ongoing supply-chain
surface specific to the App Router. Patch critical Next.js CVEs within 24–48h; keep
`react-server-dom-*` current; **never blanket auto-merge dependency PRs** (the March 2026
malicious-`axios` spread was accelerated by auto-merge).

**Design system.** `CLAUDE.md`'s tokens (Topbar `#232F3E`/48px, Sidebar `#16191F`/240px,
content `#F2F3F3`, cards, Syne/Inter/IBM Plex Mono, the four status colors) stay
authoritative. The frontend SOP's contribution is *where they live*: one token layer, base →
semantic → component variants, so a tenant-brandable theme later is a value swap rather than
a find-and-replace.

**Commits (E2 backend §14).** Conventional Commits 1.0.0, already the repo's habit.
`security/` branches require a review with security context specifically. From P9.8: PR +
one review + linked issue becomes mandatory, because it is simultaneously good practice and
the exact artifact SOC 2 CC8 samples.

---

## Open decisions for Bala

Consolidated from all four research docs. Each blocks something concrete; the blocked item
is named. **These cannot be decided from research** — that's why they're here rather than
resolved in prose above.

**Product shape**

1. **✅ ANSWERED 2026-08-05 (Bala): single-company by default, multi-company as a paid
   tier.** Ship the 1:1 tenant↔company case first (`tenants` wraps exactly one `companies`
   row by default); keep the schema capable of a tenant owning more than one company —
   which it already mostly is, via Bala's own 5-company setup — and gate multi-company as
   an upsell rather than a universal feature every customer's UI has to carry. **Implication
   for P2.1/P2.2 schema:** `tenants` is a real table above `companies`
   (`tenants.id`, `companies.tenant_id`), not a rename/absorption of `companies` itself —
   the 1:1 default and the paid multi-company case both fall out of the same FK, no schema
   fork needed. Original framing below, kept for the reasoning trail.

   ~~Does a customer tenant contain multiple companies?~~ CBOP's entire shape assumes a
   *group*. Most SMB customers are one company. If tenant→workspace is usually 1:1, the
   workspace switcher is dead UI for 90% of customers — but multi-company rollup is a
   genuine differentiator for holding groups and agencies. *Blocks: P2.1/P2.2 schema.*
   (ENTERPRISE §6.1, SECURITY §9.1)
2. **✅ ANSWERED 2026-08-05 (Bala): yes — one user can belong to multiple tenants**
   (e.g. an external accountant serving several separate customer businesses on one login).
   **Implication:** the org-switching surface is not internal-only — it's a real
   customer-facing feature and `user_companies`'s current shape (a user row with many
   company links) generalizes directly to `user_tenants`. P2.4–P2.6 keep full scope; do not
   simplify the switcher down to a team-only affordance. Original framing kept below.

   ~~Can one user belong to multiple tenants?~~ `user_companies` says yes. If real customers
   won't, the whole org-switching surface simplifies substantially and the switcher becomes
   an internal affordance. *Blocks: P2.4–P2.6 scope.* (UX §7.5.2)
3. **Do tenants pick apps, or packs?** P8.2 argues packs (Zoho's shape). If genuinely
   à-la-carte, the admin surface roughly triples and Atlassian's per-product complexity tax
   applies. *Blocks: P7.4 — the `/apps` page differs materially.* (UX §7.5.1)
4. **Self-serve signup, or sales-led provisioning?** P7.12 assumes self-serve. If every
   tenant is onboarded by hand, the onboarding route group becomes an internal provisioning
   tool and drops several priority slots. *Blocks: P7.12, P6.6.* (UX §7.5.4)
5. **Does `creator` keep cross-tenant visibility for support?** If "Bala needs to see
   customer data to help them" is a real requirement, it becomes **break-glass with logging**,
   not standing access — and it is far better to design the support workflow around that
   constraint now than to retrofit it during a SOC 2 readiness assessment. *Blocks: P2.3.*
   (SECURITY §9.6, UX §7.5.3)
6. **Is `accounting.*`'s subdomain "app inside an app" pattern the template for all future
   apps, or a one-off?** If it's the template, the app switcher must handle cross-origin
   navigation and the shared shell must become a published package. *Blocks: P7.1–P7.6
   scope, ACCT-6.* (UX §7.5.5)

**Architecture and money**

7. **n8n Embed License (~$50k/yr, keep the six workflows) or pg-boss (engineering time to
   port)?** Recommendation is pg-boss, but this is a money-vs-time call. *Blocks: P5.2, C3.*
   (ENTERPRISE §6.2)
8. **Self-hosted / on-prem tier?** Enterprise and regulated buyers ask. It changes
   *everything* — licensing, update cadence, support model — and it makes database-per-tenant
   the default rather than the exception. *Blocks: P2.1's `placement` semantics.*
   (ENTERPRISE §6.3)
9. **✅ ANSWERED 2026-08-05 (Bala): India-only for now.** Single region (e.g. `ap-south-1`),
   add EU/US residency only when a specific international deal actually requires it — not
   ahead of demand. **Implication:** `tenants.data_region` in P2.1 stays a real column
   (multi-tenant users per Decision 2 may still span regions later) but only one value is
   live at launch; no multi-region infra spend in Phase 5/9 until a deal forces it. Revisit
   alongside Open Decision 13 (which geographies to target first) once outbound sales starts
   actually happening. Original framing kept below.

   ~~Data residency commitments (EU / India / US)?~~ "International" plus GDPR means at
   minimum an EU region eventually. `tenants.data_region` is a placeholder in P2.1; whether
   it's real changes deployment topology. *Blocks: infra planning, P9.9's whitepaper claims.*
   (ENTERPRISE §6.4, SECURITY §2.2)
10. **Do end users share individual records across workspace boundaries?** This is the ReBAC
    trigger. If "yes, customers will share a deal with their external accountant," OpenFGA
    moves from later to now. *Blocks: P4's deferral.* (ENTERPRISE §6.5)
11. **Does Bala's 5-company setup become tenant #1 on the SaaS, or stay a separate
    deployment?** Tenant #1 is better dogfooding and worse blast radius. Recommendation:
    tenant #1 on the same deployment, **after** Phase 3 (RLS) is proven — not before.
    (ENTERPRISE §6.6)
12. **✅ ANSWERED 2026-08-05 (Bala): no — move to real cloud infra before onboarding
    paying customers.** The homeserver stays Bala's internal deployment (tenant zero can
    still dogfood there per Open Decision 11, post-Phase 3); paying-customer data goes on
    real infra with actual redundancy. **Implication:** migration/infra planning belongs in
    Gate 1, ahead of the tenancy rework proper, per the original framing below — this is now
    a scheduling input for Phase 9, not an open question. Provider/region choice still needs
    Open Decision 9 (data residency) resolved alongside it. Original framing kept for the
    reasoning trail.

    ~~Is the homeserver the production platform for paying customers?~~ If yes, the SLA
    cannot honestly promise 99.9% (~43 min/month on a single box with no redundancy) and the
    DDQ answers on redundancy will lose enterprise deals. If no, migration planning belongs
    in Gate 1 **before** the tenancy rework, not after. *Blocks: C12, P9.9's RTO/RPO.*
    (SECURITY §9.4)
13. **Which geographies are targeted first?** EU-first and US-first produce different Gate 2
    and Gate 3 orderings. *Blocks: P9 sequencing.* (SECURITY §9.5)

**⚖️ Get a real lawyer for** *(each of these is flagged in the research as explicitly beyond
engineering competence)*

14. **Is `resume-scorer.ts` a "solely automated" decision, and does it reach Annex III
    high-risk?** Close calls with a €20M band. Bring the actual prompt and the hiring UI
    flow — classification turns on operational specifics, not on the technology.
    (SECURITY §3.2) *Blocks: IF-1's scope, HIRE-2.*
15. **Does the hiring module ship to external customers at all?** If yes, EU AI Act
    high-risk *provider* obligations attach and it becomes the most expensive module in the
    product. Consider shipping it later, or EU-excluded. (SECURITY §9.3)
16. **Controller / processor / sub-processor characterisation for each data flow.** Getting
    this wrong invalidates the DPA. (SECURITY §2.6)
17. **SCC module selection and the Transfer Impact Assessment for EU→India.** India has no
    EU adequacy decision as of 2026. (SECURITY §2.6)
18. **Which corporate entity contracts with customers** — the Indian entity or a future
    US/EU entity? Drives governing law, tax, transfer mechanisms and which privacy regime is
    primary. **Lawyer + CA, needed early.** (SECURITY §9.2)
19. **Limitation of liability and the data-breach carve-out.** The single highest-consequence
    clause in the whole legal set, and where a startup can accidentally sign an unbounded,
    uninsurable obligation. Never template-generate it. (SECURITY §5.2)
20. **Erasure vs statutory retention** — the accounting module's no-hard-deletes rule against
    GDPR Art. 17. The resolution must be written into the privacy policy and DPA.
    (SECURITY §4.6.5) *Blocks: P9.7.*
21. **Does DPDP classify CBOP as Data Fiduciary or Data Processor under the Rules?**
    (SECURITY §2.6)
22. **Do CERT-In's 2022 Directions apply to CBOP's specific deployment topology?**
    (SECURITY §2.6)
23. **GST / export-of-services treatment in the ToS** (zero-rated export under LUT?).
    (SECURITY §5.2)

**Operational**

24. **Will any tenant upload special-category data (health, biometric)?** The AUP should
    prohibit it by default; if a customer needs it, that's a separate compliance tier and a
    separate price. (SECURITY §9.7)
25. **Budget and timeline.** Gate 1 is engineering time. Gate 2 is roughly $15k–$30k (lawyer
    + pen test + insurance). Gate 3 is $50k–$100k. Sequencing depends on which deals are
    real. (SECURITY §9.8)
26. **Accounting module's own four open questions** stay open and belong to Bala:
    non-INR currency, turnover near ₹5 crore (e-invoicing), upfront-deposit contracts
    (retainer invoices), and whether `{YEAR}` in invoice numbering is financial or calendar.
    (`ACCOUNTING_Build_Plan.md` open questions 1–4)

---

## Document map

| Doc | Role | Status under this plan |
|---|---|---|
| `CLAUDE.md` | Binding constraints | **Unchanged until Bala signs off** on the table above |
| `docs/SCALE_UP_TRACKER.md` | Research inbox | Workstreams 1–4 done, 5 informed by §10 here, 6 = this doc |
| `docs/research/CURRENT_STATE_AUDIT.md` | file:line index of every single-tenant assumption | The reference for "what has to change" — cited throughout |
| `docs/research/ENTERPRISE_ARCHITECTURE_RESEARCH.md` | Tenancy, authz, identity, infra decisions | Authoritative on architecture rationale |
| `docs/research/SECURITY_COMPLIANCE_RESEARCH.md` | Legal/security roadmap, 3 gates | Authoritative on compliance rationale |
| `docs/research/SAAS_UX_RESEARCH.md` | Shell, switching, onboarding, billing, admin IA | Authoritative on UX rationale (R-numbers) |
| `docs/modules/ACCOUNTING_Build_Plan.md` | Accounting rebuild | **In flight — absorbed, not superseded.** Its audit-log design is promoted platform-wide |
| `docs/modules/SEO_Build_Plan.md`, `docs/modules/SOCIAL_Build_Plan.md`, `docs/modules/HIRING_OVERHAUL_PLAN.md`, `docs/modules/EMAIL_STUDIO.md`, `docs/modules/WORK_MODULE.md` | Per-module internals | Authoritative inside their module; §10 adds the SaaS layer only |
| `docs/engineering/E2_BACKEND_SOP.md`, `docs/engineering/E2_FRONTEND_SOP.md` | Engineering discipline | Principles adopted (Engineering conventions §); literal Python/FastAPI layout not adopted |
| `docs/engineering/SECURITY_CHECKLIST.md` | Single-tenant security baseline | Still a prerequisite; nothing here replaces it |
| `docs/HANDOFF.md` | Session state | Overwritten at each session end per `CLAUDE.md` |

## First action

~~Answer Open Decision 1 (tenant unit) and Open Decision 12 (homeserver production).~~
**Both answered 2026-08-05** — see their entries above (single-company-default /
multi-company-paid-tier; move to real cloud infra before onboarding paying customers).
Next up: Open Decision 9 (data residency) now that infra is confirmed to be moving, since it
changes provider/region choice for that move, and Open Decision 2 (can one user belong to
multiple tenants) now that Decision 1 has settled the tenant/company relationship.

The **Immediate Fixes are unblocked and should ship** regardless of the remaining open
decisions: IF-2 (audit log writers) and IF-3 (the modules leak) first, because IF-2 is a
dependency of half the plan and IF-3 is the one live cross-tenant hole. *(Status: another
session/agent is already working these — check `docs/SCALE_UP_TRACKER.md` and the task list
for current ownership before starting one, to avoid duplicate work.)*
