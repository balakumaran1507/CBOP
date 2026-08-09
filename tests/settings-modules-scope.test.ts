import { describe, it, expect, beforeEach, vi } from 'vitest'

// ─────────────────────────────────────────────────────────────────────────────
// Regression test for the cross-tenant leak in /api/settings/modules
// (scale-up plan IF-3):
//
//   • GET  /api/settings/modules              used to run `SELECT id, name FROM
//     companies` with NO companyIds filter, handing every company × every
//     module to any ceo-or-above caller regardless of tenant.
//   • PATCH /api/settings/modules/:companyId/:module verified the company
//     *existed* but never that it was in the caller's companyIds — a
//     cross-tenant WRITE.
//
// Out-of-scope companies must be invisible on the read side and 404 (NOT 403 —
// a 403 would confirm the company exists) on the write side.
//
// The Hono app is exercised for real; only the DB, auth middleware and mailer
// are mocked.
// ─────────────────────────────────────────────────────────────────────────────

const COMPANY_A = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' // caller's company
const COMPANY_B = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb' // another tenant

const ALL_COMPANIES = [
  { id: COMPANY_A, name: 'Company A' },
  { id: COMPANY_B, name: 'Company B' },
]

// Mutable caller identity, swapped per test by the mocked requireAuth
const caller = vi.hoisted(() => ({
  role: 'ceo' as string,
  companyIds: [] as string[],
}))

// Every SQL statement the app ran, so we can assert no cross-tenant write slipped through
const executed = vi.hoisted(() => [] as { text: string; params: unknown[] }[])

vi.mock('../api/lib/db', () => ({
  query: vi.fn(async (text: string, params: unknown[] = []) => {
    executed.push({ text, params })

    // Company lookup(s) — honour whatever scope filter the route passed
    if (/FROM companies/i.test(text)) {
      const scope = params.find((p) => Array.isArray(p)) as string[] | undefined
      const single = params.find((p) => typeof p === 'string') as string | undefined
      let rows = ALL_COMPANIES
      if (single) rows = rows.filter((r) => r.id === single)
      if (scope) rows = rows.filter((r) => scope.includes(r.id))
      return { rows, rowCount: rows.length }
    }

    // No module rows seeded — the route defaults missing keys to enabled
    if (/FROM company_modules/i.test(text)) return { rows: [], rowCount: 0 }

    return { rows: [], rowCount: 0 }
  }),
  transaction: vi.fn(),
}))

vi.mock('../api/middleware/require-auth', () => ({
  requireAuth: async (c: { set: (k: string, v: unknown) => void }, next: () => Promise<void>) => {
    c.set('role', caller.role)
    c.set('companyIds', caller.companyIds)
    c.set('userId', 'user-1')
    await next()
  },
}))

vi.mock('../api/lib/mailer', () => ({ sendEmail: vi.fn(async () => ({ ok: true })) }))

const { default: app } = await import('../api/routes/settings')

function patchBody(is_enabled: boolean) {
  return {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ is_enabled }),
  }
}

describe('GET /api/settings/modules — company scope', () => {
  beforeEach(() => {
    executed.length = 0
    caller.role = 'ceo'
    caller.companyIds = [COMPANY_A]
  })

  it('returns only the companies in the caller companyIds', async () => {
    const res = await app.request('/api/settings/modules')
    expect(res.status).toBe(200)
    const body = await res.json() as { modules: { companyId: string }[] }
    expect(body.modules.map((m) => m.companyId)).toEqual([COMPANY_A])
  })

  it('never leaks a company outside the caller scope', async () => {
    const res = await app.request('/api/settings/modules')
    const text = await res.text()
    expect(text).not.toContain(COMPANY_B)
    expect(text).not.toContain('Company B')
  })

  it('scopes the companies query with an ANY($1) filter', async () => {
    await app.request('/api/settings/modules')
    const companiesQuery = executed.find((q) => /SELECT id, name FROM companies/i.test(q.text))
    expect(companiesQuery).toBeDefined()
    expect(companiesQuery!.text).toMatch(/WHERE id = ANY\(\$1\)/)
    expect(companiesQuery!.params[0]).toEqual([COMPANY_A])
  })

  it('returns an empty list (not every company) when the caller has no companies', async () => {
    caller.companyIds = []
    const res = await app.request('/api/settings/modules')
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ modules: [] })
  })

  it('a creator (companyIds = every company, set in requireAuth) still sees the full matrix', async () => {
    caller.role = 'creator'
    caller.companyIds = [COMPANY_A, COMPANY_B]
    const res = await app.request('/api/settings/modules')
    const body = await res.json() as { modules: { companyId: string }[] }
    expect(body.modules.map((m) => m.companyId).sort()).toEqual([COMPANY_A, COMPANY_B].sort())
  })
})

describe('PATCH /api/settings/modules/:companyId/:module — company scope', () => {
  beforeEach(() => {
    executed.length = 0
    caller.role = 'ceo'
    caller.companyIds = [COMPANY_A]
  })

  it('returns 404 (not 403) for a company outside the caller scope', async () => {
    const res = await app.request(`/api/settings/modules/${COMPANY_B}/sales`, patchBody(false))
    expect(res.status).toBe(404)
    expect(await res.json()).toEqual({ error: 'Company not found' })
  })

  it('performs no write when the company is outside the caller scope', async () => {
    await app.request(`/api/settings/modules/${COMPANY_B}/sales`, patchBody(false))
    expect(executed.some((q) => /INSERT INTO company_modules/i.test(q.text))).toBe(false)
  })

  it('gives the same 404 for an unknown company id — existence is not confirmed', async () => {
    const unknown = 'cccccccc-cccc-cccc-cccc-cccccccccccc'
    const outOfScope = await app.request(`/api/settings/modules/${COMPANY_B}/sales`, patchBody(false))
    const nonExistent = await app.request(`/api/settings/modules/${unknown}/sales`, patchBody(false))
    expect(outOfScope.status).toBe(nonExistent.status)
    expect(await outOfScope.json()).toEqual(await nonExistent.json())
  })

  it('returns 404 for an out-of-scope company even when the caller has no companies at all', async () => {
    caller.companyIds = []
    const res = await app.request(`/api/settings/modules/${COMPANY_A}/sales`, patchBody(false))
    expect(res.status).toBe(404)
  })

  it('still toggles a module for a company inside the caller scope', async () => {
    const res = await app.request(`/api/settings/modules/${COMPANY_A}/sales`, patchBody(false))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ companyId: COMPANY_A, module: 'sales', is_enabled: false })
    expect(executed.some((q) => /INSERT INTO company_modules/i.test(q.text))).toBe(true)
  })

  it('scopes the company existence check with the caller companyIds', async () => {
    await app.request(`/api/settings/modules/${COMPANY_A}/sales`, patchBody(true))
    const check = executed.find((q) => /SELECT id FROM companies/i.test(q.text))
    expect(check).toBeDefined()
    expect(check!.text).toMatch(/id = ANY\(\$2\)/)
    expect(check!.params[1]).toEqual([COMPANY_A])
  })

  it('rejects an unknown module key before touching the DB', async () => {
    const res = await app.request(`/api/settings/modules/${COMPANY_A}/not_a_module`, patchBody(true))
    expect(res.status).toBe(400)
  })
})
