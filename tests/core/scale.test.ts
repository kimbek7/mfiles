import { expect, it } from 'vitest'
import { buildPlan } from '../../src/core/planner'
import { TreeIndex } from '../../src/core/tree'
import { CATEGORIES } from '../../src/core/types'
import type { FileEntry } from '../../src/core/types'

const COUNT = 500_000

function syntheticEntries(): FileEntry[] {
  return Array.from({ length: COUNT }, (_, i) => {
    const name = `plik-${i % 5000}.dat`
    return {
      path: `C:\\r\\New folder (${i % 40})\\Temp (${i % 700})\\Inne (${i % 9000})\\${name}`,
      name,
      ext: 'dat',
      size: (i * 2654435761) % 5_000_000,
      mtimeMs: 1_500_000_000_000 + i * 1000,
      kind: 'file',
      category: CATEGORIES[i % CATEGORIES.length],
    }
  })
}

it(`builds the tree and plan for ${COUNT} entries`, () => {
  const entries = syntheticEntries()

  const treeStart = performance.now()
  const tree = new TreeIndex('C:\\r')
  for (const entry of entries) tree.add(entry)
  const tiles = tree.tiles()
  const treeMs = performance.now() - treeStart

  const planStart = performance.now()
  const plan = buildPlan(entries, [], {
    root: 'C:\\r',
    targetRoot: 'C:\\r\\_Posortowane',
    dimensions: ['type', 'year', 'month'],
    separateDuplicates: true,
  })
  const planMs = performance.now() - planStart

  console.log(`tree: ${Math.round(treeMs)} ms, plan: ${Math.round(planMs)} ms, groups: ${plan.groups.length}`)
  expect(plan.moves).toHaveLength(COUNT)
  expect(new Set(plan.moves.map((m) => m.to.toLowerCase())).size).toBe(COUNT)
  expect(tiles.length).toBe(40)
  expect(treeMs + planMs).toBeLessThan(15000)
}, 60000)
