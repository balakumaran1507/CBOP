// Build Unit 6: generates schema.org LocalBusiness/Organization JSON-LD from
// site_settings - the real local-SEO lever per docs/modules/SEO_Build_Plan.md's Phase 1
// research (must exactly match Google Business Profile - CBOP doesn't sync to
// GBP itself, that would need the separate Google Business Profile API, not
// built here - this generates the on-site half of that consistency).

interface SiteSettingsForSchema {
  company_name:    string
  tagline:         string | null
  logo_url:        string | null
  phone:           string | null
  email:           string | null
  address_street:  string | null
  address_city:    string | null
  address_state:   string | null
  address_postal:  string | null
  address_country: string | null
  social_links:    { platform: string; url: string }[]
  site_url:        string | null
}

export function generateLocalBusinessJsonLd(s: SiteSettingsForSchema): Record<string, unknown> {
  const hasAddress = !!(s.address_street || s.address_city)

  return {
    '@context': 'https://schema.org',
    '@type': 'LocalBusiness',
    name: s.company_name,
    description: s.tagline || undefined,
    image: s.logo_url || undefined,
    logo: s.logo_url || undefined,
    telephone: s.phone || undefined,
    email: s.email || undefined,
    url: s.site_url || undefined,
    address: hasAddress
      ? {
          '@type': 'PostalAddress',
          streetAddress: s.address_street || undefined,
          addressLocality: s.address_city || undefined,
          addressRegion: s.address_state || undefined,
          postalCode: s.address_postal || undefined,
          addressCountry: s.address_country || undefined,
        }
      : undefined,
    sameAs: s.social_links.length > 0 ? s.social_links.map(l => l.url) : undefined,
  }
}

// Not a real cross-property check (that needs the Google Business Profile API,
// out of scope for this unit) - this is a completeness/format self-check:
// does the site have the NAP fields filled in at all, and do they look
// well-formed, since an incomplete or malformed NAP block can't be consistent
// with anything.
export interface NapCheckResult {
  complete: boolean
  issues: { field: string; message: string }[]
}

export function checkNapCompleteness(s: SiteSettingsForSchema): NapCheckResult {
  const issues: { field: string; message: string }[] = []

  if (!s.company_name?.trim()) issues.push({ field: 'name', message: 'Business name is missing' })
  if (!s.phone?.trim()) issues.push({ field: 'phone', message: 'Phone number is missing' })
  else if (!/[\d+][\d\s\-()]{6,}/.test(s.phone)) issues.push({ field: 'phone', message: 'Phone number does not look well-formed' })
  if (!s.address_street?.trim() && !s.address_city?.trim()) issues.push({ field: 'address', message: 'Address is missing' })
  if (s.address_street?.trim() && !s.address_city?.trim()) issues.push({ field: 'address', message: 'Street given without a city' })
  if (!s.email?.trim()) issues.push({ field: 'email', message: 'Email is missing' })
  else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s.email)) issues.push({ field: 'email', message: 'Email does not look well-formed' })

  return { complete: issues.length === 0, issues }
}
