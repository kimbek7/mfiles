import { mkdir, open, readdir, readFile } from 'node:fs/promises'
import type { FileHandle } from 'node:fs/promises'
import path from 'node:path'
import type { EntryKind, SessionStatus, SessionSummary } from './types'
import { errorCode } from './util'

export interface IntentRecord {
  t: 'intent'
  i: number
  from: string
  to: string
  kind: EntryKind
  size: number
  mtimeMs: number
  dirs: string[]
}

export type JournalRecord =
  | { t: 'begin'; id: string; root: string; targetRoot: string; at: number }
  | IntentRecord
  | { t: 'done'; i: number }
  | { t: 'skip'; i: number }
  | { t: 'verified'; i: number }
  | { t: 'manifest'; path: string }
  | { t: 'end'; status: 'completed' | 'cancelled' }
  | { t: 'undo-begin' }
  | { t: 'undo-done'; i: number }
  | { t: 'undo-lost'; i: number }
  | { t: 'undo-verified'; i: number }
  | { t: 'undo-end' }

export interface JournalState {
  id: string
  root: string
  targetRoot: string
  startedAt: number
  intents: IntentRecord[]
  skipped: Set<number>
  verified: Set<number>
  undone: Set<number>
  undoVerified: Set<number>
  endStatus: 'completed' | 'cancelled' | null
  undoStarted: boolean
  manifest: string | null
}

const SESSION_ID = /^[A-Za-z0-9_-]+$/

export function sessionPath(dir: string, id: string): string {
  if (!SESSION_ID.test(id)) throw new Error(`Nieprawidłowy identyfikator sesji: ${id}`)
  return path.join(dir, `${id}.jsonl`)
}

export class Journal {
  private constructor(private readonly handle: FileHandle) {}

  static async open(dir: string, id: string): Promise<Journal> {
    await mkdir(dir, { recursive: true })
    return new Journal(await open(sessionPath(dir, id), 'a'))
  }

  /** `durable` forces a flush to disk. A `done` record may be lost: the state still follows from which files exist. */
  async write(record: JournalRecord, durable = false): Promise<void> {
    await this.handle.appendFile(`${JSON.stringify(record)}\n`)
    if (durable) await this.handle.sync()
  }

  async close(): Promise<void> {
    await this.handle.close()
  }
}

/** A truncated last line is a trace of a crash, not a journal error. */
export async function readJournal(dir: string, id: string): Promise<JournalState> {
  const lines = (await readFile(sessionPath(dir, id), 'utf8')).split('\n')
  const state: JournalState = {
    id,
    root: '',
    targetRoot: '',
    startedAt: 0,
    intents: [],
    skipped: new Set(),
    verified: new Set(),
    undone: new Set(),
    undoVerified: new Set(),
    endStatus: null,
    undoStarted: false,
    manifest: null,
  }
  for (const line of lines) {
    if (!line.trim()) continue
    let record: JournalRecord
    try {
      record = JSON.parse(line) as JournalRecord
    } catch {
      continue
    }
    switch (record.t) {
      case 'begin':
        state.root = record.root
        state.targetRoot = record.targetRoot
        state.startedAt = record.at
        break
      case 'intent':
        state.intents.push(record)
        break
      case 'skip':
        state.skipped.add(record.i)
        break
      case 'verified':
        state.verified.add(record.i)
        break
      case 'manifest':
        state.manifest = record.path
        break
      case 'end':
        state.endStatus = record.status
        break
      case 'undo-begin':
        state.undoStarted = true
        break
      case 'undo-done':
      case 'undo-lost':
        state.undone.add(record.i)
        break
      case 'undo-verified':
        state.undoVerified.add(record.i)
        break
    }
  }
  return state
}

export function pendingUndo(state: JournalState): IntentRecord[] {
  return state.intents.filter((r) => !state.skipped.has(r.i) && !state.undone.has(r.i))
}

function statusOf(state: JournalState, moved: number, pending: number): SessionStatus {
  if (moved > 0 && pending === 0) return 'undone'
  if (state.undoStarted) return pending === 0 ? 'undone' : 'partially-undone'
  return state.endStatus ?? 'interrupted'
}

export function summarize(state: JournalState): SessionSummary {
  const moved = state.intents.filter((r) => !state.skipped.has(r.i)).length
  const pending = pendingUndo(state).length
  return {
    id: state.id,
    root: state.root,
    targetRoot: state.targetRoot,
    startedAt: state.startedAt,
    moved,
    pending,
    status: statusOf(state, moved, pending),
  }
}

export async function listSessions(dir: string): Promise<SessionSummary[]> {
  let names: string[]
  try {
    names = await readdir(dir)
  } catch (err) {
    if (errorCode(err) === 'ENOENT') return []
    throw err
  }
  const sessions: SessionSummary[] = []
  for (const name of names) {
    if (name.endsWith('.jsonl')) sessions.push(summarize(await readJournal(dir, name.slice(0, -'.jsonl'.length))))
  }
  return sessions.sort((a, b) => b.startedAt - a.startedAt)
}
