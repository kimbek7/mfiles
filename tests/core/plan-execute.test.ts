import { mkdir, readdir, readFile, rename, stat, utimes, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { enrichEntries } from '../../src/core/classifier'
import { findDuplicates } from '../../src/core/duplicates'
import { executePlan, SimulatedCrash, TEMP_SUFFIX, undoSession } from '../../src/core/executor'
import type { FsOverrides } from '../../src/core/executor'
import { listSessions, readJournal, sessionPath } from '../../src/core/journal'
import { buildPlan, segmentsFor, sizeBucket } from '../../src/core/planner'
import { outputLabels } from '../../src/shared/i18n'
import { emptyStats, scan } from '../../src/core/scanner'
import type { Dimension, FileEntry, Plan } from '../../src/core/types'
import { snapshot, tempDir, writeTree } from './helpers'

const POLISH = outputLabels('pl')
const DEFAULT_TARGET_DIR = POLISH.targetDir

const TREE = {
  'raport.pdf': 'pdf-content',
  'zdjęcie 1.jpg': 'jpg-one',
  'sub/zdjęcie 1.jpg': 'jpg-two',
  'sub/głęboko/film.mp4': 'video',
  'kopia/raport.pdf': 'pdf-content',
  'pusty.txt': '',
  'projekt/.git/HEAD': 'ref: main',
  'projekt/src/a.ts': 'const a = 1',
  'bez-rozszerzenia': 'x',
}

async function prepare(root: string, dimensions: Dimension[] = ['type'], separateDuplicates = true): Promise<Plan> {
  const entries: FileEntry[] = []
  for await (const batch of scan(root, emptyStats())) entries.push(...batch)
  await enrichEntries(entries)
  const duplicates = await findDuplicates(entries)
  return buildPlan(entries, duplicates, {
    root,
    targetRoot: path.join(root, DEFAULT_TARGET_DIR),
    dimensions,
    separateDuplicates,
    language: 'pl',
  })
}

/** Rename pretending to span two volumes: only finalizing a temp file succeeds. */
const crossVolume: FsOverrides = {
  rename: async (from, to) => {
    if (String(from).endsWith(TEMP_SUFFIX)) return rename(from, to)
    throw Object.assign(new Error('cross-device'), { code: 'EXDEV' })
  },
}

function entry(partial: Partial<FileEntry>): FileEntry {
  return {
    path: 'C:\\r\\a.txt',
    name: 'a.txt',
    ext: 'txt',
    size: 1,
    mtimeMs: new Date(2023, 2, 15).getTime(),
    kind: 'file',
    category: 'documents',
    ...partial,
  }
}

describe('planner', () => {
  it('orders segments by the chosen dimensions', () => {
    const e = entry({})
    expect(segmentsFor(e, ['type', 'year', 'month'], POLISH)).toEqual(['Dokumenty', '2023', '03'])
    expect(segmentsFor(e, ['type', 'year', 'month'])).toEqual(['Documents', '2023', '03'])
    expect(segmentsFor(e, ['month'])).toEqual(['2023-03'])
    expect(segmentsFor(entry({ takenAtMs: new Date(2010, 0, 2).getTime() }), ['year'])).toEqual(['2010'])
  })

  it('sets size buckets at their boundaries', () => {
    expect(sizeBucket(1024 * 1024 - 1)).toBe('Under 1 MB')
    expect(sizeBucket(1024 * 1024)).toBe('1–100 MB')
    expect(sizeBucket(1024 ** 3)).toBe('Over 1 GB')
  })

  it('resolves name collisions regardless of case', () => {
    const plan = buildPlan(
      [entry({ path: 'C:\\r\\Temp\\A.txt', name: 'A.txt' }), entry({ path: 'C:\\r\\Inne\\a.txt', name: 'a.txt' })],
      [],
      { root: 'C:\\r', targetRoot: 'C:\\r\\_S', dimensions: ['type'], separateDuplicates: false },
    )
    expect(plan.moves.map((m) => path.basename(m.to))).toEqual(['A.txt', 'a (2).txt'])
  })

  it('leaves sorted files alone and skips a unit containing the target', () => {
    const plan = buildPlan(
      [
        entry({ path: 'C:\\r\\app\\_S\\a.txt' }),
        entry({ path: 'C:\\r\\app', name: 'app', kind: 'unit', category: 'projects' }),
      ],
      [],
      { root: 'C:\\r', targetRoot: 'C:\\r\\app\\_S', dimensions: ['type'], separateDuplicates: false },
    )
    expect(plan.moves).toHaveLength(0)
    expect(plan.alreadySorted).toBe(1)
    expect(plan.skipped).toEqual([{ path: 'C:\\r\\app', reason: 'target-inside-unit' }])
  })

  it('does not move a root that is a project', () => {
    const plan = buildPlan([entry({ path: 'C:\\r', name: 'r', kind: 'unit' })], [], {
      root: 'C:\\r',
      targetRoot: 'C:\\r\\_S',
      dimensions: ['type'],
      separateDuplicates: false,
    })
    expect(plan.skipped[0].reason).toBe('root-is-project')
  })

  it('sends extra copies to _Duplikaty and group totals add up', async () => {
    const root = await tempDir()
    await writeTree(root, TREE)
    const plan = await prepare(root)
    const dupes = plan.moves.filter((m) => m.duplicate)
    expect(dupes).toHaveLength(1)
    expect(dupes[0].to).toContain(`_Duplikaty${path.sep}PDF`)
    expect(plan.buckets.reduce((sum, b) => sum + b.count, 0)).toBe(plan.moves.length)
    expect(plan.origins.reduce((sum, o) => sum + o.bytes, 0)).toBe(plan.totalBytes)
    for (const move of plan.moves) expect(plan.buckets[move.bucket].label).toBe(move.group.split('/')[0])
  })
})

describe('executor', () => {
  it('moves everything and undo restores an identical tree', async () => {
    const root = await tempDir()
    const journalDir = await tempDir()
    await writeTree(root, TREE)
    const before = await snapshot(root)
    const plan = await prepare(root, ['type', 'year'])

    const run = await executePlan(plan, { journalDir })
    expect(run).toMatchObject({ moved: plan.moves.length, failed: [], cancelled: false })
    for (const move of plan.moves) await expect(stat(move.to)).resolves.toBeDefined()
    const unit = plan.moves.find((m) => m.kind === 'unit') as Plan['moves'][number]
    await expect(readFile(path.join(unit.to, 'src', 'a.ts'), 'utf8')).resolves.toBe('const a = 1')

    const undo = await undoSession(run.sessionId, { journalDir })
    expect(undo).toEqual({ restored: plan.moves.length, conflicts: [], lost: [] })
    expect(await snapshot(root)).toEqual(before)
    const [session] = await listSessions(journalDir)
    expect(session).toMatchObject({ status: 'undone', pending: 0 })
  })

  it('never overwrites a file that appeared after the plan was built', async () => {
    const root = await tempDir()
    const journalDir = await tempDir()
    await writeTree(root, { 'a.txt': 'nowy' })
    const plan = await prepare(root)
    await writeTree(root, { '_Posortowane/Dokumenty/a.txt': 'istniejący' })

    await executePlan(plan, { journalDir })
    const dir = path.join(root, DEFAULT_TARGET_DIR, 'Dokumenty')
    await expect(readFile(path.join(dir, 'a.txt'), 'utf8')).resolves.toBe('istniejący')
    await expect(readFile(path.join(dir, 'a (2).txt'), 'utf8')).resolves.toBe('nowy')
  })

  it('skips a file changed or removed after the plan was built', async () => {
    const root = await tempDir()
    const journalDir = await tempDir()
    await writeTree(root, { 'a.txt': 'x', 'b.txt': 'y', 'c.txt': 'z' })
    const plan = await prepare(root)
    await writeFile(path.join(root, 'a.txt'), 'zmieniony')
    await rename(path.join(root, 'b.txt'), path.join(root, 'b2.txt'))

    const run = await executePlan(plan, { journalDir })
    expect(run.moved).toBe(1)
    expect(run.failed.map((f) => f.reason).sort()).toEqual(['changed', 'missing'])
    await expect(readFile(path.join(root, 'a.txt'), 'utf8')).resolves.toBe('zmieniony')
  })

  it('continues after a locked file and leaves no empty reservation', async () => {
    const root = await tempDir()
    const journalDir = await tempDir()
    await writeTree(root, { 'a.txt': 'x', 'b.txt': 'y' })
    const plan = await prepare(root)
    const locked = plan.moves[0].from
    const run = await executePlan(plan, {
      journalDir,
      fs: {
        rename: async (from, to) => {
          if (from === locked) throw Object.assign(new Error('busy'), { code: 'EBUSY' })
          return rename(from, to)
        },
      },
    })
    expect(run.moved).toBe(1)
    expect(run.failed[0]).toMatchObject({ path: locked, reason: 'locked' })
    await expect(stat(plan.moves[0].to)).rejects.toThrow()
    await expect(stat(locked)).resolves.toBeDefined()
  })

  it('a failed target reservation skips the file and does not stop the run', async () => {
    const root = await tempDir()
    const journalDir = await tempDir()
    await writeTree(root, { 'a.txt': 'a', 'b.txt': 'b' })
    const plan = await prepare(root)
    // A file in place of the parent folder makes mkdir fail for this move only.
    await writeTree(root, { blokada: 'x' })
    const blocked = plan.moves[0].from
    plan.moves[0].to = path.join(root, 'blokada', path.basename(blocked))

    const run = await executePlan(plan, { journalDir })
    expect(run.moved).toBe(1)
    expect(run.failed).toHaveLength(1)
    await expect(stat(blocked)).resolves.toBeDefined()
    const undo = await undoSession(run.sessionId, { journalDir })
    expect(undo.conflicts).toEqual([])
  })

  it('refuses system paths even with a crafted plan', async () => {
    const root = await tempDir()
    const journalDir = await tempDir()
    await writeTree(root, { 'a.txt': 'x' })
    const plan = await prepare(root)
    plan.moves[0].to = 'C:\\Windows\\a.txt'
    const run = await executePlan(plan, { journalDir })
    expect(run.failed[0].reason).toBe('protected')
    await expect(stat(path.join(root, 'a.txt'))).resolves.toBeDefined()
  })

  it('cancelling stops the run and undo restores what already moved', async () => {
    const root = await tempDir()
    const journalDir = await tempDir()
    await writeTree(root, { 'a.txt': 'a', 'b.txt': 'b', 'c.txt': 'c' })
    const before = await snapshot(root)
    const plan = await prepare(root)
    const controller = new AbortController()
    const run = await executePlan(plan, { journalDir, signal: controller.signal, onProgress: () => controller.abort() })
    expect(run).toMatchObject({ moved: 1, cancelled: true })
    await undoSession(run.sessionId, { journalDir })
    expect(await snapshot(root)).toEqual(before)
  })

  it('a cross-drive copy keeps contents and date, and undo restores the original', async () => {
    const root = await tempDir()
    const journalDir = await tempDir()
    await writeTree(root, TREE)
    await utimes(path.join(root, 'raport.pdf'), new Date(2001, 5, 1), new Date(2001, 5, 1))
    const before = await snapshot(root)
    const plan = await prepare(root)

    const run = await executePlan(plan, { journalDir, fs: crossVolume })
    expect(run.failed).toEqual([])
    const pdf = plan.moves.find((m) => m.from === path.join(root, 'raport.pdf')) as Plan['moves'][number]
    expect((await stat(pdf.to)).mtime.getFullYear()).toBe(2001)
    expect(await readdir(root)).not.toContain('pusty.txt')

    await undoSession(run.sessionId, { journalDir, fs: crossVolume })
    expect(await snapshot(root)).toEqual(before)
  })

  it('undo does not overwrite a file that took the place of the original', async () => {
    const root = await tempDir()
    const journalDir = await tempDir()
    await writeTree(root, { 'a.txt': 'oryginał' })
    const plan = await prepare(root)
    const run = await executePlan(plan, { journalDir })
    await writeTree(root, { 'a.txt': 'nowa treść' })

    const undo = await undoSession(run.sessionId, { journalDir })
    expect(undo.restored).toBe(0)
    expect(undo.conflicts).toHaveLength(1)
    await expect(readFile(path.join(root, 'a.txt'), 'utf8')).resolves.toBe('nowa treść')
    await expect(readFile(plan.moves[0].to, 'utf8')).resolves.toBe('oryginał')
    const [session] = await listSessions(journalDir)
    expect(session.status).toBe('partially-undone')
  })

  it('reports a file removed after sorting and recreates a removed source folder', async () => {
    const root = await tempDir()
    const journalDir = await tempDir()
    await writeTree(root, { 'Temp/a.txt': 'a', 'b.txt': 'b' })
    const plan = await prepare(root)
    const run = await executePlan(plan, { journalDir })
    const bMove = plan.moves.find((m) => m.from.endsWith('b.txt')) as Plan['moves'][number]
    await rename(bMove.to, path.join(await tempDir(), 'wyniesiony.txt'))
    await rename(path.join(root, 'Temp'), path.join(await tempDir(), 'Temp'))

    const undo = await undoSession(run.sessionId, { journalDir })
    expect(undo.lost).toEqual([bMove.from])
    await expect(readFile(path.join(root, 'Temp', 'a.txt'), 'utf8')).resolves.toBe('a')
  })

  it('ignores a truncated last journal line', async () => {
    const root = await tempDir()
    const journalDir = await tempDir()
    await writeTree(root, { 'a.txt': 'a' })
    const plan = await prepare(root)
    const run = await executePlan(plan, { journalDir })
    await writeFile(sessionPath(journalDir, run.sessionId), '{"t":"undo-do', { flag: 'a' })
    expect((await readJournal(journalDir, run.sessionId)).intents).toHaveLength(1)
  })

  it('rejects a session id containing a path fragment', () => {
    expect(() => sessionPath('C:\\j', '..\\..\\evil')).toThrow()
  })
})

const crashAt = (target: number) => {
  let count = 0
  return () => {
    if (count++ === target) throw new SimulatedCrash()
  }
}

async function countSteps(run: (hook: () => void) => Promise<unknown>): Promise<number> {
  let steps = 0
  await run(() => {
    steps++
  })
  return steps
}

describe.each([
  ['same volume', undefined],
  ['across drives', crossVolume],
] as const)('crash recovery: %s', (_label, fsOverride) => {
  const tree = {
    'raport.pdf': 'pdf',
    'kopia.pdf': 'pdf',
    'pusty.txt': '',
    'sub/a.txt': 'a',
    'projekt/.git/HEAD': 'r',
    'projekt/x.ts': 'x',
  }

  it('interrupting sorting at any step can be fully undone', async () => {
    const dry = await tempDir()
    await writeTree(dry, tree)
    const total = await countSteps(async (hook) =>
      executePlan(await prepare(dry), { journalDir: await tempDir(), fs: fsOverride, hook }),
    )
    expect(total).toBeGreaterThan(10)

    for (let step = 0; step < total; step++) {
      const root = await tempDir()
      const journalDir = await tempDir()
      await writeTree(root, tree)
      const before = await snapshot(root)
      const plan = await prepare(root)

      await expect(
        executePlan(plan, { journalDir, sessionId: 'crash', fs: fsOverride, hook: crashAt(step) }),
      ).rejects.toBeInstanceOf(SimulatedCrash)
      const [session] = await listSessions(journalDir)
      expect(session.status).toBe('interrupted')

      const undo = await undoSession('crash', { journalDir, fs: fsOverride })
      expect(undo.conflicts).toEqual([])
      expect(await snapshot(root), `krok ${step}`).toEqual(before)
    }
  }, 120000)

  it('interrupting undo at any step can be finished', async () => {
    const dry = await tempDir()
    await writeTree(dry, tree)
    const dryJournal = await tempDir()
    const dryRun = await executePlan(await prepare(dry), { journalDir: dryJournal, fs: fsOverride })
    const total = await countSteps((hook) =>
      undoSession(dryRun.sessionId, { journalDir: dryJournal, fs: fsOverride, hook }),
    )
    expect(total).toBeGreaterThan(5)

    for (let step = 0; step < total; step++) {
      const root = await tempDir()
      const journalDir = await tempDir()
      await writeTree(root, tree)
      const before = await snapshot(root)
      const run = await executePlan(await prepare(root), { journalDir, fs: fsOverride })

      await expect(
        undoSession(run.sessionId, { journalDir, fs: fsOverride, hook: crashAt(step) }),
      ).rejects.toBeInstanceOf(SimulatedCrash)
      const undo = await undoSession(run.sessionId, { journalDir, fs: fsOverride })
      expect(undo.conflicts).toEqual([])
      expect(await snapshot(root), `krok ${step}`).toEqual(before)
    }
  }, 120000)
})

it('a project copy with an empty folder returns with no temp file traces', async () => {
  const root = await tempDir()
  const journalDir = await tempDir()
  await writeTree(root, { 'projekt/.git/HEAD': 'r' })
  await mkdir(path.join(root, 'projekt', 'pusty'))
  const before = await snapshot(root)
  const run = await executePlan(await prepare(root), { journalDir, fs: crossVolume })
  await undoSession(run.sessionId, { journalDir, fs: crossVolume })
  expect(await snapshot(root)).toEqual(before)
})
