// ═════════════════════════════════════════════════════════════════════════════
// Shared per-company email branding lookup.
//
// Replaces the COMPANY_BRAND consts that used to be hardcoded and duplicated
// verbatim in api/routes/hiring.ts and api/routes/hiring-batches.ts. Source of
// truth is now `companies.logo_initials` (migration 011) + `companies.email_branding`
// (migration 051, jsonb: accent/bg/tagline/signoff). Adding a new company via
// POST /api/settings/companies is enough to get correctly branded hiring emails —
// no code edits required.
//
// Callers in hiring.ts / hiring-batches.ts are synchronous template builders, so
// this exposes a synchronous getCompanyBrand() backed by an in-memory cache that
// refreshes itself in the background (same TTL-cache shape as loadDomains() in
// mailer.ts). A small hardcoded seed covers the original 4 companies so lookups
// are correct even before the first DB read completes (cold start).
// ═════════════════════════════════════════════════════════════════════════════

import { query } from './db'

export interface CompanyBrand {
  accent: string
  bg: string
  initials: string
  tagline: string
  signoff: string
}

export const DEFAULT_BRAND: CompanyBrand = {
  accent: '#6D28D9', bg: '#F5F3FF', initials: 'QNT',
  tagline: 'Building Tomorrow.', signoff: 'The Ouantum Team',
}

// Cold-start seed only — overwritten by the DB (companies.logo_initials /
// email_branding) as soon as the first refresh() completes.
// NOTE: migration 064 merged Etherence Pentest (22222222-...) into Etherence
// IT — they were always one legal entity, never two. Its seed entry is
// removed rather than left dead; that company_id no longer exists in `companies`.
const SEED: Record<string, CompanyBrand> = {
  '11111111-1111-1111-1111-111111111111': { accent: '#0073BB', bg: '#F0F7FF', initials: 'E2', tagline: 'Technology. Delivered.', signoff: 'The Etherence IT Team' },
  '33333333-3333-3333-3333-333333333333': { accent: '#0D9488', bg: '#F0FDFA', initials: 'CC', tagline: 'Compete. Learn. Defend.', signoff: 'The CYBERCOM CTF Team' },
  '44444444-4444-4444-4444-444444444444': { accent: '#D97706', bg: '#FFFBEB', initials: 'AOS', tagline: 'Offense-first Security.', signoff: 'The AttackOS Team' },
}

let cache: Map<string, CompanyBrand> = new Map(Object.entries(SEED))
let loadedAt = 0
const TTL = 60_000

async function refresh(): Promise<void> {
  try {
    const { rows } = await query<{ id: string; logo_initials: string | null; email_branding: Partial<CompanyBrand> | null }>(
      `SELECT id, logo_initials, email_branding FROM companies`
    )
    const next = new Map<string, CompanyBrand>()
    for (const r of rows) {
      const eb = r.email_branding ?? {}
      const seeded = SEED[r.id]
      next.set(r.id, {
        accent: eb.accent ?? seeded?.accent ?? DEFAULT_BRAND.accent,
        bg: eb.bg ?? seeded?.bg ?? DEFAULT_BRAND.bg,
        initials: r.logo_initials ?? eb.initials ?? seeded?.initials ?? DEFAULT_BRAND.initials,
        tagline: eb.tagline ?? seeded?.tagline ?? DEFAULT_BRAND.tagline,
        signoff: eb.signoff ?? seeded?.signoff ?? DEFAULT_BRAND.signoff,
      })
    }
    cache = next
  } catch {
    // email_branding column not migrated yet, or DB unreachable - keep the
    // previous (or seed) cache rather than throwing from a template builder.
  }
  loadedAt = Date.now()
}

/** Fire a background refresh if the cache is stale. Never blocks the caller. */
function maybeRefresh(): void {
  if (Date.now() - loadedAt > TTL) {
    loadedAt = Date.now() // mark in-flight immediately so concurrent callers don't pile on
    void refresh()
  }
}

/** Force an immediate refresh - call right after inserting/editing a company. */
export async function refreshCompanyBrandCache(): Promise<void> {
  await refresh()
}

export function getCompanyBrand(companyId: string | null | undefined): CompanyBrand {
  maybeRefresh()
  if (!companyId) return DEFAULT_BRAND
  return cache.get(companyId) ?? DEFAULT_BRAND
}
