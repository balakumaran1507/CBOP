'use client'

import { useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { X, Check, AlertCircle } from 'lucide-react'
import { cbopFetch, ApiError } from '../../lib/api-client'
import { todayIso, inr } from '../../lib/format'
import type { Account } from '../accounts/types'
import { AccountPicker } from './account-picker'
import type { DraftLine, JournalEntry, JournalEntryLine } from './types'

const inputCls =
  'w-full h-9 rounded-md border border-border bg-white px-3 text-sm text-text1 focus:outline-none focus:border-blue placeholder:text-text3'
const labelCls = 'block text-xs font-medium text-text2 mb-1'
const primaryBtn =
  'inline-flex items-center justify-center h-9 px-4 rounded-md bg-blue text-white text-sm font-medium hover:bg-blue/90 disabled:opacity-50 disabled:cursor-not-allowed'
const secondaryBtn =
  'inline-flex items-center justify-center h-9 px-4 rounded-md border border-border text-text1 text-sm font-medium hover:bg-bg'

let keyCounter = 0
function makeKey(): string {
  keyCounter += 1
  return `line-${keyCounter}-${Date.now()}`
}

function emptyLine(): DraftLine {
  return { key: makeKey(), account_id: '', debit: '', credit: '', description: '' }
}

function lineFromExisting(l: JournalEntryLine): DraftLine {
  return {
    key: makeKey(),
    account_id: l.account_id,
    debit: Number(l.debit) > 0 ? String(l.debit) : '',
    credit: Number(l.credit) > 0 ? String(l.credit) : '',
    description: l.description ?? '',
  }
}

interface EntryBuilderProps {
  mode: 'create' | 'edit'
  companyId: string
  accounts: Account[]
  existing?: { entry: JournalEntry; lines: JournalEntryLine[] }
  onDone: () => void
  onCancel: () => void
}

/**
 * New / edit journal entry slide-over body - the multi-line ledger builder.
 * Always submits as a draft (posting is a separate explicit step from the
 * entry detail view), matching the API's own two-step design.
 */
export function EntryBuilder({ mode, companyId, accounts, existing, onDone, onCancel }: EntryBuilderProps) {
  const postableAccounts = accounts.filter((a) => a.is_active && !a.is_group)

  const [entryDate, setEntryDate] = useState(existing?.entry.entry_date.slice(0, 10) ?? todayIso())
  const [reference, setReference] = useState(existing?.entry.reference ?? '')
  const [narration, setNarration] = useState(existing?.entry.narration ?? '')
  const [lines, setLines] = useState<DraftLine[]>(
    existing ? existing.lines.map(lineFromExisting) : [emptyLine(), emptyLine()]
  )
  const [validationError, setValidationError] = useState<string | null>(null)

  function updateLine(key: string, patch: Partial<DraftLine>) {
    setLines((prev) => prev.map((l) => (l.key === key ? { ...l, ...patch } : l)))
  }

  function setDebit(key: string, value: string) {
    updateLine(key, { debit: value, credit: value ? '' : lines.find((l) => l.key === key)?.credit ?? '' })
  }

  function setCredit(key: string, value: string) {
    updateLine(key, { credit: value, debit: value ? '' : lines.find((l) => l.key === key)?.debit ?? '' })
  }

  function addLine() {
    setLines((prev) => [...prev, emptyLine()])
  }

  function removeLine(key: string) {
    setLines((prev) => (prev.length <= 2 ? prev : prev.filter((l) => l.key !== key)))
  }

  const totalDebit = lines.reduce((sum, l) => sum + (parseFloat(l.debit) || 0), 0)
  const totalCredit = lines.reduce((sum, l) => sum + (parseFloat(l.credit) || 0), 0)
  const diff = Math.round((totalDebit - totalCredit) * 100) / 100
  const balanced = diff === 0 && totalDebit > 0

  const mutation = useMutation({
    mutationFn: () => {
      const payloadLines = lines.map((l) => ({
        account_id: l.account_id,
        debit: parseFloat(l.debit) || 0,
        credit: parseFloat(l.credit) || 0,
        description: l.description.trim() || undefined,
      }))
      if (mode === 'create') {
        return cbopFetch<{ entry: JournalEntry }>('/api/accounting/journal-entries', {
          method: 'POST',
          activeCompanyId: companyId,
          body: {
            company_id: companyId,
            entry_date: entryDate,
            reference: reference.trim() || undefined,
            narration: narration.trim() || undefined,
            lines: payloadLines,
          },
        })
      }
      return cbopFetch<{ entry: JournalEntry }>(`/api/accounting/journal-entries/${existing!.entry.id}`, {
        method: 'PATCH',
        activeCompanyId: companyId,
        body: {
          entry_date: entryDate,
          reference: reference.trim() || undefined,
          narration: narration.trim() || undefined,
          lines: payloadLines,
        },
      })
    },
    onSuccess: onDone,
  })

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setValidationError(null)
    if (lines.some((l) => !l.account_id)) {
      setValidationError('Every line needs an account.')
      return
    }
    if (lines.some((l) => !parseFloat(l.debit) && !parseFloat(l.credit))) {
      setValidationError('Every line needs a debit or a credit amount.')
      return
    }
    if (!balanced) {
      setValidationError(`Entry does not balance: debits ${inr(totalDebit)} vs credits ${inr(totalCredit)}.`)
      return
    }
    mutation.mutate()
  }

  const submitError = mutation.error instanceof ApiError ? mutation.error.message : null

  return (
    <form onSubmit={handleSubmit} className="flex-1 flex flex-col min-h-0">
      <div className="flex-1 overflow-auto px-6 py-5 flex flex-col gap-4">
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className={labelCls}>Entry date</label>
            <input
              type="date"
              className={`${inputCls} font-mono`}
              value={entryDate}
              onChange={(e) => setEntryDate(e.target.value)}
              required
            />
          </div>
          <div>
            <label className={labelCls}>Reference (optional)</label>
            <input
              className={inputCls}
              value={reference}
              onChange={(e) => setReference(e.target.value)}
              placeholder="e.g. Invoice ETH-2026-0001"
            />
          </div>
        </div>

        <div>
          <label className={labelCls}>Narration (optional)</label>
          <input
            className={inputCls}
            value={narration}
            onChange={(e) => setNarration(e.target.value)}
            placeholder="What is this entry for?"
          />
        </div>

        <div>
          <div className="flex items-center justify-between mb-2">
            <label className={labelCls + ' mb-0'}>Lines</label>
            <button type="button" onClick={addLine} className="text-xs text-blue font-medium hover:underline">
              + Add Line
            </button>
          </div>

          <div className="flex flex-col gap-2">
            {lines.map((line, i) => (
              <div key={line.key} className="rounded-md border border-border p-2.5 flex flex-col gap-2">
                <div className="flex items-center gap-2">
                  <span className="text-[11px] text-text3 w-4 shrink-0">{i + 1}</span>
                  <div className="flex-1 min-w-0">
                    <AccountPicker
                      accounts={postableAccounts}
                      value={line.account_id}
                      onChange={(id) => updateLine(line.key, { account_id: id })}
                    />
                  </div>
                  <button
                    type="button"
                    onClick={() => removeLine(line.key)}
                    disabled={lines.length <= 2}
                    aria-label="Remove line"
                    className="text-text3 hover:text-red disabled:opacity-30 disabled:cursor-not-allowed shrink-0 p-1"
                  >
                    <X size={15} />
                  </button>
                </div>
                <div className="flex items-center gap-2 pl-6">
                  <div className="flex-1">
                    <input
                      type="number"
                      step="0.01"
                      min="0"
                      inputMode="decimal"
                      className={`${inputCls} font-mono text-right`}
                      placeholder="Debit"
                      value={line.debit}
                      onChange={(e) => setDebit(line.key, e.target.value)}
                    />
                  </div>
                  <div className="flex-1">
                    <input
                      type="number"
                      step="0.01"
                      min="0"
                      inputMode="decimal"
                      className={`${inputCls} font-mono text-right`}
                      placeholder="Credit"
                      value={line.credit}
                      onChange={(e) => setCredit(line.key, e.target.value)}
                    />
                  </div>
                </div>
                <div className="pl-6">
                  <input
                    className={inputCls}
                    placeholder="Line description (optional)"
                    value={line.description}
                    onChange={(e) => updateLine(line.key, { description: e.target.value })}
                  />
                </div>
              </div>
            ))}
          </div>
        </div>

        <div
          className={`rounded-md border px-3 py-2.5 flex items-center justify-between text-sm ${
            balanced ? 'border-green/30 bg-green/5' : 'border-red/30 bg-red/5'
          }`}
        >
          <div className="flex items-center gap-2">
            {balanced ? <Check size={16} className="text-green" /> : <AlertCircle size={16} className="text-red" />}
            <span className={balanced ? 'text-green font-medium' : 'text-red font-medium'}>
              {balanced ? 'Balanced' : diff > 0 ? 'Debits exceed credits' : 'Credits exceed debits'}
            </span>
          </div>
          <div className="font-mono text-xs text-text2 text-right">
            <div>Dr {inr(totalDebit)}</div>
            <div>Cr {inr(totalCredit)}</div>
          </div>
        </div>

        {(validationError || submitError) && (
          <p className="text-xs text-red">{validationError ?? submitError}</p>
        )}
      </div>

      <div className="flex gap-3 px-6 py-4 border-t border-border shrink-0">
        <button type="button" onClick={onCancel} className={secondaryBtn}>
          Cancel
        </button>
        <button type="submit" disabled={mutation.isPending} className={primaryBtn}>
          {mutation.isPending ? 'Saving...' : mode === 'create' ? 'Save as draft' : 'Save changes'}
        </button>
      </div>
    </form>
  )
}
