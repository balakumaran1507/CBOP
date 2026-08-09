# CBOP → Multi-Tenant SaaS: Enterprise Architecture Research

Workstream #1 of `docs/SCALE_UP_TRACKER.md`. Feeds `docs/Project-Scale-Up-Plan.md`.
**This is a decision document, not a survey.** Every section ends with a
recommendation and a reason. Bala makes the final call; this doc's job is to
make the call cheap to make and expensive to get wrong by accident.

Research date: 2026-08-05. Sources are listed at the bottom and cited inline.
Codebase claims were verified against the working tree, not assumed.

---

## TL;DR — the seven decisions

| # | Decision | Recommendation | Confidence |
|---|---|---|---|
| 1 | **Data isolation** | **Shared schema + `tenant_id` on every table + vanilla Postgres RLS as a fail-closed second layer.** Keep a `database-per-tenant` escape hatch for the 1–3 enterprise/regulated logos that will demand it, behind a `tenants.placement` column decided on day one. | High |
| 2 | **RLS vs CLAUDE.md** | CLAUDE.md bans **Supabase RLS**, not **Postgres RLS**. These are different things — one is a vendor platform, the other is a core Postgres feature since 9.5. Adopt Postgres RLS. Amend the constraint wording so nobody re-litigates this every session. | High |
| 3 | **Authorization model** | **Tenant-scoped RBAC with permission bundles and role templates** (the WorkOS "hybrid" pattern), built on the `company_roles` / `role_module_access` tables migration 057 already created. Add a thin ABAC scope layer (`role_scopes`) for "only their own records / only their team". **Do not adopt OpenFGA/Zanzibar now** — define the explicit trigger that would make us adopt it later. | High |
| 4 | **Object hierarchy** | `tenant` (billing + identity boundary) → `workspace` (today's `companies`) → `team` → `member`. Three levels, not four. Rename nothing yet; introduce `tenants` above `companies` and backfill one tenant. | High |
| 5 | **Enterprise auth** | better-auth is MIT and already ships `organization`, `@better-auth/sso` (SAML 2.0 + OIDC), and `@better-auth/scim` — **no auth vendor migration is required.** SAML+OIDC SSO and audit logs are table stakes; SCIM is second-wave; per-tenant custom domains are third-wave. | High |
| 6 | **Background jobs** | **The n8n-only constraint breaks — on licensing grounds before technical ones.** n8n's Sustainable Use License forbids hosting/embedding it as the automation backend of a paid customer-facing product. Replace with **pg-boss** (Postgres-native queue, no Redis, satisfies the "no Redis/Bull" constraint's actual intent) and keep n8n for internal-only ops. | High |
| 7 | **Infra** | Single box → app tier behind PgBouncer in **transaction mode**, Postgres separated onto its own host with read replica, Caddy or NPM+Caddy for per-tenant TLS, object storage instead of Nextcloud for tenant files. Puppeteer moves to a dedicated worker pool. | Medium-High |

**The single highest-risk item:** 252 `requireRole(...)` occurrences across 25 route
files, and **zero** of them are tenant-aware in the sense a SaaS needs. They check
"what role is this person" but the tenant boundary is enforced only by a hand-written
`WHERE company_id = ANY($1)` in each query. One forgotten `WHERE` clause in one route
is a cross-customer data breach. That is survivable at 3 users who all own all the
data. It is not survivable when the data belongs to other companies. **RLS exists to
make that forgotten `WHERE` clause return zero rows instead of someone else's payroll.**

---

## 0. Current-state ground truth (verified against the tree, 2026-08-05)

Read before believing any plan below. These are facts, not impressions.

**What already exists and helps:**

- **Migration `057_dynamic_roles.sql` already did the hard part of step one.** It
  created `company_roles(id, company_id, name, slug, is_system, ...)` with
  `UNIQUE(company_id, slug)`, `role_module_access(role_id, module_key, can_read,
  can_write)`, `user_invites`, and `users.company_role_id`. It also **dropped the
  `users_role_check` CHECK constraint**, so arbitrary role slugs are already legal.
  This is, structurally, tenant-scoped RBAC — it just isn't wired up yet.
- **Migration `055_company_modules.sql`** gives per-company module toggles — i.e. a
  primitive entitlement/plan system already exists. That is exactly what a SaaS needs
  for plan tiers; it needs promoting from "toggle" to "entitlement derived from
  subscription", not rebuilding.
- **`api/middleware/require-module.ts`** implements the correct two-stage check
  (role permission ∧ company entitlement).
- **`api/lib/modules.ts`** defines 18 module keys — a ready-made permission-bundle
  vocabulary (`finance`, `sales`, `hiring`, `work`, `seo`, `legal`, …).
- `user_companies` is already a real many-to-many membership table.

**What blocks multi-tenancy today:**

- **`requireModule` is used in exactly zero route files.** Every route still uses
  `requireRole`. Count: **252 `requireRole` occurrences across 25 of 37 route files**
  (each file carries one import line, so ≈227 real gate call sites). The dynamic-role
  system is built but not adopted — the flat model is still what's actually enforced.
- **There is no tenant.** `companies` *is* the top-level object. There is no row in the
  database that says "these 5 companies belong to Bala and those 3 belong to Acme Ltd."
  Every `company_id` is currently in one implicit global namespace.
- **`creator` bypasses everything, globally.** `require-role.ts:20` and
  `require-module.ts:30` both hard-return `next()` for `creator`. In a single-tenant
  tool that's "the owner". In a SaaS that's "one compromised account reads every
  customer's finances". `creator` must become tenant-scoped, with a separate,
  audited, break-glass `platform_admin`.
- **`requireAuth` runs `SELECT id FROM companies` with no WHERE on every single
  request for `creator`** (`require-auth.ts:31`). At 5 companies that's free. At 5,000
  it is a full table scan per request, and it also returns *other tenants' companies*.
  This is simultaneously a performance bug and a data-isolation bug waiting to happen.
- **`requireAuth` issues up to 3 sequential queries per request** (user+companies,
  `company_modules`, `role_module_access`) with no caching. Fine at 3 users; at
  thousands of concurrent sessions this is the first thing that falls over.
- **Isolation is by convention only.** 32 of 37 route files reference `companyIds`;
  5 do not. There is no database-level guarantee that a query is scoped.
- **`api/lib/db.ts`** is a single `Pool` with `max: 20`, no tenant context, no
  `SET LOCAL`, no statement timeout.
- **`api/lib/auth.ts`** hardcodes `trustedOrigins` including `cbop.etherence.com`, and
  `baseURL` from a single `NEXT_PUBLIC_APP_URL`. Per-tenant domains break this.
- **Hardcoded single-tenant values in business logic**: `ALERT_TELEGRAM_ID =
  '6316112708'` in `api/routes/documents.ts:17` and `api/routes/email-campaigns.ts:13`;
  `team_lead_email: 'nabeelah@etherence.com'` in `api/routes/templates.ts:150`; the
  domain→SMTP map in `api/lib/mailer.ts:42-45`. (Full sweep is workstream #4's job —
  these are just the ones encountered while reading auth.)

**Engineering discipline to carry forward** (from `docs/engineering/E2_BACKEND_SOP.md`, adopted
in principle even though it's a FastAPI doc): §8.1 — every route has an *explicit*
guard, and an unguarded route is a reviewed decision, never a default. §8.2 — object-
level authorization is re-verified per call, never inherited from an earlier check.
§8.3/8.4 — response and request schemas exclude fields by construction, not by
remembering to strip them. §7.2 — when the revocation store is unreachable, **fail
closed**. Every recommendation below is consistent with those five rules; where a
recommendation exists *because* of one of them, it says so.

---

## 1. Data isolation

### 1.1 The four models, with Postgres-specific numbers

| Model | Isolation | Ops cost | Migration cost | Realistic tenant ceiling | Cross-tenant analytics |
|---|---|---|---|---|---|
| **Shared schema + `tenant_id`** | Logical (app-enforced) | Lowest — one DB, one schema | One migration, all tenants | Many thousands | Trivial |
| **Shared schema + `tenant_id` + RLS** | Logical, DB-enforced | Lowest + policy maintenance | One migration | Many thousands | Trivial (needs `BYPASSRLS` role) |
| **Schema-per-tenant** | Stronger logical | Medium | ×N per deploy | **A few hundred** | Awkward cross-schema joins |
| **Database-per-tenant** | Physical | High | ×N, plus N backup/monitor/upgrade tracks | **A few hundred** | Impossible in-engine |

The two hard numbers that decide this:

- PlanetScale's 2025 write-up states schema-per-tenant and database-per-tenant "likely
  won't scale beyond a few hundred tenants", while shared-schema "scales easily to many
  thousands of tenants". Schema-per-tenant dies of **catalog bloat** — hundreds of
  schemas × dozens of tables each means `pg_class`/`pg_attribute`/`pg_depend` grow to
  where the planner consults a slow catalog on *every* query. Database-per-tenant dies
  of **connections** (each PgBouncer pool is per-database; N pools blow past
  `max_connections`) and of `CREATE DATABASE` copying the template at ~8 MB a pop.
- The 2026 consensus across the sources surveyed is the same: shared schema is the
  default, database-per-tenant is for regulated/white-label, hybrid is what mature
  products actually run.

**"Super OS for international SMB/enterprise" means both ends of that range at once**
— hundreds or thousands of small tenants, plus a handful of large ones who will put
"dedicated database instance" in the contract. That is precisely the case the hybrid
(AWS calls it pool / silo / bridge) exists for.

### 1.2 The RLS clarification — this matters and is being confused

`CLAUDE.md` says: *"Postgres + better-auth only. No Supabase. No Redis. No Bull.js.
**No Supabase RLS.**"*

**"Supabase RLS" and "Postgres RLS" are not the same thing, and the constraint only
bans the first.**

- **Postgres RLS** is a core PostgreSQL feature, present since **9.5**, part of the
  server the project already runs. It is `ALTER TABLE … ENABLE ROW LEVEL SECURITY` +
  `CREATE POLICY`. It requires **no extension** — which keeps CLAUDE.md's "plain Docker
  container, no extensions required" promise intact.
- **"Supabase RLS"** is a *pattern*, not a feature: Supabase exposes Postgres directly
  to the browser via PostgREST and uses RLS policies keyed on `auth.uid()` from a
  Supabase-issued JWT as the *only* authorization layer. That is what CLAUDE.md is
  rejecting — and rightly: CLAUDE.md's own auth section says "No Supabase. No
  PostgREST. No `auth.uid()`. Authorization is explicit middleware on every route."

We are keeping all of that. **Hono middleware remains the authorization layer.** RLS is
added *underneath* it as a fail-closed backstop, not as a replacement. No browser ever
talks to Postgres. No `auth.uid()`. No PostgREST.

**Recommended CLAUDE.md wording:** *"No Supabase, no PostgREST, no browser-to-database
access. Authorization decisions are made in Hono middleware. Postgres row-level
security is enabled on every tenant-scoped table as a mandatory second layer — never as
the primary authorization mechanism."*

### 1.3 How RLS actually gets wired in (the parts that bite)

This is where implementations get it wrong, so it is spelled out.

**(a) The app must not connect as the table owner.** By default the table owner bypasses
RLS entirely. Two options, use both:

```sql
ALTER TABLE sales_invoices ENABLE ROW LEVEL SECURITY;
ALTER TABLE sales_invoices FORCE  ROW LEVEL SECURITY;  -- owner is subject to policies too
```

…and create a dedicated non-superuser, non-`BYPASSRLS` role for the application
(`cbop_app`), separate from the migration/owner role (`cbop_migrator`) and from a
deliberate analytics role that *does* hold `BYPASSRLS` for cross-tenant reporting.
Superusers and `BYPASSRLS` roles always skip policies — so the app role must be neither.

**(b) Tenant context is set with `SET LOCAL`, never `SET`.** This is the single most
important line in this document. Under PgBouncer in transaction mode — which is the
mode a multi-tenant SaaS needs — a backend connection is handed to a different client
after each transaction. A session-scoped `SET app.tenant_id` **persists onto the next
tenant's request.** `SET LOCAL` (equivalently `set_config('app.tenant_id', $1, true)`
with the third argument `true`) is transaction-scoped and rolls off automatically.
Passing `false` there under transaction pooling is a documented cross-tenant leak.

So `api/lib/db.ts` needs a tenant-aware wrapper, and the raw `query()` export needs to
stop being the default path:

```ts
// api/lib/db.ts — sketch
export async function withTenant<T>(
  tenantId: string,
  fn: (client: PoolClient) => Promise<T>
): Promise<T> {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    await client.query('SELECT set_config($1, $2, true)', ['app.tenant_id', tenantId])
    //                                            ^^^^ true = transaction-scoped. NEVER false.
    const out = await fn(client)
    await client.query('COMMIT')
    return out
  } catch (e) {
    await client.query('ROLLBACK'); throw e
  } finally { client.release() }
}
```

And the policy — note the `NULLIF`, which makes an *unset* context deny everything
rather than error or match:

```sql
CREATE POLICY tenant_isolation ON sales_invoices
  USING      (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
```

`USING` filters reads; `WITH CHECK` stops a tenant from *writing* a row stamped with
someone else's `tenant_id`. Both are needed — `USING` alone leaves an insert-side hole.
This is the DB-level expression of E2 SOP §8.4 (mass assignment): the client cannot set
`tenant_id` even if the handler forgets to strip it.

**(c) Performance is not the reason to avoid this.** A published PostgreSQL 16 benchmark
across 10M rows / 500 tenants measured RLS overhead at **+2.3% to +5.9%** depending on
query shape. The real caveats from the Postgres docs are correctness ones, not speed:
non-`leakproof` functions may be evaluated after the row-security check (so don't build
policies that depend on ordering), permissive policies combine with `OR` while
restrictive combine with `AND`, and referential-integrity checks always bypass RLS —
meaning an FK error message can itself be a covert channel confirming a row exists in
another tenant. Keep FKs tenant-local and it's a non-issue.

**(d) Nothing about RLS removes the `WHERE tenant_id = $1` from queries.** Keep writing
them — RLS is the seatbelt, not the steering wheel. It exists so that the day someone
ships a route without the filter, the blast radius is "empty page" instead of
"regulatory incident".

### 1.4 Recommendation

**Adopt shared-schema + `tenant_id` + Postgres RLS. Design for the silo escape hatch on
day one; don't build it until a contract pays for it.**

Concretely:

1. Add `tenants` above `companies`. Every existing tenant-scoped table gets a
   `tenant_id UUID NOT NULL` — denormalized deliberately, even where it's derivable via
   `company_id`, so RLS policies are one predicate on one indexed column and never a
   join. Composite indexes lead with `tenant_id`.
2. `tenants.placement TEXT NOT NULL DEFAULT 'pool'` with `CHECK (placement IN
   ('pool','silo'))`, plus `tenants.db_dsn_ref TEXT` (a *reference to* an env key, never
   a DSN in the DB — CLAUDE.md's no-secrets-in-DB rule holds). Nothing reads `silo`
   until a deal requires it; having the column from the start is what makes adding it
   later a routing change rather than a schema migration across 60 tables.
3. RLS on every tenant-scoped table, `FORCE`d, with a dedicated app role.
4. **A CI test that fails the build if any table with a `tenant_id` column lacks
   `relrowsecurity`.** Policy without enforcement is decoration. Query
   `pg_class.relrowsecurity` / `pg_policies` and assert coverage.
5. When a single table gets hot (`ops_tasks`, `email_send_log`, audit rows),
   **partition by `tenant_id` hash or list** before considering anything more exotic.
   Partitioning is native Postgres — still no extension.
6. **Citus only as a documented later option, not a plan.** It is a genuine open-source
   Postgres extension (distribution column = `tenant_id`, or schema-based sharding since
   Citus 12) and is the natural next step *if* single-node write throughput becomes the
   binding constraint. That is a "tens of thousands of tenants" problem. Note it, don't
   build for it — and note that adopting it does violate "no extensions required".

**What is explicitly rejected:** schema-per-tenant. It has the migration cost of the
silo model and the isolation guarantees of the pool model, and it caps out at a few
hundred tenants — the worst trade available for an international SMB product.

---

## 2. Authorization — replacing flat RBAC

### 2.1 Why the current model can't stretch

The current model is four global strings: `creator | ceo | coo | cto`. It fails on
first contact with a real customer for four independent reasons:

1. **The role names are the founder's org chart.** A 40-person logistics firm in
   Germany does not have a "CTO" who should see the SEO module. Roles must be
   *tenant-owned nouns*, not product constants.
2. **Roles are global, not tenant-scoped.** `users.role` is a single column. A person
   who is an admin at their own tenant and a read-only guest at a partner's tenant
   cannot be represented at all.
3. **There is no object-level check.** "Can this user see deals" is answered; "can this
   user see *this* deal" is not. That is OWASP API1:2023 (Broken Object Level
   Authorization) — the single most exploited API class — and E2 SOP §8.2 requires it
   per call.
4. **`creator` is an unaudited global bypass.** Fine for an owner. A standing
   cross-customer breach for a SaaS.

### 2.2 The model landscape

- **RBAC** — user → role → permissions. Cheap, legible, sells fine. Fails on "only
  their own records", "only during business hours", "only for deals under $50k".
- **ABAC** — decisions from attributes of subject/resource/environment. Handles the
  above. Policies get hard to reason about and hard to render in a UI ("why can't I see
  this?" becomes a debugging session).
- **ReBAC / Zanzibar** — permissions derive from a graph of relationship tuples
  (`user:bala editor document:invoice-42`). This is Google's model behind Docs/Drive.
  It is the right answer when *end users share individual objects with each other* at
  arbitrary depth.
- **Policy engines** — externalize the decision:

| Engine | Model | Deployment | License | Fit for CBOP |
|---|---|---|---|---|
| **OpenFGA** | ReBAC (Zanzibar) | Self-hosted service + its own datastore | Apache 2.0, CNCF (originated at Auth0/Okta) | Best-in-class *if* we need ReBAC. Adds a service, a datastore, and a tuple-sync problem. `BatchCheck` (v1.8.0+) exists precisely because per-object checks otherwise N+1. |
| **SpiceDB** | ReBAC (Zanzibar) | Self-hosted service | Apache 2.0 | Zanzibar-purist. Same overhead as OpenFGA. |
| **Cerbos** | ABAC/PBAC, stateless PDP | Sidecar/service, policies as YAML | Apache 2.0 | Clean fit for *conditional* rules. Weak on ReBAC hierarchies — noted as its known limitation. |
| **Oso Cloud** | Hybrid | Managed; reads from your app DB, avoiding tuple sync | Commercial | The tuple-sync problem is the main ReBAC tax, and this is the one product that attacks it directly. Managed-service dependency. |
| **Permit.io / Permify** | ReBAC + UI | Managed / self-host | Mixed | Good DX, adds vendor. |

### 2.3 What commercial multi-tenant SaaS actually does

This is the part worth copying, because it's a solved problem and the shape is
remarkably consistent:

- **WorkOS** names three patterns and recommends the third: *global roles* (simple,
  breaks the moment an enterprise wants "Billing Admin"), *tenant-scoped roles* (max
  flexibility, causes **role explosion** — 500 customers × 10 roles), and **hybrid /
  role templates** — global base roles that tenants clone and extend, which they call
  "the winning move". Their anti-explosion guardrails: ship defaults that cover 80% of
  customers; expose **permission bundles** mapped to product concepts (`billing:manage`,
  `users:invite`) rather than 40 atomic permissions; and **force custom roles to clone a
  template** so tenants can't invent taxonomies from nothing. Their schema is almost
  exactly migration 057's: `roles(tenant_id, name)` unique per tenant,
  `user_roles(user_id, tenant_id, role_id)` composite PK, composite indexes leading with
  `tenant_id`. Their enforcement rule: verify the resource belongs to the tenant, *then*
  load roles in that tenant — "never assume roles are global". On SSO they are blunt:
  the IdP is the **source of truth for membership, not for permissions**.
- **Clerk** models `organization → membership → role`, **flat, no nested orgs**, and
  caps custom roles at **10 per application instance** (and gates custom roles behind a
  paid B2B add-on). A serious vendor deliberately capping role count is evidence that
  unbounded per-tenant roles are a trap, not a feature.
- **Slack**: Enterprise Grid → Workspace → Channel. Started with
  Owner/Admin/Member/Guest; added *system roles* (Channels Admin, User Admin, Compliance
  Admin, Roles Admin) at the Business+ tier; fully custom roles assignable from IdP
  groups only at Enterprise.
- **Notion**: Workspace → Teamspace → Page. Four workspace roles (Owner, Membership
  Admin, Member, Guest); teamspaces are open/closed/private and can tighten (or, for
  workspace owners, loosen) the baseline; page-level grants are
  Full Access / Can Edit / Can Edit Content / Can Comment / Can View. Conflicts resolve
  by **highest permission wins**.
- **Linear**: Workspace → Team → Project/Issue, with a deliberately *lean* role set
  (Admin, Member, Guest; Owner on Enterprise) and **no custom workspace roles at all**.
  Structure — private teams — does the isolation work instead of permission flags.

**The pattern across all five:** keep the global role vocabulary small and opinionated;
push variation to the *edges* (per-workspace, per-object); use *structure* (private
team, closed teamspace) rather than permission matrices wherever possible; add custom
roles and IdP-driven assignment only at the enterprise tier, where it's also a
monetizable differentiator.

Notably, **Linear and Notion ship to very large enterprises without a Zanzibar engine.**
ReBAC is not the price of admission to enterprise. Per-object sharing is.

### 2.4 Recommendation for CBOP

**Tenant-scoped RBAC with permission bundles + role templates, plus a narrow ABAC scope
layer. Explicitly defer ReBAC, with a written trigger.**

Reasons, in order:

1. **Migration 057 already built 80% of it.** `company_roles` (unique per company),
   `role_module_access` (module × read/write), `user_invites`, `users.company_role_id`.
   That is WorkOS's recommended schema with different column names. Adopting a policy
   engine now would mean *throwing away work that already exists* to solve a problem
   CBOP does not yet have.
2. **The 18 module keys in `api/lib/modules.ts` are already permission bundles** — the
   exact anti-role-explosion primitive WorkOS prescribes. `finance`, `sales`, `hiring`,
   `work`, `seo`, `legal` are product concepts a customer's ops manager can reason
   about. Don't decompose them into 200 atomic permissions.
3. **CBOP is a business-ops OS, not a document-sharing product.** Its access questions
   are "which modules, which workspaces, whose records" — hierarchical and role-shaped.
   They are *not* "Bala shared invoice-42 with an external auditor who re-shared it with
   their team", which is the question Zanzibar is built for.
4. **A policy engine is a new service, a new datastore, a new failure mode, and a
   dual-write consistency problem** (keeping tuples in sync with Postgres rows). At
   pre-revenue multi-tenant stage that is a large bet against an unproven need.

**The trigger to revisit — write this into the plan so it's a decision, not a drift:**
adopt OpenFGA (or Oso Cloud, if the tuple-sync tax is what's blocking) when **any two**
of the following become true:

- Customers need to share an individual record (a deal, a document, an invoice) with a
  named user *outside* their workspace — i.e. per-object ACLs, not module grants.
- Permission inheritance exceeds two levels (tenant → workspace → team → project →
  task, with grants at each).
- A customer requires "this contractor sees only projects they're assigned to, across
  three workspaces" — cross-workspace, per-object, per-user.
- Authorization logic appears in more than ~5 places outside the middleware layer.

Until then, ReBAC is a liability with better marketing.

### 2.5 Target schema

Additive. Nothing in 057 is dropped.

```sql
-- New: the actual tenant boundary
CREATE TABLE tenants (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name          TEXT NOT NULL,
  slug          TEXT NOT NULL UNIQUE,          -- acme  → acme.cbop.app
  plan          TEXT NOT NULL DEFAULT 'trial',
  placement     TEXT NOT NULL DEFAULT 'pool' CHECK (placement IN ('pool','silo')),
  db_dsn_ref    TEXT,                          -- env KEY name, never a DSN. No secrets in DB.
  status        TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','suspended','deleted')),
  data_region   TEXT NOT NULL DEFAULT 'in',    -- residency; see workstream #2
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- companies becomes "workspace within a tenant"
ALTER TABLE companies ADD COLUMN tenant_id UUID REFERENCES tenants(id) ON DELETE RESTRICT;

-- Membership is per-tenant, and carries the role. users.role dies here.
CREATE TABLE tenant_members (
  tenant_id  UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id    UUID NOT NULL REFERENCES users(id)   ON DELETE CASCADE,
  role_id    UUID NOT NULL REFERENCES company_roles(id) ON DELETE RESTRICT,
  status     TEXT NOT NULL DEFAULT 'active',
  PRIMARY KEY (tenant_id, user_id)
);

-- Role templates: the WorkOS "clone, don't invent" guardrail
CREATE TABLE role_templates (
  slug        TEXT PRIMARY KEY,        -- 'owner','admin','manager','member','viewer','billing_admin'
  name        TEXT NOT NULL,
  description TEXT
);
CREATE TABLE role_template_modules (
  template_slug TEXT NOT NULL REFERENCES role_templates(slug) ON DELETE CASCADE,
  module_key    TEXT NOT NULL,
  can_read      BOOLEAN NOT NULL DEFAULT true,
  can_write     BOOLEAN NOT NULL DEFAULT false,
  PRIMARY KEY (template_slug, module_key)
);

-- company_roles gains tenant scope + template provenance
ALTER TABLE company_roles ADD COLUMN tenant_id     UUID REFERENCES tenants(id) ON DELETE CASCADE;
ALTER TABLE company_roles ADD COLUMN template_slug TEXT REFERENCES role_templates(slug);

-- The thin ABAC layer — this is what stops it being "just RBAC"
CREATE TABLE role_scopes (
  role_id    UUID NOT NULL REFERENCES company_roles(id) ON DELETE CASCADE,
  module_key TEXT NOT NULL,
  scope      TEXT NOT NULL CHECK (scope IN ('all','workspace','team','own')),
  PRIMARY KEY (role_id, module_key)
);

-- Structural isolation (the Linear "private team" lesson) — cheaper than a permission matrix
CREATE TABLE teams (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  company_id UUID REFERENCES companies(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  is_private BOOLEAN NOT NULL DEFAULT false
);
CREATE TABLE team_members (
  team_id UUID NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  PRIMARY KEY (team_id, user_id)
);
```

`role_scopes` is the whole ABAC story and it is intentionally four values wide. It turns
`requireModule('sales')` into "sales, but only rows where `owner_id = me`" without a
policy language, without a new service, and without a rule nobody can explain to a
customer. It composes with RLS: `scope='own'` becomes an extra predicate the query
helper appends, while the tenant predicate stays in the RLS policy.

Ship these six role templates and resist adding a seventh: **owner, admin, manager,
member, viewer, billing_admin**. That is the union of what Slack, Notion and Linear
actually ship. Every tenant-custom role must clone one.

### 2.6 Middleware target shape

```ts
// requireAuth: sets tenantId, userId, roleId, moduleGrants (Map<module,{read,write,scope}>),
//              entitlements (from plan). Cached — see §4.3.
// requirePermission: the single gate. requireRole is deleted.

app.get('/api/deals',
  requireAuth,
  requirePermission('sales', 'read'),   // module ∧ action ∧ tenant entitlement
  listDeals)                             // handler applies scope + RLS runs underneath

app.patch('/api/deals/:id',
  requireAuth,
  requirePermission('sales', 'write'),
  loadDeal,                              // 404s if not in tenant — E2 SOP §8.2
  requireScope('sales', deal => deal.owner_id),
  updateDeal)
```

`requirePermission` fails closed: no tenant context → 401; no grant → 403; module not
in the tenant's plan → **402 Payment Required**, not 403. That distinction is worth
getting right early — it's the difference between "you can't" and "upgrade to", and it
is where expansion revenue comes from.

### 2.7 Staged migration path (not a rip-and-replace)

**Stage A — make `requireRole` a thin shim over the new gate (no behavior change).**
Reimplement `requireRole(...roles)` internally as a permission lookup, so the 227
existing call sites keep working while the engine underneath changes. Zero route edits.
Deploy. Verify nothing breaks with 3 users. *Exit: all existing behavior identical,
`role_module_access` is the actual source of truth.*

**Stage B — introduce `tenants`, backfill exactly one row.** All 5 companies get
`tenant_id = <bala-tenant>`. `creator` becomes `owner` **of that tenant**, and a
separate `platform_admin` flag (on a `platform_admins` table, not a role string) takes
over the cross-tenant powers — every use of it writes an audit row. *Exit: `SELECT id
FROM companies` with no WHERE is gone from `require-auth.ts`.*

**Stage C — `tenant_id` + RLS across all tenant-scoped tables**, with the CI coverage
test from §1.4. Still one tenant, so a policy bug is visible immediately and harms
nobody. *Exit: CI fails if a tenant-scoped table lacks `FORCE ROW LEVEL SECURITY`.*

**Stage D — route migration, module by module.** Replace `requireRole` with
`requirePermission` in dependency order: `work` → `sales` → `hiring` → `documents` →
`email_studio` → `finance` last (highest blast radius, and it's the one CLAUDE.md
already singles out). One module per PR, each with an authorization test that asserts a
member of tenant B gets 404 (not 403 — don't confirm existence) on tenant A's object.
*Exit: zero `requireRole` occurrences in `api/routes/`.*

**Stage E — role templates + tenant role management UI.** Clone-only custom roles. This
is the first stage that is *visible to a customer*, and correctly comes after the
plumbing is proven.

**Stage F — second tenant onboarded.** The real test. Everything before this is
rehearsal.

Note that stages A–C are all doable *before* the pivot is publicly committed to, are all
independently valuable (A and B fix real bugs in the current product), and none of them
require a customer to exist.

---

## 3. SSO, SCIM, and enterprise identity

### 3.1 What's actually table-stakes vs. what sells

| Capability | Verdict | Why |
|---|---|---|
| **SAML 2.0 SSO** | **Table stakes.** Blocker. | Missing "SAML support" on a security questionnaire disqualifies a vendor before technical evaluation. CISA's *Secure by Demand* guidance pushes buyers to require SSO **at no additional cost** — so treat "SSO tax" pricing as a risk, not a plan. |
| **OIDC SSO** | **Table stakes.** Cheaper than SAML and covers Google Workspace / Entra / Okta modern setups. | better-auth handles OIDC discovery automatically. |
| **Audit logs (exportable)** | **Table stakes.** | Enterprise buyers need them to verify policy compliance and satisfy their own regulators. CBOP also already needs an immutable audit trail for the Indian Companies (Accounts) Rules 2021 mandate — see `ACCOUNTING_Build_Plan.md`. **One append-only audit subsystem serves both.** Build it once. |
| **MFA** | Table stakes for mid-market; often satisfied *by* SSO for enterprise. | If they SSO, their IdP enforces it. |
| **SCIM provisioning** | **Second wave.** Requested by 500+ seat orgs. | 27% of 2025 SaaS security incidents traced to misconfigured SSO, largely incomplete deprovisioning — so SCIM is a security control, not a convenience. But it is not usually a first-deal blocker. |
| **Per-tenant custom domains** | **Third wave / differentiator.** | Nice-to-have unless selling white-label. A `{tenant}.cbop.app` subdomain covers the first 50 customers. |
| **Directory group → role mapping** | Ships with SCIM/SSO. | Keep WorkOS's rule: IdP owns *membership*, CBOP owns *permissions*. Mappings are per-tenant. |
| **SOC 2 Type II** | Not architecture, but gates the same deals. | Workstream #2. Flagged here because it constrains the audit-log and access-review design. |

### 3.2 better-auth capability check (verified against docs, not assumed)

**This is the good news of the whole document: no auth migration is needed.**
better-auth is MIT-licensed and already ships the enterprise identity stack.

| Need | better-auth support | Notes |
|---|---|---|
| Tenants / orgs | **`organization` plugin** | Creates `organization`, `member`, `invitation` tables; optional `team`, `teamMember`, `organizationRole`. Adds `activeOrganizationId` + `activeTeamId` to `session`. |
| Roles/permissions | `createAccessControl()` statements; `dynamicAccessControl.enabled` for runtime role creation | Default roles: owner / admin / member. |
| Teams | `teams.enabled` | Gives exactly the two-level org → team shape. |
| Limits/guardrails | `organizationLimit`, `membershipLimit`, `allowUserToCreateOrganization`, `invitationExpiresIn` | Useful as plan enforcement. |
| SAML 2.0 + OIDC + OAuth2 SSO | **`@better-auth/sso`** (separate package) | Auto-fetches OIDC discovery docs. Per-org provider config via `domain` (comma-separated allowed) or explicit `organizationId`. |
| JIT provisioning | `provisionUser`, `provisionUserOnEveryLogin: true` | Attribute sync on every login. |
| IdP attribute → role | `organizationProvisioning: { defaultRole, getRole }` | `getRole` can inspect SSO attributes (department, job title). |
| SCIM | **`@better-auth/scim`** | **Users only — no Groups support yet.** Bearer token = `base64(scimToken:providerId[:organizationId])`. Org-scoped via `organizationId`, gated by `requiredRole`. |

**Gaps to plan around:**

1. **SCIM Groups are not supported.** If a customer demands group-based role assignment,
   that's custom work on top. Users-only SCIM covers deprovisioning — which is the
   security-critical half — so this is a real but survivable gap.
2. **No nested organizations.** better-auth gives org → team, two levels. CBOP wants
   tenant → workspace(company) → team, three. **Decision required (see §6):** either map
   better-auth `organization` = CBOP `tenant` and model workspace/team ourselves (my
   recommendation — better-auth's `team` is then unused or maps to CBOP `teams`), or map
   `organization` = `company` and lose the tenant boundary at the auth layer. The first
   keeps identity and business hierarchy cleanly separated.
3. **Self-service SSO configuration** (customers wiring their own IdP without our
   involvement) is signposted in better-auth's docs as an enterprise/contact-us
   concern. Assume the first several SSO customers are hand-configured by us. That is
   normal and fine — it's also how WorkOS-less companies do it for their first 20 deals.
4. **`auth.ts` needs to stop hardcoding origins.** `trustedOrigins` becomes dynamic
   (tenant domains from the DB), and `baseURL` must be per-request-origin aware. This is
   already a known sore spot — three of the last five commits are auth-origin fixes.

**Do not migrate to WorkOS/Clerk/Auth0.** They're excellent, but they'd add per-MAU cost
and an external dependency to solve problems better-auth already solves for free, and
they'd force the org model into *their* shape. Revisit only if self-service SSO
onboarding becomes a sales bottleneck.

### 3.3 Per-tenant custom domains (when it's time)

Subdomains first: `{tenant-slug}.cbop.app` behind one **wildcard cert via DNS-01**.
Do not use HTTP-01 per-subdomain — Let's Encrypt's limits (≈300 new orders per account
per 3 hours, 50 certs per registered domain per week) make that fail at scale.

For true customer-owned domains (`ops.acme.com`), **Caddy's on-demand TLS** is the
standard pattern: it issues a certificate on the first TLS handshake for an unknown
hostname and caches it. It must be paired with an **ask endpoint** — a URL Caddy calls
to confirm the hostname is a registered tenant domain — otherwise anyone pointing DNS at
the IP triggers certificate issuance and burns rate limit. Nginx Proxy Manager (already
running) has no equivalent; expect to add Caddy in front or beside it.

Cookie implications: `advanced.crossSubDomainCookies` with `.cbop.app` works for
subdomains (this is already the technique `ACCOUNTING_Build_Plan.md` §R&D 3 chose for
`accounting.etherence.com`). Customer-owned domains cannot share that cookie —
each becomes its own cookie origin, which is *better* isolation, but means the session
must be established per-domain.

---

## 4. Infrastructure and scaling

### 4.1 What survives the pivot unchanged

Postgres as the only datastore. Hono + Node. Next.js 14. better-auth. nodemailer as
the send abstraction. Puppeteer for PDFs. Docker. The slide-over UI convention. The
design system. The naming rules. **The architecture is not wrong — it is under-scoped.**

### 4.2 What changes

| Layer | Today | Multi-tenant SaaS | Trigger |
|---|---|---|---|
| App tier | 1 Node process on the homeserver | ≥2 stateless replicas behind a load balancer | Any paying customer |
| DB connections | one `Pool`, `max: 20`, direct | **PgBouncer, transaction mode**, `SET LOCAL` tenant context | Before 2nd app replica |
| DB host | shares the box with everything | own host + streaming replica; reporting reads hit the replica | First customer with a real dataset |
| Jobs | n8n only | **pg-boss** in-app; n8n internal-only | Immediately (licensing, §4.4) |
| Files | Nextcloud | S3-compatible object storage, per-tenant key prefixes, presigned URLs | First customer upload |
| PDFs | Puppeteer in the API process | dedicated worker pool, hard concurrency cap | ~10 tenants |
| Email | domain→SMTP map in `mailer.ts` | per-tenant sending identity + suppression lists + per-tenant reputation isolation | First customer campaign |
| Secrets | `.env` on one box | secret manager or at minimum per-env `.env` + rotation runbook | Before first customer |
| Backups | one `pg_dump` at 2am | PITR (WAL archiving) + **per-tenant logical export** (GDPR portability) | Before first customer |
| Observability | Uptime Kuma | structured logs with `tenant_id` on every line + error tracking + per-tenant metrics | Before first customer |
| Migrations | `scripts/migrate.js` on deploy | same, but **expand/contract only** — no destructive migrations, ever, once tenants exist | At tenant #2 |

### 4.3 Connection pooling — the concrete numbers

Each Postgres backend is a process consuming ~1–3 MB before caching a single row;
10,000 direct connections is ~20 GB of pure overhead. PgBouncer in transaction mode
typically multiplexes at **10×–25×**, which is the difference between one database
instance and several. Operational rule of thumb from the sources: if average client
wait time exceeds ~50 ms, either `pool_size` is undersized or queries are holding
connections too long.

Two consequences for CBOP specifically:

- **Transaction mode forbids session state.** No `SET` (only `SET LOCAL`), no session-
  level advisory locks, no `LISTEN`/`NOTIFY` on pooled connections, no prepared-statement
  reuse across transactions. pg-boss uses `LISTEN`/`NOTIFY` — so **workers connect
  directly to Postgres or through a session-mode pool, never through the transaction-mode
  pool.** Two pools, different modes, different consumers.
- **`requireAuth`'s 3 queries per request must be cached.** Cache the *permission set*,
  not the *decision* — keyed `perm:{tenantId}:{userId}` with a policy-version component
  so a role change invalidates instantly, short TTL on allows (~300s), longer on denies.
  This is WorkOS's guidance and it's right. **Without Redis**, use an in-process LRU per
  app replica plus a `policy_version` column on `tenants` checked cheaply — a stale allow
  for ≤300 s on one replica is an acceptable, bounded exposure; a stale allow forever is
  not. If that becomes unacceptable, that's the moment the "no Redis" constraint gets
  revisited on its merits.

### 4.4 Background jobs — the n8n constraint breaks, and licensing is why

**This is the constraint change with the sharpest edge, so state it plainly.**

`CLAUDE.md`: *"n8n for all 6 automations. No custom queue or scheduler code in CBOP."*
and *"No Redis. No Bull.js."*

**The licensing problem comes first and is not negotiable by engineering effort.** n8n
ships under the **Sustainable Use License**, which permits use for *internal business
purposes* and explicitly prohibits white-labeling n8n and offering it to customers for
money, hosting n8n and charging people to access it, and — directly on point —
**embedding n8n inside a SaaS product or using it as the backend for customer-facing
automation**. The sanctioned route is n8n's **Embed License, priced from ~$50,000/year**.

CBOP-as-SaaS running customer sales/hiring/email automations through n8n is squarely the
prohibited case. This is a legal exposure, not a design preference, and it needs a
decision before build, not after a customer is live.

**The technical problem is independent and would break it anyway.** n8n's own scaling
docs point to queue mode with dedicated workers, but the ecosystem consensus is
unambiguous: n8n is built for single organizations, not multi-tenant SaaS, and adapting
it means building isolation, per-tenant secret handling, and concurrency control
yourself. Multiply CBOP's six workflows by N tenants and it becomes an operational
nightmare where a runaway workflow in tenant A starves tenant B.

**Recommendation: pg-boss.**

- Postgres-native queue using `SELECT … FOR UPDATE SKIP LOCKED` and `LISTEN`/`NOTIFY`.
  **No Redis, no Bull.js** — the original constraint's *actual intent* ("don't add
  another datastore") is preserved. Only the "no custom queue code" clause changes.
- ACID with the business transaction: enqueue the job in the same transaction that
  creates the invoice. No dual-write, no lost job, no phantom job.
- Cron/scheduled jobs, retries with backoff, dead-letter queues — the six existing n8n
  workflows (`follow_ups`, `financial_calc`, `reporting`, `client_onboarding`,
  `employee_onboarding`, `lead_scoring`) map onto it directly.
- Honest tradeoff: BullMQ/Redis wins on sub-second pickup latency and very high
  throughput. CBOP's jobs are follow-ups, report generation, onboarding sequences and
  scoring — **none are latency-critical**. Postgres is the right call until proven
  otherwise, and if it isn't, Redis+BullMQ is a contained swap behind a job interface.
- **Keep n8n for internal ops only** (Bala's own 5 companies, internal alerting,
  glue). That use *is* permitted by the Sustainable Use License. Write the boundary into
  CLAUDE.md so it doesn't drift back.

**Design the abstraction now**: `api/lib/jobs.ts` exporting `enqueue(name, payload,
{tenantId, runAt})`. Every job carries `tenant_id`. Add per-tenant concurrency caps
early — one tenant importing 50,000 leads must not starve everyone else. Noisy-neighbor
control is a multi-tenant requirement, not an optimization.

### 4.5 Other scaling notes worth writing down

- **Puppeteer is the sneakiest cost.** Each Chromium instance is hundreds of MB. In the
  API process it will OOM the box under concurrent invoice generation. Move to a
  dedicated worker with a hard concurrency cap and a queue in front (pg-boss again),
  and cache generated PDFs by content hash.
- **Email reputation becomes per-tenant.** The static domain→SMTP map in
  `api/lib/mailer.ts:42-45` is single-tenant by construction. Multi-tenant sending needs
  per-tenant verified domains, per-tenant suppression lists, and isolation so one
  customer's spam complaints don't torch everyone's deliverability. `docs/
  EMAIL_DELIVERABILITY.md` already has the domain-warmup groundwork — extend it, don't
  restart it.
- **Migrations become expand/contract permanently.** `scripts/migrate.js` runs forward-
  only SQL, which is fine, but once other people's data is in there, a migration that
  drops or renames a column in one step is an outage. Add column → dual-write →
  backfill → switch reads → drop old, across separate deploys.
- **`SELECT id FROM companies` per request must die** (`require-auth.ts:31`). At 5,000
  tenants it is both a full scan and an isolation violation.
- **Statement timeouts, per-tenant rate limits, and query cost caps** — E2 SOP §9 makes
  rate limits *named constants*, never inlined. Multi-tenant adds a second axis: limits
  per tenant *and* per user, so one customer's runaway integration can't consume the
  shared pool.

---

## 5. CLAUDE.md constraints this pivot breaks

Honest accounting. "Keep" means the constraint survives verbatim; "amend" means the
intent survives but the wording must change; "break" means it is incompatible with the
pivot.

| # | Constraint | Verdict | Recommended replacement | Reasoning |
|---|---|---|---|---|
| 1 | "Postgres + better-auth only. No Supabase. **No Supabase RLS.**" | **Amend** | "No Supabase, no PostgREST, no browser-to-DB access. Authorization decisions are made in Hono middleware. **Postgres row-level security is mandatory on every tenant-scoped table** as a second layer, never as the primary mechanism." | Postgres RLS ≠ Supabase RLS (§1.2). The ban was aimed at the browser-talks-to-DB pattern, which we still reject. Banning core Postgres RLS by accident forfeits the cheapest cross-tenant breach protection available. |
| 2 | "No Redis. No Bull.js." | **Keep (for now)** | Unchanged, plus: "permission caching is in-process LRU with a `policy_version` invalidation token; revisit Redis only when multi-replica cache coherence becomes a measured problem." | The intent — don't add a datastore — is right and pg-boss honors it. Don't pre-emptively concede it. |
| 3 | "**n8n for all 6 automations. No custom queue or scheduler code in CBOP.**" | **Break** | "**pg-boss** is CBOP's job queue and scheduler. n8n is retained for *internal-only* automation across Bala's own companies and is never in the path of a paying tenant's workflow." | Licensing first: n8n's Sustainable Use License prohibits embedding it as a paid product's automation backend; the sanctioned path is a ~$50k/yr Embed License. Technically it isn't multi-tenant either. See §4.4. |
| 4 | "Telegram/WhatsApp/Discord through cbop-bridge only" | **Amend** | Keep the single-egress principle; make the bridge tenant-aware (per-tenant credentials, per-tenant rate limits, per-tenant delivery logs) and treat it as a single point of failure needing HA. | The abstraction is good. A single shared bot identity across customers is not — customers need their own WhatsApp sender and their own Telegram bot. |
| 5 | "Email via nodemailer only… `/api/internal/send-email` never exposed externally" | **Keep, extend** | Keep both. Add per-tenant sending identity, per-tenant suppression, per-tenant reputation isolation. | Single email egress point is exactly right; it just needs a tenant dimension. |
| 6 | "SOPs from Outline only" | **Break** | Ship a native SOP/knowledge module or a pluggable connector. Outline stays as one option for self-hosting tenants. | Customers will not adopt a self-hosted Outline to use CBOP. This is a hard product blocker, not an architecture one. |
| 7 | "**No global search bar.** Table filters only." | **Break** | Add scoped search (Postgres full-text, tenant-scoped, permission-filtered). Keep table filters. | Defensible at 3 users and ~50 records. At 10,000 records per tenant across 18 modules, "no search" is a product defect. Cite Notion/Linear/Slack — every one ships search; it is a baseline SaaS expectation. |
| 8 | "**Finance routes are CEO-only** (`requireRole('ceo')`); `creator` bypasses every gate" | **Break** | `requirePermission('finance','read'\|'write')` resolved against the tenant's own roles. **`creator` becomes tenant-scoped `owner`**; cross-tenant access moves to an audited, break-glass `platform_admin` that writes an audit row on every use and can be disabled per tenant contract. | A global bypass role is a standing cross-customer breach and will fail any SOC 2 / enterprise security review on sight. Also fixes the live bug documented in `ACCOUNTING_Build_Plan.md` where coo/cto get 403 on every finance call. |
| 9 | "Every task requires a project (`ops_tasks.project_id` NOT NULL)" | **Keep** | Unchanged. | Good invariant. Tenants can define their own project taxonomy; the FK stays. |
| 10 | "Slide-over panels only. No modals." | **Keep** | Unchanged. | A real design system decision, and consistency matters more at product scale, not less. |
| 11 | "No hardcoded secrets; all config from `process.env`" | **Keep, harden** | Same rule + per-tenant *credentials* (customer SMTP, OAuth tokens, IdP configs) stored **encrypted at rest in Postgres with envelope encryption**, key in env/KMS. | Per-tenant credentials cannot live in `.env` — there are N of them and they're customer-owned. The rule "no secrets in DB" must become "no *platform* secrets in DB; tenant secrets encrypted, keys never in DB". |
| 12 | "Existing homeserver services (Outline/Nextcloud/Gitea/Uptime Kuma/NPM/OpenClaw); docker-compose only contains postgres and n8n" | **Break** | Split infrastructure: keep the homeserver for Bala's own internal ops; the SaaS runs on real cloud infra. Nextcloud → object storage. Uptime Kuma → real APM/error tracking. NPM → Caddy (or NPM + Caddy) for per-tenant TLS. | A single Ubuntu box is not a place to host other companies' business data — availability, backup, and jurisdiction all fail. (Note: this line is *already* stale — `docker-compose.yml` also runs `cbop-app`, per `ACCOUNTING_Build_Plan.md` §R&D 3.) |
| 13 | "3 users only / roles are `creator\|ceo\|coo\|cto`" (Role model section) | **Break** | Replace wholesale with §2.5's model: tenant → workspace → team → member, six role templates, tenant-owned custom roles cloned from templates. | This is the pivot's core. Note the CHECK constraint on `users.role` was already dropped by migration 057. |
| 14 | "Trainer AI does not exist in v2" | **Keep** | Unchanged. | Scope discipline. Still valid. |
| 15 | Invoice format `{COMPANY_CODE}-{YEAR}-{SEQ}` | **Amend** | Make the pattern **per-tenant configurable**, seeded with the current default. | Customers have their own numbering conventions, and some are statutory. (`ACCOUNTING_Build_Plan.md` already flags a related bug: `{YEAR}` must be the *financial* year for Indian GST, not calendar.) |
| 16 | MCP tool layer: `caller_telegram_id` → user → role; hardcoded `6316112708 → Bala → creator` | **Break** | MCP calls authenticate a **tenant-scoped** service token; the caller identity resolves within a tenant. Delete hardcoded IDs. | A hardcoded telegram ID mapping to a global super-admin is a backdoor once other tenants exist. |

**Net: 6 keeps, 4 amends, 6 breaks.** The breaks cluster in exactly two places — the
role model and the single-box/single-org infrastructure assumptions — which is what a
healthy architecture looks like under this kind of pivot. The data model, the naming
rules, the UI conventions and the security posture largely survive.

---

## 6. Open decisions for Bala

These genuinely cannot be decided from research. Each blocks something downstream.

1. **Does a customer tenant contain multiple companies?** CBOP's whole shape assumes a
   *group* of companies. Most SMB customers are one company. If tenant→workspace is
   usually 1:1, the workspace switcher becomes dead UI for 90% of customers — but the
   multi-company rollup is also a genuine differentiator for holding groups and agencies.
   **This decides whether `companies` is renamed to `workspaces` or absorbed into
   `tenants`.** Blocks §2.5's schema.
2. **n8n Embed License, or pg-boss?** ~$50k/yr and keep the existing six workflows, vs.
   engineering time to port them. My recommendation is pg-boss, but this is a
   money-vs-time call and it's Bala's. Blocks §4.4.
3. **Self-hosted / on-prem tier?** Enterprise and regulated buyers ask. It changes
   *everything* — licensing, update cadence, support model, and it makes
   database-per-tenant the default rather than the exception.
4. **Data residency commitments (EU/India/US)?** "International" plus GDPR means at
   minimum an EU region. `tenants.data_region` is in §2.5's schema as a placeholder;
   whether it's real changes the deployment topology. Coordinate with workstream #2.
5. **Do end users share individual records across workspace boundaries?** This is the
   ReBAC trigger from §2.4. If the answer is "yes, customers will share a deal with
   their external accountant", OpenFGA moves from "later" to "now".
6. **Does Bala's own 5-company setup become tenant #1 on the SaaS, or stay a separate
   deployment?** Tenant #1 is better dogfooding and worse blast radius. Recommendation:
   tenant #1 on the same deployment, **after** stage C (RLS) is proven — not before.

---

## 7. Recommended sequencing (how this lands in `Project-Scale-Up-Plan.md`)

```
Phase 0  Fix current bugs that are also multi-tenant blockers
         · finance 403 bug (ACCOUNTING_Build_Plan)   · remove SELECT id FROM companies
         · adopt requireModule behind the requireRole shim (Stage A)
         · audit-log subsystem (serves both Indian statutory + enterprise SSO needs)

Phase 1  Tenant boundary
         · tenants table, backfill 1 tenant, tenant_id everywhere   (Stage B)
         · RLS + FORCE + app role + CI coverage test                (Stage C)
         · PgBouncer transaction mode + withTenant() in db.ts

Phase 2  Authorization
         · role templates, role_scopes, tenant_members              (Stage D)
         · requirePermission across all 25 route files, module by module
         · creator → tenant owner; platform_admin break-glass + audit

Phase 3  Jobs & infra
         · pg-boss; port the 6 workflows; per-tenant concurrency caps
         · object storage; Puppeteer worker pool; per-tenant email identity
         · observability with tenant_id on every log line

Phase 4  Enterprise identity
         · better-auth organization plugin wired to tenants
         · @better-auth/sso (SAML + OIDC), hand-configured per customer
         · audit log export; @better-auth/scim when a deal requires it

Phase 5  Product surface
         · tenant signup/onboarding, plan entitlements from company_modules
         · role management UI (clone-from-template only)
         · scoped search; app switcher (workstream #3)
         · subdomains → custom domains via Caddy on-demand TLS

Phase 6  Second tenant. Everything before this is rehearsal.
```

Phases 0–1 are worth doing **even if the pivot is cancelled** — they fix live bugs and
harden the existing product. That's the test of a good migration path.

---

## Sources

Multi-tenancy and Postgres:
- [Approaches to tenancy in Postgres — PlanetScale](https://planetscale.com/blog/approaches-to-tenancy-in-postgres)
- [How to architect multi-tenant SaaS on Postgres — ClickHouse](https://clickhouse.com/resources/engineering/multi-tenant-saas-postgres-architecture)
- [Multi-Tenant Architecture: Database Per Tenant vs Shared Schema (2026) — DEV](https://dev.to/young_gao/multi-tenant-architecture-database-per-tenant-vs-shared-schema-1n2e)
- [Building SaaS with PostgreSQL — Multi-Tenancy Patterns Compared](https://www.adiagr.com/blog/07-saas-postgres-multitenancy-patterns/)
- [PostgreSQL docs — Row Security Policies](https://www.postgresql.org/docs/current/ddl-rowsecurity.html)
- [Mastering PostgreSQL RLS for Rock-Solid Multi-Tenancy — Rico Fritzsche](https://ricofritzsche.me/mastering-postgresql-row-level-security-rls-for-rock-solid-multi-tenancy/)
- [Postgres Row-Level Security Footguns — Bytebase](https://www.bytebase.com/blog/postgres-row-level-security-footguns/)
- [PgBouncer at Scale: 10K+ Connections Multi-Tenant Postgres — DZone](https://dzone.com/articles/database-connection-pooling-at-scale-pgbouncer-mul)
- [Scaling Postgres connections with PgBouncer — PlanetScale](https://planetscale.com/blog/scaling-postgres-connections-with-pgbouncer)
- [Multi-tenant Applications — Citus 13 docs](https://docs.citusdata.com/en/stable/get_started/tutorial_multi_tenant.html)

Authorization models and commercial precedent:
- [How to design an RBAC model for multi-tenant SaaS — WorkOS](https://workos.com/blog/how-to-design-multi-tenant-rbac-saas)
- [Multi-tenant permissions done right: what Slack, Notion and Linear can teach us — WorkOS](https://workos.com/blog/multi-tenant-permissions-slack-notion-linear)
- [Role-Based Access Control — WorkOS Docs](https://workos.com/docs/rbac)
- [Organizations — Build multi-tenant B2B applications — Clerk Docs](https://clerk.com/docs/guides/organizations/overview)
- [B2B/B2C Roles and Permissions with Clerk Organizations](https://clerk.com/docs/organizations/roles-permissions)
- [Top 7 Open-Source Authorization Tools Compared (2026)](https://startwithidentity.com/articles/top-7-open-source-authorization-tools/)
- [OpenFGA — Running in Production](https://openfga.dev/docs/best-practices/running-in-production)
- [Taming P99s in OpenFGA — Auth0 blog](https://auth0.com/blog/self-tuning-strategy-planner-openfga/)
- [OpenFGA Alternatives — Oso](https://www.osohq.com/learn/openfga-alternatives)
- [OpenFGA vs SpiceDB vs Cerbos vs OPA](https://sph.sh/en/posts/external-authorization-management-systems/)
- [Implementing the Notion Authorization Model — Permify](https://permify.co/post/modeling-notion-access-management/)
- [Intro to teamspaces — Notion Help](https://www.notion.com/help/intro-to-teamspaces)

Enterprise identity:
- [Organization plugin — Better Auth Docs](https://better-auth.com/docs/plugins/organization)
- [Single Sign-On (SSO) plugin — Better Auth Docs](https://better-auth.com/docs/plugins/sso)
- [SCIM plugin — Better Auth Docs](https://better-auth.com/docs/plugins/scim)
- [Enterprise SSO — better-auth (DeepWiki)](https://deepwiki.com/better-auth/better-auth/6.2-enterprise-sso)
- [Federated identity for enterprise SaaS: SAML, OIDC, and SCIM — Clerk](https://clerk.com/articles/federated-identity-for-enterprise-saas-saml-oidc-and-scim)
- [Enterprise Identity Management for SaaS: The Complete Guide (2026) — SSOJet](https://ssojet.com/blog/enterprise-identity-management-for-saas)
- [10 Critical Audit Log Events Every B2B SaaS App Should Track — SSOJet](https://ssojet.com/blog/critical-audit-log-events-b2b-saas-enterprise)
- [Enterprise-Ready SaaS: SSO, SCIM, and Audit Logs in the Right Order — Hashorn](https://hashorn.com/blog/enterprise-ready-saas-sso-scim-audit-logs)

Jobs, automation and infrastructure:
- [Sustainable Use License — n8n Docs](https://docs.n8n.io/sustainable-use-license/)
- [n8n Automation Licence Explained: Why It's Not Fully Free — Scalevise](https://scalevise.com/resources/n8n-automation-license-commercial-use/)
- [Scaling n8n — n8n Docs](https://docs.n8n.io/hosting/scaling/overview/)
- [Embedding n8n in Your SaaS App: What's Possible and What You'll Need to Build](https://flowmate.io/blog/embedding-n8n-in-a-saas-app/)
- [BullMQ vs Bee-Queue vs pg-boss (2026) — PkgPulse](https://www.pkgpulse.com/guides/bullmq-vs-bee-queue-vs-pg-boss-job-queues-nodejs-2026)
- [BullMQ Alternatives for Webhook Retries — Hookdeck](https://hookdeck.com/webhooks/platforms/bullmq-alternatives-for-webhook-retries)
- [Caddy on-demand TLS for multi-tenant hostnames — Stack Harbor](https://stackharbor.com/en/knowledge-base/caddy-on-demand-tls/)
- [Multi-Tenant SaaS's Wildcard TLS: DNS-01 Challenges](https://www.skeptrune.com/posts/wildcard-tls-for-multi-tenant-systems/)

Internal (verified in-tree, 2026-08-05): `CLAUDE.md`; `docs/MASTER.md` §6, §16, §17;
`docs/modules/ACCOUNTING_Build_Plan.md`; `docs/engineering/E2_BACKEND_SOP.md` §§7–10;
`api/middleware/require-auth.ts`, `require-role.ts`, `require-module.ts`;
`api/lib/auth.ts`, `db.ts`, `modules.ts`, `mailer.ts`;
`migrations/055_company_modules.sql`, `057_dynamic_roles.sql`.
