'use client'

import Link from 'next/link'
import { useQuery } from '@tanstack/react-query'
import { useCbopSession } from '../../lib/session-context'
import { cbopFetch } from '../../lib/api-client'
import { inr, fmtDate } from '../../lib/format'

// Slice 4: replaces the Slice 3 SSO-proof placeholder with real summary
// widgets, composed entirely from endpoints that already exist in
// api/routes/accounting.ts - there is no dedicated dashboard-summary
// endpoint, so each card sums/counts client-side from its own list fetch.
// Cash/bills totals are shown to every role with accounting access (ceo/coo/
// cto/creator), matching how Zoho Books surfaces operational totals to
// non-admin roles - this is deliberately NOT the same thing as the P&L /
// balance sheet / trial balance, which stay CEO/creator-only in Slice 5.

interface BankAccount {
  id: string
  account_code: string
  account_name: string
  account_subtype: string
  balance: string
}

interface Bill {
  id: string
  vendor_name: string
  bill_no: string | null
  bill_date: string
  due_date: string | null
  amount: string
  status: string
}

interface Expense {
  id: string
  entry_date: string
  narration: string | null
  amount: string
  category: string
}

interface JournalEntry {
  id: string
  status: string
}

export default function DashboardPage() {
  const session = useCbopSession()
  const companyId = session.activeCompanyId

  const bankAccountsQuery = useQuery({
    queryKey: ['acct-bank-accounts', companyId],
    queryFn: () => cbopFetch<{ accounts: BankAccount[] }>(`/api/accounting/bank-accounts?company_id=${companyId}`, { activeCompanyId: companyId }),
    enabled: !!companyId,
  })

  const billsQuery = useQuery({
    queryKey: ['acct-bills', companyId, 'approved'],
    queryFn: () => cbopFetch<{ bills: Bill[] }>(`/api/accounting/bills?company_id=${companyId}&status=approved`, { activeCompanyId: companyId }),
    enabled: !!companyId,
  })

  const draftEntriesQuery = useQuery({
    queryKey: ['acct-journal-entries', companyId, 'draft'],
    queryFn: () => cbopFetch<{ entries: JournalEntry[] }>(`/api/accounting/journal-entries?company_id=${companyId}&status=draft`, { activeCompanyId: companyId }),
    enabled: !!companyId,
  })

  const expensesQuery = useQuery({
    queryKey: ['acct-expenses', companyId],
    queryFn: () => cbopFetch<{ expenses: Expense[] }>(`/api/accounting/expenses?company_id=${companyId}`, { activeCompanyId: companyId }),
    enabled: !!companyId,
  })

  const cashTotal = (bankAccountsQuery.data?.accounts ?? []).reduce((sum, a) => sum + parseFloat(a.balance || '0'), 0)
  const payablesTotal = (billsQuery.data?.bills ?? []).reduce((sum, b) => sum + parseFloat(b.amount || '0'), 0)
  const draftCount = draftEntriesQuery.data?.entries.length ?? 0
  const recentExpenses = (expensesQuery.data?.expenses ?? []).slice(0, 8)

  return (
    <main className="p-6 max-w-5xl">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-display font-bold text-xl text-text1">Dashboard</h1>
          <p className="mt-1 text-sm text-text2">
            {session.name} · role: {session.role}
          </p>
        </div>
        <CompanyPicker />
      </div>

      <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <SummaryCard
          label="Cash + Bank"
          value={inr(cashTotal)}
          loading={bankAccountsQuery.isLoading}
          tone="green"
          hint={`${bankAccountsQuery.data?.accounts.length ?? 0} account${bankAccountsQuery.data?.accounts.length === 1 ? '' : 's'}`}
        />
        <SummaryCard
          label="Outstanding Payables"
          value={inr(payablesTotal)}
          loading={billsQuery.isLoading}
          tone="amber"
          hint={`${billsQuery.data?.bills.length ?? 0} approved bill${billsQuery.data?.bills.length === 1 ? '' : 's'}`}
        />
        <SummaryCard
          label="Draft Entries"
          value={String(draftCount)}
          loading={draftEntriesQuery.isLoading}
          tone={draftCount > 0 ? 'amber' : 'default'}
          hint={draftCount > 0 ? 'awaiting review or posting' : 'all caught up'}
          href="/journal"
        />
        <SummaryCard
          label="Accounts Receivable"
          value="View invoices"
          loading={false}
          tone="blue"
          hint="tracked on the Invoices page"
          href="/invoices"
        />
      </div>

      <div className="mt-6 grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className="rounded-lg border border-border bg-card p-4 lg:col-span-2">
          <div className="flex items-center justify-between">
            <p className="text-xs font-semibold uppercase tracking-wide text-text3">Recent expense activity</p>
            <Link href="/expenses" className="text-xs text-blue">
              View all
            </Link>
          </div>
          {expensesQuery.isLoading ? (
            <p className="mt-3 text-sm text-text2">Loading…</p>
          ) : recentExpenses.length === 0 ? (
            <p className="mt-3 text-sm text-text2">No expenses posted yet.</p>
          ) : (
            <ul className="mt-3 divide-y divide-border">
              {recentExpenses.map((e) => (
                <li key={e.id} className="flex items-center justify-between py-2 text-sm">
                  <div className="min-w-0">
                    <p className="truncate text-text1">{e.category}</p>
                    <p className="font-mono text-xs text-text3">{fmtDate(e.entry_date)}</p>
                  </div>
                  <span className="shrink-0 font-mono text-text1">{inr(e.amount)}</span>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="rounded-lg border border-border bg-card p-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-text3">Companies in scope</p>
          <ul className="mt-3 space-y-1.5 text-sm">
            {session.companies.map((c) => (
              <li key={c.id} className="flex items-center justify-between font-mono text-text1">
                <span>
                  {c.invoice_prefix} — {c.name}
                </span>
                {c.id === session.activeCompanyId && <span className="ml-2 shrink-0 text-[11px] text-blue">active</span>}
              </li>
            ))}
          </ul>
        </div>
      </div>
    </main>
  )
}

function CompanyPicker() {
  const session = useCbopSession()
  const activeCompany = session.companies.find((c) => c.id === session.activeCompanyId)
  if (!activeCompany) return null
  // Read-only for now - switching companies is done from the main CBOP app's
  // topbar (see app/(app)/topbar.tsx's note on cbop_active_company_id); this
  // just surfaces which one is active so the widgets above aren't ambiguous.
  return (
    <div className="rounded-md border border-border bg-card px-3 py-1.5 text-right">
      <p className="text-[10px] uppercase tracking-wide text-text3">Active company</p>
      <p className="font-mono text-sm text-text1">{activeCompany.name}</p>
    </div>
  )
}

function SummaryCard({
  label,
  value,
  loading,
  tone = 'default',
  hint,
  href,
}: {
  label: string
  value: string
  loading: boolean
  tone?: 'default' | 'green' | 'amber' | 'red' | 'blue'
  hint?: string
  href?: string
}) {
  const toneCls: Record<string, string> = {
    default: 'text-text1',
    green: 'text-green',
    amber: 'text-amber',
    red: 'text-red',
    blue: 'text-blue',
  }

  const body = (
    <div className="rounded-lg border border-border bg-card p-4 transition-colors hover:border-text3/50">
      <p className="text-xs font-semibold uppercase tracking-wide text-text3">{label}</p>
      <p className={`mt-2 font-mono text-2xl font-semibold ${toneCls[tone]}`}>
        {loading ? '…' : value}
      </p>
      {hint && <p className="mt-1 text-xs text-text2">{hint}</p>}
    </div>
  )

  if (href) {
    return (
      <Link href={href} className="block">
        {body}
      </Link>
    )
  }
  return body
}
