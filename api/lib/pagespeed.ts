// PageSpeed Insights API - public, API-key only, no OAuth. Free tier: 25,000
// requests/day, 240/min. Returns Core Web Vitals (field data from CrUX +
// Lighthouse lab data). Degrades gracefully when the key isn't set.

const API_KEY = process.env.GOOGLE_PAGESPEED_API_KEY || ''

export function isPageSpeedConfigured(): boolean {
  return !!API_KEY
}

export interface CoreWebVitals {
  lcp_ms: number | null
  inp_ms: number | null
  cls: number | null
  performance_score: number | null
  strategy: 'mobile' | 'desktop'
  fetched_at: string
}

export async function getPageSpeed(url: string, strategy: 'mobile' | 'desktop' = 'mobile'): Promise<CoreWebVitals> {
  if (!isPageSpeedConfigured()) throw new Error('PageSpeed Insights not configured - set GOOGLE_PAGESPEED_API_KEY')

  const params = new URLSearchParams({ url, strategy, key: API_KEY })
  params.append('category', 'performance')
  const res = await fetch(`https://www.googleapis.com/pagespeedonline/v5/runPagespeed?${params}`)
  if (!res.ok) throw new Error(`PageSpeed Insights error (${res.status}): ${await res.text()}`)

  const data = await res.json() as {
    loadingExperience?: { metrics?: Record<string, { percentile: number }> }
    lighthouseResult?: { categories?: { performance?: { score: number } } }
  }

  const metrics = data.loadingExperience?.metrics ?? {}
  return {
    lcp_ms: metrics.LARGEST_CONTENTFUL_PAINT_MS?.percentile ?? null,
    inp_ms: metrics.INTERACTION_TO_NEXT_PAINT?.percentile ?? null,
    cls: metrics.CUMULATIVE_LAYOUT_SHIFT_SCORE ? metrics.CUMULATIVE_LAYOUT_SHIFT_SCORE.percentile / 100 : null,
    performance_score: data.lighthouseResult?.categories?.performance?.score != null
      ? Math.round(data.lighthouseResult.categories.performance.score * 100) : null,
    strategy,
    fetched_at: new Date().toISOString(),
  }
}
