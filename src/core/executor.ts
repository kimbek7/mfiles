import { randomBytes } from 'node:crypto'
import { constants } from 'node:fs'
import {
  copyFile,
  cp,
  lstat,
  mkdir,
  open,
  readdir,
  readlink,
  rename,
  rm,
  rmdir,
  unlink,
  utimes,
  writeFile,
} from 'node:fs/promises'
import type { Stats } from 'node:fs'
import path from 'node:path'
import { Journal, pendingUndo, readJournal } from './journal'
import type { IntentRecord } from './journal'
import { isProtectedPath } from './safety'
import type { EntryKind, Move, MoveFailure, Plan, RunResult, UndoResult } from './types'
import { errorCode, hashFile } from './util'

export const TEMP_SUFFIX = '.mfiles-tmp'
const MANIFEST_PREFIX = '_Spis-'

export type Step =
  | 'intent'
  | 'placeholder'
  | 'copied'
  | 'renamed'
  | 'verified'
  | 'source-removed'
  | 'done'
  | 'manifest'

/** Test-only exception simulating a sudden stop: it skips all cleanup. */
export class SimulatedCrash extends Error {}

export interface FsOverrides {
  rename?: typeof rename
}

interface MoveContext {
  rename: typeof rename
  hook: (step: Step) => Promise<void>
  onVerified: () => Promise<void>
}

export interface ExecuteOptions {
  journalDir: string
  signal?: AbortSignal
  sessionId?: string
  onProgress?: (move: Move, outcome: { ok: boolean; reason?: MoveFailure; to: string }) => void
  hook?: (step: Step, index: number) => Promise<void> | void
  fs?: FsOverrides
}

export interface UndoOptions {
  journalDir: string
  signal?: AbortSignal
  onProgress?: (intent: IntentRecord, restored: boolean) => void
  hook?: (step: Step, index: number) => Promise<void> | void
  fs?: FsOverrides
}

async function statOrNull(p: string): Promise<Stats | null> {
  try {
    return await lstat(p)
  } catch (err) {
    if (errorCode(err) === 'ENOENT') return null
    throw err
  }
}

function withSuffix(target: string, kind: EntryKind, n: number): string {
  const ext = kind === 'file' ? path.extname(target) : ''
  const stem = ext ? target.slice(0, -ext.length) : target
  return `${stem} (${n})${ext}`
}

async function freeTarget(target: string, kind: EntryKind): Promise<string> {
  let candidate = target
  for (let n = 2; (await statOrNull(candidate)) !== null; n++) candidate = withSuffix(target, kind, n)
  return candidate
}

async function missingDirs(dir: string): Promise<string[]> {
  const missing: string[] = []
  let current = dir
  while ((await statOrNull(current)) === null) {
    missing.push(current)
    const parent = path.dirname(current)
    if (parent === current) break
    current = parent
  }
  return missing
}

async function listTree(root: string): Promise<Map<string, Stats>> {
  const items = new Map<string, Stats>()
  const stack = ['']
  while (stack.length > 0) {
    const relative = stack.pop() as string
    for (const name of await readdir(path.join(root, relative))) {
      const child = path.join(relative, name)
      const stat = await lstat(path.join(root, child))
      items.set(child, stat)
      if (stat.isDirectory()) stack.push(child)
    }
  }
  return items
}

async function treesMatch(a: string, b: string): Promise<boolean> {
  const left = await listTree(a)
  const right = await listTree(b)
  if (left.size !== right.size) return false
  for (const [relative, stat] of left) {
    const other = right.get(relative)
    if (!other) return false
    if (stat.isSymbolicLink()) {
      if (!other.isSymbolicLink()) return false
      if ((await readlink(path.join(a, relative))) !== (await readlink(path.join(b, relative)))) return false
    } else if (stat.isFile()) {
      if (!other.isFile() || stat.size !== other.size) return false
      if ((await hashFile(path.join(a, relative))) !== (await hashFile(path.join(b, relative)))) return false
    } else if (stat.isDirectory() !== other.isDirectory()) {
      return false
    }
  }
  return true
}

/** The target is reserved first because `rename` on Windows would overwrite an existing file. */
async function reserve(target: string): Promise<void> {
  const handle = await open(target, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY)
  await handle.close()
}

async function releaseReservation(target: string): Promise<void> {
  const stat = await statOrNull(target)
  if (stat?.isFile() && stat.size === 0) await unlink(target)
}

async function moveFileAcrossVolumes(from: string, to: string, ctx: MoveContext): Promise<void> {
  const temp = to + TEMP_SUFFIX
  try {
    const source = await lstat(from)
    await copyFile(from, temp, constants.COPYFILE_EXCL)
    await ctx.hook('copied')
    const copy = await lstat(temp)
    if (copy.size !== source.size || (await hashFile(from)) !== (await hashFile(temp))) {
      throw new Error('Kopia różni się od oryginału')
    }
    await utimes(temp, source.atime, source.mtime)
    await ctx.rename(temp, to)
  } catch (err) {
    if (!(err instanceof SimulatedCrash)) await rm(temp, { force: true })
    throw err
  }
  await ctx.hook('renamed')
  await ctx.onVerified()
  await ctx.hook('verified')
  await unlink(from)
  await ctx.hook('source-removed')
}

async function moveFolderAcrossVolumes(from: string, to: string, ctx: MoveContext): Promise<void> {
  const temp = to + TEMP_SUFFIX
  try {
    await cp(from, temp, {
      recursive: true,
      errorOnExist: true,
      force: false,
      preserveTimestamps: true,
      verbatimSymlinks: true,
    })
    await ctx.hook('copied')
    if (!(await treesMatch(from, temp))) throw new Error('Kopia różni się od oryginału')
    await ctx.rename(temp, to)
  } catch (err) {
    if (!(err instanceof SimulatedCrash)) await rm(temp, { recursive: true, force: true })
    throw err
  }
  await ctx.hook('renamed')
  await ctx.onVerified()
  await ctx.hook('verified')
  await rm(from, { recursive: true })
  await ctx.hook('source-removed')
}

async function moveFile(from: string, to: string, ctx: MoveContext): Promise<void> {
  await reserve(to)
  await ctx.hook('placeholder')
  try {
    await ctx.rename(from, to)
    await ctx.hook('renamed')
  } catch (err) {
    if (err instanceof SimulatedCrash) throw err
    if (errorCode(err) === 'EXDEV') {
      try {
        await moveFileAcrossVolumes(from, to, ctx)
        return
      } catch (copyErr) {
        if (!(copyErr instanceof SimulatedCrash) && (await statOrNull(from))) await releaseReservation(to)
        throw copyErr
      }
    }
    await releaseReservation(to)
    throw err
  }
}

async function moveFolder(from: string, to: string, ctx: MoveContext): Promise<void> {
  try {
    await ctx.rename(from, to)
    await ctx.hook('renamed')
  } catch (err) {
    if (errorCode(err) !== 'EXDEV') throw err
    await moveFolderAcrossVolumes(from, to, ctx)
  }
}

const moveEntry = (from: string, to: string, kind: EntryKind, ctx: MoveContext): Promise<void> =>
  kind === 'file' ? moveFile(from, to, ctx) : moveFolder(from, to, ctx)

function failureOf(err: unknown): MoveFailure {
  const code = errorCode(err)
  if (code === 'EBUSY' || code === 'EPERM' || code === 'EACCES') return 'locked'
  if (code === 'ENOENT') return 'missing'
  if (code === 'EEXIST') return 'collision'
  return 'error'
}

function isFresh(stat: Stats | null, move: Move): MoveFailure | null {
  if (!stat) return 'missing'
  if (move.kind === 'unit') return stat.isDirectory() ? null : 'changed'
  if (!stat.isFile() || stat.size !== move.size || Math.abs(stat.mtimeMs - move.mtimeMs) > 1) return 'changed'
  return null
}

const csvField = (value: string | number): string => `"${String(value).replaceAll('"', '""')}"`

function manifestContent(rows: { move: Move; to: string }[]): string {
  const header = ['Skąd', 'Dokąd', 'Grupa', 'Rozmiar (bajty)', 'Data modyfikacji']
  const lines = rows.map(({ move, to }) =>
    [move.from, to, move.group, move.size, new Date(move.mtimeMs).toISOString()].map(csvField).join(';'),
  )
  return `﻿${[header.map(csvField).join(';'), ...lines].join('\r\n')}\r\n`
}

export function newSessionId(): string {
  const stamp = new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14)
  return `${stamp}-${randomBytes(4).toString('hex')}`
}

export async function executePlan(plan: Plan, options: ExecuteOptions): Promise<RunResult> {
  const sessionId = options.sessionId ?? newSessionId()
  const journal = await Journal.open(options.journalDir, sessionId)
  const result: RunResult = { sessionId, moved: 0, failed: [], cancelled: false }
  const renameFn = options.fs?.rename ?? rename
  const movedRows: { move: Move; to: string }[] = []

  try {
    await journal.write(
      { t: 'begin', id: sessionId, root: plan.options.root, targetRoot: plan.options.targetRoot, at: Date.now() },
      true,
    )

    for (let i = 0; i < plan.moves.length; i++) {
      if (options.signal?.aborted) {
        result.cancelled = true
        break
      }
      const move = plan.moves[i]
      const hook = async (step: Step): Promise<void> => {
        await options.hook?.(step, i)
      }
      const fail = (reason: MoveFailure, detail?: string): void => {
        result.failed.push({ path: move.from, reason, detail })
        options.onProgress?.(move, { ok: false, reason, to: move.to })
      }

      if (isProtectedPath(move.from) || isProtectedPath(move.to)) {
        fail('protected')
        continue
      }

      let intentWritten = false
      let to = move.to
      try {
        const stale = isFresh(await statOrNull(move.from), move)
        if (stale) {
          fail(stale)
          continue
        }
        to = await freeTarget(move.to, move.kind)
        const parent = path.dirname(to)
        const dirs = await missingDirs(parent)
        await journal.write(
          { t: 'intent', i, from: move.from, to, kind: move.kind, size: move.size, mtimeMs: move.mtimeMs, dirs },
          true,
        )
        intentWritten = true
        await hook('intent')
        await mkdir(parent, { recursive: true })
        await moveEntry(move.from, to, move.kind, {
          rename: renameFn,
          hook,
          onVerified: () => journal.write({ t: 'verified', i }, true),
        })
      } catch (err) {
        if (err instanceof SimulatedCrash) throw err
        if (intentWritten) await journal.write({ t: 'skip', i }, true)
        fail(failureOf(err), (err as Error).message)
        continue
      }

      await journal.write({ t: 'done', i })
      await hook('done')
      result.moved++
      movedRows.push({ move, to })
      options.onProgress?.(move, { ok: true, to })
    }

    if (movedRows.length > 0) {
      const manifest = path.join(plan.options.targetRoot, `${MANIFEST_PREFIX}${sessionId}.csv`)
      await journal.write({ t: 'manifest', path: manifest }, true)
      await options.hook?.('manifest', plan.moves.length)
      try {
        await writeFile(manifest, manifestContent(movedRows), { flag: 'wx' })
        result.manifest = manifest
      } catch {
        // The manifest is a convenience: losing it does not change the result, and the journal has the full data.
      }
    }

    await journal.write({ t: 'end', status: result.cancelled ? 'cancelled' : 'completed' }, true)
    return result
  } finally {
    await journal.close()
  }
}

async function removeTemps(intent: IntentRecord): Promise<void> {
  await rm(intent.to + TEMP_SUFFIX, { recursive: true, force: true })
  await rm(intent.from + TEMP_SUFFIX, { recursive: true, force: true })
}

async function sameContent(a: string, b: string): Promise<boolean> {
  return (await hashFile(a)) === (await hashFile(b))
}

type Reconciled = 'restored' | 'needs-move' | 'lost' | 'conflict'

/** Works out the state of a file after an interruption and removes only what is provably left over from this operation. */
async function reconcile(intent: IntentRecord, verified: boolean, undoVerified: boolean): Promise<Reconciled> {
  await removeTemps(intent)
  const from = await statOrNull(intent.from)
  const to = await statOrNull(intent.to)

  if (!to) return from ? 'restored' : 'lost'
  if (!from) return 'needs-move'

  if (intent.kind === 'unit') {
    if (undoVerified) {
      await rm(intent.to, { recursive: true })
      return 'restored'
    }
    if (verified) {
      await rm(intent.from, { recursive: true })
      return 'needs-move'
    }
    if (await treesMatch(intent.from, intent.to)) {
      await rm(intent.to, { recursive: true })
      return 'restored'
    }
    return 'conflict'
  }

  if (intent.size === 0 && from.size === 0 && to.size === 0) {
    // Both empty: the original is identified by its date, since the reservation carries its creation time.
    if (Math.abs(from.mtimeMs - intent.mtimeMs) <= 1) {
      await unlink(intent.to)
      return 'restored'
    }
    await unlink(intent.from)
    return 'needs-move'
  }
  if (from.size === intent.size && to.size === 0) {
    await unlink(intent.to)
    return 'restored'
  }
  if (to.size === intent.size && from.size === 0) {
    await unlink(intent.from)
    return 'needs-move'
  }
  if (from.size === to.size && (await sameContent(intent.from, intent.to))) {
    await unlink(intent.to)
    return 'restored'
  }
  return 'conflict'
}

/** Undoes a session from the end. Also works after a crash, including when a previous undo was interrupted. */
export async function undoSession(sessionId: string, options: UndoOptions): Promise<UndoResult> {
  const state = await readJournal(options.journalDir, sessionId)
  const journal = await Journal.open(options.journalDir, sessionId)
  const result: UndoResult = { restored: 0, conflicts: [], lost: [] }
  const renameFn = options.fs?.rename ?? rename

  try {
    await journal.write({ t: 'undo-begin' }, true)

    const pending = pendingUndo(state).reverse()
    for (const intent of pending) {
      if (options.signal?.aborted) break
      const hook = async (step: Step): Promise<void> => {
        await options.hook?.(step, intent.i)
      }
      try {
        const status = await reconcile(intent, state.verified.has(intent.i), state.undoVerified.has(intent.i))
        if (status === 'lost') {
          await journal.write({ t: 'undo-lost', i: intent.i }, true)
          result.lost.push(intent.from)
          continue
        }
        if (status === 'conflict') {
          result.conflicts.push({ from: intent.from, to: intent.to, reason: 'Oba pliki istnieją i się różnią' })
          continue
        }
        if (status === 'needs-move') {
          await mkdir(path.dirname(intent.from), { recursive: true })
          await moveEntry(intent.to, intent.from, intent.kind, {
            rename: renameFn,
            hook,
            onVerified: () => journal.write({ t: 'undo-verified', i: intent.i }, true),
          })
        }
        await journal.write({ t: 'undo-done', i: intent.i }, true)
        await hook('done')
        result.restored++
        options.onProgress?.(intent, true)
      } catch (err) {
        if (err instanceof SimulatedCrash) throw err
        result.conflicts.push({ from: intent.from, to: intent.to, reason: (err as Error).message })
        options.onProgress?.(intent, false)
      }
    }

    if (state.manifest && path.basename(state.manifest).startsWith(MANIFEST_PREFIX)) {
      await rm(state.manifest, { force: true })
    }

    const createdDirs = [...new Set(state.intents.flatMap((r) => r.dirs))].sort((a, b) => b.length - a.length)
    for (const dir of createdDirs) {
      await rmdir(dir).catch(() => undefined)
    }

    await journal.write({ t: 'undo-end' }, true)
    return result
  } finally {
    await journal.close()
  }
}
