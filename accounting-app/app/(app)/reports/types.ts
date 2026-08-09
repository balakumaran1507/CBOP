// Response shapes for GET /api/accounting/reports/* (api/routes/accounting.ts,
// "Reports (Slice 5)" section). Mirrors exactly what the server sends - most
// currency figures there are already parseFloat'd into numbers server-side
// (trial balance, P&L, balance sheet, aging, rollup), but a few pass straight
// through node-postgres numeric columns as strings (ledger debit/credit,
// day-book debit/credit, customer/vendor balances) - hence the string|number
// unions on exactly those fields. inr() in app/lib/format.ts accepts both.

export type AccountType = 'asset' | 'liability' | 'equity' | 'revenue' | 'expense'
export type NormalBalance = 'debit' | 'credit'

export interface TrialBalanceAccount {
  id: string
  account_code: string
  account_name: string
  account_type: AccountType
  normal_balance: NormalBalance
  debit: number
  credit: number
  balance: number
}

export interface TrialBalanceResponse {
  as_of: string
  accounts: TrialBalanceAccount[]
  totals: { debit: number; credit: number }
}

export interface PnlLine {
  account_code: string
  account_name: string
  amount: number
}

export interface ProfitAndLossResponse {
  from: string
  to: string
  revenue: PnlLine[]
  expenses: PnlLine[]
  total_revenue: number
  total_expenses: number
  net_profit: number
}

export interface BalanceSheetLine {
  account_code: string
  account_name: string
  amount: number
}

export interface BalanceSheetResponse {
  as_of: string
  assets: BalanceSheetLine[]
  liabilities: BalanceSheetLine[]
  equity: BalanceSheetLine[]
  net_income: number
  total_assets: number
  total_liabilities: number
  total_equity: number
  total_liabilities_and_equity: number
}

export interface LedgerLine {
  entry_date: string
  entry_no: string
  reference: string | null
  narration: string | null
  source_type: string
  debit: string | number
  credit: string | number
  running_balance: string | number
}

export interface LedgerResponse {
  account: { account_name: string; account_code: string; normal_balance: NormalBalance }
  from: string
  to: string
  lines: LedgerLine[]
}

export interface DayBookLine {
  id: string
  entry_no: string
  entry_date: string
  reference: string | null
  narration: string | null
  source_type: string
  account_code: string
  account_name: string
  debit: string | number
  credit: string | number
}

export interface DayBookResponse {
  from: string
  to: string
  lines: DayBookLine[]
}

export interface AgingBuckets {
  current: number
  d1_30: number
  d31_60: number
  d60_plus: number
}

export interface AgingResponse {
  buckets: AgingBuckets
  total_outstanding: number
}

export interface CustomerBalance {
  client_id: string
  client_name: string
  outstanding: string | number
  paid_total: string | number
}

export interface CustomerBalancesResponse {
  customers: CustomerBalance[]
}

export interface VendorBalance {
  vendor_name: string
  outstanding: string | number
  paid_total: string | number
}

export interface VendorBalancesResponse {
  vendors: VendorBalance[]
}

export interface RollupCompany {
  company_id: string
  company_name: string
  revenue: number
  expenses: number
  net_profit: number
  cash_and_bank: number
  ar_outstanding: number
  ap_outstanding: number
}

export interface RollupTotals {
  revenue: number
  expenses: number
  net_profit: number
  cash_and_bank: number
  ar_outstanding: number
  ap_outstanding: number
}

export interface RollupResponse {
  companies: RollupCompany[]
  totals: RollupTotals
}

// GST / TDS (Slice 6) - GET /api/accounting/reports/gstr1|gstr3b|tds-ledger.
// gstr1's b2b_invoices/hsn_summary and tds-ledger's deductions come straight
// off raw pg rows (no server-side parseFloat), hence string|number on their
// numeric fields - same pattern as LedgerLine/DayBookLine above. gstr3b's
// outward_taxable_supplies IS parseFloat'd server-side, so those are plain
// numbers.

export interface Gstr1B2bInvoice {
  invoice_no: string
  invoice_date: string
  counterparty_gstin: string | null
  hsn_sac_code: string | null
  taxable_value: string | number
  cgst_amount: string | number
  sgst_amount: string | number
  igst_amount: string | number
  cess_amount: string | number
  invoice_value: string | number
}

export interface Gstr1HsnSummary {
  hsn_sac_code: string
  invoice_count: string | number
  taxable_value: string | number
  cgst_amount: string | number
  sgst_amount: string | number
  igst_amount: string | number
}

export interface Gstr1Response {
  from: string
  to: string
  b2b_invoices: Gstr1B2bInvoice[]
  hsn_summary: Gstr1HsnSummary[]
}

export interface Gstr3bResponse {
  from: string
  to: string
  outward_taxable_supplies: {
    taxable_value: number
    cgst: number
    sgst: number
    igst: number
    cess: number
  }
  note: string
}

export interface TdsDeduction {
  vendor_name: string
  vendor_pan_or_gstin: string | null
  bill_no: string | null
  bill_date: string
  tds_section: string
  tds_rate: string | number
  taxable_value: string | number
  tds_amount: string | number
}

export interface TdsLedgerResponse {
  from: string
  to: string
  deductions: TdsDeduction[]
  total_tds: number
  by_section: Record<string, number>
}
