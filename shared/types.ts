// Types shared by the server (server/*) and the UI (src/*).

export type AlbumStatus =
  | 'pending' // scanned, not matched yet
  | 'matched' // auto-accepted (confidence >= threshold)
  | 'review' // needs a decision
  | 'unmatched' // no usable candidates
  | 'accepted' // user picked a release
  | 'singles' // treat each file as a standalone recording
  | 'leave' // keep files exactly where they are
  | 'skipped' // ignore for this run, ask again later
  | 'duplicate' // move the whole album to _duplicates
  | 'applied' // organized in a previous run

export type IssueKind =
  | 'partial' // fewer files than tracks on the release
  | 'extra' // files that don't map to any track
  | 'duration' // matched tracks with large duration drift
  | 'low-confidence'
  | 'no-candidates'
  | 'duplicate-album' // another album in the library maps to the same release group
  | 'duplicate-files' // two files map to the same track
  | 'untagged'
  | 'single-file' // whole album in one file + .cue

export interface Issue {
  kind: IssueKind
  message: string
}

export interface TrackFile {
  path: string
  rel: string // path relative to the library root
  format: string // file extension, lowercase without dot
  lossless: boolean
  bitrate: number | null
  duration: number | null // seconds
  size: number
  tags: {
    title?: string
    artist?: string
    albumartist?: string
    album?: string
    track?: number
    disc?: number
    year?: number
    mbReleaseId?: string
    mbRecordingId?: string
  }
}

export interface ReleaseTrack {
  id: string // MusicBrainz track id
  recordingId: string
  disc: number
  position: number
  title: string
  artist: string
  artistIds: string[]
  length: number | null // seconds
}

export interface ReleaseSummary {
  id: string
  title: string
  artist: string
  artistIds: string[]
  date: string | null
  originalDate: string | null
  country: string | null
  formats: string[]
  trackCount: number
  discCount: number
  releaseGroupId: string | null
  primaryType: string | null
  secondaryTypes: string[]
  status: string | null
  barcode: string | null
  disambiguation: string | null
  label: string | null
}

export interface Release extends ReleaseSummary {
  tracks: ReleaseTrack[]
}

export interface Alignment {
  filePath: string
  trackId: string | null
  titleScore: number
  durationDiff: number | null
}

export interface Candidate {
  release: ReleaseSummary
  confidence: number // 0..1
  alignment: Alignment[] | null // filled for candidates that were fully fetched
  source: 'tags' | 'search' | 'fingerprint' | 'manual' | 'edition'
}

export interface AlbumSummary {
  id: string
  title: string // best guess from tags or folder
  artist: string
  folder: string // relative source folder
  fileCount: number
  status: AlbumStatus
  confidence: number | null
  chosen: ReleaseSummary | null
  issues: Issue[]
}

export interface AlbumDetail extends AlbumSummary {
  files: TrackFile[]
  candidates: Candidate[]
  release: Release | null // full release for `chosen`
  alignment: Alignment[] | null
  duplicateOf: { id: string; title: string; folder: string; fileCount: number; lossless: boolean }[]
  duplicateFiles: string[]
  singles: Record<string, { recordingId: string; title: string; artist: string }>
}

export interface Rules {
  folderTemplate: string
  fileTemplate: string
  compilationFolderTemplate: string
  compilationFileTemplate: string
  singlesTemplate: string
  multiDisc: 'subfolder' | 'prefix'
  featuredArtists: 'title' | 'artist'
  release: {
    preferOriginalYear: boolean
    country: string // ISO code or '' for any
    format: 'any' | 'digital' | 'cd' | 'vinyl'
  }
  art: {
    embed: boolean
    saveFile: boolean
    fileName: string
    size: '500' | '1200' | 'original'
  }
  leftovers: 'move-with-album' | 'leftovers-folder' | 'leave'
  removeEmptyFolders: boolean
  duplicates: 'move-to-duplicates' | 'leave'
  genres: { enabled: boolean; max: number }
  autoAcceptThreshold: number
}

export interface Settings {
  libraryRoot: string | null
  acoustidKey: string // never sent back to the UI, only `hasAcoustidKey`
  inbox: { enabled: boolean; path: string; autoApply: boolean }
}

export interface PublicState {
  libraryRoot: string | null
  hasAcoustidKey: boolean
  fpcalc: boolean
  inbox: Settings['inbox']
  rules: Rules
  stats: { tracks: number; albums: number; byStatus: Partial<Record<AlbumStatus, number>> }
  job: Job | null
}

export type JobKind = 'scan' | 'match' | 'plan' | 'apply' | 'undo' | 'fingerprint' | 'inbox'

export interface Job {
  kind: JobKind
  status: 'running' | 'done' | 'error'
  done: number
  total: number
  message: string
}

export type PlanOp =
  | { kind: 'move'; from: string; to: string; albumId: string }
  | { kind: 'tags'; path: string; albumId: string; changes: Record<string, [string, string]> }
  | { kind: 'art'; to: string; albumId: string; releaseId: string }
  | { kind: 'rmdir'; path: string }

export interface PlanAlbum {
  albumId: string
  title: string
  artist: string
  releaseId: string | null
  destFolder: string
  moves: { from: string; to: string }[]
  tagChanges: number
  leftovers: { from: string; to: string }[]
  duplicates: { from: string; to: string }[]
}

export interface Plan {
  createdAt: number
  albums: PlanAlbum[]
  ops: PlanOp[]
  counts: { moves: number; tagWrites: number; art: number; rmdirs: number; duplicates: number; leftovers: number }
}

export interface Run {
  id: number
  createdAt: number
  root: string
  status: 'applying' | 'applied' | 'failed' | 'undone' | 'undoing'
  albums: number
  ops: number
  source: 'manual' | 'inbox'
}

export type ServerEvent =
  | { type: 'job'; job: Job | null }
  | { type: 'albums' } // album list changed
  | { type: 'album'; id: string }
  | { type: 'state' }
