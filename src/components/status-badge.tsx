import type { AlbumStatus } from '../../shared/types'
import { cn } from '@/lib/utils'

const LABEL: Record<AlbumStatus, string> = {
  pending: 'Not matched',
  matched: 'Matched',
  review: 'Needs review',
  unmatched: 'No match',
  accepted: 'Confirmed',
  singles: 'Singles',
  leave: 'Left as is',
  skipped: 'Skipped',
  duplicate: 'Duplicate',
  applied: 'Organized',
}

const TONE: Record<AlbumStatus, string> = {
  pending: 'bg-muted text-muted-foreground',
  matched: 'bg-emerald-500/10 text-emerald-400 ring-emerald-500/20',
  accepted: 'bg-emerald-500/10 text-emerald-400 ring-emerald-500/20',
  applied: 'bg-sky-500/10 text-sky-400 ring-sky-500/20',
  review: 'bg-amber-500/10 text-amber-400 ring-amber-500/20',
  unmatched: 'bg-rose-500/10 text-rose-400 ring-rose-500/20',
  singles: 'bg-violet-500/10 text-violet-400 ring-violet-500/20',
  duplicate: 'bg-orange-500/10 text-orange-400 ring-orange-500/20',
  leave: 'bg-muted text-muted-foreground',
  skipped: 'bg-muted text-muted-foreground',
}

export const statusLabel = (s: AlbumStatus) => LABEL[s]

export function StatusBadge({ status, className }: { status: AlbumStatus; className?: string }) {
  return (
    <span className={cn('inline-flex h-5 items-center rounded-full px-2 text-xs font-medium ring-1 ring-transparent ring-inset', TONE[status], className)}>
      {LABEL[status]}
    </span>
  )
}

export function ConfidenceMeter({ value }: { value: number | null }) {
  if (value === null) return <span className="text-muted-foreground">—</span>
  const pct = Math.round(value * 100)
  const tone = pct >= 90 ? 'bg-emerald-400' : pct >= 70 ? 'bg-amber-400' : 'bg-rose-400'
  return (
    <span className="inline-flex items-center gap-2 tabular-nums">
      <span className="h-1 w-12 overflow-hidden rounded-full bg-muted">
        <span className={cn('block h-full rounded-full', tone)} style={{ width: `${pct}%` }} />
      </span>
      <span className="text-xs text-muted-foreground">{pct}%</span>
    </span>
  )
}
