'use client'

import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { cbopFetch } from '../../lib/api-client'
import { inr, fmtDate } from '../../lib/format'
import { downloadCsv } from './csv'
import { DateInput, EmptyState, ErrorState, ExportButton, LoadingState } from './shared'
import type { TdsLedgerResponse } from './types'

// TDS deduction ledger from bill-linked acct_tax_details, backed by
// GET /api/accounting/reports/tds-ledger. CBOP tracks what was deducted;
// challan deposit and 26Q/24Q filing stay the CA's job (same division of
// labor as GSTR-1/3B - see ACCOUNTING_Build_Plan.md).
export function TdsLedgerTab({ companyId }: { companyId: string }) {
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')

  const query = useQuery({
    queryKey: ['acct-report-tds-ledger', companyId, from, to],
    queryFn: () => {
      const params = new URLSearchParams({ company_id: companyId })
      if (from) params.set('from', from)
      if (to) params.set('to', to)
      return cbopFetch<TdsLedgerResponse>(`/api/accounting/reports/tds-ledger?${params.toString()}`, {
        activeCompanyId: companyId,
      })
    },
  })

  const data = query.data
  // Stat-card strip pattern reused from aging-tab.tsx, one card per TDS
  // section present, sorted largest-first.
  const sections = useMemo(() => Object.entries(data?.by_section ?? {}).sort((a, b) => b[1] - a[1]), [data])

  function exportCsv() {
    if (!data) return
    downloadCsv(
      `tds-ledger-${from || 'all'}-to-${to || 'today'}.csv`,
      ['Vendor', 'PAN/GSTIN', 'Bill No', 'Bill Date', 'Section', 'Rate', 'Taxable Value', 'TDS Amount'],
      data.deductions.map((d) => [
        d.vendor_name,
        d.vendor_pan_or_gstin ?? '',
        d.bill_no ?? '',
        d.bill_date,
        d.tds_section,
        d.tds_rate,
        d.taxable_value,
        d.tds_amount,
      ])
    )
  }

  return (
    <section>
      <div className="flex items-center justify-between mb-4 flex-wrap gap-3">
        <h2 className="font-display font-semibold text-text1">TDS Ledger</h2>
        <div className="flex items-center gap-3 flex-wrap">
          <DateInput label="From" value={from} onChange={setFrom} />
          <DateInput label="To" value={to} onChange={setTo} />
          <ExportButton onClick={exportCsv} disabled={!data || data.deductions.length === 0} />
        </div>
      </div>

      {query.isLoading && <LoadingState />}
      {query.isError && <ErrorState />}

      {data && (
        <>
          {sections.length > 0 && (
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-5">
              {sections.map(([section, amount]) => (
                <div key={section} className="rounded-lg border border-border bg-card p-4">
                  <p className="text-xs text-text3 uppercase tracking-wide mb-1.5">{section}</p>
                  <p className="font-mono text-lg font-semibold text-text1">{inr(amount)}</p>
                </div>
              ))}
            </div>
          )}

          {data.deductions.length === 0 ? (
            <EmptyState message="No TDS deductions recorded in this range." />
          ) : (
            <>
              <div className="rounded-lg border border-border bg-card overflow-hidden overflow-x-auto mb-4">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border bg-bg text-left text-[11px] uppercase tracking-wide text-text3">
                      <th className="px-4 py-2.5 font-medium">Vendor</th>
                      <th className="px-4 py-2.5 font-medium">PAN/GSTIN</th>
                      <th className="px-4 py-2.5 font-medium">Bill No</th>
                      <th className="px-4 py-2.5 font-medium">Bill Date</th>
                      <th className="px-4 py-2.5 font-medium">Section</th>
                      <th className="px-4 py-2.5 font-medium text-right">Rate</th>
                      <th className="px-4 py-2.5 font-medium text-right">Taxable Value</th>
                      <th className="px-4 py-2.5 font-medium text-right">TDS Amount</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.deductions.map((d, i) => (
                      <tr key={`${d.bill_no ?? 'no-bill-no'}-${i}`} className="border-b border-border last:border-0">
                        <td className="px-4 py-2 text-text1">{d.vendor_name}</td>
                        <td className="px-4 py-2 font-mono text-text2">{d.vendor_pan_or_gstin ?? '-'}</td>
                        <td className="px-4 py-2 font-mono text-text2">{d.bill_no ?? '-'}</td>
                        <td className="px-4 py-2 font-mono text-text2">{fmtDate(d.bill_date)}</td>
                        <td className="px-4 py-2 font-mono text-text2">{d.tds_section}</td>
                        <td className="px-4 py-2 font-mono text-right text-text2">{d.tds_rate}%</td>
                        <td className="px-4 py-2 font-mono text-right text-text1">{inr(d.taxable_value)}</td>
                        <td className="px-4 py-2 font-mono text-right text-text1">{inr(d.tds_amount)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="rounded-lg border border-border bg-card p-4 flex items-center justify-between">
                <span className="text-xs uppercase tracking-wide text-text3">Total TDS</span>
                <span className="font-mono text-lg font-semibold text-text1">{inr(data.total_tds)}</span>
              </div>
            </>
          )}
        </>
      )}
    </section>
  )
}
