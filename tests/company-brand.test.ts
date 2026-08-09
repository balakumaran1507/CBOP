import { describe, it, expect } from 'vitest'
import { getCompanyBrand, DEFAULT_BRAND, refreshCompanyBrandCache } from '../api/lib/company-brand'

// getCompanyBrand is synchronous — it returns from an in-memory cache
// backed by a SEED map and a background DB refresh. These tests verify:
//  1. The function returns a well-formed CompanyBrand for known seed IDs
//  2. Missing/null companyId returns DEFAULT_BRAND
//  3. Unknown company ID returns DEFAULT_BRAND (not undefined, not a throw)

const ETHERENCE_IT_ID = '11111111-1111-1111-1111-111111111111'
const ETHERENCE_PENTEST_ID = '22222222-2222-2222-2222-222222222222'
const UNKNOWN_ID = 'aaaaaaaa-0000-0000-0000-000000000000'

describe('getCompanyBrand — synchronous cache lookup', () => {
  it('returns a CompanyBrand with all required fields for a seeded company', () => {
    const brand = getCompanyBrand(ETHERENCE_IT_ID)
    expect(brand).toHaveProperty('accent')
    expect(brand).toHaveProperty('bg')
    expect(brand).toHaveProperty('initials')
    expect(brand).toHaveProperty('tagline')
    expect(brand).toHaveProperty('signoff')
    expect(typeof brand.accent).toBe('string')
    expect(brand.accent.length).toBeGreaterThan(0)
  })

  it('returns correct initials for Etherence IT (E2)', () => {
    const brand = getCompanyBrand(ETHERENCE_IT_ID)
    expect(brand.initials).toBe('E2')
  })

  it('returns correct initials for Etherence Pentest (EP)', () => {
    const brand = getCompanyBrand(ETHERENCE_PENTEST_ID)
    expect(brand.initials).toBe('EP')
  })

  it('returns DEFAULT_BRAND when companyId is null', () => {
    const brand = getCompanyBrand(null)
    expect(brand).toEqual(DEFAULT_BRAND)
  })

  it('returns DEFAULT_BRAND when companyId is undefined', () => {
    const brand = getCompanyBrand(undefined)
    expect(brand).toEqual(DEFAULT_BRAND)
  })

  it('returns DEFAULT_BRAND for an unknown company ID — never undefined', () => {
    const brand = getCompanyBrand(UNKNOWN_ID)
    expect(brand).toEqual(DEFAULT_BRAND)
    // Critically: brand is never undefined/null, so callers cannot crash
    expect(brand).not.toBeUndefined()
    expect(brand).not.toBeNull()
  })

  it('DEFAULT_BRAND has all required fields', () => {
    expect(DEFAULT_BRAND.accent).toBeTruthy()
    expect(DEFAULT_BRAND.bg).toBeTruthy()
    expect(DEFAULT_BRAND.initials).toBeTruthy()
    expect(DEFAULT_BRAND.tagline).toBeTruthy()
    expect(DEFAULT_BRAND.signoff).toBeTruthy()
  })

  it('each seeded company has a distinct accent color', () => {
    const ethIt = getCompanyBrand(ETHERENCE_IT_ID)
    const ethPen = getCompanyBrand(ETHERENCE_PENTEST_ID)
    // They should have different accent colours — distinct branding per company
    expect(ethIt.accent).not.toBe(ethPen.accent)
  })
})
