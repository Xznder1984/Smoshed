import { useCallback, useEffect, useRef, useState } from 'react'
import { api, ApiError } from '../lib/api'
import type { Page } from '../lib/types'

export type PaginatedState<T> = {
  items: T[]
  nextCursor: string | null
  loading: boolean
  loadingMore: boolean
  error: string | null
  reload: () => void
  loadMore: () => void
  /** Applies a local change without a refetch, for optimistic toggles. */
  patch: (updater: (items: T[]) => T[]) => void
}

/**
 * Fetches a cursor-paginated endpoint.
 *
 * Requests are aborted when the path changes, so a slow response cannot
 * overwrite a newer one. After a mutation the caller calls `reload` rather
 * than patching counters in several places, which keeps a like from disagreeing
 * with the server's count.
 *
 * Loading is derived from which request key has last settled rather than
 * written directly by the effect, which keeps the effect to one state update
 * when the data actually arrives. A null path means "not asking for this", and
 * the empty result is derived rather than stored.
 */
export function usePaginated<T>(path: string | null): PaginatedState<T> {
  const [nonce, setNonce] = useState(0)
  const key = path === null ? null : `${path}|${nonce}`

  const [result, setResult] = useState<{ key: string; page: Page<T> } | null>(null)
  const [settled, setSettled] = useState<string | null>(null)
  const [loadingMore, setLoadingMore] = useState(false)
  const [failure, setFailure] = useState<{ key: string; message: string } | null>(null)
  const abortRef = useRef<AbortController | null>(null)

  useEffect(() => {
    if (!path || key === null) return

    const controller = new AbortController()
    abortRef.current?.abort()
    abortRef.current = controller

    api<Page<T>>(path, { signal: controller.signal })
      .then((page) => {
        if (controller.signal.aborted) return
        setResult({ key, page })
        setFailure(null)
      })
      .catch((err: unknown) => {
        if (controller.signal.aborted) return
        setFailure({
          key,
          message: err instanceof ApiError ? err.message : 'Could not load this right now.',
        })
      })
      .finally(() => {
        if (!controller.signal.aborted) setSettled(key)
      })

    return () => controller.abort()
  }, [path, key])

  const reload = useCallback(() => setNonce((n) => n + 1), [])

  const current = result && result.key === key ? result.page : null
  const nextCursor = current?.nextCursor ?? null
  const loading = key !== null && settled !== key
  const error = failure && failure.key === key ? failure.message : null

  const loadMore = useCallback(() => {
    if (!path || !nextCursor || loadingMore) return
    const controller = new AbortController()
    abortRef.current?.abort()
    abortRef.current = controller

    setLoadingMore(true)
    const separator = path.includes('?') ? '&' : '?'
    api<Page<T>>(`${path}${separator}cursor=${encodeURIComponent(nextCursor)}`, {
      signal: controller.signal,
    })
      .then((page) => {
        if (controller.signal.aborted) return
        setResult((existing) => ({
          key: key ?? '',
          page: {
            items: [...(existing?.page.items ?? []), ...page.items],
            nextCursor: page.nextCursor,
          },
        }))
      })
      .catch((err: unknown) => {
        if (controller.signal.aborted) return
        setFailure({
          key: key ?? '',
          message: err instanceof ApiError ? err.message : 'Could not load more.',
        })
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoadingMore(false)
      })
  }, [path, key, nextCursor, loadingMore])

  const patch = useCallback(
    (updater: (items: T[]) => T[]) => {
      setResult((existing) =>
        existing
          ? { key: existing.key, page: { ...existing.page, items: updater(existing.page.items) } }
          : existing,
      )
    },
    [],
  )

  const noop = useCallback(() => {}, [])

  if (key === null) {
    return {
      items: [],
      nextCursor: null,
      loading: false,
      loadingMore: false,
      error: null,
      reload,
      loadMore: noop,
      patch,
    }
  }

  return {
    items: current?.items ?? [],
    nextCursor,
    loading,
    loadingMore,
    error,
    reload,
    loadMore,
    patch,
  }
}

/** Simple one-shot fetch for endpoints that are not paginated. */
export function useFetch<T>(path: string | null): {
  data: T | null
  loading: boolean
  error: string | null
  reload: () => void
} {
  const [nonce, setNonce] = useState(0)
  const key = path === null ? null : `${path}|${nonce}`

  const [result, setResult] = useState<{ key: string; data: T } | null>(null)
  const [settled, setSettled] = useState<string | null>(null)
  const [failure, setFailure] = useState<{ key: string; message: string } | null>(null)

  useEffect(() => {
    if (!path || key === null) return
    const controller = new AbortController()

    api<T>(path, { signal: controller.signal })
      .then((data) => {
        if (controller.signal.aborted) return
        setResult({ key, data })
        setFailure(null)
      })
      .catch((err: unknown) => {
        if (controller.signal.aborted) return
        setFailure({
          key,
          message: err instanceof ApiError ? err.message : 'Could not load this right now.',
        })
      })
      .finally(() => {
        if (!controller.signal.aborted) setSettled(key)
      })

    return () => controller.abort()
  }, [path, key])

  return {
    data: result && result.key === key ? result.data : null,
    loading: key !== null && settled !== key,
    error: failure && failure.key === key ? failure.message : null,
    reload: () => setNonce((n) => n + 1),
  }
}
