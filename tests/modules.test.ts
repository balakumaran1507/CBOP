import { describe, it, expect } from 'vitest'
import { MODULES, ALL_MODULE_KEYS, moduleRoles } from '../api/lib/modules'

const VALID_ROLES = ['creator', 'ceo', 'coo', 'cto'] as const

describe('MODULES registry', () => {
  it('has at least 15 module keys', () => {
    expect(Object.keys(MODULES).length).toBeGreaterThanOrEqual(15)
  })

  it('ALL_MODULE_KEYS matches MODULES keys', () => {
    expect(new Set(ALL_MODULE_KEYS)).toEqual(new Set(Object.keys(MODULES)))
  })

  it('every module has at least one allowed role', () => {
    for (const [key, mod] of Object.entries(MODULES)) {
      expect(mod.roles.length, `module ${key} has no roles`).toBeGreaterThan(0)
    }
  })

  it('every role in every module is a valid CBOP role', () => {
    const valid = new Set(VALID_ROLES)
    for (const [key, mod] of Object.entries(MODULES)) {
      for (const role of mod.roles) {
        expect(valid.has(role as never), `module ${key} has invalid role: ${role}`).toBe(true)
      }
    }
  })

  it('finance and mentor are restricted to ceo and creator only', () => {
    const financeRoles = new Set<string>(MODULES.finance.roles)
    expect(financeRoles.has('coo')).toBe(false)
    expect(financeRoles.has('cto')).toBe(false)
    expect(financeRoles.has('ceo')).toBe(true)
    expect(financeRoles.has('creator')).toBe(true)

    const mentorRoles = new Set<string>(MODULES.mentor.roles)
    expect(mentorRoles.has('coo')).toBe(false)
    expect(mentorRoles.has('cto')).toBe(false)
  })

  it('work module is accessible to all roles', () => {
    const workRoles = new Set(MODULES.work.roles)
    for (const role of VALID_ROLES) {
      expect(workRoles.has(role), `work should allow ${role}`).toBe(true)
    }
  })

  it('creator is in every module', () => {
    for (const [key, mod] of Object.entries(MODULES)) {
      expect(mod.roles.includes('creator'), `creator missing from module ${key}`).toBe(true)
    }
  })
})

describe('moduleRoles helper', () => {
  it('returns the roles array for a known module', () => {
    const roles = moduleRoles('finance')
    expect(roles).toContain('ceo')
    expect(roles).toContain('creator')
  })
})
