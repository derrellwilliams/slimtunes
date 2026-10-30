import { ArrowRight, ChevronRight, FileAudio, FolderX, Image, Loader2, Play, RefreshCw, Tags, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import type { Plan, PlanAlbum } from '../../shared/types'
import { AlbumCover } from '@/components/album-cover'
import { useJob } from '@/components/job-bar'
import { PageHeader } from '@/components/page-header'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { api, useApi } from '@/lib/api'
import { scopeQuery, useApp } from '@/lib/app'
import { cn } from '@/lib/utils'

type PublicPlan = Plan & { destRoot: string }

export function ApplyPage() {
  const { scope, go } = useApp()
  const q = scopeQuery(scope)
  const { data: plan, setData } = useApi<PublicPlan | null>(`/plan${q}`, (e) => e.type === 'job' && (e.job?.kind === 'plan' || e.job?.kind === 'apply') && e.job.status !== 'running')
  const job = useJob()
  const [confirm, setConfirm] = useState(false)
  const building = job?.kind === 'plan' && job.status === 'running'
  const applying = job?.kind === 'apply' && job.status === 'running'

  const build = () => api(`/plan${q}`, { body: {} }).catch((e) => toast.error(e.message))
  const apply = async () => {
    setConfirm(false)
    try {
      await api(`/apply${q}`, { body: {} })
      setData(null)
      toast.success('Organizing your library…', { description: 'You can undo this run from History.' })
    } catch (e) {
      toast.error((e as Error).message)
    }
  }

  return (
    <>
      <PageHeader
        title="Preview & apply"
        description="Exactly what will happen to your files. Nothing changes until you press Apply, and every run can be undone."
        actions={
          plan && (
            <>
              <Button variant="outline" disabled={building || applying} onClick={() => void build()}>
                <RefreshCw /> Rebuild
              </Button>
              <Button disabled={!plan.albums.length || building || applying} onClick={() => setConfirm(true)}>
                <Play /> Apply changes
              </Button>
            </>
          )
        }
      />

      {!plan ? (
        <div className="flex flex-col items-center rounded-xl border border-dashed py-20 text-center">
          {building || applying ? (
            <>
              <Loader2 className="mb-4 size-6 animate-spin text-muted-foreground" />
              <p className="text-sm text-muted-foreground">{applying ? 'Organizing… you can watch progress at the top.' : 'Working out where everything goes…'}</p>
            </>
          ) : (
            <>
              <h2 className="text-lg font-semibold">See what will change</h2>
              <p className="mt-1 max-w-md text-sm text-muted-foreground">
                Builds a full list of moves, renames and tag updates for every matched or confirmed album, using your current rules.
              </p>
              <Button className="mt-6" onClick={() => void build()}>
                Build preview <ArrowRight />
              </Button>
            </>
          )}
        </div>
      ) : !plan.albums.length ? (
        <div className="rounded-xl border border-dashed py-16 text-center text-sm text-muted-foreground">
          Nothing to do. Match or confirm some albums first.
          <div className="mt-4">
            <Button variant="outline" onClick={() => go('review')}>
              Go to Review
            </Button>
          </div>
        </div>
      ) : (
        <>
          <div className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6">
            <Count icon={FileAudio} label="Files moved" n={plan.counts.moves} />
            <Count icon={Tags} label="Tags updated" n={plan.counts.tagWrites} />
            <Count icon={Image} label="Album art" n={plan.counts.art} />
            <Count icon={Trash2} label="Duplicates set aside" n={plan.counts.duplicates} />
            <Count icon={FileAudio} label="Extra files" n={plan.counts.leftovers} />
            <Count icon={FolderX} label="Folders cleaned" n={plan.counts.rmdirs} />
          </div>
          <div className="overflow-hidden rounded-xl border">
            {plan.albums.map((a) => (
              <AlbumPlan key={a.albumId} a={a} />
            ))}
          </div>
        </>
      )}

      <Dialog open={confirm} onOpenChange={setConfirm}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Organize {plan?.albums.length} albums?</DialogTitle>
            <DialogDescription>
              This moves {plan?.counts.moves.toLocaleString()} files and updates tags in {plan?.counts.tagWrites.toLocaleString()}. Every change is recorded, so you can undo the
              whole run from History.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setConfirm(false)}>
              Cancel
            </Button>
            <Button onClick={() => void apply()}>Apply changes</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}

function Count({ icon: Icon, label, n }: { icon: typeof FileAudio; label: string; n: number }) {
  return (
    <div className="rounded-xl border bg-card/40 px-4 py-3">
      <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <Icon className="size-3.5" /> {label}
      </div>
      <div className="mt-1 text-xl font-semibold tabular-nums">{n.toLocaleString()}</div>
    </div>
  )
}

const base = (p: string) => p.split('/').slice(-2).join('/')

function AlbumPlan({ a }: { a: PlanAlbum }) {
  const [open, setOpen] = useState(false)
  const rows = [
    ...a.moves.map((m) => ({ ...m, kind: '' })),
    ...a.leftovers.map((m) => ({ ...m, kind: 'extra' })),
    ...a.duplicates.map((m) => ({ ...m, kind: 'duplicate' })),
  ]
  return (
    <div className="border-b last:border-b-0">
      <button onClick={() => setOpen(!open)} className="flex w-full items-center gap-3 px-4 py-2.5 text-left text-sm hover:bg-muted/40">
        <ChevronRight className={cn('size-4 text-muted-foreground transition-transform', open && 'rotate-90')} />
        <AlbumCover releaseId={a.releaseId} className="size-9 rounded-md" />
        <div className="min-w-0 flex-1">
          <div className="truncate font-mono text-[13px]">{a.destFolder}</div>
          <div className="truncate text-xs text-muted-foreground">
            {a.moves.length} files{a.tagChanges ? ` · ${a.tagChanges} tag updates` : ''}
            {a.leftovers.length ? ` · ${a.leftovers.length} extras` : ''}
            {a.duplicates.length ? ` · ${a.duplicates.length} duplicates` : ''}
          </div>
        </div>
      </button>
      {open && (
        <ul className="space-y-1 bg-muted/20 px-12 py-3 font-mono text-[11.5px]">
          {rows.map((r) => (
            <li key={r.from} className="grid grid-cols-[1fr_auto_1fr] items-center gap-3">
              <span className="truncate text-muted-foreground" title={r.from}>
                {base(r.from)}
              </span>
              <ArrowRight className="size-3 text-muted-foreground/50" />
              <span className={cn('truncate', r.kind === 'duplicate' && 'text-orange-400', r.kind === 'extra' && 'text-muted-foreground')} title={r.to}>
                {base(r.to)}
              </span>
            </li>
          ))}
          {!rows.length && <li className="text-muted-foreground">Tags and art only — files are already in place.</li>}
        </ul>
      )}
    </div>
  )
}
