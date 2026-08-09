// Shared formatting helpers, used by every transactional page. Keeping these
// in one place instead of copy-pasted per page is what stops each page's
// currency/date rendering from silently drifting from the others.

export function inr(n: number | string): string {
  const num = typeof n === 'string' ? parseFloat(n) : n
  return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 2 }).format(num || 0)
}

export function fmtDate(d: string | Date): string {
  return new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })
}

export function fmtDateShort(d: string | Date): string {
  return new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })
}

// Date + time, for audit-trail timestamps (Slice 7) - precision to the minute
// matters there in a way it doesn't for invoice/bill dates elsewhere.
export function fmtDateTime(d: string | Date): string {
  return new Date(d).toLocaleString('en-IN', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

export function todayIso(): string {
  return new Date().toISOString().slice(0, 10)
}
