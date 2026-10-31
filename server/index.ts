import { timingSafeEqual } from 'node:crypto'
import { existsSync, readdirSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import path from 'node:path'
import { serve } from '@hono/node-server'
import { serveStatic } from '@hono/node-server/serve-static'
import { Hono } from 'hono'
import { streamSSE } from 'hono/streaming'
import type { AlbumDetail, AlbumSummary, PublicState, Release, Rules, ServerEvent } from '../shared/types.ts'
import { hasFpcalc } from './acoustid.ts'
import { applyPlan, listRuns, recoverInterruptedRuns, undoRun } from './applier.ts'
import { config, DEFAULT_RULES, mergeRules, save } from './config.ts'
import { type AlbumRow, albumFiles, db, getAlbum, listAlbums, putAlbum } from './db.ts'
import { bus, currentJob, emit, HttpError, startJob } from './events.ts'
import { processInbox, restartInbox } from './inbox.ts'
import { addCandidate, chooseRelease, fingerprintAlbum, matchAlbum, matchAll, resolveSingles } from './matcher.ts'
import { getEditions, getGenres, parseReleaseId } from './musicbrainz.ts'
import { buildPlan, destFor, type ExecPlan } from './planner.ts'
import { scanLibrary } from './scanner.ts'

const PORT = Number(process.env.PORT ?? 4747)
const DEV = process.env.SLIMTUNES_DEV === '1'
const ALLOWED_HOSTS = new Set([`127.0.0.1:${PORT}`, `localhost:${PORT}`, ...(DEV ? ['127.0.0.1:5173', 'localhost:5173'] : [])])

const app = new Hono()

// --- security: loopback only, same-origin only, token required ---
app.use('/api/*', async (c, next) => {
  const host = c.req.header('host') ?? ''
  if (!ALLOWED_HOSTS.has(host)) return c.text('Forbidden host', 403) // blocks DNS rebinding
  const origin = c.req.header('origin')
  if (origin && !ALLOWED_HOSTS.has(origin.replace(/^https?:\/\//, ''))) return c.text('Forbidden origin', 403) // blocks CSRF
  const given = Buffer.from(c.req.header('x-slimtunes-token') ?? c.req.query('t') ?? '')
  const want = Buffer.from(config.token)
  if (given.length !== want.length || !timingSafeEqual(given, want)) return c.text('Unauthorized', 401)
  await next()
})

app.onError((err, c) => {
  const status = err instanceof HttpError ? err.status : 500
  if (status === 500) console.error(err)
  return c.json({ error: err.message }, status as 400)
})

type Scope = 'library' | 'inbox'
function rootFor(scope: string | undefined): string {
  const s: Scope = scope === 'inbox' ? 'inbox' : 'library'
  const root = s === 'inbox' ? config.settings.inbox.path : config.settings.libraryRoot
  if (!root) throw new HttpError(400, s === 'inbox' ? 'No inbox folder set' : 'Pick a library folder first')
  return root
}

function summary(a: AlbumRow): AlbumSummary {
  const fileCount = (db.prepare('SELECT COUNT(*) AS n FROM tracks WHERE album_id = ?').get(a.id) as { n: number }).n
  return { id: a.id, title: a.title, artist: a.artist, folder: a.folder, fileCount, status: a.status, confidence: a.confidence, chosen: a.chosen, issues: a.issues }
}

async function publicState(): Promise<PublicState> {
  const root = config.settings.libraryRoot
  const albums = root ? listAlbums(root) : []
  const byStatus: PublicState['stats']['byStatus'] = {}
  for (const a of albums) byStatus[a.status] = (byStatus[a.status] ?? 0) + 1
  const tracks = root ? (db.prepare('SELECT COUNT(*) AS n FROM tracks WHERE root = ?').get(root) as { n: number }).n : 0
  return {
    libraryRoot: root,
    hasAcoustidKey: !!config.settings.acoustidKey,
    fpcalc: await hasFpcalc(),
    inbox: config.settings.inbox,
    rules: config.rules,
    stats: { tracks, albums: albums.length, byStatus },
    job: currentJob(),
  }
}

const api = new Hono()

api.get('/state', async (c) => c.json(await publicState()))

api.get('/events', (c) =>
  streamSSE(c, async (stream) => {
    const send = (e: ServerEvent) => void stream.writeSSE({ data: JSON.stringify(e) })
    bus.on('event', send)
    const ping = setInterval(() => void stream.writeSSE({ event: 'ping', data: '' }), 20_000)
    stream.onAbort(() => {
      bus.off('event', send)
      clearInterval(ping)
    })
    send({ type: 'job', job: currentJob() })
    await new Promise(() => {}) // keep open until the client disconnects
  }),
)

// --- folder picker (browsers can't hand us real paths) ---
api.get('/fs', (c) => {
  const p = path.resolve(c.req.query('path') || homedir())
  if (!existsSync(p) || !statSync(p).isDirectory()) throw new HttpError(400, 'Not a folder')
  const dirs = readdirSync(p, { withFileTypes: true })
    .filter((d) => d.isDirectory() && !d.name.startsWith('.'))
    .map((d) => d.name)
    .sort((a, b) => a.localeCompare(b))
  const places: { name: string; path: string; kind: 'home' | 'music' | 'drive' }[] = [{ name: 'Home', path: homedir(), kind: 'home' }]
  const music = path.join(homedir(), 'Music')
  if (existsSync(music)) places.push({ name: 'Music', path: music, kind: 'music' })
  places.push(...listDrives().map((d) => ({ ...d, kind: 'drive' as const })))
  return c.json({ path: p, parent: path.dirname(p) === p ? null : path.dirname(p), dirs, places })
})

/** External, USB and network drives mounted under /Volumes (skips the boot disk alias and system volumes). */
function listDrives(): { name: string; path: string }[] {
  if (!existsSync('/Volumes')) return []
  return readdirSync('/Volumes', { withFileTypes: true })
    .filter((d) => !d.isSymbolicLink() && !d.name.startsWith('.') && !['Recovery', 'Preboot', 'VM', 'Update'].includes(d.name))
    .map((d) => ({ name: d.name, path: path.join('/Volumes', d.name) }))
    .filter((d) => {
      try {
        return statSync(d.path).isDirectory()
      } catch {
        return false
      }
    })
}

api.post('/library', async (c) => {
  const { root } = await c.req.json<{ root: string }>()
  const p = path.resolve(root)
  if (!existsSync(p) || !statSync(p).isDirectory()) throw new HttpError(400, 'Not a folder')
  if (p === '/' || p === homedir()) throw new HttpError(400, 'Pick your music folder, not your whole drive or home folder')
  config.settings.libraryRoot = p
  save()
  restartInbox()
  emit({ type: 'state' })
  return c.json({ ok: true })
})

api.put('/settings', async (c) => {
  const body = await c.req.json<{ acoustidKey?: string; inbox?: Partial<PublicState['inbox']> }>()
  if (body.acoustidKey !== undefined) config.settings.acoustidKey = body.acoustidKey.trim()
  if (body.inbox) {
    const next = { ...config.settings.inbox, ...body.inbox }
    if (next.path) {
      next.path = path.resolve(next.path)
      const root = config.settings.libraryRoot
      if (root && (next.path.startsWith(root + path.sep) || root.startsWith(next.path + path.sep) || root === next.path))
        throw new HttpError(400, 'The inbox must be outside your library folder')
    }
    config.settings.inbox = next
  }
  save()
  restartInbox()
  emit({ type: 'state' })
  return c.json({ ok: true })
})

api.put('/rules', async (c) => {
  config.rules = mergeRules(await c.req.json<Partial<Rules>>())
  save()
  emit({ type: 'state' })
  return c.json(config.rules)
})
api.post('/rules/reset', (c) => {
  config.rules = DEFAULT_RULES
  save()
  emit({ type: 'state' })
  return c.json(config.rules)
})

const EXAMPLE: Release = {
  id: 'example',
  title: 'Random Access Memories',
  artist: 'Daft Punk',
  artistIds: [],
  date: '2023-05-12',
  originalDate: '2013-05-17',
  country: 'XW',
  formats: ['Digital Media', 'Digital Media'],
  trackCount: 3,
  discCount: 2,
  releaseGroupId: null,
  primaryType: 'Album',
  secondaryTypes: [],
  status: 'Official',
  barcode: null,
  disambiguation: '10th anniversary edition',
  label: 'Columbia',
  tracks: [
    { id: '1', recordingId: '', disc: 1, position: 1, title: 'Give Life Back to Music', artist: 'Daft Punk', artistIds: [], length: 274 },
    { id: '2', recordingId: '', disc: 1, position: 8, title: 'Get Lucky', artist: 'Daft Punk feat. Pharrell Williams & Nile Rodgers', artistIds: [], length: 369 },
    { id: '3', recordingId: '', disc: 2, position: 2, title: 'GLBTM (Studio Outtakes)', artist: 'Daft Punk', artistIds: [], length: 300 },
  ],
}

api.post('/rules/preview', async (c) => {
  const rules = mergeRules(await c.req.json<Partial<Rules>>())
  const root = config.settings.libraryRoot
  const out: { from: string; to: string }[] = []
  if (root) {
    for (const a of listAlbums(root)) {
      if (!a.release || !a.alignment || out.length >= 6) continue
      const files = albumFiles(a.id)
      for (const x of a.alignment.slice(0, 2)) {
        const t = a.release.tracks.find((t) => t.id === x.trackId)
        const f = files.find((f) => f.path === x.filePath)
        if (t && f) out.push({ from: f.rel, to: `${destFor(a.release, t, rules)}.${f.format}` })
      }
    }
  }
  if (!out.length) for (const t of EXAMPLE.tracks) out.push({ from: `Downloads/daft punk - ram/${t.position} ${t.title.toLowerCase()}.flac`, to: `${destFor(EXAMPLE, t, rules)}.flac` })
  return c.json(out)
})

// --- scan / match ---
api.post('/scan', (c) => {
  const root = rootFor(c.req.query('scope'))
  startJob('scan', (p) => scanLibrary(root, p))
  return c.json({ started: true })
})

api.post('/match', (c) => {
  const root = rootFor(c.req.query('scope'))
  startJob('match', (p) => matchAll(root, config.rules, p))
  return c.json({ started: true })
})

api.get('/albums', (c) => c.json(listAlbums(rootFor(c.req.query('scope'))).map(summary)))

api.get('/albums/:id', (c) => {
  const a = getAlbum(c.req.param('id'))
  if (!a) throw new HttpError(404, 'Album not found')
  const root = rootFor(c.req.query('scope'))
  const dupes = a.chosen?.releaseGroupId
    ? listAlbums(root)
        .filter((o) => o.id !== a.id && o.chosen?.releaseGroupId === a.chosen!.releaseGroupId)
        .map((o) => {
          const files = albumFiles(o.id)
          return { id: o.id, title: o.title, folder: o.folder, fileCount: files.length, lossless: files.every((f) => f.lossless) }
        })
    : []
  const detail: AlbumDetail = {
    ...summary(a),
    files: albumFiles(a.id),
    candidates: a.candidates,
    release: a.release,
    alignment: a.alignment,
    duplicateOf: dupes,
    duplicateFiles: a.duplicateFiles,
    singles: a.singles,
  }
  return c.json(detail)
})

/** Full release with alignment against this album's files (for comparing candidates in Review). */
api.get('/albums/:id/compare/:releaseId', async (c) => {
  const root = rootFor(c.req.query('scope'))
  return c.json(await addCandidate(root, c.req.param('id'), c.req.param('releaseId'), 'edition', config.rules))
})

api.post('/albums/:id/choose', async (c) => {
  const root = rootFor(c.req.query('scope'))
  const { releaseId } = await c.req.json<{ releaseId: string }>()
  const id = parseReleaseId(releaseId)
  if (!id) throw new HttpError(400, 'That doesn’t look like a MusicBrainz release link')
  await chooseRelease(root, c.req.param('id'), id, config.rules)
  return c.json({ ok: true })
})

api.post('/albums/:id/search', async (c) => {
  const root = rootFor(c.req.query('scope'))
  const q = await c.req.json<{ artist: string; album: string }>()
  await matchAlbum(root, c.req.param('id'), config.rules, { force: true, query: q })
  // A manual search always lands back in Review so the user confirms the pick.
  const a = getAlbum(c.req.param('id'))!
  a.status = a.candidates.length ? 'review' : 'unmatched'
  putAlbum(root, a)
  return c.json({ ok: true })
})

api.post('/albums/:id/fingerprint', (c) => {
  const root = rootFor(c.req.query('scope'))
  if (!config.settings.acoustidKey) throw new HttpError(400, 'Add an AcoustID key in Settings first')
  const id = c.req.param('id')
  startJob('fingerprint', (p) => fingerprintAlbum(root, id, config.rules, p))
  return c.json({ started: true })
})

api.get('/albums/:id/editions', async (c) => {
  const a = getAlbum(c.req.param('id'))
  const rg = a?.chosen?.releaseGroupId ?? a?.candidates[0]?.release.releaseGroupId
  if (!rg) return c.json([])
  return c.json(await getEditions(rg))
})

api.post('/albums/:id/action', async (c) => {
  const root = rootFor(c.req.query('scope'))
  const { action } = await c.req.json<{ action: 'leave' | 'skip' | 'reset' | 'singles' | 'duplicate' | 'accept' }>()
  const a = getAlbum(c.req.param('id'))
  if (!a) throw new HttpError(404, 'Album not found')
  if (action === 'singles') {
    await resolveSingles(root, a.id)
    return c.json({ ok: true })
  }
  if (action === 'accept') {
    if (!a.release) throw new HttpError(400, 'Pick a release first')
    a.status = 'accepted'
    a.issues = a.issues.filter((i) => i.kind !== 'low-confidence' && i.kind !== 'duplicate-album')
  } else if (action === 'reset') {
    a.status = 'pending'
    a.candidates = []
    a.chosen = a.release = a.alignment = null
    a.confidence = null
  } else {
    a.status = action === 'skip' ? 'skipped' : action
  }
  putAlbum(root, a)
  emit({ type: 'album', id: a.id })
  return c.json({ ok: true })
})

/** Mark every review album at or above a confidence as accepted. */
api.post('/albums/accept-all', async (c) => {
  const root = rootFor(c.req.query('scope'))
  const { min } = await c.req.json<{ min: number }>()
  let n = 0
  for (const a of listAlbums(root)) {
    if (a.status === 'review' && a.release && (a.confidence ?? 0) >= min && !a.issues.some((i) => i.kind === 'duplicate-album')) {
      a.status = 'accepted'
      putAlbum(root, a)
      n++
    }
  }
  emit({ type: 'albums' })
  return c.json({ accepted: n })
})

// --- plan / apply / history ---
const plans = new Map<Scope, ExecPlan>()

api.post('/plan', (c) => {
  const scope: Scope = c.req.query('scope') === 'inbox' ? 'inbox' : 'library'
  const srcRoot = rootFor(scope)
  const destRoot = rootFor('library')
  const rules = config.rules
  startJob('plan', async (p) => {
    p(0, 1, 'Working out where everything goes…')
    const plan = await buildPlan({ srcRoot, destRoot, rules, genres: (r) => getGenres(r.releaseGroupId, r.artistIds[0], rules.genres.max) })
    plans.set(scope, plan)
    p(1, 1, 'Ready')
  })
  return c.json({ started: true })
})

api.get('/plan', (c) => {
  const plan = plans.get(c.req.query('scope') === 'inbox' ? 'inbox' : 'library')
  if (!plan) return c.json(null)
  const { tagValues: _t, srcRoot: _s, destRoot, ...pub } = plan
  return c.json({ ...pub, destRoot })
})

api.post('/apply', (c) => {
  const scope: Scope = c.req.query('scope') === 'inbox' ? 'inbox' : 'library'
  const plan = plans.get(scope)
  if (!plan) throw new HttpError(400, 'Build a preview first')
  if (Date.now() - plan.createdAt > 60 * 60 * 1000) throw new HttpError(400, 'Preview is over an hour old — rebuild it')
  plans.delete(scope)
  const rules = config.rules
  startJob('apply', (p) => applyPlan(plan, rules, 'manual', p))
  return c.json({ started: true })
})

api.get('/runs', (c) => c.json(listRuns()))
api.post('/runs/:id/undo', (c) => {
  const id = Number(c.req.param('id'))
  startJob('undo', (p) => undoRun(id, p))
  return c.json({ started: true })
})

api.post('/inbox/process', (c) => {
  void processInbox().catch((e) => console.error('[inbox]', e))
  return c.json({ started: true })
})

app.route('/api', api)

// --- built UI ---
const dist = path.resolve(import.meta.dirname, '../dist')
if (existsSync(dist)) {
  app.use('/*', serveStatic({ root: path.relative(process.cwd(), dist) }))
  app.get('*', serveStatic({ path: path.relative(process.cwd(), path.join(dist, 'index.html')) }))
}

const interrupted = recoverInterruptedRuns()

const openUrl = (url: string) =>
  import('node:child_process').then(({ spawn }) => spawn(process.platform === 'darwin' ? 'open' : 'xdg-open', [url], { stdio: 'ignore', detached: true }).unref())

const server = serve({ fetch: app.fetch, port: PORT, hostname: '127.0.0.1' }, () => {
  const uiPort = DEV ? 5173 : PORT
  const url = `http://127.0.0.1:${uiPort}/?t=${config.token}`
  console.log(`\n  SlimTunes is running → ${url}\n`)
  if (process.env.SLIMTUNES_OPEN === '1') void openUrl(url)
  restartInbox()
  // After a crash mid-apply, files moved but the database didn't catch up — rescan so the UI matches the disk.
  const root = config.settings.libraryRoot
  if (interrupted && root && existsSync(root)) startJob('scan', (p) => scanLibrary(root, p))
})

// Already running (e.g. as a background service)? Just open it instead of failing.
server.on('error', (err: NodeJS.ErrnoException) => {
  if (err.code !== 'EADDRINUSE') throw err
  const url = `http://127.0.0.1:${PORT}/?t=${config.token}`
  console.log(`\n  SlimTunes is already running → ${url}\n`)
  if (process.env.SLIMTUNES_OPEN === '1') void openUrl(url).then(() => process.exit(0))
  else process.exit(0)
})
