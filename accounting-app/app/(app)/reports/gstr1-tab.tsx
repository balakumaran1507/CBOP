'use client'

import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { cbopFetch } from '../../lib/api-client'
import { inr, fmtDate } from '../../lib/format'
import { downloadCsv } from './csv'
import { DateInput, EmptyState, ErrorState, ExportButton, LoadingState } from './shared'
import type { Gstr1Response } from './types'

// GSTR-1-shaped export: invoice-level B2B table + HSN/SAC summary, backed by
// GET /api/accounting/reports/gstr1 (api/routes/accounting.ts, Slice 6). Export
// only - CBOP never files this, see docs/modules/ACCOUNTING_Build_Plan.md.
export function Gstr1Tab({ companyId }: { companyId: string }) {
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')

  const query = useQuery({
    queryKey: ['acct-report-gstr1', companyId, from, to],
    queryFn: () => {
      const params = new URLSearchParams({ company_id: companyId })
      if (from) params.set('from', from)
      if (to) params.set('to', to)
      return cbopFetch<Gstr1Response>(`/api/accounting/reports/gstr1?${params.toString()}`, {
        activeCompanyId: companyId,
      })
    },
  })

  const data = query.data

  function exportCsv() {
    if (!data) return
    downloadCsv(
      `gstr1-b2b-${from || 'all'}-to-${to || 'today'}.csv`,
      ['Invoice No', 'Date', 'GSTIN', 'HSN/SAC', 'Taxable Value', 'CGST', 'SGST', 'IGST', 'Cess', 'Invoice Value'],
      data.b2b_invoices.map((inv) => [
        inv.invoice_no,
        inv.invoice_date,
        inv.counterparty_gstin ?? '',
        inv.hsn_sac_code ?? '',
        inv.taxable_value,
        inv.cgst_amount,
        inv.sgst_amount,
        inv.igst_amount,
        inv.cess_amount,
        inv.invoice_value,
      ])
    )
  }

  return (
    <section>
      <div className="flex items-center justify-between mb-4 flex-wrap gap-3">
        <h2 className="font-display font-semibold text-text1">GSTR-1</h2>
        <div className="flex items-center gap-3 flex-wrap">
          <DateInput label="From" value={from} onChange={setFrom} />
          <DateInput label="To" value={to} onChange={setTo} />
          <ExportButton onClick={exportCsv} disabled={!data || data.b2b_invoices.length === 0} />
        </div>
      </div>

      {query.isLoading && <LoadingState />}
      {query.isError && <ErrorState />}

      {data && (
        <>
          <h3 className="text-[11px] font-semibold uppercase tracking-wide text-text3 mb-2">B2B Invoices</h3>
          {data.b2b_invoices.length === 0 ? (
            <EmptyState message="No GST-tagged invoices in this range." />
          ) : (
            <div className="rounded-lg border border-border bg-card overflow-hidden overflow-x-auto mb-6">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border bg-bg text-left text-[11px] uppercase tracking-wide text-text3">
                    <th className="px-4 py-2.5 font-medium">Invoice No</th>
                    <th className="px-4 py-2.5 font-medium">Date</th>
                    <th className="px-4 py-2.5 font-medium">GSTIN</th>
                    <th className="px-4 py-2.5 font-medium">HSN/SAC</th>
                    <th className="px-4 py-2.5 font-medium text-right">Taxable Value</th>
                    <th className="px-4 py-2.5 font-medium text-right">CGST</th>
                    <th className="px-4 py-2.5 font-medium text-right">SGST</th>
                    <th className="px-4 py-2.5 font-medium text-right">IGST</th>
                    <th className="px-4 py-2.5 font-medium text-right">Invoice Value</th>
                  </tr>
                </thead>
                <tbody>
                  {data.b2b_invoices.map((inv, i) => (
                    <tr key={`${inv.invoice_no}-${i}`} className="border-b border-border last:border-0">
                      <td className="px-4 py-2 font-mono text-text1">{inv.invoice_no}</td>
                      <td className="px-4 py-2 font-mono text-text2">{fmtDate(inv.invoice_date)}</td>
                      <td className="px-4 py-2 font-mono text-text2">{inv.counterparty_gstin ?? '-'}</td>
                      <td className="px-4 py-2 font-mono text-text2">{inv.hsn_sac_code ?? '-'}</td>
                      <td className="px-4 py-2 font-mono text-right text-text1">{inr(inv.taxable_value)}</td>
                      <td className="px-4 py-2 font-mono text-right text-text1">{inr(inv.cgst_amount)}</td>
                      <td className="px-4 py-2 font-mono text-right text-text1">{inr(inv.sgst_amount)}</td>
                      <td className="px-4 py-2 font-mono text-right text-text1">{inr(inv.igst_amount)}</td>
                      <td className="px-4 py-2 font-mono text-right text-text1 font-medium">{inr(inv.invoice_value)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <h3 className="text-[11px] font-semibold uppercase tracking-wide text-text3 mb-2">HSN/SAC Summary</h3>
          {data.hsn_summary.length === 0 ? (
            <EmptyState message="No HSN/SAC codes recorded in this range." />
          ) : (
            <div className="rounded-lg border border-border bg-card overflow-hidden overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border bg-bg text-left text-[11px] uppercase tracking-wide text-text3">
                    <th className="px-4 py-2.5 font-medium">HSN/SAC</th>
                    <th className="px-4 py-2.5 font-medium text-right">Invoices</th>
                    <th className="px-4 py-2.5 font-medium text-right">Taxable Value</th>
                    <th className="px-4 py-2.5 font-medium text-right">CGST</th>
                    <th className="px-4 py-2.5 font-medium text-right">SGST</th>
                    <th className="px-4 py-2.5 font-medium text-right">IGST</th>
                  </tr>
                </thead>
                <tbody>
                  {data.hsn_summary.map((h) => (
                    <tr key={h.hsn_sac_code} className="border-b border-border last:border-0">
                      <td className="px-4 py-2 font-mono text-text1">{h.hsn_sac_code}</td>
                      <td className="px-4 py-2 font-mono text-right text-text2">{h.invoice_count}</td>
                      <td className="px-4 py-2 font-mono text-right text-text1">{inr(h.taxable_value)}</td>
                      <td className="px-4 py-2 font-mono text-right text-text1">{inr(h.cgst_amount)}</td>
                      <td className="px-4 py-2 font-mono text-right text-text1">{inr(h.sgst_amount)}</td>
                      <td className="px-4 py-2 font-mono text-right text-text1">{inr(h.igst_amount)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </section>
  )
}
