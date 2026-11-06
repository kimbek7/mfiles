import type { OutputLabels } from '../shared/i18n'
import type { DuplicateGroup, FileEntry } from './types'
import { forEachLimit, hashFile } from './util'

const PARTIAL_BYTES = 64 * 1024

export interface DuplicateOptions {
  signal?: AbortSignal
  skipContent?: (entry: FileEntry) => boolean
  onProgress?: (hashed: number, total: number) => void
}

function groupBy<T>(items: T[], keyOf: (item: T) => string | number): T[][] {
  const groups = new Map<string | number, T[]>()
  for (const item of items) {
    const key = keyOf(item)
    const group = groups.get(key)
    if (group) group.push(item)
    else groups.set(key, [item])
  }
  return [...groups.values()]
}

async function hashAll(
  entries: FileEntry[],
  maxBytes: number | undefined,
  options: DuplicateOptions,
  onHashed: () => void,
): Promise<Map<FileEntry, string>> {
  const hashes = new Map<FileEntry, string>()
  await forEachLimit(
    entries,
    4,
    async (entry) => {
      try {
        hashes.set(entry, await hashFile(entry.path, maxBytes))
      } catch {
        // An unreadable file takes no part in duplicate detection.
      }
      onHashed()
    },
    options.signal,
  )
  return hashes
}

export function pickKeeper(entries: FileEntry[]): FileEntry {
  return [...entries].sort(
    (a, b) => a.mtimeMs - b.mtimeMs || a.path.length - b.path.length || a.path.localeCompare(b.path),
  )[0]
}

/** Size → 64 KB hash → full hash. Only files that pass the first two filters are read in full. */
export async function findDuplicates(entries: FileEntry[], options: DuplicateOptions = {}): Promise<DuplicateGroup[]> {
  const eligible = entries.filter((e) => e.kind === 'file' && e.size > 0 && !options.skipContent?.(e))
  const sameSize = groupBy(eligible, (e) => e.size).filter((g) => g.length > 1)
  const candidates = sameSize.flat()
  let hashed = 0
  const tick = (total: number) => () => options.onProgress?.(++hashed, total)

  const partial = await hashAll(candidates, PARTIAL_BYTES, options, tick(candidates.length))
  const samePartial = sameSize.flatMap((group) =>
    groupBy(
      group.filter((e) => partial.has(e)),
      (e) => partial.get(e) as string,
    ).filter((g) => g.length > 1),
  )

  const needFull = samePartial.flat().filter((e) => e.size > PARTIAL_BYTES)
  hashed = 0
  const full = await hashAll(needFull, undefined, options, tick(needFull.length))
  const hashOf = (e: FileEntry): string | undefined => (e.size > PARTIAL_BYTES ? full.get(e) : partial.get(e))

  const result: DuplicateGroup[] = []
  for (const group of samePartial) {
    const known = group.filter((e) => hashOf(e) !== undefined)
    for (const same of groupBy(known, (e) => hashOf(e) as string)) {
      if (same.length < 2) continue
      result.push({
        hash: hashOf(same[0]) as string,
        size: same[0].size,
        paths: same.map((e) => e.path),
        keeper: pickKeeper(same).path,
      })
    }
  }
  return result.sort((a, b) => b.size * (b.paths.length - 1) - a.size * (a.paths.length - 1))
}

export function duplicateSegments(entry: FileEntry, labels: OutputLabels): string[] {
  return [labels.duplicates, labels.categories[entry.category]]
}
