'use client'

import { useMemo } from 'react'
import { useQueries } from '@tanstack/react-query'
import { cbopFetch } from '../lib/api-client'
import { fmtDateTime } from '../lib/format'

// Shared audit-history view (Slice 7) over GET /api/accounting/audit-log,
// per docs/modules/ACCOUNTING_Build_Plan.md's Zoho Books audit-trail R&D:
// "who, when, what, where" per change, rendered as a timeline with a real
// before/after diff on update rows (not a raw JSON dump). CEO/creator only -
// callers are responsible for gating visibility before rendering this (see
// reports/page.tsx and the entry-detail.tsx / bills/page.tsx embeds).

export interface AuditLogEntry {
  id: string
  actor_id: string | null
  actor_role: string | null
  action: 'insert' | 'update' | 'delete'
  resource_type: string
  resource_id: string
  before_json: Record<string, unknown> | null
  after_json: Record<string, unknown> | null
  ip_address: string | null
  created_at: string
  actor_name: string | null
  actor_email: string | null
}

// Bookkeeping columns that show up on every acct_* row but never read as a
// meaningful "what changed" - never worth surfacing in an insert summary or
// an update diff. Deliberately NOT resource-type-specific: different
// resource_types have different business shapes, so this only strips the
// handful of columns that are noise everywhere.
const NOISE_KEYS = new Set(['id', 'company_id', 'created_at', 'updated_at'])

export const ACTION_STYLES: Record<AuditLogEntry['action'], string> = {
  insert: 'bg-green/10 text-green',
  update: 'bg-amber/10 text-amber',
  delete: 'bg-red/10 text-red',
}

export const ACTION_LABELS: Record<AuditLogEntry['action'], string> = {
  insert: 'Created',
  update: 'Updated',
  delete: 'Deleted',
}

export function fmtAuditValue(v: unknown): string {
  if (v === null || v === undefined || v === '') return '(empty)'
  if (typeof v === 'object') return JSON.stringify(v)
  return String(v)
}

export interface FieldChange {
  field: string
  before: unknown
  after: unknown
}

/** Key-by-key diff of before/after row JSON - only the fields that actually changed, noise columns stripped. */
export function diffFields(before: Record<string, unknown> | null, after: Record<string, unknown> | null): FieldChange[] {
  const keys = Array.from(new Set(Object.keys(before ?? {}).concat(Object.keys(after ?? {}))))
  const changes: FieldChange[] = []
  for (const key of keys) {
    if (NOISE_KEYS.has(key)) continue
    const b = before ? before[key] : undefined
    const a = after ? after[key] : undefined
    if (JSON.stringify(b) !== JSON.stringify(a)) changes.push({ field: key, before: b, after: a })
  }
  return changes.sort((x, y) => x.field.localeCompare(y.field))
}

/** Compact "field: value" list for insert/delete rows - business fields only, noise columns stripped. */
export function summaryFields(row: Record<string, unknown> | null): [string, unknown][] {
  if (!row) return []
  return Object.entries(row)
    .filter(([k]) => !NOISE_KEYS.has(k))
    .sort(([a], [b]) => a.localeCompare(b))
}

export function shortId(id: string): string {
  return id.length > 8 ? id.slice(0, 8) : id
}

function FieldChip({ field }: { field: string }) {
  return <span className="font-mono text-[11px] text-text3">{field}</span>
}

/** One changed field: name + old value (red) -> new value (green). Reused by both the panel and the Reports tab's inline diff. */
export function DiffRow({ change }: { change: FieldChange }) {
  return (
    <div className="flex flex-wrap items-center gap-2 py-1">
      <FieldChip field={change.field} />
      <span className="rounded bg-red/10 px-1.5 py-0.5 text-xs text-red line-through decoration-red/50">
        {fmtAuditValue(change.before)}
      </span>
      <span className="text-text3">&rarr;</span>
      <span className="rounded bg-green/10 px-1.5 py-0.5 text-xs text-green">{fmtAuditValue(change.after)}</span>
    </div>
  )
}

/** Compact insert/delete summary row: field name + its value, no before/after since there's only one side. */
export function SummaryRow({ field, value, tone }: { field: string; value: unknown; tone: 'green' | 'red' }) {
  const toneClass = tone === 'green' ? 'bg-green/10 text-green' : 'bg-red/10 text-red'
  return (
    <div className="flex flex-wrap items-center gap-2 py-1">
      <FieldChip field={field} />
      <span className={`rounded px-1.5 py-0.5 text-xs ${toneClass}`}>{fmtAuditValue(value)}</span>
    </div>
  )
}

/** One timeline entry: actor/action/timestamp header, then the diff or summary body. Shared by the panel and the Reports tab. */
export function AuditEntryCard({ entry }: { entry: AuditLogEntry }) {
  const changes = entry.action === 'update' ? diffFields(entry.before_json, entry.after_json) : []
  const insertRow = entry.action === 'insert' ? summaryFields(entry.after_json) : []
  const deleteRow = entry.action === 'delete' ? summaryFields(entry.before_json) : []

  return (
    <div className="rounded-lg border border-border bg-card p-3">
      <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
        <div className="flex items-center gap-2 flex-wrap">
          <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium ${ACTION_STYLES[entry.action]}`}>
            {ACTION_LABELS[entry.action]}
          </span>
          <span className="text-sm text-text1">{entry.actor_name ?? 'Unknown'}</span>
          {entry.actor_role && (
            <span className="rounded-full bg-bg px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-text3">
              {entry.actor_role}
            </span>
          )}
        </div>
        <span className="font-mono text-xs text-text3">{fmtDateTime(entry.created_at)}</span>
      </div>

      <p className="font-mono text-[11px] text-text3 mb-2">
        {entry.resource_type} / {shortId(entry.resource_id)}
      </p>

      {entry.action === 'update' && (
        <div className="flex flex-col">
          {changes.length === 0 ? (
            <p className="text-xs text-text3">No field-level changes recorded.</p>
          ) : (
            changes.map((c) => <DiffRow key={c.field} change={c} />)
          )}
        </div>
      )}
      {entry.action === 'insert' && (
        <div className="flex flex-col">
          {insertRow.map(([field, value]) => (
            <SummaryRow key={field} field={field} value={value} tone="green" />
          ))}
        </div>
      )}
      {entry.action === 'delete' && (
        <div className="flex flex-col">
          {deleteRow.map(([field, value]) => (
            <SummaryRow key={field} field={field} value={value} tone="red" />
          ))}
        </div>
      )}
    </div>
  )
}

export interface AuditTarget {
  resourceType: string
  resourceId: string
}

interface AuditHistoryPanelProps {
  companyId: string
  /** The record this panel is embedded on, e.g. { resourceType: 'acct_journal_entries', resourceId: entry.id }. */
  target: AuditTarget
  /**
   * Additional child-record targets whose history gets merged into the same
   * timeline, sorted by time. Used by the journal entry detail embed to fold
   * each line's own audit_logs rows (resource_type='acct_journal_entry_lines',
   * one row per line id - a line's resource_id is its OWN id, not the parent
   * entry's id, so the API can't return them via the entry's resource_id
   * alone) in alongside the entry-level history, so "History" on an entry
   * reads as one complete story instead of missing every line edit.
   */
  extraTargets?: AuditTarget[]
  emptyLabel?: string
}

export function AuditHistoryPanel({ companyId, target, extraTargets = [], emptyLabel }: AuditHistoryPanelProps) {
  const targets = useMemo(() => [target, ...extraTargets], [target, extraTargets])

  const results = useQueries({
    queries: targets.map((t) => ({
      queryKey: ['acct-audit-log', companyId, t.resourceType, t.resourceId],
      queryFn: () =>
        cbopFetch<{ entries: AuditLogEntry[] }>(
          `/api/accounting/audit-log?company_id=${companyId}&resource_type=${t.resourceType}&resource_id=${t.resourceId}`,
          { activeCompanyId: companyId }
        ),
      enabled: !!companyId && !!t.resourceId,
    })),
  })

  const isLoading = results.some((r) => r.isLoading)
  const isError = results.some((r) => r.isError)

  const entries = useMemo(() => {
    const all = results.flatMap((r) => r.data?.entries ?? [])
    return all.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
  }, [results])

  return (
    <div className="flex flex-col gap-2">
      {isLoading && <p className="text-sm text-text3 py-2">Loading history...</p>}
      {isError && <p className="text-sm text-red py-2">Failed to load audit history.</p>}
      {!isLoading && !isError && entries.length === 0 && (
        <p className="text-sm text-text3 py-2">{emptyLabel ?? 'No audit history recorded for this record yet.'}</p>
      )}
      {entries.map((entry) => (
        <AuditEntryCard key={entry.id} entry={entry} />
      ))}
    </div>
  )
}
