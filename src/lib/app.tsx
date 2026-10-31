import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import type { PublicState } from '../../shared/types'
import { useApi } from './api'

export type Route = 'library' | 'rules' | 'review' | 'apply' | 'history' | 'settings'
export type Scope = 'library' | 'inbox'
const ROUTES: Route[] = ['library', 'rules', 'review', 'apply', 'history', 'settings']

interface Ctx {
  state: PublicState | null
  authError: boolean
  offline: boolean
  reload: () => Promise<void>
  route: Route
  param: string | null
  go: (r: Route, param?: string) => void
  scope: Scope
  setScope: (s: Scope) => void
}

const AppCtx = createContext<Ctx | null>(null)

function readRoute(): { route: Route; param: string | null } {
  const [r, param] = location.hash.replace(/^#\/?/, '').split('/') as [Route, string | undefined]
  return { route: ROUTES.includes(r) ? r : 'library', param: param ?? null }
}

export function AppProvider({ children }: { children: ReactNode }) {
  const { data, error, reload } = useApi<PublicState>('/state', (e) => e.type === 'state' || e.type === 'albums' || (e.type === 'job' && e.job?.status !== 'running'))
  const [{ route, param }, setRoute] = useState(readRoute)
  const [scope, setScope] = useState<Scope>('library')
  const offline = !!error && !error.status
  // Keep retrying while the server is unreachable (stopped, restarting, or busy).
  useEffect(() => {
    if (!offline) return
    const t = setInterval(() => void reload(), 3000)
    return () => clearInterval(t)
  }, [offline, reload])
  useEffect(() => {
    const on = () => setRoute(readRoute())
    window.addEventListener('hashchange', on)
    return () => window.removeEventListener('hashchange', on)
  }, [])
  const go = (r: Route, p?: string) => {
    location.hash = p ? `/${r}/${p}` : `/${r}`
    window.scrollTo({ top: 0 })
  }
  return (
    <AppCtx.Provider value={{ state: data, authError: error?.status === 401, offline, reload, route, param, go, scope, setScope }}>{children}</AppCtx.Provider>
  )
}

export function useApp() {
  const ctx = useContext(AppCtx)
  if (!ctx) throw new Error('useApp outside AppProvider')
  return ctx
}

export const scopeQuery = (scope: Scope) => (scope === 'inbox' ? '?scope=inbox' : '')
