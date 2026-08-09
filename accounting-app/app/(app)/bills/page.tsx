'use client'

import { useMemo, useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Plus } from 'lucide-react'
import { useCbopSession } from '../../lib/session-context'
import { cbopFetch, ApiError } from '../../lib/api-client'
import { inr, fmtDate, todayIso } from '../../lib/format'
import { SlideOver } from '../../components/slide-over'
import { StatusBadge } from '../../components/status-badge'
import { AuditHistoryPanel } from '../../components/audit-history-panel'

// Bills (Accounts Payable). API contract: api/routes/accounting.ts's
// /api/accounting/bills* routes - see docs/modules/ACCOUNTING_Build_Plan.md.
// Bills have no real "draft" state in practice: POST /bills creates the bill
// AND posts its AP-recognition journal entry atomically, so it lands as
// 'approved' immediately. The status tabs still include every value the
// status CHECK constraint allows, they just won't show a draft row.

type BillStatus = 'draft' | 'approved' | 'paid' | 'void'

interface Bill {
  id: string
  vendor_name: string
  bill_no: string | null
  bill_date: string
  due_date: string | null
  amount: string | number
  status: BillStatus
  created_at: string
}

interface BillDetail extends Bill {
  company_id: string
  journal_entry_id: string | null
  paid_journal_entry_id: string | null
  created_by: string
  updated_at: string
}

interface Account {
  id: string
  account_code: string
  account_name: string
  account_type: string
  account_subtype: string | null
  normal_balance: string
  is_group: boolean
  is_active: boolean
}

interface BankAccount {
  id: string
  account_code: string
  account_name: string
  account_subtype: string
  balance: string | number
}

interface JournalEntryLine {
  id: string
  line_no: number
  account_id: string
  debit: string | number
  credit: string | number
  description: string | null
  account_code: string
  account_name: string
  account_type: string
}

interface JournalEntry {
  id: string
  entry_no: string
  entry_date: string
  reference: string | null
  narration: string | null
  status: string
  void_reason: string | null
  company_id: string
}

// GST/TDS metadata (Slice 6) - acct_tax_details rows, doc_type='bill'. This
// page only ever writes TDS-shaped rows here (tds_section set, gst rate
// fields left at 0) - GST capture on outbound docs lives on the Invoices
// page instead. counterparty_gstin doubles as the vendor PAN field for these
// TDS-only rows, per the API contract - there's no separate PAN column.
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

// Common TDS sections for a services business, per
// docs/modules/ACCOUNTING_Build_Plan.md's compliance R&D §2. 192 (salaries)
// is slab-based so it has no fixed default rate.
const TDS_SECTIONS: { value: string; label: string; defaultRate: number | null }[] = [
  { value: '194C', label: '194C - Contractor/Works Contract (1-2%)', defaultRate: 2 },
  { value: '194J', label: '194J - Professional/Technical Fees (10%)', defaultRate: 10 },
  { value: '194Q', label: '194Q - Goods Purchase (0.1%)', defaultRate: 0.1 },
  { value: '192', label: '192 - Salaries (slab-based)', defaultRate: null },
]

const STATUS_TABS: { value: BillStatus | 'all'; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'approved', label: 'Approved' },
  { value: 'paid', label: 'Paid' },
  { value: 'void', label: 'Void' },
]

function TdsIndicator({ taxDetail }: { taxDetail: TaxDetail | undefined }) {
  if (!taxDetail || !taxDetail.tds_section) return <span className="text-text3">-</span>
  return (
    <span className="font-mono text-xs text-text2">
      {taxDetail.tds_section} @ {taxDetail.tds_rate}% ({inr(taxDetail.tds_amount)})
    </span>
  )
}

export default function BillsPage() {
  const session = useCbopSession()
  const queryClient = useQueryClient()
  const companyId = session.activeCompanyId ?? session.companies[0]?.id ?? null

  const [statusTab, setStatusTab] = useState<BillStatus | 'all'>('all')
  const [textFilter, setTextFilter] = useState('')
  const [newBillOpen, setNewBillOpen] = useState(false)
  const [selectedBillId, setSelectedBillId] = useState<string | null>(null)

  const billsQuery = useQuery({
    queryKey: ['bills', companyId, statusTab],
    queryFn: () =>
      cbopFetch<{ bills: Bill[] }>(
        `/api/accounting/bills?company_id=${companyId}${statusTab !== 'all' ? `&status=${statusTab}` : ''}`,
        { activeCompanyId: companyId }
      ),
    enabled: !!companyId,
  })

  const accountsQuery = useQuery({
    queryKey: ['accounts', companyId],
    queryFn: () =>
      cbopFetch<{ accounts: Account[] }>(`/api/accounting/accounts?company_id=${companyId}`, {
        activeCompanyId: companyId,
      }),
    enabled: !!companyId,
  })

  const bankAccountsQuery = useQuery({
    queryKey: ['bank-accounts', companyId],
    queryFn: () =>
      cbopFetch<{ accounts: BankAccount[] }>(`/api/accounting/bank-accounts?company_id=${companyId}`, {
        activeCompanyId: companyId,
      }),
    enabled: !!companyId,
  })

  // Batch-fetch every bill's tax details once per company instead of N+1
  // requests per row - matched client-side by doc_id below.
  const billTaxDetailsQuery = useQuery({
    queryKey: ['bill-tax-details', companyId],
    queryFn: () =>
      cbopFetch<{ tax_details: TaxDetail[] }>(`/api/accounting/tax-details?company_id=${companyId}&doc_type=bill`, {
        activeCompanyId: companyId,
      }),
    enabled: !!companyId,
  })

  const tdsByBillId = useMemo(() => {
    const map = new Map<string, TaxDetail>()
    // Rows come back ordered created_at DESC, so the first match per bill is
    // the latest one - matters if a bill somehow gets more than one tax_detail.
    for (const td of billTaxDetailsQuery.data?.tax_details ?? []) {
      if (td.tds_section && !map.has(td.doc_id)) map.set(td.doc_id, td)
    }
    return map
  }, [billTaxDetailsQuery.data])

  const expenseAccounts = useMemo(
    () => (accountsQuery.data?.accounts ?? []).filter((a) => a.account_type === 'expense' && !a.is_group && a.is_active),
    [accountsQuery.data]
  )

  const filteredBills = useMemo(() => {
    const bills = billsQuery.data?.bills ?? []
    const needle = textFilter.trim().toLowerCase()
    if (!needle) return bills
    return bills.filter(
      (b) => b.vendor_name.toLowerCase().includes(needle) || (b.bill_no ?? '').toLowerCase().includes(needle)
    )
  }, [billsQuery.data, textFilter])

  function invalidateBills() {
    queryClient.invalidateQueries({ queryKey: ['bills', companyId] })
    queryClient.invalidateQueries({ queryKey: ['bank-accounts', companyId] })
    queryClient.invalidateQueries({ queryKey: ['bill-tax-details', companyId] })
  }

  if (!companyId) {
    return (
      <main className="p-6">
        <p className="text-sm text-text2">No company in scope.</p>
      </main>
    )
  }

  return (
    <main className="p-6 max-w-5xl">
      <div className="flex items-center justify-between mb-5">
        <h1 className="font-display font-bold text-xl text-text1">Bills</h1>
        <button
          onClick={() => setNewBillOpen(true)}
          className="inline-flex items-center gap-1.5 rounded-md bg-blue px-3 py-2 text-sm font-medium text-white hover:bg-blue/90"
        >
          <Plus size={16} />
          New Bill
        </button>
      </div>

      <div className="flex items-center justify-between gap-4 mb-4">
        <div className="flex gap-1">
          {STATUS_TABS.map((tab) => (
            <button
              key={tab.value}
              onClick={() => setStatusTab(tab.value)}
              className={`rounded-md px-3 py-1.5 text-[13px] font-medium transition-colors ${
                statusTab === tab.value ? 'bg-blue/10 text-blue' : 'text-text2 hover:bg-card hover:text-text1'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
        <input
          value={textFilter}
          onChange={(e) => setTextFilter(e.target.value)}
          placeholder="Filter by vendor or bill no."
          className="h-9 w-64 rounded-md border border-border bg-card px-3 text-sm text-text1 placeholder:text-text3 focus:outline-none focus:ring-1 focus:ring-blue"
        />
      </div>

      <div className="rounded-lg border border-border bg-card overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-left text-[11px] uppercase tracking-wide text-text3">
              <th className="px-4 py-2.5 font-medium">Vendor</th>
              <th className="px-4 py-2.5 font-medium">Bill No.</th>
              <th className="px-4 py-2.5 font-medium">Bill Date</th>
              <th className="px-4 py-2.5 font-medium">Due Date</th>
              <th className="px-4 py-2.5 font-medium text-right">Amount</th>
              <th className="px-4 py-2.5 font-medium">Status</th>
              <th className="px-4 py-2.5 font-medium">TDS</th>
            </tr>
          </thead>
          <tbody>
            {billsQuery.isLoading && (
              <tr>
                <td colSpan={7} className="px-4 py-6 text-center text-text3">Loading...</td>
              </tr>
            )}
            {billsQuery.isError && (
              <tr>
                <td colSpan={7} className="px-4 py-6 text-center text-red">
                  {(billsQuery.error as Error)?.message ?? 'Failed to load bills'}
                </td>
              </tr>
            )}
            {!billsQuery.isLoading && !billsQuery.isError && filteredBills.length === 0 && (
              <tr>
                <td colSpan={7} className="px-4 py-6 text-center text-text3">No bills found.</td>
              </tr>
            )}
            {filteredBills.map((bill) => (
              <tr
                key={bill.id}
                onClick={() => setSelectedBillId(bill.id)}
                className="border-b border-border last:border-0 cursor-pointer hover:bg-bg"
              >
                <td className="px-4 py-2.5 text-text1">{bill.vendor_name}</td>
                <td className="px-4 py-2.5 font-mono text-text2">{bill.bill_no ?? '-'}</td>
                <td className="px-4 py-2.5 font-mono text-text2">{fmtDate(bill.bill_date)}</td>
                <td className="px-4 py-2.5 font-mono text-text2">{bill.due_date ? fmtDate(bill.due_date) : '-'}</td>
                <td className="px-4 py-2.5 font-mono text-text1 text-right">{inr(bill.amount)}</td>
                <td className="px-4 py-2.5"><StatusBadge status={bill.status} /></td>
                <td className="px-4 py-2.5"><TdsIndicator taxDetail={tdsByBillId.get(bill.id)} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <NewBillSlideOver
        isOpen={newBillOpen}
        onClose={() => setNewBillOpen(false)}
        companyId={companyId}
        expenseAccounts={expenseAccounts}
        onCreated={() => {
          setNewBillOpen(false)
          invalidateBills()
        }}
      />

      <BillDetailSlideOver
        billId={selectedBillId}
        onClose={() => setSelectedBillId(null)}
        companyId={companyId}
        bankAccounts={bankAccountsQuery.data?.accounts ?? []}
        taxDetail={selectedBillId ? tdsByBillId.get(selectedBillId) : undefined}
        onChanged={invalidateBills}
      />
    </main>
  )
}

// ── New Bill ─────────────────────────────────────────────────────────────────

function NewBillSlideOver({
  isOpen,
  onClose,
  companyId,
  expenseAccounts,
  onCreated,
}: {
  isOpen: boolean
  onClose: () => void
  companyId: string
  expenseAccounts: Account[]
  onCreated: () => void
}) {
  const [vendorName, setVendorName] = useState('')
  const [billNo, setBillNo] = useState('')
  const [billDate, setBillDate] = useState(todayIso())
  const [dueDate, setDueDate] = useState('')
  const [amount, setAmount] = useState('')
  const [expenseAccountId, setExpenseAccountId] = useState('')
  const [error, setError] = useState<string | null>(null)

  const [tdsEnabled, setTdsEnabled] = useState(false)
  const [tdsSection, setTdsSection] = useState('')
  const [tdsRate, setTdsRate] = useState('')
  const [vendorPan, setVendorPan] = useState('')

  const createMutation = useMutation({
    // Two sequential calls, not a combined endpoint - none exists. If the
    // bill itself is created but the follow-up tax-details call fails, the
    // bill still exists; the error message says so instead of implying the
    // whole thing failed.
    mutationFn: async () => {
      const res = await cbopFetch<{ bill: { id: string } }>('/api/accounting/bills', {
        method: 'POST',
        activeCompanyId: companyId,
        body: {
          company_id: companyId,
          vendor_name: vendorName,
          bill_no: billNo || undefined,
          bill_date: billDate,
          due_date: dueDate || undefined,
          amount,
          expense_account_id: expenseAccountId,
        },
      })
      if (tdsEnabled && tdsSection) {
        try {
          await cbopFetch('/api/accounting/tax-details', {
            method: 'POST',
            activeCompanyId: companyId,
            body: {
              company_id: companyId,
              doc_type: 'bill',
              doc_id: res.bill.id,
              counterparty_gstin: vendorPan || undefined,
              taxable_value: amount,
              tds_section: tdsSection,
              tds_rate: tdsRate || 0,
            },
          })
        } catch (err) {
          const msg = err instanceof ApiError ? err.message : 'unknown error'
          throw new Error(`Bill was created, but saving TDS details failed (${msg}).`)
        }
      }
      return res
    },
    onSuccess: () => {
      resetForm()
      onCreated()
    },
    onError: (err) =>
      setError(err instanceof ApiError ? err.message : err instanceof Error ? err.message : 'Failed to create bill'),
  })

  function resetForm() {
    setVendorName('')
    setBillNo('')
    setBillDate(todayIso())
    setDueDate('')
    setAmount('')
    setExpenseAccountId('')
    setTdsEnabled(false)
    setTdsSection('')
    setTdsRate('')
    setVendorPan('')
    setError(null)
  }

  function handleClose() {
    resetForm()
    onClose()
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    if (!vendorName.trim()) return setError('Vendor name is required')
    if (!billDate) return setError('Bill date is required')
    if (!expenseAccountId) return setError('Expense account is required')
    const amt = parseFloat(amount)
    if (isNaN(amt) || amt <= 0) return setError('Amount must be a positive number')
    if (tdsEnabled && !tdsSection) return setError('Select a TDS section, or turn off "Add TDS details"')
    createMutation.mutate()
  }

  return (
    <SlideOver isOpen={isOpen} onClose={handleClose} title="New Bill">
      <form onSubmit={handleSubmit} className="flex flex-1 flex-col overflow-hidden">
        <div className="flex-1 overflow-auto px-6 py-5 flex flex-col gap-4">
          {error && <p className="text-sm text-red">{error}</p>}

          <label className="flex flex-col gap-1">
            <span className="text-xs font-medium text-text2">Vendor name</span>
            <input
              value={vendorName}
              onChange={(e) => setVendorName(e.target.value)}
              className="h-9 rounded-md border border-border px-3 text-sm text-text1 focus:outline-none focus:ring-1 focus:ring-blue"
              required
            />
          </label>

          <label className="flex flex-col gap-1">
            <span className="text-xs font-medium text-text2">Bill no. (optional)</span>
            <input
              value={billNo}
              onChange={(e) => setBillNo(e.target.value)}
              className="h-9 rounded-md border border-border px-3 text-sm font-mono text-text1 focus:outline-none focus:ring-1 focus:ring-blue"
            />
          </label>

          <div className="grid grid-cols-2 gap-3">
            <label className="flex flex-col gap-1">
              <span className="text-xs font-medium text-text2">Bill date</span>
              <input
                type="date"
                value={billDate}
                onChange={(e) => setBillDate(e.target.value)}
                className="h-9 rounded-md border border-border px-3 text-sm font-mono text-text1 focus:outline-none focus:ring-1 focus:ring-blue"
                required
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-xs font-medium text-text2">Due date (optional)</span>
              <input
                type="date"
                value={dueDate}
                onChange={(e) => setDueDate(e.target.value)}
                className="h-9 rounded-md border border-border px-3 text-sm font-mono text-text1 focus:outline-none focus:ring-1 focus:ring-blue"
              />
            </label>
          </div>

          <label className="flex flex-col gap-1">
            <span className="text-xs font-medium text-text2">Amount</span>
            <input
              type="number"
              step="0.01"
              min="0.01"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              className="h-9 rounded-md border border-border px-3 text-sm font-mono text-text1 focus:outline-none focus:ring-1 focus:ring-blue"
              required
            />
          </label>

          <label className="flex flex-col gap-1">
            <span className="text-xs font-medium text-text2">Expense account</span>
            <select
              value={expenseAccountId}
              onChange={(e) => setExpenseAccountId(e.target.value)}
              className="h-9 rounded-md border border-border px-3 text-sm text-text1 focus:outline-none focus:ring-1 focus:ring-blue"
              required
            >
              <option value="">Select an expense account</option>
              {expenseAccounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.account_code} — {a.account_name}
                </option>
              ))}
            </select>
            {expenseAccounts.length === 0 && (
              <span className="text-xs text-text3">No expense accounts found for this company.</span>
            )}
          </label>

          <div className="rounded-md border border-border p-3 flex flex-col gap-3">
            <label className="flex items-center gap-2 text-sm font-medium text-text1 cursor-pointer">
              <input
                type="checkbox"
                checked={tdsEnabled}
                onChange={(e) => setTdsEnabled(e.target.checked)}
                className="h-4 w-4 rounded border-border text-blue focus:outline-none focus:ring-1 focus:ring-blue"
              />
              Add TDS details
            </label>
            {tdsEnabled && (
              <div className="flex flex-col gap-3">
                <label className="flex flex-col gap-1">
                  <span className="text-xs font-medium text-text2">TDS section</span>
                  <select
                    value={tdsSection}
                    onChange={(e) => {
                      const section = e.target.value
                      setTdsSection(section)
                      const preset = TDS_SECTIONS.find((s) => s.value === section)
                      if (preset?.defaultRate != null) setTdsRate(String(preset.defaultRate))
                    }}
                    className="h-9 rounded-md border border-border px-3 text-sm text-text1 focus:outline-none focus:ring-1 focus:ring-blue"
                  >
                    <option value="">Select a section</option>
                    {TDS_SECTIONS.map((s) => (
                      <option key={s.value} value={s.value}>
                        {s.label}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="flex flex-col gap-1">
                  <span className="text-xs font-medium text-text2">TDS rate (%)</span>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    value={tdsRate}
                    onChange={(e) => setTdsRate(e.target.value)}
                    className="h-9 rounded-md border border-border px-3 text-sm font-mono text-text1 focus:outline-none focus:ring-1 focus:ring-blue"
                  />
                </label>
                <label className="flex flex-col gap-1">
                  <span className="text-xs font-medium text-text2">Vendor PAN (optional)</span>
                  <input
                    value={vendorPan}
                    onChange={(e) => setVendorPan(e.target.value.toUpperCase())}
                    placeholder="ABCDE1234F"
                    className="h-9 rounded-md border border-border px-3 text-sm font-mono text-text1 focus:outline-none focus:ring-1 focus:ring-blue"
                  />
                  <span className="text-[11px] text-text3">No PAN on file pushes TDS to a higher flat rate under 206AA - capture it when known.</span>
                </label>
              </div>
            )}
          </div>
        </div>

        <div className="flex gap-3 px-6 py-4 border-t border-border shrink-0">
          <button
            type="button"
            onClick={handleClose}
            className="flex-1 rounded-md border border-border px-3 py-2 text-sm font-medium text-text2 hover:bg-bg"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={createMutation.isPending}
            className="flex-1 rounded-md bg-blue px-3 py-2 text-sm font-medium text-white hover:bg-blue/90 disabled:opacity-60"
          >
            {createMutation.isPending ? 'Creating...' : 'Create Bill'}
          </button>
        </div>
      </form>
    </SlideOver>
  )
}

// ── Bill detail ──────────────────────────────────────────────────────────────

function BillDetailSlideOver({
  billId,
  onClose,
  companyId,
  bankAccounts,
  taxDetail,
  onChanged,
}: {
  billId: string | null
  onClose: () => void
  companyId: string
  bankAccounts: BankAccount[]
  taxDetail: TaxDetail | undefined
  onChanged: () => void
}) {
  const session = useCbopSession()
  const isCeo = session.role === 'ceo' || session.role === 'creator'
  const queryClient = useQueryClient()
  const [showPaymentForm, setShowPaymentForm] = useState(false)
  const [showVoidForm, setShowVoidForm] = useState(false)
  const [showHistory, setShowHistory] = useState(false)
  const [bankAccountId, setBankAccountId] = useState('')
  const [paymentDate, setPaymentDate] = useState(todayIso())
  const [voidReason, setVoidReason] = useState('')
  const [actionError, setActionError] = useState<string | null>(null)

  const billQuery = useQuery({
    queryKey: ['bill', billId],
    queryFn: () => cbopFetch<{ bill: BillDetail }>(`/api/accounting/bills/${billId}`, { activeCompanyId: companyId }),
    enabled: !!billId,
  })
  const bill = billQuery.data?.bill

  // Paid bills: fetch the payment entry to show which account/date it was paid from.
  const paidEntryQuery = useQuery({
    queryKey: ['journal-entry', bill?.paid_journal_entry_id],
    queryFn: () =>
      cbopFetch<{ entry: JournalEntry; lines: JournalEntryLine[] }>(
        `/api/accounting/journal-entries/${bill?.paid_journal_entry_id}`,
        { activeCompanyId: companyId }
      ),
    enabled: !!bill?.paid_journal_entry_id && bill.status === 'paid',
  })
  const paidFromLine = paidEntryQuery.data?.lines.find((l) => Number(l.credit) > 0)

  // Void bills: void_reason lives on the journal entry, not the bill row.
  const voidedEntryQuery = useQuery({
    queryKey: ['journal-entry', bill?.journal_entry_id],
    queryFn: () =>
      cbopFetch<{ entry: JournalEntry; lines: JournalEntryLine[] }>(
        `/api/accounting/journal-entries/${bill?.journal_entry_id}`,
        { activeCompanyId: companyId }
      ),
    enabled: !!bill?.journal_entry_id && bill.status === 'void',
  })

  const recordPaymentMutation = useMutation({
    mutationFn: () =>
      cbopFetch(`/api/accounting/bills/${billId}/record-payment`, {
        method: 'POST',
        activeCompanyId: companyId,
        body: { bank_account_id: bankAccountId, payment_date: paymentDate || undefined },
      }),
    onSuccess: () => {
      setShowPaymentForm(false)
      queryClient.invalidateQueries({ queryKey: ['bill', billId] })
      onChanged()
    },
    onError: (err) => setActionError(err instanceof ApiError ? err.message : 'Failed to record payment'),
  })

  const voidMutation = useMutation({
    mutationFn: () =>
      cbopFetch(`/api/accounting/bills/${billId}/void`, {
        method: 'POST',
        activeCompanyId: companyId,
        body: { reason: voidReason },
      }),
    onSuccess: () => {
      setShowVoidForm(false)
      queryClient.invalidateQueries({ queryKey: ['bill', billId] })
      onChanged()
    },
    onError: (err) => setActionError(err instanceof ApiError ? err.message : 'Failed to void bill'),
  })

  function handleClose() {
    setShowPaymentForm(false)
    setShowVoidForm(false)
    setShowHistory(false)
    setBankAccountId('')
    setPaymentDate(todayIso())
    setVoidReason('')
    setActionError(null)
    onClose()
  }

  return (
    <SlideOver isOpen={!!billId} onClose={handleClose} title={bill ? bill.vendor_name : 'Bill'}>
      <div className="flex-1 overflow-auto px-6 py-5 flex flex-col gap-4">
        {billQuery.isLoading && <p className="text-sm text-text3">Loading...</p>}
        {billQuery.isError && <p className="text-sm text-red">Failed to load bill</p>}

        {bill && (
          <>
            <div className="flex items-center justify-between">
              <StatusBadge status={bill.status} />
              <span className="font-mono text-lg text-text1">{inr(bill.amount)}</span>
            </div>

            <dl className="grid grid-cols-2 gap-y-3 text-sm">
              <dt className="text-text2">Bill no.</dt>
              <dd className="font-mono text-text1 text-right">{bill.bill_no ?? '-'}</dd>
              <dt className="text-text2">Bill date</dt>
              <dd className="font-mono text-text1 text-right">{fmtDate(bill.bill_date)}</dd>
              <dt className="text-text2">Due date</dt>
              <dd className="font-mono text-text1 text-right">{bill.due_date ? fmtDate(bill.due_date) : '-'}</dd>
            </dl>

            {taxDetail && taxDetail.tds_section && (
              <div className="rounded-md bg-bg px-3 py-2.5 text-sm">
                <p className="font-medium text-text1 mb-1">TDS Deducted</p>
                <p className="font-mono text-text2">
                  {taxDetail.tds_section} @ {taxDetail.tds_rate}% = {inr(taxDetail.tds_amount)}
                </p>
                {taxDetail.counterparty_gstin && (
                  <p className="text-xs text-text3 mt-1">
                    PAN: <span className="font-mono">{taxDetail.counterparty_gstin}</span>
                  </p>
                )}
              </div>
            )}

            {bill.status === 'paid' && (
              <div className="rounded-md bg-green/10 px-3 py-2.5 text-sm text-text1">
                <p className="font-medium text-green mb-1">Paid</p>
                {paidEntryQuery.isLoading && <p className="text-text3">Loading payment details...</p>}
                {paidFromLine && paidEntryQuery.data && (
                  <p className="text-text2">
                    Paid from <span className="font-mono text-text1">{paidFromLine.account_code} — {paidFromLine.account_name}</span> on{' '}
                    <span className="font-mono text-text1">{fmtDate(paidEntryQuery.data.entry.entry_date)}</span>
                  </p>
                )}
              </div>
            )}

            {bill.status === 'void' && (
              <div className="rounded-md bg-red/10 px-3 py-2.5 text-sm">
                <p className="font-medium text-red mb-1">Void</p>
                {voidedEntryQuery.isLoading && <p className="text-text3">Loading void reason...</p>}
                {voidedEntryQuery.data && (
                  <p className="text-text2">{voidedEntryQuery.data.entry.void_reason ?? 'No reason recorded.'}</p>
                )}
              </div>
            )}

            {isCeo && (
              <div>
                <div className="flex items-center justify-between mb-2">
                  <p className="text-[11px] uppercase tracking-wide text-text3">History</p>
                  <button
                    type="button"
                    onClick={() => setShowHistory((v) => !v)}
                    className="text-xs font-medium text-blue hover:underline"
                  >
                    {showHistory ? 'Hide' : 'View history'}
                  </button>
                </div>
                {showHistory && (
                  <AuditHistoryPanel
                    companyId={companyId}
                    target={{ resourceType: 'acct_bills', resourceId: bill.id }}
                  />
                )}
              </div>
            )}

            {bill.status === 'approved' && (
              <>
                {actionError && <p className="text-sm text-red">{actionError}</p>}

                {showPaymentForm && (
                  <div className="rounded-md border border-border p-3 flex flex-col gap-3">
                    <p className="text-sm font-medium text-text1">Record Payment</p>
                    <label className="flex flex-col gap-1">
                      <span className="text-xs font-medium text-text2">Bank / cash account</span>
                      <select
                        value={bankAccountId}
                        onChange={(e) => setBankAccountId(e.target.value)}
                        className="h-9 rounded-md border border-border px-3 text-sm text-text1 focus:outline-none focus:ring-1 focus:ring-blue"
                      >
                        <option value="">Select an account</option>
                        {bankAccounts.map((a) => (
                          <option key={a.id} value={a.id}>
                            {a.account_code} — {a.account_name}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="flex flex-col gap-1">
                      <span className="text-xs font-medium text-text2">Payment date</span>
                      <input
                        type="date"
                        value={paymentDate}
                        onChange={(e) => setPaymentDate(e.target.value)}
                        className="h-9 rounded-md border border-border px-3 text-sm font-mono text-text1 focus:outline-none focus:ring-1 focus:ring-blue"
                      />
                    </label>
                    <div className="flex gap-2">
                      <button
                        onClick={() => setShowPaymentForm(false)}
                        className="flex-1 rounded-md border border-border px-3 py-1.5 text-sm text-text2 hover:bg-bg"
                      >
                        Cancel
                      </button>
                      <button
                        onClick={() => {
                          setActionError(null)
                          if (!bankAccountId) return setActionError('Select a bank/cash account')
                          recordPaymentMutation.mutate()
                        }}
                        disabled={recordPaymentMutation.isPending}
                        className="flex-1 rounded-md bg-blue px-3 py-1.5 text-sm font-medium text-white hover:bg-blue/90 disabled:opacity-60"
                      >
                        {recordPaymentMutation.isPending ? 'Recording...' : 'Confirm Payment'}
                      </button>
                    </div>
                  </div>
                )}

                {showVoidForm && (
                  <div className="rounded-md border border-border p-3 flex flex-col gap-3">
                    <p className="text-sm font-medium text-text1">Void Bill</p>
                    <label className="flex flex-col gap-1">
                      <span className="text-xs font-medium text-text2">Reason (required)</span>
                      <textarea
                        value={voidReason}
                        onChange={(e) => setVoidReason(e.target.value)}
                        rows={3}
                        className="rounded-md border border-border px-3 py-2 text-sm text-text1 focus:outline-none focus:ring-1 focus:ring-blue"
                      />
                    </label>
                    <div className="flex gap-2">
                      <button
                        onClick={() => setShowVoidForm(false)}
                        className="flex-1 rounded-md border border-border px-3 py-1.5 text-sm text-text2 hover:bg-bg"
                      >
                        Cancel
                      </button>
                      <button
                        onClick={() => {
                          setActionError(null)
                          if (!voidReason.trim()) return setActionError('Reason is required')
                          voidMutation.mutate()
                        }}
                        disabled={voidMutation.isPending}
                        className="flex-1 rounded-md bg-red px-3 py-1.5 text-sm font-medium text-white hover:bg-red/90 disabled:opacity-60"
                      >
                        {voidMutation.isPending ? 'Voiding...' : 'Confirm Void'}
                      </button>
                    </div>
                  </div>
                )}

                {!showPaymentForm && !showVoidForm && (
                  <div className="flex gap-3 mt-2">
                    <button
                      onClick={() => setShowPaymentForm(true)}
                      className="flex-1 rounded-md bg-blue px-3 py-2 text-sm font-medium text-white hover:bg-blue/90"
                    >
                      Record Payment
                    </button>
                    <button
                      onClick={() => setShowVoidForm(true)}
                      className="flex-1 rounded-md border border-red text-red px-3 py-2 text-sm font-medium hover:bg-red/10"
                    >
                      Void
                    </button>
                  </div>
                )}
              </>
            )}
          </>
        )}
      </div>
    </SlideOver>
  )
}
