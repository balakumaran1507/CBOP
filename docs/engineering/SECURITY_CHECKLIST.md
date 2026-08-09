# CBOP Security Checklist — NIST CSF 2.0, right-sized

**Source:** [NIST Cybersecurity Framework (CSF) 2.0 — NIST.CSWP.29](https://nvlpubs.nist.gov/nistpubs/CSWP/NIST.CSWP.29.pdf) (final, Feb 2024). Six functions, 22 categories, 106 subcategories. This document maps a working subset of those categories to CBOP's actual deployment — it is not a compliance audit, and it does not attempt all 106 subcategories.

**Snapshot date:** 2026-07-27, during an active multi-agent fix pass. Items checked `[x]` were verified against the live code at the moment this was written — other agents are editing `api/`, `app/`, `docker-compose.yml`, and `package.json` concurrently, so treat this as a point-in-time snapshot, not final truth. Re-run the greps in each item if you need certainty later.

## Why "right-sized"

CBOP runs on one self-hosted Ubuntu homeserver for **3 real users** (a creator/CEO with full access, a COO, a CTO), with no dedicated security team, no compliance mandate, and no external customers touching the system directly. NIST CSF 2.0 was written for organizations of every size, including ones with SOCs, CISOs, and formal audit cycles — applying it uncritically to a 3-person internal tool produces a checklist that's mostly aspirational theater. Every section below states what's proportionate at this scale and explicitly marks what's **deliberately out of scope**, using the same "Required vs. Optional-when-infra-exists" logic the Frontend SOP already applies to dependencies (§3): a control that exists only to satisfy an audit an org will never face isn't a gap, it's the wrong control.

**Deliberately excluded up front** (full reasoning in the closing section): a formal SIEM, scheduled third-party penetration testing, a named CISO/security-officer role, network intrusion detection, and a legal breach-notification playbook. None of these have a proportionate role at 3 users on one host with no regulated data class processed directly — they're the wrong-sized control, not a gap. See **"Right-sized, not maximal"** at the bottom for the full list and the conditions that would change this.

---

## GOVERN (GV)

*Risk strategy, roles, and policy — CSF 2.0's new function, and the cheapest one to actually do at this scale since it's mostly writing down decisions already being made informally.*

**GV.OC — Organizational Context**
- [x] The system's mission, users, and data sensitivity are documented — `CLAUDE.md` states the platform's purpose, the exact 3 users, and their roles in one place. This *is* the organizational-context artifact; don't build a separate one.
- [ ] The blast radius of a compromise isn't written down anywhere — what's actually at stake (5 companies' financial data, client PII, `finance_personal_wealth`) deserves one paragraph in `CLAUDE.md` or this doc, since it's what justifies every other control below.

**GV.RM — Risk Management Strategy**
- [ ] There is no written risk register. For 3 users this doesn't need a GRC tool — a single markdown table (`docs/RISK_REGISTER.md`: risk, likelihood, impact, mitigation, owner) covering the known critical items (credential leak in `scripts/seed.js`, no backup, no company-creation path) would satisfy this proportionately.
- [ ] **(Finding #5, HIGH)** There is no `POST /api/settings/companies` endpoint — the only way to add a company today is a hand-run migration. Combined with **(Finding #14, MEDIUM)** `invoice_prefix` having no edit path despite being a required unique schema field, this pushes operators toward direct-DB edits whenever the business changes, which is exactly the kind of ad-hoc change that skips whatever guardrails the app layer has. Not urgent to build a UI for 3 people, but worth a documented "how to safely add a company" runbook step until one exists.
- [x] Risk tolerance for the finance module is explicit and enforced in code: `requireRole('ceo')` on every `/api/finance/*` route, `finance_personal_wealth` never entering an LLM prompt context (confirmed in the 2026-07-27 audit) — this *is* a risk decision, just expressed as code instead of policy.

**GV.RR — Roles, Responsibilities & Authorities**
- [x] Role model is explicit and centrally documented (`CLAUDE.md` "Role model" section: `creator`/`ceo`/`coo`/`cto`, what each can see). Enforced in `api/middleware/require-role.ts` and `require-auth.ts`.
- [ ] No one is named as the person who rotates a leaked secret or responds if the homeserver is compromised. With 3 people this can be one line ("Bala is the incident owner; Nabeelah/Guru are backup"), but it isn't written anywhere today.

**GV.PO — Policy**
- [x] `CLAUDE.md`'s "Non-negotiable constraints" section functions as CBOP's security policy in practice (no Redis, no direct third-party API calls outside the hermes wrapper, finance isolation, no hardcoded secrets) — genuinely unusual for a project this size to have this, worth keeping current as the source of truth.
- [ ] **(Finding #23, LOW)** `CLAUDE.md` currently contradicts itself on Hermes (says "removed, do not reference it" in one bullet, then documents `sendViaHermes()` as the canonical path two paragraphs later) — a policy document that contradicts itself stops being trustworthy. Needs reconciling with what `api/lib/hermes.ts` actually does (confirmed: a 9-line deprecated shim re-exporting `openclaw.ts`).

**GV.OV — Oversight**
- [ ] No periodic review cadence exists for this checklist or the audit findings. Proposal proportionate to scale: revisit this doc once a quarter, or whenever a new company/integration is added.
- [ ] **(Finding #24, LOW)** ~90 untracked files (8,811 insertions) landed as one uncommitted batch, unreviewed by anyone but the agent that wrote them. At 3 people there's no PR-approval process to mandate, but a batch this size skipping even a self-review pass before commit is the actual gap — the right-sized fix is committing in reviewable increments, not standing up CI/CD gates.

**GV.SC — Cybersecurity Supply Chain Risk Management**
- [ ] **(Finding #19, MEDIUM)** No dependency-update cadence. `package.json` currently pins `next@^14.2.3` and `better-auth@^0.8.0`, both meaningfully behind current releases (patch-level bump in progress, major-version bump explicitly deferred by the user).
- [ ] No `npm audit` / Dependabot / Renovate wired into any workflow — reasonable given there's no CI runner in this project's stack, but at minimum `npm audit` should run before any dependency-touching PR, per the FastAPI SOP's equivalent guidance (§14) applied to the JS side.
- [ ] **(Finding #21, LOW)** `sharp` is installed but unused anywhere in the codebase. Not a vulnerability by itself, but every unused dependency is unreviewed code that still ships in `node_modules` and still needs patching if a CVE lands in it — remove it, or use it, don't leave it idle.

---

## IDENTIFY (ID)

**ID.AM — Asset Management**
- [x] Data classification exists implicitly and is enforced: `finance_personal_wealth` is treated as more sensitive than operational data (CEO-only, never in agent context). Company-scoped data (`company_id = ANY(companyIds)`) is consistently isolated across routes (confirmed audit finding: no BOLA gaps found).
- [ ] No inventory of what's actually running: this doc doesn't yet list every external integration with credentials (SMTP × 5 companies, SES, AWS S3, Google OAuth ×2 scopes, LinkedIn, Ollama, Outline, n8n, OpenClaw/Hermes). `.env.example` is the closest thing to this inventory today — consider it the asset register until something better exists.
- [ ] **(Finding #13, MEDIUM)** A migration links to 2 of the "5 companies" by name without ever inserting them — meaning the platform's own docs and UI may reference companies that don't actually exist as rows in the `companies` table. Worth a one-time query to confirm which of the 5 are real before anything (invoicing, settings) assumes all 5 exist.
- [ ] **(Finding #22, LOW)** Company/domain name-to-ID maps are hardcoded and duplicated across at least 4 files instead of one source of truth (schema table or shared constant). Low severity on its own, but it's exactly the kind of drift that produced **(Finding #20, MEDIUM)** — a campaigns component's hardcoded 2-company sender-hint check that's silently wrong for the other 3 companies. Consolidating to one lookup (the `companies` table itself, or a single shared module) would prevent this class of bug recurring.

**ID.RA — Risk Assessment**
- [x] This document and the 2026-07-27 audit *are* the risk assessment. 24 findings ranked critical/high/medium/low.
- [ ] No recurring assessment — this was triggered reactively by a user request, not on a schedule. Fine at this scale as long as it happens again before the next major feature (e.g., before whatever module comes after the current untracked batch of ~90 new files ships).

**ID.IM — Improvement**
- [ ] Findings from this audit are tracked in an ad-hoc memory file (`project_audit_2026-07-27.md`) rather than a durable location in the repo. Once the current fix pass lands, close the loop by updating this checklist's `[ ]`/`[x]` states rather than letting it go stale — a checklist nobody updates is worse than no checklist, since it actively misrepresents state.

---

## PROTECT (PR)

**PR.AA — Identity Management, Authentication & Access Control**
- [x] **(Finding #3, CRITICAL — fixed)** Auth now fails closed: `api/lib/auth.ts` throws at startup if `BETTER_AUTH_SECRET` or `DATABASE_URL` is missing, instead of the previously-found hardcoded dev fallback (`'dev-secret-change-in-prod'`) — **verified fixed in this snapshot**.
- [x] Role-based access control enforced centrally (`require-role.ts`), not per-route ad hoc.
- [x] Session cookies via better-auth (httpOnly, 7-day session per `CLAUDE.md`).
- [ ] **(Finding #6, HIGH)** `PATCH /api/settings/users/:id` still accepts `company_ids: []` with no minimum-1 guard as of this snapshot (`api/routes/settings.ts:91-127`) — a CEO can silently orphan a user's access. In remediation (Task #5).
- [ ] No rate limiting beyond `/api/auth/*` (confirmed: 10 req/60s/IP there, nowhere else) — acceptable at 3-user scale for most routes, but worth a second look on any endpoint that triggers external sends (email, WhatsApp) to avoid accidental floods.

**PR.AT — Awareness & Training**
- [ ] No security onboarding doc for the 3 users beyond this checklist. Proportionate minimum: one page covering "don't commit `.env`," "here's how to report something that looks wrong," "here's who rotates a credential."
- [x] Out of scope beyond that minimum — a formal security-awareness training program is enterprise-scale overhead for 3 people who already read `CLAUDE.md`.

**PR.DS — Data Security**
- [x] `.env` correctly gitignored, never committed (verified via `git log --all -- .env`, empty).
- [ ] **(Finding #4, CRITICAL)** Real credentials are committed to git history — `scripts/seed.js` has plaintext production passwords for all 3 users, tracked since commit `efa2a37`. **By explicit user decision (2026-07-27): not rotating and not rewriting history right now**, because the repo is private and never goes public, and rotation would disrupt active use. This is a deliberate, informed risk acceptance, not an oversight — recorded here so it reads as a decision, not a gap nobody noticed. Revisit if the repo's privacy status ever changes.
- [ ] **(Finding #1, CRITICAL)** Unlike the seed.js secret above, this one has no reason to stay as-is: `n8n/workflows/intern_email_check.json` hardcodes the actual `N8N_WEBHOOK_SECRET` value in 3 places instead of referencing it via an env expression (`{{$env.N8N_WEBHOOK_SECRET}}`). This is a live workflow definition, not a seed script — anyone who can view the workflow (or its git history) has the current production webhook secret. In remediation.
- [ ] **(Finding #9, HIGH)** No sanitization library despite 3 `dangerouslySetInnerHTML` sites rendering DB-sourced HTML (`signature-manager.tsx:164`, `campaigns/new-campaign-slide-over.tsx:289`, `blog/post-editor.tsx:351`) — not yet added as of this snapshot (`grep -i dompurify package.json` returned nothing). In remediation (Task #6).
- [ ] **(Finding #16, MEDIUM)** `zod` is installed but used nowhere — no schema validation at any API boundary. Every route trusts its request body's shape. At 3 trusted users this isn't an injection emergency (parameterized queries still protect the DB), but malformed input can still reach business logic unchecked. Right-sized fix: add zod schemas incrementally on routes that accept the widest input (campaigns, documents, settings) rather than a big-bang pass over all ~40 routes at once.
- [ ] **(Finding #15, MEDIUM)** No company deactivation path exists, and every foreign key to `companies` cascades on delete — deleting one company row silently deletes every deal, invoice, task, and document tied to it, with no soft-delete safety net. This is a data-loss risk independent of any attacker: one wrong `DELETE` and it's gone. Matters more than it would otherwise because of the backup gap in RECOVER below — right now there is no undo at any layer.
- [x] Finance data isolation holds (`finance_personal_wealth` never in LLM context, CEO-only routes).

**PR.PS — Platform Security**
- [x] Postgres bound to `127.0.0.1` only, not exposed on all interfaces (verified).
- [x] Dockerfile uses runtime env injection, non-root `nextjs` user, standalone build — no secrets baked into the image.
- [ ] **(Finding #7, HIGH)** `docker-compose.yml` still defines a `cbop-app` service as of this snapshot, alongside `postgres` and `n8n` — `CLAUDE.md`'s own non-negotiable says the compose file "only contains postgres and n8n." In remediation (Task #7); worth the operators confirming *why* `cbop-app` was added before it's removed, in case it reflects how the app is actually deployed today.
- [ ] **(Finding #8, HIGH)** `docker-compose.yml` also still uses the stale `OPENCLAW_URL`/`OPENCLAW_API_KEY` env var names instead of the current `HERMES_URL`/`HERMES_API_KEY`. Beyond the naming drift, this is a real functional risk: if the app code reads the new names and the compose file only sets the old ones, messaging silently fails closed (or reads undefined) with no error surfaced — worth confirming this isn't currently breaking Telegram/WhatsApp sends in production.
- [ ] **(Finding #11, HIGH)** Puppeteer launches with `--no-sandbox --disable-setuid-sandbox` (`api/lib/pdf-generator.ts:969`) while rendering DB-sourced HTML into PDF — no sandbox backstop if any field isn't escaped. In remediation.
- [ ] **(Finding #17, MEDIUM)** `n8n:latest` unpinned, public API left enabled, binds to all interfaces rather than `127.0.0.1` behind the existing Nginx Proxy Manager.
- [ ] **(Finding #18, MEDIUM)** 17 of 50 migration files lack `IF NOT EXISTS` guards, so they aren't safely re-runnable. Combined with the backup gap in RECOVER below, this matters more than it looks: a partial-apply failure mid-migration currently has no clean re-run path and no backup to fall back to. Right-sized fix is adding the guards to the 17 files, not a migration-framework rewrite.

**PR.IR — Technology Infrastructure Resilience**
- [x] CSP applied to `/api/*` JSON responses via `secureHeaders()`.
- [ ] **(Finding #10, HIGH)** CSP is **not** applied to the actual HTML dashboard pages users load — confirmed still missing in this snapshot (`grep -i "Content-Security-Policy" next.config.js` returned nothing). In remediation.
- [ ] **(Finding #12, HIGH)** Uploaded files (`app/api/uploads/[...path]/route.ts`) have correct path-traversal handling but no authentication check — anyone with a filename can fetch it. In remediation.

---

## DETECT (DE)

**DE.AE — Adverse Event Analysis**
- [ ] No centralized logging beyond whatever each route's own `console.log`/`console.error` produces. At 3-user scale, a full SIEM is disproportionate — but a single `audit_logs` table (already named in `CLAUDE.md`'s table list) capturing auth failures, role-gate rejections, and admin actions (company edits, user role changes) would be a proportionate middle ground. Worth confirming whether `audit_logs` is actually written to anywhere, or exists as a table with no writers.
- [x] **(Finding #2, CRITICAL — fixed)** The webhook secret check now fails closed and logs nothing sensitive on rejection (`api/routes/webhooks.ts` — verified in this snapshot, returns a plain 403).

**DE.CM — Continuous Monitoring**
- [x] Uptime Kuma already runs on the homeserver per `CLAUDE.md`'s existing-services list — confirm CBOP's own health endpoint(s) are actually registered with it; this doc can't verify that from the repo alone.
- [ ] No monitoring on the things most likely to silently fail: SMTP send failures per company, n8n workflow failures, the (currently nonexistent) backup job. Worth at minimum a Telegram alert via the existing hermes bridge on hard failures — the infrastructure to do this already exists, it's just not wired to these events yet.

**Deliberately out of scope:** intrusion detection systems, network traffic analysis, anomaly-detection ML — genuinely enterprise-scale tooling with no proportionate role here.

---

## RESPOND (RS)

**RS.MA — Incident Management**
- [ ] No written incident response plan. Proportionate minimum for 3 people: a short doc answering "if a credential leaks, who rotates it and how" and "if the homeserver is compromised, what's the first call." This doc's PR.DS section above is the closest thing that exists today, and it's about one specific incident, not a general plan.

**RS.AN / RS.CO / RS.MI — Incident Analysis, Communication, Mitigation**
- [ ] Not formally defined. At this scale, these collapse into "Bala looks at it and tells Nabeelah/Guru" — which is fine as an approach, but writing that one sentence down means it's a decision instead of an assumption.

**Deliberately out of scope:** formal incident response team, external forensics retainer, legal breach-notification playbook — CBOP has no regulated data class (no health records, no payment card data processed directly) that would make these proportionate today. Revisit if that changes.

---

## RECOVER (RC)

**RC.RP — Incident Recovery Plan Execution**

This is the section that deserves the most weight, not the least. **CLAUDE.md's own tech-stack table states "AWS S3 + pg_dump cron at 2am daily" as the backup strategy — this does not exist anywhere in the repo.** No script, no scheduled job, no dependency for it. For a platform holding 5 companies' financial data, active deals, and client records, this means:

- [ ] **There is currently no backup of the production database.** If the Postgres container's volume is lost — disk failure, `docker volume rm` typo, a bad migration with no rollback — everything is gone. This is not a theoretical risk; it's the single highest-impact gap in this entire checklist, ranked above every code-level finding, because it's the one failure mode with no recovery path at all.
- [ ] No documented recovery procedure even if a backup existed — "restore from S3, run migrations, verify" isn't written down anywhere.
- [ ] No backup restore has ever been tested (moot until a backup exists, but worth stating: an untested backup is a hypothesis, not a backup).

**Recommendation, right-sized:** this doesn't need AWS S3 specifically — a `pg_dump` cron job writing to Nextcloud (already self-hosted per `CLAUDE.md`'s existing-services list) or even just a second disk on the homeserver would close most of the risk for a fraction of the complexity CLAUDE.md's own spec describes. The S3 approach is fine too; the point is that *something* needs to exist today, this week, independent of the rest of this fix pass.

**RC.CO — Incident Recovery Communication**
- [ ] Not defined — folds into the same one-sentence plan as RS.CO above at this scale.

---

## Right-sized, not maximal — what was deliberately left off

Matching the Frontend SOP's own Required/Optional dependency-tier logic (§3) to security controls instead of packages: a control with no backing infrastructure or no proportionate threat model isn't a gap, it's the correctly-sized decision. Left out of this checklist on purpose:

- **SIEM / centralized log aggregation** — no infra to feed it, no team to watch it. A single `audit_logs` table is the right-sized substitute (see DE.AE).
- **Formal, scheduled third-party penetration testing** — proportionate for a system with external customers or a compliance mandate; CBOP has neither. A periodic self-review against this checklist (see GV.OV) is the right-sized substitute.
- **Dedicated security officer / CISO role** — folded into GV.RR as "Bala is the incident owner," which is honest about the actual staffing rather than pretending a formal title changes anything at 3 people.
- **Intrusion detection / network anomaly detection** — see DE.CM.
- **Formal breach-notification legal playbook** — no regulated data class currently processed that requires one; revisit if CBOP starts handling payment card data or health records directly rather than through a third-party processor.
- **Zero-trust network architecture, mTLS between internal services** — CBOP's internal services (cbop-bridge, OpenClaw, n8n, Postgres) already run on `127.0.0.1`/a private Docker network on a single host; the threat model that zero-trust solves (lateral movement across an untrusted internal network) doesn't apply to one machine.

None of the above should be added later just because a checklist "feels incomplete" without them — add them only if the actual deployment changes (more users, external customers, a second host, a compliance requirement) in a way that changes the threat model this doc is scoped to.
