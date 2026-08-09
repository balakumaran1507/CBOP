import { describe, it, expect, vi } from 'vitest'
import { notFound, validationError, getPagination, companyScope } from '../api/lib/route-utils'

// Minimal Hono Context mock — only what route-utils.ts calls
function makeCtx(query: Record<string, string> = {}) {
  const headers: Record<string, string> = {}
  return {
    json: vi.fn((body: unknown, status?: number) => ({ body, status })),
    req: {
      query: (key: string) => query[key],
    },
  }
}

describe('notFound', () => {
  it('returns 404 with generic message when no resource given', () => {
    const c = makeCtx()
    notFound(c as never)
    expect(c.json).toHaveBeenCalledWith({ error: 'Not found' }, 404)
  })

  it('returns 404 with resource name in message', () => {
    const c = makeCtx()
    notFound(c as never, 'Invoice')
    expect(c.json).toHaveBeenCalledWith({ error: 'Invoice not found' }, 404)
  })
})

describe('validationError', () => {
  it('returns 400 with provided message', () => {
    const c = makeCtx()
    validationError(c as never, 'name is required')
    expect(c.json).toHaveBeenCalledWith({ error: 'name is required' }, 400)
  })
})

describe('getPagination', () => {
  it('defaults to page 1, limit 50', () => {
    const c = makeCtx()
    expect(getPagination(c as never)).toEqual({ page: 1, limit: 50, offset: 0 })
  })

  it('parses page and limit from query params', () => {
    const c = makeCtx({ page: '3', limit: '20' })
    expect(getPagination(c as never)).toEqual({ page: 3, limit: 20, offset: 40 })
  })

  it('caps limit at 200', () => {
    const c = makeCtx({ limit: '999' })
    const result = getPagination(c as never)
    expect(result.limit).toBe(200)
  })

  it('floor-clamps page to 1 for negative page input', () => {
    const c = makeCtx({ page: '-5' })
    const result = getPagination(c as never)
    expect(result.page).toBe(1)
    expect(result.offset).toBe(0)
  })

  it('limit=0 falls back to default 50 (0 is falsy → treated as missing)', () => {
    // parseInt('0') || 50 === 50 because 0 is falsy — this is documented behavior
    const c = makeCtx({ limit: '0' })
    const { limit } = getPagination(c as never)
    expect(limit).toBe(50)
  })
})

describe('companyScope', () => {
  it('returns ANY($1) with the ids array as param', () => {
    const ids = ['uuid-1', 'uuid-2']
    const result = companyScope(ids, 1)
    expect(result.clause).toBe('ANY($1)')
    expect(result.param).toEqual([ids])
  })

  it('uses the provided paramIndex', () => {
    const ids = ['uuid-a']
    const result = companyScope(ids, 3)
    expect(result.clause).toBe('ANY($3)')
  })
})
