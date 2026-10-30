import { Disc3 } from 'lucide-react'
import { useState } from 'react'
import { coverUrl } from '@/lib/api'
import { cn } from '@/lib/utils'

export function AlbumCover({ releaseId, size = 250, className }: { releaseId?: string | null; size?: 250 | 500; className?: string }) {
  const [failed, setFailed] = useState(false)
  return (
    <div className={cn('relative aspect-square shrink-0 overflow-hidden rounded-lg border bg-muted/40', className)}>
      {releaseId && !failed ? (
        <img
          src={coverUrl(releaseId, size)}
          alt=""
          loading="lazy"
          referrerPolicy="no-referrer"
          onError={() => setFailed(true)}
          className="size-full object-cover"
        />
      ) : (
        <div className="flex size-full items-center justify-center text-muted-foreground/50">
          <Disc3 className="size-1/3" strokeWidth={1.25} />
        </div>
      )}
    </div>
  )
}
