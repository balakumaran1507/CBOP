# CBOP HANDOFF

## Last updated
2026-08-07 — CBOP Accounting built end-to-end (all 9 slices), plus the enterprise scale-up pivot's first two research/execution rounds

## Completed slices
- ✅ **CBOP Accounting — all 9 slices, deployed and live**: a full statutory-grade double-entry SaaS app at `accounting.etherence.com`, SSO'd to CBOP, replacing the old broken `/accounting` page. See `docs/modules/ACCOUNTING_Build_Plan.md` for the original plan and `docs/SCALE_UP_TRACKER.md` for the session-by-session log.
  1. Ledger schema (`migrations/062_acct_accounting_module.sql`) — chart of accounts, journal entries/lines with trigger-enforced balance/immutability/period-lock, bills, tax details, reusing the platform's `audit_logs` append-only pattern
  2. Ledger engine API (`api/routes/accounting.ts`) — accounts, journal entries (draft/post/void+reversal), fiscal periods
  3. Separate Next.js app (`accounting-app/`) — SSO via `crossSubDomainCookies`, own Space Grotesk/Inter/IBM Plex Mono font identity, deployed via systemd (`deploy/cbop-accounting.service`), NOT docker-compose (docker-compose.yml's app services are aspirational, not live — see its own header comment)
  4. Core transactional UI — Chart of Accounts, Journal Entries, Bills, Banking, Expenses (Tally-style quick-add), Invoices/AR (payment recording now actually posts to the ledger), Dashboard widgets
  5. Reports — Trial Balance, P&L, Balance Sheet (verified against real posted entries: Assets 3000 = Liabilities 1000 + Equity 2000, exact), General Ledger, Day Book, AR/AP Aging, Customer/Vendor Balances, cross-company Rollup
  6. GST/TDS — `acct_tax_details` wired into Bills (TDS) and Invoices (GST breakup), GSTR-1/GSTR-3B/TDS-ledger export reports (report-only, no GSTN/IRP filing — deliberate)
  7. Audit trail UI — per-record version history + color-coded diff view, company-wide Reports tab, CEO/creator only
  8. Fiscal period locking UI — irreversible lock action with an explicit plain-language confirmation (no browser `confirm()`)
  9. Cutover, revised 2026-08-07 per Bala's real usage feedback (a hard redirect away from CBOP for something this core felt wrong): `app/(dashboard)/accounting/page.tsx` is now a real embedded page (same origin, CBOP's own Syne/Inter/IBM Plex Mono, plain same-origin fetches to the same `/api/accounting/*` backend, no CORS needed) showing cash+bank/AR/AP summary, quick-add expense, and recent activity - the day-to-day basics live inside CBOP itself. A clearly-labeled "Open full Accounting app ↗" button (opens in a new tab, so CBOP never disappears) is the door to everything advanced (Chart of Accounts, Journal Entries, Bills, Banking, Invoices/AR management, Reports, GST/TDS, Audit Trail, Period Locking), which stays exclusively on `accounting.etherence.com`. `api/routes/finance.ts` deliberately left untouched (other live consumers, not worth the risk for a "where practical" cleanup)
- ✅ **Enterprise scale-up pivot, round 1**: 4 research docs (`docs/research/`) + master plan (`docs/Project-Scale-Up-Plan.md`, 10 phases + 24-row constraint table + 26 open decisions) + docs reorganized into `docs/{research,modules,engineering,archive}/` with a new `docs/README.md` map
- ✅ **Enterprise scale-up pivot, round 2 (Immediate Fixes)**: IF-2 (`audit_logs` got its first writers — now platform-wide, not accounting-only), IF-3/4/5/6/9 (settings modules cross-tenant leak fixed, company switcher now server-validated, sidebar/registry drift fixed, 402 vs 403 split, hardcoded alert IDs replaced) — migrations 059-061 applied
- ✅ Open Decisions 1, 2, 9, 12 answered by Bala (recorded inline in `Project-Scale-Up-Plan.md`): tenant = single-company-default/multi-company-paid-tier; cross-tenant users = yes; data residency = India-only for now; homeserver = never takes paying-customer data

## Current slice
CBOP Accounting: complete ✅. Enterprise scale-up: Phase 0 (Immediate Fixes) mostly done, Phase 1+ (tenant boundary, RLS) not started — correctly blocked on more open decisions, see `Project-Scale-Up-Plan.md`.

## What works right now
- Everything in the previous HANDOFF (auth, sales, hiring, campaigns, documents, work, settings, People module, etc.) — unchanged, not touched this session except where noted below.
- **CBOP Accounting**, fully live: real double-entry bookkeeping (not a flat expense table), GST/TDS-aware, audit-trailed, period-lockable, cross-company reporting. COO/CTO get real day-to-day access (invoices/bills/expenses/journal entries); CEO/creator-only for the sensitive aggregate reports and period locking.
- Platform-wide audit log (`audit_logs`, generalized in migration 059) now has real writers across auth, authz denials, admin actions, and every `acct_*` table mutation via DB trigger.
- Cross-subdomain SSO: `cbop.etherence.com` and `accounting.etherence.com` share one session cookie (`BETTER_AUTH_COOKIE_DOMAIN=.etherence.com` — both are sibling single-label subdomains of `etherence.com`, not nested; `BETTER_AUTH_TRUSTED_ORIGINS` extended, CORS opened for the new origin). Note this is a deliberately wider cookie scope than the originally-designed `.cbop.etherence.com` — see the reasoning in `api/lib/auth.ts`'s `crossSubDomainCookies` comment.

## Files changed this session (key ones)
- `migrations/062_acct_accounting_module.sql` — NEW: full ledger schema
- `api/routes/accounting.ts` — NEW, ~1600 lines: accounts, journal entries, fiscal periods, bills, expenses, transfers, bank accounts, AR payment recording, 9 report endpoints, tax-details CRUD + GSTR-1/3B/TDS-ledger, audit-log read endpoint
- `accounting-app/` — NEW: entire second Next.js app (10 pages, shared components, lib helpers)
- `deploy/cbop.service`, `deploy/cbop-accounting.service` — NEW: systemd units checked into the repo for the first time (previously only existed live on the box, undocumented)
- `api/lib/auth.ts` — `crossSubDomainCookies` (env-gated via `BETTER_AUTH_COOKIE_DOMAIN`), `accounting.etherence.com` added to `trustedOrigins`
- `api/index.ts` — CORS origins extended for the accounting subdomain; `accountingRoutes` mounted
- `api/lib/modules.ts` — `accounting` module moved from `CEO_ONLY` to `BUSINESS` (the actual bug fix this whole project was for)
- `app/(dashboard)/accounting/page.tsx` — REPLACED (twice: first with a redirect, then 2026-08-07 with a real embedded basic-functions page after Bala found the redirect jarring - see slice 9 above)
- `tsconfig.json` — added `"accounting-app"` to `exclude` (was accidentally being type-checked as part of the main app's build)
- `docker-compose.yml` — corrected: `cbop-app`/`accounting-app` service definitions marked as NOT the real deployment (systemd is); port collision fixed (3004 → 3010, 3004 was already claimed by an unrelated live service, `reset_os-web-1`)
- `/etc/cloudflared/config.yml` (live box, not in git) — new ingress rule for `accounting.etherence.com` → `localhost:3010`
- `.env` (live box, not in git) — `BETTER_AUTH_COOKIE_DOMAIN`, extended `BETTER_AUTH_TRUSTED_ORIGINS`
- `docs/modules/ACCOUNTING_Build_Plan.md` — corrected the Nginx Proxy Manager assumption (it's actually Cloudflare Tunnel) after verifying against the real box
- `docs/Project-Scale-Up-Plan.md`, `docs/SCALE_UP_TRACKER.md` — Open Decisions 1/2/9/12 answered and recorded; multiple session log entries

## Failed attempts — do not retry
- **Docker-compose deployment for either app** — not how this box actually runs things. `cbop.service` and `cbop-accounting.service` are bare `npm start` under systemd with `EnvironmentFile=.env`. The docker-compose.yml service definitions are kept for a possible future containerized deployment but are not live — don't assume they are.
- **Inserting a reversal journal entry directly as `status='posted'`** — skips the balance-check trigger entirely (it only fires on `UPDATE`, not `INSERT`). Always insert as `draft` then transition through the same `post` path.
- **Reusing `LIKE 'TEST-%'` patterns in manual DB verification scripts against a shared dev DB** — collided with an unrelated earlier test fixture and hit the immutability trigger (correctly). Use exact `entry_no IN (...)` matches instead when cleaning up test data.

## Known issues
- ~~`accounting.etherence.com`'s Cloudflare edge TLS cert~~ — **RESOLVED 2026-08-07.** Root cause found: the hostname was originally `accounting.cbop.etherence.com` (two labels deep), and Cloudflare's free Universal SSL only covers the apex + one wildcard level (`*.etherence.com`), not a second level (`*.cbop.etherence.com`) — that hostname never had a valid edge cert to issue, no amount of waiting or DNS-proxy-toggling would have fixed it. Flattened to `accounting.etherence.com` (single label, sibling of `cbop.etherence.com`, covered by the existing wildcard) — cert issued immediately. Confirmed end-to-end: 200 externally, CORS `access-control-allow-origin` correctly returned for the new origin. If this pattern comes up again for a future subdomain app, go single-label from the start.
- **Broader platform findings from `/code-review`, unrelated to Accounting, not fixed this session** (out of scope for this session's work, belongs to whoever owns those modules): `api/routes/rnd.ts` and `api/routes/documents.ts` have no `requireRole`/`requireModule` at all (any authenticated user can hit them for any company in scope); the new `requireModule()` entitlement gate is only wired into `api/routes/accounting.ts`, not the ~10 other module-backed route files, so the per-company module-disable toggle is decorative everywhere except accounting; `api/routes/settings.ts` has several company-scoping gaps (`PATCH /api/settings/companies/:id` and others don't check the target company is in the caller's `companyIds` — currently harmless since only `creator`/global `ceo` exist, but a real gap once a company-scoped `ceo` account exists); a global Cmd/Ctrl+K command palette (`app/components/command-palette.tsx`) directly violates CLAUDE.md's explicit "no global search bar, no command palette" rule; three new email-studio modals are centered popups instead of `SlideOver`s, violating the no-modals rule.
- **`ACCOUNTING_Build_Plan.md`'s open questions 1-4 still unanswered**: non-INR currency usage, any company near ₹5cr turnover (e-invoicing threshold), upfront-deposit contracts (retainer invoices), and whether invoice numbering (`{CODE}-{YEAR}-{SEQ}`, used by both `sales_invoices` and the new `acct_journal_entries` entry numbering) resets on financial year vs calendar year — the current implementation uses calendar year, flagged with a TODO in `generateEntryNumber()`.
- **Enterprise scale-up Phase 1+ not started** — correctly blocked on Open Decisions 3-8, 10, 13-26 (self-serve vs sales-led, app-vs-pack entitlements, ReBAC trigger, budget/timeline, several "get a real lawyer" items). Don't start Phase 2 (tenant boundary schema work) until those are resolved.

## Next session
1. `accounting.etherence.com` is live and confirmed working end-to-end — do a real browser smoke test (not just curl) of CBOP Accounting: log in via "Continue with CBOP", seed a company's chart of accounts, create a journal entry, create a bill and pay it, record an invoice payment, pull a trial balance/balance sheet, check the audit trail shows real entries, lock a fiscal period.
2. Consider fixing the `requireModule()` coverage gap (`/code-review` finding) across the other ~10 module route files — accounting is now the only module where the per-company disable toggle actually does anything.
3. Answer `ACCOUNTING_Build_Plan.md`'s 4 open questions, especially the financial-year invoice numbering one (real GST compliance issue, not cosmetic).
4. Resume the enterprise scale-up pivot at Open Decision 3 (app-vs-pack entitlements) or wherever Bala wants to pick up next — see `docs/Project-Scale-Up-Plan.md`'s Open Decisions section for the full list of what's still open.
5. If another subdomain app ever gets built for this project (or a future one), go single-label from the start (e.g. `xyz.etherence.com`, not `xyz.cbop.etherence.com`) — the free Universal SSL wildcard only covers one level.
