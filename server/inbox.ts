import { existsSync } from 'node:fs'
import { type FSWatcher, watch } from 'chokidar'
import { applyPlan } from './applier.ts'
import { config } from './config.ts'
import { listAlbums } from './db.ts'
import { currentJob, runJob } from './events.ts'
import { getGenres } from './musicbrainz.ts'
import { matchAll } from './matcher.ts'
import { buildPlan } from './planner.ts'
import { scanLibrary } from './scanner.ts'

let watcher: FSWatcher | null = null
let timer: NodeJS.Timeout | null = null
const QUIET_MS = 30_000 // wait for downloads to settle

export function restartInbox() {
  void watcher?.close()
  watcher = null
  const { enabled, path } = config.settings.inbox
  if (!enabled || !path || !existsSync(path) || !config.settings.libraryRoot) return
  watcher = watch(path, { ignoreInitial: false, awaitWriteFinish: { stabilityThreshold: 5000 }, ignored: (p) => /(^|[/\\])\./.test(p) })
  watcher.on('all', () => {
    if (timer) clearTimeout(timer)
    timer = setTimeout(() => void processInbox().catch((e) => console.error('[inbox]', e)), QUIET_MS)
  })
}

/** Scan + match the inbox; auto-move confident matches into the library. The rest wait in Review. */
export async function processInbox() {
  const inbox = config.settings.inbox.path
  const root = config.settings.libraryRoot
  if (!inbox || !root) return
  if (currentJob()?.status === 'running') {
    timer = setTimeout(() => void processInbox(), QUIET_MS)
    return
  }
  await runJob('inbox', async (progress) => {
    const rules = config.rules
    await scanLibrary(inbox, progress)
    await matchAll(inbox, rules, progress)
    if (!config.settings.inbox.autoApply) return
    const ready = listAlbums(inbox).filter((a) => a.status === 'matched').map((a) => a.id)
    if (!ready.length) return
    const plan = await buildPlan({
      srcRoot: inbox,
      destRoot: root,
      rules,
      albumIds: ready,
      genres: (r) => getGenres(r.releaseGroupId, r.artistIds[0], rules.genres.max),
    })
    await applyPlan(plan, rules, 'inbox', progress)
  })
}
