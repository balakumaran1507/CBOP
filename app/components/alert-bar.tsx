interface Alert {
  type: string
  count: number
  message: string
}

export function AlertBar({ alerts }: { alerts: Alert[] }) {
  if (alerts.length === 0) return null

  const primary = alerts[0]
  const remainder = alerts.length - 1
  
  let bg = 'bg-amber'
  let text = 'text-white'
  
  if (primary.type === 'error') {
    bg = 'bg-red'
  } else if (primary.type === 'info') {
    bg = 'bg-blue'
  } else if (primary.type === 'success') {
    bg = 'bg-green'
  }

  return (
    <div className={`flex items-center gap-3 px-6 py-3 text-sm font-bold uppercase tracking-wider rounded-none ${bg} ${text}`}>
      <span>{primary.message}</span>
      {remainder > 0 && (
        <span className="opacity-80">+{remainder} more</span>
      )}
    </div>
  )
}
