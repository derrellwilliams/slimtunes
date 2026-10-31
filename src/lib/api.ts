import { useCallback, useEffect, useRef, useState } from 'react'
import type { ServerEvent } from '../../shared/types'

// The server prints a URL with ?t=<token>. Keep it for this browser and strip it from the address bar.
const TOKEN_KEY = 'slimtunes-token'
const fromUrl = new URLSearchParams(location.search).get('t')
if (fromUrl) {
  localStorage.setItem(TOKEN_KEY, fromUrl)
  history.replaceState(null, '', location.pathname + location.hash)
}
export const token = () => localStorage.getItem(TOKEN_KEY) ?? ''

/** Accepts the bare key or the whole startup link. */
export function setToken(input: string) {
  const t = input.trim().match(/[?&]t=([^&#\s]+)/)?.[1] ?? input.trim()
  localStorage.setItem(TOKEN_KEY, t)
}

export class ApiError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

export async function api<T = unknown>(path: string, init?: { method?: string; body?: unknown }): Promise<T> {
  const res = await fetch(`/api${path}`, {
    method: init?.method ?? (init?.body !== undefined ? 'POST' : 'GET'),
    headers: { 'x-slimtunes-token': token(), ...(init?.body !== undefined ? { 'content-type': 'application/json' } : {}) },
    body: init?.body !== undefined ? JSON.stringify(init.body) : undefined,
  })
  if (!res.ok) {
    let msg = res.statusText
    try {
      msg = ((await res.json()) as { error?: string }).error ?? msg
    } catch {
      msg = (await res.text().catch(() => '')) || msg
    }
    throw new ApiError(res.status, msg)
  }
  return res.json() as Promise<T>
}

type Listener = (e: ServerEvent) => void
const listeners = new Set<Listener>()
let source: EventSource | null = null
function connect() {
  if (source) return
  source = new EventSource(`/api/events?t=${encodeURIComponent(token())}`)
  source.onmessage = (m) => {
    const e = JSON.parse(m.data) as ServerEvent
    for (const l of listeners) l(e)
  }
  source.onerror = () => {
    source?.close()
    source = null
    setTimeout(connect, 2000)
  }
}

export function useServerEvents(fn: Listener) {
  const ref = useRef(fn)
  ref.current = fn
  useEffect(() => {
    connect()
    const l: Listener = (e) => ref.current(e)
    listeners.add(l)
    return () => void listeners.delete(l)
  }, [])
}

/** GET + refetch whenever a server event matches `refreshOn`. */
export function useApi<T>(path: string | null, refreshOn: (e: ServerEvent) => boolean = () => false) {
  const [data, setData] = useState<T | null>(null)
  const [error, setError] = useState<ApiError | null>(null)
  const [loading, setLoading] = useState(false)
  const reload = useCallback(async () => {
    if (!path) return
    setLoading(true)
    try {
      setData(await api<T>(path))
      setError(null)
    } catch (e) {
      setError(e as ApiError)
    } finally {
      setLoading(false)
    }
  }, [path])
  useEffect(() => {
    void reload()
  }, [reload])
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  useServerEvents((e) => {
    if (!refreshOn(e)) return
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => void reload(), 250)
  })
  return { data, error, loading, reload, setData }
}

export const coverUrl = (releaseId: string, size: 250 | 500 = 250) => `https://coverartarchive.org/release/${releaseId}/front-${size}`
