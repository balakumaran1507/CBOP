'use client'

// Client-side fetch wrapper for /api/accounting/* (and, when needed, other
// CBOP API routes). Unlike get-cbop-session.ts this runs in the browser, so
// it needs the PUBLIC main-API origin (not the container-to-container one)
// and must explicitly opt into sending the shared cross-subdomain cookie -
// credentials aren't included on cross-origin fetch by default.
const CBOP_API_PUBLIC_URL = process.env.NEXT_PUBLIC_CBOP_API_URL || 'https://cbop.etherence.com'

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message)
  }
}

export async function cbopFetch<T>(
  path: string,
  options: { method?: string; body?: unknown; activeCompanyId?: string | null } = {}
): Promise<T> {
  const res = await fetch(`${CBOP_API_PUBLIC_URL}${path}`, {
    method: options.method ?? 'GET',
    credentials: 'include', // sends the shared cbop_session cookie cross-origin - requires CORS credentials:true + this origin allow-listed server-side
    headers: {
      'Content-Type': 'application/json',
      ...(options.activeCompanyId ? { 'X-Active-Company-Id': options.activeCompanyId } : {}),
    },
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
  })

  if (!res.ok) {
    const body = await res.json().catch(() => ({}))
    throw new ApiError(res.status, body?.error ?? body?.message ?? `Request failed: ${res.status}`)
  }
  return res.json() as Promise<T>
}
