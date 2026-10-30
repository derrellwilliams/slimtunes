import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import type { Alignment, AlbumStatus, Candidate, Issue, Release, ReleaseSummary, TrackFile } from '../shared/types.ts'
import { DATA_DIR } from './config.ts'

export const db = new DatabaseSync(process.env.SLIMTUNES_DB ?? path.join(DATA_DIR, 'library.db'))

db.exec(`
  PRAGMA busy_timeout = 5000;
  PRAGMA journal_mode = WAL;
  PRAGMA synchronous = NORMAL;

  CREATE TABLE IF NOT EXISTS tracks (
    path TEXT PRIMARY KEY,
    root TEXT NOT NULL,
    mtime REAL NOT NULL,
    size INTEGER NOT NULL,
    data TEXT NOT NULL,          -- TrackFile JSON
    album_id TEXT
  );
  CREATE INDEX IF NOT EXISTS tracks_root ON tracks(root);
  CREATE INDEX IF NOT EXISTS tracks_album ON tracks(album_id);

  CREATE TABLE IF NOT EXISTS albums (
    id TEXT PRIMARY KEY,
    root TEXT NOT NULL,
    data TEXT NOT NULL           -- AlbumRow JSON
  );
  CREATE INDEX IF NOT EXISTS albums_root ON albums(root);

  CREATE TABLE IF NOT EXISTS mb_cache (
    url TEXT PRIMARY KEY,
    body TEXT NOT NULL,
    fetched_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS runs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    created_at INTEGER NOT NULL,
    root TEXT NOT NULL,
    status TEXT NOT NULL,
    albums INTEGER NOT NULL,
    source TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS journal (
    run_id INTEGER NOT NULL,
    seq INTEGER NOT NULL,
    op TEXT NOT NULL,            -- move | tags | create | rmdir | mkdir
    a TEXT,                      -- from / path
    b TEXT,                      -- to / snapshot JSON
    PRIMARY KEY (run_id, seq)
  );
`)

/** Persisted album state. Files live in `tracks` (joined on album_id). */
export interface AlbumRow {
  id: string
  title: string
  artist: string
  folder: string
  status: AlbumStatus
  confidence: number | null
  candidates: Candidate[]
  chosen: ReleaseSummary | null
  release: Release | null
  alignment: Alignment[] | null
  issues: Issue[]
  duplicateFiles: string[] // lower-quality copies of tracks that also exist in this album
  singles: Record<string, SingleMatch> // filePath -> recording, for status 'singles'
}

export interface SingleMatch {
  recordingId: string
  title: string
  artist: string
  artistId: string | null
  year: string | null
}

export function getAlbum(id: string): AlbumRow | null {
  const row = db.prepare('SELECT data FROM albums WHERE id = ?').get(id) as { data: string } | undefined
  return row ? (JSON.parse(row.data) as AlbumRow) : null
}

export function putAlbum(root: string, album: AlbumRow) {
  db.prepare('INSERT INTO albums (id, root, data) VALUES (?, ?, ?) ON CONFLICT(id) DO UPDATE SET data = excluded.data, root = excluded.root').run(
    album.id,
    root,
    JSON.stringify(album),
  )
}

export function listAlbums(root: string): AlbumRow[] {
  return (db.prepare('SELECT data FROM albums WHERE root = ?').all(root) as { data: string }[]).map((r) => JSON.parse(r.data))
}

export function albumFiles(id: string): TrackFile[] {
  return (db.prepare('SELECT data FROM tracks WHERE album_id = ? ORDER BY path').all(id) as { data: string }[]).map((r) =>
    JSON.parse(r.data),
  )
}

export function tx<T>(fn: () => T): T {
  db.exec('BEGIN')
  try {
    const out = fn()
    db.exec('COMMIT')
    return out
  } catch (e) {
    db.exec('ROLLBACK')
    throw e
  }
}
