import { CheckCircle2, Loader2, XCircle } from 'lucide-react'
import { useEffect, useState } from 'react'
import type { Job } from '../../shared/types'
import { useServerEvents } from '@/lib/api'
import { useApp } from '@/lib/app'
import { cn } from '@/lib/utils'

const VERB: Record<Job['kind'], string> = {
  scan: 'Scanning',
  match: 'Matching with MusicBrainz',
  plan: 'Building preview',
  apply: 'Organizing',
  undo: 'Undoing',
  fingerprint: 'Fingerprinting',
  inbox: 'Processing inbox',
}

/** Live progress for whatever the server is doing. */
export function useJob() {
  const { state } = useApp()
  const [job, setJob] = useState<Job | null>(state?.job ?? null)
  useEffect(() => setJob(state?.job ?? null), [state?.job])
  useServerEvents((e) => {
    if (e.type === 'job') setJob(e.job)
  })
  return job
}

export function JobBar() {
  const job = useJob()
  const [visible, setVisible] = useState(false)
  useEffect(() => {
    if (!job) return setVisible(false)
    setVisible(true)
    if (job.status === 'done') {
      const t = setTimeout(() => setVisible(false), 2500)
      return () => clearTimeout(t)
    }
  }, [job])
  if (!job || !visible) return null
  const pct = job.total ? Math.round((job.done / job.total) * 100) : null
  return (
    <div className="sticky top-0 z-20 border-b bg-background/80 backdrop-blur">
      <div className="mx-auto flex max-w-6xl items-center gap-3 px-8 py-2.5 text-sm">
        {job.status === 'running' ? (
          <Loader2 className="size-4 animate-spin text-muted-foreground" />
        ) : job.status === 'done' ? (
          <CheckCircle2 className="size-4 text-emerald-400" />
        ) : (
          <XCircle className="size-4 text-rose-400" />
        )}
        <span className="font-medium">{job.status === 'error' ? `${VERB[job.kind]} failed` : VERB[job.kind]}</span>
        <span className="min-w-0 flex-1 truncate text-muted-foreground">{job.message}</span>
        {job.total > 0 && (
          <span className="tabular-nums text-muted-foreground">
            {job.done.toLocaleString()} / {job.total.toLocaleString()}
          </span>
        )}
      </div>
      {job.status === 'running' && (
        <div className="h-px w-full bg-border">
          <div
            className={cn('h-px bg-foreground transition-[width] duration-300', pct === null && 'w-1/3 animate-pulse')}
            style={pct !== null ? { width: `${pct}%` } : undefined}
          />
        </div>
      )}
    </div>
  )
}
