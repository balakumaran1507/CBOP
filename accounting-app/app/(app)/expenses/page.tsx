'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useCbopSession } from '../../lib/session-context'
import { cbopFetch, ApiError } from '../../lib/api-client'
import { inr, fmtDate, todayIso } from '../../lib/format'

// Rebuild of the old /accounting page's Tally-style quick-add expense row
// (app/(dashboard)/accounting/page.tsx in the main repo), ledger-backed this
// time: every submit posts a real journal entry (Dr expense account, Cr
// bank/cash account) via POST /api/accounting/expenses instead of writing a
// row to the old flat finance_expenses table. Same "press n to focus" muscle
// memory, same one-row-and-go feel - deliberately inline, not a slide-over,
// per the scope note in this task (a search-bar-style quick action, not a
// multi-field creation form).

interface Account {
  id: string
  account_code: string
  account_name: string
  account_type: string
  account_subtype: string | null
  is_active: boolean
}

interface BankAccount {
  id: string
  account_code: string
  account_name: string
  account_subtype: string
  balance: string
}

interface Expense {
  id: string
  entry_no: string
  entry_date: string
  narration: string | null
  reference: string | null
  created_at: string
  amount: string
  category: string
  account_id: string
}

const inputCls =
  'h-9 rounded-md border border-border bg-white px-2.5 text-sm text-text1 focus:outline-none focus:ring-1 focus:ring-blue focus:border-blue placeholder:text-text3 disabled:bg-bg disabled:text-text3'

export default function ExpensesPage() {
  const session = useCbopSession()
  const companyId = session.activeCompanyId
  const queryClient = useQueryClient()

  const categoryRef = useRef<HTMLSelectElement>(null)

  const [form, setForm] = useState({
    expense_account_id: '',
    amount: '',
    date: todayIso(),
    bank_account_id: '',
    description: '',
  })
  const [filter, setFilter] = useState('')
  const [formError, setFormError] = useState<string | null>(null)

  const accountsQuery = useQuery({
    queryKey: ['acct-accounts', companyId],
    queryFn: () => cbopFetch<{ accounts: Account[] }>(`/api/accounting/accounts?company_id=${companyId}`, { activeCompanyId: companyId }),
    enabled: !!companyId,
  })

  const bankAccountsQuery = useQuery({
    queryKey: ['acct-bank-accounts', companyId],
    queryFn: () => cbopFetch<{ accounts: BankAccount[] }>(`/api/accounting/bank-accounts?company_id=${companyId}`, { activeCompanyId: companyId }),
    enabled: !!companyId,
  })

  const expensesQuery = useQuery({
    queryKey: ['acct-expenses', companyId],
    queryFn: () => cbopFetch<{ expenses: Expense[] }>(`/api/accounting/expenses?company_id=${companyId}`, { activeCompanyId: companyId }),
    enabled: !!companyId,
  })

  const expenseAccounts = useMemo(
    () => (accountsQuery.data?.accounts ?? []).filter((a) => a.account_type === 'expense' && a.is_active && !a.account_subtype /* leaf accounts only would need is_group, filtered defensively below */),
    [accountsQuery.data]
  )
  // is_group isn't selected on this response shape in a way we filter on above -
  // fall back to the full expense-type list if the subtype filter produced
  // nothing (most seeded expense accounts have no subtype set).
  const categoryOptions = expenseAccounts.length > 0
    ? expenseAccounts
    : (accountsQuery.data?.accounts ?? []).filter((a) => a.account_type === 'expense' && a.is_active)

  const bankAccounts = useMemo(() => bankAccountsQuery.data?.accounts ?? [], [bankAccountsQuery.data])

  // Default the "paid from" picker to the first bank/cash account once loaded,
  // and default category to the first expense account - the old page always
  // had something pre-selected so Enter-to-submit worked from a cold row.
  useEffect(() => {
    if (!form.bank_account_id && bankAccounts.length > 0) {
      setForm((f) => (f.bank_account_id ? f : { ...f, bank_account_id: bankAccounts[0].id }))
    }
  }, [bankAccounts, form.bank_account_id])

  useEffect(() => {
    if (!form.expense_account_id && categoryOptions.length > 0) {
      setForm((f) => (f.expense_account_id ? f : { ...f, expense_account_id: categoryOptions[0].id }))
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [categoryOptions.length])

  // Tally-style shortcut: "n" anywhere on the page (outside an input/textarea/
  // select) jumps focus to the quick-add category field. Same guard pattern as
  // the old page's onKey handler.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const tag = (e.target as HTMLElement)?.tagName
      if (e.key === 'n' && !['INPUT', 'TEXTAREA', 'SELECT'].includes(tag)) {
        e.preventDefault()
        categoryRef.current?.focus()
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [])

  const createExpense = useMutation({
    mutationFn: () =>
      cbopFetch(`/api/accounting/expenses`, {
        method: 'POST',
        activeCompanyId: companyId,
        body: {
          company_id: companyId,
          date: form.date,
          expense_account_id: form.expense_account_id,
          bank_account_id: form.bank_account_id,
          amount: parseFloat(form.amount),
          description: form.description || undefined,
        },
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['acct-expenses', companyId] })
      queryClient.invalidateQueries({ queryKey: ['acct-bank-accounts', companyId] })
      setForm((f) => ({ ...f, amount: '', description: '' }))
      setFormError(null)
      categoryRef.current?.focus()
    },
    onError: (err) => {
      setFormError(err instanceof ApiError ? err.message : 'Could not save this expense. Try again.')
    },
  })

  function submit() {
    if (!form.expense_account_id || !form.amount || !form.bank_account_id) return
    const amt = parseFloat(form.amount)
    if (isNaN(amt) || amt <= 0) {
      setFormError('Amount must be a positive number')
      return
    }
    createExpense.mutate()
  }

  const filtered = (expensesQuery.data?.expenses ?? []).filter((e) => {
    if (!filter.trim()) return true
    const q = filter.toLowerCase()
    return e.category.toLowerCase().includes(q) || (e.narration ?? '').toLowerCase().includes(q)
  })

  const noAccountsYet = accountsQuery.isSuccess && (accountsQuery.data?.accounts.length ?? 0) === 0
  const noExpenseAccounts = accountsQuery.isSuccess && !noAccountsYet && categoryOptions.length === 0
  const noBankAccounts = bankAccountsQuery.isSuccess && bankAccounts.length === 0

  return (
    <main className="p-6 max-w-4xl">
      <h1 className="font-display font-bold text-xl text-text1">Expenses</h1>
      <p className="mt-1 text-sm text-text2">
        Day book of posted expenses - press <kbd className="rounded border border-border bg-card px-1 font-mono text-[11px]">n</kbd> anywhere to quick-add.
      </p>

      {(noAccountsYet || noExpenseAccounts) && (
        <div className="mt-5 rounded-lg border border-amber/30 bg-amber/5 p-4 text-sm text-text1">
          {noAccountsYet ? (
            <>
              This company has no chart of accounts set up yet, so there&apos;s nothing to post
              expenses against.
            </>
          ) : (
            <>This company&apos;s chart of accounts has no expense accounts yet.</>
          )}{' '}
          A CEO/creator can set up the defaults on the{' '}
          <Link href="/accounts" className="text-blue underline">
            Chart of Accounts
          </Link>{' '}
          page first.
        </div>
      )}

      {!noAccountsYet && !noExpenseAccounts && noBankAccounts && (
        <div className="mt-5 rounded-lg border border-amber/30 bg-amber/5 p-4 text-sm text-text1">
          No bank or cash accounts are set up yet, so there&apos;s nothing to pay expenses from. Add
          one on the{' '}
          <Link href="/accounts" className="text-blue underline">
            Chart of Accounts
          </Link>{' '}
          page (account subtype &quot;bank&quot; or &quot;cash&quot;).
        </div>
      )}

      {!noAccountsYet && !noExpenseAccounts && !noBankAccounts && (
        <div className="mt-5 rounded-lg border border-border bg-card p-3">
          <div className="flex flex-wrap items-center gap-2">
            <select
              ref={categoryRef}
              className={`${inputCls} min-w-[180px] flex-1`}
              value={form.expense_account_id}
              onChange={(e) => setForm((f) => ({ ...f, expense_account_id: e.target.value }))}
              onKeyDown={(e) => e.key === 'Enter' && submit()}
            >
              {categoryOptions.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.account_name}
                </option>
              ))}
            </select>
            <input
              className={`${inputCls} w-28 font-mono`}
              type="number"
              step="0.01"
              min="0"
              placeholder="Amount"
              value={form.amount}
              onChange={(e) => setForm((f) => ({ ...f, amount: e.target.value }))}
              onKeyDown={(e) => e.key === 'Enter' && submit()}
            />
            <input
              className={`${inputCls} w-36 font-mono`}
              type="date"
              value={form.date}
              onChange={(e) => setForm((f) => ({ ...f, date: e.target.value }))}
            />
            <select
              className={`${inputCls} w-40`}
              value={form.bank_account_id}
              onChange={(e) => setForm((f) => ({ ...f, bank_account_id: e.target.value }))}
            >
              {bankAccounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.account_name}
                </option>
              ))}
            </select>
            <input
              className={`${inputCls} min-w-[160px] flex-1`}
              placeholder="Description (optional)"
              value={form.description}
              onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
              onKeyDown={(e) => e.key === 'Enter' && submit()}
            />
            <button
              onClick={submit}
              disabled={createExpense.isPending || !form.expense_account_id || !form.amount || !form.bank_account_id}
              className="h-9 shrink-0 rounded-md bg-blue px-4 text-sm font-medium text-white transition-colors hover:bg-blue/90 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {createExpense.isPending ? 'Saving…' : 'Add'}
            </button>
          </div>
          {formError && <p className="mt-2 text-xs text-red">{formError}</p>}
        </div>
      )}

      <div className="mt-6">
        <input
          className={`${inputCls} w-64`}
          placeholder="Filter by category or description"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
        />
      </div>

      <div className="mt-3 overflow-hidden rounded-lg border border-border bg-card">
        {expensesQuery.isLoading ? (
          <div className="p-6 text-center text-sm text-text2">Loading…</div>
        ) : filtered.length === 0 ? (
          <div className="p-6 text-center text-sm text-text2">
            {expensesQuery.data?.expenses.length ? 'No expenses match this filter.' : 'No expenses posted yet.'}
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-[11px] uppercase tracking-wide text-text3">
                <th className="px-4 py-2 font-medium">Date</th>
                <th className="px-4 py-2 font-medium">Category</th>
                <th className="px-4 py-2 font-medium">Description</th>
                <th className="px-4 py-2 text-right font-medium">Amount</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((e) => (
                <tr key={e.id} className="border-b border-border last:border-0 hover:bg-bg">
                  <td className="whitespace-nowrap px-4 py-2 font-mono text-text2">{fmtDate(e.entry_date)}</td>
                  <td className="px-4 py-2 text-text1">{e.category}</td>
                  <td className="px-4 py-2 text-text2">{e.narration || '—'}</td>
                  <td className="whitespace-nowrap px-4 py-2 text-right font-mono text-text1">{inr(e.amount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </main>
  )
}
