import { RotateCcw } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import type { Run } from '../../shared/types'
import { useJob } from '@/components/job-bar'
import { PageHeader } from '@/components/page-header'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { api, useApi } from '@/lib/api'
import { cn } from '@/lib/utils'

const STATUS: Record<Run['status'], { label: string; tone: string }> = {
  applying: { label: 'Running', tone: 'text-sky-400' },
  applied: { label: 'Applied', tone: 'text-emerald-400' },
  failed: { label: 'Stopped with errors', tone: 'text-rose-400' },
  undoing: { label: 'Undoing', tone: 'text-sky-400' },
  undone: { label: 'Undone', tone: 'text-muted-foreground' },
}

export function HistoryPage() {
  const { data: runs } = useApi<Run[]>('/runs', (e) => e.type === 'job' && e.job?.status !== 'running')
  const [confirm, setConfirm] = useState<Run | null>(null)
  const job = useJob()
  const busy = job?.status === 'running'
  // Only the most recent un-undone run can be undone (later runs may have touched the same files).
  const undoable = runs?.find((r) => r.status === 'applied' || r.status === 'failed')?.id

  return (
    <>
      <PageHeader title="History" description="Every time SlimTunes changed files. Undo puts files, names, tags and folders back exactly as they were." />
      {!runs?.length ? (
        <div className="rounded-xl border border-dashed py-16 text-center text-sm text-muted-foreground">No changes yet.</div>
      ) : (
        <div className="overflow-hidden rounded-xl border">
          {runs.map((r) => (
            <div key={r.id} className="flex items-center gap-4 border-b px-5 py-3 text-sm last:border-b-0">
              <div className="w-44 shrink-0 tabular-nums text-muted-foreground">{new Date(r.createdAt).toLocaleString()}</div>
              <div className="flex-1">
                {r.albums} album{r.albums === 1 ? '' : 's'} · {r.ops.toLocaleString()} changes
                {r.source === 'inbox' && <span className="ml-2 rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">from inbox</span>}
              </div>
              <div className={cn('w-36 text-right', STATUS[r.status].tone)}>{STATUS[r.status].label}</div>
              <div className="w-24 text-right">
                {r.id === undoable && (
                  <Button size="sm" variant="outline" disabled={busy} onClick={() => setConfirm(r)}>
                    <RotateCcw /> Undo
                  </Button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
      <Dialog open={!!confirm} onOpenChange={(o) => !o && setConfirm(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Undo this run?</DialogTitle>
            <DialogDescription>
              Moves {confirm?.albums} album{confirm?.albums === 1 ? '' : 's'} back to where they were and restores their original tags and art.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setConfirm(null)}>
              Cancel
            </Button>
            <Button
              onClick={async () => {
                const id = confirm!.id
                setConfirm(null)
                try {
                  await api(`/runs/${id}/undo`, { body: {} })
                } catch (e) {
                  toast.error((e as Error).message)
                }
              }}
            >
              Undo run
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
