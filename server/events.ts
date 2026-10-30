import { EventEmitter } from 'node:events'
import type { Job, JobKind, ServerEvent } from '../shared/types.ts'

export const bus = new EventEmitter()
bus.setMaxListeners(50)

export function emit(e: ServerEvent) {
  bus.emit('event', e)
}

let current: Job | null = null
let lastEmit = 0

export function currentJob() {
  return current
}

/** Run one job at a time; progress is broadcast over SSE (throttled). */
export async function runJob<T>(kind: JobKind, fn: (progress: (done: number, total: number, message?: string) => void) => Promise<T>) {
  if (current?.status === 'running') throw new HttpError(409, `Busy: ${current.kind} is still running`)
  current = { kind, status: 'running', done: 0, total: 0, message: '' }
  emit({ type: 'job', job: current })
  const progress = (done: number, total: number, message = '') => {
    current = { kind, status: 'running', done, total, message }
    const now = Date.now()
    if (now - lastEmit > 150 || done === total) {
      lastEmit = now
      emit({ type: 'job', job: current })
    }
  }
  try {
    const out = await fn(progress)
    current = { ...current, status: 'done', message: current.message }
    emit({ type: 'job', job: current })
    return out
  } catch (err) {
    current = { ...current, status: 'error', message: err instanceof Error ? err.message : String(err) }
    emit({ type: 'job', job: current })
    console.error(err)
    throw err
  }
}

/** Fire-and-forget wrapper: the HTTP request returns immediately, the UI follows along via SSE. */
export function startJob(kind: JobKind, fn: Parameters<typeof runJob>[1]) {
  if (current?.status === 'running') throw new HttpError(409, `Busy: ${current.kind} is still running`)
  runJob(kind, fn).catch(() => {})
}

export class HttpError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}
