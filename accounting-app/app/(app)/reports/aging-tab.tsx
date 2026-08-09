'use client'

import { useQuery } from '@tanstack/react-query'
import { cbopFetch } from '../../lib/api-client'
import { inr } from '../../lib/format'
import { downloadCsv } from './csv'
import { ErrorState, ExportButton, LoadingState } from './shared'
import type { AgingResponse } from './types'

// Shared AR/AP aging view - same 4-bucket stat-card layout as the Invoices
// page's client-side AR aging strip (app/(app)/invoices/page.tsx AgingCard),
// reused here for visual consistency, but backed by the server-side
// /reports/ar-aging and /reports/ap-aging endpoints instead of a client-side
// computation over the invoice list.
export function AgingTab({ companyId, kind }: { companyId: string; kind: 'ar' | 'ap' }) {
  const label = kind === 'ar' ? 'AR Aging' : 'AP Aging'
  const path = kind === 'ar' ? 'ar-aging' : 'ap-aging'
  const subject = kind === 'ar' ? 'receivable' : 'payable'

  const query = useQuery({
    queryKey: ['acct-report', path, companyId],
    queryFn: () =>
      cbopFetch<AgingResponse>(`/api/accounting/reports/${path}?company_id=${companyId}`, {
        activeCompanyId: companyId,
      }),
  })

  const data = query.data

  function exportCsv() {
    if (!data) return
    downloadCsv(
      `${path}-${companyId}.csv`,
      ['Bucket', 'Amount'],
      [
        ['Current', data.buckets.current],
        ['1-30 days overdue', data.buckets.d1_30],
        ['31-60 days overdue', data.buckets.d31_60],
        ['60+ days overdue', data.buckets.d60_plus],
        ['Total Outstanding', data.total_outstanding],
      ]
    )
  }

  return (
    <section>
      <div className="flex items-center justify-between mb-4 flex-wrap gap-3">
        <h2 className="font-display font-semibold text-text1">{label}</h2>
        <ExportButton onClick={exportCsv} disabled={!data} />
      </div>

      {query.isLoading && <LoadingState />}
      {query.isError && <ErrorState />}

      {data && (
        <>
          <div className="grid grid-cols-4 gap-3 mb-5">
            <AgingCard label="Current" amount={data.buckets.current} accent="blue" />
            <AgingCard label="1-30 days overdue" amount={data.buckets.d1_30} accent="amber" />
            <AgingCard label="31-60 days overdue" amount={data.buckets.d31_60} accent="amber" />
            <AgingCard label="60+ days overdue" amount={data.buckets.d60_plus} accent="red" />
          </div>
          <div className="rounded-lg border border-border bg-card p-4 flex items-center justify-between">
            <span className="text-xs uppercase tracking-wide text-text3">
              Total {subject === 'receivable' ? 'Receivable' : 'Payable'}
            </span>
            <span className="font-mono text-lg font-semibold text-text1">{inr(data.total_outstanding)}</span>
          </div>
        </>
      )}
    </section>
  )
}

function AgingCard({ label, amount, accent }: { label: string; amount: number; accent: 'blue' | 'amber' | 'red' }) {
  const accentClass = { blue: 'text-blue', amber: 'text-amber', red: 'text-red' }[accent]
  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <p className="text-xs text-text3 uppercase tracking-wide mb-1.5">{label}</p>
      <p className={`font-mono text-lg font-semibold ${accentClass}`}>{inr(amount)}</p>
    </div>
  )
}
