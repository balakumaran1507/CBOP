'use client'

import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useCbopSession } from '../../lib/session-context'
import { cbopFetch, ApiError } from '../../lib/api-client'
import { fmtDate } from '../../lib/format'
import { SlideOver } from '../../components/slide-over'

// Fiscal Periods - CEO/creator only, per the access split documented in
// docs/modules/ACCOUNTING_Build_Plan.md's period-locking reasoning: once a
// period is locked (GST filed for that month/quarter), no entry dated inside
// it can ever be created or edited again, by anyone. Locking is one-way - the
// backend's DB trigger raises on any attempt to clear locked_at, even via
// direct SQL, so there is deliberately no unlock action anywhere in this UI.

type PeriodType = 'month' | 'quarter'

interface FiscalPeriod {
  id: string
  period_type: PeriodType
  period_start: string
  period_end: string
  label: string
  locked_at: string | null
  locked_by: string | null
  created_at: string
}

const inputCls =
  'h-9 rounded-md border border-border bg-white px-2.5 text-sm text-text1 focus:outline-none focus:ring-1 focus:ring-blue focus:border-blue placeholder:text-text3 disabled:bg-bg disabled:text-text3'

const primaryBtn =
  'inline-flex items-center justify-center h-9 px-4 rounded-md bg-blue text-white text-sm font-medium hover:bg-blue/90 disabled:opacity-50 disabled:cursor-not-allowed'

function pad(n: number): string {
  return String(n).padStart(2, '0')
}

function toIso(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

/** First/last day of the current calendar month, computed client-side. */
function thisMonthDefaults(): { period_start: string; period_end: string; label: string } {
  const now = new Date()
  const y = now.getFullYear()
  const m = now.getMonth()
  const start = new Date(y, m, 1)
  const end = new Date(y, m + 1, 0)
  return { period_start: toIso(start), period_end: toIso(end), label: `${y}-${pad(m + 1)}` }
}

const emptyForm = { label: '', period_type: 'month' as PeriodType, period_start: '', period_end: '' }

export default function PeriodsPage() {
  const session = useCbopSession()
  const companyId = session.activeCompanyId
  const queryClient = useQueryClient()
  const isCeo = session.role === 'ceo' || session.role === 'creator'

  const [createOpen, setCreateOpen] = useState(false)
  const [form, setForm] = useState(emptyForm)
  const [createError, setCreateError] = useState<string | null>(null)

  const [confirmLockId, setConfirmLockId] = useState<string | null>(null)
  const [confirmText, setConfirmText] = useState('')
  const [lockError, setLockError] = useState<string | null>(null)

  const periodsQuery = useQuery({
    queryKey: ['acct-fiscal-periods', companyId],
    queryFn: () =>
      cbopFetch<{ periods: FiscalPeriod[] }>(`/api/accounting/fiscal-periods?company_id=${companyId}`, {
        activeCompanyId: companyId,
      }),
    enabled: !!companyId && isCeo,
  })

  const createMutation = useMutation({
    mutationFn: () =>
      cbopFetch<{ period: FiscalPeriod }>('/api/accounting/fiscal-periods', {
        method: 'POST',
        activeCompanyId: companyId,
        body: {
          company_id: companyId,
          period_type: form.period_type,
          period_start: form.period_start,
          period_end: form.period_end,
          label: form.label,
        },
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['acct-fiscal-periods', companyId] })
      setCreateOpen(false)
      setForm(emptyForm)
      setCreateError(null)
    },
    onError: (err) => {
      setCreateError(
        err instanceof ApiError && err.status === 409
          ? 'A period with this exact date range already exists for this company.'
          : err instanceof ApiError
            ? err.message
            : 'Could not create this period. Try again.'
      )
    },
  })

  const lockMutation = useMutation({
    mutationFn: (id: string) =>
      cbopFetch<{ period: FiscalPeriod }>(`/api/accounting/fiscal-periods/${id}/lock`, {
        method: 'POST',
        activeCompanyId: companyId,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['acct-fiscal-periods', companyId] })
      setConfirmLockId(null)
      setConfirmText('')
      setLockError(null)
    },
    onError: (err) => {
      setLockError(
        err instanceof ApiError && err.status === 409
          ? 'This period is already locked.'
          : err instanceof ApiError
            ? err.message
            : 'Could not lock this period. Try again.'
      )
    },
  })

  if (!isCeo) {
    return (
      <main className="p-6">
        <div className="max-w-md rounded-lg border border-border bg-card p-6">
          <p className="font-display font-semibold text-text1">CEO / creator only</p>
          <p className="mt-2 text-sm text-text2">
            Fiscal period locking is only available to CEO/creator accounts. You&apos;re signed in as{' '}
            <span className="font-mono">{session.role}</span> - ask a CEO or the creator account on your
            CBOP org for access.
          </p>
        </div>
      </main>
    )
  }

  if (!companyId) {
    return (
      <main className="p-6">
        <p className="text-sm text-text2">
          No active company selected. Switch companies from the main CBOP dashboard, then come back here.
        </p>
      </main>
    )
  }

  const activeCompanyName = session.companies.find((c) => c.id === companyId)?.name
  const periods = periodsQuery.data?.periods ?? []

  function openCreate() {
    setForm(emptyForm)
    setCreateError(null)
    setCreateOpen(true)
  }

  function applyQuickAddThisMonth() {
    const d = thisMonthDefaults()
    setForm({ label: d.label, period_type: 'month', period_start: d.period_start, period_end: d.period_end })
  }

  function submitCreate() {
    if (!form.label.trim() || !form.period_start || !form.period_end) {
      setCreateError('Label, start date and end date are all required.')
      return
    }
    if (form.period_end < form.period_start) {
      setCreateError('End date must be on or after start date.')
      return
    }
    createMutation.mutate()
  }

  function startLockConfirm(id: string) {
    setConfirmLockId(id)
    setConfirmText('')
    setLockError(null)
  }

  function cancelLockConfirm() {
    setConfirmLockId(null)
    setConfirmText('')
    setLockError(null)
  }

  return (
    <main className="p-6 max-w-4xl">
      <div className="flex items-start justify-between mb-6">
        <div>
          <h1 className="font-display font-bold text-xl text-text1">Fiscal Periods</h1>
          {activeCompanyName && <p className="text-sm text-text2 mt-0.5">{activeCompanyName}</p>}
        </div>
        <button onClick={openCreate} className={primaryBtn}>
          + New Period
        </button>
      </div>

      {periodsQuery.isLoading && <p className="text-sm text-text2">Loading fiscal periods...</p>}
      {periodsQuery.isError && <p className="text-sm text-red">Failed to load fiscal periods.</p>}

      {!periodsQuery.isLoading && !periodsQuery.isError && periods.length === 0 && (
        <div className="rounded-lg border border-border bg-card p-8 text-center max-w-lg mx-auto">
          <p className="font-display font-semibold text-text1">No fiscal periods yet</p>
          <p className="mt-2 text-sm text-text2">
            Fiscal periods let you close the books each month (or quarter) once its GST return is filed.
            Locking a period stops any entry dated inside it from ever being created or edited again, so
            the ledger can&apos;t drift away from what was actually filed. Add a period below when you&apos;re
            ready to close one.
          </p>
        </div>
      )}

      {periods.length > 0 && (
        <div className="flex flex-col gap-3">
          {periods.map((p) => {
            const isLocked = !!p.locked_at
            const isConfirming = confirmLockId === p.id
            return (
              <div key={p.id} className="rounded-lg border border-border bg-card overflow-hidden">
                <div className="flex items-center justify-between px-4 py-3 flex-wrap gap-2">
                  <div className="flex items-center gap-3 min-w-0">
                    <span className="font-display font-semibold text-text1 truncate">{p.label}</span>
                    <span className="inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium capitalize bg-blue/10 text-blue shrink-0">
                      {p.period_type}
                    </span>
                    <span className="font-mono text-xs text-text2 shrink-0">
                      {fmtDate(p.period_start)} - {fmtDate(p.period_end)}
                    </span>
                  </div>
                  <div className="flex items-center gap-3 shrink-0">
                    {isLocked ? (
                      <div className="text-right">
                        <span className="inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium bg-red/10 text-red">
                          Locked
                        </span>
                        <p className="mt-0.5 font-mono text-[11px] text-text3">
                          {fmtDate(p.locked_at as string)}
                        </p>
                      </div>
                    ) : (
                      <>
                        <span className="inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium bg-green/10 text-green">
                          Open
                        </span>
                        {!isConfirming && (
                          <button
                            onClick={() => startLockConfirm(p.id)}
                            className="inline-flex items-center justify-center h-8 px-3 rounded-md border border-red text-red text-xs font-medium hover:bg-red/5"
                          >
                            Lock Period
                          </button>
                        )}
                      </>
                    )}
                  </div>
                </div>

                {!isLocked && isConfirming && (
                  <div className="border-t border-red/30 bg-red/5 px-4 py-4">
                    <p className="text-sm text-text1">
                      Locking this period is permanent. No entries dated between{' '}
                      <span className="font-mono">{fmtDate(p.period_start)}</span> and{' '}
                      <span className="font-mono">{fmtDate(p.period_end)}</span> can be created or edited
                      afterward, by anyone, including you. This cannot be undone.
                    </p>
                    <label className="mt-3 block text-xs font-medium text-text2">
                      Type the period label (<span className="font-mono">{p.label}</span>) to confirm
                    </label>
                    <input
                      autoFocus
                      value={confirmText}
                      onChange={(e) => setConfirmText(e.target.value)}
                      className={`${inputCls} mt-1 w-full max-w-xs`}
                      placeholder={p.label}
                    />
                    {lockError && <p className="mt-2 text-xs text-red">{lockError}</p>}
                    <div className="mt-3 flex items-center gap-2">
                      <button
                        onClick={() => lockMutation.mutate(p.id)}
                        disabled={confirmText !== p.label || lockMutation.isPending}
                        className="inline-flex items-center justify-center h-9 px-4 rounded-md bg-red text-white text-sm font-medium hover:bg-red/90 disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        {lockMutation.isPending ? 'Locking...' : 'Yes, lock it permanently'}
                      </button>
                      <button
                        onClick={cancelLockConfirm}
                        disabled={lockMutation.isPending}
                        className="inline-flex items-center justify-center h-9 px-4 rounded-md border border-border text-text2 text-sm font-medium hover:bg-bg disabled:opacity-50"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      <SlideOver isOpen={createOpen} onClose={() => setCreateOpen(false)} title="New Fiscal Period">
        <div className="flex-1 overflow-auto px-6 py-5 flex flex-col gap-4">
          <button
            onClick={applyQuickAddThisMonth}
            className="self-start inline-flex items-center justify-center h-8 px-3 rounded-md border border-border text-text2 text-xs font-medium hover:bg-bg"
          >
            Quick add: this month
          </button>

          <div>
            <label className="block text-xs font-medium text-text2 mb-1">Label</label>
            <input
              value={form.label}
              onChange={(e) => setForm((f) => ({ ...f, label: e.target.value }))}
              placeholder="e.g. 2026-08 or FY2025-26 Q1"
              className={`${inputCls} w-full`}
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-text2 mb-1">Period type</label>
            <select
              value={form.period_type}
              onChange={(e) => setForm((f) => ({ ...f, period_type: e.target.value as PeriodType }))}
              className={`${inputCls} w-full`}
            >
              <option value="month">Month</option>
              <option value="quarter">Quarter</option>
            </select>
          </div>

          <div className="flex gap-3">
            <div className="flex-1">
              <label className="block text-xs font-medium text-text2 mb-1">Period start</label>
              <input
                type="date"
                value={form.period_start}
                onChange={(e) => setForm((f) => ({ ...f, period_start: e.target.value }))}
                className={`${inputCls} w-full font-mono`}
              />
            </div>
            <div className="flex-1">
              <label className="block text-xs font-medium text-text2 mb-1">Period end</label>
              <input
                type="date"
                value={form.period_end}
                onChange={(e) => setForm((f) => ({ ...f, period_end: e.target.value }))}
                className={`${inputCls} w-full font-mono`}
              />
            </div>
          </div>

          {createError && <p className="text-xs text-red">{createError}</p>}
        </div>
        <div className="flex gap-3 px-6 py-4 border-t border-border shrink-0">
          <button
            onClick={submitCreate}
            disabled={createMutation.isPending}
            className={`${primaryBtn} flex-1`}
          >
            {createMutation.isPending ? 'Creating...' : 'Create Period'}
          </button>
          <button
            onClick={() => setCreateOpen(false)}
            className="inline-flex items-center justify-center h-9 px-4 rounded-md border border-border text-text2 text-sm font-medium hover:bg-bg"
          >
            Cancel
          </button>
        </div>
      </SlideOver>
    </main>
  )
}
