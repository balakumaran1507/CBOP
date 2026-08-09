'use client'

export interface TableFilterProps {
  value: string
  onChange: (v: string) => void
  placeholder?: string
  className?: string
}

/**
 * Client-side table filter input.
 *
 * Renders a text input used to filter visible table rows on the client side.
 * No search icon to keep it minimal — matches the CBOP input design system.
 *
 * Usage:
 *   const [filter, setFilter] = useState('')
 *   const visible = rows.filter(r => r.name.toLowerCase().includes(filter.toLowerCase()))
 *   <TableFilter value={filter} onChange={setFilter} placeholder="Filter leads…" />
 */
export function TableFilter({
  value,
  onChange,
  placeholder = 'Filter…',
  className,
}: TableFilterProps) {
  return (
    <input
      type="text"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      className={className}
      style={{
        height: '36px',
        border: '1px solid var(--border)',
        borderRadius: '6px',
        outline: 'none',
        padding: '0 12px',
        fontSize: '0.875rem',
        fontFamily: 'var(--font-inter), sans-serif',
        backgroundColor: '#fff',
        color: 'var(--text1)',
        minWidth: '200px',
      }}
    />
  )
}
