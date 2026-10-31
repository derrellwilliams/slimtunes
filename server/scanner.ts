import { createHash } from 'node:crypto'
import { readdir, rm, stat } from 'node:fs/promises'
import path from 'node:path'
import { parseFile } from 'music-metadata'
import type { TrackFile } from '../shared/types.ts'
import { removeEmptyDirs } from './cleanup.ts'
import { config } from './config.ts'
import { type AlbumRow, db, getAlbum, listAlbums, putAlbum, tx } from './db.ts'
import { emit } from './events.ts'
import { normalize } from './text.ts'

export const AUDIO_EXT = new Set(['mp3', 'flac', 'm4a', 'mp4', 'aac', 'ogg', 'oga', 'opus', 'wav', 'aif', 'aiff', 'wma', 'ape', 'wv'])
const LOSSLESS = new Set(['flac', 'wav', 'aif', 'aiff', 'ape', 'wv'])
/** Folders SlimTunes writes into; never scanned as library content. */
export const SPECIAL_DIRS = new Set(['_duplicates', '_leftovers'])

/** Temp copies the tagger writes before swapping them in. Left behind only if SlimTunes was stopped mid-write. */
const TEMP_FILE = /^\.slimtunes-[0-9a-f]{12}\.[a-z0-9]+$/i

async function removeStaleTemp(p: string) {
  const st = await stat(p).catch(() => null)
  if (!st || Date.now() - st.mtimeMs < 10 * 60 * 1000) return // might still be in use
  await rm(p, { force: true })
  await rm(path.join(path.dirname(p), `._${path.basename(p)}`), { force: true }) // macOS metadata twin on FAT/exFAT
}

export async function walk(dir: string, out: string[] = []): Promise<string[]> {
  let entries
  try {
    entries = await readdir(dir, { withFileTypes: true })
  } catch {
    return out
  }
  for (const e of entries) {
    if (TEMP_FILE.test(e.name)) await removeStaleTemp(path.join(dir, e.name))
    if (e.name.startsWith('.')) continue
    const p = path.join(dir, e.name)
    if (e.isDirectory()) {
      if (!SPECIAL_DIRS.has(e.name)) await walk(p, out)
    } else if (e.isFile() && AUDIO_EXT.has(ext(e.name))) out.push(p)
  }
  return out
}

export function ext(p: string) {
  return path.extname(p).slice(1).toLowerCase()
}

export async function readTrack(root: string, p: string, size: number): Promise<TrackFile> {
  const format = ext(p)
  const base: TrackFile = {
    path: p,
    rel: path.relative(root, p),
    format,
    lossless: LOSSLESS.has(format),
    bitrate: null,
    duration: null,
    size,
    tags: {},
  }
  try {
    const meta = await parseFile(p, { skipCovers: true, duration: false })
    const c = meta.common
    base.lossless = meta.format.lossless ?? base.lossless
    base.bitrate = meta.format.bitrate ? Math.round(meta.format.bitrate / 1000) : null
    base.duration = meta.format.duration ?? null
    base.tags = {
      title: c.title,
      artist: c.artist,
      albumartist: c.albumartist,
      album: c.album,
      track: c.track.no ?? undefined,
      disc: c.disk.no ?? undefined,
      year: c.year,
      mbReleaseId: c.musicbrainz_albumid,
      mbRecordingId: c.musicbrainz_recordingid,
    }
  } catch {
    // Unreadable tags — keep the file, it'll be flagged as untagged.
  }
  return base
}

/** "Artist/Album/Disc 2" -> "Artist/Album" so multi-disc folders group together. */
function albumFolder(rel: string) {
  const dir = path.dirname(rel)
  return /^(cd|dis[ck])\s*\d+$/i.test(path.basename(dir)) ? path.dirname(dir) : dir
}

function groupKey(t: TrackFile): string {
  if (t.tags.mbReleaseId) return `mb:${t.tags.mbReleaseId}`
  if (t.tags.album) return `t:${normalize(t.tags.album)}|${albumFolder(t.rel)}`
  return `d:${path.dirname(t.rel)}`
}

export function albumId(root: string, key: string) {
  return createHash('sha1').update(`${root}\0${key}`).digest('hex').slice(0, 16)
}

function guessAlbum(files: TrackFile[]): { title: string; artist: string } {
  const mode = (vals: (string | undefined)[]) => {
    const counts = new Map<string, number>()
    for (const v of vals) if (v) counts.set(v, (counts.get(v) ?? 0) + 1)
    return [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0]
  }
  const folder = path.basename(albumFolder(files[0].rel))
  const artists = new Set(files.map((f) => f.tags.artist).filter(Boolean))
  return {
    title: mode(files.map((f) => f.tags.album)) ?? folder,
    artist:
      mode(files.map((f) => f.tags.albumartist)) ??
      (artists.size > 1 && files.length > 3 ? 'Various Artists' : mode(files.map((f) => f.tags.artist))) ??
      path.basename(path.dirname(albumFolder(files[0].rel))),
  }
}

export async function scanLibrary(root: string, progress: (done: number, total: number, msg?: string) => void) {
  progress(0, 0, 'Finding music files…')
  const paths = await walk(root)
  const known = new Map(
    (db.prepare('SELECT path, mtime, size FROM tracks WHERE root = ?').all(root) as { path: string; mtime: number; size: number }[]).map(
      (r) => [r.path, r],
    ),
  )
  const seen = new Set<string>()
  const upsert = db.prepare(
    'INSERT INTO tracks (path, root, mtime, size, data) VALUES (?, ?, ?, ?, ?) ON CONFLICT(path) DO UPDATE SET root=excluded.root, mtime=excluded.mtime, size=excluded.size, data=excluded.data',
  )

  let done = 0
  const queue = [...paths]
  const worker = async () => {
    for (let p = queue.shift(); p; p = queue.shift()) {
      seen.add(p)
      const st = await stat(p).catch(() => null)
      if (st) {
        const prev = known.get(p)
        if (!prev || prev.mtime !== st.mtimeMs || prev.size !== st.size) {
          const t = await readTrack(root, p, st.size)
          upsert.run(p, root, st.mtimeMs, st.size, JSON.stringify(t))
        }
      }
      progress(++done, paths.length, path.basename(p))
    }
  }
  await Promise.all(Array.from({ length: 8 }, worker))

  tx(() => {
    const del = db.prepare('DELETE FROM tracks WHERE path = ?')
    for (const p of known.keys()) if (!seen.has(p)) del.run(p)
  })
  if (config.rules.removeEmptyFolders) removeEmptyDirs(root)
  regroup(root)
  return { tracks: paths.length }
}

/** Rebuild album groups from tracks, preserving decisions for albums whose file set is unchanged. */
export function regroup(root: string) {
  const tracks = (db.prepare('SELECT data FROM tracks WHERE root = ?').all(root) as { data: string }[]).map(
    (r) => JSON.parse(r.data) as TrackFile,
  )
  const groups = new Map<string, TrackFile[]>()
  for (const t of tracks) {
    const k = groupKey(t)
    groups.set(k, [...(groups.get(k) ?? []), t])
  }

  const prevOwner = new Map(
    (db.prepare('SELECT path, album_id FROM tracks WHERE root = ?').all(root) as { path: string; album_id: string | null }[]).map((r) => [
      r.path,
      r.album_id,
    ]),
  )
  tx(() => {
    const setAlbum = db.prepare('UPDATE tracks SET album_id = ? WHERE path = ?')
    const live = new Set<string>()
    for (const [key, files] of groups) {
      const id = albumId(root, key)
      live.add(id)
      const prevFiles = (db.prepare('SELECT path FROM tracks WHERE album_id = ?').all(id) as { path: string }[]).map((r) => r.path)
      const sameFiles = prevFiles.length === files.length && files.every((f) => prevFiles.includes(f.path))
      for (const f of files) setAlbum.run(id, f.path)
      const prev = getAlbum(id)
      const { title, artist } = guessAlbum(files)
      const folder = albumFolder(files[0].rel)
      if (prev && sameFiles) {
        putAlbum(root, { ...prev, title, artist, folder })
        continue
      }
      // Same files under a new key (e.g. MBIDs were written on apply): carry the old decision over.
      const inherited = prevOwner.get(files[0].path)
      if (!prev && inherited && files.every((f) => prevOwner.get(f.path) === inherited)) {
        const old = getAlbum(inherited)
        if (old) {
          putAlbum(root, { ...old, id, title, artist, folder })
          continue
        }
      }
      const album: AlbumRow = {
        id,
        title,
        artist,
        folder,
        status: prev?.status === 'leave' ? 'leave' : 'pending',
        confidence: null,
        candidates: [],
        chosen: null,
        release: null,
        alignment: null,
        duplicateFiles: [],
        singles: {},
        issues: files.every((f) => !f.tags.title && !f.tags.album)
          ? [{ kind: 'untagged', message: 'These files have no tags. Fingerprinting can identify them.' }]
          : [],
      }
      putAlbum(root, album)
    }
    const del = db.prepare('DELETE FROM albums WHERE id = ?')
    for (const a of listAlbums(root)) if (!live.has(a.id)) del.run(a.id)
  })
  emit({ type: 'albums' })
}
