'use client'

import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { cbopFetch } from '../../lib/api-client'
import { inr } from '../../lib/format'
import { downloadCsv } from './csv'
import { EmptyState, ErrorState, ExportButton, LoadingState } from './shared'
import type { CustomerBalance, CustomerBalancesResponse, VendorBalance, VendorBalancesResponse } from './types'

type Row = CustomerBalance | VendorBalance

// Shared Customer/Vendor balances view - same shape (name, outstanding,
// paid_total), just a different label column and source endpoint.
export function BalancesTab({ companyId, kind }: { companyId: string; kind: 'customer' | 'vendor' }) {
  const [filterText, setFilterText] = useState('')
  const isCustomer = kind === 'customer'
  const label = isCustomer ? 'Customer Balances' : 'Vendor Balances'
  const path = isCustomer ? 'customer-balances' : 'vendor-balances'

  const query = useQuery({
    queryKey: ['acct-report', path, companyId],
    queryFn: () =>
      cbopFetch<CustomerBalancesResponse | VendorBalancesResponse>(
        `/api/accounting/reports/${path}?company_id=${companyId}`,
        { activeCompanyId: companyId }
      ),
  })

  function nameOf(r: Row): string {
    return isCustomer ? (r as CustomerBalance).client_name : (r as VendorBalance).vendor_name
  }

  const rows = useMemo((): Row[] => {
    if (!query.data) return []
    return isCustomer ? (query.data as CustomerBalancesResponse).customers : (query.data as VendorBalancesResponse).vendors
  }, [query.data, isCustomer])

  const filtered = useMemo(() => {
    const q = filterText.trim().toLowerCase()
    if (!q) return rows
    return rows.filter((r) => nameOf(r).toLowerCase().includes(q))
    // nameOf only depends on isCustomer, already tracked via `rows` recomputing on the same dep -
    // omitting it here avoids a new function identity forcing a re-filter every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, filterText])

  const totalOutstanding = filtered.reduce((s, r) => s + Number(r.outstanding), 0)

  function exportCsv() {
    downloadCsv(
      `${path}-${companyId}.csv`,
      [isCustomer ? 'Client' : 'Vendor', 'Outstanding', 'Paid Total'],
      filtered.map((r) => [nameOf(r), r.outstanding, r.paid_total])
    )
  }

  return (
    <section>
      <div className="flex items-center justify-between mb-4 flex-wrap gap-3">
        <h2 className="font-display font-semibold text-text1">{label}</h2>
        <div className="flex items-center gap-3">
          <input
            value={filterText}
            onChange={(e) => setFilterText(e.target.value)}
            placeholder={`Filter by ${isCustomer ? 'client' : 'vendor'} name...`}
            className="h-9 w-64 rounded-md border border-border bg-white px-3 text-sm text-text1 focus:outline-none focus:border-blue placeholder:text-text3"
          />
          <ExportButton onClick={exportCsv} disabled={filtered.length === 0} />
        </div>
      </div>

      {query.isLoading && <LoadingState />}
      {query.isError && <ErrorState />}
      {query.data && rows.length === 0 && (
        <EmptyState message={`No outstanding ${isCustomer ? 'customer' : 'vendor'} balances.`} />
      )}
      {query.data && rows.length > 0 && filtered.length === 0 && <EmptyState message="No rows match this filter." />}

      {filtered.length > 0 && (
        <div className="rounded-lg border border-border bg-card overflow-hidden overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-bg text-left text-[11px] uppercase tracking-wide text-text3">
                <th className="px-4 py-2.5 font-medium">{isCustomer ? 'Client' : 'Vendor'}</th>
                <th className="px-4 py-2.5 font-medium text-right">Outstanding</th>
                <th className="px-4 py-2.5 font-medium text-right">Paid Total</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((r, i) => (
                <tr key={i} className="border-b border-border last:border-0">
                  <td className="px-4 py-2 text-text1">{nameOf(r)}</td>
                  <td className="px-4 py-2 text-right font-mono text-text1">{inr(r.outstanding)}</td>
                  <td className="px-4 py-2 text-right font-mono text-text2">{inr(r.paid_total)}</td>
                </tr>
              ))}
              <tr className="border-t-2 border-border bg-bg font-semibold">
                <td className="px-4 py-2.5">Total</td>
                <td className="px-4 py-2.5 text-right font-mono text-text1">{inr(totalOutstanding)}</td>
                <td className="px-4 py-2.5"></td>
              </tr>
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}
