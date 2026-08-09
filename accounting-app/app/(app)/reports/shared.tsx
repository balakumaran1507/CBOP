'use client'

// Small pieces reused across every report tab in this folder - loading/error/
// empty states, the "Export CSV" button, and the plain inline date input
// (CLAUDE.md: "date-range pickers etc. should be inline, not popups").

export function LoadingState({ label = 'Loading report...' }: { label?: string }) {
  return <p className="text-sm text-text2 py-6">{label}</p>
}

export function ErrorState({ label = 'Failed to load this report.' }: { label?: string }) {
  return <p className="text-sm text-red py-6">{label}</p>
}

export function EmptyState({ message }: { message: string }) {
  return (
    <div className="rounded-lg border border-border bg-card p-8 text-center">
      <p className="text-sm text-text2">{message}</p>
    </div>
  )
}

export function ExportButton({ onClick, disabled }: { onClick: () => void; disabled?: boolean }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className="inline-flex items-center justify-center h-9 px-3 rounded-md border border-border text-text2 text-xs font-medium hover:bg-bg disabled:opacity-40 disabled:cursor-not-allowed"
    >
      Export CSV
    </button>
  )
}

export function DateInput({
  label,
  value,
  onChange,
}: {
  label: string
  value: string
  onChange: (v: string) => void
}) {
  return (
    <label className="flex items-center gap-2 text-xs text-text2">
      {label}
      <input
        type="date"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="h-9 rounded-md border border-border bg-white px-2.5 text-sm font-mono text-text1 focus:outline-none focus:border-blue"
      />
    </label>
  )
}
