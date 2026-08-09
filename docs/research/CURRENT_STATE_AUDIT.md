# CBOP — Current-State Multi-Tenancy Audit

Baseline: single-tenant internal ops platform, 3 fixed users (Bala/creator, Nabeelah/coo,
Guru/cto), 4-5 companies all owned by one person, one shared server, one shared set of
external-service credentials. This document inventories every place that assumption is
baked in, so a later design agent knows exactly what has to move.

Repo state note: CLAUDE.md/MASTER.md describe the *nominal* 3-role model, but the code has
already partially outgrown it — migration 057 built a DB-driven custom-role system
(`company_roles`, `role_module_access`, `user_invites`) that is **not yet wired into any
route**. That gap is itself one of the biggest findings below.

---

## BLOCKS LAUNCH ENTIRELY

### 1. Role model is a hardcoded 4-value union, enforced at 227 call sites
- `api/middleware/require-role.ts:3` — `export type Role = 'creator' | 'ceo' | 'coo' | 'cto'`. `requireRole(...allowedRoles: Role[])` (lines 12-28) type-checks against this literal union, so a 5th role or a per-tenant custom role slug (e.g. `sales_rep`) cannot even be passed to `requireRole()` without a TS error.
- `grep requireRole(` across `api/routes/*.ts` → **227 call sites in 24 files** (agents.ts, audit.ts, blog.ts, ceo.ts, clients.ts, deals.ts, departments.ts, email-campaigns.ts, email-studio.ts, employees.ts, finance.ts, goals.ts, hiring-batches.ts, hiring.ts, invoices.ts, leads.ts, legal.ts, mentor.ts, seo.ts, settings.ts, site-settings.ts, social.ts, subscribers.ts, tax.ts, templates.ts). Every one of these is `requireRole('ceo')` or `requireRole('ceo','coo','cto')` — literal strings, not module/permission lookups.
- `api/lib/modules.ts:14-33` — the `MODULES` registry still hardcodes `roles: ['ceo','coo','cto','creator']` per module as a **fallback**, duplicating the same 4-role assumption a second place.
- `app/components/sidebar.tsx:15` — `type Role = 'creator' | 'ceo' | 'coo' | 'cto'`; `castRole()` (line 83-85) force-casts any unrecognized role string to `'cto'`. A tenant-defined custom role (e.g. `sales_rep`) would silently get CTO's nav and CTO's page visibility in the sidebar — wrong and unsafe.
- **Migration 057 already built the fix** (`company_roles`, `role_module_access`, `user_invites`, `users.company_role_id`, and it *dropped* the `users.role` CHECK constraint) but `requireModule()` (`api/middleware/require-module.ts`) — the DB-driven replacement — is **used in zero actual routes** (`grep requireModule( api/routes/*.ts` → no hits). Per `docs/HANDOFF.md`: *"requireModule not wired to existing routes... existing requireRole guards still in place on all 230+ routes."* The dynamic RBAC system exists in the schema and in `api/routes/settings.ts:1000-1290` (role CRUD, module-access CRUD, invite flow) but has no runtime effect — every request is still gated by the hardcoded 4-role `requireRole()`.
- **Verdict:** this is the single biggest blocker. Even though the DB schema is ready for custom per-tenant roles, the entire enforcement layer (227 backend gates + the frontend sidebar/nav) still hardcodes exactly 4 role literals.

### 2. `creator` super-admin is a single hardcoded person, duplicated in 4+ places, and structurally cannot become "org owner sees only their org"
- `CLAUDE.md:115` and `migrations/032_creator_role.sql:9` — `UPDATE users SET role = 'creator' WHERE email = 'founders@cybercomctf.com'`. Creator is bound to one literal email, set only via a one-time migration, "not assignable through any UI."
- The "creator bypasses every gate and always sees every company" logic is copy-pasted in at least 4 independent places, each of which does `SELECT id FROM companies` (i.e. **every company in the entire database, across every future tenant**) when `role === 'creator'`:
  - `api/middleware/require-auth.ts:27-36`
  - `api/routes/mcp.ts:35-40` (`resolveCallerUser`)
  - `api/routes/session.ts:33-36`
  - `api/middleware/require-role.ts:20` / `api/middleware/require-module.ts:29-30` (bypass, not enumeration, but same "ignore tenant boundary" semantic)
- This is fundamentally incompatible with multi-tenant SaaS: in a real multi-tenant model, no single account should ever see every *other customer's* companies. Today's `creator` model literally requires that — it's not an oversight, it's how internal support/ops access was designed. This has to be redesigned as a platform-admin role that is explicitly *outside* any tenant's data boundary, not a role that unions in every row of `companies`.

### 3. `companies` table is "one of 5 divisions of one tenant," not "the tenant boundary"
- `migrations/001_initial_schema.sql:24-35` — `companies` has no `tenant_id`, no `organization_id`, no owning-account concept at all. It has `owner_id UUID REFERENCES users(id)` (single user, informational only — not used for access control anywhere in the code I found).
- There is **no table above `companies`** in any of the 58 migrations. `users` and `companies` are siblings joined only by `user_companies` (`001_initial_schema.sql:38-44`). Any user can, in principle, be granted access to any company row via `user_companies`, and `creator` is granted access to *all* company rows unconditionally. There is no schema-level wall that prevents "Client Org A's admin" from ever being linked, accidentally or maliciously, to "Client Org B's" company row — because nothing distinguishes "companies belonging to tenant A" from "companies belonging to tenant B." Today it doesn't matter because all 4-5 companies belong to the same real-world owner; for external SaaS clients this is the core gap. `companies` currently *is* what a tenant's "workspace/division" would be — a tenant boundary needs to be added as a new table that owns one-or-more `companies` rows and one-or-more `users` rows, with `user_companies` and `creator`-style bypass both scoped inside it.

### 4. Auth (`api/lib/auth.ts`) has zero notion of multiple independent organizations
- `api/lib/auth.ts:23-97` — plain `betterAuth()` config: `emailAndPassword` + a `magicLink` plugin. No `organization` plugin, no multi-tenant plugin, no per-tenant session claims. better-auth does ship an official `organization` plugin that supports exactly this use case — it is not used here.
- `magicLink({ disableSignUp: true, ... })` (line 47-49) — sign-up is explicitly disabled. Matches `docs/MASTER.md` §7: *"No sign-up page. Accounts created manually in Settings by CEO only."* Confirmed: `find app -iname "*signup*" -o -iname "*register*"` → nothing exists except `app/(auth)/login` and `app/(auth)/forgot-password`.
- `requireAuth` (`api/middleware/require-auth.ts:6-19`) resolves the CBOP user purely by `session.user.email` against a single global `users` table — there is no tenant discriminator in the session, the JWT, or the lookup query. Two different client organizations cannot both have a user named `admin@theirdomain.com` mapped independently; the whole `users` table is one flat global pool.
- **Verdict:** self-service or admin-provisioned tenant signup does not exist at any layer — DB, auth config, or UI. This has to be built from scratch, not adapted.

### 5. Hardcoded person/company identifiers baked directly into route code
- `founders@cybercomctf.com` (Bala's personal email) hardcoded as:
  - The `creator` role target — `migrations/032_creator_role.sql:9`
  - The default/transactional SMTP sender — `.env` / `.env.example`: `SMTP_USER=founders@cybercomctf.com`, and `api/lib/mailer.ts:42` (`DOMAIN_FALLBACK['cybercomctf.com'].from_email`)
  - Hiring inbox — `docs/modules/BATCH_INTERVIEW_SPEC.md:190`
- Telegram ID `6316112708` (Bala's personal Telegram) hardcoded as a module-level constant in two unrelated route files, each with its own copy:
  - `api/routes/documents.ts:17` — `const ALERT_TELEGRAM_ID = '6316112708'`, used at `documents.ts:799` to page one specific human whenever *any* company's document batch finishes.
  - `api/routes/email-campaigns.ts:13` — same constant, same value, used at lines 270 and 291 to alert on campaign auto-pause/bounce-rate events for *any* company.
  - There is no per-tenant "who gets ops alerts" concept anywhere — it's one phone number, wired at the source-code level, for every company that will ever exist in the system.
- `api/routes/mcp.ts:22-43` (`resolveCallerUser`) resolves *every* MCP tool caller by `users.telegram_chat_id` against the single global Telegram bot (Nila_V1_bot per CLAUDE.md). There is one bot for the whole platform; a second tenant's Telegram users cannot be distinguished except by being manually added to the same global `users` table with their own chat ID — there's no per-tenant bot, no per-tenant bot token, no tenant-scoped webhook.
- 5 company UUIDs are literal string constants, duplicated verbatim in 3 files (not derived from the DB at those call sites' cold-start path):
  - `migrations/001_initial_schema.sql:385-388` (seed data — expected)
  - `api/lib/company-brand.ts:36-40` (`SEED` cold-start fallback map, comment at lines 14-15 explicitly says this replaced code that used to be hardcoded and "worse" — it's now only a cache-miss fallback, but the 4 UUIDs are still typed into source)
  - `migrations/051_company_lifecycle.sql:20-39` (per-company `email_branding` backfill keyed by literal UUID)
  - These are lower severity than the ones above (they degrade gracefully to a generic default), but confirm the "5 known companies" habit runs through the codebase, not just the seed migration.

### 6. Every external-service credential is a single shared secret/account for the whole platform, not per-tenant
- `OPENCLAW_API_KEY` (`api/lib/openclaw.ts:22`) — one bearer token authenticates *all* outbound Telegram/WhatsApp/Discord/agent traffic for every company in the system. No per-company or per-tenant OpenClaw credential.
- `N8N_WEBHOOK_SECRET` — one shared header secret, checked in **6 files / 14 call sites**: `api/routes/webhooks.ts` (`hasValidSecret`, lines 7-12), `api/routes/settings.ts`, `api/routes/leads.ts`, `api/routes/mcp.ts:88` (`fireN8nWebhook`), `api/routes/internal.ts:88,173,236,366,491` (5 of the 14), `api/routes/hiring.ts`. A single leaked value grants webhook-trigger authority across every tenant's automations at once.
- `CBOP_MCP_TOKEN` (`api/routes/mcp.ts:12`) — one token authenticates every MCP tool call from Hermes/OpenClaw for the whole platform; per-tool authorization is then done purely by the `caller_telegram_id → users.role/companyIds` mapping (correct row-level scoping) but the *transport* credential itself is global, not tenant-scoped.
- SMTP is explicitly one Google Workspace mailbox **per company, hardcoded by name** — not data-driven:
  - `.env.example` — `SMTP_USER_CYBERCOM` / `SMTP_PASS_CYBERCOM`, `SMTP_USER_OUANTUM`/`SMTP_OUANTUM_USER` (inconsistent naming itself, see below), `SMTP_USER_ETHERENCE`, `SMTP_USER_ATTACKOS`, `SMTP_ZAPSTERS_USER` — 5 companies, 5 named env-var pairs.
  - `api/lib/mailer.ts:41-47` (`DOMAIN_FALLBACK`) hardcodes the domain → `smtp_env` string mapping for the same 5 companies.
  - `api/routes/internal.ts:24-30` (`getHiringInboxes()`) hardcodes the exact same 5 `process.env.SMTP_*` pairs a second, independent time, to read hiring-inbox IMAP mail. **Onboarding a 6th tenant/company today requires editing source code in two files** (`mailer.ts` and `internal.ts`) plus adding new named env vars — there is no way to add a company's mail account through the DB alone, even though `email_domains` (migration 014/029) already stores `domain`/`smtp_env`/`company_id` and is consulted first as the source of truth. The `smtp_env` *value* stored in the DB is itself just a lookup key back into these hardcoded env-var names, so the DB layer doesn't actually remove the hardcoding, it just adds an indirection on top of it.
  - AWS S3 backup credentials (`AWS_ACCESS_KEY_ID`/`AWS_SECRET_ACCESS_KEY`/`S3_BUCKET_NAME`) are a single shared account/bucket for the whole platform (by design, for a single self-hosted backup — fine for now, but would need per-tenant bucket/prefix separation, or at minimum per-tenant data segregation within the bucket, for a real SaaS backup/restore story).
  - Google OAuth (Search Console/GA4), PageSpeed API key, LinkedIn OAuth — all single app-level credentials shared by every company's SEO/social connections (`.env.example` bottom section). Each company's *connected account* is presumably per-company (stored in `seo_site_connections`/`social_connections` tables — not fully audited here), but the OAuth *app* itself is one registration for the whole platform, which is normal for a SaaS app (one app, many customer connections) and not itself a blocker — flagged here only so the design agent knows it's shared infrastructure, not per-tenant.

---

## NEEDS REWORK BUT NOT URGENT

### 7. `company_id` scoping pattern is *mechanically* reusable, but conflates two different boundaries today
- The `WHERE company_id = ANY($1)` pattern (`c.get('companyIds')`) appears consistently across virtually every route file and is exactly the shape you want for row-level tenant scoping — this part is good, not a rewrite.
- However, `companyIds` today means "the 1-5 companies this specific person happens to have `user_companies` rows for, drawn from one global company list" — not "every company inside my tenant, and only my tenant." Because there's no tenant table (see item 3), this scoping *happens* to work for internal use (Bala/Nabeelah/Guru only ever touch 4 companies that are all "his") but provides no isolation guarantee between two unrelated future customers who are each given, say, 2 companies. Nothing in the current schema/queries prevents a bug (or an admin mistake in Settings → Users) from granting a client-tenant-B user a `user_companies` row into client-tenant-A's company. A tenant_id column + a `WHERE tenant_id = $1 AND company_id = ANY($2)` (or simply scoping `companies` itself by `tenant_id` and JOINing) closes this cleanly, and the existing `company_id` filters in every route barely have to change (just add the extra join/param) — so this is "needs an added guard rail," not "needs a rewrite."

### 8. Shared-users-across-companies assumption
- `docs/MASTER.md` §6 access matrix and `CLAUDE.md` role model both assume the *same 3 people* touch all 4-5 companies (COO/CEO see "all 4", CTO sees "Etherence IT only" per MASTER.md's older spec, superseded by CLAUDE.md's "coo/cto both get all companies they're assigned"). Nowhere in the code is there a notion of "user U belongs only to tenant T and can never even be offered a company outside T" — `api/routes/settings.ts` company/user management endpoints (`requireRole('ceo')`-gated) let any CEO-role/creator account attach any user to any company in the whole `companies` table (no tenant filter on the company-picker or the `user_companies` INSERT). For internal use this was never a problem (there's one owner). For multi-tenant SaaS, the Settings UI and its backend routes need to filter the "assignable companies" list down to the caller's own tenant.

### 9. `app/components/sidebar.tsx` / `app/lib/company-context.tsx` — UI assumes one small fixed company set, one flat role, no per-tenant module/plan gating
- `app/lib/company-context.tsx:4-8` (`Company` interface) has no `enabledModules`, no `plan`, no `tenantId` — `CompanyProvider` (lines 22-46) just holds a flat array of `{id,name,invoice_prefix}` and persists the "active company" in `localStorage`. Works fine for "pick 1 of my 4-5 companies," would need real work for "user belongs to N unrelated client orgs, each with its own module set and billing plan" — there's no concept of *which modules this specific company has enabled* reaching the sidebar at all (`enabledModules`/`allowedModules`, which the backend already computes per-request in `require-auth.ts:38-87`, are never passed down to `CompanyProvider`/`Sidebar` — the sidebar's `NAV_GROUPS` visibility is driven purely by the hardcoded `Role` literal, item #1 above, not by the DB-driven module list that already exists server-side).
- `app/components/sidebar.tsx:30-81` (`NAV_GROUPS`) is a static, compiled-in list of every page in the product — there is no per-company/per-tenant "which modules do you have" filtering at all in the frontend, even though the backend (`company_modules` table, migration 055) already supports disabling modules per company. Per `docs/HANDOFF.md`: *"requireModule not wired to existing routes"* — same gap on the frontend: the sidebar never reads `enabledModules`, so a company with `campaigns` disabled in `company_modules` would still show "Campaigns" in the nav and only get a 403 on click, rather than the item being hidden.
- No billing-plan concept anywhere in the schema or the frontend (no `plan`, `subscription`, `seats`, `billing_status` on `companies` or on any new tenant-level table) — expected, since this was never a paid product, but flagging since "different module set and billing plan per client org" is explicitly part of the target model.

### 10. Duplicate/copy-pasted "is this person CEO or creator" checks instead of one shared helper
- The pattern `role === 'ceo' || role === 'creator'` (or `['ceo','coo','cto','creator'].includes(role)`) is inlined ad hoc rather than centralized:
  - `api/routes/mcp.ts:650-651` (`isCeo`, `isSales` computed per-call inside `executeTool`)
  - `api/routes/dashboard.ts:137`
  - `api/middleware/require-role.ts:20`, `api/middleware/require-module.ts:29-30`
  - Not a blocker, but every one of these is a second place that will need to change in lockstep with item #1 (the Role type) — worth having the redesign consolidate into one `isPlatformAdmin(role)` / permission-check helper rather than N inline literal comparisons.

### 11. `sales_deals.service_type` is a hardcoded, non-tenant-configurable enum
- `migrations/001_initial_schema.sql:102` — `CHECK (service_type IN ('cybersecurity_event','penetration_test','it_consulting','game_development','other'))`. These are Etherence's specific service lines. A new client-tenant selling something else (e.g. "managed IT support," "graphic design") has no path to add their own service types without a migration editing this CHECK constraint. Same for `ops_task_templates.service_type` (`001_initial_schema.sql:198-206`, used for SOP-based task creation) which is a free-text column joined against the CHECK-constrained one by convention, not FK. Not urgent (a single default `'other'` unblocks any tenant immediately) but will annoy every new client's onboarding until this becomes a per-tenant configurable list.

### 12. Invoice number prefixing is company-scoped correctly, but company creation still requires manual CEO action per new tenant
- `invoice_prefix` (unique per company, `migrations/001_initial_schema.sql:27`, enforced in `api/routes/settings.ts:242-245,296-315`) is genuinely tenant-agnostic and reusable — good design, no change needed.
- However, onboarding a new company today is a single `POST /api/settings/companies` call gated by `requireRole('ceo')` (`api/routes/settings.ts:234`) with no accompanying "provision a new tenant" workflow — no automatic creation of a default `company_roles` set (migration 057's seed step, §7 in that file, only ran once for *pre-existing* companies at migration time — a company created afterward via the API gets no seeded `company_roles`/`role_module_access` rows unless that logic was added to the route, which I did not find evidence of in the `POST /api/settings/companies` handler at `settings.ts:234-269`), no default `company_modules` rows besides what's noted in the migration comment (*"New companies created after this migration must be backfilled by the POST /api/settings/companies route"* — `migrations/055_company_modules.sql` header comment — need to verify that backfill actually happens in the route; not shown in the 100 lines read). This is a correctness gap worth flagging for the redesign even though it's not fatal today (single-owner use never creates companies dynamically in practice).

---

## ALREADY FINE / REUSABLE AS-IS (good news)

- **Row-level `company_id` scoping mechanics** — the `WHERE company_id = ANY($1)` pattern, powered by `c.get('companyIds')`, is applied consistently across essentially every route file. This is the right shape for tenant-scoped queries; it just needs the addition of a tenant boundary above `companies` (item #3) rather than a rewrite of the query pattern itself.
- **`company_roles` / `role_module_access` / `user_invites` schema (migration 057)** — this is already a fully-formed, per-company custom-role system: arbitrary role slugs, per-role module read/write permissions, an invite flow with temp passwords. It is not wired into route enforcement yet (item #1), but the *data model* for "per-tenant custom roles" already exists and doesn't need to be redesigned, only actually used.
- **`company_modules` (migration 055) + `requireModule()` middleware** — a working per-company module-enable/disable system already exists in the schema and as a ready-to-use middleware (`api/middleware/require-module.ts`). It just needs to actually replace the 227 `requireRole()` call sites (item #1) and be read by the frontend sidebar (item #9).
- **`email_branding` / `logo_initials` / `company-brand.ts`** — already fully data-driven per company (migration 051 explicitly replaced hardcoded per-company branding constants that used to be duplicated in `hiring.ts`/`hiring-batches.ts`). New companies just need a DB row; no code changes required for branding.
- **`invoice_prefix` uniqueness + generation** (`api/routes/mcp.ts:67-77`, `settings.ts`) — cleanly per-company, race-condition-safe (pg_advisory_xact_lock per HANDOFF.md), no rework needed.
- **`email_domains` table (migrations 014, 029)** — already models domain → company_id → smtp routing as data, and `companyIdForDomain()`/`sendEmail()` in `api/lib/mailer.ts` consult it first before falling back to hardcoded maps. The *remaining* hardcoding (item #6) is specifically the SMTP env-var *names* (`SMTP_USER_CYBERCOM` etc.), not the domain-routing logic itself — a secrets-manager-backed per-tenant credential store would slot in without touching the domain-routing code.
- **Better-auth core session/cookie mechanics** (7-day httpOnly session cookie, `api/lib/auth.ts:26-35`) are vanilla and provider-agnostic — swapping in the `organization` plugin or adding a tenant claim to the session does not require ripping out better-auth itself.
- **`user_companies` join table** is exactly the right primitive for "one user can belong to several companies" and needs no structural change — it only needs those companies to be scoped inside a tenant boundary (item #3).

---

## Summary of files that will need to change (quick index)

| File | What's hardcoded |
|---|---|
| `api/middleware/require-role.ts:3,12-28` | `Role` union type, 4-literal role gate |
| `api/lib/modules.ts:14-33` | Role→module fallback map |
| `api/middleware/require-auth.ts:27-36,64-87` | creator "all companies" union, role→allowedModules fallback |
| `api/routes/mcp.ts:22-43,650-651` | creator "all companies," `isCeo`/`isSales` literal role checks |
| `api/routes/session.ts:33-36` | creator "all companies" |
| `api/routes/dashboard.ts:137` | literal role check |
| `app/components/sidebar.tsx:15,30-92` | `Role` union, static `NAV_GROUPS`, `castRole()` fallback |
| `app/lib/company-context.tsx:4-8` | `Company` type missing tenant/modules/plan |
| `migrations/032_creator_role.sql:9` | hardcoded creator email |
| `migrations/001_initial_schema.sql:14-20,102` | `users.role` origin CHECK (now dropped by 057), `service_type` CHECK |
| `api/routes/documents.ts:17,799` / `api/routes/email-campaigns.ts:13,270,291` | hardcoded Telegram ID |
| `api/lib/mailer.ts:41-47` / `api/routes/internal.ts:24-30` | hardcoded per-company SMTP env-var names, duplicated |
| `api/lib/company-brand.ts:36-40` | hardcoded company UUID seed map |
| `api/lib/openclaw.ts:21-22` | single global `OPENCLAW_API_KEY` |
| `api/routes/webhooks.ts:7-12` + 5 other files | single global `N8N_WEBHOOK_SECRET` |
| `api/routes/mcp.ts:12` | single global `CBOP_MCP_TOKEN` |
| `api/lib/auth.ts` (whole file) | no organization plugin, no tenant claim, sign-up disabled |
| *(missing entirely)* | no tenant/organization table above `companies` |
