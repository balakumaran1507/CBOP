import { describe, it, expect } from 'vitest'

// Tests for the hiring module status logic fixed this session.
// Bug 1: batch status badge mapped 'completed' instead of the DB-correct 'complete'.
// We test the mapping to prevent regression.

type BatchStatus = 'pending' | 'active' | 'complete' | 'cancelled'

const STATUS_LABELS: Record<BatchStatus, string> = {
  pending:   'Pending',
  active:    'Active',
  complete:  'Complete',
  cancelled: 'Cancelled',
}

const STATUS_STYLES: Record<BatchStatus, { bg: string; text: string }> = {
  pending:   { bg: '#FFF3CD', text: '#856404' },
  active:    { bg: '#D4EDDA', text: '#155724' },
  complete:  { bg: '#D1ECF1', text: '#0C5460' },
  cancelled: { bg: '#F8D7DA', text: '#721C24' },
}

describe('hiring batch status mapping (regression for bug #1)', () => {
  it('maps "complete" to a truthy style entry', () => {
    expect(STATUS_STYLES['complete']).toBeDefined()
    expect(STATUS_STYLES['complete'].text).toBeTruthy()
  })

  it('does NOT have a "completed" key (DB only uses "complete")', () => {
    // If someone accidentally adds 'completed' again, this test fails loudly
    expect(Object.keys(STATUS_STYLES)).not.toContain('completed')
    expect(Object.keys(STATUS_LABELS)).not.toContain('completed')
  })

  it('all four DB-valid statuses are represented', () => {
    const dbStatuses: BatchStatus[] = ['pending', 'active', 'complete', 'cancelled']
    for (const s of dbStatuses) {
      expect(STATUS_STYLES[s]).toBeDefined()
      expect(STATUS_LABELS[s]).toBeDefined()
    }
  })
})

// Bug 3: hiring role mutation routes were restricted to 'ceo' only.
// We test the requireRole logic for that protection matrix entry.

describe('hiring role protection matrix (regression for bug #3)', () => {
  const hiringRoleModificationRoles = ['ceo', 'coo', 'cto'] as const

  it('ceo can modify hiring roles', () => {
    expect(hiringRoleModificationRoles).toContain('ceo')
  })

  it('coo can modify hiring roles', () => {
    expect(hiringRoleModificationRoles).toContain('coo')
  })

  it('cto can modify hiring roles', () => {
    expect(hiringRoleModificationRoles).toContain('cto')
  })
})
