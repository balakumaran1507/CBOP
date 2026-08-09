// Chart-of-accounts types, mirroring the exact response shape of
// GET/POST/PATCH /api/accounting/accounts in api/routes/accounting.ts.
// account_code/account_type/normal_balance are set at creation and never
// editable afterwards (see the PATCH handler) - they're load-bearing for
// every posted journal line and the trial balance.

export type AccountType = 'asset' | 'liability' | 'equity' | 'revenue' | 'expense'
export type NormalBalance = 'debit' | 'credit'

export interface Account {
  id: string
  parent_id: string | null
  account_code: string
  account_name: string
  account_type: AccountType
  account_subtype: string | null
  normal_balance: NormalBalance
  is_group: boolean
  is_active: boolean
  description: string | null
  created_at: string
  updated_at: string
}

export const ACCOUNT_TYPE_ORDER: AccountType[] = ['asset', 'liability', 'equity', 'revenue', 'expense']

export const ACCOUNT_TYPE_LABELS: Record<AccountType, string> = {
  asset: 'Assets',
  liability: 'Liabilities',
  equity: 'Equity',
  revenue: 'Revenue',
  expense: 'Expenses',
}

// Debit-normal for asset/expense, credit-normal for liability/equity/revenue -
// the standard accounting convention. The New Account form pre-fills this on
// account_type change but always lets the user override it (contra accounts,
// e.g. Accumulated Depreciation, legitimately differ from their group's norm).
export const SUGGESTED_NORMAL_BALANCE: Record<AccountType, NormalBalance> = {
  asset: 'debit',
  liability: 'credit',
  equity: 'credit',
  revenue: 'credit',
  expense: 'debit',
}
