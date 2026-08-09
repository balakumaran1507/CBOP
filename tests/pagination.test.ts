import { describe, it, expect } from 'vitest'
import { getPagination } from '../api/lib/route-utils'

// Additional coverage for pagination edge cases used across 20+ routes

function makeCtx(query: Record<string, string>) {
  return {
    json: () => {},
    req: { query: (k: string) => query[k] },
  }
}

describe('getPagination — comprehensive edge cases', () => {
  it('offset is 0 on page 1', () => {
    const { offset } = getPagination(makeCtx({ page: '1', limit: '10' }) as never)
    expect(offset).toBe(0)
  })

  it('offset is correct on page 2 with limit 25', () => {
    const { offset } = getPagination(makeCtx({ page: '2', limit: '25' }) as never)
    expect(offset).toBe(25)
  })

  it('offset is correct on page 5 with limit 50', () => {
    const { offset } = getPagination(makeCtx({ page: '5', limit: '50' }) as never)
    expect(offset).toBe(200)
  })

  it('NaN page param defaults to page 1', () => {
    const { page } = getPagination(makeCtx({ page: 'abc' }) as never)
    expect(page).toBe(1)
  })

  it('NaN limit param defaults to limit 50', () => {
    const { limit } = getPagination(makeCtx({ limit: 'xyz' }) as never)
    expect(limit).toBe(50)
  })

  it('negative limit floors to 1', () => {
    const { limit } = getPagination(makeCtx({ limit: '-10' }) as never)
    expect(limit).toBe(1)
  })

  it('limit 201 is clamped to 200', () => {
    const { limit } = getPagination(makeCtx({ limit: '201' }) as never)
    expect(limit).toBe(200)
  })

  it('missing params uses defaults (page=1, limit=50)', () => {
    const result = getPagination(makeCtx({}) as never)
    expect(result).toEqual({ page: 1, limit: 50, offset: 0 })
  })
})
