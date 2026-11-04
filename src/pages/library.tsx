import { ArrowRight, FolderSearch, RefreshCw, Search, Sparkles } from 'lucide-react'
import { useMemo, useState } from 'react'
import { toast } from 'sonner'
import type { AlbumStatus, AlbumSummary } from '../../shared/types'
import { AlbumCover } from '@/components/album-cover'
import { FolderPicker } from '@/components/folder-picker'
import { useJob } from '@/components/job-bar'
import { PageHeader } from '@/components/page-header'
import { ConfidenceMeter, StatusBadge } from '@/components/status-badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { api, useApi } from '@/lib/api'
import { useApp } from '@/lib/app'
import { needsReview, readyToOrganize } from '@/lib/stats'
import { cn } from '@/lib/utils'

const FILTERS: { key: string; label: string; statuses: AlbumStatus[] | null }[] = [
  { key: 'all', label: 'All', statuses: null },
  { key: 'review', label: 'Needs you', statuses: ['review', 'unmatched'] },
  { key: 'ready', label: 'Ready', statuses: ['matched', 'accepted', 'singles', 'duplicate'] },
  { key: 'done', label: 'Organized', statuses: ['applied'] },
  { key: 'pending', label: 'Not matched', statuses: ['pending'] },
  { key: 'other', label: 'Skipped', statuses: ['leave', 'skipped'] },
]

export function LibraryPage() {
  const { state, go } = useApp()
  const [picker, setPicker] = useState(false)
  const job = useJob()
  const busy = job?.status === 'running'

  const chooseRoot = async (root: string) => {
    try {
      await api('/library', { body: { root } })
      await api('/scan', { body: {} })
    } catch (e) {
      toast.error((e as Error).message)
    }
  }

  if (!state?.libraryRoot) {
    return (
      <div className="flex min-h-[70svh] flex-col items-center justify-center text-center">
        <div className="mb-6 flex size-14 items-center justify-center rounded-xl border bg-card/40">
          <FolderSearch className="size-6 text-muted-foreground" />
        </div>
        <h1 className="text-3xl font-semibold tracking-tight">Point SlimTunes at your music</h1>
        <p className="mt-3 max-w-md text-muted-foreground">
          We’ll read every file, match it to MusicBrainz, fetch album art, and tidy everything into one folder per artist and album. Nothing changes until you
          approve it.
        </p>
        <Button size="lg" className="mt-8 h-10 px-5" onClick={() => setPicker(true)}>
          Choose music folder
        </Button>
        <FolderPicker open={picker} onOpenChange={setPicker} onPick={chooseRoot} />
      </div>
    )
  }

  const s = state.stats.byStatus
  const ready = readyToOrganize(s)
  const needs = needsReview(s)
  const pending = s.pending ?? 0

  return (
    <>
      <PageHeader
        title="Library"
        description={<span className="font-mono text-xs">{state.libraryRoot}</span>}
        actions={
          <>
            <Button variant="outline" onClick={() => setPicker(true)}>
              Change folder
            </Button>
            <Button variant="outline" disabled={busy} onClick={() => api('/scan', { body: {} }).catch((e) => toast.error(e.message))}>
              <RefreshCw /> Rescan
            </Button>
          </>
        }
      />
      <FolderPicker open={picker} onOpenChange={setPicker} onPick={chooseRoot} initial={state.libraryRoot} />

      <div className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Tracks" value={state.stats.tracks} />
        <Stat label="Albums" value={state.stats.albums} />
        <Stat label="Ready to organize" value={ready} tone="text-success" />
        <Stat label="Needs you" value={needs} tone={needs ? 'text-warning' : undefined} />
      </div>

      <NextStep
        busy={busy}
        tracks={state.stats.tracks}
        pending={pending}
        needs={needs}
        ready={ready}
        onMatch={() => api('/match', { body: {} }).catch((e) => toast.error(e.message))}
        onScan={() => api('/scan', { body: {} }).catch((e) => toast.error(e.message))}
        go={go}
      />

      <AlbumTable onOpen={(a) => go('review', a.id)} />
    </>
  )
}

function Stat({ label, value, tone }: { label: string; value: number; tone?: string }) {
  return (
    <div className="rounded-xl border bg-card/40 px-4 py-3.5">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className={cn('mt-1 text-2xl font-semibold tabular-nums tracking-tight', tone)}>{value.toLocaleString()}</div>
    </div>
  )
}

function NextStep(p: {
  busy: boolean
  tracks: number
  pending: number
  needs: number
  ready: number
  onMatch: () => void
  onScan: () => void
  go: (r: 'review' | 'apply' | 'rules') => void
}) {
  let title: string
  let body: string
  let action: { label: string; run: () => void } | null
  if (!p.tracks) {
    title = 'Scan your library'
    body = 'Read tags from every music file in this folder.'
    action = { label: 'Scan now', run: p.onScan }
  } else if (p.pending) {
    const mins = Math.max(1, Math.round((p.pending * 3) / 60))
    title = `Match ${p.pending.toLocaleString()} album${p.pending > 1 ? 's' : ''} with MusicBrainz`
    body = `MusicBrainz allows one request per second, so this takes about ${mins} minute${mins > 1 ? 's' : ''}. You can review albums as they come in.`
    action = { label: 'Start matching', run: p.onMatch }
  } else if (p.needs) {
    title = `${p.needs} album${p.needs > 1 ? 's need' : ' needs'} a quick decision`
    body = 'We’ll walk you through each one: confirm the match, pick an edition, or skip.'
    action = { label: 'Start review', run: () => p.go('review') }
  } else if (p.ready) {
    title = `${p.ready} album${p.ready > 1 ? 's are' : ' is'} ready to organize`
    body = 'Preview every move and tag change before anything happens. You can undo the whole run later.'
    action = { label: 'Preview changes', run: () => p.go('apply') }
  } else {
    title = 'Everything is organized'
    body = 'Drop new music in your inbox folder (Settings) and SlimTunes will file it automatically.'
    action = null
  }
  return (
    <div className="mb-10 rounded-xl border bg-card/40 p-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="space-y-1">
          <div className="flex items-center gap-1.5 text-xs font-medium tracking-wide text-muted-foreground uppercase">
            <Sparkles className="size-3.5" /> Next step
          </div>
          <h2 className="text-lg font-semibold tracking-tight">{title}</h2>
          <p className="max-w-xl text-sm text-muted-foreground">{body}</p>
        </div>
        {action && (
          <Button size="lg" className="h-10 px-4" disabled={p.busy} onClick={action.run}>
            {action.label} <ArrowRight />
          </Button>
        )}
      </div>
    </div>
  )
}

function AlbumTable({ onOpen }: { onOpen: (a: AlbumSummary) => void }) {
  const { data } = useApi<AlbumSummary[]>('/albums', (e) => e.type === 'albums' || e.type === 'album' || (e.type === 'job' && e.job?.status === 'done'))
  const [filter, setFilter] = useState('all')
  const [q, setQ] = useState('')
  const [limit, setLimit] = useState(200)

  const counts = useMemo(() => {
    const out: Record<string, number> = {}
    for (const f of FILTERS) out[f.key] = (data ?? []).filter((a) => !f.statuses || f.statuses.includes(a.status)).length
    return out
  }, [data])

  const rows = useMemo(() => {
    const f = FILTERS.find((x) => x.key === filter)!
    const needle = q.toLowerCase()
    return (data ?? [])
      .filter((a) => !f.statuses || f.statuses.includes(a.status))
      .filter((a) => !needle || `${a.artist} ${a.title} ${a.folder}`.toLowerCase().includes(needle))
      .sort((a, b) => a.artist.localeCompare(b.artist) || a.title.localeCompare(b.title))
  }, [data, filter, q])

  if (!data?.length) return null
  return (
    <section>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-1">
          {FILTERS.map((f) => (
            <button
              key={f.key}
              onClick={() => setFilter(f.key)}
              aria-pressed={filter === f.key}
              className={cn(
                'focus-ring rounded-full px-3 py-1 text-sm text-muted-foreground transition-colors hover:text-foreground',
                filter === f.key && 'bg-muted text-foreground',
              )}
            >
              {f.label} <span className="ml-0.5 tabular-nums text-muted-foreground">{counts[f.key]}</span>
            </button>
          ))}
        </div>
        <div className="relative w-64">
          <Search className="absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input aria-label="Search albums" placeholder="Search albums" value={q} onChange={(e) => setQ(e.target.value)} className="pl-8" />
        </div>
      </div>
      <div className="overflow-hidden rounded-xl border">
        {rows.slice(0, limit).map((a) => (
          <button
            key={a.id}
            onClick={() => onOpen(a)}
            className="focus-ring grid w-full grid-cols-[40px_1fr_120px_110px] items-center gap-4 border-b px-4 py-2.5 text-left text-sm transition-colors last:border-b-0 hover:bg-muted/40"
          >
            <AlbumCover releaseId={a.chosen?.id} className="size-10 rounded-md" />
            <div className="min-w-0">
              <div className="truncate font-medium">{a.chosen?.title ?? a.title}</div>
              <div className="truncate text-muted-foreground">
                {a.chosen?.artist ?? a.artist}
                <span className="mx-1.5 opacity-40">·</span>
                <span className="font-mono text-xs">{a.folder}</span>
              </div>
            </div>
            <div>
              <StatusBadge status={a.status} />
            </div>
            <div className="flex justify-end">
              <ConfidenceMeter value={a.confidence} />
            </div>
          </button>
        ))}
        {!rows.length && <div className="p-8 text-center text-sm text-muted-foreground">Nothing here.</div>}
      </div>
      {rows.length > limit && (
        <div className="mt-3 text-center">
          <Button variant="ghost" onClick={() => setLimit((l) => l + 200)}>
            Show more ({rows.length - limit} left)
          </Button>
        </div>
      )}
    </section>
  )
}
