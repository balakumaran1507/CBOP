// Client-side CSV export, used by every report tab's optional "Export CSV"
// button. No backend export endpoint exists and none is needed - each tab
// already has the full row set in memory from its own report fetch, so this
// just serializes it to a Blob and triggers a download. Not wired to any
// server route on purpose (see ACCOUNTING_Build_Plan.md Slice 5 scope).

export function downloadCsv(filename: string, headers: string[], rows: (string | number)[][]): void {
  const escape = (v: string | number): string => {
    const s = String(v ?? '')
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
  }
  const csv = [headers, ...rows].map((r) => r.map(escape).join(',')).join('\n')
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}
