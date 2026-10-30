import { ChevronLeft, Folder, HardDrive, Home, Music } from 'lucide-react'
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { ScrollArea } from '@/components/ui/scroll-area'
import { useApi } from '@/lib/api'
import { cn } from '@/lib/utils'

interface Listing {
  path: string
  parent: string | null
  dirs: string[]
  places: { name: string; path: string }[]
}

export function FolderPicker({
  open,
  onOpenChange,
  onPick,
  title = 'Choose your music folder',
  description = 'SlimTunes will look at every music file inside this folder.',
  initial,
}: {
  open: boolean
  onOpenChange: (o: boolean) => void
  onPick: (path: string) => void
  title?: string
  description?: string
  initial?: string | null
}) {
  const [path, setPath] = useState<string>(initial ?? '')
  const [typed, setTyped] = useState<string | null>(null)
  const { data, error } = useApi<Listing>(open ? `/fs?path=${encodeURIComponent(path)}` : null)
  const current = data?.path ?? path

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-[160px_1fr] gap-4">
          <nav className="flex flex-col gap-0.5 text-sm">
            {data?.places.map((p) => {
              const Icon = p.name === 'Home' ? Home : p.name === 'Music' ? Music : HardDrive
              return (
                <button
                  key={p.path}
                  onClick={() => setPath(p.path)}
                  className={cn(
                    'flex items-center gap-2 rounded-md px-2 py-1.5 text-left text-muted-foreground hover:bg-muted hover:text-foreground',
                    current === p.path && 'bg-muted text-foreground',
                  )}
                >
                  <Icon className="size-4" />
                  <span className="truncate">{p.name}</span>
                </button>
              )
            })}
          </nav>
          <div className="flex min-w-0 flex-col gap-2">
            <div className="flex items-center gap-2">
              <Button variant="ghost" size="icon-sm" disabled={!data?.parent} onClick={() => data?.parent && setPath(data.parent)}>
                <ChevronLeft />
              </Button>
              <Input
                value={typed ?? current}
                onChange={(e) => setTyped(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && typed) {
                    setPath(typed)
                    setTyped(null)
                  }
                }}
                className="font-mono text-xs"
              />
            </div>
            <ScrollArea className="h-72 rounded-lg border">
              <div className="p-1">
                {error && <p className="p-3 text-sm text-destructive">{error.message}</p>}
                {data?.dirs.length === 0 && <p className="p-3 text-sm text-muted-foreground">No folders in here.</p>}
                {data?.dirs.map((d) => (
                  <button
                    key={d}
                    onDoubleClick={() => setPath(`${current}/${d}`)}
                    onClick={() => setPath(`${current}/${d}`)}
                    className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-muted"
                  >
                    <Folder className="size-4 text-muted-foreground" />
                    <span className="truncate">{d}</span>
                  </button>
                ))}
              </div>
            </ScrollArea>
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            onClick={() => {
              onPick(current)
              onOpenChange(false)
            }}
          >
            Use this folder
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
