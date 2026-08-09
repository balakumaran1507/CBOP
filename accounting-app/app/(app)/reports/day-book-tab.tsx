'use client'

import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { cbopFetch } from '../../lib/api-client'
import { inr, fmtDate } from '../../lib/format'
import { downloadCsv } from './csv'
import { DateInput, EmptyState, ErrorState, ExportButton, LoadingState } from './shared'
import type { DayBookResponse } from './types'

export function DayBookTab({ companyId }: { companyId: string }) {
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [filterText, setFilterText] = useState('')

  const query = useQuery({
    queryKey: ['acct-report-day-book', companyId, from, to],
    queryFn: () => {
      const params = new URLSearchParams({ company_id: companyId })
      if (from) params.set('from', from)
      if (to) params.set('to', to)
      return cbopFetch<DayBookResponse>(`/api/accounting/reports/day-book?${params.toString()}`, {
        activeCompanyId: companyId,
      })
    },
  })

  const data = query.data

  // Client-side table filter only, per CLAUDE.md ("No global search bar. Table
  // filters only") - the day book is the one report where a mixed-account feed
  // benefits most from a free-text narrow-down.
  const filtered = useMemo(() => {
    const lines = data?.lines ?? []
    const q = filterText.trim().toLowerCase()
    if (!q) return lines
    return lines.filter(
      (l) =>
        l.entry_no.toLowerCase().includes(q) ||
        (l.narration ?? '').toLowerCase().includes(q) ||
        (l.reference ?? '').toLowerCase().includes(q) ||
        l.account_code.toLowerCase().includes(q) ||
        l.account_name.toLowerCase().includes(q)
    )
  }, [data, filterText])

  function exportCsv() {
    downloadCsv(
      `day-book-${from || 'all'}-to-${to || 'today'}.csv`,
      ['Date', 'Entry No', 'Reference', 'Narration', 'Source', 'Account Code', 'Account', 'Debit', 'Credit'],
      filtered.map((l) => [
        l.entry_date,
        l.entry_no,
        l.reference ?? '',
        l.narration ?? '',
        l.source_type,
        l.account_code,
        l.account_name,
        l.debit,
        l.credit,
      ])
    )
  }

  return (
    <section>
      <div className="flex items-center justify-between mb-4 flex-wrap gap-3">
        <h2 className="font-display font-semibold text-text1">Day Book</h2>
        <div className="flex items-center gap-3 flex-wrap">
          <DateInput label="From" value={from} onChange={setFrom} />
          <DateInput label="To" value={to} onChange={setTo} />
          <ExportButton onClick={exportCsv} disabled={filtered.length === 0} />
        </div>
      </div>

      {query.isLoading && <LoadingState />}
      {query.isError && <ErrorState />}

      {data && data.lines.length > 0 && (
        <input
          value={filterText}
          onChange={(e) => setFilterText(e.target.value)}
          placeholder="Filter by entry no, account, narration..."
          className="h-9 w-80 mb-3 rounded-md border border-border bg-white px-3 text-sm text-text1 focus:outline-none focus:border-blue placeholder:text-text3"
        />
      )}

      {data && data.lines.length === 0 && <EmptyState message="No posted activity in this range." />}
      {data && data.lines.length > 0 && filtered.length === 0 && <EmptyState message="No lines match this filter." />}

      {filtered.length > 0 && (
        <div className="rounded-lg border border-border bg-card overflow-hidden overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-bg text-left text-[11px] uppercase tracking-wide text-text3">
                <th className="px-4 py-2.5 font-medium">Date</th>
                <th className="px-4 py-2.5 font-medium">Entry No</th>
                <th className="px-4 py-2.5 font-medium">Account</th>
                <th className="px-4 py-2.5 font-medium">Narration</th>
                <th className="px-4 py-2.5 font-medium">Source</th>
                <th className="px-4 py-2.5 font-medium text-right">Debit</th>
                <th className="px-4 py-2.5 font-medium text-right">Credit</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((l, i) => (
                <tr key={`${l.id}-${l.account_code}-${i}`} className="border-b border-border last:border-0">
                  <td className="px-4 py-2 font-mono text-text2">{fmtDate(l.entry_date)}</td>
                  <td className="px-4 py-2 font-mono text-text1">{l.entry_no}</td>
                  <td className="px-4 py-2 text-text1">
                    <span className="font-mono text-text2 mr-1.5">{l.account_code}</span>
                    {l.account_name}
                  </td>
                  <td className="px-4 py-2 text-text1">
                    {l.narration || l.reference || <span className="text-text3">-</span>}
                  </td>
                  <td className="px-4 py-2 text-text2 capitalize">{l.source_type}</td>
                  <td className="px-4 py-2 text-right font-mono text-text1">{Number(l.debit) ? inr(l.debit) : '-'}</td>
                  <td className="px-4 py-2 text-right font-mono text-text1">{Number(l.credit) ? inr(l.credit) : '-'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}
