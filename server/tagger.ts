import { createHash, randomBytes } from 'node:crypto'
import { copyFileSync, existsSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { ByteVector, File, Picture, PictureType, TagTypes } from 'node-taglib-sharp'
import { BLOB_DIR } from './paths.ts'

export interface TagValues {
  title: string
  artist: string
  albumArtist?: string
  album?: string
  year?: number
  track?: number
  trackCount?: number
  disc?: number
  discCount?: number
  genres?: string[]
  compilation?: boolean
  mbTrackId?: string // recording id (Picard's MUSICBRAINZ_TRACKID)
  mbReleaseId?: string
  mbReleaseGroupId?: string
  mbArtistId?: string
  mbReleaseArtistId?: string
  mbReleaseCountry?: string
  mbReleaseStatus?: string
  mbReleaseType?: string
}

/** Everything we might overwrite, so undo can put it back. Pictures are stored once by hash. */
export interface TagSnapshot {
  title: string | undefined
  performers: string[]
  albumArtists: string[]
  album: string | undefined
  year: number
  track: number
  trackCount: number
  disc: number
  discCount: number
  genres: string[]
  isCompilation: boolean
  mb: Record<string, string | undefined>
  pictures: { hash: string; mimeType: string; type: number; description: string }[]
}

const MB_FIELDS = [
  'musicBrainzTrackId',
  'musicBrainzReleaseId',
  'musicBrainzReleaseGroupId',
  'musicBrainzArtistId',
  'musicBrainzReleaseArtistId',
  'musicBrainzReleaseCountry',
  'musicBrainzReleaseStatus',
  'musicBrainzReleaseType',
] as const

/** Make sure the format's native tag exists so writes land somewhere players read. */
function ensureNativeTag(file: File, ext: string) {
  const type =
    ext === 'mp3' ? TagTypes.Id3v2 : ['flac', 'ogg', 'oga', 'opus'].includes(ext) ? TagTypes.Xiph : ['m4a', 'mp4', 'aac'].includes(ext) ? TagTypes.Apple : null
  if (type !== null) file.getTag(type, true)
}

/** Write to a temp copy in the same folder, then atomically rename over the original. */
function editAtomically(filePath: string, edit: (file: File) => void) {
  const ext = path.extname(filePath)
  const tmp = path.join(path.dirname(filePath), `.slimtunes-${randomBytes(6).toString('hex')}${ext}`)
  copyFileSync(filePath, tmp)
  try {
    const file = File.createFromPath(tmp)
    try {
      edit(file)
      file.save()
    } finally {
      file.dispose()
    }
    renameSync(tmp, filePath)
  } catch (e) {
    rmSync(tmp, { force: true })
    throw e
  }
}

export function snapshotTags(filePath: string): TagSnapshot {
  const file = File.createFromPath(filePath)
  try {
    const t = file.tag
    const mb: Record<string, string | undefined> = {}
    for (const k of MB_FIELDS) mb[k] = t[k]
    return {
      title: t.title,
      performers: t.performers ?? [],
      albumArtists: t.albumArtists ?? [],
      album: t.album,
      year: t.year,
      track: t.track,
      trackCount: t.trackCount,
      disc: t.disc,
      discCount: t.discCount,
      genres: t.genres ?? [],
      isCompilation: t.isCompilation,
      mb,
      pictures: (t.pictures ?? []).map((p) => {
        const bytes = p.data.toByteArray()
        const hash = createHash('sha1').update(bytes).digest('hex')
        const blob = path.join(BLOB_DIR, hash)
        if (!existsSync(blob)) writeFileSync(blob, bytes)
        return { hash, mimeType: p.mimeType, type: p.type, description: p.description ?? '' }
      }),
    }
  } finally {
    file.dispose()
  }
}

export function writeTags(filePath: string, v: TagValues, art: Buffer | null) {
  editAtomically(filePath, (file) => {
    ensureNativeTag(file, path.extname(filePath).slice(1).toLowerCase())
    const t = file.tag
    t.title = v.title
    t.performers = v.artist ? [v.artist] : []
    if (v.albumArtist !== undefined) t.albumArtists = [v.albumArtist]
    if (v.album !== undefined) t.album = v.album
    if (v.year) t.year = v.year
    if (v.track) t.track = v.track
    if (v.trackCount) t.trackCount = v.trackCount
    if (v.disc) t.disc = v.disc
    if (v.discCount) t.discCount = v.discCount
    if (v.genres?.length) t.genres = v.genres
    if (v.compilation !== undefined) t.isCompilation = v.compilation
    const mb: Record<(typeof MB_FIELDS)[number], string | undefined> = {
      musicBrainzTrackId: v.mbTrackId,
      musicBrainzReleaseId: v.mbReleaseId,
      musicBrainzReleaseGroupId: v.mbReleaseGroupId,
      musicBrainzArtistId: v.mbArtistId,
      musicBrainzReleaseArtistId: v.mbReleaseArtistId,
      musicBrainzReleaseCountry: v.mbReleaseCountry,
      musicBrainzReleaseStatus: v.mbReleaseStatus,
      musicBrainzReleaseType: v.mbReleaseType,
    }
    for (const k of MB_FIELDS) if (mb[k]) t[k] = mb[k]!
    if (art) {
      const pic = Picture.fromData(ByteVector.fromByteArray(art))
      pic.type = PictureType.FrontCover
      t.pictures = [pic]
    }
  })
}

export function restoreTags(filePath: string, s: TagSnapshot) {
  editAtomically(filePath, (file) => {
    const t = file.tag
    t.title = s.title ?? ''
    t.performers = s.performers
    t.albumArtists = s.albumArtists
    t.album = s.album ?? ''
    t.year = s.year
    t.track = s.track
    t.trackCount = s.trackCount
    t.disc = s.disc
    t.discCount = s.discCount
    t.genres = s.genres
    t.isCompilation = s.isCompilation
    for (const k of MB_FIELDS) t[k] = s.mb[k] ?? ''
    t.pictures = s.pictures.map((p) => {
      const pic = Picture.fromFullData(
        ByteVector.fromByteArray(readFileSync(path.join(BLOB_DIR, p.hash))),
        p.type as PictureType,
        p.mimeType,
        p.description,
      )
      return pic
    })
  })
}
