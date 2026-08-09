import { describe, it, expect } from 'vitest'

// extractTrackedUrls is not exported — we inline an identical copy here to test
// the regex logic independently of the Hono app and database.
function extractTrackedUrls(renderedHtml: string, token: string): Set<string> {
  const urls = new Set<string>()
  const pattern = new RegExp(
    `/api/email-track/click/${token}\\?url=([^"'&\\s]+)`, 'g'
  )
  let m: RegExpExecArray | null
  while ((m = pattern.exec(renderedHtml)) !== null) {
    try { urls.add(decodeURIComponent(m[1])) } catch { /* skip malformed */ }
  }
  return urls
}

const TOKEN = 'abc123tok'

function makeLink(url: string) {
  return `/api/email-track/click/${TOKEN}?url=${encodeURIComponent(url)}`
}

describe('extractTrackedUrls — open-redirect fix', () => {
  it('extracts a single tracked URL from rendered HTML', () => {
    const target = 'https://etherence.com/promo'
    const html = `<a href="${makeLink(target)}">Click</a>`
    const urls = extractTrackedUrls(html, TOKEN)
    expect(urls.has(target)).toBe(true)
    expect(urls.size).toBe(1)
  })

  it('extracts multiple tracked URLs', () => {
    const a = 'https://etherence.com/a'
    const b = 'https://example.org/b'
    const html = `<a href="${makeLink(a)}">A</a> <a href="${makeLink(b)}">B</a>`
    const urls = extractTrackedUrls(html, TOKEN)
    expect(urls.has(a)).toBe(true)
    expect(urls.has(b)).toBe(true)
    expect(urls.size).toBe(2)
  })

  it('does NOT extract URLs from a different token', () => {
    const target = 'https://attacker.com/phish'
    // Link uses a different token
    const html = `<a href="/api/email-track/click/OTHERTOKEN?url=${encodeURIComponent(target)}">Click</a>`
    const urls = extractTrackedUrls(html, TOKEN)
    expect(urls.size).toBe(0)
  })

  it('returns empty set for HTML with no tracked links', () => {
    const html = '<p>No links here</p>'
    const urls = extractTrackedUrls(html, TOKEN)
    expect(urls.size).toBe(0)
  })

  it('rejects a forged URL not present in the rendered HTML', () => {
    const legit = 'https://etherence.com/legit'
    const forged = 'https://evil.com/phish'
    const html = `<a href="${makeLink(legit)}">OK</a>`
    const urls = extractTrackedUrls(html, TOKEN)
    expect(urls.has(legit)).toBe(true)
    expect(urls.has(forged)).toBe(false)
  })

  it('handles URL-encoded URLs in the href attribute', () => {
    const target = 'https://etherence.com/path?foo=bar&baz=qux'
    const html = `<a href="${makeLink(target)}">Go</a>`
    const urls = extractTrackedUrls(html, TOKEN)
    expect(urls.has(target)).toBe(true)
  })

  it('silently skips malformed percent-encoded URLs', () => {
    const token = 'xyz'
    const html = `/api/email-track/click/${token}?url=%GG_not_valid`
    // Should not throw
    expect(() => extractTrackedUrls(html, token)).not.toThrow()
  })
})
