'use client'

import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { cbopFetch } from '../../lib/api-client'
import { inr, todayIso } from '../../lib/format'
import { ACCOUNT_TYPE_ORDER, ACCOUNT_TYPE_LABELS } from '../accounts/types'
import { downloadCsv } from './csv'
import { DateInput, EmptyState, ErrorState, ExportButton, LoadingState } from './shared'
import type { TrialBalanceAccount, TrialBalanceResponse } from './types'

export function TrialBalanceTab({ companyId }: { companyId: string }) {
  const [asOf, setAsOf] = useState(todayIso())

  const query = useQuery({
    queryKey: ['acct-report-trial-balance', companyId, asOf],
    queryFn: () =>
      cbopFetch<TrialBalanceResponse>(`/api/accounting/reports/trial-balance?company_id=${companyId}&as_of=${asOf}`, {
        activeCompanyId: companyId,
      }),
  })

  const data = query.data

  const grouped = useMemo(() => {
    const map = new Map<string, TrialBalanceAccount[]>()
    for (const t of ACCOUNT_TYPE_ORDER) map.set(t, [])
    for (const a of data?.accounts ?? []) map.get(a.account_type)?.push(a)
    return map
  }, [data])

  function exportCsv() {
    if (!data) return
    downloadCsv(
      `trial-balance-${asOf}.csv`,
      ['Code', 'Name', 'Type', 'Debit', 'Credit', 'Balance'],
      data.accounts.map((a) => [a.account_code, a.account_name, a.account_type, a.debit, a.credit, a.balance])
    )
  }

  return (
    <section>
      <div className="flex items-center justify-between mb-4 flex-wrap gap-3">
        <h2 className="font-display font-semibold text-text1">Trial Balance</h2>
        <div className="flex items-center gap-3">
          <DateInput label="As of" value={asOf} onChange={setAsOf} />
          <ExportButton onClick={exportCsv} disabled={!data || data.accounts.length === 0} />
        </div>
      </div>

      {query.isLoading && <LoadingState />}
      {query.isError && <ErrorState />}
      {data && data.accounts.length === 0 && <EmptyState message="No posted activity as of this date." />}

      {data && data.accounts.length > 0 && (
        <div className="rounded-lg border border-border bg-card overflow-hidden overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-bg text-left text-[11px] uppercase tracking-wide text-text3">
                <th className="px-4 py-2.5 font-medium">Code</th>
                <th className="px-4 py-2.5 font-medium">Account</th>
                <th className="px-4 py-2.5 font-medium text-right">Debit</th>
                <th className="px-4 py-2.5 font-medium text-right">Credit</th>
                <th className="px-4 py-2.5 font-medium text-right">Balance</th>
              </tr>
            </thead>
            <tbody>
              {ACCOUNT_TYPE_ORDER.map((type) => {
                const rows = grouped.get(type) ?? []
                if (rows.length === 0) return null
                return (
                  <SectionRows
                    key={type}
                    label={ACCOUNT_TYPE_LABELS[type]}
                    rows={rows}
                    subtotalDebit={rows.reduce((s, r) => s + r.debit, 0)}
                    subtotalCredit={rows.reduce((s, r) => s + r.credit, 0)}
                  />
                )
              })}
              <tr className="border-t-2 border-border bg-bg font-semibold">
                <td className="px-4 py-2.5" colSpan={2}>
                  Grand Total
                </td>
                <td className="px-4 py-2.5 text-right font-mono text-text1">{inr(data.totals.debit)}</td>
                <td className="px-4 py-2.5 text-right font-mono text-text1">{inr(data.totals.credit)}</td>
                <td
                  className={`px-4 py-2.5 text-right text-xs ${
                    Math.abs(data.totals.debit - data.totals.credit) < 0.01 ? 'text-green' : 'text-red'
                  }`}
                >
                  {Math.abs(data.totals.debit - data.totals.credit) < 0.01 ? 'Balanced' : 'Mismatch'}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}

function SectionRows({
  label,
  rows,
  subtotalDebit,
  subtotalCredit,
}: {
  label: string
  rows: TrialBalanceAccount[]
  subtotalDebit: number
  subtotalCredit: number
}) {
  return (
    <>
      <tr>
        <td colSpan={5} className="px-4 pt-3 pb-1 text-[11px] font-semibold uppercase tracking-wide text-text3">
          {label}
        </td>
      </tr>
      {rows.map((a) => (
        <tr key={a.id} className="border-b border-border last:border-0">
          <td className="px-4 py-2 font-mono text-text1">{a.account_code}</td>
          <td className="px-4 py-2 text-text1">{a.account_name}</td>
          <td className="px-4 py-2 text-right font-mono text-text2">{a.debit ? inr(a.debit) : '-'}</td>
          <td className="px-4 py-2 text-right font-mono text-text2">{a.credit ? inr(a.credit) : '-'}</td>
          <td className="px-4 py-2 text-right font-mono text-text1">{inr(a.balance)}</td>
        </tr>
      ))}
      <tr className="border-b border-border bg-bg/60">
        <td className="px-4 py-1.5 text-xs text-text3" colSpan={2}>
          {label} subtotal
        </td>
        <td className="px-4 py-1.5 text-right font-mono text-xs text-text2">{inr(subtotalDebit)}</td>
        <td className="px-4 py-1.5 text-right font-mono text-xs text-text2">{inr(subtotalCredit)}</td>
        <td className="px-4 py-1.5"></td>
      </tr>
    </>
  )
}
