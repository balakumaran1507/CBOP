'use client'

import { useQuery } from '@tanstack/react-query'
import { useCbopSession } from '../../lib/session-context'
import { cbopFetch } from '../../lib/api-client'
import { inr } from '../../lib/format'
import { downloadCsv } from './csv'
import { ErrorState, ExportButton, LoadingState } from './shared'
import type { RollupResponse } from './types'

// The flagship cross-company view - the one thing the old /accounting page
// explicitly could not do. No company_ids param passed: omitting it lets the
// server default to every company the caller can see (creator = every
// company system-wide, ceo = their own companyIds), which is exactly what
// "every company you have visibility into" should mean here.
export function RollupTab() {
  const session = useCbopSession()

  const query = useQuery({
    queryKey: ['acct-report-rollup', session.userId],
    queryFn: () =>
      cbopFetch<RollupResponse>('/api/accounting/reports/rollup', { activeCompanyId: session.activeCompanyId }),
  })

  const data = query.data

  function exportCsv() {
    if (!data) return
    downloadCsv(
      'company-rollup.csv',
      ['Company', 'Revenue', 'Expenses', 'Net Profit', 'Cash + Bank', 'AR Outstanding', 'AP Outstanding'],
      [
        ...data.companies.map((c) => [
          c.company_name,
          c.revenue,
          c.expenses,
          c.net_profit,
          c.cash_and_bank,
          c.ar_outstanding,
          c.ap_outstanding,
        ]),
        [
          'Total',
          data.totals.revenue,
          data.totals.expenses,
          data.totals.net_profit,
          data.totals.cash_and_bank,
          data.totals.ar_outstanding,
          data.totals.ap_outstanding,
        ],
      ]
    )
  }

  return (
    <section>
      <div className="flex items-start justify-between mb-1 flex-wrap gap-3">
        <div>
          <h2 className="font-display font-semibold text-text1">Company Rollup</h2>
          <p className="text-sm text-text2 mt-0.5 max-w-xl">
            Every company you have visibility into, side by side - the cross-company view the old accounting
            page could never show.
          </p>
        </div>
        <ExportButton onClick={exportCsv} disabled={!data || data.companies.length === 0} />
      </div>

      {query.isLoading && <LoadingState />}
      {query.isError && <ErrorState />}

      {data && data.companies.length === 0 && (
        <div className="mt-4 rounded-lg border border-border bg-card p-8 text-center">
          <p className="text-sm text-text2">No companies in scope.</p>
        </div>
      )}

      {data && data.companies.length > 0 && (
        <div className="mt-4 rounded-lg border border-border bg-card overflow-hidden overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-bg text-left text-[11px] uppercase tracking-wide text-text3">
                <th className="px-4 py-3 font-medium">Company</th>
                <th className="px-4 py-3 font-medium text-right">Revenue</th>
                <th className="px-4 py-3 font-medium text-right">Expenses</th>
                <th className="px-4 py-3 font-medium text-right">Net Profit</th>
                <th className="px-4 py-3 font-medium text-right">Cash + Bank</th>
                <th className="px-4 py-3 font-medium text-right">AR Outstanding</th>
                <th className="px-4 py-3 font-medium text-right">AP Outstanding</th>
              </tr>
            </thead>
            <tbody>
              {data.companies.map((c) => (
                <tr key={c.company_id} className="border-b border-border last:border-0 hover:bg-bg/60 transition-colors">
                  <td className="px-4 py-3 font-display font-medium text-text1">{c.company_name}</td>
                  <td className="px-4 py-3 text-right font-mono text-text1">{inr(c.revenue)}</td>
                  <td className="px-4 py-3 text-right font-mono text-text1">{inr(c.expenses)}</td>
                  <td
                    className={`px-4 py-3 text-right font-mono font-semibold ${
                      c.net_profit >= 0 ? 'text-green' : 'text-red'
                    }`}
                  >
                    {inr(c.net_profit)}
                  </td>
                  <td className="px-4 py-3 text-right font-mono text-text1">{inr(c.cash_and_bank)}</td>
                  <td className="px-4 py-3 text-right font-mono text-amber">{inr(c.ar_outstanding)}</td>
                  <td className="px-4 py-3 text-right font-mono text-text2">{inr(c.ap_outstanding)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t-2 border-border bg-bg font-semibold">
                <td className="px-4 py-3 font-display text-text1">Total</td>
                <td className="px-4 py-3 text-right font-mono text-text1">{inr(data.totals.revenue)}</td>
                <td className="px-4 py-3 text-right font-mono text-text1">{inr(data.totals.expenses)}</td>
                <td
                  className={`px-4 py-3 text-right font-mono ${
                    data.totals.net_profit >= 0 ? 'text-green' : 'text-red'
                  }`}
                >
                  {inr(data.totals.net_profit)}
                </td>
                <td className="px-4 py-3 text-right font-mono text-text1">{inr(data.totals.cash_and_bank)}</td>
                <td className="px-4 py-3 text-right font-mono text-amber">{inr(data.totals.ar_outstanding)}</td>
                <td className="px-4 py-3 text-right font-mono text-text2">{inr(data.totals.ap_outstanding)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </section>
  )
}
