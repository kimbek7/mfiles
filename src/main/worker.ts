import { stat } from 'node:fs/promises'
import path from 'node:path'
import { parentPort, workerData } from 'node:worker_threads'
import { enrichEntries } from '../core/classifier'
import { findDuplicates } from '../core/duplicates'
import { executePlan, undoSession } from '../core/executor'
import { listSessions, pendingUndo, readJournal } from '../core/journal'
import { buildPlan } from '../core/planner'
import { isCloudPath } from '../core/safety'
import { emptyStats, scan } from '../core/scanner'
import { TreeIndex } from '../core/tree'
import { CATEGORIES } from '../core/types'
import type { Category, DuplicateGroup, FileEntry, Move, Plan, ScanStats } from '../core/types'
import { PARTICLE_STRIDE } from '../shared/api'
import { AppError } from '../shared/i18n'
import type {
  DuplicatesPage,
  FlowEvent,
  PlanFilesPage,
  PlanRequest,
  PlanView,
  ScanPhase,
  TileView,
  WorkerApi,
  WorkerEvent,
  WorkerRequest,
} from '../shared/api'

const port = parentPort
if (!port) throw new Error('This module runs only as a worker')

const { journalDir } = workerData as { journalDir: string }
const EMIT_INTERVAL_MS = 100
const MAX_PARTICLES_PER_BATCH = 400
const SIMULATION_MS = 8000

const categoryIndex = new Map<Category, number>(CATEGORIES.map((c, i) => [c, i]))

let root = ''
let entries: FileEntry[] = []
let stats: ScanStats = emptyStats()
let tree: TreeIndex | null = null
let duplicates: DuplicateGroup[] = []
let controller = new AbortController()
let lastPlan: Plan | null = null
let busy = false
let mismatched = 0

function emit(message: WorkerEvent): void {
  port?.postMessage(message)
}

function duplicateTotals(): { duplicateGroups: number; duplicateBytes: number } {
  return {
    duplicateGroups: duplicates.length,
    duplicateBytes: duplicates.reduce((sum, g) => sum + g.size * (g.paths.length - 1), 0),
  }
}

function emitScan(phase: ScanPhase, done: number, total: number): void {
  emit({
    event: 'scan',
    payload: {
      phase,
      stats: { ...stats },
      done,
      total,
      tiles: tree?.tiles() ?? [],
      mismatched,
      cloud: isCloudPath(root),
      ...duplicateTotals(),
    },
  })
}

function throttled<A extends unknown[]>(fn: (...args: A) => void): (...args: A) => void {
  let last = 0
  return (...args) => {
    const now = Date.now()
    if (now - last >= EMIT_INTERVAL_MS) {
      last = now
      fn(...args)
    }
  }
}

async function withLock<T>(fn: () => Promise<T>): Promise<T> {
  if (busy) throw new AppError('busy')
  busy = true
  controller = new AbortController()
  try {
    return await fn()
  } finally {
    busy = false
  }
}

class FlowBatcher {
  private pending: Move[] = []
  private last = 0
  done = 0
  failed = 0
  bytes = 0

  constructor(
    private readonly mode: FlowEvent['mode'],
    private readonly total: number,
  ) {}

  add(move: Move, ok: boolean): void {
    this.done++
    if (ok) {
      this.bytes += move.size
      this.pending.push(move)
    } else {
      this.failed++
    }
    if (Date.now() - this.last >= EMIT_INTERVAL_MS) this.flush(false)
  }

  flush(finished: boolean): void {
    this.last = Date.now()
    const particles: number[] = []
    const groupSize = Math.max(1, Math.ceil(this.pending.length / MAX_PARTICLES_PER_BATCH))
    for (let i = 0; i < this.pending.length; i += groupSize) {
      const group = this.pending.slice(i, i + groupSize)
      const head = group[0]
      particles.push(
        head.bucket,
        head.origin,
        categoryIndex.get(head.category) as number,
        head.size,
        group.reduce((sum, m) => sum + m.size, 0),
      )
    }
    this.pending = []
    if (particles.length % PARTICLE_STRIDE !== 0) throw new Error('Malformed particle batch')
    emit({
      event: 'flow',
      payload: {
        mode: this.mode,
        done: this.done,
        total: this.total,
        failed: this.failed,
        bytes: this.bytes,
        particles,
        finished,
      },
    })
  }
}

function requirePlan(planId: string): Plan {
  if (!lastPlan || lastPlan.id !== planId) throw new AppError('planStale')
  return lastPlan
}

function view(plan: Plan): PlanView {
  const { moves, ...rest } = plan
  return { ...rest, moveCount: moves.length, duplicateCount: moves.filter((m) => m.duplicate).length }
}

const api: WorkerApi = {
  scan: (requestedRoot) =>
    withLock(async () => {
      root = path.resolve(requestedRoot)
      const rootStat = await stat(root).catch(() => null)
      if (!rootStat?.isDirectory()) throw new AppError('folderMissing', root)

      const { signal } = controller
      entries = []
      duplicates = []
      lastPlan = null
      mismatched = 0
      stats = emptyStats()
      tree = new TreeIndex(root)
      const emitWalk = throttled(() => emitScan('walk', stats.files, 0))
      for await (const batch of scan(root, stats, { signal })) {
        for (const entry of batch) {
          entries.push(entry)
          tree.add(entry)
        }
        emitWalk()
      }

      const local = entries.filter((e) => !isCloudPath(e.path))
      const emitEnrich = throttled((done: number) => emitScan('enrich', done, local.length))
      await enrichEntries(local, { signal, onProgress: emitEnrich })
      mismatched = entries.filter((e) => e.extMismatch).length

      if (!signal.aborted) {
        tree = new TreeIndex(root)
        for (const entry of entries) tree.add(entry)
      }

      const emitHash = throttled((done: number, total: number) => emitScan('duplicates', done, total))
      if (!signal.aborted) {
        duplicates = await findDuplicates(entries, {
          signal,
          skipContent: (e) => isCloudPath(e.path),
          onProgress: emitHash,
        })
      }
      emitScan(signal.aborted ? 'cancelled' : 'done', entries.length, entries.length)
    }),

  cancel: async () => controller.abort(),

  tiles: async (focus) => {
    if (!tree) throw new AppError('noScan')
    const target = focus ?? root
    const view: TileView = { focus: target, parent: tree.parentOf(target), tiles: tree.tiles(target) }
    return view
  },

  plan: async (request: PlanRequest) => {
    lastPlan = buildPlan(entries, duplicates, { root, ...request })
    return view(lastPlan)
  },

  planFiles: async (planId, group, offset, limit) => {
    const moves = requirePlan(planId).moves.filter((m) => group === null || m.group === group)
    const page: PlanFilesPage = {
      total: moves.length,
      items: moves.slice(offset, offset + limit).map((m) => ({
        from: m.from,
        to: m.to,
        size: m.size,
        category: m.category,
        duplicate: m.duplicate,
      })),
    }
    return page
  },

  duplicates: async (offset, limit) => {
    const page: DuplicatesPage = { total: duplicates.length, groups: duplicates.slice(offset, offset + limit) }
    return page
  },

  setKeeper: async (hash, keeper) => {
    const group = duplicates.find((g) => g.hash === hash)
    if (!group?.paths.includes(keeper)) throw new AppError('unknownDuplicate')
    group.keeper = keeper
  },

  execute: (planId) =>
    withLock(async () => {
      const plan = requirePlan(planId)
      const batcher = new FlowBatcher('real', plan.moves.length)
      const result = await executePlan(plan, {
        journalDir,
        signal: controller.signal,
        onProgress: (move, outcome) => batcher.add(move, outcome.ok),
      })
      batcher.flush(true)
      lastPlan = null
      return result
    }),

  simulate: (planId) =>
    withLock(async () => {
      const { moves } = requirePlan(planId)
      const { signal } = controller
      const batcher = new FlowBatcher('simulated', moves.length)
      const steps = Math.max(1, Math.round(SIMULATION_MS / EMIT_INTERVAL_MS))
      const chunk = Math.max(1, Math.ceil(moves.length / steps))
      for (let i = 0; i < moves.length && !signal.aborted; i += chunk) {
        for (const move of moves.slice(i, i + chunk)) batcher.add(move, true)
        batcher.flush(false)
        await new Promise((resolve) => setTimeout(resolve, EMIT_INTERVAL_MS))
      }
      batcher.flush(true)
    }),

  undo: (sessionId) =>
    withLock(async () => {
      const total = pendingUndo(await readJournal(journalDir, sessionId)).length
      let done = 0
      const emitUndo = throttled(() => emit({ event: 'undo', payload: { done, total } }))
      const result = await undoSession(sessionId, {
        journalDir,
        signal: controller.signal,
        onProgress: () => {
          done++
          emitUndo()
        },
      })
      emit({ event: 'undo', payload: { done, total } })
      return result
    }),

  sessions: () => listSessions(journalDir),
}

port.on('message', (request: WorkerRequest) => {
  const method = api[request.method] as (...args: unknown[]) => Promise<unknown>
  method(...request.args).then(
    (result) => port.postMessage({ id: request.id, result }),
    (err: Error) => port.postMessage({ id: request.id, error: err.message }),
  )
})
