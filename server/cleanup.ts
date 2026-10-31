import { readdir } from 'node:fs/promises'
import path from 'node:path'

const JUNK = new Set(['.DS_Store', 'Thumbs.db', 'desktop.ini'])
/** OS clutter that shouldn't keep a folder alive (incl. macOS "._" metadata files on FAT/exFAT drives). */
export const isJunk = (name: string) => JUNK.has(name) || name.startsWith('._')

/**
 * Folders under `root` that contain nothing but junk (deepest first).
 * Async so a big library on a slow drive doesn't freeze the server. Removal happens in the
 * applier as journaled `rmdir` steps, so it shows in the preview and can be undone.
 */
export async function emptyDirs(root: string): Promise<string[]> {
  const out: string[] = []
  const visit = async (dir: string): Promise<boolean> => {
    let entries
    try {
      entries = await readdir(dir, { withFileTypes: true })
    } catch {
      return false
    }
    let empty = true
    for (const e of entries) {
      if (e.isDirectory()) {
        // Hidden folders belong to the OS or other apps (.Trashes, .stfolder, .git…) — never touch them.
        if (e.name.startsWith('.') || !(await visit(path.join(dir, e.name)))) empty = false
      } else if (!isJunk(e.name)) empty = false
    }
    if (empty && dir !== root) out.push(dir)
    return empty
  }
  await visit(root)
  return out
}
