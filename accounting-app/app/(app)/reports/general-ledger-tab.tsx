'use client'

import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { cbopFetch } from '../../lib/api-client'
import { inr, fmtDate } from '../../lib/format'
import type { Account } from '../accounts/types'
import { downloadCsv } from './csv'
import { DateInput, EmptyState, ErrorState, ExportButton, LoadingState } from './shared'
import type { LedgerResponse } from './types'

export function GeneralLedgerTab({ companyId }: { companyId: string }) {
  const [accountId, setAccountId] = useState('')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')

  // Same query key as accounts/page.tsx and journal/page.tsx - shares cache
  // across the app rather than refetching the chart of accounts a fourth time.
  const accountsQuery = useQuery({
    queryKey: ['acct-accounts', companyId],
    queryFn: () =>
      cbopFetch<{ accounts: Account[] }>(`/api/accounting/accounts?company_id=${companyId}`, {
        activeCompanyId: companyId,
      }),
  })

  const accounts = useMemo(
    () =>
      (accountsQuery.data?.accounts ?? [])
        .filter((a) => !a.is_group)
        .sort((a, b) => a.account_code.localeCompare(b.account_code)),
    [accountsQuery.data]
  )

  const ledgerQuery = useQuery({
    queryKey: ['acct-report-ledger', accountId, from, to],
    queryFn: () => {
      const params = new URLSearchParams()
      if (from) params.set('from', from)
      if (to) params.set('to', to)
      return cbopFetch<LedgerResponse>(`/api/accounting/reports/ledger/${accountId}?${params.toString()}`, {
        activeCompanyId: companyId,
      })
    },
    enabled: !!accountId,
  })

  const data = ledgerQuery.data

  function exportCsv() {
    if (!data) return
    downloadCsv(
      `ledger-${data.account.account_code}.csv`,
      ['Date', 'Entry No', 'Reference', 'Narration', 'Source', 'Debit', 'Credit', 'Running Balance'],
      data.lines.map((l) => [
        l.entry_date,
        l.entry_no,
        l.reference ?? '',
        l.narration ?? '',
        l.source_type,
        l.debit,
        l.credit,
        l.running_balance,
      ])
    )
  }

  return (
    <section>
      <div className="flex items-center justify-between mb-4 flex-wrap gap-3">
        <h2 className="font-display font-semibold text-text1">General Ledger</h2>
        <div className="flex items-center gap-3 flex-wrap">
          <select
            value={accountId}
            onChange={(e) => setAccountId(e.target.value)}
            className="h-9 rounded-md border border-border bg-white px-2.5 text-sm text-text1 focus:outline-none focus:border-blue min-w-[220px]"
          >
            <option value="">Select an account...</option>
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.account_code} - {a.account_name}
              </option>
            ))}
          </select>
          <DateInput label="From" value={from} onChange={setFrom} />
          <DateInput label="To" value={to} onChange={setTo} />
          <ExportButton onClick={exportCsv} disabled={!data || data.lines.length === 0} />
        </div>
      </div>

      {!accountId && <EmptyState message="Pick an account above to view its general ledger." />}

      {accountId && ledgerQuery.isLoading && <LoadingState />}
      {accountId && ledgerQuery.isError && <ErrorState />}
      {accountId && data && data.lines.length === 0 && (
        <EmptyState message="No posted activity for this account in this range." />
      )}

      {data && data.lines.length > 0 && (
        <>
          <p className="text-xs text-text3 mb-2">
            <span className="font-mono">{data.account.account_code}</span> - {data.account.account_name} - normal
            balance: <span className="capitalize">{data.account.normal_balance}</span>
          </p>
          <div className="rounded-lg border border-border bg-card overflow-hidden overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-bg text-left text-[11px] uppercase tracking-wide text-text3">
                  <th className="px-4 py-2.5 font-medium">Date</th>
                  <th className="px-4 py-2.5 font-medium">Entry No</th>
                  <th className="px-4 py-2.5 font-medium">Reference / Narration</th>
                  <th className="px-4 py-2.5 font-medium">Source</th>
                  <th className="px-4 py-2.5 font-medium text-right">Debit</th>
                  <th className="px-4 py-2.5 font-medium text-right">Credit</th>
                  <th className="px-4 py-2.5 font-medium text-right">Running Balance</th>
                </tr>
              </thead>
              <tbody>
                {data.lines.map((l, i) => (
                  <tr key={i} className="border-b border-border last:border-0">
                    <td className="px-4 py-2 font-mono text-text2">{fmtDate(l.entry_date)}</td>
                    <td className="px-4 py-2 font-mono text-text1">{l.entry_no}</td>
                    <td className="px-4 py-2 text-text1">
                      {l.reference || l.narration || <span className="text-text3">-</span>}
                    </td>
                    <td className="px-4 py-2 text-text2 capitalize">{l.source_type}</td>
                    <td className="px-4 py-2 text-right font-mono text-text1">
                      {Number(l.debit) ? inr(l.debit) : '-'}
                    </td>
                    <td className="px-4 py-2 text-right font-mono text-text1">
                      {Number(l.credit) ? inr(l.credit) : '-'}
                    </td>
                    <td className="px-4 py-2 text-right font-mono text-text1">{inr(l.running_balance)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </section>
  )
}
