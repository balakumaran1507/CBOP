/**
 * Module registry — the SINGLE source of truth for CBOP feature areas.
 *
 * Every module carries three things:
 *  1. `roles`  — the default role→module map, used as the fallback for users
 *                who predate migration 057 (no `company_role_id`). For 057+
 *                users the authoritative list lives in `role_module_access`.
 *  2. `nav`    — where the module appears in the sidebar (space + href + icon).
 *                A module without `nav` has no page of its own yet.
 *  3. `core`   — always navigable; not subject to the company toggle or the
 *                role list. Only the dashboard qualifies: every user needs a
 *                landing page.
 *
 * The sidebar renders from `buildNavManifest()` and nothing else — it holds no
 * role list and no nav array of its own, so the two cannot drift (IF-5).
 *
 * Rules:
 *  - 'creator' always bypasses every gate (enforced in requireModule middleware)
 *  - Finance, mentor, tax, audit, settings, command, website are CEO+creator only
 *  - Accounting is split, not module-gated CEO-only: COO/CTO get the module (day-to-day
 *    bookkeeping — invoices, bills, expenses, journal entries) and the sensitive aggregate
 *    routes (P&L, balance sheet, trial balance, cross-company rollup, period locking) carry
 *    an additional requireRole('ceo') at the route level, same pattern as everything else
 *    below "equal power over business data" but with a CEO-only ceiling on the reports that
 *    actually reveal financial position. Decided 2026-08-05 — see
 *    docs/modules/ACCOUNTING_Build_Plan.md, this was the whole reason that rebuild exists:
 *    the old /accounting page 403'd COO/CTO on everything because /api/finance/* is
 *    unconditionally requireRole('ceo'), and that bug should not be reproduced here.
 *  - COO and CTO are equal power over business data (see CLAUDE.md "Role model")
 */

export type ModuleSpace = 'revenue' | 'growth' | 'people' | 'knowledge' | 'system'

export interface ModuleNav {
  space: ModuleSpace
  href: string
  /** lucide-react icon name — mapped to a component in app/components/sidebar.tsx */
  icon: string
}

export interface ModuleDef {
  label: string
  roles: readonly string[]
  nav?: ModuleNav
  core?: boolean
}

/** Sidebar groups, in render order. */
export const MODULE_SPACES: readonly { id: ModuleSpace; label: string }[] = [
  { id: 'revenue',   label: 'Revenue' },
  { id: 'growth',    label: 'Growth' },
  { id: 'people',    label: 'People' },
  { id: 'knowledge', label: 'Knowledge' },
  { id: 'system',    label: 'System' },
] as const

const BUSINESS = ['ceo', 'coo', 'cto', 'creator'] as const
const CEO_ONLY = ['ceo', 'creator'] as const

// Declaration order is nav order within each space.
export const MODULES = {
  // ── Revenue ────────────────────────────────────────────────────────────────
  dashboard:    { label: 'Dashboard',      roles: BUSINESS, core: true,
                  nav: { space: 'revenue',   href: '/dashboard',    icon: 'LayoutDashboard' } },
  sales:        { label: 'Sales',          roles: BUSINESS,
                  nav: { space: 'revenue',   href: '/sales',        icon: 'TrendingUp' } },
  accounting:   { label: 'Accounting',     roles: BUSINESS,
                  nav: { space: 'revenue',   href: '/accounting',   icon: 'Calculator' } },
  tax:          { label: 'Tax',            roles: CEO_ONLY,
                  nav: { space: 'revenue',   href: '/tax',          icon: 'Landmark' } },

  // ── Growth ─────────────────────────────────────────────────────────────────
  campaigns:    { label: 'Campaigns',      roles: BUSINESS,
                  nav: { space: 'growth',    href: '/campaigns',    icon: 'Megaphone' } },
  email_studio: { label: 'Email Studio',   roles: BUSINESS,
                  nav: { space: 'growth',    href: '/email-studio', icon: 'Mail' } },
  subscribers:  { label: 'Subscribers',    roles: BUSINESS,
                  nav: { space: 'growth',    href: '/subscribers',  icon: 'UserCheck' } },
  social:       { label: 'Social',         roles: BUSINESS,
                  nav: { space: 'growth',    href: '/social',       icon: 'Share2' } },
  blog:         { label: 'Blog',           roles: BUSINESS,
                  nav: { space: 'growth',    href: '/blog',         icon: 'Newspaper' } },
  seo:          { label: 'SEO',            roles: BUSINESS,
                  nav: { space: 'growth',    href: '/seo',          icon: 'BarChart2' } },
  website:      { label: 'Website',        roles: CEO_ONLY,
                  nav: { space: 'growth',    href: '/website',      icon: 'Globe' } },

  // ── People ─────────────────────────────────────────────────────────────────
  hiring:       { label: 'Hiring',         roles: BUSINESS,
                  nav: { space: 'people',    href: '/hiring',       icon: 'Users' } },
  people:       { label: 'Employees',      roles: BUSINESS,
                  nav: { space: 'people',    href: '/people',       icon: 'Users' } },
  work:         { label: 'Work',           roles: BUSINESS,
                  nav: { space: 'people',    href: '/work',         icon: 'LayoutList' } },

  // ── Knowledge ──────────────────────────────────────────────────────────────
  documents:    { label: 'Documents',      roles: BUSINESS,
                  nav: { space: 'knowledge', href: '/documents',    icon: 'FileText' } },
  templates:    { label: 'Templates',      roles: BUSINESS,
                  nav: { space: 'knowledge', href: '/templates',    icon: 'FileCode2' } },
  legal:        { label: 'Legal',          roles: BUSINESS,
                  nav: { space: 'knowledge', href: '/legal',        icon: 'Scale' } },

  // ── System ─────────────────────────────────────────────────────────────────
  settings:     { label: 'Settings',       roles: CEO_ONLY,
                  nav: { space: 'system',    href: '/settings',     icon: 'Settings' } },
  audit:        { label: 'Audit',          roles: CEO_ONLY,
                  nav: { space: 'system',    href: '/audit',        icon: 'ShieldCheck' } },
  command:      { label: 'Command',        roles: CEO_ONLY,
                  nav: { space: 'system',    href: '/command',      icon: 'Terminal' } },

  // ── No page of their own yet (entitlement-only, never in the sidebar) ───────
  finance:      { label: 'Finance',        roles: CEO_ONLY },
  mentor:       { label: 'Mentor Council', roles: CEO_ONLY },
  goals:        { label: 'Goals',          roles: BUSINESS },
  rnd:          { label: 'R&D',            roles: BUSINESS },
} satisfies Record<string, ModuleDef>

export type ModuleKey = keyof typeof MODULES

/** All module keys in a stable array — used for migrations and UI. */
export const ALL_MODULE_KEYS = Object.keys(MODULES) as ModuleKey[]

/** Return the allowed roles for a module key (excludes 'creator' which is implicit). */
export function moduleRoles(key: ModuleKey): readonly string[] {
  return MODULES[key].roles
}

/** Module keys the static registry grants to a role slug. Fallback for pre-057 users. */
export function modulesForRole(role: string): ModuleKey[] {
  return ALL_MODULE_KEYS.filter((key) =>
    (MODULES[key].roles as readonly string[]).includes(role)
  )
}

// ── Nav manifest ──────────────────────────────────────────────────────────────

export interface NavManifestItem {
  key: ModuleKey
  label: string
  href: string
  /** lucide-react icon name */
  icon: string
}

export interface NavManifestGroup {
  id: ModuleSpace
  label: string
  items: NavManifestItem[]
}

/**
 * Build the sidebar manifest for one request.
 *
 * A module is navigable when it has a `nav` block AND either it is `core`, or
 * it is both permitted for the user's role (`allowedModules`) and switched on
 * for the active company (`enabledModules`). Both lists come from requireAuth,
 * which resolves them against the *active* company — not an arbitrary first
 * company (IF-4).
 *
 * Empty groups are dropped, so the caller can render the array verbatim.
 */
export function buildNavManifest(
  allowedModules: readonly string[],
  enabledModules: readonly string[]
): NavManifestGroup[] {
  const allowed = new Set(allowedModules)
  const enabled = new Set(enabledModules)

  const visible: { space: ModuleSpace; item: NavManifestItem }[] = []

  for (const key of ALL_MODULE_KEYS) {
    const mod: ModuleDef = MODULES[key]
    if (!mod.nav) continue
    if (!mod.core && !(allowed.has(key) && enabled.has(key))) continue
    visible.push({
      space: mod.nav.space,
      item: { key, label: mod.label, href: mod.nav.href, icon: mod.nav.icon },
    })
  }

  return MODULE_SPACES.map((space) => ({
    id: space.id,
    label: space.label,
    items: visible.filter((v) => v.space === space.id).map((v) => v.item),
  })).filter((group) => group.items.length > 0)
}
