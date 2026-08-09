'use client'

/**
 * Active-company transport for the browser.
 *
 * There is no shared fetch wrapper in this codebase (~350 raw `fetch` calls
 * across the app), so instead of touching every call site the active company is
 * attached once, here, by wrapping `window.fetch` for same-origin `/api/*`
 * requests only. Everything else is passed straight through untouched.
 *
 * The header is a *claim*, not a grant: requireAuth rejects any company id that
 * is not in the caller's `companyIds` (403). See api/middleware/require-auth.ts.
 */

export const ACTIVE_COMPANY_HEADER = 'X-Active-Company-Id'
export const ACTIVE_COMPANY_COOKIE = 'cbop_active_company_id'

let activeCompanyId: string | null = null
let installed = false

/** Value sent on subsequent requests. Null disables the header entirely. */
export function setActiveCompanyId(id: string | null): void {
  activeCompanyId = id
}

export function getActiveCompanyId(): string | null {
  return activeCompanyId
}

/**
 * Persist the choice for requests that cannot carry a header — server-rendered
 * page loads, which only get cookies. Read back by requireAuth as a hint and
 * validated there exactly like the header.
 */
export function persistActiveCompanyCookie(id: string): void {
  if (typeof document === 'undefined') return
  const oneYear = 60 * 60 * 24 * 365
  document.cookie = `${ACTIVE_COMPANY_COOKIE}=${encodeURIComponent(id)}; path=/; max-age=${oneYear}; SameSite=Lax`
}

function isSameOriginApi(url: string): boolean {
  try {
    const parsed = new URL(url, window.location.href)
    return parsed.origin === window.location.origin && parsed.pathname.startsWith('/api/')
  } catch {
    return false
  }
}

function requestUrl(input: RequestInfo | URL): string {
  if (typeof input === 'string') return input
  if (input instanceof URL) return input.toString()
  return input.url
}

/** Idempotent — safe to call from every provider mount. */
export function installApiClient(): void {
  if (installed || typeof window === 'undefined') return
  installed = true

  const originalFetch = window.fetch.bind(window)

  window.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
    if (!activeCompanyId || !isSameOriginApi(requestUrl(input))) {
      return originalFetch(input, init)
    }

    const headers = new Headers(
      init?.headers ?? (input instanceof Request ? input.headers : undefined)
    )
    if (!headers.has(ACTIVE_COMPANY_HEADER)) {
      headers.set(ACTIVE_COMPANY_HEADER, activeCompanyId)
    }

    return originalFetch(input, { ...init, headers })
  }
}
