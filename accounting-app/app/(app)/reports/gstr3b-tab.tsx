'use client'

import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { cbopFetch } from '../../lib/api-client'
import { inr } from '../../lib/format'
import { DateInput, ErrorState, LoadingState } from './shared'
import type { Gstr3bResponse } from './types'

// GSTR-3B-shaped summary: Table 3.1 outward taxable supplies only, backed by
// GET /api/accounting/reports/gstr3b. Deliberately no ITC (Table 4) figure -
// that comes from GSTR-2B on the supplier side, outside CBOP's data, per the
// software-vs-CA division of labor in ACCOUNTING_Build_Plan.md. The `note`
// field from the API explains this and must stay visible, not buried.
export function Gstr3bTab({ companyId }: { companyId: string }) {
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')

  const query = useQuery({
    queryKey: ['acct-report-gstr3b', companyId, from, to],
    queryFn: () => {
      const params = new URLSearchParams({ company_id: companyId })
      if (from) params.set('from', from)
      if (to) params.set('to', to)
      return cbopFetch<Gstr3bResponse>(`/api/accounting/reports/gstr3b?${params.toString()}`, {
        activeCompanyId: companyId,
      })
    },
  })

  const data = query.data

  return (
    <section>
      <div className="flex items-center justify-between mb-4 flex-wrap gap-3">
        <h2 className="font-display font-semibold text-text1">GSTR-3B</h2>
        <div className="flex items-center gap-3 flex-wrap">
          <DateInput label="From" value={from} onChange={setFrom} />
          <DateInput label="To" value={to} onChange={setTo} />
        </div>
      </div>

      {query.isLoading && <LoadingState />}
      {query.isError && <ErrorState />}

      {data && (
        <>
          <p className="text-xs text-text3 uppercase tracking-wide mb-2">Outward Taxable Supplies</p>
          <div className="rounded-lg border border-border bg-card p-5 grid grid-cols-2 sm:grid-cols-5 gap-4 mb-4">
            <Stat label="Taxable Value" amount={data.outward_taxable_supplies.taxable_value} />
            <Stat label="CGST" amount={data.outward_taxable_supplies.cgst} />
            <Stat label="SGST" amount={data.outward_taxable_supplies.sgst} />
            <Stat label="IGST" amount={data.outward_taxable_supplies.igst} />
            <Stat label="Cess" amount={data.outward_taxable_supplies.cess} />
          </div>
          <div className="rounded-lg border border-blue/30 bg-blue/10 px-4 py-3 text-sm text-text1">
            {data.note}
          </div>
        </>
      )}
    </section>
  )
}

function Stat({ label, amount }: { label: string; amount: number }) {
  return (
    <div>
      <p className="text-xs text-text3 uppercase tracking-wide mb-1.5">{label}</p>
      <p className="font-mono text-lg font-semibold text-text1">{inr(amount)}</p>
    </div>
  )
}
