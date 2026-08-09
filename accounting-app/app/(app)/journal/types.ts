// Journal entry types, mirroring the exact response shapes of
// GET/POST/PATCH /api/accounting/journal-entries in api/routes/accounting.ts.
// debit/credit/total_debit are Postgres NUMERIC columns - node-postgres
// returns those as strings by default, so every numeric field here is typed
// permissively and always passed through inr() before rendering.

export type JournalStatus = 'draft' | 'posted' | 'void'

export interface JournalEntry {
  id: string
  company_id?: string
  entry_no: string
  entry_date: string
  reference: string | null
  narration: string | null
  source_type: string
  source_id: string | null
  status: JournalStatus
  posted_at: string | null
  voided_at: string | null
  void_reason: string | null
  reversal_of_id: string | null
  created_at: string
  total_debit: string | number
}

export interface JournalEntryLine {
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

// Shape of a line while being built/edited in the UI, before it's sent to
// the API. Debit/credit are kept as strings here (raw input values) so an
// empty field can render as "" rather than "0".
export interface DraftLine {
  key: string
  account_id: string
  debit: string
  credit: string
  description: string
}
