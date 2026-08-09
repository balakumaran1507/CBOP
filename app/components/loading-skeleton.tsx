/**
 * Animated loading skeleton placeholders.
 *
 * All skeletons use Tailwind's `animate-pulse` and the CBOP grey (#E0E3E3).
 * No 'use client' directive needed — pure presentational, no interactivity.
 *
 * Usage:
 *   {isLoading ? <TableSkeleton rows={6} /> : <ActualTable ... />}
 *   {isLoading ? <CardSkeleton /> : <ActualCard ... />}
 *   {isLoading ? <StatSkeleton /> : <StatCard ... />}
 */

/** Simulates a table with N rows of shimmer. */
export function TableSkeleton({ rows = 5 }: { rows?: number }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
      {/* Header row */}
      <div
        className="animate-pulse"
        style={{
          height: '38px',
          backgroundColor: '#F2F3F3',
          borderRadius: '6px',
          border: '1px solid var(--border)',
        }}
      />
      {/* Data rows */}
      {Array.from({ length: rows }).map((_, i) => (
        <div
          key={i}
          className="animate-pulse"
          style={{
            height: '48px',
            backgroundColor: '#E0E3E3',
            borderRadius: '6px',
            opacity: 1 - i * 0.12,
          }}
        />
      ))}
    </div>
  )
}

/** Simulates a card (e.g. a kanban card or info card). */
export function CardSkeleton() {
  return (
    <div
      className="animate-pulse"
      style={{
        height: '120px',
        backgroundColor: '#E0E3E3',
        borderRadius: '8px',
        border: '1px solid var(--border)',
      }}
    />
  )
}

/** Simulates a stat / KPI tile. */
export function StatSkeleton() {
  return (
    <div
      className="animate-pulse"
      style={{
        height: '80px',
        backgroundColor: '#E0E3E3',
        borderRadius: '8px',
        border: '1px solid var(--border)',
      }}
    />
  )
}
