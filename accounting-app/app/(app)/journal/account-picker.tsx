'use client'

import { useMemo, useState } from 'react'
import type { Account } from '../accounts/types'

interface AccountPickerProps {
  accounts: Account[]
  value: string
  onChange: (accountId: string) => void
}

/**
 * Minimal searchable select over the chart of accounts, used by the journal
 * entry line builder. No external combobox dependency - typing filters by
 * code or name, clicking a result selects it. `accounts` is expected to
 * already be filtered to postable accounts (active, not is_group) by the
 * caller.
 */
export function AccountPicker({ accounts, value, onChange }: AccountPickerProps) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')

  const selected = accounts.find((a) => a.id === value) || null

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return accounts
    return accounts.filter(
      (a) => a.account_code.toLowerCase().includes(q) || a.account_name.toLowerCase().includes(q)
    )
  }, [accounts, query])

  return (
    <div className="relative">
      <input
        value={open ? query : selected ? `${selected.account_code} · ${selected.account_name}` : ''}
        onChange={(e) => setQuery(e.target.value)}
        onFocus={() => {
          setOpen(true)
          setQuery('')
        }}
        onBlur={() => setTimeout(() => setOpen(false), 120)}
        placeholder="Search account..."
        className="w-full h-9 rounded-md border border-border bg-white px-3 text-sm text-text1 focus:outline-none focus:border-blue placeholder:text-text3"
      />
      {open && (
        <div className="absolute z-10 mt-1 w-full max-h-56 overflow-auto rounded-md border border-border bg-white shadow-lg">
          {filtered.length === 0 && <p className="px-3 py-2 text-xs text-text3">No matching accounts</p>}
          {filtered.map((a) => (
            <button
              key={a.id}
              type="button"
              onMouseDown={(e) => {
                e.preventDefault()
                onChange(a.id)
                setOpen(false)
                setQuery('')
              }}
              className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm hover:bg-bg"
            >
              <span className="font-mono text-xs text-text2 shrink-0">{a.account_code}</span>
              <span className="text-text1 truncate">{a.account_name}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
