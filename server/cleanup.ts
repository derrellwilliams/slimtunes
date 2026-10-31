import { readdirSync, rmdirSync, rmSync } from 'node:fs'
import path from 'node:path'

const JUNK = new Set(['.DS_Store', 'Thumbs.db', 'desktop.ini'])
/** OS clutter that shouldn't keep a folder alive (incl. macOS "._" metadata files on FAT/exFAT drives). */
export const isJunk = (name: string) => JUNK.has(name) || name.startsWith('._')

/** Folders under `root` that contain nothing but junk (deepest first). */
export function emptyDirs(root: string): string[] {
  const out: string[] = []
  const visit = (dir: string): boolean => {
    let entries
    try {
      entries = readdirSync(dir, { withFileTypes: true })
    } catch {
      return false
    }
    let empty = true
    for (const e of entries) {
      if (e.isDirectory()) {
        if (!visit(path.join(dir, e.name))) empty = false
      } else if (!isJunk(e.name)) empty = false
    }
    if (empty && dir !== root) out.push(dir)
    return empty
  }
  visit(root)
  return out
}

/** Delete folders under `root` that hold nothing but OS clutter. Returns how many were removed. */
export function removeEmptyDirs(root: string): number {
  let n = 0
  for (const dir of emptyDirs(root)) {
    try {
      for (const f of readdirSync(dir)) if (isJunk(f)) rmSync(path.join(dir, f), { force: true })
      rmdirSync(dir)
      n++
    } catch {
      /* in use or not actually empty — leave it */
    }
  }
  return n
}
