import { describe, it, expect, vi } from 'vitest'
import { requireModule } from '../api/middleware/require-module'
import { MODULES, ALL_MODULE_KEYS } from '../api/lib/modules'

// Derive allowedModules for a role using the static registry (mirrors the
// backward-compat path in requireAuth for users without company_role_id).
function allowedForRole(role: string): string[] {
  if (role === 'creator') return [...ALL_MODULE_KEYS]
  return ALL_MODULE_KEYS.filter((key) =>
    (MODULES[key].roles as readonly string[]).includes(role),
  )
}

// Build a minimal Hono Context mock for middleware tests
function makeCtx(opts: {
  role?: string
  enabledModules?: string[]
  allowedModules?: string[]
}) {
  const derivedAllowed = opts.role ? allowedForRole(opts.role) : []
  const store: Record<string, unknown> = {
    role:           opts.role,
    enabledModules: opts.enabledModules ?? [],
    allowedModules: opts.allowedModules ?? derivedAllowed,
  }
  return {
    get: (key: string) => store[key],
    json: vi.fn((body: unknown, status?: number) => ({ body, status })),
  }
}

const allModules = [
  'finance','mentor','sales','hiring','campaigns','blog','seo','social',
  'documents','email_studio','subscribers','templates','work','goals',
  'rnd','audit','settings','legal',
]

describe('requireModule middleware', () => {
  it('calls next() when role is creator regardless of module or enabledModules', async () => {
    const c = makeCtx({ role: 'creator', enabledModules: [] })
    const next = vi.fn()
    const middleware = requireModule('finance')
    await middleware(c as never, next)
    expect(next).toHaveBeenCalledOnce()
    expect(c.json).not.toHaveBeenCalled()
  })

  it('returns 500 when role is missing from context (requireAuth not run)', async () => {
    const c = makeCtx({ role: undefined, enabledModules: allModules })
    const next = vi.fn()
    await requireModule('sales')(c as never, next)
    expect(c.json).toHaveBeenCalledWith(expect.objectContaining({ error: expect.stringContaining('No role') }), 500)
    expect(next).not.toHaveBeenCalled()
  })

  it('returns 403 when role is not allowed on the module', async () => {
    // cto is not in the finance module (allowedModules derived from static registry)
    const c = makeCtx({ role: 'cto', enabledModules: allModules })
    const next = vi.fn()
    await requireModule('finance')(c as never, next)
    expect(c.json).toHaveBeenCalledWith(expect.objectContaining({ error: expect.stringContaining('Forbidden') }), 403)
    expect(next).not.toHaveBeenCalled()
  })

  // Entitlement failure (company toggle) is 402, NOT 403 — the frontend has to
  // be able to tell "ask your admin for the permission" from "this company
  // doesn't have the module enabled". See scale-up plan IF-6.
  it('returns 402 with a typed body when module is disabled for the company', async () => {
    // ceo is allowed on finance, but finance is not in enabled list
    const c = makeCtx({ role: 'ceo', enabledModules: ['sales', 'work'] })
    const next = vi.fn()
    await requireModule('finance')(c as never, next)
    expect(c.json).toHaveBeenCalledWith(
      expect.objectContaining({ error: 'module_not_enabled', module: 'finance' }),
      402,
    )
    expect(next).not.toHaveBeenCalled()
  })

  it('keeps 403 for the role-permission failure so the two are distinguishable', async () => {
    const denied = makeCtx({ role: 'coo', enabledModules: allModules })
    await requireModule('finance')(denied as never, vi.fn())
    expect(denied.json).toHaveBeenCalledWith(expect.anything(), 403)

    const notEntitled = makeCtx({ role: 'ceo', enabledModules: [] })
    await requireModule('finance')(notEntitled as never, vi.fn())
    expect(notEntitled.json).toHaveBeenCalledWith(expect.anything(), 402)
  })

  it('calls next() when role is allowed AND module is enabled', async () => {
    const c = makeCtx({ role: 'ceo', enabledModules: allModules })
    const next = vi.fn()
    await requireModule('finance')(c as never, next)
    expect(next).toHaveBeenCalledOnce()
    expect(c.json).not.toHaveBeenCalled()
  })

  it('coo can access sales module when it is enabled', async () => {
    const c = makeCtx({ role: 'coo', enabledModules: ['sales'] })
    const next = vi.fn()
    await requireModule('sales')(c as never, next)
    expect(next).toHaveBeenCalledOnce()
  })

  it('coo cannot access finance even when enabled', async () => {
    const c = makeCtx({ role: 'coo', enabledModules: allModules })
    const next = vi.fn()
    await requireModule('finance')(c as never, next)
    expect(c.json).toHaveBeenCalledWith(expect.objectContaining({ error: expect.stringContaining('Forbidden') }), 403)
  })

  it('cto cannot access campaigns module', async () => {
    const c = makeCtx({ role: 'cto', enabledModules: allModules })
    const next = vi.fn()
    await requireModule('campaigns')(c as never, next)
    expect(c.json).toHaveBeenCalledWith(expect.objectContaining({ error: expect.stringContaining('Forbidden') }), 403)
  })

  it('cto can access work module when enabled', async () => {
    const c = makeCtx({ role: 'cto', enabledModules: ['work'] })
    const next = vi.fn()
    await requireModule('work')(c as never, next)
    expect(next).toHaveBeenCalledOnce()
  })
})
