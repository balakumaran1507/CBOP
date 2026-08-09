'use client'

import { useEffect, useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useCbopSession } from '../../lib/session-context'
import { cbopFetch, ApiError } from '../../lib/api-client'
import { inr, fmtDate, todayIso } from '../../lib/format'
import { SlideOver } from '../../components/slide-over'
import { StatusBadge } from '../../components/status-badge'

// AR (accounts receivable) view for the active company. Invoice CREATE stays
// on the main CBOP app's /sales page (deliberately not duplicated here, see
// docs/modules/ACCOUNTING_Build_Plan.md) — this page's job is reading the
// existing invoice list (GET /api/invoices?all=true, main app's endpoint) and
// recording payments through the NEW ledger-aware endpoint
// (POST /api/accounting/invoices/:id/record-payment) so a payment actually
// posts Dr bank / Cr Accounts Receivable instead of just flipping a status flag.

type InvoiceStatus = 'draft' | 'sent' | 'paid' | 'overdue'

interface Invoice {
  id: string
  invoice_no: string
  amount: string | number
  gst_type: string
  gst_amount: string | number
  total: string | number
  due_date: string | null
  paid_at: string | null
  status: InvoiceStatus
  created_at: string
  service_description: string | null
  notes: string | null
  deal_id: string | null
  client_id: string | null
  client_name: string | null
  client_org: string | null
  client_email: string | null
  client_phone: string | null
  company_name: string | null
  invoice_prefix: string | null
  deal_name: string | null
}

interface BankAccount {
  id: string
  account_code: string
  account_name: string
  account_subtype: string
  balance: string | number
}

// GST metadata (Slice 6) - acct_tax_details rows, doc_type='invoice'. See
// api/routes/accounting.ts's tax-details routes.
interface TaxDetail {
  id: string
  doc_type: 'invoice' | 'bill'
  doc_id: string
  counterparty_gstin: string | null
  hsn_sac_code: string | null
  taxable_value: string | number
  cgst_rate: string | number
  cgst_amount: string | number
  sgst_rate: string | number
  sgst_amount: string | number
  igst_rate: string | number
  igst_amount: string | number
  cess_amount: string | number
  tds_section: string | null
  tds_rate: string | number | null
  tds_amount: string | number
  created_at: string
}

// Common SAC codes for an IT/services business, per
// docs/modules/ACCOUNTING_Build_Plan.md - suggestions, not a rigid list (the
// real HSN/SAC list has thousands of codes).
const SAC_SUGGESTIONS: { code: string; label: string }[] = [
  { code: '998314', label: 'IT consulting and support services' },
  { code: '998313', label: 'IT design and development' },
  { code: '998599', label: 'Other professional/technical/business services' },
  { code: '997212', label: 'Software licensing services' },
]

type StatusFilter = 'all' | 'sent' | 'overdue' | 'paid'

const STATUS_TABS: { key: StatusFilter; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'sent', label: 'Sent' },
  { key: 'overdue', label: 'Overdue' },
  { key: 'paid', label: 'Paid' },
]

/** Days between an invoice's due_date and today. Positive = overdue, negative = not yet due. */
function daysPastDue(dueDate: string): number {
  const due = new Date(dueDate).getTime()
  const today = new Date(todayIso()).getTime()
  return Math.round((today - due) / 86_400_000)
}

function toNumber(n: string | number): number {
  return typeof n === 'string' ? parseFloat(n) : n
}

interface AgingBuckets {
  current: number
  d1to30: number
  d31to60: number
  d60plus: number
}

/** AR aging, computed client-side from due_date vs today — matches the old /accounting
 * page's bucket convention. Only invoices actually sent to a client (sent/overdue) count
 * as receivable; draft invoices haven't been billed yet and paid ones aren't outstanding. */
function computeAging(invoices: Invoice[]): AgingBuckets {
  const buckets: AgingBuckets = { current: 0, d1to30: 0, d31to60: 0, d60plus: 0 }
  for (const inv of invoices) {
    if (inv.status !== 'sent' && inv.status !== 'overdue') continue
    if (!inv.due_date) continue
    const total = toNumber(inv.total)
    const days = daysPastDue(inv.due_date)
    if (days <= 0) buckets.current += total
    else if (days <= 30) buckets.d1to30 += total
    else if (days <= 60) buckets.d31to60 += total
    else buckets.d60plus += total
  }
  return buckets
}

export default function InvoicesPage() {
  const session = useCbopSession()
  const queryClient = useQueryClient()

  const activeCompany = session.companies.find((c) => c.id === session.activeCompanyId)

  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all')
  const [search, setSearch] = useState('')
  const [selectedInvoice, setSelectedInvoice] = useState<Invoice | null>(null)
  const [bankAccountId, setBankAccountId] = useState('')
  const [paymentDate, setPaymentDate] = useState(todayIso())
  const [gstInvoice, setGstInvoice] = useState<Invoice | null>(null)

  const invoicesQuery = useQuery({
    queryKey: ['invoices'],
    queryFn: () => cbopFetch<{ invoices: Invoice[] }>('/api/invoices?all=true', { activeCompanyId: session.activeCompanyId }),
  })

  const bankAccountsQuery = useQuery({
    queryKey: ['bank-accounts', session.activeCompanyId],
    queryFn: () =>
      cbopFetch<{ accounts: BankAccount[] }>(`/api/accounting/bank-accounts?company_id=${session.activeCompanyId}`, {
        activeCompanyId: session.activeCompanyId,
      }),
    enabled: !!session.activeCompanyId,
  })

  const bankAccounts = bankAccountsQuery.data?.accounts ?? []
  const hasBankAccounts = bankAccounts.length > 0

  // Batch-fetch every invoice's GST tax details once per company instead of
  // N+1 requests per row - matched client-side by doc_id below.
  const invoiceTaxDetailsQuery = useQuery({
    queryKey: ['invoice-tax-details', session.activeCompanyId],
    queryFn: () =>
      cbopFetch<{ tax_details: TaxDetail[] }>(
        `/api/accounting/tax-details?company_id=${session.activeCompanyId}&doc_type=invoice`,
        { activeCompanyId: session.activeCompanyId }
      ),
    enabled: !!session.activeCompanyId,
  })

  const gstByInvoiceId = useMemo(() => {
    const map = new Map<string, TaxDetail>()
    // Rows come back ordered created_at DESC, so the first match per invoice
    // is the latest one.
    for (const td of invoiceTaxDetailsQuery.data?.tax_details ?? []) {
      if (!map.has(td.doc_id)) map.set(td.doc_id, td)
    }
    return map
  }, [invoiceTaxDetailsQuery.data])

  const recordPaymentMutation = useMutation({
    mutationFn: (vars: { invoiceId: string; bank_account_id: string; payment_date: string }) =>
      cbopFetch(`/api/accounting/invoices/${vars.invoiceId}/record-payment`, {
        method: 'POST',
        body: { bank_account_id: vars.bank_account_id, payment_date: vars.payment_date },
        activeCompanyId: session.activeCompanyId,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['invoices'] })
      setSelectedInvoice(null)
    },
  })

  // Scope to the active company, matching the rest of this app's pages — the
  // /api/invoices response spans every company the caller belongs to, so this
  // page narrows it down client-side rather than showing an all-companies rollup.
  const companyInvoices = useMemo(() => {
    const all = invoicesQuery.data?.invoices ?? []
    if (!activeCompany) return all
    return all.filter((inv) => inv.company_name === activeCompany.name)
  }, [invoicesQuery.data, activeCompany])

  const filteredInvoices = useMemo(() => {
    let rows = companyInvoices
    if (statusFilter !== 'all') rows = rows.filter((inv) => inv.status === statusFilter)
    const q = search.trim().toLowerCase()
    if (q) {
      rows = rows.filter(
        (inv) => inv.invoice_no.toLowerCase().includes(q) || (inv.client_name ?? '').toLowerCase().includes(q)
      )
    }
    return rows
  }, [companyInvoices, statusFilter, search])

  const aging = useMemo(() => computeAging(companyInvoices), [companyInvoices])

  const hasOutstanding = aging.current + aging.d1to30 + aging.d31to60 + aging.d60plus > 0
  const showNoBankAccountsBanner = !bankAccountsQuery.isLoading && !hasBankAccounts && hasOutstanding

  useEffect(() => {
    if (!selectedInvoice) return
    setBankAccountId(bankAccounts[0]?.id ?? '')
    setPaymentDate(todayIso())
    recordPaymentMutation.reset()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedInvoice])

  function openInvoice(inv: Invoice) {
    if (inv.status === 'draft') return
    if ((inv.status === 'sent' || inv.status === 'overdue') && !hasBankAccounts) return
    setSelectedInvoice(inv)
  }

  function closePanel() {
    setSelectedInvoice(null)
    recordPaymentMutation.reset()
  }

  function submitPayment() {
    if (!selectedInvoice || !bankAccountId) return
    recordPaymentMutation.mutate({ invoiceId: selectedInvoice.id, bank_account_id: bankAccountId, payment_date: paymentDate })
  }

  const isPayable = selectedInvoice && (selectedInvoice.status === 'sent' || selectedInvoice.status === 'overdue')
  const isPaid = selectedInvoice?.status === 'paid'

  return (
    <main className="p-6">
      <div className="flex items-baseline justify-between mb-1">
        <h1 className="font-display font-bold text-xl text-text1">Invoices</h1>
        {activeCompany && <span className="text-xs text-text3 font-mono">{activeCompany.name}</span>}
      </div>
      <p className="text-sm text-text2 mb-5">
        Accounts receivable. Invoice creation stays on the main CBOP app&apos;s Sales page — this view is for
        tracking what&apos;s outstanding and recording payments against the ledger.
      </p>

      {/* AR aging summary */}
      <div className="grid grid-cols-4 gap-3 mb-5">
        <AgingCard label="Current" amount={aging.current} accent="blue" />
        <AgingCard label="1-30 days overdue" amount={aging.d1to30} accent="amber" />
        <AgingCard label="31-60 days overdue" amount={aging.d31to60} accent="amber" />
        <AgingCard label="60+ days overdue" amount={aging.d60plus} accent="red" />
      </div>

      {showNoBankAccountsBanner && (
        <div className="mb-5 rounded-lg border border-amber/30 bg-amber/10 px-4 py-3 text-sm text-text1">
          No bank or cash accounts are set up for {activeCompany?.name ?? 'this company'} yet, so payments can&apos;t
          be recorded against the ledger. Go to{' '}
          <a href="/accounts" className="text-blue underline">
            Chart of Accounts
          </a>{' '}
          and seed the defaults first.
        </div>
      )}

      {/* Filters */}
      <div className="flex items-center justify-between mb-3 gap-3">
        <div className="flex gap-1 rounded-lg border border-border bg-card p-1">
          {STATUS_TABS.map((tab) => (
            <button
              key={tab.key}
              onClick={() => setStatusFilter(tab.key)}
              className={`px-3 py-1.5 rounded-md text-[13px] font-medium transition-colors ${
                statusFilter === tab.key ? 'bg-blue text-white' : 'text-text2 hover:bg-bg'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
        <input
          type="text"
          placeholder="Filter by invoice no. or client..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-64 h-9 rounded-md border border-border bg-card px-3 text-sm text-text1 placeholder:text-text3 focus:outline-none focus:ring-1 focus:ring-blue"
        />
      </div>

      {/* Table */}
      <div className="rounded-lg border border-border bg-card overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border bg-bg text-left text-[11px] uppercase tracking-wide text-text3">
              <th className="px-4 py-2.5 font-medium">Invoice</th>
              <th className="px-4 py-2.5 font-medium">Client</th>
              <th className="px-4 py-2.5 font-medium text-right">Total</th>
              <th className="px-4 py-2.5 font-medium">Due Date</th>
              <th className="px-4 py-2.5 font-medium">Status</th>
              <th className="px-4 py-2.5 font-medium">Aging</th>
              <th className="px-4 py-2.5 font-medium">GST</th>
              <th className="px-4 py-2.5 font-medium text-right">Action</th>
            </tr>
          </thead>
          <tbody>
            {invoicesQuery.isLoading && (
              <tr>
                <td colSpan={8} className="px-4 py-10 text-center text-text3">
                  Loading invoices...
                </td>
              </tr>
            )}
            {invoicesQuery.isError && (
              <tr>
                <td colSpan={8} className="px-4 py-10 text-center text-red">
                  {invoicesQuery.error instanceof ApiError ? invoicesQuery.error.message : 'Failed to load invoices.'}
                </td>
              </tr>
            )}
            {!invoicesQuery.isLoading && !invoicesQuery.isError && filteredInvoices.length === 0 && (
              <tr>
                <td colSpan={8} className="px-4 py-10 text-center text-text3">
                  No invoices match this filter.
                </td>
              </tr>
            )}
            {filteredInvoices.map((inv) => (
              <InvoiceRow
                key={inv.id}
                invoice={inv}
                hasBankAccounts={hasBankAccounts}
                taxDetail={gstByInvoiceId.get(inv.id)}
                onOpen={() => openInvoice(inv)}
                onOpenGst={() => setGstInvoice(inv)}
              />
            ))}
          </tbody>
        </table>
      </div>

      {/* Payment / detail slide-over */}
      <SlideOver
        isOpen={!!selectedInvoice}
        onClose={closePanel}
        title={isPaid ? 'Invoice Payment' : 'Record Payment'}
        width="sm"
      >
        {selectedInvoice && (
          <div className="flex-1 overflow-auto px-6 py-5 flex flex-col gap-4">
            <div className="rounded-lg border border-border bg-bg p-3">
              <p className="font-mono text-sm text-text1">{selectedInvoice.invoice_no}</p>
              <p className="text-sm text-text2 mt-0.5">{selectedInvoice.client_name ?? 'Unknown client'}</p>
              <p className="font-mono text-lg text-text1 mt-2">{inr(selectedInvoice.total)}</p>
            </div>

            {isPaid ? (
              <div className="text-sm text-text2">
                <p>
                  Paid on{' '}
                  <span className="font-mono text-text1">
                    {selectedInvoice.paid_at ? fmtDate(selectedInvoice.paid_at) : 'unknown date'}
                  </span>
                  .
                </p>
              </div>
            ) : isPayable ? (
              <>
                <div>
                  <label className="block text-xs font-medium text-text2 mb-1">Deposit to</label>
                  <select
                    value={bankAccountId}
                    onChange={(e) => setBankAccountId(e.target.value)}
                    className="w-full h-9 rounded-md border border-border bg-card px-2.5 text-sm text-text1 focus:outline-none focus:ring-1 focus:ring-blue"
                  >
                    {bankAccounts.map((acct) => (
                      <option key={acct.id} value={acct.id}>
                        {acct.account_code} — {acct.account_name}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-text2 mb-1">Payment date</label>
                  <input
                    type="date"
                    value={paymentDate}
                    onChange={(e) => setPaymentDate(e.target.value)}
                    className="w-full h-9 rounded-md border border-border bg-card px-2.5 text-sm font-mono text-text1 focus:outline-none focus:ring-1 focus:ring-blue"
                  />
                </div>
                {recordPaymentMutation.isError && (
                  <p className="text-sm text-red">
                    {recordPaymentMutation.error instanceof ApiError
                      ? recordPaymentMutation.error.message
                      : 'Failed to record payment.'}
                  </p>
                )}
              </>
            ) : null}
          </div>
        )}

        {selectedInvoice && isPayable && (
          <div className="flex gap-3 px-6 py-4 border-t border-border shrink-0">
            <button
              onClick={closePanel}
              className="flex-1 h-9 rounded-md border border-border text-sm font-medium text-text2 hover:bg-bg"
            >
              Cancel
            </button>
            <button
              onClick={submitPayment}
              disabled={!bankAccountId || recordPaymentMutation.isPending}
              className="flex-1 h-9 rounded-md bg-blue text-sm font-medium text-white hover:bg-blue/90 disabled:opacity-50"
            >
              {recordPaymentMutation.isPending ? 'Recording...' : 'Record Payment'}
            </button>
          </div>
        )}
      </SlideOver>

      <GstDetailsSlideOver
        invoice={gstInvoice}
        onClose={() => setGstInvoice(null)}
        companyId={session.activeCompanyId}
        existing={gstInvoice ? gstByInvoiceId.get(gstInvoice.id) : undefined}
        onSaved={() => queryClient.invalidateQueries({ queryKey: ['invoice-tax-details', session.activeCompanyId] })}
      />
    </main>
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

function InvoiceRow({
  invoice,
  hasBankAccounts,
  taxDetail,
  onOpen,
  onOpenGst,
}: {
  invoice: Invoice
  hasBankAccounts: boolean
  taxDetail: TaxDetail | undefined
  onOpen: () => void
  onOpenGst: () => void
}) {
  const clickable =
    invoice.status === 'paid' || ((invoice.status === 'sent' || invoice.status === 'overdue') && hasBankAccounts)

  return (
    <tr
      onClick={clickable ? onOpen : undefined}
      className={`border-b border-border last:border-0 ${clickable ? 'cursor-pointer hover:bg-bg' : ''}`}
    >
      <td className="px-4 py-3 font-mono text-text1">{invoice.invoice_no}</td>
      <td className="px-4 py-3">
        <p className="text-text1">{invoice.client_name ?? 'Unknown'}</p>
        {invoice.client_org && <p className="text-xs text-text3">{invoice.client_org}</p>}
      </td>
      <td className="px-4 py-3 font-mono text-right text-text1">{inr(invoice.total)}</td>
      <td className="px-4 py-3 font-mono text-text2">{invoice.due_date ? fmtDate(invoice.due_date) : '-'}</td>
      <td className="px-4 py-3">
        <StatusBadge status={invoice.status} />
      </td>
      <td className="px-4 py-3">
        <AgingCell invoice={invoice} />
      </td>
      <td className="px-4 py-3">
        <GstCell taxDetail={taxDetail} onOpen={onOpenGst} />
      </td>
      <td className="px-4 py-3 text-right">
        <RowAction invoice={invoice} hasBankAccounts={hasBankAccounts} />
      </td>
    </tr>
  )
}

function GstCell({ taxDetail, onOpen }: { taxDetail: TaxDetail | undefined; onOpen: () => void }) {
  function handleClick(e: React.MouseEvent) {
    e.stopPropagation()
    onOpen()
  }

  if (!taxDetail) {
    return (
      <button onClick={handleClick} className="text-xs font-medium text-blue hover:underline">
        Add GST Details
      </button>
    )
  }
  const taxAmt = Number(taxDetail.cgst_amount) + Number(taxDetail.sgst_amount) + Number(taxDetail.igst_amount)
  return (
    <button onClick={handleClick} className="text-xs font-mono text-text2 hover:text-blue hover:underline">
      {taxDetail.hsn_sac_code ?? '-'} &middot; {inr(taxAmt)}
    </button>
  )
}

function AgingCell({ invoice }: { invoice: Invoice }) {
  if (invoice.status === 'paid') {
    return <span className="text-xs text-green">Paid</span>
  }
  if (invoice.status === 'draft' || !invoice.due_date) {
    return <span className="text-xs text-text3">-</span>
  }
  const days = daysPastDue(invoice.due_date)
  if (days > 0) {
    return <span className="text-xs font-mono text-red">{days}d overdue</span>
  }
  if (days >= -7) {
    return <span className="text-xs font-mono text-amber">Due in {-days}d</span>
  }
  return <span className="text-xs font-mono text-text2">Due in {-days}d</span>
}

function RowAction({ invoice, hasBankAccounts }: { invoice: Invoice; hasBankAccounts: boolean }) {
  if (invoice.status === 'draft') {
    return <span className="text-xs text-text3">Not sent</span>
  }
  if (invoice.status === 'paid') {
    return <span className="text-xs text-blue">View</span>
  }
  // sent or overdue
  if (!hasBankAccounts) {
    return <span className="text-xs text-text3">No bank account set up</span>
  }
  return <span className="text-xs font-medium text-blue">Record Payment</span>
}

// ── GST details ──────────────────────────────────────────────────────────────
// tax_details is create-only from the UI's perspective (no PATCH/DELETE on
// the API) - if a GSTIN/rate was entered wrong, the fix is to add a new
// record, not edit the old one. So this panel shows the latest existing
// record (if any) plus the form to add another.

function GstDetailsSlideOver({
  invoice,
  onClose,
  companyId,
  existing,
  onSaved,
}: {
  invoice: Invoice | null
  onClose: () => void
  companyId: string | null
  existing: TaxDetail | undefined
  onSaved: () => void
}) {
  const [gstin, setGstin] = useState('')
  const [hsnSac, setHsnSac] = useState('')
  const [taxableValue, setTaxableValue] = useState('')
  const [supplyType, setSupplyType] = useState<'intra' | 'inter'>('intra')
  const [cgstRate, setCgstRate] = useState('9')
  const [sgstRate, setSgstRate] = useState('9')
  const [igstRate, setIgstRate] = useState('18')
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!invoice) return
    setGstin('')
    setHsnSac('')
    setTaxableValue(String(toNumber(invoice.amount)))
    setSupplyType('intra')
    setCgstRate('9')
    setSgstRate('9')
    setIgstRate('18')
    setError(null)
  }, [invoice])

  const createMutation = useMutation({
    mutationFn: () =>
      cbopFetch('/api/accounting/tax-details', {
        method: 'POST',
        activeCompanyId: companyId,
        body: {
          company_id: companyId,
          doc_type: 'invoice',
          doc_id: invoice?.id,
          counterparty_gstin: gstin || undefined,
          hsn_sac_code: hsnSac || undefined,
          taxable_value: taxableValue,
          cgst_rate: supplyType === 'intra' ? cgstRate || 0 : undefined,
          sgst_rate: supplyType === 'intra' ? sgstRate || 0 : undefined,
          igst_rate: supplyType === 'inter' ? igstRate || 0 : undefined,
        },
      }),
    onSuccess: () => {
      onSaved()
      onClose()
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : 'Failed to save GST details'),
  })

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    const tv = parseFloat(taxableValue)
    if (isNaN(tv) || tv < 0) return setError('Taxable value must be a non-negative number')
    createMutation.mutate()
  }

  return (
    <SlideOver isOpen={!!invoice} onClose={onClose} title="GST Details" width="sm">
      <form onSubmit={handleSubmit} className="flex flex-1 flex-col overflow-hidden">
        <div className="flex-1 overflow-auto px-6 py-5 flex flex-col gap-4">
          {invoice && (
            <div className="rounded-lg border border-border bg-bg p-3">
              <p className="font-mono text-sm text-text1">{invoice.invoice_no}</p>
              <p className="text-sm text-text2 mt-0.5">{invoice.client_name ?? 'Unknown client'}</p>
            </div>
          )}

          {existing && (
            <div className="rounded-md bg-green/10 px-3 py-2.5 text-sm">
              <p className="font-medium text-green mb-1.5">Existing GST detail on file</p>
              <dl className="grid grid-cols-2 gap-y-1 text-xs">
                <dt className="text-text2">GSTIN</dt>
                <dd className="font-mono text-text1 text-right">{existing.counterparty_gstin ?? '-'}</dd>
                <dt className="text-text2">HSN/SAC</dt>
                <dd className="font-mono text-text1 text-right">{existing.hsn_sac_code ?? '-'}</dd>
                <dt className="text-text2">Taxable value</dt>
                <dd className="font-mono text-text1 text-right">{inr(existing.taxable_value)}</dd>
                <dt className="text-text2">CGST</dt>
                <dd className="font-mono text-text1 text-right">
                  {inr(existing.cgst_amount)} ({existing.cgst_rate}%)
                </dd>
                <dt className="text-text2">SGST</dt>
                <dd className="font-mono text-text1 text-right">
                  {inr(existing.sgst_amount)} ({existing.sgst_rate}%)
                </dd>
                <dt className="text-text2">IGST</dt>
                <dd className="font-mono text-text1 text-right">
                  {inr(existing.igst_amount)} ({existing.igst_rate}%)
                </dd>
                <dt className="text-text2 font-medium">Total</dt>
                <dd className="font-mono text-text1 text-right font-medium">
                  {inr(
                    Number(existing.taxable_value) +
                      Number(existing.cgst_amount) +
                      Number(existing.sgst_amount) +
                      Number(existing.igst_amount)
                  )}
                </dd>
              </dl>
              <p className="text-[11px] text-text3 mt-2">
                Tax details are create-only. Saving below adds another record rather than editing this one.
              </p>
            </div>
          )}

          {error && <p className="text-sm text-red">{error}</p>}

          <label className="flex flex-col gap-1">
            <span className="text-xs font-medium text-text2">Counterparty GSTIN</span>
            <input
              value={gstin}
              onChange={(e) => setGstin(e.target.value.toUpperCase())}
              placeholder="22AAAAA0000A1Z5"
              className="h-9 rounded-md border border-border px-3 text-sm font-mono text-text1 focus:outline-none focus:ring-1 focus:ring-blue"
            />
          </label>

          <label className="flex flex-col gap-1">
            <span className="text-xs font-medium text-text2">HSN/SAC code</span>
            <input
              value={hsnSac}
              onChange={(e) => setHsnSac(e.target.value)}
              placeholder="e.g. 998314"
              className="h-9 rounded-md border border-border px-3 text-sm font-mono text-text1 focus:outline-none focus:ring-1 focus:ring-blue"
            />
            <div className="flex flex-wrap gap-1.5 mt-1">
              {SAC_SUGGESTIONS.map((s) => (
                <button
                  key={s.code}
                  type="button"
                  onClick={() => setHsnSac(s.code)}
                  title={s.label}
                  className="rounded-full border border-border px-2 py-1 text-[11px] font-mono text-text2 hover:bg-bg hover:text-text1"
                >
                  {s.code}
                </button>
              ))}
            </div>
          </label>

          <label className="flex flex-col gap-1">
            <span className="text-xs font-medium text-text2">Taxable value</span>
            <input
              type="number"
              step="0.01"
              min="0"
              value={taxableValue}
              onChange={(e) => setTaxableValue(e.target.value)}
              className="h-9 rounded-md border border-border px-3 text-sm font-mono text-text1 focus:outline-none focus:ring-1 focus:ring-blue"
              required
            />
          </label>

          <div className="flex gap-1 rounded-lg border border-border bg-bg p-1">
            <button
              type="button"
              onClick={() => setSupplyType('intra')}
              className={`flex-1 rounded-md px-2 py-1.5 text-[13px] font-medium transition-colors ${
                supplyType === 'intra' ? 'bg-blue text-white' : 'text-text2 hover:bg-card'
              }`}
            >
              Same state (CGST+SGST)
            </button>
            <button
              type="button"
              onClick={() => setSupplyType('inter')}
              className={`flex-1 rounded-md px-2 py-1.5 text-[13px] font-medium transition-colors ${
                supplyType === 'inter' ? 'bg-blue text-white' : 'text-text2 hover:bg-card'
              }`}
            >
              Different state (IGST)
            </button>
          </div>

          {supplyType === 'intra' ? (
            <div className="grid grid-cols-2 gap-3">
              <label className="flex flex-col gap-1">
                <span className="text-xs font-medium text-text2">CGST rate (%)</span>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  value={cgstRate}
                  onChange={(e) => setCgstRate(e.target.value)}
                  className="h-9 rounded-md border border-border px-3 text-sm font-mono text-text1 focus:outline-none focus:ring-1 focus:ring-blue"
                />
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-xs font-medium text-text2">SGST rate (%)</span>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  value={sgstRate}
                  onChange={(e) => setSgstRate(e.target.value)}
                  className="h-9 rounded-md border border-border px-3 text-sm font-mono text-text1 focus:outline-none focus:ring-1 focus:ring-blue"
                />
              </label>
            </div>
          ) : (
            <label className="flex flex-col gap-1">
              <span className="text-xs font-medium text-text2">IGST rate (%)</span>
              <input
                type="number"
                step="0.01"
                min="0"
                value={igstRate}
                onChange={(e) => setIgstRate(e.target.value)}
                className="h-9 rounded-md border border-border px-3 text-sm font-mono text-text1 focus:outline-none focus:ring-1 focus:ring-blue"
              />
            </label>
          )}
        </div>

        <div className="flex gap-3 px-6 py-4 border-t border-border shrink-0">
          <button
            type="button"
            onClick={onClose}
            className="flex-1 h-9 rounded-md border border-border text-sm font-medium text-text2 hover:bg-bg"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={createMutation.isPending}
            className="flex-1 h-9 rounded-md bg-blue text-sm font-medium text-white hover:bg-blue/90 disabled:opacity-60"
          >
            {createMutation.isPending ? 'Saving...' : 'Save GST Details'}
          </button>
        </div>
      </form>
    </SlideOver>
  )
}
