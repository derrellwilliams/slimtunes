// Runs tag reads/writes off the main thread. They're synchronous and can take tens of
// seconds per file on slow USB drives; doing them here keeps the API and UI responsive.
import { parentPort } from 'node:worker_threads'
import { restoreTags, snapshotTags, type TagSnapshot, type TagValues, writeTags } from './tagger.ts'

type Msg =
  | { id: number; op: 'snapshot'; path: string }
  | { id: number; op: 'write'; path: string; values: TagValues; art: Uint8Array | null }
  | { id: number; op: 'restore'; path: string; snapshot: TagSnapshot }

parentPort!.on('message', (m: Msg) => {
  try {
    let result: unknown = null
    if (m.op === 'snapshot') result = snapshotTags(m.path)
    else if (m.op === 'write') writeTags(m.path, m.values, m.art ? Buffer.from(m.art) : null)
    else restoreTags(m.path, m.snapshot)
    parentPort!.postMessage({ id: m.id, result })
  } catch (e) {
    parentPort!.postMessage({ id: m.id, error: e instanceof Error ? e.message : String(e) })
  }
})
