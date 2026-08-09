'use client'

import { useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { cbopFetch, ApiError } from '../../lib/api-client'
import type { Account, AccountType, NormalBalance } from './types'
import { ACCOUNT_TYPE_ORDER, ACCOUNT_TYPE_LABELS, SUGGESTED_NORMAL_BALANCE } from './types'

const inputCls =
  'w-full h-9 rounded-md border border-border bg-white px-3 text-sm text-text1 focus:outline-none focus:border-blue placeholder:text-text3'
const labelCls = 'block text-xs font-medium text-text2 mb-1'
const primaryBtn =
  'inline-flex items-center justify-center h-9 px-4 rounded-md bg-blue text-white text-sm font-medium hover:bg-blue/90 disabled:opacity-50 disabled:cursor-not-allowed'
const secondaryBtn =
  'inline-flex items-center justify-center h-9 px-4 rounded-md border border-border text-text1 text-sm font-medium hover:bg-bg'

interface AccountFormProps {
  mode: 'create' | 'edit'
  companyId: string
  account?: Account
  onDone: () => void
  onCancel: () => void
}

/**
 * Slide-over body for both "New Account" and the account-detail edit form.
 * In edit mode, account_code / account_type / normal_balance render as
 * read-only labels - the API's PATCH handler intentionally rejects changes
 * to those fields once an account exists.
 */
export function AccountForm({ mode, companyId, account, onDone, onCancel }: AccountFormProps) {
  const [accountCode, setAccountCode] = useState(account?.account_code ?? '')
  const [accountName, setAccountName] = useState(account?.account_name ?? '')
  const [accountType, setAccountType] = useState<AccountType>(account?.account_type ?? 'asset')
  const [accountSubtype, setAccountSubtype] = useState(account?.account_subtype ?? '')
  const [normalBalance, setNormalBalance] = useState<NormalBalance>(
    account?.normal_balance ?? SUGGESTED_NORMAL_BALANCE.asset
  )
  const [normalBalanceTouched, setNormalBalanceTouched] = useState(false)
  const [isGroup, setIsGroup] = useState(account?.is_group ?? false)
  const [isActive, setIsActive] = useState(account?.is_active ?? true)
  const [description, setDescription] = useState(account?.description ?? '')

  function handleTypeChange(next: AccountType) {
    setAccountType(next)
    if (!normalBalanceTouched) setNormalBalance(SUGGESTED_NORMAL_BALANCE[next])
  }

  const createMutation = useMutation({
    mutationFn: () =>
      cbopFetch<{ account: Account }>('/api/accounting/accounts', {
        method: 'POST',
        activeCompanyId: companyId,
        body: {
          company_id: companyId,
          account_code: accountCode.trim(),
          account_name: accountName.trim(),
          account_type: accountType,
          account_subtype: accountSubtype.trim() || undefined,
          normal_balance: normalBalance,
          is_group: isGroup,
          description: description.trim() || undefined,
        },
      }),
    onSuccess: onDone,
  })

  const updateMutation = useMutation({
    mutationFn: () =>
      cbopFetch<{ account: Account }>(`/api/accounting/accounts/${account!.id}`, {
        method: 'PATCH',
        activeCompanyId: companyId,
        body: {
          account_name: accountName.trim(),
          account_subtype: accountSubtype.trim() || null,
          description: description.trim() || null,
          is_active: isActive,
        },
      }),
    onSuccess: onDone,
  })

  const pending = createMutation.isPending || updateMutation.isPending
  const error = createMutation.error ?? updateMutation.error

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (mode === 'create') createMutation.mutate()
    else updateMutation.mutate()
  }

  return (
    <form onSubmit={handleSubmit} className="flex-1 flex flex-col min-h-0">
      <div className="flex-1 overflow-auto px-6 py-5 flex flex-col gap-4">
        {mode === 'create' ? (
          <div>
            <label className={labelCls}>Account code</label>
            <input
              className={`${inputCls} font-mono`}
              value={accountCode}
              onChange={(e) => setAccountCode(e.target.value)}
              placeholder="e.g. 1010"
              required
            />
          </div>
        ) : (
          <div className="rounded-md border border-border bg-bg px-3 py-2.5">
            <p className="text-[11px] uppercase tracking-wide text-text3 mb-1.5">
              Code, type and normal balance are permanent
            </p>
            <div className="flex flex-wrap gap-x-6 gap-y-1 text-sm">
              <span>
                <span className="text-text3">Code </span>
                <span className="font-mono text-text1">{account!.account_code}</span>
              </span>
              <span>
                <span className="text-text3">Type </span>
                <span className="text-text1 capitalize">{account!.account_type}</span>
              </span>
              <span>
                <span className="text-text3">Normal balance </span>
                <span className="text-text1 capitalize">{account!.normal_balance}</span>
              </span>
            </div>
            <p className="text-[11px] text-text3 mt-1.5">
              Locked once created - posted journal lines and the trial balance depend on these
              never changing.
            </p>
          </div>
        )}

        <div>
          <label className={labelCls}>Account name</label>
          <input
            className={inputCls}
            value={accountName}
            onChange={(e) => setAccountName(e.target.value)}
            placeholder="e.g. Cash in Hand"
            required
          />
        </div>

        {mode === 'create' && (
          <div>
            <label className={labelCls}>Account type</label>
            <select
              className={inputCls}
              value={accountType}
              onChange={(e) => handleTypeChange(e.target.value as AccountType)}
            >
              {ACCOUNT_TYPE_ORDER.map((t) => (
                <option key={t} value={t}>
                  {ACCOUNT_TYPE_LABELS[t]}
                </option>
              ))}
            </select>
          </div>
        )}

        <div>
          <label className={labelCls}>Subtype (optional)</label>
          <input
            className={inputCls}
            value={accountSubtype}
            onChange={(e) => setAccountSubtype(e.target.value)}
            placeholder="e.g. current_asset, cogs"
          />
          <p className="text-[11px] text-text3 mt-1">Free text, used for grouping/reporting only.</p>
        </div>

        {mode === 'create' && (
          <div>
            <label className={labelCls}>Normal balance</label>
            <select
              className={inputCls}
              value={normalBalance}
              onChange={(e) => {
                setNormalBalanceTouched(true)
                setNormalBalance(e.target.value as NormalBalance)
              }}
            >
              <option value="debit">Debit</option>
              <option value="credit">Credit</option>
            </select>
            <p className="text-[11px] text-text3 mt-1">
              Suggested from account type - override for contra accounts (e.g. Accumulated
              Depreciation).
            </p>
          </div>
        )}

        {mode === 'create' && (
          <label className="flex items-center gap-2 text-sm text-text1">
            <input type="checkbox" checked={isGroup} onChange={(e) => setIsGroup(e.target.checked)} />
            Group / header account (not directly postable)
          </label>
        )}

        {mode === 'edit' && (
          <label className="flex items-center gap-2 text-sm text-text1">
            <input type="checkbox" checked={isActive} onChange={(e) => setIsActive(e.target.checked)} />
            Active
          </label>
        )}

        <div>
          <label className={labelCls}>Description (optional)</label>
          <textarea
            className={`${inputCls} h-20 py-2 resize-none`}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
        </div>

        {error && (
          <p className="text-xs text-red">{error instanceof ApiError ? error.message : 'Something went wrong.'}</p>
        )}
      </div>

      <div className="flex gap-3 px-6 py-4 border-t border-border shrink-0">
        <button type="button" onClick={onCancel} className={secondaryBtn}>
          Cancel
        </button>
        <button type="submit" disabled={pending} className={primaryBtn}>
          {pending ? 'Saving...' : mode === 'create' ? 'Create account' : 'Save changes'}
        </button>
      </div>
    </form>
  )
}
