'use client'

import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { ArrowRightLeft, Landmark, Wallet } from 'lucide-react'
import { useCbopSession } from '../../lib/session-context'
import { cbopFetch, ApiError } from '../../lib/api-client'
import { inr, fmtDate, todayIso } from '../../lib/format'
import { SlideOver } from '../../components/slide-over'

// Bank & Cash. API contract: api/routes/accounting.ts's
// /api/accounting/bank-accounts* and /api/accounting/transfers routes.
// Bank/cash "accounts" here are just acct_chart_of_accounts rows with
// account_subtype 'bank' or 'cash' - there is no separate bank-account table,
// see docs/modules/ACCOUNTING_Build_Plan.md's R&D reasoning.

interface BankAccount {
  id: string
  account_code: string
  account_name: string
  account_subtype: 'bank' | 'cash'
  balance: string | number
}

interface RegisterLine {
  entry_date: string
  entry_no: string
  reference: string | null
  narration: string | null
  source_type: string
  debit: string | number
  credit: string | number
  running_balance: string | number
}

export default function BankingPage() {
  const session = useCbopSession()
  const queryClient = useQueryClient()
  const companyId = session.activeCompanyId ?? session.companies[0]?.id ?? null

  const [selectedAccount, setSelectedAccount] = useState<BankAccount | null>(null)
  const [transferOpen, setTransferOpen] = useState(false)

  const accountsQuery = useQuery({
    queryKey: ['bank-accounts', companyId],
    queryFn: () =>
      cbopFetch<{ accounts: BankAccount[] }>(`/api/accounting/bank-accounts?company_id=${companyId}`, {
        activeCompanyId: companyId,
      }),
    enabled: !!companyId,
  })

  const accounts = accountsQuery.data?.accounts ?? []

  function invalidateAccounts() {
    queryClient.invalidateQueries({ queryKey: ['bank-accounts', companyId] })
    queryClient.invalidateQueries({ queryKey: ['bank-register'] })
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
        <h1 className="font-display font-bold text-xl text-text1">Bank &amp; Cash</h1>
        <button
          onClick={() => setTransferOpen(true)}
          className="inline-flex items-center gap-1.5 rounded-md bg-blue px-3 py-2 text-sm font-medium text-white hover:bg-blue/90"
        >
          <ArrowRightLeft size={16} />
          Transfer Funds
        </button>
      </div>

      {accountsQuery.isLoading && <p className="text-sm text-text3">Loading...</p>}
      {accountsQuery.isError && (
        <p className="text-sm text-red">{(accountsQuery.error as Error)?.message ?? 'Failed to load accounts'}</p>
      )}
      {!accountsQuery.isLoading && !accountsQuery.isError && accounts.length === 0 && (
        <p className="text-sm text-text3">No bank or cash accounts found for this company.</p>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {accounts.map((account) => {
          const balance = typeof account.balance === 'string' ? parseFloat(account.balance) : account.balance
          const negative = balance < 0
          return (
            <button
              key={account.id}
              onClick={() => setSelectedAccount(account)}
              className="text-left rounded-lg border border-border bg-card p-4 hover:border-blue transition-colors"
            >
              <div className="flex items-center gap-2 mb-2 text-text3">
                {account.account_subtype === 'bank' ? <Landmark size={15} /> : <Wallet size={15} />}
                <span className="text-[11px] uppercase tracking-wide">{account.account_subtype}</span>
              </div>
              <p className="font-inter text-sm text-text1 mb-1">{account.account_name}</p>
              <p className="font-mono text-xs text-text3 mb-3">{account.account_code}</p>
              <p className={`font-mono text-lg ${negative ? 'text-red' : 'text-text1'}`}>{inr(account.balance)}</p>
            </button>
          )
        })}
      </div>

      <RegisterSlideOver
        account={selectedAccount}
        onClose={() => setSelectedAccount(null)}
        companyId={companyId}
      />

      <TransferFundsSlideOver
        isOpen={transferOpen}
        onClose={() => setTransferOpen(false)}
        companyId={companyId}
        accounts={accounts}
        onCreated={() => {
          setTransferOpen(false)
          invalidateAccounts()
        }}
      />
    </main>
  )
}

// ── Register (ledger for one account) ───────────────────────────────────────

function RegisterSlideOver({
  account,
  onClose,
  companyId,
}: {
  account: BankAccount | null
  onClose: () => void
  companyId: string
}) {
  const registerQuery = useQuery({
    queryKey: ['bank-register', account?.id],
    queryFn: () =>
      cbopFetch<{ account_name: string; lines: RegisterLine[] }>(
        `/api/accounting/bank-accounts/${account?.id}/register`,
        { activeCompanyId: companyId }
      ),
    enabled: !!account,
  })

  const lines = registerQuery.data?.lines ?? []

  return (
    <SlideOver isOpen={!!account} onClose={onClose} title={account ? account.account_name : 'Register'} width="lg">
      <div className="flex-1 overflow-auto px-6 py-5">
        {account && (
          <p className="text-xs text-text3 mb-4">
            <span className="font-mono">{account.account_code}</span> · Balance{' '}
            <span className="font-mono text-text1">{inr(account.balance)}</span>
          </p>
        )}

        {registerQuery.isLoading && <p className="text-sm text-text3">Loading register...</p>}
        {registerQuery.isError && <p className="text-sm text-red">Failed to load register</p>}
        {!registerQuery.isLoading && !registerQuery.isError && lines.length === 0 && (
          <p className="text-sm text-text3">No posted transactions on this account yet.</p>
        )}

        {lines.length > 0 && (
          <div className="overflow-x-auto rounded-lg border border-border">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-[11px] uppercase tracking-wide text-text3">
                  <th className="px-3 py-2 font-medium">Date</th>
                  <th className="px-3 py-2 font-medium">Entry No.</th>
                  <th className="px-3 py-2 font-medium">Reference / Narration</th>
                  <th className="px-3 py-2 font-medium text-right">Debit</th>
                  <th className="px-3 py-2 font-medium text-right">Credit</th>
                  <th className="px-3 py-2 font-medium text-right">Balance</th>
                </tr>
              </thead>
              <tbody>
                {lines.map((line, i) => (
                  <tr key={i} className="border-b border-border last:border-0">
                    <td className="px-3 py-2 font-mono text-text2 whitespace-nowrap">{fmtDate(line.entry_date)}</td>
                    <td className="px-3 py-2 font-mono text-text2 whitespace-nowrap">{line.entry_no}</td>
                    <td className="px-3 py-2 text-text1">{line.narration || line.reference || '-'}</td>
                    <td className="px-3 py-2 font-mono text-text1 text-right">
                      {Number(line.debit) > 0 ? inr(line.debit) : ''}
                    </td>
                    <td className="px-3 py-2 font-mono text-text1 text-right">
                      {Number(line.credit) > 0 ? inr(line.credit) : ''}
                    </td>
                    <td className="px-3 py-2 font-mono text-text1 text-right">{inr(line.running_balance)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </SlideOver>
  )
}

// ── Transfer Funds ───────────────────────────────────────────────────────────

function TransferFundsSlideOver({
  isOpen,
  onClose,
  companyId,
  accounts,
  onCreated,
}: {
  isOpen: boolean
  onClose: () => void
  companyId: string
  accounts: BankAccount[]
  onCreated: () => void
}) {
  const [fromAccountId, setFromAccountId] = useState('')
  const [toAccountId, setToAccountId] = useState('')
  const [amount, setAmount] = useState('')
  const [date, setDate] = useState(todayIso())
  const [description, setDescription] = useState('')
  const [error, setError] = useState<string | null>(null)

  const transferMutation = useMutation({
    mutationFn: () =>
      cbopFetch('/api/accounting/transfers', {
        method: 'POST',
        activeCompanyId: companyId,
        body: {
          company_id: companyId,
          date,
          from_account_id: fromAccountId,
          to_account_id: toAccountId,
          amount,
          description: description || undefined,
        },
      }),
    onSuccess: () => {
      resetForm()
      onCreated()
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : 'Failed to create transfer'),
  })

  function resetForm() {
    setFromAccountId('')
    setToAccountId('')
    setAmount('')
    setDate(todayIso())
    setDescription('')
    setError(null)
  }

  function handleClose() {
    resetForm()
    onClose()
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    if (!fromAccountId || !toAccountId) return setError('Select both a from and a to account')
    if (fromAccountId === toAccountId) return setError('From and to accounts must be different')
    const amt = parseFloat(amount)
    if (isNaN(amt) || amt <= 0) return setError('Amount must be a positive number')
    if (!date) return setError('Date is required')
    transferMutation.mutate()
  }

  return (
    <SlideOver isOpen={isOpen} onClose={handleClose} title="Transfer Funds">
      <form onSubmit={handleSubmit} className="flex flex-1 flex-col overflow-hidden">
        <div className="flex-1 overflow-auto px-6 py-5 flex flex-col gap-4">
          {error && <p className="text-sm text-red">{error}</p>}

          <label className="flex flex-col gap-1">
            <span className="text-xs font-medium text-text2">From account</span>
            <select
              value={fromAccountId}
              onChange={(e) => setFromAccountId(e.target.value)}
              className="h-9 rounded-md border border-border px-3 text-sm text-text1 focus:outline-none focus:ring-1 focus:ring-blue"
              required
            >
              <option value="">Select an account</option>
              {accounts.map((a) => (
                <option key={a.id} value={a.id} disabled={a.id === toAccountId}>
                  {a.account_code} — {a.account_name}
                </option>
              ))}
            </select>
          </label>

          <label className="flex flex-col gap-1">
            <span className="text-xs font-medium text-text2">To account</span>
            <select
              value={toAccountId}
              onChange={(e) => setToAccountId(e.target.value)}
              className="h-9 rounded-md border border-border px-3 text-sm text-text1 focus:outline-none focus:ring-1 focus:ring-blue"
              required
            >
              <option value="">Select an account</option>
              {accounts.map((a) => (
                <option key={a.id} value={a.id} disabled={a.id === fromAccountId}>
                  {a.account_code} — {a.account_name}
                </option>
              ))}
            </select>
          </label>

          {fromAccountId && toAccountId && fromAccountId === toAccountId && (
            <p className="text-xs text-red">From and to accounts must be different.</p>
          )}

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
            <span className="text-xs font-medium text-text2">Date</span>
            <input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              className="h-9 rounded-md border border-border px-3 text-sm font-mono text-text1 focus:outline-none focus:ring-1 focus:ring-blue"
              required
            />
          </label>

          <label className="flex flex-col gap-1">
            <span className="text-xs font-medium text-text2">Description (optional)</span>
            <input
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="h-9 rounded-md border border-border px-3 text-sm text-text1 focus:outline-none focus:ring-1 focus:ring-blue"
            />
          </label>
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
            disabled={transferMutation.isPending || (!!fromAccountId && fromAccountId === toAccountId)}
            className="flex-1 rounded-md bg-blue px-3 py-2 text-sm font-medium text-white hover:bg-blue/90 disabled:opacity-60"
          >
            {transferMutation.isPending ? 'Transferring...' : 'Transfer Funds'}
          </button>
        </div>
      </form>
    </SlideOver>
  )
}
