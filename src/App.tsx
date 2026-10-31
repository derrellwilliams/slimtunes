import { FolderOpen, History, Loader2, LayoutGrid, ListChecks, Play, Settings2, SlidersHorizontal } from 'lucide-react'
import { type ComponentType, useState } from 'react'
import { JobBar } from '@/components/job-bar'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Toaster } from '@/components/ui/sonner'
import { TooltipProvider } from '@/components/ui/tooltip'
import { setToken } from '@/lib/api'
import { AppProvider, type Route, useApp } from '@/lib/app'
import { cn } from '@/lib/utils'
import { ApplyPage } from '@/pages/apply'
import { HistoryPage } from '@/pages/history'
import { LibraryPage } from '@/pages/library'
import { ReviewPage } from '@/pages/review'
import { RulesPage } from '@/pages/rules'
import { SettingsPage } from '@/pages/settings'

const NAV: { route: Route; label: string; icon: ComponentType<{ className?: string }>; step?: number }[] = [
  { route: 'library', label: 'Library', icon: LayoutGrid, step: 1 },
  { route: 'rules', label: 'Rules', icon: SlidersHorizontal, step: 2 },
  { route: 'review', label: 'Review', icon: ListChecks, step: 3 },
  { route: 'apply', label: 'Preview & apply', icon: Play, step: 4 },
  { route: 'history', label: 'History', icon: History },
  { route: 'settings', label: 'Settings', icon: Settings2 },
]

function Sidebar() {
  const { route, go, state } = useApp()
  const review = (state?.stats.byStatus.review ?? 0) + (state?.stats.byStatus.unmatched ?? 0)
  return (
    <aside className="sticky top-0 flex h-svh w-60 shrink-0 flex-col border-r bg-sidebar/40 px-3 py-5">
      <div className="flex items-center gap-2 px-2 pb-6">
        <img src="/favicon.svg" alt="" className="size-6 rounded-md ring-1 ring-border" />
        <span className="text-[15px] font-semibold tracking-tight">SlimTunes</span>
      </div>
      <nav className="flex flex-col gap-0.5">
        {NAV.map(({ route: r, label, icon: Icon }) => (
          <button
            key={r}
            onClick={() => go(r)}
            className={cn(
              'group flex items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground',
              route === r && 'bg-muted text-foreground',
            )}
          >
            <Icon className="size-4" />
            <span className="flex-1 text-left">{label}</span>
            {r === 'review' && review > 0 && (
              <span className="rounded-full bg-amber-500/15 px-1.5 text-xs tabular-nums text-amber-400">{review}</span>
            )}
          </button>
        ))}
      </nav>
      <div className="mt-auto space-y-1 px-2 text-xs text-muted-foreground">
        {state?.libraryRoot ? (
          <>
            <div className="flex items-center gap-1.5 text-foreground/80">
              <FolderOpen className="size-3.5" /> Library
            </div>
            <div className="truncate font-mono" title={state.libraryRoot}>
              {state.libraryRoot.replace(/^\/Users\/[^/]+/, '~')}
            </div>
          </>
        ) : (
          <span>No library selected</span>
        )}
      </div>
    </aside>
  )
}

function Main() {
  const { route, state, authError, offline } = useApp()
  if (authError) return <Unlock />
  if (offline)
    return (
      <div className="flex h-svh items-center justify-center p-8 text-center">
        <div className="max-w-sm space-y-2">
          <Loader2 className="mx-auto mb-3 size-5 animate-spin text-muted-foreground" />
          <h1 className="text-lg font-semibold">Can’t reach SlimTunes</h1>
          <p className="text-sm text-muted-foreground">
            It may have stopped. Start it again in Terminal with <code className="rounded bg-muted px-1">npm start</code> — this page reconnects on its own.
          </p>
        </div>
      </div>
    )
  if (!state) return null
  const Page = { library: LibraryPage, rules: RulesPage, review: ReviewPage, apply: ApplyPage, history: HistoryPage, settings: SettingsPage }[route]
  return (
    <div className="flex min-h-svh">
      <Sidebar />
      <main className="min-w-0 flex-1">
        <JobBar />
        <div className="mx-auto max-w-6xl px-8 py-10">
          <Page />
        </div>
      </main>
    </div>
  )
}

function Unlock() {
  const [value, setValue] = useState('')
  return (
    <div className="flex h-svh items-center justify-center p-8">
      <form
        className="w-full max-w-sm space-y-4 text-center"
        onSubmit={(e) => {
          e.preventDefault()
          setToken(value)
          location.reload()
        }}
      >
        <img src="/favicon.svg" alt="" className="mx-auto size-10 rounded-xl ring-1 ring-border" />
        <div className="space-y-1.5">
          <h1 className="text-lg font-semibold">Unlock SlimTunes</h1>
          <p className="text-sm text-muted-foreground">
            Paste the link SlimTunes printed when it started. It contains a private key so other websites can’t touch your files.
          </p>
        </div>
        <Input autoFocus placeholder="http://127.0.0.1:4747/?t=…" value={value} onChange={(e) => setValue(e.target.value)} className="font-mono text-xs" />
        <Button type="submit" className="w-full" disabled={!value.trim()}>
          Unlock
        </Button>
      </form>
    </div>
  )
}

export default function App() {
  return (
    <AppProvider>
      <TooltipProvider>
        <Main />
        <Toaster position="bottom-right" />
      </TooltipProvider>
    </AppProvider>
  )
}
