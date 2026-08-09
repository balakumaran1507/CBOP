'use client'

import { useState, useEffect, useRef } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useCompany } from '@/app/lib/company-context'
import { ArrowUpRight, Calculator, Plus, CreditCard, Receipt, Building, ExternalLink } from 'lucide-react'

// CBOP Accounting has two homes, deliberately:
//   - THIS page (cbop.etherence.com/accounting) - basic, day-to-day functions,
//     same origin, same shell, no jarring jump. Summary + quick-add expense.
//   - accounting.etherence.com - the full statutory-grade app (chart of
//     accounts, journal entries, bills, banking, reports, GST/TDS, audit
//     trail, period locking). One click away via the button below, opened in
//     a new tab so CBOP itself never disappears out from under you.
// Both talk to the exact same backend (api/routes/accounting.ts) - this page
// makes plain same-origin fetches, no CORS/cross-subdomain-cookie plumbing
// needed here at all, unlike the standalone app.
// Use env var so this works across environments without a code change.
// NEXT_PUBLIC_ACCOUNTING_URL must be set in .env for production.
const FULL_APP_URL = process.env.NEXT_PUBLIC_ACCOUNTING_URL || 'https://accounting.etherence.com'

// ── Helpers ───────────────────────────────────────────────────────────────────

function inr(n: number | string): string {
  const num = typeof n === 'string' ? parseFloat(n) : n
  return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(num || 0)
}

function fmtDate(d: string): string {
  return new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })
}

// ── Types ─────────────────────────────────────────────────────────────────────

interface Account {
  id: string
  account_code: string
  account_name: string
  account_type: string
  is_active: boolean
}

interface BankAccount {
  id: string
  account_code: string
  account_name: string
  balance: number | string
}

interface Bill {
  id: string
  amount: number | string
  status: string
}

interface Expense {
  id: string
  entry_no: string
  entry_date: string
  category: string
  account_id: string
  amount: number | string
  narration: string | null
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function AccountingPage() {
  const qc = useQueryClient()
  const { activeCompany } = useCompany()
  const companyId = activeCompany?.id ?? null

  const [quickAdd, setQuickAdd] = useState({ expense_account_id: '', bank_account_id: '', amount: '', description: '', date: new Date().toISOString().slice(0, 10) })
  const quickAddRef = useRef<HTMLSelectElement>(null)

  const { data: accountsData, isLoading: accountsLoading } = useQuery<{ accounts: Account[] }>({
    queryKey: ['acct-accounts', companyId],
    queryFn: async () => {
      const res = await fetch(`/api/accounting/accounts?company_id=${companyId}`, { credentials: 'include' })
      if (!res.ok) throw new Error('Failed to load accounts')
      return res.json()
    },
    enabled: !!companyId,
  })
  const accounts = accountsData?.accounts ?? []
  const expenseAccounts = accounts.filter((a) => a.account_type === 'expense' && a.is_active)
  const hasChartOfAccounts = accounts.length > 0

  const { data: bankData } = useQuery<{ accounts: BankAccount[] }>({
    queryKey: ['acct-bank-accounts', companyId],
    queryFn: async () => {
      const res = await fetch(`/api/accounting/bank-accounts?company_id=${companyId}`, { credentials: 'include' })
      if (!res.ok) throw new Error('Failed to load bank accounts')
      return res.json()
    },
    enabled: !!companyId,
  })
  const bankAccounts = bankData?.accounts ?? []
  const cashAndBank = bankAccounts.reduce((s, a) => s + (typeof a.balance === 'string' ? parseFloat(a.balance) : a.balance), 0)

  const { data: billsData } = useQuery<{ bills: Bill[] }>({
    queryKey: ['acct-bills-approved', companyId],
    queryFn: async () => {
      const res = await fetch(`/api/accounting/bills?company_id=${companyId}&status=approved`, { credentials: 'include' })
      if (!res.ok) throw new Error('Failed to load bills')
      return res.json()
    },
    enabled: !!companyId,
  })
  const apOutstanding = (billsData?.bills ?? []).reduce((s, b) => s + (typeof b.amount === 'string' ? parseFloat(b.amount) : b.amount), 0)

  const { data: invoicesData } = useQuery<{ invoices: { total: string | number; status: string }[] }>({
    // Key must include companyId — AR Outstanding must refresh when the company switcher changes.
    queryKey: ['sales-invoices-all', companyId],
    queryFn: async () => {
      const res = await fetch(`/api/invoices?all=true`, {
        credentials: 'include',
        // Pass the active company so requireAuth scopes the query to exactly this company,
        // not the full set of companyIds the user has access to.
        headers: companyId ? { 'x-active-company-id': companyId } : {},
      })
      if (!res.ok) throw new Error('Failed to load invoices')
      return res.json()
    },
    enabled: !!companyId,
  })
  // API already filters by active company via x-active-company-id — no client-side
  // company_name string match needed (which would break silently on a company rename).
  const arOutstanding = (invoicesData?.invoices ?? [])
    .filter((i) => i.status === 'sent' || i.status === 'overdue')
    .reduce((s, i) => s + (typeof i.total === 'string' ? parseFloat(i.total) : i.total), 0)

  const { data: expensesData } = useQuery<{ expenses: Expense[] }>({
    queryKey: ['acct-expenses', companyId],
    queryFn: async () => {
      const res = await fetch(`/api/accounting/expenses?company_id=${companyId}`, { credentials: 'include' })
      if (!res.ok) throw new Error('Failed to load expenses')
      return res.json()
    },
    enabled: !!companyId,
  })
  const expenses = (expensesData?.expenses ?? []).slice(0, 8)

  // Tally-style shortcut: "n" anywhere on the page jumps focus to quick-add category field
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'n' && !['INPUT', 'TEXTAREA', 'SELECT'].includes((e.target as HTMLElement).tagName)) {
        e.preventDefault()
        quickAddRef.current?.focus()
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [])

  const quickAddMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch('/api/accounting/expenses', {
        method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          company_id: companyId,
          date: quickAdd.date,
          expense_account_id: quickAdd.expense_account_id,
          bank_account_id: quickAdd.bank_account_id,
          amount: parseFloat(quickAdd.amount),
          description: quickAdd.description || undefined,
        }),
      })
      if (!res.ok) throw new Error((await res.json().catch(() => ({})))?.error ?? 'Failed to add expense')
    },
    onSuccess: () => {
      setQuickAdd((p) => ({ ...p, amount: '', description: '' }))
      qc.invalidateQueries({ queryKey: ['acct-expenses', companyId] })
      qc.invalidateQueries({ queryKey: ['acct-bank-accounts', companyId] })
    },
  })

  const canQuickAdd = !!quickAdd.expense_account_id && !!quickAdd.bank_account_id && !!quickAdd.amount

  return (
    <div className="p-8 max-w-[1200px] mx-auto animate-in fade-in duration-500 font-sans">
      <div className="flex justify-between items-start mb-8 flex-wrap gap-4">
        <div>
          <h1 className="font-bold text-3xl text-text1 m-0 mb-1.5 tracking-tight flex items-center gap-3">
            Accounting
          </h1>
          <p className="text-[14px] text-text2 m-0 font-medium tracking-wide">
            The day-to-day basics, right here in CBOP <span className="inline-block bg-border/50 text-[11px] font-mono px-1.5 py-0.5 rounded ml-1 text-text1">N</span> to quick-add
          </p>
        </div>
        <a 
          href={`${FULL_APP_URL}/dashboard`} 
          target="_blank" 
          rel="noopener noreferrer" 
          className="flex items-center gap-2 bg-card border border-border/60 text-text1 rounded-xl px-5 py-2.5 text-[14px] font-semibold hover:bg-bg hover:border-border transition-all active:scale-95 shadow-sm"
        >
          Open full Accounting app <ArrowUpRight size={16} className="text-text2" />
        </a>
      </div>

      {!companyId ? (
        <div className="py-20 text-center text-text3 font-medium text-[15px] bg-card border border-border/50 rounded-2xl">
          Select a company to continue.
        </div>
      ) : !accountsLoading && !hasChartOfAccounts ? (
        <div className="bg-card border border-border/60 rounded-3xl p-10 text-center shadow-sm max-w-2xl mx-auto mt-12 animate-in slide-in-from-bottom-4">
          <div className="w-16 h-16 bg-blue/10 rounded-2xl flex items-center justify-center mx-auto mb-6">
            <Calculator size={32} className="text-blue" />
          </div>
          <h2 className="font-bold text-xl text-text1 m-0 mb-3 tracking-tight">
            No chart of accounts set up yet for {activeCompany?.name}
          </h2>
          <p className="text-[14px] text-text2 m-0 mb-8 max-w-[440px] mx-auto leading-relaxed font-medium">
            Set-up is a CEO/creator action, done once, in the full Accounting app - it seeds a standard
            chart (cash, bank, revenue, expenses, GST accounts) so the rest of this works.
          </p>
          <a 
            href={`${FULL_APP_URL}/accounts`} 
            target="_blank" 
            rel="noopener noreferrer" 
            className="inline-flex items-center gap-2 bg-blue text-white rounded-xl px-6 py-3 text-[14px] font-bold hover:bg-blue/90 transition-all hover:scale-105 active:scale-95 shadow-sm"
          >
            Set up in full app <ArrowUpRight size={16} />
          </a>
        </div>
      ) : (
        <div className="space-y-6">
          {/* Summary cards */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-5 mb-8">
            {[
              { label: 'Cash + Bank', value: cashAndBank, color: cashAndBank >= 0 ? 'text-green' : 'text-red', icon: Building, bg: cashAndBank >= 0 ? 'bg-green/10' : 'bg-red/10' },
              { label: 'Receivable (AR)', value: arOutstanding, color: 'text-blue', icon: Receipt, bg: 'bg-blue/10' },
              { label: 'Payable (AP)', value: apOutstanding, color: 'text-amber', icon: CreditCard, bg: 'bg-amber/10' },
            ].map((s) => (
              <div key={s.label} className="bg-card border border-border/50 rounded-2xl p-6 shadow-[0_2px_10px_rgb(0,0,0,0.02)] hover:shadow-md transition-shadow">
                <div className="flex items-center gap-3 mb-4">
                  <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${s.bg}`}>
                    <s.icon size={16} className={s.color} />
                  </div>
                  <p className="text-[12px] font-bold text-text2 uppercase tracking-wider m-0">{s.label}</p>
                </div>
                <p className={`font-mono text-3xl font-bold m-0 tracking-tight ${s.color}`}>
                  {inr(s.value)}
                </p>
              </div>
            ))}
          </div>

          {/* Quick add expense */}
          <div className="bg-card border border-border/50 rounded-2xl p-6 shadow-sm">
            <h3 className="font-bold text-[15px] text-text1 m-0 mb-4 flex items-center gap-2">
              <Plus size={18} className="text-blue" /> Quick Add Expense
            </h3>
            <div className="flex flex-wrap gap-3 items-center">
              <div className="relative flex-[1_1_200px]">
                <select
                  ref={quickAddRef}
                  className="w-full h-[42px] pl-4 pr-10 text-[14px] bg-bg border border-border/60 rounded-xl outline-none transition-all focus:border-blue focus:ring-2 focus:ring-blue/10 appearance-none text-text1 font-medium cursor-pointer"
                  value={quickAdd.expense_account_id}
                  onChange={(e) => setQuickAdd((p) => ({ ...p, expense_account_id: e.target.value }))}
                >
                  <option value="" disabled>Category…</option>
                  {expenseAccounts.map((a) => (
                    <option key={a.id} value={a.id}>{a.account_name}</option>
                  ))}
                </select>
                <div className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none text-text3">
                  <svg width="10" height="6" viewBox="0 0 12 8" fill="none"><path d="M1 1l5 5 5-5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" /></svg>
                </div>
              </div>
              
              <div className="relative flex-[1_1_160px]">
                <select
                  className="w-full h-[42px] pl-4 pr-10 text-[14px] bg-bg border border-border/60 rounded-xl outline-none transition-all focus:border-blue focus:ring-2 focus:ring-blue/10 appearance-none text-text1 font-medium cursor-pointer"
                  value={quickAdd.bank_account_id}
                  onChange={(e) => setQuickAdd((p) => ({ ...p, bank_account_id: e.target.value }))}
                >
                  <option value="" disabled>Paid from…</option>
                  {bankAccounts.map((a) => (
                    <option key={a.id} value={a.id}>{a.account_name}</option>
                  ))}
                </select>
                <div className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none text-text3">
                  <svg width="10" height="6" viewBox="0 0 12 8" fill="none"><path d="M1 1l5 5 5-5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" /></svg>
                </div>
              </div>

              <input
                className="w-[120px] h-[42px] px-4 text-[14px] bg-bg border border-border/60 rounded-xl outline-none transition-all focus:border-blue focus:ring-2 focus:ring-blue/10 text-text1 font-medium placeholder:text-text3"
                type="number"
                placeholder="Amount"
                value={quickAdd.amount}
                onChange={(e) => setQuickAdd((p) => ({ ...p, amount: e.target.value }))}
                onKeyDown={(e) => e.key === 'Enter' && canQuickAdd && quickAddMutation.mutate()}
              />
              
              <input
                className="w-[140px] h-[42px] px-4 text-[14px] bg-bg border border-border/60 rounded-xl outline-none transition-all focus:border-blue focus:ring-2 focus:ring-blue/10 text-text1 font-medium"
                type="date"
                value={quickAdd.date}
                onChange={(e) => setQuickAdd((p) => ({ ...p, date: e.target.value }))}
              />
              
              <input
                className="flex-[2_1_160px] h-[42px] px-4 text-[14px] bg-bg border border-border/60 rounded-xl outline-none transition-all focus:border-blue focus:ring-2 focus:ring-blue/10 text-text1 font-medium placeholder:text-text3"
                placeholder="Description (optional)"
                value={quickAdd.description}
                onChange={(e) => setQuickAdd((p) => ({ ...p, description: e.target.value }))}
                onKeyDown={(e) => e.key === 'Enter' && canQuickAdd && quickAddMutation.mutate()}
              />
              
              <button
                onClick={() => quickAddMutation.mutate()}
                disabled={!canQuickAdd || quickAddMutation.isPending}
                className="h-[42px] px-6 bg-blue text-white text-[14px] font-bold rounded-xl hover:bg-blue/90 hover:scale-105 active:scale-95 transition-all disabled:opacity-50 disabled:pointer-events-none disabled:hover:scale-100 shadow-sm"
              >
                {quickAddMutation.isPending ? 'Saving…' : 'Add Expense'}
              </button>
            </div>
            {quickAddMutation.isError && (
              <p className="text-red text-[13px] font-medium m-0 mt-3 animate-in fade-in">{(quickAddMutation.error as Error).message}</p>
            )}
          </div>

          {/* Recent activity */}
          <div className="bg-card border border-border/50 rounded-2xl overflow-hidden shadow-sm">
            <div className="p-6 border-b border-border/40 flex justify-between items-end">
              <div>
                <h3 className="font-bold text-[15px] text-text1 m-0 mb-1">Recent Expenses</h3>
                <p className="text-[12px] font-medium text-text2 m-0">Last 8 entries</p>
              </div>
            </div>
            
            <div className="overflow-x-auto custom-scrollbar">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="bg-bg/50 border-b border-border/40">
                    <th className="py-3 px-6 text-[11px] font-bold text-text2 uppercase tracking-wider whitespace-nowrap">Date</th>
                    <th className="py-3 px-6 text-[11px] font-bold text-text2 uppercase tracking-wider">Category</th>
                    <th className="py-3 px-6 text-[11px] font-bold text-text2 uppercase tracking-wider">Description</th>
                    <th className="py-3 px-6 text-[11px] font-bold text-text2 uppercase tracking-wider text-right">Amount</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/40">
                  {expenses.map((e) => (
                    <tr key={e.id} className="hover:bg-bg/50 transition-colors">
                      <td className="py-3.5 px-6 font-mono text-[12px] font-medium text-text2 whitespace-nowrap">{fmtDate(e.entry_date)}</td>
                      <td className="py-3.5 px-6 text-[13px] font-semibold text-text1">{e.category}</td>
                      <td className="py-3.5 px-6 text-[13px] text-text2">{e.narration || <span className="text-text3 italic">None</span>}</td>
                      <td className="py-3.5 px-6 font-mono text-[13px] font-bold text-text1 text-right">{inr(e.amount)}</td>
                    </tr>
                  ))}
                  {expenses.length === 0 && (
                    <tr>
                      <td colSpan={4} className="py-12 text-center text-text3 font-medium text-[14px]">
                        No expenses recorded yet
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {/* Pointer to the full app */}
          <div className="bg-blue/5 border border-blue/20 rounded-2xl p-6 flex justify-between items-center flex-wrap gap-4 group hover:border-blue/30 transition-colors">
            <div>
              <p className="font-bold text-[15px] text-blue m-0 mb-1.5 flex items-center gap-2">
                Need more power? <ExternalLink size={16} />
              </p>
              <p className="text-[13px] text-blue/80 font-medium m-0 leading-relaxed max-w-2xl">
                Chart of Accounts, Journal Entries, Bills, Banking, Invoices/AR, Reports, GST/TDS, Audit Trail, Period Locking
              </p>
            </div>
            <a 
              href={FULL_APP_URL} 
              target="_blank" 
              rel="noopener noreferrer" 
              className="px-6 py-2.5 bg-blue text-white rounded-xl text-[14px] font-bold hover:bg-blue/90 transition-all hover:scale-105 active:scale-95 shadow-sm whitespace-nowrap"
            >
              Open Accounting App
            </a>
          </div>
        </div>
      )}
    </div>
  )
}
