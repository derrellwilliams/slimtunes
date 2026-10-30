import { realpathSync } from 'node:fs'
import path from 'node:path'
import { HttpError } from './events.ts'

/** True when `p` is `root` or inside it (lexically, after resolving). */
export function isInside(root: string, p: string): boolean {
  const rel = path.relative(path.resolve(root), path.resolve(p))
  return rel === '' || (!!rel && !rel.startsWith('..') && !path.isAbsolute(rel))
}

/** Throw unless `p` (and its real path, if it exists) is inside `root`. Guards against `..` and symlink escapes. */
export function assertInside(root: string, p: string): string {
  const abs = path.resolve(p)
  if (!isInside(root, abs)) throw new HttpError(400, `Path escapes the library: ${p}`)
  try {
    const real = realpathSync(abs)
    if (!isInside(realpathSync(root), real)) throw new HttpError(400, `Symlink escapes the library: ${p}`)
  } catch (e) {
    if (e instanceof HttpError) throw e
    // Doesn't exist yet (a destination) — check its nearest existing parent instead.
    const parent = path.dirname(abs)
    if (parent !== abs && parent !== path.resolve(root)) assertInside(root, parent)
  }
  return abs
}
