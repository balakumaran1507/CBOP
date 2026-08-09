'use client'

import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { cbopFetch } from '../../lib/api-client'
import { inr } from '../../lib/format'
import { downloadCsv } from './csv'
import { DateInput, EmptyState, ErrorState, ExportButton, LoadingState } from './shared'
import type { ProfitAndLossResponse } from './types'

export function ProfitAndLossTab({ companyId }: { companyId: string }) {
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')

  const query = useQuery({
    queryKey: ['acct-report-pnl', companyId, from, to],
    queryFn: () => {
      const params = new URLSearchParams({ company_id: companyId })
      if (from) params.set('from', from)
      if (to) params.set('to', to)
      return cbopFetch<ProfitAndLossResponse>(`/api/accounting/reports/profit-and-loss?${params.toString()}`, {
        activeCompanyId: companyId,
      })
    },
  })

  const data = query.data
  const isEmpty = !!data && data.revenue.length === 0 && data.expenses.length === 0

  function exportCsv() {
    if (!data) return
    downloadCsv(
      `profit-and-loss-${data.from}-to-${data.to}.csv`,
      ['Section', 'Code', 'Account', 'Amount'],
      [
        ...data.revenue.map((r) => ['Revenue', r.account_code, r.account_name, r.amount]),
        ...data.expenses.map((r) => ['Expense', r.account_code, r.account_name, r.amount]),
        ['', '', 'Total Revenue', data.total_revenue],
        ['', '', 'Total Expenses', data.total_expenses],
        ['', '', 'Net Profit', data.net_profit],
      ]
    )
  }

  return (
    <section>
      <div className="flex items-center justify-between mb-4 flex-wrap gap-3">
        <h2 className="font-display font-semibold text-text1">Profit &amp; Loss</h2>
        <div className="flex items-center gap-3 flex-wrap">
          <DateInput label="From" value={from} onChange={setFrom} />
          <DateInput label="To" value={to} onChange={setTo} />
          <ExportButton onClick={exportCsv} disabled={!data || isEmpty} />
        </div>
      </div>

      {query.isLoading && <LoadingState />}
      {query.isError && <ErrorState />}
      {isEmpty && <EmptyState message="No revenue or expense activity in this range." />}

      {data && !isEmpty && (
        <div className="rounded-lg border border-border bg-card overflow-hidden overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-bg text-left text-[11px] uppercase tracking-wide text-text3">
                <th className="px-4 py-2.5 font-medium">Code</th>
                <th className="px-4 py-2.5 font-medium">Account</th>
                <th className="px-4 py-2.5 font-medium text-right">Amount</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td colSpan={3} className="px-4 pt-3 pb-1 text-[11px] font-semibold uppercase tracking-wide text-text3">
                  Revenue
                </td>
              </tr>
              {data.revenue.length === 0 && (
                <tr>
                  <td colSpan={3} className="px-4 py-2 text-xs text-text3">
                    No revenue posted in this range.
                  </td>
                </tr>
              )}
              {data.revenue.map((r) => (
                <tr key={r.account_code} className="border-b border-border last:border-0">
                  <td className="px-4 py-2 font-mono text-text1">{r.account_code}</td>
                  <td className="px-4 py-2 text-text1">{r.account_name}</td>
                  <td className="px-4 py-2 text-right font-mono text-text1">{inr(r.amount)}</td>
                </tr>
              ))}
              <tr className="border-b border-border bg-bg/60">
                <td className="px-4 py-1.5" colSpan={2}>
                  <span className="text-xs text-text3">Total Revenue</span>
                </td>
                <td className="px-4 py-1.5 text-right font-mono text-xs text-text2">{inr(data.total_revenue)}</td>
              </tr>

              <tr>
                <td colSpan={3} className="px-4 pt-3 pb-1 text-[11px] font-semibold uppercase tracking-wide text-text3">
                  Expenses
                </td>
              </tr>
              {data.expenses.length === 0 && (
                <tr>
                  <td colSpan={3} className="px-4 py-2 text-xs text-text3">
                    No expenses posted in this range.
                  </td>
                </tr>
              )}
              {data.expenses.map((r) => (
                <tr key={r.account_code} className="border-b border-border last:border-0">
                  <td className="px-4 py-2 font-mono text-text1">{r.account_code}</td>
                  <td className="px-4 py-2 text-text1">{r.account_name}</td>
                  <td className="px-4 py-2 text-right font-mono text-text1">{inr(r.amount)}</td>
                </tr>
              ))}
              <tr className="border-b border-border bg-bg/60">
                <td className="px-4 py-1.5" colSpan={2}>
                  <span className="text-xs text-text3">Total Expenses</span>
                </td>
                <td className="px-4 py-1.5 text-right font-mono text-xs text-text2">{inr(data.total_expenses)}</td>
              </tr>

              <tr className={`border-t-2 border-border font-semibold ${data.net_profit >= 0 ? 'bg-green/10' : 'bg-red/10'}`}>
                <td className="px-4 py-2.5" colSpan={2}>
                  Net {data.net_profit >= 0 ? 'Profit' : 'Loss'}
                </td>
                <td className={`px-4 py-2.5 text-right font-mono ${data.net_profit >= 0 ? 'text-green' : 'text-red'}`}>
                  {inr(Math.abs(data.net_profit))}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}
