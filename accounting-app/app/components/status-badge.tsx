// One badge component for every status pill in the app (journal entry
// draft/posted/void, bill draft/approved/paid/void, invoice status, etc.) so
// the same word always renders the same color everywhere. Colors match
// CLAUDE.md's design system status palette (--amber/--green/--red/--blue),
// reused as Tailwind tokens (amber/green/red/blue) from tailwind.config.ts.
const STYLES: Record<string, string> = {
  draft:    'bg-text3/15 text-text2',
  posted:   'bg-green/10 text-green',
  paid:     'bg-green/10 text-green',
  approved: 'bg-blue/10 text-blue',
  sent:     'bg-blue/10 text-blue',
  pending:  'bg-amber/10 text-amber',
  overdue:  'bg-red/10 text-red',
  void:     'bg-red/10 text-red',
  locked:   'bg-red/10 text-red',
  open:     'bg-amber/10 text-amber',
}

export function StatusBadge({ status }: { status: string }) {
  const style = STYLES[status] ?? 'bg-text3/15 text-text2'
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium capitalize ${style}`}>
      {status}
    </span>
  )
}
