'use client'

import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { cbopFetch } from '../../lib/api-client'
import { fmtDateTime } from '../../lib/format'
import {
  ACTION_LABELS,
  ACTION_STYLES,
  diffFields,
  shortId,
  summaryFields,
  DiffRow,
  SummaryRow,
  type AuditLogEntry,
} from '../../components/audit-history-panel'
import { downloadCsv } from './csv'
import { DateInput, EmptyState, ErrorState, ExportButton, LoadingState } from './shared'

// Company-wide audit trail (Slice 7) - GET /api/accounting/audit-log with
// only company_id (+ optional resource_type), no resource_id, so it returns
// every acct_* mutation for the company, newest-first, capped at 500 rows
// server-side. The API has no from/to params, so the date range picker here
// filters the already-fetched (server-side resource_type-filtered) rows
// client-side - same "date range narrows what's on screen" feel as the other
// report tabs even though there's no dedicated date-ranged endpoint to call.
//
// Resource-type filter list intentionally matches the build spec exactly
// (All / Journal Entries / Chart of Accounts / Bills / Fiscal Periods) and
// leaves out acct_journal_entry_lines as its own filter option - line-level
// history is the journal entry's own "History" panel's job (it merges lines
// in there), this company-wide view stays at the document level. Selecting
// "All" still includes line-level rows in the feed, just without a dedicated
// filter chip for them.

const RESOURCE_TYPE_OPTIONS: { value: string; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'acct_journal_entries', label: 'Journal Entries' },
  { value: 'acct_chart_of_accounts', label: 'Chart of Accounts' },
  { value: 'acct_bills', label: 'Bills' },
  { value: 'acct_fiscal_periods', label: 'Fiscal Periods' },
]

export function AuditTrailTab({ companyId }: { companyId: string }) {
  const [resourceType, setResourceType] = useState('all')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [expandedId, setExpandedId] = useState<string | null>(null)

  const query = useQuery({
    queryKey: ['acct-audit-log-company', companyId, resourceType],
    queryFn: () =>
      cbopFetch<{ entries: AuditLogEntry[] }>(
        `/api/accounting/audit-log?company_id=${companyId}${resourceType !== 'all' ? `&resource_type=${resourceType}` : ''}`,
        { activeCompanyId: companyId }
      ),
  })

  const entries = useMemo(() => {
    const all = query.data?.entries ?? []
    if (!from && !to) return all
    const fromTime = from ? new Date(from).getTime() : -Infinity
    // End-of-day for `to` so the selected day itself is included.
    const toTime = to ? new Date(to).getTime() + 24 * 60 * 60 * 1000 - 1 : Infinity
    return all.filter((e) => {
      const t = new Date(e.created_at).getTime()
      return t >= fromTime && t <= toTime
    })
  }, [query.data, from, to])

  function exportCsv() {
    downloadCsv(
      `audit-trail-${companyId}.csv`,
      ['Timestamp', 'Actor', 'Role', 'Action', 'Resource Type', 'Resource ID'],
      entries.map((e) => [
        e.created_at,
        e.actor_name ?? 'Unknown',
        e.actor_role ?? '',
        ACTION_LABELS[e.action],
        e.resource_type,
        e.resource_id,
      ])
    )
  }

  return (
    <section>
      <div className="flex items-center justify-between mb-4 flex-wrap gap-3">
        <h2 className="font-display font-semibold text-text1">Audit Trail</h2>
        <div className="flex items-center gap-3 flex-wrap">
          <select
            value={resourceType}
            onChange={(e) => setResourceType(e.target.value)}
            className="h-9 rounded-md border border-border bg-white px-2.5 text-sm text-text1 focus:outline-none focus:border-blue"
          >
            {RESOURCE_TYPE_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
          <DateInput label="From" value={from} onChange={setFrom} />
          <DateInput label="To" value={to} onChange={setTo} />
          <ExportButton onClick={exportCsv} disabled={entries.length === 0} />
        </div>
      </div>

      {query.isLoading && <LoadingState />}
      {query.isError && <ErrorState />}
      {!query.isLoading && !query.isError && entries.length === 0 && (
        <EmptyState message="No audit activity found for this filter." />
      )}

      {entries.length > 0 && (
        <div className="rounded-lg border border-border bg-card overflow-hidden overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-bg text-left text-[11px] uppercase tracking-wide text-text3">
                <th className="px-4 py-2.5 font-medium">Timestamp</th>
                <th className="px-4 py-2.5 font-medium">Actor</th>
                <th className="px-4 py-2.5 font-medium">Action</th>
                <th className="px-4 py-2.5 font-medium">Resource</th>
                <th className="px-4 py-2.5 font-medium">Diff</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((entry) => (
                <AuditTrailRow
                  key={entry.id}
                  entry={entry}
                  expanded={expandedId === entry.id}
                  onToggle={() => setExpandedId(expandedId === entry.id ? null : entry.id)}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}

function AuditTrailRow({
  entry,
  expanded,
  onToggle,
}: {
  entry: AuditLogEntry
  expanded: boolean
  onToggle: () => void
}) {
  const changes = entry.action === 'update' ? diffFields(entry.before_json, entry.after_json) : []
  const insertRow = entry.action === 'insert' ? summaryFields(entry.after_json) : []
  const deleteRow = entry.action === 'delete' ? summaryFields(entry.before_json) : []
  const hasDetail = changes.length > 0 || insertRow.length > 0 || deleteRow.length > 0

  return (
    <>
      <tr className="border-b border-border last:border-0">
        <td className="px-4 py-2 font-mono text-xs text-text2">{fmtDateTime(entry.created_at)}</td>
        <td className="px-4 py-2 text-text1">
          {entry.actor_name ?? 'Unknown'}
          {entry.actor_role && <span className="ml-1.5 text-xs text-text3 uppercase tracking-wide">{entry.actor_role}</span>}
        </td>
        <td className="px-4 py-2">
          <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium ${ACTION_STYLES[entry.action]}`}>
            {ACTION_LABELS[entry.action]}
          </span>
        </td>
        <td className="px-4 py-2 font-mono text-xs text-text2">
          {entry.resource_type} / {shortId(entry.resource_id)}
        </td>
        <td className="px-4 py-2">
          {hasDetail ? (
            <button type="button" onClick={onToggle} className="text-xs font-medium text-blue hover:underline">
              {expanded ? 'Hide' : entry.action === 'update' ? 'View diff' : 'View details'}
            </button>
          ) : (
            <span className="text-xs text-text3">-</span>
          )}
        </td>
      </tr>
      {expanded && hasDetail && (
        <tr className="border-b border-border last:border-0 bg-bg">
          <td colSpan={5} className="px-4 py-3">
            <div className="flex flex-col">
              {entry.action === 'update' && changes.map((c) => <DiffRow key={c.field} change={c} />)}
              {entry.action === 'insert' &&
                insertRow.map(([field, value]) => <SummaryRow key={field} field={field} value={value} tone="green" />)}
              {entry.action === 'delete' &&
                deleteRow.map(([field, value]) => <SummaryRow key={field} field={field} value={value} tone="red" />)}
            </div>
          </td>
        </tr>
      )}
    </>
  )
}
