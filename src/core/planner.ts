import { randomUUID } from 'node:crypto'
import path from 'node:path'
import { analyzeContext, TOPICS_DIR } from './context'
import { DUPLICATES_DIR, duplicateSegments } from './duplicates'
import { isProtectedPath, isWithin, samePath } from './safety'
import { CATEGORY_LABELS } from './types'
import type {
  BucketSummary,
  Dimension,
  DuplicateGroup,
  FileEntry,
  GroupSummary,
  Move,
  OriginSummary,
  Plan,
  PlanOptions,
  PlanSkip,
} from './types'

export const DEFAULT_TARGET_DIR = '_Posortowane'
export const LOOSE_ORIGIN_LABEL = '(luźne pliki)'

const MB = 1024 * 1024
const GB = 1024 * MB
const SIDECAR_EXTS = new Set(['srt', 'sub', 'vtt', 'ass', 'lrc', 'xmp', 'aae', 'cue'])

export function sizeBucket(size: number): string {
  if (size < MB) return 'Poniżej 1 MB'
  if (size < 100 * MB) return '1–100 MB'
  if (size < GB) return '100 MB–1 GB'
  return 'Powyżej 1 GB'
}

function entryDate(entry: FileEntry): Date | null {
  const ms = entry.takenAtMs ?? entry.mtimeMs
  return ms > 0 ? new Date(ms) : null
}

export function segmentsFor(entry: FileEntry, dimensions: Dimension[]): string[] {
  const date = entryDate(entry)
  const year = date ? String(date.getFullYear()) : 'Bez daty'
  const month = date ? String(date.getMonth() + 1).padStart(2, '0') : 'Bez daty'
  const hasYearBefore = (index: number): boolean => dimensions.slice(0, index).includes('year')

  return dimensions.map((dimension, index) => {
    switch (dimension) {
      case 'type':
        return CATEGORY_LABELS[entry.category]
      case 'year':
        return year
      case 'month':
        return hasYearBefore(index) || !date ? month : `${year}-${month}`
      case 'size':
        return sizeBucket(entry.size)
    }
  })
}

function uniqueTarget(target: string, kind: FileEntry['kind'], taken: Set<string>): string {
  const ext = kind === 'file' ? path.extname(target) : ''
  const stem = ext ? target.slice(0, -ext.length) : target
  let candidate = target
  for (let n = 2; taken.has(candidate.toLowerCase()); n++) candidate = `${stem} (${n})${ext}`
  taken.add(candidate.toLowerCase())
  return candidate
}

function originLabel(root: string, entry: FileEntry): string {
  const relative = path.relative(root, path.dirname(entry.path))
  if (relative && !relative.startsWith('..')) return relative.split(path.sep)[0]
  return entry.kind === 'unit' ? entry.name : LOOSE_ORIGIN_LABEL
}

function stemKey(dir: string, stem: string): string {
  return `${dir}|${stem}`.toLowerCase()
}

function folderOf(filePath: string): string {
  return filePath.slice(0, filePath.lastIndexOf(path.sep))
}

function stemOf(entry: FileEntry): string {
  return entry.ext ? entry.name.slice(0, entry.name.length - entry.ext.length - 1) : entry.name
}

/** Paths in one folder give the same answer, and an expensive `path.resolve` per file slowed down large plans. */
function memoizeByFolder<T>(compute: (filePath: string) => T): (filePath: string) => T {
  const cache = new Map<string, T>()
  return (filePath) => {
    const folder = folderOf(filePath)
    let value = cache.get(folder)
    if (value === undefined) {
      value = compute(filePath)
      cache.set(folder, value)
    }
    return value
  }
}

/** `film.pl.srt` and `foto.jpg.xmp` belong to `film` and `foto`, so the shorter stem is checked too. */
function sidecarStems(entry: FileEntry): string[] {
  const stem = stemOf(entry)
  const shorter = path.parse(stem).name
  return shorter && shorter !== stem ? [stem, shorter] : [stem]
}

function indexPrimaries(entries: FileEntry[]): Map<string, FileEntry> {
  const primaries = new Map<string, FileEntry>()
  for (const entry of entries) {
    if (entry.kind !== 'file' || SIDECAR_EXTS.has(entry.ext)) continue
    const key = stemKey(folderOf(entry.path), stemOf(entry))
    const current = primaries.get(key)
    if (!current || entry.size > current.size) primaries.set(key, entry)
  }
  return primaries
}

function primaryOf(entry: FileEntry, primaries: Map<string, FileEntry>): FileEntry | undefined {
  if (entry.kind !== 'file' || !SIDECAR_EXTS.has(entry.ext)) return undefined
  const dir = folderOf(entry.path)
  for (const stem of sidecarStems(entry)) {
    const primary = primaries.get(stemKey(dir, stem))
    if (primary) return primary
  }
  return undefined
}

function followerName(entry: FileEntry, primary: FileEntry, primaryTo: string): string {
  const primaryStem = path.parse(primary.name).name
  const finalStem = path.parse(primaryTo).name
  return finalStem + entry.name.slice(primaryStem.length)
}

function duplicatesToSeparate(duplicates: DuplicateGroup[], pinned: Set<string>): Set<string> {
  const extras = new Set<string>()
  for (const group of duplicates) {
    const hasPinnedCopy = group.paths.some((p) => pinned.has(p))
    for (const p of group.paths) {
      if (!pinned.has(p) && (hasPinnedCopy || p !== group.keeper)) extras.add(p)
    }
  }
  return extras
}

/** Pure function: builds the plan of changes without touching the disk. */
export function buildPlan(
  entries: FileEntry[],
  duplicates: DuplicateGroup[],
  options: PlanOptions,
  id: string = randomUUID(),
): Plan {
  const dimensions: Dimension[] = options.dimensions.length > 0 ? options.dimensions : ['type']
  const { root, targetRoot } = options
  const isSorted = memoizeByFolder((p) => isWithin(targetRoot, p))
  const isProtectedFile = memoizeByFolder(isProtectedPath)
  const unsorted = entries.filter((e) => !(e.kind === 'unit' ? isWithin(targetRoot, e.path) : isSorted(e.path)))
  const alreadySorted = entries.length - unsorted.length
  const targetProtected = isProtectedPath(targetRoot)

  const context = analyzeContext(unsorted, root, targetRoot, options.folderDecisions)
  const extraCopies = options.separateDuplicates ? duplicatesToSeparate(duplicates, context.pinned) : new Set<string>()
  const primaries = indexPrimaries(context.loose)

  const taken = new Set<string>()
  const moves: Move[] = []
  const skipped: PlanSkip[] = []
  const groupTotals = new Map<string, GroupSummary>()
  const bucketTotals = new Map<string, BucketSummary>()
  const originTotals = new Map<string, OriginSummary>()
  const moveOrigins: string[] = []
  const placed = new Map<string, { segments: string[]; to: string }>()
  const fileOrigin = memoizeByFolder((p) => originLabel(root, { path: p, kind: 'file' } as FileEntry))
  let totalBytes = 0

  const place = (entry: FileEntry, segments: string[], name: string = entry.name): void => {
    const duplicate = extraCopies.has(entry.path)
    const to = uniqueTarget(path.join(targetRoot, ...segments, name), entry.kind, taken)
    const group = segments.join('/')
    const bucketLabel = segments[0]
    const origin = entry.kind === 'unit' ? originLabel(root, entry) : fileOrigin(entry.path)
    placed.set(entry.path, { segments, to })

    const groupTotal = groupTotals.get(group) ?? { key: group, count: 0, bytes: 0 }
    groupTotal.count++
    groupTotal.bytes += entry.size
    groupTotals.set(group, groupTotal)

    const bucketTotal = bucketTotals.get(bucketLabel) ?? {
      label: bucketLabel,
      count: 0,
      bytes: 0,
      category:
        bucketLabel === TOPICS_DIR
          ? 'topics'
          : dimensions[0] === 'type' && bucketLabel !== DUPLICATES_DIR
            ? entry.category
            : null,
    }
    bucketTotal.count++
    bucketTotal.bytes += entry.size
    bucketTotals.set(bucketLabel, bucketTotal)

    const originTotal = originTotals.get(origin) ?? { label: origin, count: 0, bytes: 0 }
    originTotal.count++
    originTotal.bytes += entry.size
    originTotals.set(origin, originTotal)

    totalBytes += entry.size
    moves.push({
      id: moves.length,
      from: entry.path,
      to,
      kind: entry.kind,
      size: entry.size,
      mtimeMs: entry.mtimeMs,
      category: entry.category,
      group,
      bucket: 0,
      origin: 0,
      duplicate,
    })
    moveOrigins.push(origin)
  }

  const standardSegments = (entry: FileEntry): string[] => {
    if (extraCopies.has(entry.path)) return duplicateSegments(entry)
    return entry.category === 'topics' ? [TOPICS_DIR] : segmentsFor(entry, dimensions)
  }

  const followers: { entry: FileEntry; lead: FileEntry }[] = []
  const companions: FileEntry[] = []
  for (const entry of [...context.loose, ...context.wholeFolders]) {
    if (entry.kind === 'unit' && samePath(entry.path, root)) {
      skipped.push({ path: entry.path, reason: 'root-is-project' })
    } else if (entry.kind === 'unit' && isWithin(entry.path, targetRoot)) {
      skipped.push({ path: entry.path, reason: 'target-inside-unit' })
    } else if (targetProtected || (entry.kind === 'unit' ? isProtectedPath(entry.path) : isProtectedFile(entry.path))) {
      skipped.push({ path: entry.path, reason: 'protected' })
    } else if (entry.companionOf) {
      companions.push(entry)
    } else {
      const lead = primaryOf(entry, primaries)
      if (lead) followers.push({ entry, lead })
      else place(entry, standardSegments(entry))
    }
  }

  // Dependent files wait for their main file: only then is the final name known.
  for (const { entry, lead } of followers) {
    const target = placed.get(lead.path)
    if (target) place(entry, target.segments, followerName(entry, lead, target.to))
    else place(entry, standardSegments(entry))
  }
  for (const entry of companions) {
    const target = placed.get(entry.companionOf as string)
    place(entry, target?.segments ?? [TOPICS_DIR])
  }

  const buckets = [...bucketTotals.values()].sort((a, b) => b.bytes - a.bytes)
  const origins = [...originTotals.values()].sort((a, b) => b.bytes - a.bytes)
  const bucketPosition = new Map(buckets.map((b, i) => [b.label, i]))
  const originPosition = new Map(origins.map((o, i) => [o.label, i]))
  for (const move of moves) {
    move.bucket = bucketPosition.get(move.group.split('/')[0]) as number
    move.origin = originPosition.get(moveOrigins[move.id]) as number
  }

  return {
    id,
    options: { ...options, dimensions },
    moves,
    groups: [...groupTotals.values()].sort((a, b) => b.bytes - a.bytes),
    buckets,
    origins,
    skipped,
    alreadySorted,
    totalBytes,
    topics: context.topics,
    kept: context.kept,
  }
}
