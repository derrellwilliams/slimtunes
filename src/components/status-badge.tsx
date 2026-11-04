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
  matched: 'bg-success/10 text-success ring-success/20',
  accepted: 'bg-success/10 text-success ring-success/20',
  applied: 'bg-info/10 text-info ring-info/20',
  review: 'bg-warning/10 text-warning ring-warning/20',
  unmatched: 'bg-destructive/10 text-destructive ring-destructive/20',
  singles: 'bg-special/10 text-special ring-special/20',
  duplicate: 'bg-duplicate/10 text-duplicate ring-duplicate/20',
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
  const tone = pct >= 90 ? 'bg-success' : pct >= 70 ? 'bg-warning' : 'bg-destructive'
  return (
    <span className="inline-flex items-center gap-2 tabular-nums">
      <span className="h-1 w-12 overflow-hidden rounded-full bg-muted">
        <span className={cn('block h-full rounded-full', tone)} style={{ width: `${pct}%` }} />
      </span>
      <span className="text-xs text-muted-foreground">{pct}%</span>
    </span>
  )
}
