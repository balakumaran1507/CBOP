export interface EmptyStateProps {
  title: string
  description?: string
  action?: { label: string; onClick: () => void }
}

/**
 * Empty state placeholder shown when a list or table has no rows.
 *
 * Usage:
 *   {rows.length === 0 && (
 *     <EmptyState
 *       title="No invoices yet"
 *       description="Create your first invoice to get started."
 *       action={{ label: '+ New Invoice', onClick: () => setOpen(true) }}
 *     />
 *   )}
 */
export function EmptyState({ title, description, action }: EmptyStateProps) {
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        minHeight: '180px',
        backgroundColor: '#fff',
        border: '1px solid var(--border)',
        borderRadius: '8px',
        padding: '40px 24px',
        textAlign: 'center',
      }}
    >
      <p
        style={{
          fontSize: '0.875rem',
          fontWeight: 500,
          color: 'var(--text2)',
          margin: 0,
        }}
      >
        {title}
      </p>

      {description && (
        <p
          style={{
            fontSize: '0.75rem',
            color: 'var(--text3)',
            margin: '6px 0 0',
            maxWidth: '320px',
            lineHeight: 1.5,
          }}
        >
          {description}
        </p>
      )}

      {action && (
        <button
          onClick={action.onClick}
          style={{
            marginTop: '14px',
            fontSize: '0.75rem',
            color: '#0073BB',
            background: 'none',
            border: 'none',
            cursor: 'pointer',
            fontFamily: 'var(--font-inter), sans-serif',
            textDecoration: 'underline',
          }}
        >
          {action.label}
        </button>
      )}
    </div>
  )
}
