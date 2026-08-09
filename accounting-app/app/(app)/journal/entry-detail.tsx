'use client'

import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { cbopFetch, ApiError } from '../../lib/api-client'
import { inr, fmtDate } from '../../lib/format'
import { StatusBadge } from '../../components/status-badge'
import { AuditHistoryPanel } from '../../components/audit-history-panel'
import { useCbopSession } from '../../lib/session-context'
import type { JournalEntry, JournalEntryLine } from './types'

const primaryBtn =
  'inline-flex items-center justify-center h-9 px-4 rounded-md bg-blue text-white text-sm font-medium hover:bg-blue/90 disabled:opacity-50 disabled:cursor-not-allowed'
const secondaryBtn =
  'inline-flex items-center justify-center h-9 px-4 rounded-md border border-border text-text1 text-sm font-medium hover:bg-bg disabled:opacity-50'
const dangerBtn =
  'inline-flex items-center justify-center h-9 px-4 rounded-md border border-red text-red text-sm font-medium hover:bg-red/5 disabled:opacity-50'

interface EntryDetailProps {
  entryId: string
  companyId: string
  onClose: () => void
  onChanged: () => void
  onEdit: (existing: { entry: JournalEntry; lines: JournalEntryLine[] }) => void
}

/**
 * Journal entry detail slide-over body: full line list rendered as a real
 * ledger (separate debit/credit columns), plus status-appropriate actions.
 * Void reason and the reversal-entry link are the two audit-trail-facing
 * pieces here - see docs/modules/ACCOUNTING_Build_Plan.md's audit-trail
 * section for why voiding is a reversal, never a delete.
 */
export function EntryDetail({ entryId, companyId, onClose, onChanged, onEdit }: EntryDetailProps) {
  const session = useCbopSession()
  const isCeo = session.role === 'ceo' || session.role === 'creator'
  const queryClient = useQueryClient()
  const [showVoidForm, setShowVoidForm] = useState(false)
  const [voidReason, setVoidReason] = useState('')
  const [showHistory, setShowHistory] = useState(false)

  const detailQuery = useQuery({
    queryKey: ['acct-je-detail', entryId],
    queryFn: () =>
      cbopFetch<{ entry: JournalEntry; lines: JournalEntryLine[] }>(`/api/accounting/journal-entries/${entryId}`, {
        activeCompanyId: companyId,
      }),
  })

  const entry = detailQuery.data?.entry
  const lines = detailQuery.data?.lines ?? []

  // No dedicated "find the reversal of X" endpoint - fetch the (low-volume)
  // entries list for this company and filter client-side, per the build spec.
  const reversalLookupQuery = useQuery({
    queryKey: ['acct-je-all-for-reversal', companyId],
    queryFn: () =>
      cbopFetch<{ entries: JournalEntry[] }>(`/api/accounting/journal-entries?company_id=${companyId}`, {
        activeCompanyId: companyId,
      }),
    enabled: !!entry && entry.status === 'void',
  })
  const reversal = reversalLookupQuery.data?.entries.find((e) => e.reversal_of_id === entryId) ?? null

  const originalQuery = useQuery({
    queryKey: ['acct-je-original', entry?.reversal_of_id],
    queryFn: () =>
      cbopFetch<{ entry: JournalEntry }>(`/api/accounting/journal-entries/${entry!.reversal_of_id}`, {
        activeCompanyId: companyId,
      }),
    enabled: !!entry?.reversal_of_id,
  })

  const postMutation = useMutation({
    mutationFn: () =>
      cbopFetch<{ entry: JournalEntry }>(`/api/accounting/journal-entries/${entryId}/post`, {
        method: 'POST',
        activeCompanyId: companyId,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['acct-je-detail', entryId] })
      onChanged()
    },
  })

  const deleteMutation = useMutation({
    mutationFn: () =>
      cbopFetch<{ ok: boolean }>(`/api/accounting/journal-entries/${entryId}`, {
        method: 'DELETE',
        activeCompanyId: companyId,
      }),
    onSuccess: () => {
      onChanged()
      onClose()
    },
  })

  const voidMutation = useMutation({
    mutationFn: () =>
      cbopFetch<{ voided: JournalEntry; reversal: JournalEntry }>(`/api/accounting/journal-entries/${entryId}/void`, {
        method: 'POST',
        activeCompanyId: companyId,
        body: { reason: voidReason.trim() },
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['acct-je-detail', entryId] })
      setShowVoidForm(false)
      onChanged()
    },
  })

  if (detailQuery.isLoading) {
    return <div className="flex-1 px-6 py-5 text-sm text-text2">Loading entry...</div>
  }
  if (detailQuery.isError || !entry) {
    return <div className="flex-1 px-6 py-5 text-sm text-red">Failed to load this journal entry.</div>
  }

  const totalDebit = lines.reduce((sum, l) => sum + Number(l.debit), 0)
  const totalCredit = lines.reduce((sum, l) => sum + Number(l.credit), 0)

  return (
    <div className="flex-1 flex flex-col min-h-0">
      <div className="flex-1 overflow-auto px-6 py-5 flex flex-col gap-5">
        <div className="flex items-center justify-between">
          <div>
            <p className="font-mono text-sm text-text1">{entry.entry_no}</p>
            <p className="text-xs text-text2 font-mono mt-0.5">{fmtDate(entry.entry_date)}</p>
          </div>
          <StatusBadge status={entry.status} />
        </div>

        {entry.reference && (
          <div>
            <p className="text-[11px] uppercase tracking-wide text-text3">Reference</p>
            <p className="text-sm text-text1">{entry.reference}</p>
          </div>
        )}
        {entry.narration && (
          <div>
            <p className="text-[11px] uppercase tracking-wide text-text3">Narration</p>
            <p className="text-sm text-text1">{entry.narration}</p>
          </div>
        )}

        {entry.reversal_of_id && (
          <div className="rounded-md border border-amber/30 bg-amber/5 px-3 py-2 text-xs text-text2">
            This is a reversal of entry{' '}
            <span className="font-mono text-text1">
              {originalQuery.data?.entry.entry_no ?? entry.reversal_of_id}
            </span>
            .
          </div>
        )}

        {entry.status === 'void' && (
          <div className="rounded-md border border-red/30 bg-red/5 px-3 py-2 text-xs text-text2">
            <p className="text-red font-medium">Voided{entry.voided_at ? ` on ${fmtDate(entry.voided_at)}` : ''}</p>
            {entry.void_reason && <p className="mt-1">Reason: {entry.void_reason}</p>}
            {reversal && (
              <p className="mt-1">
                Reversed by entry <span className="font-mono text-text1">{reversal.entry_no}</span>.
              </p>
            )}
          </div>
        )}

        <div>
          <p className="text-[11px] uppercase tracking-wide text-text3 mb-2">Lines</p>
          <div className="rounded-lg border border-border overflow-hidden overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs text-text3">
                  <th className="px-3 py-2 font-medium">Account</th>
                  <th className="px-3 py-2 font-medium">Description</th>
                  <th className="px-3 py-2 font-medium text-right">Debit</th>
                  <th className="px-3 py-2 font-medium text-right">Credit</th>
                </tr>
              </thead>
              <tbody>
                {lines.map((l) => (
                  <tr key={l.id} className="border-b border-border last:border-0">
                    <td className="px-3 py-2">
                      <span className="font-mono text-xs text-text2">{l.account_code}</span>
                      <span className="ml-1.5 text-text1">{l.account_name}</span>
                    </td>
                    <td className="px-3 py-2 text-text2">{l.description || ''}</td>
                    <td className="px-3 py-2 text-right font-mono text-text1">
                      {Number(l.debit) > 0 ? inr(l.debit) : ''}
                    </td>
                    <td className="px-3 py-2 text-right font-mono text-text1">
                      {Number(l.credit) > 0 ? inr(l.credit) : ''}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t border-border font-medium">
                  <td className="px-3 py-2" colSpan={2}>
                    Total
                  </td>
                  <td className="px-3 py-2 text-right font-mono text-text1">{inr(totalDebit)}</td>
                  <td className="px-3 py-2 text-right font-mono text-text1">{inr(totalCredit)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        </div>

        {isCeo && (
          <div>
            <div className="flex items-center justify-between mb-2">
              <p className="text-[11px] uppercase tracking-wide text-text3">History</p>
              <button
                type="button"
                onClick={() => setShowHistory((v) => !v)}
                className="text-xs font-medium text-blue hover:underline"
              >
                {showHistory ? 'Hide' : 'View history'}
              </button>
            </div>
            {showHistory && (
              // Merges this entry's own audit_logs rows with every one of its
              // lines' rows (each line has its own resource_id, see
              // audit-history-panel.tsx's AuditHistoryPanel doc comment) so
              // this one panel reads as the entry's complete change history,
              // not just the header row's.
              <AuditHistoryPanel
                companyId={companyId}
                target={{ resourceType: 'acct_journal_entries', resourceId: entry.id }}
                extraTargets={lines.map((l) => ({ resourceType: 'acct_journal_entry_lines', resourceId: l.id }))}
              />
            )}
          </div>
        )}

        {postMutation.isError && (
          <p className="text-xs text-red">
            {postMutation.error instanceof ApiError ? postMutation.error.message : 'Failed to post entry.'}
          </p>
        )}
        {deleteMutation.isError && (
          <p className="text-xs text-red">
            {deleteMutation.error instanceof ApiError ? deleteMutation.error.message : 'Failed to delete entry.'}
          </p>
        )}

        {showVoidForm && (
          <div className="rounded-md border border-red/30 bg-red/5 px-3 py-3 flex flex-col gap-2">
            <p className="text-xs text-text2">
              Voiding creates a permanent, equal-and-opposite reversal entry dated today. It never
              deletes or edits this entry - both stay in the ledger forever as part of the audit
              trail. A reason is required.
            </p>
            <textarea
              className="w-full h-16 rounded-md border border-border bg-white px-3 py-2 text-sm text-text1 resize-none focus:outline-none focus:border-blue"
              placeholder="Why is this entry being voided?"
              value={voidReason}
              onChange={(e) => setVoidReason(e.target.value)}
            />
            {voidMutation.isError && (
              <p className="text-xs text-red">
                {voidMutation.error instanceof ApiError ? voidMutation.error.message : 'Failed to void entry.'}
              </p>
            )}
            <div className="flex gap-2 justify-end">
              <button
                type="button"
                onClick={() => setShowVoidForm(false)}
                className={secondaryBtn}
                disabled={voidMutation.isPending}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => voidMutation.mutate()}
                disabled={!voidReason.trim() || voidMutation.isPending}
                className={dangerBtn}
              >
                {voidMutation.isPending ? 'Voiding...' : 'Confirm void'}
              </button>
            </div>
          </div>
        )}
      </div>

      <div className="flex gap-3 px-6 py-4 border-t border-border shrink-0">
        {entry.status === 'draft' && (
          <>
            <button
              type="button"
              onClick={() => deleteMutation.mutate()}
              disabled={deleteMutation.isPending}
              className={dangerBtn}
            >
              Delete
            </button>
            <button
              type="button"
              onClick={() => onEdit({ entry, lines })}
              className={secondaryBtn}
              disabled={deleteMutation.isPending || postMutation.isPending}
            >
              Edit
            </button>
            <button
              type="button"
              onClick={() => postMutation.mutate()}
              disabled={postMutation.isPending}
              className={primaryBtn}
            >
              {postMutation.isPending ? 'Posting...' : 'Post'}
            </button>
          </>
        )}
        {entry.status === 'posted' && !showVoidForm && (
          <button type="button" onClick={() => setShowVoidForm(true)} className={dangerBtn}>
            Void entry
          </button>
        )}
        {entry.status === 'void' && <p className="text-xs text-text3 py-2">This entry is void and read-only.</p>}
      </div>
    </div>
  )
}
