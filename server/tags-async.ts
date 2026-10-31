import { Worker } from 'node:worker_threads'
import type { TagSnapshot, TagValues } from './tagger.ts'

let worker: Worker | null = null
let nextId = 0
const pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>()

function getWorker() {
  if (worker) return worker
  const w = new Worker(new URL('./tag-worker.ts', import.meta.url))
  worker = w
  w.unref()
  w.on('message', (m: { id: number; result?: unknown; error?: string }) => {
    const p = pending.get(m.id)
    pending.delete(m.id)
    if (m.error) p?.reject(new Error(m.error))
    else p?.resolve(m.result)
  })
  const fail = (e: Error) => {
    if (worker !== w) return // already replaced ('exit' follows 'error')
    for (const p of pending.values()) p.reject(e)
    pending.clear()
    worker = null
  }
  w.on('error', fail)
  // A worker that dies without an 'error' (OOM, native crash, process.exit) would otherwise hang apply/undo forever.
  w.on('exit', (code) => fail(new Error(`Tag worker stopped unexpectedly (exit code ${code})`)))
  return w
}

function call<T>(msg: Record<string, unknown>): Promise<T> {
  const id = nextId++
  return new Promise<T>((resolve, reject) => {
    pending.set(id, { resolve: resolve as (v: unknown) => void, reject })
    getWorker().postMessage({ id, ...msg })
  })
}

export const snapshotTags = (path: string) => call<TagSnapshot>({ op: 'snapshot', path })
export const writeTags = (path: string, values: TagValues, art: Buffer | null) => call<void>({ op: 'write', path, values, art })
export const restoreTags = (path: string, snapshot: TagSnapshot) => call<void>({ op: 'restore', path, snapshot })
