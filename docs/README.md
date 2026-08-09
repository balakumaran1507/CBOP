# CBOP Docs — Map

CBOP started as an internal ops platform for 5 companies Bala owns, self-hosted on one
Ubuntu homeserver for 3 users. On 2026-08-05 the project pivoted, same-day, to a
**multi-tenant "Super OS" SaaS product**: one identity, one shell, many apps, sold by plan,
with Bala's 5 companies becoming tenant zero on the same code path every paying tenant
gets. This directory holds both eras — this README is the map so you don't have to guess
which doc is live, which is historical, and which supersedes which.

**Start here, in order:**
1. [`CLAUDE.md`](../CLAUDE.md) (repo root) — binding constraints. Not editable on the
   strength of any doc in this directory alone; see its own text for the sign-off rule.
2. [`Project-Scale-Up-Plan.md`](Project-Scale-Up-Plan.md) — the master build plan for the
   pivot. Build against this for anything touching tenancy, roles, or the SaaS shell.
3. [`SCALE_UP_TRACKER.md`](SCALE_UP_TRACKER.md) — live status of the pivot's research and
   Immediate Fixes work. Check this for what's actually shipped vs. still planned.
4. [`HANDOFF.md`](HANDOFF.md) — session state, overwritten at the end of every session.

---

## Root — entry points

| Doc | Role | Status |
|---|---|---|
| [`MASTER.md`](MASTER.md) | Original v2 spec — single-tenant, 3-user internal tool | **Historical for tenancy/roles/shell** (banner added); still accurate for design system, naming rules, DB conventions, invoice mechanics |
| [`Project-Scale-Up-Plan.md`](Project-Scale-Up-Plan.md) | Master build plan for the SaaS pivot | **Live** — the doc to build against |
| [`SCALE_UP_TRACKER.md`](SCALE_UP_TRACKER.md) | Research inbox + Immediate Fixes execution log | **Live** |
| [`HANDOFF.md`](HANDOFF.md) | Session state | **Live** — overwritten every session per `CLAUDE.md` |
| `README.md` | This file | **Live** |

## `research/` — evidence base for the pivot

| Doc | Role | Status |
|---|---|---|
| [`ENTERPRISE_ARCHITECTURE_RESEARCH.md`](research/ENTERPRISE_ARCHITECTURE_RESEARCH.md) | Tenancy, authz, identity, infra decisions | **Live** — authoritative on architecture rationale |
| [`SECURITY_COMPLIANCE_RESEARCH.md`](research/SECURITY_COMPLIANCE_RESEARCH.md) | Legal/security roadmap, 3 compliance gates | **Live** — authoritative on compliance rationale |
| [`SAAS_UX_RESEARCH.md`](research/SAAS_UX_RESEARCH.md) | Shell, org switching, onboarding, billing, admin IA | **Live** — authoritative on UX rationale (R-numbers) |
| [`CURRENT_STATE_AUDIT.md`](research/CURRENT_STATE_AUDIT.md) | file:line index of every single-tenant assumption in the codebase | **Live** — the reference for "what has to change" |

## `modules/` — per-module build plans

| Doc | Role | Status |
|---|---|---|
| [`ACCOUNTING_Build_Plan.md`](modules/ACCOUNTING_Build_Plan.md) | Accounting module rebuild as a standalone SaaS app | **Live — in flight**, absorbed (not superseded) by the scale-up plan; its audit-log design was promoted platform-wide |
| [`SEO_Build_Plan.md`](modules/SEO_Build_Plan.md) | Blog & SEO module | **Live** inside its module |
| [`SOCIAL_Build_Plan.md`](modules/SOCIAL_Build_Plan.md) | Social Media Monitor module | **Live** inside its module |
| [`social-manager-build-plan.yml`](modules/social-manager-build-plan.yml) | Machine-readable task breakdown for LinkedIn publishing, companion to `SOCIAL_Build_Plan.md` | **Live** |
| [`HIRING_OVERHAUL_PLAN.md`](modules/HIRING_OVERHAUL_PLAN.md) | Hiring module overhaul (AI scoring, DOCX viewing, Compare Mode) | **Live** inside its module |
| [`BATCH_INTERVIEW_SPEC.md`](modules/BATCH_INTERVIEW_SPEC.md) | Batch interview design spec | **Live** — design reference; its own "not yet built" status line is stale (the feature is built — see `api/routes/hiring-batches.ts`) |
| [`EMAIL_STUDIO.md`](modules/EMAIL_STUDIO.md) | Global email design + send system architecture | **Live** |
| [`EMAIL_DELIVERABILITY.md`](modules/EMAIL_DELIVERABILITY.md) | SPF/DKIM/DMARC runbook per sending domain | **Live** — re-audit the `dig` results periodically, they go stale |
| [`WORK_MODULE.md`](modules/WORK_MODULE.md) | `/work` module mental model (tasks/projects/R&D/sessions) | **Live** |

All module docs stay authoritative inside their own module; `Project-Scale-Up-Plan.md`
§10 (Per-module SaaS-ification) adds only the SaaS layer on top, by reference.

## `engineering/` — engineering discipline

| Doc | Role | Status |
|---|---|---|
| [`E2_BACKEND_SOP.md`](engineering/E2_BACKEND_SOP.md) | Backend engineering SOP research (FastAPI/Python reference stack) | **Live for principles only** — CBOP runs Hono.js/Node, not the literal Python/FastAPI layout; see `Project-Scale-Up-Plan.md`'s "Engineering conventions" section for what was actually adopted |
| [`E2_FRONTEND_SOP.md`](engineering/E2_FRONTEND_SOP.md) | Frontend engineering SOP research (Next.js baseline + 56-item R&D menu) | **Live for principles only** — same caveat as above |
| [`SECURITY_CHECKLIST.md`](engineering/SECURITY_CHECKLIST.md) | NIST CSF 2.0 checklist, right-sized for 3 users on one homeserver | **Live** — still a prerequisite; `SECURITY_COMPLIANCE_RESEARCH.md` adds the layer this one deliberately excluded, it doesn't replace it |

## `archive/` — superseded, kept for historical reasoning

| Doc | Role | Status |
|---|---|---|
| [`NEXT_SESSION_PLAN.md`](archive/NEXT_SESSION_PLAN.md) | 2026-07-11 session scratch plan (email images, hiring templates, integrations tab, company onboarding) | **Archived** — all four sections are either shipped (see the file's own archive banner for the specific commits/routes) or superseded by `Project-Scale-Up-Plan.md`. Do not build against it. |

---

## Notes on this reorg (2026-08-05)

- Nothing was hard-deleted. Everything superseded was moved to `archive/` with a one-line
  banner explaining what replaced it — git history alone isn't enough for someone to
  rediscover *why* an old decision was made.
- `MASTER.md` got a banner (pre-pivot, role model + "feature not in this doc" claim
  superseded) and one inline factual correction (the `users.role` CHECK constraint it
  documents was dropped by migration 057) — content otherwise untouched.
- `CLAUDE.md` got exactly one factual correction (`docker-compose.yml` now also runs
  `cbop-app`, not just postgres+n8n) because `Project-Scale-Up-Plan.md` names it explicitly
  as a documentation-vs-reality bug, not a policy question. Its actual constraints — the
  3-user role model, n8n-only automations, etc. — were **not** touched; those are proposals
  pending Bala's sign-off in `Project-Scale-Up-Plan.md`'s constraint-change table, and
  editing them is explicitly out of scope for any agent working from that doc alone.
