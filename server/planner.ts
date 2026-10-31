import { existsSync, readdirSync } from 'node:fs'
import path from 'node:path'
import type { Plan, PlanAlbum, PlanOp, Release, ReleaseTrack, Rules, TrackFile } from '../shared/types.ts'
import { albumFiles, db, listAlbums } from './db.ts'
import { AUDIO_EXT, ext } from './scanner.ts'
import { emptyDirs, isJunk } from './cleanup.ts'
import { coverKnownMissing } from './coverart.ts'
import { renderTemplate, type TemplateValues } from './template.ts'
import { year } from './text.ts'
import type { TagValues } from './tagger.ts'

export const VARIOUS_ARTISTS_ID = '89ad4ac3-39f7-470e-963a-56509c546377'
const IMAGE_EXT = new Set(['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp'])

/** Order- and format-insensitive genre set: ID3 may read back ["Ambient", "Post-Rock;Art Rock"]. */
export function genreKey(genres: string[] | undefined): string {
  return [...new Set((genres ?? []).flatMap((g) => g.split(/[;/\0]/)).map((g) => g.trim().toLowerCase()).filter(Boolean))].sort().join('|')
}

/** A whole album ripped to one file with a .cue sheet. SlimTunes can't split it, so it's filed as-is. */
export function isSingleFileRip(files: TrackFile[], release: Release) {
  if (files.length !== 1 || release.tracks.length <= 2) return false
  // A lone track from a bigger album is not a rip: require the file to span most of the album, or a .cue next to it.
  const [f] = files
  const total = release.tracks.reduce((n, t) => n + (t.length ?? 0), 0)
  if (f.duration && total) return f.duration > total * 0.5
  try {
    return readdirSync(path.dirname(f.path)).some((n) => n.toLowerCase().endsWith('.cue'))
  } catch {
    return false
  }
}

export function isCompilation(r: Release) {
  return r.artistIds.includes(VARIOUS_ARTISTS_ID)
}

/** "A feat. B" -> { main: "A", featured: "B" } */
export function splitFeatured(credit: string): { main: string; featured: string | null } {
  const m = credit.match(/^(.*?)\s+(?:feat\.?|ft\.|featuring)\s+(.+)$/i)
  return m ? { main: m[1], featured: m[2] } : { main: credit, featured: null }
}

export function trackNames(track: ReleaseTrack, rules: Rules) {
  if (rules.featuredArtists === 'artist') return { artist: track.artist, title: track.title }
  const { main, featured } = splitFeatured(track.artist)
  const title = featured && !/\b(feat|ft)\b/i.test(track.title) ? `${track.title} (feat. ${featured})` : track.title
  return { artist: main, title }
}

export function templateValues(release: Release, track: ReleaseTrack, rules: Rules): TemplateValues {
  const { artist, title } = trackNames(track, rules)
  const original = year(release.originalDate)
  return {
    albumartist: release.artist,
    artist,
    album: release.title,
    year: (rules.release.preferOriginalYear && original) || year(release.date),
    originalyear: original || year(release.date),
    track: track.position,
    tracktotal: release.tracks.filter((t) => t.disc === track.disc).length,
    disc: track.disc,
    disctotal: release.discCount,
    title,
    type: release.primaryType ?? '',
    country: release.country ?? '',
    label: release.label ?? '',
    format: release.formats[0] ?? '',
  }
}

/** Relative destination (without extension) for one track of a release. */
export function destFor(release: Release, track: ReleaseTrack, rules: Rules): string {
  const values = templateValues(release, track, rules)
  const comp = isCompilation(release)
  let folder = renderTemplate(comp ? rules.compilationFolderTemplate : rules.folderTemplate, values)
  let file = renderTemplate(comp ? rules.compilationFileTemplate : rules.fileTemplate, values)
  if (release.discCount > 1) {
    if (rules.multiDisc === 'subfolder') folder += `/Disc ${track.disc}`
    else file = `${track.disc}-${file}`
  }
  return `${folder}/${file}`
}

export function tagValuesFor(release: Release, track: ReleaseTrack, rules: Rules, genres: string[]): TagValues {
  const { artist, title } = trackNames(track, rules)
  const y = Number((rules.release.preferOriginalYear && year(release.originalDate)) || year(release.date)) || undefined
  return {
    title,
    artist,
    albumArtist: release.artist,
    album: release.title,
    year: y,
    track: track.position,
    trackCount: release.tracks.filter((t) => t.disc === track.disc).length,
    disc: track.disc,
    discCount: release.discCount,
    genres: rules.genres.enabled ? genres : undefined,
    compilation: isCompilation(release),
    mbTrackId: track.recordingId,
    mbReleaseId: release.id,
    mbReleaseGroupId: release.releaseGroupId ?? undefined,
    mbArtistId: track.artistIds[0],
    mbReleaseArtistId: release.artistIds[0],
    mbReleaseCountry: release.country ?? undefined,
    mbReleaseStatus: release.status?.toLowerCase(),
    mbReleaseType: release.primaryType?.toLowerCase(),
  }
}

/** Reserve unique destinations, case-insensitively (APFS/SMB are usually case-insensitive). */
class Reserver {
  private taken = new Set<string>()
  private sources: Set<string>
  constructor(sources: string[]) {
    this.sources = new Set(sources.map((s) => s.toLowerCase()))
  }
  reserve(dest: string, source: string): string {
    const extName = path.extname(dest)
    const stem = dest.slice(0, dest.length - extName.length)
    for (let n = 1; ; n++) {
      const candidate = n === 1 ? dest : `${stem} (${n})${extName}`
      const key = candidate.toLowerCase()
      const onDisk = existsSync(candidate) && key !== source.toLowerCase() && !this.sources.has(key)
      if (!this.taken.has(key) && !onDisk) {
        this.taken.add(key)
        return candidate
      }
    }
  }
}

function changes(f: TrackFile, v: TagValues): Record<string, [string, string]> {
  const out: Record<string, [string, string]> = {}
  const cmp = (k: string, a: unknown, b: unknown) => {
    // writeTags leaves a field alone when it has no new value, so that isn't a change.
    if (b === undefined || b === null || b === 0) return
    const x = a === undefined || a === null ? '' : String(a)
    const y = String(b)
    if (x !== y) out[k] = [x, y]
  }
  cmp('title', f.tags.title, v.title)
  cmp('artist', f.tags.artist, v.artist)
  cmp('album artist', f.tags.albumartist, v.albumArtist)
  cmp('album', f.tags.album, v.album)
  cmp('track', f.tags.track, v.track)
  cmp('disc', f.tags.disc, v.disc)
  cmp('year', f.tags.year, v.year)
  return out
}

/** Non-audio files sitting next to the album's files. Shared folders (several albums) are never emptied wholesale. */
function leftoversFor(srcRoot: string, files: TrackFile[]) {
  const dirs = [...new Set(files.map((f) => path.dirname(f.path)))]
  const out: { path: string; dir: string; shared: boolean }[] = []
  const owner = db.prepare('SELECT COUNT(DISTINCT album_id) AS n FROM tracks WHERE root = ? AND path LIKE ? ESCAPE ?')
  for (const dir of dirs) {
    const like = dir.replace(/[\\%_]/g, (c) => `\\${c}`) + path.sep + '%'
    const n = (owner.get(srcRoot, like, '\\') as { n: number }).n
    let entries
    try {
      entries = readdirSync(dir, { withFileTypes: true })
    } catch {
      continue
    }
    for (const e of entries) {
      if (!e.isFile() || e.name.startsWith('.') || isJunk(e.name) || AUDIO_EXT.has(ext(e.name))) continue
      out.push({ path: path.join(dir, e.name), dir, shared: n > 1 })
    }
  }
  return out
}

export interface BuildPlanOptions {
  srcRoot: string
  destRoot: string
  rules: Rules
  albumIds?: string[]
  genres: (release: Release) => Promise<string[]>
}

export interface ExecPlan extends Plan {
  tagValues: Record<string, TagValues> // source path -> values
  srcRoot: string
  destRoot: string
}

export async function buildPlan(o: BuildPlanOptions): Promise<ExecPlan> {
  const { rules, srcRoot, destRoot } = o
  const albums = listAlbums(srcRoot).filter((a) => !o.albumIds || o.albumIds.includes(a.id))
  const allSources = (db.prepare('SELECT path FROM tracks WHERE root = ?').all(srcRoot) as { path: string }[]).map((r) => r.path)
  const reserve = new Reserver(allSources)
  const ops: PlanOp[] = []
  const planAlbums: PlanAlbum[] = []
  const tagValues: Record<string, TagValues> = {}
  const sourceDirs = new Set<string>()
  const toDupes = (p: string) => path.join(destRoot, '_duplicates', path.relative(srcRoot, p))
  const toLeftovers = (p: string) => path.join(destRoot, '_leftovers', path.relative(srcRoot, p))

  for (const a of albums) {
    const files = albumFiles(a.id)
    if (!files.length) continue
    const pa: PlanAlbum = { albumId: a.id, title: a.title, artist: a.artist, releaseId: null, destFolder: '', moves: [], tagChanges: 0, leftovers: [], duplicates: [] }
    const move = (from: string, to: string, bucket: 'moves' | 'leftovers' | 'duplicates') => {
      if (from === to) return
      const dest = reserve.reserve(to, from)
      if (dest === from) return
      ops.push({ kind: 'move', from, to: dest, albumId: a.id })
      pa[bucket].push({ from, to: dest })
      sourceDirs.add(path.dirname(from))
    }

    if (a.status === 'duplicate') {
      pa.destFolder = path.join('_duplicates', a.folder)
      for (const f of files) move(f.path, toDupes(f.path), 'duplicates')
      for (const l of leftoversFor(srcRoot, files)) if (!l.shared) move(l.path, toDupes(l.path), 'leftovers')
    } else if ((a.status === 'matched' || a.status === 'accepted' || a.status === 'applied') && a.release && a.alignment) {
      // Organized albums are re-checked too: missing covers come back, rule changes apply, and anything already right is skipped.
      const release = a.release
      const genres = rules.genres.enabled ? await o.genres(release).catch(() => []) : []
      const byTrack = new Map(release.tracks.map((t) => [t.id, t]))
      const aligned = new Map(a.alignment.map((x) => [x.filePath, x.trackId]))
      let folderAbs = ''
      pa.releaseId = release.id
      const singleFile = isSingleFileRip(files, release)
      for (const f of files) {
        if (a.duplicateFiles.includes(f.path)) {
          if (rules.duplicates === 'move-to-duplicates') move(f.path, toDupes(f.path), 'duplicates')
          continue
        }
        if (singleFile) {
          // One file holding the whole album (+ .cue): file it in the album folder under its own name, tags untouched.
          const first = release.tracks[0]
          const albumDir = path.dirname(path.join(destRoot, destFor(release, first, rules)))
          folderAbs = rules.multiDisc === 'subfolder' && release.discCount > 1 ? path.dirname(albumDir) : albumDir
          move(f.path, path.join(folderAbs, path.basename(f.path)), 'moves')
          continue
        }
        const track = byTrack.get(aligned.get(f.path) ?? '')
        if (!track) continue
        const dest = path.join(destRoot, `${destFor(release, track, rules)}.${f.format}`)
        // The album folder is the part of the path common to all tracks, minus Disc N.
        const albumDir = rules.multiDisc === 'subfolder' && release.discCount > 1 ? path.dirname(path.dirname(dest)) : path.dirname(dest)
        folderAbs ||= albumDir
        const v = tagValuesFor(release, track, rules, genres)
        const ch = changes(f, v)
        // Already organized and tagged with this exact release: skip the (slow) rewrite.
        const sameGenres = !v.genres?.length || genreKey(f.tags.genres) === genreKey(v.genres)
        const upToDate =
          !Object.keys(ch).length &&
          f.tags.mbReleaseId === release.id &&
          f.tags.mbRecordingId === track.recordingId &&
          sameGenres &&
          (!rules.art.embed || f.hasArt !== false || coverKnownMissing(release.id, rules.art.size))
        if (!upToDate) {
          tagValues[f.path] = v
          pa.tagChanges += Object.keys(ch).length ? 1 : 0
          ops.push({ kind: 'tags', path: f.path, albumId: a.id, changes: ch })
        }
        move(f.path, dest, 'moves')
      }
      // Files that didn't map to a track ride along with the album under their current names.
      for (const f of files) {
        if (aligned.get(f.path) || a.duplicateFiles.includes(f.path) || !folderAbs || singleFile) continue
        move(f.path, path.join(folderAbs, path.basename(f.path)), 'moves')
      }
      pa.destFolder = path.relative(destRoot, folderAbs)
      const coverPath = folderAbs && path.join(folderAbs, rules.art.fileName)
      // Skip when the Cover Art Archive already told us there's no image, or this album would show up in every preview.
      if (coverPath && rules.art.saveFile && !existsSync(coverPath) && !coverKnownMissing(release.id, rules.art.size)) ops.push({ kind: 'art', to: coverPath, albumId: a.id, releaseId: release.id })
      if (rules.leftovers !== 'leave' && folderAbs) {
        for (const l of leftoversFor(srcRoot, files)) {
          // Anything already in the album's final folder (including our own cover.jpg) stays put.
          if (path.resolve(l.dir) === path.resolve(folderAbs)) continue
          const isImage = IMAGE_EXT.has(ext(l.path))
          const withAlbum = rules.leftovers === 'move-with-album' && !l.shared && !(isImage && rules.art.saveFile)
          move(l.path, withAlbum ? path.join(folderAbs, path.relative(l.dir, l.path)) : toLeftovers(l.path), 'leftovers')
        }
      }
    } else if (a.status === 'singles') {
      for (const f of files) {
        const s = a.singles[f.path]
        if (!s) continue
        const rel = renderTemplate(rules.singlesTemplate, { artist: s.artist, albumartist: s.artist, title: s.title, year: s.year ?? '' })
        tagValues[f.path] = { title: s.title, artist: s.artist, mbTrackId: s.recordingId, mbArtistId: s.artistId ?? undefined }
        ops.push({ kind: 'tags', path: f.path, albumId: a.id, changes: changes(f, tagValues[f.path]) })
        pa.tagChanges++
        move(f.path, path.join(destRoot, `${rel}.${f.format}`), 'moves')
      }
      pa.destFolder = path.dirname(renderTemplate(rules.singlesTemplate, { artist: a.artist, albumartist: a.artist, title: 'x' }))
    } else continue

    if (pa.moves.length || pa.leftovers.length || pa.duplicates.length || ops.some((op) => (op.kind === 'art' || op.kind === 'tags') && op.albumId === a.id))
      planAlbums.push(pa)
  }

  // Source folders emptied by this run, plus any empty folders left over from earlier or interrupted runs.
  const rmdirs = new Set<string>()
  if (rules.removeEmptyFolders) {
    for (const d of sourceDirs) rmdirs.add(d)
    for (const d of await emptyDirs(destRoot)) rmdirs.add(d)
    for (const d of rmdirs) ops.push({ kind: 'rmdir', path: d })
  }

  return {
    createdAt: Date.now(),
    albums: planAlbums,
    ops,
    tagValues,
    srcRoot,
    destRoot,
    counts: {
      moves: planAlbums.reduce((n, p) => n + p.moves.length, 0),
      tagWrites: ops.filter((op) => op.kind === 'tags').length,
      art: ops.filter((op) => op.kind === 'art').length,
      rmdirs: rmdirs.size,
      duplicates: planAlbums.reduce((n, p) => n + p.duplicates.length, 0),
      leftovers: planAlbums.reduce((n, p) => n + p.leftovers.length, 0),
    },
  }
}
