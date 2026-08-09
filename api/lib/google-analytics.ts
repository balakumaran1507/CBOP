// GA4 Data API - shares the OAuth token from google-search-console.ts (both
// scopes requested in one consent screen since it's the same Google account).

export interface GA4Report {
  dimensionHeaders: string[]
  metricHeaders: string[]
  rows: { dimensionValues: string[]; metricValues: string[] }[]
}

export async function runReport(accessToken: string, propertyId: string, opts: {
  dateRanges: { startDate: string; endDate: string }[]
  dimensions: string[]
  metrics: string[]
  limit?: number
}): Promise<GA4Report> {
  const res = await fetch(`https://analyticsdata.googleapis.com/v1beta/properties/${propertyId}:runReport`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      dateRanges: opts.dateRanges,
      dimensions: opts.dimensions.map(name => ({ name })),
      metrics: opts.metrics.map(name => ({ name })),
      limit: opts.limit ?? 100,
    }),
  })
  if (!res.ok) throw new Error(`GA4 Data API error (${res.status}): ${await res.text()}`)

  const data = await res.json() as {
    dimensionHeaders?: { name: string }[]
    metricHeaders?: { name: string }[]
    rows?: { dimensionValues?: { value: string }[]; metricValues?: { value: string }[] }[]
  }

  return {
    dimensionHeaders: (data.dimensionHeaders ?? []).map(h => h.name),
    metricHeaders: (data.metricHeaders ?? []).map(h => h.name),
    rows: (data.rows ?? []).map(r => ({
      dimensionValues: (r.dimensionValues ?? []).map(v => v.value),
      metricValues: (r.metricValues ?? []).map(v => v.value),
    })),
  }
}
