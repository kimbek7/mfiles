import { mkdtemp, readFile, rm } from 'node:fs/promises'
import path from 'node:path'
import { expect, it } from 'vitest'
import { executePlan, undoSession } from '../../src/core/executor'
import { buildPlan } from '../../src/core/planner'
import { emptyStats, scan } from '../../src/core/scanner'
import type { FileEntry } from '../../src/core/types'
import { snapshot, tempDir, writeTree } from './helpers'

const secondVolume = process.env.MFILES_SECOND_VOLUME

it.skipIf(!secondVolume)(
  'moves and undoes on a real second drive',
  async () => {
    const target = await mkdtemp(path.join(secondVolume as string, 'mfiles-test-'))
    try {
      const root = await tempDir()
      const journalDir = await tempDir()
      await writeTree(root, {
        'duży.bin': Buffer.alloc(5 * 1024 * 1024, 3),
        'pusty.txt': '',
        'projekt/.git/HEAD': 'ref',
        'projekt/src/a.ts': 'const a = 1',
      })
      const before = await snapshot(root)
      const entries: FileEntry[] = []
      for await (const batch of scan(root, emptyStats())) entries.push(...batch)
      const plan = buildPlan(entries, [], {
        root,
        targetRoot: target,
        dimensions: ['type'],
        separateDuplicates: false,
        language: 'pl',
      })

      const run = await executePlan(plan, { journalDir })
      expect(run.failed).toEqual([])
      expect(run.moved).toBe(3)
      expect(Object.keys(await snapshot(root))).toEqual([])
      await expect(readFile(path.join(target, 'Projekty', 'projekt', 'src', 'a.ts'), 'utf8')).resolves.toBe(
        'const a = 1',
      )

      const undo = await undoSession(run.sessionId, { journalDir })
      expect(undo).toEqual({ restored: 3, conflicts: [], lost: [] })
      expect(await snapshot(root)).toEqual(before)
      expect(Object.keys(await snapshot(target))).toEqual([])
    } finally {
      await rm(target, { recursive: true, force: true })
    }
  },
  60000,
)
