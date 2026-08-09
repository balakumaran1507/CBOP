// Shared Google Fonts helper for server-side HTML/PDF rendering
// (Document Studio + Document canvas templates both use this).

// Keep in sync with the "system" entries in app/(dashboard)/templates/fonts.ts -
// these are OS-installed and must never be requested from Google Fonts, since an
// unrecognized family name can make the whole css2 @import request fail.
export const SYSTEM_FONTS = new Set([
  'Arial', 'Verdana', 'Trebuchet MS', 'Georgia', 'Times New Roman', 'Courier New',
])

interface FontWeightSpec {
  name: string
  weights: string
}

/** Builds a single @import line covering `base` fonts plus any non-system `customFamilies`. */
export function buildGoogleFontsImportCss(customFamilies: string[], base: FontWeightSpec[] = []): string {
  const families: FontWeightSpec[] = [
    ...base,
    ...[...new Set(customFamilies)]
      .filter(f => !SYSTEM_FONTS.has(f))
      .map(name => ({ name, weights: '400;500;600;700' })),
  ]
  if (families.length === 0) return ''
  const params = families
    .map(f => `family=${encodeURIComponent(f.name).replace(/%20/g, '+')}:wght@${f.weights}`)
    .join('&')
  return `@import url('https://fonts.googleapis.com/css2?${params}&display=swap');`
}
