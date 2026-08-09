# CBOP Accounting — Build Plan

Tracking doc for the CBOP Accounting module. Update as phases complete — this
is the working notes file; `docs/HANDOFF.md` gets the end-of-session summary.

## Requested scope (verbatim intent from user)

- The current `/accounting` page is broken and incomplete: company selector
  doesn't work for most users, most features unusable, no cross-company
  rollup view, no legal compliance, no audit trail — "not even something you
  can give out legally."
- Not a patch job. Build it as a **separate full app** — "an app inside an
  app" — with its own auth continuation ("Continue with CBOP"), own loading
  screen, own shell/profile, big enough to feel like a real SaaS product.
- Before building: pick a real, famous, well-documented SaaS product to use
  as the feature/UX reference ("clone" in spirit, not trademark).
- Process: todo list → R&D agents → this build plan.

## Decisions locked (confirmed by user 2026-08-05 — do not re-litigate without cause)

| Decision | Answer | Why |
|---|---|---|
| Reference SaaS | **Zoho Books** | `companies` table already has a `gstin` column, page renders `en-IN`/₹ — this is Indian-jurisdiction bookkeeping. Zoho Books is the India-market-native, GST-first, extensively documented option (vs. QuickBooks/Xero which are GAAP/AU/UK-first). |
| Hosting | **Subdomain**, `accounting.etherence.com`, own Next.js 14 app, SSO'd to CBOP's existing session | User explicitly wants an "app inside an app" feel, not a route buried in the dashboard. |
| Compliance depth | **Statutory-grade, filing-ready** | GSTR-1/3B-shaped reports, HSN/SAC, TDS, e-invoice fields, and the Companies (Accounts) Rules 2021 non-disableable audit-trail mandate — built to be handed to a real CA with zero rework. |

## Root cause of the reported bugs (verified against current code, not assumed)

Read `app/(dashboard)/accounting/page.tsx` and `api/routes/finance.ts` directly:

- **"Company select doesn't work" — actually an access-control bug, not a UI
  bug.** Every `/api/finance/*` route is `requireAuth, requireRole('ceo')`.
  Per CBOP's role model, only `creator` (Bala) bypasses that gate — no
  account currently holds plain `ceo`. So Nabeelah (coo) and Guru (cto) get
  403 on **every** finance call. The page isn't half-broken for them, it's
  fully broken: empty widgets, empty tables, a selector with nothing behind
  it to filter.
- **AR aging table ignores the company selector** — `Outstanding Invoices`
  renders `agingData.invoices` unfiltered by `companyId`, so switching
  companies doesn't change that table even for `creator`. Everything else
  (waterfall, day book, ledger) does respect the selector correctly.
- **No cross-company rollup** — every widget is single-company by
  construction (`health = healthData.companies.find(c => c.company_id ===
  companyId)`); there's no "all 5 companies at once" view anywhere.
- **No real bookkeeping underneath it** — `finance_expenses` is a flat,
  single-sided table (category + amount, no debit/credit, no chart of
  accounts, no linkage to invoices as a ledger). There's no way to produce a
  trial balance, a real P&L, or a balance sheet from what exists today — the
  waterfall chart is the closest thing to a P&L and it's derived from a
  hand-maintained `finance_monthly_pl` table, not posted transactions.
- **No audit trail on any financial mutation** — expenses/invoices can be
  edited or deleted with no record of who changed what. This alone is what
  makes "not legally usable" a correct assessment, independent of GST/TDS
  scope: Indian companies are required to run accounting software with a
  non-disableable audit trail (see R&D §2 below).

## Process

1. **Phase 1 — R&D** (4 parallel research forks, read-only): Zoho Books
   feature map, Indian GST/TDS/audit-trail law, cross-subdomain SSO
   architecture, double-entry ledger schema design. **Status: COMPLETE.**
2. **Phase 2 — This build plan**, synthesizing Phase 1 into a phased,
   buildable spec. **Status: this document.**
3. **Phase 3 — Build**, slice by slice per the plan below. **Status: not
   started.**

---

## Phase 1 — R&D findings

### R&D 1: Zoho Books feature map

Full module-by-module MUST / SHOULD / SKIP / FLAG assessment, scoped to a
5-company, 3-user, **internal, services-only** business group (IT
consulting, pentesting, CTF training, game dev — no physical goods, no
external client logins).

**MUST-HAVE (v1 core):**
Chart of Accounts, Manual Journals, Opening Balances, Invoices, Credit
Notes, Payments Received, Payment Reminders, Bills, Payments Made, Expenses,
Bank/Cash Accounts, Bank Reconciliation, Transfer Funds, Items (services-only
catalog), GST-compliant invoicing, HSN/SAC codes, GSTR-1 prep report,
GSTR-3B prep report, P&L, Balance Sheet, Trial Balance, Cash Flow, AR Aging,
AP Aging, Customer/Vendor Balance Summary, Expense-by-category report, Audit
Trail, Dashboard, simplified role gating (extend existing `requireRole`).

**SHOULD-HAVE (fast follow):**
Quotes/Estimates, Recurring Invoices/Bills (via n8n cron, not a
CBOP-native scheduler — matches the "n8n for all automations" constraint),
Vendor Credits, Bank Rules (auto-categorize known vendors like AWS/Google
Workspace), GSTR-2A/2B reconciliation, RCM flagging (relevant — IT/consulting
businesses commonly pay foreign SaaS subject to reverse charge), TDS
calculation + challan tracking, Form 16A tracking, Sales-by-customer/item
reports, Projects/Timesheet billing integration (CBOP already has
`ops_projects`/`ops_tasks`/`ops_work_sessions` — just needs a billable flag +
rate + convert-to-invoice-line), PDF template customization, Fixed Asset
Management (laptops/servers/pentest lab hardware).

**SKIP (explicitly, with reasoning):**
Sales Orders, Sales Receipts/POS, Client/Vendor Portal (clients already get
invoices via the existing Hermes/mailer pipeline — no need for external
logins), Purchase Orders (no formal procurement approval chain with 3
users), Stock/Warehouse inventory (no physical goods), direct GSTN filing
API integration (requires GSP onboarding — disproportionate for 3 internal
users; generate filing-ready *reports* instead, let the CA file), E-Way
Bills (goods-movement only), Composition Scheme, TCS, Payroll (separate
project, needs an HR module first), formal Workflow/Approval engine
(pointless with `creator` bypassing every gate anyway), generic
custom-field builder (YAGNI), standalone Documents module (**use Nextcloud**
per existing non-negotiable constraint, don't build a parallel file store),
Movement of Equity / ratio-analysis reports, Inventory valuation reports.

**FLAG — needs a decision before/during build, don't guess:**
- **Multi-currency** — only build if any of the 5 companies invoice/pay in a
  non-INR currency (e.g. AttackOS or game-dev clients billed in USD). If
  all-INR, skip — retrofitting multi-currency later is painful, so this
  needs an answer before the ledger schema is finalized.
- **E-invoicing (IRN/QR)** — legally required only once a company's turnover
  crosses ₹5 crore (see R&D 2). If none of the 5 are near that, skip active
  IRP integration but still capture the required fields (cheap, see below).
- **Retainer invoices** (advance payment applied against future work) —
  relevant if any pentest/CTF training contract collects an upfront
  deposit. Ask before deciding SHOULD vs SKIP.

**Information architecture** (Zoho Books' left-nav, for reference — CBOP's
actual IA should follow CLAUDE.md's existing conventions, not copy this
verbatim): Dashboard → Items → Banking → Sales (Quotes, Invoices, Recurring
Invoices, Payments Received, Credit Notes) → Purchases (Expenses, Bills,
Payments Made, Vendor Credits) → Projects/Timesheets → Accountant (Manual
Journals, Chart of Accounts, Fixed Assets) → GST Filing → Reports → Settings.
**Deliberate divergence from Zoho's UX**, per CLAUDE.md: slide-over panels
instead of full-page create forms, table filters instead of a global search
bar.

**Dashboard widgets** worth reusing conceptually: Total Receivables /
Payables (current vs. overdue), Cash Flow trend, Income vs. Expense bar
comparison, Top Expenses donut, Bank account balances list, Projects with
unbilled hours. Gate the money-shaped widgets (`ceo`/`creator` only, matching
existing finance route gating); `coo`/`cto` see a transactional subset
(invoices to follow up, expenses to categorize) without full P&L/cash
numbers.

**Audit trail, Zoho's actual implementation** (the direct precedent for our
own): captures the "4 Ws" — who, when, what, where — on every transaction
and settings change. Each edit creates a new *version*, not an overwrite;
version-compare UI shows color-coded diffs (yellow=modified,
green=added, red=deleted). Visible only to Admin-equivalent roles. Notably,
Zoho gates this feature specifically to India/UK/UAE/KSA/Bahrain/EU
orgs — i.e. it's a jurisdiction-driven compliance feature there too, not a
generic nice-to-have, which matches exactly why CBOP needs it as a MUST.

### R&D 2: Indian statutory compliance — what "filing-ready" actually requires

**GST filing shape.** GSTR-1 needs invoice-level B2B data (receiver GSTIN,
invoice no/date, place of supply → determines CGST+SGST vs IGST, taxable
value, tax split, SAC code), B2C aggregated by state/rate, a mandatory
HSN/SAC summary table, and credit/debit notes in the same shape. **As of
July 2025, GSTR-3B liability fields auto-drawn from GSTR-1 are hard-locked**
— no manual override at filing time, so invoice-level accuracy at entry is
non-negotiable, there's no "fix it in the summary" escape hatch anymore.
Invoice numbers must be consecutive, ≤16 chars, unique **per financial year**
(Apr–Mar) — CBOP's current `{CODE}-{YEAR}-{SEQUENCE}` format needs
verification that `{YEAR}` means financial year, not calendar year, or it
violates the FY-reset rule.

**E-invoicing (IRN/QR).** Mandatory only above ₹5 crore aggregate turnover
(any FY since 2017-18, once crossed always in scope). Almost certainly none
of CBOP's 5 companies are there yet, but the schema fields are a strict
superset of what GSTR-1 already needs (mainly: full legal name + registered
address, not just billing address) — **cheap to capture now, expensive to
retrofit later.** Direct IRP integration itself (GSP onboarding, digital
signing) is explicitly **not worth building** for a 3-user internal tool —
capture the fields, track rolling turnover to flag when a company crosses
the threshold, let the CA/a GSP tool handle actual transmission.

**TDS.** Sections relevant to CBOP's services businesses: **194C**
(contractor/works-contract, ₹30k single / ₹1L annual threshold, 1-2%),
**194J** (professional/technical fees — freelance devs, pentesters,
designers — ₹30k/year threshold, 10%), **194Q** (goods purchases, high
turnover threshold, 0.1%), **192** (salaries, slab-based). Cross-cutting:
**no PAN on file → TDS jumps to a much higher flat rate** (20% under 206AA),
so PAN capture per vendor directly changes deduction math, not just
metadata.

**The audit-trail law, specifically.** Companies (Accounts) Rules 2021
(Rule 3(1) proviso) requires accounting software used by companies to (a)
log every transaction, (b) create an edit log of every change with date,
(c) **be architecturally incapable of disabling the feature**. Effective FY
2023-24 onward. Statutory auditors must now affirmatively report whether the
software has this and whether it stayed on all year. Applies to companies
(Pvt Ltd etc.) under the Companies Act — not LLPs/partnerships — but since
CBOP is one shared platform across a mix of entity types, apply the
audit-trail architecture uniformly to all 5 companies; it's the right
engineering pattern regardless and avoids a two-tier data model. **"Cannot
be disabled" means, architecturally: no hard deletes anywhere in the
accounting domain, ever — not even for `creator`.** Voiding is a status
flag, never a `DELETE`. No UI/API path exists, for any role, to edit or
purge the audit log.

**Statutory books required at minimum**: trial balance, P&L, balance sheet,
general ledger, day book — real double-entry output, not a curated list of
invoices. **Period locking**: once a month's GST return is filed, entries
dated in that month become immutable — a real GST divergence bug, not a UI
nicety, since the filed return and the books must stay reconcilable.
Corrections after lock happen via reversing entries in the currently open
period, never by editing the past.

**Software vs. CA division of labor** (the load-bearing table for scoping
this whole project — do not build past this line):

| CBOP builds | CA does |
|---|---|
| GST-shaped invoice data (SAC, place of supply, tax split), GSTR-1/3B-shaped export reports | Actually filing on the GST portal, GSTR-2B reconciliation, ITC claims |
| E-invoice schema fields, turnover tracking/alerting | IRP transmission, IRN generation, GSP relationship |
| Vendor PAN + TDS section/rate + computed deduction | Depositing challans, filing 26Q/24Q, issuing Form 16/16A |
| Append-only audit log, no hard deletes | Signing off in the audit report that the audit trail stayed operative |
| Double-entry ledger → trial balance, P&L, balance sheet, general ledger, day book | Final financial statements, notes to accounts, audit opinion |
| Period-lock enforcement, reversing-entry-only after close | Deciding when to close a period, judgment adjustments before closing |

### R&D 3: subdomain SSO architecture (verified against actual `api/lib/auth.ts` and `docker-compose.yml`)

**Correction to CLAUDE.md**: `docker-compose.yml` already runs `cbop-app` as
its own containerized service (built from a standalone `Dockerfile`, port
3003) alongside `postgres` and `n8n` — the "docker-compose.yml only contains
postgres and n8n" line in CLAUDE.md is stale and should be fixed separately
from this project. This actually makes the new app easier: there's already
a proven container pattern to copy.

**Cookie sharing**: better-auth supports this natively via
`advanced.crossSubDomainCookies`. Set `domain: '.cbop.etherence.com'`
(leading dot) so the `cbop_session` cookie set at `cbop.etherence.com` is
readable at `accounting.etherence.com`. Add the accounting origin to
`trustedOrigins` (already extended via `BETTER_AUTH_TRUSTED_ORIGINS` env var
today). **Do not** widen the domain to bare `.etherence.com` — that would
leak the session to any future subdomain.

**API placement — recommendation: extend the existing Hono API, don't stand
up a second one.** New `/api/accounting/*` routes in the same `api/index.ts`,
reusing `requireAuth`/`requireRole` and the existing Postgres pool. A second
API service would mean duplicating or network-sharing the better-auth
instance for zero benefit at 3-user scale, plus accounting will need to join
against `sales_invoices`/`finance_*` data anyway — same-process coupling is
correct here.

**Session verification from the new app — recommendation: never run a
second `betterAuth()` instance.** The accounting app is a pure session
*consumer*. It calls the existing `GET /api/session` (already returns
`{ role, companyIds, companies, ... }` — exactly what's needed) with the
forwarded cookie header, server-side, on every authenticated page load.
Middleware does a fast cookie-presence check only (better-auth's own
guidance — full verification is unreliable in Edge runtime); the real
verification happens server-side via the `/api/session` call. This keeps a
single source of truth for identity/role/company-scope — no duplicated JWT
logic, and `creator`'s all-company bypass is inherited for free.

**"Continue with CBOP" flow**: landing page shows the button. If the shared
cookie is already present, clicking it just navigates straight into the
authenticated shell. If absent, it links to
`https://cbop.etherence.com/login?redirect=https://accounting.etherence.com/`
— CBOP's existing magic-link login sets the (now cross-subdomain) cookie and
bounces back.

**Correction, verified 2026-08-06 against the real box — this is NOT Nginx
Proxy Manager.** `cbop.etherence.com` routes through a **Cloudflare Tunnel**
(`/etc/cloudflared/config.yml`, tunnel `a31b55a4-3350-427a-a718-b70039519704`,
systemd unit `cloudflared-cbop.service`) directly to `localhost:3003` — NPM is
not in this path at all (it fronts the *other* homeserver services per
CLAUDE.md, not this one). The actual steps: (1) add a `CNAME` DNS record in
the Cloudflare dashboard, `accounting.cbop` →
`a31b55a4-3350-427a-a718-b70039519704.cfargotunnel.com`, proxied; (2) add one
ingress line to `/etc/cloudflared/config.yml`, **before** the
`http_status:404` catch-all:
```yaml
  - hostname: accounting.etherence.com
    service: http://localhost:3004
```
(3) `sudo systemctl restart cloudflared-cbop.service` to pick it up — note
this restart also bounces `wiki.cybercomctf.com`, which shares the same
tunnel, so time it accordingly. No Let's Encrypt cert to provision — Cloudflare
terminates TLS at its edge for tunnel hostnames. Purely additive otherwise —
no changes to the existing `cbop.etherence.com` ingress rule.

**Deployment shape — recommendation: same repo, sibling app directory, own
container.** Not a full monorepo toolchain (Turborepo/Nx is disproportionate
tooling for one more app), not a separate repo either (would split code
review and force duplicating shared types/session-fetch helpers for no
isolation benefit at this scale). `/accounting-app` as a sibling directory
with its own `package.json`/`Dockerfile`, added as one more service in
`docker-compose.yml` following the exact `cbop-app` pattern already proven
in production. Container-to-container calls (`accounting-app` →
`cbop-app:3000` over the Docker bridge) for server-side session fetches,
avoiding a public-hostname round-trip for internal calls.

**Role/company-scope carryover**: never re-derive role/companyIds in the
accounting app — always source from `GET /api/session`, wrapped in a
client-side `AccountingSessionProvider` for UI gating. Real authorization
stays enforced server-side on every `/api/accounting/*` route via the
existing `requireRole` + `WHERE company_id = ANY($1)` pattern; the
client-side context is UI convenience only, never the security boundary.

### R&D 4: double-entry ledger schema (verified against actual migrations for naming/pattern conventions)

Next migration: `migrations/059_acct_accounting_module.sql` (058 is the
current latest). Follows existing conventions exactly: `uuid_generate_v4()`
PKs, `TIMESTAMPTZ DEFAULT NOW()`, CHECK-constraint enums (this codebase
never uses native Postgres `ENUM`), `idx_<table>_<col>` index naming,
`set_updated_at()` trigger reuse.

**Design calls made (with reasoning, not left open):**
- **Chart of accounts is per-company-row, not shared** — journal entries,
  trial balance, and day-to-day bookkeeping stay scoped to each of the 6
  `companies` rows (ETH/PEN/CYB/ATK/QNT/ZAP), for internal management
  reporting per trading name. **Correction, 2026-08-05:** the original
  "5 separate legal entities, separate GSTINs" reasoning undercounted rows
  (there are 6) and over-assumed 1:1 row↔entity. Confirmed with Bala:
  **Etherence IT and Etherence Pentest are two trading names under ONE legal
  entity**, `companies.legal_name = 'Etherence Security Private Limited'`
  (migration 063). The other 4 rows are each their own entity. **This means
  GSTIN/PAN and any statutory filing (GSTR-1/3B, ROC, balance sheet) must
  roll up by `legal_name`, not by company row** — Etherence IT + Etherence
  Pentest's postings need a consolidated statutory view even though their
  charts of accounts stay separate for internal reporting. A shared chart
  *within* one legal entity's rows is therefore not automatically wrong the
  way sharing *across* entities would be — but no code should assume
  GSTIN/PAN lives 1:1 on a company row without checking `legal_name` first.
  Whoever picks up the accounting build should read `companies.legal_name`
  (migration 063) before finalizing the statutory-report query layer.
- **Balance enforcement happens at draft→posted transition**, via a trigger
  on `acct_journal_entries`, not a per-line constraint. Drafts may be
  unbalanced while being built in the UI; the DB refuses `posted` status
  until debits = credits.
- **Posted/void entries are immutable** — only `draft` may be edited or hard
  deleted. Voiding a posted entry creates status `'void'` plus (app-layer) an
  equal-and-opposite reversal entry; it never un-posts or deletes the
  original.
- **Period locking is a DB trigger, not app-layer-only.** This is a hard
  compliance boundary that must hold regardless of caller (UI, n8n, a future
  script) — an `if` in application code is one missed check away from a
  silent violation.
- **Audit log immutability is enforced via a trigger that unconditionally
  raises on UPDATE/DELETE, not `REVOKE`.** CBOP runs a single Postgres role
  (`cbop_user`) for both migrations and runtime — Postgres object owners
  bypass `REVOKE` on their own tables, so a `REVOKE` here would be a no-op
  in this deployment. The trigger has no such loophole.
- **GST/TDS metadata lives in a separate `acct_tax_details` table**, not as
  columns on journal lines — a journal line is a clean GL-account+amount
  pair (needed for trial balance / balance sheet); tax compliance metadata
  (GSTIN, HSN/SAC, rate breakdown, TDS section) would otherwise be `NULL` on
  95% of lines. Linked to the source document, with an optional back-link to
  the specific journal line once posted.
- **`source_id` / `doc_id` are deliberately polymorphic, no FK** — consistent
  with how the rest of the schema already handles per-table nullable FKs
  rather than a generic reference; Postgres has no native polymorphic FK, so
  this is the accepted, precedented tradeoff.

Full DDL (paste directly into `migrations/059_acct_accounting_module.sql`):

```sql
-- ═══════════════════════════════════════════════════════════════════════════
-- 1. Chart of accounts — per company
-- ═══════════════════════════════════════════════════════════════════════════
CREATE TABLE acct_chart_of_accounts (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id      UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  parent_id       UUID REFERENCES acct_chart_of_accounts(id) ON DELETE RESTRICT,
  account_code    TEXT NOT NULL,
  account_name    TEXT NOT NULL,
  account_type    TEXT NOT NULL CHECK (account_type IN ('asset', 'liability', 'equity', 'revenue', 'expense')),
  account_subtype TEXT,   -- free text e.g. 'current_asset','fixed_asset','current_liability','cogs' - grouping/reporting only
  normal_balance  TEXT NOT NULL CHECK (normal_balance IN ('debit', 'credit')),
  is_group        BOOLEAN NOT NULL DEFAULT false,  -- header/control account, not directly postable
  is_active       BOOLEAN NOT NULL DEFAULT true,
  description     TEXT,
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (company_id, account_code)
);
CREATE INDEX idx_acct_chart_of_accounts_company ON acct_chart_of_accounts(company_id);
CREATE INDEX idx_acct_chart_of_accounts_parent  ON acct_chart_of_accounts(parent_id);
CREATE INDEX idx_acct_chart_of_accounts_type    ON acct_chart_of_accounts(account_type);
CREATE TRIGGER trg_acct_chart_of_accounts_updated_at
  BEFORE UPDATE ON acct_chart_of_accounts
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ═══════════════════════════════════════════════════════════════════════════
-- 2. Fiscal periods — per company, month granularity, locking
-- ═══════════════════════════════════════════════════════════════════════════
CREATE TABLE acct_fiscal_periods (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id   UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  period_type  TEXT NOT NULL DEFAULT 'month' CHECK (period_type IN ('month', 'quarter')),
  period_start DATE NOT NULL,
  period_end   DATE NOT NULL,
  label        TEXT NOT NULL,   -- e.g. '2026-04' or 'FY2025-26 Q1'
  locked_at    TIMESTAMPTZ,
  locked_by    UUID REFERENCES users(id),
  created_at   TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (company_id, period_start, period_end),
  CHECK (period_end >= period_start)
);
CREATE INDEX idx_acct_fiscal_periods_company ON acct_fiscal_periods(company_id);
CREATE INDEX idx_acct_fiscal_periods_range   ON acct_fiscal_periods(company_id, period_start, period_end);

-- ═══════════════════════════════════════════════════════════════════════════
-- 3. Journal entries + lines
-- ═══════════════════════════════════════════════════════════════════════════
CREATE TABLE acct_journal_entries (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id        UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  entry_no          TEXT NOT NULL,          -- {COMPANY_CODE}-JE-{YEAR}-{SEQUENCE}, e.g. ETH-JE-2026-0001
  entry_date        DATE NOT NULL,
  fiscal_period_id  UUID REFERENCES acct_fiscal_periods(id),
  reference         TEXT,                   -- free text, e.g. "Invoice ETH-2026-0001"
  narration         TEXT,
  source_type       TEXT NOT NULL DEFAULT 'manual'
                      CHECK (source_type IN ('invoice', 'bill', 'expense', 'payment', 'manual', 'opening_balance')),
  source_id         UUID,                   -- polymorphic - points into sales_invoices/acct_bills/finance_expenses per source_type, no FK
  status            TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'posted', 'void')),
  posted_at         TIMESTAMPTZ,
  posted_by         UUID REFERENCES users(id),
  voided_at         TIMESTAMPTZ,
  voided_by         UUID REFERENCES users(id),
  void_reason       TEXT,
  reversal_of_id    UUID REFERENCES acct_journal_entries(id),  -- set on the reversal entry created when voiding a posted entry
  created_by        UUID NOT NULL REFERENCES users(id),
  created_at        TIMESTAMPTZ DEFAULT NOW(),
  updated_at        TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (company_id, entry_no)
);
CREATE INDEX idx_acct_journal_entries_company ON acct_journal_entries(company_id);
CREATE INDEX idx_acct_journal_entries_date    ON acct_journal_entries(entry_date);
CREATE INDEX idx_acct_journal_entries_status  ON acct_journal_entries(status);
CREATE INDEX idx_acct_journal_entries_source  ON acct_journal_entries(source_type, source_id);
CREATE INDEX idx_acct_journal_entries_period  ON acct_journal_entries(fiscal_period_id);
CREATE TRIGGER trg_acct_journal_entries_updated_at
  BEFORE UPDATE ON acct_journal_entries
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE acct_journal_entry_lines (
  id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  journal_entry_id UUID NOT NULL REFERENCES acct_journal_entries(id) ON DELETE CASCADE,
  company_id       UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,  -- denormalized, must match parent entry (trigger-enforced)
  line_no          INT NOT NULL,
  account_id       UUID NOT NULL REFERENCES acct_chart_of_accounts(id),
  debit            NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (debit >= 0),
  credit           NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (credit >= 0),
  description      TEXT,
  created_at       TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (journal_entry_id, line_no),
  CHECK (NOT (debit > 0 AND credit > 0)),   -- a line is either a debit or a credit, never both
  CHECK (debit > 0 OR credit > 0)           -- a line must move money one way
);
CREATE INDEX idx_acct_journal_entry_lines_entry   ON acct_journal_entry_lines(journal_entry_id);
CREATE INDEX idx_acct_journal_entry_lines_account ON acct_journal_entry_lines(account_id);
CREATE INDEX idx_acct_journal_entry_lines_company ON acct_journal_entry_lines(company_id);

-- Enforcement: line.company_id must match its parent entry's company_id
CREATE OR REPLACE FUNCTION acct_check_line_company_match() RETURNS TRIGGER AS $$
BEGIN
  IF NEW.company_id != (SELECT company_id FROM acct_journal_entries WHERE id = NEW.journal_entry_id) THEN
    RAISE EXCEPTION 'acct_journal_entry_lines.company_id must match parent journal entry company_id';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER trg_acct_journal_entry_lines_company_match
  BEFORE INSERT OR UPDATE ON acct_journal_entry_lines
  FOR EACH ROW EXECUTE FUNCTION acct_check_line_company_match();

-- Enforcement: entry must balance (debits = credits) before it may be posted
CREATE OR REPLACE FUNCTION acct_check_entry_balances_on_post() RETURNS TRIGGER AS $$
DECLARE
  total_debit  NUMERIC(14,2);
  total_credit NUMERIC(14,2);
BEGIN
  IF NEW.status = 'posted' AND OLD.status IS DISTINCT FROM 'posted' THEN
    SELECT COALESCE(SUM(debit), 0), COALESCE(SUM(credit), 0)
      INTO total_debit, total_credit
      FROM acct_journal_entry_lines WHERE journal_entry_id = NEW.id;
    IF total_debit = 0 AND total_credit = 0 THEN
      RAISE EXCEPTION 'Cannot post journal entry %: has no lines', NEW.entry_no;
    END IF;
    IF total_debit != total_credit THEN
      RAISE EXCEPTION 'Cannot post journal entry %: debits (%) != credits (%)', NEW.entry_no, total_debit, total_credit;
    END IF;
    NEW.posted_at := NOW();
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER trg_acct_journal_entries_balance_check
  BEFORE UPDATE ON acct_journal_entries
  FOR EACH ROW EXECUTE FUNCTION acct_check_entry_balances_on_post();

-- Enforcement: posted/void entries are immutable (only draft may be edited/deleted)
CREATE OR REPLACE FUNCTION acct_prevent_posted_mutation() RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.status IN ('posted', 'void') THEN
      RAISE EXCEPTION 'Cannot delete a % journal entry (%)', OLD.status, OLD.entry_no;
    END IF;
    RETURN OLD;
  END IF;
  IF OLD.status = 'void' THEN
    RAISE EXCEPTION 'Cannot modify a void journal entry (%)', OLD.entry_no;
  END IF;
  IF OLD.status = 'posted' AND NOT (NEW.status = 'void' AND NEW.entry_no = OLD.entry_no AND NEW.entry_date = OLD.entry_date) THEN
    RAISE EXCEPTION 'Cannot modify a posted journal entry (%) except to void it', OLD.entry_no;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER trg_acct_journal_entries_immutability
  BEFORE UPDATE OR DELETE ON acct_journal_entries
  FOR EACH ROW EXECUTE FUNCTION acct_prevent_posted_mutation();

CREATE OR REPLACE FUNCTION acct_prevent_posted_line_mutation() RETURNS TRIGGER AS $$
DECLARE
  entry_status TEXT;
BEGIN
  SELECT status INTO entry_status FROM acct_journal_entries
    WHERE id = COALESCE(NEW.journal_entry_id, OLD.journal_entry_id);
  IF entry_status IN ('posted', 'void') THEN
    RAISE EXCEPTION 'Cannot modify lines of a % journal entry', entry_status;
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER trg_acct_journal_entry_lines_immutability
  BEFORE INSERT OR UPDATE OR DELETE ON acct_journal_entry_lines
  FOR EACH ROW EXECUTE FUNCTION acct_prevent_posted_line_mutation();

-- Enforcement: no entry may be created/dated into a locked fiscal period
CREATE OR REPLACE FUNCTION acct_check_period_not_locked() RETURNS TRIGGER AS $$
DECLARE
  is_locked BOOLEAN;
BEGIN
  SELECT (locked_at IS NOT NULL) INTO is_locked
    FROM acct_fiscal_periods
    WHERE company_id = NEW.company_id AND NEW.entry_date BETWEEN period_start AND period_end
    LIMIT 1;
  IF is_locked THEN
    RAISE EXCEPTION 'Cannot post/edit journal entry dated %: fiscal period is locked', NEW.entry_date;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER trg_acct_journal_entries_period_lock
  BEFORE INSERT OR UPDATE ON acct_journal_entries
  FOR EACH ROW EXECUTE FUNCTION acct_check_period_not_locked();

-- Fiscal periods cannot be unlocked through the application once locked
CREATE OR REPLACE FUNCTION acct_prevent_unlock() RETURNS TRIGGER AS $$
BEGIN
  IF OLD.locked_at IS NOT NULL AND NEW.locked_at IS NULL THEN
    RAISE EXCEPTION 'Fiscal periods cannot be unlocked through the application';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER trg_acct_fiscal_periods_no_unlock
  BEFORE UPDATE ON acct_fiscal_periods
  FOR EACH ROW EXECUTE FUNCTION acct_prevent_unlock();

-- ═══════════════════════════════════════════════════════════════════════════
-- 4. Vendor bills (AP)
-- ═══════════════════════════════════════════════════════════════════════════
CREATE TABLE acct_bills (
  id                     UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id             UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  vendor_name            TEXT NOT NULL,     -- free text; no acct_vendors master table yet, add later if needed
  bill_no                TEXT,              -- vendor's own bill number, not CBOP-generated
  bill_date              DATE NOT NULL,
  due_date               DATE,
  amount                 NUMERIC(14,2) NOT NULL,
  status                 TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'approved', 'paid', 'void')),
  journal_entry_id       UUID REFERENCES acct_journal_entries(id),  -- AP-recognition entry (Dr Expense, Cr Accounts Payable)
  paid_journal_entry_id  UUID REFERENCES acct_journal_entries(id),  -- payment entry (Dr Accounts Payable, Cr Cash/Bank)
  created_by             UUID NOT NULL REFERENCES users(id),
  created_at             TIMESTAMPTZ DEFAULT NOW(),
  updated_at             TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_acct_bills_company ON acct_bills(company_id);
CREATE INDEX idx_acct_bills_status  ON acct_bills(status);
CREATE TRIGGER trg_acct_bills_updated_at
  BEFORE UPDATE ON acct_bills
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ═══════════════════════════════════════════════════════════════════════════
-- 5. GST/TDS metadata — separate from journal lines, linked to source docs
-- ═══════════════════════════════════════════════════════════════════════════
CREATE TABLE acct_tax_details (
  id                    UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id            UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  doc_type              TEXT NOT NULL CHECK (doc_type IN ('invoice', 'bill')),
  doc_id                UUID NOT NULL,   -- polymorphic: sales_invoices.id or acct_bills.id per doc_type, no FK
  journal_entry_line_id UUID REFERENCES acct_journal_entry_lines(id),  -- back-link once posted; nullable until then
  counterparty_gstin    TEXT,
  hsn_sac_code          TEXT,
  taxable_value         NUMERIC(14,2) NOT NULL,
  cgst_rate             NUMERIC(5,2)  NOT NULL DEFAULT 0,
  cgst_amount           NUMERIC(14,2) NOT NULL DEFAULT 0,
  sgst_rate             NUMERIC(5,2)  NOT NULL DEFAULT 0,
  sgst_amount           NUMERIC(14,2) NOT NULL DEFAULT 0,
  igst_rate             NUMERIC(5,2)  NOT NULL DEFAULT 0,
  igst_amount           NUMERIC(14,2) NOT NULL DEFAULT 0,
  cess_amount           NUMERIC(14,2) NOT NULL DEFAULT 0,
  tds_section           TEXT,          -- e.g. '194C','194J','194Q' - free text, law changes more often than a CHECK should be maintained
  tds_rate              NUMERIC(5,2),
  tds_amount            NUMERIC(14,2) DEFAULT 0,
  created_at            TIMESTAMPTZ DEFAULT NOW(),
  CHECK (NOT (cgst_amount > 0 AND igst_amount > 0))  -- intra-state and inter-state are mutually exclusive on one line
);
CREATE INDEX idx_acct_tax_details_company ON acct_tax_details(company_id);
CREATE INDEX idx_acct_tax_details_doc     ON acct_tax_details(doc_type, doc_id);
CREATE INDEX idx_acct_tax_details_line    ON acct_tax_details(journal_entry_line_id);

-- ═══════════════════════════════════════════════════════════════════════════
-- 6. Audit log — append-only, statutory audit-trail requirement
-- ═══════════════════════════════════════════════════════════════════════════
CREATE TABLE acct_audit_log (
  id             UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  table_name     TEXT NOT NULL,
  record_id      UUID NOT NULL,
  company_id     UUID,            -- denormalized for fast per-company filtering
  action         TEXT NOT NULL CHECK (action IN ('insert', 'update', 'delete')),
  actor_user_id  UUID REFERENCES users(id),
  actor_role     TEXT,            -- role at time of action, snapshot (roles can change later)
  before_json    JSONB,
  after_json     JSONB,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_acct_audit_log_table_record ON acct_audit_log(table_name, record_id);
CREATE INDEX idx_acct_audit_log_company      ON acct_audit_log(company_id);
CREATE INDEX idx_acct_audit_log_actor        ON acct_audit_log(actor_user_id);
CREATE INDEX idx_acct_audit_log_created      ON acct_audit_log(created_at DESC);

-- Append-only enforcement — this is the authoritative mechanism, not a REVOKE
-- (CBOP runs a single Postgres role for migrations + runtime; table owners
-- bypass REVOKE on their own tables, so REVOKE alone would be a no-op here).
CREATE OR REPLACE FUNCTION acct_audit_log_immutable() RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'acct_audit_log is append-only: % is not permitted', TG_OP;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER trg_acct_audit_log_no_update BEFORE UPDATE ON acct_audit_log
  FOR EACH ROW EXECUTE FUNCTION acct_audit_log_immutable();
CREATE TRIGGER trg_acct_audit_log_no_delete BEFORE DELETE ON acct_audit_log
  FOR EACH ROW EXECUTE FUNCTION acct_audit_log_immutable();

-- Generic writer, attached to every acct_* table that needs an edit log.
-- IMPORTANT: every mutating request handler must call
--   SELECT set_config('cbop.current_user_id', $1, true);
--   SELECT set_config('cbop.current_role', $2, true);
-- (using c.get('userId') / c.get('role') from requireAuth) at the top of its
-- transaction, or actor_user_id/actor_role silently go NULL. Add this to the
-- code-review checklist for every new acct_* route.
CREATE OR REPLACE FUNCTION acct_write_audit_log() RETURNS TRIGGER AS $$
DECLARE
  v_company_id UUID;
BEGIN
  BEGIN
    v_company_id := (to_jsonb(COALESCE(NEW, OLD))->>'company_id')::UUID;
  EXCEPTION WHEN OTHERS THEN
    v_company_id := NULL;
  END;
  INSERT INTO acct_audit_log (table_name, record_id, company_id, action, actor_user_id, actor_role, before_json, after_json)
  VALUES (
    TG_TABLE_NAME, COALESCE(NEW.id, OLD.id), v_company_id, lower(TG_OP),
    current_setting('cbop.current_user_id', true)::UUID,
    current_setting('cbop.current_role', true),
    CASE WHEN TG_OP != 'INSERT' THEN to_jsonb(OLD) END,
    CASE WHEN TG_OP != 'DELETE' THEN to_jsonb(NEW) END
  );
  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_acct_chart_of_accounts_audit  AFTER INSERT OR UPDATE OR DELETE ON acct_chart_of_accounts  FOR EACH ROW EXECUTE FUNCTION acct_write_audit_log();
CREATE TRIGGER trg_acct_journal_entries_audit    AFTER INSERT OR UPDATE OR DELETE ON acct_journal_entries    FOR EACH ROW EXECUTE FUNCTION acct_write_audit_log();
CREATE TRIGGER trg_acct_journal_entry_lines_audit AFTER INSERT OR UPDATE OR DELETE ON acct_journal_entry_lines FOR EACH ROW EXECUTE FUNCTION acct_write_audit_log();
CREATE TRIGGER trg_acct_fiscal_periods_audit     AFTER INSERT OR UPDATE OR DELETE ON acct_fiscal_periods     FOR EACH ROW EXECUTE FUNCTION acct_write_audit_log();
CREATE TRIGGER trg_acct_bills_audit              AFTER INSERT OR UPDATE OR DELETE ON acct_bills              FOR EACH ROW EXECUTE FUNCTION acct_write_audit_log();
```

**How this links to existing tables** (no schema change needed on either):

- `sales_invoices` (AR, unchanged): on send, create one `acct_journal_entries`
  row (`source_type='invoice'`) — `Dr Accounts Receivable` / `Cr Revenue` /
  `Cr GST Output`. On payment, a second entry (`source_type='payment'`) —
  `Dr Cash/Bank` / `Cr Accounts Receivable`.
- `finance_expenses` (being deprecated, not deleted): one-time backfill
  migration writes one journal entry per existing row
  (`source_type='expense'`). After backfill it becomes **read-only**
  (existing `/api/finance/expenses` reads keep working); all new expense
  entry goes through `acct_journal_entries` directly or `acct_bills`.

---

## Feature-parity acceptance bar

The rebuilt Accounting app is "done" for v1 when it can, for any of the 5
companies, independently:
1. Record a sale (invoice → payment) and a purchase (bill → payment) as
   real double-entry postings, not flat rows.
2. Produce, on demand, per company per period: trial balance, P&L, balance
   sheet, general ledger, day book, AR aging, AP aging.
3. Produce GSTR-1-shaped and GSTR-3B-shaped export reports a CA can use
   directly.
4. Show, for any transaction, a full edit history (who/when/what changed) —
   and make it structurally impossible for any role, including `creator`,
   to delete or alter that history.
5. Lock a fiscal period and have the system refuse any further edit to
   entries dated inside it.
6. Show a real cross-company rollup view (all 5 companies' revenue,
   expenses, AR/AP at once) — the thing the current page can't do at all.

---

## Phase 3 — Build slices (proposed order, not yet started)

1. **Schema** — apply `migrations/059_acct_accounting_module.sql` as above.
   Seed a default chart of accounts per company (standard Indian SMB
   template: Assets/Liabilities/Equity/Revenue/Expense groups with common
   sub-accounts).
2. **Ledger engine (API only, no UI yet)** — `api/routes/accounting.ts`:
   CRUD for chart of accounts, journal entries (draft/post/void), fiscal
   period lock/unlock-is-manual-only. Backfill migration from
   `finance_expenses` → `acct_journal_entries`. Wire the
   `set_config('cbop.current_user_id', ...)` pattern into every mutating
   handler (see audit-log note above) — this is easy to forget and silently
   breaks the audit trail if skipped.
3. **App shell + auth handoff** — new `/accounting-app` Next.js app,
   `crossSubDomainCookies` config change in `api/lib/auth.ts`, new Cloudflare
   Tunnel ingress rule + DNS CNAME for `accounting.etherence.com` (see the
   corrected section above — no NPM/Let's Encrypt involved), landing page with
   "Continue with CBOP", `AccountingSessionProvider` fetching
   `/api/session`. Own loading screen, own shell chrome (can reuse CBOP's
   design tokens/fonts without reusing its exact sidebar).
4. **Core transactional UI** — Invoices (already exists in `sales_invoices`,
   extend to post journal entries), Bills, Expenses (migrate quick-add UX
   from the old `/accounting` page), Payments Received/Made, Bank/Cash
   accounts + manual reconciliation, Transfer Funds.
5. **Reports** — Trial Balance, P&L, Balance Sheet, General Ledger, Day
   Book, AR/AP Aging, Customer/Vendor Balance Summary, cross-company rollup
   dashboard.
6. **GST/TDS** — `acct_tax_details` wiring on invoice/bill entry, GSTR-1 and
   GSTR-3B export reports, HSN/SAC code picker (validated list, not free
   text), vendor PAN + TDS section/rate capture, TDS-deduction ledger.
7. **Audit trail UI** — version history per transaction, diff view
   (old/new, color-coded per the Zoho precedent), gated to `ceo`/`creator`.
8. **Period locking UI** — close-period action (CEO/creator only, logged),
   reversing-entry flow for post-close corrections.
9. **Cutover** — old `/accounting` page in the main CBOP app either
   redirects to `accounting.etherence.com` or is removed; `finance_*`
   routes in `api/routes/finance.ts` become thin wrappers over the new
   ledger where practical, left alone where `finance_personal_wealth` /
   CEO-only scenario-planning features aren't in scope for this rebuild.

## Explicit non-goals (prevent scope creep)

- No direct GST portal filing (GSTN API/GSP integration). Reports only.
- No direct IRP e-invoice transmission. Fields captured, transmission is the
  CA's/a GSP tool's job.
- No payroll. Separate project, needs an HR module first.
- No client-facing portal or client logins into the accounting app.
- No multi-currency unless confirmed needed (FLAG above — ask before
  building, don't default either way).
- No formal approval-workflow engine — `creator`/`ceo` gating is sufficient
  at 3-user scale.
- No standalone document storage — attach via Nextcloud links.
- `finance_personal_wealth` stays exactly as gated today (CEO-only, never
  enters any agent/LLM prompt context) — this rebuild does not touch it.

## Open questions for Bala (answer before Slice 1, not mid-build)

1. Does any of the 5 companies invoice or pay in a non-INR currency? (drives
   multi-currency FLAG)
2. Is any company's turnover near ₹5 crore? (drives e-invoicing FLAG/urgency)
3. Do any current client contracts (pentest/CTF training especially) take an
   upfront deposit? (drives retainer-invoice SHOULD vs SKIP)
4. Confirm `{COMPANY_CODE}-{YEAR}-{SEQUENCE}` invoice numbering uses
   financial year (Apr–Mar), not calendar year — needs a fix before GST
   filing-readiness is real if it's currently calendar-based.

## Next session — first action

Start Slice 1: create `migrations/059_acct_accounting_module.sql` from the
DDL above, run it against a local/dev Postgres, verify all triggers fire as
expected (try posting an unbalanced entry, try deleting a posted entry, try
editing the audit log directly — all three must fail). Do not start on the
UI or the new subdomain app until the ledger engine (Slice 2) is solid and
manually tested via API calls.
