import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  AudioWaveform,
  Check,
  CheckCheck,
  Copy,
  Layers,
  Link2,
  Loader2,
  MoreHorizontal,
  PartyPopper,
  Search,
  SkipForward,
  X,
} from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import type { AlbumDetail, AlbumSummary, Alignment, Candidate, Release, ReleaseSummary } from '../../shared/types'
import { AlbumCover } from '@/components/album-cover'
import { useJob } from '@/components/job-bar'
import { PageHeader } from '@/components/page-header'
import { ConfidenceMeter, StatusBadge } from '@/components/status-badge'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import { Kbd } from '@/components/kbd'
import { api, useApi } from '@/lib/api'
import { type Scope, scopeQuery, useApp } from '@/lib/app'
import { cn } from '@/lib/utils'

const QUEUE = new Set(['review', 'unmatched'])

export function ReviewPage() {
  const { param, go, scope, setScope, state } = useApp()
  const q = scopeQuery(scope)
  const { data: albums } = useApi<AlbumSummary[]>(`/albums${q}`, (e) => e.type === 'albums' || e.type === 'album')
  const queue = useMemo(
    () => (albums ?? []).filter((a) => QUEUE.has(a.status)).sort((a, b) => (b.confidence ?? 0) - (a.confidence ?? 0)),
    [albums],
  )
  const [current, setCurrent] = useState<string | null>(param)
  useEffect(() => setCurrent(param), [param])
  // Fall through to the first album in the queue when nothing (or a finished album) is selected.
  const id = current ?? queue[0]?.id ?? null
  const index = queue.findIndex((a) => a.id === id)

  const next = useCallback(() => {
    const after = queue.filter((a) => a.id !== id)
    const target = after[Math.max(0, Math.min(index, after.length - 1))]
    setCurrent(target?.id ?? null)
    if (param) go('review')
  }, [queue, id, index, param, go])

  const bulk = async () => {
    const { accepted } = await api<{ accepted: number }>(`/albums/accept-all${q}`, { body: { min: 0.75 } })
    toast.success(`Confirmed ${accepted} album${accepted === 1 ? '' : 's'}`)
  }

  const highConfidence = queue.filter((a) => (a.confidence ?? 0) >= 0.75 && !a.issues.some((i) => i.kind === 'duplicate-album')).length

  return (
    <>
      <PageHeader
        title="Review"
        description="Albums that didn’t match perfectly. Take them one at a time — most need a single click."
        actions={
          <>
            {state?.inbox.enabled && <ScopeToggle scope={scope} setScope={setScope} />}
            {highConfidence > 1 && (
              <Button variant="outline" onClick={() => void bulk()}>
                <CheckCheck /> Confirm {highConfidence} likely matches
              </Button>
            )}
          </>
        }
      />
      {!albums ? null : !id ? (
        <EmptyQueue onApply={() => go('apply')} />
      ) : (
        <>
          {index >= 0 && (
            <div className="mb-3 flex items-center justify-between text-sm text-muted-foreground">
              <span className="tabular-nums">
                {index + 1} of {queue.length}
              </span>
              <div className="flex gap-1">
                <Button variant="ghost" size="icon-sm" disabled={index <= 0} onClick={() => setCurrent(queue[index - 1].id)}>
                  <ArrowLeft />
                </Button>
                <Button variant="ghost" size="icon-sm" disabled={index >= queue.length - 1} onClick={() => setCurrent(queue[index + 1].id)}>
                  <ArrowRight />
                </Button>
              </div>
            </div>
          )}
          <AlbumReview key={id} id={id} scope={scope} onDone={next} inQueue={index >= 0} />
        </>
      )}
    </>
  )
}

function ScopeToggle({ scope, setScope }: { scope: Scope; setScope: (s: Scope) => void }) {
  return (
    <div className="flex rounded-lg border p-0.5 text-sm">
      {(['library', 'inbox'] as const).map((s) => (
        <button key={s} onClick={() => setScope(s)} className={cn('rounded-md px-3 py-1 capitalize text-muted-foreground', scope === s && 'bg-muted text-foreground')}>
          {s}
        </button>
      ))}
    </div>
  )
}

function EmptyQueue({ onApply }: { onApply: () => void }) {
  return (
    <div className="flex flex-col items-center rounded-xl border border-dashed py-20 text-center">
      <PartyPopper className="mb-4 size-8 text-muted-foreground" />
      <h2 className="text-lg font-semibold">Nothing left to review</h2>
      <p className="mt-1 max-w-sm text-sm text-muted-foreground">Every album is matched, skipped, or set aside. Preview the changes next.</p>
      <Button className="mt-6" onClick={onApply}>
        Preview changes <ArrowRight />
      </Button>
    </div>
  )
}

const fmt = (s: number | null | undefined) => (s == null ? '' : `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}`)
const yearOf = (r: ReleaseSummary) => (r.originalDate ?? r.date)?.slice(0, 4)

function releaseMeta(r: ReleaseSummary) {
  return [r.date?.slice(0, 4), r.country, r.formats.join(' + '), `${r.trackCount} tracks`, r.label, r.disambiguation].filter(Boolean).join(' · ')
}

function AlbumReview({ id, scope, onDone, inQueue }: { id: string; scope: Scope; onDone: () => void; inQueue: boolean }) {
  const q = scopeQuery(scope)
  const { data: album } = useApi<AlbumDetail>(`/albums/${id}${q}`, (e) => (e.type === 'album' && e.id === id) || (e.type === 'job' && e.job?.kind === 'fingerprint' && e.job.status !== 'running'))
  const [selected, setSelected] = useState<string | null>(null)
  const [compared, setCompared] = useState<Record<string, { release: Release; alignment: Alignment[]; confidence: number }>>({})
  const [loading, setLoading] = useState(false)
  const [busy, setBusy] = useState(false)
  const [search, setSearch] = useState(false)
  const [editions, setEditions] = useState(false)
  const job = useJob()

  const selId = selected ?? album?.chosen?.id ?? album?.candidates[0]?.release.id ?? null
  const view = useMemo(() => {
    if (!album || !selId) return null
    if (compared[selId]) return compared[selId]
    if (album.release?.id === selId && album.alignment) return { release: album.release, alignment: album.alignment, confidence: album.confidence ?? 0 }
    return null
  }, [album, selId, compared])

  useEffect(() => {
    if (!selId || view || loading) return
    setLoading(true)
    api<{ release: Release; alignment: Alignment[]; confidence: number }>(`/albums/${id}/compare/${selId}${q}`)
      .then((r) => setCompared((c) => ({ ...c, [selId]: r })))
      .catch((e) => toast.error(e.message))
      .finally(() => setLoading(false))
  }, [selId, view, loading, id, q])

  const act = useCallback(
    async (fn: () => Promise<unknown>, done = true) => {
      setBusy(true)
      try {
        await fn()
        if (done) onDone()
      } catch (e) {
        toast.error((e as Error).message)
      } finally {
        setBusy(false)
      }
    },
    [onDone],
  )

  const accept = useCallback(() => selId && act(() => api(`/albums/${id}/choose${q}`, { body: { releaseId: selId } })), [selId, act, id, q])
  const action = useCallback((a: string) => act(() => api(`/albums/${id}/action${q}`, { body: { action: a } })), [act, id, q])
  const fingerprint = useCallback(() => act(() => api(`/albums/${id}/fingerprint${q}`, { body: {} }), false), [act, id, q])

  // Keyboard: Enter = use release, S = skip, / = search, F = fingerprint
  useEffect(() => {
    const on = (e: KeyboardEvent) => {
      if (search || editions || (e.target as HTMLElement).closest('input,textarea')) return
      if (e.key === 'Enter' && view) void accept()
      else if (e.key === 's') void action('skip')
      else if (e.key === '/') {
        e.preventDefault()
        setSearch(true)
      } else if (e.key === 'f') void fingerprint()
    }
    window.addEventListener('keydown', on)
    return () => window.removeEventListener('keydown', on)
  }, [accept, action, fingerprint, view, search, editions])

  if (!album) return <div className="h-96 animate-pulse rounded-xl border bg-card/40" />

  const fingerprinting = job?.kind === 'fingerprint' && job.status === 'running'
  const others = album.candidates.filter((c) => c.release.id !== selId)
  const issues = album.issues

  return (
    <div className="space-y-4">
      <div className="rounded-xl border bg-card/40">
        <div className="flex flex-wrap items-start justify-between gap-4 border-b px-5 py-4">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h2 className="truncate text-lg font-semibold tracking-tight">{album.title}</h2>
              <StatusBadge status={album.status} />
            </div>
            <p className="truncate text-sm text-muted-foreground">
              {album.artist} · {album.fileCount} files · <span className="font-mono text-xs">{album.folder}</span>
            </p>
          </div>
        </div>

        {issues.length > 0 && (
          <div className="space-y-1.5 border-b bg-amber-500/[0.04] px-5 py-3">
            {issues.map((i) => (
              <div key={i.kind + i.message} className="flex items-start gap-2 text-sm">
                <AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-400" />
                <span>{i.message}</span>
              </div>
            ))}
            {issues.some((i) => i.kind === 'untagged' || i.kind === 'no-candidates') && (
              <p className="pl-6 text-sm text-muted-foreground">Try fingerprinting — it identifies songs by how they sound, not their tags.</p>
            )}
          </div>
        )}

        {album.duplicateOf.length > 0 && (
          <div className="flex items-center gap-3 border-b px-5 py-3 text-sm">
            <Copy className="size-4 text-orange-400" />
            <span className="flex-1">
              Also in your library:{' '}
              {album.duplicateOf.map((d) => (
                <span key={d.id} className="font-mono text-xs">
                  {d.folder} ({d.fileCount} files{d.lossless ? ', lossless' : ''})
                </span>
              ))}
            </span>
            <Button size="sm" variant="outline" disabled={busy} onClick={() => void action('duplicate')}>
              Move this copy to _duplicates
            </Button>
          </div>
        )}

        <div className="grid divide-y lg:grid-cols-2 lg:divide-x lg:divide-y-0">
          <YourFiles album={album} alignment={view?.alignment ?? null} release={view?.release ?? null} />
          <div className="p-5">
            <div className="mb-3 text-xs font-medium tracking-wide text-muted-foreground uppercase">MusicBrainz</div>
            {!selId ? (
              <NoCandidates fingerprinting={fingerprinting} onSearch={() => setSearch(true)} onFingerprint={() => void fingerprint()} />
            ) : !view ? (
              <div className="flex h-48 items-center justify-center text-sm text-muted-foreground">
                <Loader2 className="mr-2 size-4 animate-spin" /> Loading tracklist…
              </div>
            ) : (
              <ReleaseView release={view.release} alignment={view.alignment} confidence={view.confidence} />
            )}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 border-t px-5 py-3">
          <Button disabled={!view || busy} onClick={() => void accept()}>
            <Check /> Use this release <Kbd>↵</Kbd>
          </Button>
          <Button variant="outline" disabled={busy} onClick={() => setSearch(true)}>
            <Search /> Search <Kbd>/</Kbd>
          </Button>
          {view?.release.releaseGroupId && (
            <Button variant="outline" disabled={busy} onClick={() => setEditions(true)}>
              <Layers /> Other editions
            </Button>
          )}
          <Button variant="outline" disabled={busy || fingerprinting} onClick={() => void fingerprint()}>
            {fingerprinting ? <Loader2 className="animate-spin" /> : <AudioWaveform />} Fingerprint <Kbd>F</Kbd>
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger render={<Button variant="ghost" size="icon" disabled={busy} />}>
              <MoreHorizontal />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-64">
              <DropdownMenuItem onClick={() => void action('singles')}>Treat as individual songs</DropdownMenuItem>
              <DropdownMenuItem onClick={() => void action('leave')}>Leave these files as they are</DropdownMenuItem>
              <DropdownMenuItem onClick={() => void action('duplicate')}>Move to _duplicates</DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => void act(() => api(`/albums/${id}/action${q}`, { body: { action: 'reset' } }), false)}>Start over (rematch)</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <div className="flex-1" />
          {inQueue && (
            <Button variant="ghost" disabled={busy} onClick={() => void action('skip')}>
              Skip for now <Kbd>S</Kbd> <SkipForward />
            </Button>
          )}
        </div>
      </div>

      {others.length > 0 && (
        <div className="rounded-xl border bg-card/40">
          <div className="border-b px-5 py-3 text-sm font-medium">Other possible matches</div>
          <div className="divide-y">
            {others.map((c) => (
              <CandidateRow key={c.release.id} c={c} onClick={() => setSelected(c.release.id)} />
            ))}
          </div>
        </div>
      )}

      <SearchDialog
        open={search}
        onOpenChange={setSearch}
        album={album}
        onSearch={(artist, title) =>
          act(async () => {
            await api(`/albums/${id}/search${q}`, { body: { artist, album: title } })
            setSelected(null)
          }, false)
        }
        onLink={(link) => act(() => api(`/albums/${id}/choose${q}`, { body: { releaseId: link } }))}
      />
      {view?.release.releaseGroupId && (
        <EditionsDialog open={editions} onOpenChange={setEditions} albumId={id} currentId={view.release.id} onPick={(rid) => setSelected(rid)} />
      )}
    </div>
  )
}

function YourFiles({ album, alignment, release }: { album: AlbumDetail; alignment: Alignment[] | null; release: Release | null }) {
  const byPath = new Map(alignment?.map((a) => [a.filePath, a]))
  const tracks = new Map(release?.tracks.map((t) => [t.id, t]))
  const dupes = new Set(album.duplicateFiles)
  return (
    <div className="p-5">
      <div className="mb-3 text-xs font-medium tracking-wide text-muted-foreground uppercase">Your files</div>
      <ul className="space-y-0.5 text-sm">
        {album.files.map((f) => {
          const a = byPath.get(f.path)
          const t = a?.trackId ? tracks.get(a.trackId) : null
          const isDupe = dupes.has(f.path)
          return (
            <li key={f.path} className={cn('flex items-center gap-2 rounded-md px-2 py-1', !t && alignment && !isDupe && 'bg-rose-500/[0.06]')}>
              <span className="w-8 shrink-0 text-right text-xs tabular-nums text-muted-foreground">{f.tags.track ?? ''}</span>
              <span className="min-w-0 flex-1 truncate">{f.tags.title || <span className="text-muted-foreground italic">{f.rel.split('/').pop()}</span>}</span>
              {isDupe && <span className="text-xs text-orange-400">duplicate</span>}
              <span className="text-xs uppercase text-muted-foreground">{f.format}</span>
              <span className="w-10 text-right text-xs tabular-nums text-muted-foreground">{fmt(f.duration)}</span>
              {alignment && !isDupe && (t ? <Check className="size-3.5 text-emerald-400" /> : <X className="size-3.5 text-rose-400" />)}
            </li>
          )
        })}
      </ul>
    </div>
  )
}

function ReleaseView({ release, alignment, confidence }: { release: Release; alignment: Alignment[]; confidence: number }) {
  const matched = new Map(alignment.filter((a) => a.trackId).map((a) => [a.trackId!, a]))
  const discs = [...new Set(release.tracks.map((t) => t.disc))]
  return (
    <div>
      <div className="mb-4 flex gap-4">
        <AlbumCover releaseId={release.id} size={500} className="size-24" />
        <div className="min-w-0 flex-1 space-y-1">
          <a
            href={`https://musicbrainz.org/release/${release.id}`}
            target="_blank"
            rel="noreferrer noopener"
            className="block truncate font-semibold hover:underline"
          >
            {release.title}
          </a>
          <div className="truncate text-sm">{release.artist}</div>
          <div className="text-xs text-muted-foreground">{releaseMeta(release)}</div>
          <ConfidenceMeter value={confidence} />
        </div>
      </div>
      <ul className="space-y-0.5 text-sm">
        {release.tracks.map((t) => {
          const a = matched.get(t.id)
          const drift = a?.durationDiff != null && Math.abs(a.durationDiff) > 7
          return (
            <li key={t.id} className={cn('flex items-center gap-2 rounded-md px-2 py-1', !a && 'text-muted-foreground')}>
              <span className="w-8 shrink-0 text-right text-xs tabular-nums text-muted-foreground">
                {discs.length > 1 ? `${t.disc}-` : ''}
                {t.position}
              </span>
              <span className="min-w-0 flex-1 truncate">{t.title}</span>
              <span className={cn('w-10 text-right text-xs tabular-nums', drift ? 'text-amber-400' : 'text-muted-foreground')}>{fmt(t.length)}</span>
              {a ? <Check className="size-3.5 text-emerald-400" /> : <span className="w-3.5 text-center text-xs">–</span>}
            </li>
          )
        })}
      </ul>
    </div>
  )
}

function NoCandidates({ fingerprinting, onSearch, onFingerprint }: { fingerprinting: boolean; onSearch: () => void; onFingerprint: () => void }) {
  return (
    <div className="flex h-48 flex-col items-center justify-center gap-3 text-center text-sm text-muted-foreground">
      <p>No matches yet.</p>
      <div className="flex gap-2">
        <Button size="sm" variant="outline" onClick={onSearch}>
          <Search /> Search by name
        </Button>
        <Button size="sm" variant="outline" disabled={fingerprinting} onClick={onFingerprint}>
          <AudioWaveform /> Fingerprint
        </Button>
      </div>
    </div>
  )
}

function CandidateRow({ c, onClick }: { c: Candidate; onClick: () => void }) {
  return (
    <button onClick={onClick} className="flex w-full items-center gap-3 px-5 py-2.5 text-left text-sm hover:bg-muted/40">
      <AlbumCover releaseId={c.release.id} className="size-9 rounded-md" />
      <div className="min-w-0 flex-1">
        <div className="truncate">
          {c.release.title} <span className="text-muted-foreground">— {c.release.artist}</span>
        </div>
        <div className="truncate text-xs text-muted-foreground">{releaseMeta(c.release)}</div>
      </div>
      {c.source === 'fingerprint' && <span className="text-xs text-violet-400">fingerprint</span>}
      {c.alignment ? <ConfidenceMeter value={c.confidence} /> : <span className="text-xs text-muted-foreground">compare</span>}
    </button>
  )
}

function SearchDialog({
  open,
  onOpenChange,
  album,
  onSearch,
  onLink,
}: {
  open: boolean
  onOpenChange: (o: boolean) => void
  album: AlbumDetail
  onSearch: (artist: string, album: string) => Promise<unknown>
  onLink: (link: string) => Promise<unknown>
}) {
  const [artist, setArtist] = useState(album.artist)
  const [title, setTitle] = useState(album.title)
  const [link, setLink] = useState('')
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Find the right album</DialogTitle>
          <DialogDescription>Fix the names and search again, or paste a link from musicbrainz.org.</DialogDescription>
        </DialogHeader>
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault()
            onOpenChange(false)
            void onSearch(artist, title)
          }}
        >
          <label className="grid gap-1.5 text-sm">
            Artist
            <Input value={artist} onChange={(e) => setArtist(e.target.value)} autoFocus />
          </label>
          <label className="grid gap-1.5 text-sm">
            Album
            <Input value={title} onChange={(e) => setTitle(e.target.value)} />
          </label>
          <Button type="submit" className="w-full">
            <Search /> Search MusicBrainz
          </Button>
        </form>
        <div className="flex items-center gap-3 text-xs text-muted-foreground">
          <div className="h-px flex-1 bg-border" /> or <div className="h-px flex-1 bg-border" />
        </div>
        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault()
            onOpenChange(false)
            void onLink(link)
          }}
        >
          <div className="relative flex-1">
            <Link2 className="absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input className="pl-8" placeholder="https://musicbrainz.org/release/…" value={link} onChange={(e) => setLink(e.target.value)} />
          </div>
          <Button type="submit" variant="outline" disabled={!link}>
            Use link
          </Button>
        </form>
        <DialogFooter className="text-xs text-muted-foreground sm:justify-start">
          <a href={`https://musicbrainz.org/search?query=${encodeURIComponent(`${artist} ${title}`)}&type=release`} target="_blank" rel="noreferrer noopener" className="underline">
            Search on musicbrainz.org
          </a>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function EditionsDialog({ open, onOpenChange, albumId, currentId, onPick }: { open: boolean; onOpenChange: (o: boolean) => void; albumId: string; currentId: string; onPick: (id: string) => void }) {
  const { data, loading } = useApi<ReleaseSummary[]>(open ? `/albums/${albumId}/editions` : null)
  const sorted = (data ?? []).slice().sort((a, b) => (a.date ?? '9999').localeCompare(b.date ?? '9999'))
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Editions</DialogTitle>
          <DialogDescription>Pick the version that matches your files — track count is usually the giveaway.</DialogDescription>
        </DialogHeader>
        <div className="-mx-1 max-h-[60vh] overflow-y-auto">
          {loading && <p className="p-4 text-sm text-muted-foreground">Loading…</p>}
          {sorted.map((r) => (
            <button
              key={r.id}
              onClick={() => {
                onPick(r.id)
                onOpenChange(false)
              }}
              className={cn('flex w-full items-center gap-3 rounded-md px-3 py-2 text-left text-sm hover:bg-muted/60', r.id === currentId && 'bg-muted')}
            >
              <span className="w-12 shrink-0 tabular-nums text-muted-foreground">{yearOf(r) ? r.date?.slice(0, 4) : '—'}</span>
              <span className="min-w-0 flex-1 truncate">
                {r.title}
                {r.disambiguation && <span className="text-muted-foreground"> ({r.disambiguation})</span>}
              </span>
              <span className="text-xs text-muted-foreground">
                {[r.country, r.formats.join(' + ')].filter(Boolean).join(' · ')}
              </span>
              <span className="w-16 text-right text-xs tabular-nums">{r.trackCount} tracks</span>
            </button>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  )
}
