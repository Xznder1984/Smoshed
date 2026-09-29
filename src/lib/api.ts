/**
 * Thin fetch wrapper for the Hono API.
 *
 * Every mutating call sends the CSRF token from the readable cookie, and a 401
 * clears the in-memory session so the UI reacts to an expired cookie without a
 * full page reload. Error bodies are always `{ error: { message } }`, so the
 * message can be shown to the user as-is.
 */

export class ApiError extends Error {
  readonly status: number
  readonly fields: { path: string; message: string }[]

  constructor(status: number, message: string, fields: { path: string; message: string }[] = []) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.fields = fields
  }
}

const CSRF_COOKIE = 'smosh_csrf'

function readCookie(name: string): string | null {
  const match = document.cookie.match(new RegExp(`(?:^|; )${name}=([^;]*)`))
  return match ? decodeURIComponent(match[1]) : null
}

let onUnauthorized: (() => void) | null = null

/** Lets the auth provider clear its state when a request comes back 401. */
export function setUnauthorizedHandler(handler: () => void): void {
  onUnauthorized = handler
}

type RequestOptions = {
  method?: string
  body?: unknown
  signal?: AbortSignal
}

export async function api<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const method = options.method ?? 'GET'
  const headers: Record<string, string> = {}

  if (options.body !== undefined) headers['Content-Type'] = 'application/json'

  if (method !== 'GET' && method !== 'HEAD') {
    const csrf = readCookie(CSRF_COOKIE)
    if (csrf) headers['X-CSRF-Token'] = csrf
  }

  const response = await fetch(path, {
    method,
    headers,
    credentials: 'same-origin',
    signal: options.signal,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  })

  if (response.status === 204) return undefined as T

  const text = await response.text()
  let payload: unknown = null
  if (text.length > 0) {
    try {
      payload = JSON.parse(text)
    } catch {
      payload = null
    }
  }

  if (!response.ok) {
    if (response.status === 401) onUnauthorized?.()
    const error = (payload as { error?: { message?: string; fields?: { path: string; message: string }[] } })
      ?.error
    throw new ApiError(
      response.status,
      error?.message ?? 'Something went wrong. Please try again.',
      error?.fields ?? [],
    )
  }

  return payload as T
}

/** Builds a query string, dropping empty values. */
export function query(params: Record<string, string | number | undefined | null>): string {
  const search = new URLSearchParams()
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === '') continue
    search.set(key, String(value))
  }
  const result = search.toString()
  return result ? `?${result}` : ''
}
