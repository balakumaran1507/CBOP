'use client'

import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { cbopFetch } from '../../lib/api-client'
import { inr, todayIso } from '../../lib/format'
import { downloadCsv } from './csv'
import { DateInput, EmptyState, ErrorState, ExportButton, LoadingState } from './shared'
import type { BalanceSheetLine, BalanceSheetResponse } from './types'

export function BalanceSheetTab({ companyId }: { companyId: string }) {
  const [asOf, setAsOf] = useState(todayIso())

  const query = useQuery({
    queryKey: ['acct-report-balance-sheet', companyId, asOf],
    queryFn: () =>
      cbopFetch<BalanceSheetResponse>(`/api/accounting/reports/balance-sheet?company_id=${companyId}&as_of=${asOf}`, {
        activeCompanyId: companyId,
      }),
  })

  const data = query.data
  const isEmpty = !!data && data.assets.length === 0 && data.liabilities.length === 0 && data.equity.length === 0
  const balanced = data ? Math.abs(data.total_assets - data.total_liabilities_and_equity) < 0.01 : false

  function exportCsv() {
    if (!data) return
    downloadCsv(
      `balance-sheet-${asOf}.csv`,
      ['Section', 'Code', 'Account', 'Amount'],
      [
        ...data.assets.map((a) => ['Asset', a.account_code, a.account_name, a.amount]),
        ...data.liabilities.map((a) => ['Liability', a.account_code, a.account_name, a.amount]),
        ...data.equity.map((a) => ['Equity', a.account_code, a.account_name, a.amount]),
        ['Equity', '', 'Net Income (current, undistributed)', data.net_income],
        ['', '', 'Total Assets', data.total_assets],
        ['', '', 'Total Liabilities + Equity', data.total_liabilities_and_equity],
      ]
    )
  }

  return (
    <section>
      <div className="flex items-center justify-between mb-4 flex-wrap gap-3">
        <h2 className="font-display font-semibold text-text1">Balance Sheet</h2>
        <div className="flex items-center gap-3">
          <DateInput label="As of" value={asOf} onChange={setAsOf} />
          <ExportButton onClick={exportCsv} disabled={!data || isEmpty} />
        </div>
      </div>

      {query.isLoading && <LoadingState />}
      {query.isError && <ErrorState />}
      {isEmpty && <EmptyState message="No asset, liability, or equity activity as of this date." />}

      {data && !isEmpty && (
        <>
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
                <BsSection label="Assets" rows={data.assets} total={data.total_assets} totalLabel="Total Assets" />
                <BsSection
                  label="Liabilities"
                  rows={data.liabilities}
                  total={data.total_liabilities}
                  totalLabel="Total Liabilities"
                />

                <tr>
                  <td colSpan={3} className="px-4 pt-3 pb-1 text-[11px] font-semibold uppercase tracking-wide text-text3">
                    Equity
                  </td>
                </tr>
                {data.equity.map((a) => (
                  <tr key={a.account_code} className="border-b border-border last:border-0">
                    <td className="px-4 py-2 font-mono text-text1">{a.account_code}</td>
                    <td className="px-4 py-2 text-text1">{a.account_name}</td>
                    <td className="px-4 py-2 text-right font-mono text-text1">{inr(a.amount)}</td>
                  </tr>
                ))}
                <tr className="border-b border-border">
                  <td className="px-4 py-2 font-mono text-text3">-</td>
                  <td className="px-4 py-2 text-text1">Net Income (current, undistributed)</td>
                  <td className="px-4 py-2 text-right font-mono text-text1">{inr(data.net_income)}</td>
                </tr>
                <tr className="border-b border-border bg-bg/60">
                  <td className="px-4 py-1.5" colSpan={2}>
                    <span className="text-xs text-text3">Total Equity</span>
                  </td>
                  <td className="px-4 py-1.5 text-right font-mono text-xs text-text2">{inr(data.total_equity)}</td>
                </tr>

                <tr className="border-t-2 border-border bg-bg font-semibold">
                  <td className="px-4 py-2.5" colSpan={2}>
                    Total Liabilities + Equity
                  </td>
                  <td className="px-4 py-2.5 text-right font-mono text-text1">{inr(data.total_liabilities_and_equity)}</td>
                </tr>
              </tbody>
            </table>
          </div>

          <div
            className={`mt-3 inline-flex items-center gap-2 rounded-md px-3 py-1.5 text-xs font-medium ${
              balanced ? 'bg-green/10 text-green' : 'bg-red/10 text-red'
            }`}
          >
            {balanced ? 'Balanced' : 'Mismatch'} - Assets{' '}
            <span className="font-mono">{inr(data.total_assets)}</span> vs Liabilities + Equity{' '}
            <span className="font-mono">{inr(data.total_liabilities_and_equity)}</span>
          </div>
        </>
      )}
    </section>
  )
}

function BsSection({
  label,
  rows,
  total,
  totalLabel,
}: {
  label: string
  rows: BalanceSheetLine[]
  total: number
  totalLabel: string
}) {
  return (
    <>
      <tr>
        <td colSpan={3} className="px-4 pt-3 pb-1 text-[11px] font-semibold uppercase tracking-wide text-text3">
          {label}
        </td>
      </tr>
      {rows.length === 0 && (
        <tr>
          <td colSpan={3} className="px-4 py-2 text-xs text-text3">
            None
          </td>
        </tr>
      )}
      {rows.map((a) => (
        <tr key={a.account_code} className="border-b border-border last:border-0">
          <td className="px-4 py-2 font-mono text-text1">{a.account_code}</td>
          <td className="px-4 py-2 text-text1">{a.account_name}</td>
          <td className="px-4 py-2 text-right font-mono text-text1">{inr(a.amount)}</td>
        </tr>
      ))}
      <tr className="border-b border-border bg-bg/60">
        <td className="px-4 py-1.5" colSpan={2}>
          <span className="text-xs text-text3">{totalLabel}</span>
        </td>
        <td className="px-4 py-1.5 text-right font-mono text-xs text-text2">{inr(total)}</td>
      </tr>
    </>
  )
}
