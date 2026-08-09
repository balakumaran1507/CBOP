# CBOP Super OS — Multi-App SaaS UX Research

Reference doc for the pivot from "internal 3-user tool" to "multi-tenant Super OS
that SMB/enterprise clients subscribe to, picking which apps they want."

**What this is.** UX and page-structure patterns sourced from real, shipping
products — not invented. Visual design is out of scope (owner handles that).
Each section reads: *what real products actually do* → *what to steal* → *how
CBOP adapts it given the existing module registry and the slide-over-only rule
in `CLAUDE.md`.*

**What this is not.** A repeat of `docs/engineering/E2_FRONTEND_SOP.md`. That doc already
covers the mechanics — command palette (#17), skeletons (#27), optimistic UI
(#19), loading discipline (#5/#11), passkeys + social login (#14), offline
banners (#36), feature flags, notification *delivery* plumbing. This doc covers
what the SOP has no opinion on: **the multi-app, multi-tenant product shell** —
app switching, org switching, onboarding, billing, admin IA, and the cross-app
notification inbox. Where a pattern here needs an SOP item, it's cross-referenced
as `SOP #N`.

**Reading order for a frontend dev:** §0 (what's already built) → the section
matching your ticket. §7 is the cross-cutting routing/state decision that every
other section depends on — read it before writing any nav code.

---

## §0 — Starting point: what CBOP already has (verified against code, 2026-08-05)

Not assumed. Read from the actual files.

| Thing | Where | State |
|---|---|---|
| Module registry, 18 keys | `api/lib/modules.ts` | Static object, `{ label, roles[] }` per key |
| Per-tenant module toggle | `migrations/055_company_modules.sql` | `company_modules(company_id, module_key, is_enabled)` — PK on the pair, backfilled all-enabled |
| Per-role module grants | `role_module_access` (migration 057) | `role_id, module_key, can_read` — custom roles per company |
| Two-layer gate middleware | `api/middleware/require-module.ts` | Checks `allowedModules` (role) **then** `enabledModules` (company). `creator` bypasses both |
| Admin toggle UI + API | `api/routes/settings.ts:890–960` | `GET /api/settings/modules` (all companies × all modules matrix), `PATCH /api/settings/modules/:companyId/:module` |
| Nav | `app/components/sidebar.tsx` | 5 hardcoded `NAV_GROUPS`, 20 links, per-item `roles?: Role[]` |
| Company switcher | `app/components/topbar.tsx` + `app/lib/company-context.tsx` | Topbar dropdown, active company in `localStorage` only |
| Notifications | `api/routes/notifications.ts`, `migrations/058_app_notifications.sql`, `app/components/notification-bell.tsx` | Bell dropdown, 30-item list, unread count polled every 60s |
| Command palette | `app/components/command-palette.tsx`, mounted in `app/(dashboard)/layout.tsx` | Exists, role-aware |

**CBOP is already ~70% of the way to the industry-standard entitlement
architecture and doesn't know it.** `require-module.ts` implements exactly the
entitlement × permission split that WorkOS and the multi-tenant literature
recommend (§7.2). What's missing is the *product shell* on top of it.

### Four defects the pivot must fix (all verified, all load-bearing for multi-tenancy)

1. **The company switcher does not switch tenants server-side.**
   `api/middleware/require-auth.ts` loads `enabledModules` from
   `companyIds[0]` — a *primary* company, hardcoded as the first row. The
   topbar switcher writes `cbop_active_company_id` to `localStorage` and
   nothing else. So a user in two companies with different module sets gets
   company A's entitlements no matter which company the UI claims is active.
   Fixes in §2.4.

2. **The sidebar duplicates the module registry with a different, already-drifted
   access list.** Sidebar gates Social/Blog/SEO to `['creator','ceo']`;
   `modules.ts` grants `blog`/`seo` to `coo` **and** `cto`, and `social` to
   `coo`. Campaigns is ungated in the sidebar but excludes `cto` in the
   registry. Two sources of truth, drifting in both directions. Fixes in §1.4.

3. **The sidebar and the registry don't cover the same surface.** Sidebar has
   `/accounting`, `/tax`, `/people`, `/website`, `/profile`, `/command` — none
   are module keys. Registry has `mentor`, `goals`, `rnd` — none have nav
   entries. In a marketplace where a tenant buys apps, "app" must be one
   enumerable concept.

4. **`company_modules` has no provenance.** A row says `is_enabled` but not
   *why* — plan entitlement, admin choice, or trial. The moment billing exists,
   a downgrade cannot distinguish "admin turned this off" from "plan no longer
   includes this," and re-upgrade silently resurrects the wrong state. Fixes in
   §4.4.

---

## §1 — App switcher and the multi-app shell

### 1.1 What real products do

**Zoho One** — the closest analogue to CBOP's target shape (50 apps, one
subscription, one identity, per-user app assignment). Zoho shipped a full UX
overhaul on **18 Nov 2025** ([Constellation
Research](https://www.constellationr.com/insights/news/zoho-one-gets-new-ux-moves-closer-business-operating-system-vision),
[Reworked](https://www.reworked.co/digital-workplace/zoho-one-update-brings-unified-interface-and-deeper-ai-integration/)).
The pieces that matter:

- **Spaces** replace a flat app grid. Three kinds: *Personal* (my tools),
  *Department* (HR / Marketing / Finance), *Organization* (company-wide). A
  Space is a context-scoped subset of apps, arranged across the top toolbar.
  This is the single most transferable idea in this doc: **at 18+ apps, a flat
  launcher stops working, and grouping by *who you are* beats grouping by
  *what the app does*.**
- **Left navigation holds the apps**, user-arrangeable. Zoho moved the app list
  from a modal grid into persistent left nav in the new UI.
- **Action Panel** — one consolidated surface for upcoming meetings, unread
  messages, emails, tasks pulled from *all* apps. See §6.
- **Zia Search** — one search box spanning every app, explicitly positioned as
  the alternative to keeping many tabs open.
- **Unified Portal** — consolidates per-app portals (Zoho and third-party) into
  one place.

**Microsoft 365 app launcher** ("the waffle") — the oldest and most-copied
pattern ([Microsoft
Learn](https://learn.microsoft.com/en-us/microsoft-365/admin/manage/customize-the-app-launcher?view=o365-worldwide)).
Grid icon, fixed top-right corner, opens a tile grid. Three behaviours worth
copying:
- **Users pin their own tiles** — `…` → *Pin to app launcher* — so the launcher
  becomes personal without any admin work.
- **Admins push custom tiles** org-wide from *Org Settings → Organization
  profile → Custom tiles for Apps*, pointing at internal sites or legacy apps.
  Documented propagation: **within 24 hours**.
- **An `All` tab** exists behind the pinned set. Pinned is the default view;
  exhaustive is one click away, never the front door.

**Odoo 18** — the reference for *installable* apps, which is the part Zoho and
Microsoft don't model ([Odoo
docs](https://www.odoo.com/documentation/18.0/applications/general/apps_modules.html)).
- Apps are a first-class app: an **Apps** dashboard of cards with search, and a
  filter that splits **Apps** (default) from **Extra** (modules).
- Install is one **Activate** button on the card. Upgrade lives under the card's
  vertical-ellipsis menu.
- **Uninstall is a deliberately scary, two-section confirmation**: *Apps to
  Uninstall* (including dependents) and *Documents to Delete* (the actual DB
  records), with a `Show All` checkbox that expands the full dependency chain,
  plus the flat statement that "uninstalling apps also deletes their database
  records." Dependencies are shown, not discovered after the fact — removing
  Restaurant removes Point of Sale, and the dialog says so.

**Rippling** — the model for "many apps, one data spine" ([Rippling
platform](https://www.rippling.com/en-GB/global/platform), [product
teardown](https://nextsprints.com/guide/rippling-product-teardown-analysis)).
Left-side nav with clear separation between HR / IT / Finance; a customizable
widget dashboard as the hub; and the Employee Graph as the shared object model
every app reads. Rippling's own framing of the UX consequence is the important
part: platform capabilities *"share a common set of UX patterns, so by learning
how to use them in one part of Rippling, you're mastering them across all of its
applications."* Adding a module needs minimal setup because identity,
permissions, and workflows are already configured.

**ClickUp** — the counter-example on hierarchy depth. Sidebar carries the whole
hierarchy (**Everything → Spaces → Folders → Lists**), with an *Everything* level
that flattens the entire workspace into one view ([ClickUp
Help](https://help.clickup.com/hc/en-us/articles/12755292456983-Intro-to-the-Sidebar-in-ClickUp-3-0)).
ClickUp 3.0 was deprecated **27 Mar 2026** in favour of 4.0's Spaces Sidebar,
which pulled *create* actions (tasks, messages, Docs) into the sidebar itself.
Lesson: four nesting levels is the practical ceiling before users get lost, and
an escape hatch that flattens everything is mandatory at that depth.

### 1.2 Pattern summary

| Pattern | Product | Take it? |
|---|---|---|
| Persistent left nav holds apps; app switcher is not the primary nav | Zoho One (new UI), Rippling | **Yes** — CBOP already does this |
| Grouped Spaces (Personal / Department / Org) instead of flat grid | Zoho One | **Yes** — replaces hardcoded `NAV_GROUPS` |
| User-pinnable tiles + `All` tab | Microsoft 365 | **Yes** — cheap, high value at 18+ apps |
| Admin-pushed custom tiles | Microsoft 365 | Later — only when tenants want to surface their own internal links |
| Apps-as-an-app browse/install surface | Odoo | **Yes** — this is the marketplace page |
| Destructive-uninstall confirmation naming dependents *and* data | Odoo | **Yes, non-negotiable** — see §1.4 |
| Shared UX grammar so one app teaches the next | Rippling | **Yes** — the strongest argument for a shared page-shell component |
| Cross-app unified search | Zoho Zia Search | **Constrained** — see §1.4 |
| Flatten-everything escape hatch | ClickUp *Everything* | Only if nesting ever goes past 2 levels |

### 1.3 The shell CBOP should converge on

```
┌──────────────────────────────────────────────────────────────────┐
│ TOPBAR 48px  [☰ apps] [Org ▾] › breadcrumb      [⌘K] [🔔] [avatar]│  ← identity + org + inbox
├──────────┬───────────────────────────────────────────────────────┤
│ SIDEBAR  │                                                       │
│ 240px    │  APP CONTENT                                          │
│          │                                                       │
│ ⌄ Pinned │  Every app page = same shell:                         │
│   …      │    page title · tabs · filter row · primary action     │
│ ⌄ Space  │    (opens slide-over)                                 │
│   …      │                                                       │
│ ⌄ Space  │                                                       │
│   …      │                                                       │
│ ──────── │                                                       │
│ Browse   │  ← the Odoo "Apps" surface, /apps                     │
│ apps     │                                                       │
├──────────┴───────────────────────────────────────────────────────┤
│ footer: active org name (already built)                          │
└──────────────────────────────────────────────────────────────────┘
```

Three layers, borrowed in order: **Zoho's Spaces** for grouping, **Microsoft's
pin + All** for personalization, **Odoo's Apps page** for acquisition.

### 1.4 CBOP recommendation

**R1.1 — One registry, served, never duplicated in the client.** Delete the
`roles?: Role[]` field from `sidebar.tsx`'s `NAV_GROUPS`. Extend `modules.ts`
entries to carry everything the nav needs and make it the only source:

```ts
// api/lib/modules.ts
export const MODULES = {
  sales: {
    label: 'Sales',
    href: '/sales',
    icon: 'TrendingUp',        // lucide name, resolved client-side
    space: 'revenue',          // Zoho Spaces grouping
    roles: ['ceo','coo','cto','creator'] as const,
    dependsOn: [] as ModuleKey[],   // Odoo dependency chain
    dataTables: ['sales_deals','sales_invoices','sales_leads','sales_clients'],
  },
  // …
}
```

`GET /api/session` (already returns `role`, `companyIds`, `companies`) gains a
`modules[]` manifest: for each key, `{ key, label, href, icon, space, state }`
where `state ∈ 'enabled' | 'locked_plan' | 'locked_role'`. The sidebar renders
that array and nothing else. This kills defect #2 permanently — drift becomes
structurally impossible because there is only one list.

**R1.2 — Close the registry/route gap (defect #3).** Add module keys for
`accounting`, `tax`, `people` (employees), `website`. Give `mentor`, `goals`,
`rnd` nav entries or drop them. `/dashboard`, `/profile`, `/command` are shell
routes, not apps — they belong in the topbar/footer, never in the module list.

**R1.3 — Spaces, not hardcoded groups.** Keep the current five groups as the
*default* Spaces (`revenue`, `growth`, `people`, `knowledge`, `system`) but move
them to a `space` field on each module and add a **Pinned** space at the top
(Microsoft 365's pin behaviour), persisted per user, not per company. Existing
`localStorage`-backed group collapse in `sidebar.tsx` is already the right
mechanic — extend it, don't replace it.

**R1.4 — `/apps` is a real page, not a launcher popover.** This is the Odoo
Apps dashboard: card grid of every module, filter chips (`All` / `Enabled` /
`Available` / by Space), search input, and a state badge per card. Locked cards
render with a lock glyph and a `Pro`-style badge (§4.5), never hidden — the
feature-gating research is unanimous that visible-but-locked converts and hidden
does not. **A full page, not a modal — this satisfies the no-modals rule by
construction, and it gives the marketplace a URL to link to from email and
billing.**

**R1.5 — Enable and disable both go through slide-overs.** Clicking a card opens
a right-edge slide-over with: what the app does, which tables it writes, which
roles can use it, price delta if any, and the primary button. This is the
CLAUDE.md-compliant translation of Odoo's `Activate` button + uninstall dialog.

**R1.6 — Port Odoo's uninstall confirmation exactly, into the slide-over.** Two
labelled sections — *Apps that will also be disabled* (resolved from `dependsOn`)
and *Data that becomes inaccessible* (resolved from `dataTables`, with live row
counts) — plus a type-to-confirm field. Getting this wrong in a multi-tenant
product means a client admin silently orphans their own billing data. Note the
one deliberate divergence from Odoo: **CBOP disables, it never deletes.**
`company_modules.is_enabled = false` hides the app and 403s its routes; rows stay
on disk. Say so in the slide-over copy — "your data is retained and returns if
you re-enable" removes the biggest single objection to trying a module off.

**R1.7 — Cross-app search stays a command palette, not a search bar.**
`CLAUDE.md` bans a global search bar outright. Zoho's Zia Search value —
"don't keep 15 tabs open" — is real, but the compliant expression of it is the
existing `command-palette.tsx` (SOP #17): extend it from route-jumping to
returning records across enabled modules, scoped to the active org. Zero new
chrome, no constraint violated.

**R1.8 — One page shell component, enforced.** Rippling's "learn it once, know
it everywhere" is a component decision, not a design decision. Build
`<AppPage title tabs filters primaryAction>` and make every module route use it.
The payoff compounds per module and is why adding app #19 will be cheap.

---

## §2 — Organization / workspace switching

### 2.1 What real products do

**Linear** ([docs](https://linear.app/docs/workspaces)). A workspace is *"the
home for all issues and interactions in an organization."* One account, many
workspaces, each with **distinct member lists and separate billing plans**.
Switching: click the workspace name top-left → *Switch workspace*, or press
`O` then `W`. Roles are per-workspace — Members see personal settings only;
Admins/Owners get workspace administration. Mobile: long-press the Home icon.
Linear's own guidance is worth internalizing: **stay in one workspace if you
can — the single workspace is the conceptual model the product was designed
around.** Multi-workspace is an escape hatch, not the happy path.

**Slack.** Workspace icon top-left opens the list of signed-in workspaces;
`⌘/Ctrl + Shift + S` toggles a persistent **workspace rail** down the left edge;
icons are drag-reorderable; mobile is a swipe-right from Home
([Slack](https://slack.com/help/articles/1500002200741-Switch-between-workspaces)).
Enterprise Grid adds an **All workspaces** dropdown at the top of the sidebar
that *filters* the current view by workspace rather than switching to it.
The instructive failure: the 2023 redesign removed the rail, multi-workspace
users revolted, and **Slack restored it as an optional feature**
([TidBITS](https://tidbits.com/2023/09/21/how-to-restore-the-slack-workspace-sidebar/)).
Never make context-switching cost a click for the people who do it fifty times a
day.

**Vercel.** The **scope selector** sits top-left of the dashboard and is the
gate on everything — you must select the team before you can manage its members
([docs](https://vercel.com/docs/rbac/managing-team-members)). Scope is in the
**URL**: `vercel.com/[team]/[project]`, `/[team]/~/settings/billing`. There's a
**default team** setting (`vercel.com/account/settings` → Default Team) that
decides where `/dashboard` lands you, and Vercel auto-reassigns it if you leave
that team ([docs](https://vercel.com/docs/accounts)). The **26 Feb 2026**
navigation redesign moved horizontal tabs into a resizable, hideable sidebar,
unified the tab set across team *and* project scope, and made **projects act as
filters so you can switch between the team and project version of the same page
in one click** ([changelog](https://vercel.com/changelog/dashboard-navigation-redesign-rollout)).
That last one is the sharpest idea in this section — see R2.3.

**Notion.** Workspace switcher at top-left of the sidebar, and critically it
also holds **Add another account**, so one app instance spans multiple *identities*,
not just multiple orgs. The sidebar itself splits into **Teamspaces / Shared /
Private** with Favorites pinned above, and the recent redesign folded Home,
Recents, Favorites, Teamspaces, Agents, and notifications into that one sidebar
([Notion Help](https://www.notion.com/help/navigate-with-the-sidebar)).

### 2.2 Pattern summary

| Pattern | Product | Take it? |
|---|---|---|
| Switcher top-left, adjacent to the product mark | Linear, Slack, Notion, Vercel | **Yes** |
| Org identity in the **URL**, not just client state | Vercel `/[team]/…`, GitHub `/[org]` | **Yes — highest priority in this doc** |
| Keyboard shortcut to switch | Linear `O W`, Slack `⌘⇧S` | **Yes** — fold into command palette |
| Persistent rail for heavy switchers, opt-in | Slack | Later — only when a real user has 5+ orgs |
| Per-org roles and per-org billing | Linear, Vercel | **Yes** — CBOP is half-way there already |
| Default org on login, auto-reassigned when invalid | Vercel | **Yes** — cheap, prevents a dead landing page |
| Filter-by-org (see all orgs at once) rather than switch | Slack Enterprise Grid, Vercel project filters | **Yes** — this *is* Bala's `creator` cross-company view |
| Multiple identities in one switcher | Notion | No — CBOP is one account, many orgs |

### 2.3 The `creator` insight

CBOP's `creator` role — sees all companies, bypasses every gate — is exactly
Slack Enterprise Grid's **All workspaces** mode and Vercel's team-vs-project
filter, arrived at independently. Frame it that way in the UI: the org switcher's
first entry for `creator` is **All companies** (a filter state, showing the union
with a per-row company column), and every other entry is a scope switch. This
also gives the roll-up view that `docs/modules/ACCOUNTING_Build_Plan.md` flags as missing
across finance widgets — same control, one implementation.

### 2.4 CBOP recommendation

**R2.1 — Put the org in the URL (fixes defect #1).** Adopt Vercel's shape:
`/[orgSlug]/sales`, `/[orgSlug]/settings/billing`. Concretely, move
`app/(dashboard)/*` under `app/(dashboard)/[org]/*`. Consequences, all good:
server components read the active org from `params` instead of guessing;
`requireAuth` stops hardcoding `companyIds[0]`; links are shareable and land the
recipient in the right tenant; browser history and back-button work per tenant.
`companies.slug` needs adding (unique, immutable) — `companies.invoice_prefix`
already proves the pattern of a short stable company code.

**R2.2 — Server-side scope enforcement, always.** With the org in the path,
`requireAuth` resolves it from the request and rejects orgs not in `companyIds`
(and never trusts a header or cookie for it). `enabledModules` and
`allowedModules` then load for the **requested** org. `localStorage` in
`company-context.tsx` drops to remembering the *last* org for a bare `/` visit —
a convenience, never an authorization input. **This is the single highest-value
change in this document**; every other multi-tenant feature is unsound without
it.

**R2.3 — Steal Vercel's "same page, other scope" rule.** Switching orgs must
keep you on the equivalent page — `/acme/sales/invoices` → `/globex/sales/invoices`
— not dump you at the dashboard. If the target org doesn't have that module
enabled, land on that org's `/apps` with the module card focused and its
locked-state slide-over open. That failure mode becomes a discovery moment
instead of a dead end.

**R2.4 — Keep the switcher a topbar popover; add keyboard access.** The existing
`topbar.tsx` dropdown is correct and is *not* a modal (no overlay, no focus trap,
dismisses on outside click — same class as the profile menu already shipped).
Add: search input once a user exceeds ~7 orgs, a checkmark on the active row,
role badge per row (users hold different roles in different orgs), and `O` then
`W` wired through the command palette.

**R2.5 — Default org, and handle its absence.** Store `users.default_company_id`.
`/` redirects there. If it's null or no longer in `companyIds`, fall back to the
first alphabetically and rewrite the stored value (Vercel's auto-reassign). A
user with zero orgs is a real state in a self-serve product — route them to
onboarding (§3), never to an empty dashboard.

**R2.6 — Do not build cross-org data views beyond `creator`'s roll-up.** Linear's
advice applies: one workspace is the conceptual model. A tenant admin managing
three subsidiaries is the *only* legitimate multi-org user, and the roll-up in
§2.3 already serves them. Resist per-widget "show all orgs" toggles — that's how
the current accounting page ended up with a company selector that half its
widgets ignore (`docs/modules/ACCOUNTING_Build_Plan.md`, root-cause section).

---

## §3 — Onboarding: self-serve signup → org → invite → module selection

### 3.1 What real products do

The largest structured sample available is an audit of **37 B2B SaaS onboarding
flows** ([Ofspace](https://www.ofspace.co/blog/b2b-saas-onboarding-flows-audit)).
Every one of the 37 followed the same five-stage architecture:

1. Account access (37/37)
2. Context collection **after** signup (37/37)
3. Workspace preparation (37/37)
4. Scaffolded first state — never a blank workspace (37/37)
5. A clear, real first task (37/37)
6. Continued support after dashboard entry (30/37)

The counter-intuitive findings are the useful ones:

- **Progress bars are not required.** All 37 made the next action obvious; only
  **15/37 (41%)** showed explicit progress UI.
- **Persistent checklists are not required.** 30 kept onboarding alive past the
  dashboard; only **22** used a persistent checklist. Contextual prompts and task
  cards substitute fine.
- **Blank-state prevention *is* required** — 37/37 prevented it, but only 22 used
  labelled demo data. Templates, guided prompts, and structural callouts count.
- **Early team invite is the minority choice** — only **15/37** invited teammates
  early. Individual-first activation dominates.
- **22/37 offered skip/defer** on configuration steps.

Named sequences from the same audit: **Pipedrive** = contact → activity → deal,
with sample data that demonstrates the *relationships*, not just the rows.
**Maze** = create study → recruit → analyze → share (mirrors the actual job).
**Mixpanel** = progressive disclosure across separate work-type / role /
organization screens rather than one long form.

Product-specific teardowns worth copying directly:

- **Notion** asks one routing question — *"What will you use Notion for?"* — and
  that answer changes templates, sidebar layout, and example pages. Reported
  **55% onboarding completion vs a 20–30% industry average**, with much of the
  lift attributed to that single question
  ([Flowjam](https://www.flowjam.com/blog/saas-onboarding-best-practices-2025-guide-checklist)).
- **Stripe** is progressive setup: the first screen asks only business name and
  country; every further layer appears at the moment it's needed.
- **Linear** teaches `⌘K` upfront and bets the product on it, and uses
  pre-populated sandboxes/sample issues so the first session isn't empty.
- **Figma / Slack** are action-first: a real artifact exists inside the first
  minute; learning happens around it, not before it
  ([saasui.design](https://www.saasui.design/blog/saas-onboarding-flows-that-actually-convert-2026)).
- **Rippling**, the closest structural match, sequences: company profile →
  employee data import (CSV or integration) → **module activation** → per-module
  configuration with best-practice defaults
  ([teardown](https://nextsprints.com/guide/rippling-product-teardown-analysis)).

### 3.2 Pitfalls, with the numbers

| Pitfall | Evidence | Guard |
|---|---|---|
| Verification wall between signup and first value | **8,325 of 25,000** users abandoned between account creation and email verification | Async verification — let them work while the email lands; SSO/social bypasses it entirely (SOP #14) |
| Too many signup fields | Every extra field ≈ **7%** conversion | ≤3 fields. Everything else is post-signup context |
| Invite asked before the user has anything worth sharing | Only 15/37 invite early; accounts with **3+ active users churn at a fraction** of single-user rate | Invite *after* first real artifact — but do invite |
| Empty dashboard on first entry | 37/37 prevented it | Seed demo data, scoped and deletable |
| Personalization crammed into one long form | Named as a top pitfall; Mixpanel splits it | One question per screen |
| Onboarding tasks that are product tours, not work | Named pitfall | The first task must produce a real record |
| No skip route for experienced admins | 22/37 offer it | Skip on every configuration step |

### 3.3 CBOP's onboarding sequence

The one place `CLAUDE.md`'s slide-over rule must bend, and it should be stated
explicitly rather than worked around: **onboarding is a separate route group,
`app/(onboarding)/`, with its own minimal chrome and no sidebar.** It is not a
create-form inside the app — there is no app yet. The slide-over rule governs the
authenticated product shell; a pre-tenant wizard is outside it. (The subdomain
"app inside an app" precedent for `/accounting` in
`docs/modules/ACCOUNTING_Build_Plan.md` is the same reasoning.)

```
/signup           email + password, or Google/passkey (SOP #14). 3 fields max.
                  Async verification — never block on the email.
   ↓
/onboarding/org   Company name → slug auto-derived + editable (this is the §2.1
                  URL identity, so get it right once). Country/currency, since
                  invoicing is ₹/en-IN today and this must not be assumed later.
                  ONE screen.
   ↓
/onboarding/use   Notion's routing question, CBOP-flavoured:
                  "What do you run on CBOP?" — multi-select over Spaces
                  (Revenue · Growth · People · Knowledge). Not modules — Spaces.
                  Four cards beats eighteen checkboxes.
   ↓
/onboarding/apps  Pre-checked module list derived from the answer above; every
                  box editable. This writes company_modules. Skip = accept the
                  defaults. Show price delta live if plans are per-app (§4).
   ↓
/[org]/dashboard  Seeded: 1 demo client, 1 demo deal, 1 demo invoice, 1 demo
                  project + task — all tagged is_demo and bulk-deletable from a
                  dismissible banner. Pipedrive's lesson: the seed must show the
                  RELATIONSHIPS (deal→client→invoice→project→task), which is
                  precisely what CBOP's ops_tasks.project_id NOT NULL rule is
                  about.
                  First task card: "Create your first real client."
   ↓
(after first real record is created) → invite prompt, not before
```

### 3.4 CBOP recommendation

**R3.1 — Ask one routing question, at the Space level.** Four cards, multi-select.
It drives the module pre-check, the sidebar's default expanded Spaces, and the
seed data. Notion's 55%-vs-20–30% number comes from exactly this move and it
costs one screen.

**R3.2 — Module selection is a step, not a settings page you hope they find.**
Rippling puts module activation in the setup sequence. `company_modules` already
exists; this screen is its create path, and it's the moment a tenant forms an
opinion about what they bought.

**R3.3 — Seed demo data, tagged and reversible.** Add `is_demo BOOLEAN DEFAULT
false` to the seedable tables (`sales_clients`, `sales_deals`, `sales_invoices`,
`ops_projects`, `ops_tasks`). One banner: *"Showing sample data — Remove sample
data."* The alternative — an empty CRM on first login — is the single most-cited
onboarding failure in the sources above.

**R3.4 — Delay the invite until after the first real record.** Then use a
slide-over from the topbar (compliant), pre-filled subject and body so the admin
isn't staring at a blank message. `api/routes/settings.ts` already has an invite
path with `genTempPassword`/`newAuthId` — reuse it, don't rebuild it.

**R3.5 — Skip on every configuration screen; no progress bar.** 22/37 offer skip;
only 41% show progress. Instead of a bar, put a **contextual task card on the
dashboard** that survives past onboarding — this covers the 30/37 that continue
activation post-entry without committing to checklist infrastructure.

**R3.6 — Teach `⌘K` on first dashboard load.** Linear's bet, and CBOP already has
the palette built. One dismissible inline hint in the topbar. This matters more
for CBOP than for most products because the no-global-search-bar rule means the
palette is the *only* way to search — a user who never discovers it experiences a
product with no search at all.

---

## §4 — Billing and plan management for a modular multi-app SaaS

### 4.1 The three real-world models

**Zoho One — bundle, two seat models** ([Zenatta pricing
guide](https://zenatta.com/zoho-pricing-guide-2025/), 2026 figures):
- *All-Employee*: **$37/employee/mo** annual, **$45** monthly — but you must
  license **every** employee.
- *Flexible User*: **$90/user/yr** or **$105/user/mo** — license only who you
  choose.
- Break-even sits at roughly **41% of headcount** needing access.

The lesson isn't the numbers, it's the shape: **Zoho does not sell apps
individually.** One price, all 50 apps, and the only decision is *how many
people*. That eliminates an entire class of "which app am I paying for" support
tickets — and it is the reason Zoho can ship 50 apps without a pricing page that
needs a spreadsheet.

**Atlassian — per-product billing** ([Atlassian
Support](https://support.atlassian.com/subscriptions-and-billing/docs/manage-subscriptions-and-bills-for-atlassian-cloud-products/)).
`admin.atlassian.com` → *Subscriptions and billing* → *Manage subscriptions*,
showing **each cloud product with its own billable-user count or user tier**.
Some subscriptions are per-user only; some are per-user **plus** usage-based
components. Billing admin is a distinct role from product admin, and billing
accounts are separate from organizations. This is the honest cost of per-product
pricing: users must be counted per product, the admin surface multiplies, and
"who is a billing admin" becomes its own support category (there's a whole
community thread on just that question).

**The 2026 market position** — hybrid has won:
- Chargebee's 2025 State of Subscriptions: **43%** of companies on hybrid
  models today, projected **61% by end of 2026**
  ([SaaS Mag](https://www.saasmag.com/hybrid-pricing-saas-growth-2026/)).
- **Seat-only models show ~2.3× higher churn** than hybrid or usage-based.
- Hybrid adopters report **+38%** revenue growth and **+38%** net revenue
  retention vs pure subscription.
- IDC forecasts **70% of software vendors move off pure per-seat by 2028**, as
  AI agents reduce human seat counts.
- Critical UX finding: *"customers will only accept usage-based billing if they
  trust their ability to monitor and control it"* — **ship the usage dashboard
  first, separately from billing**, to decouple visibility from pricing risk.
- On migrations: **grandfather existing contracts** through a transition period,
  and announce **6–12 months ahead** for enterprise.

### 4.2 Self-serve mechanics

Stripe's **Billing customer portal** is the default build-vs-buy answer: hosted
UI for plan switch, payment-method update, pause, cancel, and invoice download,
configured under *Settings → Billing → Customer portal* by naming which prices
customers may switch between
([Stripe](https://stripe.com/blog/billing-customer-portal),
[docs](https://docs.stripe.com/no-code/customer-portal)). Stripe Billing costs
**0.7% per recurring transaction** on top of processing, in exchange for
proration, dunning, invoicing, and smart retries. One configuration detail with a
direct churn effect: set cancellation to **at end of billing period** rather than
immediate, so no proration refund fires the instant someone clicks cancel and
they keep access through the paid term.

### 4.3 Feature-gating UX (how locked modules should look)

From the 2026 gating literature
([Docsie](https://www.docsie.io/blog/glossary/feature-gating/),
[Orbix](https://www.orbix.studio/blogs/saas-ui-patterns-conversion)):

- **Gate at the moment of intent, not the moment of work.** Prompts triggered
  when a user actually reaches for the feature convert at **~12% vs ~5%** for a
  generic paywall.
- The prompt must name **three things**: the exact feature, the plan that
  unlocks it, and the concrete benefit.
- **Visible but not obstructive** — lock glyphs, tier badges, a partial preview.
  Slack's canonical version: full product use until the 90-day history limit
  bites.
- **Never gate before core value is experienced** — early paywalls raise churn,
  not upgrades.

### 4.4 CBOP recommendation

**R4.1 — Bundled tiers with module *packs*, not à-la-carte per-app pricing.**
Zoho's shape, not Atlassian's. Reasons, specific to CBOP: 18 modules à la carte
is 2^18 billable configurations and an admin surface that must count users per
module; the modules are heavily cross-referential (an invoice touches `sales`,
`finance`, `documents`, `templates`, `email_studio` — per-app billing makes that
a support conversation); and Atlassian's own docs show the complexity tax
(separate billing accounts, separate billing-admin role, per-product user tiers).
Concretely, map packs onto the existing `space` grouping from R1.1:

| Tier | Spaces / modules included | Shape |
|---|---|---|
| **Core** | `work`, `documents`, `templates`, `goals` | per-seat |
| **Revenue** | Core + `sales`, `accounting`, `tax`, `finance` | per-seat |
| **Growth** | Core + `campaigns`, `email_studio`, `subscribers`, `social`, `blog`, `seo`, `website` | per-seat + usage (emails sent, posts published) |
| **Full OS** | everything incl. `hiring`, `mentor`, `audit`, `legal`, `rnd` | per-seat, best rate |

Hybrid because of the 2.3× churn delta: seats for the platform, metered only
where cost genuinely scales with volume (outbound email via `mailer.ts`, LLM
calls through `openclaw.ts`/`local-llm.ts`, PDF generation). Those are the only
three places CBOP's marginal cost is real.

**R4.2 — Add provenance to `company_modules` (fixes defect #4).**

```sql
ALTER TABLE company_modules
  ADD COLUMN source TEXT NOT NULL DEFAULT 'plan'
    CHECK (source IN ('plan','admin','trial')),
  ADD COLUMN trial_ends_at TIMESTAMPTZ;
```

Resolution order at read time: `plan` grants the entitlement ceiling → `admin`
may turn a granted module **off** but never on → `trial` grants temporarily with
an expiry. Without this, a downgrade-then-re-upgrade cycle cannot restore the
admin's actual intent, and trials have nowhere to live. Do this **before** any
billing code — retrofitting provenance onto rows already written by a plan
change is materially harder.

**R4.3 — Ship the usage dashboard before the metering.** Per the hybrid-pricing
research, this is what buys acceptance. `/[org]/settings/usage`: seats used vs
included, emails sent this cycle, LLM calls, storage. Read-only, no pricing
attached, shipped first. Then attach billing to it later.

**R4.4 — Buy the portal, own the plan picker.** Stripe's hosted portal handles
payment method, invoice history, cancel, and dunning — do not rebuild any of
that. Build only the CBOP-native plan/module picker, because it must render
against the module registry and show exactly which apps a change adds or removes.
Configure cancellation as *at end of billing period*.

**R4.5 — Locked module states, three of them, everywhere.** The `state` field
from R1.1 renders identically in the sidebar, `/apps`, and the command palette:

| State | Sidebar | `/apps` card | Click behaviour |
|---|---|---|---|
| `enabled` | normal link | normal card | navigate |
| `locked_plan` | dimmed + lock glyph + tier badge | dimmed + `Revenue` badge | slide-over: *what it does · which plan · what it adds · Upgrade* |
| `locked_role` | **hidden** | hidden | n/a — a permission failure must not read as an upsell |

The `locked_plan` slide-over is where the 12%-vs-5% "moment of intent" number
lives, and it satisfies the three-things rule (feature, plan, benefit).
Separating `locked_role` from `locked_plan` matters: showing an upgrade CTA to a
user whose *role* excludes a module generates a support ticket their admin has
to answer, and this is precisely the bug already documented in
`docs/modules/ACCOUNTING_Build_Plan.md` where non-`ceo` users hit blanket 403s with no
explanation.

**R4.6 — Billing is its own admin role.** Atlassian's split. Add `billing_admin`
as a grantable capability rather than folding billing into `ceo` — a real tenant
routinely has a finance person who must see invoices and touch nothing else, and
`role_module_access` (migration 057) already provides the mechanism.

---

## §5 — Admin console IA (a tenant admin managing their own org)

### 5.1 What real products do

**Vercel team settings** ([docs](https://vercel.com/docs/accounts)) — sections
under `/[team]/~/settings/`: General (name, ID, avatar, **Leave Team**, **Delete
Team** at the bottom), Members (+ **Collaboration** sub-section), Billing (with a
**paid add-ons** area — SAML SSO is literally a purchasable add-on for Pro),
Security & Privacy (where Owners configure SAML), Environment Variables, Domains,
Log Drains. Patterns worth copying: destructive actions live at the **bottom of
General**, never in a menu; membership has **Auto Approval vs Manual Approval**
modes with owner notification either way; new members land on a specific default
role (Developer), never the most-privileged one.

**GitHub org settings** ([docs](https://docs.github.com/en/organizations/keeping-your-organization-secure/managing-security-settings-for-your-organization/reviewing-the-audit-log-for-your-organization))
— the audit log is the part with the most transferable detail:
- Lives under an **Archive → Logs → Audit log** section; **owners only**.
- **180-day retention**, with only the last 3 months shown by default.
- **No free-text search.** Structured qualifiers only: `operation:create|modify|remove`,
  `actor:username`, `repo:org/name`, `created:>=YYYY-MM-DD` (ISO 8601, supports
  `..` ranges), `country:`. Combinable: `actor:octocat operation:create created:2014-07-08`.
- Event names follow **`category.operation`** — `repo.create`, `team.modify`,
  `billing.*`, `hook.*` — across 40+ categories.
- **Export as JSON or CSV**, capped at 100 MB compressed / 10 minutes.
- Docs explicitly steer real-time needs to **webhooks**, not log polling.

**Slack admin** ([Guide to the admin
dashboard](https://slack.com/help/articles/115005594006-Guide-to-the-Slack-admin-dashboard))
— *Tools & settings → Organization settings* opens a **separate browser page**
with its own left sidebar of expandable sections (Workspaces, People → Members &
guests, Permissions, Settings, Apps, Analytics). **System roles** let one user
hold several narrow admin roles rather than one god role. Org-level config
applies to every workspace beneath it.

**Zoho One admin panel** ([Zenatta](https://zenatta.com/zoho-one-admin-panel/))
— the fullest IA of the four, and the closest to CBOP's target:
Dashboard (user counts, login activity, app usage, **flags inactive users and
underused applications**) · Getting Started (video + setup checklists) ·
Organization Details (name, address, timezone, work locations for geo-fencing) ·
**Applications** (add/remove/organize apps; assign users and roles *during* app
setup) · Users (create with app+group assignment in the same step; **Full Admins**
vs **Service Admins** scoped to specific apps) · Roles & Groups · Security
Policies (password rules, MFA, IP restrictions, session timeout — appliable
conditionally by role/group) · Domains · Device Management · Reports & Audit
Logs · Licensing & Billing (reached from the **profile menu**, not the left nav).

Two Zoho mechanics deserve special attention:
- **Conditional Assignment** — apps and roles are granted automatically by rule
  (department, group, title) rather than one-by-one, explicitly to reduce missed
  permissions at onboarding
  ([Zoho Directory docs](https://help.zoho.com/portal/en/kb/directory/admin-guide/conditions/articles/add-condition)).
  Four assignment methods exist: individual, group, everyone, conditional.
- **Smart Offboarding** — one screen handles department transfer, device
  handling, and removal of the user's data across every app.

**Microsoft 365 admin center** — left nav of Users / Teams / Billing / Settings
(→ Org settings) / Reports / **Health** (real-time service status and active
incidents), plus **specialist workspaces** (SharePoint, Teams, Exchange,
Security, Compliance, Entra ID) that break out of the main console entirely. Any
frequently-visited page can be **pinned** via a pushpin icon.

### 5.2 The convergent IA

Five products, one skeleton. Ordered by how often an admin touches it:

```
/[org]/settings
  ├─ General            name, slug, logo, timezone, currency
  │                     …danger zone at the BOTTOM (Vercel)
  ├─ Members            list · role per member · invite · pending · deactivate
  │                     └ Access rules   (Zoho Conditional Assignment)
  ├─ Roles              custom roles × module matrix  ← role_module_access exists
  ├─ Apps               module enablement matrix      ← company_modules exists
  ├─ Billing            plan · seats · usage · invoices · payment method
  ├─ Integrations       n8n · Outline · OpenClaw/bridge · SMTP · GA/GSC · LinkedIn
  ├─ Security           MFA · session timeout · IP allowlist · SSO/SAML
  ├─ Audit log          structured filters · export      (GitHub model)
  └─ Health             job/agent/automation status      (M365 model)
```

Cross-cutting rules the five products agree on:
1. **Admin is a scoped area with its own left nav** — Slack goes as far as a
   separate page. Never scatter admin controls across product pages.
2. **Destructive actions at the bottom of General**, with confirm-by-typing.
3. **Billing sits slightly apart** — Zoho puts it under the profile menu,
   Atlassian on a separate billing account. It has a different audience.
4. **Split admin roles.** Slack system roles, Zoho Full vs Service Admins,
   Atlassian billing admins. One god-admin is the anti-pattern.
5. **Audit log is filter-driven, not search-driven** (GitHub), with export.

### 5.3 CBOP recommendation

**R5.1 — Restructure `/settings` into the nine sections above**, as tabs down a
sub-sidebar inside the settings route (this is CBOP's version of Slack's separate
admin page — same isolation, no new app). Two of the nine already have working
backends: **Apps** is `GET/PATCH /api/settings/modules`, **Roles** is
`/api/settings/roles` + `role_module_access`. Those two ship first because
they're already built and they're the marketplace's control surface.

**R5.2 — Scope the Apps matrix to one org.** `GET /api/settings/modules`
currently returns **every company × every module** — correct for a 3-user
internal tool with one `creator`, a cross-tenant data leak the moment a real
tenant admin calls it. Add the org from the URL as a filter and enforce it
against `companyIds`. **Ship this with R2.1 or before; it is the most
security-relevant single line in this document.**

**R5.3 — Adopt Zoho's Conditional Assignment for member onboarding.** A rule
row — *"role = Sales → grant Revenue pack modules"* — evaluated on member
creation. It reuses `role_module_access` entirely; the only new thing is the
rule table and a slide-over to author rules. Zoho's stated rationale (fewer
missed permissions at onboarding) is exactly the failure mode a tenant admin
hits at 20 employees.

**R5.4 — Copy GitHub's audit-log UX literally.** `audit_logs` already exists in
the schema and `/audit` already has a page. Make it: structured filter chips
(actor / module / operation / date range) instead of a text box — which is
**also** the no-global-search-bar rule satisfied for free; event names as
`category.operation` (`invoice.create`, `module.disable`, `member.role_change`);
CSV + JSON export; a stated retention window. **Do not build free-text search
over the audit log** — GitHub explicitly doesn't, and structured filters are both
faster and compliant.

**R5.5 — `/settings/health` is the M365 Health page.** CBOP already tracks
`system_jobs`, agent runs, and n8n automation status (`MASTER.md` §13). Surface
it to tenant admins: last run, status, next scheduled, for each of the 6 n8n
automations and the agent set. In a self-hosted multi-tenant OS, "is the
automation running" is the #1 support question and this deflects it.

**R5.6 — Every settings edit opens a slide-over.** Member role change, integration
credential, role definition, module toggle-with-consequences — all right-edge
panels over the settings table (`app/components/slide-over.tsx` already exists).
Only the danger zone in General is inline, and it uses type-to-confirm rather
than a dialog, keeping the no-modals rule intact.

**R5.7 — Split the god-role now, not later.** `creator` must stay exactly as it
is (`CLAUDE.md` is explicit). But tenant-side, introduce **Owner** (everything
incl. billing + delete org), **Admin** (members, roles, apps, integrations, no
billing), **Billing admin** (billing only), **Member** (product access per
`role_module_access`). All four are expressible in the existing tables.

---

## §6 — Notification and activity center across many apps

### 6.1 What real products do

**Linear's Inbox** is the reference implementation
([docs](https://linear.app/docs/inbox)):
- **Split layout** — notification list on the left, full issue detail on the
  right; you triage without navigating away.
- **Keyboard-complete**: `G` `I` to open from anywhere · `J`/`K` or arrows to
  move · `U` read/unread, `Opt+U` all read · `Backspace` delete, `Shift+Backspace`
  delete all read · `H` snooze · `Shift+S` unsubscribe · `⌘F` quick-search
  within the inbox by title, ID, type, assignee, team, project, priority.
- **Explicit subscription model**: auto-subscribed when you create, are assigned,
  or are @mentioned — and you can unsubscribe from any thread. Users always know
  *why* something reached them.
- **Snooze hides until a time; reminders reappear and pin to the top of the
  issue.** Two different mechanics, not one.
- Display settings toggle showing/hiding snoozed and read items.
- Hard cap: **2,000 open notifications**, older ones discarded.
- Recent addition: filter the inbox **by actor** — including agents — so a noisy
  bot can be cleared in one action.

Linear's routing logic, as analyzed in a 2026 teardown
([Medium](https://medium.com/@arjundesigns/linears-notification-system-treats-attention-as-abundant-it-isn-t-646f5f44b8ae)),
sorts every notification into **three tiers by consequence**:

| Tier | Contains | Delivery |
|---|---|---|
| 1 — Interrupt | assigned to you, direct @mention, blocker on your work | breaks through regardless of state (push) |
| 2 — Ambient | comments, status changes, due-date moves | in-panel only, no push |
| 3 — Digest | reactions, watched-item updates, broad team activity | collapsed by default, surfaced on demand |

**Slack** rebuilt around this too: the 2023–24 redesign added a dedicated
**Activity** hub and a separate DMs tab in a left rail, specifically so
multi-workspace users could see everything demanding attention in one place
([AlternativeTo](https://alternativeto.net/news/2023/8/slack-undergoes-a-major-redesign-in-years-introducing-a-new-dedicated-dm-tab-and-an-activity-hub/)).

**Notion** renamed sidebar *Updates* to **Inbox** explicitly for better triage
workflows, and the newer sidebar redesign put navigation, AI threads, and
notifications into one consistent surface
([Notion Help](https://www.notion.com/help/navigate-with-the-sidebar)).

**Zoho One's Action Panel** is the multi-app version: one view consolidating
upcoming meetings, unread messages, emails, and tasks pulled from across all 50
apps — the cross-app inbox as a *platform* feature rather than a per-app one.

### 6.2 CBOP recommendation

CBOP has `app_notifications` (migration 058), `/api/notifications`, and a bell
dropdown with a 30-item list polled every 60 seconds. That's a per-app-era
notification widget. A Super OS with 18 apps needs an inbox.

**R6.1 — Promote the bell dropdown to a real Inbox page at `/[org]/inbox`**, with
Linear's split layout: list left, detail right. Keep the bell as the unread count
plus a peek of the top 5 and a *"View all"* link — Slack kept both the rail and
the activity view for the same reason. The current dropdown is the peek; it
doesn't have to change much.

**R6.2 — Add the three-tier column and route on it.** This is the highest-value
schema change in this section:

```sql
ALTER TABLE app_notifications
  ADD COLUMN tier SMALLINT NOT NULL DEFAULT 2
    CHECK (tier IN (1,2,3)),
  ADD COLUMN module_key TEXT,
  ADD COLUMN snoozed_until TIMESTAMPTZ,
  ADD COLUMN actor_user_id UUID REFERENCES users(id);
```

Tier decides delivery, and CBOP already has the delivery channels wired: **tier 1
→ in-app + Telegram/WhatsApp via `sendViaHermes()`**, tier 2 → in-app only, tier
3 → rolled into the existing morning briefing. Mapping CBOP's real events:

| Event | Tier | Why |
|---|---|---|
| Invoice overdue (yours) | 1 | money, actionable now |
| Task assigned to you | 1 | direct assignment — Linear's exact rule |
| Deal stuck 7+ days (your deal) | 1 | already an alert-bar trigger |
| Agent/automation job **failed** | 1 | silent failure is the worst state in an ops OS |
| Comment / status change on watched record | 2 | ambient |
| Someone else closed a deal | 2 | ambient |
| Campaign sent, blog published, SEO crawl done | 3 | digest |
| Automation succeeded | 3 | digest — never notify on success |

**R6.3 — `module_key` on every notification, and filter by it.** In an 18-app OS
the first question is always *which app is this from*. Filter chips across the
inbox top (All · Sales · Work · Hiring · …), rendered from the same manifest as
the sidebar. Add Linear's actor filter too — CBOP's agents (`morning_briefing`,
`deal_invoice_tasks`, `social_media`) are exactly the noisy non-human actors
Linear built that filter for.

**R6.4 — Snooze and read/unread, with Linear's keyboard set.** `G` `I`, `J`/`K`,
`U`, `H`, `Backspace` — the palette registry from SOP #17/#32 should own these
bindings so they don't collide with per-page shortcuts.

**R6.5 — Make the subscription model visible.** Every notification detail states
*why you got this* ("You're assigned", "You created this project", "You're the
company CEO"), with an unsubscribe affordance. Linear's model works because the
reason is never a mystery; without it, users mute everything and the channel dies.

**R6.6 — Scope the inbox to the active org, with a cross-org count for `creator`.**
Consistent with §2: the inbox is per-tenant. `creator` (and any multi-org user)
gets a per-org breakdown in the bell, so a switch is a deliberate act, not a
surprise.

**R6.7 — Cap and prune.** Linear caps at 2,000 open notifications. Set a cap and
a retention window on `app_notifications` before multi-tenant volume arrives —
per-user unbounded notification tables are a well-known way to make a Postgres
instance slow in year two.

---

## §7 — Cross-cutting decisions

### 7.1 Routing and state (settle this before writing nav code)

| Concern | Decision | Precedent |
|---|---|---|
| Org identity | **URL path segment** `/[org]/…` | Vercel `/[team]/[project]`, GitHub `/[org]`, Linear |
| Org resolution | Server-side from `params`, validated against `companyIds` on every request | Vercel scope selector gates member management |
| `localStorage` role | Remember last org for a bare `/` visit — **never** an authorization input | — |
| Module manifest | Server-rendered into the shell via `GET /api/session` | Zoho serves the assigned-app list |
| Entitlement check | Server on every route (`requireModule`), client for rendering only | Already correct in `require-module.ts` |
| Deep links | Every app page addressable as `/[org]/[module]/[view]` | Vercel unified team/project tabs |
| Sub-tenant nesting | **None.** Companies are flat | Linear: "stay in a single workspace" |

### 7.2 The three-layer gate (and CBOP already has two of them)

```
1. ENTITLEMENT   company_modules   "did this tenant's plan buy this app?"   → 402 / upsell
2. PERMISSION    role_module_access "does this user's role include it?"     → 403 / hidden
3. SCOPE         WHERE company_id = ANY($1)  "is this row theirs?"          → filtered
```

This is the split the multi-tenant literature converges on — entitlements as
per-tenant plan configuration checked at both API and UI layers, RBAC as
tenant-scoped roles, and neither substituting for the other
([WorkOS](https://workos.com/blog/developers-guide-saas-multi-tenant-architecture)).
`require-module.ts` implements 1 and 2 in the right order today. What's missing
is **distinct responses**: it currently returns 403 for both, so the UI can't
tell "buy this" from "ask your admin," which is what R4.5 depends on. Return
**402 Payment Required** (or a typed error body) for entitlement failures and
**403** for permission failures.

### 7.3 Compliance with `CLAUDE.md` UI constraints

Nothing in this doc requires breaking the rules. The mapping, explicitly:

| Constraint | How this doc complies |
|---|---|
| Slide-over panels only, no modals | App enable/disable, invites, role edits, integration config, locked-module upsells — all slide-overs. `/apps` is a **page**, not a launcher modal. Uninstall confirmation is a slide-over with type-to-confirm |
| No separate `/create` pages | Org creation lives in `(onboarding)`, which is a pre-tenant wizard, not an in-app create form — the one carve-out, stated deliberately (§3.3) |
| No global search bar, no command palette | The palette already exists and is already mounted in `app/(dashboard)/layout.tsx`; this doc extends its scope rather than adding chrome. The bar-shaped surfaces here — audit log, `/apps`, inbox — are **per-table filters and filter chips**, which the rule permits |
| Table filters only | Inbox module chips, `/apps` state chips, audit-log qualifier chips are all per-table filters |
| Every task requires a project | Demo-seed data (R3.3) must respect `ops_tasks.project_id NOT NULL` — seed the project first |

### 7.4 Build order

Ordered by dependency and by risk, not by visibility:

1. **R5.2** — scope `GET /api/settings/modules` to one org. Cross-tenant leak; one query change.
2. **R2.1 + R2.2** — org in the URL, server-side scope resolution. Everything downstream depends on it.
3. **R7.2** — 402 vs 403 split in `require-module.ts`. Two lines; unblocks R4.5.
4. **R1.1 + R1.2** — one registry, served as a manifest; sidebar renders it. Kills the drift.
5. **R4.2** — `company_modules.source` + `trial_ends_at`. Cheap now, painful later.
6. **R1.4 + R1.5 + R1.6** — `/apps` page with slide-over enable/disable and Odoo-style consequences.
7. **R5.1** — settings restructured into nine sections (Apps and Roles first — backends exist).
8. **R6.1 + R6.2** — inbox page and notification tiers.
9. **§3** — onboarding route group. Only needed once self-serve signup is real.
10. **§4** — billing. Last, and only after R4.3's usage dashboard has shipped standalone.

### 7.5 Open questions for the owner

1. **Do tenants pick apps, or do they pick packs?** R4.1 argues packs (Zoho
   shape). If it's genuinely à-la-carte, the admin surface roughly triples and
   Atlassian's per-product complexity tax applies — worth deciding before
   `/apps` is built, because the page differs.
2. **Can one user belong to multiple tenants?** The schema (`user_companies`)
   says yes. If real customers won't, §2 simplifies substantially and the
   switcher becomes a `creator`-only affordance.
3. **Does `creator` survive the pivot?** It's currently a cross-tenant superuser
   with no audit boundary. In a paying-customer product that's a compliance
   question, not a convenience one.
4. **Self-serve signup, or sales-led provisioning?** §3 assumes self-serve. If
   every tenant is onboarded by hand, the whole onboarding route group becomes an
   internal provisioning tool instead and drops several priority slots.
5. **Is `/accounting`'s subdomain "app inside an app" pattern
   (`docs/modules/ACCOUNTING_Build_Plan.md`) the template for all future apps, or a
   one-off?** If it's the template, the app switcher must handle cross-origin
   navigation and the shared shell has to be a published package — a materially
   different §1.

---

## Sources

Multi-app platforms:
[Constellation Research — Zoho One new UX](https://www.constellationr.com/insights/news/zoho-one-gets-new-ux-moves-closer-business-operating-system-vision) ·
[Reworked — Zoho One unified interface](https://www.reworked.co/digital-workplace/zoho-one-update-brings-unified-interface-and-deeper-ai-integration/) ·
[Odoo 18 — Apps and modules](https://www.odoo.com/documentation/18.0/applications/general/apps_modules.html) ·
[Microsoft Learn — Customize the app launcher](https://learn.microsoft.com/en-us/microsoft-365/admin/manage/customize-the-app-launcher?view=o365-worldwide) ·
[Rippling — Platform](https://www.rippling.com/en-GB/global/platform) ·
[NextSprints — Rippling product teardown](https://nextsprints.com/guide/rippling-product-teardown-analysis) ·
[ClickUp Help — Sidebar](https://help.clickup.com/hc/en-us/articles/12755292456983-Intro-to-the-Sidebar-in-ClickUp-3-0) ·
[ClickUp Help — Hierarchy](https://help.clickup.com/hc/en-us/articles/13856392825367-Intro-to-the-Hierarchy)

Org / workspace switching:
[Linear — Workspaces](https://linear.app/docs/workspaces) ·
[Slack — Switch between workspaces](https://slack.com/help/articles/1500002200741-Switch-between-workspaces) ·
[TidBITS — Restoring the Slack workspace sidebar](https://tidbits.com/2023/09/21/how-to-restore-the-slack-workspace-sidebar/) ·
[Vercel — Account management](https://vercel.com/docs/accounts) ·
[Vercel — Dashboard navigation redesign (Feb 26, 2026)](https://vercel.com/changelog/dashboard-navigation-redesign-rollout) ·
[Vercel — Managing team members](https://vercel.com/docs/rbac/managing-team-members) ·
[Notion — Navigate with the sidebar](https://www.notion.com/help/navigate-with-the-sidebar)

Onboarding:
[Ofspace — audit of 37 B2B SaaS onboarding flows](https://www.ofspace.co/blog/b2b-saas-onboarding-flows-audit) ·
[saasui.design — 8 onboarding patterns with real examples (2026)](https://www.saasui.design/blog/saas-onboarding-flows-that-actually-convert-2026) ·
[Flowjam — SaaS onboarding best practices + checklist](https://www.flowjam.com/blog/saas-onboarding-best-practices-2025-guide-checklist) ·
[Userpilot — onboarding funnel / time-to-first-value](https://userpilot.com/blog/saas-user-onboarding-funnel/)

Billing & gating:
[Zenatta — Zoho pricing guide (2026)](https://zenatta.com/zoho-pricing-guide-2025/) ·
[Atlassian — Manage subscriptions and bills](https://support.atlassian.com/subscriptions-and-billing/docs/manage-subscriptions-and-bills-for-atlassian-cloud-products/) ·
[Atlassian — Understand billing administration](https://support.atlassian.com/subscriptions-and-billing/docs/understand-billing-administration/) ·
[SaaS Mag — Hybrid pricing 2026](https://www.saasmag.com/hybrid-pricing-saas-growth-2026/) ·
[Stripe — Introducing the Billing customer portal](https://stripe.com/blog/billing-customer-portal) ·
[Stripe — Customer portal docs](https://docs.stripe.com/no-code/customer-portal) ·
[Docsie — Feature gating definition, examples, best practices (2026)](https://www.docsie.io/blog/glossary/feature-gating/) ·
[Orbix — SaaS UI patterns that kill trial-to-paid conversion](https://www.orbix.studio/blogs/saas-ui-patterns-conversion)

Admin console IA:
[Zenatta — Zoho One admin panel guide](https://zenatta.com/zoho-one-admin-panel/) ·
[Zoho Directory — Conditional app assignment](https://help.zoho.com/portal/en/kb/directory/admin-guide/conditions/articles/add-condition) ·
[Zoho One — Assign apps to a user](https://help.zoho.com/portal/en/kb/one/admin-guide/applications/managing-applications/articles/zohoone-assign-app-individually) ·
[GitHub — Reviewing the org audit log](https://docs.github.com/en/organizations/keeping-your-organization-secure/managing-security-settings-for-your-organization/reviewing-the-audit-log-for-your-organization) ·
[Slack — Guide to the admin dashboard](https://slack.com/help/articles/115005594006-Guide-to-the-Slack-admin-dashboard) ·
[Slack — Permissions by role](https://slack.com/help/articles/201314026-Permissions-by-role-in-Slack) ·
[Microsoft Learn — Admin center overview](https://learn.microsoft.com/en-us/microsoft-365/admin/admin-overview/admin-center-overview?view=o365-worldwide)

Notifications:
[Linear — Inbox](https://linear.app/docs/inbox) ·
[Linear — Notifications](https://linear.app/docs/notifications) ·
[Medium — Linear's notification system treats attention as abundant](https://medium.com/@arjundesigns/linears-notification-system-treats-attention-as-abundant-it-isn-t-646f5f44b8ae) ·
[AlternativeTo — Slack redesign: DM tab and Activity hub](https://alternativeto.net/news/2023/8/slack-undergoes-a-major-redesign-in-years-introducing-a-new-dedicated-dm-tab-and-an-activity-hub/)

Architecture:
[WorkOS — Developer's guide to SaaS multi-tenant architecture](https://workos.com/blog/developers-guide-saas-multi-tenant-architecture)

### Caveats

- Product UX changes fast. Zoho One's Spaces UI shipped 18 Nov 2025 and is still
  rolling out per-org (there's an admin toggle to opt users into the new UI);
  Vercel's nav redesign became default 26 Feb 2026; ClickUp 3.0 was deprecated
  27 Mar 2026. Re-verify any specific screen before copying it pixel-for-pixel.
- Several sources are vendor blogs, agency teardowns, or consultancy guides
  (Zenatta, Ofspace, saasui.design, SaaS Mag). Structural claims — IA, step
  order, which controls exist — were preferred from primary docs
  (Linear, Vercel, GitHub, Slack, Microsoft, Odoo, Zoho help). Treat conversion
  percentages (55% vs 20–30%, 12% vs 5%, 7% per field, 2.3× churn) as
  directional; they come from secondary reporting of vendor studies, not
  independent replication.
- Pricing figures (Zoho $37/$45/$90/$105, Stripe Billing 0.7%) are as published
  mid-2026 and change without notice.
- The four CBOP defects in §0 were read directly from
  `api/middleware/require-auth.ts`, `api/routes/settings.ts`,
  `app/components/sidebar.tsx`, `app/lib/company-context.tsx`, and
  `migrations/055_company_modules.sql` on 2026-08-05. Re-verify before acting if
  those files have moved.
