'use client'

import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useCbopSession } from '../../lib/session-context'
import { cbopFetch, ApiError } from '../../lib/api-client'
import { SlideOver } from '../../components/slide-over'
import { AccountForm } from './account-form'
import type { Account } from './types'
import { ACCOUNT_TYPE_ORDER, ACCOUNT_TYPE_LABELS } from './types'

const primaryBtn =
  'inline-flex items-center justify-center h-9 px-4 rounded-md bg-blue text-white text-sm font-medium hover:bg-blue/90 disabled:opacity-50 disabled:cursor-not-allowed'

export default function AccountsPage() {
  const session = useCbopSession()
  const companyId = session.activeCompanyId
  const isCeo = session.role === 'ceo' || session.role === 'creator'
  const queryClient = useQueryClient()

  const [showInactive, setShowInactive] = useState(false)
  const [filterText, setFilterText] = useState('')
  const [newOpen, setNewOpen] = useState(false)
  const [selected, setSelected] = useState<Account | null>(null)

  const accountsQuery = useQuery({
    queryKey: ['acct-accounts', companyId],
    queryFn: () =>
      cbopFetch<{ accounts: Account[] }>(`/api/accounting/accounts?company_id=${companyId}`, {
        activeCompanyId: companyId,
      }),
    enabled: !!companyId,
  })

  const seedMutation = useMutation({
    mutationFn: () =>
      cbopFetch<{ accounts: Account[] }>('/api/accounting/accounts/seed-defaults', {
        method: 'POST',
        activeCompanyId: companyId,
        body: { company_id: companyId },
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['acct-accounts', companyId] }),
  })

  const accounts = useMemo(() => accountsQuery.data?.accounts ?? [], [accountsQuery.data])

  const filtered = useMemo(() => {
    const q = filterText.trim().toLowerCase()
    return accounts.filter((a) => {
      if (!showInactive && !a.is_active) return false
      if (!q) return true
      return a.account_code.toLowerCase().includes(q) || a.account_name.toLowerCase().includes(q)
    })
  }, [accounts, filterText, showInactive])

  const grouped = useMemo(() => {
    const map = new Map<string, Account[]>()
    for (const type of ACCOUNT_TYPE_ORDER) map.set(type, [])
    for (const a of filtered) map.get(a.account_type)?.push(a)
    map.forEach((list) => list.sort((a, b) => a.account_code.localeCompare(b.account_code)))
    return map
  }, [filtered])

  function refetchAccounts() {
    queryClient.invalidateQueries({ queryKey: ['acct-accounts', companyId] })
  }

  if (!companyId) {
    return (
      <main className="p-6">
        <p className="text-sm text-text2">
          No active company selected. Switch companies from the main CBOP dashboard, then come back
          here.
        </p>
      </main>
    )
  }

  const activeCompanyName = session.companies.find((c) => c.id === companyId)?.name

  return (
    <main className="p-6 max-w-5xl">
      <div className="flex items-start justify-between mb-6">
        <div>
          <h1 className="font-display font-bold text-xl text-text1">Chart of Accounts</h1>
          {activeCompanyName && <p className="text-sm text-text2 mt-0.5">{activeCompanyName}</p>}
        </div>
        {accounts.length > 0 && (
          <button onClick={() => setNewOpen(true)} className={primaryBtn}>
            + New Account
          </button>
        )}
      </div>

      {accountsQuery.isLoading && <p className="text-sm text-text2">Loading chart of accounts...</p>}
      {accountsQuery.isError && (
        <p className="text-sm text-red">Failed to load the chart of accounts. Try refreshing.</p>
      )}

      {!accountsQuery.isLoading && !accountsQuery.isError && accounts.length === 0 && (
        <div className="rounded-lg border border-border bg-card p-8 text-center">
          <p className="font-display font-semibold text-text1">No chart of accounts yet</p>
          <p className="text-sm text-text2 mt-1.5 max-w-md mx-auto">
            This company has no accounts. Set up the standard Indian SMB chart (cash, bank,
            receivables, payables, GST input/output, TDS payable, and common revenue/expense
            categories) to start recording journal entries.
          </p>
          {isCeo ? (
            <>
              <button
                onClick={() => seedMutation.mutate()}
                disabled={seedMutation.isPending}
                className={`${primaryBtn} mt-4`}
              >
                {seedMutation.isPending ? 'Setting up...' : 'Set up default chart of accounts'}
              </button>
              {seedMutation.isError && (
                <p className="mt-2 text-xs text-red">
                  {seedMutation.error instanceof ApiError
                    ? seedMutation.error.message
                    : 'Something went wrong.'}
                </p>
              )}
            </>
          ) : (
            <p className="mt-4 text-xs text-text3">
              Ask a CEO or the creator account to set this up for this company.
            </p>
          )}
        </div>
      )}

      {accounts.length > 0 && (
        <>
          <div className="flex items-center gap-4 mb-4">
            <input
              value={filterText}
              onChange={(e) => setFilterText(e.target.value)}
              placeholder="Filter by code or name..."
              className="h-9 w-64 rounded-md border border-border bg-white px-3 text-sm text-text1 focus:outline-none focus:border-blue placeholder:text-text3"
            />
            <label className="flex items-center gap-1.5 text-xs text-text2">
              <input
                type="checkbox"
                checked={showInactive}
                onChange={(e) => setShowInactive(e.target.checked)}
              />
              Show inactive
            </label>
          </div>

          <div className="space-y-6">
            {ACCOUNT_TYPE_ORDER.map((type) => {
              const list = grouped.get(type) ?? []
              if (list.length === 0) return null
              return (
                <section key={type}>
                  <h2 className="font-display font-semibold text-sm text-text1 uppercase tracking-wide mb-2">
                    {ACCOUNT_TYPE_LABELS[type]}
                  </h2>
                  <div className="rounded-lg border border-border bg-card overflow-hidden overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-border text-left text-xs text-text3">
                          <th className="px-4 py-2 font-medium">Code</th>
                          <th className="px-4 py-2 font-medium">Name</th>
                          <th className="px-4 py-2 font-medium">Subtype</th>
                          <th className="px-4 py-2 font-medium">Normal Balance</th>
                          <th className="px-4 py-2 font-medium"></th>
                        </tr>
                      </thead>
                      <tbody>
                        {list.map((a) => (
                          <tr
                            key={a.id}
                            onClick={() => setSelected(a)}
                            className={`border-b border-border last:border-0 cursor-pointer hover:bg-bg transition-colors ${
                              !a.is_active ? 'opacity-50' : ''
                            }`}
                          >
                            <td className="px-4 py-2 font-mono text-text1">{a.account_code}</td>
                            <td className={`px-4 py-2 text-text1 ${a.is_group ? 'font-semibold' : ''}`}>
                              {a.account_name}
                              {a.is_group && (
                                <span className="ml-2 text-[10px] uppercase tracking-wide text-text3 font-normal">
                                  Group
                                </span>
                              )}
                            </td>
                            <td className="px-4 py-2 text-text2">{a.account_subtype || 'None'}</td>
                            <td className="px-4 py-2 text-text2 capitalize">{a.normal_balance}</td>
                            <td className="px-4 py-2 text-right">
                              {!a.is_active && (
                                <span className="text-[10px] uppercase tracking-wide text-red">
                                  Inactive
                                </span>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </section>
              )
            })}
          </div>
        </>
      )}

      <SlideOver isOpen={newOpen} onClose={() => setNewOpen(false)} title="New Account">
        <AccountForm
          mode="create"
          companyId={companyId}
          onDone={() => {
            setNewOpen(false)
            refetchAccounts()
          }}
          onCancel={() => setNewOpen(false)}
        />
      </SlideOver>

      <SlideOver
        isOpen={!!selected}
        onClose={() => setSelected(null)}
        title={selected ? `${selected.account_code} · ${selected.account_name}` : ''}
      >
        {selected && (
          <AccountForm
            mode="edit"
            companyId={companyId}
            account={selected}
            onDone={() => {
              setSelected(null)
              refetchAccounts()
            }}
            onCancel={() => setSelected(null)}
          />
        )}
      </SlideOver>
    </main>
  )
}
