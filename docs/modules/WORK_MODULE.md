# /work Module — How It Works

**Last updated:** 2026-06-16
**Status:** Built and live. No automations (n8n) wired to this module yet.

This doc exists so the next session doesn't have to re-read 2,100+ lines of
`app/(dashboard)/work/page.tsx` to make a change. Read this first, then jump
straight to the relevant function with `grep -n "function X"`.

---

## One-page mental model

```
/work
  ├── Tasks tab     — kanban board (todo / in_progress / review / done)
  ├── Projects tab  — table of projects, client OR internal, with progress bar
  ├── R&D tab       — split panel: initiatives (left) + dated log (right)
  └── Sessions tab  — work session log (goal → output), tied to a project
```

Tasks and Sessions both **require a project** (`ops_tasks.project_id NOT NULL`
per `CLAUDE.md` — "every task requires a project, no orphan tasks"). Projects
can now be `client` (tied to a company) or `internal` (no company). R&D
initiatives are a separate, lighter-weight entity — they don't go through
projects/tasks at all, just initiative → log entries.

**No n8n automation touches `/work` currently.** Tasks, projects, sessions,
and R&D initiatives are pure CRUD through the Hono API — nothing schedules,
reminds, or auto-creates them. If you want e.g. "task due today → Telegram
ping", that's a new n8n workflow + webhook, not yet built.

---

## Data model

### `ops_projects` (existing table, extended in migration 018)
```sql
ops_projects (
  id          UUID PRIMARY KEY,
  company_id  UUID REFERENCES companies(id),   -- NULLABLE since migration 018
  name        TEXT NOT NULL,
  owner_id    UUID REFERENCES users(id),
  status      TEXT CHECK (status IN ('active','on_hold','completed','cancelled')),
  work_type   VARCHAR(20) NOT NULL DEFAULT 'client',  -- 'client' | 'internal' — added in 018
  deadline    DATE,
  description TEXT,
  created_at  TIMESTAMPTZ DEFAULT NOW()
)
```
`work_type = 'internal'` is how CBOP/tooling, team process, infra/devops, and
marketing/content work gets tracked without forcing a fake company. The
internal project categories the user asked for (from the original session)
are just **project names** under `work_type = 'internal'` — there's no
separate "internal category" enum, it's freeform via `name`/`description`.

### `ops_tasks` / `ops_work_sessions` (unchanged schema, queries patched)
Both still have `company_id` (nullable) and `project_id` (NOT NULL FK). They
inherit "internal-ness" from their parent project, not from their own
`company_id` column — see **Known gotcha** below.

### `rnd_initiatives` + `rnd_log_entries` (new in migration 018)
```sql
rnd_initiatives (
  id, title, description,
  domain      VARCHAR(50)  DEFAULT 'other',   -- security|ctf|design|ai|infra|devops|marketing|tooling|other
  status      VARCHAR(20)  DEFAULT 'exploring', -- exploring|active|paused|concluded
  company_id  UUID NULL,                       -- optional, not required
  outcome     TEXT,                            -- conclusion, filled in later
  tags        TEXT[] DEFAULT '{}',
  created_by_id, created_at, updated_at
)

rnd_log_entries (
  id, initiative_id UUID NOT NULL REFERENCES rnd_initiatives ON DELETE CASCADE,
  body        TEXT NOT NULL,
  entry_type  VARCHAR(20) DEFAULT 'note',  -- note|experiment|finding|prototype|milestone|blocker
  created_by_id, created_at
)
```
Posting a log entry bumps `rnd_initiatives.updated_at` (also via trigger on
direct UPDATE) so the initiative list sorts by recency, not creation date.

Design choice: **initiative + freeform log entries, not hypothesis-driven.**
R&D here spans "redesign portfolio site" to "CTF infra overhaul" to "AI
automations" — too varied for a rigid hypothesis/experiment template. Decided
in the prior session; don't relitigate without new info.

---

## API surface

| Method | Path | Notes |
|---|---|---|
| GET | `/api/projects?work_type=` | `work_type` optional filter. Returns internal projects regardless of `company_id` scope. |
| POST | `/api/projects` | `work_type` defaults `'client'`. `company_id` required only if client. |
| PATCH | `/api/projects/:id` | Scope check: `company_id = ANY(companyIds) OR work_type = 'internal'`. |
| GET | `/api/tasks?project_id=&mine=true` | Scope: `company_id = ANY(companyIds) OR <parent project>.work_type = 'internal'`. |
| POST | `/api/tasks` | Looks up project first; 404s if project not in scope and not internal. |
| PATCH | `/api/tasks/:id` | Same internal-aware scope check (fixed this session — see gotcha below). |
| GET / POST / PATCH | `/api/sessions` | Same pattern as tasks, project-scoped. |
| GET | `/api/rnd/initiatives?status=&domain=` | No company scoping at all — R&D is visible to all 3 users regardless of companyIds. |
| POST | `/api/rnd/initiatives` | `title` required; `domain`/`company_id` optional. |
| PATCH | `/api/rnd/initiatives/:id` | Partial update via `COALESCE` — status, outcome, domain, etc. |
| DELETE | `/api/rnd/initiatives/:id` | Cascades to log entries. |
| GET / POST | `/api/rnd/initiatives/:id/log` | Post bumps parent `updated_at`. |
| DELETE | `/api/rnd/log/:id` | No ownership check — any authenticated user can delete any entry (matches the 3-user trust model of this app). |

Files: `api/routes/projects.ts`, `api/routes/tasks.ts`,
`api/routes/work-sessions.ts`, `api/routes/rnd.ts`.

---

## Known gotcha — fixed this session, watch for regressions

**Internal projects have `company_id = NULL`.** Any SQL of the shape
`WHERE company_id = ANY($companyIds)` silently excludes them, because
`NULL = ANY(array)` evaluates to `NULL` (falsy), not an error — it just
quietly returns zero rows. This bit:

- `tasks.ts` GET/POST/PATCH — fixed to `(company_id = ANY($1) OR <project>.work_type = 'internal')`
- `work-sessions.ts` GET/POST/PATCH — same fix

**If you add a new query touching `ops_tasks` or `ops_work_sessions`,
always OR against the parent project's `work_type = 'internal'` — never
gate purely on `company_id`.** The same trap will resurface for any new
table that hangs off `ops_projects` with its own `company_id` column.

`ops_projects` itself doesn't have this trap anymore because its own routes
already check `work_type = 'internal'` directly (no JOIN needed).

---

## Frontend structure — `app/(dashboard)/work/page.tsx` (~2150 lines)

Single file, no sub-components extracted to separate files (consistent with
how `/hiring` and `/settings` are also single mega-files in this codebase).

```
Types (line ~8)          WorkTab, Task, Project, RndInitiative, RndLogEntry, Session, User, Company
Helpers (line ~88)       fmtDate, isOverdue, timeAgo, style constants (PRIORITY_STYLE, PROJECT_STATUS_STYLE, DOMAIN_STYLE, RND_STATUS_STYLE, ENTRY_TYPE_STYLE)
TaskCard / TaskSlideOver / NewTaskSlideOver       (~line 133–460)
TasksTab()                line 462    — kanban, mineOnly toggle, drag is click-to-edit not drag-drop
NewProjectSlideOver()     line 647    — work_type toggle (client/internal), conditional company picker
ProjectDetailSlideOver()  line 784
ProjectsTab()             line 973    — type filter pills (All/Client/Internal), Type badge column
NewInitiativeSlideOver()  R&D section — title/domain/company/description
RndTab()                  R&D section — split panel, see below
Session components + SessionsTab()   line 1447
WorkPage() (default export)          line ~2095 — TABS array + tab switcher
```

### RndTab() layout
- **Left (320px fixed)**: status + domain filter dropdowns, "+ New Initiative"
  button, scrollable list. Each row: title, status badge, domain badge,
  company chip (if set), entry count + relative time.
- **Right (flex-1)**: empty state until you select an initiative. Once
  selected: header (title, domain, company, description, delete ✕),
  status buttons (exploring/active/paused/concluded — click to set, no
  confirm), outcome box (inline edit, green background once filled),
  scrollable log feed (newest first, color-coded by entry_type), and a
  fixed-bottom composer with 6 entry-type chips + textarea +
  Enter-to-post/Shift+Enter-for-newline.

### Color tokens used (not in the global design system table, local to this module)
```
DOMAIN_STYLE:      security #D13212/#FEF0EE · ctf #7C3AED/#F3E8FF · design #0073BB/#EBF5FB
                   ai #1D8102/#EBF5E8 · infra #E8820C/#FEF8EE · devops #546474/#F2F3F3
                   marketing #BE185D/#FEF0EE · tooling #0891B2/#E0F7FA · other #687078/#F2F3F3
RND_STATUS_STYLE:  exploring (blue) · active (green) · paused (amber) · concluded (gray)
ENTRY_TYPE_STYLE:  note 📝 · experiment 🧪 · finding ✅ · prototype 🔧 · milestone 🏁 · blocker 🚧
Project Type badge: client #0073BB/#EBF5FB · internal #7C3AED/#F3E8FF
```

---

## Things deliberately NOT built (in case "should we add X" comes up)

- **No drag-and-drop on the kanban board** — TaskCard click opens a
  slide-over with a Status dropdown instead. Matches "slide-over panels
  only, no modals" from `CLAUDE.md`, and drag-and-drop wasn't asked for.
- **No company scoping on R&D** — all 3 users see all initiatives regardless
  of `companyIds`. Intentional: R&D spans companies by nature (e.g. AI
  automations benefit everyone), and there are only 3 users total.
- **No automation/reminders** — no n8n workflow watches task due dates,
  stale R&D initiatives, or session completion. Nothing pings Telegram from
  this module today.
- **No task templates for internal/R&D work** — `ops_task_templates` is
  service_type-driven (client onboarding flows only). Internal work and R&D
  initiatives are created ad hoc.

---

## Likely next steps (pick up here)

1. **n8n automation**: "task overdue" or "R&D initiative idle 14+ days"
   digest via Telegram (uses existing `sendViaHermes()` / cbop-bridge — no
   new infra).
2. **Task drag-and-drop** on the kanban board if click-to-edit feels slow
   in practice (currently no complaint on record — don't build speculatively).
3. **Link R&D initiatives to projects** — e.g. "this initiative spawned
   project X" — not requested yet, just a natural extension if R&D work
   graduates into execution.
4. **Wire hiring.ts to read from `hiring_settings`** — unrelated to /work,
   but still the long-standing item in `HANDOFF.md`.
