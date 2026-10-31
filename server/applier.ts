import { copyFileSync, existsSync, mkdirSync, readdirSync, renameSync, rmdirSync, rmSync, statSync, unlinkSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import type { Rules, Run } from '../shared/types.ts'
import { type AlbumRow, db, getAlbum, putAlbum, tx } from './db.ts'
import { emit } from './events.ts'
import { getCover } from './coverart.ts'
import { isJunk } from './cleanup.ts'
import type { ExecPlan } from './planner.ts'
import { assertInside, isInside } from './safepath.ts'
import { readTrack, regroup } from './scanner.ts'
import type { TagSnapshot } from './tagger.ts'
import { restoreTags, snapshotTags, writeTags } from './tags-async.ts'


class Journal {
  private seq = 0
  private stmt = db.prepare('INSERT INTO journal (run_id, seq, op, a, b) VALUES (?, ?, ?, ?, ?)')
  readonly runId: number
  constructor(runId: number) {
    this.runId = runId
  }
  log(op: string, a: string, b: string | null = null) {
    this.stmt.run(this.runId, this.seq++, op, a, b)
  }
}

function moveFile(from: string, to: string) {
  const caseOnly = from.toLowerCase() === to.toLowerCase()
  if (!caseOnly && existsSync(to)) throw new Error(`Destination already exists: ${to}`)
  try {
    renameSync(from, to)
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== 'EXDEV') throw e
    // Different volume: copy, verify, then remove the original.
    copyFileSync(from, to)
    if (statSync(from).size !== statSync(to).size) {
      rmSync(to, { force: true })
      throw new Error(`Copy verification failed for ${from}`)
    }
    unlinkSync(from)
  }
}

function ensureDir(dir: string, root: string, j: Journal) {
  if (existsSync(dir)) return
  ensureDir(path.dirname(dir), root, j)
  assertInside(root, dir)
  mkdirSync(dir)
  j.log('mkdir', dir)
}

/** Remove `dir` and its parents (up to `stopAt`) while they contain nothing but OS junk. */
function pruneEmpty(dir: string, stopAt: string, j: Journal) {
  for (let d = dir; isInside(stopAt, d) && path.resolve(d) !== path.resolve(stopAt); d = path.dirname(d)) {
    let entries: string[]
    try {
      entries = readdirSync(d)
    } catch {
      return
    }
    if (entries.some((e) => !isJunk(e))) return
    for (const e of entries) rmSync(path.join(d, e), { force: true })
    rmdirSync(d)
    j.log('rmdir', d)
  }
}

export async function applyPlan(plan: ExecPlan, rules: Rules, source: Run['source'], progress: (d: number, t: number, m?: string) => void) {
  const { srcRoot, destRoot } = plan
  const runId = Number(
    db.prepare('INSERT INTO runs (created_at, root, status, albums, source) VALUES (?, ?, ?, ?, ?)').run(Date.now(), destRoot, 'applying', plan.albums.length, source)
      .lastInsertRowid,
  )
  const j = new Journal(runId)
  const albumIds = [...new Set(plan.albums.map((a) => a.albumId))]

  // Snapshot album rows first so undo can restore decisions exactly.
  for (const id of albumIds) {
    const row = getAlbum(id)
    const files = (db.prepare('SELECT path FROM tracks WHERE album_id = ?').all(id) as { path: string }[]).map((r) => r.path)
    if (row) j.log('album', id, JSON.stringify({ row, files, root: srcRoot }))
  }

  const covers = new Map<string, Buffer | null>()
  const coverFor = async (albumId: string) => {
    if (!covers.has(albumId)) {
      const a = getAlbum(albumId)
      covers.set(albumId, a?.release ? await getCover(a.release.id, a.release.releaseGroupId, rules.art.size).catch(() => null) : null)
    }
    return covers.get(albumId)!
  }

  const moved = new Map<string, string>() // from -> to
  let done = 0
  try {
    for (const op of plan.ops) {
      progress(done++, plan.ops.length, op.kind === 'move' ? path.basename(op.to) : op.kind)
      if (op.kind === 'tags') {
        assertInside(srcRoot, op.path)
        const values = plan.tagValues[op.path]
        if (!values) continue
        const snap = await snapshotTags(op.path)
        j.log('tags', op.path, JSON.stringify(snap))
        await writeTags(op.path, values, rules.art.embed ? await coverFor(op.albumId) : null)
      } else if (op.kind === 'move') {
        assertInside(srcRoot, op.from)
        assertInside(destRoot, op.to)
        ensureDir(path.dirname(op.to), destRoot, j)
        moveFile(op.from, op.to)
        j.log('move', op.from, op.to)
        moved.set(op.from, op.to)
      } else if (op.kind === 'art') {
        if (!op.to || existsSync(op.to)) continue
        assertInside(destRoot, op.to)
        const img = await coverFor(op.albumId)
        if (!img) continue
        ensureDir(path.dirname(op.to), destRoot, j)
        writeFileSync(op.to, img)
        j.log('create', op.to)
      } else if (op.kind === 'rmdir') {
        pruneEmpty(op.path, isInside(srcRoot, op.path) ? srcRoot : destRoot, j)
      }
    }
    await syncDb(plan, albumIds, moved)
    db.prepare('UPDATE runs SET status = ? WHERE id = ?').run('applied', runId)
  } catch (e) {
    await syncDb(plan, albumIds, moved)
    db.prepare('UPDATE runs SET status = ? WHERE id = ?').run('failed', runId)
    throw e
  } finally {
    emit({ type: 'albums' })
  }
  progress(plan.ops.length, plan.ops.length, 'Done')
  return runId
}

/** Point track rows at their new paths and mark albums applied. */
async function syncDb(plan: ExecPlan, albumIds: string[], moved: Map<string, string>) {
  const update = db.prepare('UPDATE tracks SET path = ?, root = ?, mtime = ?, size = ?, data = ? WHERE path = ?')
  const touched = new Set([...Object.keys(plan.tagValues), ...moved.keys()])
  const pending: { from: string; to: string }[] = []
  for (const from of touched) pending.push({ from, to: moved.get(from) ?? from })
  // Re-read outside the transaction (async), then write in one go.
  const rows = await Promise.all(
    pending.map(async ({ from, to }) => {
      if (!existsSync(to)) return null
      const st = statSync(to)
      return { from, to, st, t: await readTrack(plan.destRoot, to, st.size) }
    }),
  )
  tx(() => {
      for (const r of rows) if (r) update.run(r.to, plan.destRoot, r.st.mtimeMs, r.st.size, JSON.stringify(r.t), r.from)
      for (const id of albumIds) {
        const a = getAlbum(id)
        if (!a) continue
        const pa = plan.albums.find((p) => p.albumId === id)
        const next: AlbumRow = {
          ...a,
          status: a.status === 'duplicate' ? 'duplicate' : 'applied',
          folder: pa?.destFolder ?? a.folder,
          alignment: a.alignment?.map((x) => ({ ...x, filePath: moved.get(x.filePath) ?? x.filePath })) ?? null,
          duplicateFiles: a.duplicateFiles.map((p) => moved.get(p) ?? p),
          singles: Object.fromEntries(Object.entries(a.singles).map(([p, s]) => [moved.get(p) ?? p, s])),
        }
      putAlbum(plan.destRoot, next)
    }
  })
}

/** Runs left mid-way by a crash or restart can't still be running — mark them so they can be undone. */
export function recoverInterruptedRuns() {
  const n = db.prepare("UPDATE runs SET status = 'failed' WHERE status IN ('applying', 'undoing')").run().changes
  if (n) console.log(`  Marked ${n} interrupted run(s) as stopped. Rescan the library to refresh it.`)
}

export function listRuns(): Run[] {
  return (
    db
      .prepare(
        `SELECT r.id, r.created_at AS createdAt, r.root, r.status, r.albums, r.source,
          (SELECT COUNT(*) FROM journal j WHERE j.run_id = r.id AND j.op IN ('move','tags','create')) AS ops
         FROM runs r ORDER BY r.id DESC LIMIT 100`,
      )
      .all() as unknown as Run[]
  )
}

export async function undoRun(runId: number, progress: (d: number, t: number, m?: string) => void) {
  const run = db.prepare('SELECT * FROM runs WHERE id = ?').get(runId) as { status: string; root: string } | undefined
  if (!run) throw new Error('Run not found')
  if (run.status === 'undone') throw new Error('Already undone')
  const later = db.prepare("SELECT COUNT(*) AS n FROM runs WHERE id > ? AND status IN ('applied','failed')").get(runId) as { n: number }
  if (later.n) throw new Error('Undo newer runs first — they may have moved the same files.')
  db.prepare('UPDATE runs SET status = ? WHERE id = ?').run('undoing', runId)

  const entries = db.prepare('SELECT op, a, b FROM journal WHERE run_id = ? ORDER BY seq DESC').all(runId) as { op: string; a: string; b: string | null }[]
  const missing: string[] = []
  const restoredPaths = new Map<string, string>() // current -> original
  for (const [i, e] of entries.entries()) {
    progress(i, entries.length, e.op)
    try {
      if (e.op === 'move') {
        if (!existsSync(e.b!)) {
          missing.push(e.b!)
          continue
        }
        mkdirSync(path.dirname(e.a), { recursive: true })
        moveFile(e.b!, e.a)
        restoredPaths.set(e.b!, e.a)
      } else if (e.op === 'tags') {
        if (existsSync(e.a)) await restoreTags(e.a, JSON.parse(e.b!) as TagSnapshot)
      } else if (e.op === 'create') {
        rmSync(e.a, { force: true })
      } else if (e.op === 'mkdir') {
        try {
          for (const f of readdirSync(e.a)) if (isJunk(f)) rmSync(path.join(e.a, f))
          rmdirSync(e.a)
        } catch {
          /* not empty — the user put something there */
        }
      } else if (e.op === 'rmdir') {
        mkdirSync(e.a, { recursive: true })
      }
    } catch (err) {
      missing.push(`${e.a}: ${err instanceof Error ? err.message : err}`)
    }
  }

  // Restore album rows and track rows.
  const albums = entries.filter((e) => e.op === 'album').map((e) => JSON.parse(e.b!) as { row: AlbumRow; files: string[]; root: string })
  const rows = await Promise.all(
    albums.flatMap((a) =>
      a.files.map(async (p) => {
        if (!existsSync(p)) return null
        const st = statSync(p)
        return { p, st, root: a.root, albumId: a.row.id, t: await readTrack(a.root, p, st.size) }
      }),
    ),
  )
  tx(() => {
    const del = db.prepare('DELETE FROM tracks WHERE path = ?')
    for (const cur of restoredPaths.keys()) del.run(cur)
    const ins = db.prepare(
      'INSERT INTO tracks (path, root, mtime, size, data, album_id) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(path) DO UPDATE SET root=excluded.root, mtime=excluded.mtime, size=excluded.size, data=excluded.data, album_id=excluded.album_id',
    )
    for (const r of rows) if (r) ins.run(r.p, r.root, r.st.mtimeMs, r.st.size, JSON.stringify(r.t), r.albumId)
    for (const a of albums) putAlbum(a.root, a.row)
    db.prepare('UPDATE runs SET status = ? WHERE id = ?').run('undone', runId)
  })
  // Drop album rows that only existed for the organized copies (e.g. created by a rescan after apply).
  for (const root of new Set([run.root, ...albums.map((a) => a.root)])) regroup(root)
  emit({ type: 'albums' })
  return { missing }
}
