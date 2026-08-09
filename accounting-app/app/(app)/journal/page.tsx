'use client'

import { useMemo, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useCbopSession } from '../../lib/session-context'
import { cbopFetch } from '../../lib/api-client'
import { inr, fmtDate } from '../../lib/format'
import { SlideOver } from '../../components/slide-over'
import { StatusBadge } from '../../components/status-badge'
import type { Account } from '../accounts/types'
import { EntryBuilder } from './entry-builder'
import { EntryDetail } from './entry-detail'
import type { JournalEntry, JournalEntryLine, JournalStatus } from './types'

const primaryBtn =
  'inline-flex items-center justify-center h-9 px-4 rounded-md bg-blue text-white text-sm font-medium hover:bg-blue/90 disabled:opacity-50 disabled:cursor-not-allowed'

type StatusFilter = 'all' | JournalStatus

const TABS: { value: StatusFilter; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'draft', label: 'Draft' },
  { value: 'posted', label: 'Posted' },
  { value: 'void', label: 'Void' },
]

type BuilderState = { mode: 'create' } | { mode: 'edit'; existing: { entry: JournalEntry; lines: JournalEntryLine[] } } | null

export default function JournalPage() {
  const session = useCbopSession()
  const companyId = session.activeCompanyId
  const queryClient = useQueryClient()

  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all')
  const [filterText, setFilterText] = useState('')
  const [builder, setBuilder] = useState<BuilderState>(null)
  const [detailId, setDetailId] = useState<string | null>(null)

  const entriesQuery = useQuery({
    queryKey: ['acct-je-list', companyId, statusFilter],
    queryFn: () =>
      cbopFetch<{ entries: JournalEntry[] }>(
        `/api/accounting/journal-entries?company_id=${companyId}${statusFilter !== 'all' ? `&status=${statusFilter}` : ''}`,
        { activeCompanyId: companyId }
      ),
    enabled: !!companyId,
  })

  // Same query key as accounts/page.tsx - lets the two pages share cache
  // when navigated between in one session, and gives the entry builder the
  // chart of accounts to pick lines from.
  const accountsQuery = useQuery({
    queryKey: ['acct-accounts', companyId],
    queryFn: () =>
      cbopFetch<{ accounts: Account[] }>(`/api/accounting/accounts?company_id=${companyId}`, {
        activeCompanyId: companyId,
      }),
    enabled: !!companyId,
  })

  const entries = useMemo(() => entriesQuery.data?.entries ?? [], [entriesQuery.data])
  const accounts = useMemo(() => accountsQuery.data?.accounts ?? [], [accountsQuery.data])

  const filtered = useMemo(() => {
    const q = filterText.trim().toLowerCase()
    if (!q) return entries
    return entries.filter(
      (e) =>
        e.entry_no.toLowerCase().includes(q) ||
        (e.narration ?? '').toLowerCase().includes(q) ||
        (e.reference ?? '').toLowerCase().includes(q)
    )
  }, [entries, filterText])

  function refetchList() {
    queryClient.invalidateQueries({ queryKey: ['acct-je-list', companyId] })
  }

  if (!companyId) {
    return (
      <main className="p-6">
        <p className="text-sm text-text2">
          No active company selected. Switch companies from the main CBOP dashboard, then come back
          here.
        </p>
      </main>
    )
  }

  const activeCompanyName = session.companies.find((c) => c.id === companyId)?.name
  const hasAccounts = accounts.length > 0

  return (
    <main className="p-6 max-w-5xl">
      <div className="flex items-start justify-between mb-6">
        <div>
          <h1 className="font-display font-bold text-xl text-text1">Journal Entries</h1>
          {activeCompanyName && <p className="text-sm text-text2 mt-0.5">{activeCompanyName}</p>}
        </div>
        <button
          onClick={() => setBuilder({ mode: 'create' })}
          disabled={!hasAccounts}
          title={hasAccounts ? undefined : 'Set up the chart of accounts first'}
          className={primaryBtn}
        >
          + New Entry
        </button>
      </div>

      {!hasAccounts && !accountsQuery.isLoading && (
        <p className="text-xs text-amber mb-4">
          This company has no chart of accounts yet - set one up on the Chart of Accounts page before
          recording journal entries.
        </p>
      )}

      <div className="flex items-center justify-between mb-4 flex-wrap gap-3">
        <div className="flex items-center gap-1 rounded-md border border-border bg-card p-0.5">
          {TABS.map((tab) => (
            <button
              key={tab.value}
              onClick={() => setStatusFilter(tab.value)}
              className={`px-3 py-1.5 rounded text-xs font-medium transition-colors ${
                statusFilter === tab.value ? 'bg-blue text-white' : 'text-text2 hover:text-text1'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
        <input
          value={filterText}
          onChange={(e) => setFilterText(e.target.value)}
          placeholder="Filter by entry no, reference, narration..."
          className="h-9 w-72 rounded-md border border-border bg-white px-3 text-sm text-text1 focus:outline-none focus:border-blue placeholder:text-text3"
        />
      </div>

      {entriesQuery.isLoading && <p className="text-sm text-text2">Loading journal entries...</p>}
      {entriesQuery.isError && <p className="text-sm text-red">Failed to load journal entries.</p>}

      {!entriesQuery.isLoading && !entriesQuery.isError && filtered.length === 0 && (
        <div className="rounded-lg border border-border bg-card p-8 text-center">
          <p className="text-sm text-text2">
            {entries.length === 0 ? 'No journal entries yet.' : 'No entries match this filter.'}
          </p>
        </div>
      )}

      {filtered.length > 0 && (
        <div className="rounded-lg border border-border bg-card overflow-hidden overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs text-text3">
                <th className="px-4 py-2 font-medium">Entry No</th>
                <th className="px-4 py-2 font-medium">Date</th>
                <th className="px-4 py-2 font-medium">Reference / Narration</th>
                <th className="px-4 py-2 font-medium text-right">Total Debit</th>
                <th className="px-4 py-2 font-medium">Status</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((e) => (
                <tr
                  key={e.id}
                  onClick={() => setDetailId(e.id)}
                  className="border-b border-border last:border-0 cursor-pointer hover:bg-bg transition-colors"
                >
                  <td className="px-4 py-2 font-mono text-text1">{e.entry_no}</td>
                  <td className="px-4 py-2 font-mono text-text2">{fmtDate(e.entry_date)}</td>
                  <td className="px-4 py-2 text-text1">
                    {e.reference || e.narration || <span className="text-text3">No description</span>}
                  </td>
                  <td className="px-4 py-2 text-right font-mono text-text1">{inr(e.total_debit)}</td>
                  <td className="px-4 py-2">
                    <StatusBadge status={e.status} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <SlideOver
        isOpen={!!builder}
        onClose={() => setBuilder(null)}
        title={builder?.mode === 'edit' ? `Edit ${builder.existing.entry.entry_no}` : 'New Journal Entry'}
        width="lg"
      >
        {builder && (
          <EntryBuilder
            mode={builder.mode}
            companyId={companyId}
            accounts={accounts}
            existing={builder.mode === 'edit' ? builder.existing : undefined}
            onDone={() => {
              setBuilder(null)
              refetchList()
            }}
            onCancel={() => setBuilder(null)}
          />
        )}
      </SlideOver>

      <SlideOver
        isOpen={!!detailId}
        onClose={() => setDetailId(null)}
        title={detailId ? 'Journal Entry' : ''}
        width="lg"
      >
        {detailId && (
          <EntryDetail
            entryId={detailId}
            companyId={companyId}
            onClose={() => setDetailId(null)}
            onChanged={refetchList}
            onEdit={(existing) => {
              setDetailId(null)
              setBuilder({ mode: 'edit', existing })
            }}
          />
        )}
      </SlideOver>
    </main>
  )
}
